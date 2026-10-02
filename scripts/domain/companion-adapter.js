// scripts/domain/companion-adapter.js -- #141: a companion's numbers DERIVED, not stored
// (window.SheetCompanionAdapter).
//
// A companion row keeps its build on `comp.base` (abilities, HD, BAB, save bases, natural
// armour, size, skill ranks, feats, tricks, natural attacks) and its own `comp._sheet`
// (buffs, conditions, temp/nonlethal HP). `toData(comp)` dresses that up as a master-shaped
// object so the master's own machinery — SheetDerive.abilityInfo / sizeInfo / conditionFlags /
// appendLedgerParts, SheetDetails.collectChanges, SheetSkillMath — computes it unchanged.
// The adapter's `_sheet` IS `comp._sheet` (same reference), so SheetState.createBuff on the
// adapter writes straight into the companion.
//
// computeDerived itself is deliberately NOT called: it writes window.sheetChanges /
// sheetChangesFull and data.Total_HP, and reads armour/weapon/class fields a creature has
// none of. The blocks below are the same parts, assembled for a creature.
//
// Every number takes a hand override (`comp.overrides[field]`), and `comp.edited[field]`
// marks what the user touched so a backend refresh never overwrites it (hand edits win).
window.SheetCompanionAdapter = (function () {
    'use strict';
    const AB = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const D = () => window.SheetDerive;
    const SD = () => window.SheetDetails;
    const MODEL = 2;

    const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const modOf = (score) => Math.floor((num(score, 10) - 10) / 2);
    const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

    /** Backend skill key ('knowledge dungeoneering') -> the sheet's skill entry. */
    function skillDef(name) {
        const k = keyOf(name);
        return (window.SheetData?.ALL_SKILLS || []).find((s) => keyOf(s.name) === k) || null;
    }

    // ---------------------------------------------------------------- the adapter object
    function sheetOf(comp) {
        const st = comp._sheet ??= {};
        if (!Array.isArray(st.buffs)) st.buffs = [];
        if (!Array.isArray(st.conditions)) st.conditions = [];
        st.abilityAdjust ??= {};
        return st;
    }

    function toData(comp) {
        const b = comp.base || {};
        const st = sheetOf(comp);
        st.size = b.size || 'medium';
        const out = {
            _companion: true,
            character_full_name: comp.name,
            level: num(b.hd, 1),
            bab_total: num(b.bab),
            save_bases: { ...(b.saveBases || {}) },
            skill_ranks: {},
            _sheet: st,
        };
        for (const ab of AB) out[ab] = num(b.abilities?.[ab], 10);
        for (const [name, s] of Object.entries(b.skills || {})) out.skill_ranks[name.toLowerCase()] = num(s.ranks);
        return out;
    }

    /** The full ledger for this creature: its own buffs + conditions + built-in changes. */
    function ledger(data, comp) {
        const L = D().effectiveLedger(data);
        const built = (comp.base?.changes || []).map((c) => ({
            formula: String(c.value ?? c.formula ?? 0), target: c.target, type: c.type || 'untyped',
            operator: 'add', source: c.source || 'Built-in', sourceKind: 'racial',
        }));
        return { ...L, changes: [...(L.changes || []), ...built] };
    }

    // ---------------------------------------------------------------- derivation
    function derive(comp) {
        const Dv = D();
        const { part, sumParts, appendLedgerParts } = Dv;
        const data = toData(comp);
        const L = ledger(data, comp);
        const b = comp.base || {};
        const ab = {};
        for (const k of AB) {
            // Buffs and conditions reach abilities through abilityInfo's own ledger read; the
            // built-in (applied_changes) list never targets an ability score.
            const info = Dv.abilityInfo(data, k);
            ab[k] = { total: info.total ?? 10, mod: info.mod, formula: info.formula };
        }
        const size = Dv.sizeInfo(data);
        const cond = Dv.conditionFlags(data);
        const dexM = ab.dex.mod;
        const strM = ab.str.mod;
        const dexDenied = cond.loseDex && dexM > 0;
        const effDex = dexDenied ? 0 : dexM;
        const dexLabel = dexDenied ? `Dex (denied — ${cond.sources.join(', ')})` : 'Dex';
        const bab = num(b.bab);
        const nat = num(b.natArmor);
        const block = (parts) => ({ total: sumParts(parts), parts });
        const sizePart = () => part(`Size (${size.label})`, size.mod);
        const special = () => part(`Size, special (${size.label})`, size.special);

        const ac = [part('Base', 10), part(dexLabel, effDex, { kind: 'ability' })];
        if (nat) ac.push(part('Natural armour', nat, { type: 'natural' }));
        if (size.mod) ac.push(sizePart());
        appendLedgerParts(ac, data, L, ['ac', 'aac', 'sac', 'nac'], { skipDodge: cond.noDodge });
        const touch = [part('Base', 10), part(dexLabel, effDex, { kind: 'ability' })];
        if (size.mod) touch.push(sizePart());
        appendLedgerParts(touch, data, L, ['ac', 'tac'], { touchOnly: true, skipDodge: cond.noDodge });
        const ff = [part('Base', 10)];
        if (Math.min(dexM, 0)) ff.push(part('Dex (penalty)', Math.min(dexM, 0), { kind: 'ability' }));
        if (nat) ff.push(part('Natural armour', nat, { type: 'natural' }));
        if (size.mod) ff.push(sizePart());
        appendLedgerParts(ff, data, L, ['ac', 'ffac', 'aac', 'sac', 'nac'], { skipDodge: true });

        const save = (k, abKey) => {
            const p = [part('Base', num(b.saveBases?.[k])), part(abKey.toUpperCase(), ab[abKey].mod, { kind: 'ability' })];
            appendLedgerParts(p, data, L, [k, 'allSavingThrows']);
            return block(p);
        };
        const init = [part('Dex', dexM, { kind: 'ability' })];
        appendLedgerParts(init, data, L, ['init']);
        const cmb = [part('BAB', bab), part('Strength', strM, { kind: 'ability' })];
        if (size.special) cmb.push(special());
        appendLedgerParts(cmb, data, L, ['cmb']);
        const cmd = [part('Base', 10), part('BAB', bab), part('Strength', strM, { kind: 'ability' }),
            part(dexDenied ? 'Dexterity (denied)' : 'Dexterity', dexDenied ? Math.min(dexM, 0) : dexM, { kind: 'ability' })];
        if (size.special) cmd.push(special());
        appendLedgerParts(cmd, data, L, ['cmd']);
        const hd = num(b.hd, 1);
        const hp = [part('Rolled hit dice', num(b.rolledHp)), part(`Con × ${hd} HD`, ab.con.mod * hd, { kind: 'ability' })];
        appendLedgerParts(hp, data, L, ['mhp', 'hp']);

        return {
            data, ledger: L, abilities: ab, size,
            blocks: {
                ac: block(ac), touch: block(touch), ff: block(ff),
                fort: save('fort', 'con'), ref: save('ref', 'dex'), will: save('will', 'wis'),
                init: block(init), cmb: block(cmb), cmd: block(cmd), hpMax: block(hp),
            },
        };
    }

    // ---------------------------------------------------------------- overrides
    function value(comp, field, derived) {
        const o = comp.overrides?.[field];
        if (o !== undefined && o !== null && o !== '') return o;
        const d = derived || derive(comp);
        return d.blocks[field]?.total ?? 0;
    }
    const isOverridden = (comp, field) => comp.overrides?.[field] != null && comp.overrides[field] !== '';
    function setOverride(comp, field, v) {
        (comp.overrides ??= {})[field] = v;
        (comp.edited ??= {})[field] = true;
    }
    function clearOverride(comp, field) {
        if (comp.overrides) delete comp.overrides[field];
        (comp.edited ??= {})[field] = true;   // a deliberate reset is still a hand edit
    }
    /** Edit a base field (e.g. 'abilities.str', 'bab') and mark it so the backend leaves it alone. */
    function setBase(comp, path, v) {
        const keys = path.split('.');
        let o = comp.base ??= {};
        for (const k of keys.slice(0, -1)) o = o[k] ??= {};
        o[keys[keys.length - 1]] = v;
        (comp.edited ??= {})['base.' + path] = true;
    }

    // ---------------------------------------------------------------- skills
    function skillTotal(comp, name, derived) {
        const d = derived || derive(comp);
        const s = comp.base?.skills?.[name] || {};
        const def = skillDef(name) || { name, ab: s.ab || 'int' };
        const abKey = s.ab || def.ab || 'int';
        const ranks = num(s.ranks);
        const parts = [{ label: 'Ranks', value: ranks }, { label: abKey.toUpperCase(), value: d.abilities[abKey].mod }];
        if (s.cs && ranks > 0) parts.push({ label: 'Class skill', value: 3 });
        if (def.id === 'ste' && d.size.steps) parts.push({ label: `Size (${d.size.label})`, value: -4 * d.size.steps });
        if (def.id === 'fly' && d.size.steps) parts.push({ label: `Size (${d.size.label})`, value: -2 * d.size.steps });
        const misc = window.SheetSkillMath?.skillMiscBonus?.(d.data, { ...def, ab: abKey });
        for (const bit of misc?.bits || []) parts.push({ label: bit.source, value: bit.value });
        for (const c of d.ledger.changes) {
            // built-in changes (evolutions' skill.acr …) are not in effectiveLedger's view
            if (c.sourceKind === 'racial' && def.id && c.target === 'skill.' + def.id) {
                parts.push({ label: c.source, value: num(c.formula) });
            }
        }
        const total = parts.reduce((a, p) => a + num(p.value), 0);
        const key = 'skill:' + name;
        return { total: isOverridden(comp, key) ? num(comp.overrides[key]) : total, derived: total, parts, key };
    }

    // ---------------------------------------------------------------- attacks
    function attackLine(comp, i, derived) {
        const d = derived || derive(comp);
        const a = comp.base?.attacks?.[i];
        if (!a) return null;
        const naturals = (comp.base.attacks || []).filter((x) => x.natural !== false);
        const secondary = a.kind === 'secondary';
        const abKey = a.ability || 'str';
        const abMod = d.abilities[abKey].mod;
        const atkParts = [{ label: 'BAB', value: num(comp.base.bab) }, { label: abKey.toUpperCase(), value: abMod }];
        if (d.size.mod) atkParts.push({ label: `Size (${d.size.label})`, value: d.size.mod });
        if (secondary) atkParts.push({ label: 'Secondary', value: -5 });
        for (const c of SD().changesForTargets(d.ledger, ['attack', 'mattack', 'nattack'])) {
            const ev = SD().evalSimpleFormula(c.formula, d.data);
            if (ev.ok) atkParts.push({ label: c.source, value: ev.value });
        }
        const atk = atkParts.reduce((s, p) => s + num(p.value), 0);
        // PF1: Str ×1.5 on a creature's sole natural attack, ×0.5 on secondaries.
        const strMult = secondary ? 0.5 : (naturals.length === 1 && a.natural !== false ? 1.5 : 1);
        let flat = abKey === 'str' || a.damageAbility === 'str'
            ? Math.floor(d.abilities.str.mod * (d.abilities.str.mod > 0 ? strMult : 1)) : 0;
        for (const c of SD().changesForTargets(d.ledger, ['damage', 'mdamage', 'ndamage'])) {
            const ev = SD().evalSimpleFormula(c.formula, d.data);
            if (ev.ok) flat += ev.value;
        }
        // Dice are stored at the size the payload rolled them for; step by the difference.
        const fromSteps = (window.SheetData?.SIZES || []).find((s) => s.id === (a.diceSize || comp.base.size))?.steps || 0;
        const dice = a.dice ? (window.SheetData?.stepDice?.(a.dice, d.size.steps - fromSteps) ?? a.dice) : '';
        const dmg = dice ? dice + (flat ? (flat > 0 ? '+' : '') + flat : '') : '';
        const ak = 'atk:' + i;
        const dk = 'dmg:' + i;
        return {
            name: a.name, count: num(a.count, 1), crit: a.crit || '', notes: a.notes || '',
            atk: isOverridden(comp, ak) ? num(comp.overrides[ak]) : atk, atkDerived: atk, atkParts, atkKey: ak,
            dmg: isOverridden(comp, dk) ? String(comp.overrides[dk]) : dmg, dmgDerived: dmg, dmgKey: dk,
        };
    }

    /** Remove a natural attack; its index-keyed overrides go with it and later ones shift down. */
    function removeAttack(comp, i) {
        comp.base?.attacks?.splice(i, 1);
        const next = {};
        for (const [k, v] of Object.entries(comp.overrides || {})) {
            const m = /^(atk|dmg):(\d+)$/.exec(k);
            if (!m) { next[k] = v; continue; }
            const n = Number(m[2]);
            if (n !== i) next[`${m[1]}:${n > i ? n - 1 : n}`] = v;
        }
        comp.overrides = next;
        (comp.edited ??= {})['base.attacks'] = true;
    }
    function addAttack(comp, sizeId) {
        ((comp.base ??= {}).attacks ??= []).push({ name: 'Attack', count: 1, kind: 'primary', ability: 'str',
            dice: '1d4', diceSize: sizeId || comp.base.size || 'medium', crit: '', notes: '', natural: true });
        (comp.edited ??= {})['base.attacks'] = true;
    }

    // ---------------------------------------------------------------- HP appliers
    // Same semantics as SheetRoll.applyDamageToHp (roll.js), which is hard-wired to the master:
    // temp HP absorbs first, current may go negative, nonlethal accrues separately.
    function hpOf(comp) {
        comp.hp ??= { current: 0, max: 0 };
        const st = sheetOf(comp);
        return { cur: num(comp.hp.current), max: num(comp.hp.max), temp: num(st.hpTemp), nl: num(st.hpNonlethal) };
    }
    function applyDamage(comp, n, { nonlethal = false } = {}) {
        const st = sheetOf(comp);
        n = Math.max(0, num(n));
        if (nonlethal) { st.hpNonlethal = num(st.hpNonlethal) + n; return; }
        const absorbed = Math.min(num(st.hpTemp), n);
        st.hpTemp = num(st.hpTemp) - absorbed;
        comp.hp.current = num(comp.hp.current) - (n - absorbed);
    }
    function applyHealing(comp, n) {
        const st = sheetOf(comp);
        n = Math.max(0, num(n));
        comp.hp.current = Math.min(num(comp.hp.max), num(comp.hp.current) + n);
        st.hpNonlethal = Math.max(0, num(st.hpNonlethal) - n);
    }

    // ---------------------------------------------------------------- migration
    /** Natural attacks out of a `stats.attacks[]` entry. */
    function attackFromStats(line, size) {
        const m = /^(\d+d\d+)\s*([+-]\s*\d+)?/.exec(String(line.damage || '').trim());
        return {
            name: String(line.name || 'attack'),
            count: num(line.count, 1),
            kind: line.kind === 'secondary' ? 'secondary' : 'primary',
            ability: 'str',
            dice: m ? m[1] : '',
            diceSize: size,
            crit: line.crit_multiplier ? '×' + line.crit_multiplier : '',
            notes: [line.alternative ? 'alternative' : '', line.notes || ''].filter(Boolean).join('; '),
            natural: true,
        };
    }

    /** A `bonded_creatures[].stats` block -> a `base`. The size the creature STARTED at is the base. */
    function baseFromStats(entry) {
        const s = entry.stats || {};
        const abilities = {};
        for (const ab of AB) abilities[ab] = num(s.abilities?.[ab], 10);
        const conM = modOf(abilities.con);
        const hd = num(s.hd, 1);
        const finalSize = String(s.size || 'medium').toLowerCase();
        const startSize = String(s.size_change?.from || finalSize).toLowerCase();
        const saveBases = {};
        const abFor = { fort: 'con', ref: 'dex', will: 'wis' };
        for (const k of ['fort', 'ref', 'will']) saveBases[k] = num(s.saves?.[k]) - modOf(abilities[abFor[k]]);
        const skills = {};
        for (const [name, v] of Object.entries(s.skills || {})) {
            const def = skillDef(name);
            skills[def ? def.name : name] = { ranks: num(v?.ranks), cs: true, ab: def?.ab };
        }
        const feats = (Array.isArray(s.feats) && s.feats.length ? s.feats : entry.feats) || [];
        return {
            abilities, hd,
            hitDie: String(s.hit_die || ''),
            rolledHp: num(s.hp) - conM * hd,
            bab: num(s.bab),
            saveBases,
            natArmor: num(s.natural_armor),
            size: startSize,
            skills,
            feats: feats.map((f) => ({ name: String(f) })),
            tricks: [],
            bonusTricks: num(s.bonus_tricks),
            // `damage_bonus` (eidolon lines) is the finished Str contribution, which the
            // derivation recomputes — so only the dice are kept.
            attacks: (Array.isArray(s.attacks) ? s.attacks : []).map((a) => attackFromStats(a, finalSize)),
            // applied_changes are evolutions/racials that live OUTSIDE the scores; natural armour
            // already includes its own (`natural_armor` is the finished number), so `nac` is dropped.
            changes: (Array.isArray(s.applied_changes) ? s.applied_changes : [])
                .filter((c) => c && c.target && c.target !== 'nac'),
        };
    }

    /** A pre-#141 row of stored totals -> a base that reproduces them as closely as it can. */
    function baseFromTotals(comp) {
        const abilities = {};
        for (const ab of AB) abilities[ab] = num(comp.abilities?.[ab], 10);
        const m = (k) => modOf(abilities[k]);
        const hd = num(comp.hd, 1);
        const bab = num(comp.cmb) - m('str');
        return {
            abilities, hd, hitDie: '', rolledHp: num(comp.hp?.max) - m('con') * hd, bab,
            saveBases: { fort: num(comp.saves?.fort) - m('con'), ref: num(comp.saves?.ref) - m('dex'),
                will: num(comp.saves?.will) - m('wis') },
            natArmor: Math.max(0, num(comp.ac, 10) - num(comp.touch, 10)),
            size: 'medium',
            skills: Object.fromEntries((comp.skills || []).map((s) => [skillDef(s.name)?.name || s.name,
                { ranks: 0, cs: false, ab: skillDef(s.name)?.ab }])),
            feats: [], tricks: [], bonusTricks: 0,
            attacks: (comp.attacks || []).map((a) => {
                const mm = /^(\d+d\d+)/.exec(String(a.dmg || ''));
                return { name: a.name, count: 1, kind: 'primary', ability: 'str', dice: mm ? mm[1] : '',
                    diceSize: 'medium', crit: '', notes: '', natural: true };
            }),
            changes: [],
        };
    }

    /**
     * Upgrade a row to the derived model, ONCE. Every field whose stored total differs from
     * what the derivation now produces is kept as an override, so nothing on screen moves.
     */
    function migrate(comp, entry) {
        if (!comp || comp.model === MODEL) return false;
        comp.base = entry && entry.stats ? baseFromStats(entry) : baseFromTotals(comp);
        comp.overrides ??= {};
        comp.edited ??= {};
        const st = sheetOf(comp);
        const sc = entry?.stats?.size_change;
        if (sc && sc.from && sc.to && !st.buffs.some((x) => x.autoKey === 'companion:advancement')) {
            // The payload's advancement ability/NA deltas are already merged into the scores and
            // are not reported separately, so the buff carries the one part it CAN own: the size step.
            st.buffs.push(window.SheetState.normalizeBuffEntry({
                name: `Advancement (${sc.from} → ${sc.to})`, subType: 'perm', active: true,
                setSize: String(sc.to).toLowerCase(), changes: [], autoKey: 'companion:advancement',
            }));
        }
        const d = derive(comp);
        const stored = {
            ac: comp.ac, touch: comp.touch, ff: comp.ff, cmb: comp.cmb, cmd: comp.cmd,
            fort: comp.saves?.fort, ref: comp.saves?.ref, will: comp.saves?.will,
            init: entry?.stats?.initiative, hpMax: comp.hp?.max,
        };
        for (const [k, v] of Object.entries(stored)) {
            if (v == null || !Number.isFinite(Number(v))) continue;
            if (Number(v) !== d.blocks[k].total) comp.overrides[k] = Number(v);
        }
        const totals = entry?.stats?.skills
            ? Object.entries(entry.stats.skills).map(([n, v]) => [skillDef(n)?.name || n, v?.total])
            : (comp.skills || []).map((s) => [skillDef(s.name)?.name || s.name, s.total]);
        for (const [name, t] of totals) {
            if (t == null) continue;
            if (Number(t) !== skillTotal(comp, name, d).derived) comp.overrides['skill:' + name] = Number(t);
        }
        const statLines = Array.isArray(entry?.stats?.attacks) ? entry.stats.attacks : null;
        (comp.attacks || []).forEach((a, i) => {
            const line = attackLine(comp, i, d);
            if (!line) return;
            if (Number(a.atk) !== line.atkDerived) comp.overrides['atk:' + i] = Number(a.atk);
            // The payload states an eidolon's bonus apart from its dice; judge the whole formula.
            const sl = statLines?.[i];
            const bonus = sl && sl.damage_bonus != null && num(sl.damage_bonus)
                ? (num(sl.damage_bonus) > 0 ? '+' : '') + num(sl.damage_bonus) : '';
            const storedDmg = (String(a.dmg || '').split('/')[0] + (sl && !/[+-]\d/.test(String(sl.damage || '')) ? bonus : ''))
                .replace(/\s+/g, '');
            if (storedDmg && storedDmg !== '—' && storedDmg !== line.dmgDerived) comp.overrides['dmg:' + i] = storedDmg;
        });
        comp.model = MODEL;
        return true;
    }

    /**
     * Hand edits win: re-read a generated row's base from the payload, but only the fields
     * nobody has touched (`comp.edited['base.<path>']`). Overrides are never touched.
     */
    function refreshFromBackend(comp, entry) {
        if (!comp?.base || comp.source !== 'generated' || !entry?.stats) return;
        const fresh = baseFromStats(entry);
        const ed = comp.edited || {};
        for (const ab of AB) if (!ed['base.abilities.' + ab]) comp.base.abilities[ab] = fresh.abilities[ab];
        for (const k of ['hd', 'bab', 'natArmor', 'rolledHp', 'hitDie', 'bonusTricks']) {
            if (!ed['base.' + k]) comp.base[k] = fresh[k];
        }
        for (const k of ['fort', 'ref', 'will']) if (!ed['base.saveBases.' + k]) comp.base.saveBases[k] = fresh.saveBases[k];
        if (!ed['base.skills']) comp.base.skills = fresh.skills;
        if (!ed['base.feats']) comp.base.feats = fresh.feats;
        if (!ed['base.attacks']) comp.base.attacks = fresh.attacks;
    }

    /** Write the derived/effective totals back onto the legacy row fields the card + share code read. */
    function syncLegacy(comp, derived) {
        const d = derived || derive(comp);
        const v = (f) => num(value(comp, f, d));
        comp.ac = v('ac'); comp.touch = v('touch'); comp.ff = v('ff');
        comp.cmb = v('cmb'); comp.cmd = v('cmd');
        comp.saves = { fort: v('fort'), ref: v('ref'), will: v('will') };
        comp.hp ??= { current: 0, max: 0 };
        const prevMax = num(comp.hp.max);
        comp.hp.max = v('hpMax');
        if (comp.hp.current == null || comp.hp.current === '' ) comp.hp.current = comp.hp.max;
        else if (prevMax && prevMax !== comp.hp.max && num(comp.hp.current) === prevMax) comp.hp.current = comp.hp.max;
        comp.hd = num(comp.base?.hd, 1);
        for (const ab of AB) (comp.abilities ??= {})[ab] = d.abilities[ab].total;
        comp.skills = Object.keys(comp.base?.skills || {}).sort().map((name) => ({ name, total: skillTotal(comp, name, d).total }));
        comp.attacks = (comp.base?.attacks || []).map((_, i) => {
            const l = attackLine(comp, i, d);
            return { name: (l.count > 1 ? l.count + ' ' : '') + l.name, atk: l.atk, dmg: (l.dmg || '—') + (l.crit ? '/' + l.crit : '') };
        });
    }

    return {
        MODEL, toData, derive, value, isOverridden, setOverride, clearOverride, setBase,
        skillTotal, skillDef, attackLine, removeAttack, addAttack, hpOf, applyDamage, applyHealing,
        migrate, refreshFromBackend, baseFromStats, syncLegacy,
    };
})();
