/**
 * ============================================================================
 * Theme & Settings Features
 * ============================================================================
 */

// Theme Manager
class ThemeManager {
    constructor() {
        this.theme = localStorage.getItem('theme') || 'light';
        this.init();
    }

    init() {
        this.applyTheme(this.theme);
        document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggle());
        document.getElementById('theme-select')?.addEventListener('change', (e) => this.setTheme(e.target.value));
    }

    toggle() {
        this.setTheme(this.theme === 'light' ? 'dark' : 'light');
    }

    setTheme(theme) {
        this.theme = theme;
        this.applyTheme(theme);
        localStorage.setItem('theme', theme);
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const sunIcon = document.querySelector('.sun-icon');
        const moonIcon = document.querySelector('.moon-icon');
        if (theme === 'dark') {
            sunIcon?.classList.add('hidden');
            moonIcon?.classList.remove('hidden');
        } else {
            sunIcon?.classList.remove('hidden');
            moonIcon?.classList.add('hidden');
        }
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
