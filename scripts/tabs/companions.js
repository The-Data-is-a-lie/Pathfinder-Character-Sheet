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
            notes: '',
        };
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
        vital('Speed', editNum(comp, 'speed'));
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

    return { renderCompanions, companions, newCompanion };
})();
