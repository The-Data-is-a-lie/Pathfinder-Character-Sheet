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
        weapons: 'data/weapon_details.json',
        items: 'data/item_details.json',
    };
    const CONDITIONAL_FILES = ['data/combat_talent_conditionals.json', 'data/magic_talent_conditionals.json'];
    const MANEUVER_CHANGES_URL = 'data/maneuver_changes.json';

    // kind -> { byKey: {lowercase name -> entry|entry[]}, aliases: {paren-stripped -> full key} }
    const maps = {};
    // normalized talent name -> { sphere, modifiers, rider }
    const talentConditionals = {};
    // powNorm(name) -> { modifiers, rider } from maneuver_changes.json
    const maneuverConditionals = {};

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
                talentConditionals[sphereNorm(name)] = {
                    sphere,
                    label: name,
                    ...cond,
                };
            }
        }
    }

    // Path of War / Martial Training name key (matches Foundry module powNorm).
    function powNorm(s) {
        return sphereNorm(s);
    }

    function indexManeuverChanges(data) {
        for (const [name, cond] of Object.entries(data || {})) {
            if (!cond) continue;
            maneuverConditionals[powNorm(name)] = {
                name,
                modifiers: cond.modifiers || [],
                rider: cond.rider || '',
            };
        }
    }

    const ready = Promise.all([
        ...Object.entries(FILES).map(([kind, url]) =>
            fetchJson(url).then((data) => indexDetails(kind, data))
                .catch((err) => console.warn('SheetDetails: could not load ' + url, err))),
        ...CONDITIONAL_FILES.map((url) =>
            fetchJson(url).then(indexConditionals)
                .catch((err) => console.warn('SheetDetails: could not load ' + url, err))),
        fetchJson(MANEUVER_CHANGES_URL).then(indexManeuverChanges)
            .catch((err) => console.warn('SheetDetails: could not load ' + MANEUVER_CHANGES_URL, err)),
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

    // Weapon roll stats (dice, crit, actionType) for the Tools attack menu.
    function lookupWeapon(name) {
        return lookup('weapons', name);
    }

    // Wondrous / armor / gear for Inventory (description, weight, changes).
    function lookupItem(name) {
        return lookup('items', name);
    }

    function lookupManeuverConditional(name) {
        if (!name) return null;
        return maneuverConditionals[powNorm(name)] || null;
    }

    /**
     * Unified per-roll toggles for this character (Foundry attack-dialog conditionals).
     * Returns [{ id, label, sourceKind, defaultOn, modifiers, rider, source }].
     */
    function collectRollConditionals(data) {
        if (!data) return [];
        const out = [];
        const seen = new Set();
        const push = (entry) => {
            if (!entry?.id || seen.has(entry.id)) return;
            if (!(entry.modifiers?.length || entry.rider)) return;
            seen.add(entry.id);
            out.push(entry);
        };

        let known = (data.maneuvers_choose_from || []).flat().filter(Boolean);
        const descs = data.maneuvers_desc_dict || {};
        // Fallback: desc keys that aren't stances
        const stanceSet = new Set(data.stances_chosen || []);
        if (!known.length && descs) {
            known = Object.keys(descs).filter((name) => {
                if (stanceSet.has(name)) return false;
                return String(descs[name]?.type || '').toLowerCase() !== 'stance';
            });
        }
        for (const name of known) {
            const cond = lookupManeuverConditional(name);
            if (!cond) continue;
            const typeCap = String(descs[name]?.type || 'Strike')
                .replace(/^\w/, (c) => c.toUpperCase());
            const label = cond.rider
                ? `(${typeCap}) ${name}: ${cond.rider}`
                : `(${typeCap}) ${name}`;
            push({
                id: 'maneuver:' + powNorm(name),
                label,
                source: name,
                sourceKind: 'maneuver',
                defaultOn: false,
                modifiers: cond.modifiers || [],
                rider: cond.rider || '',
            });
        }
        for (const name of (data.stances_chosen || [])) {
            const cond = lookupManeuverConditional(name);
            if (!cond?.modifiers?.length) continue; // Foundry only attaches stances with mods
            const label = cond.rider
                ? `(Stance) ${name}: ${cond.rider}`
                : `(Stance) ${name}`;
            push({
                id: 'stance:' + powNorm(name),
                label,
                source: name,
                sourceKind: 'stance',
                defaultOn: true,
                modifiers: cond.modifiers || [],
                rider: cond.rider || '',
            });
        }

        for (const [fn, cond] of Object.entries(data.feat_conditionals_dict || {})) {
            if (!cond) continue;
            const label = cond.name || fn;
            push({
                id: 'feat:' + String(fn).toLowerCase(),
                label,
                source: fn,
                sourceKind: 'feat',
                defaultOn: !!cond.default,
                modifiers: cond.modifiers || [],
                rider: '',
            });
        }

        for (const t of [...(data.magic_talent_items || []), ...(data.combat_talent_items || [])]) {
            if (!t?.name) continue;
            const cond = conditionalForTalent(t.name);
            if (!cond || !(cond.modifiers?.length || cond.rider)) continue;
            push({
                id: 'talent:' + sphereNorm(t.name),
                label: t.name + (cond.rider ? ': ' + cond.rider : ''),
                source: t.name,
                sourceKind: 'talent',
                defaultOn: false,
                modifiers: cond.modifiers || [],
                rider: cond.rider || '',
            });
        }

        for (const [spellName, entry] of Object.entries(data.spell_changes_dict || {})) {
            if (!entry) continue;
            let mods = null;
            let label = spellName;
            if (Array.isArray(entry.modifiers)) {
                mods = entry.modifiers;
                label = entry.name || spellName;
            } else if (Array.isArray(entry.changes) && entry.changes.length) {
                // Sustained buff-shaped: map to attack/damage-ish targets only
                mods = entry.changes
                    .filter((c) => c?.formula && /attack|damage/i.test(String(c.target || '')))
                    .map((c) => ({
                        formula: c.formula,
                        target: /attack/i.test(c.target) ? 'attack' : 'damage',
                        subTarget: /attack/i.test(c.target) ? 'allAttack' : 'allDamage',
                        type: c.type || 'untyped',
                        critical: 'normal',
                    }));
                label = entry.name || spellName;
            }
            if (!mods?.length) continue;
            push({
                id: 'spell:' + String(spellName).toLowerCase(),
                label,
                source: spellName,
                sourceKind: 'spell',
                defaultOn: !!entry.default,
                modifiers: mods,
                rider: '',
            });
        }

        return out;
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
                priority: ch.priority || 0, custom: !!ch.custom });
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

        const seenTraits = new Set();
        for (const bucket of TRAIT_BUCKETS) {
            for (const name of data[bucket] || []) {
                if (!name || seenTraits.has(name)) continue;
                seenTraits.add(name);
                const entry = lookup('traits', name) || lookup('feats', name);
                if (entry) pushEntry(ledger, name, 'trait', entry);
            }
        }

        const classes = [data.c_class, data.c_class_2];
        const seenClassFeats = new Set();
        for (const raw of data.class_ability || []) {
            const cut = String(raw).lastIndexOf('_');
            const name = cut > 0 ? String(raw).slice(0, cut) : String(raw);
            if (!name || seenClassFeats.has(name)) continue;
            seenClassFeats.add(name);
            const entry = lookupClassFeature(name, classes);
            if (entry) pushEntry(ledger, entry.name || name, 'classFeat', entry);
        }

        // User-authored buffs attached to a feature (feat/trait/class feature) on the
        // Features tab. Keyed by the feature's display name; tagged custom so the editor
        // popover can tell them apart from compendium-supplied changes.
        for (const [name, entry] of Object.entries(data._sheet?.featureChanges || {})) {
            if (!entry?.changes?.length) continue;
            pushEntry(ledger, name, entry.sourceKind || 'feat',
                { changes: entry.changes.map((c) => ({ ...c, custom: true })) });
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

        // Equipped inventory items (equipment_list objects or name strings).
        // Unequipped items contribute nothing; custom changes on the item object win.
        for (const raw of data.equipment_list || []) {
            const inv = normalizeInventoryEntry(raw, data);
            if (!inv || !inv.equipped) continue;
            const entry = {
                changes: inv.changes || [],
                contextNotes: inv.contextNotes || [],
            };
            if (entry.changes.length || entry.contextNotes.length) {
                pushEntry(ledger, inv.name, 'item', entry);
            }
        }

        // Foundry-style buffs on Buffs tab (_sheet.buffs; migrate from tempBuffs)
        const buffs = Array.isArray(data._sheet?.buffs) && data._sheet.buffs.length
            ? data._sheet.buffs
            : (data._sheet?.tempBuffs || []);
        if (Array.isArray(buffs)) {
            for (const b of buffs) {
                if (!b || b.active === false) continue;
                if (!b.changes?.length) continue;
                pushEntry(ledger, b.name || 'Buff', 'buff', { changes: b.changes });
            }
        }

        return ledger;
    }

    /**
     * Normalize one equipment_list entry to a stable inventory shape (does not mutate).
     * Prefer stored object fields; fill gaps from equip_descrip + item_details.
     * Non-customized empty change lists re-hydrate from the compendium (avoids a race
     * where inventory was migrated before item_details.json finished loading).
     */
    function normalizeInventoryEntry(raw, data) {
        if (raw == null) return null;
        const isObj = raw && typeof raw === 'object' && !Array.isArray(raw);
        const name = isObj
            ? String(raw.name || raw.label || '').trim()
            : String(raw).trim();
        if (!name) return null;
        const foundry = lookupItem(name);
        const fromDesc = data?.equip_descrip?.[name];
        const customized = !!(isObj && raw.changesCustomized);

        let changes;
        if (customized && isObj && Array.isArray(raw.changes)) {
            changes = raw.changes.map((c) => ({ ...c }));
        } else if (foundry?.changes?.length) {
            changes = foundry.changes.map((c) => ({ ...c }));
        } else if (isObj && Array.isArray(raw.changes) && raw.changes.length) {
            changes = raw.changes.map((c) => ({ ...c }));
        } else {
            changes = [];
        }

        let contextNotes;
        if (customized && isObj && Array.isArray(raw.contextNotes)) {
            contextNotes = raw.contextNotes.map((n) => ({ ...n }));
        } else if (foundry?.contextNotes?.length) {
            contextNotes = foundry.contextNotes.map((n) => ({ ...n }));
        } else if (isObj && Array.isArray(raw.contextNotes) && raw.contextNotes.length) {
            contextNotes = raw.contextNotes.map((n) => ({ ...n }));
        } else {
            contextNotes = [];
        }

        const weight = isObj && raw.weight != null && raw.weight !== ''
            ? Number(raw.weight)
            : (foundry?.weight != null ? Number(foundry.weight) : null);
        const description = (isObj && raw.description)
            || fromDesc
            || foundry?.description
            || '';
        const equipped = isObj && raw.equipped === false ? false : true;
        const identified = isObj && raw.identified === false ? false : true;
        const carried = isObj && raw.carried === false ? false : true;
        const quantity = Math.max(1, Number(isObj ? raw.quantity : 1) || 1);
        let price = null;
        if (isObj && raw.price != null && raw.price !== '') price = Number(raw.price);
        else if (isObj && raw.value != null && raw.value !== '') price = Number(raw.value);
        else if (foundry?.price != null) price = Number(foundry.price);
        if (!Number.isFinite(price)) price = null;
        const id = isObj && raw.id
            ? String(raw.id)
            : 'eq:' + name.toLowerCase().replace(/\s+/g, '-');
        return {
            id,
            name,
            equipped,
            carried,
            identified,
            quantity,
            weight: Number.isFinite(weight) ? weight : null,
            price,
            description,
            changes,
            contextNotes,
            changesCustomized: customized,
            subType: (isObj && raw.subType) || foundry?.subType || '',
            slot: (isObj && raw.slot) || foundry?.slot || '',
            itemType: (isObj && raw.itemType) || foundry?.itemType || '',
            containerId: (isObj && raw.containerId) || null,
            _foundry: foundry || null,
        };
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

    /**
     * Evaluate a simple pf1 change formula against character ability scores.
     * @returns {{ ok: true, value: number } | { ok: false, formula: string }}
     */
    function evalSimpleFormula(formula, data) {
        let s = String(formula ?? '').trim();
        if (!s) return { ok: false, formula: s };
        // Pure integer
        if (/^[+-]?\d+$/.test(s)) return { ok: true, value: Number(s) };

        const abilityMod = (ab) => {
            const score = data?.[ab];
            if (score == null || score === '') return 0;
            return Math.floor((Number(score) - 10) / 2);
        };
        // @abilities.str.mod / @abilities.str.total
        s = s.replace(/@abilities\.(str|dex|con|int|wis|cha)\.mod/gi,
            (_, ab) => String(abilityMod(ab.toLowerCase())));
        s = s.replace(/@abilities\.(str|dex|con|int|wis|cha)\.total/gi,
            (_, ab) => String(Number(data?.[ab.toLowerCase()]) || 0));
        // Hit dice / level (Toughness: max(3, @attributes.hd.total))
        const hd = Number(data?.level) || Number(data?.attributes?.hd?.total) || 0;
        s = s.replace(/@attributes\.hd\.total/gi, String(hd));
        s = s.replace(/@attributes\.hd\.max/gi, String(hd));
        // Allow max/min/floor/ceil after substitution (common in pf1 changes)
        s = s.replace(/\s+/g, '');
        if (!/^[0-9+\-*/().,a-zA-Z]+$/.test(s)) return { ok: false, formula: String(formula).trim() };
        // Only allow known function names
        if (/[a-zA-Z]/.test(s) && !/^(?:max|min|floor|ceil|abs|[0-9+\-*/().,])+$/i.test(s)) {
            return { ok: false, formula: String(formula).trim() };
        }
        try {
            // eslint-disable-next-line no-new-func
            const v = Function(
                '"use strict"; const max=Math.max,min=Math.min,floor=Math.floor,ceil=Math.ceil,abs=Math.abs; return (' + s + ')',
            )();
            if (typeof v !== 'number' || !Number.isFinite(v)) {
                return { ok: false, formula: String(formula).trim() };
            }
            return { ok: true, value: Math.floor(v) };
        } catch {
            return { ok: false, formula: String(formula).trim() };
        }
    }

    /** Filter ledger.changes whose target is in `targets` (Set or array). */
    function changesForTargets(ledger, targets) {
        const want = targets instanceof Set ? targets : new Set(targets || []);
        return (ledger?.changes || []).filter((c) => want.has(c.target));
    }

    /**
     * Search a loaded catalog (feats, traits, spells, items, weapons, classFeatures, talents).
     * Returns [{ key, name, kind, subtitle?, entry }] ranked by name match.
     */
    function searchCatalog(kind, query, opts = {}) {
        const limit = opts.limit || 40;
        const q = String(query || '').toLowerCase().trim();
        if (!q || q.length < 1) return [];

        const out = [];
        const push = (row) => {
            if (out.length >= limit) return;
            out.push(row);
        };

        if (kind === 'talents') {
            for (const [norm, cond] of Object.entries(talentConditionals)) {
                const name = cond.label || cond.name || norm;
                const hay = (name + ' ' + (cond.sphere || '')).toLowerCase();
                if (!hay.includes(q) && !norm.includes(q)) continue;
                push({
                    key: norm,
                    name,
                    kind: 'talents',
                    subtitle: (cond.sphere || 'Talent')
                        + (cond.modifiers?.length ? ' · has modifiers' : ''),
                    entry: cond,
                });
                if (out.length >= limit) break;
            }
            out.sort((a, b) => a.name.localeCompare(b.name));
            return out.slice(0, limit);
        }

        const m = maps[kind];
        if (!m?.byKey) return [];

        for (const [key, entry] of Object.entries(m.byKey)) {
            if (!key.includes(q)) {
                // also match display name
                const entries = Array.isArray(entry) ? entry : [entry];
                const nm = String(entries[0]?.name || '').toLowerCase();
                if (!nm.includes(q)) continue;
            }
            const entries = Array.isArray(entry) ? entry : [entry];
            const primary = entries[0] || { name: key };
            const display = primary.name || key;
            let subtitle = '';
            if (kind === 'spells' && primary.school) subtitle = primary.school;
            if (kind === 'items' && primary.subType) subtitle = primary.subType;
            if (kind === 'weapons' && primary.actionType) subtitle = primary.actionType;
            if (kind === 'classFeatures' && primary.classes?.length) {
                subtitle = primary.classes.slice(0, 3).join(', ');
            }
            if (kind === 'feats' && primary.changes?.length) subtitle = 'has changes';
            if (kind === 'items' && primary.changes?.length) {
                subtitle = (subtitle ? subtitle + ' · ' : '') + 'has buffs';
            }
            push({
                key,
                name: display,
                kind,
                subtitle,
                entry: primary,
            });
            if (out.length >= limit) break;
        }

        // Prefer prefix matches
        out.sort((a, b) => {
            const an = a.name.toLowerCase();
            const bn = b.name.toLowerCase();
            const ap = an.startsWith(q) ? 0 : 1;
            const bp = bn.startsWith(q) ? 0 : 1;
            if (ap !== bp) return ap - bp;
            return an.localeCompare(bn);
        });
        return out.slice(0, limit);
    }

    function catalogKinds() {
        return Object.keys(maps).concat(['talents']);
    }

    return {
        ready, lookup, lookupClassFeature, lookupWeapon, lookupItem,
        lookupManeuverConditional, conditionalForTalent, collectChanges,
        collectRollConditionals, normalizeInventoryEntry, powNorm,
        targetLabel, typeLabel, evalSimpleFormula, changesForTargets,
        searchCatalog, catalogKinds,
    };
})();
