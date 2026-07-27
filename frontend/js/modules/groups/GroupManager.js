/**
 * ============================================================================
 * GroupManager - Handles group loading, rendering, joining, and creation
 * ============================================================================
 */
class GroupManager {
    constructor(app) {
        this.app = app;
        this.myGroups = [];
        this.availableGroups = [];
    }

    async loadGroups() {
        UI.showLoading('groups-list');

        try {
            const response = await api.getGroups();
            const allGroups = response.results || response;

            if (!Array.isArray(allGroups)) {
                console.error('❌ Invalid groups data:', allGroups);
                throw new Error('Invalid groups data format');
            }

            this.myGroups = allGroups.filter(g => g.is_member);
            this.availableGroups = allGroups.filter(g => !g.is_member);

            // Subscribe to groups via WebSocket
            if (ws.isConnected) {
                console.log(`📡 Subscribing to ${this.myGroups.length} groups...`);
                this.myGroups.forEach(g => ws.subscribeToGroup(g.id));
            }

            this.renderGroups();
        } catch (error) {
            console.error('Failed to load groups:', error);
            UI.showToast('Failed to load groups', 'error');
            this.myGroups = this.myGroups || [];
            this.availableGroups = this.availableGroups || [];
        }
    }

    renderGroups(searchQuery = '') {
        const container = document.getElementById('groups-list');
        if (!container) return;

        container.innerHTML = '';
        const query = searchQuery.toLowerCase();

        const filteredMy = this.myGroups.filter(g => g.name.toLowerCase().includes(query));
        const filteredAvailable = this.availableGroups.filter(g => g.name.toLowerCase().includes(query));

        // My Groups Section
        if (filteredMy.length > 0) {
            this.addSectionHeader(container, 'My Groups');
            filteredMy.forEach(group => {
                const item = UI.createGroupItem(group);
                item.addEventListener('click', () => this.app.openGroupChat(group));
                container.appendChild(item);
            });
        }

        // Available Groups Section  
        if (filteredAvailable.length > 0) {
            this.addSectionHeader(container, 'Available Groups');
            filteredAvailable.forEach(group => {
                const item = this.createAvailableGroupItem(group);
                container.appendChild(item);
            });
        }

        // Empty state
        if (filteredMy.length === 0 && filteredAvailable.length === 0) {
            container.innerHTML = `
                <div class="empty-list" style="padding: 60px 20px; text-align: center;">
                    <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity: 0.2; margin-bottom: 16px;">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                    <p style="font-size: 16px; font-weight: 500; margin-bottom: 8px; color: var(--text-secondary);">No groups found</p>
                    <button class="btn btn-primary" onclick="document.getElementById('create-group-modal').classList.add('show')" style="margin-top: 16px;">
                        Create New Group
                    </button>
                </div>
            `;
        }
    }

    addSectionHeader(container, title) {
        const header = document.createElement('div');
        header.className = 'list-section-header';
        header.innerHTML = `<h4>${title}</h4>`;
        container.appendChild(header);
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
            <button class="btn btn-primary btn-sm join-group-btn">Join</button>
        `;

        const joinBtn = div.querySelector('.join-group-btn');
        joinBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            joinBtn.disabled = true;
            joinBtn.textContent = 'Joining...';

            try {
                await this.handleJoinGroup(group.id);
            } catch (error) {
                console.error('Failed to join group:', error);
                joinBtn.disabled = false;
                joinBtn.textContent = 'Join';
                UI.showToast('Failed to join group: ' + error.message, 'error');
            }
        });

        return div;
    }

    async handleJoinGroup(groupId) {
        console.log('🔵 Joining group:', groupId);
        const response = await api.joinGroup(groupId);
        console.log('✅ Joined group:', response);

        UI.showToast('Joined group successfully', 'success');

        await this.loadGroups();
        await this.app.chatManager.loadAllChats();
        ws.subscribeToGroup(groupId);
    }

    async handleCreateGroup(name, description) {
        try {
            const response = await api.createGroup(name, description);
            UI.showToast('Group created successfully', 'success');
            await this.loadGroups();
            await this.app.chatManager.loadAllChats();
            return response;
        } catch (error) {
            console.error('Failed to create group:', error);
            throw error;
        }
    }

    handleSearch(query) {
        this.renderGroups(query);
    }
}
