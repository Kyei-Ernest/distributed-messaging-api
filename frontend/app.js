class MessagingApp {
    constructor() {
        this.currentChat = null;
        this.typingTimeout = null;
        this.init();
    }

    async init() {
        // Check if user is logged in
        const token = localStorage.getItem(CONFIG.TOKEN_KEY);
        
        if (token) {
            UI.showScreen('chat-screen');
            await this.initializeChat();
        } else {
            UI.showScreen('login-screen');
        }

        this.setupEventListeners();
    }

    async initializeChat() {
        // Load user info
        const currentUser = api.getCurrentUser();
        document.getElementById('current-user-name').textContent = currentUser.username;
        document.getElementById('current-user-initials').textContent = UI.getInitials(currentUser.username);

        // Connect WebSocket
        ws.connect();
        this.setupWebSocketListeners();

        // Load initial data
        await this.loadGroups();
        await this.loadUsers();
    }

    setupEventListeners() {
        // Auth forms
        document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('register-form').addEventListener('submit', (e) => this.handleRegister(e));
        
        document.getElementById('show-register').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('register-form').classList.remove('hidden');
        });
        
        document.getElementById('show-login').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('login-form').classList.remove('hidden');
        });

        // Logout
        document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());

        // Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleTabSwitch(e));
        });

        // Create group
        document.getElementById('create-group-btn').addEventListener('click', () => {
            document.getElementById('create-group-modal').classList.add('show');
        });

        document.getElementById('create-group-form').addEventListener('submit', (e) => this.handleCreateGroup(e));

        // Close modals
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.modal').forEach(modal => modal.classList.remove('show'));
            });
        });

        // Message form
        document.getElementById('message-form').addEventListener('submit', (e) => this.handleSendMessage(e));
        document.getElementById('message-input').addEventListener('input', () => this.handleTyping());

        // Group info
        document.getElementById('group-info-btn').addEventListener('click', () => {
            UI.toggle('info-sidebar');
        });

        document.getElementById('close-info-btn').addEventListener('click', () => {
            UI.hide('info-sidebar');
        });

        document.getElementById('leave-group-btn').addEventListener('click', () => this.handleLeaveGroup());

        // Search
        document.getElementById('group-search').addEventListener('input', (e) => this.handleSearch(e, 'groups'));
        document.getElementById('user-search').addEventListener('input', (e) => this.handleSearch(e, 'users'));
    }

    setupWebSocketListeners() {
        ws.on('group_message', (data) => this.handleIncomingGroupMessage(data));
        ws.on('private_message', (data) => this.handleIncomingPrivateMessage(data));
        ws.on('user_joined', (data) => this.handleUserJoined(data));
        ws.on('user_left', (data) => this.handleUserLeft(data));
        ws.on('typing_indicator', (data) => this.handleTypingIndicator(data));
        ws.on('message_deleted', (data) => this.handleMessageDeleted(data));
    }

    async handleLogin(e) {
        e.preventDefault();
        
        const identifier = document.getElementById('login-identifier').value;
        const password = document.getElementById('login-password').value;

        try {
            UI.hideError('login-error');
            await api.login(identifier, password);
            
            window.location.reload();
        } catch (error) {
            UI.showError('login-error', error.message);
        }
    }

    async handleRegister(e) {
        e.preventDefault();
        
        const userData = {
            username: document.getElementById('register-username').value,
            email: document.getElementById('register-email').value,
            password: document.getElementById('register-password').value,
            first_name: document.getElementById('register-firstname').value,
            last_name: document.getElementById('register-lastname').value
        };

        try {
            UI.hideError('register-error');
            await api.register(userData);
            
            UI.showToast('Account created! Please login.', 'success');
            
            // Switch to login form
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('login-form').classList.remove('hidden');
        } catch (error) {
            UI.showError('register-error', error.message);
        }
    }

    handleLogout() {
        ws.disconnect();
        api.logout();
    }

    handleTabSwitch(e) {
        const tabName = e.currentTarget.dataset.tab;
        
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        e.currentTarget.classList.add('active');
        
        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`${tabName}-tab`).classList.add('active');
    }

    async loadGroups() {
        UI.showLoading('groups-list');
        
        try {
            const response = await api.getGroups();
            const groups = response.results || response;
            
            const container = document.getElementById('groups-list');
            container.innerHTML = '';
            
            if (groups.length === 0) {
                container.innerHTML = '<div class="loading">No groups yet</div>';
                return;
            }
            
            groups.forEach(group => {
                const item = UI.createGroupItem(group);
                item.addEventListener('click', () => this.openGroupChat(group));
                container.appendChild(item);
            });
        } catch (error) {
            console.error('Failed to load groups:', error);
            UI.showToast('Failed to load groups', 'error');
        }
    }

    async loadUsers() {
        UI.showLoading('users-list');
        
        try {
            const response = await api.getUsers();
            const users = response.results || response;
            
            const container = document.getElementById('users-list');
            container.innerHTML = '';
            
            users.forEach(user => {
                const item = UI.createUserItem(user);
                if (item) {
                    item.addEventListener('click', () => this.openPrivateChat(user));
                    container.appendChild(item);
                }
            });
        } catch (error) {
            console.error('Failed to load users:', error);
            UI.showToast('Failed to load users', 'error');
        }
    }

    async openGroupChat(group) {
        this.currentChat = {
            type: 'group',
            id: group.id,
            data: group
        };

        // Update UI
        UI.hide('empty-state');
        UI.show('chat-header');
        UI.show('messages-container');
        UI.show('message-input-container');

        document.getElementById('chat-title').textContent = group.name;
        document.getElementById('chat-subtitle').textContent = `${group.member_count} members`;
        document.getElementById('chat-avatar-initials').textContent = UI.getInitials(group.name);

        // Mark as active in sidebar
        document.querySelectorAll('.list-item').forEach(item => item.classList.remove('active'));
        document.querySelector(`[data-group-id="${group.id}"]`)?.classList.add('active');

        // Subscribe to WebSocket group
        ws.subscribeToGroup(group.id);

        // Load messages
        await this.loadMessages();

        // Load group info
        await this.loadGroupInfo(group.id);
    }

    async openPrivateChat(user) {
        this.currentChat = {
            type: 'private',
            id: user.id,
            data: user
        };

        // Update UI
        UI.hide('empty-state');
        UI.show('chat-header');
        UI.show('messages-container');
        UI.show('message-input-container');
        UI.hide('group-info-btn');

        document.getElementById('chat-title').textContent = user.username;
        document.getElementById('chat-subtitle').textContent = user.email;
        document.getElementById('chat-avatar-initials').textContent = UI.getInitials(user.username);

        // Mark as active in sidebar
        document.querySelectorAll('.list-item').forEach(item => item.classList.remove('active'));
        document.querySelector(`[data-user-id="${user.id}"]`)?.classList.add('active');

        // Load messages
        await this.loadMessages();
    }

    async loadMessages() {
        UI.clearList('messages-list');
        
        try {
            const filters = {};
            
            if (this.currentChat.type === 'group') {
                filters.group = this.currentChat.id;
                filters.message_type = 'group';
            } else {
                filters.recipient = this.currentChat.id;
                filters.message_type = 'private';
            }

            const response = await api.getMessages(filters);
            const messages = response.results || response;

            const container = document.getElementById('messages-list');
            
            messages.forEach(message => {
                const messageElement = UI.createMessage(message);
                container.appendChild(messageElement);
            });

            UI.scrollToBottom('messages-container');
        } catch (error) {
            console.error('Failed to load messages:', error);
            UI.showToast('Failed to load messages', 'error');
        }
    }

    async loadGroupInfo(groupId) {
        try {
            const members = await api.getGroupMembers(groupId);
            
            document.getElementById('info-member-count').textContent = members.count;
            
            const container = document.getElementById('info-members-list');
            container.innerHTML = '';
            
            members.members.forEach(member => {
                const div = document.createElement('div');
                div.className = 'member-item';
                div.innerHTML = `
                    <div class="avatar">
                        <span>${UI.getInitials(member.user.username)}</span>
                    </div>
                    <div class="member-info">
                        <div class="member-name">${UI.escapeHtml(member.user.username)}</div>
                        <div class="member-role">${member.is_admin ? 'Admin' : 'Member'}</div>
                    </div>
                `;
                container.appendChild(div);
            });
        } catch (error) {
            console.error('Failed to load group info:', error);
        }
    }

    async handleCreateGroup(e) {
        e.preventDefault();
        
        const name = document.getElementById('group-name').value;
        const description = document.getElementById('group-description').value;

        try {
            await api.createGroup(name, description);
            
            UI.showToast('Group created successfully!', 'success');
            document.getElementById('create-group-modal').classList.remove('show');
            document.getElementById('create-group-form').reset();
            
            await this.loadGroups();
        } catch (error) {
            UI.showToast(error.message, 'error');
        }
    }

    async handleSendMessage(e) {
        e.preventDefault();
        
        const input = document.getElementById('message-input');
        const content = input.value.trim();
        
        if (!content || !this.currentChat) return;

        try {
            const messageData = {
                content,
                message_type: this.currentChat.type
            };

            if (this.currentChat.type === 'group') {
                messageData.group = this.currentChat.id;
            } else {
                messageData.recipient_id = this.currentChat.id;
            }

            await api.sendMessage(messageData);
            
            input.value = '';
        } catch (error) {
            UI.showToast('Failed to send message', 'error');
        }
    }

    handleTyping() {
        if (this.currentChat?.type !== 'group') return;

        // Send typing indicator
        ws.sendTypingIndicator(this.currentChat.id, true);

        // Clear previous timeout
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }

        // Stop typing after 3 seconds
        this.typingTimeout = setTimeout(() => {
            ws.sendTypingIndicator(this.currentChat.id, false);
        }, 3000);
    }

    handleIncomingGroupMessage(data) {
        // Only show if this is the current chat
        if (this.currentChat?.type === 'group' && this.currentChat.id === data.group_id) {
            const messageElement = UI.createMessage(data);
            document.getElementById('messages-list').appendChild(messageElement);
            UI.scrollToBottom('messages-container');
        }
    }

    handleIncomingPrivateMessage(data) {
        const currentUser = api.getCurrentUser();
        const otherUserId = data.sender_id === currentUser.id ? data.recipient_id : data.sender_id;

        // Only show if this is the current chat
        if (this.currentChat?.type === 'private' && this.currentChat.id === otherUserId) {
            const messageElement = UI.createMessage(data);
            document.getElementById('messages-list').appendChild(messageElement);
            UI.scrollToBottom('messages-container');
        }
    }

    handleUserJoined(data) {
        if (this.currentChat?.type === 'group' && this.currentChat.id === data.group_id) {
            UI.showToast(`${data.username} joined the group`, 'info');
            this.loadGroupInfo(data.group_id);
        }
    }

    handleUserLeft(data) {
        if (this.currentChat?.type === 'group' && this.currentChat.id === data.group_id) {
            UI.showToast(`${data.username} left the group`, 'info');
            this.loadGroupInfo(data.group_id);
        }
    }

    handleTypingIndicator(data) {
        if (this.currentChat?.type === 'group' && this.currentChat.id === data.group_id) {
            const currentUser = api.getCurrentUser();
            
            // Don't show typing indicator for current user
            if (data.user_id === currentUser.id) return;

            const typingIndicator = document.getElementById('typing-indicator');
            const typingText = document.getElementById('typing-text');

            if (data.is_typing) {
                typingText.textContent = `${data.username} is typing...`;
                typingIndicator.classList.remove('hidden');
            } else {
                typingIndicator.classList.add('hidden');
            }
        }
    }

    handleMessageDeleted(data) {
        const messageElement = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (messageElement) {
            messageElement.remove();
            UI.showToast('Message deleted', 'info');
        }
    }

    async handleLeaveGroup() {
        if (!this.currentChat || this.currentChat.type !== 'group') return;

        if (!confirm('Are you sure you want to leave this group?')) return;

        try {
            await api.leaveGroup(this.currentChat.id);
            
            UI.showToast('Left group successfully', 'success');
            UI.hide('info-sidebar');
            
            // Clear chat
            this.currentChat = null;
            UI.show('empty-state');
            UI.hide('chat-header');
            UI.hide('messages-container');
            UI.hide('message-input-container');
            
            // Reload groups
            await this.loadGroups();
        } catch (error) {
            UI.showToast(error.message, 'error');
        }
    }

    handleSearch(e, type) {
        const query = e.target.value.toLowerCase();
        const listId = type === 'groups' ? 'groups-list' : 'users-list';
        const items = document.querySelectorAll(`#${listId} .list-item`);

        items.forEach(item => {
            const title = item.querySelector('.list-item-title').textContent.toLowerCase();
            const subtitle = item.querySelector('.list-item-subtitle').textContent.toLowerCase();
            
            if (title.includes(query) || subtitle.includes(query)) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new MessagingApp();
});