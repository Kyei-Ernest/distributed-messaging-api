package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	"websocket-server/config"
	"websocket-server/handlers"
	"websocket-server/manager"
	"websocket-server/pubsub"

	"github.com/gorilla/mux"
)

func main() {
	// Load configuration
	cfg := config.LoadConfig()

	// Initialize Redis Pub/Sub
	redisPubSub := pubsub.NewRedisPubSub(cfg.RedisURL)
	defer redisPubSub.Close()

	// Initialize connection manager
	connManager := manager.NewConnectionManager(redisPubSub)

	// Start Redis subscriber
	go redisPubSub.Subscribe(connManager)

	// Setup HTTP router
	router := mux.NewRouter()

	// WebSocket endpoint
	router.HandleFunc("/ws", handlers.WebSocketHandler(connManager, cfg)).Methods("GET")

	// Health check endpoint
	router.HandleFunc("/health", handlers.HealthCheckHandler(redisPubSub)).Methods("GET")

	// Start HTTP server
	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		log.Printf("🚀 WebSocket server starting on port %s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	connManager.Shutdown()
	log.Println("Server stopped gracefully")
}