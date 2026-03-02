package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const jobKeyPrefix = "wordtex:job:"
const jobTTL = 24 * time.Hour

// RedisJobStore manages job state in Redis.
type RedisJobStore struct {
	client *redis.Client
}

func NewRedisJobStore(redisURL string) (*RedisJobStore, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("invalid Redis URL: %w", err)
	}

	client := redis.NewClient(opts)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("Redis connection failed: %w", err)
	}

	return &RedisJobStore{client: client}, nil
}

func (s *RedisJobStore) SaveJob(ctx context.Context, job interface{}) error {
	data, err := json.Marshal(job)
	if err != nil {
		return err
	}

	// Use job ID from the struct
	type hasID struct {
		ID string `json:"id"`
	}
	var id hasID
	json.Unmarshal(data, &id)

	key := jobKeyPrefix + id.ID
	return s.client.Set(ctx, key, data, jobTTL).Err()
}

func (s *RedisJobStore) GetJob(ctx context.Context, jobID string) ([]byte, error) {
	key := jobKeyPrefix + jobID
	data, err := s.client.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, fmt.Errorf("job not found: %s", jobID)
	}
	return data, err
}

func (s *RedisJobStore) DeleteJob(ctx context.Context, jobID string) error {
	key := jobKeyPrefix + jobID
	return s.client.Del(ctx, key).Err()
}

func (s *RedisJobStore) ListActiveJobs(ctx context.Context) ([]string, error) {
	pattern := jobKeyPrefix + "*"
	var keys []string
	iter := s.client.Scan(ctx, 0, pattern, 100).Iterator()
	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
	}
	return keys, iter.Err()
}
