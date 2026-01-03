class WebSocketClient {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        this.listeners = {};
        this.isConnected = false;
        this.token = null;
    }

    connect(token) {
        if (!token) {
            console.error('No authentication token provided');
            return;
        }
        
        this.token = token;

        try {
            this.ws = new WebSocket(`${this.url}?token=${token}`);
            this.setupEventHandlers();
        } catch (error) {
            console.error('WebSocket connection failed:', error);
            this.handleReconnect();
        }
    }

    setupEventHandlers() {
        this.ws.onopen = () => {
            console.log('✅ WebSocket connected');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.emit('connected');
            this.updateConnectionStatus('connected');
        };

        this.ws.onmessage = (event) => {
            try {
                const messages = event.data.trim().split('\n').filter(line => line.trim());
                
                messages.forEach(msgStr => {
                    try {
                        const data = JSON.parse(msgStr);
                        console.log('📨 WebSocket message:', data);
                        this.handleMessage(data);
                    } catch (err) {
                        console.error('Failed to parse individual message:', msgStr, err);
                    }
                });
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error);
                console.error('Raw message data:', event.data);
            }
        };

        this.ws.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            this.emit('error', error);
        };

        this.ws.onclose = () => {
            console.log('🔌 WebSocket disconnected');
            this.isConnected = false;
            this.emit('disconnected');
            this.updateConnectionStatus('disconnected');
            this.handleReconnect();
        };
    }

    handleMessage(data) {
        const { type, data: payload } = data;
        
        console.log('📨 WebSocket received:', type, payload);
        
        // Emit the event with proper type
        this.emit(type, payload);
    }

    handleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            this.updateConnectionStatus('failed');
            return;
        }

        this.reconnectAttempts++;
        this.updateConnectionStatus('reconnecting');
        
        console.log(`Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(() => {
            this.connect(this.token);
        }, this.reconnectDelay);
    }

    send(type, data = {}) {
        if (!this.isConnected) {
            console.warn('WebSocket not connected, cannot send:', type);
            return;
        }

        const message = {
            type,
            data,
            timestamp: new Date().toISOString()
        };

        console.log('📤 Sending WebSocket message:', type, data);
        this.ws.send(JSON.stringify(message));
    }

    subscribeToGroup(groupId) {
        this.send('subscribe_group', { group_id: groupId });
    }

    unsubscribeFromGroup(groupId) {
        this.send('unsubscribe_group', { group_id: groupId });
    }

    sendTypingIndicator(groupId, isTyping) {
        this.send('typing_indicator', { group_id: groupId, is_typing: isTyping });
    }

    ping() {
        this.send('ping');
    }

    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    off(event, callback) {
        if (!this.listeners[event]) return;
        
        if (callback) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        } else {
            delete this.listeners[event];
        }
    }

    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(callback => callback(data));
    }

    updateConnectionStatus(status) {
        const statusElement = document.getElementById('connection-status');
        const statusMessage = statusElement.querySelector('.status-message');
        
        statusElement.className = 'connection-status ' + status;
        
        switch (status) {
            case 'connected':
                statusMessage.textContent = 'Connected';
                setTimeout(() => statusElement.classList.add('hidden'), 2000);
                break;
            case 'disconnected':
                statusMessage.textContent = 'Disconnected';
                statusElement.classList.remove('hidden');
                break;
            case 'reconnecting':
                statusMessage.textContent = 'Reconnecting...';
                statusElement.classList.remove('hidden');
                break;
            case 'failed':
                statusMessage.textContent = 'Connection failed';
                statusElement.classList.remove('hidden');
                break;
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// Create global WebSocket instance
const ws = new WebSocketClient(CONFIG.WS_URL);