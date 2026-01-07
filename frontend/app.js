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
        // ✅ NEW: Add sending lock to prevent duplicate messages
        this.isSending = false;
        // NEW: Infinite scroll properties
        this.messagesPage = 1;
        this.messagesPerPage = 20;
        this.hasMoreMessages = true;
        this.isLoadingMessages = false;
        this.allLoadedMessages = [];

        // ✅ NEW: Reply state
        this.replyingToMessage = null;

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

        // Request notification permission on first user interaction
        const requestNotification = () => {
            if (Notification.permission === 'default') {
                UI.requestNotificationPermission().then(granted => {
                    if (granted) console.log('✅ Notification permission granted');
                });
            }
            document.removeEventListener('click', requestNotification);
        };
        document.addEventListener('click', requestNotification);

        // Ensure persistent connection when tab becomes visible
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                const token = localStorage.getItem(CONFIG.TOKEN_KEY);
                if (token && (!ws.isConnected || ws.ws?.readyState === WebSocket.CLOSED)) {
                    console.log('🔄 Tab visible, reconnecting WebSocket...');
                    ws.connect(token);
                }

                // Refresh online users when coming back
                if (ws.isConnected) {
                    ws.send('request_online_users');
                }
            }
        });
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

        this.adjustMobileScrollPadding()

        // Also adjust on window resize
        window.addEventListener('resize', () => {
            this.adjustMobileScrollPadding();
        });

        // After loading groups, log the buttons:
        console.log('🔘 Create group button:', document.getElementById('create-group-btn'));
        console.log('🔘 Create group form:', document.getElementById('create-group-form'));
        console.log('🔘 Create group modal:', document.getElementById('create-group-modal'));
        this.profileManager = new UserProfileManager(this);
        console.log('✅ Profile manager initialized');

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
        const createGroupBtn = document.getElementById('create-group-btn');
        if (createGroupBtn) {
            // Remove any existing listeners
            const newBtn = createGroupBtn.cloneNode(true);
            createGroupBtn.parentNode.replaceChild(newBtn, createGroupBtn);

            // Add fresh listener
            newBtn.addEventListener('click', () => {
                console.log('Create group button clicked');
                const modal = document.getElementById('create-group-modal');
                if (modal) {
                    modal.classList.add('show');
                }
            });
        }

        const emptyNewGroupBtn = document.getElementById('empty-new-group-btn');
        if (emptyNewGroupBtn) {
            emptyNewGroupBtn.addEventListener('click', () => {
                console.log('Empty state create group clicked');
                document.getElementById('create-group-modal').classList.add('show');
            });
        }

        const createGroupForm = document.getElementById('create-group-form');
        if (createGroupForm) {
            // Remove any existing listeners
            const newForm = createGroupForm.cloneNode(true);
            createGroupForm.parentNode.replaceChild(newForm, createGroupForm);

            // Add fresh listener
            newForm.addEventListener('submit', (e) => this.handleCreateGroup(e));
        }


        // ====================================================================
        // Modal Close Buttons
        // ====================================================================
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                console.log('Close modal clicked');
                const modal = e.target.closest('.modal');
                if (modal) {
                    modal.classList.remove('show');
                }
            });
        });

        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                console.log('Modal overlay clicked');
                const modal = e.target.closest('.modal');
                if (modal) {
                    modal.classList.remove('show');
                }
            });
        });

        // ====================================================================
        // Message Form
        // ====================================================================
        document.getElementById('message-form')?.addEventListener('submit', (e) => this.handleSendMessage(e));

        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');

        // Toggle send button visibility based on input
        messageInput?.addEventListener('input', () => {
            this.handleTyping();

            // Show/hide send button based on input content
            if (messageInput.value.trim().length > 0) {
                sendBtn?.classList.add('visible');
            } else {
                sendBtn?.classList.remove('visible');
            }
        });

        messageInput?.addEventListener('keydown', (e) => this.handleTyping(e));
        // ====================================================================
        // Group Info Sidebar
        // ====================================================================
        // Group Info Sidebar - FIXED VERSION
        document.getElementById('group-info-btn')?.addEventListener('click', () => {
            console.log('Group info button clicked');
            const infoSidebar = document.getElementById('info-sidebar');
            const messageInput = document.getElementById('message-input-container');

            if (infoSidebar.classList.contains('hidden')) {
                // Opening info sidebar
                console.log('Opening info sidebar');
                infoSidebar.classList.remove('hidden');
                infoSidebar.style.display = 'flex';

                // CRITICAL: Hide message input
                messageInput.classList.add('hidden');
                messageInput.style.display = 'none';
                messageInput.style.visibility = 'hidden';
            } else {
                // Closing info sidebar
                console.log('Closing info sidebar');
                infoSidebar.classList.add('hidden');
                infoSidebar.style.display = 'none';

                // CRITICAL: Show message input again
                messageInput.classList.remove('hidden');
                messageInput.style.display = 'flex';
                messageInput.style.visibility = 'visible';
            }
        });

        document.getElementById('close-info-btn')?.addEventListener('click', () => {
            console.log('Close info button clicked');
            const infoSidebar = document.getElementById('info-sidebar');
            const messageInput = document.getElementById('message-input-container');

            // Hide info sidebar
            infoSidebar.classList.add('hidden');
            infoSidebar.style.display = 'none';

            // Show message input again when closing info sidebar
            if (this.currentChat) {
                messageInput.classList.remove('hidden');
                messageInput.style.display = 'flex';
                console.log('✅ Message input restored after closing info');
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
        // Context Menu for Messages (Telegram Style)
        // ====================================================================
        const messagesList = document.getElementById('messages-list');
        if (messagesList) {
            messagesList.addEventListener('contextmenu', (e) => {
                const messageEl = e.target.closest('.message');
                if (messageEl) {
                    e.preventDefault();
                    this.handleContextMenu(e, messageEl.dataset.messageId);
                }
            });

            // Mobile Long Press
            let longPressTimer;
            messagesList.addEventListener('touchstart', (e) => {
                const messageEl = e.target.closest('.message');
                if (messageEl) {
                    longPressTimer = setTimeout(() => {
                        this.handleContextMenu(e.touches[0], messageEl.dataset.messageId);
                    }, 500);
                }
            }, { passive: true });

            messagesList.addEventListener('touchend', () => clearTimeout(longPressTimer));
            messagesList.addEventListener('touchmove', () => clearTimeout(longPressTimer));
        }

        // ====================================================================
        // Mobile Menu and Search Button Handlers
        // ====================================================================
        // Mobile menu toggle
        document.getElementById('mobile-menu-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById('mobile-menu-dropdown');
            dropdown?.classList.toggle('hidden');
        });

        // Close mobile menu when clicking outside
        document.addEventListener('click', (e) => {
            const menuContainer = e.target.closest('.mobile-menu-container');
            if (!menuContainer) {
                document.getElementById('mobile-menu-dropdown')?.classList.add('hidden');
            }

            // Close search when clicking outside
            const searchContainer = e.target.closest('.search-container');
            const searchBtn = e.target.closest('#mobile-search-btn');
            if (!searchContainer && !searchBtn) {
                document.querySelectorAll('.search-container.mobile-search-active').forEach(container => {
                    container.classList.remove('mobile-search-active');
                });
            }
        });

        // Menu theme toggle
        document.getElementById('menu-theme-toggle')?.addEventListener('click', () => {
            document.getElementById('mobile-menu-dropdown')?.classList.add('hidden');
            document.getElementById('theme-toggle')?.click();
        });

        // Menu logout
        document.getElementById('menu-logout')?.addEventListener('click', () => {
            document.getElementById('mobile-menu-dropdown')?.classList.add('hidden');
            this.handleLogout();
        });

        // Mobile search button
        document.getElementById('mobile-search-btn')?.addEventListener('click', () => {
            // Get currently active tab
            const activeTab = document.querySelector('.tab-content.active');
            if (activeTab) {
                const searchContainer = activeTab.querySelector('.search-container');
                if (searchContainer) {
                    searchContainer.classList.toggle('mobile-search-active');
                    // Focus the search input
                    const searchInput = searchContainer.querySelector('.search-input');
                    if (searchContainer.classList.contains('mobile-search-active') && searchInput) {
                        setTimeout(() => searchInput.focus(), 100);
                    }
                }
            }
        });


        // ====================================================================
        // Avatar Click Handler (User Info Modal)
        // ====================================================================
        document.addEventListener('click', async (e) => {
            const avatar = e.target.closest('.avatar');
            if (!avatar) return;

            // Check if inside a message
            const message = avatar.closest('.message');
            if (message) {
                const userId = message.dataset.senderId;
                if (userId && userId !== String(this.currentUser.id)) {
                    await this.showUserInfo(userId);
                }
                return;
            }

            // Check if inside chat header
            if (avatar.closest('.chat-header-avatar')) {
                if (this.currentChat && this.currentChat.type === 'private') {
                    await this.showUserInfo(this.currentChat.id);
                }
                return;
            }
        });

        // Open private chat from modal
        window.addEventListener('open-private-chat', (e) => this.openPrivateChat(e.detail));
    }

    // Add this new method
    async showUserInfo(userId) {
        try {
            const user = await api.getUser(userId);
            UI.showUserInfoModal(user);
        } catch (error) {
            console.error('Failed to load user info:', error);
            UI.showToast('Failed to load user info', 'error');
        }
    }

    // Add to MessagingApp class
    adjustMobileScrollPadding() {
        if (!UI.isMobile()) return;

        const mobileNav = document.querySelector('.mobile-bottom-nav');
        const listContainers = document.querySelectorAll('.list-container');

        if (mobileNav) {
            const navHeight = mobileNav.offsetHeight;
            listContainers.forEach(container => {
                container.style.paddingBottom = `${navHeight + 20}px`;
            });
            console.log(`✅ Mobile scroll padding adjusted: ${navHeight}px`);
        }
    }

    toggleInfoSidebar() {
        const infoSidebar = document.getElementById('info-sidebar');
        const messageInput = document.getElementById('message-input-container');

        const isHidden = infoSidebar.classList.contains('hidden');

        if (isHidden) {
            // Opening info sidebar
            console.log('Opening info sidebar');
            infoSidebar.classList.remove('hidden');
            infoSidebar.style.display = 'flex';

            // Simply hide the message input
            messageInput.classList.add('hidden');

        } else {
            // Closing info sidebar
            console.log('Closing info sidebar');
            infoSidebar.classList.add('hidden');
            infoSidebar.style.display = 'none';

            // Show the message input
            messageInput.classList.remove('hidden');
        }
    }
    // ========================================================================
    // Mobile Navigation Management
    // ========================================================================

    updateMobileNav() {
        // Mobile bottom nav removed - tabs now show at top on mobile
        // This method kept as stub to avoid breaking existing calls
        return;
    }

    handleMobileNavAction(action) {
        // Mobile bottom nav removed - method kept as stub
        return;
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
        // Remove infinite scroll listener
        if (this.infiniteScrollHandler) {
            const messagesContainer = document.getElementById('messages-container');
            if (messagesContainer) {
                messagesContainer.removeEventListener('scroll', this.infiniteScrollHandler);
            }
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

        // Update Total Badge
        this.updateTotalUnreadBadge();

        // ✅ DOM MANIPULATION: Update individual chat badges
        const listContainer = document.querySelector('.list-container .simplebar-content') || document.querySelector('.list-container');
        if (listContainer) {
            // 1. CLEAR STALE BADGES: Iterate over existing badges in DOM
            const existingBadges = listContainer.querySelectorAll('.unread-badge');
            existingBadges.forEach(badge => {
                const item = badge.closest('.list-item');
                if (item) {
                    const groupId = item.dataset.groupId;
                    const userId = item.dataset.userId;
                    const id = groupId || userId;

                    // If this chat is NOT in the new counts (or count is 0), remove badge
                    if (!data.all_chats[id] || data.all_chats[id] <= 0) {
                        badge.remove();
                        const subtitle = item.querySelector('.list-item-subtitle');
                        if (subtitle) subtitle.classList.remove('unread');
                    }
                }
            });

            // 2. ADD/UPDATE BADGES: Iterate over all chats in the update
            for (const [chatId, count] of Object.entries(data.all_chats)) {
                // Try to find the chat item (could be user or group)
                // We don't know the type from just the ID in this list, so check both selectors
                let chatItem = listContainer.querySelector(`[data-group-id="${chatId}"]`) ||
                    listContainer.querySelector(`[data-user-id="${chatId}"]`);

                if (chatItem) {
                    const metaDiv = chatItem.querySelector('.list-item-meta');
                    if (metaDiv) {
                        let badge = metaDiv.querySelector('.unread-badge');

                        if (count > 0) {
                            if (!badge) {
                                badge = document.createElement('span');
                                badge.className = 'badge unread-badge';
                                metaDiv.appendChild(badge);

                                // Also bold the subtitle
                                const subtitle = chatItem.querySelector('.list-item-subtitle');
                                if (subtitle) subtitle.classList.add('unread');
                            }
                            badge.textContent = count > 99 ? '99+' : count;
                        } else {
                            if (badge) {
                                badge.remove();

                                // Un-bold the subtitle
                                const subtitle = chatItem.querySelector('.list-item-subtitle');
                                if (subtitle) subtitle.classList.remove('unread');
                            }
                        }
                    }
                }
            }
        }
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
            console.log('📋 Loading all chats from dedicated endpoint...');

            // ✅ NEW: Use dedicated /chats/ endpoint
            const response = await api.getChats();
            this.allChats = response.chats || [];

            console.log(`✅ Loaded ${this.allChats.length} chats from server`);

            // No need to fetch messages separately
            // No need to aggregate - server does it efficiently

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

        // ✅ FIX: Get real-time online status
        const isOnline = chat.type === 'user' ? (chat.is_online || false) : false;

        // Get unread count for this chat
        const unreadCount = this.unreadCounts.all_chats[chat.id] || 0;
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
                    ${chat.type === 'group' && chat.is_admin ? '<span class="badge admin">Admin</span>' : ''}
                    ${chat.type === 'user' && isOnline ? '<span style="color: var(--success-color); font-size: 11px; margin-left: 4px;">● online</span>' : ''}
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

        // Click event listener
        div.addEventListener('click', () => {
            console.log('Chat item clicked:', chat.name, chat.type);

            if (chat.type === 'group') {
                const groupData = chat.data || chat;
                this.openGroupChat(groupData);
            } else {
                const userData = chat.data || chat;
                this.openPrivateChat(userData);
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

                // CRITICAL: Attach event listener AFTER item is in DOM
                const joinBtn = item.querySelector('.join-group-btn');
                if (joinBtn) {
                    // Remove any existing listeners
                    const newBtn = joinBtn.cloneNode(true);
                    joinBtn.parentNode.replaceChild(newBtn, joinBtn);

                    newBtn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        console.log('🔵 Join button clicked for group:', group.name);

                        // Disable button
                        newBtn.disabled = true;
                        newBtn.innerHTML = 'Joining...';
                        newBtn.style.opacity = '0.6';

                        try {
                            await this.handleJoinGroup(group.id);
                            console.log('✅ Successfully joined group');
                        } catch (error) {
                            console.error('❌ Failed to join group:', error);
                            newBtn.disabled = false;
                            newBtn.innerHTML = 'Join';
                            newBtn.style.opacity = '1';
                            UI.showToast('Failed to join group: ' + error.message, 'error');
                        }
                    });
                }
            });
        }

        // Empty state
        if (filteredMyGroups.length === 0 && filteredAvailable.length === 0) {
            container.innerHTML = `
            <div class="empty-list" style="padding: 60px 20px; text-align: center;">
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity: 0.2; margin-bottom: 16px;">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <p style="font-size: 16px; font-weight: 500; margin-bottom: 8px; color: var(--text-secondary);">No groups found</p>
                <button class="btn btn-primary" id="empty-new-group-btn" style="margin-top: 16px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    Create New Group
                </button>
            </div>
        `;

            // Reattach create group listener
            setTimeout(() => {
                document.getElementById('empty-new-group-btn')?.addEventListener('click', () => {
                    document.getElementById('create-group-modal').classList.add('show');
                });
            }, 100);
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
            <button class="btn btn-primary btn-sm join-group-btn" style="flex-shrink: 0; pointer-events: auto;">
                Join
            </button>
        `;

        // CRITICAL FIX: Don't attach to the div, only to the button
        div.addEventListener('click', (e) => {
            // Only handle if clicking the list item itself, not the button
            if (!e.target.closest('.join-group-btn')) {
                console.log('Clicked list item (not button)');
            }
        });

        return div;
    }

    async handleJoinGroup(groupId) {
        console.log('🔵 handleJoinGroup called with ID:', groupId);

        try {
            const response = await api.joinGroup(groupId);
            console.log('✅ API response:', response);

            UI.showToast('Joined group successfully', 'success');

            // Reload groups and chats to update lists
            await this.loadGroups();
            await this.loadAllChats();

            // Subscribe to group via WebSocket
            ws.subscribeToGroup(groupId);

            console.log('✅ Group join complete');
        } catch (error) {
            console.error('❌ Join group error:', error);
            throw error; // Re-throw so the button can handle it
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
        // Reduce polling interval to 15 seconds for faster updates
        this.onlineStatusInterval = setInterval(() => {
            if (ws.isConnected) {
                console.log('🔄 Refreshing online status...');
                ws.send('request_online_users');
            }
        }, 15000); // Changed from 30000 to 15000
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
            this.updateStatusIndicator('Connected', 'online');

            // Subscribe to all groups
            this.myGroups.forEach(group => {
                ws.subscribeToGroup(group.id);
            });

            // ✅ IMMEDIATE REQUEST: Request online users without delay
            console.log('🔡 Requesting online users list immediately...');
            ws.send('request_online_users');

            // ✅ ADDITIONAL: Poll every 15 seconds for freshness
            if (this.onlineStatusPollInterval) {
                clearInterval(this.onlineStatusPollInterval);
            }

            this.onlineStatusPollInterval = setInterval(() => {
                if (ws.isConnected) {
                    ws.send('request_online_users');
                }
            }, 15000);
        });

        // ... other WebSocket listeners ...

        // ✅ NEW: Add handler for specific user status response
        ws.on('user_status_response', (data) => {
            this.handleUserStatusResponse(data);
        });

        // ✅ Handle bulk online users list
        ws.on('online_users_list', (data) => this.handleOnlineUsersList(data));
        ws.on('user_status', (data) => this.handleUserStatusChange(data));




        ws.on('group_message', (data) => {
            // Fix: Live preview expects last_message, but socket sends content
            if (data && data.content && !data.last_message) {
                data.last_message = data.content;
            }
            this.handleIncomingGroupMessage(data);
        });
        ws.on('private_message', (data) => {
            // Fix: Live preview expects last_message, but socket sends content
            if (data && data.content && !data.last_message) {
                data.last_message = data.content;
            }

            // Fix: For private messages, we need to ensure the ID matches the CHAT ID (the other person)
            // If I am the sender, the chat ID is the recipient. If I am the recipient, the chat ID is the sender.
            if (data.sender_id === this.currentUser.id) {
                data.id = data.recipient_id; // Preview should update the recipient's chat item
            } else {
                data.id = data.sender_id; // Preview should update the sender's chat item
            }

            this.handleIncomingPrivateMessage(data);
        });
        ws.on('user_joined', (data) => this.handleUserJoined(data));
        ws.on('user_left', (data) => this.handleUserLeft(data));
        ws.on('user_removed', (data) => this.handleUserRemoved(data));
        ws.on('member_promoted', (data) => this.handleMemberPromoted(data));
        ws.on('typing_indicator', (data) => this.handleTypingIndicator(data));
        ws.on('message_deleted', (data) => this.handleMessageDeleted(data));
        ws.on('message_read', (data) => this.handleMessageRead(data));
        ws.on('message_reaction', (data) => this.handleMessageReaction(data));
        ws.on('unread_count_update', (data) => this.handleUnreadCountUpdate(data));

        // ✅ CRITICAL: Add both event handlers for online status

        ws.on('disconnected', () => {
            this.updateStatusIndicator('Disconnected', 'offline');

            // Clear polling interval
            if (this.onlineStatusPollInterval) {
                clearInterval(this.onlineStatusPollInterval);
            }
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            this.updateStatusIndicator('Connection error', 'offline');
        });
    }
    handleOnlineUsersList(data) {
        console.log('📋 Online users list received:', data);

        const onlineUserIds = data.online_users || [];
        const count = data.count || onlineUserIds.length;

        console.log(`✅ ${count} users are currently online:`, onlineUserIds);

        // ✅ INSTANT UPDATE: Use DocumentFragment for batch DOM updates
        const statusUpdates = new Map();

        // Collect all status changes first
        this.users.forEach(user => {
            const wasOnline = user.is_online;
            const userIdStr = user.id.toString();
            user.is_online = onlineUserIds.includes(userIdStr);

            if (wasOnline !== user.is_online) {
                statusUpdates.set(userIdStr, user.is_online);
            }
        });

        // Update allChats
        this.allChats.forEach(chat => {
            if (chat.type === 'user') {
                const wasOnline = chat.is_online;
                const chatIdStr = chat.id.toString();
                chat.is_online = onlineUserIds.includes(chatIdStr);

                if (wasOnline !== chat.is_online) {
                    statusUpdates.set(chatIdStr, chat.is_online);
                }
            }
        });

        // ✅ Apply all UI updates at once (single reflow)
        statusUpdates.forEach((isOnline, userId) => {
            this.updateOnlineStatusUIInstant(userId, isOnline);
        });

        // Update current chat header if it's a private chat
        if (this.currentChat?.type === 'private') {
            const isOnline = onlineUserIds.includes(this.currentChat.id.toString());
            this.updateChatHeaderStatus(isOnline);
        }

        console.log(`✅ Online status synchronized instantly (${statusUpdates.size} updates)`);
    }

    // ✅ NEW: Ultra-fast UI update method
    updateOnlineStatusUIInstant(userId, isOnline) {
        const statusClass = isOnline ? 'online' : 'offline';

        // Use querySelectorAll once and cache the result
        const badges = document.querySelectorAll(`[data-user-id="${userId}"] .status-badge, .status-badge[data-user-id="${userId}"]`);

        // Batch update all badges at once
        badges.forEach(badge => {
            // Direct class manipulation (fastest method)
            badge.className = `status-badge ${statusClass}`;
        });
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


        // Update chat header if currently chatting with this user
        if (this.currentChat?.type === 'private' && this.currentChat.id.toString() === userIdStr) {
            this.updateChatHeaderStatus(isOnline);
        }
    }

    handleUserStatusResponse(data) {
        console.log('🔍 Immediate status response:', data);

        const userId = data.user_id;
        const isOnline = data.is_online;

        if (!userId) return;

        const userIdStr = userId.toString();

        // Update user in users array
        const userIndex = this.users.findIndex(u => u.id.toString() === userIdStr);
        if (userIndex !== -1) {
            this.users[userIndex].is_online = isOnline;
        }

        // Update user in allChats array
        const chatIndex = this.allChats.findIndex(chat =>
            chat.type === 'user' && chat.id.toString() === userIdStr
        );
        if (chatIndex !== -1) {
            this.allChats[chatIndex].is_online = isOnline;
        }

        // ✅ INSTANT UI UPDATE: If this is the current chat, update immediately
        if (this.currentChat?.type === 'private' && this.currentChat.id.toString() === userIdStr) {
            // Update current user data
            if (this.currentChat.data) {
                this.currentChat.data.is_online = isOnline;
            }

            // Update UI instantly
            this.updateChatHeaderStatus(isOnline);

            // Update status badge in header
            this.updateOnlineStatusUI(userIdStr, isOnline);

            console.log(`✅ Updated online status for ${userId}: ${isOnline ? 'online' : 'offline'}`);
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
                ? '<span style="color: var(--success-color); font-weight: 600;">● online</span>'
                : '<span style="color: var(--text-tertiary);">offline</span>';
        }

        // ✅ Also update badge in header avatar
        const headerBadge = document.querySelector('.chat-header-avatar .status-badge');
        if (headerBadge) {
            headerBadge.classList.remove('online', 'offline');
            headerBadge.classList.add(isOnline ? 'online' : 'offline');
        }
    }

    // ========================================================================
    // Open Chat (Group or Private)
    // ========================================================================

    async openGroupChat(group) {
        console.log('Opening group chat:', group.name);

        // We DO NOT clear the unread count here anymore.
        // Instead, we clear it as the user SCROLLS to the messages or when they are first rendered.
        // This allows us to know which messages are unread and show the divider.

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

        if (this.markedAsRead) {
            this.markedAsRead.clear();
        }

        if (window.history && window.history.pushState) {
            window.history.pushState({ chat: 'group', id: group.id }, '', `#group-${group.id}`);
        }

        // ✅ Reset pagination
        this.messagesPage = 1;
        this.hasMoreMessages = true;
        this.allLoadedMessages = [];

        // ✅ Update UI immediately
        this.updateChatUI(group, 'group');

        // Subscribe to WebSocket
        ws.subscribeToGroup(group.id);

        // ✅ Force show input
        setTimeout(() => {
            const inputContainer = document.getElementById('message-input-container');
            if (inputContainer) {
                inputContainer.classList.remove('hidden');
                inputContainer.style.display = 'flex';
                inputContainer.style.visibility = 'visible';
            }
        }, 50);

        // ✅ Load data WITHOUT the extra scroll in loadChatDataInBackground
        this.loadChatDataInBackgroundNoScroll(group.id);

        if (UI.isMobile()) {
            setTimeout(() => {
                const inputContainer = document.getElementById('message-input-container');
                if (inputContainer) {
                    inputContainer.style.position = 'fixed';
                    inputContainer.style.bottom = '0';
                    inputContainer.style.left = '0';
                    inputContainer.style.right = '0';
                    inputContainer.style.zIndex = '120';
                    inputContainer.classList.remove('hidden');
                }
            }, 100);
        }
    }


    async loadChatDataInBackgroundNoScroll(groupId) {
        try {
            console.log('🔥 Loading chat data...');

            const inputContainer = document.getElementById('message-input-container');
            if (inputContainer) {
                inputContainer.classList.remove('hidden');
                inputContainer.style.display = 'flex';
                inputContainer.style.visibility = 'visible';
            }

            // Load messages (it handles its own scroll)
            await this.loadMessages(1, false);
            await this.loadReadMessages();

            if (groupId) {
                this.loadGroupInfo(groupId).catch(err => {
                    console.error('Failed to load group info:', err);
                });
            }

            // ✅ Setup scroll after messages are fully loaded and scrolled
            setTimeout(() => {
                this.setupInfiniteScroll();
            }, 300);

            console.log('✅ Chat loaded');

        } catch (error) {
            console.error('Error loading chat:', error);
            UI.showToast('Error loading chat', 'error');
        }
    }


    // Add to MessagingApp class
    getOnlineStatusSync(userId) {
        // Check in users array first (cached)
        const user = this.users.find(u => u.id.toString() === userId.toString());
        if (user) return user.is_online;

        // Check in allChats array
        const chat = this.allChats.find(c => c.type === 'user' && c.id.toString() === userId.toString());
        if (chat) return chat.is_online;

        return false; // Default to offline
    }

    // Add this to MessagingApp class
    getCachedOnlineStatus(userId) {
        const userIdStr = userId.toString();

        // Check cache first (users array)
        const cachedUser = this.users.find(u => u.id.toString() === userIdStr);
        if (cachedUser) return cachedUser.is_online || false;

        // Check allChats
        const cachedChat = this.allChats.find(c => c.type === 'user' && c.id.toString() === userIdStr);
        if (cachedChat) return cachedChat.is_online || false;

        return false; // Default to offline
    }

    // Update openPrivateChat to use cached status instantly
    async openPrivateChat(user) {
        console.log('Opening private chat with:', user.username);

        const selectedUserId = user.id;
        const currentUserId = this.currentUser.id;

        if (selectedUserId === currentUserId) {
            console.error('ERROR: Cannot chat with yourself!');
            UI.showToast('Cannot chat with yourself', 'error');
            return;
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

        // ⚡ INSTANT: Get cached online status FIRST
        const cachedOnlineStatus = this.getCachedOnlineStatus(selectedUserId);

        // ✅ FIX: Create enriched user object with cached online status
        const enrichedUser = {
            ...user,
            id: selectedUserId,
            is_online: cachedOnlineStatus
        };

        this.currentChat = {
            type: 'private',
            id: selectedUserId,
            data: enrichedUser  // ✅ Use enriched user with cached status
        };

        // We DO NOT clear the unread count here anymore.
        // Instead, we clear it as the user SCROLLS to the messages or when they are first rendered.
        // This allows us to know which messages are unread and show the divider.

        if (this.markedAsRead) {
            this.markedAsRead.clear();
        }

        if (window.history && window.history.pushState) {
            window.history.pushState({ chat: 'private', id: selectedUserId }, '', `#chat-${selectedUserId}`);
        }

        // ⚡ INSTANT: Update UI immediately with cached status
        this.updateChatUI(enrichedUser, 'private');  // ✅ Pass enrichedUser instead of user

        // 🔄 Request fresh online status AFTER showing cached status
        this.requestImmediateOnlineStatus(selectedUserId);

        this.messagesPage = 1;
        this.hasMoreMessages = true;
        this.allLoadedMessages = [];

        setTimeout(() => {
            const inputContainer = document.getElementById('message-input-container');
            if (inputContainer) {
                inputContainer.classList.remove('hidden');
                inputContainer.style.display = 'flex';
                inputContainer.style.visibility = 'visible';
            }
        }, 50);

        this.loadChatDataInBackground();

        if (UI.isMobile()) {
            setTimeout(() => {
                const inputContainer = document.getElementById('message-input-container');
                if (inputContainer) {
                    inputContainer.style.position = 'fixed';
                    inputContainer.style.bottom = '0';
                    inputContainer.style.left = '0';
                    inputContainer.style.right = '0';
                    inputContainer.style.zIndex = '120';
                    inputContainer.classList.remove('hidden');
                }
            }, 100);
        }
    }

    // Get cached online status instantly
    getCachedOnlineStatus(userId) {
        const userIdStr = userId.toString();

        // Check users array (most updated)
        const user = this.users.find(u => u.id.toString() === userIdStr);
        if (user) return user.is_online || false;

        // Check allChats array
        const chat = this.allChats.find(c => c.type === 'user' && c.id.toString() === userIdStr);
        if (chat) return chat.is_online || false;

        return false; // Default to offline
    }

    // Request immediate online status check
    requestImmediateOnlineStatus(userId) {
        if (!ws.isConnected) return;

        // Send immediate request for this specific user
        ws.send('check_user_status', {
            user_id: userId
        });

        console.log(`🔍 Requesting immediate online status for user ${userId}`);
    }

    updateChatUI(chatData, type) {
        console.log('🎨 Updating chat UI for:', chatData.name || chatData.username, 'Type:', type);

        document.querySelectorAll('.list-item.active').forEach(item => {
            item.classList.remove('active');
        });

        if (type === 'group') {
            document.querySelectorAll(`[data-group-id="${chatData.id}"]`).forEach(item => {
                item.classList.add('active');
            });
        } else {
            document.querySelectorAll(`[data-user-id="${chatData.id}"]`).forEach(item => {
                item.classList.add('active');
            });
        }

        const emptyState = document.getElementById('empty-state');
        const chatHeader = document.getElementById('chat-header');
        const messagesContainer = document.getElementById('messages-container');
        const inputContainer = document.getElementById('message-input-container');

        if (emptyState) {
            emptyState.classList.add('hidden');
            emptyState.style.display = 'none';
        }

        if (chatHeader) {
            chatHeader.classList.remove('hidden');
            chatHeader.style.display = 'flex';
        }

        if (messagesContainer) {
            messagesContainer.classList.remove('hidden');
            messagesContainer.style.display = 'block';
        }

        if (inputContainer) {
            inputContainer.classList.remove('hidden');
            inputContainer.style.display = 'flex';
            inputContainer.style.visibility = 'visible';
            inputContainer.style.opacity = '1';

            if (UI.isMobile()) {
                inputContainer.style.position = 'fixed';
                inputContainer.style.bottom = '0';
                inputContainer.style.left = '0';
                inputContainer.style.right = '0';
                inputContainer.style.zIndex = '120';
            }

            const sendBtn = document.getElementById('send-btn');
            const emojiBtn = document.getElementById('emoji-btn');
            const attachBtn = document.getElementById('attach-btn');

            if (sendBtn) {
                sendBtn.style.display = 'flex';
                sendBtn.style.visibility = 'visible';
            }
            if (emojiBtn) {
                emojiBtn.style.display = 'flex';
                emojiBtn.style.visibility = 'visible';
            }
            if (attachBtn) {
                attachBtn.style.display = 'flex';
                attachBtn.style.visibility = 'visible';
            }

            console.log('✅ Message input shown for', type, ':', {
                display: inputContainer.style.display,
                visibility: inputContainer.style.visibility,
                classList: inputContainer.classList.toString()
            });
        }

        // ✅ Build header with cached online indicator
        const avatarColor = UI.generateAvatarColor(chatData.name || chatData.username);
        const isOnline = type === 'private' ? (chatData.is_online || false) : false;  // ✅ Use cached status

        chatHeader.innerHTML = `
        <div class="chat-header-left">
            <button class="btn-icon" id="mobile-back-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
            </button>
            <div class="chat-header-avatar" style="background: ${avatarColor}; position: relative;">
                <span>${UI.getInitials(chatData.name || chatData.username)}</span>
                ${type === 'private' ? `<span class="status-badge ${isOnline ? 'online' : 'offline'}" data-user-id="${chatData.id}"></span>` : ''}
            </div>
            <div class="chat-header-info">
                <h3 class="chat-header-name">${UI.escapeHtml(chatData.name || chatData.username)}</h3>
                <div class="chat-header-status" id="chat-subtitle">
                    ${type === 'group'
                ? `${chatData.member_count || 0} members`
                : isOnline
                    ? '<span style="color: var(--success-color); font-weight: 600;">● online</span>'
                    : '<span style="color: var(--text-tertiary);">offline</span>'
            }
                </div>
            </div>
        </div>
        
        <div class="chat-header-actions">
            <!-- ✅ ADD: Search button -->
            <button class="btn-icon" id="search-messages-btn" title="Search messages">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
            </button>
            
            <!-- ✅ ADD: Info/Options button -->
            <button class="btn-icon" id="chat-options-btn" title="Options">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="1"></circle>
                    <circle cx="12" cy="5" r="1"></circle>
                    <circle cx="12" cy="19" r="1"></circle>
                </svg>
            </button>
        </div>
    `;

        const backBtn = document.getElementById('mobile-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                console.log('Back button clicked');
                this.handleMobileBack();
            });
        }

        const optionsBtn = document.getElementById('chat-options-btn');
        if (optionsBtn) {
            optionsBtn.addEventListener('click', (e) => {
                console.log('Options button clicked');
                this.showChatOptionsMenu(e, type);
            });
        }

        const searchBtn = document.getElementById('search-messages-btn');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                // For now, show a toast message
                UI.showToast('Search functionality coming soon!', 'info');

                // You can implement search functionality later:
                // this.showSearchBar();
            });
        }

        const messagesList = document.getElementById('messages-list');
        if (messagesList) {
            messagesList.innerHTML = this.createSkeletonLoading();
            console.log('✅ Skeleton loading created');
        }

        const infoSidebar = document.getElementById('info-sidebar');
        if (infoSidebar) {
            infoSidebar.classList.add('hidden');
            infoSidebar.style.display = 'none';
        }

        this.updateMobileNav();

        if (UI.isMobile()) {
            const sidebar = document.querySelector('.sidebar');
            if (sidebar) {
                sidebar.classList.remove('mobile-open');
            }
        }

        console.log('✅ Chat UI update complete');
    }


    createSkeletonLoading() {
        return `
        <div class="skeleton-loading">
            <!-- Message 1: Received -->
            <div class="skeleton-message">
                <div class="skeleton-avatar"></div>
                <div class="skeleton-message-content">
                    <div class="skeleton-sender"></div>
                    <div class="skeleton-bubble">
                        <div class="skeleton-line long"></div>
                        <div class="skeleton-line medium"></div>
                        <div class="skeleton-line short"></div>
                    </div>
                    <div class="skeleton-time"></div>
                </div>
            </div>
            
            <!-- Message 2: Sent -->
            <div class="skeleton-message own">
                <div class="skeleton-message-content">
                    <div class="skeleton-bubble">
                        <div class="skeleton-line medium"></div>
                        <div class="skeleton-line short"></div>
                    </div>
                    <div class="skeleton-time"></div>
                </div>
                <div class="skeleton-avatar"></div>
            </div>
            
            <!-- Message 3: Received -->
            <div class="skeleton-message">
                <div class="skeleton-avatar"></div>
                <div class="skeleton-message-content">
                    <div class="skeleton-sender"></div>
                    <div class="skeleton-bubble">
                        <div class="skeleton-line short"></div>
                        <div class="skeleton-line long"></div>
                    </div>
                    <div class="skeleton-time"></div>
                </div>
            </div>
            
            <!-- Message 4: Sent -->
            <div class="skeleton-message own">
                <div class="skeleton-message-content">
                    <div class="skeleton-bubble">
                        <div class="skeleton-line long"></div>
                        <div class="skeleton-line medium"></div>
                    </div>
                    <div class="skeleton-time"></div>
                </div>
                <div class="skeleton-avatar"></div>
            </div>
            
            <!-- Message 5: Received -->
            <div class="skeleton-message">
                <div class="skeleton-avatar"></div>
                <div class="skeleton-message-content">
                    <div class="skeleton-sender"></div>
                    <div class="skeleton-bubble">
                        <div class="skeleton-line medium"></div>
                        <div class="skeleton-line long"></div>
                        <div class="skeleton-line short"></div>
                    </div>
                    <div class="skeleton-time"></div>
                </div>
            </div>
        </div>
    `;
    }


    showChatOptionsMenu(event, chatType) {
        event.stopPropagation();

        // Remove existing menu if any
        document.querySelectorAll('.chat-options-menu').forEach(menu => menu.remove());

        const menu = document.createElement('div');
        menu.className = 'chat-options-menu';

        // Position near the button
        const buttonRect = event.currentTarget.getBoundingClientRect();
        menu.style.top = `${buttonRect.bottom + 8}px`;
        menu.style.right = `${window.innerWidth - buttonRect.right}px`;

        // ✅ Group info is in the options menu, not separate button
        const menuItems = chatType === 'group'
            ? [
                { icon: 'info', label: 'Group Info', action: 'info' },
                { icon: 'search', label: 'Search Messages', action: 'search' },
                { icon: 'bell-off', label: 'Mute Notifications', action: 'mute' },
                { icon: 'download', label: 'Export Chat', action: 'export' },
                { icon: 'log-out', label: 'Leave Group', action: 'leave', danger: true }
            ]
            : [
                { icon: 'info', label: 'Contact Info', action: 'info' },
                { icon: 'search', label: 'Search Messages', action: 'search' },
                { icon: 'bell-off', label: 'Mute Notifications', action: 'mute' },
                { icon: 'download', label: 'Export Chat', action: 'export' },
                { icon: 'trash', label: 'Clear Chat', action: 'clear', danger: true }
            ];

        menu.innerHTML = menuItems.map(item => `
            <button class="context-menu-item ${item.danger ? 'danger' : ''}" data-action="${item.action}">
                ${this.getMenuIcon(item.icon)}
                ${item.label}
            </button>
        `).join('');

        document.body.appendChild(menu);

        // Ensure menu stays in viewport
        setTimeout(() => {
            const rect = menu.getBoundingClientRect();
            if (rect.bottom > window.innerHeight) {
                menu.style.top = `${buttonRect.top - rect.height - 8}px`;
            }
            if (rect.right > window.innerWidth) {
                menu.style.left = `${buttonRect.left - rect.width + buttonRect.width}px`;
                menu.style.right = 'auto';
            }
        }, 0);

        // Add click handlers
        menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                this.handleChatOptionsAction(action, chatType);
                menu.remove();
            });
        });

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', () => menu.remove(), { once: true });
        }, 100);
    }


    // ========================================================================
    // NEW: Get Menu Icons
    // ========================================================================

    getMenuIcon(iconName) {
        const icons = {
            'info': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
            'search': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
            'bell-off': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13.73 21a2 2 0 0 1-3.46 0"></path><path d="M18.63 13A17.89 17.89 0 0 1 18 8"></path><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"></path><path d="M18 8a6 6 0 0 0-9.33-5"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>',
            'download': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
            'log-out': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>',
            'trash': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>'
        };
        return icons[iconName] || '';
    }

    // ========================================================================
    // NEW: Handle Chat Options Actions
    // ========================================================================

    handleChatOptionsAction(action, chatType) {
        switch (action) {
            case 'info':
                if (chatType === 'group') {
                    // Simply toggle the info sidebar
                    this.toggleInfoSidebar();
                } else {
                    UI.showToast('Contact info coming soon', 'info');
                }
                break;
            case 'search':
                UI.showToast('Message search coming soon', 'info');
                break;
            case 'mute':
                UI.showToast('Notifications muted for this chat', 'success');
                break;
            case 'export':
                if (chatType === 'group') {
                    if (window.chatBackup) {
                        window.chatBackup.exportChat(this.currentChat.id, 'group');
                    } else {
                        UI.showToast('Export feature coming soon', 'info');
                    }
                } else {
                    if (window.chatBackup) {
                        window.chatBackup.exportChat(this.currentChat.id, 'private');
                    } else {
                        UI.showToast('Export feature coming soon', 'info');
                    }
                }
                break;
            case 'leave':
                this.handleLeaveGroup();
                break;
            case 'clear':
                if (confirm('Clear all messages in this chat? This cannot be undone.')) {
                    UI.showToast('Clear chat coming soon', 'info');
                }
                break;
        }
    }
    async loadChatDataInBackground(groupId) {
        try {
            console.log('🔥 Loading chat data in background...');

            // ✅ Ensure message input is visible
            const inputContainer = document.getElementById('message-input-container');
            if (inputContainer) {
                inputContainer.classList.remove('hidden');
                inputContainer.style.display = 'flex';
                inputContainer.style.visibility = 'visible';
            }

            // Load messages and read status in parallel
            const [messagesResult, readStatusResult] = await Promise.allSettled([
                this.loadMessages(1, false), // Explicitly first page, not appending
                this.loadReadMessages()
            ]);

            // Check for errors
            if (messagesResult.status === 'rejected') {
                console.error('Failed to load messages:', messagesResult.reason);
                const container = document.getElementById('messages-list');
                if (container) {
                    container.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--danger-color);">Failed to load messages. Please try again.</div>';
                }
                UI.showToast('Failed to load messages', 'error');
                return;
            }

            // Load group info if it's a group chat
            if (groupId) {
                this.loadGroupInfo(groupId).catch(err => {
                    console.error('Failed to load group info:', err);
                });
            }

            // ✅ Setup infinite scroll immediately after messages load
            // Wait just enough for scroll to complete
            setTimeout(() => {
                this.setupInfiniteScroll();
            }, 200);

            console.log('✅ Chat data loaded successfully');

        } catch (error) {
            console.error('Error loading chat data:', error);
            const container = document.getElementById('messages-list');
            if (container) {
                container.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--danger-color);">Failed to load chat. Please try again.</div>';
            }
            UI.showToast('Error loading chat', 'error');
        }
    }


    // ========================================================================
    // Load Messages (BOTTOM TO TOP - WhatsApp Style)
    // ========================================================================

    async loadMessages(page = 1, append = false) {
        const container = document.getElementById('messages-list');
        const loadingIndicator = document.getElementById('messages-loading-top');
        const messagesContainer = document.getElementById('messages-container');

        if (page > 1 && loadingIndicator && !this.isLoadingMessages) {
            loadingIndicator.classList.add('show');
        }

        this.isLoadingMessages = true;

        try {
            let messages = [];

            if (this.currentChat.type === 'group') {
                const filters = {
                    group: this.currentChat.id,
                    message_type: 'group',
                    page: page,
                    page_size: this.messagesPerPage
                };
                const response = await api.getMessages(filters);
                messages = response.results || response;
                this.hasMoreMessages = response.next !== null;
            } else {
                // FIXED: Use the recipient parameter to get only messages between current user and this specific user
                const otherUserId = this.currentChat.id;

                const filters = {
                    message_type: 'private',
                    recipient: otherUserId, // Add this parameter
                    page: page,
                    page_size: this.messagesPerPage
                };

                const response = await api.getMessages(filters);
                messages = response.results || response;

                // IMPORTANT: Also filter for the reverse direction
                // The API endpoint should handle both directions with the recipient parameter
                // but if not, we need to filter client-side

                this.hasMoreMessages = response.next !== null;
            }

            // Sort messages chronologically (oldest first)
            messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

            if (append) {
                // ✅ WHATSAPP-STYLE SEAMLESS PREPEND
                this.allLoadedMessages = [...messages, ...this.allLoadedMessages];

                // Save scroll metrics BEFORE any DOM changes
                const scrollHeightBefore = messagesContainer.scrollHeight;
                const scrollTopBefore = messagesContainer.scrollTop;

                // Prepend messages in ONE operation
                this.prependMessagesWithDates(messages);

                // INSTANT scroll restoration
                const scrollHeightAfter = messagesContainer.scrollHeight;
                const heightDifference = scrollHeightAfter - scrollHeightBefore;

                // Restore scroll position SYNCHRONOUSLY
                messagesContainer.scrollTop = scrollTopBefore + heightDifference;

                console.log(`📍 Seamless prepend: +${heightDifference}px`);

            } else {
                // Initial load
                this.allLoadedMessages = messages;
                container.innerHTML = '';

                // ✅ NEW: Find first unread message for scroll targeting
                const firstUnreadIndex = this.renderMessagesWithDates(messages, true);

                // ✅ SMART SCROLL:
                // If we have an unread divider (returned index != -1), scroll to it.
                // Otherwise, scroll to bottom.
                if (firstUnreadIndex !== -1) {
                    console.log('📜 Scrolling to first unread message');
                    requestAnimationFrame(() => {
                        const unreadDivider = document.querySelector('.unread-divider');
                        if (unreadDivider) {
                            unreadDivider.scrollIntoView({ behavior: 'auto', block: 'center' });
                        }
                    });
                } else {
                    // Scroll to bottom
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            messagesContainer.scrollTop = messagesContainer.scrollHeight;
                        });
                    });
                }
            }

        } catch (error) {
            console.error('Load messages failed:', error);
            if (!append) {
                container.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--danger-color);">Failed to load messages</div>';
            }
        } finally {
            this.isLoadingMessages = false;
            if (loadingIndicator) {
                loadingIndicator.classList.remove('show');
            }
        }
    }
    // ========================================================================
    // NEW: Prepend Messages (for infinite scroll)
    // ========================================================================

    prependMessagesWithDates(messages) {
        const container = document.getElementById('messages-list');
        const fragment = document.createDocumentFragment();

        // Get first existing message's date to handle duplicate date dividers
        const firstExistingMessage = container.querySelector('.message');
        const firstExistingDate = firstExistingMessage ? firstExistingMessage.dataset.date : null;

        let lastRenderedDate = null;

        // Build fragment with ALL messages and date dividers
        messages.forEach((message) => {
            const messageDate = new Date(message.created_at).toDateString();

            // Add date divider if date changed
            if (messageDate !== lastRenderedDate) {
                const divider = UI.createDateDivider(message.created_at);
                divider.dataset.date = messageDate;
                fragment.appendChild(divider);
                lastRenderedDate = messageDate;
            }

            const messageElement = UI.createMessage(message, this.currentUser.id);
            messageElement.dataset.date = messageDate;
            fragment.appendChild(messageElement);

            // Observe for read tracking (only for received messages)
            const senderId = message.sender_id || message.sender?.id;
            const isOwn = senderId === this.currentUser.id;
            if (this.messageObserver && !isOwn) {
                this.messageObserver.observe(messageElement);
            }
        });

        // Remove duplicate date divider if last prepended date matches first existing date
        if (lastRenderedDate === firstExistingDate) {
            const firstDivider = container.querySelector('.date-divider');
            if (firstDivider && firstDivider.dataset.date === firstExistingDate) {
                firstDivider.remove();
            }
        }

        // ✅ Prepend everything in ONE DOM operation (prevents layout thrashing)
        container.insertBefore(fragment, container.firstChild);
    }

    // ========================================================================
    // NEW: Setup Infinite Scroll Listener
    // ========================================================================

    setupInfiniteScroll() {
        const messagesContainer = document.getElementById('messages-container');
        if (!messagesContainer) {
            console.warn('❌ Messages container not found');
            return;
        }

        // Remove old listener
        if (this.infiniteScrollHandler) {
            messagesContainer.removeEventListener('scroll', this.infiniteScrollHandler);
        }

        // Throttle helper
        let scrollThrottle;

        // ✅ Throttled handler for smoother performance
        this.infiniteScrollHandler = () => {
            if (scrollThrottle) return; // Skip if throttled

            scrollThrottle = setTimeout(() => {
                scrollThrottle = null;
            }, 50); // Check every 50ms max

            // Skip if already loading or no more messages
            if (this.isLoadingMessages || !this.hasMoreMessages) return;

            const scrollTop = messagesContainer.scrollTop;

            // ✅ Trigger when within 400px of top (generous threshold)
            if (scrollTop < 400) {
                console.log('🔄 Loading page', this.messagesPage + 1);
                this.messagesPage++;
                this.loadMessages(this.messagesPage, true);
            }
        };

        // Use passive listener for better scroll performance
        messagesContainer.addEventListener('scroll', this.infiniteScrollHandler, { passive: true });

        console.log('✅ Infinite scroll ready');
    }



    renderMessagesWithDates(messages, checkForUnread = false) {
        const container = document.getElementById('messages-list');
        let lastDate = null;
        let unreadDividerAdded = false;
        let firstUnreadIndex = -1;

        // Get unread count to determine where to split
        let unreadCount = 0;
        if (this.currentChat) {
            const chatId = this.currentChat.id;
            unreadCount = this.unreadCounts.all_chats[chatId] || 0;
        }

        // Optimization: Find the index where unread messages start
        // This is simple: It's the last N messages
        const unreadStartIndex = messages.length - unreadCount;

        messages.forEach((message, index) => {
            const messageDate = new Date(message.created_at).toDateString();

            // Add date divider if date changed
            if (messageDate !== lastDate) {
                const divider = UI.createDateDivider(message.created_at);
                container.appendChild(divider);
                lastDate = messageDate;
            }

            // ✅ Add Unread Divider
            // We verify:
            // 1. We are looking for unread (checkForUnread is true)
            // 2. We haven't added it yet
            // 3. We have unread messages (unreadCount > 0)
            // 4. This is the start of unread messages (index >= unreadStartIndex)
            // 5. The message is NOT from us (sender != current user)
            const senderId = message.sender_id || message.sender?.id;
            const isOwn = senderId === this.currentUser.id;

            if (checkForUnread && !unreadDividerAdded && unreadCount > 0 && index >= unreadStartIndex && !isOwn) {
                const unreadDivider = document.createElement('div');
                unreadDivider.className = 'unread-divider';
                unreadDivider.innerHTML = `<span>${unreadCount} UNREAD MESSAGES</span>`;
                container.appendChild(unreadDivider);

                unreadDividerAdded = true;
                firstUnreadIndex = index;
            }

            // CRITICAL: Pass current user ID to ensure proper alignment
            const messageElement = UI.createMessage(message, this.currentUser.id);

            container.appendChild(messageElement);

            // Observe message for read tracking (only for received messages)
            if (this.messageObserver && !isOwn) {
                this.messageObserver.observe(messageElement);
            }
        });

        return firstUnreadIndex;
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

            // ✅ CRITICAL: Properly hide login screen and show chat screen
            UI.showScreen('chat-screen');

            // ✅ Clear login form
            document.getElementById('login-form').reset();

            // ✅ Set current user and initialize chat
            this.currentUser = {
                id: response.user.id,
                username: response.user.username,
                email: response.user.email,
                first_name: response.user.first_name,
                last_name: response.user.last_name
            };

            // ✅ Store user ID in localStorage
            localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(this.currentUser.id));

            console.log('👤 Current User ID set to:', this.currentUser.id);

            // ✅ Initialize chat immediately (don't wait for page reload)
            await this.initializeChat();

            // ✅ Update mobile nav for chat interface
            this.updateMobileNav();

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

            // ✅ FIX: Clear chat and navigate to chat list
            this.currentChat = null;
            UI.show('empty-state');
            UI.hide('chat-header');
            UI.hide('messages-container');
            UI.hide('message-input-container');

            // ✅ FIX: Navigate to chats tab
            this.navigateToTab('chats');

            // Show mobile navigation
            this.updateMobileNav();

            // Show sidebar on mobile
            if (UI.isMobile()) {
                const sidebar = document.querySelector('.sidebar');
                if (sidebar) {
                    sidebar.classList.add('mobile-open');
                }
            }

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
        if (e) {
            e.preventDefault();
        }

        // ✅ Prevent duplicate sending
        if (this.isSending) {
            console.log('⚠️ Message already sending, please wait...');
            return;
        }

        const input = document.getElementById('message-input');
        const content = input.value.trim();

        if (!content || !this.currentChat) {
            this.isSending = false;
            return;
        }

        try {
            // ✅ Set sending lock
            this.isSending = true;

            const messageData = {
                content,
                message_type: this.currentChat.type
            };

            // ✅ NEW: Add reply ID if exists
            if (this.replyingToMessage) {
                messageData.parent_message_id = this.replyingToMessage.id;
            }

            if (this.currentChat.type === 'group') {
                messageData.group = this.currentChat.id;
                // Note: We rely on API for sending to ensure persistence.
                // The backend will broadcast the message via WebSocket.
            } else {
                const recipientId = this.currentChat.id;
                const currentUserId = this.currentUser.id;

                if (recipientId === currentUserId) {
                    throw new Error('Cannot send message to yourself');
                }

                messageData.recipient_id = recipientId;
            }

            // ✅ OPTIMISTIC UI UPDATE: Clear input and update preview immediately
            input.value = '';
            input.style.height = 'auto'; // Reset height
            input.focus();

            // Clear reply state
            if (this.replyingToMessage) {
                this.cancelReply();
            }

            // Update chat list preview immediately
            this.updateChatPreview({
                id: this.currentChat.id,
                type: this.currentChat.type,
                last_message: content,
                last_message_time: new Date().toISOString(),
                sender_username: this.currentUser.username
            });

            // Send "stopped typing" signal immediately
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

            // Note: We rely on API for sending to ensure persistence.
            // The backend will broadcast the message via WebSocket.
            // This is awaited, but UI is already updated.
            const savedMessage = await api.sendMessage(messageData);

            // ✅ Release sending lock after successful send
            this.isSending = false;

            // Scroll to bottom ensures we see the new message when it renders (via broadcast)
            setTimeout(() => UI.scrollToBottom('messages-container'), 100);
        } catch (error) {
            console.error('Send failed:', error);
            UI.showToast('Failed to send: ' + error.message, 'error');

            // ✅ Release sending lock on error too
            this.isSending = false;
        }
    }

    // ========================================================================
    // ========================================================================
    // Advanced Message Actions (Telegram Style)
    // ========================================================================

    handleContextMenu(e, messageId) {
        this.closeAllMenus();

        const message = this.allLoadedMessages.find(m => String(m.id) === String(messageId) || String(m.message_id) === String(messageId));
        if (!message) return;

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.dataset.messageId = messageId;

        // Reactions Bar
        const reactionsBar = document.createElement('div');
        reactionsBar.className = 'reaction-bar';
        reactionsBar.innerHTML = ['👍', '❤️', '😂', '😮', '😢', '🔥'].map(emoji => `
            <span class="reaction-btn" onclick="app.toggleReaction('${messageId}', '${emoji}')">${emoji}</span>
        `).join('');
        menu.appendChild(reactionsBar);

        // Menu Actions
        const actions = [
            { icon: 'reply', label: 'Reply', action: () => this.handleReply(messageId) },
            { icon: 'copy', label: 'Copy Content', action: () => this.copyToClipboard(message.content) },
            { icon: 'forward', label: 'Forward', action: () => this.openForwardModal(messageId) },
            { icon: 'trash', label: 'Delete', action: () => this.handleDeleteMessage(messageId), danger: true }
        ];

        actions.forEach(item => {
            const div = document.createElement('div');
            div.className = `context-menu-item ${item.danger ? 'danger' : ''}`;
            div.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    ${this.getIconPath(item.icon)}
                </svg>
                <span>${item.label}</span>
            `;
            div.onclick = (event) => {
                event.stopPropagation();
                item.action();
                this.closeAllMenus();
            };
            menu.appendChild(div);
        });

        document.body.appendChild(menu);

        // Positioning
        let x = e.clientX || (e.touches && e.touches[0].clientX);
        let y = e.clientY || (e.touches && e.touches[0].clientY);

        const menuRect = menu.getBoundingClientRect();

        // Ensure menu stays within window bounds
        if (x + menuRect.width > window.innerWidth) x = window.innerWidth - menuRect.width - 10;
        if (y + menuRect.height > window.innerHeight) y = window.innerHeight - menuRect.height - 10;
        if (x < 10) x = 10;
        if (y < 10) y = 10;

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        // Global click to close
        const closer = (evt) => {
            if (!menu.contains(evt.target)) {
                this.closeAllMenus();
                document.removeEventListener('mousedown', closer);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closer), 10);
    }

    closeAllMenus() {
        document.querySelectorAll('.context-menu, .actions-menu-dropdown').forEach(m => m.remove());
    }

    getIconPath(icon) {
        const paths = {
            reply: '<path d="M3 10h10a8 8 0 0 1 8 8v2"></path><polyline points="9 14 5 10 9 6"></polyline>',
            copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
            forward: '<polyline points="15 3 21 9 15 15"></polyline><path d="M21 9H9a10 10 0 0 0-10 10"></path>',
            trash: '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>'
        };
        return paths[icon] || '';
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            UI.showToast('Copied to clipboard', 'info');
        }).catch(err => {
            console.error('Copy failed:', err);
        });
    }

    async toggleReaction(messageId, emoji) {
        try {
            await api.reactToMessage(messageId, emoji);
            this.closeAllMenus();
        } catch (err) {
            UI.showToast('Failed to react: ' + err.message, 'error');
        }
    }

    handleReply(messageId) {
        const message = this.allLoadedMessages.find(m => String(m.id) === String(messageId) || String(m.message_id) === String(messageId));
        if (!message) return;

        this.replyingToMessage = message;

        let banner = document.getElementById('reply-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'reply-banner';
            banner.className = 'input-reply-banner';
            const form = document.getElementById('message-form');
            form.insertBefore(banner, form.firstChild);
        }

        banner.innerHTML = `
            <div class="input-reply-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10h10a8 8 0 0 1 8 8v2"></path><polyline points="9 14 5 10 9 6"></polyline></svg>
            </div>
            <div class="input-reply-content">
                <div class="input-reply-title">${UI.escapeHtml(message.sender?.username || message.sender_username || 'Unknown')}</div>
                <div class="input-reply-message">${UI.escapeHtml(message.content || '...')}</div>
            </div>
            <div class="close-reply-btn" onclick="app.cancelReply()">
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </div>
        `;
        banner.style.display = 'flex';
        document.getElementById('message-input').focus();
    }

    cancelReply() {
        this.replyingToMessage = null;
        document.getElementById('reply-banner')?.remove();
    }

    scrollToMessage(messageId) {
        const el = document.querySelector(`.message[data-message-id="${messageId}"]`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight');
            setTimeout(() => el.classList.remove('highlight'), 2000);
        } else {
            UI.showToast('Message not found', 'info');
        }
    }

    openForwardModal(messageId) {
        const message = this.allLoadedMessages.find(m => String(m.id) === String(messageId) || String(m.message_id) === String(messageId));
        if (!message) return;

        this.forwardingMessage = message;
        UI.showModal('forward-modal');

        // Show all chats for selection
        const chats = this.allChats || [];
        UI.renderForwardChatList(chats, 'forward-chats-list');

        // Setup search
        const searchInput = document.getElementById('forward-search');
        if (searchInput) {
            searchInput.oninput = (e) => {
                const query = e.target.value.toLowerCase();
                const filtered = chats.filter(c => (c.name || c.username || '').toLowerCase().includes(query));
                UI.renderForwardChatList(filtered, 'forward-chats-list');
            };
            searchInput.value = '';
            searchInput.focus();
        }
    }

    async confirmForward(chatId, chatType) {
        if (!this.forwardingMessage) return;

        try {
            const content = this.forwardingMessage.content;
            const data = {
                content: content,
                is_forwarded: true // Custom field if backend supports it, otherwise just content
            };

            if (chatType === 'group') {
                data.group_id = chatId;
            } else {
                data.recipient_id = chatId;
            }

            await api.sendMessage(data);
            UI.hideModal('forward-modal');
            UI.showToast('Message forwarded', 'success');

            // Switch to the chat where message was forwarded
            this.switchChat(chatId, chatType);
        } catch (err) {
            UI.showToast('Failed to forward: ' + err.message, 'error');
        } finally {
            this.forwardingMessage = null;
        }
    }
    // Add this helper method to your MessagingApp class
    // ====================================================================

    scrollToBottomSmooth() {
        const container = document.getElementById('messages-container');
        if (container) {
            // Smooth scroll to bottom
            setTimeout(() => {
                container.scrollTo({
                    top: container.scrollHeight,
                    behavior: 'smooth'
                });
            }, 100);
        }
    }


    updateStatusIndicator(message, status = 'online', duration = 0) {
        const statusText = document.querySelector('.status-text');
        const statusIndicator = document.querySelector('.status-indicator');

        if (!statusText || !statusIndicator) return;

        // Update text
        statusText.textContent = message;

        // Update indicator class
        statusIndicator.className = 'status-indicator';
        statusIndicator.classList.add(status);

        // If duration is set, revert back to "Online" after timeout
        if (duration > 0) {
            setTimeout(() => {
                statusText.textContent = 'Online';
                statusIndicator.className = 'status-indicator online';
            }, duration);
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
            sender_username: data.sender_username,
            sender_id: data.sender_id
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
            sender_username: data.sender_username,
            sender_id: data.sender_id
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
            String(chat.id) === String(messageData.id) && chat.type === messageData.type
        );

        const listContainer = document.querySelector('.list-container .simplebar-content') || document.querySelector('.list-container');
        if (!listContainer) return;

        const selector = messageData.type === 'group'
            ? `[data-group-id="${messageData.id}"]`
            : `[data-user-id="${messageData.id}"]`;

        console.log(`[Preview] Updating logic for:`, messageData);
        console.log(`[Preview] Selector used:`, selector);

        let chatItem = listContainer.querySelector(selector);
        console.log(`[Preview] Chat item found:`, !!chatItem);

        if (chatIndex !== -1) {
            // 1. Update local data
            const chat = this.allChats[chatIndex];
            chat.last_message = messageData.last_message;
            chat.last_message_time = messageData.last_message_time;

            // 2. Move to top of local array
            this.allChats.splice(chatIndex, 1);
            this.allChats.unshift(chat);

            if (chatItem) {
                // Update Subtitle
                const subtitle = chatItem.querySelector('.list-item-subtitle');
                if (subtitle) {
                    subtitle.textContent = UI.truncate(messageData.last_message, 40);
                    subtitle.style.color = '';
                    subtitle.style.fontStyle = '';
                    delete subtitle.dataset.originalText;
                }

                // Update Time
                const timeEl = chatItem.querySelector('.list-item-time');
                if (timeEl) {
                    timeEl.textContent = UI.formatTime(messageData.last_message_time);
                }

                // Move to Top
                if (listContainer.firstChild !== chatItem) {
                    listContainer.insertBefore(chatItem, listContainer.firstChild);
                }
            }
        } else {
            // New chat - Don't reload EVERYTHING. Just fetch the chat item and prepend.
            console.log('🆕 New chat detected, fetching meta...');
            this.handleNewChatIncoming(messageData);
            return;
        }

        // ✅ HANDLE LIVE UNREAD INCREMENT (Optimistic)
        // If message is NOT from us AND NOT the current active chat, increment badge
        const isFromUs = String(messageData.sender_id) === String(this.currentUser.id);
        const isCurrentChat = this.currentChat && String(this.currentChat.id) === String(messageData.id) && this.currentChat.type === messageData.type;

        if (!isFromUs && !isCurrentChat && chatItem) {
            // Update unread state in local counts
            const currentCount = this.unreadCounts.all_chats[messageData.id] || 0;
            const newCount = currentCount + 1;

            this.unreadCounts.all_chats[messageData.id] = newCount;
            this.unreadCounts.total = (this.unreadCounts.total || 0) + 1;

            if (messageData.type === 'user') this.unreadCounts.users[messageData.id] = newCount;
            else this.unreadCounts.groups[messageData.id] = newCount;

            // Update UI Total
            this.updateTotalUnreadBadge();

            // Update UI Badge on item
            const metaDiv = chatItem.querySelector('.list-item-meta');
            if (metaDiv) {
                let badge = metaDiv.querySelector('.unread-badge');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'badge unread-badge';
                    metaDiv.appendChild(badge);

                    const subtitle = chatItem.querySelector('.list-item-subtitle');
                    if (subtitle) subtitle.classList.add('unread');
                }
                badge.textContent = newCount > 99 ? '99+' : newCount;
                badge.style.transform = 'scale(1.2)';
                setTimeout(() => badge.style.transform = '', 200);
            }
        }
    }

    async handleNewChatIncoming(messageData) {
        try {
            // We need to fetch the full chat object to render it correctly
            const chatsResponse = await api.getChats();
            const fullChat = chatsResponse.chats?.find(c =>
                String(c.id) === String(messageData.id) && c.type === messageData.type
            );

            if (fullChat) {
                // Add to array
                this.allChats.unshift(fullChat);

                // Add to DOM
                const listContainer = document.querySelector('.list-container .simplebar-content') || document.querySelector('.list-container');
                if (listContainer) {
                    const item = this.createChatItem(fullChat);
                    listContainer.insertBefore(item, listContainer.firstChild);
                }
            }
        } catch (e) {
            console.error('Failed to handle incoming new chat:', e);
            // Last resort fallback
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
        // ✅ Prevent duplicate rendering (e.g. from both WebSocket and API)
        const msgId = message.id || message.message_id;
        if (msgId && document.querySelector(`.message[data-message-id="${msgId}"]`)) {
            console.log(`Duplicate message ${msgId} ignored`);
            return;
        }

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

        // Create and append message
        const messageElement = UI.createMessage(message, this.currentUser.id);
        messageElement.dataset.date = new Date(message.created_at || message.timestamp).toDateString();
        container.appendChild(messageElement);

        // ✅ IMPORTANT: Keep cache in sync for live reactions/actions
        if (!this.allLoadedMessages.some(m => String(m.id || m.message_id) === String(message.id || message.message_id))) {
            this.allLoadedMessages.push(message);
        }

        // Observe for read tracking
        const senderId = message.sender_id || message.sender?.id;
        const isOwn = senderId === this.currentUser.id;
        if (this.messageObserver && !isOwn) {
            this.messageObserver.observe(messageElement);
        }

        // ✅ AUTO-SCROLL to bottom after adding message
        this.scrollToBottomSmooth();
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

        // 🚀 INSTANT: Immediately update local unread count if applicable
        // This makes the badge update feel real-time
        if (this.currentChat) {
            const chatId = this.currentChat.id;
            const type = this.currentChat.type;

            // Decrement local count if it exists
            if (this.unreadCounts.all_chats[chatId] && this.unreadCounts.all_chats[chatId] > 0) {
                this.unreadCounts.all_chats[chatId]--;
                this.unreadCounts.total--;

                if (this.unreadCounts.all_chats[chatId] === 0) {
                    delete this.unreadCounts.all_chats[chatId];
                    if (type === 'private') delete this.unreadCounts.users[chatId];
                    else delete this.unreadCounts.groups[chatId];
                }

                // Update badges immediately
                this.updateTotalUnreadBadge();

                // Allow immediate badge update in list (using our new direct DOM method)
                this.handleUnreadCountUpdate({
                    total_unread: this.unreadCounts.total,
                    all_chats: this.unreadCounts.all_chats,
                    groups: this.unreadCounts.groups,
                    users: this.unreadCounts.users
                });
            }
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

    handleMessageReaction(data) {
        const { message_id, user_id, emoji, action, username } = data;

        const message = this.allLoadedMessages.find(m => m.id === message_id || m.message_id === message_id);
        if (!message) return;

        if (!message.reactions) message.reactions = [];
        const uid = String(user_id);

        if (action === 'added') {
            if (!message.reactions.some(r => String(r.user?.id || r.user_id) === uid && r.emoji === emoji)) {
                message.reactions.push({
                    user: { id: uid, username: username },
                    user_id: uid,
                    emoji: emoji,
                    created_at: data.timestamp
                });
            }
        } else if (action === 'removed') {
            message.reactions = message.reactions.filter(r => !(String(r.user?.id || r.user_id) === uid && r.emoji === emoji));
        }

        const msgEl = document.querySelector(`.message[data-message-id="${message_id}"]`);
        if (msgEl) {
            const newNode = UI.createMessage(message, this.currentUser.id);
            msgEl.innerHTML = newNode.innerHTML;
        }
    }

    // ========================================================================
    // Group Info Management
    // ========================================================================

    async loadGroupInfo(groupId) {
        try {
            // Load group details and members in parallel
            const [groupDetails, membersData] = await Promise.all([
                api.getGroup(groupId),
                api.getGroupMembers(groupId)
            ]);

            const members = membersData;

            // Update UI elements
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

            // Sort members
            const sortedMembers = [...members.members].sort((a, b) => {
                if (a.user.id === this.currentUser.id) return -1;
                if (b.user.id === this.currentUser.id) return 1;
                if (a.is_admin && !b.is_admin) return -1;
                if (!a.is_admin && b.is_admin) return 1;
                return a.user.username.localeCompare(b.user.username);
            });

            sortedMembers.forEach(member => {
                const memberDiv = this.createMemberItemWithControls(member, isAdmin, isCreator);
                container.appendChild(memberDiv);
            });
        } catch (error) {
            console.error('Failed to load group info:', error);
            throw error;
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

    handleTyping(event) {
        if (!this.currentChat) return;

        const input = document.getElementById('message-input');

        // Handle Enter key press
        if (event && event.type === 'keydown' && event.key === 'Enter') {
            // Shift+Enter = new line, Enter = send
            if (!event.shiftKey) {
                event.preventDefault(); // Prevent default (new line)

                // Send message if there's content
                const content = input.value.trim();
                if (content && !this.isSending) {
                    this.handleSendMessage(event);
                }

                // Stop typing indicator immediately when sending
                this.clearTypingTimeout();
                this.sendTypingStatus(false);
                return;
            }
            // Shift+Enter allows new line (default behavior)
            return;
        }

        // Ensure we only process input events for typing indicators
        // and ignore non-character keys during keydown if needed
        if (event && event.type === 'keydown' && event.key !== 'Enter') {
            // Optional: could filter out non-char keys here
        }

        // Clear previous timeout
        this.clearTypingTimeout();

        // Send typing indicator (only if text exists)
        if (input.value.trim()) {
            // Only send "started typing" if we haven't already or if timeout renewed
            this.sendTypingStatus(true);

            // Stop typing after 2 seconds of inactivity
            this.typingTimeout = setTimeout(() => {
                this.sendTypingStatus(false);
            }, 2000);
        } else {
            // If input is empty (user deleted everything), send stop typing
            this.sendTypingStatus(false);
        }
    }

    sendTypingStatus(isTyping) {
        if (!this.currentChat) return;

        const payload = { is_typing: isTyping };

        if (this.currentChat.type === 'group') {
            payload.group_id = this.currentChat.id;
        } else {
            payload.recipient_id = this.currentChat.id;
        }

        // Use the centralized method or direct ws
        ws.send('typing_indicator', payload);
    }

    handleTypingIndicator(data) {
        // data: { user_id, username, is_typing, group_id (opt) }

        console.log('📨 Typing indicator received:', data);

        // 0. CRITICAL: Don't show your own typing indicator!
        if (data.user_id === this.currentUser.id) {
            console.log('⏭️ Ignoring own typing indicator');
            return;
        }

        // 1. Determine the chat ID for this typing event
        // For groups: chatId is group_id
        // For private: chatId is the OTHER user's ID (the one typing)
        const chatId = data.group_id || data.user_id;
        const chatType = data.group_id ? 'group' : 'user';

        console.log('📍 Chat info - ID:', chatId, 'Type:', chatType);

        // 2. Update chat list preview with typing status
        this.updateChatListTyping(chatId, chatType, data.is_typing, data.username);

        // 3. Check if this typing event is relevant to current chat
        if (!this.currentChat) {
            console.log('⏭️ No current chat open');
            return;
        }

        const isCurrentChat =
            (data.group_id && this.currentChat.type === 'group' && this.currentChat.id == data.group_id) ||
            (!data.group_id && this.currentChat.type === 'private' && this.currentChat.id == data.user_id);

        console.log('🎯 Is current chat?', isCurrentChat, 'Current:', this.currentChat);

        if (!isCurrentChat) {
            console.log('⏭️ Not for current chat');
            return;
        }

        // 4. Clear any existing timeout for this user locally (to prevent flickering)
        if (this.typingIndicatorTimeouts.has(data.user_id)) {
            clearTimeout(this.typingIndicatorTimeouts.get(data.user_id));
            this.typingIndicatorTimeouts.delete(data.user_id);
        }

        // 5. Update UI in message area
        if (data.is_typing) {
            console.log('✅ Showing typing indicator for:', data.username);
            UI.showTypingIndicator(data.username);

            // Auto-scroll to show typing indicator
            UI.scrollToBottom('messages-container');

            // Safety timeout: Auto-hide after 3 seconds in case we miss the "stop" event
            const timeoutId = setTimeout(() => {
                console.log('⏰ Auto-hiding typing indicator (timeout)');
                UI.hideTypingIndicator();
                this.typingIndicatorTimeouts.delete(data.user_id);
            }, 3000);

            this.typingIndicatorTimeouts.set(data.user_id, timeoutId);
        } else {
            console.log('❌ Hiding typing indicator');
            UI.hideTypingIndicator();
        }
    }

    updateChatListTyping(chatId, chatType, isTyping, username) {
        // Find the chat item in the list
        let chatItem;
        if (chatType === 'group') {
            chatItem = document.querySelector(`[data-group-id="${chatId}"]`);
        } else {
            chatItem = document.querySelector(`[data-user-id="${chatId}"]`);
        }

        if (!chatItem) return;

        const subtitle = chatItem.querySelector('.list-item-subtitle');
        if (!subtitle) return;

        if (isTyping) {
            // Store original text if not already stored
            if (!subtitle.dataset.originalText) {
                subtitle.dataset.originalText = subtitle.textContent;
            }

            // Show typing indicator
            subtitle.innerHTML = '<span style="color: var(--primary-color); font-style: italic;">typing...</span>';
        } else {
            // Restore original text
            if (subtitle.dataset.originalText) {
                subtitle.textContent = subtitle.dataset.originalText;
                delete subtitle.dataset.originalText;
            }
        }
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

class UserProfileManager {
    constructor(app) {
        this.app = app;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Open profile when clicking avatar or username in sidebar header
        const profileTriggers = document.querySelectorAll('#current-user-avatar, .user-info');
        profileTriggers.forEach(trigger => {
            trigger.addEventListener('click', () => {
                this.openProfile();
            });
            trigger.style.cursor = 'pointer';
        });
    }

    openProfile() {
        const user = this.app.currentUser;
        if (!user) {
            UI.showToast('User information not available', 'error');
            return;
        }

        // Create or update profile modal
        this.createProfileModal(user);
    }

    createProfileModal(user) {
        // Remove existing modal if any
        const existingModal = document.getElementById('user-profile-modal');
        if (existingModal) {
            existingModal.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'user-profile-modal';
        modal.className = 'modal show';

        const avatarColor = UI.generateAvatarColor(user.username);
        const initials = UI.getInitials(user.username);

        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>Profile</h3>
                    <button class="btn-icon close-modal">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="modal-body">
                    <!-- Profile Header -->
                    <div style="text-align: center; margin-bottom: 32px;">
                        <div class="avatar" style="width: 100px; height: 100px; font-size: 40px; margin: 0 auto 16px; background: ${avatarColor}; position: relative; cursor: pointer;" id="profile-avatar-edit">
                            <span>${initials}</span>
                            <div style="position: absolute; bottom: 0; right: 0; width: 32px; height: 32px; background: var(--primary-color); border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid var(--bg-primary); box-shadow: var(--shadow-sm);">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                                    <circle cx="12" cy="13" r="4"></circle>
                                </svg>
                            </div>
                        </div>
                        <h3 style="font-size: 24px; font-weight: 700; margin-bottom: 4px;">${UI.escapeHtml(user.username)}</h3>
                        <p style="color: var(--text-tertiary); font-size: 14px;">${UI.escapeHtml(user.email)}</p>
                    </div>

                    <!-- Profile Information -->
                    <div style="display: flex; flex-direction: column; gap: 16px;">
                        <div class="profile-field">
                            <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Username</label>
                            <div style="padding: 12px 16px; background: var(--bg-secondary); border-radius: var(--radius-md); font-size: 15px; color: var(--text-primary);">
                                ${UI.escapeHtml(user.username)}
                            </div>
                        </div>

                        <div class="profile-field">
                            <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Email</label>
                            <div style="padding: 12px 16px; background: var(--bg-secondary); border-radius: var(--radius-md); font-size: 15px; color: var(--text-primary);">
                                ${UI.escapeHtml(user.email)}
                            </div>
                        </div>

                        ${user.first_name ? `
                            <div class="profile-field">
                                <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">First Name</label>
                                <div style="padding: 12px 16px; background: var(--bg-secondary); border-radius: var(--radius-md); font-size: 15px; color: var(--text-primary);">
                                    ${UI.escapeHtml(user.first_name)}
                                </div>
                            </div>
                        ` : ''}

                        ${user.last_name ? `
                            <div class="profile-field">
                                <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Last Name</label>
                                <div style="padding: 12px 16px; background: var(--bg-secondary); border-radius: var(--radius-md); font-size: 15px; color: var(--text-primary);">
                                    ${UI.escapeHtml(user.last_name)}
                                </div>
                            </div>
                        ` : ''}

                        <div class="profile-field">
                            <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">User ID</label>
                            <div style="padding: 12px 16px; background: var(--bg-secondary); border-radius: var(--radius-md); font-size: 13px; color: var(--text-tertiary); font-family: monospace; display: flex; align-items: center; justify-content: space-between;">
                                <span>${user.id}</span>
                                <button class="btn-icon btn-sm" id="copy-user-id" title="Copy User ID">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Profile Actions -->
                    <div style="margin-top: 32px; display: flex; flex-direction: column; gap: 12px;">
                        <button class="btn btn-primary btn-block" id="edit-profile-btn">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                            Edit Profile
                        </button>
                        
                        <button class="btn btn-secondary btn-block" id="change-password-btn">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                            </svg>
                            Change Password
                        </button>

                        <button class="btn btn-secondary btn-block" id="privacy-settings-btn">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                            </svg>
                            Privacy & Security
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Setup event listeners
        this.setupModalEventListeners(modal, user);
    }

    setupModalEventListeners(modal, user) {
        // Close modal
        modal.querySelector('.close-modal').addEventListener('click', () => {
            modal.remove();
        });

        modal.querySelector('.modal-overlay').addEventListener('click', () => {
            modal.remove();
        });

        // Copy User ID
        modal.querySelector('#copy-user-id')?.addEventListener('click', async () => {
            await UI.copyToClipboard(user.id);
        });

        // Edit Profile
        modal.querySelector('#edit-profile-btn')?.addEventListener('click', () => {
            modal.remove();
            this.openEditProfile(user);
        });

        // Change Password
        modal.querySelector('#change-password-btn')?.addEventListener('click', () => {
            modal.remove();
            this.openChangePassword();
        });

        // Privacy Settings
        modal.querySelector('#privacy-settings-btn')?.addEventListener('click', () => {
            modal.remove();
            this.openPrivacySettings();
        });

        // Avatar edit (future enhancement)
        modal.querySelector('#profile-avatar-edit')?.addEventListener('click', () => {
            UI.showToast('Avatar upload coming soon', 'info');
        });
    }

    openEditProfile(user) {
        const modal = document.createElement('div');
        modal.id = 'edit-profile-modal';
        modal.className = 'modal show';

        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>Edit Profile</h3>
                    <button class="btn-icon close-modal">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <form id="edit-profile-form">
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="edit-first-name">First Name</label>
                            <input type="text" id="edit-first-name" value="${UI.escapeHtml(user.first_name || '')}" placeholder="Enter first name">
                        </div>
                        
                        <div class="form-group">
                            <label for="edit-last-name">Last Name</label>
                            <input type="text" id="edit-last-name" value="${UI.escapeHtml(user.last_name || '')}" placeholder="Enter last name">
                        </div>

                        <div class="form-group">
                            <label for="edit-bio">Bio (Optional)</label>
                            <textarea id="edit-bio" rows="3" placeholder="Tell us about yourself...">${UI.escapeHtml(user.bio || '')}</textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary close-modal">Cancel</button>
                        <button type="submit" class="btn btn-primary">Save Changes</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        // Setup event listeners
        modal.querySelector('.close-modal').addEventListener('click', () => {
            modal.remove();
        });

        modal.querySelector('.modal-overlay').addEventListener('click', () => {
            modal.remove();
        });

        modal.querySelector('#edit-profile-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleEditProfile(modal, user);
        });
    }

    async handleEditProfile(modal, user) {
        const firstName = document.getElementById('edit-first-name').value;
        const lastName = document.getElementById('edit-last-name').value;
        const bio = document.getElementById('edit-bio').value;

        try {
            const response = await api.request(`/users/${user.id}/`, {
                method: 'PATCH',
                body: JSON.stringify({
                    first_name: firstName,
                    last_name: lastName,
                    bio: bio
                })
            });

            // Update current user data
            this.app.currentUser.first_name = response.first_name;
            this.app.currentUser.last_name = response.last_name;
            this.app.currentUser.bio = response.bio;

            UI.showToast('Profile updated successfully', 'success');
            modal.remove();

            // Reopen profile modal with updated data
            this.openProfile();
        } catch (error) {
            console.error('Failed to update profile:', error);
            UI.showToast('Failed to update profile', 'error');
        }
    }

    openChangePassword() {
        const modal = document.createElement('div');
        modal.id = 'change-password-modal';
        modal.className = 'modal show';

        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>Change Password</h3>
                    <button class="btn-icon close-modal">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <form id="change-password-form">
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="current-password">Current Password</label>
                            <input type="password" id="current-password" required placeholder="Enter current password">
                        </div>
                        
                        <div class="form-group">
                            <label for="new-password">New Password</label>
                            <input type="password" id="new-password" required placeholder="Enter new password" minlength="8">
                            <div class="password-strength">
                                <div class="strength-bar">
                                    <div class="strength-fill"></div>
                                </div>
                                <span class="strength-text">Enter password</span>
                            </div>
                        </div>

                        <div class="form-group">
                            <label for="confirm-password">Confirm New Password</label>
                            <input type="password" id="confirm-password" required placeholder="Confirm new password">
                        </div>

                        <div id="password-error" class="error-message"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary close-modal">Cancel</button>
                        <button type="submit" class="btn btn-primary">Change Password</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        // Setup event listeners
        modal.querySelector('.close-modal').addEventListener('click', () => {
            modal.remove();
        });

        modal.querySelector('.modal-overlay').addEventListener('click', () => {
            modal.remove();
        });

        // Password strength checker
        if (window.passwordStrength) {
            new window.passwordStrength.constructor('new-password');
        }

        modal.querySelector('#change-password-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleChangePassword(modal);
        });
    }

    async handleChangePassword(modal) {
        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        const errorElement = document.getElementById('password-error');

        // Validate
        if (newPassword !== confirmPassword) {
            errorElement.textContent = 'Passwords do not match';
            errorElement.classList.add('show');
            return;
        }

        if (newPassword.length < 8) {
            errorElement.textContent = 'Password must be at least 8 characters';
            errorElement.classList.add('show');
            return;
        }

        try {
            await api.request('/auth/change-password/', {
                method: 'POST',
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_password: newPassword
                })
            });

            UI.showToast('Password changed successfully', 'success');
            modal.remove();
        } catch (error) {
            console.error('Failed to change password:', error);
            errorElement.textContent = error.message || 'Failed to change password';
            errorElement.classList.add('show');
        }
    }

    openPrivacySettings() {
        const modal = document.createElement('div');
        modal.id = 'privacy-settings-modal';
        modal.className = 'modal show';

        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>Privacy & Security</h3>
                    <button class="btn-icon close-modal">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="modal-body">
                    <div style="display: flex; flex-direction: column; gap: 20px;">
                        <div class="setting-item">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div style="font-weight: 600; margin-bottom: 4px;">Show Last Seen</div>
                                    <div style="font-size: 13px; color: var(--text-tertiary);">Let others see when you're online</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="show-last-seen" checked>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>

                        <div class="setting-item">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div style="font-weight: 600; margin-bottom: 4px;">Read Receipts</div>
                                    <div style="font-size: 13px; color: var(--text-tertiary);">Send read receipts for messages</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="read-receipts" checked>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>

                        <div class="setting-item">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div style="font-weight: 600; margin-bottom: 4px;">Typing Indicators</div>
                                    <div style="font-size: 13px; color: var(--text-tertiary);">Show when you're typing</div>
                                </div>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="typing-indicators" checked>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>

                        <hr style="border: none; border-top: 1px solid var(--border-light); margin: 8px 0;">

                        <button class="btn btn-secondary btn-block" id="export-data-btn">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            Export My Data
                        </button>

                        <button class="btn btn-secondary btn-block" id="delete-account-btn" style="color: var(--danger-color);">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                            Delete Account
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Setup event listeners
        modal.querySelector('.close-modal').addEventListener('click', () => {
            modal.remove();
        });

        modal.querySelector('.modal-overlay').addEventListener('click', () => {
            modal.remove();
        });

        modal.querySelector('#export-data-btn')?.addEventListener('click', () => {
            UI.showToast('Exporting your data...', 'info');
            if (window.chatBackup) {
                window.chatBackup.exportAllChats();
            }
        });

        modal.querySelector('#delete-account-btn')?.addEventListener('click', () => {
            if (confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
                UI.showToast('Account deletion coming soon', 'warning');
            }
        });
    }
}