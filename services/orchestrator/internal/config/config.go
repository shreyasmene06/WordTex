package config

import (
	"os"
	"strconv"
)

type Config struct {
	RedisURL          string
	AMQPURL           string
	SIRCoreGRPCAddr   string
	LatexEngineAddr   string
	OOXMLEngineAddr   string
	WorkerConcurrency int
	JobTimeoutSecs    int
	MaxRetries        int
}

func Load() (*Config, error) {
	return &Config{
		RedisURL:          getEnv("REDIS_URL", "redis://localhost:6379"),
		AMQPURL:           getEnv("AMQP_URL", "amqp://wordtex:wordtex_dev@localhost:5672/"),
		SIRCoreGRPCAddr:   getEnv("SIR_CORE_GRPC_ADDR", "localhost:50051"),
		LatexEngineAddr:   getEnv("LATEX_ENGINE_ADDR", "localhost:50052"),
		OOXMLEngineAddr:   getEnv("OOXML_ENGINE_ADDR", "localhost:50053"),
		WorkerConcurrency: getEnvInt("WORKER_CONCURRENCY", 8),
		JobTimeoutSecs:    getEnvInt("JOB_TIMEOUT_SECS", 600),
		MaxRetries:        getEnvInt("MAX_RETRIES", 3),
	}, nil
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v, ok := os.LookupEnv(key); ok {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}
