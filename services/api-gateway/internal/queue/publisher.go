package queue

import (
	"context"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// ConversionJob is the message published to the job queue.
type ConversionJob struct {
	JobID            string           `json:"job_id"`
	Direction        string           `json:"direction"`
	SourceFilename   string           `json:"source_filename"`
	SourceData       []byte           `json:"source_data"`
	TemplateOverride string           `json:"template_override,omitempty"`
	EmbedAnchors     bool             `json:"embed_anchors"`
	SVGFallbacks     bool             `json:"svg_fallbacks"`
	PDFEngine        string           `json:"pdf_engine,omitempty"`
	AdditionalFiles  []FileAttachment `json:"additional_files,omitempty"`
	SubmittedAt      time.Time        `json:"submitted_at"`
}

type FileAttachment struct {
	Filename string `json:"filename"`
	Data     []byte `json:"data"`
}

// Publisher manages AMQP connections for publishing job messages.
type Publisher struct {
	conn    *amqp.Connection
	channel *amqp.Channel
}

func NewPublisher(amqpURL string) (*Publisher, error) {
	conn, err := amqp.Dial(amqpURL)
	if err != nil {
		return nil, err
	}

	ch, err := conn.Channel()
	if err != nil {
		conn.Close()
		return nil, err
	}

	// Declare exchanges and queues
	err = ch.ExchangeDeclare(
		"wordtex.jobs", // name
		"topic",        // kind
		true,           // durable
		false,          // auto-deleted
		false,          // internal
		false,          // no-wait
		nil,            // arguments
	)
	if err != nil {
		ch.Close()
		conn.Close()
		return nil, err
	}

	// Declare the conversion jobs queue
	_, err = ch.QueueDeclare(
		"wordtex.jobs.conversion", // name
		true,                      // durable
		false,                     // auto-delete
		false,                     // exclusive
		false,                     // no-wait
		amqp.Table{
			"x-message-ttl":          int64(3600000),  // 1 hour TTL
			"x-dead-letter-exchange": "wordtex.jobs.dlx",
		},
	)
	if err != nil {
		ch.Close()
		conn.Close()
		return nil, err
	}

	// Bind queue to exchange
	err = ch.QueueBind(
		"wordtex.jobs.conversion",
		"wordtex.jobs.conversion",
		"wordtex.jobs",
		false,
		nil,
	)
	if err != nil {
		ch.Close()
		conn.Close()
		return nil, err
	}

	return &Publisher{conn: conn, channel: ch}, nil
}

func (p *Publisher) Publish(routingKey string, body []byte) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return p.channel.PublishWithContext(ctx,
		"wordtex.jobs", // exchange
		routingKey,     // routing key
		false,          // mandatory
		false,          // immediate
		amqp.Publishing{
			ContentType:  "application/json",
			DeliveryMode: amqp.Persistent,
			Timestamp:    time.Now(),
			Body:         body,
		},
	)
}

func (p *Publisher) Close() {
	if p.channel != nil {
		p.channel.Close()
	}
	if p.conn != nil {
		p.conn.Close()
	}
}
