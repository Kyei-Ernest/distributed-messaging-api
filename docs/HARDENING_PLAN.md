# Distributed Hardening Plan

Closing the four gaps documented in [`SCALING.md`](SCALING.md) ("Honest remaining
limits", L1–L4). Each workstream states the problem with code references, a chosen
design (with rejected alternatives), concrete change sketches, rollout strategy,
acceptance criteria, and effort. Suggested execution order: **W1 → W4 → W2 → W3**
(dependency rationale in §5).

---

## W1 — Cross-node targeted events (fixes L1)

### Problem

Client-originated targeted events route only on the receiving node:

- `manager/connection.go:867` `handleTypingIndicator` → `cm.SendToUser(...)` local-only
- `manager/connection.go:904` `handleMarkRead` → `cm.routeReadEvent(...)` local-only

A typist on node A cannot reach a reader on node B; read receipts likewise stay local.
The REST→Redis path (`messaging/views.py` publish) is already cross-node correct — the
gap is only in the raw-WS shortcut path.

### Design (chosen): republish over the existing Redis channel

Go nodes gain *publish* rights on `messaging_events`. Client-targeted events are
enveloped and published; **every** node — including the originator — receives them via
the existing `HandleRedisMessage` dispatch and routes to locally-held targets.

Envelope additions:

```json
{ "type": "typing_indicator",
  "event_id": "uuid-v4",          // client-side dedup
  "origin_node": "ws-3f2a...",    // echo suppression for originator-sensitive types
  "data": { ... } }
```

Rejected alternatives:

| Alternative | Why rejected |
|---|---|
| Dedicated second channel | Splits subscription loops for zero benefit; one channel keeps dispatch unified |
| Deprecate raw-WS mark_read, force REST | Works, but typing needs sub-100 ms feel; forcing every keystroke through Django+DB is wasteful |

### Change sketch

```go
// manager/connection.go — after fix
func (c *Client) handleTypingIndicator(data map[string]interface{}) {
    c.Manager.Publish(models.OutgoingMessage{
        Type:       models.EventTypingIndicator,
        ID:         newEventID(),
        OriginNode: cfg.NodeID,
        Data:       data,
    }) // HandleRedisMessage already fans out to local recipients on all nodes
}
```

Echo suppression: `HandleRedisMessage` skips routing an event to its origin when
`origin_node == self` **and** the event type is self-echo-sensitive (today's
`echoToReader` logic in `routeReadEvent:250` migrates here).

Config: new `NODE_ID` env (hostname fallback) + `CLIENT_EVENTS_VIA_REDIS` flag.

### Rollout

1. Ship publish path behind flag (default off) — behavior unchanged.
2. Enable in staging; add integration test: two managers over one miniredis instance,
   assert typing/read receipt crosses nodes exactly once per target.
3. Flip default on; delete legacy direct-routing branch after one release.

**Acceptance:** two-node docker-compose test shows cross-node typing + read receipts;
no duplicate events observed by any single client across 10k-event soak.
**Effort:** 2–3 days including tests. **Risk:** low (additive, reversible).

---

## W2 — Redis high availability (fixes L2)

### Problem

One Redis instance carries the event bus **and** presence (`online_users`). Its loss
silently freezes fan-out and corrupts presence truth until manual restart. Both planes
point at logical DB `1` — failover must preserve that.

### Design (chosen): Sentinel (1 primary + 1 replica, quorum 3)

| Option | Verdict |
|---|---|
| **Sentinel** | Chosen — automatic failover, minimal ops, pub/sub semantics preserved on promotion |
| Cluster | Rejected — sharding adds nothing at this event volume; pub/sub across cluster slots complicates broadcast |
| Managed (ElastiCache/Upstash) | Endorse for production SaaS; self-hosted Sentinel is the OSS default |

### Changes

Compose additions:

```yaml
redis-primary:  # existing redis service renamed; appendonly yes
redis-replica:  # replicaof redis-primary 6379
sentinel-1..3:  # sentinel monitor dms-master redis-primary 6379 2
```

Django (`config/settings.py`) — django-redis sentinel pool:

```python
CACHES["default"]["LOCATION"] = "dms-master"  # master name
CACHES["default"]["OPTIONS"].update({
    "CONNECTION_POOL_CLASS": "django_redis.pool.SentinelConnectionPool",
    "CONNECTION_POOL_KWARGS": {
        "master_name": "dms-master",
        "sentinel_instances": SENTINELS_CSV,   # host:26379 triples
        "db": 1,
    },
})
```

Go (`pubsub/redis.go`) — go-redis v9 failover client:

```go
client := redis.NewFailoverClient(&redis.FailoverOptions{
    MasterName:    cfg.RedisMasterName,
    SentinelAddrs: cfg.SentinelAddrs,
    DB:            1, // invariant: both planes stay on DB 1
})
```

Degradation contract (documented behavior during quorum loss):
- Existing WebSocket connections keep serving reads from node-local fallback presence.
- New fan-out events are **not queued** (at-most-once retained); clients reconcile via
  REST pagination as today.
- `/health` reports `degraded`, not `unhealthy`, so orchestrators don't thrash restarts.

### Acceptance / drill

Kill redis-primary under load; assert: sentinel promotes < 10 s, both planes resume
publish/subscribe without restart, zero message loss beyond in-flight window,
presence set intact post-promotion.

**Effort:** ~2 days + one failover drill. **Risk:** medium (config surface grows;
mitigated by compose-managed defaults).

---

## W3 — Durable fan-out via Redis Streams (fixes L3)

### Problem

Pub/Sub is fire-and-forget: events published while a node is restarting/deploying are
lost to that node's clients until they refetch. No replay, no acks, no lag visibility.

### Scope honesty

Streams buy **at-least-once delivery to nodes**, enabling zero-loss rolling deploys and
node crash catch-up. Device-level offline delivery still reconciles through REST
history — that remains true and intentional (mobile push is separate roadmap).

### Topology

```
stream  dms:events                       (XADD by Django & Go publishers)
groups  node:{NODE_ID}  per Go node      (each group receives every entry)
read    XREADGROUP GROUP g $ BLOCK 5000 COUNT 64
ack     XACK after per-client sends are enqueued
reclaim XAUTOCLAIM min-idle-time 30s      (dead consumer takeover)
trim    XTRIM dms:events MAXLEN ~ 500000  (~hours of headroom at peak rate)
```

Per-node groups give broadcast semantics (every group sees every entry) while group
bookkeeping survives node restarts — last-delivered-ID resumes where the node died.

### Migration (dual-write shadow phase)

1. Producers write **both** Pub/Sub and stream behind `STREAM_FANOUT=shadow`; stream
   consumers run dark comparing delivered-set equality (metrics counter).
2. Switch consumers to stream; keep Pub/Sub emitting for one release (rollback path).
3. Retire Pub/Sub publisher; document ordering upgrade: a single stream imposes total
   order on events — strictly stronger than today's multi-worker interleaving.

Idempotency: producers stamp `event_id`; clients keep an LRU of the last ~200 ids and
drop duplicates (at-least-once ⇒ exactly-once *effect*).

### Acceptance

Chaos test: `kill -9` a node mid-fanout under 1k msg/s → restarted node replays gap
via group history; zero lost events verified against producer-side ledger; p95 added
fan-out latency ≤ +15 ms vs Pub/Sub baseline.

**Effort:** ~1 week including load tests. **Risk:** medium — memory sizing for stream
retention must be budgeted (entry ≈ payload + ~100 B overhead; 500k entries × ~600 B
≈ 300 MB worst case → tune MAXLEN or move to `MINID` time-based trim).

---

## W4 — Presence with TTL and sweeper (fixes L4, plus latent multi-device bug)

### Problem

`online_users` is a plain SET with `SREM` only on clean disconnect:

- Crash-stale entries linger until node restart (`SCALING.md` L4).
- **Latent bug found during planning:** with a user connected to two nodes (two tabs /
  devices), any *single* disconnect's `SREM` marks them globally offline while the
  sibling connection lives on — false negatives under normal operation once replicas
  exist.

### Design (chosen): per-node connection hashes with TTL + derived global set

```
presence:node:{NODE_ID}   HASH connID → userID     TTL 90 s
```

- Refreshed by each node every ping tick (54 s < TTL 90 s ⇒ one missed tick tolerated).
- Node crash ⇒ hash expires within ≤ 90 s automatically — ghosts self-heal, no sweeper
  *required* for correctness.
- Derived `online_users` SET rebuilt periodically (30 s job): scan all
  `presence:node:*` hashes, rebuild membership, diff-and-write. Reads remain O(1)
  against the set; multi-device correct (offline ⇔ zero connIDs map to user).
- Graceful shutdown: `DEL presence:node:{id}` for instant cleanup.

Rejected alternative: sorted-set scored by expiry timestamp — workable, but forces
`ZREMRANGEBYSCORE` before every read and mixes write-amplification into hot paths;
hash-per-node keeps refresh O(1) and blast radius per node.

### Acceptance

Multi-node test: same user on nodes A+B, kill -9 A → user stays online via B, ghost
gone ≤ 90 s; clean shutdown of A → immediate; soak shows zero flapping.

**Effort:** 2–3 days. **Risk:** low.

---

## Execution order and dependency graph

```
W1 ────────────────┐
                   ├─► observable cross-node correctness on current broker
W4 ────────────────┘
        │
W2 (Sentinel HA) ──► broker survives failure before we raise its criticality
        │
W3 (Streams) ──────► durability lands on top of an HA broker it depends on
```

Rationale: W1/W4 are independent correctness fixes shippable immediately on today's
single Redis. W2 hardens the broker *before* W3 makes it stateful-critical (a stream
with retention is worse to lose than a firehose). W3 last because shadow-phase
comparison is only meaningful once failovers (W2 drills) are routine.

## Chaos drill matrix (post-hardening regression suite)

| Drill | Inject | Assert |
|---|---|---|
| Node kill | `kill -9` websocket under load | No lost events (W3), presence heals ≤ 90 s (W4) |
| Broker kill | stop redis-primary | Failover < 10 s (W2), degraded-not-dead health |
| Partition | iptables-drop node↔redis 60 s | Clients reconcile via REST; no crash-loop |
| Rolling deploy | restart all nodes sequentially | Zero-downtime fan-out (W3 replay) |
| Slow consumer | stall one socket's reads | Node throughput unaffected (existing backpressure) |
