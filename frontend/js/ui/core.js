/**
 * ============================================================================
 * UI Core - Base UI utilities: screens, visibility, toasts, errors
 * ============================================================================
 */
console.log('✅ UI Core loaded');

const UI = {
    // ========================================================================
    // Screen Management
    // ========================================================================
    showScreen(screenId) {
        console.log(`🖥️ Switching to screen: ${screenId}`);
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
            screen.style.display = 'none';
        });

        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
            targetScreen.style.display = 'flex';
        }

        const mobileNav = document.querySelector('.mobile-bottom-nav');
        if (mobileNav) {
            if (screenId === 'login-screen') {
                mobileNav.classList.add('hidden');
            } else {
                mobileNav.classList.remove('hidden');
            }
        }
    },

    // ========================================================================
    // Element Visibility
    // ========================================================================
    show(elementId) {
        const el = document.getElementById(elementId);
        if (el) {
            el.classList.remove('hidden');
            // Ensure proper display for flex containers
            if (elementId === 'messages-container' || elementId === 'message-input-container') {
                el.style.display = 'flex';
            } else if (elementId === 'chat-header') {
                el.style.display = 'flex';
            } else {
                el.style.display = '';
            }
        }
    },

    hide(elementId) {
        const el = document.getElementById(elementId);
        if (el) {
            el.classList.add('hidden');
            el.style.display = 'none';
        }
    },

    toggle(elementId) {
        const el = document.getElementById(elementId);
        if (el) {
            if (el.classList.contains('hidden')) {
                this.show(elementId);
            } else {
                this.hide(elementId);
            }
        }
    },

    // ========================================================================
    // Toast Notifications
    // ========================================================================
    showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toast-container') || this.createToastContainer();
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `${this.getToastIcon(type)}<span>${this.escapeHtml(message)}</span>`;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    createToastContainer() {
        const container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
        return container;
    },

    getToastIcon(type) {
        const icons = {
            success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>',
            error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
            warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
            info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
        };
        return icons[type] || icons.info;
    },

    // ========================================================================
    // Error Messages
    // ========================================================================
    showError(elementId, message) {
        const el = document.getElementById(elementId);
        if (el) { el.textContent = message; el.classList.add('show'); }
    },

    hideError(elementId) {
        const el = document.getElementById(elementId);
        if (el) el.classList.remove('show');
    },

    // ========================================================================
    // Basic Utilities
    // ========================================================================
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    truncate(text, maxLength) {
        if (!text || text.length <= maxLength) return text || '';
        return text.substring(0, maxLength) + '...';
    },

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => { clearTimeout(timeout); func(...args); };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    isMobile() {
        return window.innerWidth <= 768;
    },

    // ========================================================================
    // User Utilities
    // ========================================================================
    getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
    },

    generateAvatarColor(name) {
        const colors = ['#4f46e5', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#d97706', '#65a30d', '#16a34a', '#059669', '#0891b2', '#0284c7', '#2563eb'];
        let hash = 0;
        for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        return colors[Math.abs(hash) % colors.length];
    },

    createAvatar(name, size = 40) {
        const div = document.createElement('div');
        div.className = 'avatar';
        if (size !== 40) {
            div.style.width = `${size}px`;
            div.style.height = `${size}px`;
            div.style.minWidth = `${size}px`;
            div.style.fontSize = `${Math.floor(size / 2.5)}px`;
        }
        div.style.background = this.generateAvatarColor(name);
        div.innerHTML = `<span>${this.getInitials(name)}</span>`;
        return div;
    },

    // ========================================================================
    // Time Formatting
    // ========================================================================
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        }
        const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
        if (diff < 604800000) return date.toLocaleDateString('en-US', { weekday: 'short' });
        if (date.getFullYear() === now.getFullYear()) {
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },

    formatDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        if (date.toDateString() === now.toDateString()) return 'Today';
        const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return date.toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
    },

    // ========================================================================
    // Scroll & Loading
    // ========================================================================
    scrollToBottom(elementId, smooth = true) {
        const el = document.getElementById(elementId);
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    },

    clearList(elementId) {
        const el = document.getElementById(elementId);
        if (el) el.innerHTML = '';
    },

    showLoading(elementId, message = 'Loading...') {
        const el = document.getElementById(elementId);
        if (el) {
            el.innerHTML = `<div class="loading-container" style="display:flex;flex-direction:column;align-items:center;padding:40px;color:var(--text-tertiary)"><div class="spinner" style="width:24px;height:24px;border:2px solid var(--border-subtle);border-top-color:var(--accent-primary);border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:12px"></div><div>${message}</div></div>`;
        }
    },

    updateUnreadBadge(elementId, count) {
        const badge = document.getElementById(elementId);
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    },

    confirm(message, onConfirm, onCancel) {
        if (window.confirm(message)) { if (onConfirm) onConfirm(); }
        else { if (onCancel) onCancel(); }
    },

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
};
