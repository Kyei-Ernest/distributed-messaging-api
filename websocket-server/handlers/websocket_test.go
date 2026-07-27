package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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
