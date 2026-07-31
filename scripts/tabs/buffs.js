// scripts/tabs/buffs.js -- the Buffs tab: conditions tray, buff sections, passive source toggles,
// feature-uses controls (window.SheetTabBuffs). Extracted from sheet.js (Part B split); bodies
// verbatim except PF1_CONDITIONS (shared with Defenses, from SheetData). renderUsesControls is
// consumed by the Features tab via SheetApp -- the shell destructure re-points its delegate here.
window.SheetTabBuffs = (function () {
    'use strict';
    const { h, section, details, fmt, mod, parseIntLoose, dblclickEditable, cloneChanges } = window.SheetUI;
    const { effectiveLedger, groupChangesBySource } = window.SheetDerive;
    const {
        quietSave, createBuff, sheetState, activeConditions, setConditionActive, notesForTargets,
        ensureBuffs, isBuffSourceRemoved, isBuffSourceActive, setBuffSourceActive, removeBuffSource,
        BUFF_SUBTYPES, addBuffFromCatalog, formatBuffDuration, restoreRemovedBuffSources,
    } = window.SheetState;
    const { formatChangeLine, openCatalogPicker, openBuffEditor } = window.SheetModals;
    const { PF1_CONDITIONS } = window.SheetData;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);

    // Shape owner moved to SheetState.featureUses (the marquee spend/tick paths share it).
    const featureUsesEntry = (data, name) => window.SheetState.featureUses(data, name);
    function renderUsesControls(data, name) {
        const u = featureUsesEntry(data, name);
        const wrap = h('span', 'uses-controls no-print');
        const label = h('span', 'uses-label', `${u.value || 0}/${u.max || 0}`);
        const bag = { max: u.max || 0 };
        const maxEdit = dblclickEditable(bag, 'max', {
            type: 'number', min: 0, max: 99,
            format: (v) => 'max ' + (v || 0),
            parse: (s) => parseIntLoose(s, 0),
            onChange: (v) => {
                const n = Number(v) || 0;
                u.max = n;
                if (u.value > n) u.value = n;
                if (n > 0 && !u.value) u.value = n;
                quietSave();
                label.textContent = `${u.value || 0}/${u.max || 0}`;
            },
        });
        const dec = h('button', 'inv-btn uses-dec', '−');
        dec.type = 'button';
        dec.title = 'Spend one use';
        dec.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if ((u.value || 0) <= 0) return;
            u.value -= 1;
            quietSave();
            label.textContent = `${u.value || 0}/${u.max || 0}`;
        });
        wrap.append(label, dec, maxEdit);
        return wrap;
    }
    /** Round tracker: the shared round strip (Round N · Next round · Reset · swift/AoO
     *  chips, SheetRoll.renderRoundStrip) — the Tools drawer mounts the same strip, and
     *  both surfaces repaint from one state. */
    function renderRoundCounter(body, data) {
        body.appendChild(window.SheetRoll.renderRoundStrip({ withReset: true }));
    }
    function renderConditionsTray(body, data) {
        body.appendChild(h('h3', null, 'Conditions'));
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Click to toggle — penalties apply to the sheet automatically. Double-click an active chip '
            + 'for a duration ("5 rounds" ticks down with Next round; free text stays put).'));
        renderRoundCounter(body, data);
        const grid = h('div', 'conditions-grid no-print');
        const active = activeConditions(data);
        const st = sheetState(data);
        st.conditionDurations ??= {};
        for (const c of PF1_CONDITIONS) {
            const on = active.has(c.id);
            const dur = st.conditionDurations[c.id];
            const btn = h('button', 'condition-chip' + (on ? ' is-active' : ''),
                c.label + (on && dur ? ` (${dur})` : ''));
            btn.type = 'button';
            btn.title = c.note + (on ? ' — click clear · dbl-click duration' : ' — click to activate');
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.addEventListener('click', () => {
                setConditionActive(data, c.id, !on);
                if (on) delete st.conditionDurations[c.id];
                renderSheet(data);
                setActiveTab('buffs');
            });
            btn.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!activeConditions(data).has(c.id)) setConditionActive(data, c.id, true);
                const next = prompt('Duration note (e.g. 5 rounds):',
                    st.conditionDurations[c.id] || '');
                if (next == null) return;
                if (String(next).trim()) st.conditionDurations[c.id] = String(next).trim();
                else delete st.conditionDurations[c.id];
                quietSave();
                renderSheet(data);
                setActiveTab('buffs');
            });
            grid.appendChild(btn);
        }
        body.appendChild(grid);
        const activeList = PF1_CONDITIONS.filter((c) => active.has(c.id));
        if (activeList.length) {
            body.appendChild(h('p', 'conditions-active-summary',
                'Active: ' + activeList.map((c) => {
                    const d = st.conditionDurations[c.id];
                    return c.label + (d ? ` (${d})` : '');
                }).join(', ')));
        }
    }
    const PASSIVE_KIND_TAGS = {
        feat: 'Feat', trait: 'Trait', classFeat: 'Class', item: 'Item', talent: 'Talent',
    };
    /**
     * Always-on source (feat/trait/item/class feature) as a row in the Permanent buff
     * section: Active checkbox toggles it in sheet math, × deletes it (restorable).
     */
    function renderPassiveSourceRow(data, g) {
        const SD = window.SheetDetails;
        const active = isBuffSourceActive(data, g.source, g.sourceKind);
        const row = h('div', 'buffs-row buffs-row-derived' + (active ? '' : ' buff-off'));
        const nameCell = h('div', 'buffs-col-name');
        const nameLine = h('span', 'buff-source-name', g.source || '?');
        nameCell.appendChild(nameLine);
        nameCell.appendChild(h('span', 'feat-tag buff-kind-tag',
            PASSIVE_KIND_TAGS[g.sourceKind] || 'Other'));
        const bits = g.lines.map((c) => formatChangeLine(c, SD)).join('; ');
        if (bits) nameCell.appendChild(h('div', 'buff-source-effects', bits));
        // Situational notes from this source surface on hover (they also hover on the
        // relevant skill / attack rows via notesForTargets).
        const srcNotes = [...new Set((window.sheetChangesFull?.notes || [])
            .filter((n) => n.source === g.source && n.sourceKind === g.sourceKind)
            .map((n) => String(n.text || '').replace(/<[^>]*>/g, '').trim())
            .filter(Boolean))];
        if (srcNotes.length) row.title = 'Situational: ' + srcNotes.join('; ');
        row.appendChild(nameCell);

        row.appendChild(h('span', 'buffs-col-dur', 'Permanent'));
        row.appendChild(h('span', 'buffs-col-lv', '—'));

        const activeCell = h('label', 'buffs-col-active');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = active;
        cb.title = active ? 'Active — applied to sheet math' : 'Inactive';
        cb.addEventListener('change', () => {
            setBuffSourceActive(data, g.source, g.sourceKind, cb.checked);
            setActiveTab('buffs');
        });
        activeCell.appendChild(cb);
        row.appendChild(activeCell);

        const ctrl = h('div', 'buffs-col-ctrl no-print');
        const rm = h('button', 'inv-btn inv-btn-danger', '×');
        rm.type = 'button';
        rm.title = 'Delete this source from the sheet math and list';
        rm.addEventListener('click', () => {
            if (!confirm(`Delete “${g.source}”? Its modifiers stop applying (restorable via the button below).`)) return;
            removeBuffSource(data, g.source, g.sourceKind);
            setActiveTab('buffs');
        });
        ctrl.appendChild(rm);
        row.appendChild(ctrl);
        return row;
    }
    function renderBuffSections(body, data, passive = { groups: [], removed: [] }) {
        const buffs = ensureBuffs(data);
        const SD = window.SheetDetails;

        body.appendChild(h('h3', null, 'Buffs'));
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Grouped by category. Active checkbox applies changes. Duration & level are session bookkeeping.'));

        // Column legend
        const legend = h('div', 'buffs-col-legend no-print');
        legend.innerHTML = '<span class="buffs-col-name">Name</span>'
            + '<span class="buffs-col-dur">Duration</span>'
            + '<span class="buffs-col-lv">Level</span>'
            + '<span class="buffs-col-active">Active</span>'
            + '<span class="buffs-col-ctrl"></span>';
        body.appendChild(legend);

        for (const sec of BUFF_SUBTYPES) {
            const sectionEl = h('div', 'buffs-section');
            sectionEl.dataset.buffSubtype = sec.id;
            const head = h('div', 'buffs-section-head');
            head.appendChild(h('h4', 'buffs-section-title', sec.label));
            const headCtrl = h('div', 'buffs-section-controls no-print');
            const addBtn = h('button', 'inv-btn inv-btn-primary', '+');
            addBtn.type = 'button';
            addBtn.title = 'Create ' + sec.label.toLowerCase() + ' buff';
            addBtn.addEventListener('click', () => {
                createBuff(data, { name: 'New ' + sec.label.toLowerCase() + ' buff', subType: sec.id });
                renderSheet(data);
                setActiveTab('buffs');
            });
            const browseBtn = h('button', 'inv-btn', 'Browse');
            browseBtn.type = 'button';
            browseBtn.title = 'Add from catalog into ' + sec.label;
            browseBtn.addEventListener('click', () => {
                openCatalogPicker({
                    title: 'Add ' + sec.label.toLowerCase() + ' buff',
                    kinds: ['feats', 'items'],
                    allowCustom: true,
                    customPlaceholder: 'Custom buff name',
                    onPick: (hit) => {
                        addBuffFromCatalog(data, hit.name, hit.entry, sec.id);
                        renderSheet(data);
                        setActiveTab('buffs');
                    },
                    onCustom: (name) => {
                        createBuff(data, { name, subType: sec.id });
                        renderSheet(data);
                        setActiveTab('buffs');
                    },
                });
            });
            headCtrl.append(addBtn, browseBtn);
            head.appendChild(headCtrl);
            sectionEl.appendChild(head);

            const items = buffs.filter((b) => b.subType === sec.id);
            // Always-on sources (feats/traits/items/class features) live in Permanent
            const derived = sec.id === 'perm' ? (passive.groups || []) : [];
            const list = h('div', 'buffs-list');
            if (!items.length && !derived.length) {
                list.appendChild(h('p', 'tools-empty buffs-empty', 'No ' + sec.label.toLowerCase() + ' buffs.'));
            } else {
                for (const buff of items) {
                    const row = h('div', 'buffs-row' + (buff.active === false ? ' buff-off' : ''));
                    const nameCell = h('div', 'buffs-col-name');
                    nameCell.appendChild(h('span', 'buff-source-name', buff.name));
                    const bits = (buff.changes || []).map((c) => formatChangeLine(c, SD)).join('; ');
                    if (bits) {
                        nameCell.appendChild(h('div', 'buff-source-effects', bits));
                    }
                    if (buff.notes) {
                        nameCell.appendChild(h('div', 'dim buff-notes-preview', buff.notes));
                    }
                    row.appendChild(nameCell);

                    row.appendChild(h('span', 'buffs-col-dur', formatBuffDuration(buff)));

                    const lvCell = h('span', 'buffs-col-lv');
                    lvCell.appendChild(dblclickEditable(buff, 'level', {
                        type: 'number', min: 0, max: 40,
                        format: (v) => (v == null || v === '' || Number(v) === 0 ? '—' : String(v)),
                        parse: (s) => parseIntLoose(s, 0),
                        onChange: () => quietSave(),
                    }));
                    row.appendChild(lvCell);

                    const activeCell = h('label', 'buffs-col-active');
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = buff.active !== false;
                    cb.title = buff.active !== false ? 'Active — applied to sheet math' : 'Inactive';
                    cb.addEventListener('change', () => {
                        buff.active = cb.checked;
                        quietSave();
                        renderSheet(data);
                        setActiveTab('buffs');
                    });
                    activeCell.appendChild(cb);
                    row.appendChild(activeCell);

                    const ctrl = h('div', 'buffs-col-ctrl no-print');
                    const editBtn = h('button', 'inv-btn', 'Edit');
                    editBtn.type = 'button';
                    editBtn.addEventListener('click', () => openBuffEditor(data, buff, row));
                    const dupBtn = h('button', 'inv-btn', '⧉');
                    dupBtn.type = 'button';
                    dupBtn.title = 'Duplicate buff';
                    dupBtn.addEventListener('click', () => {
                        createBuff(data, {
                            name: (buff.name || 'Buff') + ' (copy)',
                            subType: buff.subType,
                            active: false,
                            level: buff.level,
                            duration: { ...buff.duration },
                            changes: cloneChanges(buff.changes),
                            notes: buff.notes,
                            seedDefault: false,
                        });
                        renderSheet(data);
                        setActiveTab('buffs');
                    });
                    const rm = h('button', 'inv-btn inv-btn-danger', '×');
                    rm.type = 'button';
                    rm.title = 'Delete buff';
                    rm.addEventListener('click', () => {
                        if (!confirm(`Delete buff “${buff.name}”?`)) return;
                        const arr = ensureBuffs(data);
                        let i = arr.indexOf(buff);
                        if (i < 0) i = arr.findIndex((x) => x?.id === buff.id);
                        if (i >= 0) arr.splice(i, 1);
                        quietSave();
                        renderSheet(data);
                        setActiveTab('buffs');
                    });
                    ctrl.append(editBtn, dupBtn, rm);
                    row.appendChild(ctrl);
                    list.appendChild(row);
                }
            }
            for (const g of derived) list.appendChild(renderPassiveSourceRow(data, g));
            sectionEl.appendChild(list);
            if (sec.id === 'perm' && (passive.removed || []).length) {
                const restore = h('button', 'inv-btn no-print',
                    'Restore removed sources (' + passive.removed.length + ')');
                restore.type = 'button';
                restore.title = 'Bring back: ' + passive.removed.map((g) => g.source).join(', ');
                restore.addEventListener('click', () => {
                    restoreRemovedBuffSources(data);
                    setActiveTab('buffs');
                });
                sectionEl.appendChild(restore);
            }
            body.appendChild(sectionEl);
        }
    }
    // Foundry-like Buffs tab: Conditions → Buff sections (Permanent holds always-on sources)
    function renderModifiers(data) {
        const SD = window.SheetDetails;
        const { sec, body } = section('Buffs & Conditions', 'modifiers buffs-tab');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Conditions strip, then buffs by category (toggle Active). Always-on modifiers from feats, traits, items, and class features live under Permanent.'));

        // 1) Conditions (Foundry buffs-conditions)
        renderConditionsTray(body, data);

        // Ledger first: the Permanent section lists always-on sources as rows.
        let passive = { groups: [], removed: [] };
        let ledger = null;
        if (SD) {
            ledger = SD.collectChanges(data);
            window.sheetChangesFull = ledger;
            window.sheetChanges = effectiveLedger(data);
            // Conditions have their own tray above — a second toggle row here would fight it.
            const passiveChanges = (ledger.changes || [])
                .filter((c) => c.sourceKind !== 'buff' && c.sourceKind !== 'condition'
                    && c.sourceKind !== 'combat' && c.sourceKind !== 'marquee');
            const allGroups = groupChangesBySource(passiveChanges);
            passive = {
                groups: allGroups.filter((g) => !isBuffSourceRemoved(data, g.source, g.sourceKind)),
                removed: allGroups.filter((g) => isBuffSourceRemoved(data, g.source, g.sourceKind)),
            };
        }

        // 2) Foundry-style buff item sections
        renderBuffSections(body, data, passive);

        if (!SD) {
            body.appendChild(h('p', 'tools-empty', 'Item details not loaded yet — permanent sources unavailable.'));
            return sec;
        }

        // Print: active modifiers by target
        const activeChanges = effectiveLedger(data).changes;
        if (activeChanges.length) {
            body.appendChild(h('h3', 'print-only', 'Active modifiers (print)'));
            const byTarget = {};
            for (const c of activeChanges) (byTarget[SD.targetLabel(c.target)] ??= []).push(c);
            for (const [label, clist] of Object.entries(byTarget).sort((a, b) => a[0].localeCompare(b[0]))) {
                const line = h('div', 'mod-line print-only');
                line.appendChild(h('span', 'mod-target', label + ': '));
                line.appendChild(h('span', null, clist.map((c) => {
                    const t = SD.typeLabel(c.type);
                    const num = /^-?\d+$/.test(String(c.formula).trim())
                        ? fmt(Number(c.formula)) : String(c.formula);
                    return `${num}${t ? ' ' + t : ''} (${c.source})`;
                }).join(', ')));
                body.appendChild(line);
            }
        }

        // Situational notes render as ⓘ hover tooltips on the relevant skill / attack
        // rows (notesForTargets) — no panel here.

        // Per-roll conditionals — pointer only
        if (ledger.conditionals.length) {
            body.appendChild(h('p', 'dim buffs-cond-pointer',
                ledger.conditionals.length + ' per-roll conditionals — toggle them on the Combat / Tools attack panel, not here.'));
        }
        return sec;
    }

    return { renderModifiers, renderUsesControls };
})();
