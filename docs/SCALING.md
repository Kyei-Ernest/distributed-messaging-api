# Scaling the Distributed Messaging System

This document is the authoritative answer to *"how does this handle N concurrent
connections?"*. It describes what is already horizontal by design, what was
hardened to be multi-node correct, and the honest remaining limits with concrete
next steps.

## Architecture recap

- **Control plane (Django)** — auth, business logic, persistence, REST. Scales
  horizontally by adding gunicorn workers / web server replicas.
- **Data plane (Go WebSocket server)** — holds persistent connections and fans
  out real-time events.
- **Redis Pub/Sub** — decouples the two. Django *publishes* events; every Go
  node *subscribes*.

The Go WebSocket server is **almost entirely shared-state-free**: each node keeps
only its own connected clients in memory (`cm.clients`), which is the key property
that lets you run many replicas behind a load balancer.

## What is already multi-node correct

### Group & private message delivery
Django publishes `group_message`, `private_message`, `message_deleted`, etc. to the
single `messaging_events` Redis channel. **Every Go node receives every event and
forwards it only to the clients it happens to be holding.** There is no shared
client registry and no sticky session needed:

- Node A holds Alice → delivers group messages to Alice.
- Node B holds Bob → delivers the same group event to Bob.

Whichever node holds a client delivers to it. Because the source of truth for
*where an event must go* is the group/recipient identity (not the node), delivery
is correct across any number of replicas.

### Presence
Online/offline status is written to a **shared Redis set** (`online_users`) on
connect/disconnect, and the chat list reads it from `Django`. WebSocket presence
responses now also read from the same shared set (falling back to node-local
memory if Redis is briefly unavailable). Presence is therefore correct across
multiple Go instances — it no longer depends on any single node.

## How to run multiple replicas

Run `N` Go WebSocket replicas behind a reverse proxy. The repo already ships an
`nginx` upstream:

```nginx
upstream websocket_server {
    server websocket:8001;
    keepalive 32;
}
# add more:
#   server websocket-2:8001;
#   server websocket-3:8001;
```

Because WebSocket nodes share state via Redis and are stateless, **no sticky
sessions are required for correctness** — the "Upgrade" request can land on any
healthy node. When scaling the Go tier, also:

- Add Redis replicas / use Redis Cluster or Sentinel for HA (see Roadmap).
- Raise `worker_connections` and `<h2> keepalive timeouts in nginx.
- Use `ip_hash` only if you want to maximize connection reuse on one node.

## Rendering the cost/performance argument

The hybrid is a *legit* cost advantage to market:

- **Django handles the boring, cheaply-parallelizable work** (auth, DB, admin) —
  you pay per web worker, not per connection.
- **Go only pays for what it's good at** — a few goroutines and channels per
  socket. A single Go process can hold tens of thousands of idle WebSockets with
  modest memory, whereas scaling a Python WS stack to the same connection count
  is far more expensive.
- By defaulting to `sync` gunicorn workers with per-socket Go handling, the hot
  path (persistent connections) never blocks the control plane.

## Honest remaining limits (with a plan)

| # | Limitation | Why | Plan |
|---|------------|-----|------|
| 1 | Client-originated **targeted** events (`mark_read`, typing) currently route only on the local node | The direct WS path calls `routeReadEvent(SendToUser)` on the node the device is connected to; a target user on another node would not be reached | Re-publish client-originated targeted events to Redis so all nodes forward to their local target; or switch those flows to the REST→Redis path (already the primary path) |
| 2 | `online_users` set has no TTL — **crash-stale entries** linger until the node restarts | `SREM` runs on clean disconnect only | Periodic reconciliation: each node re-writes its clients under a per-node key with expiry, and a sweeper removes expired entries (or per-user keyed entries with TTL) |
| 3 | No durable / at-least-once delivery if a device is offline | Redis Pub/Sub is fire-and-forget | Move to Redis Streams with consumer groups (already on the Roadmap) |
| 4 | Global per-node stats (live connection counts) are node-local | No coordinator | Expose per-node `/health` with connection count; aggregate via the load balancer or a monitoring scrape |

None of these block running multiple replicas today; they are refinements for HA /
observability / offline durability.

## Load-shape notes

- Default ping/pong: `pongWait = 60s`, `pingPeriod = 54s` — idle sockets use
  minimal resources.
- `maxMessageSize = 512KB` and `Send` buffers are per-socket; outlier clients that
  stall stop consuming their own buffer (dropped messages are logged, never block
  the node).
- Gunicorn: raise `GUNICORN_WORKERS`/`GUNICORN_THREADS` for control-plane capacity;
  the WebSocket tier scales by replica count, not per-process threads.

## Rough sizing rule of thumb

- WebSocket tier: ~10k concurrent connections per well-provisioned Go replica is a
  realistic target (the exact ceiling depends on message rate, not idle sockets).
- Control plane: scale Django replicas by request RPS (REST + persistence), not by
  connection count.