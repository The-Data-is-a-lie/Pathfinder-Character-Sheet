// Shared drag-to-resize / collapse behaviour for the page's two edge panels: the left Tools
// drawer and the right action rail.
//
// All of the fiddly parts live here once — pointer capture, the hold-then-drag threshold on
// the toggle button, the collapse-past-a-threshold-to-close gesture, the "releasing here will
// close it" warning, arrow-key nudges, text-selection suppression, swallowing the click that
// ends a drag, and localStorage persistence. The two callers differ in exactly three ways:
// which edge they hang off, which CSS the measured size drives, and whether dragging is
// available at all (the rail becomes a tap-only bottom bar on narrow screens).
//
//   const panel = SheetEdgePanel.attach({
//       side: 'left', panel: drawerEl, handle: toggleBtn, grip: stripEl,
//       openClass: 'tools-open', resizingClass: 'tools-resizing',
//       keys: { open: 'sheet.toolsOpen', size: 'sheet.toolsWidth' },
//       min: 220, closeAt: 140, defaultSize: 320,
//       applySize: (px) => root.style.setProperty('--tools-width', px + 'px'),
//   });
//   panel.toggle();
//
// `size` is always measured in px from the panel's own edge, whatever the caller then does
// with it — the rail turns it into a scale factor, the drawer into a width.

window.SheetEdgePanel = (function () {
    'use strict';

    const DRAG_START = 5;    // px of movement before a press on the handle becomes a resize
    const NUDGE = 28;        // px per arrow-key press on the grip

    function readNum(key) {
        try {
            const v = parseInt(localStorage.getItem(key), 10);
            return Number.isFinite(v) ? v : null;
        } catch { return null; }
    }

    function write(key, value) {
        try { localStorage.setItem(key, value); } catch { /* private mode */ }
    }

    /**
     * @param {object} opts
     * @param {'left'|'right'} opts.side      which edge the panel hangs off
     * @param {HTMLElement} opts.panel        the panel being resized
     * @param {HTMLElement} [opts.handle]     toggle button; a tap toggles, a hold-drag resizes
     * @param {HTMLElement} [opts.grip]       drag strip on the panel's inner edge
     * @param {string} opts.openClass         body class marking the panel open
     * @param {string} opts.resizingClass     body class applied for the duration of a drag
     * @param {{open: string, size: string}} opts.keys  localStorage keys
     * @param {number} opts.min               smallest size a release will settle on
     * @param {number} [opts.max]             largest; defaults to 95% of the viewport
     * @param {number} opts.closeAt           release below this size closes instead
     * @param {number} opts.defaultSize       size when nothing is stored
     * @param {boolean} [opts.defaultOpen]    open state when nothing is stored
     * @param {(px: number) => void} opts.applySize   turn a size into CSS
     * @param {(open: boolean) => void} [opts.onToggle]  after open state changes
     * @param {() => boolean} [opts.dragDisabled]  true ⇒ handle taps only, no resizing
     * @returns {{open: Function, close: Function, toggle: Function, isOpen: Function,
     *            size: Function, setSize: Function}}
     */
    function attach(opts) {
        const {
            side, panel, handle, grip, openClass, resizingClass, keys,
            min, closeAt, defaultSize, defaultOpen = false,
            applySize, onToggle, dragDisabled,
        } = opts;
        if (!panel) return null;

        const maxSize = () => opts.max ?? Math.round(window.innerWidth * 0.95);
        const clamp = (px) => Math.max(min, Math.min(maxSize(), px));
        // Distance from this panel's edge to the pointer. Floored well under `min` so the
        // drag can still travel into close-threshold territory.
        const sizeAt = (clientX) => {
            const raw = side === 'right' ? window.innerWidth - clientX : clientX;
            return Math.max(40, Math.min(maxSize(), raw));
        };
        const noDrag = () => (dragDisabled ? dragDisabled() : false);

        function storedSize() {
            const v = readNum(keys.size);
            return v === null ? defaultSize : clamp(v);
        }

        function isOpen() {
            return document.body.classList.contains(openClass);
        }

        function setOpen(open) {
            document.body.classList.toggle(openClass, open);
            write(keys.open, open ? '1' : '0');
            if (handle) handle.setAttribute('aria-expanded', open ? 'true' : 'false');
            panel.setAttribute('aria-hidden', open ? 'false' : 'true');
            onToggle?.(open);
        }

        // ------------------------------------------------------------ drag
        let dragging = false;
        let captureEl = null;
        let capturedId = null;
        let handleDragged = false;  // a handle press that became a resize — swallow its click

        const blockSelect = (ev) => ev.preventDefault();

        const onMove = (ev) => {
            if (!dragging) return;
            const px = sizeAt(ev.clientX);
            applySize(px);
            panel.classList.toggle('will-close', px <= closeAt);
        };

        // Settle on a released size: too small counts as "close it", the way the × would.
        function finish(px) {
            if (px <= closeAt) {
                applySize(storedSize());   // restore a usable size for the next open
                setOpen(false);
            } else {
                const c = clamp(px);
                applySize(c);
                write(keys.size, String(c));
            }
        }

        const endDrag = (ev) => {
            if (!dragging) return;
            dragging = false;
            document.body.classList.remove(resizingClass);
            panel.classList.remove('will-close');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', endDrag);
            document.removeEventListener('selectstart', blockSelect);
            if (captureEl && capturedId != null) {
                try { captureEl.releasePointerCapture(capturedId); } catch { /* */ }
            }
            captureEl = null;
            capturedId = null;
            finish(sizeAt(ev.clientX));
        };

        // Begin a live resize from `target` (the grip or the handle). Capture so every
        // move/up targets it, and kill any selection attempt.
        function beginDrag(ev, target) {
            dragging = true;
            document.body.classList.add(resizingClass);
            try {
                target.setPointerCapture(ev.pointerId);
                captureEl = target;
                capturedId = ev.pointerId;
            } catch { /* capture unsupported — window listeners still track the drag */ }
            window.getSelection?.()?.removeAllRanges?.();
            document.addEventListener('selectstart', blockSelect);
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', endDrag);
            onMove(ev);
        }

        // Grip: dragging starts immediately.
        if (grip) {
            grip.addEventListener('pointerdown', (e) => {
                if (noDrag()) return;
                e.preventDefault();
                beginDrag(e, grip);
            });
            // Keyboard affordance: arrows nudge, and shrinking past the threshold closes.
            grip.addEventListener('keydown', (e) => {
                if (noDrag()) return;
                const cur = currentSize();
                const grow = side === 'right' ? 'ArrowLeft' : 'ArrowRight';
                const shrink = side === 'right' ? 'ArrowRight' : 'ArrowLeft';
                if (e.key === grow) { e.preventDefault(); finish(cur + NUDGE); }
                else if (e.key === shrink) { e.preventDefault(); finish(cur - NUDGE); }
            });
        }

        // Handle: a tap toggles, but press-and-drag past a small threshold turns it into a
        // live resize — opening the panel first, so you can fling it open to any size.
        if (handle) {
            handle.addEventListener('pointerdown', (e) => {
                if (e.button != null && e.button > 0) return; // primary button / touch only
                if (noDrag()) return;
                handleDragged = false;
                const startX = e.clientX;
                let started = false;
                // Watch on window, not the button: once the press moves off the small button
                // it stops getting pointermove, so the threshold must be tracked globally.
                const watchMove = (ev) => {
                    if (started || Math.abs(ev.clientX - startX) < DRAG_START) return;
                    started = true;
                    stopWatching();
                    handleDragged = true;         // this press is a drag, not a click
                    if (!isOpen()) setOpen(true); // open so the resize is visible
                    beginDrag(ev, handle);
                };
                const stopWatching = () => {
                    window.removeEventListener('pointermove', watchMove);
                    window.removeEventListener('pointerup', stopWatching);
                };
                window.addEventListener('pointermove', watchMove);
                window.addEventListener('pointerup', stopWatching);
            });
            handle.addEventListener('click', () => {
                if (handleDragged) { handleDragged = false; return; } // just finished a drag
                setOpen(!isOpen());
            });
        }

        function currentSize() {
            const measured = side === 'right'
                ? panel.getBoundingClientRect().width
                : parseInt(getComputedStyle(panel).width, 10);
            return Math.round(measured) || storedSize();
        }

        // ------------------------------------------------------------ boot
        applySize(storedSize());
        const storedOpen = (() => {
            try { return localStorage.getItem(keys.open); } catch { return null; }
        })();
        setOpen(storedOpen === null ? defaultOpen : storedOpen === '1');

        return {
            open: () => setOpen(true),
            close: () => setOpen(false),
            toggle: () => setOpen(!isOpen()),
            isOpen,
            size: currentSize,
            setSize: (px) => finish(px),
        };
    }

    return { attach };
})();
