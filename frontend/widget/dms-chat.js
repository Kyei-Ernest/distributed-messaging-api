/**
 * dms-chat.js — Zero-dependency embeddable messaging widget for the Distributed
 * Messaging System.
 *
 * Usage (any site, single <script> tag):
 *   <script src="https://your-host/dms-chat.js"></script>
 *   <script>
 *     window.DMSChat.init({
 *       container: '#chat-widget',
 *       apiBase:   'https://your-host/api',   // optional: defaults to same-origin /api
 *       wsUrl:     'wss://your-host/ws',
 *       chatType:  'group' | 'private',       // the conversation to render
 *       chatId:    '<uuid>',                  // group id, or the other party's user id
 *       token:     '<end-user jwt>',          // OR tokenProvider: () => Promise<string>
 *       userId:    '<current user id>',
 *       onMessage: (msg) => {},
 *       onError:   (err) => {},
 *     });
 *   </script>
 *
 * UMD-style: attaches `window.DMSChat` in a browser and exports pure helpers via
 * CommonJS so they can be unit-tested with Node. The JWT is sent to the WebSocket
 * via the Sec-WebSocket-Protocol subprotocol — never in the URL — so it cannot
 * leak into access logs.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DMSChat = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ----------------------------------------------------------------
    // Pure helpers (exported for unit testing; DOM-free)
    // ----------------------------------------------------------------

    var DEFAULTS = {
        apiBase: '/api',
        maxReconnectAttempts: 5,
        reconnectDelayMs: 3000,
        pageSize: 50,
    };

    function isPlainObject(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }

    /** Validate + normalize the init config, throwing on missing required fields. */
    function normalizeConfig(input) {
        if (!isPlainObject(input)) {
            throw new Error('dms-chat: init requires a config object.');
        }
        var cfg = {};
        var key;
        for (key in DEFAULTS) {
            if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
                cfg[key] = DEFAULTS[key];
            }
        }
        for (key in input) {
            if (Object.prototype.hasOwnProperty.call(input, key)) {
                cfg[key] = input[key];
            }
        }
        if (!cfg.container) {
            throw new Error('dms-chat: "container" is required.');
        }
        if ((!cfg.token || typeof cfg.token !== 'string') && typeof cfg.tokenProvider !== 'function') {
            throw new Error('dms-chat: "token" (string) or "tokenProvider" (function) is required.');
        }
        if (cfg.chatType !== 'group' && cfg.chatType !== 'private') {
            throw new Error('dms-chat: "chatType" must be "group" or "private".');
        }
        if (!cfg.chatId) {
            throw new Error('dms-chat: "chatId" is required.');
        }
        if (!cfg.userId) {
            throw new Error('dms-chat: "userId" is required.');
        }
        return cfg;
    }

    /** Headers for authenticated REST calls. */
    function authHeaders(token) {
        var headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers.Authorization = 'Bearer ' + token;
        }
        return headers;
    }

    /** Sec-WebSocket-Protocol subprotocols offered to the Go WS server. */
    function buildWsSubprotocols(token) {
        return ['chat', 'Bearer ' + (token || '')];
    }

    /** Parse raw WS frame payload(s) into an array of event objects. */
    function parseIncomingFrames(raw) {
        if (typeof raw !== 'string' || raw.trim().length === 0) {
            return [];
        }
        var results = [];
        var parts = raw.trim().split('\n');
        for (var i = 0; i < parts.length; i++) {
            var line = parts[i].trim();
            if (!line) {
                continue;
            }
            try {
                results.push(JSON.parse(line));
            } catch (e) {
                /* skip unparseable / unrelated frames */
            }
        }
        return results;
    }

    /** HTTP query params used to fetch conversation history. */
    function buildMessageQuery(chatType, chatId, pageSize) {
        var params = { page_size: String(pageSize || DEFAULTS.pageSize) };
        if (chatType === 'group') {
            params.group = chatId;
        } else {
            params.message_type = 'private';
            params.recipient = chatId;
        }
        return params;
    }

    /** Does a real-time event belong to the conversation we render? */
    function eventMatchesConversation(chatType, chatId, userId, event) {
        if (!event || !event.data) {
            return false;
        }
        var data = event.data;
        if (chatType === 'group') {
            return String(data.group_id) === String(chatId);
        }
        var sender = data.sender_id;
        var recipient = data.recipient_id;
        if (sender && recipient) {
            return (String(sender) === String(chatId) && String(recipient) === String(userId)) ||
                   (String(sender) === String(userId) && String(recipient) === String(chatId));
        }
        return String(sender) === String(chatId) || String(recipient) === String(chatId);
    }

    /** Escape untrusted content before injecting into the DOM. */
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ----------------------------------------------------------------
    // Browser-only rendering + connection logic
    // ----------------------------------------------------------------

    var browser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

    function injectStyles() {
        if (!browser || window.__dmsChatStylesInjected) {
            return;
        }
        window.__dmsChatStylesInjected = true;
        var style = document.createElement('style');
        style.textContent =
            '.dms-embed{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
            'display:flex;flex-direction:column;height:100%;max-height:520px;' +
            'min-height:320px;border:1px solid #d0d7de;border-radius:12px;overflow:hidden;' +
            'background:var(--dms-bg,#ffffff);color:var(--dms-fg,#1f2328);box-sizing:border-box;}' +
            '.dms-embed *{box-sizing:border-box;}' +
            '.dms-embed__header{padding:10px 14px;font-weight:600;border-bottom:1px solid #d0d7de;' +
            'background:var(--dms-header-bg,#f6f8fa);}' +
            '.dms-embed__list{flex:1;overflow-y:auto;padding:10px 14px;display:flex;' +
            'flex-direction:column;gap:6px;scrollbar-width:thin;}' +
            '.dms-embed__msg{align-self:flex-start;max-width:80%;padding:8px 11px;' +
            'border-radius:10px;background:var(--dms-msg-bg,#eef1f4);word-wrap:break-word;}' +
            '.dms-embed__msg--own{align-self:flex-end;background:var(--dms-own-bg,#0969da);' +
            'color:var(--dms-own-fg,#fff);}' +
            '.dms-embed__meta{font-size:11px;opacity:.7;margin-bottom:2px;}' +
            '.dms-embed__input{display:flex;gap:8px;padding:10px;border-top:1px solid #d0d7de;}' +
            '.dms-embed__input textarea{flex:1;resize:none;border:1px solid #d0d7de;' +
            'border-radius:8px;padding:8px 10px;font:inherit;background:var(--dms-bg,#fff);' +
            'color:var(--dms-fg,#1f2328);transition:border-color .12s ease,box-shadow .12s ease;}' +
            '.dms-embed__input textarea:focus{outline:none;border-color:var(--dms-btn,#0969da);' +
            'box-shadow:0 0 0 3px color-mix(in srgb,var(--dms-btn,#0969da) 25%,transparent);}' +
            '.dms-embed__input button{border:none;border-radius:8px;padding:0 16px;' +
            'background:var(--dms-btn,#0969da);color:#fff;font-weight:600;cursor:pointer;' +
            'transition:filter .12s ease,opacity .12s ease;}' +
            '.dms-embed__input button:hover:not(:disabled){filter:brightness(1.08);}' +
            '.dms-embed__input button:focus-visible{outline:2px solid var(--dms-btn,#0969da);' +
            'outline-offset:2px;}' +
            '.dms-embed__input button:disabled{opacity:.5;cursor:not-allowed;}' +
            '.dms-embed__status{font-size:11px;padding:2px 14px;color:#57606a;}' +
            '.dms-embed--dark{--dms-bg:#161b22;--dms-fg:#e6edf3;--dms-header-bg:#21262d;' +
            '--dms-msg-bg:#30363d;--dms-btn:#1f6feb;}' +
            '@media (prefers-reduced-motion: reduce){' +
            '.dms-embed *{transition-duration:.01ms !important;animation-duration:.01ms !important;}}';
        document.head.appendChild(style);
    }

    /** Resolve the auth token: a static string or the value of tokenProvider(). */
    function resolveToken(cfg) {
        if (typeof cfg.token === 'string') {
            return Promise.resolve(cfg.token);
        }
        return Promise.resolve(cfg.tokenProvider())
            .then(function (t) {
                if (typeof t !== 'string' || !t) {
                    throw new Error('dms-chat: tokenProvider() must resolve to a token string.');
                }
                return t;
            });
    }

    /** Small fetch wrapper that throws on non-2xx with a readable message. */
    function fetchJson(url, options) {
        return fetch(url, options).then(function (res) {
            return res.text().then(function (text) {
                var data = null;
                try {
                    data = text ? JSON.parse(text) : null;
                } catch (e) {
                    data = null;
                }
                if (!res.ok) {
                    var msg = (data && (data.detail || data.error)) || ('HTTP ' + res.status);
                    throw new Error(msg);
                }
                return data;
            });
        });
    }

    /** Build the DOM inside the target container for the widget. */
    function mount(cfg) {
        var container = document.querySelector(cfg.container);
        if (!container) {
            throw new Error('dms-chat: container "' + cfg.container + '" not found.');
        }

        injectStyles();
        container.innerHTML = '';
        container.classList.add('dms-embed');
        if (cfg.theme === 'dark') {
            container.classList.add('dms-embed--dark');
        }
        container.setAttribute('role', 'region');
        container.setAttribute('aria-label', cfg.title || 'Chat');

        var header = document.createElement('div');
        header.className = 'dms-embed__header';
        header.textContent = cfg.title || (cfg.chatType === 'group' ? 'Group chat' : 'Chat');

        var status = document.createElement('div');
        status.className = 'dms-embed__status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.textContent = 'Connecting...';

        var list = document.createElement('div');
        list.className = 'dms-embed__list';
        list.setAttribute('role', 'log');
        list.setAttribute('aria-live', 'polite');
        list.setAttribute('aria-label', 'Messages');

        var input = document.createElement('div');
        input.className = 'dms-embed__input';
        var textarea = document.createElement('textarea');
        textarea.placeholder = 'Type a message...';
        textarea.rows = 1;
        textarea.setAttribute('aria-label', 'Type a message');
        textarea.setAttribute('enterkeyhint', 'send');
        var sendBtn = document.createElement('button');
        sendBtn.type = 'button';
        sendBtn.textContent = 'Send';
        sendBtn.setAttribute('aria-label', 'Send message');

        input.appendChild(textarea);
        input.appendChild(sendBtn);
        container.appendChild(header);
        container.appendChild(status);
        container.appendChild(list);
        container.appendChild(input);

        var el = { header: header, status: status, list: list, textarea: textarea, sendBtn: sendBtn };
        return el;
    }

    /** Create a message bubble element (rendered with escaping). */
    function renderMessage(message, userId) {
        var isOwn = String(message.sender && message.sender.id ? message.sender.id : message.sender_id) === String(userId);
        var bubble = document.createElement('div');
        bubble.className = 'dms-embed__msg' + (isOwn ? ' dms-embed__msg--own' : '');

        var meta = document.createElement('div');
        meta.className = 'dms-embed__meta';
        meta.textContent = (message.sender && message.sender.username) || 'User';

        var text = document.createElement('div');
        text.textContent = message.content || '';

        bubble.appendChild(meta);
        bubble.appendChild(text);
        return bubble;
    }

    /** Append a bubble to the list and scroll into view. */
    function appendBubble(list, message, userId, onMessage) {
        var bubble = renderMessage(message, userId);
        list.appendChild(bubble);
        list.scrollTop = list.scrollHeight;
        if (typeof onMessage === 'function') {
            onMessage(message);
        }
    }

    function setStatus(statusEl, text) {
        if (statusEl) {
            statusEl.textContent = text;
        }
    }

    /** The full widget lifecycle: mount, load history, connect WS, send/recv. */
    function startEmbed(cfg) {
        var elements = mount(cfg);
        var state = { token: null, ws: null, reconnectAttempts: 0, destroyed: false };
        var historyLoaded = false;

        function loadHistory(token) {
            var qs = new URLSearchParams(buildMessageQuery(cfg.chatType, cfg.chatId, cfg.pageSize)).toString();
            var url = cfg.apiBase + '/messages/?' + qs;
            return fetchJson(url, { headers: authHeaders(token) }).then(function (data) {
                var results = (data && data.results) || (Array.isArray(data) ? data : []);
                elements.list.innerHTML = '';
                results.slice().reverse().forEach(function (m) {
                    appendBubble(elements.list, m, cfg.userId, null);
                });
                historyLoaded = true;
            });
        }

        function handleFrame(events) {
            events.forEach(function (event) {
                if (event.type === 'connected') {
                    setStatus(elements.status, 'Connected');
                    return;
                }
                if (event.type !== 'group_message' && event.type !== 'private_message') {
                    return;
                }
                if (!historyLoaded || !eventMatchesConversation(cfg.chatType, cfg.chatId, cfg.userId, event)) {
                    return;
                }
                var data = event.data || {};
                var msg = {
                    content: data.content,
                    sender_id: data.sender_id,
                    sender: { id: data.sender_id, username: data.sender_username },
                };
                appendBubble(elements.list, msg, cfg.userId, cfg.onMessage);
            });
        }

        function connect(token) {
            if (state.destroyed) {
                return;
            }
            setStatus(elements.status, 'Connecting...');
            var socket = new WebSocket(cfg.wsUrl, buildWsSubprotocols(token));
            state.ws = socket;
            socket.onopen = function () {
                state.reconnectAttempts = 0;
                if (cfg.chatType === 'group') {
                    socket.send(JSON.stringify({ type: 'subscribe_group', data: { group_id: cfg.chatId } }));
                }
            };
            socket.onmessage = function (ev) {
                handleFrame(parseIncomingFrames(ev.data));
            };
            socket.onerror = function () {
                setStatus(elements.status, 'Connection error');
            };
            socket.onclose = function () {
                setStatus(elements.status, 'Disconnected');
                scheduleReconnect(token);
            };
        }

        function scheduleReconnect(token) {
            if (state.destroyed) {
                return;
            }
            if (state.reconnectAttempts >= (cfg.maxReconnectAttempts || 0)) {
                setStatus(elements.status, 'Connection failed');
                return;
            }
            state.reconnectAttempts += 1;
            setStatus(elements.status, 'Reconnecting...');
            setTimeout(function () {
                if (!state.destroyed) {
                    connect(token);
                }
            }, cfg.reconnectDelayMs);
        }

        function send() {
            var text = elements.textarea.value.trim();
            if (!text || !state.token) {
                return;
            }
            var payload = { content: text };
            if (cfg.chatType === 'group') {
                payload.message_type = 'group';
                payload.group = cfg.chatId;
            } else {
                payload.message_type = 'private';
                payload.recipient_id = cfg.chatId;
            }
            elements.textarea.value = '';
            syncSendButton();
            fetchJson(cfg.apiBase + '/messages/', {
                method: 'POST',
                headers: authHeaders(state.token),
                body: JSON.stringify(payload),
            }).then(function (saved) {
                if (saved && saved.id) {
                    appendBubble(elements.list, saved, cfg.userId, cfg.onMessage);
                }
            }).catch(function (err) {
                setStatus(elements.status, 'Send failed');
                if (cfg.onError) {
                    cfg.onError(err);
                }
            });
        }

        /** Enable Send only when there is something to send. */
        function syncSendButton() {
            elements.sendBtn.disabled = elements.textarea.value.trim().length === 0;
        }

        elements.sendBtn.addEventListener('click', send);
        elements.textarea.addEventListener('input', syncSendButton);
        syncSendButton();

        // Enter sends; Shift+Enter inserts a newline; Escape dismisses the keyboard.
        elements.textarea.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
            } else if (e.key === 'Escape') {
                elements.textarea.blur();
            }
        });

        return resolveToken(cfg)
            .then(function (token) {
                state.token = token;
                return loadHistory(token);
            })
            .then(function () {
                if (!state.destroyed) {
                    connect(state.token);
                }
                return {
                    destroy: function () {
                        state.destroyed = true;
                        if (state.ws) {
                            state.ws.close();
                        }
                    },
                    send: send,
                };
            })
            .catch(function (err) {
                setStatus(elements.status, 'Failed to initialize');
                if (cfg.onError) {
                    cfg.onError(err);
                }
                return null;
            });
    }

    function init(cfg) {
        if (!browser) {
            return Promise.reject(new Error('dms-chat: init() requires a browser environment.'));
        }
        var normalized = normalizeConfig(cfg);
        return startEmbed(normalized);
    }

    return {
        version: '2.0.0',
        DEFAULTS: DEFAULTS,
        normalizeConfig: normalizeConfig,
        authHeaders: authHeaders,
        buildWsSubprotocols: buildWsSubprotocols,
        parseIncomingFrames: parseIncomingFrames,
        buildMessageQuery: buildMessageQuery,
        eventMatchesConversation: eventMatchesConversation,
        escapeHtml: escapeHtml,
        init: init,
    };
});