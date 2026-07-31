// scripts/data.js -- static data tables for the character sheet (window.SheetData): the PF1
// class-chassis table + defaults, the condition list, and the generator form's option lists.
// No code deps; loads first so every consumer (the boot, summary/defenses/buffs tabs) can
// destructure straight from it.
window.SheetData = (function () {
    'use strict';

    // ---------------------------------------------------------------- form option data
    // Mirrors the Foundry module's generator dialog (button.js) so both clients send the
    // same values to /update_character_data.
    const REGIONS = ['Random', 'Tal-falko', 'Dolestan', 'Sojoria', 'Ieso', 'Spire', 'Feyador',
        'Esterdragon', 'Grundykin Damplands', 'Dust Cairn', 'Kaeru no Tochi'];
    const RACES = ['Random', 'Dwarf', 'Elf', 'Gnome', 'Half-Elf', 'Halfling', 'Half-Orc', 'Human',
        'Aasimar', 'Aquatic Elf', 'Catfolk', 'Changeling', 'Dhampir', 'Drow', 'Fetchling',
        'Gathlain', 'Ghoran', 'Gillman', 'Goblin', 'Grippli', 'Hobgoblin', 'Ifrit', 'Kitsune',
        'Kobold', 'Locathah', 'Merfolk', 'Monkey Goblin', 'Nagaji', 'Orc', 'Oread', 'Ratfolk',
        'Sahuagin', 'Skinwalker', 'Strix', 'Svirfneblin', 'Sylph', 'Syrinx', 'Tengu', 'Tiefling',
        'Triaxian', 'Triton', 'Undine', 'Vanara', 'Vine Leshy', 'Vishkanya', 'Wayang', 'Wyrwood',
        'Wyvaran', 'Yaddithian'];
    // Unlike the Foundry module, the web sheet has no compendium constraint, so Stalker and
    // Zealot are selectable here even while they stay out of the module's class list.
    const CLASSES = ['Random', 'Alchemist', 'Antipaladin', 'Arcanist', 'Barbarian',
        'Barbarian (Unchained)', 'Bard', 'Bloodrager', 'Brawler', 'Cavalier', 'Cleric', 'Druid',
        'Fighter', 'Gunslinger', 'Hunter', 'Inquisitor', 'Investigator', 'Magus', 'Monk',
        'Monk (Unchained)', 'Ninja', 'Oracle', 'Paladin', 'Ranger', 'Rogue', 'Rogue (Unchained)',
        'Samurai', 'Shaman', 'Shifter', 'Skald', 'Slayer', 'Sorcerer', 'Summoner',
        'Summoner (Unchained)', 'Swashbuckler', 'Vigilante', 'Warpriest', 'Witch', 'Wizard',
        'Warlord', 'Warder', 'Harbinger', 'Mystic', 'Medic', 'Stalker', 'Zealot'];
    // Beginner grouping for the quick generate form: these float to a "Common" optgroup and
    // everything else falls into "More…". Membership only — RACES/CLASSES above stay the
    // single source of truth, so a new entry there still shows up (just under More).
    const CORE_RACES = new Set(['Human', 'Elf', 'Dwarf', 'Halfling', 'Gnome', 'Half-Elf', 'Half-Orc']);
    const CORE_CLASSES = new Set(['Fighter', 'Wizard', 'Rogue', 'Cleric', 'Ranger', 'Paladin',
        'Barbarian', 'Bard', 'Druid', 'Monk', 'Sorcerer']);
    const DEITIES = ['random', 'Abadar', 'Achaekek', 'Ahriman', 'Alazhra', 'Alseta', 'Apsu',
        'Arazni', 'Asmodeus', 'Besmara', 'Calistria', 'Cayden Cailean', 'Desna', 'Easivra',
        'Erastil', 'Erecura', 'Gorum', 'Gozreh', 'Groetus', 'Hanspur', 'Iomedae', 'Irori',
        'Kurgess', 'Lamashtu', 'Lissala', 'Nethys', 'Norgorber', 'Pharasma', 'Rovagug',
        'Sarenrae', 'Shelyn', 'Torag', 'Urgathoa', 'Zon-Kuthon', 'Zyphus'];
    // ---------------------------------------------------------------- PF1 conditions tray
    const PF1_CONDITIONS = [
        { id: 'blinded', label: 'Blinded', note: '−2 AC; lose Dex to AC; 50% miss chance' },
        { id: 'confused', label: 'Confused', note: 'Act randomly each turn' },
        { id: 'cowering', label: 'Cowering', note: '−2 AC; lose Dex to AC' },
        { id: 'dazed', label: 'Dazed', note: 'No actions' },
        { id: 'dazzled', label: 'Dazzled', note: '−1 attack & Perception' },
        { id: 'deafened', label: 'Deafened', note: '−4 initiative; 20% spell fail (verbal)' },
        { id: 'entangled', label: 'Entangled', note: '−2 attack; −4 Dex; half speed' },
        { id: 'exhausted', label: 'Exhausted', note: '−6 Str/Dex; half speed' },
        { id: 'fascinated', label: 'Fascinated', note: 'Stand still; −4 Perception' },
        { id: 'fatigued', label: 'Fatigued', note: '−2 Str/Dex; cannot run/charge' },
        { id: 'flat-footed', label: 'Flat-footed', note: 'Lose Dex to AC; no AoO' },
        { id: 'frightened', label: 'Frightened', note: '−2 attacks/saves/skills; must flee' },
        { id: 'grappled', label: 'Grappled', note: '−2 attack/combat man.; −4 Dex' },
        { id: 'helpless', label: 'Helpless', note: 'Dex 0 (−5); coup de grace' },
        { id: 'invisible', label: 'Invisible', note: '+2 attack; deny Dex to targets' },
        { id: 'nauseated', label: 'Nauseated', note: 'Only a single move action' },
        { id: 'panicked', label: 'Panicked', note: '−2; drop items; flee' },
        { id: 'paralyzed', label: 'Paralyzed', note: 'Str/Dex 0; helpless' },
        { id: 'pinned', label: 'Pinned', note: '−4 AC; limited actions' },
        { id: 'prone', label: 'Prone', note: '−4 melee attack; +4 AC vs ranged' },
        { id: 'shaken', label: 'Shaken', note: '−2 attacks/saves/skills/ability checks' },
        { id: 'sickened', label: 'Sickened', note: '−2 attacks/damage/saves/skills' },
        { id: 'staggered', label: 'Staggered', note: 'Single move or standard' },
        { id: 'stunned', label: 'Stunned', note: '−2 AC; drop items; no actions' },
    ];
    // Mechanical effects per condition, consumed by the changes ledger (collectChanges) and
    // derive.js. `changes` use the normal ledger target vocabulary; the parts a ledger can't
    // express are flags: `loseDex` (Dex bonus to AC/CMD denied — negative Dex still applies)
    // and `noDodge` (dodge bonuses drop too). Non-numeric rules (can't act, speed halved,
    // prone's split ranged/melee AC) stay in the chip's `note` — honesty over fake numbers.
    const ccPen = (formula, target, type = 'penalty') => ({ formula, target, type });
    const CONDITION_CHANGES = {
        blinded: { loseDex: true, changes: [ccPen('-2', 'ac')] },
        cowering: { loseDex: true, changes: [ccPen('-2', 'ac')] },
        dazzled: { changes: [ccPen('-1', 'attack'), ccPen('-1', 'skill.per')] },
        deafened: { changes: [ccPen('-4', 'init')] },
        entangled: { changes: [ccPen('-2', 'attack'), ccPen('-4', 'dex')] },
        exhausted: { changes: [ccPen('-6', 'str'), ccPen('-6', 'dex')] },
        fascinated: { changes: [ccPen('-4', 'skill.per')] },
        fatigued: { changes: [ccPen('-2', 'str'), ccPen('-2', 'dex')] },
        'flat-footed': { loseDex: true, noDodge: true },
        frightened: { changes: [ccPen('-2', 'attack'), ccPen('-2', 'cmb'),
            ccPen('-2', 'allSavingThrows'), ccPen('-2', 'skills')] },
        grappled: { changes: [ccPen('-4', 'dex'), ccPen('-2', 'attack'), ccPen('-2', 'cmb')] },
        helpless: { loseDex: true },
        invisible: { changes: [{ formula: '+2', target: 'attack', type: 'circumstance' }] },
        panicked: { changes: [ccPen('-2', 'allSavingThrows'), ccPen('-2', 'skills')] },
        paralyzed: { loseDex: true },
        pinned: { loseDex: true, changes: [ccPen('-4', 'ac')] },
        prone: { changes: [ccPen('-4', 'mattack')] },
        shaken: { changes: [ccPen('-2', 'attack'), ccPen('-2', 'cmb'),
            ccPen('-2', 'allSavingThrows'), ccPen('-2', 'skills')] },
        sickened: { changes: [ccPen('-2', 'attack'), ccPen('-2', 'cmb'), ccPen('-2', 'damage'),
            ccPen('-2', 'allSavingThrows'), ccPen('-2', 'skills')] },
        stunned: { loseDex: true, changes: [ccPen('-2', 'ac')] },
    };

    // ------------------------------------------------- situational combat toggles
    // Curated per-roll toggles for the conditional panel's "Combat options" group. Universal
    // PF1 rules live client-side in this table; per-character data stays in the backend.
    // `modifiers` use the per-roll conditional shape (m*/r* targets scope to melee/ranged;
    // `gripScale` marks Power Attack's damage bonus for the ×1.5 two-handed / ×0.5 off-hand
    // adjustment). `acChanges` is the standing side: while the toggle is checked,
    // collectChanges feeds these into the ledger (sourceKind 'combat') so AC / saves / CMD
    // update live. `autoExpire: 'round'` clears the toggle on advanceRound.
    const babScale = '(1 + floor(@attributes.bab.total / 4))';
    const COMBAT_TOGGLES = [
        {
            id: 'combat:power-attack', name: 'Power Attack',
            label: 'Power Attack: −1 attack / +2 damage per 4 BAB (melee; ×1.5 two-handed, ×0.5 off-hand)',
            modifiers: [
                { formula: '-' + babScale, target: 'mattack', type: 'penalty' },
                { formula: '2 * ' + babScale, target: 'mdamage', type: 'untyped', gripScale: true },
            ],
        },
        {
            id: 'combat:deadly-aim', name: 'Deadly Aim',
            label: 'Deadly Aim: −1 attack / +2 damage per 4 BAB (ranged)',
            modifiers: [
                { formula: '-' + babScale, target: 'rattack', type: 'penalty' },
                { formula: '2 * ' + babScale, target: 'rdamage', type: 'untyped' },
            ],
        },
        {
            id: 'combat:combat-expertise', name: 'Combat Expertise',
            label: 'Combat Expertise: −1 attack / +1 dodge AC per 4 BAB (melee)',
            modifiers: [{ formula: '-' + babScale, target: 'mattack', type: 'penalty' }],
            acChanges: [{ formula: babScale, target: 'ac', type: 'dodge' }],
        },
        {
            id: 'combat:fighting-defensively', name: 'Fighting defensively',
            label: 'Fighting defensively: −4 attack, +2 dodge AC',
            modifiers: [{ formula: '-4', target: 'attack', type: 'penalty' }],
            acChanges: [{ formula: '2', target: 'ac', type: 'dodge' }],
        },
        {
            id: 'combat:total-defense', name: 'Total defense',
            label: 'Total defense: +4 dodge AC, no attacks',
            rider: 'Total defense: standard action, +4 dodge AC — you cannot attack or make attacks of opportunity this round.',
            acChanges: [{ formula: '4', target: 'ac', type: 'dodge' }],
        },
        {
            id: 'combat:flanking', name: 'Flanking',
            label: 'Flanking: +2 melee attack',
            modifiers: [{ formula: '2', target: 'mattack', type: 'untyped' }],
        },
        {
            id: 'combat:charge', name: 'Charge',
            label: 'Charge: +2 melee attack, −2 AC until your next turn',
            autoExpire: 'round',
            modifiers: [{ formula: '2', target: 'mattack', type: 'untyped' }],
            acChanges: [{ formula: '-2', target: 'ac', type: 'penalty' }],
        },
        {
            id: 'combat:haste', name: 'Haste',
            label: 'Haste: +1 attack, +1 dodge AC & Reflex; extra attack on a full attack',
            rider: 'Haste: one extra attack at your highest bonus when making a full attack.',
            modifiers: [{ formula: '1', target: 'attack', type: 'untyped' }],
            acChanges: [
                { formula: '1', target: 'ac', type: 'dodge' },
                { formula: '1', target: 'ref', type: 'dodge' },
            ],
        },
        {
            id: 'combat:higher-ground', name: 'Higher ground',
            label: 'Higher ground: +1 melee attack',
            modifiers: [{ formula: '1', target: 'mattack', type: 'untyped' }],
        },
    ];

    // Two-handed melee weapons by base name (enhancement suffix stripped, lowercase), for
    // Power Attack's grip auto-detection. The item sheet's Grip override wins over this list;
    // anything unlisted counts as one-handed. Lance is listed as two-handed (its one-handed
    // mounted grip is the override's job).
    const TWO_HANDED_WEAPONS = new Set([
        'bardiche', 'bec de corbin', 'bill', 'boar spear', 'dire flail', 'dwarven longaxe',
        'dwarven longhammer', 'earth breaker', 'elven branched spear', 'elven curve blade',
        'falchion', 'fauchard', 'glaive', 'glaive-guisarme', 'gnome ripsaw glaive',
        'great terbutje', 'greataxe', 'greatclub', 'greatsword', 'guisarme', 'halberd',
        'harpoon', 'heavy flail', 'hooked lance', 'horsechopper', 'kusarigama', 'lance',
        'longspear', 'lucerne hammer', 'mancatcher', 'meteor hammer', "monk's spade",
        'naginata', 'no-dachi', 'nodachi', 'ogre hook', 'orc double axe', 'orc skull ram',
        'planson', 'quarterstaff', 'ranseur', 'rhomphaia', 'sansetsukon', 'scythe', 'spear',
        'spiked chain', 'syringe spear', 'taiaha', 'tepoztopilli', 'tetsubo', 'tiger fork',
        'tri-point double-edged sword', 'two-bladed sword',
    ]);

    // ------------------------------------------- marquee base class features (issue #8)
    // The signature class features the backend deliberately does not curate (its
    // class_feature_effects.json covers choice pools only). Curated client-side, keyed by
    // class presence, so already-saved characters get them with no re-generate. Same shape
    // as COMBAT_TOGGLES: `modifiers` = per-roll side, `acChanges` = standing ledger side
    // (dual-written while the toggle is on, sourceKind 'marquee').
    //   uses:  { name, max } links the toggle to the Features-tab uses tracker (max is an
    //          evalSimpleFormula string, seeded on first activation). Non-timed features
    //          spend 1 use when toggled on (warn at 0, never block).
    //   timed: spends 1 use per advanceRound while on and auto-ends at 0.
    //   endCondition: PF1 condition id applied when the feature ends (Rage → fatigued).
    // Scaling avoids ifelse (evalSimpleFormula has floor/ceil/min/max only):
    // floor(level/11) + floor(level/20) steps at 11 and 20 (greater/mighty rage).
    const MARQUEE_FEATURES = [
        {
            id: 'marquee:rage', name: 'Rage', cls: 'barbarian',
            label: 'Rage: +4 morale Str & Con (+6 @11, +8 @20), +2 Will, −2 AC — spends rage rounds',
            timed: true, endCondition: 'fatigued',
            uses: { name: 'Rage', max: '4 + @abilities.con.mod + 2 * (@classes.barbarian.level - 1)' },
            acChanges: [
                { formula: '4 + 2*floor(@classes.barbarian.level/11) + 2*floor(@classes.barbarian.level/20)', target: 'str', type: 'morale' },
                { formula: '4 + 2*floor(@classes.barbarian.level/11) + 2*floor(@classes.barbarian.level/20)', target: 'con', type: 'morale' },
                { formula: '2 + floor(@classes.barbarian.level/11) + floor(@classes.barbarian.level/20)', target: 'will', type: 'morale' },
                { formula: '-2', target: 'ac', type: 'penalty' },
            ],
            rider: 'Rage: no Cha-, Dex- or Int-based skills (except Acrobatics, Fly, Intimidate, Ride) and no concentration. When it ends you are fatigued for 2× the rounds spent raging (auto-applied).',
        },
        {
            id: 'marquee:smite-evil', name: 'Smite Evil', cls: 'paladin',
            label: 'Smite Evil: +Cha attack, +level damage, +Cha deflection AC vs target (1 use)',
            uses: { name: 'Smite Evil', max: 'ceil(@classes.paladin.level/3)' },
            modifiers: [
                { formula: '@abilities.cha.mod', target: 'attack', type: 'untyped' },
                { formula: '@classes.paladin.level', target: 'damage', type: 'untyped' },
            ],
            acChanges: [{ formula: '@abilities.cha.mod', target: 'ac', type: 'deflection' }],
            rider: 'Smite Evil: bonuses apply only against the chosen evil target (deflection AC only vs its attacks); damage ×2 on the first hit vs evil outsiders, evil dragons and undead; your attacks bypass its DR. Lasts until the target is dead or you rest.',
        },
        {
            id: 'marquee:challenge', name: 'Challenge', cls: 'cavalier',
            label: 'Challenge: +level melee damage vs target, −2 AC vs everyone else (1 use)',
            uses: { name: 'Challenge', max: 'ceil(@classes.cavalier.level/3)' },
            modifiers: [{ formula: '@classes.cavalier.level', target: 'mdamage', type: 'untyped' }],
            acChanges: [{ formula: '-2', target: 'ac', type: 'penalty' }],
            rider: 'Challenge: the damage bonus applies only against the challenged target; the −2 AC applies against everyone except that target. Lasts until the target is dead or unconscious.',
        },
        {
            id: 'marquee:judgment', name: 'Judgment', cls: 'inquisitor',
            label: 'Judgment (destruction): +sacred damage, scales with level (1 use)',
            uses: { name: 'Judgment', max: 'ceil(@classes.inquisitor.level/3)' },
            modifiers: [{ formula: '1 + floor(@classes.inquisitor.level/3)', target: 'damage', type: 'sacred' }],
            rider: 'Judgment: destruction shown; other choices — justice +(1 + level/10) attack, protection +(1 + level/10) sacred AC, purity +(1 + level/10) saves, healing fast healing (1 + level/3), piercing +(1 + level/3) concentration & vs SR, resiliency DR (1 + level/5)/magic, resistance energy resist 2×(1 + level/5), smiting: weapons count as magic (adamantine @6, aligned @10) — swap the numbers by hand if you picked one of those. Lasts the whole combat; swift action to change.',
        },
        {
            id: 'marquee:sneak-attack', name: 'Sneak Attack', cls: 'rogue',
            label: 'Sneak Attack: +Nd6 precision damage (target denied Dex, or flanked)',
            modifiers: [{ formula: '(ceil(@classes.rogue.level/2))d6', target: 'damage', type: 'untyped' }],
            rider: 'Sneak attack: only when the target is denied its Dex bonus to AC or you are flanking; precision damage is never multiplied on a crit (the sheet already rolls it once); creatures immune to precision damage take none.',
        },
        {
            id: 'marquee:favored-enemy', name: 'Favored Enemy', cls: 'ranger',
            label: 'Favored Enemy: +2 attack & damage',
            modifiers: [
                { formula: '2', target: 'attack', type: 'untyped' },
                { formula: '2', target: 'damage', type: 'untyped' },
            ],
            rider: 'Favored enemy: +2 also applies to Bluff, Knowledge, Perception, Sense Motive and Survival vs that creature type. If this enemy type has a higher bonus (+4/+6 from later picks), use the "Next roll" one-off boxes for the difference.',
        },
        {
            id: 'marquee:studied-target', name: 'Studied Target', cls: 'slayer',
            label: 'Studied Target: +N attack & damage, scales with level',
            modifiers: [
                { formula: '1 + floor(@classes.slayer.level/5)', target: 'attack', type: 'untyped' },
                { formula: '1 + floor(@classes.slayer.level/5)', target: 'damage', type: 'untyped' },
            ],
            rider: 'Studied target: the same bonus applies to Bluff, Knowledge, Perception, Sense Motive and Survival checks against the target, and to slayer talent DCs.',
        },
        {
            id: 'marquee:inspire-courage', name: 'Inspire Courage', cls: 'bard',
            label: 'Inspire Courage: +N competence attack & damage — spends performance rounds',
            timed: true,
            uses: { name: 'Bardic Performance', max: '4 + @abilities.cha.mod + 2 * (@classes.bard.level - 1)' },
            modifiers: [
                { formula: '1 + floor((@classes.bard.level + 1)/6)', target: 'attack', type: 'competence' },
                { formula: '1 + floor((@classes.bard.level + 1)/6)', target: 'damage', type: 'competence' },
            ],
            rider: 'Inspire courage: also +the same bonus (morale) on saves vs charm and fear; allies who can hear you gain the full effect too. Free action to maintain each round.',
        },
    ];

    // ------------------------------------------------------------ size categories
    // `mod` is the size modifier to attack & AC; the special size modifier (CMB/CMD) is its
    // negation. `steps` is the damage-dice progression distance from Medium.
    const SIZES = [
        { id: 'fine', label: 'Fine', mod: 8, steps: -4 },
        { id: 'diminutive', label: 'Diminutive', mod: 4, steps: -3 },
        { id: 'tiny', label: 'Tiny', mod: 2, steps: -2 },
        { id: 'small', label: 'Small', mod: 1, steps: -1 },
        { id: 'medium', label: 'Medium', mod: 0, steps: 0 },
        { id: 'large', label: 'Large', mod: -1, steps: 1 },
        { id: 'huge', label: 'Huge', mod: -2, steps: 2 },
        { id: 'gargantuan', label: 'Gargantuan', mod: -4, steps: 3 },
        { id: 'colossal', label: 'Colossal', mod: -8, steps: 4 },
    ];
    const SMALL_RACES = new Set(['halfling', 'gnome', 'goblin', 'kobold', 'ratfolk', 'wayang',
        'svirfneblin', 'grippli', 'monkey goblin', 'vine leshy']);

    // pf1's damage-dice progression ladder plus the official off-ladder pairs. A die the
    // table doesn't know (or a non-NdM formula) is returned unchanged — the item sheet's
    // per-item dice override is the escape hatch.
    const DICE_LADDER = ['1d1', '1d2', '1d3', '1d4', '1d6', '1d8', '1d10', '2d6', '2d8',
        '3d6', '3d8', '4d6', '4d8', '6d6', '6d8', '8d6', '8d8', '12d6', '12d8', '16d6'];
    const DICE_STEP_SPECIAL = {
        '1d12': { up: '3d6', down: '1d10' },
        '2d4': { up: '2d6', down: '1d4' },
        '2d10': { up: '4d8', down: '2d8' },
        '2d12': { up: '6d6', down: '3d6' },
        '4d10': { up: '8d8', down: '4d8' },
    };
    // Paizo FAQ progression: one size up moves +1 ladder step at 1d6 or less, +2 steps at
    // 1d8 or more (longsword 1d8 → 2d6); one size down moves −1 step at 1d8 or less, −2
    // steps above (2d6 → 1d8, but 1d8 → 1d6).
    const D8_IDX = DICE_LADDER.indexOf('1d8');
    function stepDice(dice, steps) {
        let cur = String(dice || '').trim().toLowerCase().replace(/\s+/g, '');
        let n = Number(steps) || 0;
        if (!n || !/^\d+d\d+$/.test(cur)) return dice;
        while (n !== 0) {
            const dir = n > 0 ? 'up' : 'down';
            const sp = DICE_STEP_SPECIAL[cur];
            if (sp?.[dir]) {
                cur = sp[dir];
            } else {
                const i = DICE_LADDER.indexOf(cur);
                if (i < 0) return dice;
                const delta = n > 0 ? (i >= D8_IDX ? 2 : 1) : -(i > D8_IDX ? 2 : 1);
                const j = Math.min(DICE_LADDER.length - 1, Math.max(0, i + delta));
                if (j === i) break; // floor/cap of the chart
                cur = DICE_LADDER[j];
            }
            n += n > 0 ? -1 : 1;
        }
        return cur;
    }

    // ------------------------------------------------------------ class & archetype info
    // Built-in PF1 class chassis (best effort — every field is editable per character
    // via _sheet.classInfo overrides in the class popup). classSkills use ALL_SKILLS ids.
    const CLASS_STATS = {
        alchemist: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Good', will: 'Poor', skills: 4, casting: 'Extracts (Int, 6th-level)', weaponProf: 'Simple + bombs', armorProf: 'Light', classSkills: ['apr', 'crf', 'dev', 'fly', 'hea', 'kar', 'kna', 'per', 'pro', 'slt', 'spl', 'sur'] },
        antipaladin: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Good', skills: 2, casting: 'Divine (Cha, 4th-level)', alignment: 'Chaotic evil only', weaponProf: 'Simple, martial', armorProf: 'All armor, shields', classSkills: ['blf', 'crf', 'dis', 'han', 'int', 'kre', 'pro', 'rid', 'sen', 'ste', 'spl'] },
        arcanist: { hd: 6, bab: '1/2', fort: 'Poor', ref: 'Poor', will: 'Good', skills: 2, casting: 'Arcane (Int, 9th-level, prepared-spontaneous)', weaponProf: 'Simple', armorProf: 'None', classSkills: ['apr', 'crf', 'fly', 'kar', 'kdu', 'ken', 'kge', 'khi', 'klo', 'kna', 'kno', 'kpl', 'kre', 'lin', 'pro', 'spl', 'umd'] },
        barbarian: { hd: 12, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Poor', skills: 4, casting: 'None', alignment: 'Any nonlawful', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['acr', 'clm', 'crf', 'han', 'int', 'kna', 'per', 'rid', 'sur', 'swm'] },
        bard: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Good', will: 'Good', skills: 6, casting: 'Arcane (Cha, 6th-level, spontaneous)', weaponProf: 'Simple + bard list', armorProf: 'Light, shields', classSkills: ['acr', 'apr', 'blf', 'clm', 'crf', 'dip', 'dis', 'esc', 'int', 'kar', 'kdu', 'ken', 'kge', 'khi', 'klo', 'kna', 'kno', 'kpl', 'kre', 'lin', 'per', 'prf', 'pro', 'sen', 'slt', 'spl', 'ste', 'umd'] },
        bloodrager: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Poor', skills: 4, casting: 'Arcane (Cha, 4th-level, spontaneous)', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['acr', 'clm', 'crf', 'han', 'int', 'kar', 'per', 'rid', 'spl', 'sur', 'swm'] },
        brawler: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Good', will: 'Poor', skills: 4, casting: 'None', weaponProf: 'Simple + close weapons', armorProf: 'Light, shields', classSkills: ['acr', 'clm', 'crf', 'esc', 'han', 'int', 'kdu', 'klo', 'per', 'pro', 'rid', 'sen', 'swm'] },
        cavalier: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Poor', skills: 4, casting: 'None', weaponProf: 'Simple, martial', armorProf: 'All armor, shields', classSkills: ['blf', 'clm', 'crf', 'dip', 'han', 'int', 'pro', 'rid', 'sen', 'swm'] },
        cleric: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Poor', will: 'Good', skills: 2, casting: 'Divine (Wis, 9th-level, prepared)', weaponProf: 'Simple + deity favored', armorProf: 'Light, medium, shields', classSkills: ['apr', 'crf', 'dip', 'hea', 'kar', 'khi', 'kno', 'kpl', 'kre', 'lin', 'pro', 'sen', 'spl'] },
        druid: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Poor', will: 'Good', skills: 4, casting: 'Divine (Wis, 9th-level, prepared)', alignment: 'Any neutral', weaponProf: 'Druid list', armorProf: 'Light, medium, shields (no metal)', classSkills: ['clm', 'crf', 'fly', 'han', 'hea', 'kge', 'kna', 'per', 'pro', 'rid', 'spl', 'sur', 'swm'] },
        fighter: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Poor', skills: 2, casting: 'None', weaponProf: 'Simple, martial', armorProf: 'All armor, shields (incl. tower)', classSkills: ['clm', 'crf', 'han', 'int', 'kdu', 'ken', 'pro', 'rid', 'sur', 'swm'] },
        gunslinger: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Good', will: 'Poor', skills: 4, casting: 'None', weaponProf: 'Simple, martial + firearms', armorProf: 'Light', classSkills: ['acr', 'blf', 'clm', 'crf', 'han', 'hea', 'int', 'ken', 'klo', 'per', 'pro', 'rid', 'slt', 'sur', 'swm'] },
        hunter: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Good', will: 'Poor', skills: 6, casting: 'Divine (Wis, 6th-level, spontaneous)', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['clm', 'crf', 'han', 'hea', 'int', 'kdu', 'kge', 'kna', 'per', 'pro', 'rid', 'spl', 'ste', 'sur', 'swm'] },
        inquisitor: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Poor', will: 'Good', skills: 6, casting: 'Divine (Wis, 6th-level, spontaneous)', weaponProf: 'Simple + deity favored', armorProf: 'Light, medium, shields', classSkills: ['blf', 'clm', 'crf', 'dip', 'dis', 'hea', 'int', 'kar', 'kdu', 'kna', 'kpl', 'kre', 'per', 'pro', 'rid', 'sen', 'spl', 'ste', 'sur', 'swm'] },
        investigator: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Good', will: 'Good', skills: 6, casting: 'Extracts (Int, 6th-level)', weaponProf: 'Simple + a few martial', armorProf: 'Light', classSkills: ['acr', 'apr', 'blf', 'clm', 'crf', 'dip', 'dev', 'dis', 'esc', 'hea', 'int', 'kar', 'kdu', 'ken', 'kge', 'khi', 'klo', 'kna', 'kno', 'kpl', 'kre', 'lin', 'per', 'pro', 'sen', 'slt', 'spl', 'ste'] },
        magus: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Poor', will: 'Good', skills: 2, casting: 'Arcane (Int, 6th-level, prepared)', weaponProf: 'Simple, martial', armorProf: 'Light (armored casting)', classSkills: ['clm', 'crf', 'dip', 'fly', 'int', 'kar', 'kdu', 'kpl', 'pro', 'rid', 'spl', 'swm', 'umd'] },
        monk: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Good', will: 'Good', skills: 4, casting: 'None', alignment: 'Any lawful', weaponProf: 'Monk weapons', armorProf: 'None', classSkills: ['acr', 'clm', 'crf', 'esc', 'int', 'khi', 'kre', 'per', 'prf', 'pro', 'rid', 'sen', 'ste', 'swm'] },
        'monk (unchained)': { hd: 10, bab: 'Full', fort: 'Good', ref: 'Good', will: 'Poor', skills: 4, casting: 'None', alignment: 'Any lawful', weaponProf: 'Monk weapons', armorProf: 'None', classSkills: ['acr', 'clm', 'crf', 'esc', 'int', 'khi', 'kre', 'per', 'prf', 'pro', 'rid', 'sen', 'ste', 'swm'] },
        ninja: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Good', will: 'Poor', skills: 8, casting: 'None (ki tricks)', weaponProf: 'Simple + ninja weapons', armorProf: 'Light', classSkills: ['acr', 'apr', 'blf', 'clm', 'crf', 'dip', 'dev', 'dis', 'esc', 'int', 'klo', 'kno', 'lin', 'per', 'prf', 'pro', 'sen', 'slt', 'ste', 'swm', 'umd'] },
        oracle: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Poor', will: 'Good', skills: 4, casting: 'Divine (Cha, 9th-level, spontaneous)', weaponProf: 'Simple', armorProf: 'Light, medium, shields', classSkills: ['crf', 'dip', 'hea', 'khi', 'kpl', 'kre', 'pro', 'sen', 'spl'] },
        paladin: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Good', skills: 2, casting: 'Divine (Cha, 4th-level)', alignment: 'Lawful good only', weaponProf: 'Simple, martial', armorProf: 'All armor, shields', classSkills: ['crf', 'dip', 'han', 'hea', 'kno', 'kre', 'pro', 'rid', 'sen', 'spl'] },
        ranger: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Good', will: 'Poor', skills: 6, casting: 'Divine (Wis, 4th-level)', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['clm', 'crf', 'han', 'hea', 'int', 'kdu', 'kge', 'kna', 'per', 'pro', 'rid', 'spl', 'ste', 'sur', 'swm'] },
        rogue: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Good', will: 'Poor', skills: 8, casting: 'None', weaponProf: 'Simple + rogue weapons', armorProf: 'Light', classSkills: ['acr', 'apr', 'blf', 'clm', 'crf', 'dip', 'dev', 'dis', 'esc', 'int', 'kdu', 'klo', 'lin', 'per', 'prf', 'pro', 'sen', 'slt', 'spl', 'ste', 'swm', 'umd'] },
        samurai: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Poor', skills: 4, casting: 'None', weaponProf: 'Simple, martial + katana', armorProf: 'All armor, shields', classSkills: ['blf', 'clm', 'crf', 'dip', 'han', 'int', 'pro', 'rid', 'sen', 'swm'] },
        shaman: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Poor', will: 'Good', skills: 4, casting: 'Divine (Wis, 9th-level, prepared)', weaponProf: 'Simple', armorProf: 'Light, medium (no metal)', classSkills: ['crf', 'dip', 'fly', 'han', 'hea', 'kna', 'kpl', 'kre', 'lin', 'pro', 'rid', 'spl', 'sur'] },
        shifter: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Good', will: 'Poor', skills: 4, casting: 'None', alignment: 'Any neutral', weaponProf: 'Simple + natural attacks', armorProf: 'Light (no metal)', classSkills: ['acr', 'clm', 'crf', 'fly', 'han', 'kna', 'per', 'pro', 'rid', 'ste', 'sur', 'swm'] },
        skald: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Poor', will: 'Good', skills: 4, casting: 'Arcane (Cha, 6th-level, spontaneous)', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['acr', 'apr', 'blf', 'clm', 'crf', 'dip', 'esc', 'han', 'int', 'kar', 'kdu', 'ken', 'kge', 'khi', 'klo', 'kna', 'kno', 'kpl', 'kre', 'lin', 'per', 'prf', 'pro', 'rid', 'sen', 'spl', 'swm', 'umd'] },
        slayer: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Good', will: 'Poor', skills: 6, casting: 'None', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['acr', 'blf', 'clm', 'crf', 'dis', 'han', 'hea', 'int', 'kdu', 'kge', 'klo', 'per', 'pro', 'rid', 'sen', 'ste', 'sur', 'swm'] },
        sorcerer: { hd: 6, bab: '1/2', fort: 'Poor', ref: 'Poor', will: 'Good', skills: 2, casting: 'Arcane (Cha, 9th-level, spontaneous)', weaponProf: 'Simple', armorProf: 'None', classSkills: ['apr', 'blf', 'crf', 'fly', 'int', 'kar', 'pro', 'spl', 'umd'] },
        summoner: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Poor', will: 'Good', skills: 2, casting: 'Arcane (Cha, 6th-level, spontaneous)', weaponProf: 'Simple', armorProf: 'Light', classSkills: ['crf', 'fly', 'han', 'kar', 'kdu', 'ken', 'kge', 'khi', 'klo', 'kna', 'kno', 'kpl', 'kre', 'lin', 'pro', 'rid', 'spl', 'umd'] },
        warpriest: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Poor', will: 'Good', skills: 2, casting: 'Divine (Wis, 6th-level, prepared)', weaponProf: 'Simple, martial + deity favored', armorProf: 'All armor, shields', classSkills: ['clm', 'crf', 'dip', 'han', 'hea', 'int', 'ken', 'kre', 'pro', 'rid', 'sen', 'spl', 'sur', 'swm'] },
        witch: { hd: 6, bab: '1/2', fort: 'Poor', ref: 'Poor', will: 'Good', skills: 2, casting: 'Arcane (Int, 9th-level, prepared)', weaponProf: 'Simple', armorProf: 'None', classSkills: ['crf', 'fly', 'hea', 'int', 'kar', 'khi', 'kna', 'kpl', 'pro', 'spl', 'umd'] },
        wizard: { hd: 6, bab: '1/2', fort: 'Poor', ref: 'Poor', will: 'Good', skills: 2, casting: 'Arcane (Int, 9th-level, prepared)', weaponProf: 'Wizard list', armorProf: 'None', classSkills: ['apr', 'crf', 'fly', 'kar', 'kdu', 'ken', 'kge', 'khi', 'klo', 'kna', 'kno', 'kpl', 'kre', 'lin', 'pro', 'spl'] },
        stalker: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Good', will: 'Good', skills: 6, casting: 'None', maneuvers: 'Full initiator (Path of War)', weaponProf: 'Simple, martial', armorProf: 'Light', classSkills: ['acr', 'blf', 'clm', 'esc', 'int', 'per', 'sen', 'slt', 'ste', 'sur', 'swm'] },
        warder: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Good', skills: 4, casting: 'None', maneuvers: 'Full initiator (Path of War)', weaponProf: 'Simple, martial', armorProf: 'All armor, shields', classSkills: ['acr', 'clm', 'crf', 'dip', 'int', 'kdu', 'ken', 'khi', 'klo', 'kno', 'per', 'pro', 'rid', 'sen', 'swm'] },
        warlord: { hd: 10, bab: 'Full', fort: 'Poor', ref: 'Good', will: 'Poor', skills: 4, casting: 'None', maneuvers: 'Full initiator (Path of War)', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['acr', 'blf', 'clm', 'crf', 'dip', 'han', 'int', 'khi', 'klo', 'per', 'prf', 'pro', 'rid', 'sen', 'swm'] },
        zealot: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Poor', will: 'Good', skills: 4, casting: 'Psionic-flavored (Path of War: Zealot)', maneuvers: 'Full initiator (Path of War)', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['blf', 'clm', 'crf', 'dip', 'hea', 'int', 'khi', 'klo', 'kre', 'per', 'pro', 'sen', 'spl', 'swm'] },
    };
    CLASS_STATS['barbarian (unchained)'] = CLASS_STATS.barbarian;
    CLASS_STATS['rogue (unchained)'] = CLASS_STATS.rogue;
    const DEFAULT_CLASS_INFO = {
        hd: null, bab: '—', fort: '—', ref: '—', will: '—', skills: null,
        casting: '—', maneuvers: '—', fcb: '+1 HP or +1 skill point',
        weaponProf: '—', armorProf: '—', alignment: 'Any', classSkills: [],
    };

    // -------------------------------------------- standard spell-slot progressions (#23)
    // The four canonical PF1 spells-per-day shapes (validated against d20pfsrd), indexed by
    // class level 1–20; each row is per spell level 0–9, null = "—" (no slots at all — at-will
    // cantrips for spontaneous casters, or a level the class never reaches). A 0 entry is a
    // real row: it grants slots only via the casting-ability bonus, per PF1.
    // Prestige progressions and oddballs (arcanist's prepared-spontaneous, medium…) are
    // deliberately absent — no badge beats a wrong one.
    const SPELL_SLOT_TABLES = {
        // Wizard/cleric/druid/witch/shaman (domain & school extras are #11's restricted slots).
        nine_prepared: [
            [3, 1], [4, 2], [4, 2, 1], [4, 3, 2], [4, 3, 2, 1], [4, 3, 3, 2],
            [4, 4, 3, 2, 1], [4, 4, 3, 3, 2], [4, 4, 4, 3, 2, 1], [4, 4, 4, 3, 3, 2],
            [4, 4, 4, 4, 3, 2, 1], [4, 4, 4, 4, 3, 3, 2], [4, 4, 4, 4, 4, 3, 2, 1],
            [4, 4, 4, 4, 4, 3, 3, 2], [4, 4, 4, 4, 4, 4, 3, 2, 1], [4, 4, 4, 4, 4, 4, 3, 3, 2],
            [4, 4, 4, 4, 4, 4, 4, 3, 2, 1], [4, 4, 4, 4, 4, 4, 4, 3, 3, 2],
            [4, 4, 4, 4, 4, 4, 4, 4, 3, 3], [4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
        ],
        // Sorcerer/oracle/psychic — cantrips are at-will (null).
        nine_spontaneous: [
            [null, 3], [null, 4], [null, 5], [null, 6, 3], [null, 6, 4], [null, 6, 5, 3],
            [null, 6, 6, 4], [null, 6, 6, 5, 3], [null, 6, 6, 6, 4], [null, 6, 6, 6, 5, 3],
            [null, 6, 6, 6, 6, 4], [null, 6, 6, 6, 6, 5, 3], [null, 6, 6, 6, 6, 6, 4],
            [null, 6, 6, 6, 6, 6, 5, 3], [null, 6, 6, 6, 6, 6, 6, 4],
            [null, 6, 6, 6, 6, 6, 6, 5, 3], [null, 6, 6, 6, 6, 6, 6, 6, 4],
            [null, 6, 6, 6, 6, 6, 6, 6, 5, 3], [null, 6, 6, 6, 6, 6, 6, 6, 6, 4],
            [null, 6, 6, 6, 6, 6, 6, 6, 6, 6],
        ],
        // Bard progression, shared by every 6-level caster (magus, alchemist, inquisitor…).
        six: [
            [null, 1], [null, 2], [null, 3], [null, 3, 1], [null, 4, 2], [null, 4, 3],
            [null, 4, 3, 1], [null, 4, 4, 2], [null, 5, 4, 3], [null, 5, 4, 3, 1],
            [null, 5, 4, 4, 2], [null, 5, 5, 4, 3], [null, 5, 5, 4, 3, 1],
            [null, 5, 5, 4, 4, 2], [null, 5, 5, 5, 4, 3], [null, 5, 5, 5, 4, 3, 1],
            [null, 5, 5, 5, 4, 4, 2], [null, 5, 5, 5, 5, 4, 3], [null, 5, 5, 5, 5, 5, 4],
            [null, 5, 5, 5, 5, 5, 5],
        ],
        // Paladin/ranger/bloodrager — delayed entry at class level 4.
        four_delayed: [
            [], [], [], [null, 0], [null, 1], [null, 1], [null, 1, 0], [null, 1, 1],
            [null, 2, 1], [null, 2, 1, 0], [null, 2, 1, 1], [null, 2, 2, 1],
            [null, 3, 2, 1, 0], [null, 3, 2, 1, 1], [null, 3, 2, 2, 1], [null, 3, 3, 2, 1],
            [null, 4, 3, 2, 1], [null, 4, 3, 2, 2], [null, 4, 4, 3, 2], [null, 4, 4, 3, 3],
        ],
    };
    /** Map a CLASS_STATS `casting` string to a slot-table shape (null = no badge). */
    function spellSlotShapeOf(castingStr) {
        const s = String(castingStr || '').toLowerCase();
        if (s.includes('prepared-spontaneous')) return null; // arcanist — its own table
        if (s.includes('9th-level')) {
            if (s.includes('prepared')) return 'nine_prepared';
            if (s.includes('spontaneous')) return 'nine_spontaneous';
            return null;
        }
        if (s.includes('6th-level')) return 'six';
        if (s.includes('4th-level')) return 'four_delayed';
        return null;
    }
    /** The standard per-day row for a shape at a class level: array per spell level 0–9
     *  (null = no slots), or null when the shape/level is off-table. */
    function standardSpellSlots(shape, classLevel) {
        const table = SPELL_SLOT_TABLES[shape];
        const lvl = Number(classLevel);
        if (!table || !Number.isFinite(lvl) || lvl < 1) return null;
        return table[Math.min(20, Math.floor(lvl)) - 1] || null;
    }
    /** PF1 bonus spells per day from the casting-ability modifier (spell levels 1–9). */
    function abilityBonusSlots(abMod, spellLevel) {
        const m = Number(abMod) || 0;
        const s = Number(spellLevel) || 0;
        if (s < 1 || s > 9 || m < s) return 0;
        return Math.floor((m - s) / 4) + 1;
    }

    // Mirrors Foundry module addingReceivedLocationToName / Feats_n_Traits prefixes.
    // labelArray → "Label: Feat"; taxDict → "Name > Child > …" (applyFeatTax).
    const FEAT_GROUPS = [
        { title: 'Flavor', listKey: 'flavor_feats', prefix: 'Flavor', start: 1, step: 1,
            taxKey: 'flavor_feat_tax_dict' },
        { title: 'Flaw', listKey: 'flaw_feats', prefix: 'Flaw', start: 1, step: 1,
            taxKey: 'flaw_feat_tax_dict' },
        { title: 'Story Feat', listKey: 'story_feats', prefix: 'Story Feat',
            customLevels: [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
            taxKey: 'story_feat_tax_dict' },
        { title: 'Feat', listKey: 'feats', prefix: 'Feat', start: 1, step: 2,
            taxKey: 'feats_feat_tax_dict' },
        { title: 'Class Bonus Feat', listKey: 'teamwork_feats', labelsKey: 'teamwork_feat_labels',
            prefix: 'Class Bonus Feat', start: 3, step: 3 },
        { title: 'Class Bonus Feat', listKey: 'class_feats', labelsKey: 'class_feat_labels',
            prefix: 'Class Bonus Feat', start: 1, step: 2, taxKey: 'class_feat_tax_dict' },
        { title: 'Bloodline Feat', listKey: 'bloodline_feats', labelsKey: 'bloodline_feat_labels',
            prefix: 'Bloodline Feat', start: 1, step: 1 },
        { title: 'Trainer', listKey: 'trainer_feats', labelsKey: 'trainer_feat_labels',
            prefix: 'Trainer', start: 1, step: 1, taxKey: 'trainer_feat_tax_dict' },
        { title: 'Profession', listKey: 'profession_feats', prefix: 'Profession', start: 1, step: 1 },
        { title: 'Sphere Feat', listKey: 'sphere_feats', prefix: 'Sphere Feat', start: 1, step: 1 },
        // No `mt_feats` group: the backend distributes every Martial Training feat into the normal
        // feats / class_feats / trainer_feats buckets (mentor-funded ones land under a Trainer slot),
        // so a dedicated group here would render each one twice and double-count it in the Bonus/Total
        // tallies. This mirrors the Foundry module, which renders MT feats only through those buckets
        // and uses the mt_feats array solely to detect martial characters.
    ];

    // Full PF1 skill list (display name, ability, optional pf1 id for ledger targets).
    const ALL_SKILLS = [
        { name: 'Acrobatics', ab: 'dex', id: 'acr', acp: true },
        { name: 'Appraise', ab: 'int', id: 'apr' },
        { name: 'Bluff', ab: 'cha', id: 'blf' },
        { name: 'Climb', ab: 'str', id: 'clm', acp: true },
        { name: 'Craft', ab: 'int', id: 'crf' },
        { name: 'Diplomacy', ab: 'cha', id: 'dip' },
        { name: 'Disable Device', ab: 'dex', id: 'dev', acp: true },
        { name: 'Disguise', ab: 'cha', id: 'dis' },
        { name: 'Escape Artist', ab: 'dex', id: 'esc', acp: true },
        { name: 'Fly', ab: 'dex', id: 'fly', acp: true },
        { name: 'Handle Animal', ab: 'cha', id: 'han' },
        { name: 'Heal', ab: 'wis', id: 'hea' },
        { name: 'Intimidate', ab: 'cha', id: 'int' },
        { name: 'Knowledge (Arcana)', ab: 'int', id: 'kar' },
        { name: 'Knowledge (Dungeoneering)', ab: 'int', id: 'kdu' },
        { name: 'Knowledge (Engineering)', ab: 'int', id: 'ken' },
        { name: 'Knowledge (Geography)', ab: 'int', id: 'kge' },
        { name: 'Knowledge (History)', ab: 'int', id: 'khi' },
        { name: 'Knowledge (Local)', ab: 'int', id: 'klo' },
        { name: 'Knowledge (Nature)', ab: 'int', id: 'kna' },
        { name: 'Knowledge (Nobility)', ab: 'int', id: 'kno' },
        { name: 'Knowledge (Planes)', ab: 'int', id: 'kpl' },
        { name: 'Knowledge (Religion)', ab: 'int', id: 'kre' },
        { name: 'Linguistics', ab: 'int', id: 'lin' },
        { name: 'Perception', ab: 'wis', id: 'per' },
        { name: 'Perform', ab: 'cha', id: 'prf' },
        { name: 'Profession', ab: 'wis', id: 'pro' },
        { name: 'Ride', ab: 'dex', id: 'rid', acp: true },
        { name: 'Sense Motive', ab: 'wis', id: 'sen' },
        { name: 'Sleight of Hand', ab: 'dex', id: 'slt', acp: true },
        { name: 'Spellcraft', ab: 'int', id: 'spl' },
        { name: 'Stealth', ab: 'dex', id: 'ste', acp: true },
        { name: 'Survival', ab: 'wis', id: 'sur' },
        { name: 'Swim', ab: 'str', id: 'swm', acp: true },
        { name: 'Use Magic Device', ab: 'cha', id: 'umd' },
    ];

    return {
        REGIONS, RACES, CLASSES, CORE_RACES, CORE_CLASSES, DEITIES,
        PF1_CONDITIONS, CONDITION_CHANGES, COMBAT_TOGGLES, TWO_HANDED_WEAPONS,
        MARQUEE_FEATURES, SIZES, SMALL_RACES, stepDice,
        CLASS_STATS, DEFAULT_CLASS_INFO, ALL_SKILLS, FEAT_GROUPS,
        SPELL_SLOT_TABLES, spellSlotShapeOf, standardSpellSlots, abilityBonusSlots,
    };
})();
