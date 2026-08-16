// The uniform list contract — the rules every "list of things" tab on this sheet obeys, in
// one place, with no DOM in sight.
//
// Six tabs (Inventory, Features, Path of War, Spells, Psionics, Buffs) each grew their own
// row layout, add flow, delete model and reorder behaviour. They had already drifted toward
// the same shape by accident; this module states that shape once so the drift stops.
//
// Two rules live here because they are the ones that are easy to get subtly wrong per-tab:
//
//   1. MOVING. A list is stored flat but displayed grouped by section, so an index the user
//      sees ("third row of Spell") is never an index into the array. moveGrouped translates
//      one into the other, and re-tags the item when it lands in a different section.
//
//      Whether a cross-section drop is *allowed* is a separate question, answered by
//      canDropInto: a drop is a shortcut for an edit the row's detail sheet could already
//      make. Where the sheet cannot set that property — a Path of War maneuver is not a
//      stance, a feat is not a trait — the drop is refused and the row springs back. That
//      keeps drag from reaching any state the user could not reach by hand, which is what
//      makes it safe to do without a confirm dialog.
//
//   2. DELETING is soft. Removing a row moves it to a trash list rather than splicing it
//      away, so a mis-drop or a mis-tap costs one click instead of re-authoring a buff. This
//      repo has already reached for that model twice (removedBuffSources for always-on
//      sources, and health-check's finding mutes) and it is the one that fits a sheet whose
//      stated philosophy is to warn rather than block. Keeping the trashed object whole —
//      rather than flagging it in place — also means nothing downstream needs a new guard:
//      the changes ledger walks _sheet.buffs and simply never sees it.

window.SheetListContract = (function () {
    'use strict';

    /**
     * Move `item` inside a flat array that is displayed grouped into sections.
     *
     * @param {Array} arr            the flat backing array (mutated in place)
     * @param {*} item               the entry being moved
     * @param {string} toSection     section it is landing in
     * @param {number} insertAt      index among that section's members, the section's
     *                               members having been counted WITHOUT `item`
     * @param {{sectionOf: Function, setSection?: Function}} opts
     * @returns {boolean}            false when `item` is not in `arr`
     */
    function moveGrouped(arr, item, toSection, insertAt, opts) {
        if (!Array.isArray(arr) || !item) return false;
        const { sectionOf, setSection } = opts || {};
        if (typeof sectionOf !== 'function') return false;

        const at = arr.indexOf(item);
        if (at < 0) return false;
        arr.splice(at, 1);

        // Re-tag before measuring, so a same-section move and a cross-section move take
        // the identical path below.
        if (setSection && sectionOf(item) !== toSection) setSection(item, toSection);

        // `item` is already out of `arr`, so these are exactly the members the caller
        // counted insertAt against.
        const members = arr.filter((x) => sectionOf(x) === toSection);
        const anchor = members[insertAt];
        let index;
        if (anchor) {
            index = arr.indexOf(anchor);
        } else if (members.length) {
            // Past the last member of a non-empty section: sit directly after it, NOT at the
            // end of the array, or the row would jump into whichever section renders last.
            index = arr.indexOf(members[members.length - 1]) + 1;
        } else {
            index = arr.length;
        }
        arr.splice(index, 0, item);
        return true;
    }

    /**
     * May a row from `fromSection` be dropped into `toSection`?
     *
     * `settable` is the tab's answer to "can this row's detail sheet change the property
     * this section is keyed on?" — true for a free-form tag (a buff's subtype), false where
     * the section reflects what the object fundamentally IS.
     */
    function canDropInto(fromSection, toSection, settable) {
        if (fromSection === toSection) return true;   // pure reorder, always fine
        return settable === true;
    }

    /** Soft delete: out of the live list, into the trash, recoverable. */
    function trash(arr, trashArr, item) {
        if (!Array.isArray(arr) || !Array.isArray(trashArr) || !item) return false;
        const at = arr.indexOf(item);
        if (at < 0) return false;
        arr.splice(at, 1);
        trashArr.push(item);
        return true;
    }

    /** Undo one soft delete, putting the row back where it was. */
    function untrash(arr, trashArr, item, index) {
        if (!Array.isArray(arr) || !Array.isArray(trashArr) || !item) return false;
        const at = trashArr.indexOf(item);
        if (at < 0) return false;
        trashArr.splice(at, 1);
        const i = Number.isInteger(index) && index >= 0 && index <= arr.length ? index : arr.length;
        arr.splice(i, 0, item);
        return true;
    }

    /** Empty the trash back into the live list (the "Restore removed (N)" button). */
    function untrashAll(arr, trashArr) {
        if (!Array.isArray(arr) || !Array.isArray(trashArr)) return 0;
        const n = trashArr.length;
        while (trashArr.length) arr.push(trashArr.shift());
        return n;
    }

    return { moveGrouped, canDropInto, trash, untrash, untrashAll };
})();
