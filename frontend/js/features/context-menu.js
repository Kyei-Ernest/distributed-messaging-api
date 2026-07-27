/**
 * ============================================================================
 * Context Menu & Message Actions
 * ============================================================================
 */

class ContextMenu {
    constructor() {
        this.menu = document.getElementById('context-menu');
        if (!this.menu) return;
        this.currentTarget = null;
        this.longPressTimer = null;
        this.init();
    }

    init() {
        // Desktop: right-click
        document.addEventListener('contextmenu', (e) => {
            const message = e.target.closest('.message');
            if (message && message.dataset.messageId) {
                e.preventDefault();
                this.show(e.clientX, e.clientY, message);
            } else {
                this.hide();
            }
        });

        // Mobile: long-press
        document.addEventListener('touchstart', (e) => {
            const message = e.target.closest('.message');
            if (!message || !message.dataset.messageId) return;
            this.currentTarget = message;
            this.longPressTimer = setTimeout(() => {
                const rect = message.getBoundingClientRect();
                this.show(rect.left + 20, rect.top + 20, message);
            }, 400);
        });

        document.addEventListener('touchend', () => clearTimeout(this.longPressTimer));
        document.addEventListener('touchmove', () => clearTimeout(this.longPressTimer));

        document.addEventListener('click', (e) => {
            if (this.menu && !this.menu.contains(e.target)) {
                this.hide();
            }
        });

        this.menu.addEventListener('click', (e) => {
            const item = e.target.closest('.context-menu-item');
            if (item) {
                e.stopPropagation();
                this.handleAction(item.dataset.action);
            }
            const reaction = e.target.closest('.context-reaction');
            if (reaction) {
                e.stopPropagation();
                this.handleReaction(reaction.dataset.reaction);
            }
        });
    }

    show(x, y, target) {
        this.currentTarget = target;
        if (!this.menu) return;

        // Highlight the active reaction in the reaction bar
        const msgId = target.dataset.messageId;
        this.menu.querySelectorAll('.context-reaction').forEach(el => {
            el.classList.remove('active-reaction');
        });

        this.menu.style.left = `${x}px`;
        this.menu.style.top = `${y}px`;
        this.menu.classList.remove('hidden');

        const rect = this.menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) this.menu.style.left = `${x - rect.width}px`;
        if (rect.bottom > window.innerHeight) this.menu.style.top = `${y - rect.height}px`;
    }

    hide() {
        if (this.menu) this.menu.classList.add('hidden');
        this.currentTarget = null;
    }

    handleAction(action) {
        if (!this.currentTarget) return;
        const messageId = this.currentTarget.dataset.messageId;
        const messageText = this.currentTarget.querySelector('.message-bubble')?.textContent;

        switch (action) {
            case 'reply': this.triggerReply(messageId, messageText); break;
            case 'forward': this.triggerForward(messageId); break;
            case 'copy': this.copyText(messageText); break;
            case 'delete': this.triggerDelete(messageId); break;
        }
        this.hide();
    }

    async handleReaction(emoji) {
        if (!this.currentTarget) return;
        const messageId = this.currentTarget.dataset.messageId;
        try {
            await api.reactToMessage(messageId, emoji);
        } catch (error) {
            console.error('Failed to react:', error);
        }
        this.hide();
    }

    triggerReply(messageId, messageText) {
        document.dispatchEvent(new CustomEvent('messageAction', { detail: { action: 'reply', messageId, messageText } }));
    }

    triggerForward(messageId) {
        document.dispatchEvent(new CustomEvent('messageAction', { detail: { action: 'forward', messageId } }));
    }

    copyText(text) {
        navigator.clipboard.writeText(text).then(() => UI.showToast('Message copied', 'success'));
    }

    triggerDelete(messageId) {
        document.dispatchEvent(new CustomEvent('messageAction', { detail: { action: 'delete', messageId } }));
    }
}

console.log('✅ Context Menu loaded');
