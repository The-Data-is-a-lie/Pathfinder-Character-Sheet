// scripts/domain/buff-effects.js -- what a buff CHANGES, as a browsable taxonomy
// (window.SheetBuffEffects).
//
// The Buffs tab's "Browse" used to hand you the whole feat and item catalog behind a single text
// box: ~11,000 entries, and no way in unless you already knew the name of the thing you wanted.
// That is backwards for the question people actually arrive with, which is never "where is Shield
// Focus" but "what do I have that helps my AC".
//
// So the catalog is indexed by the one thing a buff objectively IS: its `changes[].target`s. Every
// target in the ledger vocabulary maps to exactly one bucket (see BUCKETS), an entry belongs to a
// category if any of its changes lands there, and an entry with no changes at all belongs to none
// — it would be noise in every list. Those are still reachable through the name search, which is
// deliberately kept one click away rather than replaced.
//
// The classification is DERIVED, never curated: no per-feat table to maintain, and a compendium
// rebuild that adds 200 feats files them automatically. The cost of that is honesty about the
// edges — a feat whose real effect lives in prose ("+2 on saves against fear") has no changes and
// so appears in no category. Silence beats filing it under a guess.
window.SheetBuffEffects = (function () {
    'use strict';

    /**
     * target -> category. Keys are the ledger's own target vocabulary (SheetDetails.TARGET_LABELS);
     * `skill.<id>` and anything unlisted are handled in bucketFor below.
     */
    const BUCKETS = {
        ac: 'defense', aac: 'defense', sac: 'defense', nac: 'defense', ffac: 'defense',
        tac: 'defense', cmd: 'defense', spellResist: 'defense',
        // Max-Dex is an AC ceiling, so it files with AC; the armour check penalty is filed under
        // Skills instead, because that is the number it actually moves on the sheet.
        mDexA: 'defense',
        attack: 'attack', mattack: 'attack', rattack: 'attack', allattack: 'attack',
        nattack: 'attack', critConfirm: 'attack', cmb: 'attack', bab: 'attack',
        damage: 'damage', wdamage: 'damage', mdamage: 'damage', rdamage: 'damage',
        ndamage: 'damage',
        fort: 'saves', ref: 'saves', will: 'saves', allSavingThrows: 'saves',
        skills: 'skills', unskills: 'skills', strSkills: 'skills', dexSkills: 'skills',
        conSkills: 'skills', intSkills: 'skills', wisSkills: 'skills', chaSkills: 'skills',
        bonusSkillRanks: 'skills', acpA: 'skills',
        str: 'abilities', dex: 'abilities', con: 'abilities', int: 'abilities',
        wis: 'abilities', cha: 'abilities',
        // Ability CHECKS are not the score, but someone hunting "what helps my Charisma" wants
        // them in the same place.
        allChecks: 'abilities', strChecks: 'abilities', dexChecks: 'abilities',
        conChecks: 'abilities', intChecks: 'abilities', wisChecks: 'abilities',
        chaChecks: 'abilities',
        landSpeed: 'movement', allSpeeds: 'movement', init: 'movement', swimSpeed: 'movement',
        climbSpeed: 'movement', flySpeed: 'movement', burrowSpeed: 'movement',
        mhp: 'health', hp: 'health', wounds: 'health', vigor: 'health',
        cl: 'casting', concentration: 'casting', dc: 'casting',
    };

    /** Display order of the category grid. `hint` is the second line on each tile. */
    const CATEGORIES = [
        { id: 'defense', icon: '🛡️', label: 'Defense', hint: 'AC, CMD, spell resistance' },
        { id: 'attack', icon: '⚔️', label: 'Attack', hint: 'to-hit, CMB, crit confirms' },
        { id: 'damage', icon: '💥', label: 'Damage', hint: 'weapon and melee damage' },
        { id: 'saves', icon: '🎯', label: 'Saving throws', hint: 'Fortitude, Reflex, Will' },
        { id: 'skills', icon: '📚', label: 'Skills', hint: 'one skill or all of them' },
        { id: 'abilities', icon: '💪', label: 'Ability scores', hint: 'Strength … Charisma' },
        { id: 'movement', icon: '🏃', label: 'Speed & initiative', hint: 'movement, going first' },
        { id: 'health', icon: '❤️', label: 'Hit points', hint: 'max HP, wounds, vigor' },
        { id: 'casting', icon: '✨', label: 'Spellcasting', hint: 'caster level, save DC' },
        { id: 'other', icon: '🎲', label: 'Something else', hint: 'carrying capacity, oddities' },
    ];
    const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

    /** Which category a single change target belongs to. Never null: unknowns fall to 'other'. */
    function bucketFor(target) {
        const t = String(target || '');
        if (!t) return null;
        if (t.startsWith('skill.')) return 'skills';
        return BUCKETS[t] || 'other';
    }

    /** The set of categories a changes[] array touches. Empty for a buff with no numbers. */
    function categorize(changes) {
        const out = new Set();
        for (const c of (Array.isArray(changes) ? changes : [])) {
            const b = bucketFor(c?.target);
            if (b) out.add(b);
        }
        return out;
    }

    // kind -> [{ key, name, kind, entry, changes, cats:Set }], built once on first use.
    const indexes = {};

    /**
     * Index one catalog kind. Reads through SheetDetails so the fetched-and-cached compendium
     * extracts are the only copy in memory — this stores references, not clones.
     */
    function indexKind(kind) {
        if (indexes[kind]) return indexes[kind];
        const rows = [];
        window.SheetDetails?.eachCatalogEntry?.(kind, (key, entry) => {
            const changes = Array.isArray(entry?.changes) ? entry.changes : [];
            if (!changes.length) return;
            const cats = categorize(changes);
            if (!cats.size) return;
            rows.push({ key, name: entry.name || key, kind, entry, changes, cats });
        });
        rows.sort((a, b) => a.name.localeCompare(b.name));
        indexes[kind] = rows;
        return rows;
    }

    /** A row's identity for dedupe: same name AND same changes is the same buff twice. */
    const signature = (row) => row.name.toLowerCase() + '|' + row.changes
        .map((c) => `${c.formula}${c.target}${c.type || ''}`).join(';');

    /**
     * How many entries each category has, for the tile badges. Deduped exactly as `search` is —
     * a badge that promises 100 and then lists 84 is worse than no badge.
     */
    function counts(kinds) {
        const out = {};
        const seen = {};
        for (const c of CATEGORIES) { out[c.id] = 0; seen[c.id] = new Set(); }
        for (const kind of kinds) {
            for (const row of indexKind(kind)) {
                const sig = signature(row);
                for (const cat of row.cats) {
                    if (seen[cat].has(sig)) continue;
                    seen[cat].add(sig);
                    out[cat] += 1;
                }
            }
        }
        return out;
    }

    /**
     * Entries in one category, optionally narrowed by a name query.
     * @returns {Array} index rows, prefix matches first.
     */
    function search(categoryId, query, opts = {}) {
        const kinds = opts.kinds || ['feats', 'items'];
        const limit = opts.limit || 80;
        const q = String(query || '').toLowerCase().trim();
        if (!CATEGORY_IDS.has(categoryId)) return [];
        const hits = [];
        // The same thing is often in two catalogs — the monk's AC Bonus is both a feat entry and a
        // class-feature entry, with byte-identical changes. Keep the first (kinds are in caller
        // priority order); a same-name entry with DIFFERENT changes is a different buff and stays,
        // because its own line under the name is what tells them apart.
        const seen = new Set();
        for (const kind of kinds) {
            for (const row of indexKind(kind)) {
                if (!row.cats.has(categoryId)) continue;
                if (q && !row.name.toLowerCase().includes(q) && !row.key.includes(q)) continue;
                const sig = signature(row);
                if (seen.has(sig)) continue;
                seen.add(sig);
                hits.push(row);
            }
        }
        hits.sort((a, b) => {
            if (q) {
                const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
                const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
                if (ap !== bp) return ap - bp;
            }
            return a.name.localeCompare(b.name);
        });
        return { rows: hits.slice(0, limit), total: hits.length };
    }

    /** The changes of one entry that landed it in this category — what the row should show. */
    function changesFor(row, categoryId) {
        return row.changes.filter((c) => bucketFor(c?.target) === categoryId);
    }

    return { CATEGORIES, BUCKETS, bucketFor, categorize, counts, search, changesFor, indexKind };
})();
