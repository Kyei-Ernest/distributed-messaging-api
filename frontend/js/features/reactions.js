/**
 * ============================================================================
 * Message Reactions — Long-press to react with emoji
 * ============================================================================
 */
class MessageReactions {
    constructor() {
        this.reactions = ['❤️', '😆', '😮', '😢', '👏', '🔥'];
        this.longPressTimer = null;
        this.currentTarget = null;
        this.init();
    }

    init() {
        document.addEventListener('contextmenu', (e) => {
            const bubble = e.target.closest('.message-bubble');
            if (bubble && bubble.closest('.message')) {
                e.preventDefault();
                this.showReactionPicker(
                    e.clientX,
                    e.clientY,
                    bubble.closest('.message').dataset.messageId
                );
            }
        });

        document.addEventListener('touchstart', (e) => {
            const bubble = e.target.closest('.message-bubble');
            if (!bubble) return;
            const msg = bubble.closest('.message');
            if (!msg) return;

            this.currentTarget = msg;
            this.longPressTimer = setTimeout(() => {
                const rect = msg.getBoundingClientRect();
                this.showReactionPicker(
                    rect.left + rect.width / 2,
                    rect.top - 10,
                    msg.dataset.messageId
                );
            }, 500);
        });

        document.addEventListener('touchend', () => {
            clearTimeout(this.longPressTimer);
        });

        document.addEventListener('touchmove', () => {
            clearTimeout(this.longPressTimer);
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.reaction-picker')) {
                document.querySelector('.reaction-picker')?.remove();
            }
        });
    }

    showReactionPicker(x, y, messageId) {
        // Remove any existing picker
        document.querySelector('.reaction-picker')?.remove();

        const picker = document.createElement('div');
        picker.className = 'reaction-picker';
        picker.innerHTML = this.reactions.map(r =>
            `<button class="reaction-option" data-reaction="${r}">${r}</button>`
        ).join('');

        picker.style.cssText = `
            position: fixed;
            display: flex;
            gap: 6px;
            padding: 8px 12px;
            background: var(--bg-surface);
            border: 1px solid var(--border-subtle);
            border-radius: 20px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            z-index: 2001;
            left: ${Math.min(x - 80, window.innerWidth - 210)}px;
            top: ${Math.max(y - 50, 10)}px;
        `;

        picker.querySelectorAll('.reaction-option').forEach(btn => {
            btn.style.cssText = `
                background: none;
                border: none;
                font-size: 1.5rem;
                cursor: pointer;
                padding: 4px;
                border-radius: 50%;
                transition: transform 0.15s;
                width: 40px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const reaction = btn.dataset.reaction;
                await this.addReaction(messageId, reaction);
                picker.remove();
            });
            btn.addEventListener('mouseenter', () => {
                btn.style.transform = 'scale(1.3)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = 'scale(1)';
            });
        });

        document.body.appendChild(picker);

        setTimeout(() => {
            document.addEventListener('click', function rm() {
                picker.remove();
                document.removeEventListener('click', rm);
            }, { once: true });
        }, 100);
    }

    async addReaction(messageId, reaction) {
        try {
            await api.reactToMessage(messageId, reaction);
        } catch (error) {
            console.error('Failed to add reaction:', error);
        }
    }
}
