package engine

import (
	"context"
	"encoding/json"
	"fmt"
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
	// response, err := o.sirClient.LatexToSir(ctx, &pb.LatexToSirRequest{...})

	job.Metrics.ParseDurationMS = time.Since(start).Milliseconds()

	// Stage 2: Transform SIR → OOXML
	o.updateProgress(ctx, job, StateTransforming, 40, "Transforming to Word format")
	start = time.Now()

	// TODO: Call SIR Core for SIR → OOXML transformation

	job.Metrics.TransformDurationMS = time.Since(start).Milliseconds()

	// Stage 3: Render final .docx
	o.updateProgress(ctx, job, StateRendering, 70, "Generating .docx file")
	start = time.Now()

	// TODO: Call OOXML Engine to assemble final .docx with templates

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
	o.updateProgress(ctx, job, StatePostProcessing, 90, "Validating output")
	o.updateProgress(ctx, job, StateCompleted, 100, "Complete")
	return nil
}

func (o *Orchestrator) latexToPdfPipeline(ctx context.Context, job *Job) error {
	o.updateProgress(ctx, job, StateParsing, 10, "Preparing LaTeX compilation")
	o.updateProgress(ctx, job, StateRendering, 30, "Compiling with "+job.PDFEngine)
	// Run xelatex/lualatex in sandbox
	o.updateProgress(ctx, job, StatePostProcessing, 90, "Resolving cross-references")
	o.updateProgress(ctx, job, StateCompleted, 100, "Complete")
	return nil
}

func (o *Orchestrator) wordToPdfPipeline(ctx context.Context, job *Job) error {
	o.updateProgress(ctx, job, StateParsing, 10, "Loading Word document")
	o.updateProgress(ctx, job, StateRendering, 40, "Rendering to PDF")
	// Use Aspose.Words or headless Word COM interop
	o.updateProgress(ctx, job, StateCompleted, 100, "Complete")
	return nil
}

func (o *Orchestrator) roundTripPipeline(ctx context.Context, job *Job) error {
	o.updateProgress(ctx, job, StateParsing, 10, "Parsing source document")
	o.updateProgress(ctx, job, StateTransforming, 30, "Forward conversion")
	o.updateProgress(ctx, job, StateRendering, 60, "Reverse conversion")
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
