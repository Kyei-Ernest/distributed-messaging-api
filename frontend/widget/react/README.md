# @dms/chat-react

React SDK for the Distributed Messaging embeddable chat widget.

This is a thin React wrapper over the zero-dependency vanilla widget in
`frontend/widget/dms-chat.js`. The vanilla script must be available on `window`
(from your HTML `<head>` or the bundled `dms-chat` package).

## Quick start

```jsx
import ChatWidget from '@dms/chat-react';

export function SupportChat({ currentUser, jwt }) {
  return (
    <div style={{ height: '420px' }}>
      <ChatWidget
        apiBase="https://chat.example.com/api"
        wsUrl="wss://chat.example.com/ws"
        chatType="group"
        chatId="support-room"
        userId={currentUser.id}
        token={jwt}
        containerId="support-chat"
        title="Support"
      />
    </div>
  );
}
```

## Props

Mirror the [embed config](../EMBED.md): `apiBase`, `wsUrl`, `chatType`
(`'group' | 'private'`), `chatId`, `userId`, plus either `token` (string) or
`tokenProvider` (`() => Promise<string>`), and optional `theme`, `title`,
`onMessage`, `onError`. `containerId` must be unique per mounted widget.

> Framework SDKs (React first) are the embeddable-product layer; the underlying
> transport and auth are provided by the vanilla widget and the Go/Django backend.