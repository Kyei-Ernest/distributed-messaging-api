/**
 * ============================================================================
 * Theme & Settings Features
 * ============================================================================
 */

// Theme Manager — light | dark | auto (follows OS, FOUC-safe via inline head script)
class ThemeManager {
    constructor() {
        this.theme = localStorage.getItem('theme');
        if (!this.theme || this.theme === 'null') this.theme = 'auto';
        this.media = window.matchMedia('(prefers-color-scheme: dark)');
        this.media.addEventListener('change', () => {
            if (this.theme === 'auto') this.applyTheme('auto');
        });
        this.init();
    }

    init() {
        this.applyTheme(this.theme);
        document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggle());
        document.getElementById('theme-select')?.addEventListener('change', (e) => this.setTheme(e.target.value));
        const select = document.getElementById('theme-select');
        if (select) select.value = this.theme;
        // Publish to the reactive store so any UI can react without polling.
        if (window.AppStore) AppStore.set('ui', 'theme', this.theme);
    }

    toggle() {
        const current = this.resolve();
        this.setTheme(current === 'light' ? 'dark' : 'light');
    }

    setTheme(theme) {
        this.theme = theme;
        localStorage.setItem('theme', theme);
        this.applyTheme(theme);
        const select = document.getElementById('theme-select');
        if (select) select.value = theme;
        if (window.AppStore) AppStore.set('ui', 'theme', theme);
    }

    /** Resolve 'auto' against the OS preference. */
    resolve() {
        return this.theme === 'auto'
            ? (this.media.matches ? 'dark' : 'light')
            : this.theme;
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', this.resolve());
        // Sync <meta name="theme-color"> with the resolved scheme.
        document.querySelector('meta[name="theme-color"]:not([media])')
            ?.setAttribute('content', this.resolve() === 'dark' ? '#09090b' : '#f0f2f5');
        const dark = this.resolve() === 'dark';
        document.querySelectorAll('.sun-icon').forEach(el => el.classList.toggle('hidden', dark));
        document.querySelectorAll('.moon-icon').forEach(el => el.classList.toggle('hidden', !dark));
    }
}

// Settings Manager
class SettingsManager {
    constructor() {
        this.settings = this.loadSettings();
        this.init();
    }

    init() {
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });
        document.getElementById('settings-btn')?.addEventListener('click', () => {
            document.getElementById('settings-modal').classList.add('show');
        });
    }

    switchTab(tabName) {
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        document.querySelectorAll('.settings-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `${tabName}-panel`);
        });
    }

    loadSettings() {
        const defaults = {
            theme: 'light',
            enterToSend: true,
            desktopNotifications: true,
            soundNotifications: true,
            messagePreview: true,
            showLastSeen: true,
            readReceipts: true,
            typingIndicator: true
        };
        const saved = localStorage.getItem('user_settings');
        return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    }

    saveSettings() { localStorage.setItem('user_settings', JSON.stringify(this.settings)); }
    get(key) { return this.settings[key]; }
    set(key, value) { this.settings[key] = value; this.saveSettings(); }
}

// Notification Manager
class NotificationManager {
    constructor() {
        this.permission = Notification.permission;
    }

    async requestPermission() {
        if (this.permission === 'default' && 'Notification' in window) {
            this.permission = await Notification.requestPermission();
        }
        return this.permission === 'granted';
    }

    show(title, options = {}) {
        if (this.permission === 'granted' && !document.hasFocus()) {
            const notification = new Notification(title, { icon: '/icon.svg', badge: '/icon.svg', ...options });
            notification.onclick = () => { window.focus(); notification.close(); };
            return notification;
        }
    }

    showMessageNotification(message) {
        return this.show(`New message from ${message.sender_username}`, {
            body: message.content,
            tag: message.id,
            icon: '/icon.svg'
        });
    }
}

console.log('✅ Theme & Settings loaded');
