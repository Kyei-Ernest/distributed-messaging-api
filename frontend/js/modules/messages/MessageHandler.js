/**
 * ============================================================================
 * MessageHandler - Handles message sending, receiving, and UI updates
 * ============================================================================
 */
class MessageHandler {
    constructor(app) {
        this.app = app;
        this.isSending = false;
        this.messageIds = new Set();
        this.replyingToMessage = null;
        this.tempMessages = new Map();
        this.missedCount = 0;
        // Scrolling back to the bottom clears the FAB missed-count badge.
        window.dmsClearMissedCount = () => {
            this.missedCount = 0;
            this.renderFabBadge();
        };
    }

    async handleSendMessage(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        if (this.isSending) {
            console.log('⏳ Already sending, ignoring duplicate');
            return;
        }

        const messageInput = document.getElementById('message-input');
        const content = messageInput?.value?.trim();

        if (!content || !this.app.currentChat) {
            console.log('No content or no active chat');
            return;
        }

        this.isSending = true;
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        try {
            // Add optimistic message
            const optimisticMessage = this.createOptimisticMessage(content, tempId);
            this.addMessageToUI(optimisticMessage);
            this.tempMessages.set(tempId, { content, senderId: this.app.currentUser.id });
            messageInput.value = '';

            // Send via REST API (persists to DB, Django broadcasts via Redis → WS)
            const result = await this.sendViaAPI(content, tempId);

            // Replace temp message with server response
            if (result && result.id) {
                this.replaceTempMessage({ ...result, temp_id: tempId });
                return;
            }

            // Update temp message status
            this.updateMessageStatus(tempId, 'sent');

        } catch (error) {
            console.error('Failed to send message:', error);
            this.updateMessageStatus(tempId, 'failed');
            UI.showToast('Failed to send message', 'error');
        } finally {
            this.isSending = false;
        }
    }

    createOptimisticMessage(content, tempId) {
        return {
            id: tempId,
            content: content,
            sender_id: this.app.currentUser.id,
            sender_username: this.app.currentUser.username,
            created_at: new Date().toISOString(),
            is_own: true,
            is_optimistic: true,
            status: 'sending',
            reply_to: this.replyingToMessage
        };
    }

    async sendViaWebSocket(content, tempId) {
        const messageData = {
            content: content,
            temp_id: tempId
        };

        if (this.replyingToMessage) {
            messageData.reply_to_id = this.replyingToMessage.id;
            this.cancelReply();
        }

        if (this.app.currentChat.type === 'group') {
            ws.send('group_message', {
                ...messageData,
                group_id: this.app.currentChat.id
            });
        } else {
            ws.send('private_message', {
                ...messageData,
                recipient_id: this.app.currentChat.id
            });
        }

        // Return a promise so await works (WS send is fire-and-forget)
        return Promise.resolve();
    }

    async sendViaAPI(content, tempId) {
        const body = this.app.currentChat.type === 'group'
            ? { content, group_id: this.app.currentChat.id, message_type: 'group' }
            : { content, recipient_id: this.app.currentChat.id, message_type: 'private' };

        return await api.request('/messages/', {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    updateMessageStatus(tempId, status) {
        const messageEl = document.querySelector(`[data-message-id="${tempId}"]`);
        if (messageEl) {
            messageEl.classList.remove('sending', 'sent', 'failed');
            messageEl.classList.add(status);

            const statusIcon = messageEl.querySelector('.status-checks');
            if (statusIcon) {
                statusIcon.className = `status-checks ${status}`;
                if (status === 'sent') {
                    statusIcon.innerHTML = '✓';
                } else if (status === 'failed') {
                    statusIcon.innerHTML = '⚠️';
                }
            }
        }
    }

    addMessageToUI(message) {
        const container = document.getElementById('messages-list');
        if (!container) return;

        // Check for duplicates
        if (this.messageIds.has(message.id)) {
            console.log('Duplicate message ignored:', message.id);
            return;
        }
        this.messageIds.add(message.id);

        // Date separator when the day changes (WhatsApp-style chips)
        const msgDate = new Date(message.created_at || Date.now());
        const dayKey = msgDate.toDateString();
        if (container.dataset.lastDay !== dayKey) {
            container.appendChild(UI.createDateDivider(msgDate));
            container.dataset.lastDay = dayKey;
        }

        const messageEl = UI.createMessage(message, this.app.currentUser?.id);

        // Check if previous message is from same sender
        const lastMessage = container.lastElementChild;
        if (lastMessage && lastMessage.classList.contains('message') &&
            String(lastMessage.dataset.senderId) === String(message.sender_id || message.sender?.id)) {
            messageEl.classList.add('consecutive');
            // Remove avatar from this consecutive message to clean up UI
            const avatar = messageEl.querySelector('.avatar');
            if (avatar) avatar.style.visibility = 'hidden';

            // Remove sender name spacing
            const senderName = messageEl.querySelector('.message-sender');
            if (senderName) senderName.style.display = 'none';
        }

        container.appendChild(messageEl);
        this.scrollForNewMessage(message);
    }

    /**
     * Live-feel scrolling: follow the conversation only when the user is at
     * (or near) the bottom or it's their own message; otherwise park the
     * message behind the jump-to-latest FAB with a missed-count badge.
     */
    scrollForNewMessage(message) {
        const isOwn = String(message.sender_id || message.sender?.id) === String(this.app.currentUser?.id);
        const atBottom = window.scrollManager ? window.scrollManager.isAtBottom() : true;

        if (isOwn || atBottom) {
            this.missedCount = 0;
            this.renderFabBadge();
            window.scrollManager ? window.scrollManager.scrollToBottom() : this.scrollToBottom();
        } else {
            this.missedCount = (this.missedCount || 0) + 1;
            this.renderFabBadge();
        }
    }

    renderFabBadge() {
        const btn = document.getElementById('scroll-to-bottom');
        if (!btn) return;
        let badge = btn.querySelector('.fab-count');
        if (!this.missedCount) {
            badge?.remove();
            return;
        }
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'fab-count';
            btn.appendChild(badge);
        }
        badge.textContent = this.missedCount > 99 ? '99+' : this.missedCount;
        // Re-trigger pop animation on each increment
        badge.style.animation = 'none';
        void badge.offsetWidth;
        badge.style.animation = '';
    }

    scrollToBottom() {
        document.getElementById('messages-container')?.scrollTo({
            top: document.getElementById('messages-container').scrollHeight
        });
    }

    handleReply(messageId) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageEl) return;

        this.replyingToMessage = {
            id: messageId,
            content: messageEl.querySelector('.message-content')?.textContent || '',
            sender: messageEl.dataset.senderName || 'User'
        };

        // Show reply preview
        const replyPreview = document.getElementById('reply-preview');
        if (replyPreview) {
            replyPreview.innerHTML = `
                <div class="reply-preview-content">
                    <span class="reply-to">Replying to ${this.replyingToMessage.sender}</span>
                    <span class="reply-text">${UI.truncate(this.replyingToMessage.content, 50)}</span>
                    <button class="cancel-reply" onclick="app.messageHandler.cancelReply()">×</button>
                </div>
            `;
            replyPreview.classList.remove('hidden');
        }

        document.getElementById('message-input')?.focus();
    }

    cancelReply() {
        this.replyingToMessage = null;
        const replyPreview = document.getElementById('reply-preview');
        if (replyPreview) {
            replyPreview.classList.add('hidden');
            replyPreview.innerHTML = '';
        }
    }

    handleIncomingMessage(data) {
        console.log('📩 Incoming message:', data);

        // Try to replace a pending temp message first
        if (this.replaceTempMessage(data)) {
            this.app.chatManager.updateChatPreview?.(data);
            return;
        }

        // Update chat preview
        this.app.chatManager.updateChatPreview?.(data);

        // If this chat is open, add to UI
        if (this.isCurrentChat(data)) {
            this.addMessageToUI(data);
        } else {
            // Show notification
            UI.showNotification?.({
                title: data.sender_username || 'New Message',
                body: UI.truncate(data.content, 50)
            });
        }
    }

    replaceTempMessage(data) {
        // If server echoes temp_id, use it directly
        if (data.temp_id && this.tempMessages.has(data.temp_id)) {
            const tempId = data.temp_id;
            const tempEl = document.querySelector(`[data-message-id="${tempId}"]`);
            if (tempEl) {
                const newEl = UI.createMessage(data, this.app.currentUser?.id);
                tempEl.parentNode?.replaceChild(newEl, tempEl);
            }
            this.messageIds.delete(tempId);
            if (data.id) this.messageIds.add(data.id);
            this.tempMessages.delete(tempId);
            return true;
        }

        // Match by sender + content for broadcasts
        const senderId = data.sender_id || data.sender?.id;
        if (String(senderId) !== String(this.app.currentUser?.id)) return false;

        for (const [tempId, tempData] of this.tempMessages) {
            if (tempData.content === data.content) {
                const tempEl = document.querySelector(`[data-message-id="${tempId}"]`);
                if (tempEl) {
                    const newEl = UI.createMessage(data, this.app.currentUser?.id);
                    tempEl.parentNode?.replaceChild(newEl, tempEl);
                }
                this.messageIds.delete(tempId);
                if (data.id) this.messageIds.add(data.id);
                this.tempMessages.delete(tempId);
                return true;
            }
        }
        return false;
    }

    isCurrentChat(data) {
        if (!this.app.currentChat) return false;

        if (data.group_id) {
            return this.app.currentChat.type === 'group' &&
                this.app.currentChat.id === data.group_id;
        } else {
            const otherId = data.sender_id === this.app.currentUser.id
                ? data.recipient_id
                : data.sender_id;
            return this.app.currentChat.type === 'private' &&
                this.app.currentChat.id === otherId;
        }
    }

    handleContextMenu(e, messageId) {
        e.preventDefault();
        const message = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!message) return;

        const isOwn = message.classList.contains('own');
        const content = message.querySelector('.message-content')?.textContent || '';

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.innerHTML = `
            <div class="context-menu-item" data-action="reply">Reply</div>
            <div class="context-menu-item" data-action="copy">Copy</div>
            <div class="context-menu-item" data-action="forward">Forward</div>
            ${isOwn ? '<div class="context-menu-item danger" data-action="delete">Delete</div>' : ''}
        `;

        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        document.body.appendChild(menu);

        menu.addEventListener('click', (evt) => {
            const action = evt.target.dataset.action;
            if (action === 'reply') this.handleReply(messageId);
            if (action === 'copy') this.copyToClipboard(content);
            if (action === 'forward') this.openForwardModal(messageId);
            if (action === 'delete') this.deleteMessage(messageId);
            menu.remove();
        });

        setTimeout(() => {
            document.addEventListener('click', () => menu.remove(), { once: true });
        }, 100);
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            UI.showToast('Copied to clipboard', 'success');
        });
    }

    async deleteMessage(messageId) {
        try {
            await api.deleteMessage(messageId);
            document.querySelector(`[data-message-id="${messageId}"]`)?.remove();
            UI.showToast('Message deleted', 'success');
        } catch (error) {
            console.error('Failed to delete message:', error);
            UI.showToast('Failed to delete message', 'error');
        }
    }

    openForwardModal(messageId) {
        const modal = document.getElementById('forward-modal');
        if (!modal) return;
        modal.dataset.messageId = messageId;
        modal.classList.add('show');

        this.renderForwardList('');
        this.bindForwardControls();
    }

    /** Union of chats, groups and users as forward targets (deduped by id). */
    forwardTargets() {
        const seen = new Set();
        const targets = [];
        const push = (id, name, type) => {
            if (!id || seen.has(String(id))) return;
            seen.add(String(id));
            targets.push({ id: String(id), name: name || 'Chat', type });
        };
        (this.app.chatManager?.allChats || []).forEach(c =>
            push(c.id, c.name || c.username, c.type === 'group' ? 'group' : 'user'));
        (this.app.groupManager?.myGroups || []).forEach(g => push(g.id, g.name, 'group'));
        (this.app.userManager?.users || []).forEach(u => push(u.id, u.username, 'user'));
        return targets;
    }

    renderForwardList(filterText) {
        const container = document.getElementById('forward-chats-list');
        if (!container) return;
        const needle = (filterText || '').toLowerCase();
        const items = this.forwardTargets()
            .filter(t => !needle || t.name.toLowerCase().includes(needle));

        if (!items.length) {
            container.innerHTML = '<div class="empty-list" style="padding:24px;text-align:center;color:var(--text-muted)">No matching chats</div>';
            return;
        }

        container.innerHTML = '';
        items.forEach(t => {
            const row = document.createElement('div');
            row.className = 'forward-chat-item';
            row.dataset.chatId = t.id;
            row.dataset.chatType = t.type;
            row.innerHTML = `
                <div class="avatar avatar-sm" style="background:${UI.generateAvatarColor(t.name)}">
                    <span>${UI.getInitials(t.name)}</span>
                </div>
                <div class="member-name">${UI.escapeHtml(t.name)}</div>
                <span class="forward-type">${t.type === 'group' ? 'Group' : 'Direct'}</span>
            `;
            row.addEventListener('click', () => {
                this.app.confirmForward(t.id, t.type);
            });
            container.appendChild(row);
        });
    }

    bindForwardControls() {
        if (this._forwardBound) return; // bind once per session
        this._forwardBound = true;

        document.getElementById('forward-search')?.addEventListener('input',
            UI.debounce((e) => this.renderForwardList(e.target.value), 150));
    }
}
