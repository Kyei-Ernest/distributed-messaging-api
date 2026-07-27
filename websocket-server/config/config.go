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

	return &Config{
		Port:      getEnv("WEBSOCKET_PORT", "8001"),
		RedisURL:  getEnv("REDIS_URL", "redis://localhost:6379/1"),
		JWTSecret: getEnv("JWT_SECRET", "your-jwt-secret-key"),
		Environment: getEnv("ENVIRONMENT", "development"),
		AllowOrigins: []string{
			getEnv("CORS_ORIGIN_1", "http://localhost:5500"),
			getEnv("CORS_ORIGIN_2", "http://localhost:8000"),
		},
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}