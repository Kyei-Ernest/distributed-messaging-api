/**
 * ============================================================================
 * Features Initialization
 * ============================================================================
 */

// Initialize all features when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Theme & Settings
    window.themeManager = new ThemeManager();
    window.settingsManager = new SettingsManager();
    window.notificationManager = new NotificationManager();

    // Input Features
    window.passwordStrength = new PasswordStrength('register-password');
    window.passwordToggle = new PasswordToggle();
    window.emojiPicker = new EmojiPicker();
    window.messageInputResize = new MessageInputResize('message-input');

    // Media Features
    window.fileUpload = new FileUploadHandler();
    window.imageViewer = new ImageViewer();
    window.scrollManager = new ScrollManager('messages-container', 'scroll-to-bottom');

    // Context Menu
    window.contextMenu = new ContextMenu();

    // Reactions
    window.messageReactions = new MessageReactions();

    // Voice Messages
    window.voiceRecorder = new VoiceMessageRecorder();
    // Attach app reference after app initializes
    document.addEventListener('appReady', (e) => {
        if (window.voiceRecorder) window.voiceRecorder.app = e.detail;
    });

    // Chat Themes
    window.chatThemes = new ChatThemes();

    console.log('✅ All features initialized');
});
