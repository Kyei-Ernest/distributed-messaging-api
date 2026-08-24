# Changelog

All notable changes to the Distributed Messaging System are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Frontend overhaul (modern vanilla, no build step)**
  - Reactive core (`js/core/store.js`): signals, rAF-batched effects, computed values, localStorage-persisted slices, and a global `AppStore` state tree (ui/connection/presence/unread/typing).
  - DOM kit (`js/core/dom.js`): `h()` hyperscript builder, `renderList` keyed list reconciliation (no more wholesale `innerHTML` rebuilds), focus-trap helper for modals.
  - Accessibility: skip-link, ARIA tablist/tab/tabpanel on sidebar tabs, `role="log"` + `aria-live` message log, dialog semantics (`aria-modal`, labelled titles) on all four modals, live-region toasts/status pills, visible `:focus-visible` rings, full `prefers-reduced-motion` support.
  - Theming: new `auto` theme honoring OS preference with FOUC-free inline resolution, `<meta theme-color>` synced per scheme, sun/moon icon sync across desktop and mobile menus.
  - PWA: service worker (`sw.js`) — cache-first shell, network-first API with offline fallback, versioned cache busting; hardened manifest (id/scope/categories/maskable icon); removed anti-user viewport restrictions (`maximum-scale`/`user-scalable=no`).
  - Connection status pill now auto-hides once connected; store-backed connection state.
- **Widget v2** (`frontend/widget/dms-chat.js`): ARIA region/log/live-status semantics, labelled inputs, Enter-to-send (Shift+Enter newline, Escape blur), disabled-until-valid send button, dark-theme-aware input styling, reduced-motion support; zero-dependency contract and public API unchanged.
- **Distributed hardening documentation**
  - `docs/HARDENING_PLAN.md`: engineering designs to close the four scaling limits from `docs/SCALING.md` — cross-node targeted events (W1), Redis Sentinel HA (W2), durable fan-out via Redis Streams (W3), TTL-based presence with sweeper (W4, also fixes a latent multi-device false-offline bug) — each with rollout strategy, acceptance criteria, effort/risk, and a chaos drill matrix.
  - `THESIS.md` rewritten as a deep technical thesis: formal system/failure model, delivery-semantics contract (durable-once persistence + at-most-once realtime overlay with client reconciliation), replica-transparency argument, O(nodes) fan-out analysis, capacity model, FMEA, SLO framework.
- Server-to-server provisioning endpoints authenticated by workspace API key:
  - `POST /api/provision/users/` — create an end-user scoped to the authenticating workspace (`ProvisionUserView`).
  - `POST /api/provision/groups/` — create a workspace group (channel) owned by an existing workspace user, who becomes its admin (`ProvisionGroupView`).
- Per-workspace **daily message quota enforcement**: when a `Workspace.message_quota` is set, message creation is rejected with `403` once `WorkspaceDailyUsage` reaches the quota for the day.
- `AGENTS.md` local agent-instructions file (git-ignored; never distributed).

### Notes
- Provisioning endpoints complete the embeddable-widget story described in `docs/EMBED.md` §8: embedding apps can now provision users/channels server-to-server instead of relying on self-registration.

## [1.1.0] — 2026-08-16 — Security hardening, multi-tenant workspaces, widget & metering

Commit `05c8037` · 34 files changed, +2012 / −64

### Added
- **Multi-tenancy (workspaces)**
  - `Workspace` model: UUID PK, unique name, hashed API key (`issue_api_key`/`verify_api_key` via Django password hashers), optional `message_quota`.
  - `WorkspaceDailyUsage` model: daily per-workspace message counter (unique per workspace+date), incremented atomically with `F()` expressions.
  - `User.workspace` and `Group.workspace` foreign keys for tenant scoping; NULL workspace preserves legacy single-tenant behavior everywhere.
- **API-key authentication** (`accounts/authentication.py`)
  - `WorkspaceAPIAuthentication`: server-to-server auth via `X-Workspace-ID` + `X-Workspace-Key` headers.
  - `WorkspacePrincipal` lightweight principal; `current_workspace(request)` helper resolving tenant from API key or user membership.
  - `IsWorkspaceAPIKey` permission class.
- **Usage metering** (`messaging/signals.py`): `post_save` signal on `Message` increments the sender's workspace daily usage; failures are logged but never block messaging.
- **Embeddable chat widget** (`frontend/widget/dms-chat.js`, zero-dependency)
  - Group and private chat modes, light/dark themes, reconnection with backoff, HTML-escaped rendering.
  - React SDK wrapper (`frontend/widget/react/src/ChatWidget.jsx`) + README.
  - Widget unit tests (`dms-chat.test.js`, Node runner).
  - Embedding guide: `docs/EMBED.md`.
- **Scaling documentation**: `docs/SCALING.md` — multi-replica correctness story, presence via shared Redis set, honest remaining limits and remediation plans.
- Workspace management API (`WorkspaceViewSet`) including API-key issuance.
- Test suites: `accounts/tests.py`, `messaging/tests.py`, `websocket-server/handlers/websocket_test.go`.

### Changed
- Go WebSocket server:
  - JWT now extracted from `Sec-WebSocket-Protocol` subprotocol (never query string).
  - Origin allow-list enforced on the upgrader (CSWSH protection); non-browser clients without Origin still allowed.
  - Presence reads from shared Redis `online_users` set with node-local fallback.
- Django settings gained workspace-related configuration; docker-compose wiring updated.

## [1.0.0] — 2026-07-27 — Production-ready enhancements

Commit `c3b1289` · Initial public baseline of the platform

### Added
- **Core platform**
  - Django project (`config/`) with env-driven configuration via python-decouple.
  - `accounts` app: custom UUID-PK `User`, registration/login/logout/token-refresh, profile endpoints.
  - `messaging` app: `Group`, `GroupMember`, `Message` (group/private, replies, encryption fields), read receipts, reactions; REST viewsets with custom permission classes.
  - End-to-end-style encryption fields (AES-GCM payloads with per-recipient keys; public keys hosted per-user).
- **Go WebSocket data plane** (`websocket-server/`)
  - Gorilla-based WS server: upgrade+JWT validation, connection manager (channels), ReadPump/WritePump goroutines, ping/pong keepalive, graceful shutdown.
  - Redis Pub/Sub subscriber fanning out `group_message`, `private_message`, `user_joined/left/removed`, `member_promoted`, `message_deleted`, `message_read`, typing indicators.
  - Health endpoint probing Redis connectivity.
- **Frontend SPA** (`frontend/`)
  - Vanilla ES-module architecture: `core/EventBus.js`, modules for auth/chat/groups/messages/navigation/users, feature modules (reactions, media, voice, themes, context menus, inputs).
- **Infrastructure & ops**
  - Dockerfile (gunicorn) + `docker-compose.yml` (PostgreSQL 16, Redis 7, backend, websocket, nginx) with healthchecks and resource limits.
  - nginx reverse proxy: rate-limit zones, security headers, WebSocket `/ws` upgrade path.
  - `.env.example` / `.env.production.example`; Sentry integration (conditional on DSN).
  - Swagger/OpenAPI docs via drf-spectacular at `/api/docs/`.
  - Backend documentation (`BACKEND_DOCUMENTATION.md` + PDF), MIT License.

### Security
- Removed hardcoded secrets and ngrok domains; secrets sourced from environment only.
- Production fail-fast when `SECRET_KEY` is left as insecure default with `DEBUG=False`.

### Performance
- Eliminated N+1 queries in chat list and unread-count aggregation paths using aggregated ORM queries.

### Fixed
- `is_user_online` now queries the Redis `online_users` set instead of returning a stubbed `false`.

[Unreleased]: https://github.com/Kyei-Ernest/distributed-messaging/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Kyei-Ernest/distributed-messaging/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Kyei-Ernest/distributed-messaging/releases/tag/v1.0.0
