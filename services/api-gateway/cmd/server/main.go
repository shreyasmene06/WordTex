package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/wordtex/api-gateway/internal/config"
	"github.com/wordtex/api-gateway/internal/handler"
	"github.com/wordtex/api-gateway/internal/middleware"
	"github.com/wordtex/api-gateway/internal/queue"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

var Version = "dev"

func main() {
	// Initialize logger
	logger, _ := zap.NewProduction()
	defer logger.Sync()
	sugar := logger.Sugar()

	sugar.Infow("Starting WordTex API Gateway", "version", Version)

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		sugar.Fatalw("Failed to load configuration", "error", err)
	}

	// Initialize Redis client
	rOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		sugar.Fatalw("Invalid Redis URL", "error", err)
	}
	redisClient := redis.NewClient(rOpts)

	// Initialize queue publisher
	publisher, err := queue.NewPublisher(cfg.AMQPURL)
	if err != nil {
		sugar.Warnw("Failed to connect to message queue (running without queue)", "error", err)
	}

	// Set up Gin
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()

	// Global middleware
	router.Use(gin.Recovery())
	router.Use(middleware.RequestLogger(logger))
	router.Use(middleware.CORS())
	router.Use(middleware.RateLimiter(cfg.RateLimitRPS))

	// Health endpoints (no auth)
	router.GET("/health", handler.Health)
	router.GET("/ready", handler.Readiness)

	// API v1 routes
	v1 := router.Group("/api/v1")
	v1.Use(middleware.Auth(cfg.JWTSecret))
	{
		convHandler := handler.NewConversionHandler(publisher, redisClient, sugar)

		// Conversion endpoints
		v1.POST("/convert", convHandler.SubmitConversion)
		v1.GET("/jobs/:id", convHandler.GetJobStatus)
		v1.DELETE("/jobs/:id", convHandler.CancelJob)
		v1.GET("/jobs/:id/download", convHandler.DownloadResult)

		// WebSocket for real-time progress
		v1.GET("/jobs/:id/progress", convHandler.StreamProgress)

		// Template management
		v1.GET("/templates", handler.ListTemplates)
		v1.GET("/templates/:name", handler.GetTemplate)
	}

	// Create HTTP server
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
		// Max upload: 100MB
		MaxHeaderBytes: 1 << 20,
	}

	// Graceful shutdown
	go func() {
		sugar.Infow("Server listening", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			sugar.Fatalw("Server failed", "error", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	sugar.Info("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		sugar.Fatalw("Server forced to shutdown", "error", err)
	}

	if publisher != nil {
		publisher.Close()
	}

	sugar.Info("Server exited cleanly")
}
