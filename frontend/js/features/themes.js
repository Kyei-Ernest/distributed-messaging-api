/**
 * ============================================================================
 * Chat Themes — Customize message bubble colors
 * ============================================================================
 */
class ChatThemes {
    constructor() {
        this.themes = {
            default: {
                bubble: 'var(--bg-panel)',
                ownBubble: 'var(--accent-primary)',
            },
            blue: {
                bubble: '#1a3a5c',
                ownBubble: '#1a73e8',
            },
            green: {
                bubble: '#1a3c2a',
                ownBubble: '#128c7e',
            },
            purple: {
                bubble: '#2a1a3c',
                ownBubble: '#7c3aed',
            },
            gray: {
                bubble: '#2a2a30',
                ownBubble: '#555560',
            }
        };
        this.init();
    }

    init() {
        this.loadSavedTheme();
        document.getElementById('chat-theme-select')?.addEventListener('change', (e) => {
            this.applyTheme(e.target.value);
        });
        // Set current theme in dropdown
        const saved = localStorage.getItem('chat_theme') || 'default';
        const select = document.getElementById('chat-theme-select');
        if (select) select.value = saved;
    }

    applyTheme(themeName) {
        const theme = this.themes[themeName] || this.themes.default;
        const root = document.documentElement;

        if (themeName === 'default') {
            root.style.removeProperty('--chat-received-bg');
            root.style.removeProperty('--chat-own-bg');
        } else {
            root.style.setProperty('--chat-received-bg', theme.bubble);
            root.style.setProperty('--chat-own-bg', theme.ownBubble);
        }

        localStorage.setItem('chat_theme', themeName);
    }

    loadSavedTheme() {
        const saved = localStorage.getItem('chat_theme');
        if (saved && saved !== 'default') {
            this.applyTheme(saved);
        }
    }

    getThemes() {
        return Object.keys(this.themes);
    }

    getThemeNames() {
        return {
            default: 'Default',
            blue: 'Blue',
            green: 'Green',
            purple: 'Purple',
            gray: 'Gray'
        };
    }
}
