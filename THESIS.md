# Design and Implementation of a Hybrid Distributed Messaging System

**A Technical Design Document**

Author: Ernest Kyei
Project: Distributed Messaging System (DMS)
Repository: `github.com/Kyei-Ernest/distributed-messaging`
Version: 1.1.0 · August 2026

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [Introduction](#2-introduction)
3. [Goals and Non-Goals](#3-goals-and-non-goals)
4. [System Architecture](#4-system-architecture)
5. [Control Plane: Django/DRF](#5-control-plane-djangodrf)
6. [Data Plane: Go WebSocket Server](#6-data-plane-go-websocket-server)
7. [The Broker: Redis Pub/Sub](#7-the-broker-redis-pubsub)
8. [Client Layer](#8-client-layer)
9. [Multi-Tenancy and Metering](#9-multi-tenancy-and-metering)
10. [Security Design](#10-security-design)
11. [Scaling Analysis](#11-scaling-analysis)
12. [Deployment Topology](#12-deployment-topology)
13. [Testing Strategy](#13-testing-strategy)
14. [Known Limitations and Future Work](#14-known-limitations-and-future-work)
15. [Conclusion](#15-conclusion)

---

## 1. Abstract

Real-time messaging systems impose two conflicting engineering demands: the *control*
demands of authentication, authorization, validation, and persistence — where mature,
batteries-included frameworks excel — and the *data-plane* demands of holding tens of
thousands of concurrent WebSocket connections and fanning out events with minimal
latency, where runtime efficiency dominates.

This document describes the design of a hybrid architecture that resolves this tension
by splitting the system into two planes: a **Django 6 / Django REST Framework control
plane** that owns all business logic and persistence, and a **Go 1.21 data plane**
built on Gorilla WebSocket that owns persistent connections and event fan-out. The two
planes are decoupled by **Redis Pub/Sub**, which converts direct coupling into an
event-driven contract.

The design achieves horizontal scalability without sticky sessions: every Go node is
deliberately shared-state-free, receiving all events via broadcast subscription and
delivering only to locally-held clients; cross-node state (presence) lives exclusively
in Redis. The platform additionally introduces **multi-tenant workspaces** with hashed
API-key authentication for server-to-server embedding, per-tenant daily usage metering
that can never disrupt message delivery, and a zero-dependency embeddable chat widget.
We describe each subsystem, justify its key decisions, analyze scaling properties, and
document honest limitations with remediation paths.

---

## 2. Introduction

### 2.1 Problem Statement

Chat-as-a-feature has become a default expectation in modern applications — support
widgets inside SaaS products, community chat inside marketplaces, coordination channels
inside internal tools. Building this correctly requires solving several hard problems
simultaneously:

1. **Connection scale.** A messaging backend must hold long-lived bidirectional
   connections far beyond what request/response web frameworks are tuned for.
2. **Delivery fan-out.** One message to one group must reach every member's device,
   wherever it happens to be connected.
3. **Correctness under replication.** Running multiple stateful connection servers
   naively produces split-brain presence and missed deliveries unless shared state is
   designed deliberately.
4. **Security.** Tokens must not leak through infrastructure logs; cross-site WebSocket
   hijacking must be addressed; tenant data must be isolated when the same platform
   serves many products.
5. **Embeddability.** Third-party applications need to embed chat without adopting the
   host platform's stack.

### 2.2 Approach

DMS answers these with three cooperating components:

| Component | Technology | Plane | Responsibility |
|---|---|---|---|
| REST API | Django 6 + DRF (Python 3.10+) | Control | Auth, business rules, persistence, admin |
| WebSocket server | Go 1.21 + Gorilla | Data | Persistent connections, real-time fan-out |
| Broker | Redis 6+ Pub/Sub (DB 1) | Glue | Event bus decoupling the planes |

Clients authenticate once against Django to obtain a JWT; they then hold a WebSocket to
the Go tier using that JWT. Every message is created through the REST API (so Django
remains the single writer of truth), after which Django publishes an event to Redis;
each Go node receives the event and forwards it to the clients it holds. This yields
"REST as source of truth, WebSockets as delivery mechanism."

### 2.3 Document Scope

This document covers architecture rationale, component designs, the data model,
security posture, scaling analysis, deployment topology, and testing strategy. It does
not restate user-facing API reference material, which lives in `README.md`,
`BACKEND_DOCUMENTATION.md`, and the generated OpenAPI schema at `/api/docs/`.

---

## 3. Goals and Non-Goals

### 3.1 Goals

- G1 — Real-time delivery with low, stable latency (< 10 ms intra-fan-out target on a
  healthy node).
- G2 — Horizontal scalability of the WebSocket tier with **no sticky sessions required
  for correctness**.
- G3 — Clean separation of concerns: business logic testable without any socket open.
- G4 — Multi-tenant isolation for embedded deployments, with metering that never
  degrades the core messaging path.
- G5 — Defense-in-depth security: no tokens in URLs or proxy logs, CSWSH protection,
  hashed credentials at rest, HTML-escaped rendering everywhere.
- G6 — Embeddability: a zero-dependency widget embeddable by any site with one script
  tag; framework SDKs optional.

### 3.2 Non-Goals (v1)

- Full server-independent end-to-end encryption (keys transit the server by design —
  see §10.5).
- At-least-once durable delivery to offline devices (Redis Pub/Sub is fire-and-forget;
  see §14).
- Voice/video signaling beyond the client-side feature scaffold.
- Mobile push notification delivery.

---

## 4. System Architecture

### 4.1 Overview

```
                        ┌────────────────────────────┐
                        │        Browser Client      │
                        │  HTTP/REST      WebSocket  │
                        └────────┬──────────┬────────┘
                                 │          │
                          :80 nginx (TLS edge)
                     rate limits · security headers · upgrade
                                 │          │
                    ┌────────────▼───┐  ┌───▼──────────────┐
                    │ Control plane  │  │   Data plane     │
                    │ Django + DRF   │  │  Go WS node ×N   │
                    │ gunicorn ×W    │  │  goroutine/pump  │
                    └───────┬────────┘  └───┬──────────────┘
                            │  publish      ▲ subscribe (every node)
                            │               │
                         ┌──▼───────────────┴──┐
                         │  Redis Pub/Sub DB 1 │
                         │  online_users set   │
                         └──────────┬──────────┘
                                    │ (control plane only)
                          ┌─────────▼─────────┐
                          │ PostgreSQL / SQLite│
                          └───────────────────┘
```

### 4.2 Message Flow (canonical write path)

1. User authenticates (`POST /api/auth/login/`) → receives access + refresh JWTs
   (HS256, signed with Django `SECRET_KEY`).
2. Client opens `/ws` on the Go tier, presenting the JWT as a **`Sec-WebSocket-Protocol`
   subprotocol** (`Bearer <token>`). The node validates the token signature and claims,
   upgrades the socket, and registers the client.
3. Sending a message goes over REST (`POST /api/messages/`). Django validates
   membership/recipient constraints, persists the row, then publishes a JSON envelope
   to the Redis channel `messaging_events`.
4. **Every** Go node subscribed to `messaging_events` receives the envelope and routes
   it: group events to members it holds, private events to sender/recipient sockets it
   holds. Nodes that hold no relevant recipient simply drop the event.
5. Clients receive typed events (`group_message`, `private_message`, …) and update UI
   state optimistically reconciled with paginated history from REST.

### 4.3 Why Hybrid?

| Consideration | All-Django WS | Hybrid (chosen) |
|---|---|---|
| Concurrency model | Worker/thread per connection; green threads help but the ORM/WSGI ecosystem is request-centric | Goroutine-per-pump; a few KB per idle socket |
| Cost profile | Pay per web worker even for idle connections | Django workers sized by RPS; Go replicas sized by connection count |
| Ecosystem fit | Business logic, auth, admin, migrations are Django's strength | Each tool used where it is strongest |
| Failure isolation | WS load spikes degrade API latency | Data-plane load cannot block the control plane |

The decisive argument is economic: persistent connections dominate resource usage in
chat workloads, and Go amortizes them cheaply, while Django amortizes the *complexity*
of auth/validation/admin cheaply. §11 quantifies the sizing consequences.

---

## 5. Control Plane: Django/DRF

### 5.1 Application Layout

- **`accounts/`** — identity and tenancy: custom `User` (UUID PK, `AbstractUser`),
  `Workspace`, `WorkspaceDailyUsage`, JWT login/refresh/blacklist, workspace API-key
  issuance and verification, server-to-server provisioning endpoints.
- **`messaging/`** — domain logic: `Group`, `GroupMember`, `Message`, read receipts,
  reactions, public-key hosting, health endpoint, usage-metering signals.
- **`config/`** — settings composed entirely from environment variables via
  python-decouple; fail-fast checks for production misconfiguration.

### 5.2 Data Model

All primary keys are UUIDs (`uuid4`, non-editable), chosen over sequential integers to
avoid enumeration and ease multi-system ID handling.

```
Workspace 1──* User            (SET_NULL; NULL = legacy single-tenant)
Workspace 1──* Group           (CASCADE)
Workspace 1──* WorkspaceDailyUsage  (unique per workspace+date)
User M──N Group                via GroupMember (unique user×group, is_admin flag)
User 1──* Message (sender)     CASCADE
Message *──1 Group             nullable; required iff message_type="group"
Message *──1 User (recipient)  nullable; required iff message_type="private"
Message 1──self (parent_message/replies)
Message 1──* MessageReadReceipt (unique message×user)
Message 1──* MessageReaction   (unique message×user×emoji)
```

Model-level integrity is enforced twice: `Message.clean()` validates type-specific
constraints (group membership of sender, no self-messages, private≠group), and the ORM
layer adds composite indexes matching the hot query shapes:

```python
indexes = [
    Index(fields=['message_type', 'group', '-created_at']),          # group history
    Index(fields=['message_type', 'sender', 'recipient', '-created_at']),  # DM history
    Index(fields=['sender', '-created_at']),
    Index(fields=['recipient', '-created_at']),
]
```

Encryption-related columns (`is_encrypted`, `encrypted_content`, `encrypted_key`,
`encrypted_key_self`, `encrypted_keys` JSONB for groups, `iv`) support client-side
AES-GCM payloads with per-recipient wrapped keys (§10.5).

### 5.3 API Surface (summary)

| Area | Endpoints |
|---|---|
| Auth | register, login, logout (blacklist), token refresh |
| Users | `GET /api/users/me/`, public-key upload/fetch (`UserPublicKeyViewSet`) |
| Groups | CRUD + `join`, `leave`, `members`, promote/remove actions |
| Messages | CRUD scoped by `?group=` or `?recipient=`, `mark_read`, `react/{id}`, unread counts, read receipts, chat list |
| Workspaces | CRUD + API-key issue (`WorkspaceViewSet`) |
| Provisioning | `POST /api/provision/users/`, `POST /api/provision/groups/` (API-key auth) |
| Health | `/api/health/` (DB + Redis probes) |

Authorization is enforced by per-view permission classes rather than a global default
(`messaging/permissions.py`: `IsGroupMember`, `IsGroupAdmin`, `IsGroupCreator`,
`IsMessageSender`, `CanAccessMessage`, …). This keeps authorization explicit and
auditable per endpoint.

### 5.4 Event Publication

After a successful `perform_create`, Django publishes a JSON envelope to
`messaging_events` containing event type, actor/target identities, and serialized
payload. Publication failures do not roll back persistence — REST remains the source of
truth, and clients reconcile via pagination.

---

## 6. Data Plane: Go WebSocket Server

### 6.1 Package Structure

```
websocket-server/
├── main.go              # wiring: config → pubsub → manager → router → graceful stop
├── config/              # env-driven configuration (port, redis URL, JWT secret, origins)
├── handlers/            # HTTP upgrade handler, JWT extraction/validation, /health
├── manager/connection.go # ConnectionManager: registration, routing, pumps
├── models/              # OutgoingMessage envelopes + EventType constants
└── pubsub/redis.go      # Redis subscriber loop, HandleRedisMessage dispatch
```

### 6.2 Connection Lifecycle

On `GET /ws`:

1. **Origin check** (`isOriginAllowed`): allow-list comparison against configured
   origins plus localhost; requests without `Origin` (non-browser clients) pass. This
   is the CSWSH boundary (§10.3).
2. **Token extraction**: scan offered subprotocols for `Bearer <jwt>` (also accepting
   legacy `token.` prefix). Never read from query string.
3. **Validation**: HS256 signature verified against `JWT_SECRET`, which *must equal*
   Django's `SECRET_KEY`; `user_id` and `username` claims become client identity.
4. **Upgrade & registration**: Gorilla upgrade (1 KB buffers); a `Client{ID, Username,
   Conn, Send chan []byte(256)}` enters the manager via the `Register` channel.
5. **Pumps start**: `ReadPump` (per-connection read deadlines, ping handling) and
   `WritePump` (channel drain + ticker pings) run as goroutines — two lightweight
   goroutines per socket.

### 6.3 The ConnectionManager

The manager is a single goroutine owning all mutable state, communicated with via
channels — the canonical Go pattern that eliminates lock contention:

- `Register` / `Unregister` channels mutate the client set.
- `BroadcastToGroup(groupID, msg)` and `SendToUser(userID, msg)` route to local
  recipients only.
- Presence writes go to the shared Redis `online_users` set on connect/disconnect;
  reads prefer Redis with a node-local fallback if Redis blips.

### 6.4 Keepalive and Backpressure

- Ping/pong: `pongWait = 60 s`, `pingPeriod = 54 s` — idle sockets cost almost nothing.
- `maxMessageSize = 512 KB` caps inbound frames; slow consumers simply stop draining
  their own `Send` buffer (drops logged, never blocking the node) — backpressure is
  contained per-socket by design.

### 6.5 Supported Events

Server-emitted: `connected`, `group_message`, `private_message`, `user_joined`,
`user_left`, `user_removed`, `member_promoted`, `message_deleted`, `message_read`,
unread-count updates, `typing_indicator`, `error`.
Client-emitted (raw WS): `ping`, typing indicators, mark-read, online-users request,
older-message paging. *Note:* these client-originated targeted events currently route
only on the receiving node (§14, L1).

### 6.6 Shutdown

SIGINT/SIGTERM triggers `server.Shutdown(ctx)` with a 5-second grace period, then
`connManager.Shutdown()` drains registrations so unregisters and Redis `SREM`s complete
cleanly — preventing stale presence entries from planned restarts.

---

## 7. The Broker: Redis Pub/Sub

### 7.1 Role and Contract

Redis provides exactly two things:

1. **An event bus** — channel `messaging_events`, logical database **1**. Both planes
   must point at DB 1 or delivery silently breaks; this is enforced operationally by
   compose configuration and documented as an invariant.
2. **Shared ephemeral state** — the `online_users` set (and cache usage via
   django-redis), keeping nodes stateless.

### 7.2 Delivery Semantics

Pub/Sub is **at-most-once, fire-and-forget**: there is no replay. The design accepts
this because REST persistence already guarantees durability of content; the realtime
path is an optimization, and clients reconcile missed events by refetching. Moving to
Redis Streams with consumer groups would buy at-least-once fan-out for offline devices
(roadmap, §14 L3).

### 7.3 Why Not Alternatives

- **Django Channels/Twisted** were removed in v1.0.0 — they collapse both planes onto
  one Python process, forfeiting Go's concurrency economics and failure isolation.
- **Kafka/RabbitMQ** exceed requirements at this scale; operational cost outweighs
  durability gains the current reconciliation model doesn't yet need.

---

## 8. Client Layer

### 8.1 Main SPA (vanilla ES modules)

No bundler; the browser loads native ES modules:

```
js/
├── app.js                  # bootstrap
├── api.js                  # REST client (fetch, JWT attach/refresh)
├── websocket.js            # WS lifecycle, reconnect
├── config.js
├── core/EventBus.js        # pub/sub decoupling modules
├── modules/{auth,chat,groups,messages,navigation,users}/
├── ui/                     # rendering (lists, messages)
└── features/               # reactions, media, voice, themes, context menus, inputs
```

The EventBus mediates between transport managers and UI renderers, keeping DOM code
ignorant of protocol details.

### 8.2 Embeddable Widget (`dms-chat.js`)

A single-file, zero-dependency IIFE exposing `window.DMSChat.init(config)`. Design
points:

- **Config surface**: container selector, `apiBase`, `wsUrl`, `chatType`
  (`group|private`), `chatId`, `userId`, `token` **or** `tokenProvider() => Promise`,
  theme/title callbacks, reconnect knobs, page size.
- **tokenProvider** is the recommended production pattern: the host mints short-lived
  user JWTs on demand; nothing long-lived sits in page source.
- **Transport-only**: persists neither tokens nor messages; all authorization remains
  server-enforced (the widget can never read a conversation its user cannot access).
- **XSS-safe rendering**: all message content HTML-escaped before insertion.
- React SDK wrapper (`widget/react/src/ChatWidget.jsx`) mirrors the config surface;
  unit tests for pure logic run in Node (`node dms-chat.test.js`).

---

## 9. Multi-Tenancy and Metering

### 9.1 Tenancy Model

A `Workspace` is the tenant boundary: one embedding application. `User.workspace` and
`Group.workspace` scope data; NULL workspace preserves legacy single-tenant behavior
unchanged, making tenancy opt-in and backward compatible.

Two authentication modes coexist (`accounts/authentication.py`):

| Mode | Credentials | Principal |
|---|---|---|
| End-user | JWT bearer | `User` (workspace from `user.workspace`) |
| Server-to-server | `X-Workspace-ID` + `X-Workspace-Key` headers | `WorkspacePrincipal` |

`current_workspace(request)` centralizes resolution so every queryset scoping decision
has a single source of truth. Server-to-server provisioning endpoints
(`/api/provision/users|groups/`) let embedding apps create users/channels without
self-registration flows.

### 9.2 Metering Design

Usage tracking is a `post_save` signal on `Message` (`messaging/signals.py`):

- For group messages the workspace resolves via the message's group; otherwise via the
  sender's workspace. Workspaceless messages are ignored (legacy mode untouched).
- Counters live in `WorkspaceDailyUsage` (unique workspace+date) incremented with
  `F('message_count') + 1` — atomic, race-safe, and O(1) storage versus an event log.
- **Failure isolation invariant:** the increment is wrapped in try/except and logs on
  error — *metering must never break messaging*. Billing accuracy is best-effort;
   delivery correctness is absolute.
- Enforcement is symmetric but soft by default: when `Workspace.message_quota` is null
  the quota is unlimited; when set, `perform_create` rejects messages past the daily
  cap with `403`. Because enforcement reads today's aggregate (one indexed lookup),
  the check costs effectively nothing on the hot path.

---

## 10. Security Design

### 10.1 Credential Handling

- No secrets in code: everything flows from environment (`python-decouple`); production
  refuses to boot with the insecure default `SECRET_KEY` while `DEBUG=False`
  (fail-fast, settings.py:27).
- API keys are stored **hashed only** — `Workspace.issue_api_key` runs the raw key
  through Django password hashers; verification uses constant-time checking. The raw
  key exists solely at issuance time.
- JWT rotation with blacklist-after-rotation; refresh tokens revocable at logout.

### 10.2 Token Transport

JWTs travel to the WebSocket tier inside the **`Sec-WebSocket-Protocol` subprotocol
header**. URLs leak into nginx/proxy access logs and browser history by default; headers
do not. This closes a common real-world leak vector.

### 10.3 Cross-Site WebSocket Hijacking (CSWSH)

Browsers attach ambient cookies to WS handshakes, so an attacker page can open a socket
as a victim unless origins are checked. The upgrader enforces an origin allow-list
(case-insensitive, trailing-slash-normalized). Non-browser clients omitting `Origin`
are permitted deliberately (CLIs/tests/server-to-server), trading theoretical CSRF
exposure for practical operability — those clients have no ambient-cookie semantics.

### 10.4 Edge Hardening

nginx adds `X-Frame-Options: DENY`, `nosniff`, strict `Referrer-Policy`,
`Permissions-Policy`, a restrictive CSP, and rate-limits: `30 r/s` general API, `5 r/s`
auth endpoints (burst allowances), connection caps per IP. DRF throttling layers
additionally cap anonymous traffic (100/hour) and authenticated users (1000/hour),
with a dedicated 20/hour login throttle.

### 10.5 Encryption Posture (honest framing)

Messages may carry client-side AES-GCM ciphertext with per-recipient wrapped keys;
public keys are hosted per-user. Because wrapped keys and ciphertext transit the
server, this is accurately described as **server-assisted client encryption**, not full
E2EE — a deliberate v1 trade-off enabling server-side search/moderation later. The
platform never claims otherwise in user-facing copy.

### 10.6 Content Safety

All message rendering escapes HTML — main SPA and widget alike. The widget injects no
untrusted markup ever.

---

## 11. Scaling Analysis

### 11.1 What Is Already Horizontal

- **Control plane**: stateless Django behind gunicorn (`GUNICORN_WORKERS`,
  `GUNICORN_THREADS`); scale by adding workers/replicas sized on request RPS.
- **Data plane**: each Go node knows only its own clients (`cm.clients`). Since event
  *routing* keys off group/recipient identity — carried in every Redis envelope — any
  node can deliver to whichever of its clients care. **Sticky sessions are unnecessary
  for correctness.**

### 11.2 Multi-Replica Correctness

| Concern | Mechanism |
|---|---|
| Group/private delivery | Every node subscribes to `messaging_events`; delivers to locally-held members only |
| Presence | Shared `online_users` Redis set; reads prefer Redis, fallback node-local |
| Identity | Stateless JWT validation per node (shared secret) |

Adding capacity is literally `docker compose --scale websocket=N` (or more upstream
entries in nginx).

### 11.3 Sizing Rule of Thumb

- ~10k concurrent connections per well-provisioned Go replica is realistic; ceiling is
  set by message rate, not idle sockets.
- Control plane scales by RPS (persistence-heavy), independent of connection count.
- nginx: raise `worker_connections` and WS keepalive timeouts when going wide.

### 11.4 Remaining Limits

See §14 for the four documented limits (node-local targeted events, crash-stale
presence entries, fire-and-forget delivery, node-local stats) each paired with a
concrete remediation path.

---

## 12. Deployment Topology

`docker-compose.yml` defines five services on a private bridge network:

| Service | Image/Build | Notes |
|---|---|---|
| `db` | postgres:16-alpine | healthcheck `pg_isready`; 512 MB cap |
| `redis` | redis:7-alpine | AOF on; 256 MB; LRU policy; **DB 1 by convention** |
| `backend` | Dockerfile | migrate + collectstatic + gunicorn (`max-requests` recycling); healthcheck on `/api/health/` |
| `websocket` | websocket-server/Dockerfile | shares `REDIS_URL` (DB 1) and `JWT_SECRET=${SECRET_KEY}` with backend; healthcheck on `/health` |
| `nginx` | nginx:alpine | mounts repo `nginx/nginx.conf`; serves frontend SPA, static/media volumes; proxies `/api|/admin` → backend, `/ws` → websocket with proper upgrade headers and 24 h timeouts |

Static assets ship through WhiteNoise (compressed manifest storage) inside the backend
image and via nginx volume mount at the edge. Media uploads persist on a named volume.
Resource limits are declared per service, making the stack predictable under noisy
neighbors.

---

## 13. Testing Strategy

Tests live next to code; no external e2e harness in v1.

| Layer | Suite | Runner |
|---|---|---|
| Django apps | `accounts/tests.py`, `messaging/tests.py` (auth, groups, messages, workspaces, metering, quotas) | `python manage.py test` / pytest |
| Go handlers | `handlers/websocket_test.go` (subprotocol extraction, origin rules) | `go test ./...` |
| Widget | `frontend/widget/dms-chat.test.js` (pure logic: config validation, URL derivation, escaping) | `node dms-chat.test.js` |

Coverage philosophy: business rules and security boundaries (origin filtering, token
extraction, quota enforcement) are unit-tested where they live; integration behavior is
verified manually against the compose stack, with nginx-level behaviors documented
rather than automated.

---

## 14. Known Limitations and Future Work

Tracked honestly in `docs/SCALING.md`; reproduced here with design intent:

| # | Limitation | Root Cause | Remediation Path |
|---|---|---|---|
| L1 | Client-originated targeted events (`typing`, `mark_read` over raw WS) reach only same-node targets | Direct local routing bypasses Redis republish | Re-publish these to `messaging_events`, or move flows onto the REST→Redis path (already primary) |
| L2 | Crash-stale presence entries linger until node restart | `online_users` lacks TTL; `SREM` runs on clean disconnect only | Per-node keyed entries with expiry + periodic sweeper |
| L3 | No offline/at-least-once delivery | Pub/Sub is fire-and-forget | Redis Streams consumer groups |
| L4 | Global connection stats are node-local | No coordinator | Expose per-node `/health` counts; aggregate at LB/monitoring scrape |

Roadmap items beyond fixes: Redis HA (Sentinel/Cluster), push notifications
(FCM/APNS), message search, voice/video signaling, additional SDKs (Vue/Svelte),
launcher-style widget themes.

---

## 15. Conclusion

DMS demonstrates that the control-plane/data-plane split is more than an aesthetic:
it lets each subsystem be chosen for what it is actually good at — Django's ecosystem
for trustworthy business logic, Go's runtime for connection economics — while a thin
Redis contract keeps them independently scalable. The design's defining property is
**disciplined statelessness**: Go nodes hold nothing global, presence lives in one
Redis set, truth lives in Postgres through Django alone. That discipline is what makes
"just add replicas" a true statement about the WebSocket tier.

Equally deliberate are the honest edges: metering that fails open for delivery but
closed for billing abuse; encryption framed as server-assisted rather than E2EE;
four named scaling limits each carrying its fix. The result is a platform whose growth
path — streams for durability, sweepers for presence hygiene, republished targeted
events — requires no architectural reversal, only incremental refinement.

---

*Companion documents: `README.md` (usage), `docs/SCALING.md` (scaling authority),
`docs/EMBED.md` (widget guide), `BACKEND_DOCUMENTATION.md` (API reference),
`CHANGELOG.md` (release history).*
