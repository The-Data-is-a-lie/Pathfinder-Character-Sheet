// scripts/domain/companion-share.js — companion-adjacent play (#22): buffs shared with a
// companion, and the "mounted on <companion>" state.
//
// Pure: reads `data`, returns numbers. Nothing here mutates a companion block — a shared
// buff's bonuses are FOLDED IN AT DISPLAY / ROLL TIME by the Companions tab, so unticking
// the buff (or its share flag) restores the stored block instantly with nothing to undo.
//
// Formulas evaluate against the MASTER's stats (SheetDetails.evalSimpleFormula on `data`):
// a bard's Inspire Courage arrives at the wolf as flat numbers the same way it arrives at
// the fighter next to it, and a companion block has no @classes for a formula to read anyway.
window.SheetCompanionShare = (function () {
    'use strict';

    // Ledger target → the companion fields it lands on. Anything not listed (abilities,
    // skills, speed, HP, casting…) is counted in `ignored` and shown in the tooltip rather
    // than silently dropped: the companion block stores totals, not a derivation, so a +4 Str
    // cannot be turned into "+2 attack, +2 damage, +4 CMB" without guessing the build.
    const FIELDS_FOR = {
        attack: ['attack'], mattack: ['attack'], wattack: ['attack'], nattack: ['attack'],
        damage: ['damage'], mdamage: ['damage'], wdamage: ['damage'], ndamage: ['damage'],
        // rattack / rdamage deliberately absent — companions do not shoot.
        ac: null, // routed by bonus type below
        fort: ['fort'], ref: ['ref'], will: ['will'],
        allSavingThrows: ['fort', 'ref', 'will'],
        cmb: ['cmb'], cmd: ['cmd'],
    };
    const FIELDS = ['attack', 'damage', 'ac', 'touch', 'ff', 'fort', 'ref', 'will', 'cmb', 'cmd'];
    // PF1 AC routing: dodge skips flat-footed, armor/shield/natural skip touch, the rest
    // (deflection, insight, luck, sacred, profane, morale, untyped, penalties) hit all three.
    function acFields(type) {
        const t = String(type || 'untyped').toLowerCase();
        if (t === 'dodge') return ['ac', 'touch'];
        if (t === 'armor' || t === 'shield' || t === 'natural' || t === 'naturalarmor') return ['ac', 'ff'];
        return ['ac', 'touch', 'ff'];
    }
    // Bonus types that stack with themselves; every other type takes its single best value.
    const STACKING = new Set(['untyped', 'dodge', 'circumstance', 'penalty', 'racial', '']);

    /** Active always-on buffs flagged for sharing. */
    function sharedBuffs(data) {
        const list = Array.isArray(data?._sheet?.buffs) ? data._sheet.buffs : [];
        return list.filter((b) => b && b.active !== false && b.shareWithCompanions === true
            && b.activation !== 'perRoll' && Array.isArray(b.changes) && b.changes.length);
    }

    function evalChange(change, buff, data) {
        const lv = Number(buff.level) || 0;
        let formula = String(change.formula ?? '').trim();
        if (lv) formula = formula.replace(/@(?:cl|sl)\b/gi, String(lv));
        const r = window.SheetDetails?.evalSimpleFormula?.(formula, data);
        return r && r.ok ? Number(r.value) || 0 : null;
    }

    /**
     * The numbers every companion currently receives.
     * → { attack, damage, ac, touch, ff, fort, ref, will, cmb, cmd,
     *     sources: { field: [{ source, value, type }] }, ignored: [{ source, target }], any }
     */
    function sharedBonuses(data) {
        const out = { sources: {}, ignored: [], any: false };
        for (const f of FIELDS) { out[f] = 0; out.sources[f] = []; }
        // (field, type) → best value for non-stacking types
        const best = new Map();
        const stackers = [];
        for (const b of sharedBuffs(data)) {
            for (const c of b.changes) {
                const target = String(c?.target || '');
                const fields = target === 'ac' ? acFields(c.type) : FIELDS_FOR[target];
                if (!fields) {
                    out.ignored.push({ source: b.name, target });
                    continue;
                }
                const value = evalChange(c, b, data);
                if (value == null) { out.ignored.push({ source: b.name, target }); continue; }
                if (!value) continue;
                const type = String(c.type || 'untyped').toLowerCase();
                for (const field of fields) {
                    const entry = { source: b.name, value, type, field };
                    if (STACKING.has(type) || value < 0) { stackers.push(entry); continue; }
                    const key = field + '|' + type;
                    const cur = best.get(key);
                    if (!cur || value > cur.value) best.set(key, entry);
                }
            }
        }
        for (const e of [...stackers, ...best.values()]) {
            out[e.field] += e.value;
            out.sources[e.field].push(e);
            out.any = true;
        }
        return out;
    }

    /** Tooltip text for one field: "+2 morale (Inspire Courage) · +1 luck (Prayer)". */
    function describe(bonuses, field) {
        const parts = (bonuses?.sources?.[field] || [])
            .map((e) => `${e.value > 0 ? '+' : ''}${e.value} ${e.type} (${e.source})`);
        return parts.join(' · ');
    }

    // ---- mounted ------------------------------------------------------------------------- //

    /** The companion the master is riding, or null. `_sheet.mounted` holds its id. */
    function mountOf(data) {
        const id = data?._sheet?.mounted;
        if (!id) return null;
        const list = Array.isArray(data?._sheet?.companions) ? data._sheet.companions : [];
        return list.find((c) => c && c.id === id) || null;
    }
    function isMounted(data) { return !!mountOf(data); }

    /** Companions that can be ridden: anything the player has — the sheet warns, it never gates. */
    function rideable(data) {
        return (Array.isArray(data?._sheet?.companions) ? data._sheet.companions : [])
            .filter((c) => c && c.id);
    }

    // What the numbers can't carry, kept as tooltip prose (the conditions precedent).
    const MOUNTED_RULES = 'Mounted: you move with the mount (its speed, its actions to move). '
        + 'Ride DC 5 to guide with knees, DC 15 to negate a hit on the mount as an immediate '
        + 'action, DC 15 to fight from an untrained mount. A charging mount lets a lance deal '
        + 'double damage. If the mount moves more than 5 ft you get one melee attack, not a full '
        + 'attack; ranged attacks take −4 after a double move, −8 after a run. A mount larger than '
        + 'you grants cover against attackers on its far side; a smaller one grants none.';

    return { sharedBuffs, sharedBonuses, describe, mountOf, isMounted, rideable, MOUNTED_RULES, FIELDS };
})();
