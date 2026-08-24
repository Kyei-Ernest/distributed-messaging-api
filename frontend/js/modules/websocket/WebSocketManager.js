/**
 * ============================================================================
 * WebSocketManager - Handles WebSocket connection and event routing
 * ============================================================================
 */
class WebSocketManager {
    constructor(app) {
        this.app = app;
        this.onlineStatusPollInterval = null;
        this.typingTimeouts = {};
    }

    setupListeners() {
        ws.on('connected', () => this.handleConnected());
        ws.on('disconnected', () => this.handleDisconnected());
        ws.on('error', (error) => this.handleError(error));

        // Message events
        ws.on('group_message', (data) => this.handleGroupMessage(data));
        ws.on('private_message', (data) => this.handlePrivateMessage(data));

        // User status events
        ws.on('online_users_list', (data) => this.app.userManager.handleOnlineUsersList(data));
        ws.on('user_status', (data) => this.app.userManager.handleUserStatusChange(data));
        ws.on('user_status_response', (data) => this.handleUserStatusResponse(data));

        // Typing events
        ws.on('typing_indicator', (data) => this.handleTypingIndicator(data));

        // Group events
        ws.on('user_joined', (data) => this.handleUserJoined(data));
        ws.on('user_left', (data) => this.handleUserLeft(data));
        ws.on('user_removed', (data) => this.handleUserRemoved(data));
        ws.on('member_promoted', (data) => this.handleMemberPromoted(data));

        // Message events
        ws.on('message_deleted', (data) => this.handleMessageDeleted(data));
        ws.on('message_read', (data) => this.handleMessageRead(data));
        ws.on('message_delivered', (data) => this.handleMessageDelivered(data));
        ws.on('message_reaction', (data) => this.handleMessageReaction(data));
        ws.on('unread_count_update', (data) => this.app.chatManager.handleUnreadCountUpdate(data));
    }

    handleConnected() {
        console.log('✅ WebSocket connected');
        if (window.AppStore) AppStore.set('connection', 'status', 'connected');
        this.app.updateStatusIndicator?.('Connected', 'online');

        // Subscribe to all groups
        this.app.myGroups?.forEach(group => ws.subscribeToGroup(group.id));

        // Request online users immediately
        ws.send('request_online_users');

        // Poll every 15 seconds
        if (this.onlineStatusPollInterval) {
            clearInterval(this.onlineStatusPollInterval);
        }
        this.onlineStatusPollInterval = setInterval(() => {
            if (ws.isConnected) {
                ws.send('request_online_users');
            }
        }, 15000);
    }

    handleDisconnected() {
        console.log('❌ WebSocket disconnected');
        if (window.AppStore) AppStore.set('connection', 'status', 'disconnected');
        this.app.updateStatusIndicator?.('Disconnected', 'offline');

        if (this.onlineStatusPollInterval) {
            clearInterval(this.onlineStatusPollInterval);
        }
    }

    handleError(error) {
        console.error('WebSocket error:', error);
        if (window.AppStore) AppStore.set('connection', 'status', 'disconnected');
        this.app.updateStatusIndicator?.('Connection error', 'offline');
    }

    handleGroupMessage(data) {
        console.log('📩 Group message:', data);

        if (data && data.content && !data.last_message) {
            data.last_message = data.content;
        }
        this.notifyIncoming(data);
        this.app.messageHandler?.handleIncomingMessage(data);
    }

    handlePrivateMessage(data) {
        console.log('📩 Private message:', data);

        if (data && data.content && !data.last_message) {
            data.last_message = data.content;
        }

        // Set correct chat ID
        if (data.sender_id === this.app.currentUser?.id) {
            data.id = data.recipient_id;
        } else {
            data.id = data.sender_id;
        }

        this.notifyIncoming(data);
        this.app.messageHandler?.handleIncomingMessage(data);
    }

    // Desktop notification (tab hidden) + optional sound for others' messages.
    notifyIncoming(data) {
        try {
            if (!data || data.sender_id === this.app.currentUser?.id) return;
            if (window.dmsWantsSound?.()) window.dmsPlayPing();
            if (document.hidden && typeof this.app.profileManager?.notificationManager?.showMessageNotification === 'function') {
                this.app.profileManager.notificationManager.showMessageNotification({
                    sender_username: data.sender_username || data.username,
                    content: data.content,
                    id: data.id,
                });
            } else if (document.hidden && window.notificationManager) {
                window.notificationManager.showMessageNotification({
                    sender_username: data.sender_username || data.username,
                    content: data.content,
                    id: data.id,
                });
            }
        } catch (e) { /* notifications must never break delivery */ }
    }

    handleTypingIndicator(data) {
        console.log('⌨️ Typing:', data);

        if (!this.app.currentChat) return;

        const typingEl = document.getElementById('typing-indicator');
        if (!typingEl) return;

        const typingText = document.getElementById('typing-text');
        const avatar = typingEl.querySelector('.avatar');

        if (data.is_typing) {
            if (typingText) typingText.textContent = `${data.username || 'Someone'} is typing...`;
            if (avatar) {
                avatar.style.background = UI.generateAvatarColor(data.username || 'User');
                const span = avatar.querySelector('span');
                if (span) span.textContent = UI.getInitials(data.username || 'User');
            }
            typingEl.classList.remove('hidden');

            // Auto-hide typing indicator after 5 seconds
            if (this.typingTimeouts[data.user_id]) {
                clearTimeout(this.typingTimeouts[data.user_id]);
            }
            this.typingTimeouts[data.user_id] = setTimeout(() => {
                typingEl.classList.add('hidden');
                delete this.typingTimeouts[data.user_id];
            }, 5000);
        } else {
            typingEl.classList.add('hidden');
            if (this.typingTimeouts[data.user_id]) {
                clearTimeout(this.typingTimeouts[data.user_id]);
                delete this.typingTimeouts[data.user_id];
            }
        }

        // Update chat list preview with typing status
        const chatId = data.group_id || data.user_id;
        if (chatId) {
            this.app.chatManager?.updateTypingPreview?.(chatId, data.username, data.is_typing);
        }
    }

    handleUserStatusResponse(data) {
        console.log('👤 User status response:', data);

        const user = this.app.users?.find(u => u.id.toString() === data.user_id?.toString());
        if (user) {
            user.is_online = data.is_online;
            this.app.userManager?.updateOnlineStatusUI(data.user_id, data.is_online);
        }
    }

    handleUserJoined(data) {
        console.log('👋 User joined:', data);
        UI.showToast(`${data.username} joined the group`, 'info');
        this.app.groupManager?.loadGroups();
    }

    handleUserLeft(data) {
        console.log('👋 User left:', data);
        UI.showToast(`${data.username} left the group`, 'info');
    }

    handleUserRemoved(data) {
        console.log('🚫 User removed:', data);

        if (data.user_id === this.app.currentUser?.id) {
            UI.showToast(`You were removed from ${data.group_name || 'the group'}`, 'warning');
            this.app.navigationManager?.handleMobileBack();
            this.app.groupManager?.loadGroups();
        } else {
            UI.showToast(`${data.username} was removed from the group`, 'info');
        }
    }

    handleMemberPromoted(data) {
        console.log('⭐ Member promoted:', data);
        UI.showToast(`${data.username} is now an admin`, 'success');
    }

    handleMessageDeleted(data) {
        console.log('🗑️ Message deleted:', data);
        document.querySelector(`[data-message-id="${data.message_id}"]`)?.remove();
    }

    handleMessageRead(data) {
        console.log('✓✓ Message read:', data);

        const messageEl = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (messageEl) {
            const statusEl = messageEl.querySelector('.status-checks') || messageEl.querySelector('.message-status');
            if (statusEl) {
                statusEl.className = 'status-checks read';
                statusEl.innerHTML = '✓✓';
                statusEl.style.color = '#53bdeb';
            }
        }
    }

    handleMessageDelivered(data) {
        console.log('✓✓ Message delivered:', data);

        const messageEl = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (messageEl) {
            const statusEl = messageEl.querySelector('.status-checks') || messageEl.querySelector('.message-status');
            if (statusEl && !statusEl.classList.contains('read')) {
                statusEl.className = 'status-checks delivered';
                statusEl.innerHTML = '✓✓';
                statusEl.style.color = '';
            }
        }
    }

    handleMessageReaction(data) {
        console.log('😊 Reaction:', data);

        const messageEl = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (messageEl) {
            let reactionsEl = messageEl.querySelector('.message-reactions');
            if (!reactionsEl) {
                reactionsEl = document.createElement('div');
                reactionsEl.className = 'message-reactions';
                messageEl.querySelector('.message-bubble')?.appendChild(reactionsEl);
            }

            // Update reactions display
            reactionsEl.innerHTML = data.reactions?.map(r =>
                `<span class="reaction">${r.emoji} ${r.count}</span>`
            ).join('') || '';
        }
    }

    startOnlineStatusPolling() {
        this.onlineStatusPollInterval = setInterval(() => {
            if (ws.isConnected) {
                ws.send('request_online_users');
            }
        }, 15000);
    }

    stopOnlineStatusPolling() {
        if (this.onlineStatusPollInterval) {
            clearInterval(this.onlineStatusPollInterval);
        }
    }
}
