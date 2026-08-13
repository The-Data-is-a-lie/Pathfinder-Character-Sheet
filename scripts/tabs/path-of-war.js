// scripts/tabs/path-of-war.js -- the Path of War tab (window.SheetTabPathOfWar). Extracted from
// sheet.js (Part B split); bodies moved verbatim. renderSheet / setActiveTab late-bind via SheetApp.
window.SheetTabPathOfWar = (function () {
    'use strict';
    const {
        h, section, details, kv, kvEdit, fmt, nonEmpty, escapeHtml,
        bindDragReorder, reorderArray, dndHandle,
    } = window.SheetUI;
    const { abModOf } = window.SheetDerive;
    const {
        sheetState, quietSave, ensureInitiationStat, activeStanceSet, setStanceActive,
    } = window.SheetState;
    const { formatChangeLine, openPowModifierEditor } = window.SheetModals;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);

    function knownManeuverNames(data) {
        const stanceSet = new Set(data.stances_chosen || []);
        const descs = data.maneuvers_desc_dict || {};
        const fromChoose = (data.maneuvers_choose_from || []).flat().filter(Boolean);
        const fromReadied = (data.maneuvers_readied_names || []).flat().filter(Boolean);
        let known = [...new Set([...fromChoose, ...fromReadied])];
        if (!known.length && descs) {
            known = Object.keys(descs).filter((name) => {
                if (stanceSet.has(name)) return false;
                return String(descs[name]?.type || '').toLowerCase() !== 'stance';
            });
        }
        // Never list stances in the ready-able maneuver list
        return known.filter((n) => !stanceSet.has(n)
            && String(descs[n]?.type || '').toLowerCase() !== 'stance');
    }
    function readiedManeuverSet(data) {
        return new Set((data.maneuvers_readied_names || []).flat().filter(Boolean));
    }
    /** Rebuild level-bucketed maneuvers_readied_names from a Set of readied names. */
    function writeReadiedManeuvers(data, readiedSet) {
        const descs = data.maneuvers_desc_dict || {};
        const byLevel = {};
        let maxLv = 0;
        for (const name of readiedSet) {
            const lv = Math.max(1, Number(descs[name]?.level) || 1);
            maxLv = Math.max(maxLv, lv);
            (byLevel[lv] ??= []).push(name);
        }
        // Preserve prior array length if larger (empty buckets)
        const prevLen = Array.isArray(data.maneuvers_readied_names)
            ? data.maneuvers_readied_names.length : 0;
        const len = Math.max(maxLv, prevLen, 1);
        const buckets = [];
        for (let i = 1; i <= len; i++) buckets.push(byLevel[i] || []);
        data.maneuvers_readied_names = buckets;
    }
    function maneuverDetailHtml(d) {
        if (!d) return '';
        if (typeof d === 'string') return d;
        const meta = ['action', 'range', 'duration']
            .filter((k) => d[k])
            .map((k) => `<p><em>${k[0].toUpperCase() + k.slice(1)}:</em> ${escapeHtml(String(d[k]))}</p>`)
            .join('');
        const desc = d.description ? `<div>${d.description}</div>` : '';
        return meta + desc;
    }
    function renderPathOfWar(data) {
        const known = knownManeuverNames(data);
        const hasPoW = Number(data.initiator_level) > 0
            || nonEmpty(data.martial_disciplines)
            || known.length
            || nonEmpty(data.stances_chosen)
            || nonEmpty(data.maneuvers_desc_dict);
        if (!hasPoW) return null;

        const { sec, body } = section('Path of War');
        ensureInitiationStat(data);
        kvEdit(body, 'Initiator Level', data, 'initiator_level', { type: 'number', min: 0, max: 30 });
        // Practitioner ability (Foundry/PoW initiation stat) — not a global "main stat"
        const pracKey = ensureInitiationStat(data);
        const pracRow = h('div', 'kv kv-stat');
        pracRow.appendChild(h('span', 'k', 'Practitioner ability'));
        const pracV = h('span', 'v');
        const pracSel = h('select', 'edit-field');
        for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
            const opt = document.createElement('option');
            opt.value = a;
            opt.textContent = a.toUpperCase();
            if (a === pracKey) opt.selected = true;
            pracSel.appendChild(opt);
        }
        pracSel.addEventListener('change', () => {
            data.initiation_stat = pracSel.value;
            quietSave();
            renderSheet(data);
            setActiveTab('path-of-war');
        });
        pracV.appendChild(pracSel);
        pracV.appendChild(h('span', 'dim',
            `  mod ${fmt(abModOf(data, pracKey))} (used for @INITMOD / maneuver riders)`));
        pracRow.appendChild(pracV);
        body.appendChild(pracRow);
        if (nonEmpty(data.martial_disciplines)) {
            kvEdit(body, 'Disciplines', data, 'martial_disciplines', { asArray: true });
        }
        // Generator per-maneuver-level budgets (#68): index 0 = maneuver level 1. Display
        // only — the Ready checkboxes below stay the source of truth for what's readied.
        if (nonEmpty(data.maneuvers_known_list)) {
            const fmtCounts = (arr) => (arr || [])
                .map((n, i) => `L${i + 1}: ${Number(n) || 0}`).join(' · ');
            const row = h('div', 'kv');
            row.appendChild(h('span', 'k', 'Per level'));
            const v = h('span', 'v', 'Known — ' + fmtCounts(data.maneuvers_known_list)
                + (nonEmpty(data.maneuvers_readied_list)
                    ? '  ·  Readied — ' + fmtCounts(data.maneuvers_readied_list) : ''));
            row.appendChild(v);
            body.appendChild(row);
        }

        const descs = data.maneuvers_desc_dict || {};
        const readied = readiedManeuverSet(data);
        const readiedCountEl = h('span', 'pow-ready-count', '');
        const updateReadyCount = () => {
            const r = readiedManeuverSet(data).size;
            readiedCountEl.textContent = `${known.length} known · ${r} readied`;
        };
        updateReadyCount();
        kv(body, 'Maneuvers', readiedCountEl);

        if (known.length) {
            body.appendChild(h('h3', null, 'Maneuvers (check = readied · drag to reorder)'));
            const list = h('div', 'pow-maneuver-list dnd-list');
            const st = sheetState(data);
            // Prefer saved order; fall back to level/name
            let sorted;
            if (Array.isArray(st.maneuverOrder) && st.maneuverOrder.length) {
                const set = new Set(known);
                sorted = st.maneuverOrder.filter((n) => set.has(n));
                for (const n of known) if (!sorted.includes(n)) sorted.push(n);
            } else {
                sorted = [...known].sort((a, b) => {
                    const la = Number(descs[a]?.level) || 99;
                    const lb = Number(descs[b]?.level) || 99;
                    return la - lb || String(a).localeCompare(String(b));
                });
            }
            for (const name of sorted) {
                const d = descs[name] || {};
                const row = h('div', 'pow-maneuver-row dnd-item');
                row.dataset.dndId = name;
                row.appendChild(dndHandle());
                const lab = h('label', 'pow-ready-label');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'pow-ready-check';
                cb.checked = readied.has(name);
                cb.title = 'Readied';
                cb.addEventListener('change', () => {
                    const set = readiedManeuverSet(data);
                    if (cb.checked) set.add(name);
                    else set.delete(name);
                    writeReadiedManeuvers(data, set);
                    updateReadyCount();
                    quietSave();
                });
                lab.appendChild(cb);
                lab.appendChild(h('span', 'pow-ready-tag', 'Ready'));
                row.appendChild(lab);

                const lv = d.level != null ? `L${d.level}` : '';
                const bits = [lv, d.discipline, d.type, name].filter(Boolean);
                const bodyHtml = maneuverDetailHtml(d);
                if (bodyHtml) {
                    const det = details(bits.join(' · '), bodyHtml, 'pow-maneuver-details');
                    row.appendChild(det);
                } else {
                    row.appendChild(h('span', 'pow-maneuver-name', bits.join(' · ')));
                }
                const mEdit = h('button', 'inv-btn pow-mod-edit-btn no-print', 'Edit');
                mEdit.type = 'button';
                mEdit.title = 'Adjust this maneuver’s attack/damage modifiers (also updates the roll conditionals)';
                mEdit.addEventListener('click', () => openPowModifierEditor(data, name, row));
                row.appendChild(mEdit);
                list.appendChild(row);
            }
            body.appendChild(list);
            bindDragReorder(list, '.pow-maneuver-row', (from, to) => {
                const order = [...sorted];
                reorderArray(order, from, to);
                sheetState(data).maneuverOrder = order;
                quietSave();
                renderSheet(data);
                setActiveTab('path-of-war');
            });
        }

        if (nonEmpty(data.stances_chosen)) {
            body.appendChild(h('h3', null, 'Stances (check = active · boosts apply to the sheet)'));
            const SD = window.SheetDetails;
            const active = activeStanceSet(data);
            const list = h('div', 'pow-stance-list');
            for (const s of data.stances_chosen) {
                const d = descs[s] || {};
                const summary = [d.discipline, d.type || 'stance', s].filter(Boolean).join(' · ');
                const bodyHtml = maneuverDetailHtml(d);
                const row = h('div', 'pow-stance-row' + (active.has(s) ? ' is-active' : ''));

                const lab = h('label', 'pow-stance-toggle');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'pow-stance-check';
                cb.checked = active.has(s);
                cb.title = 'Active — boosts apply to the sheet';
                cb.addEventListener('change', () => {
                    setStanceActive(data, s, cb.checked);
                    quietSave();
                    renderSheet(data);
                    setActiveTab('path-of-war');
                });
                lab.appendChild(cb);
                lab.appendChild(h('span', 'pow-stance-tag', 'On'));
                row.appendChild(lab);

                const main = h('div', 'pow-stance-main');
                main.appendChild(bodyHtml ? details(summary, bodyHtml) : h('span', null, summary));
                // Effect preview: the always-on benefits this stance applies while active.
                const benefit = SD?.resolveStanceEntry?.(data, s) || { changes: [] };
                if (benefit.changes.length) {
                    main.appendChild(h('div', 'buff-source-effects',
                        benefit.changes.map((c) => formatChangeLine(c, SD)).join('; ')));
                } else {
                    main.appendChild(h('div', 'dim pow-stance-nomods',
                        'No mechanical benefits on file — add one with Edit.'));
                }
                row.appendChild(main);

                const sEdit = h('button', 'inv-btn pow-mod-edit-btn no-print', 'Edit');
                sEdit.type = 'button';
                sEdit.title = 'Adjust this stance’s benefits';
                sEdit.addEventListener('click', () => openPowModifierEditor(data, s, row, { mode: 'changes' }));
                row.appendChild(sEdit);

                list.appendChild(row);
            }
            body.appendChild(list);
        }
        return sec;
    }

    return { renderPathOfWar };
})();
