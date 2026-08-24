package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Port         string
	RedisURL     string
	JWTSecret    string
	Environment  string
	AllowOrigins []string
}


func LoadConfig() *Config {
	// Load .env file if exists
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	cfg := &Config{
		Port:         getEnv("WEBSOCKET_PORT", "8001"),
		RedisURL:     getEnv("REDIS_URL", "redis://localhost:6379/1"),
		JWTSecret:    getEnv("JWT_SECRET", "your-jwt-secret-key"),
		Environment:  getEnv("ENVIRONMENT", "development"),
		AllowOrigins: []string{
			getEnv("CORS_ORIGIN_1", "http://localhost:5500"),
			getEnv("CORS_ORIGIN_2", "http://localhost:8000"),
		},
	}

	// Fail fast rather than silently rejecting every Django-minted token:
	// the JWT is HS256-signed with Django's SECRET_KEY, so JWT_SECRET MUST
	// equal it. A stale placeholder here looks like "401 on every connect".
	if cfg.JWTSecret == "your-jwt-secret-key" ||
		cfg.JWTSecret == "change-this-to-match-django-secret" {
		if cfg.Environment == "production" {
			log.Fatal("JWT_SECRET must be configured in production (rejecting known default secret)")
		}
		log.Println("WARNING: JWT_SECRET is a placeholder — every WebSocket auth will fail until it equals Django SECRET_KEY")
	}

	return cfg
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}