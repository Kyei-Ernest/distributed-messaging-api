/**
 * ============================================================================
 * Media & File Features - Upload, Image viewer, Voice recording
 * ============================================================================
 */

// File Upload Handler
class FileUploadHandler {
    constructor() {
        this.fileInput = document.getElementById('file-input');
        this.attachBtn = document.getElementById('attach-btn');
        this.previewArea = document.getElementById('file-preview-area');
        this.previewList = document.getElementById('file-preview-list');
        if (!this.fileInput) return;
        this.files = [];
        this.init();
    }

    init() {
        this.attachBtn?.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleFiles(Array.from(e.target.files)));

        const container = document.getElementById('messages-container');
        if (container) {
            container.addEventListener('dragover', (e) => { e.preventDefault(); container.classList.add('drag-over'); });
            container.addEventListener('dragleave', () => container.classList.remove('drag-over'));
            container.addEventListener('drop', (e) => {
                e.preventDefault();
                container.classList.remove('drag-over');
                this.handleFiles(Array.from(e.dataTransfer.files));
            });
        }
    }

    handleFiles(newFiles) {
        this.files.push(...newFiles);
        this.renderPreviews();
        this.previewArea?.classList.remove('hidden');
    }

    renderPreviews() {
        if (!this.previewList) return;
        this.previewList.innerHTML = this.files.map((file, i) => `
            <div class="file-preview-item" data-index="${i}">
                ${file.type.startsWith('image/')
                ? `<img src="${URL.createObjectURL(file)}" alt="${file.name}" class="file-thumbnail">`
                : `<div class="file-icon">${this.getFileIcon(file.type)}</div>`}
                <div class="file-info">
                    <span class="file-name">${file.name.substring(0, 20)}${file.name.length > 20 ? '...' : ''}</span>
                    <span class="file-size">${this.formatSize(file.size)}</span>
                </div>
                <button type="button" class="remove-file" data-index="${i}">×</button>
            </div>
        `).join('');

        this.previewList.querySelectorAll('.remove-file').forEach(btn => {
            btn.addEventListener('click', () => this.removeFile(parseInt(btn.dataset.index)));
        });
    }

    getFileIcon(type) {
        if (type.includes('pdf')) return '📄';
        if (type.includes('word')) return '📝';
        if (type.includes('video')) return '🎥';
        return '📎';
    }

    removeFile(index) {
        this.files.splice(index, 1);
        if (this.files.length === 0) this.previewArea?.classList.add('hidden');
        this.renderPreviews();
    }

    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    getFiles() { return this.files; }
    clear() { this.files = []; this.fileInput.value = ''; this.previewArea?.classList.add('hidden'); }
}

// Image Viewer
class ImageViewer {
    constructor() {
        this.viewer = document.getElementById('image-viewer');
        this.img = document.getElementById('image-viewer-img');
        this.closeBtn = document.getElementById('close-image-viewer');
        if (!this.viewer) return;
        this.init();
    }

    init() {
        this.closeBtn?.addEventListener('click', () => this.close());
        this.viewer.addEventListener('click', (e) => { if (e.target === this.viewer) this.close(); });
    }

    open(src, title, subtitle) {
        this.img.src = src;
        document.getElementById('image-viewer-title').textContent = title || 'Image';
        document.getElementById('image-viewer-subtitle').textContent = subtitle || '';
        this.viewer.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    close() {
        this.viewer.classList.add('hidden');
        document.body.style.overflow = '';
    }
}

// Scroll Manager
class ScrollManager {
    constructor(containerId, btnId) {
        this.container = document.getElementById(containerId);
        this.btn = document.getElementById(btnId);
        if (!this.container || !this.btn) return;
        this.init();
    }

    init() {
        this.container.addEventListener('scroll', () => this.checkScroll());
        this.btn.addEventListener('click', () => this.scrollToBottom());
    }

    checkScroll() {
        const isAtBottom = this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight < 100;
        this.btn.classList.toggle('hidden', isAtBottom);
    }

    scrollToBottom(smooth = true) {
        this.container.scrollTo({ top: this.container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }

    isAtBottom() {
        return this.container.scrollHeight - this.container.scrollTop - this.container.clientHeight < 100;
    }
}

console.log('✅ Media Features loaded');
