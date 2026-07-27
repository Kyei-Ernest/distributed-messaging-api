/**
 * ============================================================================
 * EventBus - Simple pub/sub system for inter-module communication
 * ============================================================================
 */
class EventBus {
    constructor() {
        this.events = new Map();
    }

    on(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        this.events.get(event).push(callback);
        return () => this.off(event, callback);
    }

    once(event, callback) {
        const unsubscribe = this.on(event, (...args) => {
            unsubscribe();
            callback(...args);
        });
    }

    emit(event, data) {
        const callbacks = this.events.get(event);
        if (callbacks) {
            callbacks.forEach(cb => {
                try { cb(data); } catch (e) { console.error(`EventBus error [${event}]:`, e); }
            });
        }
    }

    off(event, callback) {
        const callbacks = this.events.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) callbacks.splice(index, 1);
        }
    }
}

// Global EventBus instance
const eventBus = new EventBus();
