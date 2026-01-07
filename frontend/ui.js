// ============================================================================
// FILE: ui.js - Complete UI Helper Functions with Real-time Features
// ============================================================================

const UI = {
    // ========================================================================
    // Screen Management
    // ========================================================================

    showScreen(screenId) {
        console.log(`🖥️ Switching to screen: ${screenId}`);

        // Hide all screens
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
            screen.style.display = 'none';
        });

        // Show the requested screen
        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
            targetScreen.style.display = 'flex';

            console.log(`✅ Screen "${screenId}" shown`);
        } else {
            console.error(`❌ Screen "${screenId}" not found!`);
        }

        // Hide mobile nav on login screen
        const mobileNav = document.querySelector('.mobile-bottom-nav');
        if (mobileNav) {
            if (screenId === 'login-screen') {
                mobileNav.style.display = 'none';
            } else {
                mobileNav.style.display = 'block';
            }
        }
    },

    // ========================================================================
    // Element Visibility
    // ========================================================================

    show(elementId) {
        const element = document.getElementById(elementId);
        if (element) element.classList.remove('hidden');
    },

    hide(elementId) {
        const element = document.getElementById(elementId);
        if (element) element.classList.add('hidden');
    },

    toggle(elementId) {
        const element = document.getElementById(elementId);
        if (element) element.classList.toggle('hidden');
    },

    // ========================================================================
    // Toast Notifications (Enhanced)
    // ========================================================================

    showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toast-container') || this.createToastContainer();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        // Add icon based on type
        const icon = this.getToastIcon(type);
        toast.innerHTML = `
            ${icon}
            <span>${this.escapeHtml(message)}</span>
        `;

        container.appendChild(toast);

        // Animate in
        setTimeout(() => toast.classList.add('show'), 10);

        // Remove after duration
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
        const errorElement = document.getElementById(elementId);
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.add('show');
        }
    },

    hideError(elementId) {
        const errorElement = document.getElementById(elementId);
        if (errorElement) {
            errorElement.classList.remove('show');
        }
    },

    // ========================================================================
    // User Utilities
    // ========================================================================

    getInitials(name) {
        if (!name) return '?';
        return name
            .split(' ')
            .map(word => word[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);
    },

    generateAvatarColor(name) {
        const colors = [
            '#4f46e5', '#7c3aed', '#db2777', '#dc2626',
            '#ea580c', '#d97706', '#65a30d', '#16a34a',
            '#059669', '#0891b2', '#0284c7', '#2563eb'
        ];

        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }

        return colors[Math.abs(hash) % colors.length];
    },

    // ========================================================================
    // Time Formatting
    // ========================================================================

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        // Less than 1 minute
        if (diff < 60000) {
            return 'Just now';
        }

        // Less than 1 hour
        if (diff < 3600000) {
            const minutes = Math.floor(diff / 60000);
            return `${minutes}m ago`;
        }

        // Today
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        }

        // Yesterday
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        }

        // This week
        if (diff < 604800000) {
            return date.toLocaleDateString('en-US', { weekday: 'short' });
        }

        // This year
        if (date.getFullYear() === now.getFullYear()) {
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            });
        }

        // Older
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    },

    formatDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();

        if (date.toDateString() === now.toDateString()) {
            return 'Today';
        }

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        }

        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
    },

    // ========================================================================
    // List Items Creation
    // ========================================================================

    createGroupItem(group) {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.dataset.groupId = group.id;
        div.dataset.type = 'group';

        const avatarColor = this.generateAvatarColor(group.name);

        div.innerHTML = `
            <div class="avatar" style="background: ${avatarColor}">
                <span>${this.getInitials(group.name)}</span>
            </div>
            <div class="list-item-content">
                <div class="list-item-title">
                    ${this.escapeHtml(group.name)}
                    ${group.is_admin ? '<span class="badge admin">Admin</span>' : ''}
                </div>
                <div class="list-item-subtitle">
                    ${group.member_count} member${group.member_count !== 1 ? 's' : ''}
                </div>
            </div>
        `;

        return div;
    },

    createUserItem(user, currentUserId) {
        const userIdNum = user.id;
        const currentUserIdNum = currentUserId;

        // Skip current user
        if (userIdNum === currentUserIdNum) {
            console.log('Skipping self:', user.username);
            return null;
        }

        const div = document.createElement('div');
        div.className = 'list-item';
        div.dataset.userId = userIdNum;
        div.dataset.type = 'user';

        const avatarColor = this.generateAvatarColor(user.username);
        const isOnline = user.is_online || false;

        div.innerHTML = `
            <div class="avatar" style="background: ${avatarColor}">
                <span>${this.getInitials(user.username)}</span>
                <span class="status-badge ${isOnline ? 'online' : 'offline'}"></span>
            </div>
            <div class="list-item-content">
                <div class="list-item-title">
                    ${this.escapeHtml(user.username)}
                    ${isOnline ? '<span style="color: var(--success-color); font-size: 11px; margin-left: 4px;">● online</span>' : ''}
                </div>
                <div class="list-item-subtitle">
                    ${this.escapeHtml(user.email || '')}
                </div>
            </div>
        `;

        return div;
    },

    createChatItem(chat) {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.dataset.chatId = chat.id;
        div.dataset.type = chat.type;

        const avatarColor = this.generateAvatarColor(chat.name);
        const hasUnread = chat.unread_count > 0;

        div.innerHTML = `
            <div class="avatar" style="background: ${avatarColor}">
                <span>${this.getInitials(chat.name)}</span>
                ${chat.type === 'user' ? `<span class="status-badge ${chat.is_online ? 'online' : 'offline'}"></span>` : ''}
            </div>
            <div class="list-item-content">
                <div class="list-item-title">
                    ${this.escapeHtml(chat.name)}
                    ${hasUnread ? `<span class="badge">${chat.unread_count}</span>` : ''}
                </div>
                <div class="list-item-subtitle ${hasUnread ? 'unread' : ''}">
                    ${chat.last_message ? this.escapeHtml(this.truncate(chat.last_message, 40)) : 'No messages yet'}
                </div>
            </div>
            <div class="list-item-time">${chat.last_message_time ? this.formatTime(chat.last_message_time) : ''}</div>
        `;

        return div;
    },

    // ========================================================================
    // Message Creation (Enhanced with Read Receipts)
    // ========================================================================

    createMessage(message, currentUserId) {
        const senderId = message.sender_id || message.sender?.id;
        const currentUserIdNum = currentUserId;
        const isOwn = senderId === currentUserIdNum;

        const div = document.createElement('div');
        div.className = `message ${isOwn ? 'own' : ''}`;
        div.dataset.messageId = message.message_id || message.id;
        div.dataset.senderId = senderId;

        // Message Actions Trigger (context menu) - Using global app handler
        const senderName = message.sender_username || message.sender?.username || 'Unknown';
        const avatarColor = this.generateAvatarColor(senderName);

        // Reply Context (Telegram Style)
        let replyHTML = '';
        if (message.parent_message) {
            replyHTML = `
                <div class="message-reply-preview" onclick="app.scrollToMessage('${message.parent_message.id || message.parent_message.message_id}')">
                    <div class="reply-content-wrapper">
                        <div class="reply-sender">${this.escapeHtml(message.parent_message.sender?.username || message.parent_message.sender_username || 'Unknown')}</div>
                        <div class="reply-text">${this.escapeHtml(message.parent_message.content || 'Message')}</div>
                    </div>
                </div>
            `;
        }

        // Reactions
        let reactionsHTML = '';
        if (message.reactions && message.reactions.length > 0) {
            // Group reactions by emoji
            const counts = {};
            const userReacted = {};

            message.reactions.forEach(r => {
                counts[r.emoji] = (counts[r.emoji] || 0) + 1;
                // Check if current user reacted with this emoji
                const rUserId = r.user?.id || r.user_id;
                if (rUserId === currentUserId) {
                    userReacted[r.emoji] = true;
                }
            });

            reactionsHTML = '<div class="message-reactions-container">';
            Object.keys(counts).forEach(emoji => {
                const isUser = userReacted[emoji];
                reactionsHTML += `
                    <div class="reaction-pill ${isUser ? 'own-reaction' : ''}" 
                         onclick="app.toggleReaction('${message.id || message.message_id}', '${emoji}')">
                        <span class="emoji">${emoji}</span>
                        <span class="count">${counts[emoji]}</span>
                    </div>
                `;
            });
            reactionsHTML += '</div>';
        }

        div.innerHTML = `
            ${!isOwn ? `
                <div class="avatar avatar-sm" style="background: ${avatarColor}">
                    <span>${this.getInitials(senderName)}</span>
                </div>
            ` : ''}
            <div class="message-content">
                ${!isOwn ? `<div class="message-sender">${this.escapeHtml(senderName)}</div>` : ''}
                
                ${replyHTML}
                
                <div class="message-bubble">
                    ${this.formatMessageContent(message.content)}
                </div>
                
                ${reactionsHTML}
                
                <div class="message-time">
                    ${this.formatTime(message.timestamp || message.created_at)}
                    ${isOwn ? this.getMessageStatus(message) : ''}
                </div>
            </div>
        `;

        return div;
    },

    renderForwardChatList(chats, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (chats.length === 0) {
            container.innerHTML = '<div class="empty-list">No chats found</div>';
            return;
        }

        container.innerHTML = '';
        chats.forEach(chat => {
            const item = document.createElement('div');
            item.className = 'forward-chat-item';
            item.onclick = () => app.confirmForward(chat.id, chat.type);

            const initials = this.getInitials(chat.name || chat.username);
            const color = this.generateAvatarColor(chat.name || chat.username);

            item.innerHTML = `
                <div class="avatar" style="background: ${color}">
                    <span>${initials}</span>
                </div>
                <div class="chat-info">
                    <div class="chat-name" style="font-weight: 600;">${this.escapeHtml(chat.name || chat.username)}</div>
                    <div class="chat-type" style="font-size: 0.75rem; opacity: 0.7;">${chat.type === 'group' ? 'Group' : 'User'}</div>
                </div>
            `;
            container.appendChild(item);
        });
    },

    formatMessageContent(content) {
        // Escape HTML
        let formatted = this.escapeHtml(content);

        // Convert URLs to links
        formatted = formatted.replace(
            /(https?:\/\/[^\s]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
        );

        // Convert line breaks
        formatted = formatted.replace(/\n/g, '<br>');

        return formatted;
    },

    // Update UI.js createMessage method
    getMessageStatus(message) {
        // Icon definitions
        const checkIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        const doubleCheckIcon = `
            <div style="position: relative; width: 18px; height: 14px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; left: 0;">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; left: 6px;">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </div>`;

        if (message.read_by && message.read_by.length > 0) {
            // READ (Blue double ticks)
            const lastRead = message.read_by[message.read_by.length - 1];
            const readTime = lastRead.timestamp ? UI.formatTime(lastRead.timestamp) : 'Read';
            return `<span class="message-status read" title="Read at ${readTime}">${doubleCheckIcon}</span>`;

        } else if (message.delivered) {
            // DELIVERED (Grey double ticks)
            return `<span class="message-status delivered" title="Delivered">${doubleCheckIcon}</span>`;

        } else {
            // SENT (Grey single tick)
            return `<span class="message-status sent" title="Sent">${checkIcon}</span>`;
        }
    },

    updateMessageStatus(messageId, status) {
        const message = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!message) return;

        const statusElement = message.querySelector('.message-status');
        if (!statusElement) return;

        statusElement.className = `message-status ${status}`;

        // Icon definitions
        const checkIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        const doubleCheckIcon = `
            <div style="position: relative; width: 18px; height: 14px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; left: 0;">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; left: 6px;">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </div>`;

        if (status === 'read') {
            statusElement.innerHTML = doubleCheckIcon;
            statusElement.title = 'Read';
        } else if (status === 'delivered') {
            statusElement.innerHTML = doubleCheckIcon;
            statusElement.title = 'Delivered';
        } else {
            statusElement.innerHTML = checkIcon;
            statusElement.title = 'Sent';
        }
    },

    // ========================================================================
    // Date Dividers
    // ========================================================================

    createDateDivider(date) {
        const div = document.createElement('div');
        div.className = 'date-divider';
        div.innerHTML = `<span>${this.formatDate(date)}</span>`;
        return div;
    },

    // ========================================================================
    // Typing Indicator
    // ========================================================================

    showTypingIndicator(username, avatarColor) {
        console.log('🔵 showTypingIndicator called:', username);
        const indicator = document.getElementById('typing-indicator');
        if (!indicator) {
            console.error('❌ typing-indicator element not found!');
            return;
        }

        console.log('✅ typing-indicator element found, showing...');

        const avatar = indicator.querySelector('.avatar');
        const text = document.getElementById('typing-text');

        if (avatar) {
            avatar.style.background = avatarColor || this.generateAvatarColor(username);
            avatar.querySelector('span').textContent = this.getInitials(username);
        }

        if (text) {
            text.textContent = `${username} is typing...`;
        }

        indicator.classList.remove('hidden');
        console.log('✅ Typing indicator visible now');
    },

    hideTypingIndicator() {
        console.log('🔴 hideTypingIndicator called');
        const indicator = document.getElementById('typing-indicator');
        if (indicator) {
            indicator.classList.add('hidden');
            console.log('✅ Typing indicator hidden');
        }
    },


    // ========================================================================
    // Member List Items
    // ========================================================================

    createMemberItem(member) {
        const div = document.createElement('div');
        div.className = 'member-item';
        div.dataset.userId = member.user.id;

        const avatarColor = this.generateAvatarColor(member.user.username);

        div.innerHTML = `
            <div class="avatar avatar-sm" style="background: ${avatarColor}">
                <span>${this.getInitials(member.user.username)}</span>
                <span class="status-badge ${member.is_online ? 'online' : 'offline'}"></span>
            </div>
            <div class="member-info">
                <div class="member-name">${this.escapeHtml(member.user.username)}</div>
                <div class="member-role">
                    ${member.is_admin ? 'Admin' : 'Member'}
                    ${member.is_creator ? ' • Creator' : ''}
                </div>
            </div>
        `;

        return div;
    },

    // ========================================================================
    // Utility Functions
    // ========================================================================

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    truncate(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    },

    scrollToBottom(elementId, smooth = true) {
        const element = document.getElementById(elementId);
        if (element) {
            element.scrollTo({
                top: element.scrollHeight,
                behavior: smooth ? 'smooth' : 'auto'
            });
        }
    },

    clearList(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.innerHTML = '';
        }
    },

    showLoading(elementId, message = 'Loading...') {
        const element = document.getElementById(elementId);
        if (element) {
            element.innerHTML = `<div class="loading">${message}</div>`;
        }
    },

    // ========================================================================
    // Badge Updates
    // ========================================================================

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

    // ========================================================================
    // Loading Overlay
    // ========================================================================

    showLoadingOverlay(message = 'Loading...') {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.querySelector('p').textContent = message;
            overlay.classList.remove('hidden');
        }
    },

    hideLoadingOverlay() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    },

    // ========================================================================
    // Confirmation Dialog
    // ========================================================================

    confirm(message, onConfirm, onCancel) {
        if (window.confirm(message)) {
            if (onConfirm) onConfirm();
        } else {
            if (onCancel) onCancel();
        }
    },

    // ========================================================================
    // File Size Formatting
    // ========================================================================

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    },

    // ========================================================================
    // Animation Helpers
    // ========================================================================

    fadeIn(elementId, duration = 300) {
        const element = document.getElementById(elementId);
        if (!element) return;

        element.style.opacity = '0';
        element.classList.remove('hidden');

        let start = null;
        const animate = (timestamp) => {
            if (!start) start = timestamp;
            const progress = timestamp - start;

            element.style.opacity = Math.min(progress / duration, 1);

            if (progress < duration) {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
    },

    fadeOut(elementId, duration = 300, callback) {
        const element = document.getElementById(elementId);
        if (!element) return;

        let start = null;
        const animate = (timestamp) => {
            if (!start) start = timestamp;
            const progress = timestamp - start;

            element.style.opacity = 1 - Math.min(progress / duration, 1);

            if (progress < duration) {
                requestAnimationFrame(animate);
            } else {
                element.classList.add('hidden');
                if (callback) callback();
            }
        };

        requestAnimationFrame(animate);
    },

    // ========================================================================
    // Notification Permission
    // ========================================================================

    async requestNotificationPermission() {
        if (!('Notification' in window)) {
            console.log('This browser does not support notifications');
            return false;
        }

        if (Notification.permission === 'granted') {
            return true;
        }

        if (Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            return permission === 'granted';
        }

        return false;
    },

    showNotification(title, options = {}) {
        if (Notification.permission === 'granted' && !document.hasFocus()) {
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
    },

    // ========================================================================
    // Debounce Utility
    // ========================================================================

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // ========================================================================
    // Throttle Utility
    // ========================================================================

    throttle(func, limit) {
        let inThrottle;
        return function (...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    // ========================================================================
    // Copy to Clipboard
    // ========================================================================

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showToast('Copied to clipboard', 'success');
            return true;
        } catch (err) {
            console.error('Failed to copy:', err);
            this.showToast('Failed to copy', 'error');
            return false;
        }
    },

    // ========================================================================
    // Mobile Detection
    // ========================================================================

    isMobile() {
        return window.innerWidth <= 768;
    },

    isTablet() {
        return window.innerWidth > 768 && window.innerWidth <= 1024;
    },

    isDesktop() {
        return window.innerWidth > 1024;
    },

    // ========================================================================
    // User Info Modal
    // ========================================================================

    showUserInfoModal(user) {
        const modal = document.getElementById('user-info-modal');
        if (!modal) return;

        // Populate basic info
        const avatar = modal.querySelector('#modal-user-avatar');
        const initials = modal.querySelector('#modal-user-initials');
        const name = modal.querySelector('#modal-user-name');
        const email = modal.querySelector('#modal-user-email');
        const joined = modal.querySelector('#modal-user-joined');
        const statusBadge = modal.querySelector('#modal-user-status');
        const statusText = statusBadge.querySelector('.status-text');

        // Styling
        avatar.style.background = this.generateAvatarColor(user.username);
        initials.textContent = this.getInitials(user.username);
        name.textContent = user.username;
        email.textContent = user.email || 'No email hidden';
        joined.textContent = user.created_at ? this.formatDate(user.created_at) : 'Unknown';

        // Online Status
        if (user.is_online) {
            statusBadge.classList.add('online');
            statusText.textContent = 'Online';
        } else {
            statusBadge.classList.remove('online');
            statusText.textContent = 'Offline';
        }

        // Action Buttons
        const msgBtn = modal.querySelector('#modal-message-btn');
        msgBtn.onclick = () => {
            // Close modal
            modal.classList.remove('active');
            // Navigate to chat (requires accessing App instance global or custom event)
            window.dispatchEvent(new CustomEvent('open-private-chat', { detail: user }));
        };

        // Show modal
        modal.classList.add('active');
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UI;
}