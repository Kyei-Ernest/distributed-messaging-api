/**
 * DMS Service Worker — offline app shell + smart caching.
 *
 * Strategy:
 * - Static shell & assets: cache-first (instant loads, versioned busting)
 * - API GETs: network-first with cache fallback (fresh when online, usable offline)
 * - API mutations: never cached
 *
 * Bump CACHE_VERSION on any static asset change to invalidate all caches.
 */
const CACHE_VERSION = 'dms-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const API_CACHE = `${CACHE_VERSION}-api`;

const SHELL_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './manifest.json',
    './icon.svg',
    './js/config.js',
    './js/api.js',
    './js/websocket.js',
    './js/core/EventBus.js',
    './js/core/store.js',
    './js/core/dom.js',
    './js/ui/core.js',
    './js/ui/lists.js',
    './js/ui/messages.js',
    './js/features/theme.js',
    './js/features/inputs.js',
    './js/features/media.js',
    './js/features/context-menu.js',
    './js/features/reactions.js',
    './js/features/voice.js',
    './js/features/themes.js',
    './js/features/init.js',
    './js/sidebar-resize.js',
    './js/search-overlay.js',
    './js/modules/auth/AuthManager.js',
    './js/modules/navigation/NavigationManager.js',
    './js/modules/chat/ChatManager.js',
    './js/modules/groups/GroupManager.js',
    './js/modules/users/UserManager.js',
    './js/modules/messages/MessageHandler.js',
    './js/modules/websocket/WebSocketManager.js',
    './js/app.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => !key.startsWith(CACHE_VERSION))
                    .map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    // API: network-first, fall back to last good response.
    if (url.pathname.includes('/api/')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(API_CACHE).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Static: cache-first, then network (and backfill the cache).
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((response) => {
                if (response.ok && url.origin === self.location.origin) {
                    const clone = response.clone();
                    caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
                }
                return response;
            });
        })
    );
});
