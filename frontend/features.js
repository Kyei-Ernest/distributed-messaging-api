// ============================================================================
// FILE: features.js - Enhanced Features & Interactions
// ============================================================================

/**
 * Theme Management
 */
class ThemeManager {
    constructor() {
        this.theme = localStorage.getItem('theme') || 'light';
        this.init();
    }

    init() {
        this.applyTheme(this.theme);
        document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggle());
        document.getElementById('theme-select')?.addEventListener('change', (e) => {
            this.setTheme(e.target.value);
        });
    }

    toggle() {
        const newTheme = this.theme === 'light' ? 'dark' : 'light';
        this.setTheme(newTheme);
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

/**
 * Password Strength Checker
 */
class PasswordStrength {
    constructor(inputId) {
        this.input = document.getElementById(inputId);
        if (!this.input) return;
        
        this.strengthBar = this.input.closest('.form-group')?.querySelector('.strength-fill');
        this.strengthText = this.input.closest('.form-group')?.querySelector('.strength-text');
        
        this.input.addEventListener('input', () => this.checkStrength());
    }

    checkStrength() {
        const password = this.input.value;
        const strength = this.calculateStrength(password);
        
        if (this.strengthBar) {
            this.strengthBar.className = 'strength-fill';
            if (strength.score >= 4) {
                this.strengthBar.classList.add('strong');
                this.strengthText.textContent = 'Strong password';
            } else if (strength.score >= 2) {
                this.strengthBar.classList.add('medium');
                this.strengthText.textContent = 'Medium strength';
            } else if (password.length > 0) {
                this.strengthBar.classList.add('weak');
                this.strengthText.textContent = 'Weak password';
            } else {
                this.strengthText.textContent = 'Enter password';
            }
        }
    }

    calculateStrength(password) {
        let score = 0;
        
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
        if (/\d/.test(password)) score++;
        if (/[^a-zA-Z0-9]/.test(password)) score++;
        
        return { score };
    }
}

/**
 * Password Toggle Visibility
 */
class PasswordToggle {
    constructor() {
        document.querySelectorAll('.toggle-password').forEach(btn => {
            btn.addEventListener('click', () => this.toggle(btn));
        });
    }

    toggle(btn) {
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);
        const eyeIcon = btn.querySelector('.eye-icon');
        const eyeOffIcon = btn.querySelector('.eye-off-icon');
        
        if (input.type === 'password') {
            input.type = 'text';
            eyeIcon.classList.add('hidden');
            eyeOffIcon.classList.remove('hidden');
        } else {
            input.type = 'password';
            eyeIcon.classList.remove('hidden');
            eyeOffIcon.classList.add('hidden');
        }
    }
}

/**
 * Emoji Picker
 */
class EmojiPicker {
    constructor() {
        this.picker = document.getElementById('emoji-picker');
        this.grid = document.getElementById('emoji-grid');
        this.input = document.getElementById('message-input');
        this.button = document.getElementById('emoji-btn');
        
        if (!this.picker || !this.button) return;
        
        this.emojis = {
            smileys: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋'],
            people: ['👋', '🤚', '🖐', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍'],
            nature: ['🌸', '🌺', '🌻', '🌷', '🌹', '🥀', '💐', '🌾', '🌲', '🌳', '🌴', '🌵', '🌿', '☘️', '🍀', '🍁', '🍂', '🍃', '🪴', '🌍'],
            food: ['🍕', '🍔', '🍟', '🌭', '🍿', '🧈', '🧇', '🥞', '🧈', '🍖', '🍗', '🥩', '🥓', '🍔', '🍟', '🍕', '🌮', '🌯', '🥙', '🥪'],
            activities: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳'],
            travel: ['✈️', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥', '🛳', '⛴', '🚢', '⚓', '🪝', '⛽', '🚧', '🚦', '🚥', '🚏', '🗺', '🗿'],
            objects: ['💡', '🔦', '🏮', '🪔', '📱', '💻', '⌨️', '🖥', '🖨', '🖱', '🖲', '🕹', '🗜', '💾', '💿', '📀', '📼', '📷', '📸', '📹'],
            symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️']
        };
        
        this.init();
    }

    init() {
        this.button.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
        
        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!this.picker.contains(e.target) && e.target !== this.button) {
                this.close();
            }
        });
        
        // Category buttons
        document.querySelectorAll('.emoji-category').forEach(btn => {
            btn.addEventListener('click', () => this.showCategory(btn.dataset.category));
        });
        
        // Load default category
        this.showCategory('smileys');
    }

    toggle() {
        this.picker.classList.toggle('hidden');
        if (!this.picker.classList.contains('hidden')) {
            this.position();
        }
    }

    close() {
        this.picker.classList.add('hidden');
    }

    position() {
        const buttonRect = this.button.getBoundingClientRect();
        const pickerRect = this.picker.getBoundingClientRect();
        
        this.picker.style.bottom = `${window.innerHeight - buttonRect.top + 8}px`;
        this.picker.style.right = `${window.innerWidth - buttonRect.right}px`;
    }

    showCategory(category) {
        // Update active button
        document.querySelectorAll('.emoji-category').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.category === category);
        });
        
        // Render emojis
        this.grid.innerHTML = this.emojis[category]
            .map(emoji => `<button class="emoji-item" type="button">${emoji}</button>`)
            .join('');
        
        // Add click handlers
        this.grid.querySelectorAll('.emoji-item').forEach(btn => {
            btn.addEventListener('click', () => this.insertEmoji(btn.textContent));
        });
    }

    insertEmoji(emoji) {
        const input = this.input;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const text = input.value;
        
        input.value = text.substring(0, start) + emoji + text.substring(end);
        input.selectionStart = input.selectionEnd = start + emoji.length;
        input.focus();
        
        this.close();
    }
}

/**
 * Context Menu
 */
class ContextMenu {
    constructor() {
        this.menu = document.getElementById('context-menu');
        if (!this.menu) return;
        
        this.currentTarget = null;
        this.init();
    }

    init() {
        // Show context menu on right click
        document.addEventListener('contextmenu', (e) => {
            const message = e.target.closest('.message');
            if (message && message.dataset.messageId) {
                e.preventDefault();
                this.show(e.clientX, e.clientY, message);
            } else {
                this.hide();
            }
        });
        
        // Hide on click outside
        document.addEventListener('click', () => this.hide());
        
        // Handle actions
        this.menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleAction(item.dataset.action);
            });
        });
    }

    show(x, y, target) {
        this.currentTarget = target;
        this.menu.style.left = `${x}px`;
        this.menu.style.top = `${y}px`;
        this.menu.classList.remove('hidden');
        
        // Ensure menu stays in viewport
        const rect = this.menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            this.menu.style.left = `${x - rect.width}px`;
        }
        if (rect.bottom > window.innerHeight) {
            this.menu.style.top = `${y - rect.height}px`;
        }
    }

    hide() {
        this.menu.classList.add('hidden');
        this.currentTarget = null;
    }

    handleAction(action) {
        if (!this.currentTarget) return;
        
        const messageId = this.currentTarget.dataset.messageId;
        const messageText = this.currentTarget.querySelector('.message-bubble')?.textContent;
        
        switch (action) {
            case 'reply':
                this.triggerReply(messageId, messageText);
                break;
            case 'forward':
                this.triggerForward(messageId);
                break;
            case 'copy':
                this.copyText(messageText);
                break;
            case 'delete':
                this.triggerDelete(messageId);
                break;
        }
        
        this.hide();
    }

    triggerReply(messageId, messageText) {
        const event = new CustomEvent('messageAction', {
            detail: { action: 'reply', messageId, messageText }
        });
        document.dispatchEvent(event);
    }

    triggerForward(messageId) {
        const event = new CustomEvent('messageAction', {
            detail: { action: 'forward', messageId }
        });
        document.dispatchEvent(event);
    }

    copyText(text) {
        navigator.clipboard.writeText(text).then(() => {
            UI.showToast('Message copied', 'success');
        });
    }

    triggerDelete(messageId) {
        const event = new CustomEvent('messageAction', {
            detail: { action: 'delete', messageId }
        });
        document.dispatchEvent(event);
    }
}

/**
 * File Upload Handler
 */
class FileUploadHandler {
    constructor() {
        this.fileInput = document.getElementById('file-input');
        this.attachBtn = document.getElementById('attach-btn');
        this.previewArea = document.getElementById('file-preview-area');
        this.previewList = document.getElementById('file-preview-list');
        
        if (!this.fileInput) return;
        
        this.files = [];
        this.init();
    }

    init() {
        this.attachBtn?.addEventListener('click', () => this.fileInput.click());
        
        this.fileInput.addEventListener('change', (e) => {
            this.handleFiles(Array.from(e.target.files));
        });
        
        // Drag and drop
        const container = document.getElementById('messages-container');
        if (container) {
            container.addEventListener('dragover', (e) => {
                e.preventDefault();
                container.classList.add('drag-over');
            });
            
            container.addEventListener('dragleave', () => {
                container.classList.remove('drag-over');
            });
            
            container.addEventListener('drop', (e) => {
                e.preventDefault();
                container.classList.remove('drag-over');
                this.handleFiles(Array.from(e.dataTransfer.files));
            });
        }
    }

    handleFiles(newFiles) {
        this.files.push(...newFiles);
        this.renderPreviews();
        this.previewArea.classList.remove('hidden');
    }

    renderPreviews() {
        this.previewList.innerHTML = this.files.map((file, index) => {
            const preview = this.getFilePreview(file);
            return `
                <div class="file-preview-item" data-index="${index}">
                    ${preview}
                    <div class="file-info">
                        <span class="file-name">${this.truncate(file.name, 20)}</span>
                        <span class="file-size">${this.formatSize(file.size)}</span>
                    </div>
                    <button type="button" class="remove-file" data-index="${index}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            `;
        }).join('');
        
        // Add remove handlers
        this.previewList.querySelectorAll('.remove-file').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                this.removeFile(index);
            });
        });
    }

    getFilePreview(file) {
        if (file.type.startsWith('image/')) {
            const url = URL.createObjectURL(file);
            return `<img src="${url}" alt="${file.name}" class="file-thumbnail">`;
        } else {
            const icon = this.getFileIcon(file.type);
            return `<div class="file-icon">${icon}</div>`;
        }
    }

    getFileIcon(type) {
        if (type.includes('pdf')) return '📄';
        if (type.includes('word')) return '📝';
        if (type.includes('video')) return '🎥';
        return '📎';
    }

    removeFile(index) {
        this.files.splice(index, 1);
        if (this.files.length === 0) {
            this.previewArea.classList.add('hidden');
        }
        this.renderPreviews();
    }

    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    truncate(str, maxLength) {
        if (str.length <= maxLength) return str;
        return str.substr(0, maxLength) + '...';
    }

    getFiles() {
        return this.files;
    }

    clear() {
        this.files = [];
        this.fileInput.value = '';
        this.previewArea.classList.add('hidden');
    }
}

/**
 * Message Input Auto-resize
 */
class MessageInputResize {
    constructor(inputId) {
        this.input = document.getElementById(inputId);
        if (!this.input) return;
        
        this.input.addEventListener('input', () => this.resize());
    }

    resize() {
        this.input.style.height = 'auto';
        this.input.style.height = Math.min(this.input.scrollHeight, 120) + 'px';
    }
}

/**
 * Scroll to Bottom Button
 */
class ScrollManager {
    constructor(containerId, btnId) {
        this.container = document.getElementById(containerId);
        this.btn = document.getElementById(btnId);
        
        if (!this.container || !this.btn) return;
        
        this.init();
    }

    init() {
        this.container.addEventListener('scroll', () => this.checkScroll());
        this.btn.addEventListener('click', () => this.scrollToBottom());
    }

    checkScroll() {
        const isAtBottom = this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight < 100;
        
        if (isAtBottom) {
            this.btn.classList.add('hidden');
        } else {
            this.btn.classList.remove('hidden');
        }
    }

    scrollToBottom(smooth = true) {
        this.container.scrollTo({
            top: this.container.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto'
        });
    }

    isAtBottom() {
        return this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight < 100;
    }
}

/**
 * Image Viewer
 */
class ImageViewer {
    constructor() {
        this.viewer = document.getElementById('image-viewer');
        this.img = document.getElementById('image-viewer-img');
        this.closeBtn = document.getElementById('close-image-viewer');
        
        if (!this.viewer) return;
        
        this.init();
    }

    init() {
        this.closeBtn?.addEventListener('click', () => this.close());
        this.viewer.addEventListener('click', (e) => {
            if (e.target === this.viewer) this.close();
        });
    }

    open(src, title, subtitle) {
        this.img.src = src;
        document.getElementById('image-viewer-title').textContent = title || 'Image';
        document.getElementById('image-viewer-subtitle').textContent = subtitle || '';
        this.viewer.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    close() {
        this.viewer.classList.add('hidden');
        document.body.style.overflow = '';
    }
}

/**
 * Notification System
 */
class NotificationManager {
    constructor() {
        this.permission = Notification.permission;
        // Don't request permission in constructor
    }

    async requestPermission() {
        if (this.permission === 'default' && 'Notification' in window) {
            this.permission = await Notification.requestPermission();
        }
        return this.permission === 'granted';
    }

    show(title, options = {}) {
        if (this.permission === 'granted' && !document.hasFocus()) {
            const notification = new Notification(title, {
                icon: '/icon.png',
                badge: '/badge.png',
                ...options
            });
            
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
            
            return notification;
        }
    }

    showMessageNotification(message) {
        const options = {
            body: message.content,
            tag: message.id,
            icon: '/icon.png'
        };
        
        return this.show(`New message from ${message.sender_username}`, options);
    }
}

/**
 * Settings Manager
 */
class SettingsManager {
    constructor() {
        this.settings = this.loadSettings();
        this.init();
    }

    init() {
        // Settings tabs
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                this.switchTab(tabName);
            });
        });
        
        // Open settings modal
        document.getElementById('settings-btn')?.addEventListener('click', () => {
            document.getElementById('settings-modal').classList.add('show');
        });
    }

    switchTab(tabName) {
        // Update active tab button
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        
        // Update active panel
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

    saveSettings() {
        localStorage.setItem('user_settings', JSON.stringify(this.settings));
    }

    get(key) {
        return this.settings[key];
    }

    set(key, value) {
        this.settings[key] = value;
        this.saveSettings();
    }
}

// Initialize all features when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.themeManager = new ThemeManager();
    window.passwordStrength = new PasswordStrength('register-password');
    window.passwordToggle = new PasswordToggle();
    window.emojiPicker = new EmojiPicker();
    window.contextMenu = new ContextMenu();
    window.fileUpload = new FileUploadHandler();
    window.messageInputResize = new MessageInputResize('message-input');
    window.scrollManager = new ScrollManager('messages-container', 'scroll-to-bottom');
    window.imageViewer = new ImageViewer();
    window.notificationManager = new NotificationManager();
    window.settingsManager = new SettingsManager();
});