// scripts/tabs/companions.js — the Companions tab: one editable stat block per companion
// (abilities, AC/saves, attack lines with roll buttons, HP, notes) over a nested-in-master
// model (_sheet.companions — travels in the one-JSON export with zero extra plumbing;
// linked roster characters were ruled out by portability, and the compact Summary-panel
// candidate by the #9 pick — at-the-table glances belong to the Combat HUD, #43).
// Companion rolls land in the SHARED roll log, prefixed with the companion's name.
window.SheetTabCompanions = (function () {
    'use strict';
    const { h, fmt, section, dblclickEditable, parseIntLoose } = window.SheetUI;
    const { sheetState, quietSave } = window.SheetState;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);

    const COMPANION_TYPES = ['animal companion', 'familiar', 'eidolon', 'mount', 'other'];
    const AB_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const mod = (score) => Math.floor(((Number(score) || 10) - 10) / 2);

    // The backend's `bonded_creatures[].type` -> this tab's editable dropdown. `companion` is the
    // only one that renames; anything unrecognised lands on 'other' rather than inventing an option
    // the dropdown cannot show.
    const TYPE_MAP = { companion: 'animal companion', familiar: 'familiar', mount: 'mount', eidolon: 'eidolon' };
    const typeLabel = (t) => TYPE_MAP[String(t || '').toLowerCase()] || 'other';

    // `outcome` is a closed set on the backend, so the phrasing is a MAP, not a formatter. An
    // unrecognised token falls through to itself: a new `on_loss` in companion_grantors.json should
    // look odd on the sheet, not vanish.
    const ABSENCE_PHRASE = {
        domain: () => 'chose a domain instead',
        bonded_object: () => 'took a bonded object instead',
        bond_with_allies: () => 'bonded with allies instead',
        archetype_removed: (e) => 'traded away by ' + (e.archetype || 'an archetype'),
    };

    function companions(data) {
        const st = sheetState(data);
        if (!Array.isArray(st.companions)) st.companions = [];
        return st.companions;
    }

    /** Seeded defaults; familiars auto-derive HP (half the master's) per PF1. */
    function newCompanion(data, type) {
        const masterHp = Number(data.Total_HP) || 10;
        const familiar = type === 'familiar';
        return {
            id: 'comp-' + Date.now().toString(36),
            name: familiar ? 'Familiar' : 'Companion',
            type: type || 'animal companion',
            hd: familiar ? Math.max(1, Number(data.level) || 1) : 1,
            hp: { current: familiar ? Math.floor(masterHp / 2) : 8,
                max: familiar ? Math.floor(masterHp / 2) : 8 },
            ac: 14, touch: 12, ff: 12,
            saves: { fort: 2, ref: 2, will: 0 },
            abilities: { str: 12, dex: 14, con: 12, int: familiar ? 6 : 2, wis: 12, cha: 6 },
            attacks: [{ name: 'Bite', atk: 2, dmg: '1d4+1' }],
            speed: 40,
            cmb: 0, cmd: 10,
            skills: [],
            notes: '',
        };
    }

    // ---- generated companions: payload -> row ------------------------------------------------ //
    // A `bonded_creatures` entry becomes ONE ordinary companion row. After the first render it is
    // indistinguishable from a hand-made one -- same model, same editors, same ×. Nothing refreshes
    // it and nothing merges into it, because the payload never changes for a saved character.

    const isRow = (e) => !!(e && e.species && e.stats && typeof e.stats === 'object');
    const titleCase = (s) => String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase());

    /** `stats.attacks[]` is richer than the row's {name, atk, dmg}; fold the extras into the name. */
    function foldAttack(line) {
        const count = Number(line.count) || 1;
        const name = (line.alternative ? 'or ' : '')
            + (count > 1 ? count + ' ' : '')
            + String(line.name || 'attack')
            + (line.notes ? ' (' + line.notes + ')' : '');
        // An empty `damage` is an unparsed prose attack -- its rider is already in the name above,
        // so an em dash is honest where '1d4' would be invented.
        const dmg = line.damage
            ? String(line.damage) + (line.crit_multiplier ? '/×' + line.crit_multiplier : '')
            : '—';
        return { name, atk: Number(line.atk) || 0, dmg };
    }

    /**
     * The notes block: what the creature IS, one line each, blanks omitted.
     * `merge_notes` is deliberately dropped -- it explains how a number was built ("4th-level
     * advancement applied"), not what the creature is, and neither renderer shows it. `unapplied` is
     * kept for the opposite reason: it names something the generator COULD NOT do.
     * `size_change` renders as a sentence and never as a modifier -- its values are already inside
     * ac / attacks[].atk / cmb / cmd / skills, so re-applying it double-counts.
     */
    function composeNotes(entry, s) {
        const lines = [];
        const head = [];
        if (s.size) head.push(titleCase(s.size) + (s.space ? ', ' + s.space + ' ft. space' : ''));
        if (s.bonus_tricks) head.push(s.bonus_tricks + ' bonus tricks');
        if (head.length) lines.push(head.join(' · '));
        if (s.special) lines.push('Special: ' + s.special);
        if (s.special_qualities) lines.push('Qualities: ' + s.special_qualities);
        if (s.special_attacks) lines.push('Special attacks: ' + s.special_attacks);
        const feats = (Array.isArray(s.feats) && s.feats.length) ? s.feats : entry.feats;
        if (Array.isArray(feats) && feats.length) lines.push('Feats: ' + feats.join(', '));
        if (s.other && typeof s.other === 'object') {
            const bits = Object.entries(s.other)
                .map(([k, v]) => (v === '' || v == null ? titleCase(k) : titleCase(k) + ' ' + v));
            if (bits.length) lines.push(bits.join(' · '));
        }
        if (s.size_change && s.size_change.from) {
            lines.push('Grew ' + titleCase(s.size_change.from) + ' → ' + titleCase(s.size_change.to)
                + ' (already applied above)');
        }
        for (const u of (Array.isArray(s.unapplied) ? s.unapplied : [])) lines.push('⚠ Not applied: ' + u);
        return lines.join('\n');
    }

    /** One `bonded_creatures` entry -> one row. Caller has already checked isRow(). */
    function mapBondedCreature(entry, index) {
        const s = entry.stats;
        const hp = Number(s.hp) || 0;
        const skills = Object.entries(s.skills || {})
            // `ranks` is dropped on purpose: a total is what you roll.
            .map(([name, v]) => ({ name, total: Number(v && v.total) || 0 }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return {
            // Not newCompanion()'s Date.now() form, so a generated row stays identifiable across a
            // save/load without a second flag.
            id: 'gen-' + entry.grantor + '-' + index,
            source: 'generated',
            grantor: entry.grantor,
            // The BARE name (§8 D9): the tab heading already says Companions, the dropdown beside
            // this field says "animal companion", and the HD badge follows -- the composed
            // "<Master>'s animal companion: <Name>" would state the type three times. Foundry keeps
            // the composed Actor name; the two renderers differ here on purpose.
            name: entry.name,
            type: typeLabel(entry.type),
            hd: Number(s.hd) || 1,                       // the creature's HD, not effective_level
            hp: { current: hp, max: hp },
            ac: Number(s.ac) || 10,
            touch: Number(s.touch_ac) || 10,
            ff: Number(s.flat_footed_ac) || 10,
            saves: { fort: Number(s.saves?.fort) || 0, ref: Number(s.saves?.ref) || 0,
                will: Number(s.saves?.will) || 0 },
            abilities: AB_KEYS.reduce((o, ab) => (o[ab] = Number(s.abilities?.[ab]) || 10, o), {}),
            attacks: (Array.isArray(s.attacks) ? s.attacks : []).map(foldAttack),
            speed: String(s.speed || '').trim(),          // prose, not a number -- see the widget note
            cmb: Number(s.cmb) || 0,
            cmd: Number(s.cmd) || 10,
            skills,
            notes: composeNotes(entry, s),
        };
    }

    /**
     * Seed generated companions into the user's own array, ONCE, then get out of the way.
     * Called from renderSheet alongside seedBackendStatBonuses / seedRacialColumn -- it needs its own
     * flag (not theirs) so characters saved before this feature still upgrade, and it must run above
     * the simple-view early return so the fill happens in both view modes and on loadCharacter().
     *
     * Three cases, and there is no fourth:
     *  1. already seeded -> return; the rows are the user's now.
     *  2. otherwise append one row per real entry and leave every existing row untouched, including
     *     hand-made rows on a character saved before this existed.
     *  3. a player who hand-typed their bird may end up with two rows. That is correct and visible:
     *     both are editable and either has a ×. Reconciling them would mean guessing which fields
     *     they meant to keep.
     */
    function seedCompanions(data) {
        if (!data || typeof data !== 'object') return;
        const st = sheetState(data);
        if (st.companionsSeeded) return;
        const list = Array.isArray(data.bonded_creatures) ? data.bonded_creatures : [];
        st.companionsSeeded = true;
        if (!list.length) return;
        if (!Array.isArray(st.companions)) st.companions = [];
        list.forEach((entry, i) => { if (isRow(entry)) st.companions.push(mapBondedCreature(entry, i)); });
    }

    function logRoll(name, label, bonus) {
        window.SheetRoll?.setOpen?.(true);
        window.SheetRoll?.rollAndLog?.('1d20' + (bonus ? fmt(Number(bonus) || 0) : ''),
            `${name} — ${label}`);
    }
    function logDamage(name, formula) {
        window.SheetRoll?.setOpen?.(true);
        window.SheetRoll?.rollAndLog?.(formula, `${name} — damage`);
    }

    const editNum = (obj, key, onDone) => dblclickEditable(obj, key, {
        type: 'number', min: -99,
        format: (v) => String(v ?? 0),
        parse: (s) => parseIntLoose(s, 0),
        onChange: () => { quietSave(); if (onDone) onDone(); },
    });

    function renderCompanionBlock(data, comp, index) {
        // Back-fill the fields added after this tab first shipped, so a row saved earlier renders
        // with sane numbers rather than a CMD of 0. Idempotent, and cheaper than a migration pass.
        comp.cmb ??= 0;
        comp.cmd ??= 10;
        comp.skills ??= [];
        const box = h('div', 'companion-block');
        const head = h('div', 'companion-head');
        const nameBag = { v: comp.name };
        head.appendChild(dblclickEditable(nameBag, 'v', {
            format: (v) => String(v || 'Companion'),
            parse: (s) => String(s),
            onChange: (v) => { comp.name = String(v || '').trim() || comp.name; quietSave(); },
        }));
        const typeSel = h('select', 'edit-field companion-type');
        for (const t of COMPANION_TYPES) {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            if (comp.type === t) opt.selected = true;
            typeSel.appendChild(opt);
        }
        typeSel.addEventListener('change', () => { comp.type = typeSel.value; quietSave(); });
        head.appendChild(typeSel);
        const hdWrap = h('span', 'dim');
        hdWrap.append('HD ', editNum(comp, 'hd'));
        head.appendChild(hdWrap);
        const del = h('button', 'inv-btn inv-btn-danger companion-del', '×');
        del.type = 'button';
        del.title = 'Remove this companion';
        del.addEventListener('click', () => {
            companions(data).splice(index, 1);
            quietSave();
            renderSheet(data);
            setActiveTab('companions');
            window.SheetOverlay?.toast?.(`${comp.name} removed`);
        });
        head.appendChild(del);
        box.appendChild(head);

        // vitals strip: HP / AC / saves / speed — all editable, saves rollable
        const vitals = h('div', 'companion-vitals');
        const vital = (label, node, rollBonus, rollLabel) => {
            const cell = h('span', 'companion-vital');
            cell.appendChild(h('span', 'companion-vital-label', label));
            cell.appendChild(node);
            if (rollBonus != null) {
                const b = h('button', 'inv-btn companion-roll', '🎲');
                b.type = 'button';
                b.title = 'Roll ' + rollLabel;
                b.addEventListener('click', () => logRoll(comp.name, rollLabel, rollBonus()));
                cell.appendChild(b);
            }
            vitals.appendChild(cell);
        };
        const hpPair = h('span', 'companion-hp');
        hpPair.append(editNum(comp.hp, 'current'), ' / ', editNum(comp.hp, 'max'));
        vital('HP', hpPair);
        vital('AC', editNum(comp, 'ac'));
        vital('Touch', editNum(comp, 'touch'));
        vital('FF', editNum(comp, 'ff'));
        vital('Fort', editNum(comp.saves, 'fort'), () => comp.saves.fort, 'Fortitude save');
        vital('Ref', editNum(comp.saves, 'ref'), () => comp.saves.ref, 'Reflex save');
        vital('Will', editNum(comp.saves, 'will'), () => comp.saves.will, 'Will save');
        vital('CMB', editNum(comp, 'cmb'), () => comp.cmb, 'combat manoeuvre');
        vital('CMD', editNum(comp, 'cmd'));
        // Speed is FREE TEXT, not a number: the backend ships prose ('10 ft. , fly 80 ft. (average)')
        // and the second number is the one a bird companion's player actually needs. Rows saved
        // before this carry speed: 40, which stringifies unchanged.
        const speedBag = { v: comp.speed };
        vital('Speed', dblclickEditable(speedBag, 'v', {
            format: (v) => (String(v ?? '').trim() || '—'),
            parse: (s) => String(s),
            onChange: (v) => { comp.speed = String(v || '').trim(); quietSave(); },
        }));
        box.appendChild(vitals);

        // abilities row
        const abRow = h('div', 'companion-abilities');
        for (const ab of AB_KEYS) {
            const cell = h('span', 'companion-ab');
            cell.appendChild(h('span', 'companion-vital-label', ab.toUpperCase()));
            cell.appendChild(editNum(comp.abilities, ab));
            cell.appendChild(h('span', 'dim', ` (${fmt(mod(comp.abilities[ab]))})`));
            abRow.appendChild(cell);
        }
        box.appendChild(abRow);

        // skills row — mirrors the abilities row, one 🎲 each into the shared log. Omitted entirely
        // when empty, so a hand-made companion looks exactly as it did before this existed.
        if (Array.isArray(comp.skills) && comp.skills.length) {
            const skRow = h('div', 'companion-skills');
            comp.skills.forEach((sk, si) => {
                const cell = h('span', 'companion-skill');
                cell.appendChild(h('span', 'companion-vital-label', sk.name));
                cell.appendChild(editNum(comp.skills[si], 'total'));
                const b = h('button', 'inv-btn companion-roll', '🎲');
                b.type = 'button';
                b.title = 'Roll ' + sk.name;
                b.addEventListener('click', () => logRoll(comp.name, sk.name, comp.skills[si].total));
                cell.appendChild(b);
                skRow.appendChild(cell);
            });
            box.appendChild(skRow);
        }

        // attack lines
        const atkList = h('div', 'companion-attacks');
        comp.attacks.forEach((line, li) => {
            const row = h('div', 'companion-attack-row');
            const nameBag2 = { v: line.name };
            row.appendChild(dblclickEditable(nameBag2, 'v', {
                format: (v) => String(v || 'Attack'),
                parse: (s) => String(s),
                onChange: (v) => { line.name = String(v || '').trim() || line.name; quietSave(); },
            }));
            const atkWrap = h('span');
            atkWrap.append('atk ', editNum(line, 'atk'));
            row.appendChild(atkWrap);
            const dmgBag = { v: line.dmg };
            const dmgWrap = h('span');
            dmgWrap.append('dmg ', dblclickEditable(dmgBag, 'v', {
                format: (v) => String(v || '1d4'),
                parse: (s) => String(s),
                onChange: (v) => { line.dmg = String(v || '').trim() || line.dmg; quietSave(); },
            }));
            row.appendChild(dmgWrap);
            const atkBtn = h('button', 'inv-btn companion-roll', 'Attack');
            atkBtn.type = 'button';
            atkBtn.addEventListener('click', () => logRoll(comp.name, line.name + ' attack', line.atk));
            const dmgBtn = h('button', 'inv-btn companion-roll', 'Damage');
            dmgBtn.type = 'button';
            dmgBtn.addEventListener('click', () => logDamage(comp.name, line.dmg));
            const rm = h('button', 'inv-btn inv-btn-danger', '×');
            rm.type = 'button';
            rm.addEventListener('click', () => {
                comp.attacks.splice(li, 1);
                quietSave();
                renderSheet(data);
                setActiveTab('companions');
            });
            row.append(atkBtn, dmgBtn, rm);
            atkList.appendChild(row);
        });
        const addAtk = h('button', 'inv-btn', '+ attack');
        addAtk.type = 'button';
        addAtk.addEventListener('click', () => {
            comp.attacks.push({ name: 'Attack', atk: 0, dmg: '1d4' });
            quietSave();
            renderSheet(data);
            setActiveTab('companions');
        });
        atkList.appendChild(addAtk);
        box.appendChild(atkList);

        const notes = h('textarea', 'edit-field companion-notes');
        notes.rows = 2;
        notes.placeholder = 'Tricks, special abilities, notes…';
        notes.value = comp.notes || '';
        notes.addEventListener('change', () => { comp.notes = notes.value; quietSave(); });
        box.appendChild(notes);
        return box;
    }

    function renderCompanions(data) {
        const { sec, body } = section('Companions');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Double-click values to edit; 🎲 and Attack/Damage roll into the shared Tools log.'));
        const list = companions(data);
        if (!list.length) {
            body.appendChild(h('p', 'tools-empty',
                'No companions yet — add one below. (Familiars seed half the master’s HP.)'));
        }
        list.forEach((comp, i) => body.appendChild(renderCompanionBlock(data, comp, i)));

        // Absences render STRAIGHT FROM THE PAYLOAD on every render, and are the only thing on this
        // tab that is not user-owned: they are not creatures, so they must not become deletable rows.
        // Skipping them was rejected — an empty tab cannot distinguish "the generator decided no
        // companion" from "this is broken", which is the exact confusion this feature was opened on.
        const absences = (Array.isArray(data.bonded_creatures) ? data.bonded_creatures : [])
            .filter((e) => e && !isRow(e));
        for (const e of absences) {
            const phrase = ABSENCE_PHRASE[e.outcome];
            body.appendChild(h('p', 'companion-absence dim',
                `${titleCase(e.grantor)} — no ${typeLabel(e.type)}: ${phrase ? phrase(e) : e.outcome}.`));
        }

        const addRow = h('div', 'companion-add-row no-print');
        for (const t of COMPANION_TYPES) {
            const b = h('button', 'inv-btn', '+ ' + t);
            b.type = 'button';
            b.addEventListener('click', () => {
                companions(data).push(newCompanion(data, t));
                quietSave();
                renderSheet(data);
                setActiveTab('companions');
            });
            addRow.appendChild(b);
        }
        body.appendChild(addRow);
        return sec;
    }

    return { renderCompanions, companions, newCompanion, seedCompanions, mapBondedCreature };
})();
