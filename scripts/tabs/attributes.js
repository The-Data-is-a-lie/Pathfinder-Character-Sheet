// scripts/tabs/attributes.js -- the Attributes tab: ability rows + senses/aura/languages/
// proficiencies/negative-levels (window.SheetTabAttributes). Extracted from sheet.js (Part B
// split); bodies moved verbatim. renderSheet / setActiveTab late-bind via SheetApp.
window.SheetTabAttributes = (function () {
    'use strict';
    const { h, section, kvDbl, dblclickEditable, fmt, parseIntLoose } = window.SheetUI;
    const { abilityInfo, computeDerived } = window.SheetDerive;
    const { sheetState, quietSave } = window.SheetState;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);
    const { rollBtn } = window.SheetStatKit;

    function kvInitiative(body, d) {
        const block = d.blocks.init;
        const row = h('div', 'kv kv-stat');
        const k = h('span', 'k');
        k.append(document.createTextNode('Initiative '), rollBtn('Initiative', block.total));
        row.appendChild(k);
        const v = h('span', 'v');
        v.appendChild(h('span', 'stat-total', fmt(block.total)));
        if (block.parts?.length) {
            const det = h('details', 'stat-sources');
            det.appendChild(h('summary', null, 'sources'));
            const list = h('ul', 'stat-source-list');
            for (const p of block.parts) {
                const li = h('li', 'stat-source-line'
                    + (p.unresolved ? ' unresolved' : '')
                    + (p.info ? ' info' : ''));
                li.append(
                    h('span', 'stat-source-label', p.label),
                    h('span', 'stat-source-value',
                        p.unresolved ? (p.formula || '?') : fmt(Number(p.value) || 0)),
                );
                list.appendChild(li);
            }
            det.appendChild(list);
            v.appendChild(det);
        }
        row.appendChild(v);
        body.appendChild(row);
        return row;
    }
    function tabAttributes(data) {
        const d = computeDerived(data);
        const { sec, body } = section('Attributes', 'attributes-tab');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Double-click a value to edit. Expand “sources” for calculated breakdowns. Use Roll for checks.'));

        kvInitiative(body, d);
        // Speed lives on Summary; BAB on Combat; saves on Defenses.

        // Misc info — senses / aura / languages / proficiencies (_sheet.miscInfo)
        const stMisc = sheetState(data);
        stMisc.miscInfo ??= {};
        const miscRow = (label, field, hint) => {
            const row = h('div', 'kv');
            row.appendChild(h('span', 'k', label));
            const v = h('span', 'v');
            const bag = { t: stMisc.miscInfo[field] || '' };
            v.appendChild(dblclickEditable(bag, 't', {
                format: (x) => (x && String(x).trim() ? String(x) : '—'),
                parse: (s) => String(s),
                onChange: (x) => {
                    const t = String(x || '').trim();
                    if (t) stMisc.miscInfo[field] = t;
                    else delete stMisc.miscInfo[field];
                    quietSave();
                },
            }));
            v.title = hint;
            row.appendChild(v);
            body.appendChild(row);
        };
        miscRow('Senses', 'senses', 'e.g. darkvision 60 ft., low-light vision, scent');
        miscRow('Aura', 'aura', 'e.g. courage 10 ft., fear aura (DC 16)');
        kvDbl(body, 'Languages', data, 'language_text', {
            asArray: true,
            format: (v) => {
                const list = Array.isArray(v) ? v : (v ? [String(v)] : []);
                return list.length ? list.join(', ') : '—';
            },
        });
        miscRow('Weapon proficiencies', 'weaponProf', 'e.g. simple, martial, whip');
        miscRow('Armor proficiencies', 'armorProf', 'e.g. light, medium, heavy, shields');

        // Negative levels — PF1: each gives −1 attacks/saves/skill & ability checks,
        // −5 HP, −1 effective level; equal to HD = death. Applied to sheet math.
        const nlRow = h('div', 'kv');
        nlRow.appendChild(h('span', 'k', 'Negative levels'));
        const nlV = h('span', 'v');
        const nlBag = { v: Number(stMisc.negativeLevels) || 0 };
        nlV.appendChild(dblclickEditable(nlBag, 'v', {
            type: 'number', min: 0, max: 40,
            format: (v) => String(Number(v) || 0),
            parse: (s) => parseIntLoose(s, 0),
            onChange: (v) => {
                const n = Number(v) || 0;
                if (n) stMisc.negativeLevels = n;
                else delete stMisc.negativeLevels;
                quietSave();
                renderSheet(data);
                setActiveTab('attributes');
            },
        }));
        nlRow.appendChild(nlV);
        body.appendChild(nlRow);
        const negLv = Number(stMisc.negativeLevels) || 0;
        if (negLv) {
            body.appendChild(h('p', 'neg-level-warning',
                `⚠ ${negLv} negative level${negLv > 1 ? 's' : ''}: −${negLv} on attack rolls, `
                + `saves, skill and ability checks; −${5 * negLv} max HP; effective level −${negLv}. `
                + `Applied automatically to attacks, saves, skills, initiative, and HP. `
                + `Casters also lose ${negLv} highest-level spell slot${negLv > 1 ? 's' : ''} `
                + `(adjust on Spells); negative levels equal to Hit Dice mean death.`));
        }

        // FoundryVTT-style ability rows: spelled-out name + Total / Modifier /
        // typed bonuses (Racial / Enhance / Inherent / Level-up / Misc) / Damage / Drain,
        // full width. Inherent & Level-up are pre-filled from the generator. Total hover
        // shows the full source formula.
        const ABILITY_NAMES = {
            str: 'Strength', dex: 'Dexterity', con: 'Constitution',
            int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
        };
        const st = sheetState(data);
        const abT = h('table', 'skills-table ability-table');
        const abHd = h('tr');
        ['Ability', 'Total', 'Modifier', 'Base', 'Racial', 'Enhance', 'Inherent',
            'Level-up', 'Misc', 'Damage', 'Drain']
            .forEach((t) => abHd.appendChild(h('th', null, t)));
        abT.appendChild(abHd);
        const rerenderAttrs = () => {
            quietSave();
            renderSheet(data);
            setActiveTab('attributes');
        };
        for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
            const info = abilityInfo(data, ab);
            const tr = h('tr');
            tr.appendChild(h('td', 'ability-name', ABILITY_NAMES[ab]));

            // Total = computed effective score (read-only); hover shows the full formula.
            const totTd = h('td', 'num ability-total', (info.total ?? '—') + '');
            totTd.title = info.formula;
            tr.appendChild(totTd);

            const modTd = h('td', 'num ability-mod', fmt(info.mod));
            modTd.title = 'floor((total − 10) / 2)'
                + (info.damage ? ` − ${Math.floor(info.damage / 2)} (ability damage)` : '');
            tr.appendChild(modTd);

            // Base = the rolled score; racial is split into the Racial column once seeded
            // (older unseeded saves that carry racial_stats still have it baked in).
            const baseTd = h('td', 'num ability-base');
            const racialBaked = !st.racialSeeded && data?.racial_stats;
            baseTd.title = (racialBaked
                ? 'Rolled base score (includes racial modifier). '
                : 'Rolled base score. ') + 'Double-click to edit.';
            baseTd.appendChild(dblclickEditable(data, ab, {
                type: 'number', min: 1, max: 99,
                format: (v) => (Number(v) ? String(Number(v)) : '—'),
                parse: (s) => parseIntLoose(s, 10),
                onChange: rerenderAttrs,
            }));
            tr.appendChild(baseTd);

            const ADJ_HINTS = {
                racial: 'Racial ability modifier (e.g. +2 from race/heritage). '
                    + 'Pre-filled from the generator; editable.',
                enhancement: 'Enhancement bonus (belts, bull’s strength). Equipped items and buffs '
                    + 'add the dim auto value; the editable box is a manual override on top.',
                inherent: 'Inherent bonus (tomes/manuals, wish). Max +5, stacks with '
                    + 'enhancement. Pre-filled from the generator; editable.',
                levelup: 'Level-up ability increases (+1 per 4 levels). Pre-filled from '
                    + 'the generator; editable.',
                misc: 'Any other untyped/situational adjustment to the score. Untyped bonuses '
                    + 'from items/buffs add the dim auto value.',
                damage: 'Ability damage: −1 to the modifier per 2 points.',
                drain: 'Ability drain: −1 to the score per point (permanent).',
            };
            const adjCell = (field, signed) => {
                const td = h('td', 'num');
                if (ADJ_HINTS[field]) td.title = ADJ_HINTS[field];
                const bag = { v: (st.abilityAdjust?.[ab]?.[field]) || 0 };
                td.appendChild(dblclickEditable(bag, 'v', {
                    type: 'number', min: signed ? -99 : 0, max: 99,
                    format: (v) => (Number(v) ? (signed ? fmt(Number(v)) : String(v)) : '—'),
                    parse: (s) => parseIntLoose(s, 0),
                    onChange: (v) => {
                        st.abilityAdjust ??= {};
                        st.abilityAdjust[ab] ??= {};
                        const n = Number(v) || 0;
                        if (n) st.abilityAdjust[ab][field] = n;
                        else delete st.abilityAdjust[ab][field];
                        if (!Object.keys(st.abilityAdjust[ab]).length) delete st.abilityAdjust[ab];
                        rerenderAttrs();
                    },
                }));
                // Auto value from equipped items / buffs (the ledger), shown dim beside the manual
                // box so the enhancement from a belt etc. is visible in its own column.
                const auto = info.autoByCol?.[field] || 0;
                if (auto) {
                    const badge = h('span', 'ability-auto', fmt(auto));
                    badge.title = 'From items/buffs: ' + (info.autoSrc?.[field] || []).join(', ');
                    td.appendChild(badge);
                }
                return td;
            };
            tr.appendChild(adjCell('racial', true));
            tr.appendChild(adjCell('enhancement', true));
            tr.appendChild(adjCell('inherent', true));
            tr.appendChild(adjCell('levelup', true));
            tr.appendChild(adjCell('misc', true));
            tr.appendChild(adjCell('damage', false));
            tr.appendChild(adjCell('drain', false));
            abT.appendChild(tr);
        }
        body.appendChild(abT);
        body.appendChild(h('p', 'dim attr-cols-note',
            'Racial, Inherent and Level-up columns are pre-filled from the generator (editable). '
            + (st.racialSeeded || !data?.racial_stats
                ? 'Older characters without generator racial data keep the Racial column blank.'
                : 'Racial modifiers are already included in the base score.')));

        return sec;
    }

    return { tabAttributes };
})();
