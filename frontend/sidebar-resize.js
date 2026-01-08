// ============================================================================
// FILE: sidebar-resize.js - Resizable Sidebar for Desktop
// ============================================================================

class SidebarResizer {
    constructor() {
        this.sidebar = document.querySelector('.sidebar');
        this.handle = null;
        this.isResizing = false;
        this.startX = 0;
        this.startWidth = 0;

        this.init();
    }

    init() {
        // Only enable on desktop
        if (window.innerWidth <= 768) return;

        // Create resize handle
        this.handle = document.createElement('div');
        this.handle.className = 'sidebar-resize-handle';
        this.sidebar.appendChild(this.handle);

        // Load saved width from localStorage
        const savedWidth = localStorage.getItem('sidebar-width');
        if (savedWidth) {
            this.sidebar.style.width = savedWidth;
        }

        // Add event listeners
        this.handle.addEventListener('mousedown', (e) => this.startResize(e));
        document.addEventListener('mousemove', (e) => this.resize(e));
        document.addEventListener('mouseup', () => this.stopResize());

        // Re-initialize on window resize (if switching from mobile to desktop)
        window.addEventListener('resize', () => {
            if (window.innerWidth <= 768) {
                this.destroy();
            } else if (!this.handle) {
                this.init();
            }
        });
    }

    startResize(e) {
        e.preventDefault();
        this.isResizing = true;
        this.startX = e.clientX;
        this.startWidth = parseInt(getComputedStyle(this.sidebar).width, 10);

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }

    resize(e) {
        if (!this.isResizing) return;

        const delta = e.clientX - this.startX;
        const newWidth = this.startWidth + delta;

        // Constrain between min and max
        if (newWidth >= 280 && newWidth <= 600) {
            this.sidebar.style.width = newWidth + 'px';
        }
    }

    stopResize() {
        if (!this.isResizing) return;

        this.isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // Save width to localStorage
        const currentWidth = this.sidebar.style.width;
        if (currentWidth) {
            localStorage.setItem('sidebar-width', currentWidth);
        }
    }

    destroy() {
        if (this.handle) {
            this.handle.remove();
            this.handle = null;
        }
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.sidebarResizer = new SidebarResizer();
});
