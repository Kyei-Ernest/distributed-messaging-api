/**
 * ChatWidget — React wrapper around the vanilla `dms-chat.js` embed widget.
 *
 * The vanilla script must be loaded first (e.g. from your HTML <head> or via the
 * `dms-chat` package) so that `window.DMSChat` is available.
 *
 * Usage:
 *   <ChatWidget
 *     apiBase="https://chat.example.com/api"
 *     wsUrl="wss://chat.example.com/ws"
 *     chatType="group"
 *     chatId="<group-id>"
 *     userId="<current-user-id>"
 *     token={jwt}                      // or tokenProvider={() => Promise.resolve(jwt)}
 *     containerId="my-chat"
 *   />
 */
import { useEffect, useRef } from 'react';

export default function ChatWidget({
    apiBase,
    wsUrl,
    chatType,
    chatId,
    userId,
    token,
    tokenProvider,
    theme,
    title,
    containerId,
    onMessage,
    onError,
}) {
    const containerRef = useRef(null);
    const instanceRef = useRef(null);

    useEffect(() => {
        const root = (typeof window !== 'undefined') ? window.DMSChat : null;
        if (!root) {
            if (onError) {
                onError(new Error('dms-chat script is not loaded. Add <script src=".../dms-chat.js"></script>.'));
            }
            return undefined;
        }

        root.init({
            container: '#' + containerId,
            apiBase,
            wsUrl,
            chatType,
            chatId,
            userId,
            token,
            tokenProvider,
            theme,
            title,
            onMessage,
            onError,
        }).then((instance) => {
            instanceRef.current = instance;
        });

        // Re-init/destroy when the conversation or target container changes.
        return () => {
            if (instanceRef.current) {
                instanceRef.current.destroy();
                instanceRef.current = null;
            }
        };
    }, [containerId, chatId, chatType]);

    // Submit a message from the parent app (e.g. programmatic send).
    const send = (text) => {
        if (instanceRef.current && instanceRef.current.send) {
            instanceRef.current.send(text);
            return true;
        }
        return false;
    };

    // Expose the imperative `send` via a ref handle for advanced integrators.
    if (containerRef.current) {
        containerRef.current.send = send;
    }

    return <div id={containerId} ref={containerRef} style={{ height: '100%' }} />;
}