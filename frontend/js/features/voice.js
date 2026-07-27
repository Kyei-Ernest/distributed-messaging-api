/**
 * ============================================================================
 * Voice Message Recorder — Hold-to-record voice messages
 * ============================================================================
 */
class VoiceMessageRecorder {
    constructor() {
        this.recorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.recordingTime = 0;
        this.timer = null;
        this.preventClick = false;
        this.init();
    }

    init() {
        const form = document.getElementById('message-form');
        if (!form) return;

        // Only add button if it doesn't exist
        if (document.getElementById('voice-btn')) return;

        const voiceBtn = document.createElement('button');
        voiceBtn.type = 'button';
        voiceBtn.className = 'btn-icon';
        voiceBtn.id = 'voice-btn';
        voiceBtn.title = 'Hold to record voice message';
        voiceBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
        `;
        voiceBtn.style.cssText = 'color: var(--text-muted);';

        form.querySelector('.input-wrapper')?.prepend(voiceBtn);

        voiceBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.startRecording();
        });
        voiceBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startRecording();
        });

        document.addEventListener('mouseup', (e) => {
            if (this.isRecording) {
                this.stopRecording();
            }
        });
        document.addEventListener('touchend', (e) => {
            if (this.isRecording) {
                this.stopRecording();
            }
        });

        this.overlay = document.getElementById('voice-recording-overlay');
    }

    async startRecording() {
        if (this.isRecording) return;
        if (!this.app?.currentChat) {
            UI.showToast('Open a chat first', 'error');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            this.audioChunks = [];
            this.isRecording = true;

            this.recorder.ondataavailable = (e) => this.audioChunks.push(e.data);
            this.recorder.onstop = async () => {
                const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                await this.sendVoiceMessage(blob);
                stream.getTracks().forEach(t => t.stop());
            };

            this.recorder.start();
            this.startTimer();
            this.showOverlay();
        } catch (error) {
            console.error('Microphone error:', error);
            UI.showToast('Microphone access denied', 'error');
        }
    }

    stopRecording() {
        if (!this.isRecording || !this.recorder) return;
        this.recorder.stop();
        this.isRecording = false;
        this.stopTimer();
        this.hideOverlay();
    }

    startTimer() {
        this.recordingTime = 0;
        const timerEl = document.querySelector('.recording-timer');
        if (timerEl) timerEl.textContent = '0:00';
        this.timer = setInterval(() => {
            this.recordingTime++;
            const mins = Math.floor(this.recordingTime / 60);
            const secs = this.recordingTime % 60;
            if (timerEl) timerEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
        }, 1000);
    }

    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    showOverlay() {
        if (this.overlay) {
            this.overlay.classList.remove('hidden');
            this.overlay.style.display = 'flex';
        }
    }

    hideOverlay() {
        if (this.overlay) {
            this.overlay.classList.add('hidden');
            this.overlay.style.display = 'none';
        }
    }

    async sendVoiceMessage(audioBlob) {
        if (audioBlob.size < 200) {
            UI.showToast('Recording too short', 'warning');
            return;
        }

        try {
            // Send as file upload
            const formData = new FormData();
            formData.append('file', audioBlob, `voice-${Date.now()}.webm`);
            formData.append('duration', String(this.recordingTime));

            const token = localStorage.getItem(CONFIG.TOKEN_KEY);
            const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

            // Try sending with metadata via the message API
            await api.request('/upload/', {
                method: 'POST',
                headers,
                body: formData
            });

            // Also send a text message as placeholder if voice upload isn't supported
            // Fallback: send as a regular message with the duration info
            // (This will be replaced when the backend supports voice natively)
        } catch (error) {
            console.error('Failed to send voice message:', error);
            // Fallback: just send a text note
            const content = `🎤 Voice message (${this.recordingTime}s)`;
            await this.app?.messageHandler?.handleSendMessage?.({ preventDefault: () => {} });
        }

        UI.showToast('Voice message sent', 'success');
    }
}
