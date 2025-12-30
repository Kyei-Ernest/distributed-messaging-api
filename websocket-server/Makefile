.PHONY: build run test clean docker-build docker-run deps

# Build the application
build:
	go build -o bin/websocket-server .

# Run the application
run:
	go run main.go

# Run with live reload (requires air: go install github.com/cosmtrek/air@latest)
dev:
	air

# Run tests
test:
	go test -v ./...

# Run tests with coverage
test-coverage:
	go test -v -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out

# Install dependencies
deps:
	go mod download
	go mod tidy

# Clean build artifacts
clean:
	rm -rf bin/
	rm -f coverage.out

# Build Docker image
docker-build:
	docker build -t websocket-server:latest .

# Run with Docker Compose
docker-up:
	docker-compose up -d

# Stop Docker containers
docker-down:
	docker-compose down

# View Docker logs
docker-logs:
	docker-compose logs -f websocket

# Format code
fmt:
	go fmt ./...

# Run linter (requires golangci-lint)
lint:
	golangci-lint run

# Generate module
init:
	go mod init websocket-server
	go mod tidy