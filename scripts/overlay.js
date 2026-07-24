// Shared modal overlay shell for the character sheet.
//
// Every popup on this page used to hand-roll its own backdrop, Escape handler and close
// wiring — six near-identical copies that had quietly drifted apart (only the theme modal
// restored focus or locked page scroll; the catalog picker's Escape only fired while its
// search box had focus). This module owns that behaviour once, so a caller supplies content
// and nothing else.
//
//   const handle = SheetOverlay.open({ title, body, footer, onClose });
//   handle.close();
//
// `body` is a Node, which lets a caller pass either freshly-built DOM or an element that
// already lives in index.html. Adopted elements are moved back into a hidden stash on close
// rather than discarded, so ids and document-wide querySelectorAll lookups keep resolving
// while the overlay is shut (syncThemeControls in sheet.js depends on this).
//
// Overlays stack: the theme modal can open the instructions on top of itself. Escape closes
// only the topmost, scroll unlocks when the last one goes, and focus unwinds down the stack.

window.SheetOverlay = (function () {
    'use strict';

    const FOCUSABLE = [
        'a[href]', 'button:not([disabled])', 'input:not([disabled])',
        'select:not([disabled])', 'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const stack = [];
    let seq = 0;

    function el(tag, cls, content) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (content !== undefined && content !== null) {
            if (content instanceof Node) node.appendChild(content);
            else node.textContent = String(content);
        }
        return node;
    }

    // Adopted (index.html-owned) bodies live here while their overlay is closed, so they stay
    // in the document and keep answering getElementById / querySelectorAll.
    function stash() {
        let box = document.getElementById('overlay-stash');
        if (!box) {
            box = el('div', 'overlay-stash');
            box.id = 'overlay-stash';
            box.hidden = true;
            document.body.appendChild(box);
        }
        return box;
    }

    function focusables(root) {
        return Array.from(root.querySelectorAll(FOCUSABLE))
            .filter((n) => n.offsetParent !== null || n === document.activeElement);
    }

    function top() {
        return stack.length ? stack[stack.length - 1] : null;
    }

    // One document-level listener for the whole stack, installed once.
    document.addEventListener('keydown', (e) => {
        const current = top();
        if (!current) return;
        if (e.key === 'Escape' && current.dismissible) {
            e.preventDefault();
            current.close();
            return;
        }
        if (e.key !== 'Tab') return;
        // Focus trap: wrap at the ends so Tab can never reach the page behind the overlay.
        const items = focusables(current.card);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });

    /**
     * @param {object} opts
     * @param {string} [opts.title]        heading text; also names the dialog for a11y
     * @param {Node}   opts.body           content node (built fresh, or adopted from the page)
     * @param {Node|Node[]} [opts.footer]  action row contents
     * @param {Function} [opts.onClose]    run after the overlay is torn down
     * @param {boolean} [opts.dismissible] Escape / backdrop / × can close it (default true)
     * @param {string} [opts.cls]          extra class on the overlay root
     * @returns {{close: Function, el: HTMLElement, card: HTMLElement}}
     */
    function open(opts) {
        const {
            title, body, footer, onClose,
            dismissible = true, cls,
        } = opts || {};

        const id = 'overlay-' + (++seq);
        const root = el('div', 'sheet-overlay no-print' + (cls ? ' ' + cls : ''));
        root.id = id;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');

        const card = el('div', 'overlay-card');
        root.appendChild(card);

        if (title) {
            const head = el('div', 'overlay-head');
            const heading = el('h2', 'overlay-title', title);
            heading.id = id + '-title';
            root.setAttribute('aria-labelledby', heading.id);
            head.appendChild(heading);
            if (dismissible) {
                const x = el('button', 'overlay-x', '×');
                x.type = 'button';
                x.title = 'Close';
                x.setAttribute('aria-label', 'Close');
                x.addEventListener('click', () => handle.close());
                head.appendChild(x);
            }
            card.appendChild(head);
        } else if (title === undefined && dismissible) {
            const x = el('button', 'overlay-x overlay-x-bare', '×');
            x.type = 'button';
            x.setAttribute('aria-label', 'Close');
            x.addEventListener('click', () => handle.close());
            card.appendChild(x);
        }

        const bodyWrap = el('div', 'overlay-body');
        // Every node that came from the page (rather than being built fresh) has to be handed
        // back on close, or it is destroyed along with the overlay root — taking its id with
        // it. Footer nodes matter as much as the body: the theme picker's "Don't show this on
        // load" checkbox lives there, and its onClose reads that checkbox by id.
        const adopted = [];
        if (body && body.parentNode) adopted.push(body);
        if (body) bodyWrap.appendChild(body);
        card.appendChild(bodyWrap);

        if (footer) {
            const foot = el('div', 'overlay-foot');
            for (const node of [].concat(footer)) {
                if (!node) continue;
                if (node.parentNode) adopted.push(node);
                foot.appendChild(node);
            }
            card.appendChild(foot);
        }

        if (dismissible) {
            // Close on click, but only when the press STARTED on the backdrop: dragging a text
            // selection out of the card must not dismiss it. Closing on mousedown instead would
            // also lose the focus restore — the browser finishes the click on the removed node
            // and parks focus on <body> after we've already restored it.
            let pressedBackdrop = false;
            root.addEventListener('mousedown', (e) => { pressedBackdrop = e.target === root; });
            root.addEventListener('click', (e) => {
                if (pressedBackdrop && e.target === root) handle.close();
                pressedBackdrop = false;
            });
        }

        const restoreTo = document.activeElement;
        let closed = false;

        const handle = {
            el: root,
            card,
            dismissible,
            close() {
                if (closed) return;
                closed = true;
                const i = stack.indexOf(handle);
                if (i >= 0) stack.splice(i, 1);
                // Before root.remove(), so onClose below can still find these by id.
                if (adopted.length) {
                    const box = stash();
                    for (const node of adopted) box.appendChild(node);
                }
                root.remove();
                if (!stack.length) document.body.classList.remove('overlay-open');
                const back = stack.length ? stack[stack.length - 1].card : null;
                if (back) focusables(back)[0]?.focus();
                else if (restoreTo && document.contains(restoreTo)) restoreTo.focus();
                onClose?.();
            },
        };

        document.body.appendChild(root);
        document.body.classList.add('overlay-open');
        stack.push(handle);
        // Focus the first control inside, falling back to the card so Escape still lands.
        const firstFocus = focusables(card)[0];
        if (firstFocus) firstFocus.focus();
        else {
            card.tabIndex = -1;
            card.focus();
        }
        return handle;
    }

    function closeTop() {
        top()?.close();
    }

    function isOpen() {
        return stack.length > 0;
    }

    // ---------------------------------------------------------------- toast
    // Transient confirmation for changes whose effect is easy to miss — flipping Explain
    // when you happen to be looking at a part of the sheet with no hints, say. Deliberately
    // NOT built on open() above: a toast must never take focus, trap Tab, dim the page or
    // block scrolling. One reused node, so rapid re-firing replaces rather than stacks.
    const TOAST_MS = 2400;
    let toastTimer = null;

    function toastNode() {
        let node = document.getElementById('sheet-toast');
        if (!node) {
            node = el('div', 'sheet-toast no-print');
            node.id = 'sheet-toast';
            node.setAttribute('role', 'status');
            node.setAttribute('aria-live', 'polite');
            document.body.appendChild(node);
        }
        return node;
    }

    /**
     * @param {string} text  message; keep it short and concrete
     * @param {{ms?: number}} [opts]
     */
    function toast(text, opts) {
        const node = toastNode();
        node.textContent = String(text ?? '');
        // Restart the entry animation even when the node is already showing.
        node.classList.remove('is-on');
        void node.offsetWidth;
        node.classList.add('is-on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => node.classList.remove('is-on'), opts?.ms ?? TOAST_MS);
    }

    return { open, closeTop, isOpen, toast, get count() { return stack.length; } };
})();
