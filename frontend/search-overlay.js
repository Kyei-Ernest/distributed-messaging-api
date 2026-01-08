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

    // Fallback utilities in case UI helper isn't fully loaded or has issues
    getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(word => word[0]).join('').toUpperCase().substring(0, 2);
    }

    generateAvatarColor(name) {
        const colors = ['#4f46e5', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#d97706', '#65a30d', '#16a34a', '#059669', '#0891b2', '#0284c7', '#2563eb'];
        let hash = 0;
        for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        return colors[Math.abs(hash) % colors.length];
    }

    createAvatar(name, size = 40) {
        if (typeof UI !== 'undefined' && UI.createAvatar) return UI.createAvatar(name, size);

        const color = this.generateAvatarColor(name);
        const initials = this.getInitials(name);
        const div = document.createElement('div');
        div.className = 'avatar';
        if (size !== 40) {
            div.style.width = `${size}px`;
            div.style.height = `${size}px`;
            div.style.minWidth = `${size}px`;
            div.style.fontSize = `${Math.floor(size / 2.5)}px`;
        }
        div.style.background = color;
        div.innerHTML = `<span>${initials}</span>`;
        return div;
    }

    init() {
        // Toggle search button
        const toggleBtn = document.getElementById('toggle-search-btn');

        console.log('🔍 GlobalSearch init - toggle button:', toggleBtn);
        console.log('🔍 Search overlay element:', this.overlay);
        console.log('🔍 Search overlay classes:', this.overlay?.className);

        if (toggleBtn) {
            // Remove any existing listeners by cloning
            const newBtn = toggleBtn.cloneNode(true);
            toggleBtn.parentNode.replaceChild(newBtn, toggleBtn);

            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🔍 Search button clicked!');
                console.log('🔍 Before open - overlay classes:', this.overlay?.className);
                this.open();
                console.log('🔍 After open - overlay classes:', this.overlay?.className);
            });
            console.log('✅ Search button event listener attached');
        } else {
            console.error('❌ toggle-search-btn not found!');
        }

        // Close button
        const closeBtn = document.getElementById('close-search-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                console.log('🔍 Close search button clicked');
                this.close();
            });
        }


        // Clear button
        document.getElementById('clear-search-btn')?.addEventListener('click', () => {
            this.clearSearch();
        });

        // Search input
        this.input?.addEventListener('input', (e) => {
            this.handleSearch(e.target.value);
        });

        // Category tabs
        document.querySelectorAll('.search-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchCategory(e.target.dataset.category);
            });
        });
    }

    open() {
        console.log('🔍 Opening search overlay');

        // Remove hidden class to show the overlay
        this.overlay.classList.remove('hidden');

        // Focus input after a brief delay
        setTimeout(() => {
            this.input?.focus();
        }, 50);

        this.showPlaceholderState();
    }

    close() {
        console.log('🔍 Closing search overlay');

        // Add hidden class to hide the overlay
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