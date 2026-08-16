# Embedding the Chat Widget

The Distributed Messaging platform ships a **zero-dependency, embeddable chat
widget** (`frontend/widget/dms-chat.js`) that any website can drop in with a
single `<script>` tag to get a real-time conversation inside its own UI. This is
the embeddable "chat-as-a-service" surface of the platform.

## 1. Serve the widget

Host `frontend/widget/dms-chat.js` (and, optionally, bundle it with your build —
it has no dependencies). You can serve it from Django's static files, your CDN,
or your own origin.

```html
<script src="https://chat.example.com/static/dms-chat.js"></script>
```

## 2. Drop in a container and init

```html
<div id="chat-widget" style="height: 420px;"></div>
<script>
  window.DMSChat.init({
    container: '#chat-widget',
    apiBase:   'https://chat.example.com/api',   // optional: defaults to same-origin /api
    wsUrl:     'wss://chat.example.com/ws',
    chatType:  'group',                          // 'group' or 'private'
    chatId:    'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    userId:    'current-end-user-id',
    token:     'the-end-users-jwt',              // OR tokenProvider: () => Promise<string>
    theme:     'light',                          // optional: 'light' | 'dark'
    title:     'Support',
    onMessage: (msg) => { /* live message callback */ },
    onError:   (err) => { /* surface errors to your app */ },
  });
</script>
```

For **React**, use `frontend/widget/react` (see its README).

## 3. Config reference

| Option | Required | Description |
|--------|----------|-------------|
| `container` | yes | CSS selector for the element that will hold the widget. |
| `apiBase` | no | REST base URL (default `/api`, same-origin). |
| `wsUrl` | no | WebSocket URL (default derived from `apiBase`'s origin). |
| `chatType` | yes | `'group'` (a group room) or `'private'` (1:1 with a user). |
| `chatId` | yes | Group UUID, or the *other party's* user UUID. |
| `userId` | yes | The current authenticated end-user's UUID. |
| `token` | cond. | End-user JWT (static string). |
| `tokenProvider` | cond. | `() => Promise<string>` for fresh/short-lived tokens. |
| `theme` | no | `'light'` (default) or `'dark'`. |
| `title` | no | Widget header title. |
| `onMessage` | no | Called for each live/sent message bubble. |
| `onError` | no | Called with errors (config, init, send, WS). |
| `maxReconnectAttempts` | no | WS reconnect attempts (default 5). |
| `reconnectDelayMs` | no | Delay between reconnects (default 3000). |
| `pageSize` | no | History page size (default 50). |

## 4. Auth model (important)

- **End-user requests** are authenticated with the user's **JWT**. For group chat
  the user must be a group member; for private chat they must be the sender or the
  selected recipient — the backend enforces this, so the widget can never read a
  conversation the user cannot access.
- **Tenant isolation** is handled server-side via a user's *Workspace*. `userId`
  (and the `token` it maps to) determines which workspace the widget must see, and
  the backend scopes every query accordingly. The widget itself is tenant-agnostic.
- **`tokenProvider`** is the recommended pattern for production: it lets your
  server mint a short-lived user JWT on demand instead of exposing a long-lived one
  in the page. The widget re-requests the token on reconnect.

## 5. CORS and deployment

Configure the backend's `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` to include
the site that embeds the widget. If the widget and the API are on separate origins,
make sure:

- `CORS_ALLOWED_ORIGINS` includes the embedding site,
- the WebSocket origins allow-list includes the embedding site (Go server `CORS_ORIGIN_*`).

## 6. Security notes (by design)

- The JWT is sent to the WebSocket via the **`Sec-WebSocket-Protocol` subprotocol**
  — never in the URL — so it cannot leak into nginx/proxy access logs.
- Message content is rendered with HTML escaping; the widget never injects raw
  untrusted HTML.
- The widget is transport-only: it never stores tokens or messages persistently.

## 7. Testing

The widget's pure logic is covered by Node unit tests:

```sh
cd frontend/widget && node dms-chat.test.js
```

## 8. Roadmap for this surface

- Server-to-server provisioning endpoints (create workspace users/channels with the
  workspace API key, instead of relying on user self-registration).
- Metering/entitlements (per-workspace message/MAU quotas) tied to the Workspace model.
- More framework SDKs (Vue, Svelte) and prebuilt UI themes (launcher button, popover).