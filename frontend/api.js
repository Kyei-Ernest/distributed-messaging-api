class APIClient {
    constructor(baseURL) {
        this.baseURL = baseURL;
    }

    getAuthHeader() {
        const token = localStorage.getItem(CONFIG.TOKEN_KEY);
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }


    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...this.getAuthHeader(),
            ...options.headers
        };

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            if (response.status === 401) {
                // Token expired, try to refresh
                const refreshed = await this.refreshToken();
                if (refreshed) {
                    // Retry the request
                    headers['Authorization'] = `Bearer ${localStorage.getItem(CONFIG.TOKEN_KEY)}`;
                    const retryResponse = await fetch(url, { ...options, headers });
                    return await this.handleResponse(retryResponse);
                } else {
                    // Refresh failed, logout
                    this.logout();
                    throw new Error('Session expired. Please login again.');
                }
            }

            return await this.handleResponse(response);
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }


    async handleResponse(response) {
        // Handle empty responses (like 204 No Content)
        const contentType = response.headers.get('content-type');

        let data;
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            // Try to parse as JSON, fallback to text
            try {
                data = JSON.parse(text);
            } catch {
                data = { detail: text || 'Request failed' };
            }
        }

        if (!response.ok) {
            throw new Error(data.detail || data.error || JSON.stringify(data) || 'Request failed');
        }

        return data;
    }

    // Authentication
    async login(identifier, password) {
        const data = await this.request('/auth/login/', {
            method: 'POST',
            body: JSON.stringify({ identifier, password })
        });

        localStorage.setItem(CONFIG.TOKEN_KEY, data.tokens.access);
        localStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, data.tokens.refresh);
        localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(data.user.id));

        return data;
    }

    async register(userData) {
        return await this.request('/users/', {
            method: 'POST',
            body: JSON.stringify(userData)
        });
    }

    async refreshToken() {
        try {
            const refreshToken = localStorage.getItem(CONFIG.REFRESH_TOKEN_KEY);
            if (!refreshToken) return false;

            const data = await this.request('/auth/token/refresh/', {
                method: 'POST',
                body: JSON.stringify({ refresh: refreshToken })
            });

            localStorage.setItem(CONFIG.TOKEN_KEY, data.access);
            return true;
        } catch (error) {
            console.error('Token refresh failed:', error);
            return false;
        }
    }

    logout() {
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem(CONFIG.REFRESH_TOKEN_KEY);
        localStorage.removeItem(CONFIG.USER_KEY);
        window.location.reload();
    }

    getCurrentUser() {
        const userData = localStorage.getItem(CONFIG.USER_KEY);
        return userData ? JSON.parse(userData) : null;
    }

    // Groups
    async getGroups() {
        return await this.request('/groups/');
    }

    async getGroup(groupId) {
        return await this.request(`/groups/${groupId}/`);
    }

    async createGroup(name, description = '') {
        return await this.request('/groups/', {
            method: 'POST',
            body: JSON.stringify({ name, description })
        });
    }

    async joinGroup(groupId) {
        return await this.request(`/groups/${groupId}/join/`, {
            method: 'POST'
        });
    }

    async leaveGroup(groupId) {
        return await this.request(`/groups/${groupId}/leave/`, {
            method: 'POST'
        });
    }

    async getGroupMembers(groupId) {
        return await this.request(`/groups/${groupId}/members/`);
    }

    async promoteMember(groupId, userId) {
        return await this.request(`/groups/${groupId}/members/${userId}/promote/`, {
            method: 'POST'
        });
    }

    async removeMember(groupId, userId) {
        return await this.request(`/groups/${groupId}/members/${userId}/remove/`, {
            method: 'POST'
        });
    }

    // Users
    async getUsers() {
        return await this.request('/users/');
    }

    async getUser(userId) {
        return await this.request(`/users/${userId}/`);
    }


    async sendMessage(messageData) {
        // Log what we're sending
        console.log('API: Sending message data:', messageData);

        try {
            const response = await this.request('/messages/', {
                method: 'POST',
                body: JSON.stringify(messageData)
            });
            console.log('API: Message sent, response:', response);
            return response;
        } catch (error) {
            console.error('API: Send message failed:', error);
            throw error;
        }
    }

    async deleteMessage(messageId) {
        return await this.request(`/messages/${messageId}/`, {
            method: 'DELETE'
        });
    }

    async markMessagesAsRead(messageIds) {
        return await this.request('/messages/mark_read/', {
            method: 'POST',
            body: JSON.stringify({ message_ids: messageIds })
        });
    }

    async reactToMessage(messageId, emoji) {
        return await this.request(`/messages/${messageId}/react/`, {
            method: 'POST',
            body: JSON.stringify({ emoji })
        });
    }

    async getMessages(filters = {}) {
        const params = new URLSearchParams();

        Object.keys(filters).forEach(key => {
            if (filters[key] !== undefined && filters[key] !== null) {
                params.append(key, filters[key]);
            }
        });

        return await this.request(`/messages/?${params}`);
    }

    // Typing Indicator
    //async sendTyping(recipientId, isTyping) {
    //return await this.request('/messages/typing/', {  // Changed from '/typing/' to '/messages/typing/'
    //    method: 'POST',
    //    body: JSON.stringify({ 
    //        recipient_id: recipientId, 
    //        is_typing: isTyping 
    //    })
    //});
    //}

    // File Upload
    async uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${this.baseURL}/upload/`, {
            method: 'POST',
            headers: this.getAuthHeader(),
            body: formData
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || data.error || 'Upload failed');
        }

        return await response.json();
    }
    async getChats() {
        return await this.request('/chats/');
    }

}

// Create global API instance
const api = new APIClient(CONFIG.API_BASE_URL);