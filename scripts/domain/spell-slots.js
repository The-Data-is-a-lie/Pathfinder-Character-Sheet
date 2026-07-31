// scripts/domain/spell-slots.js — #23: standard PF1 spells-per-day progressions
// (window.SheetSpellSlots). ADVISORY ONLY: the Spells tab compares the hand-entered
// per-day numbers against these and badges differences ("table: N") — it never writes
// or clamps a cell; the one-click "Use table values" button is the only writer, and the
// user pushes it. Classes without a listed table (arcanist, medium, prestige
// progressions…) get NO expectation rather than a wrong one.
window.SheetSpellSlots = (function () {
    'use strict';

    // Four canonical shapes, validated against the d20pfsrd class tables. Rows are
    // class levels 1–20; columns are slots per SPELL level (index 0 = cantrips).
    // null = the table has no expectation there (at-will cantrips, level not reached).
    const P9 = [ // 9-level prepared (wizard numbers; cleric/druid/witch/shaman share them)
        [3, 1], [4, 2], [4, 2, 1], [4, 3, 2], [4, 3, 2, 1], [4, 3, 3, 2],
        [4, 4, 3, 2, 1], [4, 4, 3, 3, 2], [4, 4, 4, 3, 2, 1], [4, 4, 4, 3, 3, 2],
        [4, 4, 4, 4, 3, 2, 1], [4, 4, 4, 4, 3, 3, 2],
        [4, 4, 4, 4, 4, 3, 2, 1], [4, 4, 4, 4, 4, 3, 3, 2],
        [4, 4, 4, 4, 4, 4, 3, 2, 1], [4, 4, 4, 4, 4, 4, 3, 3, 2],
        [4, 4, 4, 4, 4, 4, 4, 3, 2, 1], [4, 4, 4, 4, 4, 4, 4, 3, 3, 2],
        [4, 4, 4, 4, 4, 4, 4, 4, 3, 3], [4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
    ];
    const S9 = [ // 9-level spontaneous (sorcerer numbers; cantrips are at will)
        [null, 3], [null, 4], [null, 5], [null, 6, 3], [null, 6, 4], [null, 6, 5, 3],
        [null, 6, 6, 4], [null, 6, 6, 5, 3], [null, 6, 6, 6, 4], [null, 6, 6, 6, 5, 3],
        [null, 6, 6, 6, 6, 4], [null, 6, 6, 6, 6, 5, 3], [null, 6, 6, 6, 6, 6, 4],
        [null, 6, 6, 6, 6, 6, 5, 3], [null, 6, 6, 6, 6, 6, 6, 4],
        [null, 6, 6, 6, 6, 6, 6, 5, 3], [null, 6, 6, 6, 6, 6, 6, 6, 4],
        [null, 6, 6, 6, 6, 6, 6, 6, 5, 3], [null, 6, 6, 6, 6, 6, 6, 6, 6, 4],
        [null, 6, 6, 6, 6, 6, 6, 6, 6, 6],
    ];
    const B6 = [ // 6-level (bard numbers; the 6-level casters share the shape)
        [null, 1], [null, 2], [null, 3], [null, 3, 1], [null, 4, 2], [null, 4, 3],
        [null, 4, 3, 1], [null, 4, 4, 2], [null, 5, 4, 3], [null, 5, 4, 3, 1],
        [null, 5, 4, 4, 2], [null, 5, 5, 4, 3], [null, 5, 5, 4, 3, 1],
        [null, 5, 5, 4, 4, 2], [null, 5, 5, 5, 4, 3], [null, 5, 5, 5, 4, 3, 1],
        [null, 5, 5, 5, 4, 4, 2], [null, 5, 5, 5, 5, 4, 3], [null, 5, 5, 5, 5, 5, 4],
        [null, 5, 5, 5, 5, 5, 5],
    ];
    const D4 = [ // 4-level delayed (paladin numbers; casting starts at class level 4)
        [], [], [], [null, 0], [null, 1], [null, 1], [null, 1, 0], [null, 1, 1],
        [null, 2, 1], [null, 2, 1, 0], [null, 2, 1, 1], [null, 2, 2, 1],
        [null, 3, 2, 1, 0], [null, 3, 2, 1, 1], [null, 3, 2, 2, 1], [null, 3, 3, 2, 1],
        [null, 4, 3, 2, 1], [null, 4, 3, 2, 2], [null, 4, 3, 3, 2], [null, 4, 4, 3, 3],
    ];

    const CLASS_TABLES = {
        wizard: P9, cleric: P9, druid: P9, witch: P9, shaman: P9,
        sorcerer: S9, oracle: S9, psychic: S9,
        bard: B6, skald: B6, inquisitor: B6, magus: B6, warpriest: B6,
        summoner: B6, 'summoner (unchained)': B6, alchemist: B6, investigator: B6,
        hunter: B6, mesmerist: B6, occultist: B6, spiritualist: B6,
        paladin: D4, antipaladin: D4, ranger: D4, bloodrager: D4,
    };

    /** PF1 bonus slots from the casting ability: for spell level L ≥ 1 with mod ≥ L,
     *  one slot plus one more per 4 points of mod beyond L. */
    function bonusSlots(castMod, spellLevel) {
        const m = Number(castMod) || 0;
        if (spellLevel < 1 || m < spellLevel) return 0;
        return Math.floor((m - spellLevel) / 4) + 1;
    }

    /**
     * Expected per-day slots for `className` at `classLevel` with casting mod
     * `castMod`. Returns null when there is no table for the class (or no level);
     * otherwise an array indexed by spell level 0–9 where null = no expectation.
     * A table "0" still gets ability bonus slots (the paladin-at-4 case), per PF1.
     */
    function expectedSlots(className, classLevel, castMod) {
        const tbl = CLASS_TABLES[String(className || '').toLowerCase().trim()];
        const lvl = Number(classLevel) || 0;
        if (!tbl || lvl < 1) return null;
        const row = tbl[Math.min(20, lvl) - 1] || [];
        const out = [];
        for (let L = 0; L <= 9; L++) {
            const base = row[L];
            out.push(base == null ? null : base + bonusSlots(castMod, L));
        }
        return out;
    }

    return { expectedSlots, bonusSlots, CLASS_TABLES };
})();
