// scripts/chardiff.js -- #86: side-by-side character comparison (window.SheetCharDiff).
// Two pickers over the library (plus the current character's #80 snapshots when the
// snapshot store exists — feature-detected, so this file works before and after #80
// lands), a key-stat table with the delta column highlighted where the two differ.
// Deliberately read-only: comparing must never mutate either character.
window.SheetCharDiff = (function () {
    'use strict';
    const h = (...a) => window.SheetUI.h(...a);
    const fmtMod = (n) => (Number(n) >= 0 ? '+' : '') + (Number(n) || 0);

    /** computeDerived publishes to window.sheetChanges* as a side effect; comparing a
     *  NON-current character must not leave those globals pointing at it. */
    function derivedOf(data) {
        const keepFull = window.sheetChangesFull;
        const keep = window.sheetChanges;
        try {
            return window.SheetDerive.computeDerived(data);
        } finally {
            window.sheetChangesFull = keepFull;
            window.sheetChanges = keep;
        }
    }

    function statRows(data) {
        const D = window.SheetDerive;
        const d = derivedOf(data);
        const b = d.blocks;
        const classes = (window.SheetState?.ensureClassList?.(data) || [])
            .map((c) => (typeof c === 'string' ? c : `${c?.display || c?.name || ''} ${c?.level || ''}`))
            .join('/') || String(data.c_class || '');
        const rows = {
            Level: Number(data.level) || 0,
            Class: classes,
            HP: b.hp?.total ?? (Number(data.Total_HP) || 0),
            AC: d.ac, Touch: d.touch, 'Flat-footed': d.flat,
            Fort: fmtMod(b.fort?.total), Ref: fmtMod(b.ref?.total), Will: fmtMod(b.will?.total),
            Init: fmtMod(b.init?.total),
            CMB: fmtMod(d.cmb), CMD: d.cmd,
        };
        for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
            rows[ab.toUpperCase()] = D.abilityInfo(data, ab).total;
        }
        rows.Gold = Number(data.gold) || 0;
        rows.Items = (data.equipment_list || []).length;
        return rows;
    }

    /** Numeric-aware delta: "+2" for numbers (and "+X"-style strings), "≠" otherwise. */
    function deltaText(a, bV) {
        const na = Number(String(a).replace('+', ''));
        const nb = Number(String(bV).replace('+', ''));
        if (Number.isFinite(na) && Number.isFinite(nb)) {
            const d = nb - na;
            return d === 0 ? '' : (d > 0 ? '+' + d : String(d));
        }
        return String(a) === String(bV) ? '' : '≠';
    }

    async function sources() {
        const lib = window.SheetLibrary;
        const out = [];
        for (const rec of await lib.list().catch(() => [])) {
            out.push({
                key: 'char:' + rec.id,
                label: `${rec.name} — ${rec.klass || '?'} ${rec.level}`,
                load: async () => (await lib.get(rec.id))?.data,
            });
        }
        // #80 snapshots of the CURRENT character, when the store exists.
        const cur = window.SheetApp?.current;
        if (lib.listSnapshots && cur?._sheet?.id) {
            for (const s of await lib.listSnapshots(cur._sheet.id).catch(() => [])) {
                out.push({
                    key: 'snap:' + s.key,
                    label: `Snapshot ${new Date(s.ts).toLocaleString()}`
                        + (s.reason ? ` (${s.reason})` : ''),
                    load: async () => (await lib.getSnapshot(s.key))?.data,
                });
            }
        }
        return out;
    }

    async function open() {
        const opts = await sources();
        if (opts.length < 2) {
            window.SheetOverlay?.toast?.('Need at least two saved characters to compare');
            return;
        }
        const body = h('div', 'chardiff');
        const mkSel = (label) => {
            const wrap = h('label', 'chardiff-pick');
            wrap.appendChild(h('span', 'k', label));
            const sel = h('select', 'edit-field');
            for (const o of opts) {
                const opt = document.createElement('option');
                opt.value = o.key;
                opt.textContent = o.label;
                sel.appendChild(opt);
            }
            wrap.appendChild(sel);
            return { wrap, sel };
        };
        const A = mkSel('A');
        const B = mkSel('B');
        // Default: A = the current character (if saved), B = the next different source.
        const curKey = 'char:' + (window.SheetApp?.current?._sheet?.id || '');
        if (opts.some((o) => o.key === curKey)) A.sel.value = curKey;
        B.sel.value = (opts.find((o) => o.key !== A.sel.value) || opts[0]).key;
        const picks = h('div', 'chardiff-picks');
        picks.append(A.wrap, B.wrap);
        body.appendChild(picks);
        const host = h('div', 'chardiff-table');
        body.appendChild(host);

        const repaint = async () => {
            host.innerHTML = '';
            const [da, db] = await Promise.all([
                opts.find((o) => o.key === A.sel.value)?.load(),
                opts.find((o) => o.key === B.sel.value)?.load(),
            ]);
            if (!da || !db) {
                host.appendChild(h('p', 'dim', 'Could not load one of the characters.'));
                return;
            }
            const ra = statRows(da);
            const rb = statRows(db);
            const table = h('table', 'chardiff-grid');
            const head = h('tr');
            head.append(h('th', null, ''), h('th', null, da.character_full_name || 'A'),
                h('th', null, db.character_full_name || 'B'), h('th', null, 'Δ'));
            table.appendChild(head);
            for (const key of Object.keys(ra)) {
                const tr = h('tr');
                const delta = deltaText(ra[key], rb[key]);
                if (delta) tr.className = 'chardiff-differs';
                tr.append(h('td', 'chardiff-stat', key),
                    h('td', null, String(ra[key])),
                    h('td', null, String(rb[key])),
                    h('td', 'chardiff-delta', delta));
                table.appendChild(tr);
            }
            host.appendChild(table);
        };
        A.sel.addEventListener('change', repaint);
        B.sel.addEventListener('change', repaint);
        await repaint();
        window.SheetOverlay.open({ title: 'Compare characters', body });
    }

    return { open };
})();
