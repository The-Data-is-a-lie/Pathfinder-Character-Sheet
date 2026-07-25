// Power-user keyboard layer: bare hotkeys + a Ctrl-K command palette.
//
// The sheet is dense and every action already lives behind a real DOM control (tab buttons,
// the primary-action buttons that renderPrimaryActions() paints into #topbar-primary, the
// toolbar buttons, the Tools drawer). Rather than reach into sheet.js internals, this module
// drives those controls: the palette rebuilds its command list from the live DOM every time
// it opens, so it always mirrors TABS and PRIMARY_ACTIONS without a second source of truth.
//
// Built on SheetOverlay for the palette shell (backdrop / Escape / focus trap / restore).
// Nothing here fires while the user is typing in a field — the sheet is full of inline
// editors, and a stray 'g' must never hijack a name edit.

window.SheetShortcuts = (function () {
    'use strict';

    function h(tag, cls, content) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (content !== undefined && content !== null) {
            if (content instanceof Node) el.appendChild(content);
            else el.textContent = String(content);
        }
        return el;
    }

    const overlay = () => window.SheetOverlay;

    // A keystroke belongs to whatever the user is editing, not to us.
    function isTyping(target) {
        if (!target) return false;
        const tag = target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    }

    function anyOverlayOpen() {
        const o = overlay();
        return !!(o && o.isOpen && o.isOpen());
    }

    function clickIf(selector) {
        const el = document.querySelector(selector);
        if (el) { el.click(); return true; }
        return false;
    }

    // ---------------------------------------------------------------- command list
    // Read live from the DOM so tabs, view switch and primary actions stay in sync
    // automatically — reorder a tab or rename an action and the palette just follows.
    function commands() {
        const cmds = [];

        document.querySelectorAll('.tab-nav .tab-btn').forEach((btn) => {
            const label = btn.textContent.trim();
            if (label) cmds.push({ label, group: 'Tab', run: () => btn.click() });
        });

        document.querySelectorAll('.topbar-primary .view-seg').forEach((seg) => {
            const name = seg.querySelector('.view-seg-label')?.textContent.trim();
            if (name) cmds.push({ label: name + ' view', group: 'View', run: () => seg.click() });
        });

        // Generate / Explain / Start here — whatever renderPrimaryActions painted.
        document.querySelectorAll('.topbar-primary .primary-action').forEach((btn) => {
            const label = btn.querySelector('.pa-label')?.textContent.trim() || btn.textContent.trim();
            if (label) cmds.push({ label, group: 'Action', run: () => btn.click() });
        });

        const toolbar = [
            ['#save-btn', 'Save character'],
            ['#toggle-load', 'Load JSON'],
            ['#theme-btn', 'Choose theme'],
            ['#print-btn', 'Print'],
        ];
        for (const [sel, label] of toolbar) {
            const el = document.querySelector(sel);
            if (el) cmds.push({ label, group: 'Action', run: () => el.click() });
        }

        if (window.SheetRoll?.toggle) {
            cmds.push({ label: 'Toggle Tools drawer', group: 'Action', run: () => window.SheetRoll.toggle() });
        }
        return cmds;
    }

    // ---------------------------------------------------------------- palette
    let handle = null;

    function openPalette() {
        const o = overlay();
        if (!o || handle) return; // already open, or no overlay module

        const all = commands();
        let filtered = all;
        let sel = 0;

        const input = h('input', 'cmdk-input');
        input.type = 'text';
        input.placeholder = 'Type a command…  (a tab name, generate, save, print)';
        input.setAttribute('aria-label', 'Command search');
        input.autocomplete = 'off';
        input.spellcheck = false;

        const list = h('ul', 'cmdk-list');
        list.setAttribute('role', 'listbox');

        const foot = h('div', 'cmdk-foot',
            '↑↓ move · Enter run · Esc close · hotkeys: 1–9 tabs, g generate, s save, t tools, e explain');

        const wrap = h('div', 'cmdk-wrap');
        wrap.append(input, list, foot);

        function renderList() {
            list.innerHTML = '';
            if (!filtered.length) {
                list.appendChild(h('li', 'cmdk-empty', 'No matching command'));
                return;
            }
            filtered.forEach((c, i) => {
                const li = h('li', 'cmdk-item' + (i === sel ? ' is-sel' : ''));
                li.setAttribute('role', 'option');
                li.setAttribute('aria-selected', i === sel ? 'true' : 'false');
                li.append(h('span', 'cmdk-label', c.label), h('span', 'cmdk-group', c.group || ''));
                li.addEventListener('mousemove', () => { if (sel !== i) { sel = i; renderList(); } });
                li.addEventListener('click', () => run(i));
                list.appendChild(li);
            });
        }

        function filter(q) {
            const needle = q.trim().toLowerCase();
            filtered = needle
                ? all.filter((c) => c.label.toLowerCase().includes(needle))
                : all;
            sel = 0;
            renderList();
        }

        function run(i) {
            const cmd = filtered[i];
            if (!cmd) return;
            handle.close();      // close first so the target (e.g. theme modal) isn't stacked under us
            cmd.run();
        }

        input.addEventListener('input', () => filter(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                sel = Math.min(sel + 1, filtered.length - 1);
                renderList();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                sel = Math.max(sel - 1, 0);
                renderList();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                run(sel);
            }
            // Escape falls through to SheetOverlay's stack handler.
        });

        renderList();
        handle = o.open({
            title: 'Command palette',
            body: wrap,
            cls: 'cmdk-overlay',
            onClose: () => { handle = null; },
        });
        input.focus();
    }

    // ---------------------------------------------------------------- global keys
    function switchToTab(index) {
        const btns = document.querySelectorAll('.tab-nav .tab-btn');
        if (btns[index]) { btns[index].click(); return true; }
        return false;
    }

    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd-K opens the palette from anywhere — even mid-edit.
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            openPalette();
            return;
        }

        // Everything below is a bare hotkey: never with a modifier, never while typing,
        // never with an overlay (including the palette itself) already up.
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (isTyping(e.target)) return;
        if (anyOverlayOpen()) return;

        const k = e.key;
        if (k >= '1' && k <= '9') { if (switchToTab(+k - 1)) e.preventDefault(); return; }
        if (k === '0') { if (switchToTab(9)) e.preventDefault(); return; }

        switch (k) {
            case 'g': if (clickIf('#toggle-gen')) e.preventDefault(); break;
            case 's': if (clickIf('#save-btn')) e.preventDefault(); break;
            case 't': if (window.SheetRoll?.toggle) { window.SheetRoll.toggle(); e.preventDefault(); } break;
            case 'e': if (clickIf('.topbar-primary .pa-explain')) e.preventDefault(); break;
            case '?': case '/': e.preventDefault(); openPalette(); break;
            default: break;
        }
    });

    return { openPalette };
})();
