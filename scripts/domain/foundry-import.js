// scripts/domain/foundry-import.js -- FoundryVTT pf1 actor export -> sheet payload
// (window.SheetFoundryImport). #59, shape fixed by the #46 feasibility research.
//
// Pure functions, no DOM, no network: `transform(actor)` returns `{ data, report }` where
// `data` is the same shape `/update_character_data` produces, so it hands off to the exact
// render/save pipeline every other load path already uses (adoptCharacter).
//
// WHAT AN EXPORT LOOKS LIKE
//   { name, type: 'character'|'npc', system: { abilities, attributes, details, skills,
//     traits, currency, altCurrency }, items: [ { name, type, system } ], effects, flags }
// Verified against pf1 11.11 (`systems/pf1/template.json` + real world actors), Foundry v13.
//
// THE TARGET VOCABULARY (the #46 research's "hard part #1")
// It turned out to be *mostly a pass-through*: modern pf1 stopped using dotted data paths for
// `Change.target` and now uses the same short keys this sheet's ledger already speaks
// (`ac`, `aac`, `mattack`, `wdamage`, `allSavingThrows`, `skill.per`, `cl`, `dc`, …). What is
// left is a small alias table plus a deliberate rule:
//
//   **Map only exact or narrower matches. Never silently widen a bonus.**
//
// pf1 targets the sheet expresses more loosely (`wattack` → all attacks, `ndamage` → all
// damage) are still imported but recorded in `report.approximate`, so the user is told the
// scope grew. Targets the sheet has no concept of at all (`strMod`, `ffcmd`, `climbSpeed`,
// `sensedv`, `bonusFeats`) are dropped into `report.unmapped` rather than guessed — an
// invented mapping is worse than a visible gap.
window.SheetFoundryImport = (function () {
    'use strict';

    // ------------------------------------------------------------------ detection
    /**
     * Is this JSON a pf1 actor export rather than an `/update_character_data` payload?
     * Deliberately structural (never a version string): a Foundry export always has a
     * `system` block with `abilities` + `attributes` and an `items` array, and the sheet's
     * own payload has neither.
     * @returns {{ ok: boolean, reason: string, actorType?: string, systemVersion?: string }}
     */
    function detect(json) {
        if (!json || typeof json !== 'object' || Array.isArray(json)) {
            return { ok: false, reason: 'Not a JSON object.' };
        }
        if (json.character_full_name != null || json.generator_version != null) {
            return { ok: false, reason: 'This is a generator payload, not a Foundry export.' };
        }
        const sys = json.system;
        if (!sys || typeof sys !== 'object') {
            return { ok: false, reason: 'No `system` block — not a Foundry document export.' };
        }
        if (!sys.abilities || !sys.attributes) {
            return { ok: false, reason: 'No `system.abilities` — this is not an actor export.' };
        }
        const systemId = json._stats?.systemId;
        if (systemId && systemId !== 'pf1') {
            return { ok: false, reason: `Exported from the "${systemId}" system, not pf1.` };
        }
        return {
            ok: true,
            reason: '',
            actorType: json.type || 'character',
            systemVersion: json._stats?.systemVersion || '',
        };
    }

    // ------------------------------------------------------------------ small helpers
    const num = (v, dflt = 0) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : dflt;
    };
    const str = (v) => (v == null ? '' : String(v));
    const titleCase = (s) => str(s).replace(/\b[a-z]/g, (c) => c.toUpperCase());
    /** pf1 stores item weight as `{value, total, converted}`; older exports use a number. */
    const weightOf = (system) => {
        const w = system?.weight;
        if (w == null) return null;
        if (typeof w === 'object') return w.value != null ? num(w.value, null) : null;
        return num(w, null);
    };
    /** `<p>text</p>` → `text`, for the freeform text boxes that are not HTML-aware. */
    const stripHtml = (html) => str(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // ------------------------------------------------------------------ vocabulary tables
    // pf1 `Change.target` keys this sheet's ledger speaks natively. Anything here is copied
    // through untouched. (Sourced from pf1.config.buffTargets ∩ SheetDetails.TARGET_LABELS.)
    const TARGETS_PASSTHROUGH = new Set([
        'str', 'dex', 'con', 'int', 'wis', 'cha',
        'ac', 'aac', 'sac', 'nac', 'tac', 'ffac',
        'attack', 'mattack', 'rattack', 'critConfirm', 'bab',
        'damage', 'mdamage', 'rdamage', 'wdamage',
        'fort', 'ref', 'will', 'allSavingThrows',
        'cmb', 'cmd', 'init', 'mhp', 'wounds', 'vigor', 'spellResist',
        'landSpeed', 'allSpeeds', 'carryStr', 'carryMult',
        'skills', 'unskills',
        'strSkills', 'dexSkills', 'conSkills', 'intSkills', 'wisSkills', 'chaSkills',
        'cl', 'dc', 'concentration',
    ]);
    // pf1 target → the nearest sheet target, where the sheet's version is WIDER. Imported,
    // but every use is listed in report.approximate with this explanation.
    const TARGETS_APPROXIMATE = {
        wattack: ['attack', 'weapon attacks → all attack rolls'],
        nattack: ['attack', 'natural attacks → all attack rolls'],
        tattack: ['rattack', 'thrown attacks → all ranged attacks'],
        mwdamage: ['mdamage', 'melee weapon damage → all melee damage'],
        rwdamage: ['rdamage', 'ranged weapon damage → all ranged damage'],
        twdamage: ['rdamage', 'thrown weapon damage → all ranged damage'],
        ndamage: ['damage', 'natural-attack damage → all damage'],
        sdamage: ['damage', 'spell damage → all damage'],
    };
    // pf1 bonus types → the sheet's type ids. Only two differ; `haste` has no sheet bucket,
    // so it lands as untyped (the number survives, the stacking rule does not).
    const TYPE_MAP = { deflection: 'deflect', haste: 'untyped' };
    const TYPES_KNOWN = new Set(['untyped', 'untypedPerm', 'base', 'enh', 'dodge', 'inherent',
        'morale', 'luck', 'sacred', 'insight', 'resist', 'profane', 'trait', 'racial', 'size',
        'competence', 'circumstance', 'alchemical', 'penalty', 'deflect']);
    // Sheet skill ids are pf1 skill ids verbatim (both are the PF1 three-letter abbreviations),
    // so only the *display* name differs — this is the id → `skill_ranks` key map.
    const SKILL_KEYS = {
        acr: 'acrobatics', apr: 'appraise', art: 'artistry', blf: 'bluff', clm: 'climb',
        crf: 'craft', dev: 'disable device', dip: 'diplomacy', dis: 'disguise',
        esc: 'escape artist', fly: 'fly', han: 'handle animal', hea: 'heal', int: 'intimidate',
        kar: 'knowledge arcana', kdu: 'knowledge dungeoneering', ken: 'knowledge engineering',
        kge: 'knowledge geography', khi: 'knowledge history', klo: 'knowledge local',
        kna: 'knowledge nature', kno: 'knowledge nobility', kpl: 'knowledge planes',
        kre: 'knowledge religion', lin: 'linguistics', lor: 'lore', per: 'perception',
        prf: 'perform', pro: 'profession', rid: 'ride', sen: 'sense motive',
        slt: 'sleight of hand', spl: 'spellcraft', ste: 'stealth', sur: 'survival',
        swm: 'swim', umd: 'use magic device',
    };
    const SIZE_MAP = {
        fine: 'fine', dim: 'diminutive', tiny: 'tiny', sm: 'small', med: 'medium',
        lg: 'large', huge: 'huge', grg: 'gargantuan', col: 'colossal',
    };
    const ALIGNMENTS = {
        lg: 'Lawful Good', ng: 'Neutral Good', cg: 'Chaotic Good',
        ln: 'Lawful Neutral', tn: 'True Neutral', n: 'True Neutral', cn: 'Chaotic Neutral',
        le: 'Lawful Evil', ne: 'Neutral Evil', ce: 'Chaotic Evil',
    };
    // pf1 stores languages as lowercase keys; the sheet's Languages box is prose.
    const LANGUAGE_LABELS = {
        common: 'Common', abyssal: 'Abyssal', aklo: 'Aklo', aquan: 'Aquan', auran: 'Auran',
        celestial: 'Celestial', draconic: 'Draconic', druidic: 'Druidic', dwarven: 'Dwarven',
        elven: 'Elven', giant: 'Giant', gnome: 'Gnome', goblin: 'Goblin', gnoll: 'Gnoll',
        halfling: 'Halfling', ignan: 'Ignan', infernal: 'Infernal', orc: 'Orc',
        protean: 'Protean', sylvan: 'Sylvan', terran: 'Terran', undercommon: 'Undercommon',
        tengu: 'Tengu', necril: 'Necril', shadowtongue: 'Shadowtongue', vegepygmy: 'Vegepygmy',
    };
    // pf1 damage/energy-resistance and condition keys → the labels the Defenses chips use.
    const DAMAGE_TYPE_LABELS = {
        fire: 'Fire', cold: 'Cold', electric: 'Electricity', acid: 'Acid', sonic: 'Sonic',
        force: 'Force', negative: 'Negative', positive: 'Positive',
        slashing: 'Slashing', piercing: 'Piercing', bludgeoning: 'Bludgeoning',
        magic: 'Magic', epic: 'Epic', good: 'Good', evil: 'Evil', lawful: 'Lawful',
        chaotic: 'Chaotic', silver: 'Silver', adamantine: 'Adamantine', coldiron: 'Cold Iron',
    };

    /**
     * pf1 change target → sheet ledger target.
     * @returns {{ target: string|null, note: string }} — `target: null` means "not importable".
     */
    function mapTarget(raw) {
        const t = str(raw).trim();
        if (!t) return { target: null, note: 'empty target' };
        if (t.startsWith('~')) return { target: null, note: 'pf1 internal target' };
        if (TARGETS_PASSTHROUGH.has(t)) return { target: t, note: '' };
        if (TARGETS_APPROXIMATE[t]) {
            const [target, note] = TARGETS_APPROXIMATE[t];
            return { target, note };
        }
        // `skill.per`, and `skill.crf.crf1` for a subskill — the sheet scopes to the parent.
        if (t.startsWith('skill.')) {
            const parts = t.split('.');
            const id = parts[1];
            if (!SKILL_KEYS[id]) return { target: null, note: 'unknown skill id' };
            return parts.length > 2
                ? { target: 'skill.' + id, note: `subskill ${t} → the whole ${SKILL_KEYS[id]} skill` }
                : { target: 'skill.' + id, note: '' };
        }
        // Spellbook/school-scoped caster stats: `cl.book.primary`, `dc.school.evo`, `concn.primary`.
        if (/^cl\./.test(t)) return { target: 'cl', note: `${t} → caster level (book/school scope dropped)` };
        if (/^dc\./.test(t)) return { target: 'dc', note: `${t} → spell DC (school scope dropped)` };
        if (/^concn\b/.test(t)) return { target: 'concentration', note: `${t} → concentration (book scope dropped)` };
        return { target: null, note: 'no equivalent on this sheet' };
    }

    function mapType(raw) {
        const t = str(raw).trim() || 'untyped';
        const mapped = TYPE_MAP[t] || t;
        return TYPES_KNOWN.has(mapped) ? mapped : 'untyped';
    }

    /**
     * pf1 `changes[]` → sheet ledger changes, collecting anything lost into `report`.
     * `sourceName` is only used to label report lines.
     */
    function mapChanges(changes, sourceName, report) {
        const out = [];
        for (const c of Array.isArray(changes) ? changes : []) {
            const { target, note } = mapTarget(c?.target);
            if (!target) {
                if (note !== 'pf1 internal target') {
                    report.unmapped.push({ source: sourceName, target: str(c?.target), why: note });
                }
                continue;
            }
            if (note) report.approximate.push({ source: sourceName, target: str(c?.target), why: note });
            out.push({
                formula: str(c?.formula ?? c?.value ?? '0'),
                target,
                type: mapType(c?.type),
                operator: c?.operator === 'set' ? 'set' : 'add',
                priority: num(c?.priority, 0),
                ...(c?.flavor ? { flavor: str(c.flavor) } : {}),
            });
        }
        return out;
    }

    /** pf1 `contextNotes[]` → the sheet's situational-note shape (same fields, mapped target). */
    function mapContextNotes(notes, sourceName, report) {
        const out = [];
        for (const n of Array.isArray(notes) ? notes : []) {
            const text = stripHtml(n?.text);
            if (!text) continue;
            const { target } = mapTarget(n?.target);
            if (!target) {
                report.unmapped.push({ source: sourceName, target: str(n?.target), why: 'context note target' });
                continue;
            }
            out.push({ text, target });
        }
        return out;
    }

    // ------------------------------------------------------------------ class chassis
    // pf1 class items carry the progression as words; both sides describe the same PF1 tables.
    const BAB_LABEL = { high: 'Full', med: '3/4', low: '1/2' };
    const babFor = (prog, lvl) => (prog === 'high' ? lvl
        : prog === 'med' ? Math.floor(lvl * 3 / 4) : Math.floor(lvl / 2));
    const saveFor = (prog, lvl) => (lvl <= 0 ? 0
        : prog === 'high' ? 2 + Math.floor(lvl / 2) : Math.floor(lvl / 3));

    // ------------------------------------------------------------------ the transform
    /**
     * @param {object} actor    a parsed pf1 actor export
     * @returns {{ data: object, report: object }}
     */
    function transform(actor) {
        const report = {
            actorName: str(actor?.name),
            actorType: str(actor?.type),
            systemVersion: str(actor?._stats?.systemVersion),
            counts: {},        // what came across, by kind
            approximate: [],   // imported, but the sheet scopes it more loosely
            unmapped: [],      // dropped: no sheet equivalent
            skipped: [],       // whole items/systems left behind, with the reason
            derived: [],       // values the sheet recomputes rather than reading
        };
        const sys = actor?.system || {};
        const items = Array.isArray(actor?.items) ? actor.items : [];
        const byType = (t) => items.filter((i) => i && i.type === t);

        const data = {};
        const sheet = {};
        data._sheet = sheet;

        // ---------------------------------------------------------- identity & vitals
        data.character_full_name = str(actor?.name) || 'Imported character';
        const details = sys.details || {};
        const alignKey = str(details.alignment).toLowerCase();
        data.mini_alignment = alignKey;
        data.alignment = ALIGNMENTS[alignKey] || titleCase(alignKey);
        data.gender = titleCase(details.gender);
        data.deity_name = str(details.deity);
        data.age_number = num(details.age, 0);
        data.weight_number = num(details.weight, 0);
        data.height_number = parseHeight(details.height);
        data.region = '';   // pf1 has no homeland field; the generator's is prose-only
        data.hero_points = num(details.heroPoints?.value ?? details.heroPoints, 0);

        // ---------------------------------------------------------- abilities
        // pf1 keeps a clean base score (`value`) with every item/buff bonus living in the
        // changes ledger — exactly the split this sheet wants, so no backing-out is needed.
        // Damage/drain/user penalty go straight into the Attributes tab's own columns.
        const adjust = {};
        for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
            const a = sys.abilities?.[ab] || {};
            data[ab] = num(a.value, 10);
            const cols = {};
            if (num(a.damage)) cols.damage = num(a.damage);
            if (num(a.drain)) cols.drain = num(a.drain);
            if (num(a.userPenalty)) cols.misc = -Math.abs(num(a.userPenalty));
            if (Object.keys(cols).length) adjust[ab] = cols;
        }
        if (Object.keys(adjust).length) sheet.abilityAdjust = adjust;
        // The generator's racial/level-up/inherent seeding must not run over an import: pf1's
        // base score already excludes every one of those, so seeding would double-count.
        sheet.statSeeded = true;
        sheet.racialSeeded = true;
        data.racial_stats = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
        data.inherents = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
        data.level_up_stats = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };

        // ---------------------------------------------------------- classes
        const classItems = byType('class');
        const classes = [];
        const classInfo = {};
        for (const it of classItems) {
            const cs = it.system || {};
            const level = num(cs.level, 0);
            const key = str(cs.tag).toLowerCase() || str(it.name).toLowerCase();
            classes.push({ name: key, display: str(it.name), level });
            // The class card's chassis, straight from the class item: whatever the world had
            // (homebrew, archetype-modified) beats this sheet's built-in PF1 table.
            const info = {};
            if (num(cs.hd)) info.hd = num(cs.hd);
            if (BAB_LABEL[cs.bab]) info.bab = BAB_LABEL[cs.bab];
            for (const [s, field] of [['fort', 'fort'], ['ref', 'ref'], ['will', 'will']]) {
                const prog = str(cs.savingThrows?.[s]?.value);
                if (prog) info[field] = prog === 'high' ? 'Good' : 'Poor';
            }
            if (num(cs.skillsPerLevel)) info.skills = num(cs.skillsPerLevel);
            const cSkills = Object.entries(cs.classSkills || {})
                .filter(([, on]) => on === true).map(([id]) => id);
            if (cSkills.length) info.classSkills = cSkills;
            const profs = [].concat(cs.weaponProf || []).map(titleCase).filter(Boolean);
            if (profs.length) info.weaponProf = profs.join(', ');
            const aProfs = [].concat(cs.armorProf || []).map(titleCase).filter(Boolean);
            if (aProfs.length) info.armorProf = aProfs.join(', ');
            if (Object.keys(info).length) classInfo[key] = info;
        }
        if (Object.keys(classInfo).length) sheet.classInfo = classInfo;
        data.classes = classes;
        const totalLevel = classes.reduce((a, c) => a + c.level, 0);
        data.level = totalLevel;
        data.total_level = totalLevel;
        // A pf1 actor can carry level-0 class items (prestige/archetype placeholders). They
        // stay in `classes[]` so nothing is lost, but the four header label slots show only
        // classes the character actually has levels in.
        const leveled = classes.filter((c) => c.level > 0);
        data.c_class = leveled[0]?.name || classes[0]?.name || '';
        data.c_class_display = leveled[0]?.display || classes[0]?.display || '';
        data.c_class_2 = leveled[1]?.display || '';
        data.c_class_3 = leveled[2]?.display || '';
        data.c_class_4 = leveled[3]?.display || '';
        report.counts.classes = classes.length;

        // BAB and base saves: pf1 derives both from the class items at runtime and exports only
        // the manual extra on the actor, so they are recomputed here from the same progressions.
        let bab = 0;
        const saves = { fort: 0, ref: 0, will: 0 };
        for (const it of classItems) {
            const cs = it.system || {};
            const lvl = num(cs.level, 0);
            bab += babFor(str(cs.bab), lvl);
            for (const s of ['fort', 'ref', 'will']) {
                saves[s] += saveFor(str(cs.savingThrows?.[s]?.value), lvl);
            }
        }
        for (const s of ['fort', 'ref', 'will']) {
            saves[s] += num(sys.attributes?.savingThrows?.[s]?.base, 0);
        }
        data.bab_total = bab;
        data.save_bases = saves;
        report.derived.push('BAB and base saves recomputed from each class item’s progression '
            + '(pf1 exports them as derived values, not stored numbers).');

        // ---------------------------------------------------------- race
        const raceItem = byType('race')[0];
        data.chosen_race = str(raceItem?.name) || '';
        const attrs = sys.attributes || {};
        data.land_speed = num(attrs.speed?.land?.base, num(raceItem?.system?.speeds?.land, 30));
        const sizeKey = str(sys.traits?.size || raceItem?.system?.size);
        if (SIZE_MAP[sizeKey] && SIZE_MAP[sizeKey] !== 'medium') sheet.size = SIZE_MAP[sizeKey];
        // Racial ability bumps arrive as ordinary `changes[]` on the race item, so they enter
        // the ledger with everything else (see the buff/permanent-source pass below).

        // ---------------------------------------------------------- hit points
        // pf1 exports rolled HD as `attributes.hp.base` and derives max/current; the sheet
        // computes max the same way (rolled + Con×level + feats), so only rolled HP is read.
        data.total_rolled_hp = num(attrs.hp?.base, 0);
        data.Total_HP = null;    // recomputed live by SheetDerive
        if (num(attrs.hp?.temp)) sheet.hpTemp = num(attrs.hp.temp);
        if (num(attrs.hp?.nonlethal)) sheet.hpNonlethal = num(attrs.hp.nonlethal);
        report.derived.push('Max HP is recomputed from rolled hit dice + Con — pf1 exports only '
            + 'the total, so current HP starts full.');
        if (num(attrs.energyDrain)) sheet.negativeLevels = num(attrs.energyDrain);

        // ---------------------------------------------------------- skills
        const ranks = {};
        const skillBonuses = {};
        const subSkills = {};
        for (const [id, sk] of Object.entries(sys.skills || {})) {
            const key = SKILL_KEYS[id];
            if (!key) { report.unmapped.push({ source: 'skills', target: id, why: 'unknown skill id' }); continue; }
            ranks[key] = num(sk?.rank, 0);
            for (const sub of Object.values(sk?.subSkills || {})) {
                const label = str(sub?.name).replace(/^[^:]+:\s*/, '').trim();
                if (!label) continue;
                (subSkills[id] ??= []).push(label);
            }
        }
        // CS is not a skill-level flag in pf1 — it lives on every class item's `classSkills`
        // set, so it is the union across the character's classes.
        for (const it of classItems) {
            for (const [id, on] of Object.entries(it.system?.classSkills || {})) {
                if (on === true && SKILL_KEYS[id]) (skillBonuses[id] ??= {}).cs = true;
            }
        }
        data.skill_ranks = ranks;
        if (Object.keys(skillBonuses).length) sheet.skillBonuses = skillBonuses;
        if (Object.keys(subSkills).length) sheet.subSkills = subSkills;
        // Class skills are explicit now, so the generator's one-time seeding must not re-run.
        sheet.classSkillsSeeded = true;
        report.counts.skills = Object.keys(ranks).length;

        // ---------------------------------------------------------- traits & defenses
        const traits = sys.traits || {};
        data.language_text = [].concat(traits.languages?.value || traits.languages || [])
            .map((l) => LANGUAGE_LABELS[str(l).toLowerCase()] || titleCase(l))
            .filter(Boolean);
        const misc = {};
        const senses = sensesText(traits.senses);
        if (senses) misc.senses = senses;
        const aura = str(typeof traits.aura === 'object' ? traits.aura?.custom : traits.aura);
        if (aura) misc.aura = aura;
        const wProf = profText(traits.weaponProf);
        if (wProf) misc.weaponProf = wProf;
        const aProf = profText(traits.armorProf);
        if (aProf) misc.armorProf = aProf;
        if (Object.keys(misc).length) sheet.miscInfo = misc;

        const defenses = {
            dr: drChips(traits.dr),
            resist: erChips(traits.eres),
            dmgImmune: typeChips(traits.di),
            dmgVuln: typeChips(traits.dv),
            condImmune: typeChips(traits.ci),
            condResist: typeChips(traits.cres),
        };
        // Regeneration / fast healing / hardness share the same `_sheet.defenses` bag as the
        // chip lists (the Defenses tab's Healing & Toughness boxes read it), so they are only
        // attached once the bag exists.
        if (num(traits.regen) || num(traits.fastHealing) || num(traits.hardness)
            || Object.values(defenses).some((v) => v.length)) {
            sheet.defenses = defenses;
            if (num(traits.regen)) defenses.regen = num(traits.regen);
            else if (str(traits.regen)) defenses.regenBypass = str(traits.regen);
            if (num(traits.fastHealing)) defenses.fastHealing = num(traits.fastHealing);
            if (num(traits.hardness)) defenses.hardness = num(traits.hardness);
        }
        const srFormula = str(attrs.sr?.formula);
        if (srFormula && /^\d+$/.test(srFormula.trim())) sheet.sr = num(srFormula);
        else if (srFormula) report.unmapped.push({ source: 'spell resistance', target: srFormula, why: 'formula SR — enter a number on Defenses' });

        // ---------------------------------------------------------- currency
        // pf1's pp is a real coin count, not the generator's derived `gold / 10` duplicate, so
        // the normalize-once guard is pre-tripped to stop it zeroing a genuine platinum purse.
        const cur = sys.currency || {};
        const alt = sys.altCurrency || {};
        data.platinum = num(cur.pp) + num(alt.pp);
        data.gold = num(cur.gp) + num(alt.gp);
        data.silver = num(cur.sp) + num(alt.sp);
        data.copper = num(cur.cp) + num(alt.cp);
        data.platnium = data.platinum;
        sheet.currencyNormalized = true;

        // ---------------------------------------------------------- inventory
        const PHYSICAL = { weapon: 'weapon', equipment: 'equipment', consumable: 'consumable', loot: 'loot', container: 'container', implant: 'equipment' };
        const equipment = [];
        const equipDescrip = {};
        let coreWeapon = null; let coreArmor = null; let coreShield = null;
        for (const it of items) {
            const itemType = PHYSICAL[it?.type];
            if (!itemType) continue;
            const is = it.system || {};
            const identifiedHtml = str(is.description?.value);
            const entry = {
                id: 'fdy:' + str(it._id || it.name).toLowerCase().replace(/\s+/g, '-'),
                name: str(it.name),
                equipped: is.equipped === true,
                carried: is.carried !== false,
                identified: is.identified !== false,
                quantity: Math.max(0, num(is.quantity, 1)),
                weight: weightOf(is),
                price: is.price != null ? num(is.price, null) : null,
                description: identifiedHtml,
                unidentifiedDescription: str(is.description?.unidentified),
                changes: mapChanges(is.changes, it.name, report),
                contextNotes: mapContextNotes(is.contextNotes, it.name, report),
                changesCustomized: true,   // these came from the world, not the compendium
                subType: str(is.subType),
                equipmentSubtype: str(is.equipmentSubtype),
                slot: str(is.slot),
                itemType: it.type === 'implant' ? 'equipment' : it.type,
                masterwork: is.masterwork === true,
                broken: is.broken === true,
                hardness: num(is.hardness, null),
                hp: { value: num(is.hp?.value, null), max: num(is.hp?.max, null) },
                containerId: null,
            };
            if (num(is.enh)) entry.enh = num(is.enh);
            if (is.armor) {
                entry.armor = {
                    value: num(is.armor.value, 0),
                    dex: is.armor.dex == null ? null : num(is.armor.dex),
                    acp: num(is.armor.acp, 0),
                };
                if (num(is.spellFailure)) entry.spellFailure = num(is.spellFailure);
                // pf1 keeps an armor/shield's enhancement bonus in its own `armor.enh` field
                // and adds it at derive time. This sheet reads enhancement off the `[+N, …]`
                // name suffix, which a Foundry name ("+5 Agile Breastplate") does not use — so
                // the bonus is carried as an explicit enhancement-typed change instead, which
                // is what the Defenses AC grid's Enhancement row reads anyway.
                const aEnh = num(is.armor.enh);
                if (aEnh) {
                    entry.changes.push({
                        formula: String(aEnh),
                        target: str(is.slot) === 'shield' ? 'sac' : 'aac',
                        type: 'enh', operator: 'add', priority: 0,
                        flavor: 'Enhancement bonus',
                    });
                }
            }
            const weaponAction = (is.actions || [])[0];
            if (it.type === 'weapon' && weaponAction) {
                entry.weapon = weaponStats(weaponAction, is);
            }
            equipment.push(entry);
            if (identifiedHtml) equipDescrip[entry.name] = identifiedHtml;
            // The legacy weapon_name / armor_* fields still drive the combat math, so the
            // equipped gear is mirrored there as well as into the list.
            if (entry.equipped) {
                if (it.type === 'weapon' && !coreWeapon) coreWeapon = entry;
                else if (str(is.slot) === 'armor' && !coreArmor) coreArmor = entry;
                else if (str(is.slot) === 'shield' && !coreShield) coreShield = entry;
            }
        }
        data.equipment_list = equipment;
        data.equip_descrip = equipDescrip;
        report.counts.items = equipment.length;
        // Already-real inventory rows: the core-gear migration would duplicate them.
        sheet.coreGearMigrated = true;
        data.weapon_name = coreWeapon?.name || '';
        data.armor_name = coreArmor?.name || '';
        data.shield_name = coreShield?.name || '';
        data.armor_ac = coreArmor?.armor?.value ?? 0;
        data.armor_max_dex_bonus = coreArmor?.armor?.dex ?? '';
        data.armor_armor_check_penalty = coreArmor?.armor?.acp ?? 0;
        data.armor_spell_failure = coreArmor?.spellFailure ?? 0;
        data.armor_weight = coreArmor?.weight ?? 0;
        data.shield_ac = coreShield?.armor?.value ?? 0;
        data.shield_armor_check_penalty = coreShield?.armor?.acp ?? 0;
        data.shield_spell_failure = coreShield?.spellFailure ?? 0;
        data.shield_max_dex_bonus = coreShield?.armor?.dex ?? '';
        data.shield_weight = coreShield?.weight ?? 0;
        if (num(attrs.naturalAC)) {
            sheet.buffs = [{
                id: 'fdy-natural-ac', name: 'Natural armor (imported)', subType: 'perm',
                active: true, level: 0, duration: { value: '', units: '' },
                changes: [{ formula: String(num(attrs.naturalAC)), target: 'nac', type: 'untyped', operator: 'add', priority: 0 }],
                contextNotes: [], notes: 'From the Foundry actor’s Natural AC field.',
            }];
        }

        // ---------------------------------------------------------- feats & features
        // pf1 feat items are one unordered bag with a subType; the sheet's acquisition-slot
        // bookkeeping ((Feat 1) / (Flaw 2) / tax chains) has no pf1 equivalent, so every feat
        // lands in the plain `feats` list and the Features tab's Missing/Excess badge does the
        // rest. Names the generator itself wrote ("(Feat 11) Lucky Boy") keep their labels.
        const feats = []; const traitsPicked = []; const classFeatures = {};
        const featChanges = {}; const classFeatureChanges = {}; const featureOwners = {};
        for (const it of byType('feat')) {
            const is = it.system || {};
            const name = str(it.name);
            if (!name || /^_{3,}/.test(name)) continue;   // Foundry sheet separators
            const changes = mapChanges(is.changes, name, report);
            const notes = mapContextNotes(is.contextNotes, name, report);
            const entry = { changes, contextNotes: notes };
            const sub = str(is.subType);
            if (sub === 'trait' || sub === 'racial') {
                traitsPicked.push(name);
                if (changes.length || notes.length) featChanges[name] = entry;
            } else if (sub === 'classFeat') {
                classFeatures[name] = stripHtml(is.description?.value);
                if (changes.length || notes.length) classFeatureChanges[name] = entry;
                const owner = str(is.class || [].concat(is.associations?.classes || [])[0]);
                if (owner) featureOwners[name] = owner.toLowerCase();
            } else {
                feats.push(name);
                if (changes.length || notes.length) featChanges[name] = entry;
            }
        }
        data.feats = feats;
        data.selected_traits = traitsPicked;
        data.class_features = classFeatures;
        data.class_feature_owners = featureOwners;
        data.feat_changes_dict = featChanges;
        data.class_feature_changes_dict = classFeatureChanges;
        for (const k of ['class_feats', 'flavor_feats', 'story_feats', 'flaw_feats', 'teamwork_feats', 'bloodline_feats', 'trainer_feats', 'profession_feats']) data[k] = [];
        report.counts.feats = feats.length;
        report.counts.classFeatures = Object.keys(classFeatures).length;
        report.counts.traits = traitsPicked.length;
        if (feats.length) {
            report.skipped.push('Feat acquisition slots — pf1 stores feats as an unordered list '
                + 'with no "which level bought this" metadata, so every feat lands unslotted and '
                + 'the Features tab’s feat-count badge will flag the difference.');
        }

        // ---------------------------------------------------------- buffs
        const buffs = sheet.buffs || [];
        for (const it of byType('buff')) {
            const is = it.system || {};
            const name = str(it.name);
            const changes = mapChanges(is.changes, name, report);
            const notes = mapContextNotes(is.contextNotes, name, report);
            buffs.push({
                id: 'fdy-buff-' + str(it._id || name).toLowerCase().replace(/\s+/g, '-'),
                name,
                subType: ['temp', 'perm', 'item', 'misc', 'spell', 'feat'].includes(str(is.subType)) ? str(is.subType) : 'temp',
                active: is.active === true,
                level: num(is.level, 0),
                duration: { value: str(is.duration?.value), units: str(is.duration?.units) },
                changes,
                contextNotes: notes,
                notes: stripHtml(is.description?.value).slice(0, 2000),
            });
        }
        if (buffs.length) sheet.buffs = buffs;
        report.counts.buffs = byType('buff').length;

        // ---------------------------------------------------------- spellbooks
        const spellItems = byType('spell');
        const books = Object.entries(sys.attributes?.spells?.spellbooks || {})
            .filter(([, b]) => b && b.inUse === true);
        const bookViews = books.map(([key, b]) => buildBook(key, b, spellItems, classes));
        const primary = bookViews[0];
        if (primary) {
            data.spell_list_choose_from = primary.lists;
            data.spells_prepared_names = primary.prepared;
            data.day_list = primary.dayList;
            data.spells_prepared_per_level = primary.dayList;
            data.casting_stat = primary.castAb;
            data.main_stat = primary.castAb;
            data.casting_level_str_foundry = primary.casterType;
            data.known_list = primary.mode === 'prepared' ? [] : primary.lists.flat();
            if (bookViews.length > 1) {
                sheet.extraSpellbooks = bookViews.slice(1).map((v, i) => ({
                    id: 'fdy-book-' + i, name: v.name, castAb: v.castAb, cl: v.cl,
                    preparedMode: v.mode, dayList: v.dayList, lists: v.lists,
                    prepared: v.prepared, casts: v.dayList.slice(),
                }));
            }
            report.derived.push('Spells per day are the standard PF1 table for each book’s caster '
                + 'progression — pf1 computes slots on the fly and exports only offsets.');
        }
        report.counts.spells = spellItems.length;
        report.counts.spellbooks = bookViews.length;

        // ---------------------------------------------------------- Path of War
        // The #46 audit called PoW unmappable because it lives in a third-party module. In
        // practice its items ride along in the same export under `pf1-pow.maneuver`, carrying
        // exactly what this sheet's PoW tab needs (name, discipline, level, maneuver type),
        // so they are imported when present and simply absent when they are not.
        const maneuverItems = items.filter((i) => str(i?.type).endsWith('maneuver'));
        if (maneuverItems.length) {
            const descs = {}; const stances = []; const byLevel = [];
            const disciplines = new Set();
            for (const it of maneuverItems) {
                const is = it.system || {};
                const name = str(it.name);
                const level = Math.max(1, num(is.level, 1));
                const kind = str(is.maneuverType).toLowerCase();
                const isStance = kind === 'stance' || /^\(stance\)/i.test(name);
                descs[name] = {
                    level, type: isStance ? 'stance' : (kind || 'strike'),
                    discipline: str(is.discipline),
                    description: str(is.description?.value),
                };
                if (str(is.discipline)) disciplines.add(str(is.discipline));
                if (isStance) stances.push(name);
                else ((byLevel[level - 1] ??= [])).push(name);
            }
            for (let i = 0; i < byLevel.length; i++) byLevel[i] ??= [];
            data.maneuvers_desc_dict = descs;
            data.maneuvers_choose_from = byLevel;
            data.maneuvers_known_list = byLevel.map((a) => a.length);
            data.maneuvers_readied_names = byLevel.map(() => []);
            data.stances_chosen = stances;
            data.martial_disciplines = [...disciplines];
            data.initiator_level = Math.max(1, Math.ceil(totalLevel / 2));
            data.initiation_stat = primary?.castAb || 'wis';
            report.counts.maneuvers = maneuverItems.length;
            report.derived.push('Initiator level estimated as half character level — the Path of '
                + 'War module does not export it; readied maneuvers start empty.');
        }
        // Spheres of Power lives in `pf1spheres` with a schema this transform does not read.
        if (items.some((i) => /sphere/i.test(str(i?.type)))) {
            report.skipped.push('Spheres of Power items — the pf1spheres module has its own '
                + 'schema; the Spheres tab stays empty.');
        }

        // ---------------------------------------------------------- prose
        const bio = str(details.biography?.value);
        const noteText = str(details.notes?.value);
        sheet.prose = {
            description: bio,
            personality: '',
            notes: noteText,
        };
        sheet.notes = stripHtml(noteText);
        data.backstory = stripHtml(bio);
        data.formatted_bio = bio;

        // ---------------------------------------------------------- provenance
        sheet.importedFrom = {
            source: 'foundry-pf1',
            actorType: str(actor?.type),
            systemVersion: str(actor?._stats?.systemVersion),
        };
        data.generator_version = 'foundry-import';

        return { data, report };
    }

    // ------------------------------------------------------------------ sub-transforms
    /** `5'7"` / `67` / `170 cm` → inches, the unit the sheet's Biography box uses. */
    function parseHeight(raw) {
        const s = str(raw).trim();
        if (!s) return 0;
        const ft = s.match(/(\d+)\s*(?:'|ft|feet)\s*(\d+)?/i);
        if (ft) return num(ft[1]) * 12 + num(ft[2]);
        const cm = s.match(/(\d+(?:\.\d+)?)\s*cm/i);
        if (cm) return Math.round(num(cm[1]) / 2.54);
        return num(s.replace(/[^\d.]/g, ''), 0);
    }
    /** pf1's structured senses block → the Attributes tab's freeform Senses line. */
    function sensesText(senses) {
        if (!senses || typeof senses !== 'object') return '';
        const parts = [];
        const ranged = { dv: 'Darkvision', ts: 'Tremorsense', bs: 'Blindsight', bse: 'Blindsense', sc: 'Scent', tr: 'True seeing' };
        for (const [key, label] of Object.entries(ranged)) {
            const v = num(senses[key]);
            if (v > 0) parts.push(`${label} ${v} ft.`);
        }
        if (num(senses.ls?.value) > 0) parts.push(`Lifesense ${num(senses.ls.value)} ft.`);
        if (senses.ll?.enabled) parts.push('Low-light vision');
        if (senses.si) parts.push('See invisibility');
        if (senses.sid) parts.push('See in darkness');
        if (str(senses.custom)) parts.push(str(senses.custom));
        return parts.join(', ');
    }
    /** pf1 proficiency block (`{value: [], custom: []}`) → prose. */
    function profText(prof) {
        if (!prof) return '';
        const list = [].concat(prof.value || []).map(titleCase);
        const custom = typeof prof.custom === 'string'
            ? prof.custom.split(/[;,]/) : [].concat(prof.custom || []);
        return [...list, ...custom.map((c) => str(c).trim())].filter(Boolean).join(', ');
    }
    /** pf1 DR entries (`{amount, types, operator}`) → the Defenses chip list. */
    function drChips(dr) {
        const out = [];
        for (const e of [].concat(dr?.value || [])) {
            const types = [].concat(e?.types || []).filter(Boolean)
                .map((t) => DAMAGE_TYPE_LABELS[str(t).toLowerCase()] || titleCase(t));
            const joiner = e?.operator === true || e?.operator === 1 ? ' and ' : ' or ';
            out.push({ amount: num(e?.amount, 0), type: types.join(joiner) || '—' });
        }
        for (const t of splitCustom(dr?.custom)) {
            const m = t.match(/(\d+)\s*\/\s*(.+)/);
            if (m) out.push({ amount: num(m[1]), type: m[2].trim() });
        }
        return out;
    }
    /** pf1 energy resistance (`{amount, types}`) → chips. */
    function erChips(eres) {
        const out = [];
        for (const e of [].concat(eres?.value || [])) {
            const t = [].concat(e?.types || [])[0];
            out.push({ amount: num(e?.amount, 0), type: DAMAGE_TYPE_LABELS[str(t).toLowerCase()] || titleCase(t) || '—' });
        }
        for (const t of splitCustom(eres?.custom)) {
            const m = t.match(/(.+?)\s*(\d+)|(\d+)\s*(.+)/);
            if (m) out.push({ amount: num(m[2] || m[3]), type: str(m[1] || m[4]).trim() });
        }
        return out;
    }
    /** Type-only chip lists (immunities, vulnerabilities, condition immunities). */
    function typeChips(block) {
        if (!block) return [];
        const list = typeof block === 'string' ? splitCustom(block)
            : [...[].concat(block.value || []), ...splitCustom(block.custom)];
        return list.filter(Boolean)
            .map((t) => ({ type: DAMAGE_TYPE_LABELS[str(t).toLowerCase()] || titleCase(t) }));
    }
    const splitCustom = (v) => (typeof v === 'string' ? v.split(/[;,]/) : [].concat(v || []))
        .map((s) => str(s).trim()).filter(Boolean);

    /** pf1 nests weapon dice/crit inside `actions[0]`; the sheet keeps them flat on the item. */
    function weaponStats(action, is) {
        const parts = [].concat(action?.damage?.parts || []).map((p) => ({
            formula: str(p?.formula).replace(/sizeRoll\((\d+),\s*(\d+)[^)]*\)/i, '$1d$2'),
            type: [].concat(p?.type?.values || []).join(', ') || str(p?.type?.custom),
        })).filter((p) => p.formula);
        return {
            actionType: str(action?.actionType),
            damageParts: parts,
            damageDice: parts[0]?.formula || '',
            damageAbility: str(action?.ability?.damage),
            attackAbility: str(action?.ability?.attack),
            critRange: num(action?.ability?.critRange, 20),
            critMult: num(action?.ability?.critMult, 2),
            enh: num(is?.enh, 0),
            masterwork: is?.masterwork === true,
        };
    }

    /**
     * One pf1 spellbook + the actor's spell items → the sheet's per-level view.
     * Slots come from this sheet's own PF1 tables: pf1 computes spells/day at runtime from the
     * caster progression and exports only the manual offset formulas, so there is nothing to read.
     */
    function buildBook(key, book, spellItems, classes) {
        const mine = spellItems.filter((s) => str(s.system?.spellbook) === key);
        const lists = []; const prepared = [];
        for (const s of mine) {
            const lvl = Math.min(9, Math.max(0, num(s.system?.level, 0)));
            (lists[lvl] ??= []).push(str(s.name));
            if (num(s.system?.preparation?.value) > 0 || num(s.system?.preparation?.max) > 0) {
                (prepared[lvl] ??= []).push(str(s.name));
            }
        }
        for (let i = 0; i < 10; i++) { lists[i] ??= []; prepared[i] ??= []; }
        const classKey = str(book.class).toLowerCase();
        const level = classes.find((c) => c.name === classKey)?.level
            || classes.reduce((a, c) => a + c.level, 0);
        const cl = num(book.cl?.total, 0) || casterLevelFor(str(book.casterType), level);
        return {
            key,
            name: str(book.name) || titleCase(key),
            castAb: str(book.ability) || 'int',
            cl,
            casterType: str(book.casterType) || 'high',
            mode: str(book.spellPreparationMode) === 'prepared' ? 'prepared' : 'spontaneous',
            lists,
            prepared,
            dayList: slotsFor(str(book.casterType), str(book.spellPreparationMode), cl),
        };
    }
    const casterLevelFor = (casterType, level) => (casterType === 'high' ? level
        : casterType === 'med' ? Math.max(0, level - 3) : Math.max(0, Math.floor((level - 3) / 2)));
    /**
     * The sheet's own standard PF1 progressions, addressed the way `spellSlotShapeOf` expects
     * (it parses the generator's casting *string*, e.g. "9th-level prepared", so pf1's
     * high/med/low caster type is spelled back out into that vocabulary here).
     * Off-table shapes (arcanist and friends) yield an all-zero row the user can edit.
     */
    function slotsFor(casterType, mode, cl) {
        const SD = window.SheetData;
        const castingStr = casterType === 'high' ? `9th-level ${mode === 'prepared' ? 'prepared' : 'spontaneous'}`
            : casterType === 'med' ? '6th-level' : '4th-level';
        const shape = SD?.spellSlotShapeOf?.(castingStr);
        const row = shape ? SD?.standardSpellSlots?.(shape, cl) : null;
        const out = new Array(10).fill(0);
        if (Array.isArray(row)) row.forEach((v, i) => { if (i < 10) out[i] = num(v, 0); });
        return out;
    }

    return { detect, transform, mapTarget, mapType, SKILL_KEYS, SIZE_MAP, LANGUAGE_LABELS };
})();
