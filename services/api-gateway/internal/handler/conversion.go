package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/wordtex/api-gateway/internal/queue"
	"go.uber.org/zap"
)

const jobKeyPrefix = "wordtex:job:"

// ConversionHandler manages document conversion endpoints.
type ConversionHandler struct {
	publisher *queue.Publisher
	redis     *redis.Client
	logger    *zap.SugaredLogger
}

func NewConversionHandler(publisher *queue.Publisher, redisClient *redis.Client, logger *zap.SugaredLogger) *ConversionHandler {
	return &ConversionHandler{
		publisher: publisher,
		redis:     redisClient,
		logger:    logger,
	}
}

type SubmitRequest struct {
	Direction       string            `form:"direction" binding:"required"`
	TemplateOverride string           `form:"template_override"`
	EmbedAnchors    bool              `form:"embed_anchors"`
	SVGFallbacks    bool              `form:"svg_fallbacks"`
	PDFEngine       string            `form:"pdf_engine"`
}

type JobResponse struct {
	JobID          string `json:"job_id"`
	Status         string `json:"status"`
	EstimatedSecs  int    `json:"estimated_seconds,omitempty"`
	Message        string `json:"message,omitempty"`
}

type JobStatusResponse struct {
	JobID          string   `json:"job_id"`
	Status         string   `json:"status"`
	Progress       float64  `json:"progress_percent"`
	CurrentStage   string   `json:"current_stage,omitempty"`
	Error          string   `json:"error,omitempty"`
	OutputFilename string   `json:"output_filename,omitempty"`
	Metrics        *Metrics `json:"metrics,omitempty"`
}

type Metrics struct {
	ParseDurationMS     int64    `json:"parse_duration_ms"`
	TransformDurationMS int64    `json:"transform_duration_ms"`
	RenderDurationMS    int64    `json:"render_duration_ms"`
	TotalDurationMS     int64    `json:"total_duration_ms"`
	BlocksProcessed     int      `json:"blocks_processed"`
	EquationsProcessed  int      `json:"equations_processed"`
	Warnings            []string `json:"warnings,omitempty"`
}

// SubmitConversion handles POST /api/v1/convert
func (h *ConversionHandler) SubmitConversion(c *gin.Context) {
	// Parse multipart form
	if err := c.Request.ParseMultipartForm(100 << 20); err != nil { // 100MB max
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Failed to parse multipart form",
			"detail": err.Error(),
		})
		return
	}

	direction := c.PostForm("direction")
	if direction == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "direction is required"})
		return
	}

	// Validate direction
	validDirections := map[string]bool{
		"latex_to_word": true,
		"word_to_latex": true,
		"latex_to_pdf":  true,
		"word_to_pdf":   true,
		"round_trip":    true,
	}
	if !validDirections[direction] {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Invalid direction: %s. Must be one of: latex_to_word, word_to_latex, latex_to_pdf, word_to_pdf, round_trip", direction),
		})
		return
	}

	// Get uploaded file
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read file"})
		return
	}

	// Generate job ID
	jobID := uuid.New().String()

	h.logger.Infow("Conversion job submitted",
		"job_id", jobID,
		"direction", direction,
		"filename", header.Filename,
		"size_bytes", len(fileBytes),
	)

	// Build job message for the queue
	jobMsg := queue.ConversionJob{
		JobID:            jobID,
		Direction:        direction,
		SourceFilename:   header.Filename,
		SourceData:       fileBytes,
		TemplateOverride: c.PostForm("template_override"),
		EmbedAnchors:     c.PostForm("embed_anchors") == "true",
		SVGFallbacks:     c.PostForm("svg_fallbacks") == "true",
		PDFEngine:        c.DefaultPostForm("pdf_engine", "xelatex"),
		SubmittedAt:      time.Now(),
	}

	// Collect additional files (images, .bib, .sty)
	form := c.Request.MultipartForm
	if form != nil {
		for _, fileHeaders := range form.File {
			for _, fh := range fileHeaders {
				if fh.Filename == header.Filename {
					continue // Skip the main file
				}
				f, err := fh.Open()
				if err != nil {
					continue
				}
				data, err := io.ReadAll(f)
				f.Close()
				if err != nil {
					continue
				}
				jobMsg.AdditionalFiles = append(jobMsg.AdditionalFiles, queue.FileAttachment{
					Filename: fh.Filename,
					Data:     data,
				})
			}
		}
	}

	// Publish to message queue
	if h.publisher != nil {
		data, _ := json.Marshal(jobMsg)
		if err := h.publisher.Publish("wordtex.jobs.conversion", data); err != nil {
			h.logger.Errorw("Failed to publish job to queue", "error", err, "job_id", jobID)
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "Conversion service temporarily unavailable",
			})
			return
		}
	}

	// Estimate processing time based on file size
	estimatedSecs := max(5, len(fileBytes)/50000)

	c.JSON(http.StatusAccepted, JobResponse{
		JobID:         jobID,
		Status:        "queued",
		EstimatedSecs: estimatedSecs,
		Message:       fmt.Sprintf("Job submitted for %s conversion", direction),
	})
}

// GetJobStatus handles GET /api/v1/jobs/:id
func (h *ConversionHandler) GetJobStatus(c *gin.Context) {
	jobID := c.Param("id")

	if h.redis == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Status store unavailable"})
		return
	}

	data, err := h.redis.Get(context.Background(), jobKeyPrefix+jobID).Bytes()
	if err == redis.Nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job not found"})
		return
	}
	if err != nil {
		h.logger.Errorw("Redis get failed", "error", err, "job_id", jobID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch job status"})
		return
	}

	// Parse the orchestrator Job struct (only the fields we need)
	var job struct {
		ID             string  `json:"id"`
		State          string  `json:"state"`
		Progress       float64 `json:"progress"`
		CurrentStage   string  `json:"current_stage"`
		Error          string  `json:"error"`
		OutputFilename string  `json:"output_filename"`
		Metrics        *Metrics `json:"metrics"`
	}
	if err := json.Unmarshal(data, &job); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse job data"})
		return
	}

	c.JSON(http.StatusOK, JobStatusResponse{
		JobID:          job.ID,
		Status:         job.State,
		Progress:       job.Progress,
		CurrentStage:   job.CurrentStage,
		Error:          job.Error,
		OutputFilename: job.OutputFilename,
		Metrics:        job.Metrics,
	})
}

// CancelJob handles DELETE /api/v1/jobs/:id
func (h *ConversionHandler) CancelJob(c *gin.Context) {
	jobID := c.Param("id")
	h.logger.Infow("Job cancellation requested", "job_id", jobID)

	// TODO: Send cancellation message to queue
	c.JSON(http.StatusOK, gin.H{
		"job_id":  jobID,
		"status":  "cancelled",
		"message": "Cancellation requested",
	})
}

// DownloadResult handles GET /api/v1/jobs/:id/download
func (h *ConversionHandler) DownloadResult(c *gin.Context) {
	jobID := c.Param("id")

	if h.redis == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Store unavailable"})
		return
	}

	data, err := h.redis.Get(context.Background(), jobKeyPrefix+jobID).Bytes()
	if err == redis.Nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Store error"})
		return
	}

	var job struct {
		State          string `json:"state"`
		OutputFilename string `json:"output_filename"`
		OutputData     []byte `json:"output_data"`
	}
	if err := json.Unmarshal(data, &job); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse job"})
		return
	}

	if job.State != "completed" {
		c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("Job is not complete (state: %s)", job.State)})
		return
	}

	if len(job.OutputData) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "No output data available for this job"})
		return
	}

	filename := job.OutputFilename
	if filename == "" {
		filename = fmt.Sprintf("wordtex-%s.docx", jobID)
	}

	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Data(http.StatusOK, "application/octet-stream", job.OutputData)
}

// StreamProgress handles WebSocket at GET /api/v1/jobs/:id/progress
func (h *ConversionHandler) StreamProgress(c *gin.Context) {
	jobID := c.Param("id")
	h.logger.Infow("Progress stream requested", "job_id", jobID)

	// TODO: Upgrade to WebSocket and stream progress events
	c.JSON(http.StatusNotImplemented, gin.H{
		"error": "WebSocket streaming not yet implemented",
	})
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
