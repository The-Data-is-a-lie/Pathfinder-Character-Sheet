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
    /**
     * #112: creature type + racial hit dice — the monster chassis.
     *
     * Empty on every ordinary character, and it says so rather than showing a half-filled form:
     * a PC is "Humanoid, no racial HD" and none of this changes a single number until a type is
     * picked. Choosing one fills the racial-HD block from the type table (undead → d8, medium BAB,
     * good Will), and the count is the only thing most creatures need to touch after that.
     */
    function renderCreatureBlock(body, data) {
        const C = window.SheetCreature;
        if (!C) return;
        const creature = C.ensureCreature(data);
        const types = C.types();
        const repaint = () => {
            window.SheetApp.quietSave();
            renderSheet(data);
            setActiveTab('attributes');
        };

        const row = h('div', 'kv creature-row');
        row.appendChild(h('span', 'k', 'Creature type'));
        const v = h('span', 'v creature-controls');
        const typeSel = h('select', 'edit-field');
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '— ordinary character —';
        typeSel.appendChild(none);
        for (const t of types) {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.label;
            if (t.id === creature.type) opt.selected = true;
            typeSel.appendChild(opt);
        }
        typeSel.addEventListener('change', () => {
            creature.type = typeSel.value;
            // Re-seed the chassis from the new type, keeping however many dice are already set.
            creature.racialHD = C.chassisFor(typeSel.value, creature.racialHD.count);
            repaint();
        });
        v.appendChild(typeSel);

        const hdIn = h('input', 'edit-field creature-hd');
        hdIn.type = 'number';
        hdIn.min = '0';
        hdIn.max = '60';
        hdIn.value = String(creature.racialHD.count || 0);
        hdIn.title = 'Racial hit dice — these stack on top of class levels';
        hdIn.addEventListener('change', () => {
            creature.racialHD.count = Math.max(0, parseIntLoose(hdIn.value, 0));
            repaint();
        });
        v.append(h('span', 'dim', ' racial HD '), hdIn);
        row.appendChild(v);
        body.appendChild(row);

        const contrib = C.racialContribution(data);
        if (contrib) {
            body.appendChild(h('p', 'dim creature-note',
                `${contrib.count}d${contrib.die} racial HD: BAB +${contrib.bab}, `
                + `Fort +${contrib.saves.fort} / Ref +${contrib.saves.ref} / Will +${contrib.saves.will}, `
                + `${contrib.skillRanks} skill ranks. Hit dice total `
                + `${window.SheetDerive.totalHD(data)} — every rule that says “HD” uses that.`));
        }
        const traits = C.typeTraits(data);
        if (traits.length) {
            body.appendChild(h('p', 'dim creature-note',
                'Type traits (not automated): ' + traits.join(' · ')));
        }
    }

    /**
     * Inherent luck (house rule; tickets repo feature/inherent-luck). One strip, shown only for a
     * character the generator gave a `luck` block -- an old payload or a hand-made character has
     * no luck, which is not the same thing as 0 luck. The score is editable and the sheet's edit
     * wins (`_sheet.luck.score`); every luck-trait bonus in the ledger is a live formula over it,
     * so a GM adjusting luck mid-campaign moves the saves and AC with it. The E-Kat reserve and
     * hero points are play-state and edit in place too. The derivation is the tooltip on the
     * score, so the number is auditable rather than taken on faith.
     */
    function renderLuckBlock(body, data) {
        const luck = data?.luck;
        if (!luck || typeof luck !== 'object') return;
        const st = sheetState(data);
        st.luck ??= {};
        const SD = window.SheetDetails;
        const score = SD?.luckScoreOf?.(data) ?? 0;
        // floor toward -inf: the backend's luck_mod rounding (-13 -> -3, not -2).
        const mod = Math.floor(score / 5);
        const repaint = () => {
            quietSave();
            renderSheet(data);
            setActiveTab('attributes');
        };
        const signed = (n) => (Number(n) > 0 ? '+' : '') + String(Number(n) || 0);

        const row = h('div', 'kv luck-row');
        row.appendChild(window.SheetUI.kLabel ? window.SheetUI.kLabel('Luck') : h('span', 'k', 'Luck'));
        const strip = h('span', 'v luck-strip');
        const box = (label, node, title) => {
            const b = h('div', 'luck-box');
            if (title) b.title = title;
            b.appendChild(h('div', 'luck-box-label', label));
            const val = h('div', 'luck-box-val');
            if (node instanceof Node) val.appendChild(node);
            else val.textContent = String(node);
            b.appendChild(val);
            return b;
        };
        // Score and mod carry a sign (a luck score is a signed quantity); counts do not.
        const editableNum = (bag, key, onChange, opts = {}) => dblclickEditable(bag, key, {
            format: (x) => (opts.plain ? String(Number(x) || 0) : signed(x)),
            parse: (t) => parseIntLoose(t, 0),
            onChange: (x) => onChange(Number(x) || 0),
        });

        const derivation = (Array.isArray(luck.derivation) ? luck.derivation : []).join(' · ');
        const edited = st.luck.score != null && Number(st.luck.score) !== Number(luck.score);
        const scoreBox = box('Score', editableNum({ s: score }, 's', (n) => {
            if (n === Number(luck.score)) delete st.luck.score;
            else st.luck.score = n;
            repaint();
        }), (derivation || 'Luck score') + (edited ? ` — edited here (generated ${signed(luck.score)})` : ''));
        if (score < 0) scoreBox.classList.add('is-negative');
        strip.appendChild(scoreBox);
        strip.appendChild(box('Mod', signed(mod), 'Luck score ÷ 5, rounded down — Twist Fate uses per day'));
        if (luck.type) strip.appendChild(box('Type', String(luck.type), 'Default, Proximity or Dimorphic'));

        const reserve = st.luck.eKatReserve ?? luck.e_kat_reserve;
        const cap = Number(luck.e_kat_store_cap) || 0;
        strip.appendChild(box('E-Kats', editableNum({ r: Number(reserve) || 0 }, 'r', (n) => {
            if (n === Number(luck.e_kat_reserve)) delete st.luck.eKatReserve;
            else st.luck.eKatReserve = n;
            repaint();
        }, { plain: true }), 'E-Kat reserve — tokens to spend at the table'
            + (cap ? ` (store cap ${cap})` : '')
            + (luck.e_kat_earned != null ? `; ${luck.e_kat_earned} earned by the build` : '')));

        const heroBag = { hp: Number(data.hero_points) || 0 };
        strip.appendChild(box('Hero pts', editableNum(heroBag, 'hp', (n) => {
            data.hero_points = n;
            repaint();
        }, { plain: true }), '10 E-Kats buy one hero point; a non-temporary hero point sells back for five'));

        if (Number(luck.dr_pool)) {
            strip.appendChild(box('DR pool', String(luck.dr_pool), 'Luck spent as a daily damage-reduction pool'));
        }
        if (Number(luck.twist_fate_per_day) || String(luck.type) === 'Dimorphic') {
            strip.appendChild(box('Twist Fate', (Number(luck.twist_fate_per_day) || 0) + '/day',
                'Dimorphic: 1d100 + up to 77 from the Vault, ≤ 50 is the bad end'));
        }
        // The Vault is Dimorphic's mechanic; the backend exports `vault_cap` for every type so the
        // sheets read one shape, which is not a reason to show an empty vault on everyone.
        if (Number(luck.vault) || String(luck.type) === 'Dimorphic') {
            strip.appendChild(box('Vault', `${Number(luck.vault) || 0} / ${Number(luck.vault_cap) || 0}`,
                'Vaulted Interest banks a point whenever a luck roll lands below 0'));
        }
        row.appendChild(strip);
        body.appendChild(row);
        if (derivation) body.appendChild(h('p', 'dim luck-note', derivation));
    }

    function tabAttributes(data) {
        const d = computeDerived(data);
        const { sec, body } = section('Attributes', 'attributes-tab');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Double-click a value to edit. Expand “sources” for calculated breakdowns. Use Roll for checks.'));

        kvInitiative(body, d);
        // Speed lives on Summary; BAB on Combat; saves on Defenses.

        renderCreatureBlock(body, data);
        renderLuckBlock(body, data);

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

        return sec;
    }

    return { tabAttributes };
})();
