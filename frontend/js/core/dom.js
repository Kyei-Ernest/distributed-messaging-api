/**
 * ============================================================================
 * DMS DOM Kit — hyperscript builder + keyed list reconciliation.
 *
 * Declarative element construction without a build step:
 *
 *   const row = h('li', { class: 'item', onclick: () => open(id) },
 *       h('span', { class: 'name' }, user.username),
 *   );
 *
 * `renderList` diffs by key: only new/removed/moved nodes touch the DOM,
 * so re-sorting or filtering long lists no longer rebuilds them wholesale
 * (the old innerHTML='' pattern destroyed scroll positions and focus).
 * ============================================================================
 */
(function () {
    'use strict';

    var SVG_NS = 'http://www.w3.org/2000/svg';

    function isEventKey(key) {
        return key.length > 2 && key.slice(0, 2) === 'on';
    }

    /**
     * Create an element. Props: class, dataset entries via data-*, aria-* and
     * standard attributes, on<Event> listeners, style object, boolean attrs.
     * Children: strings (text), Nodes, arrays (flattened), null/undefined
     * (skipped). Use the tag prefix 'svg:' for SVG elements.
     */
    function h(tag, props) {
        var children = Array.prototype.slice.call(arguments, 2);
        var isSvg = tag.slice(0, 4) === 'svg:';
        var el = isSvg
            ? document.createElementNS(SVG_NS, tag.slice(4))
            : document.createElement(tag);

        if (props) {
            Object.keys(props).forEach(function (key) {
                var value = props[key];
                if (value == null || value === false) return;
                if (isEventKey(key)) {
                    el.addEventListener(key.slice(2).toLowerCase(), value);
                } else if (key === 'class') {
                    el.setAttribute('class', Array.isArray(value) ? value.join(' ') : value);
                } else if (key === 'style' && typeof value === 'object') {
                    Object.assign(el.style, value);
                } else if (key === 'dataset') {
                    Object.keys(value).forEach(function (k) { el.dataset[k] = value[k]; });
                } else if (value === true) {
                    el.setAttribute(key, '');
                } else {
                    el.setAttribute(key, value);
                }
            });
        }

        appendChildren(el, children);
        return el;
    }

    function appendChildren(el, children) {
        children.forEach(function (child) {
            if (child == null || child === false) return;
            if (Array.isArray(child)) { appendChildren(el, child); return; }
            el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
    }

    /** DocumentFragment from variadic nodes/strings. */
    function frag() {
        var f = document.createDocumentFragment();
        appendChildren(f, Array.prototype.slice.call(arguments));
        return f;
    }

    /**
     * Keyed list reconciliation.
     *
     * @param {HTMLElement} container - list parent; its non-keyed children are managed
     * @param {Array} items - view-model items
     * @param {(item) => string} keyOf - stable identity per item
     * @param {(item) => Node} render - builds a node for a NEW item only
     * Reuses existing nodes for known keys (state, listeners and scroll-safe
     * transitions survive), removes stale nodes, and moves nodes to match order.
     */
    function renderList(container, items, keyOf, render) {
        var existing = new Map();
        Array.prototype.forEach.call(container.children, function (child) {
            var key = child.__listKey;
            if (key != null) existing.set(key, child);
        });

        var nextInOrder = [];
        var seen = new Set();

        items.forEach(function (item) {
            var key = String(keyOf(item));
            seen.add(key);
            var node = existing.get(key);
            if (!node) {
                node = render(item);
                node.__listKey = key;
            }
            nextInOrder.push(node);
        });

        existing.forEach(function (node, key) {
            if (!seen.has(key)) node.remove();
        });

        var cursor = container.firstChild;
        nextInOrder.forEach(function (node) {
            if (node !== cursor) container.insertBefore(node, cursor);
            else cursor = cursor.nextSibling;
            if (cursor === node) cursor = cursor.nextSibling;
        });
    }

    /** Focus-trap helper for modals/dialogs. Returns a cleanup function. */
    function trapFocus(container) {
        var selector = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
        function onKey(e) {
            if (e.key !== 'Tab') return;
            var focusables = container.querySelectorAll(selector);
            if (!focusables.length) return;
            var first = focusables[0];
            var last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
        container.addEventListener('keydown', onKey);
        return function () { container.removeEventListener('keydown', onKey); };
    }

    window.h = h;
    window.frag = frag;
    window.renderList = renderList;
    window.trapFocus = trapFocus;
})();
