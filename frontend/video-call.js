// video-call.js
class VideoCallManager {
    constructor() {
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.isInCall = false;
        this.init();
    }

    init() {
        // Add call buttons to chat header
        this.addCallButtons();
        this.setupWebSocketListeners();
    }

    addCallButtons() {
        const chatHeader = document.getElementById('chat-header');
        if (!chatHeader) return;
        
        const callButtons = document.createElement('div');
        callButtons.className = 'call-buttons';
        callButtons.innerHTML = `
            <button class="btn-icon" id="voice-call-btn" title="Voice call">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
            </button>
            <button class="btn-icon" id="video-call-btn" title="Video call">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M23 7l-7 5 7 5V7z"></path>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                </svg>
            </button>
        `;
        
        chatHeader.querySelector('.chat-header-actions')?.appendChild(callButtons);
        
        document.getElementById('voice-call-btn')?.addEventListener('click', () => this.startCall('audio'));
        document.getElementById('video-call-btn')?.addEventListener('click', () => this.startCall('video'));
    }

    async startCall(type) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: type === 'video',
                audio: true
            });
            
            this.createPeerConnection();
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
            
            // Send call invitation via WebSocket
            ws.send('call_invitation', {
                type: type,
                to: app.currentChat.id,
                chat_type: app.currentChat.type
            });
            
            this.showCallUI(type, true); // Show local video
            this.isInCall = true;
            
        } catch (error) {
            console.error('Error starting call:', error);
            UI.showToast('Failed to start call', 'error');
        }
    }

    createPeerConnection() {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        this.peerConnection = new RTCPeerConnection(configuration);
        
        this.peerConnection.ontrack = (event) => {
            this.remoteStream = event.streams[0];
            this.showRemoteVideo();
        };
        
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send('ice_candidate', {
                    candidate: event.candidate,
                    to: app.currentChat.id
                });
            }
        };
    }
}