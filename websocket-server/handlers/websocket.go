package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"
	"websocket-server/config"
	"websocket-server/manager"
	"websocket-server/models"
	"websocket-server/pubsub"

	"github.com/gorilla/websocket"
)

// extractTokenFromSubprotocol scans the offered Sec-WebSocket-Protocol values for a
// bearer/JWT token so it is never placed in the URL query string (which would
// otherwise leak the token into nginx/proxy access logs).
func extractTokenFromSubprotocol(r *http.Request) string {
	for _, proto := range websocket.Subprotocols(r) {
		if strings.HasPrefix(proto, "Bearer ") {
			return strings.TrimSpace(strings.TrimPrefix(proto, "Bearer "))
		}
		if strings.HasPrefix(proto, "token.") {
			return strings.TrimSpace(strings.TrimPrefix(proto, "token."))
		}
	}
	return ""
}

// isOriginAllowed enforces Cross-Site WebSocket Hijacking protection.
func isOriginAllowed(r *http.Request, cfg *config.Config) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		// Non-browser clients (CLIs, tests, servers) may omit the Origin header.
		return true
	}
	// Local development origins.
	if strings.Contains(origin, "localhost") || strings.Contains(origin, "127.0.0.1") {
		return true
	}
	for _, allowed := range cfg.AllowOrigins {
		if strings.EqualFold(strings.TrimRight(origin, "/"), strings.TrimRight(allowed, "/")) {
			return true
		}
	}
	return false
}

// WebSocketHandler handles WebSocket connections
func WebSocketHandler(connManager *manager.ConnectionManager, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Enforce origin allow-list (CSWSH protection)
		if !isOriginAllowed(r, cfg) {
			log.Printf("WebSocket origin rejected: %q", r.Header.Get("Origin"))
			http.Error(w, "Origin not allowed", http.StatusForbidden)
			return
		}

		// Extract JWT from the negotiated subprotocols (never the query string)
		token := extractTokenFromSubprotocol(r)
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

		upgrader := websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(req *http.Request) bool {
				return isOriginAllowed(req, cfg)
			},
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

// HealthCheckHandler handles health check requests including Redis check
func HealthCheckHandler(ps *pubsub.RedisPubSub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		
		redisStatus := "healthy"
		if err := ps.Ping(); err != nil {
			redisStatus = "unhealthy: " + err.Error()
		}

		status := "healthy"
		statusCode := http.StatusOK
		if strings.HasPrefix(redisStatus, "unhealthy") {
			status = "unhealthy"
			statusCode = http.StatusServiceUnavailable
		}

		w.WriteHeader(statusCode)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":    status,
			"service":   "websocket-server",
			"redis":     redisStatus,
			"timestamp": time.Now().Format(time.RFC3339),
		})
	}
}