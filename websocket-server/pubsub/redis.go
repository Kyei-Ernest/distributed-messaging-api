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

// Subscribe subscribes to Redis channels and forwards messages with auto-reconnect.
// Backoff starts at 1s and doubles on each reconnect, capped at 30s. It is only
// consulted between a dropped subscription and the next successful re-subscribe.
func (r *RedisPubSub) Subscribe(handler MessageHandler) {
	backoff := 1 * time.Second
	for {
		pubsub := r.client.Subscribe(r.ctx, "messaging_events")
		log.Println("📡 Subscribed to Redis channel: messaging_events")

		ch := pubsub.Channel()
		for msg := range ch {
			handler.HandleRedisMessage(msg.Channel, []byte(msg.Payload))
		}

		pubsub.Close()
		log.Printf("⚠️ Redis subscription closed. Reconnecting in %v...", backoff)
		time.Sleep(backoff)
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

// AddOnlineUser adds a user ID to the online_users tracking set so Django
// (sharing the same Redis logical DB) can report accurate presence.
func (r *RedisPubSub) AddOnlineUser(userID string) error {
	return r.client.SAdd(r.ctx, "online_users", userID).Err()
}

// RemoveOnlineUser removes a user ID from the online_users tracking set.
func (r *RedisPubSub) RemoveOnlineUser(userID string) error {
	return r.client.SRem(r.ctx, "online_users", userID).Err()
}

// GetOnlineUserIDs returns all user IDs currently tracked in the shared
// online_users set. Reading from Redis (instead of node-local memory) makes
// presence correct across multiple WebSocket server instances.
func (r *RedisPubSub) GetOnlineUserIDs() ([]string, error) {
	return r.client.SMembers(r.ctx, "online_users").Result()
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