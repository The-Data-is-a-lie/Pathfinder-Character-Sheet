// scripts/domain/creature-templates.js -- the seven PF1 *simple* creature templates
// (window.SheetTemplates, #78).
//
// MECHANISM, per the ticket's grill decision: a template is a **reversible buff-like toggle**,
// never a destructive transform. Applying one creates a single buff in the Template category
// carrying its ledger changes and (for Giant/Young) a `setSize`; unchecking Active undoes the
// whole thing, and × deletes it. Stacking is allowed because PF1 allows it — Advanced Giant is
// a legal creature — and size conflicts resolve through the existing `setSize` precedence.
//
// Numeric parts land as changes. DR, energy resistance, darkvision and smite carry as
// **description notes only** until buff→Defenses-chip support exists (split out as #112) —
// but the note is *resolved*, not generic: the HD-banded DR/resistance table is read down to
// the row this character is actually on.
//
// CURATION SOURCE: the numbers are the pf1 system's own `monster-templates` compendium
// (`Advanced (Rebuild)`, `Giant (Rebuild)`, `Young (Rebuild)`, Celestial, Fiendish, Entropic,
// Resolute), which is the rebuild-rules reading of the Bestiary tables. Three formulas needed
// translating into this sheet's evaluator vocabulary — each is called out at its use site.
window.SheetTemplates = (function () {
    'use strict';

    const chg = (formula, target, type = 'untyped') => ({
        formula: String(formula), target, type, operator: 'add', priority: 0,
    });

    /** The HD band a creature is on, for the celestial/fiendish/entropic/resolute table. */
    function drBand(hd) {
        if (hd >= 11) return { resist: 15, dr: 10 };
        if (hd >= 5) return { resist: 10, dr: 5 };
        return { resist: 5, dr: 0 };
    }
    /** Shared body of the four outsider-flavoured templates — they differ only in flavour. */
    function planarTemplate(id, label, energies, bypass, smite) {
        return {
            id,
            label,
            cr: '+1 at 5+ HD',
            summary: `Planar ${label.toLowerCase()} kin: resistances, DR/${bypass}, SR, and smite ${smite}.`,
            changes: [
                // pf1 writes this as `@details.cr.total + 5`. This sheet has no CR field, so it
                // uses hit dice — the standard CR≈HD reading for an NPC, and stated in the note.
                chg('@attributes.hd.total + 5', 'spellResist'),
            ],
            notes(hd) {   // (data unused: the planar templates read only hit dice)
                const band = drBand(hd);
                return [
                    'Darkvision 60 ft.',
                    `Resist ${energies.join(', ')} ${band.resist}`,
                    band.dr ? `DR ${band.dr}/${bypass}` : `No DR until 5 HD`,
                    `Spell resistance = CR + 5 (read as hit dice + 5 here — this sheet has no CR field)`,
                    `Smite ${smite} 1/day as a swift action: add your Cha bonus to attack rolls and `
                        + `${hd} damage against ${smite} foes, until it dies or you rest.`,
                ];
            },
        };
    }

    const TEMPLATES = [
        {
            id: 'advanced',
            label: 'Advanced',
            cr: '+1',
            summary: 'Fiercer than its ordinary cousins: +4 to every ability score, +2 natural armor.',
            changes: [
                chg(2, 'nac', 'untypedPerm'),
                chg(4, 'str', 'untypedPerm'),
                chg(4, 'dex', 'untypedPerm'),
                chg(4, 'con', 'untypedPerm'),
                chg(4, 'wis', 'untypedPerm'),
                chg(4, 'cha', 'untypedPerm'),
            ],
            /**
             * "+4 to all ability scores except Int scores of 2 or less."
             *
             * pf1 encodes the exception as a formula (`if(gt(@abilities.int.total, 2), 4)`) and
             * this evaluator could express it as `ifelse(...)` — but it must not. Ability-targeted
             * ledger changes are resolved by the *simple* evaluator precisely because a formula
             * that reads `@abilities.int.total` from inside an `int` change is circular. So the
             * exception is decided here, against the real score, and the change is simply
             * omitted for a beast: re-applying re-decides it.
             */
            changesFor(data, changes) {
                const int = window.SheetDerive?.abilityInfo?.(data, 'int')?.total;
                if (int != null && int <= 2) return changes;
                return [...changes, chg(4, 'int', 'untypedPerm')];
            },
            notes(hd, data) {
                const int = window.SheetDerive?.abilityInfo?.(data, 'int')?.total;
                return (int != null && int <= 2)
                    ? ['Intelligence stays put — the template skips Int scores of 2 or less.']
                    : [];
            },
        },
        {
            id: 'giant',
            label: 'Giant',
            cr: '+1',
            summary: 'One size category larger: +4 Str/Con, −2 Dex, +3 natural armor, bigger damage dice.',
            sizeStep: 1,
            changes: [
                chg(4, 'str', 'size'),
                chg(4, 'con', 'size'),
                chg(-2, 'dex'),
                chg(3, 'nac'),
            ],
            notes: () => ['Damage dice step up one category with the size change (handled automatically).'],
        },
        {
            id: 'young',
            label: 'Young',
            cr: '−1',
            summary: 'An immature or smaller specimen: one size down, −4 Str/Con, +4 Dex, −2 natural armor.',
            sizeStep: -1,
            changes: [
                chg(-4, 'str'),
                chg(-4, 'con'),
                chg(4, 'dex', 'size'),
                // pf1 floors this at 0 with `-min(2, @ac.natural.total)`; that variable does not
                // exist here, so it is a flat −2 and the note says to zero it out by hand if the
                // creature had less than 2 natural armor to give.
                chg(-2, 'nac'),
            ],
            notes: () => [
                'Damage dice step down one category with the size change (handled automatically).',
                'Natural armor should not go below +0 — if this creature had less than +2 to begin '
                    + 'with, trim the −2 in this buff’s Changes.',
            ],
        },
        planarTemplate('celestial', 'Celestial', ['acid', 'cold', 'electricity'], 'evil', 'evil'),
        planarTemplate('fiendish', 'Fiendish', ['cold', 'fire'], 'good', 'good'),
        planarTemplate('entropic', 'Entropic', ['acid', 'fire'], 'lawful', 'law'),
        planarTemplate('resolute', 'Resolute', ['acid', 'cold', 'fire'], 'chaotic', 'chaos'),
    ];

    const byId = (id) => TEMPLATES.find((t) => t.id === id) || null;
    const autoKeyFor = (id) => 'template:' + id;

    /** The buff a template created, if it is still on this character. */
    function appliedBuff(data, id) {
        const buffs = data?._sheet?.buffs;
        if (!Array.isArray(buffs)) return null;
        return buffs.find((b) => b && b.autoKey === autoKeyFor(id)) || null;
    }
    /** Every template currently on the character, applied-order. */
    function appliedTemplates(data) {
        return TEMPLATES.filter((t) => appliedBuff(data, t.id));
    }

    /**
     * Resolve the size a size-changing template moves this character to, from where they
     * stand RIGHT NOW — which includes any template already applied. That is what makes
     * stacking work: Giant on a Medium creature sets Large, and a second Giant on top reads
     * Large and sets Huge, because `sizeInfo` already folds active `setSize` buffs in.
     * Returns '' at the ends of the ladder (Colossal cannot grow, Fine cannot shrink).
     */
    function nextSize(data, step) {
        const SIZES = window.SheetData?.SIZES || [];
        const current = window.SheetDerive?.sizeInfo?.(data)?.id || 'medium';
        const i = SIZES.findIndex((s) => s.id === current);
        if (i < 0) return '';
        const target = SIZES[i + step];
        return target ? target.id : '';
    }

    /**
     * Apply (or refresh) a template.
     *
     * Re-applying an already-applied template REFRESHES it in place rather than stacking a
     * duplicate — the same `autoKey` discipline spell-cast buffs use. That is also the fix for
     * the one thing frozen at apply time: the HD-banded DR/resistance note. Level up, hit
     * Templates again, and the note re-reads the table.
     *
     * @returns {object|null} the buff, or null for an unknown id.
     */
    function applyTemplate(data, id) {
        const tpl = byId(id);
        if (!data || !tpl) return null;
        const S = window.SheetState;
        const buffs = S.ensureBuffs(data);
        const hd = Math.max(1, Number(window.SheetDerive?.totalLevel?.(data)) || 1);
        const notes = tpl.notes(hd, data);
        const setSize = tpl.sizeStep ? nextSize(data, tpl.sizeStep) : '';
        const base = tpl.changes.map((c) => ({ ...c }));
        const fields = {
            name: tpl.label + ' creature',
            subType: 'template',
            active: true,
            // A template may decide part of itself from the character it is landing on (see
            // Advanced's Int exception) rather than from a formula the ledger has to re-run.
            changes: tpl.changesFor ? tpl.changesFor(data, base) : base,
            setSize,
            notes: notes.join(' · '),
            autoKey: autoKeyFor(id),
        };
        let buff = appliedBuff(data, id);
        if (buff) Object.assign(buff, S.normalizeBuffEntry({ ...buff, ...fields }));
        else {
            buff = S.normalizeBuffEntry(fields);
            buffs.push(buff);
        }
        window.SheetApp?.quietSave?.();
        return buff;
    }
    /** Remove a template's buff entirely (unchecking Active is the non-destructive version). */
    function removeTemplate(data, id) {
        const buffs = data?._sheet?.buffs;
        if (!Array.isArray(buffs)) return false;
        const i = buffs.findIndex((b) => b && b.autoKey === autoKeyFor(id));
        if (i < 0) return false;
        buffs.splice(i, 1);
        window.SheetApp?.quietSave?.();
        return true;
    }

    return {
        TEMPLATES, byId, applyTemplate, removeTemplate, appliedTemplates, appliedBuff,
        autoKeyFor, drBand, nextSize,
    };
})();
