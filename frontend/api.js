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
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.detail || data.error || 'Request failed');
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

    // Users
    async getUsers() {
        return await this.request('/users/');
    }

    // Messages
    async getMessages(filters = {}) {
        const params = new URLSearchParams(filters);
        return await this.request(`/messages/?${params}`);
    }

    async sendMessage(messageData) {
        return await this.request('/messages/', {
            method: 'POST',
            body: JSON.stringify(messageData)
        });
    }

    async deleteMessage(messageId) {
        return await this.request(`/messages/${messageId}/`, {
            method: 'DELETE'
        });
    }
}

// Create global API instance
const api = new APIClient(CONFIG.API_BASE_URL);