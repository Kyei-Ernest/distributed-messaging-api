// ============================================================================
// FILE: app.js - Complete Application Logic (WhatsApp-style)
// REORGANIZED: 
// - Chats Tab: All conversations (groups + individuals)
// - Groups Tab: Only group conversations  
// - Contacts Tab: Only individual conversations
// ============================================================================

class MessagingApp {
    constructor() {
        this.currentChat = null;
        this.typingTimeout = null;
        this.currentUser = null;
        this.myGroups = [];
        this.availableGroups = [];
        this.users = [];
        this.allChats = [];
        this.messageObserver = null;
        this.history = [];
        this.markedAsRead = new Set(); // Add this line,
        this.pendingReadReceipts = new Set(); // Add this
        this.readReceiptTimer = null; // Add this
        this.typingIndicatorTimeouts = new Map();
        this.unreadCounts = {
        total: 0,
        groups: {},
        users: {},
        all_chats: {}
    };
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
            this.setupMobileNavForLogin(); // Setup mobile nav for login screen
        }

        this.setupEventListeners();
        this.setupBrowserBackButton(); // Setup browser back button handler
        this.updateMobileNav(); // Initialize mobile nav state
    }
     // ========================================================================
    // Browser Back Button Handling
    // ========================================================================

    setupBrowserBackButton() {
        // Handle browser/mobile back button
        window.addEventListener('popstate', (event) => {
            console.log('Browser back button pressed', event.state);
            
            if (this.currentChat) {
                // If in a chat, go back to list view
                event.preventDefault();
                this.handleMobileBack();
                
                // Push a new state to prevent going to blank page
                window.history.pushState({ view: 'list' }, '', '#chats');
            }
        });
        
        // Push initial state
        if (window.history.state === null) {
            window.history.replaceState({ view: 'list' }, '', '#chats');
        }
    }

    pushToHistory(state) {
        this.history.push(state);
        // Update browser history
        window.history.pushState({ hasHistory: true, state: state }, '', window.location.pathname);
    }

    popFromHistory() {
        if (this.history.length > 0) {
            this.history.pop();
        }
        // Go back in browser history
        if (window.history.length > 1) {
            window.history.back();
        }
    }

    handleBrowserBack() {
        if (this.currentChat) {
            // If in a chat, go back to list view
            this.handleMobileBack();
        } else if (this.history.length > 0) {
            // Restore previous state from history
            const previousState = this.history[this.history.length - 1];
            if (previousState === 'chat-list') {
                // Already in list view
                this.navigateToTab('chats');
            }
        }
    }
    setupMobileNavForLogin() {
        // On login screen, hide mobile nav completely
        const mobileNav = document.querySelector('.mobile-bottom-nav');
        if (mobileNav) {
            mobileNav.style.display = 'none';
        }
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

    async loadUnreadCounts() {
        try {
            const response = await api.request('/messages/unread_counts/');
            this.unreadCounts = response;
            
            // Update total unread badge in UI
            this.updateTotalUnreadBadge();
            
            console.log('✅ Unread counts loaded:', this.unreadCounts);
        } catch (error) {
            console.error('Failed to load unread counts:', error);
        }
    }

    updateTotalUnreadBadge() {
        // Update total unread count in sidebar header or mobile nav
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

    async initializeChat() {
        console.log('🚀 Initializing chat...');
        
        // Load user info
        const username = this.currentUser.username || 'User';
        document.getElementById('current-user-name').textContent = username;
        document.getElementById('current-user-initials').textContent = UI.getInitials(username);

        console.log('👤 Current User ID:', this.currentUser.id);

        // Connect WebSocket
        const token = localStorage.getItem(CONFIG.TOKEN_KEY);
        ws.connect(token);
        this.setupWebSocketListeners();

        // Load data IN ORDER - groups and users FIRST, then chats
        try {
            console.log('📥 Loading groups...');
            await this.loadGroups();
            console.log(`✅ Groups loaded: ${this.myGroups.length} joined, ${this.availableGroups.length} available`);
            
            console.log('📥 Loading users...');
            await this.loadUsers();
            console.log(`✅ Users loaded: ${this.users.length} total`);
            await this.loadUnreadCounts();
            console.log('📥 Loading chats (combined view)...');
            await this.loadAllChats();
            console.log(`✅ Chats loaded: ${this.allChats.length} total`);
        } catch (error) {
            console.error('❌ Error during initialization:', error);
            UI.showToast('Error loading data: ' + error.message, 'error');
        }
        
        // Setup message read tracking
        this.setupMessageReadTracking();
        
        // Update mobile nav state
        this.updateMobileNav();
        
        // Set initial active tab in mobile nav
        this.syncMobileNavWithTab();

        // Start online status polling
        this.startOnlineStatusPolling();
        
        console.log('✅ Initialization complete');
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
            const infoSidebar = document.getElementById('info-sidebar');
            const isHidden = infoSidebar.classList.contains('hidden');
            
            if (isHidden) {
                // Opening info sidebar - hide message input
                UI.show('info-sidebar');
                UI.hide('message-input-container');
            } else {
                // Closing info sidebar - show message input
                UI.hide('info-sidebar');
                UI.show('message-input-container');
            }
        });

        document.getElementById('close-info-btn')?.addEventListener('click', () => {
            UI.hide('info-sidebar');
            // Show message input again when closing info sidebar
            if (this.currentChat) {
                UI.show('message-input-container');
            }
        });
        document.getElementById('leave-group-btn')?.addEventListener('click', () => this.handleLeaveGroup());

        // ====================================================================
        // Search
        // ====================================================================
        document.getElementById('chat-search')?.addEventListener('input', UI.debounce((e) => {
            this.handleSearch(e.target.value, 'chats');
        }, 300));

        document.getElementById('group-search')?.addEventListener('input', UI.debounce((e) => {
            this.handleSearch(e.target.value, 'groups');
        }, 300));

        document.getElementById('user-search')?.addEventListener('input', UI.debounce((e) => {
            this.handleSearch(e.target.value, 'users');
        }, 300));

        // ====================================================================
        // Mobile Back Button - FIXED: Shows mobile nav when going back
        // ====================================================================
        document.getElementById('mobile-back-btn')?.addEventListener('click', () => {
            this.handleMobileBack();
        });

        // ====================================================================
        // Context Menu for Messages
        // ====================================================================
        document.addEventListener('messageAction', (e) => this.handleMessageAction(e.detail));

        // ====================================================================
        // Mobile Navigation Click Handlers
        // ====================================================================
        document.querySelectorAll('.mobile-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                this.handleMobileNavAction(action);
            });
        });
    }

    // ========================================================================
    // Mobile Navigation Management
    // ========================================================================

    updateMobileNav() {
        if (!UI.isMobile()) return;
        
        const mobileNav = document.querySelector('.mobile-bottom-nav');
        const hasActiveChat = this.currentChat !== null;
        const isLoginScreen = document.getElementById('login-screen')?.classList.contains('active');
        
        if (isLoginScreen) {
            // Hide mobile nav on login screen
            if (mobileNav) {
                mobileNav.style.display = 'none';
            }
        } else if (hasActiveChat) {
            // Hide mobile nav when in chat
            if (mobileNav) {
                mobileNav.style.display = 'none';
            }
        } else {
            // Show mobile nav when in list view
            if (mobileNav) {
                mobileNav.style.display = 'block';
            }
        }
    }

    handleMobileNavAction(action) {
        if (!UI.isMobile()) return;
        
        // Update active state in mobile nav
        document.querySelectorAll('.mobile-nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`.mobile-nav-item[data-action="${action}"]`)?.classList.add('active');
        
        // Handle the action
        switch(action) {
            case 'chats':
                // Navigate to chats tab (combined list)
                this.navigateToTab('chats');
                break;
            case 'groups':
                // Navigate to groups tab
                this.navigateToTab('groups');
                break;
            case 'contacts':
                // Navigate to users tab
                this.navigateToTab('users');
                break;
            case 'settings':
                // Show settings modal
                document.getElementById('settings-modal')?.classList.add('show');
                break;
        }
        
        // Ensure sidebar is open on mobile for list view
        if (action !== 'settings') {
            document.querySelector('.sidebar')?.classList.add('mobile-open');
        }
    }

    navigateToTab(tabName) {
        // Click the corresponding tab button in sidebar
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
        if (tabBtn) {
            tabBtn.click();
        }
        
        // Show the empty state (list view)
        UI.show('empty-state');
        UI.hide('chat-header');
        UI.hide('messages-container');
        UI.hide('message-input-container');
        
        // Clear any active chat
        this.currentChat = null;
        
        // Clear active selections
        document.querySelectorAll('.list-item.active').forEach(item => {
            item.classList.remove('active');
        });
        
        // Update mobile nav visibility
        this.updateMobileNav();
        
        // Add to browser history for back button support
        if (window.history && window.history.pushState) {
            window.history.pushState({ tab: tabName }, '', `#${tabName}`);
        }
    }
    handleMobileBack() {
        if (this.currentChat) {
            this.clearTypingTimeout();
            if (this.currentChat.type === 'group') {
                ws.send('typing_indicator', {
                    group_id: this.currentChat.id,
                    is_typing: false
                });
            } else {
                ws.send('typing_indicator', {
                    recipient_id: this.currentChat.id,
                    is_typing: false
                });
            }
        }

        // Clear current chat
        this.currentChat = null;
        
        // Hide chat UI
        UI.hide('empty-state');
        UI.hide('chat-header');
        UI.hide('messages-container');
        UI.hide('message-input-container');
        UI.hide('info-sidebar');
        
        // Show sidebar (list view)
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.add('mobile-open');
        }
        
        // Make sure we're on the chats tab
        const chatsTab = document.querySelector('.tab-btn[data-tab="chats"]');
        if (chatsTab && !chatsTab.classList.contains('active')) {
            chatsTab.click();
        }
        
        // Clear active selections
        document.querySelectorAll('.list-item.active').forEach(item => {
            item.classList.remove('active');
        });
        
        // Show mobile nav
        this.updateMobileNav();
    }

    syncMobileNavWithTab() {
        if (!UI.isMobile()) return;
        
        const activeTab = document.querySelector('.tab-content.active')?.id;
        if (activeTab === 'chats-tab') {
            // Set chats as active in mobile nav
            document.querySelectorAll('.mobile-nav-item').forEach(item => {
                item.classList.remove('active');
            });
            document.querySelector('.mobile-nav-item[data-action="chats"]')?.classList.add('active');
        } else if (activeTab === 'groups-tab') {
            // Set groups as active in mobile nav
            document.querySelectorAll('.mobile-nav-item').forEach(item => {
                item.classList.remove('active');
            });
            document.querySelector('.mobile-nav-item[data-action="groups"]')?.classList.add('active');
        } else if (activeTab === 'users-tab') {
            // Set contacts as active in mobile nav
            document.querySelectorAll('.mobile-nav-item').forEach(item => {
                item.classList.remove('active');
            });
            document.querySelector('.mobile-nav-item[data-action="contacts"]')?.classList.add('active');
        }
    }

    // ========================================================================
    // Mobile Hardware Back Button Handling
    // ========================================================================

    setupHardwareBackButton() {
        // Listen for back button press on mobile devices
        if ('ontouchstart' in window) {
            // Handle Android back button via popstate
            window.addEventListener('popstate', (e) => {
                e.preventDefault();
                
                if (this.currentChat) {
                    // If in a chat, go back to list view
                    this.handleMobileBack();
                } else {
                    // If already in list view, let browser handle it (or exit app)
                    return;
                }
            });
            
            // Handle iOS swipe gesture (optional)
            let startX = 0;
            let startY = 0;
            
            document.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
            }, { passive: true });
            
            document.addEventListener('touchend', (e) => {
                const endX = e.changedTouches[0].clientX;
                const endY = e.changedTouches[0].clientY;
                const diffX = endX - startX;
                const diffY = Math.abs(endY - startY);
                
                // If swiped from left edge to right (back gesture)
                // And vertical movement is less than horizontal (not scrolling)
                if (startX < 50 && diffX > 100 && diffY < 50) {
                    if (this.currentChat) {
                        this.handleMobileBack();
                    }
                }
            }, { passive: true });
        }
    }

    handleUnreadCountUpdate(data) {
        console.log('📊 Live unread count update received:', data);
        
        // Update local unread counts
        this.unreadCounts.total = data.total_unread;
        this.unreadCounts.groups = data.groups || {};
        this.unreadCounts.users = data.users || {};
        this.unreadCounts.all_chats = data.all_chats || {};
        
        console.log('📊 New unread counts:', this.unreadCounts);
        
        // Update UI
        this.updateTotalUnreadBadge();
        this.renderChats(); // Re-render to show updated counts
    }

    handleHardwareBack() {
        console.log('Hardware back button pressed');
        
        // If we're in a chat, go back to list view
        if (this.currentChat) {
            this.handleMobileBack();
            return true;
        }
        
        // If we're in list view but sidebar is open on mobile, close it
        const sidebar = document.querySelector('.sidebar');
        if (sidebar && sidebar.classList.contains('mobile-open')) {
            sidebar.classList.remove('mobile-open');
            return true;
        }
        
        // If we're in groups tab, go back to chats tab
        const activeTab = document.querySelector('.tab-content.active')?.id;
        if (activeTab === 'groups-tab' || activeTab === 'users-tab') {
            this.navigateToTab('chats');
            return true;
        }
        
        // If we're on login screen, ask to exit app
        if (document.getElementById('login-screen')?.classList.contains('active')) {
            if (confirm('Exit app?')) {
                // This will close the app or go to home screen on mobile
                if (navigator.app) {
                    navigator.app.exitApp();
                }
            }
            return true;
        }
        
        return false;
    }

    // ========================================================================
    // Load All Chats (Combined: Groups + Individuals with last messages)
    // ========================================================================

    async loadAllChats() {
    UI.showLoading('chats-list');
    
    try {
        console.log('🔍 Loading all chats...');
        
        // Get all groups and users
        const groups = this.myGroups;
        const users = this.users.filter(user => user.id !== this.currentUser.id);
        
        console.log(`📊 Groups: ${groups.length}, Users: ${users.length}`);
        
        // Get all messages
        const allMessages = await api.getMessages({});
        const messages = allMessages.results || allMessages;
        
        console.log(`💬 Total messages loaded: ${messages.length}`);
        
        // DEBUG: Log first message to see structure
        if (messages.length > 0) {
            console.log('🔍 FIRST MESSAGE STRUCTURE:', messages[0]);
            console.log('🔍 Message type:', messages[0].message_type);
            console.log('🔍 Group ID:', messages[0].group_id || messages[0].group);
            console.log('🔍 Sender ID:', messages[0].sender_id || messages[0].sender?.id);
            console.log('🔍 Recipient ID:', messages[0].recipient_id || messages[0].recipient?.id);
        }
        
        this.allChats = [];
        
        // Process groups - ONLY add if they have messages
        groups.forEach(group => {
            console.log(`\n🔍 Checking group "${group.name}" (ID: ${group.id})`);
            
            // Filter messages for this group
            const groupMessages = messages.filter(msg => {
                const isGroupMsg = msg.message_type === 'group';
                const matchesGroup = msg.group_id === group.id || msg.group === group.id;
                
                console.log(`  Message check: type=${msg.message_type}, group_id=${msg.group_id}, group=${msg.group}, matches=${isGroupMsg && matchesGroup}`);
                
                return isGroupMsg && matchesGroup;
            });
            
            console.log(`✅ Group "${group.name}": ${groupMessages.length} messages`);
            
            if (groupMessages.length > 0) {
                const sortedMessages = [...groupMessages].sort((a, b) => 
                    new Date(b.created_at) - new Date(a.created_at)
                );
                const lastMessage = sortedMessages[0];
                
                this.allChats.push({
                    id: group.id,
                    type: 'group',
                    name: group.name,
                    avatar: group.name,
                    is_online: true,
                    last_message: lastMessage.content,
                    last_message_time: lastMessage.created_at,
                    unread_count: 0,
                    data: group,
                    member_count: group.member_count,
                    is_admin: group.is_admin
                });
            }
        });
        
        // Process users - ONLY add if they have messages
        users.forEach(user => {
            console.log(`\n🔍 Checking user "${user.username}" (ID: ${user.id})`);
            
            const userMessages = messages.filter(msg => {
                const isPrivateMsg = msg.message_type === 'private';
                const senderId = msg.sender_id || msg.sender?.id;
                const recipientId = msg.recipient_id || msg.recipient?.id;
                
                const isFromUser = senderId === user.id && recipientId === this.currentUser.id;
                const isToUser = senderId === this.currentUser.id && recipientId === user.id;
                
                console.log(`  Message check: type=${msg.message_type}, sender=${senderId}, recipient=${recipientId}, matches=${isPrivateMsg && (isFromUser || isToUser)}`);
                
                return isPrivateMsg && (isFromUser || isToUser);
            });
            
            console.log(`✅ User "${user.username}": ${userMessages.length} messages`);
            
            if (userMessages.length > 0) {
                const sortedMessages = [...userMessages].sort((a, b) => 
                    new Date(b.created_at) - new Date(a.created_at)
                );
                const lastMessage = sortedMessages[0];
                
                this.allChats.push({
                    id: user.id,
                    type: 'user',
                    name: user.username,
                    avatar: user.username,
                    is_online: user.is_online || false,
                    last_message: lastMessage.content,
                    last_message_time: lastMessage.created_at,
                    unread_count: 0,
                    data: user,
                    email: user.email
                });
            }
        });
        
        console.log(`✅ Total chats created: ${this.allChats.length}`);
        
        // Sort by most recent message time (newest first)
        this.allChats.sort((a, b) => {
            const timeA = new Date(a.last_message_time).getTime();
            const timeB = new Date(b.last_message_time).getTime();
            return timeB - timeA;
        });
        
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
    if (!container) {
        console.error('❌ chats-list container not found!');
        return;
    }
    
    container.innerHTML = '';
    
    console.log(`🎨 Rendering chats: total=${this.allChats.length}, query="${searchQuery}"`);
    
    const query = searchQuery.toLowerCase().trim();
    
    // Filter chats based on search
    const filteredChats = this.allChats.filter(chat => {
        if (!query) return true;
        
        return chat.name.toLowerCase().includes(query) ||
               (chat.email && chat.email.toLowerCase().includes(query)) ||
               (chat.last_message && chat.last_message.toLowerCase().includes(query));
    });
    
    console.log(`🔍 Filtered chats: ${filteredChats.length}`);
    
    // Show empty state if no chats
    if (filteredChats.length === 0) {
        console.warn('⚠️ No chats to display!');
        
        const emptyMessage = searchQuery 
            ? 'No chats match your search'
            : 'No conversations yet';
        
        const emptyHint = searchQuery
            ? 'Try a different search term'
            : 'Start a conversation from Groups or Contacts';
        
        container.innerHTML = `
            <div class="empty-list" style="padding: 60px 20px; text-align: center;">
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity: 0.2; margin-bottom: 16px;">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                <p style="font-size: 16px; font-weight: 500; margin-bottom: 8px; color: var(--text-secondary);">${emptyMessage}</p>
                <p style="font-size: 13px; color: var(--text-tertiary);">
                    ${emptyHint}
                </p>
            </div>
        `;
        return;
    }
    
    console.log('✅ Rendering', filteredChats.length, 'chats');
    
    // Render each chat item
    filteredChats.forEach((chat, index) => {
        try {
            const item = this.createChatItem(chat);
            container.appendChild(item);
            console.log(`  ${index + 1}. ${chat.name} (${chat.type}) - ${chat.last_message?.substring(0, 30)}...`);
        } catch (error) {
            console.error(`❌ Error rendering chat "${chat.name}":`, error);
        }
    });
    
    console.log('✅ Rendering complete');
}

    createChatItem(chat) {
        const div = document.createElement('div');
        div.className = 'list-item';
        
        if (chat.type === 'group') {
            div.dataset.groupId = chat.id;
            div.dataset.type = 'group';
        } else {
            div.dataset.userId = chat.id;
            div.dataset.type = 'user';
        }
        
        const avatarColor = UI.generateAvatarColor(chat.name);
        
        // Get unread count for this chat
        const unreadCount = this.unreadCounts.all_chats[chat.id] || 0;
        const hasUnread = unreadCount > 0;
        
        const subtitle = UI.escapeHtml(UI.truncate(chat.last_message, 40));
        
        div.innerHTML = `
            <div class="avatar" style="background: ${avatarColor}">
                <span>${UI.getInitials(chat.name)}</span>
                ${chat.type === 'user' ? `<span class="status-badge ${chat.is_online ? 'online' : 'offline'}"></span>` : ''}
            </div>
            <div class="list-item-content">
                <div class="list-item-title">
                    ${UI.escapeHtml(chat.name)}
                    ${chat.type === 'group' && chat.is_admin ? '<span class="badge admin">Admin</span>' : ''}
                </div>
                <div class="list-item-subtitle ${hasUnread ? 'unread' : ''}">
                    ${subtitle}
                </div>
            </div>
            <div class="list-item-meta">
                <div class="list-item-time">${UI.formatTime(chat.last_message_time)}</div>
                ${hasUnread ? `<span class="badge unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''}
            </div>
        `;
        
        div.addEventListener('click', () => {
            if (chat.type === 'group') {
                this.openGroupChat(chat.data);
            } else {
                this.openPrivateChat(chat.data);
            }
        });
        
        return div;
    }

    // ========================================================================
    // Load Groups (Only groups user is member of)
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
        if (!container) return;
        
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
            
            // Reload groups and chats to update lists
            await this.loadGroups();
            await this.loadAllChats();
            
            // Subscribe to group via WebSocket
            ws.subscribeToGroup(groupId);
        } catch (error) {
            UI.showToast(error.message, 'error');
        }
    }

    // ========================================================================
    // Load Users (Only individuals, no groups)
    // ========================================================================

    async loadUsers() {
        UI.showLoading('users-list');
        
        try {
            const response = await api.getUsers();
            this.users = response.results || response;
            
            // CRITICAL: Normalize all IDs to numbers
            this.users = this.users.map(user => ({
                ...user,
                id: user.id,
                is_online: false  // Start with false, will be updated by WebSocket
            }));
            
            console.log('Loaded users:', this.users.length);
            console.log('Current user ID:', this.currentUser.id);
            
            // NEW: Request current online status from server
            ws.send('request_online_users');
            
            this.renderUsers();
        } catch (error) {
            console.error('Failed to load users:', error);
            UI.showToast('Failed to load users', 'error');
        }
    }
    renderUsers(searchQuery = '') {
        const container = document.getElementById('users-list');
        if (!container) return;
        
        container.innerHTML = '';
        
        const query = searchQuery.toLowerCase();
        
        // Filter out current user
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
        
        console.log(`🎨 Rendering ${filteredUsers.length} users`);
        
        if (filteredUsers.length === 0) {
            container.innerHTML = '<div class="empty-list">No users found</div>';
            return;
        }
        
        // Sort users: online first, then by username
        filteredUsers.sort((a, b) => {
            // Online users first
            if (a.is_online && !b.is_online) return -1;
            if (!a.is_online && b.is_online) return 1;
            
            // Then alphabetically
            return a.username.localeCompare(b.username);
        });
        
        filteredUsers.forEach(user => {
            const item = UI.createUserItem(user, this.currentUser.id);
            if (item) {
                item.addEventListener('click', () => this.openPrivateChat(user));
                container.appendChild(item);
                
                console.log(`  ✓ ${user.username}: ${user.is_online ? '🟢 online' : '⚫ offline'}`);
            }
        });
    }
    startOnlineStatusPolling() {
        // Request online status every 30 seconds as a fallback
        this.onlineStatusInterval = setInterval(() => {
            if (ws.isConnected) {
                console.log('🔄 Refreshing online status...');
                ws.send('request_online_users');
            }
        }, 30000); // 30 seconds
    }

    // ========================================================================
    // Search Handler
    // ========================================================================

    handleSearch(query, type) {
        if (type === 'chats') {
            this.renderChats(query);
        } else if (type === 'groups') {
            this.renderGroups(query);
        } else if (type === 'users') {
            this.renderUsers(query);
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
        
        // Sync mobile nav with current tab
        this.syncMobileNavWithTab();
        
        // Update mobile nav visibility (should be visible when switching tabs)
        this.updateMobileNav();
    }

    // ========================================================================
    // WebSocket Listeners
    // ========================================================================

    setupWebSocketListeners() {
        ws.on('connected', () => {
            console.log('WebSocket connected');
            UI.showToast('Connected', 'success', 2000);
            
            // Subscribe to all groups
            this.myGroups.forEach(group => {
                ws.subscribeToGroup(group.id);
            });
            
            // IMPORTANT: Request online users AFTER a small delay
            // This ensures the server has registered the connection
            setTimeout(() => {
                console.log('📡 Requesting online users list...');
                ws.send('request_online_users');
            }, 500);
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
        ws.on('unread_count_update', (data) => this.handleUnreadCountUpdate(data));
        
        // NEW: Add this line for online status
        ws.on('online_users_list', (data) => this.handleOnlineUsersList(data));
        ws.on('user_status', (data) => this.handleUserStatusChange(data));
        
        ws.on('disconnected', () => {
            UI.showToast('Disconnected', 'warning');
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            UI.showToast('Connection error', 'error');
        });
    }
    handleOnlineUsersList(data) {
        console.log('📋 Online users list received:', data);
        
        const onlineUserIds = data.online_users || [];
        const count = data.count || onlineUserIds.length;
        
        console.log(`✅ ${count} users are currently online:`, onlineUserIds);
        
        // Update all users' online status
        this.users.forEach(user => {
            const wasOnline = user.is_online;
            user.is_online = onlineUserIds.includes(user.id.toString());
            
            if (wasOnline !== user.is_online) {
                console.log(`  ${user.username}: ${wasOnline ? 'online' : 'offline'} → ${user.is_online ? 'online' : 'offline'}`);
                
                // ✅ INSTANT UPDATE: Update UI immediately without re-render
                this.updateOnlineStatusUI(user.id.toString(), user.is_online);
            }
        });
        
        // Update in allChats
        this.allChats.forEach(chat => {
            if (chat.type === 'user') {
                const wasOnline = chat.is_online;
                chat.is_online = onlineUserIds.includes(chat.id.toString());
                
                if (wasOnline !== chat.is_online) {
                    // ✅ INSTANT UPDATE: Update chat list badges immediately
                    this.updateOnlineStatusUI(chat.id.toString(), chat.is_online);
                }
            }
        });
        
        // Update current chat header if it's a private chat
        if (this.currentChat?.type === 'private') {
            const isOnline = onlineUserIds.includes(this.currentChat.id.toString());
            this.updateChatHeaderStatus(isOnline);
        }
        
        console.log('✅ Online status synchronized with server (instant updates)');
    }
    // ========================================================================
    // User Status Change Handler
    // ========================================================================

    handleUserStatusChange(data) {
        console.log('👤 User status update received:', data);
        
        const userId = data.user_id;
        const username = data.username;
        const status = data.status;
        const isOnline = status === 'online';
        
        const userIdStr = userId.toString();
        
        // Update in users array
        const userIndex = this.users.findIndex(u => u.id.toString() === userIdStr);
        if (userIndex !== -1) {
            this.users[userIndex].is_online = isOnline;
            console.log(`✅ Updated user ${username}: ${status}`);
        }
        
        // Update in allChats array
        const chatIndex = this.allChats.findIndex(chat => 
            chat.type === 'user' && chat.id.toString() === userIdStr
        );
        if (chatIndex !== -1) {
            this.allChats[chatIndex].is_online = isOnline;
        }
        
        // ✅ INSTANT UPDATE: Update UI immediately without re-render
        this.updateOnlineStatusUI(userIdStr, isOnline);
        
        // Show toast notification
        if (this.isUserInContacts(userIdStr)) {
            const message = isOnline 
                ? `${username} is now online` 
                : `${username} is now offline`;
            UI.showToast(message, isOnline ? 'success' : 'info', 2000);
        }
        
        // Update chat header if currently chatting with this user
        if (this.currentChat?.type === 'private' && this.currentChat.id.toString() === userIdStr) {
            this.updateChatHeaderStatus(isOnline);
        }
    }
    
    handleUserStatusChange(data) {
        console.log('👤 User status update received:', data);
        
        const userId = data.user_id;
        const username = data.username;
        const status = data.status; // 'online' or 'offline'
        const isOnline = status === 'online';
        
        // Update in users array
        const userIndex = this.users.findIndex(u => u.id === userId);
        if (userIndex !== -1) {
            this.users[userIndex].is_online = isOnline;
            console.log(`✅ Updated user ${username}: ${status}`);
        }
        
        // Update in allChats array
        const chatIndex = this.allChats.findIndex(chat => 
            chat.type === 'user' && chat.id === userId
        );
        if (chatIndex !== -1) {
            this.allChats[chatIndex].is_online = isOnline;
        }
        
        // Update UI elements
        this.updateOnlineStatusUI(userId, isOnline);
        
        // Show toast notification if it's a contact coming online/offline
        if (this.isUserInContacts(userId)) {
            const message = isOnline 
                ? `${username} is now online` 
                : `${username} is now offline`;
            UI.showToast(message, isOnline ? 'success' : 'info', 2000);
        }
        
        // If currently chatting with this user, update chat header
        if (this.currentChat?.type === 'private' && this.currentChat.id === userId) {
            this.updateChatHeaderStatus(isOnline);
        }
    }

    // 2. Helper method to check if user is in contacts
    isUserInContacts(userId) {
        return this.users.some(u => u.id.toString() === userId.toString());
    }

    // 3. Update all UI elements showing this user's status
    updateOnlineStatusUI(userId, isOnline) {
        const statusClass = isOnline ? 'online' : 'offline';
        
        // Update all status badges for this user (instant transition)
        const statusBadges = document.querySelectorAll(`[data-user-id="${userId}"] .status-badge`);
        statusBadges.forEach(badge => {
            // Remove both classes first
            badge.classList.remove('online', 'offline');
            // Add the correct class (CSS handles the transition)
            badge.classList.add(statusClass);
        });
        
        // Update in user list items
        const userItems = document.querySelectorAll(`[data-user-id="${userId}"][data-type="user"]`);
        userItems.forEach(item => {
            const badge = item.querySelector('.status-badge');
            if (badge) {
                badge.classList.remove('online', 'offline');
                badge.classList.add(statusClass);
            }
        });
        
        // Update in member lists (group info sidebar)
        const memberItems = document.querySelectorAll(`.member-item[data-user-id="${userId}"] .status-badge`);
        memberItems.forEach(badge => {
            badge.classList.remove('online', 'offline');
            badge.classList.add(statusClass);
        });
    }


    // 4. Update chat header status indicator
    updateChatHeaderStatus(isOnline) {
        const chatSubtitle = document.getElementById('chat-subtitle');
        if (chatSubtitle) {
            chatSubtitle.innerHTML = isOnline 
                ? '<span class="status-indicator online"></span> Online'
                : '<span class="status-indicator offline"></span> Offline';
        }
    }
    
    // ========================================================================
    // Open Chat (Group or Private)
    // ========================================================================

    async openGroupChat(group) {
       // Clear unread count for this group
    if (this.unreadCounts.all_chats[group.id]) {
        this.unreadCounts.total -= this.unreadCounts.all_chats[group.id];
        delete this.unreadCounts.all_chats[group.id];
        delete this.unreadCounts.groups[group.id];
        this.updateTotalUnreadBadge();
    }

        if (this.currentChat) {
            this.clearTypingTimeout();
            if (this.currentChat.type === 'group') {
                ws.send('typing_indicator', {
                    group_id: this.currentChat.id,
                    is_typing: false
                });
            } else {
                ws.send('typing_indicator', {
                    recipient_id: this.currentChat.id,
                    is_typing: false
                });
            }
        }

        this.currentChat = {
            type: 'group',
            id: group.id,
            data: group
        };

        // Clear marked as read set when switching chats
        if (this.markedAsRead) {
            this.markedAsRead.clear();
        }
        // Push to history for back button support
        if (window.history && window.history.pushState) {
            window.history.pushState({ chat: 'group', id: group.id }, '', `#group-${group.id}`);
        }

        // Update UI
        UI.hide('empty-state');
        UI.show('chat-header');
        UI.show('messages-container');
        UI.show('message-input-container');

        // Load messages
        await this.loadMessages();
        
        // IMPORTANT: Load read status AFTER messages are loaded
        await this.loadReadMessages();

        // Load group info
        await this.loadGroupInfo(group.id);
        
        document.getElementById('group-info-btn').style.display = 'flex';

        document.getElementById('chat-title').textContent = group.name;
        document.getElementById('chat-subtitle').textContent = `${group.member_count} members`;
        document.getElementById('chat-avatar-initials').textContent = UI.getInitials(group.name);

        // Mark as active in sidebar
        document.querySelectorAll('.list-item').forEach(item => item.classList.remove('active'));
        document.querySelectorAll(`[data-group-id="${group.id}"]`).forEach(item => {
            item.classList.add('active');
        });

        // Subscribe to WebSocket group
        ws.subscribeToGroup(group.id);

        // Load messages (bottom to top order)
        await this.loadMessages();

        // Load group info
        await this.loadGroupInfo(group.id);
        
        // Hide mobile navigation
        this.updateMobileNav();
        
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
        document.querySelectorAll(`[data-user-id="${selectedUserId}"]`).forEach(userElement => {
            userElement.classList.add('active');
        });

        // Send "stopped typing" for previous chat
        if (this.currentChat) {
            this.clearTypingTimeout();
            if (this.currentChat.type === 'group') {
                ws.send('typing_indicator', {
                    group_id: this.currentChat.id,
                    is_typing: false
                });
            } else {
                ws.send('typing_indicator', {
                    recipient_id: this.currentChat.id,
                    is_typing: false
                });
            }
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

        // Clear unread count
        if (this.unreadCounts.all_chats[selectedUserId]) {
            this.unreadCounts.total -= this.unreadCounts.all_chats[selectedUserId];
            delete this.unreadCounts.all_chats[selectedUserId];
            delete this.unreadCounts.users[selectedUserId];
            this.updateTotalUnreadBadge();
        }

        // Clear marked as read set when switching chats
        if (this.markedAsRead) {
            this.markedAsRead.clear();
        }
        
        // Push to history for back button support
        if (window.history && window.history.pushState) {
            window.history.pushState({ chat: 'private', id: selectedUserId }, '', `#chat-${selectedUserId}`);
        }

        console.log('Current chat set to:', this.currentChat);

        // Update UI - CRITICAL: Ensure message input is shown
        UI.hide('empty-state');
        UI.show('chat-header');
        UI.show('messages-container');
        UI.show('message-input-container');
        
        // ⭐ FIX: Load messages ONCE, then load read status WITHOUT reloading
        try {
            // Clear the messages list first to prevent duplicates
            const container = document.getElementById('messages-list');
            container.innerHTML = '';
            
            // Load messages
            await this.loadMessages();
            
            // IMPORTANT: Load read status AFTER messages are loaded
            // This should NOT trigger another load
            await this.loadReadMessages();
            
        } catch (error) {
            console.error('Error loading chat:', error);
            UI.showToast('Error loading messages', 'error');
        }

        // CRITICAL FIX: Force display message input on mobile
        const inputContainer = document.getElementById('message-input-container');
        if (inputContainer) {
            inputContainer.classList.remove('hidden');
            inputContainer.style.display = 'flex';
            
            // Extra force for mobile
            if (UI.isMobile()) {
                inputContainer.style.position = 'fixed';
                inputContainer.style.bottom = '0';
                inputContainer.style.left = '0';
                inputContainer.style.right = '0';
                inputContainer.style.zIndex = '1000';
            }
        }
        
        document.getElementById('group-info-btn').style.display = 'none';

        document.getElementById('chat-title').textContent = user.username;
        document.getElementById('chat-subtitle').textContent = user.email || 'Private chat';
        document.getElementById('chat-avatar-initials').textContent = UI.getInitials(user.username);
        
        // Hide mobile navigation
        this.updateMobileNav();
        
        // Mobile: hide sidebar
        if (UI.isMobile()) {
            document.querySelector('.sidebar')?.classList.remove('mobile-open');
        }
    }

    // ========================================================================
    // Load Messages (BOTTOM TO TOP - WhatsApp Style)
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
                // For private chats, fetch messages in BOTH directions
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
            
            container.appendChild(messageElement);
            
            // Observe message for read tracking (only for received messages)
            const senderId = message.sender_id || message.sender?.id;
            const isOwn = senderId === this.currentUser.id;
            if (this.messageObserver && !isOwn) {
                this.messageObserver.observe(messageElement);
            }
        });
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
        if (this.onlineStatusInterval) {
            clearInterval(this.onlineStatusInterval);
        }
        
        if (confirm('Are you sure you want to logout?')) {
            ws.disconnect();
            api.logout();
        }
    }

    // ========================================================================
    // Group Management
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
            await this.loadAllChats();
        } catch (error) {
            UI.showToast(error.message, 'error');
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
            
            // Show mobile navigation
            this.updateMobileNav();
            
            // Reload groups and chats
            await this.loadGroups();
            await this.loadAllChats();
        } catch (error) {
            UI.showToast(error.message, 'error');
        }
    }

    // ========================================================================
    // Send Message
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
                const recipientId = this.currentChat.id;
                const currentUserId = this.currentUser.id;
                
                if (recipientId === currentUserId) {
                    throw new Error('Cannot send message to yourself');
                }
                
                messageData.recipient_id = recipientId;
            }

            const savedMessage = await api.sendMessage(messageData);
            
            // Clear input
            input.value = '';
            input.style.height = 'auto';
            
            // IMPORTANT: Send "stopped typing" signal
            this.clearTypingTimeout();
            if (this.currentChat.type === 'group') {
                ws.send('typing_indicator', {
                    group_id: this.currentChat.id,
                    is_typing: false
                });
            } else {
                ws.send('typing_indicator', {
                    recipient_id: this.currentChat.id,
                    is_typing: false
                });
            }
            
            setTimeout(() => UI.scrollToBottom('messages-container'), 100);
            
            // Refresh chats list to update last message
            await this.loadAllChats();
        } catch (error) {
            console.error('Send failed:', error);
            UI.showToast('Failed to send: ' + error.message, 'error');
        }
    }

    // ========================================================================
    // WebSocket Event Handlers
    // ========================================================================

    handleIncomingGroupMessage(data) {
        console.log('Incoming group message:', data);
        
        // Update chat list immediately with new message preview
        this.updateChatPreview({
            id: data.group_id,
            type: 'group',
            last_message: data.content,
            last_message_time: data.timestamp,
            sender_username: data.sender_username
        });
        
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
        
        // NOTE: Unread count will be updated via separate WebSocket event
        // No need to manually increment here
    }

    handleIncomingPrivateMessage(data) {
        console.log('Private message received:', data);
        
        const senderId = data.sender_id;
        const recipientId = data.recipient_id;
        const currentUserId = this.currentUser.id;
        
        // Determine other user
        const otherUserId = senderId === currentUserId ? recipientId : senderId;
        
        // Update chat list immediately with new message preview
        this.updateChatPreview({
            id: otherUserId,
            type: 'user',
            last_message: data.content,
            last_message_time: data.timestamp,
            sender_username: data.sender_username
        });

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
        
        // NOTE: Unread count will be updated via separate WebSocket event
        // No need to manually increment here
    }

    async updateChatListAfterMessage(messageData) {
        // Reload chats to show updated last message
        await this.loadAllChats();
        
        // Re-select active chat if needed
        if (this.currentChat) {
            const chatId = this.currentChat.id;
            const chatType = this.currentChat.type;
            
            document.querySelectorAll('.list-item').forEach(item => {
                if (chatType === 'group' && item.dataset.groupId == chatId) {
                    item.classList.add('active');
                } else if (chatType === 'user' && item.dataset.userId == chatId) {
                    item.classList.add('active');
                }
            });
        }
    }

    updateChatPreview(messageData) {
        // Find the chat in allChats array
        const chatIndex = this.allChats.findIndex(chat => 
            chat.id === messageData.id && chat.type === messageData.type
        );
        
        if (chatIndex !== -1) {
            // Update existing chat
            this.allChats[chatIndex].last_message = messageData.last_message;
            this.allChats[chatIndex].last_message_time = messageData.last_message_time;
            
            // Move to top of list
            const [chat] = this.allChats.splice(chatIndex, 1);
            this.allChats.unshift(chat);
            
            // Re-render chats list
            this.renderChats();
            
            // Re-highlight active chat if needed
            if (this.currentChat && this.currentChat.id === messageData.id && this.currentChat.type === messageData.type) {
                const selector = messageData.type === 'group' 
                    ? `[data-group-id="${messageData.id}"]` 
                    : `[data-user-id="${messageData.id}"]`;
                document.querySelectorAll(selector).forEach(item => {
                    item.classList.add('active');
                });
            }
        } else {
            // New chat - reload all chats
            this.loadAllChats();
        }
    }

    // Add after updateChatPreview method
    updateChatTypingIndicator(chatId, chatType, isTyping, username) {
        const selector = chatType === 'group' 
            ? `[data-group-id="${chatId}"]` 
            : `[data-user-id="${chatId}"]`;
        
        const chatItem = document.querySelector(selector);
        if (!chatItem) return;
        
        const subtitle = chatItem.querySelector('.list-item-subtitle');
        if (!subtitle) return;
        
        // Create unique key for this chat's typing timeout
        const timeoutKey = `preview_${chatType}_${chatId}`;
        
        // Clear any existing timeout for this chat preview
        if (this.typingIndicatorTimeouts.has(timeoutKey)) {
            clearTimeout(this.typingIndicatorTimeouts.get(timeoutKey));
            this.typingIndicatorTimeouts.delete(timeoutKey);
        }
        
        if (isTyping) {
            // Save original text if not already saved
            if (!subtitle.dataset.originalText) {
                subtitle.dataset.originalText = subtitle.textContent;
            }
            subtitle.innerHTML = '<em style="color: var(--primary-color);">typing...</em>';
            
            // Set timeout to auto-clear after 3 seconds
            const timeout = setTimeout(() => {
                if (subtitle.dataset.originalText) {
                    subtitle.textContent = subtitle.dataset.originalText;
                    delete subtitle.dataset.originalText;
                }
                this.typingIndicatorTimeouts.delete(timeoutKey);
            }, 3000);
            
            this.typingIndicatorTimeouts.set(timeoutKey, timeout);
        } else {
            // Manually stopped - restore immediately
            if (subtitle.dataset.originalText) {
                subtitle.textContent = subtitle.dataset.originalText;
                delete subtitle.dataset.originalText;
            }
        }
    }
    // ========================================================================
    // Message Management
    // ========================================================================

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

    setupMessageReadTracking() {
        // Track which messages have already been marked as read
        this.markedAsRead = new Set();
        
        // Setup intersection observer to mark messages as read when they become visible
        const options = {
            root: document.getElementById('messages-container'),
            threshold: 0.5,
            rootMargin: '0px' // Only trigger when actually visible
        };

        this.messageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const messageId = entry.target.dataset.messageId;
                    const senderId = entry.target.dataset.senderId;
                    
                    // Only mark as read if it's not our message and hasn't been marked already
                    if (senderId && senderId !== String(this.currentUser.id) && messageId) {
                        if (!this.markedAsRead.has(messageId)) {
                            this.markMessageAsRead(messageId);
                            
                            // IMPORTANT: Stop observing this message after marking it
                            this.messageObserver.unobserve(entry.target);
                        }
                    }
                }
            });
        }, options);
    }
    async markMessageAsRead(messageId) {
        // Don't mark if already marked
        if (this.markedAsRead.has(messageId)) {
            return;
        }
        
        // Add to pending batch
        this.pendingReadReceipts.add(messageId);
        
        // Clear existing timer
        if (this.readReceiptTimer) {
            clearTimeout(this.readReceiptTimer);
        }
        
        // Batch send after 500ms
        this.readReceiptTimer = setTimeout(async () => {
            if (this.pendingReadReceipts.size === 0) return;
            
            const messageIds = Array.from(this.pendingReadReceipts);
            this.pendingReadReceipts.clear();
            
            // Add all to marked set
            messageIds.forEach(id => this.markedAsRead.add(id));
            
            try {
                // Send all at once
                await api.markMessagesAsRead(messageIds);
                console.log(`✅ Marked ${messageIds.length} messages as read`);
            } catch (error) {
                console.error('Failed to mark messages as read:', error);
                // Remove from set if failed
                messageIds.forEach(id => this.markedAsRead.delete(id));
            }
        }, 500);
    }

    async loadReadMessages() {
        try {
            // Get unread messages from API
            const response = await api.request('/messages/unread/');
            const unreadIds = response.unread_message_ids || [];
            
            // Get all messages in current chat
            const allMessages = document.querySelectorAll('[data-message-id]');
            
            // Add all READ messages to the set (messages NOT in unread list)
            allMessages.forEach(msg => {
                const msgId = msg.dataset.messageId;
                if (!unreadIds.includes(msgId)) {
                    this.markedAsRead.add(msgId);
                }
            });
            
            console.log(`✅ Loaded ${this.markedAsRead.size} already-read messages`);
        } catch (error) {
            console.error('Failed to load read status:', error);
        }
    }
    // ========================================================================
    // Other WebSocket Handlers (simplified)
    // ========================================================================

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
                this.updateMobileNav(); // Show mobile nav
                this.loadGroups();
                this.loadAllChats();
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
        const timeoutKey = data.group_id ? `group_${data.group_id}_${data.user_id}` : `user_${data.user_id}`;
        
        // Clear existing timeout for this user
        if (this.typingIndicatorTimeouts.has(timeoutKey)) {
            clearTimeout(this.typingIndicatorTimeouts.get(timeoutKey));
            this.typingIndicatorTimeouts.delete(timeoutKey);
        }
        
        if (this.currentChat?.type === 'group' && this.currentChat.id === data.group_id) {
            // Don't show typing indicator for current user
            if (data.user_id === this.currentUser.id) return;

            if (data.is_typing) {
                const avatarColor = UI.generateAvatarColor(data.username);
                UI.showTypingIndicator(data.username, avatarColor);
                
                // Auto-hide after 3 seconds of no updates
                const timeout = setTimeout(() => {
                    UI.hideTypingIndicator();
                    this.updateChatTypingIndicator(data.group_id, 'group', false, data.username);
                    this.typingIndicatorTimeouts.delete(timeoutKey);
                }, 3000);
                
                this.typingIndicatorTimeouts.set(timeoutKey, timeout);
            } else {
                UI.hideTypingIndicator();
            }
            
            // Update chat list preview
            this.updateChatTypingIndicator(data.group_id, 'group', data.is_typing, data.username);
            
            // Auto-clear chat preview after 3 seconds
            if (data.is_typing) {
                const timeout = setTimeout(() => {
                    this.updateChatTypingIndicator(data.group_id, 'group', false, data.username);
                    this.typingIndicatorTimeouts.delete(timeoutKey);
                }, 3000);
                
                this.typingIndicatorTimeouts.set(timeoutKey, timeout);
            }
            
        } else if (this.currentChat?.type === 'private') {
            // Private chat typing indicator
            const otherUserId = data.user_id;
            if (this.currentChat.id === otherUserId) {
                if (data.is_typing) {
                    const avatarColor = UI.generateAvatarColor(data.username);
                    UI.showTypingIndicator(data.username, avatarColor);
                    
                    // Auto-hide after 3 seconds of no updates
                    const timeout = setTimeout(() => {
                        UI.hideTypingIndicator();
                        this.updateChatTypingIndicator(otherUserId, 'user', false, data.username);
                        this.typingIndicatorTimeouts.delete(timeoutKey);
                    }, 3000);
                    
                    this.typingIndicatorTimeouts.set(timeoutKey, timeout);
                } else {
                    UI.hideTypingIndicator();
                }
            }
            
            // Update chat list preview
            this.updateChatTypingIndicator(otherUserId, 'user', data.is_typing, data.username);
            
            // Auto-clear chat preview after 3 seconds
            if (data.is_typing) {
                const timeout = setTimeout(() => {
                    this.updateChatTypingIndicator(otherUserId, 'user', false, data.username);
                    this.typingIndicatorTimeouts.delete(timeoutKey);
                }, 3000);
                
                this.typingIndicatorTimeouts.set(timeoutKey, timeout);
            }
            
        } else {
            // Not in the chat but still update the preview in sidebar
            if (data.group_id) {
                this.updateChatTypingIndicator(data.group_id, 'group', data.is_typing, data.username);
                
                // Auto-clear after 3 seconds
                if (data.is_typing) {
                    const timeout = setTimeout(() => {
                        this.updateChatTypingIndicator(data.group_id, 'group', false, data.username);
                        this.typingIndicatorTimeouts.delete(timeoutKey);
                    }, 3000);
                    
                    this.typingIndicatorTimeouts.set(timeoutKey, timeout);
                }
            } else if (data.recipient_id || data.user_id) {
                const userId = data.user_id;
                this.updateChatTypingIndicator(userId, 'user', data.is_typing, data.username);
                
                // Auto-clear after 3 seconds
                if (data.is_typing) {
                    const timeout = setTimeout(() => {
                        this.updateChatTypingIndicator(userId, 'user', false, data.username);
                        this.typingIndicatorTimeouts.delete(timeoutKey);
                    }, 3000);
                    
                    this.typingIndicatorTimeouts.set(timeoutKey, timeout);
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
    // Group Info Management
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
            
            // Add instruction text
            const instructionDiv = document.createElement('div');
            instructionDiv.style.cssText = `
                font-size: 12px;
                color: var(--text-tertiary);
                margin-bottom: 12px;
                padding: 8px 12px;
                background: var(--bg-secondary);
                border-radius: var(--radius-sm);
                border-left: 3px solid var(--primary-color);
            `;
            instructionDiv.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 6px;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                Tap on any member to start a private chat
            `;
            container.appendChild(instructionDiv);
            
            const isAdmin = groupDetails.is_admin;
            const isCreator = groupDetails.created_by?.id === this.currentUser.id;
            
            // Sort members: current user first, then admins, then by name
            const sortedMembers = [...members.members].sort((a, b) => {
                // Current user first
                if (a.user.id === this.currentUser.id) return -1;
                if (b.user.id === this.currentUser.id) return 1;
                
                // Then admins
                if (a.is_admin && !b.is_admin) return -1;
                if (!a.is_admin && b.is_admin) return 1;
                
                // Then alphabetically
                return a.user.username.localeCompare(b.user.username);
            });
            
            sortedMembers.forEach(member => {
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
        
        // Check if user is online
        const userOnlineStatus = this.users.find(u => u.id === member.user.id);
        const isOnline = userOnlineStatus ? userOnlineStatus.is_online : false;
        
        // Make clickable if not current user
        if (!isCurrentUser) {
            div.classList.add('clickable-member');
            div.setAttribute('title', `Click to chat with ${member.user.username}`);
        }
        
        div.innerHTML = `
            <div class="avatar avatar-sm" style="background: ${avatarColor}; position: relative;">
                <span>${UI.getInitials(member.user.username)}</span>
                ${!isCurrentUser ? `<span class="status-badge ${isOnline ? 'online' : 'offline'}"></span>` : ''}
            </div>
            <div class="member-info">
                <div class="member-name">
                    ${UI.escapeHtml(member.user.username)}
                    ${isCurrentUser ? ' (You)' : ''}
                    ${isOnline && !isCurrentUser ? '<span style="color: var(--success-color); font-size: 10px; margin-left: 4px;">● Online</span>' : ''}
                </div>
                <div class="member-role">
                    ${member.is_admin ? '👑 Admin' : 'Member'}
                </div>
            </div>
            ${!isCurrentUser ? `
                <div class="member-chat-icon" style="opacity: 0.6; transition: opacity 0.2s;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--primary-color);">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                </div>
            ` : ''}
            ${currentUserIsAdmin && !isCurrentUser ? `
                <div class="member-actions" style="display: flex; gap: 4px;">
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
        
        // Add click handler to open private chat (if not current user)
        if (!isCurrentUser) {
            div.addEventListener('click', (e) => {
                // Don't trigger if clicking on action buttons
                if (e.target.closest('.member-actions')) {
                    return;
                }
                
                console.log('Opening private chat with member:', member.user.username);
                
                // Add visual feedback
                div.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    div.style.transform = '';
                }, 100);
                
                // Close info sidebar
                UI.hide('info-sidebar');
                UI.show('message-input-container');
                
                // Open private chat with this user
                this.openPrivateChat(member.user);
            });
            
            // Show chat icon on hover
            const chatIcon = div.querySelector('.member-chat-icon');
            div.addEventListener('mouseenter', () => {
                if (chatIcon) chatIcon.style.opacity = '1';
            });
            div.addEventListener('mouseleave', () => {
                if (chatIcon) chatIcon.style.opacity = '0.6';
            });
        }
        
        // Add event listeners for admin actions
        if (currentUserIsAdmin && !isCurrentUser) {
            const promoteBtn = div.querySelector('[data-action="promote"]');
            const removeBtn = div.querySelector('[data-action="remove"]');
            
            if (promoteBtn) {
                promoteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handlePromoteMember(member.user.id, member.user.username);
                });
            }
            
            if (removeBtn) {
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleRemoveMember(member.user.id, member.user.username);
                });
            }
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
    // Message Actions
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

    clearTypingTimeout() {
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
            this.typingTimeout = null;
        }
    }

    handleTyping() {
        if (!this.currentChat) return;

        // Clear previous timeout
        this.clearTypingTimeout();

        // Send typing indicator
        if (this.currentChat.type === 'group') {
            ws.send('typing_indicator', {
                group_id: this.currentChat.id,
                is_typing: true
            });
        } else {
            ws.send('typing_indicator', {
                recipient_id: this.currentChat.id,
                is_typing: true
            });
        }

        // Stop typing after 2 seconds of inactivity
        this.typingTimeout = setTimeout(() => {
            if (this.currentChat.type === 'group') {
                ws.send('typing_indicator', {
                    group_id: this.currentChat.id,
                    is_typing: false
                });
            } else {
                ws.send('typing_indicator', {
                    recipient_id: this.currentChat.id,
                    is_typing: false
                });
            }
        }, 2000);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new MessagingApp();
});


// Add to app.js
class MessageSearch {
    constructor() {
        this.searchInput = null;
        this.searchResults = [];
        this.currentResultIndex = -1;
        this.init();
    }

    init() {
        // Add search button to chat header
        this.addSearchButton();
    }

    addSearchButton() {
        const chatHeader = document.getElementById('chat-header');
        if (!chatHeader) return;
        
        const searchBtn = document.createElement('button');
        searchBtn.className = 'btn-icon';
        searchBtn.id = 'search-messages-btn';
        searchBtn.title = 'Search messages';
        searchBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
        `;
        
        chatHeader.querySelector('.chat-header-actions')?.appendChild(searchBtn);
        
        searchBtn.addEventListener('click', () => this.showSearchBar());
    }

    showSearchBar() {
        const chatHeader = document.getElementById('chat-header');
        const searchBar = document.createElement('div');
        searchBar.className = 'message-search-bar';
        searchBar.innerHTML = `
            <input type="text" id="message-search-input" placeholder="Search in conversation...">
            <button class="btn-icon" id="close-search-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            <button class="btn-icon" id="prev-search-result" disabled>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            </button>
            <button class="btn-icon" id="next-search-result" disabled>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
        `;
        
        chatHeader.appendChild(searchBar);
        
        const searchInput = document.getElementById('message-search-input');
        searchInput.focus();
        
        searchInput.addEventListener('input', UI.debounce(() => {
            this.searchMessages(searchInput.value);
        }, 300));
        
        document.getElementById('close-search-btn').addEventListener('click', () => {
            this.hideSearchBar();
        });
        
        document.getElementById('prev-search-result').addEventListener('click', () => {
            this.navigateResults(-1);
        });
        
        document.getElementById('next-search-result').addEventListener('click', () => {
            this.navigateResults(1);
        });
    }

    searchMessages(query) {
        if (!query.trim()) {
            this.clearHighlights();
            return;
        }
        
        const messages = document.querySelectorAll('.message-bubble');
        this.searchResults = [];
        
        messages.forEach((message, index) => {
            const text = message.textContent.toLowerCase();
            if (text.includes(query.toLowerCase())) {
                this.searchResults.push(message);
                this.highlightText(message, query);
            }
        });
        
        this.updateSearchButtons();
        
        if (this.searchResults.length > 0) {
            this.navigateToResult(0);
        }
    }

    highlightText(element, query) {
        const innerHTML = element.innerHTML;
        const regex = new RegExp(`(${query})`, 'gi');
        element.innerHTML = innerHTML.replace(regex, '<mark class="search-highlight">$1</mark>');
    }

    navigateToResult(index) {
        if (index < 0 || index >= this.searchResults.length) return;
        
        this.currentResultIndex = index;
        const result = this.searchResults[index];
        
        // Scroll to message
        result.closest('.message').scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Highlight current result
        this.clearCurrentHighlight();
        result.classList.add('current-search-result');
        
        this.updateSearchButtons();
    }
}

// Add to app.js
class MessagePinning {
    constructor() {
        this.pinnedMessages = new Map(); // chatId -> [messageIds]
        this.init();
    }

    init() {
        // Add pin button to context menu
        this.addPinToContextMenu();
        this.setupPinnedMessagesPanel();
    }

    addPinToContextMenu() {
        const contextMenu = document.getElementById('context-menu');
        if (!contextMenu) return;
        
        const pinItem = document.createElement('button');
        pinItem.className = 'context-menu-item';
        pinItem.dataset.action = 'pin';
        pinItem.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
            </svg>
            Pin Message
        `;
        
        contextMenu.appendChild(pinItem);
        
        // Update context menu handler in app.js to handle 'pin' action
    }

    async togglePin(messageId) {
        try {
            const response = await api.pinMessage(messageId);
            
            if (response.pinned) {
                UI.showToast('Message pinned', 'success');
                this.addPinnedMessageUI(messageId);
            } else {
                UI.showToast('Message unpinned', 'info');
                this.removePinnedMessageUI(messageId);
            }
            
            // Update pinned messages panel
            this.updatePinnedMessagesPanel();
        } catch (error) {
            console.error('Error pinning message:', error);
            UI.showToast('Failed to pin message', 'error');
        }
    }

    setupPinnedMessagesPanel() {
        // Add pinned messages button to chat header
        const chatHeader = document.getElementById('chat-header');
        if (!chatHeader) return;
        
        const pinnedBtn = document.createElement('button');
        pinnedBtn.className = 'btn-icon';
        pinnedBtn.id = 'pinned-messages-btn';
        pinnedBtn.title = 'Pinned messages';
        pinnedBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
            </svg>
        `;
        
        chatHeader.querySelector('.chat-header-actions')?.appendChild(pinnedBtn);
        
        pinnedBtn.addEventListener('click', () => {
            this.showPinnedMessagesPanel();
        });
    }

    showPinnedMessagesPanel() {
        const panel = document.createElement('div');
        panel.className = 'pinned-messages-panel';
        panel.innerHTML = `
            <div class="panel-header">
                <h3>Pinned Messages</h3>
                <button class="btn-icon close-panel">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="pinned-messages-list"></div>
        `;
        
        document.body.appendChild(panel);
        panel.classList.add('show');
        
        this.updatePinnedMessagesPanel();
        
        panel.querySelector('.close-panel').addEventListener('click', () => {
            panel.classList.remove('show');
            setTimeout(() => panel.remove(), 300);
        });
    }
}