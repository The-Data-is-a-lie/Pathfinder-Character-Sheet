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
        cmds.push(...contentCommands());
        return cmds;
    }

    // ------------------------------------------------------- deep content jumps (#85)
    // Fuzzy-jump to any inventory item, spell, skill, feature or settings section on the
    // CURRENT character: open the right tab, scroll the row into view, flash it. Built
    // fresh each palette open, same as the shell commands — no second source of truth.
    function jumpTo(tabId, name) {
        document.querySelector(`.tab-btn[data-tab="${tabId}"]`)?.click();
        // Panes are pre-rendered; one frame lets the tab switch paint before we scroll.
        setTimeout(() => {
            const pane = document.querySelector(`.tab-pane[data-tab="${tabId}"]`);
            if (!pane) return;
            const needle = String(name).toLowerCase();
            let best = null;
            for (const el of pane.querySelectorAll('*')) {
                if (el.children.length > 6) continue;              // rows, not whole sections
                const t = el.textContent;
                if (!t || t.length > 300) continue;
                if (!t.toLowerCase().includes(needle)) continue;
                if (!best || t.length < best.textContent.length) best = el;
            }
            if (!best) return;
            const row = best.closest(
                'tr, li, .spell-prep-row, .dnd-item, .settings-row, details, h3') || best;
            row.scrollIntoView({ block: 'center', behavior: 'smooth' });
            row.classList.add('cmdk-flash');
            setTimeout(() => row.classList.remove('cmdk-flash'), 1600);
        }, 60);
    }

    function contentCommands() {
        const d = window.SheetApp?.current;
        if (!d || d.error) return [];
        const cmds = [];
        const seen = new Set();
        const add = (label, group, tabId) => {
            const name = String(label || '').trim();
            const key = group + '|' + name.toLowerCase();
            if (!name || seen.has(key)) return;
            seen.add(key);
            cmds.push({ label: name, group, run: () => jumpTo(tabId, name) });
        };
        for (const it of d.equipment_list || []) {
            add(typeof it === 'string' ? it : it?.name, 'Item', 'inventory');
        }
        for (const lvl of d.spell_list_choose_from || []) {
            for (const s of lvl || []) add(s, 'Spell', 'spells');
        }
        for (const bk of d._sheet?.extraSpellbooks || []) {
            for (const lvl of bk.lists || []) for (const s of lvl || []) add(s, 'Spell', 'spells');
        }
        for (const sk of window.SheetData?.ALL_SKILLS || []) add(sk.name, 'Skill', 'skills');
        for (const g of window.SheetData?.FEAT_GROUPS || []) {
            const list = d[g.listKey];
            if (Array.isArray(list)) for (const f of list) add(f, 'Feature', 'features');
        }
        for (const picks of Object.values(d.class_features || {})) {
            if (picks && typeof picks === 'object' && !Array.isArray(picks)) {
                for (const n of Object.keys(picks)) add(n, 'Feature', 'features');
            }
        }
        for (const t of d.traits || d.selected_traits || []) add(t, 'Feature', 'features');
        document.querySelectorAll('.tab-pane[data-tab="settings"] h3').forEach((el) => {
            add(el.textContent, 'Setting', 'settings');
        });
        return cmds;
    }

    /** Substring beats prefix-ish beats subsequence; shorter labels win ties. −1 = no match. */
    function fuzzyScore(label, needle) {
        const l = label.toLowerCase();
        const idx = l.indexOf(needle);
        if (idx === 0) return 100 - l.length * 0.01;
        if (idx > 0) return 60 - idx * 0.1 - l.length * 0.01;
        let li = 0;
        for (const ch of needle) {
            li = l.indexOf(ch, li);
            if (li < 0) return -1;
            li += 1;
        }
        return 30 - l.length * 0.01;
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
            if (!needle) {
                filtered = all.slice(0, 60);   // content commands run to hundreds — type to reach them
            } else {
                filtered = all
                    .map((c) => [fuzzyScore(c.label, needle), c])
                    .filter(([s]) => s >= 0)
                    .sort((a, b) => b[0] - a[0])
                    .slice(0, 50)
                    .map(([, c]) => c);
            }
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

        filter('');
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
