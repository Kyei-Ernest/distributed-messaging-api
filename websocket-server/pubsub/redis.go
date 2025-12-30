package pubsub

import (
	"context"
	"log"

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
		log.Fatalf("Failed to parse Redis URL: %v", err)
	}

	client := redis.NewClient(opt)

	// Test connection
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}

	log.Println("✅ Connected to Redis")

	return &RedisPubSub{
		client: client,
		ctx:    ctx,
	}
}

// Subscribe subscribes to Redis channels and forwards messages
func (r *RedisPubSub) Subscribe(handler MessageHandler) {
	pubsub := r.client.Subscribe(r.ctx, "messaging_events")
	defer pubsub.Close()

	log.Println("📡 Subscribed to Redis channel: messaging_events")

	ch := pubsub.Channel()
	for msg := range ch {
		handler.HandleRedisMessage(msg.Channel, []byte(msg.Payload))
	}
}

// Publish publishes a message to a Redis channel
func (r *RedisPubSub) Publish(channel string, message []byte) error {
	return r.client.Publish(r.ctx, channel, message).Err()
}

// Close closes the Redis connection
func (r *RedisPubSub) Close() error {
	return r.client.Close()
}

// MessageHandler interface for handling Redis messages
type MessageHandler interface {
	HandleRedisMessage(channel string, payload []byte)
}