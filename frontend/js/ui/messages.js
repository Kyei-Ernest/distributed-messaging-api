/**
 * ============================================================================
 * UI Messages - Message rendering, status indicators, typing, date dividers
 * ============================================================================
 */

// Extend UI object with message methods
Object.assign(UI, {
    createMessage(message, currentUserId) {
        const senderId = message.sender_id || message.sender?.id;
        const isOwn = String(senderId) === String(currentUserId);

        const div = document.createElement('div');
        div.className = `message ${isOwn ? 'own' : ''}`;
        div.dataset.messageId = message.message_id || message.id;
        div.dataset.senderId = senderId;

        const senderName = message.sender_username || message.sender?.username || 'Unknown';
        const avatarColor = this.generateAvatarColor(senderName);

        // Reply preview
        let replyHTML = '';
        if (message.parent_message) {
            const parentSender = message.parent_message.sender?.username || message.parent_message.sender_username || 'Unknown';
            replyHTML = `
                <div class="message-reply-preview" onclick="app.scrollToMessage('${message.parent_message.id || message.parent_message.message_id}')">
                    <div class="reply-content-wrapper">
                        <div class="reply-sender">${this.escapeHtml(parentSender)}</div>
                        <div class="reply-text">${this.escapeHtml(message.parent_message.content || 'Message')}</div>
                    </div>
                </div>
            `;
        }

        // Reactions
        let reactionsHTML = '';
        if (message.reactions && message.reactions.length > 0) {
            const counts = {};
            const userReacted = {};
            message.reactions.forEach(r => {
                counts[r.emoji] = (counts[r.emoji] || 0) + 1;
                if ((r.user?.id || r.user_id) === currentUserId) userReacted[r.emoji] = true;
            });

            reactionsHTML = '<div class="message-reactions-container">';
            Object.keys(counts).forEach(emoji => {
                reactionsHTML += `
                    <div class="reaction-pill ${userReacted[emoji] ? 'own-reaction' : ''}" 
                         onclick="app.toggleReaction('${message.id || message.message_id}', '${emoji}')">
                        <span class="emoji">${emoji}</span>
                        <span class="count">${counts[emoji]}</span>
                    </div>
                `;
            });
            reactionsHTML += '</div>';
        }

        div.innerHTML = `
            ${!isOwn ? `<div class="avatar avatar-sm" style="background: ${avatarColor}"><span>${this.getInitials(senderName)}</span></div>` : ''}
            <div class="message-content">
                ${!isOwn ? `<div class="message-sender">${this.escapeHtml(senderName)}</div>` : ''}
                ${replyHTML}
                <div class="message-bubble">
                    <div class="message-text">${this.formatMessageContent(message.content)}</div>
                    <span class="message-meta">
                        <span class="message-time">${this.formatTime(message.timestamp || message.created_at)}</span>
                        ${isOwn ? this.getMessageStatus(message) : ''}
                    </span>
                </div>
                ${reactionsHTML}
            </div>
        `;

        return div;
    },

    formatMessageContent(content) {
        let formatted = this.escapeHtml(content);
        formatted = formatted.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
        formatted = formatted.replace(/\n/g, '<br>');
        return formatted;
    },

    getMessageStatus(message) {
        if (message.is_failed || message.failed) {
            return '<span class="status-checks failed" title="Failed to send">⚠️</span>';
        }
        if (message.is_retrying || message.retrying) {
            return '<span class="status-checks retrying" title="Retrying...">↻</span>';
        }
        if (message.is_optimistic) {
            return '<span class="status-checks sending" title="Sending...">○</span>';
        }
        if (message.read_by && message.read_by.length > 0) {
            return '<span class="status-checks read">✓✓</span>';
        }
        if (message.delivered) {
            return '<span class="status-checks delivered">✓✓</span>';
        }
        return '<span class="status-checks sent">✓</span>';
    },

    updateMessageStatus(messageId, status) {
        const message = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!message) return;

        let statusEl = message.querySelector('.status-checks') || message.querySelector('.message-status');
        if (!statusEl) return;

        statusEl.className = `status-checks ${status}`;
        if (status === 'read') {
            statusEl.innerHTML = '✓✓';
            statusEl.style.color = '#53bdeb';
        } else if (status === 'delivered') {
            statusEl.innerHTML = '✓✓';
            statusEl.style.color = '';
        } else if (status === 'sent') {
            statusEl.innerHTML = '✓';
            statusEl.style.color = '';
        }
    },

    createDateDivider(date) {
        const div = document.createElement('div');
        div.className = 'date-divider';
        div.innerHTML = `<span>${this.formatDate(date)}</span>`;
        return div;
    },

    showTypingIndicator(username, avatarColor) {
        const indicator = document.getElementById('typing-indicator');
        if (!indicator) return;

        const avatar = indicator.querySelector('.avatar');
        const text = document.getElementById('typing-text');

        if (avatar) {
            avatar.style.background = avatarColor || this.generateAvatarColor(username);
            avatar.querySelector('span').textContent = this.getInitials(username);
        }
        if (text) text.textContent = `${username} is typing...`;
        indicator.classList.remove('hidden');
    },

    hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.classList.add('hidden');
    }
});

console.log('✅ UI Messages loaded');
