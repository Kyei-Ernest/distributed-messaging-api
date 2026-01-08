// Pull-to-Refresh Implementation
// Works everywhere EXCEPT the chat messages area

class PullToRefresh {
    constructor() {
        this.container = document.body;
        this.refreshThreshold = 80;
        this.isRefreshing = false;
        this.startY = 0;
        this.currentY = 0;
        this.pullDistance = 0;
        this.canPull = false; // Only allow pull when at top

        this.createIndicator();
        this.attachListeners();
    }

    createIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'pull-to-refresh-indicator';
        indicator.className = 'pull-to-refresh-indicator';
        indicator.innerHTML = `
            <div class="pull-indicator-content">
                <div class="pull-spinner"></div>
                <span class="pull-text">Pull to refresh</span>
            </div>
        `;

        document.body.appendChild(indicator);
        this.indicator = indicator;
    }

    attachListeners() {
        // Touch events for mobile
        document.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: true });
        document.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        document.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: true });

        // Mouse events for desktop
        document.addEventListener('mousedown', (e) => this.handleMouseStart(e));
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', (e) => this.handleMouseEnd(e));
    }

    isInsideMessagesContainer(element) {
        // Check if the touch/click is inside the messages container
        const messagesContainer = document.getElementById('messages-container');
        if (!messagesContainer) return false;

        return messagesContainer.contains(element);
    }

    handleTouchStart(e) {
        if (this.isRefreshing) return;

        // Don't activate if inside messages container
        if (this.isInsideMessagesContainer(e.target)) return;

        // ONLY activate if we're at absolute top of page
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        if (scrollTop === 0) {
            this.startY = e.touches[0].clientY;
            this.canPull = true;
        } else {
            this.canPull = false;
        }
    }

    handleTouchMove(e) {
        if (this.isRefreshing || !this.canPull || this.startY === 0) return;

        // Don't activate if inside messages container
        if (this.isInsideMessagesContainer(e.target)) return;

        this.currentY = e.touches[0].clientY;
        this.pullDistance = this.currentY - this.startY;

        // Still at top AND pulling DOWN (positive distance)
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        if (this.pullDistance > 0 && scrollTop === 0) {
            e.preventDefault();
            this.updateIndicator(this.pullDistance);
        } else {
            // If user scrolled or pulled up, cancel
            this.canPull = false;
            this.resetIndicator();
        }
    }

    handleTouchEnd(e) {
        if (this.isRefreshing || !this.canPull || this.startY === 0) {
            this.canPull = false;
            return;
        }

        if (this.pullDistance >= this.refreshThreshold) {
            this.triggerRefresh();
        } else {
            this.resetIndicator();
        }

        this.startY = 0;
        this.pullDistance = 0;
        this.canPull = false;
    }

    // Desktop mouse handlers
    handleMouseStart(e) {
        if (this.isRefreshing) return;

        // Don't activate if inside messages container
        if (this.isInsideMessagesContainer(e.target)) return;

        // ONLY activate if at absolute top
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        if (scrollTop === 0) {
            this.startY = e.clientY;
            this.isDragging = false;
            this.canPull = true;
        } else {
            this.canPull = false;
        }
    }

    handleMouseMove(e) {
        if (this.isRefreshing || !this.canPull || this.startY === 0) return;

        // Don't activate if inside messages container  
        if (this.isInsideMessagesContainer(e.target)) return;

        this.currentY = e.clientY;
        this.pullDistance = this.currentY - this.startY;

        if (this.pullDistance > 10) {
            this.isDragging = true;
        }

        // Still at top AND pulling DOWN
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        if (this.isDragging && this.pullDistance > 0 && scrollTop === 0) {
            e.preventDefault();
            this.updateIndicator(this.pullDistance);
        } else if (scrollTop > 0) {
            // User scrolled, cancel
            this.canPull = false;
            this.resetIndicator();
        }
    }

    handleMouseEnd(e) {
        if (!this.isDragging || !this.canPull) {
            this.startY = 0;
            this.canPull = false;
            return;
        }

        if (this.pullDistance >= this.refreshThreshold) {
            this.triggerRefresh();
        } else {
            this.resetIndicator();
        }

        this.startY = 0;
        this.pullDistance = 0;
        this.isDragging = false;
        this.canPull = false;
    }

    updateIndicator(distance) {
        if (!this.indicator) return;

        const cappedDistance = Math.min(distance, this.refreshThreshold * 1.5);
        const progress = Math.min(distance / this.refreshThreshold, 1);

        this.indicator.style.transform = `translateY(${cappedDistance - 80}px)`;
        this.indicator.style.opacity = progress;

        const spinner = this.indicator.querySelector('.pull-spinner');
        if (spinner) {
            spinner.style.transform = `rotate(${progress * 360}deg)`;
        }

        const text = this.indicator.querySelector('.pull-text');
        if (text) {
            text.textContent = progress >= 1 ? 'Release to refresh' : 'Pull to refresh';
        }
    }

    async triggerRefresh() {
        if (this.isRefreshing) return;

        this.isRefreshing = true;

        this.indicator.classList.add('refreshing');
        this.indicator.style.transform = `translateY(0px)`;
        this.indicator.style.opacity = '1';

        const text = this.indicator.querySelector('.pull-text');
        if (text) {
            text.textContent = 'Refreshing...';
        }

        try {
            await new Promise(resolve => setTimeout(resolve, 500));
            window.location.reload();
        } catch (error) {
            console.error('Refresh failed:', error);
            this.resetIndicator();
        }
    }

    resetIndicator() {
        if (!this.indicator) return;

        this.indicator.classList.remove('refreshing');
        this.indicator.style.transform = 'translateY(-80px)';
        this.indicator.style.opacity = '0';
        this.isRefreshing = false;

        const text = this.indicator.querySelector('.pull-text');
        if (text) {
            text.textContent = 'Pull to refresh';
        }
    }
}

// Initialize when document is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.pullToRefresh = new PullToRefresh();
    });
} else {
    window.pullToRefresh = new PullToRefresh();
}
