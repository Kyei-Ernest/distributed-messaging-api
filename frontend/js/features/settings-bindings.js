/**
 * ============================================================================
 * Settings Bindings - wires every Settings-modal control to real behavior.
 *
 * Every toggle in the Settings modal now does something:
 *   enter-to-send          -> Enter sends in the composer (Shift+Enter newline)
 *   desktop-notifications  -> gates Notification permission + delivery
 *   sound-notifications    -> subtle WebAudio ping on incoming messages
 *   msg-preview            -> message body included in notifications or not
 *   read-receipts          -> client stops sending mark_read when disabled
 *
 * All reads go through the lazily-created global `settingsManager`, so load
 * order never matters. Checkbox states sync on the `appReady` event.
 * ============================================================================
 */
(function () {
    'use strict';

    function setting(key, fallback) {
        try {
            const value = window.settingsManager?.get(key);
            return value === undefined ? fallback : value;
        } catch (e) {
            return fallback;
        }
    }

    function setSetting(key, value) {
        window.settingsManager?.set(key, value);
    }

    // ------------------------------------------------------------------
    // Toggle <-> persistence binding + initial state sync on appReady
    // ------------------------------------------------------------------
    const TOGGLES = [
        ['enter-to-send', 'enterToSend'],
        ['desktop-notifications', 'desktopNotifications'],
        ['sound-notifications', 'soundNotifications'],
        ['msg-preview', 'messagePreview'],
        ['read-receipts', 'readReceipts'],
    ];

    TOGGLES.forEach(([elementId, key]) => {
        document.getElementById(elementId)?.addEventListener('change', (e) => {
            setSetting(key, e.target.checked);
        });
    });

    document.addEventListener('appReady', () => {
        TOGGLES.forEach(([elementId, key]) => {
            const box = document.getElementById(elementId);
            if (box) box.checked = setting(key, true);
        });
    });

    // ------------------------------------------------------------------
    // Enter to send
    // ------------------------------------------------------------------
    document.getElementById('message-input')?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        if (!setting('enterToSend', true)) return;
        e.preventDefault();
        document.getElementById('message-form')?.requestSubmit();
    });

    // ------------------------------------------------------------------
    // Send button: disabled until there is text (mirrors the widget)
    // ------------------------------------------------------------------
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    function syncSendState() {
        if (!messageInput || !sendBtn) return;
        sendBtn.disabled = messageInput.value.trim().length === 0;
    }
    messageInput?.addEventListener('input', syncSendState);
    document.addEventListener('appReady', () => {
        syncSendState();
        TOGGLES.forEach(([elementId, key]) => {
            const box = document.getElementById(elementId);
            if (box) box.checked = setting(key, true);
        });
    });

    // ------------------------------------------------------------------
    // Sound: tiny WebAudio ping, no assets needed
    // ------------------------------------------------------------------
    let audioCtx = null;

    window.dmsPlayPing = function () {
        if (!setting('soundNotifications', true)) return;
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(660, audioCtx.currentTime + 0.12);
            gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.2);
        } catch (e) { /* autoplay policies etc. — silence is fine */ }
    };

    window.dmsWantsSound = function () {
        return setting('soundNotifications', true);
    };
})();
