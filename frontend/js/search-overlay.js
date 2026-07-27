class GlobalSearch {
    constructor(app) {
        this.app = app;
        this.overlay = document.getElementById('global-search-overlay');
        this.input = document.getElementById('global-search-input');
        this.resultsContainer = document.getElementById('search-results-list');
        this.emptyState = document.getElementById('search-empty-state');
        this.frequentContacts = document.getElementById('frequent-contacts');
        this.currentCategory = 'all';
        this.searchTimeout = null;

        this.init();
    }

    init() {
        const toggleBtn = document.getElementById('toggle-search-btn');

        if (toggleBtn) {
            const newBtn = toggleBtn.cloneNode(true);
            toggleBtn.parentNode.replaceChild(newBtn, toggleBtn);
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.open();
            });
        } else {
            console.error('❌ toggle-search-btn not found!');
        }

        // Close button
        const closeBtn = document.getElementById('close-search-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.close();
            });
        }


        document.getElementById('clear-search-btn')?.addEventListener('click', () => this.clearSearch());

        this.input?.addEventListener('input', (e) => this.handleSearch(e.target.value));

        // Category tabs
        document.querySelectorAll('.search-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchCategory(e.target.dataset.category);
            });
        });
    }

    open() {
        this.overlay.classList.remove('hidden');
        setTimeout(() => this.input?.focus(), 50);
        this.showPlaceholderState();
    }

    close() {
        this.overlay.classList.add('hidden');
        this.clearSearch();
    }

    handleSearch(query) {
        // Clear existing timeout
        if (this.searchTimeout) clearTimeout(this.searchTimeout);

        // Show/hide clear button
        const clearBtn = document.getElementById('clear-search-btn');
        if (query.length > 0) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
            this.showPlaceholderState();
            return;
        }

        // Debounce search
        this.searchTimeout = setTimeout(() => {
            this.performSearch(query);
        }, 300);
    }

    async performSearch(query) {
        try {
            const results = this.searchLocal(query);
            this.displayResults(results);
        } catch (error) {
            console.error('Search error:', error);
        }
    }

    searchLocal(query) {
        const lowerQuery = query.toLowerCase();
        const results = [];

        // Search based on category
        if (this.currentCategory === 'all' || this.currentCategory === 'chats') {
            // Search all chats
            this.app.allChats.forEach(chat => {
                if (chat.name?.toLowerCase().includes(lowerQuery)) {
                    results.push({
                        type: 'chat',
                        category: chat.type,
                        data: chat
                    });
                }
            });
        }

        if (this.currentCategory === 'all' || this.currentCategory === 'groups') {
            // Search groups
            if (this.app.myGroups) {
                this.app.myGroups.forEach(group => {
                    if (group.name?.toLowerCase().includes(lowerQuery)) {
                        results.push({
                            type: 'group',
                            category: 'group',
                            data: group
                        });
                    }
                });
            }
        }

        if (this.currentCategory === 'all' || this.currentCategory === 'users') {
            // Search users
            if (this.app.users) {
                this.app.users.forEach(user => {
                    const fullName = `${user.first_name} ${user.last_name}`.toLowerCase();
                    const username = user.username?.toLowerCase() || '';

                    if (fullName.includes(lowerQuery) || username.includes(lowerQuery)) {
                        results.push({
                            type: 'user',
                            category: 'user',
                            data: user
                        });
                    }
                });
            }
        }

        return results;
    }

    displayResults(results) {
        this.emptyState.classList.add('hidden');
        this.frequentContacts.classList.add('hidden');
        this.resultsContainer.classList.remove('hidden');
        this.resultsContainer.innerHTML = '';

        if (results.length === 0) {
            this.resultsContainer.innerHTML = '<p style="text-align: center; color: var(--text-tertiary); padding: 40px;">No results found</p>';
            return;
        }

        results.forEach(result => {
            const item = this.createResultItem(result);
            this.resultsContainer.appendChild(item);
        });
    }

    createResultItem(result) {
        const div = document.createElement('div');
        div.className = 'search-result-item';

        let title, subtitle, avatarHtml;

        if (result.type === 'user') {
            title = `${result.data.first_name} ${result.data.last_name}`;
            subtitle = `@${result.data.username}`;
            avatarHtml = this.createAvatar(result.data.username, 48).outerHTML;
        } else if (result.type === 'group') {
            title = result.data.name;
            subtitle = `${result.data.members_count || 0} members`;
            avatarHtml = this.createAvatar(result.data.name, 48).outerHTML;
        } else {
            title = result.data.name;
            subtitle = result.data.last_message || '';
            avatarHtml = this.createAvatar(result.data.name, 48).outerHTML;
        }

        div.innerHTML = `
            ${avatarHtml}
            <div class="search-result-content">
                <div class="search-result-title">${title}</div>
                <div class="search-result-subtitle">${subtitle}</div>
            </div>
            <span class="search-category-badge">${result.category}</span>
        `;

        // Click handler - open chat/user
        div.addEventListener('click', () => {
            this.handleResultClick(result);
        });

        return div;
    }

    handleResultClick(result) {
        this.close();

        if (result.type === 'user') {
            this.app.switchChat(result.data.id, 'user');
        } else if (result.type === 'group') {
            this.app.switchChat(result.data.id, 'group');
        } else {
            this.app.switchChat(result.data.id, result.data.type);
        }
    }

    switchCategory(category) {
        this.currentCategory = category;

        // Update active tab
        document.querySelectorAll('.search-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.category === category);
        });

        // Re-search if query exists
        const query = this.input.value;
        if (query) {
            this.performSearch(query);
        }
    }

    showPlaceholderState() {
        this.resultsContainer.classList.add('hidden');
        this.emptyState.classList.remove('hidden');
        this.frequentContacts.classList.remove('hidden');
        this.loadFrequentContacts();
    }

    clearSearch() {
        this.input.value = '';
        document.getElementById('clear-search-btn').classList.add('hidden');
        this.showPlaceholderState();
    }

    loadFrequentContacts() {
        const listContainer = this.frequentContacts.querySelector('.frequent-contacts-list');
        if (!listContainer) return;

        listContainer.innerHTML = '';

        // Get recent chats (first 5)
        const recent = this.app.allChats.slice(0, 5);

        if (recent.length === 0) {
            this.frequentContacts.classList.add('hidden');
            return;
        }

        recent.forEach(chat => {
            const item = document.createElement('div');
            item.className = 'frequent-contact-item';

            const avatar = UI.createAvatar ? UI.createAvatar(chat.name, 56) : document.createElement('div');
            if (!UI.createAvatar) {
                avatar.className = 'avatar';
                avatar.innerHTML = `<span>?</span>`;
            }

            const name = document.createElement('div');
            name.className = 'frequent-contact-name';
            name.textContent = chat.name;

            item.appendChild(avatar);
            item.appendChild(name);

            item.addEventListener('click', () => {
                this.close();
                this.app.switchChat(chat.id, chat.type);
            });

            listContainer.appendChild(item);
        });
    }
}