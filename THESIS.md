# Design and Analysis of a Hybrid Distributed Messaging System

**A Technical Thesis on Architecture, Correctness, and Scalability**

Author: Ernest Kyei
Project: Distributed Messaging System (DMS)
Repository: `github.com/Kyei-Ernest/distributed-messaging`
Version: 1.2.0 · August 2026

---

## Abstract

Real-time messaging systems impose two conflicting engineering demands: the *control*
demands of authentication, authorization, validation, and persistence — where mature,
batteries-included frameworks excel — and the *data-plane* demands of holding tens of
thousands of concurrent WebSocket connections and fanning out events with minimal
latency, where runtime efficiency dominates.

This thesis presents the design of a hybrid architecture resolving this tension by
splitting the system into a **Django 6 / DRF control plane** owning business logic and
persistence, and a **Go 1.21 data plane** owning persistent connections and fan-out,
decoupled by **Redis Pub/Sub**. We contribute: (1) a rigorous statement of the
system's delivery-semantics contract — durable-once persistence with at-most-once
realtime overlay reconciled by client refetch; (2) an analysis demonstrating that the
data plane is *shared-state-free*, yielding horizontal scalability without sticky
sessions, with fan-out cost O(nodes) rather than O(recipients); (3) a capacity model
grounded in measured constants of the implementation; (4) an honest gap analysis
against full distributed-systems semantics — node-local targeted events, single-broker
failure domain, at-most-once realtime, and crash-stale presence — each paired with a
concrete remediation design in the companion hardening plan; and (5) an FMEA and SLO
framework for operating the result. Multi-tenant workspaces with hashed-key server-to-
server authentication, metering that provably cannot degrade the messaging hot path,
and a zero-dependency embeddable widget complete the platform.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Background and Related Systems](#2-background-and-related-systems)
3. [Requirements](#3-requirements)
4. [System Model and Failure Model](#4-system-model-and-failure-model)
5. [Architecture](#5-architecture)
6. [Design Decisions](#6-design-decisions)
7. [Control Plane](#7-control-plane-djangodrf)
8. [Data Plane](#8-data-plane-go-websocket-server)
9. [Broker](#9-broker-redis-pubsub)
10. [Client Layer](#10-client-layer)
11. [Multi-Tenancy and Metering](#11-multi-tenancy-and-metering)
12. [Security Design](#12-security-design)
13. [Correctness and Delivery Semantics](#13-correctness-and-delivery-semantics)
14. [Distributed Gaps and Remediation](#14-distributed-gaps-and-remediation)
15. [Capacity and Performance Model](#15-capacity-and-performance-model)
16. [Failure Modes and Effects Analysis](#16-failure-modes-and-effects-analysis)
17. [Operations](#17-operations-slos--observability--deployment)
18. [Testing Strategy](#18-testing-strategy)
19. [Conclusion](#19-conclusion)

---

## 1. Introduction

### 1.1 Problem Statement

Chat-as-a-feature is now a default expectation: support widgets inside SaaS products,
community chat inside marketplaces, coordination channels inside internal tools.
Building this correctly requires solving simultaneously:

1. **Connection scale** — long-lived bidirectional connections far beyond what
   request/response web frameworks are tuned for.
2. **Fan-out** — one message to one group must reach every member's device wherever it
   happens to be connected.
3. **Correctness under replication** — multiple stateful connection servers produce
   split-brain presence and missed deliveries unless shared state is designed
   deliberately.
4. **Security** — tokens must not leak through infrastructure logs; cross-site
   WebSocket hijacking must be addressed; tenant data must be isolated when one
   platform serves many products.
5. **Embeddability** — third parties must embed chat without adopting the host stack.

### 1.2 Approach

DMS answers with three cooperating components:

| Component | Technology | Plane | Responsibility |
|---|---|---|---|
| REST API | Django 6 + DRF | Control | Auth, business rules, persistence, admin |
| WebSocket server | Go 1.21 + Gorilla | Data | Persistent connections, real-time fan-out |
| Broker | Redis Pub/Sub, DB 1 | Glue | Event bus decoupling the planes |

Clients authenticate once against Django to obtain a JWT; they then hold a WebSocket to
the Go tier using that JWT. Every message is created through REST (Django remains the
single writer of truth), after which Django publishes an event to Redis; each Go node
receives it and forwards to clients it holds. In short: **REST as source of truth,
WebSockets as delivery mechanism.**

### 1.3 Contributions

1. A hybrid control/data-plane split with a precise statement of which guarantees live
   where (§13).
2. Proof-by-construction that the data plane needs no sticky sessions: routing keys off
   group/recipient identity carried in events, not connection affinity (§8, §13).
3. Fan-out cost analysis showing inter-broker traffic scales with node count, not
   recipient count (§15.3).
4. A capacity model derived from implementation constants (§15).
5. An explicit gap register against stronger distributed semantics, with engineered
   remediations ([`docs/HARDENING_PLAN.md`](HARDENING_PLAN.md)) summarized in §14.
6. Operational frameworks: FMEA (§16), SLOs (§17), chaos testing (§18).

---

## 2. Background and Related Systems

### 2.1 Architectural families for real-time chat

| Family | Representative | Strength | Weakness DMS addresses differently |
|---|---|---|---|
| Monolith + channels | Django Channels / Twisted | One deploy unit, ORM-native WS | Concurrency economics collapse onto Python process; no failure isolation |
| Dedicated realtime server + app backend | Centrifuge, Socket.IO + Node | Strong realtime focus | Business logic still needs a second framework; two ecosystems |
| Managed pub/sub edge | Pusher, Ably, Firebase | Zero ops | Cost at scale, data gravity, no self-hosting |
| App-backend + broker-fed gateway | Slack/Discord-era pattern: stateless gateways fed by a bus | Independent scaling of both concerns | Requires discipline to keep gateways stateless — this thesis's core subject |
| Server-sent push (HTTP/2) | Mercure | Simplicity over HTTP | Half-duplex; typing/receipts want bidirectional |

### 2.2 Positioning

DMS implements the fourth family in miniature with commodity parts: Django (ecosystem
gravity), Go (connection economics), Redis (bus + ephemeral state). The contribution is
not novelty of parts but the explicit contracts between them — §13 makes those
contracts precise, which is where such systems usually fail quietly.

---

## 3. Requirements

### 3.1 Functional (abridged)

FR1 Register/login/logout/refresh (JWT). FR2 Group CRUD with membership roles.
FR3 Private and group messages with replies, receipts, reactions.
FR4 Realtime delivery of messages and presence. FR5 Typing indicators.
FR6 Media attachments. FR7 Embeddable group/private chat widget.
FR8 Workspace provisioning via API key. FR9 Per-workspace daily usage metering with
optional quota.

### 3.2 Non-functional (measurable)

| ID | Requirement | Target | Where addressed |
|---|---|---|---|
| NFR1 | Fan-out latency (publish → socket write, intra-region) | p95 < 150 ms | §15.5 budget |
| NFR2 | Connection density | ~10k sockets/node on modest host | §15.1–15.2 |
| NFR3 | Horizontal scale-out without sticky sessions | correctness-preserving | §13.2, §8 |
| NFR4 | Message durability | 100% of accepted writes survive crash | §13.1 |
| NFR5 | Metering isolation | 0 added failure modes to send path | §11.3 |
| NFR6 | Tenant isolation | no cross-workspace read/write by any principal | §11, §12.6 |
| NFR7 | No secrets in URLs/logs | token transport via headers only | §12.2 |
| NFR8 | Rolling deploys without message loss | post-W3 (§14) | HARDENING_PLAN |

---

## 4. System Model and Failure Model

Following standard practice (cf. Abadi; Brewer; Gilbert–Lynch):

- **Processes**: control-plane replicas C₁..Cₘ (stateless behind LB), data-plane nodes
  G₁..Gₙ (own only local sockets), broker R (single instance today), database P
  (single primary). 
- **Links**: asynchronous; partitions possible intra-region but rare; no clock
  synchronization assumed for ordering — timestamps are informational, ordering comes
  from channel position or DB sequence.
- **Failure modes assumed**: crash-restart (fail-stop). No Byzantine behavior.
  Slow-consumer backpressure treated as a first-class failure mode (§8.4).
- **Baseline delivery semantics** (before hardening): persistence = durable once;
  realtime = at-most-once; presence = eventually consistent bounded by disconnect
  detection (60 s pong timeout).

This model makes explicit why the four gaps exist: they are exactly the consequences
of fail-stop nodes + fire-and-forget links + single-broker R. §14 closes them within
this same model (no Byzantine machinery needed at this scale).

---

## 5. Architecture

### 5.1 Topology

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

### 5.2 Canonical write path

1. `POST /api/auth/login/` → HS256 JWT pair signed with `SECRET_KEY`
   (`config/settings.py:225`).
2. `GET /ws` upgrade at Go tier; JWT presented via **`Sec-WebSocket-Protocol`
   subprotocol** (`handlers/websocket.go:20`); signature validated against the same
   secret; client registered through manager's `Register` channel.
3. `POST /api/messages/` — permission classes validate membership/recipient; row
   committed (`messaging/models.py:53`); JSON envelope published to `messaging_events`
   (`messaging/views.py:58`).
4. **Every** node receives the envelope via its subscriber goroutine
   (`pubsub/redis.go`) and routes to locally-held recipients
   (`manager/connection.go:375,433`).
5. Clients apply typed events, reconciling against paginated REST history.

### 5.3 Why hybrid — the economic argument

Persistent connections dominate chat resource usage; Go amortizes them cheaply
(goroutine-per-pump, few KB per idle socket), while Django amortizes auth/validation/
admin complexity cheaply. All-Django alternatives collapse both planes onto one Python
process, forfeiting concurrency economics *and* failure isolation — the v1.0.0 removal
of Channels/Twisted codified this decision. Quantified further in §15.

---

## 6. Design Decisions

Condensed architecture-decision record:

| # | Decision | Alternatives considered | Rationale / consequence |
|---|---|---|---|
| D1 | Two-plane split, bus-decoupled | Channels monolith; pure-Go monolith | Each tool used where strongest; planes scale/deploy independently (§2.1, §5.3) |
| D2 | Redis Pub/Sub over queue/streams (v1) | RabbitMQ, Kafka, Streams | Ops cost vs durability need; REST already guarantees durability; streams adopted later (W3) |
| D3 | REST-writes-only for messages | WS-direct writes | Single writer of truth; validation/permissions reuse; realtime demoted to optimization |
| D4 | UUID PKs throughout | BigAutoField | Non-enumerable IDs; multi-system generation without coordination |
| D5 | Shared-secret JWT across planes | Token introspection service | Stateless validation at N nodes; cost = coordinated secret rotation |
| D6 | JWT via subprotocol header | Query string | URLs leak into proxy logs/history (`handlers/websocket.go:20`) |
| D7 | Origin allow-list; empty Origin permitted | Mandatory Origin | CSWSH boundary for browsers; CLIs/tests/servers legitimately omit it |
| D8 | API keys stored hashed (password hashers) | Plaintext/encrypted keys | Constant-time verify; raw key shown once at issuance (`accounts/models.py:30`) |
| D9 | Daily-aggregate metering | Append-only event log | O(1) storage/quota checks; `F()` atomic increments avoid races |
| D10 | NULL workspace = legacy single-tenant | Forced migration of all users | Backward compatibility; tenancy opt-in |
| D11 | Manager = single goroutine + channels | Mutex-guarded map | Lock-free reasoning; canonical Go ownership transfer |

---

## 7. Control Plane (Django/DRF)

### 7.1 Layout

`accounts/` — identity & tenancy (custom UUID `User`, `Workspace`,
`WorkspaceDailyUsage`, JWT endpoints, API-key issuance, provisioning).
`messaging/` — domain logic (`Group`, `GroupMember`, `Message`, receipts, reactions,
public-key hosting, health, metering signals). `config/` — env-driven settings via
python-decouple with production fail-fast (`settings.py:27`: refuse insecure default
secret when `DEBUG=False`).

### 7.2 Data model

All PKs UUIDv4. Relationships:

```
Workspace 1──* User            (SET_NULL; NULL = legacy single-tenant, D10)
Workspace 1──* Group           (CASCADE)
Workspace 1──* WorkspaceDailyUsage  (unique workspace×date)
User M──N Group                via GroupMember (unique user×group, is_admin)
Message *──1 Group             required iff type="group" (model-level clean())
Message *──1 User (recipient)  required iff type="private"
Message 1──self                replies (parent_message)
Message 1──* ReadReceipt       unique message×user
Message 1──* Reaction          unique message×user×emoji
```

Integrity enforced twice: `Message.clean()` validates type constraints including
sender-membership; composite indexes match hot query shapes exactly —

```python
Index(fields=['message_type', 'group', '-created_at']),                # group history
Index(fields=['message_type', 'sender', 'recipient', '-created_at']), # DM history
Index(fields=['sender', '-created_at']),
Index(fields=['recipient', '-created_at']),
```

Encryption columns (`encrypted_content`, `encrypted_key`, `encrypted_key_self`,
`encrypted_keys` JSONB for groups, `iv`) support AES-GCM client payloads with
per-recipient wrapped keys (§12.5).

### 7.3 Authorization posture

No global default permission class — authorization is explicit per view via
`messaging/permissions.py` (`IsGroupMember`, `IsGroupAdmin`, `IsGroupCreator`,
`IsMessageSender`, `CanAccessMessage`). Cost: every new endpoint must choose its
guards deliberately; benefit: no accidental public default. This trade-off is
documented as a standing review requirement.

### 7.4 Event publication

After `perform_create`, an envelope goes to `messaging_events`. Publication failure
does not roll back persistence — REST remains truth, clients reconcile via pagination
(semantics formalized §13).

---

## 8. Data Plane (Go WebSocket Server)

### 8.1 Structure and lifecycle

Packages: `config` (env), `handlers` (upgrade/auth/health), `manager/connection.go`
(routing), `pubsub` (subscriber loop), `models` (envelopes/events).

Connection lifecycle on `GET /ws`: origin allow-list check (`isOriginAllowed`,
case-insensitive, trailing-slash-normalized; empty Origin permitted per D7) →
subprotocol token extraction (`Bearer <jwt>`, legacy `token.` accepted) → HS256
validation against shared secret → Gorilla upgrade (1 KB buffers) → registration via
channel → `ReadPump`/`WritePump` goroutines started (two lightweight goroutines per
socket).

### 8.2 The ConnectionManager as ownership boundary

Single goroutine owns all mutable client state; all interaction flows through channels
(`Register`, `Unregister`, broadcast/group/user sends). Routing primitives:
`BroadcastToGroup(groupID, msg)` and `SendToUser(userID, msg)` deliver to **local**
recipients only — the property enabling replica transparency (§13.2).

### 8.3 Presence

Connect/disconnect mutate the **shared Redis set** `online_users`; reads prefer Redis
with node-local fallback during Redis unavailability. Cross-node correct today;
crash-stale and multi-device issues analyzed in §14 (W4 fixes both).

### 8.4 Keepalive and backpressure containment

Constants: `pongWait = 60 s`, `pingPeriod = 54 s` (one missed tick tolerated);
`maxMessageSize = 512 KB`; per-socket `Send` channel capacity 256 frames. Slow
consumers stop draining their own buffer — drops are logged, never block the node:
backpressure blast radius is one socket by construction.

### 8.5 Event surface

Server-emitted: `connected`, `group_message`, `private_message`, `user_joined/left/
removed`, `member_promoted`, `message_deleted`, `message_read`, unread-count updates,
`typing_indicator`, `error`. Client-emitted raw-WS: `ping`, typing, mark-read,
online-users request, older-message paging — currently node-local (gap L1, §14).

### 8.6 Shutdown

SIGINT/SIGTERM → `server.Shutdown(5 s grace)` → `connManager.Shutdown()` drains
registrations so unregisters and Redis cleanup complete — planned restarts leave no
presence residue (crash restarts do; see W4).

---

## 9. Broker (Redis Pub/Sub)

### 9.1 Contract

Redis provides exactly two things: (1) event bus — channel `messaging_events`,
logical **DB 1**, an invariant shared by both planes or delivery silently breaks;
(2) shared ephemeral state — `online_users` plus django-redis caching.

### 9.2 Delivery semantics and acceptance thereof

Pub/Sub is at-most-once, fire-and-forget. Accepted because REST persistence already
guarantees content durability; realtime is an optimization layered on top, and clients
reconcile missed events by refetching (§13.4). The upgrade path — Streams with
consumer groups — trades small latency for replay/acks and is designed in W3.

### 9.3 Why not heavier middleware

Kafka/RabbitMQ exceed current requirements; operational cost outweighs durability gains
that reconciliation already covers. Revisited when offline-device push becomes a
requirement rather than reconciliation-by-refetch.

---

## 10. Client Layer

### 10.1 Main SPA

Bundler-free ES modules: `core/EventBus.js` mediates between transport managers
(`modules/{auth,chat,groups,messages,navigation,users}`) and UI renderers (`ui/`),
with feature modules (reactions, media, voice, themes, context menus). Protocol
knowledge never reaches DOM code.

### 10.2 Embeddable widget

Single-file zero-dependency `dms-chat.js` exposing `window.DMSChat.init(config)`:
group/private modes, light/dark themes, reconnect (default 5 attempts × 3000 ms),
history pageSize 50. Security-relevant properties: **transport-only** (persists
neither tokens nor messages), all authorization server-enforced (widget can never read
a conversation its user lacks), all rendering HTML-escaped. `tokenProvider() =>
Promise<string>` lets hosts mint short-lived JWTs on demand instead of embedding
long-lived tokens in page source. React SDK mirrors the config surface.

---

## 11. Multi-Tenancy and Metering

### 11.1 Tenancy model

`Workspace` is the tenant boundary — one embedding application. `User.workspace` and
`Group.workspace` scope data; NULL preserves legacy single-tenant behavior unchanged
(D10), making tenancy opt-in and backward compatible.

Two principals coexist (`accounts/authentication.py`):

| Mode | Credentials | Principal |
|---|---|---|
| End-user | JWT bearer | `User` (tenant from `user.workspace`) |
| Server-to-server | `X-Workspace-ID` + `X-Workspace-Key` headers | `WorkspacePrincipal` |

`current_workspace(request)` centralizes tenant resolution — one function every
queryset-scoping decision consults. Provisioning endpoints (`/api/provision/users|groups/`)
let embedding apps create tenants' users/channels server-to-server.

### 11.2 Metering mechanism

`post_save` on `Message` resolves the workspace (via group for group messages, sender
otherwise; NULL ignored), then atomically increments the daily aggregate:

```python
usage.message_count = F('message_count') + 1   # race-safe UPSERT-style bump
```

Daily aggregate over event log: quota checks become single indexed lookups; storage is
O(days), not O(messages) (D9).

### 11.3 The isolation invariant

The increment sits inside try/except with error logging only — **metering must never
break messaging** (`messaging/signals.py:48`). Billing accuracy is best-effort;
delivery correctness is absolute. Quota enforcement (`perform_create`) reads today's
aggregate and rejects past-cap sends with `403`; enforcement cost ≈ one indexed SELECT
on the hot path.

---

## 12. Security Design

### 12.1 Credential handling

Environment-only configuration (python-decouple); production boot fails fast on
insecure defaults. API keys hashed with Django password hashers — constant-time
verification, raw key exists solely at issuance (D8). JWT refresh rotation with
blacklist-after-rotation; logout revokes refresh tokens.

### 12.2 Token transport

WebSocket JWT travels in the `Sec-WebSocket-Protocol` header — never the URL, which
leaks into nginx access logs and browser history (D6).

### 12.3 CSWSH

Browsers attach ambient cookies to WS handshakes; attacker pages could open sockets as
victims absent origin checks. The upgrader enforces the allow-list (D7). Empty-Origin
permission is deliberate: non-browser clients carry no ambient-cookie semantics.

### 12.4 Edge hardening

nginx: security headers (`X-Frame-Options DENY`, `nosniff`, strict Referrer-Policy,
Permissions-Policy, restrictive CSP); rate-limit zones 30 r/s general API, 5 r/s auth
(bursts 20/10), per-IP connection caps; 24 h read/send timeouts on `/ws`.
Application throttles: anonymous 100/h, user 1000/h, login 20/h — two independent
layers so bypassing one still hits the other.

### 12.5 Encryption posture (precise framing)

Client-side AES-GCM payloads with per-recipient wrapped keys; public keys hosted
per-user. Keys and ciphertext transit the server ⇒ accurately **server-assisted client
encryption**, not full E2EE — a deliberate v1 trade preserving future server-side
search/moderation options. No user-facing copy claims otherwise.

### 12.6 Content safety

HTML escaping everywhere messages render — SPA and widget alike; the widget injects no
untrusted markup ever.

---

## 13. Correctness and Delivery Semantics

This section states the system's actual guarantees precisely — the heart of the thesis.

### 13.1 Persistence guarantee

**Durable-once:** a message acknowledged by `POST /api/messages/` has been committed
to the primary. Crash of any component afterwards cannot lose it. This is the floor
guarantee; everything else is optimization.

### 13.2 Replica transparency (why no sticky sessions)

Routing correctness depends only on identities carried in the event envelope
(`group_id`, `recipient_id`, `sender_id`), not on which node holds which socket:

- Every node receives every event (broadcast subscription).
- Each delivers to locally-held members only.
- Whichever node holds a client delivers to it.

Formally: delivery predicate = {g ∈ G : ∃ socket(g) ∧ member(target_event, g)} —
node partition-independent. Hence replicas may be added/removed freely behind nginx;
the Upgrade request may land anywhere.

### 13.3 Ordering

No total order is guaranteed across publishers: multiple gunicorn workers publish
concurrently, interleaving arbitrarily. Per-channel FIFO holds approximately per Redis
connection, but clients must not rely on cross-sender ordering. Mitigation: UI orders
by `created_at` (+ id tiebreak) fetched from REST; realtime events update/append
optimistically. Note for W3: a single stream imposes total order — strictly stronger
than today.

### 13.4 Realtime delivery semantics

**At-most-once** to connected devices; loss windows exist (broker down, node mid-
restart, slow consumer drops). Correctness is restored by **client reconciliation**:
on reconnect/visibility/n-th event gap detection, clients refetch paginated history.
Convergence argument: REST history is the authoritative ordered log per
conversation; realtime events merely pre-apply entries of that log; any missed entry
is recovered by refetch. Thus the observable contract is *eventual convergence with
durable-once writes*, not reliable push.

### 13.5 Presence semantics

Eventually consistent. Upper bounds: disconnect detection ≤ 60 s (pong timeout);
crash-stale residue until node restart today (bounded ≤ TTL 90 s post-W4). Multi-device
false-offline bug identified and designed away in W4.

### 13.6 CAP/PACELC placement

Within-region, the system leans **AP** for the realtime view: during broker/partition
incidents, sockets stay alive and reads fall back node-local (availability), while
cross-node freshness degrades (consistency sacrificed). Writes remain CP-flavored via
single Postgres primary. PACELC else-latency: fire-and-forget keeps the happy-path
latency minimal; W3 deliberately trades a bounded latency increment (≤ +15 ms budget)
for durability.

---

## 14. Distributed Gaps and Remediation

Four gaps separate current semantics from stronger ones. Full engineering designs —
including code sketches, rollout flags, acceptance tests, effort, and risk ratings —
live in [`docs/HARDENING_PLAN.md`](HARDENING_PLAN.md); summarized:

| Gap | Today's consequence | Remediation (design) | Effect on §13 semantics |
|---|---|---|---|
| **L1** Node-local targeted events (`typing`, raw-WS `mark_read`; `manager/connection.go:867,904`) | Typist on node A invisible to reader on B | Republish client-targeted events over `messaging_events` with `event_id` + `origin_node`; echo suppression migrates to dispatch | §13.4 extends to targeted events; removes last routing asymmetry |
| **L2** Single-broker failure domain | Redis loss freezes fan-out, corrupts presence | Sentinel HA (primary+replica, quorum 3), documented degraded-mode contract, `/health` reports degraded-not-dead | Availability of §13.4 under failover < 10 s |
| **L3** At-most-once realtime | Deploy/crash windows lose events to affected clients until refetch | Streams `dms:events`, consumer group per node, XACK/XAUTOCLAIM, MAXLEN trim; dual-write shadow migration | Upgrades to **at-least-once to nodes**; with client dedup (event-id LRU) ⇒ exactly-once effect; rolling deploys lose nothing (§13.4 strengthened, reconciliation becomes rare-case) |
| **L4** Crash-stale + multi-device presence bugs | Ghost online users; false offline with sibling connection | Per-node hashes `presence:node:{id}` (connID→userID, TTL 90 s, refreshed each ping tick), derived global set rebuild | §13.5 bound tightens to ≤ 90 s worst case; multi-device correctness proven by construction |

Execution order **W1 → W4 → W2 → W3**: independent correctness fixes first; broker HA
before the bus becomes stateful-critical; durability last, since shadow-comparison is
only meaningful once failover drills are routine.

---

## 15. Capacity and Performance Model

Arithmetic from implementation constants; measurements to replace estimates as load
tests land.

### 15.1 Per-socket footprint (Go node)

Steady-state idle socket ≈ 2 goroutine stacks (~8 KB initial) + read/write buffers
(2 KB) + client struct/channel headers ≈ **15–25 KB**. At the SCALING.md target of
10k sockets/node: **150–250 MB**. Honest finding: the compose limit of 128 MB for the
websocket service must be raised before targeting 10k on one container — flagged as an
operational prerequisite, not a design flaw.

### 15.2 Active-socket costs

Under sustained traffic, dominant costs shift to GC pressure from per-frame slice
allocations and syscalls. Practical sustained budget: **5–10k events/s/node** well
below the manager-loop theoretical ceiling (channel send ≈ 100 ns amortized; the loop
is not the bottleneck — allocator and NIC are).

### 15.3 Fan-out amplification — the structural win

Event to a group of M members spread across N nodes: **one** broker publish, N node
deliveries, Σ local sends = M. Inter-broker traffic is **O(N)** regardless of M or
member distribution — versus O(M) for naive per-recipient publishing. With 50k-member
groups on 20 nodes: 20 deliveries. This asymmetry is why the shared-state-free design
scales.

### 15.4 Broker ceiling

Single Redis sustains ≥ ~100k small-msg publishes/s (published benchmarks; verify on
target hardware). Headroom vs 20 nodes × 5k/s = 100k/s is thin — another reason W2
(precedes W3) matters, and a sizing note for large clusters (sharded pub/sub or
Streams partitioning if exceeded).

### 15.5 Write-path latency budget (NFR1)

REST accept+commit (indexed insert, P99 ~2–5 ms w/ WAL) → publish (< 1 ms local) →
subscriber wake (~µs) → per-socket channel enqueue + write syscall. Intra-region
end-to-end p95 comfortably < 150 ms; typical < 50 ms. Metering adds one indexed
SELECT + atomic UPSERT (§11.3) — noise-level.

### 15.6 Control plane ceiling

4 sync gunicorn workers × 2 threads ≈ hundreds–low-thousands RPS depending on view
latency; scale knob is worker/replica count sized on request RPS — independent of
socket count by construction.

---

## 16. Failure Modes and Effects Analysis

| Component failure | Detection | Impact (current) | Mitigation in place | Residual risk / planned |
|---|---|---|---|---|
| Django pod crash | compose/k8s healthcheck `/api/health/` | Writes unavailable; sockets unaffected | Restart policy; gunicorn max-requests recycling; stateless replicas | Standard HA (multi-host) out of scope v1 |
| Go node kill -9 | healthcheck `/health`; clients reconnect | Local sockets drop; clients reconcile; other nodes fine | Statelessness ⇒ zero blast-radius propagation; graceful shutdown for planned stops | Crash-stale presence (W4); event gap on restart (W3) |
| Redis primary loss | `/health` redis probe → unhealthy | Fan-out frozen; presence frozen; REST fine | Clients refetch (reconciliation path); node-local presence fallback | Sentinel HA (W2) |
| Postgres primary loss | `/api/health/` DB probe | Writes fail-fast; realtime continues for in-memory sockets until next publish attempt | Backup/restore ops | Managed PG/failover recommended for prod |
| nginx loss | External monitoring | Both planes unreachable despite being healthy | restart: always; keepalive upstreams | Redundant LB pair for prod |
| Slow/stalled consumer | None needed — contained | Only that socket loses frames | Per-socket buffer cap 256; drops logged; node never blocks (§8.4) | Client-side gap detection triggers refetch |
| Poison event (bad envelope) | Subscriber error log | Dispatch abort risk | Handler-level recovery; malformed payloads logged not fatal | Schema versioning field in envelopes (future) |
| Secret compromise | Audit/alerting (Sentry optional) | JWT forgery possible platform-wide | Fail-fast secret checks; rotation runbook | Keyed rotation epochs (future work) |

---

## 17. Operations: SLOs, Observability, Deployment

### 17.1 Proposed SLOs

| SLI | SLO | Measured via |
|---|---|---|
| Fan-out latency p95 | < 150 ms intra-region | Publish-timestamp → client-echo instrumentation (planned) |
| API availability | 99.9% monthly | Health probes + LB metrics |
| Write durability | 100% acked writes survive crash | By construction (§13.1); verified in chaos drills |
| Realtime delivery while online | ≥ 99% | Producer-ledger vs delivered-set counters (W3 shadow phase yields this free) |
| Presence accuracy | ≥ 99%, stale ≤ 90 s | Sweeper diff metrics (W4) |

Current honesty: instrumentation beyond health endpoints and optional Sentry is thin;
SLO measurement is itself part of the roadmap (per-node stats exposure, L4-adjacent).

### 17.2 Deployment topology

Compose services on private bridge network: postgres:16 (512 MB cap, pg_isready
healthcheck), redis:7 (AOF, 256 MB, LRU), backend (migrate→collectstatic→gunicorn
4×2 workers, max-requests 1000/jitter 50; curl healthcheck), websocket (shares REDIS_URL
DB 1 + JWT_SECRET=SECRET_KEY; wget healthcheck), nginx (repo config mounted; serves SPA +
static/media volumes; proxies `/api|/admin` and `/ws` upgrade). Resource limits declared
per service; static assets via WhiteNoise compressed-manifest storage in-image.

---

## 18. Testing Strategy

Tests live next to code. Current suites: Django app tests (`accounts/tests.py`,
`messaging/tests.py` — auth, groups, messages, workspaces, metering, quotas),
Go handler tests (`websocket_test.go` — subprotocol extraction, origin rules), widget
logic tests (`dms-chat.test.js` — config validation, escaping). Philosophy: business
rules and security boundaries unit-tested where they live; integration verified against
compose stack.

Planned (tied to hardening waves): two-manager miniredis integration test (W1),
failover drill automation (W2), producer-ledger reconciliation under kill -9 (W3),
multi-node presence soak (W4) — collectively the chaos matrix in
[HARDENING_PLAN.md §Chaos drills](HARDENING_PLAN.md).

---

## 19. Conclusion

DMS demonstrates that the control-plane/data-plane split is more than aesthetics: it
lets each subsystem be chosen for what it is good at — Django's ecosystem for
trustworthy business logic, Go's runtime for connection economics — while a thin Redis
contract keeps them independently scalable. Its defining property is disciplined
statelessness: nodes hold nothing global, presence lives in one Redis structure, truth
lives in Postgres through Django alone. That discipline makes "just add replicas" a
true statement about the WebSocket tier and gives fan-out its O(nodes) cost curve.

Equally deliberate are the edges, stated rather than hidden: metering fails open for
delivery but closed for billing abuse; encryption is framed as server-assisted, not
E2EE; delivery semantics are durable-once persistence beneath an at-most-once realtime
overlay reconciled by refetch — and four named gaps (targeted-event locality, broker
single-point-of-failure, no replay, presence staleness) each carry an engineered fix
with rollout strategy. The growth path — republished targeted events, TTL'd presence,
Sentinel HA, Streams-based durable fan-out — requires no architectural reversal, only
incremental refinement executed in dependency order.

The deeper lesson generalizes: distributed correctness in such systems is bought not
with exotic machinery but with **explicit contracts** — who owns state, which
guarantees live where, what happens when each wire is cut. This thesis is, ultimately,
those contracts written down.

---

*Companion documents:* [`docs/HARDENING_PLAN.md`](HARDENING_PLAN.md) (gap remediation
engineering) · [`docs/SCALING.md`](SCALING.md) (scaling authority, operations view) ·
[`docs/EMBED.md`](EMBED.md) (widget guide) · [`BACKEND_DOCUMENTATION.md`](../BACKEND_DOCUMENTATION.md)
(API reference) · [`CHANGELOG.md`](../CHANGELOG.md) (release history).
