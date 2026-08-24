/**
 * ============================================================================
 * UserManager - Handles user list, online status tracking
 * ============================================================================
 */
class UserManager {
    constructor(app) {
        this.app = app;
        this.users = [];
    }

    async loadUsers() {
        UI.showLoading('users-list');

        try {
            const response = await api.getUsers();
            const users = response.results || response;

            if (!Array.isArray(users)) {
                console.error('❌ Invalid users data:', users);
                throw new Error('Invalid users data format');
            }

            this.users = users.map(user => ({
                ...user,
                id: user.id,
                is_online: false
            }));

            console.log('✅ Loaded users:', this.users.length);

            // Request online status
            if (ws.isConnected) {
                ws.send('request_online_users');
            }

            this.renderUsers();
        } catch (error) {
            console.error('Failed to load users:', error);
            UI.showToast('Failed to load users', 'error');
            this.users = this.users || [];
        }
    }

    renderUsers(searchQuery = '') {
        const container = document.getElementById('users-list');
        if (!container) return;

        container.innerHTML = '';
        const query = searchQuery.toLowerCase();
        const currentUserId = this.app.currentUser?.id;

        const filtered = this.users.filter(user => {
            if (user.id === currentUserId) return false;
            if (!query) return true;
            return user.username.toLowerCase().includes(query) ||
                (user.email && user.email.toLowerCase().includes(query));
        });

        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-list">No users found</div>';
            return;
        }

        // Sort: online first, then alphabetically
        filtered.sort((a, b) => {
            if (a.is_online && !b.is_online) return -1;
            if (!a.is_online && b.is_online) return 1;
            return a.username.localeCompare(b.username);
        });

        filtered.forEach(user => {
            const item = UI.createUserItem(user, currentUserId);
            if (item) {
                item.addEventListener('click', () => this.app.openPrivateChat(user));
                // Avatar tap opens the profile modal instead of the chat.
                item.querySelector('.avatar')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.app.showUserInfoModal(user);
                });
                container.appendChild(item);
            }
        });
    }

    handleOnlineUsersList(data) {
        console.log('📋 Online users received:', data);

        const onlineUserIds = data.online_users || [];

        if (!Array.isArray(this.users)) {
            console.error('❌ this.users is not an array');
            this.users = [];
            return;
        }

        this.users.forEach(user => {
            const userIdStr = user.id.toString();
            user.is_online = onlineUserIds.includes(userIdStr);
        });

        // Update all UI elements
        onlineUserIds.forEach(userId => this.updateOnlineStatusUI(userId, true));

        console.log(`✅ Online status updated for ${onlineUserIds.length} users`);
    }

    handleUserStatusChange(data) {
        console.log('👤 Status change:', data);

        const user = this.users.find(u => u.id.toString() === data.user_id.toString());
        if (user) {
            user.is_online = data.status === 'online';
            this.updateOnlineStatusUI(data.user_id, user.is_online);
        }
    }

    updateOnlineStatusUI(userId, isOnline) {
        // Update status badges in user list
        const userBadge = document.querySelector(`.list-item[data-user-id="${userId}"] .status-badge`);
        if (userBadge) {
            userBadge.classList.toggle('online', isOnline);
            userBadge.classList.toggle('offline', !isOnline);
        }

        // Update in chat list
        const chatBadge = document.querySelector(`#chats-list .list-item[data-user-id="${userId}"] .status-badge`);
        if (chatBadge) {
            chatBadge.classList.toggle('online', isOnline);
            chatBadge.classList.toggle('offline', !isOnline);
        }
    }

    handleSearch(query) {
        this.renderUsers(query);
    }

    getUserById(userId) {
        return this.users.find(u => u.id.toString() === userId.toString());
    }

    startOnlineStatusPolling() {
        this.onlineStatusInterval = setInterval(() => {
            if (ws.isConnected) {
                ws.send('request_online_users');
            }
        }, 15000);
    }

    stopOnlineStatusPolling() {
        if (this.onlineStatusInterval) {
            clearInterval(this.onlineStatusInterval);
        }
    }
}
