// ============================================================================
// FILE: app.js - Complete Application Logic (WhatsApp-style)
// FIXED: Ensures all received messages go LEFT, all sent messages go RIGHT
// ============================================================================

class MessagingApp {
    constructor() {
        this.currentChat = null;
        this.typingTimeout = null;
        this.currentUser = null;
        this.myGroups = [];
        this.availableGroups = [];
        this.users = [];
        this.messageObserver = null;
        this.init();
    }

    async init() {
        // Check if user is logged in
        const token = localStorage.getItem(CONFIG.TOKEN_KEY);
        
        if (token) {
            try {
                // CRITICAL: Always load user details from API, not localStorage
                await this.loadCurrentUserDetails();
                
                if (!this.currentUser || !this.currentUser.id) {
                    console.error('Failed to load user details, logging out');
                    this.handleLogout();
                    return;
                }
                
                console.log('✅ Logged in as:', this.currentUser);
                
                UI.showScreen('chat-screen');
                await this.initializeChat();
            } catch (error) {
                console.error('Initialization failed:', error);
                this.handleLogout();
                return;
            }
        } else {
            UI.showScreen('login-screen');
        }

        this.setupEventListeners();
    }


    debugInfo() {
        console.log('\n' + '='.repeat(70));
        console.log('APP DEBUG INFO');
        console.log('='.repeat(70));
        console.log('Current User:');
        console.log('  ID:', this.currentUser?.id);
        console.log('  Username:', this.currentUser?.username);
        console.log('  Email:', this.currentUser?.email);
        console.log('');
        console.log('Current Chat:');
        console.log('  Type:', this.currentChat?.type);
        console.log('  ID:', this.currentChat?.id);
        console.log('  Data:', this.currentChat?.data);
        console.log('');
        console.log('ID Comparison:');
        if (this.currentChat && this.currentUser) {
            const chatId = String(this.currentChat.id);
            const userId = String(this.currentUser.id);
            console.log('  Chat ID:', chatId);
            console.log('  User ID:', userId);
            console.log('  Are Equal:', chatId === userId);
            console.log('  ⚠️  Should be FALSE for private chats!');
        }
        console.log('');
        console.log('Users List:', this.users.length, 'users');
        this.users.forEach((u, i) => {
            const isCurrent = String(u.id) === String(this.currentUser?.id);
            console.log(`  ${i + 1}. ${u.username} (${u.id})${isCurrent ? ' ← CURRENT USER' : ''}`);
        });
        console.log('='.repeat(70) + '\n');
        
        return {
            currentUser: this.currentUser,
            currentChat: this.currentChat,
            usersCount: this.users.length
        };
    }

    async loadCurrentUserDetails() {
    try {
        console.log('Loading current user details from API...');
            const response = await api.request('/users/me/');
            
            if (!response || !response.id) {
                throw new Error('Invalid user response from API');
            }
            
            this.currentUser = {
                id: response.id,
                username: response.username,
                email: response.email,
                first_name: response.first_name,
                last_name: response.last_name
            };
            
            // Update localStorage with correct user ID
            localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(this.currentUser.id));
            
            console.log('✅ Current user loaded:', this.currentUser);
    } catch (error) {
            console.error('❌ Failed to load user details:', error);
            throw error;  // Propagate error so init() can handle it
        }
}

    async initializeChat() {
        // Load user info
        const username = this.currentUser.username || 'User';
        document.getElementById('current-user-name').textContent = username;
        document.getElementById('current-user-initials').textContent = UI.getInitials(username);

        console.log('Current User ID:', this.currentUser.id); // Debug log

        // Connect WebSocket
        // Connect WebSocket
        const token = localStorage.getItem(CONFIG.TOKEN_KEY);
        ws.connect(token);
        this.setupWebSocketListeners();

        // Load initial data
        await this.loadGroups();
        await this.loadUsers();
        
        // Setup message read tracking
        this.setupMessageReadTracking();
    }

    setupEventListeners() {
        // ====================================================================
        // Authentication Events
        // ====================================================================
        document.getElementById('login-form')?.addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('register-form')?.addEventListener('submit', (e) => this.handleRegister(e));
        
        document.getElementById('show-register')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('register-form').classList.remove('hidden');
        });
        
        document.getElementById('show-login')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('login-form').classList.remove('hidden');
        });

        // Logout
        document.getElementById('logout-btn')?.addEventListener('click', () => this.handleLogout());

        // ====================================================================
        // Sidebar Tabs
        // ====================================================================
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleTabSwitch(e));
        });

        // ====================================================================
        // Group Actions
        // ====================================================================
        document.getElementById('create-group-btn')?.addEventListener('click', () => {
            document.getElementById('create-group-modal').classList.add('show');
        });

        document.getElementById('empty-new-group-btn')?.addEventListener('click', () => {
            document.getElementById('create-group-modal').classList.add('show');
        });

        document.getElementById('create-group-form')?.addEventListener('submit', (e) => this.handleCreateGroup(e));

        // ====================================================================
        // Modal Close Buttons
        // ====================================================================
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.modal')?.classList.remove('show');
            });
        });

        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                e.target.closest('.modal')?.classList.remove('show');
            });
        });

        // ====================================================================
        // Message Form
        // ====================================================================
        document.getElementById('message-form')?.addEventListener('submit', (e) => this.handleSendMessage(e));
        document.getElementById('message-input')?.addEventListener('input', () => this.handleTyping());

        // ====================================================================
        // Group Info Sidebar
        // ====================================================================
        document.getElementById('group-info-btn')?.addEventListener('click', () => {
            UI.toggle('info-sidebar');
        });

        document.getElementById('close-info-btn')?.addEventListener('click', () => {
            UI.hide('info-sidebar');
        });

        document.getElementById('leave-group-btn')?.addEventListener('click', () => this.handleLeaveGroup());

        // ====================================================================
        // Search
        // ====================================================================
        document.getElementById('group-search')?.addEventListener('input', UI.debounce((e) => {
            this.handleSearch(e.target.value, 'groups');
        }, 300));

        document.getElementById('user-search')?.addEventListener('input', UI.debounce((e) => {
            this.handleSearch(e.target.value, 'users');
        }, 300));

        // ====================================================================
        // Mobile Back Button
        // ====================================================================
        document.getElementById('mobile-back-btn')?.addEventListener('click', () => {
            document.querySelector('.sidebar')?.classList.add('mobile-open');
            UI.hide('chat-header');
            UI.hide('messages-container');
            UI.hide('message-input-container');
            UI.show('empty-state');
        });

        // ====================================================================
        // Context Menu for Messages
        // ====================================================================
        document.addEventListener('messageAction', (e) => this.handleMessageAction(e.detail));
    }

    setupWebSocketListeners() {
        ws.on('connected', () => {
            console.log('WebSocket connected');
            UI.showToast('Connected', 'success', 2000);
            
            // Subscribe to all groups user is part of
            this.myGroups.forEach(group => {
                ws.subscribeToGroup(group.id);
            });
        });

        ws.on('group_message', (data) => this.handleIncomingGroupMessage(data));
        ws.on('private_message', (data) => this.handleIncomingPrivateMessage(data));
        ws.on('user_joined', (data) => this.handleUserJoined(data));
        ws.on('user_left', (data) => this.handleUserLeft(data));
        ws.on('user_removed', (data) => this.handleUserRemoved(data));
        ws.on('member_promoted', (data) => this.handleMemberPromoted(data));
        ws.on('typing_indicator', (data) => this.handleTypingIndicator(data));
        ws.on('message_deleted', (data) => this.handleMessageDeleted(data));
        ws.on('message_read', (data) => this.handleMessageRead(data));
        
        ws.on('disconnected', () => {
            UI.showToast('Disconnected', 'warning');
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            UI.showToast('Connection error', 'error');
        });
    }

    setupMessageReadTracking() {
        // Setup intersection observer to mark messages as read when they become visible
        const options = {
            root: document.getElementById('messages-container'),
            threshold: 0.5
        };

        this.messageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const messageId = entry.target.dataset.messageId;
                    const senderId = entry.target.dataset.senderId;
                    
                    // Only mark as read if it's not our message
                    if (senderId && senderId !== String(this.currentUser.id) && messageId) {
                        this.markMessageAsRead(messageId);
                    }
                }
            });
        }, options);
    }

    async markMessageAsRead(messageId) {
        try {
            // Send read receipt via WebSocket
            ws.send('mark_read', {
                message_id: messageId
            });
            
            // Also send to API for persistence
            await api.markMessagesAsRead([messageId]);
        } catch (error) {
            console.error('Failed to mark message as read:', error);
        }
    }

    // ========================================================================
    // Authentication Handlers
    // ========================================================================

    async handleLogin(e) {
        e.preventDefault();
        
        const identifier = document.getElementById('login-identifier').value;
        const password = document.getElementById('login-password').value;
        const btn = e.target.querySelector('button[type="submit"]');

        try {
            UI.hideError('login-error');
            btn.classList.add('loading');
            
            const response = await api.login(identifier, password);
            
            // Verify we got user data
            if (!response.user || !response.user.id) {
                throw new Error('Invalid login response - no user data');
            }
            
            console.log('✅ Login successful, user:', response.user);
            
            window.location.reload();
        } catch (error) {
            console.error('❌ Login failed:', error);
            UI.showError('login-error', error.message);
        } finally {
            btn.classList.remove('loading');
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

        const btn = e.target.querySelector('button[type="submit"]');

        try {
            UI.hideError('register-error');
            btn.classList.add('loading');
            
            await api.register(userData);
            
            UI.showToast('Account created! Please login.', 'success');
            
            // Switch to login form
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('login-form').classList.remove('hidden');
        } catch (error) {
            UI.showError('register-error', error.message);
        } finally {
            btn.classList.remove('loading');
        }
    }

    handleLogout() {
        if (confirm('Are you sure you want to logout?')) {
            ws.disconnect();
            api.logout();
        }
    }

    // ========================================================================
    // Tab Management
    // ========================================================================

    handleTabSwitch(e) {
        const tabName = e.currentTarget.dataset.tab;
        
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        e.currentTarget.classList.add('active');
        
        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`${tabName}-tab`)?.classList.add('active');
    }

    // ========================================================================
    // Load Groups (Separated: My Groups vs Available Groups)
    // ========================================================================

    async loadGroups() {
        UI.showLoading('groups-list');
        
        try {
            const response = await api.getGroups();
            const allGroups = response.results || response;
            
            // Separate groups: user is member vs available to join
            this.myGroups = allGroups.filter(g => g.is_member);
            this.availableGroups = allGroups.filter(g => !g.is_member);
            
            this.renderGroups();
        } catch (error) {
            console.error('Failed to load groups:', error);
            UI.showToast('Failed to load groups', 'error');
        }
    }

    renderGroups(searchQuery = '') {
        const container = document.getElementById('groups-list');
        container.innerHTML = '';
        
        const query = searchQuery.toLowerCase();
        
        // Filter groups based on search
        const filteredMyGroups = this.myGroups.filter(g => 
            g.name.toLowerCase().includes(query)
        );
        const filteredAvailable = this.availableGroups.filter(g => 
            g.name.toLowerCase().includes(query)
        );
        
        // My Groups Section
        if (filteredMyGroups.length > 0) {
            const myGroupsHeader = document.createElement('div');
            myGroupsHeader.className = 'list-section-header';
            myGroupsHeader.innerHTML = '<h4>My Groups</h4>';
            container.appendChild(myGroupsHeader);
            
            filteredMyGroups.forEach(group => {
                const item = UI.createGroupItem(group);
                item.addEventListener('click', () => this.openGroupChat(group));
                container.appendChild(item);
            });
        }
        
        // Available Groups Section
        if (filteredAvailable.length > 0) {
            const availableHeader = document.createElement('div');
            availableHeader.className = 'list-section-header';
            availableHeader.innerHTML = '<h4>Available Groups</h4>';
            container.appendChild(availableHeader);
            
            filteredAvailable.forEach(group => {
                const item = this.createAvailableGroupItem(group);
                container.appendChild(item);
            });
        }
        
        // Empty state
        if (filteredMyGroups.length === 0 && filteredAvailable.length === 0) {
            container.innerHTML = '<div class="empty-list">No groups found</div>';
        }
    }

    createAvailableGroupItem(group) {
        const div = document.createElement('div');
        div.className = 'list-item available-group';
        div.dataset.groupId = group.id;
        
        const avatarColor = UI.generateAvatarColor(group.name);
        
        div.innerHTML = `
            <div class="avatar" style="background: ${avatarColor}">
                <span>${UI.getInitials(group.name)}</span>
            </div>
            <div class="list-item-content">
                <div class="list-item-title">${UI.escapeHtml(group.name)}</div>
                <div class="list-item-subtitle">${group.member_count} members</div>
            </div>
            <button class="btn btn-primary btn-sm join-group-btn" data-group-id="${group.id}">
                Join
            </button>
        `;
        
        // Join button handler
        div.querySelector('.join-group-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.handleJoinGroup(group.id);
        });
        
        return div;
    }

    async handleJoinGroup(groupId) {
        try {
            await api.joinGroup(groupId);
            UI.showToast('Joined group successfully', 'success');
            
            // Reload groups to update lists
            await this.loadGroups();
            
            // Subscribe to group via WebSocket
            ws.subscribeToGroup(groupId);
        } catch (error) {
            UI.showToast(error.message, 'error');
        }
    }

    // ========================================================================
    // Load Users
    // ========================================================================

    async loadUsers() {
        UI.showLoading('users-list');
        
        try {
            const response = await api.getUsers();
            this.users = response.results || response;
            
            // CRITICAL: Normalize all IDs to numbers
            this.users = this.users.map(user => ({
                ...user,
                id: user.id
            }));
            
            console.log('Loaded users:', this.users.length);
            console.log('Current user ID:', this.currentUser.id);
            
            this.renderUsers();
        } catch (error) {
            console.error('Failed to load users:', error);
            UI.showToast('Failed to load users', 'error');
        }
    }

    renderUsers(searchQuery = '') {
        const container = document.getElementById('users-list');
        container.innerHTML = '';
        
        const query = searchQuery.toLowerCase();
        
        // CRITICAL: Filter out current user
        const filteredUsers = this.users.filter(user => {
            if (user.id === this.currentUser.id) {
                return false;
            }
            
            if (query) {
                return user.username.toLowerCase().includes(query) ||
                    (user.email && user.email.toLowerCase().includes(query));
            }
            
            return true;
        });
        
        console.log(`Rendering ${filteredUsers.length} users`);
        
        if (filteredUsers.length === 0) {
            container.innerHTML = '<div class="empty-list">No users found</div>';
            return;
        }
        
        filteredUsers.forEach(user => {
            const item = UI.createUserItem(user, this.currentUser.id);
            if (item) {
                item.addEventListener('click', () => this.openPrivateChat(user));
                container.appendChild(item);
            }
        });
    }

    // ========================================================================
    // Search Handler
    // ========================================================================

    handleSearch(query, type) {
        if (type === 'groups') {
            this.renderGroups(query);
        } else if (type === 'users') {
            this.renderUsers(query);
        }
    }

    // ========================================================================
    // Open Chat (Group or Private)
    // ========================================================================

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
        document.getElementById('group-info-btn').style.display = 'flex';

        document.getElementById('chat-title').textContent = group.name;
        document.getElementById('chat-subtitle').textContent = `${group.member_count} members`;
        document.getElementById('chat-avatar-initials').textContent = UI.getInitials(group.name);

        // Mark as active in sidebar
        document.querySelectorAll('.list-item').forEach(item => item.classList.remove('active'));
        document.querySelector(`[data-group-id="${group.id}"]`)?.classList.add('active');

        // Subscribe to WebSocket group
        ws.subscribeToGroup(group.id);

        // Load messages (bottom to top order)
        await this.loadMessages();

        // Load group info
        await this.loadGroupInfo(group.id);
        
        // Mobile: hide sidebar
        if (UI.isMobile()) {
            document.querySelector('.sidebar')?.classList.remove('mobile-open');
        }
    }

  async openPrivateChat(user) {
        console.log('Opening chat with:', user.username);
        
        // CRITICAL: Normalize IDs
        const selectedUserId = user.id;
        const currentUserId = this.currentUser.id;
        
        // SAFETY CHECK: Prevent self-chat
        if (selectedUserId === currentUserId) {
            console.error('ERROR: Cannot chat with yourself!');
            console.error('Selected user:', user);
            console.error('Current user:', this.currentUser);
            UI.showToast('Cannot chat with yourself', 'error');
            return;
        }
        
        // Clear previous highlights
        document.querySelectorAll('.list-item.active').forEach(item => {
            item.classList.remove('active');
        });
        
        // Highlight selected user
        const userElement = document.querySelector(`[data-user-id="${selectedUserId}"]`);
        if (userElement) {
            userElement.classList.add('active');
        }
        
        // Set current chat - currentChat.id is ALWAYS the OTHER user
        this.currentChat = {
            type: 'private',
            id: selectedUserId,  // This is the recipient (other user)
            data: {
                ...user,
                id: selectedUserId
            }
        };

        console.log('Current chat set to:', this.currentChat);

        // Update UI - CRITICAL: Ensure message input is shown
        UI.hide('empty-state');
        UI.show('chat-header');
        UI.show('messages-container');
        UI.show('message-input-container'); // This is critical!
        
        // Force display on mobile
        const inputContainer = document.getElementById('message-input-container');
        if (inputContainer) {
            inputContainer.classList.remove('hidden');
            inputContainer.style.display = 'flex';
        }
        
        document.getElementById('group-info-btn').style.display = 'none';

        document.getElementById('chat-title').textContent = user.username;
        document.getElementById('chat-subtitle').textContent = user.email || 'Private chat';
        document.getElementById('chat-avatar-initials').textContent = UI.getInitials(user.username);

        // Load messages
        await this.loadMessages();
        
        // Mobile: hide sidebar
        if (UI.isMobile()) {
            document.querySelector('.sidebar')?.classList.remove('mobile-open');
        }
    }

    // ========================================================================
    // Load Messages (BOTTOM TO TOP - WhatsApp Style)
    // FIXED: Proper alignment based on sender ID comparison
    // ========================================================================

    async loadMessages() {
        const container = document.getElementById('messages-list');
        container.innerHTML = '';
        
        try {
            let messages = [];
            
            if (this.currentChat.type === 'group') {
                const filters = {
                    group: this.currentChat.id,
                    message_type: 'group'
                };
                console.log('Loading group messages:', filters);
                const response = await api.getMessages(filters);
                messages = response.results || response;
            } else {
                // FIXED: For private chats, fetch messages in BOTH directions
                const otherUserId = this.currentChat.id;
                const currentUserId = this.currentUser.id;
                
                console.log(`Loading private messages between ${currentUserId} and ${otherUserId}`);
                
                // Fetch all private messages and filter for this conversation
                const response = await api.getMessages({ message_type: 'private' });
                const allPrivateMessages = response.results || response;
                
                // Filter messages that belong to this conversation (either direction)
                messages = allPrivateMessages.filter(msg => {
                    const senderId = msg.sender_id || msg.sender?.id;
                    const recipientId = msg.recipient_id || msg.recipient?.id;
                    
                    // Message is part of this conversation if:
                    // - Current user sent to other user, OR
                    // - Other user sent to current user
                    return (
                        (senderId === currentUserId && recipientId === otherUserId) ||
                        (senderId === otherUserId && recipientId === currentUserId)
                    );
                });
            }
            
            console.log(`Loaded ${messages.length} messages`);
            
            messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            
            this.renderMessagesWithDates(messages);
            
            setTimeout(() => {
                UI.scrollToBottom('messages-container', false);
            }, 100);
        } catch (error) {
            console.error('Load messages failed:', error);
            UI.showToast('Failed to load messages', 'error');
        }
    }

    renderMessagesWithDates(messages) {
        const container = document.getElementById('messages-list');
        let lastDate = null;
        
        messages.forEach(message => {
            const messageDate = new Date(message.created_at).toDateString();
            
            // Add date divider if date changed
            if (messageDate !== lastDate) {
                const divider = UI.createDateDivider(message.created_at);
                container.appendChild(divider);
                lastDate = messageDate;
            }
            
            // CRITICAL: Pass current user ID to ensure proper alignment
            const messageElement = UI.createMessage(message, this.currentUser.id);
            
            // Debug log to verify alignment
            const senderId = message.sender_id || message.sender?.id;
            const isOwn = senderId === this.currentUser.id;
            console.log(`Message from ${senderId}, Current user: ${this.currentUser.id}, Is own: ${isOwn}`);
            
            container.appendChild(messageElement);
            
            // Observe message for read tracking (only for received messages)
            if (this.messageObserver && !isOwn) {
                this.messageObserver.observe(messageElement);
            }
        });
    }

    // ========================================================================
    // Load Group Info with Admin Controls
    // ========================================================================

    async loadGroupInfo(groupId) {
        try {
            const groupDetails = await api.getGroup(groupId);
            const members = await api.getGroupMembers(groupId);
            
            document.getElementById('info-member-count').textContent = members.count;
            document.getElementById('info-description').textContent = groupDetails.description || 'No description';
            document.getElementById('info-group-name').textContent = groupDetails.name;
            document.getElementById('info-avatar-initials').textContent = UI.getInitials(groupDetails.name);
            
            const container = document.getElementById('info-members-list');
            container.innerHTML = '';
            
            const isAdmin = groupDetails.is_admin;
            const isCreator = groupDetails.created_by?.id === this.currentUser.id;
            
            members.members.forEach(member => {
                const memberDiv = this.createMemberItemWithControls(member, isAdmin, isCreator);
                container.appendChild(memberDiv);
            });
        } catch (error) {
            console.error('Failed to load group info:', error);
        }
    }

    createMemberItemWithControls(member, currentUserIsAdmin, currentUserIsCreator) {
        const div = document.createElement('div');
        div.className = 'member-item';
        div.dataset.userId = member.user.id;
        
        const avatarColor = UI.generateAvatarColor(member.user.username);
        const isCurrentUser = member.user.id === this.currentUser.id;
        
        div.innerHTML = `
            <div class="avatar avatar-sm" style="background: ${avatarColor}">
                <span>${UI.getInitials(member.user.username)}</span>
            </div>
            <div class="member-info">
                <div class="member-name">
                    ${UI.escapeHtml(member.user.username)}
                    ${isCurrentUser ? ' (You)' : ''}
                </div>
                <div class="member-role">
                    ${member.is_admin ? '👑 Admin' : 'Member'}
                </div>
            </div>
            ${currentUserIsAdmin && !isCurrentUser ? `
                <div class="member-actions">
                    ${!member.is_admin ? `
                        <button class="btn-icon btn-sm" title="Make Admin" data-action="promote" data-user-id="${member.user.id}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                            </svg>
                        </button>
                    ` : ''}
                    <button class="btn-icon btn-sm btn-danger" title="Remove Member" data-action="remove" data-user-id="${member.user.id}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            ` : ''}
        `;
        
        // Add event listeners for admin actions
        if (currentUserIsAdmin && !isCurrentUser) {
            div.querySelector('[data-action="promote"]')?.addEventListener('click', () => {
                this.handlePromoteMember(member.user.id, member.user.username);
            });
            
            div.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
                this.handleRemoveMember(member.user.id, member.user.username);
            });
        }
        
        return div;
    }

    async handlePromoteMember(userId, username) {
        if (!confirm(`Make ${username} an admin?`)) return;
        
        try {
            await api.promoteMember(this.currentChat.id, userId);
            UI.showToast(`${username} is now an admin`, 'success');
            await this.loadGroupInfo(this.currentChat.id);
        } catch (error) {
            UI.showToast(error.message, 'error');
        }
    }

    async handleRemoveMember(userId, username) {
        if (!confirm(`Remove ${username} from the group?`)) return;
        
        try {
            await api.removeMember(this.currentChat.id, userId);
            UI.showToast(`${username} has been removed`, 'success');
            await this.loadGroupInfo(this.currentChat.id);
        } catch (error) {
            UI.showToast(error.message, 'error');
        }
    }

    // ========================================================================
    // Send Message (Appears on Right for Sender)
    // ========================================================================

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
                // CRITICAL FIX: For private chats, currentChat.id is the OTHER user
                const recipientId = this.currentChat.id;
                const currentUserId = this.currentUser.id;
                
                console.log(`Sending private message: current user=${currentUserId}, recipient=${recipientId}`);
                
                // Validate we're not sending to ourselves
                if (recipientId === currentUserId) {
                    console.error('ERROR: Attempting to send message to self!');
                    console.error('currentChat:', this.currentChat);
                    console.error('currentUser:', this.currentUser);
                    throw new Error('Cannot send message to yourself');
                }
                
                messageData.recipient_id = recipientId;
            }

            console.log('Sending message data:', messageData);

            const savedMessage = await api.sendMessage(messageData);
            
            console.log('Message sent successfully:', savedMessage);
            
            // Clear input
            input.value = '';
            input.style.height = 'auto';
            
            setTimeout(() => UI.scrollToBottom('messages-container'), 100);
        } catch (error) {
            console.error('Send failed:', error);
            UI.showToast('Failed to send: ' + error.message, 'error');
        }
    }

    addMessageToUI(message) {
        const container = document.getElementById('messages-list');
        const lastMessage = container.lastElementChild;
        
        // Check if we need a date divider
        if (lastMessage && !lastMessage.classList.contains('date-divider')) {
            const lastDate = lastMessage.dataset.date;
            const messageDate = new Date(message.created_at || message.timestamp).toDateString();
            
            if (lastDate !== messageDate) {
                const divider = UI.createDateDivider(message.created_at || message.timestamp);
                container.appendChild(divider);
            }
        } else if (!lastMessage) {
            // First message - add date divider
            const divider = UI.createDateDivider(message.created_at || message.timestamp);
            container.appendChild(divider);
        }
        
        // CRITICAL: Pass current user ID to ensure proper alignment
        const messageElement = UI.createMessage(message, this.currentUser.id);
        messageElement.dataset.date = new Date(message.created_at || message.timestamp).toDateString();
        container.appendChild(messageElement);
        
        // Observe message for read tracking (only for received messages)
        const senderId = message.sender_id || message.sender?.id;
        const isOwn = senderId === this.currentUser.id;
        if (this.messageObserver && !isOwn) {
            this.messageObserver.observe(messageElement);
        }
    }

    // ========================================================================
    // Typing Indicator
    // ========================================================================

    handleTyping() {
    if (!this.currentChat) return;

    // Send typing indicator via WebSocket (more efficient)
    if (this.currentChat.type === 'group') {
        ws.sendTypingIndicator(this.currentChat.id, true);
    } else {
        // For private chat, also use WebSocket
        ws.send('typing_indicator', {
            recipient_id: this.currentChat.id,
            is_typing: true
        });
    }

    // Clear previous timeout
    if (this.typingTimeout) {
        clearTimeout(this.typingTimeout);
    }

    // Stop typing after 3 seconds
    this.typingTimeout = setTimeout(() => {
        if (this.currentChat.type === 'group') {
            ws.sendTypingIndicator(this.currentChat.id, false);
        } else {
            ws.send('typing_indicator', {
                recipient_id: this.currentChat.id,
                is_typing: false
            });
        }
    }, 3000);
    }

    // ========================================================================
    // WebSocket Event Handlers
    // ========================================================================

    handleIncomingGroupMessage(data) {
        console.log('Incoming group message:', data);
        console.log('Current user ID:', this.currentUser.id);
        console.log('Sender ID:', data.sender_id);
        console.log('Is own message?', data.sender_id === this.currentUser.id);

        // Only show if this is the current chat
        if (this.currentChat?.type === 'group' && this.currentChat.id === data.group_id) {
            this.addMessageToUI(data);
            UI.scrollToBottom('messages-container');
            
            // Mark as read if message is visible
            if (data.sender_id !== this.currentUser.id) {
                setTimeout(() => this.markMessageAsRead(data.message_id), 500);
            }
        } else {
            // Show notification
            UI.showNotification('New message', {
                body: `${data.sender_username} in ${data.group_name}: ${data.content}`,
                tag: data.message_id
            });
        }
    }

    handleIncomingPrivateMessage(data) {
        console.log('Private message received:', data);
        
        const senderId = data.sender_id;
        const recipientId = data.recipient_id;
        const currentUserId = this.currentUser.id;
        
        // Determine other user
        const otherUserId = senderId === currentUserId ? recipientId : senderId;

        // Only show if current chat
        if (this.currentChat?.type === 'private' && this.currentChat.id === otherUserId) {
            this.addMessageToUI(data);
            UI.scrollToBottom('messages-container');
            
            if (senderId !== currentUserId) {
                setTimeout(() => this.markMessageAsRead(data.message_id), 500);
            }
        } else {
            UI.showNotification('New message', {
                body: `${data.sender_username}: ${data.content}`,
                tag: data.message_id
            });
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

    handleUserRemoved(data) {
        if (this.currentChat?.type === 'group' && this.currentChat.id === data.group_id) {
            UI.showToast(`${data.username} was removed from the group`, 'warning');
            this.loadGroupInfo(data.group_id);
            
            // If current user was removed, close chat
            if (data.user_id === this.currentUser.id) {
                this.currentChat = null;
                UI.show('empty-state');
                UI.hide('chat-header');
                UI.hide('messages-container');
                UI.hide('message-input-container');
                this.loadGroups();
            }
        }
    }

    handleMemberPromoted(data) {
        if (this.currentChat?.type === 'group' && this.currentChat.id === data.group_id) {
            UI.showToast(`${data.username} is now an admin`, 'success');
            this.loadGroupInfo(data.group_id);
        }
    }

    handleTypingIndicator(data) {
        if (this.currentChat?.type === 'group' && this.currentChat.id === data.group_id) {
            // Don't show typing indicator for current user
            if (data.user_id === this.currentUser.id) return;

            if (data.is_typing) {
                const avatarColor = UI.generateAvatarColor(data.username);
                UI.showTypingIndicator(data.username, avatarColor);
            } else {
                UI.hideTypingIndicator();
            }
        } else if (this.currentChat?.type === 'private') {
            // Private chat typing indicator
            const otherUserId = data.user_id;
            if (this.currentChat.id === otherUserId) {
                if (data.is_typing) {
                    const avatarColor = UI.generateAvatarColor(data.username);
                    UI.showTypingIndicator(data.username, avatarColor);
                } else {
                    UI.hideTypingIndicator();
                }
            }
        }
    }

    handleMessageDeleted(data) {
        const messageElement = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (messageElement) {
            messageElement.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => messageElement.remove(), 300);
        }
    }

    handleMessageRead(data) {
        // Update message status to show double check
        UI.updateMessageStatus(data.message_id, 'read');
    }

    // ========================================================================
    // Message Actions (Context Menu)
    // ========================================================================

    async handleMessageAction(detail) {
        const { action, messageId, messageText } = detail;
        
        switch (action) {
            case 'delete':
                await this.handleDeleteMessage(messageId);
                break;
            case 'copy':
                this.handleCopyMessage(messageText);
                break;
            case 'reply':
                this.handleReplyToMessage(messageText);
                break;
        }
    }

    async handleDeleteMessage(messageId) {
        if (!confirm('Delete this message?')) return;
        
        try {
            await api.deleteMessage(messageId);
            UI.showToast('Message deleted', 'success');
        } catch (error) {
            UI.showToast('Failed to delete message', 'error');
        }
    }

    handleCopyMessage(messageText) {
        navigator.clipboard.writeText(messageText)
            .then(() => UI.showToast('Message copied', 'success'))
            .catch(() => UI.showToast('Failed to copy message', 'error'));
    }

    handleReplyToMessage(messageText) {
        const input = document.getElementById('message-input');
        const senderMatch = messageText.match(/^@(\w+)/);
        if (senderMatch) {
            input.value = `@${senderMatch[1]} `;
        }
        input.focus();
    }

    // ========================================================================
    // Create Group
    // ========================================================================

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

    // ========================================================================
    // Leave Group
    // ========================================================================

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
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new MessagingApp();
});