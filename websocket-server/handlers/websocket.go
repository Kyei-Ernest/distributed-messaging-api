package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
	"websocket-server/config"
	"websocket-server/manager"
	"websocket-server/models"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// Allow all origins in development
		// In production, check against allowed origins
		return true
	},
}

// WebSocketHandler handles WebSocket connections
func WebSocketHandler(connManager *manager.ConnectionManager, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Extract and validate JWT token
		token := r.URL.Query().Get("token")
		if token == "" {
			http.Error(w, "Missing authentication token", http.StatusUnauthorized)
			return
		}

		claims, err := ValidateToken(token, cfg.JWTSecret)
		if err != nil {
			log.Printf("Authentication failed: %v", err)
			http.Error(w, "Invalid authentication token", http.StatusUnauthorized)
			return
		}

		// Upgrade HTTP connection to WebSocket
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("Failed to upgrade connection: %v", err)
			return
		}

		// Create client connection
		client := &manager.Client{
			ID:       claims.UserID,
			Username: claims.Username,
			Conn:     conn,
			Send:     make(chan []byte, 256),
			Manager:  connManager,
		}

		// Register client
		connManager.Register <- client

		// Send connection confirmation
		welcomeMsg := models.OutgoingMessage{
			Type: models.EventConnected,
			Data: map[string]interface{}{
				"user_id":  client.ID,
				"username": client.Username,
				"message":  "Connected to WebSocket server",
			},
			Timestamp: time.Now().Format(time.RFC3339),
		}
		client.SendMessage(welcomeMsg)

		// Start goroutines for reading and writing
		go client.WritePump()
		go client.ReadPump()

		log.Printf("✅ Client connected: %s (%s)", client.Username, client.ID)
	}
}

// HealthCheckHandler handles health check requests
func HealthCheckHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "websocket-server",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}