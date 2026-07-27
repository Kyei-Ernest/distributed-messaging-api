package pubsub

import (
	"context"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisPubSub handles Redis publish/subscribe
type RedisPubSub struct {
	client *redis.Client
	ctx    context.Context
}

// NewRedisPubSub creates a new Redis pub/sub instance
func NewRedisPubSub(redisURL string) *RedisPubSub {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Printf("Warning: Failed to parse Redis URL: %v. Retrying standard format...", err)
		opt = &redis.Options{Addr: redisURL}
	}

	client := redis.NewClient(opt)

	// Test connection
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		log.Printf("⚠️ Initial Redis ping failed: %v (will retry on subscribe)", err)
	} else {
		log.Println("✅ Connected to Redis")
	}

	return &RedisPubSub{
		client: client,
		ctx:    ctx,
	}
}

// Subscribe subscribes to Redis channels and forwards messages with auto-reconnect
func (r *RedisPubSub) Subscribe(handler MessageHandler) {
	backoff := 1 * time.Second
	for {
		pubsub := r.client.Subscribe(r.ctx, "messaging_events")
		log.Println("📡 Subscribed to Redis channel: messaging_events")

		ch := pubsub.Channel()
		for msg := range ch {
			handler.HandleRedisMessage(msg.Channel, []byte(msg.Payload))
			backoff = 1 * time.Second // reset backoff on successful message
		}

		pubsub.Close()
		log.Printf("⚠️ Redis subscription closed. Reconnecting in %v...", backoff)
		time.Sleep(backoff)
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

// Publish publishes a message to a Redis channel
func (r *RedisPubSub) Publish(channel string, message []byte) error {
	return r.client.Publish(r.ctx, channel, message).Err()
}

// Ping checks the health of the Redis connection
func (r *RedisPubSub) Ping() error {
	return r.client.Ping(r.ctx).Err()
}

// Close closes the Redis connection
func (r *RedisPubSub) Close() error {
	return r.client.Close()
}

// MessageHandler interface for handling Redis messages
type MessageHandler interface {
	HandleRedisMessage(channel string, payload []byte)
}