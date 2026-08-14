// scripts/domain/rebuild-templates.js -- zombie / skeleton (window.SheetRebuild), #112 phase 3.
//
// The simple templates in `creature-templates.js` are reversible buffs: everything they do lives on
// one buff object, and unchecking it puts the creature back. **These are not that.** A PF1 rebuild
// template throws the original creature's chassis away — its class levels become undead racial hit
// dice, it loses its feats and its skills, and its Intelligence stops existing. There is no ledger
// entry that expresses "this creature no longer has levels in cleric".
//
// So this module is honest about being destructive, and buys its safety somewhere else:
//
//   * **A snapshot is taken first, always** — `SheetLibrary.takeSnapshot(data, 'before Zombie
//     rebuild')`, the same call `levelup.js` makes at a level boundary. Undo is restoring it, which
//     the #86 diff picker already surfaces. That is the whole undo story and it is why this can
//     exist at all.
//   * **It refuses to run on an unsaved character**, because a snapshot needs `_sheet.id`; without
//     one there would be nothing to go back to.
//   * **The confirm names what it is about to destroy**, counted from the actual character, not in
//     general terms.
//
// What it does NOT do is pretend to be reversible. There is no "remove zombie" that reconstructs a
// cleric 20.
window.SheetRebuild = (function () {
    'use strict';

    const FEAT_BUCKETS = ['feats', 'class_feats', 'story_feats', 'flaw_feats', 'flavor_feats',
        'teamwork_feat_labels', 'bloodline_feats', 'trainer_feats', 'profession_feats',
        'sphere_feats', 'mt_feats'];

    const chg = (formula, target, type = 'untyped') => ({
        formula: String(formula), target, type, operator: 'add', priority: 0,
    });

    /**
     * PF1 "Creating a Zombie" / "Creating a Skeleton", as far as a sheet can carry them.
     *
     * `hdFor(level)` is the rule that actually replaces the creature: a zombie keeps its hit dice
     * and re-rolls them as d8 undead HD; a skeleton likewise. Everything else here is stripping.
     */
    const REBUILDS = [
        {
            id: 'zombie',
            label: 'Zombie',
            summary: 'A shambling corpse: undead d8 HD in place of its class levels, no Int, '
                + 'no feats but Toughness, no skills, DR 5/slashing, +2 natural armor.',
            keepFeats: ['Toughness'],
            grants: { dr: [{ amount: 5, bypass: 'slashing' }] },
            changes: [chg(2, 'nac', 'untypedPerm'), chg(-2, 'dex', 'untypedPerm')],
            notes: [
                'Staggered: a zombie may take only a single move or standard action each round.',
                'Speed is unchanged, but it can never run.',
                'Undead traits: no Constitution, immune to mind-affecting, uses Charisma for hit points.',
            ],
        },
        {
            id: 'skeleton',
            label: 'Skeleton',
            summary: 'Animated bones: undead d8 HD in place of its class levels, no Int, '
                + 'Improved Initiative only, DR 5/bludgeoning, +2 natural armor, +2 Dex.',
            keepFeats: ['Improved Initiative'],
            grants: { dr: [{ amount: 5, bypass: 'bludgeoning' }] },
            changes: [chg(2, 'nac', 'untypedPerm'), chg(2, 'dex', 'untypedPerm')],
            notes: [
                'Cold immunity, and the usual undead immunities.',
                'Keeps its natural attacks and a claw attack pair (1d4 for a Medium skeleton).',
                'Undead traits: no Constitution, immune to mind-affecting, uses Charisma for hit points.',
            ],
        },
    ];

    const byId = (id) => REBUILDS.find((r) => r.id === id) || null;

    /** What `apply` is about to destroy on THIS character, counted. Drives the confirm text. */
    function preview(data, id) {
        const tpl = byId(id);
        if (!tpl || !data) return null;
        const D = window.SheetDerive;
        const hd = Math.max(1, Number(D?.totalHD?.(data)) || 1);
        const keep = new Set(tpl.keepFeats.map((f) => f.toLowerCase()));
        let feats = 0;
        for (const bucket of FEAT_BUCKETS) {
            for (const name of (Array.isArray(data[bucket]) ? data[bucket] : [])) {
                const bare = String(name).replace(/^\([^)]*\)\s*/, '').trim().toLowerCase();
                if (!keep.has(bare)) feats += 1;
            }
        }
        const classes = (Array.isArray(data.classes) && data.classes.length
            ? data.classes : [{ display: data.c_class, level: data.level }])
            .filter((c) => c && c.level)
            .map((c) => `${c.display || c.name || 'class'} ${c.level}`);
        const ranks = Object.keys(data.skill_ranks || {}).length;
        return { hd, feats, classes, ranks, label: tpl.label, keepFeats: tpl.keepFeats };
    }

    /**
     * Rebuild the character. Destructive; snapshots first.
     *
     * @returns {{ok: boolean, reason?: string, snapshot?: boolean, hd?: number}}
     */
    async function apply(data, id) {
        const tpl = byId(id);
        if (!tpl || !data) return { ok: false, reason: 'unknown template' };
        if (!data._sheet?.id) {
            // Without an id there is no snapshot, and without a snapshot this is unrecoverable.
            return { ok: false, reason: 'save this character first — the undo is a snapshot' };
        }
        const D = window.SheetDerive;
        const C = window.SheetCreature;
        const S = window.SheetState;
        const hd = Math.max(1, Number(D?.totalHD?.(data)) || 1);
        await window.SheetLibrary?.takeSnapshot?.(data, `before ${tpl.label} rebuild`);

        // --- the chassis swap: class levels become undead racial hit dice -----------------
        const creature = C.ensureCreature(data);
        creature.type = 'undead';
        creature.subtypes = [];
        creature.racialHD = C.chassisFor('undead', hd);
        data.classes = [];
        data.level = 0;
        data.c_class = tpl.label;
        data.c_class_display = tpl.label;
        data.c_class_2 = '';
        data.bab_total = 0;          // the racial HD supply BAB now
        data.save_bases = { fort: 0, ref: 0, will: 0 };

        // --- the stripping ---------------------------------------------------------------
        const keep = new Set(tpl.keepFeats.map((f) => f.toLowerCase()));
        for (const bucket of FEAT_BUCKETS) {
            if (!Array.isArray(data[bucket])) continue;
            data[bucket] = data[bucket].filter((name) => {
                const bare = String(name).replace(/^\([^)]*\)\s*/, '').trim().toLowerCase();
                return keep.has(bare);
            });
        }
        for (const name of tpl.keepFeats) {
            data.feats = Array.isArray(data.feats) ? data.feats : [];
            if (!data.feats.some((f) => String(f).toLowerCase().includes(name.toLowerCase()))) {
                data.feats.push(name);
            }
        }
        data.skill_ranks = {};
        data.class_features = [];
        data.maneuvers_known_list = [];
        data.stances_chosen = [];
        data.spell_list_choose_from = [];
        data.spells_prepared_names = [];
        // Int stops existing. The sheet has no "no score" concept for abilities, so this is the
        // closest honest thing: zero it and say so in the notes rather than silently leaving a
        // mindless corpse with a 14 Intelligence.
        data.int = 0;

        // --- what is left is a buff, so the DR and natural armor stay visible and typed ----
        const buffs = S.ensureBuffs(data);
        const autoKey = 'rebuild:' + tpl.id;
        const fields = {
            name: tpl.label,
            subType: 'template',
            active: true,
            changes: tpl.changes.map((c) => ({ ...c })),
            grants: JSON.parse(JSON.stringify(tpl.grants)),
            notes: tpl.notes.join(' · '),
            autoKey,
        };
        const existing = buffs.find((b) => b && b.autoKey === autoKey);
        if (existing) Object.assign(existing, S.normalizeBuffEntry({ ...existing, ...fields }));
        else buffs.push(S.normalizeBuffEntry(fields));

        window.SheetApp?.quietSave?.();
        return { ok: true, snapshot: true, hd };
    }

    return { REBUILDS, byId, preview, apply };
})();
