// scripts/domain/creature.js -- the creature chassis (window.SheetCreature), #112 phase 2.
//
// Until now this sheet had no monster model at all: no creature type, and no hit dice. "HD" was
// `SheetDerive.totalLevel()` — class levels — which is right for an NPC built out of PC classes and
// wrong for everything Paizo prints in a Bestiary. That gap is why the zombie/skeleton rebuild
// templates could not be written: they replace a creature's HD and type, and there was nothing to
// replace.
//
// The model is deliberately additive and empty by default:
//
//     _sheet.creature = { type, subtypes: [], racialHD: { count, die, bab, saves[], skills } }
//
// A character with no `_sheet.creature` behaves exactly as before — `totalHD` falls back to
// `totalLevel`, and no BAB, save, HP or skill number moves. Racial HD stack ON TOP of class levels,
// which is how PF1 works: a gnoll fighter 3 is 2 racial HD + 3 class levels.
//
// The type table lives in `data/creature-types.json` (fetched once, cached) rather than in code,
// because it is data — HD size, BAB progression, good saves, skills per HD, and the standing traits
// that are prose. `chassisFor()` fills the racial-HD block from the type so a user picking "undead"
// gets d8 / medium BAB / good Will without knowing the table.
window.SheetCreature = (function () {
    'use strict';

    let TABLE = { types: [], subtypes: [] };
    let loading = null;

    /** Fetch the type table once. Everything here works (empty) before it resolves. */
    function load() {
        if (loading) return loading;
        loading = fetch('data/creature-types.json')
            .then((resp) => {
                if (!resp.ok) return null;
                // #61: hand the offline cache a clone, the same way details.js warms every
                // compendium fetch. The worker cannot catch this one on a first visit.
                window.SheetPWA?.warmCache?.('data/creature-types.json', resp.clone());
                return resp.json();
            })
            .then((json) => {
                if (json) TABLE = json;
                return TABLE;
            })
            .catch(() => TABLE);
        return loading;
    }

    const types = () => TABLE.types || [];
    const subtypeOptions = () => TABLE.subtypes || [];
    const typeById = (id) => types().find((t) => t.id === String(id || '').toLowerCase()) || null;

    // BAB and save progressions, PF1's three curves. Racial HD use the same tables monsters do.
    const BAB_RATE = { high: 1, med: 0.75, low: 0.5 };
    const babFor = (rate, hd) => Math.floor((BAB_RATE[rate] ?? 0.75) * (Number(hd) || 0));
    const saveFor = (good, hd) => {
        const n = Number(hd) || 0;
        if (!n) return 0;
        return good ? 2 + Math.floor(n / 2) : Math.floor(n / 3);
    };

    /** The racial-HD block a type implies, for `count` dice. */
    function chassisFor(typeId, count) {
        const type = typeById(typeId);
        return {
            count: Math.max(0, Number(count) || 0),
            die: type?.hd || 8,
            bab: type?.bab || 'med',
            saves: [...(type?.saves || [])],
            skills: type?.skills || 2,
        };
    }

    /** `_sheet.creature`, created empty on first read. Empty means "an ordinary character". */
    function ensureCreature(data) {
        const st = (data._sheet ??= {});
        const c = (st.creature ??= {});
        c.type = typeof c.type === 'string' ? c.type : '';
        c.subtypes = Array.isArray(c.subtypes) ? c.subtypes.filter((s) => typeof s === 'string') : [];
        const hd = c.racialHD && typeof c.racialHD === 'object' ? c.racialHD : {};
        c.racialHD = {
            count: Math.max(0, Number(hd.count) || 0),
            die: Number(hd.die) || (typeById(c.type)?.hd || 8),
            bab: ['high', 'med', 'low'].includes(hd.bab) ? hd.bab : (typeById(c.type)?.bab || 'med'),
            saves: Array.isArray(hd.saves) ? hd.saves.filter((s) => ['fort', 'ref', 'will'].includes(s))
                : [...(typeById(c.type)?.saves || [])],
            skills: Number(hd.skills) || (typeById(c.type)?.skills || 2),
        };
        return c;
    }

    /** Racial hit dice only — 0 for every ordinary character. */
    function racialHD(data) {
        return Math.max(0, Number(data?._sheet?.creature?.racialHD?.count) || 0);
    }

    /** What racial HD contribute, or null when there are none (the overwhelmingly common case). */
    function racialContribution(data) {
        const n = racialHD(data);
        if (!n) return null;
        const hd = data._sheet.creature.racialHD;
        const type = typeById(data._sheet.creature.type);
        return {
            count: n,
            die: hd.die,
            label: `${type ? type.label : 'Racial'} ${n} HD`,
            bab: babFor(hd.bab, n),
            saves: {
                fort: saveFor(hd.saves.includes('fort'), n),
                ref: saveFor(hd.saves.includes('ref'), n),
                will: saveFor(hd.saves.includes('will'), n),
            },
            skillRanks: Math.max(1, Number(hd.skills) || 2) * n,
        };
    }

    /** The standing traits of the creature's type — prose, surfaced on Attributes. */
    function typeTraits(data) {
        const type = typeById(data?._sheet?.creature?.type);
        return type ? [...(type.traits || [])] : [];
    }

    /** "Undead (incorporeal, evil)" — or '' for an ordinary character. */
    function describe(data) {
        const c = data?._sheet?.creature;
        const type = typeById(c?.type);
        if (!type) return '';
        const subs = (c.subtypes || []).filter(Boolean);
        return type.label + (subs.length ? ` (${subs.join(', ')})` : '');
    }

    return { load, types, typeById, subtypeOptions, chassisFor, ensureCreature,
        racialHD, racialContribution, typeTraits, describe, babFor, saveFor };
})();
