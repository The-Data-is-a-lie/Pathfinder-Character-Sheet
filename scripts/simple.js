// scripts/simple.js -- the classic printable/simple character sheet (window.SheetSimple).
// Extracted from sheet.js (Part B split); body moved verbatim except currentData reads (via
// SheetApp.current). Loads after notes.js + skills.js (destructures their helpers), before
// sheet.js. renderSheet / gearLine / addInventoryItem / kvHp late-bind via SheetApp.
window.SheetSimple = (function () {
    'use strict';
    const {
        h, section, fmt, mod, toInt, nonEmpty, parseIntLoose, titleCase, fmtWeight,
        editableField, dblclickEditable, spCell, spHeading, spBoxBig, spTable,
    } = window.SheetUI;
    const {
        computeDerived, abModOf, srTotal, loadCategory, castingAbilityMod, concentrationBonus,
    } = window.SheetDerive;
    const {
        sheetState, ensureInventoryObjects, ensureSkillRanksObject, ensureCastingAbility,
    } = window.SheetState;
    const { ensureProse, renderBioFacts, bindProseTextarea } = window.SheetTabNotes;
    const { ALL_SKILLS, FEAT_GROUPS } = window.SheetData;
    const {
        ranksForSkill, skillMiscBonus, skillUserBonus, skillRankKey, getSkillAbility,
        skillAbilityKey, ranksEditor,
    } = window.SheetTabSkills;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const gearLine = (...a) => window.SheetApp.gearLine(...a);
    const addInventoryItem = (...a) => window.SheetApp.addInventoryItem(...a);
    const { kvHp } = window.SheetStatKit;

    function renderSimpleSheet(data) {
        const d = computeDerived(data);
        const st = sheetState(data);
        const SD = window.SheetDetails;
        const wrap = h('div', 'simple-sheet');

        // Edit helpers: every commit quiet-saves via editableField; opts.rerender repaints
        // the sheet when the edited value feeds computeDerived / skill math.
        const rerender = () => renderSheet(window.SheetApp.current || data);
        const edit = (obj, key, opts = {}) => dblclickEditable(obj, key, {
            ...opts,
            onChange: (v, o) => {
                opts.onChange?.(v, o);
                if (opts.rerender) rerender();
            },
        });
        const editNum = (obj, key, opts = {}) => edit(obj, key, {
            type: 'number',
            parse: (s) => parseIntLoose(s, 0),
            ...opts,
        });
        // Editing a computed total stores the delta as a "Manual adjustment" that
        // computeDerived folds into both views' math.
        const adjustable = (key, block, opts = {}) => {
            const bag = { total: block.total };
            return dblclickEditable(bag, 'total', {
                type: 'number',
                format: () => (opts.plain ? String(block.total) : fmt(block.total)),
                parse: (s) => parseIntLoose(s, block.total),
                onChange: () => {
                    const delta = (Number(bag.total) || 0) - block.total;
                    if (delta) {
                        st.manualAdjust ??= {};
                        st.manualAdjust[key] = (Number(st.manualAdjust[key]) || 0) + delta;
                    }
                    rerender();
                },
            });
        };
        const titled = (v) => (v ? titleCase(String(v)) : '');

        // ---- page 1: identity, abilities, combat, skills ----
        const p1 = h('section', 'simple-page');
        p1.appendChild(h('p', 'simple-hint no-print',
            'Double-click a value to edit. Editing a total (AC, saves, Initiative, …) stores a manual adjustment that also shows on the full sheet. '
            + 'Double-click a blank line under Feats, Gear, etc. to add an entry; clear a name to remove it.'));

        const nameRow = h('div', 'simple-name-row');
        nameRow.appendChild(spCell('Character Name', edit(data, 'character_full_name'), 'simple-name-cell'));
        nameRow.appendChild(spCell('Player', edit(st, 'player')));

        const clsWrap = h('span', 'simple-inline-edits');
        clsWrap.appendChild(edit(data, 'c_class', { format: titled, rerender: true }));
        if (Array.isArray(data.classes) && data.classes.length > 1) {
            // multiclass payload: "Fighter 6 / Wizard 4 / ..." — the editable level is the
            // primary class's level ("level" keeps that meaning in multiclass payloads)
            clsWrap.appendChild(document.createTextNode(' '));
            clsWrap.appendChild(editNum(data, 'level', { min: 1, max: 40, rerender: true }));
            clsWrap.appendChild(h('span', null, ' / '
                + data.classes.slice(1).map((c) => `${titleCase(c.display || c.name)} ${c.level}`).join(' / ')));
        } else {
            if (data.c_class_2) clsWrap.appendChild(h('span', null, ' / ' + titleCase(data.c_class_2)));
            clsWrap.appendChild(document.createTextNode(' '));
            clsWrap.appendChild(editNum(data, 'level', { min: 1, max: 40, rerender: true }));
        }
        const id = h('div', 'simple-id-grid');
        id.appendChild(spCell('Alignment', edit(data, 'alignment', {
            format: (v) => {
                const s = String(v || '');
                return s.length <= 2 ? s.toUpperCase() : titleCase(s);
            },
        })));
        id.appendChild(spCell('Class & Level', clsWrap));
        id.appendChild(spCell('Race', edit(data, 'chosen_race', { format: titled })));
        id.appendChild(spCell('Deity', edit(data, 'deity_name', {
            format: (v) => Array.isArray(v) ? v.join(', ') : (v == null ? '' : String(v)),
            parse: (s) => {
                const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
                return parts.length <= 1 ? (parts[0] || '') : parts;
            },
        })));
        id.appendChild(spCell('Homeland', edit(data, 'region')));
        id.appendChild(spCell('Size', edit(data, 'size')));
        id.appendChild(spCell('Gender', edit(data, 'gender', { format: titled })));
        id.appendChild(spCell('Age', editNum(data, 'age_number', { min: 0 })));
        id.appendChild(spCell('Height', edit(data, 'height_number')));
        id.appendChild(spCell('Weight', editNum(data, 'weight_number', { min: 0 })));

        // Identity block (name + id grid); a stored portrait sits beside it when present.
        const idBlock = h('div', 'simple-id-block');
        idBlock.appendChild(nameRow);
        idBlock.appendChild(id);
        const portraitUrl = data?._sheet?.portrait;
        if (portraitUrl) {
            const row = h('div', 'simple-id-withportrait');
            const pImg = h('img', 'simple-portrait');
            pImg.src = portraitUrl;
            pImg.alt = 'Character portrait';
            row.appendChild(pImg);
            row.appendChild(idBlock);
            p1.appendChild(row);
        } else {
            p1.appendChild(idBlock);
        }

        const cols = h('div', 'simple-cols');
        const left = h('div', 'simple-col');
        const right = h('div', 'simple-col');
        cols.append(left, right);
        p1.appendChild(cols);

        // Abilities
        left.appendChild(spHeading('Ability Scores'));
        left.appendChild(spTable(
            ['Ability', { text: 'Score', cls: 'num' }, { text: 'Mod', cls: 'num' }],
            ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((ab) => [
                ab.toUpperCase(),
                { node: editNum(data, ab, { min: 1, max: 99, rerender: true }), cls: 'num' },
                { text: data[ab] != null ? fmt(abModOf(data, ab)) : '', cls: 'num strong' },
            ])));

        // HP / init / speed
        left.appendChild(spHeading('Hit Points & Initiative'));
        const vit = h('div', 'simple-stat-grid');
        const maxHp = d.blocks.hp.total || 0;
        if (st.hpCurrent == null || st.hpCurrent === '') st.hpCurrent = maxHp;
        if (st.hpNonlethal == null || st.hpNonlethal === '') st.hpNonlethal = 0;
        const hpBag = { max: maxHp };
        vit.appendChild(spBoxBig('Max HP', dblclickEditable(hpBag, 'max', {
            type: 'number',
            min: 0,
            format: () => String(maxHp),
            parse: (s) => parseIntLoose(s, maxHp),
            onChange: () => {
                // Shift the rolled-dice component so the computed total matches (kvHp-style).
                const delta = (Number(hpBag.max) || 0) - maxHp;
                if (delta) {
                    const rolled = toInt(data.total_rolled_hp)
                        ?? (d.blocks.hp.parts.find((p) => p.kind === 'base' && !p.unresolved)?.value ?? 0);
                    data.total_rolled_hp = rolled + delta;
                    if (Number(st.hpCurrent) === maxHp) st.hpCurrent = maxHp + delta;
                }
                rerender();
            },
        })));
        vit.appendChild(spBoxBig('Current HP', editNum(st, 'hpCurrent', { min: 0 })));
        vit.appendChild(spBoxBig('Nonlethal', editNum(st, 'hpNonlethal', { min: 0 })));
        vit.appendChild(spBoxBig('Initiative', adjustable('init', d.blocks.init)));
        st.speeds ??= {};
        if (st.speeds.land == null || st.speeds.land === '') {
            st.speeds.land = Number(data.land_speed) || 30;
        }
        const extraSpeeds = ['climb', 'swim', 'fly', 'burrow']
            .map((k) => [k, Number(st.speeds[k]) || 0])
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${titleCase(k)} ${v}`)
            .join(', ');
        vit.appendChild(spBoxBig('Speed', editNum(st.speeds, 'land', {
            min: 0,
            suffix: ' ft',
            onChange: () => { data.land_speed = st.speeds.land; },
        })));
        vit.appendChild(spBoxBig('Other Speeds', extraSpeeds || '—'));
        left.appendChild(vit);

        // Defense
        left.appendChild(spHeading('Defense'));
        const defGrid = h('div', 'simple-stat-grid');
        defGrid.appendChild(spBoxBig('AC', adjustable('ac', d.blocks.ac, { plain: true })));
        defGrid.appendChild(spBoxBig('Touch', adjustable('touch', d.blocks.touch, { plain: true })));
        defGrid.appendChild(spBoxBig('Flat-Footed', adjustable('flat', d.blocks.flat, { plain: true })));
        left.appendChild(defGrid);
        const acMisc = d.ac - 10 - d.armorAc - d.shieldAc - d.effDex;
        left.appendChild(h('p', 'simple-formula',
            `AC = 10 + armor ${d.armorAc} + shield ${d.shieldAc} + Dex ${fmt(d.effDex)}`
            + (acMisc ? ` + misc ${fmt(acMisc)}` : '')));

        // Saves
        const saveRow = (label, key, block, abLabel, abMod) => {
            const base = block.parts.find((p) => p.kind === 'base' && !p.unresolved)?.value ?? 0;
            const misc = block.total - base - abMod;
            return [
                label,
                { node: adjustable(key, block), cls: 'num strong' },
                { text: String(base), cls: 'num' },
                { text: `${fmt(abMod)} ${abLabel}`, cls: 'num' },
                { text: misc ? fmt(misc) : '—', cls: 'num' },
            ];
        };
        left.appendChild(spHeading('Saving Throws'));
        left.appendChild(spTable(
            ['Save', { text: 'Total', cls: 'num' }, { text: 'Base', cls: 'num' },
                { text: 'Ability', cls: 'num' }, { text: 'Misc', cls: 'num' }],
            [
                saveRow('Fortitude', 'fort', d.blocks.fort, 'Con', d.conM),
                saveRow('Reflex', 'ref', d.blocks.ref, 'Dex', d.dexM),
                saveRow('Will', 'will', d.blocks.will, 'Wis', d.wisM),
            ]));

        // Offense
        left.appendChild(spHeading('Offense'));
        const offGrid = h('div', 'simple-stat-grid');
        offGrid.appendChild(spBoxBig('BAB', editNum(data, 'bab_total', {
            min: 0,
            rerender: true,
            format: (v) => fmt(Number(v) || 0),
        })));
        offGrid.appendChild(spBoxBig('Melee', adjustable('melee', d.blocks.melee)));
        offGrid.appendChild(spBoxBig('Ranged', adjustable('ranged', d.blocks.ranged)));
        offGrid.appendChild(spBoxBig('CMB', adjustable('cmb', d.blocks.cmb)));
        offGrid.appendChild(spBoxBig('CMD', adjustable('cmd', d.blocks.cmd, { plain: true })));
        if (st.sr == null || st.sr === '') st.sr = Number(data.spell_resistance) || 0;
        offGrid.appendChild(spBoxBig('SR', editNum(st, 'sr', {
            min: 0,
            format: () => (srTotal(data) ? String(srTotal(data)) : '—'),
        })));
        left.appendChild(offGrid);

        // Weapons
        const isRangedType = (w) => !!w && ['rwak', 'rsak', 'twak'].includes(w.actionType);
        const critStr = (w) => w
            ? (w.critRange && w.critRange < 20 ? w.critRange + '–20' : '20') + '/×' + (w.critMult || 2)
            : '';
        const dmgTypeStr = (w) => (w?.parts?.[0]?.types || [])
            .map((t) => String(t).charAt(0).toUpperCase()).join('/');
        const weaponRows = [];
        const mainName = (data.weapon_name || '').trim();
        if (mainName) {
            const w = SD?.lookupWeapon?.(mainName);
            const atk = isRangedType(w) ? d.blocks.ranged.total : d.blocks.melee.total;
            weaponRows.push([
                gearLine(mainName, data.weapon_enhancement_chosen_list) || mainName,
                { text: fmt(atk), cls: 'num strong' },
                { text: critStr(w), cls: 'num' },
                { text: d.blocks.damage?.total || w?.dice || '', cls: 'num' },
                dmgTypeStr(w),
            ]);
        }
        for (const item of ensureInventoryObjects(data)) {
            if (!item?.name || item.name.toLowerCase() === mainName.toLowerCase()) continue;
            const w = SD?.lookupWeapon?.(item.name);
            if (!w) continue;
            const atk = isRangedType(w) ? d.blocks.ranged.total : d.blocks.melee.total;
            const abKey = String(w.damageAbility || 'str').toLowerCase();
            const abMod = ({ str: d.strM, dex: d.dexM, con: d.conM, int: d.intM, wis: d.wisM, cha: d.chaM })[abKey] ?? 0;
            weaponRows.push([
                item.name,
                { text: fmt(atk), cls: 'num' },
                { text: critStr(w), cls: 'num' },
                { text: (w.dice || '') + (abMod ? (abMod > 0 ? '+' : '') + abMod : ''), cls: 'num' },
                dmgTypeStr(w),
            ]);
        }
        const weaponBlanks = Math.max(4 - weaponRows.length, 2);
        for (let i = 0; i < weaponBlanks; i++) {
            weaponRows.push({
                cls: 'simple-blank-row' + (i > 0 ? ' simple-blank-extra' : ''),
                cells: ['', '', '', '', ''],
            });
        }
        left.appendChild(spHeading('Weapons'));
        left.appendChild(spTable(
            ['Weapon', { text: 'Attack', cls: 'num' }, { text: 'Crit', cls: 'num' },
                { text: 'Damage', cls: 'num' }, 'Type'],
            weaponRows));
        const wornBits = [
            gearLine(data.armor_name, data.armor_enhancement_chosen_list),
            gearLine(data.shield_name, data.shield_enhancement_chosen_list),
        ].filter(Boolean);
        if (wornBits.length) {
            left.appendChild(h('p', 'simple-formula', 'Worn: ' + wornBits.join(' · ')));
        }

        // Gear — editable name / qty / per-unit weight; blank rows add items
        // (addInventoryItem fills weight & price from the compendium when the name matches).
        left.appendChild(spHeading('Gear'));
        const eqList = data.equipment_list ??= [];
        const gearRows = [];
        let totalWt = 0;
        for (const item of eqList) {
            if (!item || typeof item !== 'object') continue;
            const qty = Math.max(1, Number(item.quantity) || 1);
            const wt = item.weight != null && Number.isFinite(Number(item.weight))
                ? Number(item.weight) * qty : null;
            if (wt) totalWt += wt;
            gearRows.push([
                { node: edit(item, 'name', {
                    onChange: () => {
                        if (!String(item.name || '').trim()) {
                            const ix = eqList.indexOf(item);
                            if (ix >= 0) eqList.splice(ix, 1);
                        }
                        rerender();
                    },
                }) },
                { node: editNum(item, 'quantity', {
                    min: 1,
                    rerender: true,
                    parse: (s) => Math.max(1, parseIntLoose(s, 1)),
                }), cls: 'num' },
                { node: editNum(item, 'weight', {
                    min: 0,
                    rerender: true,
                    format: (v) => (v == null || v === '' ? '—' : String(v)),
                    parse: (s) => {
                        const n = parseFloat(s);
                        return Number.isFinite(n) ? n : null;
                    },
                }), cls: 'num' },
            ]);
        }
        const gearBlanks = Math.max(8 - gearRows.length, 2);
        for (let i = 0; i < gearBlanks; i++) {
            const bag = { name: '' };
            gearRows.push({
                cls: 'simple-blank-row' + (i > 0 ? ' simple-blank-extra' : ''),
                cells: [
                    { node: dblclickEditable(bag, 'name', {
                        format: (v) => (v && String(v).trim() ? String(v) : ' '),
                        onChange: () => {
                            const nm = String(bag.name || '').trim();
                            if (nm) {
                                addInventoryItem(data, nm);
                                rerender();
                            }
                        },
                    }) },
                    '', '',
                ],
            });
        }
        left.appendChild(spTable(
            ['Item', { text: 'Qty', cls: 'num' }, { text: 'Wt.', cls: 'num' }],
            gearRows));
        const load = loadCategory(totalWt, data.str);
        left.appendChild(h('p', 'simple-formula',
            `Total ${fmtWeight(totalWt)} — ${load.label} load`
            + ` (light ${load.lim.light} / medium ${load.lim.medium} / heavy ${load.lim.heavy} lbs)`));

        // Languages
        left.appendChild(spHeading('Languages'));
        const langsP = h('p', 'simple-langs');
        langsP.appendChild(edit(data, 'language_text', { asArray: true }));
        left.appendChild(langsP);

        // Skills (same math and rank storage as the Skills tab)
        right.appendChild(spHeading('Skills'));
        const rankMap = ensureSkillRanksObject(data);
        const craftLabel = data.craft_type ? `Craft (${data.craft_type})` : 'Craft';
        const skillRows = [];
        for (const skill of ALL_SKILLS) {
            const displayName = skill.name === 'Craft' ? craftLabel
                : skill.name === 'Profession' && nonEmpty(data.profession_ranks) ? null
                    : skill.name;
            if (displayName === null) continue;
            const rKey = skillRankKey(
                skill.name === 'Craft' && data.craft_type ? craftLabel : skill.name,
            );
            const ranks = ranksForSkill(rankMap, skill.name)
                || ranksForSkill(rankMap, displayName)
                || (skill.name === 'Craft' && data.craft_type ? ranksForSkill(rankMap, 'craft') : 0);
            const ab = getSkillAbility(data, skill);
            const abMod = abModOf(data, ab);
            const misc = skillMiscBonus(data, { ...skill, ab });
            // Fold user bonuses (racial/feat/trait/misc/class-skill) into Misc here
            const user = skillUserBonus(data, skillAbilityKey(skill), ranks);
            const extra = misc.total + user.total;
            skillRows.push([
                displayName,
                ab.toUpperCase(),
                { text: fmt(ranks + abMod + extra), cls: 'num strong' },
                { text: fmt(abMod), cls: 'num' },
                { node: ranksEditor(data, rKey, ranks), cls: 'num' },
                { text: extra ? fmt(extra) : '—', cls: 'num' },
            ]);
        }
        for (const p of data.profession_ranks || []) {
            const label = p.skill_label || p.name || 'Profession';
            const ranks = Number(p.ranks) || 0;
            const abMod = abModOf(data, 'wis');
            const misc = skillMiscBonus(data, { ab: 'wis', id: 'pro', acp: false });
            const user = skillUserBonus(data, 'pro:' + label, ranks);
            const extra = misc.total + user.total;
            skillRows.push([
                label, 'WIS',
                { text: fmt(ranks + abMod + extra), cls: 'num strong' },
                { text: fmt(abMod), cls: 'num' },
                { node: editNum(p, 'ranks', { min: 0, max: 40, rerender: true }), cls: 'num' },
                { text: extra ? fmt(extra) : '—', cls: 'num' },
            ]);
        }
        right.appendChild(spTable(
            ['Skill', 'Abl', { text: 'Total', cls: 'num' }, { text: 'Mod', cls: 'num' },
                { text: 'Ranks', cls: 'num' }, { text: 'Misc', cls: 'num' }],
            skillRows, 'simple-skills'));

        wrap.appendChild(p1);

        // ---- page 2: feats, traits, abilities, money, spells ----
        const p2 = h('section', 'simple-page');

        // Editable name lists: dblclick a line to rename (clear it to remove);
        // dblclick a blank line to add a new entry.
        const editableNameList = (rows, onAdd, minLines = 3) => {
            const ul = h('ul', 'simple-name-list');
            for (const r of rows) {
                const li = h('li');
                li.appendChild(dblclickEditable(r.obj, r.key, {
                    format: r.format,
                    parse: r.parse,
                    onChange: () => {
                        const v = r.obj[r.key];
                        if (v == null || String(v).trim() === '') r.remove();
                        rerender();
                    },
                }));
                ul.appendChild(li);
            }
            // Pad with blanks to at least minLines, then round up to fill the 3-wide grid row
            let blanks = Math.max(minLines - rows.length, 1);
            blanks += (3 - ((rows.length + blanks) % 3)) % 3;
            for (let b = 0; b < blanks; b++) {
                const li = h('li', 'simple-blank' + (b > 0 ? ' simple-blank-extra' : ''));
                const bag = { name: '' };
                li.appendChild(dblclickEditable(bag, 'name', {
                    format: (v) => (v && String(v).trim() ? String(v) : ' '),
                    onChange: () => {
                        const nm = String(bag.name || '').trim();
                        if (nm) {
                            onAdd(nm);
                            rerender();
                        }
                    },
                }));
                ul.appendChild(li);
            }
            return ul;
        };
        const arrayRows = (arr, opts = {}) => (arr || []).map((_, i) => ({
            obj: arr,
            key: i,
            format: opts.format,
            parse: opts.parse,
            remove: () => arr.splice(i, 1),
        }));

        const featRows = [];
        for (const g of FEAT_GROUPS) featRows.push(...arrayRows(data[g.listKey]));
        p2.appendChild(spHeading('Feats'));
        p2.appendChild(editableNameList(featRows, (nm) => {
            (data.feats ??= []).push(nm);
        }));

        const traitRows = [
            ...arrayRows(data.selected_traits),
            ...arrayRows(data.background_traits),
            ...arrayRows(data.sphere_traits),
            ...arrayRows(data.flaw, {
                format: (v) => (v ? v + ' (flaw)' : ''),
                parse: (s) => s.replace(/\s*\(flaw\)\s*$/i, '').trim(),
            }),
        ];
        p2.appendChild(spHeading('Traits & Flaws'));
        p2.appendChild(editableNameList(traitRows, (nm) => {
            (data.selected_traits ??= []).push(nm);
        }));

        // class_ability entries look like "arcane bond_wizard" — edit the name, keep the class suffix
        const abilityRows = (data.class_ability || []).map((entry, i) => {
            const s = String(entry ?? '');
            const cut = s.lastIndexOf('_');
            const suffix = cut > 0 ? s.slice(cut) : '';
            return {
                obj: data.class_ability,
                key: i,
                format: (v) => {
                    const str = String(v ?? '');
                    const c = str.lastIndexOf('_');
                    return titleCase(c > 0 ? str.slice(0, c) : str);
                },
                parse: (txt) => {
                    const nm = txt.trim();
                    return nm ? nm.toLowerCase() + suffix : '';
                },
                remove: () => data.class_ability.splice(i, 1),
            };
        });
        for (const pa of data.profession_ability_items || []) {
            abilityRows.push({
                obj: pa,
                key: 'name',
                remove: () => {
                    const ix = data.profession_ability_items.indexOf(pa);
                    if (ix >= 0) data.profession_ability_items.splice(ix, 1);
                },
            });
        }
        p2.appendChild(spHeading('Special Abilities'));
        p2.appendChild(editableNameList(abilityRows, (nm) => {
            (data.class_ability ??= []).push(nm); // plain name, like the Features tab's custom add
        }));

        // Money | Experience side by side (gear lives on page 1 under Weapons)
        const cols2 = h('div', 'simple-cols');
        const l2 = h('div', 'simple-col');
        const r2 = h('div', 'simple-col');
        cols2.append(l2, r2);
        p2.appendChild(cols2);

        if (data.platinum == null && data.platnium != null) data.platinum = data.platnium;
        l2.appendChild(spHeading('Money'));
        const moneyGrid = h('div', 'simple-stat-grid simple-money');
        for (const [label, key] of [['PP', 'platinum'], ['GP', 'gold'], ['SP', 'silver'], ['CP', 'copper']]) {
            if (data[key] == null || data[key] === '') data[key] = 0;
            moneyGrid.appendChild(spBoxBig(label, editNum(data, key, {
                min: 0,
                format: (raw) => (raw == null || raw === '' ? '0' : String(raw)),
                onChange: () => {
                    if (key === 'platinum') data.platnium = data.platinum; // keep legacy in sync
                },
            })));
        }
        l2.appendChild(moneyGrid);

        r2.appendChild(spHeading('Experience'));
        const xpBox = h('div', 'simple-writein-box');
        xpBox.appendChild(edit(st, 'xp'));
        r2.appendChild(xpBox);

        // Spells — fixed levels 0–9 like the paper sheet; blank but editable for non-casters.
        if (!Array.isArray(data.day_list)) data.day_list = [];
        if (!Array.isArray(data.known_list)) data.known_list = [];
        if (!Array.isArray(data.spell_list_choose_from)) data.spell_list_choose_from = [];
        const perDay = data.day_list;
        const known = data.known_list;
        const lists = data.spell_list_choose_from;
        const isCaster = perDay.some((n) => Number(n) > 0)
            || known.some((n) => Number(n) > 0)
            || lists.some((l) => nonEmpty(l))
            || Number(data.caster_level) > 0;
        let castAb = '';
        let castMod = 0;
        if (isCaster) {
            castAb = ensureCastingAbility(data);
            castMod = castingAbilityMod(data);
        }
        const sp = h('div', 'simple-spells');
        sp.appendChild(spHeading('Spells'));
        const spLine = h('p', 'simple-formula');
        spLine.appendChild(document.createTextNode('Caster level '));
        spLine.appendChild(editNum(data, 'caster_level', { min: 0, max: 40, rerender: true }));
        spLine.appendChild(document.createTextNode(isCaster
            ? ` · ${String(castAb).toUpperCase()} ${fmt(castMod)}`
                + ` · Concentration ${fmt(concentrationBonus(data))} · Save DC = 10 + spell level ${fmt(castMod)}`
            : ' · Save DC = 10 + spell level + casting ability mod'));
        sp.appendChild(spLine);
        const spellNumCell = (arr, lv) => ({
            node: editNum(arr, lv, {
                min: 0,
                format: (raw) => (raw == null || raw === '' ? '—' : String(raw)),
            }),
            cls: 'num',
        });
        // Editable list plus a print-only "(N)" so the printed 2-line clamp shows the true count
        const spellListCell = (lv) => {
            const cellWrap = h('span', 'simple-spell-wrap');
            cellWrap.appendChild(edit(lists, lv, { asArray: true }));
            const n = (lists[lv] || []).length;
            if (n > 2) cellWrap.appendChild(h('span', 'simple-spell-count print-only', `(${n} total)`));
            return cellWrap;
        };
        const spellRows = [];
        for (let lv = 0; lv <= 9; lv++) {
            spellRows.push([
                { text: String(lv), cls: 'num' },
                spellNumCell(perDay, lv),
                spellNumCell(known, lv),
                { text: isCaster ? String(10 + lv + castMod) : '', cls: 'num' },
                { node: spellListCell(lv), cls: 'simple-spell-cell' },
            ]);
        }
        sp.appendChild(spTable(
            [{ text: 'Lvl', cls: 'num' }, { text: 'Per Day', cls: 'num' },
                { text: 'Known', cls: 'num' }, { text: 'DC', cls: 'num' }, 'Spell List'],
            spellRows));
        p2.appendChild(sp);

        // Biography & Notes — a full-width band at the very bottom (below spells) so the structured
        // background (from the generator's formatted_bio) lays out horizontally and flows across
        // the two printed pages instead of claiming a page of its own. The notes-prose-notes id
        // lets renderSheet's flush keep un-debounced edits.
        const bioProse = ensureProse(data);
        const bioBand = h('div', 'simple-bio-band');
        bioBand.appendChild(spHeading('Biography & Notes'));
        const facts = renderBioFacts(data, { compact: true });
        if (facts) bioBand.appendChild(facts);

        const notesBlock = h('div', 'simple-bio-block simple-bio-notes');
        notesBlock.appendChild(h('div', 'simple-bio-label', 'Notes & background'));
        const notesTa = h('textarea', 'notes-text simple-bio-text simple-bio-main');
        notesTa.id = 'notes-prose-notes';
        notesTa.placeholder = 'Backstory, family, relationships, session notes…';
        notesTa.value = bioProse.notes || '';
        notesTa.rows = 4;
        bindProseTextarea(notesTa, data, 'notes');
        notesBlock.appendChild(notesTa);
        bioBand.appendChild(notesBlock);
        p2.appendChild(bioBand);

        wrap.appendChild(p2);
        return wrap;
    }

    return { renderSimpleSheet };
})();
