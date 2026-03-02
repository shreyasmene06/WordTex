package engine

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/wordtex/orchestrator/internal/config"
	"github.com/wordtex/orchestrator/internal/store"
	"go.uber.org/zap"
)

// JobState represents the state machine for a conversion job.
type JobState string

const (
	StateQueued         JobState = "queued"
	StateParsing        JobState = "parsing"
	StateTransforming   JobState = "transforming"
	StateRendering      JobState = "rendering"
	StatePostProcessing JobState = "post_processing"
	StateCompleted      JobState = "completed"
	StateFailed         JobState = "failed"
	StateCancelled      JobState = "cancelled"
)

// Job represents a conversion job in the orchestration pipeline.
type Job struct {
	ID               string    `json:"id"`
	Direction        string    `json:"direction"`
	State            JobState  `json:"state"`
	SourceFilename   string    `json:"source_filename"`
	SourceData       []byte    `json:"source_data,omitempty"`
	TemplateOverride string    `json:"template_override,omitempty"`
	EmbedAnchors     bool      `json:"embed_anchors"`
	SVGFallbacks     bool      `json:"svg_fallbacks"`
	PDFEngine        string    `json:"pdf_engine,omitempty"`
	SubmittedAt      time.Time `json:"submitted_at"`
	StartedAt        time.Time `json:"started_at,omitempty"`
	CompletedAt      time.Time `json:"completed_at,omitempty"`
	Progress         float64   `json:"progress"`
	CurrentStage     string    `json:"current_stage"`
	Error            string    `json:"error,omitempty"`
	OutputFilename   string    `json:"output_filename,omitempty"`
	OutputData       []byte    `json:"output_data,omitempty"`
	RetryCount       int       `json:"retry_count"`
	Metrics          JobMetrics `json:"metrics"`
}

type JobMetrics struct {
	ParseDurationMS     int64 `json:"parse_duration_ms"`
	TransformDurationMS int64 `json:"transform_duration_ms"`
	RenderDurationMS    int64 `json:"render_duration_ms"`
	TotalDurationMS     int64 `json:"total_duration_ms"`
	BlocksProcessed     int   `json:"blocks_processed"`
	EquationsProcessed  int   `json:"equations_processed"`
}

// Orchestrator manages the conversion pipeline and coordinates workers.
type Orchestrator struct {
	cfg      *config.Config
	store    *store.RedisJobStore
	logger   *zap.SugaredLogger
	conn     *amqp.Connection
	channel  *amqp.Channel
	workers  chan struct{}
}

func NewOrchestrator(cfg *config.Config, store *store.RedisJobStore, logger *zap.SugaredLogger) (*Orchestrator, error) {
	conn, err := amqp.Dial(cfg.AMQPURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to AMQP: %w", err)
	}

	ch, err := conn.Channel()
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to open channel: %w", err)
	}

	// Set prefetch count for fair dispatch
	err = ch.Qos(cfg.WorkerConcurrency, 0, false)
	if err != nil {
		ch.Close()
		conn.Close()
		return nil, fmt.Errorf("failed to set QoS: %w", err)
	}

	return &Orchestrator{
		cfg:     cfg,
		store:   store,
		logger:  logger,
		conn:    conn,
		channel: ch,
		workers: make(chan struct{}, cfg.WorkerConcurrency),
	}, nil
}

// ConsumeJobs starts listening for conversion jobs from the queue.
func (o *Orchestrator) ConsumeJobs(ctx context.Context) error {
	// Ensure exchange and queue exist (idempotent — safe if already declared by api-gateway)
	if err := o.channel.ExchangeDeclare(
		"wordtex.jobs", "topic", true, false, false, false, nil,
	); err != nil {
		return fmt.Errorf("failed to declare exchange: %w", err)
	}

	if _, err := o.channel.QueueDeclare(
		"wordtex.jobs.conversion", true, false, false, false,
		amqp.Table{
			"x-message-ttl":          int64(3600000),
			"x-dead-letter-exchange": "wordtex.jobs.dlx",
		},
	); err != nil {
		return fmt.Errorf("failed to declare queue: %w", err)
	}

	if err := o.channel.QueueBind(
		"wordtex.jobs.conversion", "wordtex.jobs.conversion", "wordtex.jobs", false, nil,
	); err != nil {
		return fmt.Errorf("failed to bind queue: %w", err)
	}

	msgs, err := o.channel.Consume(
		"wordtex.jobs.conversion",
		"orchestrator",
		false, // auto-ack
		false, // exclusive
		false, // no-local
		false, // no-wait
		nil,
	)
	if err != nil {
		return fmt.Errorf("failed to register consumer: %w", err)
	}

	o.logger.Info("Consuming jobs from wordtex.jobs.conversion")

	for {
		select {
		case <-ctx.Done():
			return nil
		case msg, ok := <-msgs:
			if !ok {
				return fmt.Errorf("channel closed")
			}

			// Acquire worker slot
			o.workers <- struct{}{}

			go func(delivery amqp.Delivery) {
				defer func() { <-o.workers }()
				o.processJob(ctx, delivery)
			}(msg)
		}
	}
}

func (o *Orchestrator) processJob(ctx context.Context, delivery amqp.Delivery) {
	var jobMsg struct {
		JobID          string `json:"job_id"`
		Direction      string `json:"direction"`
		SourceFilename string `json:"source_filename"`
		SourceData     []byte `json:"source_data"`
	}

	if err := json.Unmarshal(delivery.Body, &jobMsg); err != nil {
		o.logger.Errorw("Failed to unmarshal job message", "error", err)
		delivery.Nack(false, false) // Don't requeue malformed messages
		return
	}

	o.logger.Infow("Processing conversion job",
		"job_id", jobMsg.JobID,
		"direction", jobMsg.Direction,
		"filename", jobMsg.SourceFilename,
	)

	job := &Job{
		ID:             jobMsg.JobID,
		Direction:      jobMsg.Direction,
		State:          StateQueued,
		SourceFilename: jobMsg.SourceFilename,
		SourceData:     jobMsg.SourceData,
		StartedAt:      time.Now(),
	}

	// Save initial state
	o.store.SaveJob(ctx, job)

	// Execute the pipeline
	err := o.executePipeline(ctx, job)
	if err != nil {
		o.logger.Errorw("Pipeline execution failed",
			"job_id", job.ID,
			"error", err,
		)
		job.State = StateFailed
		job.Error = err.Error()
		o.store.SaveJob(ctx, job)
		delivery.Nack(false, false)
		return
	}

	job.State = StateCompleted
	job.CompletedAt = time.Now()
	job.Metrics.TotalDurationMS = time.Since(job.StartedAt).Milliseconds()
	o.store.SaveJob(ctx, job)

	delivery.Ack(false)

	o.logger.Infow("Job completed successfully",
		"job_id", job.ID,
		"duration_ms", job.Metrics.TotalDurationMS,
	)
}

func (o *Orchestrator) executePipeline(ctx context.Context, job *Job) error {
	switch job.Direction {
	case "latex_to_word":
		return o.latexToWordPipeline(ctx, job)
	case "word_to_latex":
		return o.wordToLatexPipeline(ctx, job)
	case "latex_to_pdf":
		return o.latexToPdfPipeline(ctx, job)
	case "word_to_pdf":
		return o.wordToPdfPipeline(ctx, job)
	case "round_trip":
		return o.roundTripPipeline(ctx, job)
	default:
		return fmt.Errorf("unknown direction: %s", job.Direction)
	}
}

func (o *Orchestrator) latexToWordPipeline(ctx context.Context, job *Job) error {
	// Stage 1: Parse LaTeX → SIR
	o.updateProgress(ctx, job, StateParsing, 10, "Parsing LaTeX source")
	start := time.Now()
	// TODO: Call SIR Core gRPC service
	job.Metrics.ParseDurationMS = time.Since(start).Milliseconds()

	// Stage 2: Transform SIR → OOXML
	o.updateProgress(ctx, job, StateTransforming, 40, "Transforming to Word format")
	start = time.Now()
	// TODO: Call SIR Core for SIR → OOXML transformation
	job.Metrics.TransformDurationMS = time.Since(start).Milliseconds()

	// Stage 3: Render final .docx
	o.updateProgress(ctx, job, StateRendering, 70, "Generating .docx file")
	start = time.Now()

	// Stub: generate a minimal valid .docx containing the source text
	docx, err := buildStubDocx(string(job.SourceData))
	if err != nil {
		return fmt.Errorf("stub docx generation failed: %w", err)
	}
	baseName := strings.TrimSuffix(job.SourceFilename, ".tex")
	job.OutputFilename = baseName + ".docx"
	job.OutputData = docx

	job.Metrics.RenderDurationMS = time.Since(start).Milliseconds()

	// Stage 4: Post-processing
	o.updateProgress(ctx, job, StatePostProcessing, 90, "Finalizing output")
	// TODO: Run quality checks, inject anchor metadata

	o.updateProgress(ctx, job, StateCompleted, 100, "Complete")
	return nil
}

func (o *Orchestrator) wordToLatexPipeline(ctx context.Context, job *Job) error {
	o.updateProgress(ctx, job, StateParsing, 10, "Parsing Word document")
	o.updateProgress(ctx, job, StateTransforming, 40, "Extracting anchor metadata")
	o.updateProgress(ctx, job, StateRendering, 70, "Generating LaTeX source")

	// Stub: produce a minimal .tex wrapper around a placeholder
	baseName := strings.TrimSuffix(job.SourceFilename, ".docx")
	job.OutputFilename = baseName + ".tex"
	job.OutputData = []byte(fmt.Sprintf(
		"\\documentclass{article}\n\\begin{document}\n%% Converted from %s by WordTex (stub)\n\\section{Placeholder}\nReal conversion coming soon.\n\\end{document}\n",
		job.SourceFilename,
	))

	o.updateProgress(ctx, job, StatePostProcessing, 90, "Validating output")
	o.updateProgress(ctx, job, StateCompleted, 100, "Complete")
	return nil
}

func (o *Orchestrator) latexToPdfPipeline(ctx context.Context, job *Job) error {
	o.updateProgress(ctx, job, StateParsing, 10, "Preparing LaTeX compilation")
	o.updateProgress(ctx, job, StateRendering, 30, "Compiling with "+job.PDFEngine)

	// Stub: produce a minimal valid PDF
	baseName := strings.TrimSuffix(job.SourceFilename, ".tex")
	job.OutputFilename = baseName + ".pdf"
	job.OutputData = buildStubPdf(job.SourceFilename)

	o.updateProgress(ctx, job, StatePostProcessing, 90, "Resolving cross-references")
	o.updateProgress(ctx, job, StateCompleted, 100, "Complete")
	return nil
}

func (o *Orchestrator) wordToPdfPipeline(ctx context.Context, job *Job) error {
	o.updateProgress(ctx, job, StateParsing, 10, "Loading Word document")
	o.updateProgress(ctx, job, StateRendering, 40, "Rendering to PDF")

	baseName := strings.TrimSuffix(job.SourceFilename, ".docx")
	job.OutputFilename = baseName + ".pdf"
	job.OutputData = buildStubPdf(job.SourceFilename)

	o.updateProgress(ctx, job, StateCompleted, 100, "Complete")
	return nil
}

func (o *Orchestrator) roundTripPipeline(ctx context.Context, job *Job) error {
	o.updateProgress(ctx, job, StateParsing, 10, "Parsing source document")
	o.updateProgress(ctx, job, StateTransforming, 30, "Forward conversion")
	o.updateProgress(ctx, job, StateRendering, 60, "Reverse conversion")

	// Stub: echo back the source data as the round-trip result
	job.OutputFilename = "roundtrip_" + job.SourceFilename
	job.OutputData = job.SourceData

	o.updateProgress(ctx, job, StatePostProcessing, 80, "Computing diff report")
	o.updateProgress(ctx, job, StateCompleted, 100, "Complete")
	return nil
}

func (o *Orchestrator) updateProgress(ctx context.Context, job *Job, state JobState, progress float64, stage string) {
	job.State = state
	job.Progress = progress
	job.CurrentStage = stage
	o.store.SaveJob(ctx, job)
	o.logger.Debugw("Job progress",
		"job_id", job.ID,
		"state", state,
		"progress", progress,
		"stage", stage,
	)
}

// RunStateMachine periodically checks for timed-out or stuck jobs.
func (o *Orchestrator) RunStateMachine(ctx context.Context) error {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			o.checkTimeouts(ctx)
		}
	}
}

func (o *Orchestrator) checkTimeouts(ctx context.Context) {
	// TODO: Scan Redis for jobs that have been processing too long
	// and transition them to failed state
}

func (o *Orchestrator) Shutdown() {
	if o.channel != nil {
		o.channel.Close()
	}
	if o.conn != nil {
		o.conn.Close()
	}
}

// ── Stub output generators (replaced by real gRPC calls later) ──

// buildStubDocx creates a minimal valid .docx (OOXML ZIP package) whose
// single paragraph contains the provided text.  Every .docx reader on
// the planet can open this.
func buildStubDocx(body string) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	// [Content_Types].xml
	ct := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
	addZipFile(zw, "[Content_Types].xml", ct)

	// _rels/.rels
	rels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
	addZipFile(zw, "_rels/.rels", rels)

	// word/_rels/document.xml.rels (empty but required)
	docRels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`
	addZipFile(zw, "word/_rels/document.xml.rels", docRels)

	// Build paragraphs from source text
	var paras strings.Builder
	for _, line := range strings.Split(body, "\n") {
		escaped := escapeXML(line)
		paras.WriteString(fmt.Sprintf("<w:p><w:r><w:t xml:space=\"preserve\">%s</w:t></w:r></w:p>\n", escaped))
	}

	doc := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Converted by WordTex</w:t></w:r></w:p>
%s  </w:body>
</w:document>`, paras.String())
	addZipFile(zw, "word/document.xml", doc)

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func addZipFile(zw *zip.Writer, name, content string) {
	w, _ := zw.Create(name)
	w.Write([]byte(content))
}

func escapeXML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	return s
}

// buildStubPdf produces a minimal valid 1-page PDF with a note.
func buildStubPdf(sourceFilename string) []byte {
	// Minimal valid PDF with one page and text
	text := fmt.Sprintf("WordTex stub output for: %s", sourceFilename)
	stream := fmt.Sprintf("BT /F1 12 Tf 72 720 Td (%s) Tj ET", text)
	streamLen := len(stream)

	var b strings.Builder
	b.WriteString("%%PDF-1.4\n")
	// Object 1: Catalog
	b.WriteString("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n")
	// Object 2: Pages
	b.WriteString("2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n")
	// Object 3: Page
	b.WriteString("3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n")
	// Object 4: Content stream
	b.WriteString(fmt.Sprintf("4 0 obj<</Length %d>>stream\n%s\nendstream\nendobj\n", streamLen, stream))
	// Object 5: Font
	b.WriteString("5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n")
	// xref + trailer (simplified)
	b.WriteString("xref\n0 6\n")
	b.WriteString("0000000000 65535 f \n")
	b.WriteString("0000000009 00000 n \n")
	b.WriteString("0000000058 00000 n \n")
	b.WriteString("0000000115 00000 n \n")
	b.WriteString("0000000266 00000 n \n")
	b.WriteString("0000000350 00000 n \n")
	b.WriteString("trailer<</Size 6/Root 1 0 R>>\nstartxref\n0\n%%%%EOF\n")
	return []byte(b.String())
}
