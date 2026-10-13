// scripts/domain/row-verbs.js -- Duplicate and Split on list rows (window.SheetRowVerbs, #154).
// Buffs already had ⧉; this states the verb once for the other lists:
//
//   - an inventory item copies whole (new id, same name, inserted after the original). The copy
//     starts UNEQUIPPED, as Buffs' copy starts inactive, so duplicating armour cannot quietly
//     double its AC;
//   - a split moves half a stack (Shift: one) into a new row right below, with no dialog. The
//     moved part is likewise unequipped: an equipped stack's changes apply once per row;
//   - a feature or spell is a NAME in a list, and those lists refuse duplicate names, so the copy
//     is "<name> (copy)". The compendium lookup strips parentheticals, so the copy still reads the
//     catalog entry, and any sheet edit (description, tags, details) is copied across. Generator
//     dicts keyed by the original name (feat_changes_dict…) stay with the original.
//
// Every verb returns an undo() so the caller's toast can offer it.
window.SheetRowVerbs = (function () {
    'use strict';

    let seq = 0;
    const newItemId = (item) => 'eq:' + String(item?.name || 'item').toLowerCase().replace(/\s+/g, '-')
        + '-' + Date.now() + '-c' + (++seq);
    const clone = (o) => (typeof structuredClone === 'function'
        ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

    /** "<name> (copy)", then "(copy 2)", "(copy 3)"… — the first not in `taken` (lowercase). */
    function copyName(name, taken) {
        const base = String(name || '').trim() || 'Copy';
        for (let i = 1; ; i++) {
            const nm = base + (i === 1 ? ' (copy)' : ` (copy ${i})`);
            if (!taken.has(nm.toLowerCase())) return nm;
        }
    }

    // Undo looks the row up by id at undo time: a render may normalize the list's objects.
    const findById = (data, id) => (data.equipment_list || []).find((x) => x && x.id === id) || null;
    function insertAfter(data, original, entry) {
        const list = data.equipment_list || (data.equipment_list = []);
        const i = list.indexOf(original);
        list.splice(i >= 0 ? i + 1 : list.length, 0, entry);
        return () => {
            const cur = data.equipment_list || [];
            const j = cur.findIndex((x) => x && x.id === entry.id);
            if (j >= 0) cur.splice(j, 1);
        };
    }

    /** Copy an inventory item in place. → { copy, undo } */
    function duplicateItem(data, item) {
        const copy = clone(item);
        copy.id = newItemId(item);
        copy.equipped = false;
        return { copy, undo: insertAfter(data, item, copy) };
    }

    /**
     * Split `n` off a stack into a new row below (default: half, rounded down). Null when the
     * stack has fewer than two. → { part, undo }
     */
    function splitStack(data, item, n) {
        const q = Math.floor(Number(item.quantity) || 0);
        if (q < 2) return null;
        const take = Math.min(q - 1, Math.max(1, Math.floor(n ?? q / 2)));
        const part = clone(item);
        part.id = newItemId(item);
        part.quantity = take;
        part.equipped = false;
        item.quantity = q - take;
        const remove = insertAfter(data, item, part);
        return {
            part,
            undo: () => {
                remove();
                const orig = (item.id && findById(data, item.id)) || item;
                orig.quantity = (Number(orig.quantity) || 0) + take;
            },
        };
    }

    /**
     * Copy a name-list entry (feat, trait, class feature, spell) as "<name> (copy)" right after
     * the original in `list`, carrying its sheet edits. `kind` is the SheetDetails override kind.
     * → { name, undo }
     */
    function duplicateNamed(data, kind, list, name) {
        const SD = window.SheetDetails;
        const taken = new Set();
        for (const arr of [list, ...(SD?.membershipArrays?.(data, kind) || [])]) {
            for (const x of arr || []) taken.add(String(x || '').toLowerCase());
        }
        const nm = copyName(name, taken);
        const i = list.findIndex((x) => String(x) === String(name));
        list.splice(i >= 0 ? i + 1 : list.length, 0, nm);
        const ov = SD?.getFeatureOverride?.(data, kind, name);
        if (ov) {
            const { kind: _k, name: _n, ...rest } = clone(ov);
            SD.setFeatureOverride(data, kind, nm, rest);
        }
        return {
            name: nm,
            undo: () => {
                const j = list.findIndex((x) => String(x) === nm);
                if (j >= 0) list.splice(j, 1);
                SD?.clearFeatureOverride?.(data, kind, nm);
            },
        };
    }

    /** Stepper size from a click: Shift ×5, Ctrl/⌘ ×10, else 1. */
    const stepSize = (e) => (e?.ctrlKey || e?.metaKey ? 10 : e?.shiftKey ? 5 : 1);

    return { copyName, duplicateItem, splitStack, duplicateNamed, stepSize };
})();
