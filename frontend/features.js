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
        
        if (UI.isMobile()) {
            // Center on mobile, above message input
            this.picker.style.bottom = '80px';
            this.picker.style.left = '10px';
            this.picker.style.right = '10px';
            this.picker.style.width = 'auto';
        } else {
            // Desktop positioning
            this.picker.style.bottom = `${window.innerHeight - buttonRect.top + 8}px`;
            this.picker.style.right = `${window.innerWidth - buttonRect.right}px`;
        }
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
        // Also resize on paste
        this.input.addEventListener('paste', () => {
            setTimeout(() => this.resize(), 10);
        });
    }

    resize() {
        this.input.style.height = 'auto';
        const newHeight = Math.min(this.input.scrollHeight, 120);
        this.input.style.height = newHeight + 'px';
        
        // Adjust parent container if needed
        const form = this.input.closest('.message-form');
        if (form) {
            form.style.alignItems = newHeight > 40 ? 'flex-end' : 'center';
        }
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

// Add to features.js
class VoiceMessageRecorder {
    constructor() {
        this.recorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.recordingTime = 0;
        this.timer = null;
        this.init();
    }

    init() {
        // Add voice message button to message form
        this.addVoiceButton();
        this.setupRecordingUI();
    }

    addVoiceButton() {
        const messageForm = document.getElementById('message-form');
        if (!messageForm) return;
        
        const voiceBtn = document.createElement('button');
        voiceBtn.type = 'button';
        voiceBtn.className = 'btn-icon';
        voiceBtn.id = 'voice-message-btn';
        voiceBtn.title = 'Voice message';
        voiceBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
        `;
        
        messageForm.insertBefore(voiceBtn, messageForm.querySelector('#message-input'));
        
        voiceBtn.addEventListener('mousedown', () => this.startRecording());
        voiceBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startRecording();
        });
        
        document.addEventListener('mouseup', () => this.stopRecording());
        document.addEventListener('touchend', () => this.stopRecording());
    }

    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.recorder = new MediaRecorder(stream);
            this.audioChunks = [];
            this.isRecording = true;
            
            this.recorder.ondataavailable = (e) => {
                this.audioChunks.push(e.data);
            };
            
            this.recorder.onstop = async () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                await this.sendVoiceMessage(audioBlob);
                stream.getTracks().forEach(track => track.stop());
            };
            
            this.recorder.start();
            this.startTimer();
            this.showRecordingUI();
            
        } catch (error) {
            console.error('Error accessing microphone:', error);
            UI.showToast('Microphone access denied', 'error');
        }
    }

    stopRecording() {
        if (this.isRecording && this.recorder && this.recorder.state === 'recording') {
            this.recorder.stop();
            this.isRecording = false;
            this.stopTimer();
            this.hideRecordingUI();
        }
    }

    startTimer() {
        this.recordingTime = 0;
        this.timer = setInterval(() => {
            this.recordingTime++;
            this.updateTimerDisplay();
        }, 1000);
    }

    stopTimer() {
        clearInterval(this.timer);
    }

    async sendVoiceMessage(audioBlob) {
        if (audioBlob.size < 100) {
            UI.showToast('Recording too short', 'warning');
            return;
        }

        try {
            // Convert to base64 for sending
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = async () => {
                const base64Audio = reader.result;
                
                // Send via WebSocket
                ws.send('voice_message', {
                    audio: base64Audio,
                    duration: this.recordingTime,
                    type: app.currentChat?.type,
                    group_id: app.currentChat?.type === 'group' ? app.currentChat.id : null,
                    recipient_id: app.currentChat?.type === 'private' ? app.currentChat.id : null
                });
                
                UI.showToast('Voice message sent', 'success');
            };
        } catch (error) {
            console.error('Error sending voice message:', error);
            UI.showToast('Failed to send voice message', 'error');
        }
    }
}

// Add to features.js
class MessageReactions {
    constructor() {
        this.reactions = ['❤️', '😆', '😮', '😢', '👏', '🔥'];
        this.init();
    }

    init() {
        // Add reaction picker to context menu
        this.addReactionsToContextMenu();
        document.addEventListener('messageLongPress', (e) => this.showReactionPicker(e.detail));
    }

    showReactionPicker(message) {
        const picker = document.createElement('div');
        picker.className = 'reaction-picker';
        picker.innerHTML = this.reactions.map(reaction => `
            <button class="reaction-option" data-reaction="${reaction}">${reaction}</button>
        `).join('');
        
        // Position near message
        const messageRect = message.getBoundingClientRect();
        picker.style.position = 'fixed';
        picker.style.left = `${messageRect.left}px`;
        picker.style.top = `${messageRect.top - 50}px`;
        
        document.body.appendChild(picker);
        
        // Add click handlers
        picker.querySelectorAll('.reaction-option').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.addReaction(message.dataset.messageId, e.target.dataset.reaction);
                picker.remove();
            });
        });
        
        // Remove picker on outside click
        setTimeout(() => {
            document.addEventListener('click', () => picker.remove(), { once: true });
        }, 100);
    }

    async addReaction(messageId, reaction) {
        try {
            ws.send('message_reaction', {
                message_id: messageId,
                reaction: reaction
            });
            
            // Update UI immediately
            this.updateMessageReactionUI(messageId, reaction);
        } catch (error) {
            console.error('Error adding reaction:', error);
        }
    }

    updateMessageReactionUI(messageId, reaction) {
        const message = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!message) return;
        
        let reactionContainer = message.querySelector('.message-reactions');
        if (!reactionContainer) {
            reactionContainer = document.createElement('div');
            reactionContainer.className = 'message-reactions';
            message.appendChild(reactionContainer);
        }
        
        // Add or update reaction
        const existingReaction = reactionContainer.querySelector(`[data-reaction="${reaction}"]`);
        if (existingReaction) {
            const count = parseInt(existingReaction.dataset.count) + 1;
            existingReaction.dataset.count = count;
            existingReaction.textContent = `${reaction} ${count}`;
        } else {
            const reactionElement = document.createElement('span');
            reactionElement.className = 'message-reaction';
            reactionElement.dataset.reaction = reaction;
            reactionElement.dataset.count = 1;
            reactionElement.textContent = `${reaction} 1`;
            reactionContainer.appendChild(reactionElement);
        }
    }
}

// Add to features.js
class MessageScheduler {
    constructor() {
        this.scheduledMessages = [];
        this.init();
    }

    init() {
        // Add schedule button to message form
        this.addScheduleButton();
        this.loadScheduledMessages();
        this.startScheduler();
    }

    addScheduleButton() {
        const messageForm = document.getElementById('message-form');
        if (!messageForm) return;
        
        const scheduleBtn = document.createElement('button');
        scheduleBtn.type = 'button';
        scheduleBtn.className = 'btn-icon';
        scheduleBtn.id = 'schedule-message-btn';
        scheduleBtn.title = 'Schedule message';
        scheduleBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
        `;
        
        messageForm.insertBefore(scheduleBtn, messageForm.querySelector('#send-btn'));
        
        scheduleBtn.addEventListener('click', () => {
            this.showScheduleDialog();
        });
    }

    showScheduleDialog() {
        const dialog = document.createElement('div');
        dialog.className = 'schedule-dialog';
        dialog.innerHTML = `
            <div class="dialog-content">
                <h3>Schedule Message</h3>
                <div class="form-group">
                    <label>Date</label>
                    <input type="date" id="schedule-date" value="${this.getTomorrowDate()}">
                </div>
                <div class="form-group">
                    <label>Time</label>
                    <input type="time" id="schedule-time" value="09:00">
                </div>
                <div class="dialog-actions">
                    <button class="btn btn-secondary" id="cancel-schedule">Cancel</button>
                    <button class="btn btn-primary" id="confirm-schedule">Schedule</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        document.getElementById('cancel-schedule').addEventListener('click', () => {
            dialog.remove();
        });
        
        document.getElementById('confirm-schedule').addEventListener('click', () => {
            this.scheduleMessage();
            dialog.remove();
        });
    }

    scheduleMessage() {
        const content = document.getElementById('message-input').value;
        if (!content.trim()) {
            UI.showToast('Enter a message to schedule', 'warning');
            return;
        }
        
        const date = document.getElementById('schedule-date').value;
        const time = document.getElementById('schedule-time').value;
        const scheduledTime = new Date(`${date}T${time}`);
        
        if (scheduledTime <= new Date()) {
            UI.showToast('Schedule time must be in the future', 'warning');
            return;
        }
        
        const scheduledMessage = {
            id: Date.now(),
            content: content,
            scheduledTime: scheduledTime.getTime(),
            chatType: app.currentChat.type,
            chatId: app.currentChat.id,
            status: 'scheduled'
        };
        
        this.scheduledMessages.push(scheduledMessage);
        this.saveScheduledMessages();
        
        UI.showToast(`Message scheduled for ${scheduledTime.toLocaleString()}`, 'success');
        document.getElementById('message-input').value = '';
    }

    startScheduler() {
        setInterval(() => {
            const now = Date.now();
            this.scheduledMessages = this.scheduledMessages.filter(msg => {
                if (msg.scheduledTime <= now && msg.status === 'scheduled') {
                    this.sendScheduledMessage(msg);
                    return false;
                }
                return true;
            });
            this.saveScheduledMessages();
        }, 60000); // Check every minute
    }

    async sendScheduledMessage(message) {
        try {
            const messageData = {
                content: message.content,
                message_type: message.chatType
            };
            
            if (message.chatType === 'group') {
                messageData.group = message.chatId;
            } else {
                messageData.recipient_id = message.chatId;
            }
            
            await api.sendMessage(messageData);
            UI.showToast('Scheduled message sent', 'success');
        } catch (error) {
            console.error('Error sending scheduled message:', error);
            UI.showToast('Failed to send scheduled message', 'error');
        }
    }
}

// Add to features.js
class MessageTranslator {
    constructor() {
        this.apiKey = ''; // You'd need a translation API key
        this.supportedLanguages = {
            'en': 'English',
            'es': 'Spanish',
            'fr': 'French',
            'de': 'German',
            'it': 'Italian',
            'pt': 'Portuguese',
            'ru': 'Russian',
            'zh': 'Chinese',
            'ja': 'Japanese',
            'ko': 'Korean',
            'ar': 'Arabic',
            'hi': 'Hindi'
        };
        this.init();
    }

    init() {
        // Add translate button to context menu
        this.addTranslateToContextMenu();
    }

    async translateMessage(messageId, targetLang = 'en') {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageElement) return;
        
        const messageContent = messageElement.querySelector('.message-bubble');
        const originalText = messageContent.textContent;
        
        try {
            const translatedText = await this.callTranslationAPI(originalText, targetLang);
            
            // Show translation
            const translationDiv = document.createElement('div');
            translationDiv.className = 'message-translation';
            translationDiv.innerHTML = `
                <div class="translation-header">
                    <small>Translated to ${this.supportedLanguages[targetLang]}</small>
                    <button class="btn-icon btn-sm" onclick="this.closest('.message-translation').remove()">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="translation-text">${translatedText}</div>
            `;
            
            messageContent.parentNode.insertBefore(translationDiv, messageContent.nextSibling);
            
        } catch (error) {
            console.error('Translation error:', error);
            UI.showToast('Translation failed', 'error');
        }
    }

    async callTranslationAPI(text, targetLang) {
        // This would use a real translation API like Google Translate
        // For demo purposes, returning mock translation
        return `[Translated to ${this.supportedLanguages[targetLang]}] ${text}`;
    }
}

// Add to features.js
class ChatBackup {
    constructor() {
        this.init();
    }

    init() {
        // Add backup option to settings
        this.addBackupToSettings();
    }

    async exportChat(chatId, chatType) {
        try {
            UI.showLoadingOverlay('Exporting chat...');
            
            const filters = chatType === 'group' ? 
                { group: chatId, message_type: 'group' } : 
                { message_type: 'private' };
            
            const response = await api.getMessages(filters);
            const messages = response.results || response;
            
            // Filter for private chat if needed
            let chatMessages = messages;
            if (chatType === 'private') {
                const otherUserId = chatId;
                chatMessages = messages.filter(msg => {
                    const senderId = msg.sender_id || msg.sender?.id;
                    const recipientId = msg.recipient_id || msg.recipient?.id;
                    return (senderId === otherUserId || recipientId === otherUserId);
                });
            }
            
            // Format for export
            const exportData = {
                chatInfo: {
                    type: chatType,
                    id: chatId,
                    exportDate: new Date().toISOString(),
                    messageCount: chatMessages.length
                },
                messages: chatMessages.map(msg => ({
                    id: msg.id,
                    sender: msg.sender_username || msg.sender?.username,
                    content: msg.content,
                    timestamp: msg.created_at,
                    type: msg.message_type
                }))
            };
            
            // Create and download JSON file
            const dataStr = JSON.stringify(exportData, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
            
            const exportFileDefaultName = `chat_${chatType}_${chatId}_${Date.now()}.json`;
            
            const linkElement = document.createElement('a');
            linkElement.setAttribute('href', dataUri);
            linkElement.setAttribute('download', exportFileDefaultName);
            linkElement.click();
            
            UI.hideLoadingOverlay();
            UI.showToast('Chat exported successfully', 'success');
            
        } catch (error) {
            console.error('Export error:', error);
            UI.hideLoadingOverlay();
            UI.showToast('Failed to export chat', 'error');
        }
    }

    async exportAllChats() {
        try {
            UI.showLoadingOverlay('Exporting all chats...');
            
            // Get all messages
            const response = await api.getMessages();
            const allMessages = response.results || response;
            
            // Organize by chat
            const chats = {};
            
            allMessages.forEach(msg => {
                let chatKey;
                if (msg.message_type === 'group') {
                    chatKey = `group_${msg.group_id}`;
                } else {
                    // For private chats, create a consistent key regardless of direction
                    const userIds = [msg.sender_id, msg.recipient_id].sort();
                    chatKey = `private_${userIds.join('_')}`;
                }
                
                if (!chats[chatKey]) {
                    chats[chatKey] = {
                        type: msg.message_type,
                        messages: []
                    };
                }
                
                chats[chatKey].messages.push({
                    id: msg.id,
                    sender: msg.sender_username || msg.sender?.username,
                    content: msg.content,
                    timestamp: msg.created_at,
                    type: msg.message_type
                });
            });
            
            const exportData = {
                exportDate: new Date().toISOString(),
                totalChats: Object.keys(chats).length,
                totalMessages: allMessages.length,
                chats: chats
            };
            
            // Create and download JSON file
            const dataStr = JSON.stringify(exportData, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
            
            const exportFileDefaultName = `all_chats_backup_${Date.now()}.json`;
            
            const linkElement = document.createElement('a');
            linkElement.setAttribute('href', dataUri);
            linkElement.setAttribute('download', exportFileDefaultName);
            linkElement.click();
            
            UI.hideLoadingOverlay();
            UI.showToast('All chats exported successfully', 'success');
            
        } catch (error) {
            console.error('Export error:', error);
            UI.hideLoadingOverlay();
            UI.showToast('Failed to export chats', 'error');
        }
    }
}

// Add to features.js
class ChatThemes {
    constructor() {
        this.themes = {
            default: {
                '--message-bg': 'var(--bg-primary)',
                '--own-message-bg': 'var(--primary-color)',
                '--message-text': 'var(--text-primary)',
                '--own-message-text': 'white'
            },
            blue: {
                '--message-bg': '#e3f2fd',
                '--own-message-bg': '#2196f3',
                '--message-text': '#1565c0',
                '--own-message-text': 'white'
            },
            green: {
                '--message-bg': '#e8f5e9',
                '--own-message-bg': '#4caf50',
                '--message-text': '#2e7d32',
                '--own-message-text': 'white'
            },
            purple: {
                '--message-bg': '#f3e5f5',
                '--own-message-bg': '#9c27b0',
                '--message-text': '#7b1fa2',
                '--own-message-text': 'white'
            },
            dark: {
                '--message-bg': '#37474f',
                '--own-message-bg': '#263238',
                '--message-text': '#eceff1',
                '--own-message-text': '#eceff1'
            }
        };
        this.init();
    }

    init() {
        this.loadTheme();
        this.addThemeSelector();
    }

    applyTheme(themeName) {
        const theme = this.themes[themeName] || this.themes.default;
        
        Object.entries(theme).forEach(([property, value]) => {
            document.documentElement.style.setProperty(property, value);
        });
        
        localStorage.setItem('chat_theme', themeName);
    }

    loadTheme() {
        const savedTheme = localStorage.getItem('chat_theme') || 'default';
        this.applyTheme(savedTheme);
    }

    addThemeSelector() {
        // Add to settings panel
        const settingsPanel = document.getElementById('appearance-panel');
        if (!settingsPanel) return;
        
        const themeSection = document.createElement('div');
        themeSection.className = 'settings-section';
        themeSection.innerHTML = `
            <h4>Chat Theme</h4>
            <div class="theme-options">
                ${Object.keys(this.themes).map(theme => `
                    <button class="theme-option ${theme}" data-theme="${theme}">
                        <span class="theme-preview" style="background: ${this.themes[theme]['--own-message-bg']}"></span>
                        <span>${theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
                    </button>
                `).join('')}
            </div>
        `;
        
        settingsPanel.appendChild(themeSection);
        
        themeSection.querySelectorAll('.theme-option').forEach(btn => {
            btn.addEventListener('click', () => {
                const themeName = btn.dataset.theme;
                this.applyTheme(themeName);
                
                // Update active state
                themeSection.querySelectorAll('.theme-option').forEach(b => {
                    b.classList.remove('active');
                });
                btn.classList.add('active');
            });
        });
    }
}