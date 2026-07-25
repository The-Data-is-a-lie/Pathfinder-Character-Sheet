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

    return {
        REGIONS, RACES, CLASSES, CORE_RACES, CORE_CLASSES, DEITIES,
        PF1_CONDITIONS, CLASS_STATS, DEFAULT_CLASS_INFO,
    };
})();
