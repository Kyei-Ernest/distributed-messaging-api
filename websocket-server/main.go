package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
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
	router.HandleFunc("/health", handlers.HealthCheckHandler).Methods("GET")

	// Start HTTP server
	server := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: router,
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
	connManager.Shutdown()
	log.Println("Server stopped")
}