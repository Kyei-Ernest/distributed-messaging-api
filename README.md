# 💬 Distributed Messaging System

A **hybrid real-time messaging platform** that combines **Django** for business logic and RESTful APIs with a high-performance **Go WebSocket server** for real-time communication. Designed for scalability, low latency, and clean separation of concerns.

---

## ✨ Features

- **Real-Time Messaging** — Instant message delivery via WebSocket with < 10ms latency
- **Group & Private Chats** — Create groups, manage members, or chat one-on-one
- **End-to-End Encryption** — AES-256-GCM encrypted message payloads
- **Server-Assisted Encryption** — Public keys hosted per-user; AES-GCM payloads carry per-recipient keys. Note: keys and ciphertext transit the server, so this is *server-assisted* client encryption, not fully server-independent E2EE.
- **Emoji Reactions** — React to any message with emoji
- **Read Receipts** — Know when your messages are seen
- **Message Replies** — Thread-style replies to any message
- **Typing Indicators** — See when someone is typing in real-time
- **Online Presence** — Live user online/offline status
- **File Uploads** — Share media and files within conversations
- **Role-Based Access** — Group admins can promote members & manage access
- **JWT Authentication** — Stateless auth shared across Django and Go services

---

## 🏗️ Architecture

The system uses a **microservices-like hybrid architecture** with three core components:

```
┌─────────────────────────────────────────────────────────┐
│                     Client (Browser)                    │
│                                                         │
│            HTTP/REST ──┐          ┌── WebSocket          │
└────────────────────────┼──────────┼─────────────────────┘
                         │          │
                         ▼          ▼
                ┌────────────┐  ┌────────────────┐
                │  Django    │  │ Go WebSocket   │
                │  REST API  │  │ Server         │
                │  (Port     │  │ (Port 8001)    │
                │   8000)    │  │                │
                └─────┬──────┘  └───────┬────────┘
                      │                 │
                      │   ┌─────────┐   │
                      └──►│  Redis  │◄──┘
                          │ Pub/Sub │
                          └────┬────┘
                               │
                          ┌────▼────┐
                          │ SQLite/ │
                          │ Postgres│
                          └─────────┘
```

| Component | Role |
|---|---|
| **Django Backend** | Control plane — authentication, business logic, REST APIs, database access |
| **Go WebSocket Server** | Data plane — persistent connections, low-latency message broadcasting |
| **Redis** | Message broker — decouples Django and Go via Pub/Sub |

### Message Flow

1. User authenticates with Django → receives JWT
2. User connects to Go WebSocket server with JWT
3. User sends a message via Django REST API
4. Django persists the message and publishes an event to Redis
5. Go server receives the event and broadcasts to connected clients

> **🔧 Scaling:** for how the WebSocket tier handles many concurrent connections and
> multi-replica deployments, see [docs/SCALING.md](docs/SCALING.md).
>
> **🟩 Embed:** shipping a self-hosted chat inside your own app? Drop in the
> zero-dependency widget (`dms-chat.js`) — see [docs/EMBED.md](docs/EMBED.md) and
> the React SDK in `frontend/widget/react`.

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Backend API** | Python 3.10+, Django 6.0, Django REST Framework |
| **WebSocket Server** | Go 1.21+, Gorilla WebSocket |
| **Message Broker** | Redis 6.0+ (Pub/Sub) |
| **Database** | SQLite (dev) / PostgreSQL (prod) |
| **Authentication** | JWT via SimpleJWT |
| **Frontend** | Vanilla JavaScript, CSS |
| **API Docs** | Swagger / OpenAPI (drf-spectacular) |

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.10+**
- **Go 1.21+**
- **Redis 6.0+**
- **Git**

### 1. Clone the Repository

```bash
git clone https://github.com/Kyei-Ernest/distributed-messaging.git
cd distributed-messaging
```

### 2. Django Backend

```bash
# Create & activate virtual environment
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your settings (SECRET_KEY, REDIS_URL, etc.)

# Run migrations
python manage.py migrate

# Create admin user (optional)
python manage.py createsuperuser

# Start the server
python manage.py runserver 8000
```

### 3. Go WebSocket Server

```bash
cd websocket-server

# Install Go dependencies
go mod download

# Configure environment
cp .env.example .env
# IMPORTANT: Set JWT_SECRET to match Django's SECRET_KEY

# Start the server
make run
# OR: go run main.go
```

### 4. Redis

```bash
# Ensure Redis is running
redis-server
```

### 5. Frontend

```bash
cd frontend

# Serve with any static file server
python -m http.server 5500
```

### Quick Start (All Servers)

A launcher script is included to start all services in separate terminal tabs:

```bash
python start_servers.py          # Start all servers
python start_servers.py stop     # Stop all servers
python start_servers.py list     # List configured servers
```

---

## 📡 API Endpoints

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register/` | Register a new account |
| `POST` | `/api/auth/login/` | Obtain JWT tokens |
| `GET` | `/api/users/me/` | Get current user profile |

### Messaging
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/groups/` | List all groups |
| `POST` | `/api/groups/` | Create a new group |
| `POST` | `/api/groups/{id}/join/` | Join a group |
| `POST` | `/api/groups/{id}/leave/` | Leave a group |
| `GET` | `/api/messages/?group={id}` | Get group messages |
| `GET` | `/api/messages/?recipient={id}` | Get private conversation |
| `POST` | `/api/messages/` | Send a message |
| `POST` | `/api/messages/mark_read/` | Batch mark as read |
| `POST` | `/api/messages/{id}/react/` | Add emoji reaction |

> **Full API documentation** available at `/api/docs/` (Swagger UI) when the Django server is running.

---

## 📨 Real-Time Events

Events broadcast via the Go WebSocket server:

| Event | Description |
|---|---|
| `group_message` | New message in a group |
| `private_message` | New direct message |
| `user_joined` | User joined a group |
| `user_left` | User left a group |
| `user_removed` | User removed from group |
| `member_promoted` | Member promoted to admin |
| `message_deleted` | Message was deleted |
| `message_read` | Read receipt generated |
| `typing_indicator` | User is typing |

---

## 📂 Project Structure

```
distributed-messaging/
├── accounts/              # Django user auth & profiles
├── config/                # Django project settings
├── messaging/             # Django messaging app (models, views, serializers)
├── frontend/              # Vanilla JS/CSS client
│   ├── index.html
│   ├── styles.css
│   └── js/
│       ├── app.js             # App entry point
│       ├── api.js             # REST API client
│       ├── config.js          # Configuration
│       ├── core/              # Event bus
│       ├── modules/           # Auth, Chat, Groups, Messages, WebSocket managers
│       ├── ui/                # UI rendering (lists, messages, core)
│       └── features/          # Context menu, media, theme, inputs
├── websocket-server/      # Go WebSocket server
│   ├── main.go
│   ├── handlers/          # WebSocket connection handlers
│   ├── manager/           # Client connection manager
│   ├── models/            # Data models
│   ├── pubsub/            # Redis subscriber
│   └── config/            # Server configuration
├── requirements.txt       # Python dependencies
└── manage.py
```

---

## 🔐 Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Description | Default |
|---|---|---|
| `SECRET_KEY` | Django secret key | — |
| `DEBUG` | Debug mode | `True` |
| `REDIS_URL` | Redis connection URL | `redis://127.0.0.1:6379/1` |
| `DB_ENGINE` | Database backend | `django.db.backends.sqlite3` |
| `CORS_ALLOWED_ORIGINS` | Allowed frontend origins | `http://localhost:5500` |
| `JWT_ACCESS_TOKEN_LIFETIME_MINUTES` | Access token TTL | `30` |

---

## 🧪 Testing

```bash
# Run Django tests
python manage.py test

# Run with pytest
pytest

# Run Go tests
cd websocket-server && go test ./...
```

---

## 🗺️ Roadmap

- [ ] Redis Cluster / Sentinel for high availability
- [ ] Redis Streams for reliable at-least-once delivery
- [ ] Horizontal scaling — multi-node Go WebSocket support
- [ ] Mobile push notifications (FCM/APNS)
- [ ] Voice & video call support
- [ ] Message search & filtering

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

## 👤 Author

**Ernest Kyei**

- GitHub: [@Kyei-Ernest](https://github.com/Kyei-Ernest)
- Email: ernestkyei101@gmail.com
