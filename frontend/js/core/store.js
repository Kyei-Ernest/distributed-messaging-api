/**
 * ============================================================================
 * DMS Reactive Store — signals, effects, and the application state tree.
 *
 * A tiny (zero-dependency) fine-grained reactivity kernel for the vanilla
 * frontend. Loaded as a classic script exposing globals, matching the rest
 * of the codebase's no-build contract.
 *
 *   const [count, setCount] = Store.signal(0);
 *   Store.effect(() => console.log(count()), count);   // logs on change
 *   setCount(1);
 *
 * Effects are batched per animation frame: N synchronous mutations trigger
 * exactly one effect run per frame.
 * ============================================================================
 */
(function () {
    'use strict';

    var batching = false;
    var pendingEffects = new Set();

    function flush() {
        batching = false;
        var effects = Array.from(pendingEffects);
        pendingEffects.clear();
        effects.forEach(function (run) { run(); });
    }

    /** Batch mutations so dependent effects run once, after paint. */
    function batch(fn) {
        if (batching) { fn(); return; }
        batching = true;
        try { fn(); } finally {
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
            else setTimeout(flush, 0);
        }
    }

    function schedule(effect) {
        pendingEffects.add(effect);
        if (!batching) batch(function () {});
    }

    /**
     * Create a reactive signal.
     * Returns [getter, setter] where setter(v | (prev) => next).
     */
    function signal(initial) {
        var value = initial;
        var subscribers = new Set();

        function get() { return value; }

        function set(next) {
            var resolved = typeof next === 'function' ? next(value) : next;
            if (resolved === value) return;
            value = resolved;
            subscribers.forEach(function (fn) { schedule(fn); });
        }

        get.subscribe = function (fn) {
            subscribers.add(fn);
            return function () { subscribers.delete(fn); };
        };
        return [get, set];
    }

    /**
     * Run `fn` now and whenever any subscribed signal changes.
     * Pass optional signals array to subscribe explicitly; otherwise use
     * getter.subscribe manually. Auto-tracked reading is intentionally not
     * implemented — explicit subscription keeps this tiny and predictable.
     */
    function effect(fn, signals) {
        var run = function () { fn(); };
        if (Array.isArray(signals)) {
            signals.forEach(function (s) { s.subscribe(run); });
        }
        fn();
        return run;
    }

    /** Derived read-only signal recomputed when inputs change (pulled on read). */
    function computed(fn, signals) {
        var cached;
        var dirty = true;
        if (Array.isArray(signals)) {
            signals.forEach(function (s) {
                s.subscribe(function () { dirty = true; });
            });
        }
        var get = function () {
            if (dirty) { cached = fn(); dirty = false; }
            return cached;
        };
        return get;
    }

    /** Persisted slice helper: hydrates from localStorage, writes back on set. */
    function persisted(key, initial, reviver) {
        var stored = null;
        try { stored = localStorage.getItem(key); } catch (e) { /* private mode */ }
        var value = stored != null
            ? (reviver ? reviver(JSON.parse(stored)) : JSON.parse(stored))
            : initial;
        var sig = signal(value);
        var origSet = sig[1];
        sig[1] = function (next) {
            origSet(next);
            try { localStorage.setItem(key, JSON.stringify(sig[0]())); } catch (e) { /* quota */ }
        };
        return sig;
    }

    /**
     * The application state tree. Slices are plain objects of signals:
     *   AppStore.ui.theme() -> 'light' | 'dark' | 'auto'
     *   AppStore.set('ui', 'activeTab', 'groups')
     *   AppStore.update('presence', 'online', (set) => set.add(id))
     */
    var slices = {
        ui: {
            theme: persisted('theme', 'auto'),
            activeTab: signal('chats'),
            sidebarOpen: signal(false),
        },
        connection: {
            status: signal('disconnected'), // disconnected | connecting | connected
        },
        presence: {
            online: signal(new Set()),
        },
        unread: {
            total: signal(0),
        },
        typing: {
            users: signal([]), // [{ id, username }] in the open chat
        },
    };

    window.Store = {
        signal: signal,
        effect: effect,
        computed: computed,
        batch: batch,
        persisted: persisted,
    };

    window.AppStore = {
        slices: slices,
        get: function (slice, key) { return slices[slice][key](); },
        set: function (slice, key, value) { slices[slice][key](value); },
        update: function (slice, key, fn) { slices[slice][key](function (prev) { return fn(prev); }); },
        subscribe: function (slice, key, fn) { return slices[slice][key].subscribe(fn); },
    };
})();
