package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/wordtex/orchestrator/internal/config"
	"github.com/wordtex/orchestrator/internal/engine"
	"github.com/wordtex/orchestrator/internal/store"

	"go.uber.org/zap"
)

var Version = "dev"

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()
	sugar := logger.Sugar()

	sugar.Infow("Starting WordTex Orchestrator", "version", Version)

	cfg, err := config.Load()
	if err != nil {
		sugar.Fatalw("Failed to load configuration", "error", err)
	}

	// Initialize Redis job store
	jobStore, err := store.NewRedisJobStore(cfg.RedisURL)
	if err != nil {
		sugar.Fatalw("Failed to connect to Redis", "error", err)
	}

	// Initialize the orchestration engine
	orch, err := engine.NewOrchestrator(cfg, jobStore, sugar)
	if err != nil {
		sugar.Fatalw("Failed to initialize orchestrator", "error", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start consuming from the conversion queue
	go func() {
		if err := orch.ConsumeJobs(ctx); err != nil {
			sugar.Errorw("Job consumer failed", "error", err)
			cancel()
		}
	}()

	// Start the state machine ticker (for timeouts, retries)
	go func() {
		if err := orch.RunStateMachine(ctx); err != nil {
			sugar.Errorw("State machine failed", "error", err)
			cancel()
		}
	}()

	sugar.Info("Orchestrator running, waiting for jobs...")

	// Wait for shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	sugar.Info("Shutting down orchestrator...")
	cancel()
	orch.Shutdown()
	sugar.Info("Orchestrator stopped")
}
