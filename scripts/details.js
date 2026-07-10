// Foundry-data details layer for the static sheet: loads the slim data/*.json extracts
// (built by tools/build_details.py from the pf1e_random_char_generator module's compendium
// exports) and exposes name lookups plus collectChanges(), the per-character ledger of every
// numeric pf1 `change` / contextNote / per-roll conditional. Future dice-rolling code should
// consume that ledger rather than re-scraping the DOM.

window.SheetDetails = (function () {
    'use strict';

    const FILES = {
        feats: 'data/feat_details.json',
        traits: 'data/trait_details.json',
        classFeatures: 'data/class_feature_details.json',
        spells: 'data/spell_details.json',
    };
    const CONDITIONAL_FILES = ['data/combat_talent_conditionals.json', 'data/magic_talent_conditionals.json'];

    // kind -> { byKey: {lowercase name -> entry|entry[]}, aliases: {paren-stripped -> full key} }
    const maps = {};
    // normalized talent name -> { sphere, modifiers, rider }
    const talentConditionals = {};

    async function fetchJson(url) {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
    }

    function indexDetails(kind, data) {
        // paren-stripped name -> ALL full keys sharing it (never shadowing a real key)
        const aliases = {};
        for (const key of Object.keys(data)) {
            const cut = key.indexOf(' (');
            if (cut > 0) {
                const alias = key.slice(0, cut).trim();
                if (!(alias in data)) (aliases[alias] ??= []).push(key);
            }
        }
        maps[kind] = { byKey: data, aliases };
    }

    // Same normalization the Foundry module uses for sphere talents: drop " (variant)" and
    // " [source]" tags, lowercase, strip apostrophes, collapse spaces.
    function sphereNorm(s) {
        return String(s).split(' (')[0].replace(/\s*\[[^\]]*\]\s*/g, ' ')
            .toLowerCase().replace(/['’`]/g, '').replace(/\s+/g, ' ').trim();
    }

    function indexConditionals(data) {
        for (const [sphere, talents] of Object.entries(data || {})) {
            for (const [name, cond] of Object.entries(talents || {})) {
                talentConditionals[sphereNorm(name)] = { sphere, ...cond };
            }
        }
    }

    const ready = Promise.all([
        ...Object.entries(FILES).map(([kind, url]) =>
            fetchJson(url).then((data) => indexDetails(kind, data))
                .catch((err) => console.warn('SheetDetails: could not load ' + url, err))),
        ...CONDITIONAL_FILES.map((url) =>
            fetchJson(url).then(indexConditionals)
                .catch((err) => console.warn('SheetDetails: could not load ' + url, err))),
    ]).then(() => true);

    // Exact lowercase match, then paren-stripped both ways (backend "Weapon Focus (Longsword)"
    // -> data "weapon focus"; backend "Bestial Wrath" -> data "bestial wrath (rovagug)").
    function lookup(kind, name) {
        const m = maps[kind];
        if (!m || !name) return null;
        const lc = String(name).toLowerCase().trim();
        let hit = m.byKey[lc];
        if (hit === undefined) {
            const stripped = lc.split(' (')[0].trim();
            const alias = m.aliases[stripped]?.[0] ?? m.aliases[lc]?.[0];
            hit = m.byKey[stripped] ?? (alias !== undefined ? m.byKey[alias] : undefined);
        }
        return hit ?? null;
    }

    // Class features are stored as arrays (same feature name across several classes), and
    // parenthetical variants ("Bonus Feats (Ftr)" / "(Wiz)" / ...) are separate keys — gather
    // every candidate, then prefer the entry owned by one of the character's classes.
    function lookupClassFeature(name, classes) {
        const m = maps.classFeatures;
        if (!m || !name) return null;
        const lc = String(name).toLowerCase().trim();
        const stripped = lc.split(' (')[0].trim();
        const keys = new Set([lc, stripped, ...(m.aliases[stripped] || []), ...(m.aliases[lc] || [])]);
        const hits = [...keys].flatMap((k) => m.byKey[k] || []);
        if (!hits.length) return null;
        const mine = (classes || []).filter(Boolean).map((c) => String(c).toLowerCase());
        return hits.find((e) => (e.classes || []).some((c) => mine.includes(String(c).toLowerCase())))
            || hits[0];
    }

    function conditionalForTalent(name) {
        return talentConditionals[sphereNorm(name)] || null;
    }

    // ------------------------------------------------------------------ changes ledger
    const FEAT_BUCKETS = ['feats', 'class_feats', 'story_feats', 'flaw_feats', 'flavor_feats',
        'teamwork_feat_labels', 'bloodline_feats', 'trainer_feats', 'profession_feats',
        'sphere_feats', 'mt_feats'];
    const TRAIT_BUCKETS = ['selected_traits', 'background_traits', 'sphere_traits', 'flaw'];

    function pushEntry(ledger, source, sourceKind, entry) {
        for (const ch of entry?.changes || []) {
            ledger.changes.push({ source, sourceKind, formula: ch.formula, target: ch.target,
                type: ch.type || 'untyped', operator: ch.operator || 'add',
                priority: ch.priority || 0 });
        }
        for (const note of entry?.contextNotes || []) {
            const text = typeof note === 'string' ? note : note.text;
            if (text) ledger.notes.push({ source, sourceKind, text,
                target: (typeof note === 'object' && note.target) || '' });
        }
    }

    // Aggregate every numeric modifier the character owns into one normalized ledger:
    //   changes      always-on pf1 changes  {source, sourceKind, formula, target, type, operator, priority}
    //   notes        situational contextNotes {source, sourceKind, text, target}
    //   conditionals per-roll toggles/riders  {source, sourceKind, name?, modifiers, rider?}
    function collectChanges(data) {
        const ledger = { changes: [], notes: [], conditionals: [] };
        const featChanges = data.feat_changes_dict || {};
        const featConditionals = data.feat_conditionals_dict || {};
        const seenFeats = new Set();

        for (const bucket of FEAT_BUCKETS) {
            for (const name of data[bucket] || []) {
                if (!name || seenFeats.has(name)) continue;
                seenFeats.add(name);
                const foundry = lookup('feats', name);
                // Prefer Foundry-automated changes; feat_changes.json only covers feats the
                // compendium does NOT automate, but guard against double counting anyway.
                if (foundry?.changes?.length || foundry?.contextNotes?.length) {
                    pushEntry(ledger, name, 'feat', foundry);
                } else if (featChanges[name]) {
                    pushEntry(ledger, name, 'feat', featChanges[name]);
                }
                const cond = featConditionals[name];
                if (cond) ledger.conditionals.push({ source: name, sourceKind: 'feat',
                    name: cond.name, modifiers: cond.modifiers || [] });
            }
        }

        for (const bucket of TRAIT_BUCKETS) {
            for (const name of data[bucket] || []) {
                const entry = lookup('traits', name) || lookup('feats', name);
                if (entry) pushEntry(ledger, name, 'trait', entry);
            }
        }

        const classes = [data.c_class, data.c_class_2];
        for (const raw of data.class_ability || []) {
            const cut = String(raw).lastIndexOf('_');
            const name = cut > 0 ? String(raw).slice(0, cut) : String(raw);
            const entry = lookupClassFeature(name, classes);
            if (entry) pushEntry(ledger, entry.name || name, 'classFeat', entry);
        }

        for (const t of [...(data.magic_talent_items || []), ...(data.combat_talent_items || [])]) {
            if (!t?.name) continue;
            pushEntry(ledger, t.name, 'talent', t);
            const cond = conditionalForTalent(t.name);
            if (cond && (cond.modifiers?.length || cond.rider)) {
                ledger.conditionals.push({ source: t.name, sourceKind: 'talent',
                    modifiers: cond.modifiers || [], rider: cond.rider || '' });
            }
        }

        return ledger;
    }

    // ------------------------------------------------------------------ display helpers
    const SKILL_NAMES = {
        acr: 'Acrobatics', apr: 'Appraise', art: 'Artistry', blf: 'Bluff', clm: 'Climb',
        crf: 'Craft', dev: 'Disable Device', dip: 'Diplomacy', dis: 'Disguise',
        esc: 'Escape Artist', fly: 'Fly', han: 'Handle Animal', hea: 'Heal', int: 'Intimidate',
        kar: 'Knowledge (Arcana)', kdu: 'Knowledge (Dungeoneering)', ken: 'Knowledge (Engineering)',
        kge: 'Knowledge (Geography)', khi: 'Knowledge (History)', klo: 'Knowledge (Local)',
        kna: 'Knowledge (Nature)', kno: 'Knowledge (Nobility)', kpl: 'Knowledge (Planes)',
        kre: 'Knowledge (Religion)', lin: 'Linguistics', lor: 'Lore', per: 'Perception',
        prf: 'Perform', pro: 'Profession', rid: 'Ride', sen: 'Sense Motive',
        slt: 'Sleight of Hand', spl: 'Spellcraft', ste: 'Stealth', sur: 'Survival',
        swm: 'Swim', umd: 'Use Magic Device',
    };
    const TARGET_LABELS = {
        str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence',
        wis: 'Wisdom', cha: 'Charisma', ac: 'AC', aac: 'Armor AC', sac: 'Shield AC',
        nac: 'Natural Armor', ffac: 'Flat-Footed AC', tac: 'Touch AC', attack: 'Attack Rolls',
        mattack: 'Melee Attack', rattack: 'Ranged Attack', wdamage: 'Weapon Damage',
        damage: 'Damage', mdamage: 'Melee Damage', rdamage: 'Ranged Damage',
        fort: 'Fortitude', ref: 'Reflex', will: 'Will', allSavingThrows: 'All Saves',
        cmb: 'CMB', cmd: 'CMD', init: 'Initiative', landSpeed: 'Land Speed',
        allSpeeds: 'All Speeds', mhp: 'Max HP', hp: 'HP', wounds: 'Wounds', vigor: 'Vigor',
        critConfirm: 'Critical Confirmation', skills: 'All Skills', unskills: 'Untrained Skills',
        strSkills: 'Str Skills', dexSkills: 'Dex Skills', conSkills: 'Con Skills',
        intSkills: 'Int Skills', wisSkills: 'Wis Skills', chaSkills: 'Cha Skills',
        cl: 'Caster Level', concentration: 'Concentration', dc: 'Spell DC',
        carryStr: 'Carry Capacity (Str)', carryMult: 'Carry Multiplier', bab: 'BAB',
        spellResist: 'Spell Resistance',
    };
    const TYPE_LABELS = {
        enh: 'enhancement', resist: 'resistance', deflect: 'deflection', untyped: '',
        untypedPerm: '', base: 'base', alchemical: 'alchemical', circumstance: 'circumstance',
        competence: 'competence', dodge: 'dodge', inherent: 'inherent', insight: 'insight',
        luck: 'luck', morale: 'morale', profane: 'profane', racial: 'racial', sacred: 'sacred',
        size: 'size', trait: 'trait', penalty: 'penalty',
    };

    function targetLabel(target) {
        if (!target) return '?';
        if (target.startsWith('skill.')) {
            const id = target.split('.')[1];
            return 'Skill: ' + (SKILL_NAMES[id] || id);
        }
        return TARGET_LABELS[target] || target;
    }

    function typeLabel(type) {
        return TYPE_LABELS[type] ?? type ?? '';
    }

    return { ready, lookup, lookupClassFeature, conditionalForTalent, collectChanges,
        targetLabel, typeLabel };
})();
