const UI = {
    // Show/Hide screens
    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(screenId).classList.add('active');
    },

    // Show/Hide elements
    show(elementId) {
        const element = document.getElementById(elementId);
        if (element) element.classList.remove('hidden');
    },

    hide(elementId) {
        const element = document.getElementById(elementId);
        if (element) element.classList.add('hidden');
    },

    toggle(elementId) {
        const element = document.getElementById(elementId);
        if (element) element.classList.toggle('hidden');
    },

    // Toast notifications
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type} show`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    },

    // Error messages
    showError(elementId, message) {
        const errorElement = document.getElementById(elementId);
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.add('show');
        }
    },

    hideError(elementId) {
        const errorElement = document.getElementById(elementId);
        if (errorElement) {
            errorElement.classList.remove('show');
        }
    },

    // Get initials from name
    getInitials(name) {
        if (!name) return '?';
        return name
            .split(' ')
            .map(word => word[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);
    },

    // Format timestamp
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        // Less than 1 minute
        if (diff < 60000) {
            return 'Just now';
        }
        
        // Less than 1 hour
        if (diff < 3600000) {
            const minutes = Math.floor(diff / 60000);
            return `${minutes}m ago`;
        }
        
        // Today
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
            });
        }
        
        // This week
        if (diff < 604800000) {
            return date.toLocaleDateString('en-US', { weekday: 'short' });
        }
        
        // Older
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric' 
        });
    },

    // Create group list item
    createGroupItem(group) {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.dataset.groupId = group.id;
        div.dataset.type = 'group';
        
        div.innerHTML = `
            <div class="avatar">
                <span>${this.getInitials(group.name)}</span>
            </div>
            <div class="list-item-content">
                <div class="list-item-title">${this.escapeHtml(group.name)}</div>
                <div class="list-item-subtitle">${group.member_count} members</div>
            </div>
        `;
        
        return div;
    },

    // Create user list item
    createUserItem(user) {
        const currentUser = api.getCurrentUser();
        if (user.id === currentUser.id) return null;
        
        const div = document.createElement('div');
        div.className = 'list-item';
        div.dataset.userId = user.id;
        div.dataset.type = 'user';
        
        div.innerHTML = `
            <div class="avatar">
                <span>${this.getInitials(user.username)}</span>
            </div>
            <div class="list-item-content">
                <div class="list-item-title">${this.escapeHtml(user.username)}</div>
                <div class="list-item-subtitle">${this.escapeHtml(user.email)}</div>
            </div>
        `;
        
        return div;
    },

    // Create message element
    createMessage(message) {
        const currentUser = api.getCurrentUser();
        const isOwn = message.sender_id === currentUser.id;
        
        const div = document.createElement('div');
        div.className = `message ${isOwn ? 'own' : ''}`;
        div.dataset.messageId = message.message_id || message.id;
        
        div.innerHTML = `
            ${!isOwn ? `
                <div class="avatar">
                    <span>${this.getInitials(message.sender_username || message.sender?.username)}</span>
                </div>
            ` : ''}
            <div class="message-content">
                ${!isOwn ? `<div class="message-sender">${this.escapeHtml(message.sender_username || message.sender?.username)}</div>` : ''}
                <div class="message-bubble">${this.escapeHtml(message.content)}</div>
                <div class="message-time">${this.formatTime(message.timestamp || message.created_at)}</div>
            </div>
        `;
        
        return div;
    },

    // Escape HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // Scroll to bottom
    scrollToBottom(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.scrollTop = element.scrollHeight;
        }
    },

    // Clear list
    clearList(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.innerHTML = '';
        }
    },

    // Show loading
    showLoading(elementId, message = 'Loading...') {
        const element = document.getElementById(elementId);
        if (element) {
            element.innerHTML = `<div class="loading">${message}</div>`;
        }
    }
};