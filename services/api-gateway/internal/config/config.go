package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port         int
	Environment  string
	JWTSecret    string
	AMQPURL      string
	RedisURL     string
	RateLimitRPS int
	MaxUploadMB  int
}

func Load() (*Config, error) {
	cfg := &Config{
		Port:         getEnvInt("PORT", 8080),
		Environment:  getEnv("ENVIRONMENT", "development"),
		JWTSecret:    getEnv("JWT_SECRET", "dev-secret-change-in-production"),
		AMQPURL:      getEnv("AMQP_URL", "amqp://wordtex:wordtex_dev@localhost:5672/"),
		RedisURL:     getEnv("REDIS_URL", "redis://localhost:6379"),
		RateLimitRPS: getEnvInt("RATE_LIMIT_RPS", 100),
		MaxUploadMB:  getEnvInt("MAX_UPLOAD_MB", 100),
	}

	if cfg.Environment == "production" && cfg.JWTSecret == "dev-secret-change-in-production" {
		return nil, fmt.Errorf("JWT_SECRET must be set in production")
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if value, ok := os.LookupEnv(key); ok {
		if i, err := strconv.Atoi(value); err == nil {
			return i
		}
	}
	return fallback
}
