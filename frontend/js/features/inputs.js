/**
 * ============================================================================
 * Input Features - Password, Emoji, Message Input
 * ============================================================================
 */

// Password Strength Checker
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

// Password Toggle Visibility
class PasswordToggle {
    constructor() {
        document.querySelectorAll('.toggle-password').forEach(btn => {
            btn.addEventListener('click', () => this.toggle(btn));
        });
    }

    toggle(btn) {
        const input = document.getElementById(btn.dataset.target);
        const eyeIcon = btn.querySelector('.eye-icon');
        const eyeOffIcon = btn.querySelector('.eye-off-icon');
        if (input.type === 'password') {
            input.type = 'text';
            eyeIcon?.classList.add('hidden');
            eyeOffIcon?.classList.remove('hidden');
        } else {
            input.type = 'password';
            eyeIcon?.classList.remove('hidden');
            eyeOffIcon?.classList.add('hidden');
        }
    }
}

// Emoji Picker
class EmojiPicker {
    constructor() {
        this.picker = document.getElementById('emoji-picker');
        this.grid = document.getElementById('emoji-grid');
        this.input = document.getElementById('message-input');
        this.button = document.getElementById('emoji-btn');
        if (!this.picker || !this.button) return;

        this.emojis = {
            smileys: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘'],
            people: ['👋', '🤚', '🖐', '✋', '👌', '✌️', '🤞', '👍', '👎', '✊', '👊', '👏', '🙌', '🙏', '💪', '👀'],
            nature: ['🌸', '🌺', '🌻', '🌷', '🌹', '💐', '🌲', '🌳', '🌴', '🌵', '🌿', '🍀', '🌍', '🌈', '☀️', '⭐'],
            food: ['🍕', '🍔', '🍟', '🌭', '🍿', '🌮', '🥪', '🍩', '🎂', '🍰', '☕', '🍷', '🍺', '🥤', '🧊', '🍎'],
            activities: ['⚽', '🏀', '🏈', '⚾', '🎾', '🎮', '🎯', '🎨', '🎭', '🎪', '🎤', '🎧', '🎬', '📷', '🎸', '🎹'],
            symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '💕', '💖', '💗', '💘', '✨', '💫', '⚡', '🔥']
        };
        this.init();
    }

    init() {
        this.button.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
        document.addEventListener('click', (e) => {
            if (!this.picker.contains(e.target) && e.target !== this.button) this.close();
        });
        document.querySelectorAll('.emoji-category').forEach(btn => {
            btn.addEventListener('click', () => this.showCategory(btn.dataset.category));
        });
        this.showCategory('smileys');
    }

    toggle() {
        if (!this.picker.classList.contains('show')) {
            this.picker.classList.remove('hidden');
            this.picker.classList.add('show');
        } else {
            this.picker.classList.remove('show');
        }
    }

    close() { this.picker.classList.remove('show'); this.picker.classList.add('hidden'); }

    showCategory(category) {
        document.querySelectorAll('.emoji-category').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.category === category);
        });
        this.grid.innerHTML = this.emojis[category].map(e => `<button class="emoji-item" type="button">${e}</button>`).join('');
        this.grid.querySelectorAll('.emoji-item').forEach(btn => {
            btn.addEventListener('click', () => this.insertEmoji(btn.textContent));
        });
    }

    insertEmoji(emoji) {
        const start = this.input.selectionStart;
        const text = this.input.value;
        this.input.value = text.substring(0, start) + emoji + text.substring(this.input.selectionEnd);
        this.input.selectionStart = this.input.selectionEnd = start + emoji.length;
        this.input.focus();
        this.close();
    }
}

// Message Input Auto-resize
class MessageInputResize {
    constructor(inputId) {
        this.input = document.getElementById(inputId);
        if (!this.input) return;
        this.input.addEventListener('input', () => this.resize());
        this.input.addEventListener('paste', () => setTimeout(() => this.resize(), 10));
    }

    resize() {
        this.input.style.height = 'auto';
        const newHeight = Math.min(this.input.scrollHeight, 120);
        this.input.style.height = newHeight + 'px';
        const form = this.input.closest('.message-form');
        if (form) form.style.alignItems = newHeight > 40 ? 'flex-end' : 'center';
    }
}

console.log('✅ Input Features loaded');
