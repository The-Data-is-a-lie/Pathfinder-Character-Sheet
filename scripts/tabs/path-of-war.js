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
    const { formatChangeLine, buildPowModifierPanel } = window.SheetModals;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);

    /**
     * Effective display record for a maneuver/stance (#109): payload maneuvers_desc_dict
     * merged under the feature-sheet override (details.pow for meta, description).
     */
    function powMeta(data, kind, name) {
        const raw = (data.maneuvers_desc_dict || {})[name];
        const d = raw && typeof raw === 'object' ? raw : (raw ? { description: raw } : {});
        const ov = window.SheetDetails?.getFeatureOverride?.(data, kind, name);
        return {
            ...d,
            ...(ov?.details?.pow || {}),
            description: ov?.description ?? d.description,
            edited: !!ov,
        };
    }
    function powLevelOf(data, name) {
        return Math.max(1, Number(powMeta(data, 'maneuver', name).level) || 1);
    }

    /** Maneuver/stance Details panel: meta fields into the override layer. */
    function buildPowDetailsPanel(data, kind, name) {
        const SD = window.SheetDetails;
        const panel = h('div', 'spell-details-panel');
        const meta = powMeta(data, kind, name);
        const row = (label, ctl) => {
            const r = h('label', 'item-sheet-stat');
            r.appendChild(h('span', 'item-sheet-stat-label', label));
            r.appendChild(ctl);
            return r;
        };
        const text = (value, placeholder) => {
            const inp = h('input', 'item-sheet-text');
            inp.type = 'text';
            inp.value = value != null ? String(value) : '';
            if (placeholder) inp.placeholder = placeholder;
            return inp;
        };
        const levelIn = text(meta.level, '1–9');
        levelIn.type = 'number';
        levelIn.min = '1';
        levelIn.max = '9';
        const discIn = text(meta.discipline, 'Primal Fury, …');
        const typeIn = text(meta.type, kind === 'stance' ? 'stance' : 'strike / boost / counter');
        const actionIn = text(meta.action, 'standard / swift / immediate');
        const rangeIn = text(meta.range, 'melee / 30 ft');
        const durIn = text(meta.duration, 'instant / 1 round');
        const commit = () => {
            const pow = {};
            const lv = parseInt(levelIn.value, 10);
            if (Number.isFinite(lv) && lv >= 1) pow.level = lv;
            if (discIn.value.trim()) pow.discipline = discIn.value.trim();
            if (typeIn.value.trim()) pow.type = typeIn.value.trim();
            if (actionIn.value.trim()) pow.action = actionIn.value.trim();
            if (rangeIn.value.trim()) pow.range = rangeIn.value.trim();
            if (durIn.value.trim()) pow.duration = durIn.value.trim();
            SD.setFeatureOverride(data, kind, name,
                { details: Object.keys(pow).length ? { pow } : null });
            // A level change re-buckets the readied lists (they're level-indexed).
            if (kind === 'maneuver') writeReadiedManeuvers(data, readiedManeuverSet(data));
            quietSave();
        };
        for (const ctl of [levelIn, discIn, typeIn, actionIn, rangeIn, durIn]) {
            ctl.addEventListener('change', commit);
        }
        panel.appendChild(h('h4', 'item-sheet-h', kind === 'stance' ? 'Stance' : 'Maneuver'));
        panel.appendChild(row('Level', levelIn));
        panel.appendChild(row('Discipline', discIn));
        panel.appendChild(row('Type', typeIn));
        panel.appendChild(row('Action', actionIn));
        panel.appendChild(row('Range', rangeIn));
        panel.appendChild(row('Duration', durIn));
        panel.appendChild(h('p', 'dim',
            'Edits store on this character; Revert (sidebar) restores the backend text.'));
        return panel;
    }

    function openPowSheet(data, kind, name) {
        const SD = window.SheetDetails;
        const raw = (data.maneuvers_desc_dict || {})[name];
        const fallbackDesc = typeof raw === 'string' ? raw : (raw?.description || '');
        window.SheetFeatureSheet.openFeatureSheet(data, {
            kind,
            name,
            sourceKind: kind,
            typeLabel: kind === 'stance' ? 'Stance' : 'Maneuver',
            canRegroup: false,
            showUses: false,
            fallbackDesc,
            extraEdited: () => (kind === 'stance'
                ? !!data._sheet?.stanceOverrides?.[SD.powNorm(name)]
                : !!data._sheet?.powOverrides?.[SD.powNorm(name)]),
            onRevert: () => {
                if (kind === 'stance') SD.clearStanceOverride(data, name);
                else SD.clearPowOverride(data, name);
            },
            panels: {
                details: buildPowDetailsPanel(data, kind, name),
                changes: buildPowModifierPanel(data, name,
                    kind === 'stance' ? { mode: 'changes' } : {}),
            },
        });
    }

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
        const byLevel = {};
        let maxLv = 0;
        for (const name of readiedSet) {
            const lv = powLevelOf(data, name); // override-aware (#109)
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

        // Blank creation (#109) — homebrew maneuvers/stances typed in from scratch.
        const addBar = h('div', 'section-catalog-bar no-print');
        const addManBtn = h('button', 'inv-btn catalog-blank-btn', '+ Blank maneuver');
        addManBtn.type = 'button';
        addManBtn.title = 'Create an empty maneuver and open its sheet';
        addManBtn.addEventListener('click', () => {
            const name = window.SheetFeatureSheet.blankName('New Maneuver', [
                ...known, ...(data.stances_chosen || []),
            ]);
            (data.maneuvers_desc_dict ??= {})[name] = { level: 1, type: 'strike' };
            if (!Array.isArray(data.maneuvers_choose_from)) data.maneuvers_choose_from = [];
            if (!Array.isArray(data.maneuvers_choose_from[0])) data.maneuvers_choose_from[0] = [];
            data.maneuvers_choose_from[0].push(name);
            quietSave();
            renderSheet(data);
            setActiveTab('path-of-war');
            openPowSheet(data, 'maneuver', name);
        });
        const addStanceBtn = h('button', 'inv-btn catalog-blank-btn', '+ Blank stance');
        addStanceBtn.type = 'button';
        addStanceBtn.title = 'Create an empty stance and open its sheet';
        addStanceBtn.addEventListener('click', () => {
            const name = window.SheetFeatureSheet.blankName('New Stance', [
                ...known, ...(data.stances_chosen || []),
            ]);
            (data.maneuvers_desc_dict ??= {})[name] = { type: 'stance' };
            (data.stances_chosen ??= []).push(name);
            quietSave();
            renderSheet(data);
            setActiveTab('path-of-war');
            openPowSheet(data, 'stance', name);
        });
        addBar.append(addManBtn, addStanceBtn);
        body.appendChild(addBar);

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
                const d = powMeta(data, 'maneuver', name);
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
                if (d.edited) {
                    const chip = h('span', 'feat-edited-chip', '✎');
                    chip.title = 'Edited on this character';
                    row.appendChild(chip);
                }
                const mEdit = h('button', 'inv-btn pow-mod-edit-btn no-print', 'Edit');
                mEdit.type = 'button';
                mEdit.title = 'Open this maneuver’s sheet — description, level, modifiers';
                mEdit.addEventListener('click', () => openPowSheet(data, 'maneuver', name));
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
                const d = powMeta(data, 'stance', s);
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
                sEdit.title = 'Open this stance’s sheet — description, benefits';
                sEdit.addEventListener('click', () => openPowSheet(data, 'stance', s));
                row.appendChild(sEdit);

                list.appendChild(row);
            }
            body.appendChild(list);
        }
        return sec;
    }

    return { renderPathOfWar };
})();
