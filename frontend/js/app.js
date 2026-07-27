/**
 * ============================================================================
 * MessagingApp - Main Application Orchestrator
 * All logic is delegated to specialized managers for clean separation
 * ============================================================================
 */
class MessagingApp {
    constructor() {
        // Core state
        this.currentChat = null;
        this.currentUser = null;
        this.typingTimeout = null;
        this.groupsLoaded = false;
        this.usersLoaded = false;
        this.isLoadingChat = false;

        // Initialize all managers
        this.authManager = new AuthManager(this);
        this.navigationManager = new NavigationManager(this);
        this.chatManager = new ChatManager(this);
        this.groupManager = new GroupManager(this);
        this.userManager = new UserManager(this);
        this.messageHandler = new MessageHandler(this);
        this.webSocketManager = new WebSocketManager(this);

        // Features
        this.profileManager = null; // Initialized after login
        this.globalSearch = null;

        this.init();
    }

    // Property accessors (delegate to managers)
    get allChats() { return this.chatManager.allChats; }
    set allChats(v) { this.chatManager.allChats = v; }
    get myGroups() { return this.groupManager.myGroups; }
    set myGroups(v) { this.groupManager.myGroups = v; }
    get availableGroups() { return this.groupManager.availableGroups; }
    set availableGroups(v) { this.groupManager.availableGroups = v; }
    get users() { return this.userManager.users; }
    set users(v) { this.userManager.users = v; }
    get unreadCounts() { return this.chatManager.unreadCounts; }
    set unreadCounts(v) { this.chatManager.unreadCounts = v; }

    async init() {
        console.log('🚀 Initializing Messaging App...');

        // Hide all screens initially
        document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));

        const token = localStorage.getItem(CONFIG.TOKEN_KEY);
        if (token) {
            try {
                await this.authManager.loadCurrentUserDetails();
                if (!this.currentUser || !this.currentUser.id) {
                    console.error('Failed to load user details, logging out');
                    this.authManager.handleLogout();
                    return;
                }
                console.log('✅ Logged in as:', this.currentUser);
                UI.showScreen('chat-screen');
                await this.initializeChat();
            } catch (error) {
                console.error('Initialization failed:', error);
                this.authManager.handleLogout();
                return;
            }
        } else {
            UI.showScreen('login-screen');
            this.authManager.setupMobileNavForLogin();
        }

        this.setupEventListeners();
        this.navigationManager.setupBrowserBackButton();
        this.setupNetworkListeners();
        this.navigationManager.updateMobileNav();

        // Request notification permission
        document.addEventListener('click', () => {
            if (Notification.permission === 'default') {
                Notification.requestPermission();
            }
        }, { once: true });

        // Reconnect on visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                const token = localStorage.getItem(CONFIG.TOKEN_KEY);
                if (token && !ws.isConnected) {
                    ws.connect(token);
                }
                if (ws.isConnected) ws.send('request_online_users');
            }
        });
    }

    async initializeChat() {
        console.log('🚀 Initializing chat...');

        const username = this.currentUser.username || 'User';
        document.getElementById('current-user-name').textContent = username;
        document.getElementById('current-user-initials').textContent = UI.getInitials(username);

        // Connect WebSocket
        const token = localStorage.getItem(CONFIG.TOKEN_KEY);
        ws.connect(token);
        this.webSocketManager.setupListeners();

        // Load data via managers
        try {
            await Promise.all([
                this.chatManager.loadAllChats(),
                this.chatManager.loadUnreadCounts()
            ]);

            Promise.all([
                this.groupManager.loadGroups(),
                this.userManager.loadUsers()
            ]).then(() => {
                this.groupsLoaded = true;
                this.usersLoaded = true;
            });
        } catch (error) {
            console.error('Error loading data:', error);
            UI.showToast('Error loading data', 'error');
        }

        this.navigationManager.syncMobileNavWithTab();
        this.navigationManager.adjustMobileScrollPadding();

        if (typeof UserProfileManager !== 'undefined') {
            this.profileManager = new UserProfileManager(this);
        }
        if (typeof GlobalSearch !== 'undefined') {
            this.globalSearch = new GlobalSearch(this);
        }

        console.log('✅ Chat initialized');
    }

    setupEventListeners() {
        // Auth events
        document.getElementById('login-form')?.addEventListener('submit', (e) => this.authManager.handleLogin(e));
        document.getElementById('register-form')?.addEventListener('submit', (e) => this.authManager.handleRegister(e));
        document.getElementById('logout-btn')?.addEventListener('click', () => this.authManager.handleLogout());

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

        // Tab events
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.navigationManager.handleTabSwitch(e));
        });

        // Message events
        document.getElementById('message-form')?.addEventListener('submit', (e) => this.messageHandler.handleSendMessage(e));
        document.getElementById('send-btn')?.addEventListener('click', (e) => this.messageHandler.handleSendMessage(e));

        // Typing indicator
        document.getElementById('message-input')?.addEventListener('input', () => {
            if (!this.currentChat || !ws.isConnected) return;
            const content = document.getElementById('message-input')?.value?.trim();
            if (content) {
                const payload = { is_typing: true };
                if (this.currentChat.type === 'group') {
                    payload.group_id = this.currentChat.id;
                } else {
                    payload.recipient_id = this.currentChat.id;
                }
                ws.send('typing_indicator', payload);
                // Auto-stop typing after 2s of inactivity
                this.clearTypingTimeout();
                this.typingTimeout = setTimeout(() => {
                    const stopPayload = { is_typing: false };
                    if (this.currentChat?.type === 'group') {
                        stopPayload.group_id = this.currentChat.id;
                    } else {
                        stopPayload.recipient_id = this.currentChat.id;
                    }
                    ws.send('typing_indicator', stopPayload);
                    this.typingTimeout = null;
                }, 2000);
            } else {
                // Empty input, send stop typing
                this.sendStopTyping();
            }
        });

        // Search events
        document.getElementById('chat-search')?.addEventListener('input', UI.debounce((e) => {
            this.chatManager.handleSearch(e.target.value);
        }, 300));
        document.getElementById('group-search')?.addEventListener('input', UI.debounce((e) => {
            this.groupManager.handleSearch(e.target.value);
        }, 300));
        document.getElementById('user-search')?.addEventListener('input', UI.debounce((e) => {
            this.userManager.handleSearch(e.target.value);
        }, 300));

        // Mobile back
        document.getElementById('mobile-back-btn')?.addEventListener('click', () => {
            this.navigationManager.handleMobileBack();
        });

        // Group creation
        document.getElementById('create-group-btn')?.addEventListener('click', () => {
            document.getElementById('create-group-modal')?.classList.add('show');
        });
        document.getElementById('create-group-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('group-name')?.value.trim();
            const desc = document.getElementById('group-description')?.value.trim();
            if (name) {
                await this.groupManager.handleCreateGroup(name, desc);
                document.getElementById('create-group-modal')?.classList.remove('show');
                e.target.reset();
            }
        });

        // Modal close
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.modal')?.classList.remove('show');
            });
        });

        // FAB Create Group Button
        document.getElementById('fab-create-group')?.addEventListener('click', () => {
            document.getElementById('create-group-modal')?.classList.add('show');
        });

        // Group Info Button
        document.getElementById('group-info-btn')?.addEventListener('click', () => {
            this.showGroupInfo();
        });

        // Close Info Sidebar Button
        document.getElementById('close-info-btn')?.addEventListener('click', () => {
            document.getElementById('info-sidebar')?.classList.remove('show');
        });

        // Leave Group Button
        document.getElementById('leave-group-btn')?.addEventListener('click', async () => {
            if (this.currentChat?.type === 'group') {
                if (confirm('Are you sure you want to leave this group?')) {
                    try {
                        await api.leaveGroup(this.currentChat.id);
                        UI.showToast('Left group successfully', 'success');
                        document.getElementById('info-sidebar')?.classList.remove('show');
                        this.navigationManager.handleMobileBack();
                        await this.groupManager.loadGroups();
                        await this.chatManager.loadAllChats();
                    } catch (error) {
                        console.error('Failed to leave group:', error);
                        UI.showToast('Failed to leave group', 'error');
                    }
                }
            }
        });

        // Mobile Menu Button
        document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
            const dropdown = document.getElementById('mobile-menu-dropdown');
            dropdown?.classList.toggle('hidden');
        });

        // Mobile Menu Theme Toggle
        document.getElementById('menu-theme-toggle')?.addEventListener('click', () => {
            window.themeManager?.toggle();
            document.getElementById('mobile-menu-dropdown')?.classList.add('hidden');
        });

        // Mobile Menu Logout
        document.getElementById('menu-logout')?.addEventListener('click', () => {
            document.getElementById('mobile-menu-dropdown')?.classList.add('hidden');
            this.authManager.handleLogout();
        });

        // Close mobile menu when clicking outside
        document.addEventListener('click', (e) => {
            const menuContainer = document.querySelector('.mobile-menu-container');
            const dropdown = document.getElementById('mobile-menu-dropdown');
            if (menuContainer && dropdown && !menuContainer.contains(e.target)) {
                dropdown.classList.add('hidden');
            }
        });

        // Context menu action events
        document.addEventListener('messageAction', (e) => {
            const { action, messageId, messageText } = e.detail;
            if (action === 'reply') {
                this.messageHandler.handleReply(messageId);
            } else if (action === 'forward') {
                this.messageHandler.openForwardModal(messageId);
            } else if (action === 'delete') {
                this.messageHandler.deleteMessage(messageId);
            }
        });

        // Mobile nav item clicks
        document.querySelectorAll('.mobile-nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                if (action === 'chats') {
                    document.querySelector('.tab-btn[data-tab="chats"]')?.click();
                } else if (action === 'groups') {
                    document.querySelector('.tab-btn[data-tab="groups"]')?.click();
                } else if (action === 'contacts') {
                    document.querySelector('.tab-btn[data-tab="users"]')?.click();
                }
            });
        });
    }

    setupNetworkListeners() {
        window.addEventListener('online', () => {
            console.log('🌐 Back online');
            UI.showToast('Connection restored', 'success');
            const token = localStorage.getItem(CONFIG.TOKEN_KEY);
            if (token) ws.connect(token);
        });

        window.addEventListener('offline', () => {
            console.log('📴 Went offline');
            UI.showToast('You are offline', 'warning');
        });
    }

    // Chat opening methods
    openGroupChat(group) {
        if (this.isLoadingChat) return;
        console.log('Opening group chat:', group);
        this.currentChat = { type: 'group', id: group.id, ...group };
        this.loadChatUI(group, 'group');
    }

    openPrivateChat(user) {
        if (this.isLoadingChat) return;
        console.log('Opening private chat:', user);
        this.currentChat = { type: 'private', id: user.id, ...user };
        this.loadChatUI(user, 'private');
    }

    async loadChatUI(data, type) {
        this.isLoadingChat = true;
        // Hide sidebar on mobile to show chat area
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.remove('mobile-open');
        }

        // Hide mobile bottom nav when viewing a chat
        const mobileNav = document.querySelector('.mobile-bottom-nav');
        if (mobileNav) {
            mobileNav.classList.add('hidden');
            // Remove nav padding from chat main area
            document.querySelector('.chat-main')?.style.removeProperty('padding-bottom');
            document.getElementById('scroll-to-bottom')?.style.removeProperty('bottom');
        }

        UI.hide('empty-state');
        UI.show('chat-header');
        UI.show('messages-container');
        UI.show('message-input-container');

        // Update header - use correct IDs from HTML
        const name = data.name || data.username;
        const chatTitle = document.getElementById('chat-title');
        const chatAvatarInitials = document.getElementById('chat-avatar-initials');
        const chatAvatar = document.querySelector('#chat-header .avatar');
        const chatSubtitle = document.getElementById('chat-subtitle');

        if (chatTitle) chatTitle.textContent = name;
        if (chatAvatarInitials) chatAvatarInitials.textContent = UI.getInitials(name);
        if (chatAvatar) chatAvatar.style.background = UI.generateAvatarColor(name);
        if (chatSubtitle) {
            chatSubtitle.textContent = type === 'group'
                ? `${data.member_count || 0} members`
                : (data.is_online ? 'Online' : 'Offline');
        }

        // Clear messages and show loading state
        const messagesList = document.getElementById('messages-list');
        if (messagesList) {
            messagesList.innerHTML = '<div class="loading-messages"><div class="spinner" style="width:24px;height:24px;border:2px solid var(--border-subtle);border-top-color:var(--accent-primary);border-radius:50%;animation:spin 0.8s linear infinite;margin:40px auto"></div><p style="text-align:center;color:var(--text-muted);font-size:13px;">Loading messages...</p></div>';
        }
        this.messageHandler.messageIds.clear();

        // Load messages
        await this.loadMessages();
    }

    async loadMessages() {
        try {
            let filters = {};

            if (this.currentChat.type === 'group') {
                filters = {
                    group: this.currentChat.id,
                    message_type: 'group'
                };
            } else {
                filters = {
                    message_type: 'private',
                    recipient: this.currentChat.id
                };
            }

            const response = await api.getMessages(filters);
            const messages = response.results || response || [];

            // Mark messages as read
            const unreadIds = messages
                .filter(m => String(m.sender_id) !== String(this.currentUser?.id))
                .map(m => m.message_id || m.id)
                .filter(Boolean);
            if (unreadIds.length > 0) {
                api.markMessagesAsRead(unreadIds).catch(() => {});
            }

            // Sort chronologically
            messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

            // Clear loading indicator and add messages
            const container = document.getElementById('messages-list');
            if (container) container.innerHTML = '';

            messages.forEach(msg => this.messageHandler.addMessageToUI(msg));
            this.messageHandler.scrollToBottom();
        } catch (error) {
            console.error('Failed to load messages:', error);
            UI.showToast('Failed to load messages', 'error');
            const container = document.getElementById('messages-list');
            if (container) container.innerHTML = '<div class="empty-list" style="padding:40px;text-align:center;color:var(--text-muted)">Failed to load messages</div>';
        } finally {
            this.isLoadingChat = false;
        }
    }

    switchChat(id, type) {
        if (type === 'group') {
            const group = this.myGroups?.find(g => String(g.id) === String(id)) ||
                this.allChats?.find(c => String(c.id) === String(id) && c.type === 'group');
            if (group) this.openGroupChat(group);
        } else {
            const user = this.users?.find(u => String(u.id) === String(id)) ||
                this.allChats?.find(c => String(c.id) === String(id) && c.type === 'user');
            if (user) this.openPrivateChat(user);
        }
    }

    async confirmForward(chatId, chatType) {
        const modal = document.getElementById('forward-modal');
        const messageId = modal?.dataset.messageId;
        if (!messageId || !chatId) return;

        try {
            const endpoint = chatType === 'group'
                ? `/messages/forward/group/${chatId}/`
                : `/messages/forward/user/${chatId}/`;
            await api.request(endpoint, {
                method: 'POST',
                body: JSON.stringify({ message_id: messageId })
            });
            UI.showToast('Message forwarded', 'success');
            modal.classList.remove('show');
        } catch (error) {
            console.error('Failed to forward message:', error);
            UI.showToast('Failed to forward message', 'error');
        }
    }

    scrollToMessage(messageId) {
        const el = document.querySelector(`[data-message-id="${messageId}"]`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight');
            setTimeout(() => el.classList.remove('highlight'), 2000);
        }
    }

    async toggleReaction(messageId, emoji) {
        try {
            await api.reactToMessage(messageId, emoji);
        } catch (error) {
            console.error('Failed to toggle reaction:', error);
        }
    }

    updateStatusIndicator(message, status) {
        const indicator = document.getElementById('connection-status');
        if (indicator) {
            const msgEl = indicator.querySelector('.connection-message');
            if (msgEl) msgEl.textContent = message;
            indicator.className = `connection-status ${status}`;
            indicator.classList.remove('hidden');
        }
    }

    clearTypingTimeout() {
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
            this.typingTimeout = null;
        }
    }

    sendStopTyping() {
        if (!this.currentChat || !ws.isConnected) return;
        const payload = { is_typing: false };
        if (this.currentChat.type === 'group') {
            payload.group_id = this.currentChat.id;
        } else {
            payload.recipient_id = this.currentChat.id;
        }
        ws.send('typing_indicator', payload);
    }

    handleSearch(query, type) {
        if (type === 'chats') this.chatManager.handleSearch(query);
        else if (type === 'groups') this.groupManager.handleSearch(query);
        else if (type === 'users') this.userManager.handleSearch(query);
    }

    async showGroupInfo() {
        if (!this.currentChat || this.currentChat.type !== 'group') {
            console.log('No group chat selected');
            return;
        }

        const sidebar = document.getElementById('info-sidebar');
        if (!sidebar) return;

        // Update header
        const name = this.currentChat.name;
        document.getElementById('info-group-name').textContent = name;
        document.getElementById('info-avatar-initials').textContent = UI.getInitials(name);
        document.getElementById('info-description').textContent = this.currentChat.description || 'No description';
        document.getElementById('info-member-count').textContent = this.currentChat.member_count || '0';

        // Load members
        const membersList = document.getElementById('info-members-list');
        if (membersList) {
            membersList.innerHTML = '<div class="loading">Loading members...</div>';

            try {
                const response = await api.getGroupMembers(this.currentChat.id);
                const members = response.members || response || [];

                membersList.innerHTML = '';
                members.forEach(member => {
                    const item = UI.createMemberItem ? UI.createMemberItem(member) : document.createElement('div');
                    if (!UI.createMemberItem) {
                        item.className = 'member-item';
                        item.innerHTML = `
                            <div class="avatar avatar-sm" style="background: ${UI.generateAvatarColor(member.user?.username || member.username || 'User')}">
                                <span>${UI.getInitials(member.user?.username || member.username || 'User')}</span>
                            </div>
                            <div class="member-info">
                                <div class="member-name">${UI.escapeHtml(member.user?.username || member.username || 'Unknown')}</div>
                                <div class="member-role">${member.is_admin ? 'Admin' : 'Member'}</div>
                            </div>
                        `;
                    }
                    membersList.appendChild(item);
                });
            } catch (error) {
                console.error('Failed to load members:', error);
                membersList.innerHTML = '<div class="error">Failed to load members</div>';
            }
        }

        // Show sidebar
        sidebar.classList.add('show');
    }
}

// Initialize app
const app = new MessagingApp();
document.dispatchEvent(new CustomEvent('appReady', { detail: app }));