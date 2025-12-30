# WebSocket Server

High-performance WebSocket server for real-time messaging, built with Go.

## Features

- 🚀 High-performance WebSocket connections
- 🔐 JWT authentication
- 📡 Redis Pub/Sub for message distribution
- 💬 Group and private messaging
- 👥 User presence tracking
- ⌨️ Typing indicators
- 🔄 Auto-reconnection support
- 📊 Health check endpoint

## Prerequisites

- Go 1.21 or higher
- Redis server
- Django API running (for authentication)

## Installation

### 1. Clone and setup
```bash
git clone <repository>
cd websocket-server

# Install dependencies
go mod download
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Run the server
```bash
# Development
make run

# Or with live reload
make dev

# Production
make build
./bin/websocket-server
```

## Docker Deployment

```bash
# Build and run with Docker Compose
make docker-up

# View logs
make docker-logs

# Stop containers
make docker-down
```

## API Documentation

### WebSocket Connection

**Endpoint:** `ws://localhost:8001/ws?token=<JWT_TOKEN>`

**Authentication:** JWT token in query parameter

### Message Types

#### Client -> Server

**Subscribe to Group:**
```json
{
  "type": "subscribe_group",
  "data": {
    "group_id": "uuid"
  }
}
```

**Typing Indicator:**
```json
{
  "type": "typing_indicator",
  "data": {
    "group_id": "uuid",
    "is_typing": true
  }
}
```

**Ping:**
```json
{
  "type": "ping"
}
```

#### Server -> Client

**Group Message:**
```json
{
  "type": "group_message",
  "data": {
    "message_id": "uuid",
    "sender_id": "uuid",
    "sender_username": "string",
    "group_id": "uuid",
    "group_name": "string",
    "content": "string",
    "timestamp": "ISO8601"
  }
}
```

**Private Message:**
```json
{
  "type": "private_message",
  "data": {
    "message_id": "uuid",
    "sender_id": "uuid",
    "sender_username": "string",
    "recipient_id": "uuid",
    "recipient_username": "string",
    "content": "string",
    "timestamp": "ISO8601"
  }
}
```

**User Joined:**
```json
{
  "type": "user_joined",
  "data": {
    "user_id": "uuid",
    "username": "string",
    "group_id": "uuid",
    "group_name": "string"
  }
}
```

### Health Check

**Endpoint:** `GET http://localhost:8001/health`

**Response:**
```json
{
  "status": "healthy",
  "service": "websocket-server",
  "timestamp": "ISO8601"
}
```

## Development

### Running Tests
```bash
make test
make test-coverage
```

### Code Formatting
```bash
make fmt
make lint
```

### Live Reload
```bash
# Install air
go install github.com/cosmtrek/air@latest

# Run with live reload
make dev
```

## Project Structure

```
websocket-server/
├── main.go                 # Entry point
├── config/
│   └── config.go          # Configuration
├── handlers/
│   ├── websocket.go       # WebSocket handler
│   └── auth.go            # JWT authentication
├── models/
│   └── message.go         # Data structures
├── manager/
│   └── connection.go      # Connection management
├── pubsub/
│   └── redis.go           # Redis Pub/Sub
├── go.mod                 # Dependencies
├── Dockerfile             # Docker configuration
├── docker-compose.yml     # Docker Compose
└── Makefile              # Build commands
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| WEBSOCKET_PORT | Server port | 8001 |
| REDIS_URL | Redis connection URL | redis://localhost:6379/1 |
| JWT_SECRET | JWT signing secret (must match Django) | - |
| ENVIRONMENT | Environment (development/production) | development |
| CORS_ORIGIN_* | Allowed CORS origins | - |

### Redis Channels

The server subscribes to: `messaging_events`

Django publishes to this channel when:
- New messages are created
- Users join/leave groups
- Messages are deleted

## Performance

- Supports 10,000+ concurrent connections
- Low latency message delivery (<10ms)
- Automatic connection cleanup
- Efficient memory usage with connection pooling

## Troubleshooting

### Connection Refused
- Ensure Redis is running: `redis-cli ping`
- Check Redis URL in .env

### Authentication Failed
- Verify JWT_SECRET matches Django SECRET_KEY
- Check token expiration

### Messages Not Delivered
- Verify Django is publishing to correct Redis channel
- Check Redis channel subscription: `redis-cli PUBSUB CHANNELS`

## Production Checklist

- [ ] Set strong JWT_SECRET
- [ ] Configure CORS origins properly
- [ ] Enable Redis persistence
- [ ] Set up monitoring (Prometheus/Grafana)
- [ ] Configure log aggregation
- [ ] Set up load balancing
- [ ] Enable SSL/TLS
- [ ] Set resource limits
- [ ] Configure health checks
- [ ] Set up backup Redis instance

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
