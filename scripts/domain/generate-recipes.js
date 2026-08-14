// scripts/domain/generate-recipes.js -- client-side recipes over the EXISTING generate endpoint
// (window.SheetRecipes): related NPCs (#73) and CR-budgeted encounter sets (#74).
//
// Both tickets originally assumed a new backend endpoint and a Render deploy. Their grills
// concluded otherwise, and this module is why: everything here is *parameter derivation*. The
// sheet reads what it already knows (an open character, or an APL and a difficulty), works out
// what to ask `/update_character_data` for, and posts the same payload the Generate form
// posts. Zero backend work — which also means these features ship independent of any deploy.
//
// Nothing in this file performs network I/O or touches the DOM; `SheetGenerate.generateCustom`
// does the posting and `scripts/recipes-ui.js` does the asking.
window.SheetRecipes = (function () {
    'use strict';

    const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const lc = (v) => String(v || '').toLowerCase().trim();

    // ------------------------------------------------------------------ alignment algebra
    // The generator's own option values (index.html), as a 3×3 grid so "one step off" and
    // "opposed" are arithmetic rather than a lookup table of 81 pairs.
    const LAW = ['l', 'n', 'c'];     // lawful → chaotic
    const GOOD = ['g', 'n', 'e'];    // good → evil
    const ALIGN_LABELS = {
        lg: 'Lawful Good', ln: 'Lawful Neutral', le: 'Lawful Evil',
        ng: 'Neutral Good', n: 'Neutral', ne: 'Neutral Evil',
        cg: 'Chaotic Good', cn: 'Chaotic Neutral', ce: 'Chaotic Evil',
    };
    /** Any of "le", "Lawful Evil", "lawful evil" → the generator's option value. */
    function alignCode(raw) {
        const s = lc(raw).replace(/[^a-z ]/g, '');
        if (ALIGN_LABELS[s]) return s;
        if (s === 'true neutral' || s === 'neutral') return 'n';
        const law = /lawful/.test(s) ? 'l' : /chaotic/.test(s) ? 'c' : 'n';
        const good = /good/.test(s) ? 'g' : /evil/.test(s) ? 'e' : 'n';
        const code = (law === 'n' && good === 'n') ? 'n' : law + good;
        return ALIGN_LABELS[code] ? code : '';
    }
    const axes = (code) => (code === 'n' ? ['n', 'n'] : [code[0], code[1]]);
    const join = (l, g) => (l === 'n' && g === 'n' ? 'n' : l + g);
    /** Mirror both axes: Lawful Good → Chaotic Evil. True Neutral has no opposite, so it stays. */
    function opposedAlign(code) {
        const c = alignCode(code);
        if (!c) return 'random';
        const [l, g] = axes(c);
        return join(LAW[2 - LAW.indexOf(l)], GOOD[2 - GOOD.indexOf(g)]);
    }
    /** Move ONE axis by one notch — near enough to grate, close enough to have history. */
    function alignOneStep(code) {
        const c = alignCode(code);
        if (!c) return 'random';
        const [l, g] = axes(c);
        const li = LAW.indexOf(l);
        const gi = GOOD.indexOf(g);
        // Shift the axis that has room to move; prefer the ethical axis for variety.
        if (li < 2) return join(LAW[li + 1], g);
        if (gi < 2) return join(l, GOOD[gi + 1]);
        return join(LAW[li - 1], g);
    }

    // ------------------------------------------------------------------ class relationships
    // Rough role buckets, only ever used to pick a *plausible* counterpart class. Nothing
    // mechanical hangs off these — a wrong bucket costs one uninspired NPC, not a wrong number.
    const ROLES = {
        martial: ['Fighter', 'Barbarian', 'Cavalier', 'Ranger', 'Slayer', 'Samurai', 'Brawler',
            'Swashbuckler', 'Gunslinger', 'Warlord', 'Warder', 'Stalker'],
        divine: ['Cleric', 'Druid', 'Oracle', 'Inquisitor', 'Paladin', 'Antipaladin', 'Warpriest',
            'Shaman', 'Hunter'],
        arcane: ['Wizard', 'Sorcerer', 'Arcanist', 'Magus', 'Witch', 'Summoner', 'Bloodrager'],
        skill: ['Rogue', 'Bard', 'Investigator', 'Ninja', 'Vigilante', 'Alchemist', 'Skald',
            'Monk', 'Shifter'],
    };
    function roleOf(className) {
        const n = lc(className);
        for (const [role, list] of Object.entries(ROLES)) {
            if (list.some((c) => lc(c) === n)) return role;
        }
        return 'martial';
    }
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    /** A class that answers the source's: the counter-role's typical pick. */
    const COUNTERS = { martial: 'skill', skill: 'arcane', arcane: 'divine', divine: 'martial' };
    const COMPLEMENTS = { martial: 'divine', divine: 'martial', arcane: 'skill', skill: 'arcane' };

    /** Everything a recipe needs to read off the open character, in generator vocabulary. */
    function sourceParams(data) {
        return {
            name: String(data?.character_full_name || 'this character'),
            className: String(data?.c_class_display || data?.c_class || ''),
            race: String(data?.chosen_race || ''),
            region: String(data?.region || ''),
            deity: Array.isArray(data?.deity_name) ? data.deity_name[0] : String(data?.deity_name || ''),
            alignment: alignCode(data?.mini_alignment || data?.alignment),
            level: Math.max(1, num(data?.total_level ?? data?.level, 1)),
        };
    }

    // ------------------------------------------------------------------ #73 related NPCs
    const clampLevel = (n) => Math.min(40, Math.max(1, Math.round(n)));
    const RELATIONSHIPS = [
        {
            id: 'rival',
            label: 'Rival',
            blurb: 'Close enough to compare yourself to, wrong enough to resent.',
            derive(s) {
                return {
                    className: Math.random() < 0.5 ? s.className : pick(ROLES[COUNTERS[roleOf(s.className)]]),
                    level: clampLevel(s.level + (Math.random() < 0.5 ? 1 : -1)),
                    alignment: alignOneStep(s.alignment),
                    region: s.region,
                };
            },
            prose: (a, b) => `${b} is ${a}'s rival — the same road walked a little differently.`,
        },
        {
            id: 'nemesis',
            label: 'Nemesis',
            blurb: 'The opposed number: stronger, and built to answer you.',
            derive(s) {
                return {
                    className: pick(ROLES[COUNTERS[roleOf(s.className)]]),
                    level: clampLevel(s.level + 2),
                    alignment: opposedAlign(s.alignment),
                    region: '',
                };
            },
            prose: (a, b) => `${b} is ${a}'s nemesis, and everything ${a} is not.`,
        },
        {
            id: 'mentor',
            label: 'Mentor',
            blurb: 'Same craft, several years ahead, same gods and same country.',
            derive(s) {
                return {
                    className: s.className,
                    level: clampLevel(s.level + 3 + Math.floor(Math.random() * 3)),
                    alignment: s.alignment,
                    region: s.region,
                    deity: s.deity,
                };
            },
            prose: (a, b) => `${b} taught ${a} the trade, and still knows more of it.`,
        },
        {
            id: 'ally',
            label: 'Ally / bond',
            blurb: 'Covers the gap you leave: the same side, a different strength.',
            derive(s) {
                return {
                    className: pick(ROLES[COMPLEMENTS[roleOf(s.className)]]),
                    level: clampLevel(s.level + (Math.random() < 0.5 ? 1 : -1)),
                    alignment: s.alignment,
                    region: s.region,
                };
            },
            prose: (a, b) => `${b} and ${a} watch each other's backs; neither says why any more.`,
        },
    ];
    const relationshipById = (id) => RELATIONSHIPS.find((r) => r.id === id) || null;

    /** Recipe → the generator payload overrides, ready to be shown and edited before posting. */
    function relatedParams(data, id) {
        const rel = relationshipById(id);
        if (!rel) return null;
        const s = sourceParams(data);
        const d = rel.derive(s);
        return {
            relationship: id,
            source: s,
            className: d.className || 'Random',
            level: d.level,
            alignment: d.alignment || 'random',
            region: d.region || 'random',
            deity: d.deity || 'random',
            race: 'random',
        };
    }
    /** The `generateCustom` override object for a set of edited params. */
    const toPayload = (p) => ({
        class: p.className || 'Random',
        alignment: p.alignment || 'random',
        region: p.region || 'random',
        deity: p.deity || 'random',
        race: p.race || 'random',
        highestLevel: String(p.level),
        lowestLevel: String(p.level),
    });

    /**
     * Record the link on BOTH characters and append one prose sentence to each background.
     *
     * Stored on `_sheet.relationships` so it rides every export, the folder mirror and the
     * one-JSON import; the prose is a starting sentence the user is expected to rewrite, which
     * is why it is appended to the freeform notes rather than owned by a field.
     */
    function linkCharacters(a, b, typeId) {
        const rel = relationshipById(typeId);
        if (!a || !b || !rel) return;
        const idOf = (d) => d?._sheet?.id || null;
        const nameOf = (d) => String(d?.character_full_name || 'Unnamed');
        const add = (self, other, label) => {
            const st = (self._sheet ??= {});
            if (!Array.isArray(st.relationships)) st.relationships = [];
            const otherId = idOf(other);
            // Re-generating the same pairing updates the entry rather than doubling it.
            const hit = st.relationships.find((r) => (otherId && r.id === otherId)
                || (!otherId && r.name === nameOf(other)));
            const entry = { id: otherId, name: nameOf(other), type: typeId, label };
            if (hit) Object.assign(hit, entry);
            else st.relationships.push(entry);
        };
        add(a, b, rel.label);
        // The inverse of "mentor" is "student", and the rest are their own inverse.
        add(b, a, typeId === 'mentor' ? 'Student' : rel.label);
        const line = rel.prose(nameOf(a), nameOf(b));
        for (const d of [a, b]) {
            const prose = (d._sheet ??= {}).prose ??= {};
            const notes = String(prose.notes || '');
            if (!notes.includes(line)) prose.notes = (notes ? notes.trimEnd() + '\n\n' : '') + line;
            (d._sheet).notes = prose.notes;
        }
    }

    // ------------------------------------------------------------------ #74 encounter sets
    // PF1 XP-by-CR. The encounter budget IS the XP value of the target CR, and each slot's CR
    // is the largest CR whose XP fits its share — so a shape is solved, not hand-tuned.
    const XP_BY_CR = [
        [0.125, 50], [0.166, 65], [0.25, 100], [0.333, 135], [0.5, 200],
        [1, 400], [2, 600], [3, 800], [4, 1200], [5, 1600], [6, 2400], [7, 3200],
        [8, 4800], [9, 6400], [10, 9600], [11, 12800], [12, 19200], [13, 25600],
        [14, 38400], [15, 51200], [16, 76800], [17, 102400], [18, 153600], [19, 204800],
        [20, 307200], [21, 409600], [22, 614400], [23, 819200], [24, 1228800], [25, 1638400],
    ];
    function xpForCR(cr) {
        let best = XP_BY_CR[0][1];
        for (const [c, xp] of XP_BY_CR) {
            if (c <= cr) best = xp;
        }
        return best;
    }
    /** Largest CR whose XP fits the share; never below the bottom of the table. */
    function crForXp(xp) {
        let best = XP_BY_CR[0][0];
        for (const [c, x] of XP_BY_CR) {
            if (x <= xp) best = c;
        }
        return best;
    }
    // PF1 encounter difficulty is expressed relative to APL.
    const DIFFICULTIES = [
        { id: 'easy', label: 'Easy', offset: -1 },
        { id: 'average', label: 'Average', offset: 0 },
        { id: 'challenging', label: 'Challenging', offset: 1 },
        { id: 'hard', label: 'Hard', offset: 2 },
        { id: 'epic', label: 'Epic', offset: 3 },
    ];
    // Each shape is a list of slots with a share of the XP budget. Shares sum to 1.
    const SHAPES = [
        {
            id: 'solo', label: 'Solo boss',
            blurb: 'One creature carrying the whole encounter.',
            slots: () => [{ role: 'Boss', count: 1, share: 1 }],
        },
        {
            id: 'boss-minions', label: 'Boss + minions',
            blurb: 'One heavy hitter and a screen of lighter ones.',
            slots: (n = 3) => [
                { role: 'Boss', count: 1, share: 0.5 },
                { role: 'Minion', count: n, share: 0.5 },
            ],
            counts: [2, 3, 4], countLabel: 'Minions',
        },
        {
            id: 'pair', label: 'Matched pair',
            blurb: 'Two equals who fight as one.',
            slots: () => [{ role: 'Pair', count: 2, share: 1 }],
        },
        {
            id: 'squad', label: 'Mook squad',
            blurb: 'A group of equals — numbers instead of power.',
            slots: (n = 5) => [{ role: 'Mook', count: n, share: 1 }],
            counts: [4, 5, 6], countLabel: 'Mooks',
        },
    ];
    const shapeById = (id) => SHAPES.find((s) => s.id === id) || null;
    const difficultyById = (id) => DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[1];
    /** Heroic NPCs are built a level above their CR (the grill decision's mapping). */
    const levelForCR = (cr) => Math.min(40, Math.max(1, Math.round(cr) + 1));
    const crLabel = (cr) => (cr >= 1 ? String(Math.round(cr))
        : ({ 0.125: '1/8', 0.166: '1/6', 0.25: '1/4', 0.333: '1/3', 0.5: '1/2' }[cr] || String(cr)));

    /**
     * Solve a shape against the encounter budget.
     * @returns {{ encounterCR, budget, slots: [{ role, count, cr, crLabel, level, xpEach }] }}
     */
    function solveEncounter(apl, difficultyId, shapeId, count) {
        const shape = shapeById(shapeId) || SHAPES[0];
        const diff = difficultyById(difficultyId);
        const encounterCR = Math.max(1, Math.round(num(apl, 1)) + diff.offset);
        const budget = xpForCR(encounterCR);
        const slots = shape.slots(count).map((slot) => {
            const xpEach = (budget * slot.share) / Math.max(1, slot.count);
            const cr = crForXp(xpEach);
            return {
                role: slot.role, count: slot.count, cr, crLabel: crLabel(cr),
                level: levelForCR(cr), xpEach: Math.round(xpEach),
            };
        });
        return { encounterCR, budget, slots, shape, difficulty: diff };
    }
    /**
     * The generate calls an encounter needs: **one per distinct statblock**, with the rest
     * filled by cloning. A six-mook squad is one backend round trip, not six — which is the
     * whole reason this is affordable against a sleeping free-tier backend.
     */
    function encounterPlan(solved) {
        return solved.slots.map((slot) => ({
            role: slot.role,
            level: slot.level,
            crLabel: slot.crLabel,
            generate: 1,
            clones: Math.max(0, slot.count - 1),
        }));
    }

    /** Tag a character as part of an encounter group; the roster dropdown groups on it. */
    function tagEncounter(data, group) {
        if (!data || !group) return;
        (data._sheet ??= {}).encounterGroup = { id: group.id, name: group.name };
    }
    const encounterGroupOf = (data) => data?._sheet?.encounterGroup || null;

    return {
        // shared
        sourceParams, alignCode, opposedAlign, alignOneStep, ALIGN_LABELS, toPayload,
        // #73
        RELATIONSHIPS, relationshipById, relatedParams, linkCharacters, roleOf,
        // #74
        DIFFICULTIES, SHAPES, difficultyById, shapeById, solveEncounter, encounterPlan,
        xpForCR, crForXp, levelForCR, crLabel, tagEncounter, encounterGroupOf,
    };
})();
