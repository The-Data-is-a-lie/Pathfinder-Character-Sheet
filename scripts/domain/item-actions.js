// scripts/domain/item-actions.js -- multi-action items (#152), window.SheetItemActions.
//
// One item or feature can hold several actions — a longsword's normal swing and its Power
// Attack swing, a feat with two different uses — each with its own attack, damage, save/DC,
// range and notes. pf1 calls these an item's actions and asks which one when there is more
// than one; this module is the model, item-actions-ui.js is the picker and the editor.
//
// Storage:
//   inventory item      item.actions = [action, …]
//   feat / trait / …    the feature override layer: setFeatureOverride(data, kind, name, { actions })
//                       (so rename, Revert, Copy to… and Export JSON carry it for free)
//
// action = { id, name, atk, dmg, dice, save, dc, range, notes }   (all strings but id/name)
//   On a WEAPON the base swing is always action #0 ("Normal", implicit, never stored), and a
//   stored action is a delta on top of it: atk / dmg are ADDED (formulas, dice allowed — e.g.
//   Power Attack "-floor(@attributes.bab.total / 4) - 1"), `dice` REPLACES the weapon dice.
//   On anything else an action is standalone: atk is the whole attack bonus (blank = no attack
//   roll), dmg the whole damage formula. save/dc/range/notes mean the same everywhere.
window.SheetItemActions = (function () {
    'use strict';

    const SAVES = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' };
    const FIELDS = ['atk', 'dmg', 'dice', 'save', 'dc', 'range', 'notes'];

    let seq = 0;
    const newId = () => 'act-' + Date.now().toString(36) + '-' + (seq++).toString(36);

    /** A clean copy of a stored list: ids filled, unknown keys and blank fields dropped. */
    function normalize(list) {
        if (!Array.isArray(list)) return [];
        const out = [];
        for (const raw of list) {
            if (!raw || typeof raw !== 'object') continue;
            const a = { id: String(raw.id || newId()), name: String(raw.name || '').trim() || 'Action' };
            for (const f of FIELDS) {
                const v = raw[f] == null ? '' : String(raw[f]).trim();
                if (v) a[f] = v;
            }
            if (a.save && !SAVES[a.save]) delete a.save;
            out.push(a);
        }
        return out;
    }

    function blank(name = 'New action') {
        return { id: newId(), name };
    }

    // ---- where actions live ----------------------------------------------------------- //
    function forItem(item) {
        return normalize(item?.actions);
    }
    function setForItem(item, list) {
        const clean = normalize(list);
        if (clean.length) item.actions = clean;
        else delete item.actions;
        return clean;
    }
    function forFeature(data, kind, name) {
        const ov = window.SheetDetails?.getFeatureOverride?.(data, kind, name);
        return normalize(ov?.actions);
    }
    function setForFeature(data, kind, name, list) {
        const clean = normalize(list);
        window.SheetDetails?.setFeatureOverride?.(data, kind, name, { actions: clean.length ? clean : null });
        return clean;
    }

    /** The choices a picker offers. Weapons always lead with the implicit Normal swing. */
    function choices(stored, { weapon = false } = {}) {
        const list = normalize(stored);
        return weapon ? [{ id: 'normal', name: 'Normal', normal: true }, ...list] : list;
    }
    /** Does this host need a picker? (Weapon: any stored action; otherwise more than one.) */
    const needsPicker = (stored, { weapon = false } = {}) => choices(stored, { weapon }).length > 1;

    // ---- evaluation --------------------------------------------------------------------- //
    /** A formula with @tokens folded, dice kept: { formula, unresolved } or null when blank. */
    function rollable(f, data) {
        const s = String(f || '').trim();
        if (!s) return null;
        const r = window.SheetFormula?.evaluateToRollable?.(s, data);
        if (r?.ok) return { formula: r.formula, unresolved: r.unresolved || [] };
        return { formula: s, unresolved: r?.unresolved || [], error: r?.error || '' };
    }
    /** DC as a number, or null (blank / not a number after evaluation). */
    function dcValue(action, data) {
        const s = String(action?.dc || '').trim();
        if (!s) return null;
        const r = window.SheetFormula?.evaluate?.(s, data);
        if (r?.ok && Number.isFinite(Number(r.value))) return Math.trunc(Number(r.value));
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    }
    /** One summary line: "Reflex DC 15 · 30 ft · notes". Empty string when nothing to say. */
    function summary(action, data) {
        if (!action) return '';
        const bits = [];
        const dc = dcValue(action, data);
        if (action.save) bits.push(SAVES[action.save] + (dc != null ? ` DC ${dc}` : ''));
        else if (dc != null) bits.push(`DC ${dc}`);
        if (action.range) bits.push(action.range);
        if (action.notes) bits.push(action.notes);
        return bits.join(' · ');
    }
    /** Short label for a picker row: "−3 atk · 2d6 dice · +6 dmg", formulas folded to numbers. */
    function deltaLabel(action, { weapon = false, data = null } = {}) {
        if (!action || action.normal) return 'the weapon as it is';
        const bits = [];
        const shown = (f, signed) => {
            const r = rollable(f, data);
            let s = r ? r.formula.replace(/\s+/g, ' ').trim() : String(f);
            const n = Number(s);
            if (Number.isFinite(n)) s = (n < 0 ? '−' + Math.abs(n) : (signed ? '+' : '') + n);
            else if (signed && !/^[+-]/.test(s)) s = '+' + s;
            return s;
        };
        if (action.atk) bits.push(shown(action.atk, true) + ' atk');
        if (action.dice) bits.push(action.dice + ' dice');
        if (action.dmg) bits.push(shown(action.dmg, weapon) + ' dmg');
        return bits.join(' · ');
    }

    return {
        SAVES, normalize, blank, forItem, setForItem, forFeature, setForFeature,
        choices, needsPicker, rollable, dcValue, summary, deltaLabel,
    };
})();
