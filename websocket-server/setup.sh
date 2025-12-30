#!/bin/bash

echo "🚀 Setting up Go WebSocket Server..."

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo "❌ Go is not installed. Please install Go 1.21 or higher."
    exit 1
fi

echo "✅ Go version: $(go version)"

# Initialize Go module
if [ ! -f "go.mod" ]; then
    echo "📦 Initializing Go module..."
    go mod init websocket-server
fi

# Install dependencies
echo "📥 Installing dependencies..."
go get github.com/gorilla/websocket
go get github.com/gorilla/mux
go get github.com/golang-jwt/jwt/v5
go get github.com/redis/go-redis/v9
go get github.com/joho/godotenv
go mod tidy

# Create .env file
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file..."
    cat > .env << 'EOF'
WEBSOCKET_PORT=8001
REDIS_URL=redis://localhost:6379/1
JWT_SECRET=your-django-secret-key-here
ENVIRONMENT=development
CORS_ORIGIN_1=http://localhost:5500
CORS_ORIGIN_2=http://localhost:8000
LOG_LEVEL=debug
EOF
    echo "⚠️  Please update JWT_SECRET in .env to match your Django SECRET_KEY"
fi

# Create bin directory
mkdir -p bin

# Build the application
echo "🔨 Building application..."
go build -o bin/websocket-server .

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Update JWT_SECRET in .env to match Django SECRET_KEY"
echo "2. Ensure Redis is running: redis-server"
echo "3. Start the server: make run or ./bin/websocket-server"
echo ""
echo "Server will be available at: ws://localhost:8001/ws"
echo "Health check: http://localhost:8001/health"
echo ""

chmod +x setup.sh