/**
 * ============================================================================
 * NavigationManager - Handles tabs, mobile navigation, back button
 * ============================================================================
 */
class NavigationManager {
    constructor(app) {
        this.app = app;
        this.history = [];
    }

    setupBrowserBackButton() {
        window.addEventListener('popstate', (event) => {
            console.log('Browser back button pressed', event.state);

            if (this.app.currentChat) {
                event.preventDefault();
                this.handleMobileBack();
                window.history.pushState({ view: 'list' }, '', '#chats');
            }
        });

        if (window.history.state === null) {
            window.history.replaceState({ view: 'list' }, '', '#chats');
        }
    }

    pushToHistory(state) {
        this.history.push(state);
        window.history.pushState({ hasHistory: true, state: state }, '', window.location.pathname);
    }

    popFromHistory() {
        if (this.history.length > 0) {
            this.history.pop();
        }
        if (window.history.length > 1) {
            window.history.back();
        }
    }

    handleBrowserBack() {
        if (this.app.currentChat) {
            this.handleMobileBack();
        } else if (this.history.length > 0) {
            const previousState = this.history[this.history.length - 1];
            if (previousState === 'chat-list') {
                this.navigateToTab('chats');
            }
        }
    }

    navigateToTab(tabName) {
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
        if (tabBtn) {
            tabBtn.click();
        }

        UI.show('empty-state');
        UI.hide('chat-header');
        UI.hide('messages-container');
        UI.hide('message-input-container');

        this.app.currentChat = null;

        document.querySelectorAll('.list-item.active').forEach(item => {
            item.classList.remove('active');
        });

        this.updateMobileNav();

        // Show mobile bottom nav when returning to list
        const mobileNav = document.querySelector('.mobile-bottom-nav');
        if (mobileNav) {
            mobileNav.classList.remove('hidden');
            // Restore nav padding on mobile
            if (UI.isMobile()) {
                document.querySelector('.chat-main')?.style.setProperty('padding-bottom', '70px');
                document.getElementById('scroll-to-bottom')?.style.setProperty('bottom', '140px');
            }
        }

        if (window.history && window.history.pushState) {
            window.history.pushState({ tab: tabName }, '', `#${tabName}`);
        }
    }

    handleMobileBack() {
        // Remove infinite scroll listener
        if (this.app.infiniteScrollHandler) {
            const messagesContainer = document.getElementById('messages-container');
            if (messagesContainer) {
                messagesContainer.removeEventListener('scroll', this.app.infiniteScrollHandler);
            }
        }

        this.hideScrollButton();

        if (this.app.currentChat) {
            this.app.clearTypingTimeout();
            if (this.app.currentChat.type === 'group') {
                ws.send('typing_indicator', { group_id: this.app.currentChat.id, is_typing: false });
            } else {
                ws.send('typing_indicator', { recipient_id: this.app.currentChat.id, is_typing: false });
            }
        }

        this.app.currentChat = null;

        UI.hide('empty-state');
        UI.hide('chat-header');
        UI.hide('messages-container');
        UI.hide('message-input-container');
        UI.hide('info-sidebar');

        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.add('mobile-open');
        }

        const chatsTab = document.querySelector('.tab-btn[data-tab="chats"]');
        if (chatsTab && !chatsTab.classList.contains('active')) {
            chatsTab.click();
        }

        document.querySelectorAll('.list-item.active').forEach(item => {
            item.classList.remove('active');
        });

        this.updateMobileNav();

        // Show mobile bottom nav when returning to list
        const mobileNav = document.querySelector('.mobile-bottom-nav');
        if (mobileNav) {
            mobileNav.classList.remove('hidden');
            // Restore nav padding on mobile
            if (UI.isMobile()) {
                document.querySelector('.chat-main')?.style.setProperty('padding-bottom', '70px');
                document.getElementById('scroll-to-bottom')?.style.setProperty('bottom', '140px');
            }
        }
    }

    hideScrollButton() {
        const scrollBtn = document.getElementById('scroll-to-bottom');
        if (scrollBtn) {
            scrollBtn.classList.add('hidden');
        }
    }

    updateMobileNav() {
        // Stub for mobile nav updates
        return;
    }

    handleMobileNavAction(action) {
        // Stub for mobile nav actions
        return;
    }

    syncMobileNavWithTab() {
        if (!UI.isMobile()) return;

        const activeTab = document.querySelector('.tab-content.active')?.id;
        const navItems = document.querySelectorAll('.mobile-nav-item');

        navItems.forEach(item => item.classList.remove('active'));

        if (activeTab === 'chats-tab') {
            document.querySelector('.mobile-nav-item[data-action="chats"]')?.classList.add('active');
        } else if (activeTab === 'groups-tab') {
            document.querySelector('.mobile-nav-item[data-action="groups"]')?.classList.add('active');
        } else if (activeTab === 'users-tab') {
            document.querySelector('.mobile-nav-item[data-action="contacts"]')?.classList.add('active');
        }
    }

    handleTabSwitch(e) {
        const tabBtn = e.target.closest('.tab-btn');
        if (!tabBtn) return;

        const tabName = tabBtn.dataset.tab;

        // Lazy load data via managers
        if (tabName === 'groups' && (!this.app.myGroups || this.app.myGroups.length === 0) && !this.app.groupsLoaded) {
            this.app.groupManager.loadGroups();
            this.app.groupsLoaded = true;
        }
        if (tabName === 'users') {
            this.app.userManager.loadUsers();
            this.app.usersLoaded = true;
        }

        // Update active states
        document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        tabBtn.classList.add('active');
        document.getElementById(`${tabName}-tab`)?.classList.add('active');

        // Sync mobile nav
        this.syncMobileNavWithTab();
    }

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

    setupHardwareBackButton() {
        if ('ontouchstart' in window) {
            window.addEventListener('popstate', (e) => {
                e.preventDefault();
                if (this.app.currentChat) {
                    this.handleMobileBack();
                }
            });

            let startX = 0, startY = 0;

            document.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
            }, { passive: true });

            document.addEventListener('touchend', (e) => {
                const endX = e.changedTouches[0].clientX;
                const endY = e.changedTouches[0].clientY;
                const diffX = endX - startX;
                const diffY = Math.abs(endY - startY);

                if (startX < 50 && diffX > 100 && diffY < 50) {
                    if (this.app.currentChat) {
                        this.handleMobileBack();
                    }
                }
            }, { passive: true });
        }
    }

    handleHardwareBack() {
        console.log('Hardware back button pressed');

        if (this.app.currentChat) {
            this.handleMobileBack();
            return true;
        }

        const sidebar = document.querySelector('.sidebar');
        if (sidebar && sidebar.classList.contains('mobile-open')) {
            sidebar.classList.remove('mobile-open');
            return true;
        }

        const activeTab = document.querySelector('.tab-content.active')?.id;
        if (activeTab === 'groups-tab' || activeTab === 'users-tab') {
            this.navigateToTab('chats');
            return true;
        }

        return false;
    }
}
