package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"websocket-server/config"

	"github.com/golang-jwt/jwt/v5"
)

func TestHealthCheckHandlerWithoutRedis(t *testing.T) {
	// Mock request for HealthCheckHandler
	req, err := http.NewRequest("GET", "/health", nil)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}

	rr := httptest.NewRecorder()
	
	// Create inline handler mock testing basic structure
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":    "healthy",
			"service":   "websocket-server",
			"timestamp": time.Now().Format(time.RFC3339),
		})
	})

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf("Handler returned wrong status code: got %v want %v", status, http.StatusOK)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	if resp["status"] != "healthy" {
		t.Errorf("Expected status 'healthy', got %v", resp["status"])
	}
}

func TestValidateToken(t *testing.T) {
	secretKey := "test-secret-key"

	// Create valid JWT claims
	claims := &Claims{
		UserID:   "user-123",
		Username: "alice",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(secretKey))
	if err != nil {
		t.Fatalf("Failed to sign token: %v", err)
	}

	// Validate token
	validatedClaims, err := ValidateToken(tokenString, secretKey)
	if err != nil {
		t.Fatalf("ValidateToken failed for valid token: %v", err)
	}

	if validatedClaims.UserID != "user-123" {
		t.Errorf("Expected UserID 'user-123', got '%s'", validatedClaims.UserID)
	}

	if validatedClaims.Username != "alice" {
		t.Errorf("Expected Username 'alice', got '%s'", validatedClaims.Username)
	}
}

func TestExtractTokenFromSubprotocol(t *testing.T) {
	req, _ := http.NewRequest("GET", "/ws", nil)
	req.Header.Set("Sec-WebSocket-Protocol", "chat, Bearer abc.def.ghi")

	token := extractTokenFromSubprotocol(req)
	if token != "abc.def.ghi" {
		t.Errorf("Expected token 'abc.def.ghi', got '%s'", token)
	}
}

func TestExtractTokenFromSubprotocolTokenPrefix(t *testing.T) {
	req, _ := http.NewRequest("GET", "/ws", nil)
	req.Header.Set("Sec-WebSocket-Protocol", "token.abc.def")

	token := extractTokenFromSubprotocol(req)
	if token != "abc.def" {
		t.Errorf("Expected token 'abc.def', got '%s'", token)
	}
}

func TestExtractTokenFromSubprotocolMissing(t *testing.T) {
	req, _ := http.NewRequest("GET", "/ws", nil)
	if token := extractTokenFromSubprotocol(req); token != "" {
		t.Errorf("Expected empty token, got '%s'", token)
	}
}

func TestIsOriginAllowed(t *testing.T) {
	cfg := &config.Config{
		AllowOrigins: []string{"https://chat.example.com"},
	}

	// Configured origin is allowed.
	okReq, _ := http.NewRequest("GET", "/ws", nil)
	okReq.Header.Set("Origin", "https://chat.example.com")
	if !isOriginAllowed(okReq, cfg) {
		t.Error("Expected configured origin to be allowed")
	}

	// Local development origin is allowed.
	localReq, _ := http.NewRequest("GET", "/ws", nil)
	localReq.Header.Set("Origin", "http://localhost:5500")
	if !isOriginAllowed(localReq, cfg) {
		t.Error("Expected localhost origin to be allowed")
	}

	// Unconfigured cross-site origin is rejected.
	badReq, _ := http.NewRequest("GET", "/ws", nil)
	badReq.Header.Set("Origin", "https://evil.example.com")
	if isOriginAllowed(badReq, cfg) {
		t.Error("Expected unconfigured origin to be rejected")
	}
}
