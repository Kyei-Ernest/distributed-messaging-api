# Integrating DMS Into Your System (Plug and Play)

Add real-time chat to your product in **~5 minutes** without touching this
codebase. You talk to the platform over three surfaces:

| Surface | Auth | What you get |
|---|---|---|
| REST API | Workspace API key (`X-Workspace-ID` / `X-Workspace-Key`) | Provision users/groups, check usage, manage webhooks |
| Embeddable widget | End-user JWTs | Full chat UI inside your app, zero dependencies |
| Webhooks | HMAC-SHA256 signature | `message_created` events pushed to your backend |

---

## 0. Run the platform

```bash
docker compose up --build      # postgres, redis, api, websocket, nginx
# or for development: see README "Getting Started"
```

## 1. Bootstrap your tenant (one command)

```bash
python manage.py bootstrap_workspace \
    --name "Acme Support" \
    --daily-quota 1000 \
    --origin https://app.acme.com
```

Output (keep these safe):

```
Workspace ID : 7c9e...        # your X-Workspace-ID
API key      : whs_...        # your X-Workspace-Key (shown ONCE, stored hashed)
Allowed origins: https://app.acme.com   # per-tenant CORS, no redeploy needed
```

Prefer API? `POST /api/workspaces/` (admin auth) returns the key once; rotate
anytime with `POST /api/workspaces/{id}/regenerate-key/`.

## 2. Provision users and channels (server-to-server)

From *your* backend, with the key from step 1:

```bash
curl -X POST https://your-dms-host/api/provision/users/ \
  -H "X-Workspace-ID: $WS_ID" -H "X-Workspace-Key: $WS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "email": "alice@acme.com", "password": "•••"}'

curl -X POST https://your-dms-host/api/provision/groups/ \
  -H "X-Workspace-ID: $WS_ID" -H "X-Workspace-Key: $WS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "support-room", "owner_id": "<alice-id>"}'
```

Everything created is scoped to your workspace — invisible to other tenants.

## 3. Mint a JWT for the embedding user

Log the user in against the platform (or do it server-to-server via your own
session flow calling `/api/auth/login/`), then pass a short-lived token to the
widget through `tokenProvider` so no long-lived secret touches your page.

## 4. Drop in the widget

```html
<script src="https://your-dms-host/static/dms-chat.js"></script>
<div id="chat"></div>
<script>
  window.DMSChat.init({
    container: '#chat',
    wsUrl:     'ws://your-dms-host/ws',          // wss:// in production
    chatType:  'group',
    chatId:    '<group-id>',
    userId:    '<alice-id>',
    tokenProvider: () => fetch('/your-backend/dms-token') // mints fresh JWTs
                       .then(r => r.text()),
    theme: 'auto',
  });
</script>
```

React? Use `frontend/widget/react`. Full config reference: [`EMBED.md`](EMBED.md).

## 5. Receive events in your backend

Subscribe a webhook once:

```bash
curl -X POST https://your-dms-host/api/webhooks/ \
  -H "X-Workspace-ID: $WS_ID" -H "X-Workspace-Key: $WS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://api.acme.com/dms-events", "events": ["message_created"]}'
```

The response contains your signing secret **once**. Verify deliveries:

```python
import hmac, hashlib

def verify(secret: str, timestamp: str, signature_header: str, raw_body: bytes) -> bool:
    expected = hmac.new(secret.encode(),
                        f"{timestamp}.".encode() + raw_body,
                        hashlib.sha256).hexdigest()
    return hmac.compare_digest("sha256=" + expected, signature_header)
```

Headers on every delivery: `X-DMS-Signature`, `X-DMS-Timestamp`,
`X-DMS-Event`. Test-fire with `POST /api/webhooks/{id}/test/`.

## 6. Watch usage & quotas

```bash
curl https://your-dms-host/api/workspaces/$WS_ID/usage/ ...admin auth...
```

Set/change quotas and origins anytime:
`PATCH /api/workspaces/{id}/` (`message_quota`) ·
`PUT /api/workspaces/{id}/origins/` (`allowed_origins`).

---

## Which integration style fits me?

| Your situation | Recommended path |
|---|---|
| Separate SaaS product, want chat inside it | Steps 1–5 above (hosted/self-hosted DMS) |
| Greenfield Django project wanting messaging built-in | Mount the apps — see below |
| Existing Django project with its own User model | Integrate via API/widget/webhooks only (the custom UUID `User` requires setting `AUTH_USER_MODEL` before an app's first migrate) |

### Mounting into another Django project (greenfield)

1. Copy `accounts/`, `messaging/` into your project (or add as path deps).
2. `INSTALLED_APPS += ['rest_framework', 'corsheaders', 'accounts', 'messaging']`.
3. Set `AUTH_USER_MODEL = 'accounts.User'` **before** the first migration.
4. Merge settings blocks from `config/settings.py` (JWT, throttles, Redis cache).
5. Include URLs: `path('api/', include('accounts.urls'))`,
   `path('api/', include('messaging.urls'))`.

---

## Guarantees & limits

- **Tenant isolation** — every queryset is workspace-scoped; NULL-workspace data is legacy single-tenant mode.
- **Metering can't break messaging** — quota checks and usage counters are fail-open for delivery, enforced only at send time when a quota is configured.
- **Webhooks are best-effort** — at-least-once intent, at-most-once guarantee today; verify state via the REST API when it matters. Delivery failures are logged server-side.
- **Secrets shown once** — API keys are stored hashed; webhook secrets are stored retrievably (needed for signing) — treat them like credentials and rotate by recreating subscriptions.
