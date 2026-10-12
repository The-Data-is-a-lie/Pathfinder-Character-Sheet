// scripts/list-filter.js -- one search box + section chips for every list tab (window.SheetListFilter,
// #149, pf1's actor-item-nav-filters.hbs). Features had its own toolbar and Inventory a bare search;
// Combat, Buffs and Spells had nothing. This states the behaviour once:
//
//   - the search box hides rows whose text does not match;
//   - one chip per section narrows to the chosen sections (none chosen = all);
//   - "Hide empty" hides any section left with no visible rows (after search and chips);
//   - "Prepared only" (where a tab supplies `prepared`) hides unprepared rows.
//
// Chips are DERIVED FROM THE DOM, not passed in: any element matching `groupSel` is a section, its
// label and row count are read off it. That is what lets the Combat tab filter the conditionals
// panel roll.js renders on its own schedule. A MutationObserver re-applies the filter and re-syncs
// the chips whenever the tab's content changes, and the state is kept per tab key, so the filter
// survives the re-render every edit on this sheet triggers. Hiding is by class/style only — rows
// are never rebuilt here.
window.SheetListFilter = (function () {
    'use strict';
    const { h } = window.SheetUI;

    // Per-tab filter state for this page session: { q, groups: Set, empty, prepared }.
    // Keyed by tab; owned by one character object, so switching characters starts clean.
    const STATE = new Map();
    const stateFor = (key, owner) => {
        const cur = STATE.get(key);
        if (cur && cur.owner === owner) return cur;
        const fresh = { owner, q: '', groups: new Set(), empty: false, prepared: false };
        STATE.set(key, fresh);
        return fresh;
    };

    /**
     * Build the toolbar for one tab and start filtering `root` (the tab's section body).
     * cfg: {
     *   key,                 // state key, e.g. 'spells'
     *   root?,               // element the groups and rows live under (default: the tab pane)
     *   placeholder,
     *   groupSel,            // CSS selector for section containers
     *   groupId(el),         // slug for a section (sections sharing a slug share one chip)
     *   groupLabel(el),      // chip text
     *   rowSel,              // CSS selector for rows, matched inside each section
     *   rowText?(el),        // searchable text (default: textContent)
     *   prepared?(el),       // true / false, or null when "prepared" means nothing for the row
     *   extra?,              // a node appended to the toolbar (Inventory's jump links)
     *   cls?,                // extra toolbar class (keeps a tab's existing CSS hooks)
     * }
     */
    function attach(cfg) {
        const st = stateFor(cfg.key, cfg.owner ?? window.SheetApp?.current);
        const bar = h('div', 'list-toolbar no-print' + (cfg.cls ? ' ' + cfg.cls : ''));
        bar.dataset.listKey = cfg.key;
        const search = h('input', 'edit-field list-search' + (cfg.searchCls ? ' ' + cfg.searchCls : ''));
        search.type = 'search';
        search.placeholder = cfg.placeholder || 'Search…';
        search.setAttribute('aria-label', cfg.placeholder || 'Search this tab');
        search.value = st.q;
        const pills = h('div', 'list-filter-pills feature-filter-pills');
        pills.setAttribute('role', 'group');
        pills.setAttribute('aria-label', 'Show sections');
        const specials = h('div', 'list-filter-specials');
        bar.append(search, pills, specials);
        if (cfg.extra) bar.appendChild(cfg.extra);

        const mkSpecial = (key, label, title) => {
            const b = h('button', 'filter-pill filter-special');
            b.type = 'button';
            b.dataset.special = key;
            b.textContent = label;
            b.title = title;
            const sync = () => {
                b.classList.toggle('is-active', !!st[key]);
                b.setAttribute('aria-pressed', String(!!st[key]));
            };
            sync();
            b.addEventListener('click', () => { st[key] = !st[key]; sync(); apply(); });
            specials.appendChild(b);
        };
        mkSpecial('empty', 'Hide empty', 'Hide sections with nothing showing');
        if (cfg.prepared) mkSpecial('prepared', 'Prepared only', 'Show only prepared spells (spontaneous lists stay)');

        const rootEl = () => cfg.root || bar.closest('.tab-pane') || bar.parentElement;
        const groups = () => [...(rootEl()?.querySelectorAll(cfg.groupSel) || [])]
            .filter((g) => !bar.contains(g));
        let pillSig = '';
        function syncPills() {
            const seen = new Map();
            for (const g of groups()) {
                const id = cfg.groupId(g);
                if (!id) continue;
                const n = g.querySelectorAll(cfg.rowSel).length;
                const prev = seen.get(id);
                if (prev) prev.count += n;
                else seen.set(id, { id, label: cfg.groupLabel(g) || id, count: n });
            }
            const sig = [...seen.values()].map((e) => `${e.id}:${e.count}`).join('|');
            if (sig === pillSig) return;
            pillSig = sig;
            // A section that disappeared cannot stay selected, or nothing would ever show.
            for (const id of [...st.groups]) if (!seen.has(id)) st.groups.delete(id);
            pills.textContent = '';
            for (const e of seen.values()) {
                const pill = h('button', 'filter-pill');
                pill.type = 'button';
                pill.dataset.lgroup = e.id;
                pill.appendChild(h('span', null, e.label));
                pill.appendChild(h('span', 'pill-count', String(e.count)));
                pill.title = 'Show only selected sections (click again to clear)';
                const on = st.groups.has(e.id);
                pill.classList.toggle('is-active', on);
                pill.setAttribute('aria-pressed', String(on));
                pill.addEventListener('click', () => {
                    if (st.groups.has(e.id)) st.groups.delete(e.id);
                    else st.groups.add(e.id);
                    const now = st.groups.has(e.id);
                    pill.classList.toggle('is-active', now);
                    pill.setAttribute('aria-pressed', String(now));
                    apply();
                });
                pills.appendChild(pill);
            }
        }

        function apply() {
            const q = st.q.toLowerCase().trim();
            for (const g of groups()) {
                const id = cfg.groupId(g);
                const chipHidden = st.groups.size > 0 && !st.groups.has(id);
                let visible = 0;
                for (const row of g.querySelectorAll(cfg.rowSel)) {
                    const text = (cfg.rowText ? cfg.rowText(row) : row.textContent || '').toLowerCase();
                    let show = !q || text.includes(q);
                    if (show && st.prepared && cfg.prepared) {
                        const p = cfg.prepared(row);
                        if (p === false) show = false;
                    }
                    row.classList.toggle('list-filter-hidden', !show);
                    if (show) visible += 1;
                }
                const emptyHidden = st.empty && visible === 0;
                g.classList.toggle('list-filter-hidden', chipHidden || emptyHidden);
                // A search that matches inside a collapsed section opens it, or the hit is invisible.
                if (q && visible && g.tagName === 'DETAILS' && !g.open) g.open = true;
            }
        }

        search.addEventListener('input', () => { st.q = search.value; apply(); });

        // Re-apply whenever the tab's content changes under us (attack card repaints, a row
        // added, a section collapsing into "No buffs."). childList only: our own class toggles
        // must not wake the observer, and mutations inside the toolbar are ours too.
        let queued = false;
        const obs = new MutationObserver((muts) => {
            if (!bar.isConnected) { obs.disconnect(); return; }
            if (muts.every((m) => bar.contains(m.target))) return;
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                if (!bar.isConnected) return;
                syncPills();
                apply();
            });
        });
        // Defer until the caller has inserted the toolbar and the tab body is filled.
        requestAnimationFrame(() => {
            if (!bar.isConnected) return;
            syncPills();
            apply();
            obs.observe(rootEl(), { childList: true, subtree: true });
        });
        return bar;
    }

    /** Forget a tab's filter (tests, or a character switch). */
    const reset = (key) => (key ? STATE.delete(key) : STATE.clear());

    return { attach, reset };
})();
