// scripts/tabs/defenses.js -- the Defenses tab: AC composition, save buckets, armor/shield rows,
// DR / resistances / immunities chip editors, SR (window.SheetTabDefenses). Extracted from
// sheet.js (Part B split); bodies verbatim. PF1_CONDITIONS (shared with Buffs) is from SheetData;
// rollBtn/rollAllBar/renderSheet/setActiveTab and the inventory helpers late-bind via SheetApp.
window.SheetTabDefenses = (function () {
    'use strict';
    const { h, section, fmt, titleCase, parseIntLoose, dblclickEditable } = window.SheetUI;
    const { acTypeTotals, saveBuckets, srTotal, computeDerived } = window.SheetDerive;
    const { quietSave, sheetState, ensureDefenses, ensureInventoryObjects } = window.SheetState;
    const { PF1_CONDITIONS } = window.SheetData;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);
    const { rollBtn, rollAllBar } = window.SheetStatKit;
    const { migrateCoreGear, inventoryCategory } = window.SheetInventoryModel;
    const renderInventoryItemCard = (...a) => window.SheetApp.renderInventoryItemCard(...a);

    // ---------------------------------------------------------------- defenses block
    const DR_BYPASS_TYPES = ['—', 'adamantine', 'bludgeoning', 'chaotic', 'cold iron',
        'epic', 'evil', 'good', 'lawful', 'magic', 'piercing', 'silver', 'slashing'];
    const ENERGY_TYPES = ['acid', 'cold', 'electricity', 'fire', 'sonic', 'force',
        'negative energy', 'positive energy'];
    const DAMAGE_TYPES = [...ENERGY_TYPES, 'bludgeoning', 'piercing', 'slashing'];
    function renderDefenses(body, data, d) {
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'AC bonuses by type (hover a box for sources), save buckets, and editable DR / resistances / SR. + adds an entry; × removes it.'));
        const st = sheetState(data);
        const defs = ensureDefenses(data);
        const rerender = () => {
            quietSave();
            renderSheet(data);
            setActiveTab('defenses');
        };

        // --- AC composition by bonus type
        const grid = h('div', 'defense-grid');
        for (const b of acTypeTotals(d.blocks.ac.parts)) {
            const box = h('div', 'feat-count-box def-box');
            box.appendChild(h('span', 'feat-count-label', b.label));
            box.appendChild(h('span', 'feat-count-value', b.total ? fmt(b.total) : '—'));
            if (b.sources.length) box.title = b.sources.join('\n');
            grid.appendChild(box);
        }
        body.appendChild(grid);

        // --- Saves breakdown (rollable — every ledger boost is already in block.total)
        const table = h('table', 'skills-table saves-breakdown');
        const hd = h('tr');
        ['', 'Save', 'Base', 'Abl', 'Enhance', 'Resist', 'Feat', 'Trait', 'Misc', 'Temp', 'Total']
            .forEach((t) => hd.appendChild(h('th', null, t)));
        table.appendChild(hd);
        for (const [label, block] of [
            ['Fortitude', d.blocks.fort], ['Reflex', d.blocks.ref], ['Will', d.blocks.will],
        ]) {
            const bk = saveBuckets(block);
            const tr = h('tr');
            const rollTd = h('td', 'skill-roll-cell no-print');
            rollTd.appendChild(rollBtn(label + ' save', block.total));
            tr.appendChild(rollTd);
            tr.appendChild(h('td', null, label));
            for (const key of ['base', 'ability', 'enh', 'resist', 'feat', 'trait', 'misc', 'temp']) {
                tr.appendChild(h('td', 'num', bk[key] ? fmt(bk[key]) : '—'));
            }
            tr.appendChild(h('td', 'num skill-total', fmt(block.total)));
            table.appendChild(tr);
        }
        body.appendChild(rollAllBar('🎲 Roll all saves',
            'Roll Fort, Ref and Will into the Tools log', table));
        body.appendChild(table);

        // --- shared chip-list builder (DR, resistances, immunities, vulnerabilities)
        const chipSection = (title, list, chipParts, selOptions, onAdd, opts = {}) => {
            const head = h('div', 'def-line-head');
            head.appendChild(h('h4', 'def-h', title));
            const addBtn = h('button', 'inv-btn def-add-btn no-print', '+');
            addBtn.type = 'button';
            addBtn.title = 'Add ' + title.toLowerCase();
            head.appendChild(addBtn);
            body.appendChild(head);

            const row = h('div', 'def-chips');
            list.forEach((entry, idx) => {
                const chip = h('span', 'def-chip');
                chipParts(chip, entry);
                const rm = h('button', 'inv-btn inv-btn-danger def-chip-rm no-print', '×');
                rm.type = 'button';
                rm.title = 'Remove';
                rm.addEventListener('click', () => {
                    list.splice(idx, 1);
                    rerender();
                });
                chip.appendChild(rm);
                row.appendChild(chip);
            });
            if (!list.length) row.appendChild(h('span', 'dim', 'None'));
            body.appendChild(row);

            const form = h('div', 'def-add-row no-print hidden');
            const amt = h('input', 'edit-field def-amt');
            amt.type = 'number';
            amt.min = '0';
            amt.placeholder = '5';
            const sel = h('select', 'edit-field');
            for (const t of selOptions) {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t;
                sel.appendChild(opt);
            }
            const customOpt = document.createElement('option');
            customOpt.value = '__custom';
            customOpt.textContent = 'custom…';
            sel.appendChild(customOpt);
            const custom = h('input', 'edit-field def-custom hidden');
            custom.type = 'text';
            custom.placeholder = 'custom type';
            sel.addEventListener('change', () => {
                custom.classList.toggle('hidden', sel.value !== '__custom');
            });
            const go = h('button', 'inv-btn inv-btn-primary', 'Add');
            go.type = 'button';
            go.addEventListener('click', () => {
                const amount = opts.noAmount ? 0 : parseIntLoose(amt.value, 0);
                if (!opts.noAmount && !amount) {
                    amt.focus();
                    return;
                }
                const type = sel.value === '__custom'
                    ? (custom.value.trim() || '—') : sel.value;
                onAdd(amount, type);
                rerender();
            });
            if (!opts.noAmount) form.append(amt);
            form.append(sel, custom, go);
            body.appendChild(form);
            addBtn.addEventListener('click', () => form.classList.toggle('hidden'));
        };

        // --- Damage reduction: chips like "5/cold iron", amount dblclick-editable
        chipSection('Damage Reduction', defs.dr, (chip, entry) => {
            const bag = { v: Number(entry.amount) || 0 };
            chip.appendChild(dblclickEditable(bag, 'v', {
                type: 'number', min: 0,
                format: (v) => String(v ?? 0),
                parse: (s) => parseIntLoose(s, 0),
                onChange: (v) => {
                    entry.amount = Number(v) || 0;
                    quietSave();
                },
            }));
            chip.appendChild(h('span', 'def-chip-type', '/' + (entry.bypass || '—')));
        }, DR_BYPASS_TYPES, (amount, type) => {
            defs.dr.push({ amount, bypass: type });
        });

        // --- Energy resistances: chips like "Fire 10"
        chipSection('Energy Resistance', defs.resist, (chip, entry) => {
            chip.appendChild(h('span', 'def-chip-type', titleCase(entry.type || '?') + ' '));
            const bag = { v: Number(entry.amount) || 0 };
            chip.appendChild(dblclickEditable(bag, 'v', {
                type: 'number', min: 0,
                format: (v) => String(v ?? 0),
                parse: (s) => parseIntLoose(s, 0),
                onChange: (v) => {
                    entry.amount = Number(v) || 0;
                    quietSave();
                },
            }));
        }, ENERGY_TYPES, (amount, type) => {
            defs.resist.push({ type, amount });
        });

        // --- Healing & toughness: regeneration / fast healing / hardness
        body.appendChild(h('h4', 'def-h', 'Healing & Toughness'));
        const healRow = h('div', 'defense-grid def-stretch');
        const defEditBox = (label, get, set, textOpts) => {
            const box = h('div', 'feat-count-box def-box');
            box.appendChild(h('span', 'feat-count-label', label));
            const bag = { v: get() };
            box.appendChild(dblclickEditable(bag, 'v', textOpts || {
                type: 'number', min: 0,
                format: (v) => (Number(v) ? String(v) : '—'),
                parse: (s) => parseIntLoose(s, 0),
                onChange: (v) => {
                    set(Number(v) || 0);
                    quietSave();
                },
            }));
            return box;
        };
        healRow.appendChild(defEditBox('Regeneration',
            () => Number(defs.regen) || 0, (v) => { defs.regen = v; }));
        healRow.appendChild(defEditBox('Regen. bypass',
            () => defs.regenBypass || '', null, {
                format: (v) => (v && String(v).trim() ? String(v) : '—'),
                parse: (s) => String(s),
                onChange: (v) => {
                    const t = String(v || '').trim();
                    if (t) defs.regenBypass = t;
                    else delete defs.regenBypass;
                    quietSave();
                },
            }));
        healRow.appendChild(defEditBox('Fast Healing',
            () => Number(defs.fastHealing) || 0, (v) => { defs.fastHealing = v; }));
        healRow.appendChild(defEditBox('Hardness',
            () => Number(defs.hardness) || 0, (v) => { defs.hardness = v; }));
        body.appendChild(healRow);

        // --- Immunities / vulnerabilities / condition defenses (type-only chips)
        const typeChip = (chip, entry) => {
            chip.appendChild(h('span', 'def-chip-type', titleCase(entry.type || '?')));
        };
        const condOptions = PF1_CONDITIONS.map((c) => c.label.toLowerCase());
        chipSection('Damage Immunities', defs.dmgImmune, typeChip, DAMAGE_TYPES,
            (a, type) => defs.dmgImmune.push({ type }), { noAmount: true });
        chipSection('Damage Vulnerabilities', defs.dmgVuln, typeChip, DAMAGE_TYPES,
            (a, type) => defs.dmgVuln.push({ type }), { noAmount: true });
        chipSection('Condition Resistances', defs.condResist, typeChip, condOptions,
            (a, type) => defs.condResist.push({ type }), { noAmount: true });
        chipSection('Condition Immunities', defs.condImmune, typeChip, condOptions,
            (a, type) => defs.condImmune.push({ type }), { noAmount: true });

        // --- Spell resistance: base + feat/trait/class/misc boxes + computed total
        body.appendChild(h('h4', 'def-h', 'Spell Resistance'));
        if (st.sr == null && data.spell_resistance != null) {
            st.sr = Number(data.spell_resistance) || 0;
        }
        st.srBonus ??= {};
        const srRow = h('div', 'defense-grid def-sr-row def-stretch');
        const srBox = (label, get, set) => {
            const box = h('div', 'feat-count-box def-box');
            box.appendChild(h('span', 'feat-count-label', label));
            const bag = { v: get() };
            box.appendChild(dblclickEditable(bag, 'v', {
                type: 'number', min: 0,
                format: (v) => String(Number(v) || 0),
                parse: (s) => parseIntLoose(s, 0),
                onChange: (v) => {
                    set(Number(v) || 0);
                    rerender();
                },
            }));
            return box;
        };
        srRow.appendChild(srBox('Base', () => Number(st.sr) || 0, (v) => { st.sr = v; }));
        for (const [key, label] of [['feat', 'Feat'], ['trait', 'Trait'], ['class', 'Class'], ['misc', 'Misc']]) {
            srRow.appendChild(srBox(label,
                () => Number(st.srBonus[key]) || 0,
                (v) => {
                    if (v) st.srBonus[key] = v;
                    else delete st.srBonus[key];
                }));
        }
        const totBox = h('div', 'feat-count-box def-box def-sr-total');
        totBox.appendChild(h('span', 'feat-count-label', 'SR Total'));
        totBox.appendChild(h('span', 'feat-count-value', String(srTotal(data))));
        srRow.appendChild(totBox);
        body.appendChild(srRow);
    }
    function tabDefenses(data) {
        const d = computeDerived(data);
        const { sec, body } = section('Defenses', 'defenses-tab');
        renderDefenses(body, data, d);
        // Armor & shield — same inventory-style rows as the weapons on Combat
        // (name / ⚙ open the item sheet, incl. the Enhancements block)
        body.appendChild(h('h4', 'def-h', 'Armor & Shield'));
        migrateCoreGear(data);
        const invList = ensureInventoryObjects(data);
        const armorRows = [];
        invList.forEach((item, i) => {
            if (inventoryCategory(item) === 'armor') armorRows.push({ item, index: i });
        });
        if (armorRows.length) {
            const pack = h('div', 'inv-list defense-armor');
            for (const { item, index } of armorRows) {
                pack.appendChild(renderInventoryItemCard(data, item, index));
            }
            body.appendChild(pack);
        } else {
            body.appendChild(h('p', 'dim no-print',
                'No armor in inventory — add it on the Inventory tab (Browse items).'));
        }
        // The generator's armor numbers (armor_ac & co.) still feed the AC math —
        // they show in the AC "sources" expander; no separate input rows here.
        return sec;
    }

    return { renderDefenses, tabDefenses };
})();
