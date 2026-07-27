/**
 * ============================================================================
 * ChatManager - Handles chat list loading, rendering, and unread counts
 * ============================================================================
 */
class ChatManager {
    constructor(app) {
        this.app = app;
        this.allChats = [];
        this.unreadCounts = { total: 0, groups: {}, users: {}, all_chats: {} };
        this.typingPreviews = {};
    }

    showSkeletonChatList(count = 5) {
        const container = document.getElementById('chats-list');
        if (!container) return;

        container.innerHTML = '';
        for (let i = 0; i < count; i++) {
            const skeleton = document.createElement('div');
            skeleton.className = 'skeleton-chat-item';
            skeleton.innerHTML = `
                <div class="skeleton skeleton-avatar"></div>
                <div class="skeleton-content">
                    <div class="skeleton skeleton-line title"></div>
                    <div class="skeleton skeleton-line subtitle"></div>
                </div>
            `;
            container.appendChild(skeleton);
        }
    }

    async loadAllChats() {
        this.showSkeletonChatList(5);

        try {
            console.log('📋 Loading all chats...');
            const response = await api.getChats();
            this.allChats = response.chats || [];
            console.log(`✅ Loaded ${this.allChats.length} chats`);

            // Subscribe to groups in chats
            if (ws.isConnected) {
                this.allChats.filter(c => c.type === 'group').forEach(g => ws.subscribeToGroup(g.id));
            }

            this.renderChats();
        } catch (error) {
            console.error('❌ Failed to load chats:', error);
            UI.showToast('Failed to load chats', 'error');
            this.allChats = [];
            this.renderChats();
        }
    }

    renderChats(searchQuery = '') {
        const container = document.getElementById('chats-list');
        if (!container) return;

        container.innerHTML = '';
        const query = searchQuery.toLowerCase().trim();

        const filtered = this.allChats.filter(chat => {
            if (!query) return true;
            return chat.name.toLowerCase().includes(query) ||
                (chat.email && chat.email.toLowerCase().includes(query)) ||
                (chat.last_message && chat.last_message.toLowerCase().includes(query));
        });

        if (filtered.length === 0) {
            const msg = searchQuery ? 'No chats match your search' : 'No conversations yet';
            const hint = searchQuery ? 'Try a different search term' : 'Start a conversation from Groups or Contacts';
            container.innerHTML = `
                <div class="empty-list" style="padding: 60px 20px; text-align: center;">
                    <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity: 0.2; margin-bottom: 16px;">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <p style="font-size: 16px; font-weight: 500; margin-bottom: 8px; color: var(--text-secondary);">${msg}</p>
                    <p style="font-size: 13px; color: var(--text-tertiary);">${hint}</p>
                </div>
            `;
            return;
        }

        filtered.forEach(chat => {
            const item = this.createChatItem(chat);
            container.appendChild(item);
        });
    }

    createChatItem(chat) {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.dataset.chatId = chat.id;
        div.dataset.type = chat.type;

        if (chat.type === 'group') {
            div.dataset.groupId = chat.id;
        } else {
            div.dataset.userId = chat.id;
        }

        const avatarColor = UI.generateAvatarColor(chat.name);
        const isOnline = chat.type === 'user' ? (chat.is_online || false) : false;

        let unreadCount = this.unreadCounts.all_chats[chat.id] ?? chat.unread_count ?? 0;
        if (unreadCount > 0) {
            this.unreadCounts.all_chats[chat.id] = unreadCount;
            if (chat.type === 'group') this.unreadCounts.groups[chat.id] = unreadCount;
            else this.unreadCounts.users[chat.id] = unreadCount;
        }

        const hasUnread = unreadCount > 0;
        const subtitle = UI.escapeHtml(UI.truncate(chat.last_message, 40));

        div.innerHTML = `
            <div class="avatar" style="background: ${avatarColor}">
                <span>${UI.getInitials(chat.name)}</span>
                ${chat.type === 'user' ? `<span class="status-badge ${isOnline ? 'online' : 'offline'}" data-user-id="${chat.id}"></span>` : ''}
            </div>
            <div class="list-item-content">
                <div class="list-item-title">
                    ${UI.escapeHtml(chat.name)}
                    ${chat.type === 'user' && isOnline ? '<span class="online-indicator">● online</span>' : ''}
                    ${hasUnread ? `<span class="badge unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''}
                </div>
                <div class="list-item-subtitle ${hasUnread ? 'unread' : ''}">${subtitle}</div>
            </div>
            <div class="list-item-meta">
                <div class="list-item-time">${UI.formatTime(chat.last_message_time)}</div>
            </div>
        `;

        div.addEventListener('click', () => {
            if (chat.type === 'group') {
                this.app.openGroupChat(chat.data || chat);
            } else {
                this.app.openPrivateChat(chat.data || chat);
            }
        });

        return div;
    }

    async loadUnreadCounts() {
        try {
            const response = await api.request('/messages/unread_counts/');
            this.unreadCounts = response;
            this.updateTotalUnreadBadge();
            console.log('✅ Unread counts loaded:', this.unreadCounts);
        } catch (error) {
            console.error('Failed to load unread counts:', error);
        }
    }

    updateTotalUnreadBadge() {
        const totalBadge = document.getElementById('total-unread-badge');
        if (totalBadge) {
            if (this.unreadCounts.total > 0) {
                totalBadge.textContent = this.unreadCounts.total > 99 ? '99+' : this.unreadCounts.total;
                totalBadge.classList.remove('hidden');
            } else {
                totalBadge.classList.add('hidden');
            }
        }
    }

    handleUnreadCountUpdate(data) {
        console.log('📊 Unread count update:', data);
        this.unreadCounts.total = data.total_unread;
        this.unreadCounts.groups = data.groups || {};
        this.unreadCounts.users = data.users || {};
        this.unreadCounts.all_chats = data.all_chats || {};
        this.updateTotalUnreadBadge();
        this.updateChatBadges(data);
    }

    updateChatBadges(data) {
        const container = document.querySelector('.list-container');
        if (!container) return;

        // Update badges for each chat
        for (const [chatId, count] of Object.entries(data.all_chats)) {
            const item = container.querySelector(`.list-item[data-chat-id="${chatId}"]`);
            if (!item) continue;

            const titleDiv = item.querySelector('.list-item-title');
            if (!titleDiv) continue;

            let badge = titleDiv.querySelector('.unread-badge');
            const subtitle = item.querySelector('.list-item-subtitle');

            if (count > 0) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'badge unread-badge';
                    titleDiv.appendChild(badge);
                }
                badge.textContent = count > 99 ? '99+' : count;
                subtitle?.classList.add('unread');
            } else if (badge) {
                badge.remove();
                subtitle?.classList.remove('unread');
            }
        }
    }

    handleSearch(query) {
        this.renderChats(query);
    }

    updateChatPreview(data) {
        // For private messages sent by current user, use recipient_id as chatId
        let chatId = data.group_id;
        if (!chatId) {
            if (data.sender_id && String(data.sender_id) === String(this.app.currentUser?.id)) {
                chatId = data.recipient_id;
            } else {
                chatId = data.sender_id;
            }
        }
        if (!chatId) return;

        // Check if chat exists in allChats
        let chat = this.allChats.find(c =>
            String(c.id) === String(chatId) ||
            (data.group_id && String(c.id) === String(data.group_id)) ||
            (data.sender_id && c.type === 'user' && String(c.id) === String(data.sender_id)) ||
            (data.recipient_id && c.type === 'user' && String(c.id) === String(data.recipient_id))
        );

        if (chat) {
            // Update chat preview
            chat.last_message = data.content || data.last_message || '';
            chat.last_message_time = data.timestamp || data.created_at || new Date().toISOString();

            // Move updated chat to top 
            const index = this.allChats.indexOf(chat);
            if (index > 0) {
                this.allChats.splice(index, 1);
                this.allChats.unshift(chat);
            }

            // Re-render the chat list
            this.renderChats();
        }

        // Update the specific list item directly if it exists
        const chatItem = document.querySelector(`.list-item[data-chat-id="${chatId}"]`);
        if (chatItem) {
            const subtitleEl = chatItem.querySelector('.list-item-subtitle');
            const timeEl = chatItem.querySelector('.list-item-time');

            if (subtitleEl) {
                subtitleEl.textContent = UI.truncate(data.content || data.last_message || '', 40);
            }
            if (timeEl) {
                timeEl.textContent = UI.formatTime(data.timestamp || data.created_at || new Date().toISOString());
            }
        }
    }

    updateTypingPreview(chatId, username, isTyping) {
        const chatItem = document.querySelector(`.list-item[data-chat-id="${chatId}"]`);
        if (!chatItem) return;

        const subtitleEl = chatItem.querySelector('.list-item-subtitle');
        if (!subtitleEl) return;

        if (isTyping) {
            // Save original text if not already saved
            if (!this.typingPreviews[chatId]) {
                this.typingPreviews[chatId] = subtitleEl.textContent;
            }
            subtitleEl.innerHTML = `<span style="color: var(--accent-primary); font-style: italic;">typing...</span>`;
        } else {
            // Restore original text
            const original = this.typingPreviews[chatId];
            if (original) {
                subtitleEl.textContent = original;
                delete this.typingPreviews[chatId];
            }
        }
    }
}
