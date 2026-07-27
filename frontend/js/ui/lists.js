/**
 * ============================================================================
 * UI Lists - List item creation for chats, groups, users, members
 * ============================================================================
 */

// Extend UI object with list methods
Object.assign(UI, {
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
                <div class="list-item-title">${this.escapeHtml(group.name)}</div>
                <div class="list-item-subtitle">${group.member_count} member${group.member_count !== 1 ? 's' : ''}</div>
            </div>
        `;
        return div;
    },

    createUserItem(user, currentUserId) {
        if (user.id === currentUserId) return null;

        const div = document.createElement('div');
        div.className = 'list-item';
        div.dataset.userId = user.id;
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
                    ${isOnline ? '<span class="online-indicator">● online</span>' : ''}
                </div>
                <div class="list-item-subtitle">${this.escapeHtml(user.email || '')}</div>
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
                    ${member.is_admin ? 'Admin' : 'Member'}${member.is_creator ? ' • Creator' : ''}
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

            const name = chat.name || chat.username;
            item.innerHTML = `
                <div class="avatar" style="background: ${this.generateAvatarColor(name)}">
                    <span>${this.getInitials(name)}</span>
                </div>
                <div class="chat-info">
                    <div class="chat-name" style="font-weight: 600;">${this.escapeHtml(name)}</div>
                    <div class="chat-type" style="font-size: 0.75rem; opacity: 0.7;">${chat.type === 'group' ? 'Group' : 'User'}</div>
                </div>
            `;
            container.appendChild(item);
        });
    }
});

console.log('✅ UI Lists loaded');
