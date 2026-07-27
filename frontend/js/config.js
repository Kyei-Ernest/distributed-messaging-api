// Detect environment based on hostname
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// In production (behind Nginx), derive API/WS URLs from the current location.
// In local development, use explicit dev server ports.
const CONFIG = {
    API_BASE_URL: isLocal
        ? 'http://127.0.0.1:8000/api'
        : `${window.location.protocol}//${window.location.host}/api`,
    WS_URL: isLocal
        ? 'ws://127.0.0.1:8001/ws'
        : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
    TOKEN_KEY: 'auth_token',
    REFRESH_TOKEN_KEY: 'refresh_token',
    USER_KEY: 'current_user'
};