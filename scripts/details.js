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
    const STANCE_CHANGES_URL = 'data/stance_changes.json';

    // kind -> { byKey: {lowercase name -> entry|entry[]}, aliases: {paren-stripped -> full key} }
    const maps = {};
    // normalized talent name -> { sphere, modifiers, rider }
    const talentConditionals = {};
    // powNorm(name) -> { modifiers, rider } from maneuver_changes.json
    const maneuverConditionals = {};
    // powNorm(name) -> { changes, contextNotes } from stance_changes.json (always-on benefits)
    const stanceBenefits = {};

    async function fetchJson(url) {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        // #61: hand a clone to the offline cache. The service worker cannot catch these on the
        // very first visit — it is still installing while they are already in flight — and
        // these ARE the offline build (~22 MB of compendium extracts the sheet loads on every
        // boot). Warming from the response we already have costs no extra bandwidth, so the
        // sheet is offline-ready after one successful load instead of two.
        window.SheetPWA?.warmCache?.(url, resp.clone());
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

    function indexStanceChanges(data) {
        for (const [name, entry] of Object.entries(data || {})) {
            if (!entry) continue;
            stanceBenefits[powNorm(name)] = {
                name,
                changes: Array.isArray(entry.changes) ? entry.changes : [],
                contextNotes: Array.isArray(entry.contextNotes) ? entry.contextNotes : [],
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
        fetchJson(STANCE_CHANGES_URL).then(indexStanceChanges)
            .catch((err) => console.warn('SheetDetails: could not load ' + STANCE_CHANGES_URL, err)),
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

    /**
     * Per-roll conditional for a sphere talent (#109): the talent OBJECT's own
     * modifiers/rider (catalog adds and feature-sheet edits live there) win over the
     * shipped conditionals database. Accepts the object or a name.
     */
    function resolveTalentConditional(data, t) {
        const obj = t && typeof t === 'object' ? t
            : [...(data?.magic_talent_items || []), ...(data?.combat_talent_items || [])]
                .find((x) => x?.name === t);
        if (obj && (obj.modifiers?.length || obj.rider)) {
            return {
                sphere: obj.sphere || 'Other',
                label: obj.name,
                modifiers: obj.modifiers || [],
                rider: obj.rider || '',
            };
        }
        return conditionalForTalent(obj?.name || t);
    }

    // #24: compendium class features owned by `className` whose DESCRIPTION marks them
    // as gained at `level` ("At 5th level…", "Starting at 3rd level…"). The extract has
    // no level field, but explicit markers cover exactly the core progression features
    // (0–4 per class level); the unmarked mass is choice-pool members (rage powers,
    // hexes…), which must not be auto-suggested anyway. Advisory for the level-up
    // wizard — a wrong guess costs one untick, never a block.
    const GAIN_LEVEL_RE =
        /(?:^|[>.\s])(?:at|starting at|beginning at|upon reaching)\s+(\d+)(?:st|nd|rd|th)\s+level/i;
    function classFeaturesAtLevel(className, level) {
        const m = maps.classFeatures;
        const want = Number(level) || 0;
        if (!m || !className || want < 1) return [];
        const cls = String(className).toLowerCase().trim();
        const out = [];
        const seen = new Set();
        for (const arr of Object.values(m.byKey)) {
            for (const e of (Array.isArray(arr) ? arr : [arr])) {
                if (!(e.classes || []).some((c) => String(c).toLowerCase() === cls)) continue;
                // Tagged entries (Rage Power, Hex, Domain Power…) are choice-pool members —
                // a level marker there is a "must be at least Nth level" prerequisite, not
                // the class progression granting it.
                if (Array.isArray(e.tags) && e.tags.length) continue;
                const mark = GAIN_LEVEL_RE.exec(String(e.description || ''));
                if (!mark || parseInt(mark[1], 10) !== want) continue;
                const key = String(e.name).toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(e);
            }
        }
        return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
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

    // --- Weapon / armor enhancements ("flaming", "keen", "+1") ---------------------------
    // The backend curates every quality's mechanics in quality_effects.json and ships the ones
    // this character actually owns as `enhancement_effects_dict`:
    //   { weapon: { "<Quality>": { conditionals[], description } },
    //     armor:  { "<Quality>": { changes[], contextNotes[], description } } }
    // The two sections are shaped differently on purpose, and that split drives how they are
    // consumed here: weapon qualities are per-ROLL (flaming's 1d6 fire fires when you swing), armor
    // qualities are standing bonuses that belong in the sheet-math ledger. The shield list is
    // matched against the armor section, exactly as the backend builds it.

    /** "Longsword [+1, flaming]" → ['+1', 'flaming']; plain names → []. */
    function parseEnhancements(name) {
        const m = String(name || '').match(/\[([^\]]+)\]\s*$/);
        if (!m) return [];
        return m[1].split(',').map((s) => s.trim()).filter(Boolean);
    }

    function enhancementSection(data, kind) {
        const eff = data?.enhancement_effects_dict || {};
        return kind === 'armor' ? { ...(eff.armor || {}) } : { ...(eff.weapon || {}) };
    }

    /** Case-insensitive quality lookup, matching how the item sheet already reads the dict. */
    function lookupEnhancement(data, name, kind) {
        const section = enhancementSection(data, kind);
        const key = String(name || '').toLowerCase().trim();
        if (!key) return null;
        const hit = Object.entries(section)
            .find(([k]) => String(k).toLowerCase().trim() === key);
        return hit ? { name: hit[0], ...(hit[1] || {}) } : null;
    }

    /**
     * Every enhancement on this character, resolved and tagged with the item that carries it.
     * Returns [{ itemKey, itemName, quality, kind, entry }].
     *
     * Two sources, because a character can be in either state: the migrated inventory items carry
     * their qualities in the name suffix (`Longsword [+1, flaming]`), while a payload that predates
     * `_sheet.coreGearMigrated` still only has weapon_name + weapon_enhancement_chosen_list. The
     * legacy lists are read for the core gear either way so the main weapon is never missed.
     */
    function collectEnhancements(data) {
        if (!data) return [];
        const out = [];
        const seen = new Set();
        const add = (itemKey, itemName, quality, kind) => {
            const entry = lookupEnhancement(data, quality, kind);
            if (!entry) return;
            const id = itemKey + '|' + String(quality).toLowerCase();
            if (seen.has(id)) return;
            seen.add(id);
            out.push({ itemKey, itemName, quality: entry.name || quality, kind, entry });
        };

        const catOf = (inv) => window.SheetInventoryModel?.inventoryCategory?.(inv) || '';
        for (const raw of data.equipment_list || []) {
            const inv = normalizeInventoryEntry(raw, data);
            if (!inv || !inv.equipped) continue;
            const cat = catOf(inv);
            // Only weapons and armor/shields can carry qualities; a `[stuff]` suffix on a potion is
            // not an enhancement.
            const kind = cat === 'weapons' ? 'weapon' : (cat === 'armor' ? 'armor' : null);
            if (!kind) continue;
            for (const q of parseEnhancements(inv.name)) add(inv.id, inv.name, q, kind);
        }

        // Core generated gear, by name, for both the migrated and unmigrated cases.
        for (const [nameField, listField, kind] of [
            ['weapon_name', 'weapon_enhancement_chosen_list', 'weapon'],
            ['armor_name', 'armor_enhancement_chosen_list', 'armor'],
            ['shield_name', 'shield_enhancement_chosen_list', 'armor'],
        ]) {
            const nm = String(data[nameField] || '').trim();
            if (!nm || !Array.isArray(data[listField])) continue;
            const itemKey = coreGearItemKey(data, nm);
            for (const q of data[listField]) add(itemKey, nm, q, kind);
        }
        return out;
    }

    /**
     * The inventory id of a core gear item, so a quality read from the legacy
     * weapon_enhancement_chosen_list lands on the SAME itemKey as one parsed from the migrated
     * item's name suffix — otherwise the character shows each quality twice, once per source.
     * migrateCoreGear renames the item to "<name> [suffix]", so match on the prefix.
     */
    function coreGearItemKey(data, gearName) {
        const lc = String(gearName).toLowerCase().trim();
        for (const raw of data.equipment_list || []) {
            const inv = normalizeInventoryEntry(raw, data);
            if (!inv) continue;
            const n = inv.name.toLowerCase();
            if (n === lc || n.startsWith(lc + ' [')) return inv.id;
        }
        return 'eq:' + lc.replace(/\s+/g, '-');
    }

    // --- Class-feature powers (rage powers, hexes, ki powers, talents, arcana, ...) -------
    // The backend curates these in class_feature_effects.json and ships this character's matches as
    // `class_feature_conditionals_dict` and `class_feature_changes_dict`. Note the conditionals dict
    // maps a name to a LIST of conditionals — unlike feat_conditionals_dict, whose value is a single
    // object — because one power can grant several independent toggles.
    /**
     * Rider text for a curated conditional.
     *
     * Some qualities and powers are PROSE-ONLY: `modifiers: []` with the whole rule written into
     * `name` (Fury-Born's escalating enhancement bonus, Spellstealing's crit-forgo option — effects
     * no sheet can automate). Those would be dropped by collectRollConditionals' "has no mechanical
     * effect" guard, so the description becomes the rider instead. The toggle then does what it
     * honestly can: print the rule, with its [[inline rolls]] rolled, into the roll log.
     */
    function condRider(cond) {
        if (cond?.rider) return cond.rider;
        return cond?.modifiers?.length ? '' : (cond?.name || '');
    }

    function classFeaturePowerConditionals(data) {
        const dict = data?.class_feature_conditionals_dict || {};
        const out = [];
        for (const [name, conds] of Object.entries(dict)) {
            const list = Array.isArray(conds) ? conds : [conds];
            list.forEach((cond, idx) => {
                if (!cond) return;
                out.push({ name, index: idx, cond });
            });
        }
        return out;
    }

    // --- Per-character overrides for Path of War maneuver/stance modifiers -------------
    // Stored on data._sheet.powOverrides[powNorm(name)] in the same conditional-modifier
    // shape as maneuver_changes.json ({ modifiers, rider }). One resolver feeds every
    // consumer (roll conditionals + stance sheet-math), so an edit in one place shows up
    // everywhere.
    function powOverrideStore(data, create) {
        const st = data && data._sheet;
        if (!st) return null;
        if (!st.powOverrides && create) st.powOverrides = {};
        return st.powOverrides || null;
    }

    function resolvePowConditional(data, name) {
        if (!name) return null;
        const store = powOverrideStore(data, false);
        const ov = store && store[powNorm(name)];
        if (ov) return { name, modifiers: ov.modifiers || [], rider: ov.rider || '' };
        return lookupManeuverConditional(name);
    }

    function setPowOverride(data, name, entry) {
        if (!data || !name) return;
        const store = powOverrideStore(data, true);
        store[powNorm(name)] = {
            modifiers: Array.isArray(entry?.modifiers) ? entry.modifiers : [],
            rider: entry?.rider || '',
        };
    }

    function clearPowOverride(data, name) {
        const store = powOverrideStore(data, false);
        if (store) delete store[powNorm(name)];
    }

    // --- Stance always-on benefits (stance_changes.json, pf1 changes shape) --------------
    // Distinct from maneuver_changes.json: stances apply persistent bonuses (AC, saves,
    // skills, abilities, attack/damage...) while active, so they live in the sheet-math
    // ledger rather than the per-roll conditional table.
    function lookupStanceBenefit(name) {
        if (!name) return null;
        return stanceBenefits[powNorm(name)] || null;
    }

    function stanceOverrideStore(data, create) {
        const st = data && data._sheet;
        if (!st) return null;
        if (!st.stanceOverrides && create) st.stanceOverrides = {};
        return st.stanceOverrides || null;
    }

    // Resolved always-on benefit for a stance: user override wins, else the compendium
    // entry, else an empty benefit. Returns { changes, contextNotes }.
    function resolveStanceEntry(data, name) {
        if (!name) return { changes: [], contextNotes: [] };
        const store = stanceOverrideStore(data, false);
        const ov = store && store[powNorm(name)];
        if (ov) {
            return {
                changes: Array.isArray(ov.changes) ? ov.changes : [],
                contextNotes: Array.isArray(ov.contextNotes) ? ov.contextNotes : [],
            };
        }
        const base = lookupStanceBenefit(name);
        return base
            ? { changes: base.changes || [], contextNotes: base.contextNotes || [] }
            : { changes: [], contextNotes: [] };
    }

    function setStanceOverride(data, name, entry) {
        if (!data || !name) return;
        const store = stanceOverrideStore(data, true);
        store[powNorm(name)] = {
            changes: Array.isArray(entry?.changes) ? entry.changes : [],
            contextNotes: Array.isArray(entry?.contextNotes) ? entry.contextNotes : [],
        };
    }

    function clearStanceOverride(data, name) {
        const store = stanceOverrideStore(data, false);
        if (store) delete store[powNorm(name)];
    }

    // --- Per-character feature overrides (#104/#105) -------------------------------------
    // One store for every name-keyed kind the sheet renders read-only from the compendium /
    // backend dicts: _sheet.featureOverrides["<kind>::<sphereNorm(name)>"] =
    //   { kind, name, description?, tags?, details? }.
    // Overrides WIN over compendium + backend text; the shipped data/*.json stay pristine
    // and the edit travels in the character JSON. Object-backed kinds (buffs, talents) are
    // edited in place instead and never need an entry here — except for description/tags on
    // talents, whose objects the backend re-sends.
    const OVERRIDE_KINDS = ['feat', 'trait', 'classFeat', 'spell', 'maneuver', 'stance', 'talent'];

    function featureOverrideStore(data, create) {
        const st = data && data._sheet;
        if (!st) return null;
        if (!st.featureOverrides && create) st.featureOverrides = {};
        return st.featureOverrides || null;
    }

    function featureOvKey(kind, name) {
        return String(kind) + '::' + sphereNorm(name);
    }

    function getFeatureOverride(data, kind, name) {
        const store = featureOverrideStore(data, false);
        return (store && store[featureOvKey(kind, name)]) || null;
    }

    /** Merge `patch` into the override; empty patches prune the entry (revert). */
    function setFeatureOverride(data, kind, name, patch) {
        if (!data || !name) return null;
        const store = featureOverrideStore(data, true);
        const key = featureOvKey(kind, name);
        const entry = store[key] ??= { kind, name: String(name) };
        Object.assign(entry, patch || {});
        entry.kind = kind;
        entry.name = String(name);
        // Drop null/'' fields so a cleared edit reads as "not overridden".
        for (const k of Object.keys(entry)) {
            if (entry[k] == null || entry[k] === '') delete entry[k];
        }
        const hasContent = Object.keys(entry).some((k) => k !== 'kind' && k !== 'name');
        if (!hasContent) {
            delete store[key];
            return null;
        }
        return entry;
    }

    function clearFeatureOverride(data, kind, name) {
        const store = featureOverrideStore(data, false);
        if (store) delete store[featureOvKey(kind, name)];
    }

    function isFeatureEdited(data, kind, name) {
        return !!getFeatureOverride(data, kind, name);
    }

    /**
     * Resolved display record for a feature-ish thing: override → compendium → the
     * caller's backend fallback (`opts.fallbackDesc` — features.js knows which desc dict
     * its group reads; this layer does not). `opts.classes` disambiguates class features.
     */
    function resolveFeature(data, kind, name, opts = {}) {
        const ov = getFeatureOverride(data, kind, name);
        let base = null;
        if (kind === 'feat') base = lookup('feats', name);
        else if (kind === 'trait') base = lookup('traits', name) || lookup('feats', name);
        else if (kind === 'classFeat') base = lookupClassFeature(name, opts.classes);
        else if (kind === 'spell') base = lookup('spells', name);
        const description = ov?.description ?? base?.description ?? (opts.fallbackDesc || '');
        const tags = Array.isArray(ov?.tags) ? ov.tags
            : (Array.isArray(base?.tags) ? base.tags : []);
        return { kind, name, description, tags, details: ov?.details || {}, edited: !!ov, base };
    }

    /**
     * Spell record with the user's mechanics edits merged over a clone of the compendium
     * entry — the Cast flow reads this instead of `lookup('spells', name)` so an edited
     * save/damage/range actually rolls. `details.spell` mirrors the native action shape.
     */
    function resolveSpell(data, name) {
        const base = lookup('spells', name);
        const ov = getFeatureOverride(data, 'spell', name);
        if (!ov) return base;
        const out = base ? JSON.parse(JSON.stringify(base)) : { name: String(name) };
        if (ov.description != null) out.description = ov.description;
        const d = ov.details?.spell;
        if (d) {
            if (d.school) out.school = d.school;
            out.actions = Array.isArray(out.actions) && out.actions.length
                ? out.actions : [{ name: 'Use' }];
            const act = out.actions[0];
            if (d.actionType) act.actionType = d.actionType;
            if (d.save) act.save = { ...(act.save || {}), ...d.save };
            if (d.range) act.range = { ...(act.range || {}), ...d.range };
            if (d.duration) act.duration = { ...(act.duration || {}), ...d.duration };
            if (Array.isArray(d.damageParts)) {
                act.damage = { ...(act.damage || {}), parts: d.damageParts.map((p) => ({ ...p })) };
            }
        }
        out._edited = true;
        return out;
    }

    // --- Rename engine (#105) ------------------------------------------------------------
    // The display name is the join key for everything: membership lists, desc/mechanics
    // dicts, uses/pools, per-roll toggle prefs, disabled-source sets. One table-driven
    // pass per kind; a store missed here silently detaches state after a rename, so new
    // name-keyed stores MUST be added to this walker.
    const FEAT_LIST_KEYS = ['flavor_feats', 'flaw_feats', 'story_feats', 'feats',
        'teamwork_feats', 'class_feats', 'bloodline_feats', 'trainer_feats',
        'profession_feats', 'sphere_feats', 'mt_feats'];
    const FEAT_TAX_KEYS = ['flavor_feat_tax_dict', 'flaw_feat_tax_dict', 'story_feat_tax_dict',
        'feats_feat_tax_dict', 'class_feat_tax_dict', 'trainer_feat_tax_dict', 'sphere_feat_tax'];
    const TRAIT_LIST_KEYS = ['selected_traits', 'background_traits', 'sphere_traits', 'flaw'];

    /** Membership arrays a duplicate-name check scans, per kind. */
    function membershipArrays(data, kind) {
        if (kind === 'feat') return FEAT_LIST_KEYS.map((k) => data[k]);
        if (kind === 'trait') return TRAIT_LIST_KEYS.map((k) => data[k]);
        if (kind === 'classFeat') {
            return [(data.class_ability || []).map((e) => {
                const cut = String(e).lastIndexOf('_');
                return cut > 0 ? String(e).slice(0, cut) : String(e);
            })];
        }
        if (kind === 'spell') {
            const out = [(data.spell_list_choose_from || []).flat()];
            for (const bk of data._sheet?.extraSpellbooks || []) {
                out.push((bk?.lists || []).flat());
            }
            return out;
        }
        if (kind === 'maneuver') return [(data.maneuvers_choose_from || []).flat()];
        if (kind === 'stance') return [data.stances_chosen];
        if (kind === 'talent') {
            return [[...(data.magic_talent_items || []), ...(data.combat_talent_items || [])]
                .map((t) => t?.name)];
        }
        if (kind === 'buff') return [(data._sheet?.buffs || []).map((b) => b?.name)];
        return [];
    }

    function renameFeature(data, kind, oldName, newName) {
        oldName = String(oldName || '').trim();
        newName = String(newName || '').trim();
        if (!data || !oldName || !newName || oldName === newName) {
            return { ok: false, reason: 'no-op' };
        }
        const oldLc = oldName.toLowerCase();
        const newLc = newName.toLowerCase();
        if (oldLc !== newLc) {
            for (const arr of membershipArrays(data, kind)) {
                if ((arr || []).some((x) => String(x || '').toLowerCase() === newLc)) {
                    return { ok: false, reason: 'duplicate' };
                }
            }
        }
        let n = 0;
        const isOld = (x) => String(x || '').toLowerCase().trim() === oldLc;
        const inArray = (arr) => {
            if (!Array.isArray(arr)) return;
            arr.forEach((x, i) => { if (isOld(x)) { arr[i] = newName; n++; } });
        };
        const inNested = (arrOfArrays) => {
            for (const arr of arrOfArrays || []) inArray(arr);
        };
        const keyMove = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            const hit = Object.keys(obj).find(isOld);
            if (hit === undefined || (newName in obj)) return;
            obj[newName] = obj[hit];
            delete obj[hit];
            n++;
        };
        const inObjArray = (arr, field = 'name') => {
            for (const o of arr || []) {
                if (o && typeof o === 'object' && isOld(o[field])) { o[field] = newName; n++; }
            }
        };
        const st = data._sheet || {};
        // Per-roll toggle prefs: remap ids whose name-derived segment matches.
        const prefsRemap = (oldId, newId) => {
            const prefs = st.conditionalPrefs;
            if (!prefs) return;
            for (const id of Object.keys(prefs)) {
                if (id !== oldId && !id.startsWith(oldId + ':')) continue;
                const nid = newId + id.slice(oldId.length);
                if (nid in prefs) continue;
                prefs[nid] = prefs[id];
                delete prefs[id];
                n++;
            }
        };

        if (kind === 'feat') {
            for (const k of FEAT_LIST_KEYS) inArray(data[k]);
            for (const k of FEAT_TAX_KEYS) {
                const dict = data[k];
                keyMove(dict);
                for (const children of Object.values(dict || {})) inArray(children);
            }
            for (const k of ['homebrew_feat_desc_dict', 'profession_feat_desc',
                'feat_changes_dict', 'feat_conditionals_dict']) keyMove(data[k]);
            prefsRemap('feat:' + oldLc, 'feat:' + newLc);
        } else if (kind === 'trait') {
            for (const k of TRAIT_LIST_KEYS) inArray(data[k]);
            inObjArray(data.selected_traits_desc);
            keyMove(data.flaw_effects_dict);
        } else if (kind === 'classFeat') {
            const list = data.class_ability;
            if (Array.isArray(list)) {
                list.forEach((raw, i) => {
                    const s = String(raw);
                    const cut = s.lastIndexOf('_');
                    const base = cut > 0 ? s.slice(0, cut) : s;
                    if (!isOld(base)) return;
                    list[i] = cut > 0 ? newName + s.slice(cut) : newName;
                    n++;
                });
            }
            keyMove(data.class_ability_desc);
            keyMove(data.class_feature_changes_dict);
            keyMove(data.class_feature_conditionals_dict);
            // Choice-pool names live one level down: class_features[bucket][choice].
            for (const bucket of Object.values(data.class_features || {})) keyMove(bucket);
            for (const bucket of Object.values(data.class_feature_levels || {})) keyMove(bucket);
            inObjArray(data.profession_ability_items);
            prefsRemap('classFeature:' + sphereNorm(oldName), 'classFeature:' + sphereNorm(newName));
        } else if (kind === 'spell') {
            inNested(data.spell_list_choose_from);
            inNested(data.spells_prepared_names);
            for (const bk of st.extraSpellbooks || []) {
                inNested(bk?.lists);
                inNested(bk?.prepared);
            }
            keyMove(data.spell_changes_dict);
            for (const b of st.buffs || []) {
                if (b && b.autoKey === 'spell:' + oldLc) { b.autoKey = 'spell:' + newLc; n++; }
            }
            prefsRemap('spell:' + oldLc, 'spell:' + newLc);
        } else if (kind === 'maneuver') {
            inNested(data.maneuvers_choose_from);
            inNested(data.maneuvers_readied_names);
            keyMove(data.maneuvers_desc_dict);
            inArray(st.maneuverOrder);
            const pov = st.powOverrides;
            if (pov && pov[powNorm(oldName)] !== undefined && !(powNorm(newName) in pov)) {
                pov[powNorm(newName)] = pov[powNorm(oldName)];
                delete pov[powNorm(oldName)];
                n++;
            }
            prefsRemap('maneuver:' + powNorm(oldName), 'maneuver:' + powNorm(newName));
        } else if (kind === 'stance') {
            inArray(data.stances_chosen);
            keyMove(data.maneuvers_desc_dict);
            inArray(st.activeStances);
            const sov = st.stanceOverrides;
            if (sov && sov[powNorm(oldName)] !== undefined && !(powNorm(newName) in sov)) {
                sov[powNorm(newName)] = sov[powNorm(oldName)];
                delete sov[powNorm(oldName)];
                n++;
            }
            prefsRemap('stance:' + powNorm(oldName), 'stance:' + powNorm(newName));
        } else if (kind === 'talent') {
            inObjArray(data.magic_talent_items);
            inObjArray(data.combat_talent_items);
            prefsRemap('talent:' + sphereNorm(oldName), 'talent:' + sphereNorm(newName));
        } else if (kind === 'buff') {
            inObjArray(st.buffs);
            prefsRemap('custombuff:' + oldName, 'custombuff:' + newName);
        }

        // ---- stores shared by every kind ----
        keyMove(st.featureChanges);
        const uses = st.featureUses;
        if (uses) {
            keyMove(uses);
            // Charge links point AT pools by name — follow both directions.
            for (const u of Object.values(uses)) {
                const cs = u?.chargeSource;
                if (cs?.kind === 'feature' && isOld(cs.name)) { cs.name = newName; n++; }
            }
        }
        for (const it of data.equipment_list || []) {
            const cs = it && typeof it === 'object' ? it.chargeSource : null;
            if (cs?.kind === 'feature' && isOld(cs.name)) { cs.name = newName; n++; }
        }
        // Disabled/removed passive-source sets: entries are "<sourceKind>::<name>" where
        // sourceKind is the LEDGER vocabulary (feat/trait/classFeat/marquee/…), not ours —
        // match on the name half only.
        for (const k of ['disabledBuffSources', 'removedBuffSources']) {
            const arr = st[k];
            if (!Array.isArray(arr)) continue;
            arr.forEach((entry, i) => {
                const cut = String(entry).indexOf('::');
                if (cut < 0 || !isOld(String(entry).slice(cut + 2))) return;
                arr[i] = String(entry).slice(0, cut) + '::' + newName;
                n++;
            });
        }
        // The override itself moves last (its key embeds the name).
        const store = featureOverrideStore(data, false);
        if (store) {
            const okey = featureOvKey(kind, oldName);
            const nkey = featureOvKey(kind, newName);
            if (store[okey] !== undefined && okey !== nkey && !(nkey in store)) {
                store[nkey] = store[okey];
                delete store[okey];
                n++;
            }
            if (store[nkey]) store[nkey].name = newName;
        }
        return { ok: true, changed: n };
    }

    // Conditional modifier -> always-on ledger change. Attack/damage targets are valid
    // change targets and pass straight through; everything else passes through as-is.
    function stanceChangesFromModifiers(mods) {
        return (mods || [])
            .filter((m) => m && m.formula != null && m.target)
            .map((m) => ({
                formula: String(m.formula),
                target: m.target,
                type: m.type || 'untyped',
                operator: m.operator || 'add',
                priority: m.priority || 0,
            }));
    }

    /**
     * The MARQUEE_FEATURES entries this character qualifies for, by class presence —
     * substring match on every class name the payload knows (classes[], class_list, legacy
     * c_class pair) so "Barbarian (Invulnerable Rager)" still lights up Rage. Read-only:
     * never seeds class_list.
     */
    function marqueeFeaturesFor(data) {
        const names = [];
        if (Array.isArray(data?.classes)) {
            for (const c of data.classes) names.push(c?.name, c?.display);
        }
        if (Array.isArray(data?.class_list)) names.push(...data.class_list);
        names.push(data?.c_class, data?.c_class_2);
        const lower = names.filter(Boolean).map((n) => String(n).toLowerCase());
        return (window.SheetData?.MARQUEE_FEATURES || [])
            .filter((t) => lower.some((n) => n.includes(t.cls)));
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

        // Situational combat toggles — universal PF1 options curated client-side in
        // SheetData.COMBAT_TOGGLES. Always listed, never feat-gated: the sheet warns via the
        // roll card, it doesn't gatekeep. The checked ones also dual-write their standing
        // `acChanges` into collectChanges' ledger (sourceKind 'combat').
        for (const t of window.SheetData?.COMBAT_TOGGLES || []) {
            push({
                id: t.id,
                label: t.label || t.name,
                source: t.name,
                sourceKind: 'combat',
                defaultOn: false,
                modifiers: t.modifiers || [],
                rider: t.rider || '',
            });
        }

        // Marquee base class features (Rage, Smite Evil, ...) — curated client-side in
        // SheetData.MARQUEE_FEATURES, keyed by class presence so already-saved characters
        // get them without a re-generate. Same dual-write pattern as the combat toggles:
        // per-roll `modifiers` here, standing `acChanges` in collectChanges ('marquee').
        for (const t of marqueeFeaturesFor(data)) {
            push({
                id: t.id,
                label: t.label || t.name,
                source: t.name,
                sourceKind: 'classFeature',
                defaultOn: false,
                modifiers: t.modifiers || [],
                rider: t.rider || '',
            });
        }

        // User-authored per-roll toggles (#16): buffs with activation 'perRoll'. The buff's
        // Active checkbox gates availability; the panel checkbox is the per-roll switch.
        // An itemKey scopes the toggle to one weapon, exactly like enhancement qualities.
        for (const b of (data._sheet?.buffs || [])) {
            if (!b || b.active === false || b.activation !== 'perRoll') continue;
            if (!b.changes?.length && !b.notes) continue;
            push({
                id: 'custombuff:' + (b.id || b.name),
                label: b.name || 'Custom toggle',
                source: b.name || 'Custom toggle',
                sourceKind: 'custom',
                itemKey: b.itemKey || undefined,
                defaultOn: false,
                modifiers: applyBuffLevel(b.changes, b.level).map((c) => ({
                    formula: String(c.formula ?? ''),
                    target: c.target || 'attack',
                    type: c.type || 'untyped',
                })),
                rider: b.notes || '',
            });
        }

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
            const cond = resolvePowConditional(data, name);
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
                // Boosts are swift actions — the roller auto-spends the swift slot when an
                // attack fires with one checked (#19).
                powType: String(descs[name]?.type || 'strike').toLowerCase(),
                defaultOn: false,
                modifiers: cond.modifiers || [],
                rider: cond.rider || '',
            });
        }
        for (const name of (data.stances_chosen || [])) {
            const cond = resolvePowConditional(data, name);
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
            const cond = resolveTalentConditional(data, t);
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

        // Weapon qualities. `itemKey` scopes each one to the weapon that carries it: flaming on the
        // longsword must not add 1d6 fire when the greataxe swings, and without the tag every
        // quality on every equipped weapon would apply to every attack.
        for (const enh of collectEnhancements(data)) {
            if (enh.kind !== 'weapon') continue;
            for (const [idx, cond] of (enh.entry.conditionals || []).entries()) {
                if (!cond) continue;
                push({
                    id: `enh:${enh.itemKey}:${String(enh.quality).toLowerCase()}:${idx}`,
                    label: cond.name || `${enh.quality} (${enh.itemName})`,
                    source: enh.quality,
                    sourceKind: 'enhancement',
                    itemKey: enh.itemKey,
                    itemName: enh.itemName,
                    defaultOn: !!cond.default,
                    modifiers: cond.modifiers || [],
                    rider: condRider(cond),
                });
            }
        }

        // Class-feature powers. The curated `name` is the display label and already carries its
        // [[inline rolls]], which the panel renders as chips with no extra work.
        for (const { name, index, cond } of classFeaturePowerConditionals(data)) {
            push({
                id: `classFeature:${sphereNorm(name)}:${index}`,
                label: cond.name || name,
                source: name,
                sourceKind: 'classFeature',
                defaultOn: !!cond.default,
                modifiers: cond.modifiers || [],
                rider: condRider(cond),
            });
        }

        // #45 double-count guard: while a spell's auto-cast buff is active, the ledger
        // already carries its changes — suppress the per-roll toggle until the buff ends.
        const autoBuffActive = new Set((data._sheet?.buffs || [])
            .filter((b) => b && b.active !== false && b.autoKey)
            .map((b) => b.autoKey));
        for (const [spellName, entry] of Object.entries(data.spell_changes_dict || {})) {
            if (!entry) continue;
            if (autoBuffActive.has('spell:' + String(spellName).toLowerCase())) continue;
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
                priority: ch.priority || 0, custom: !!ch.custom,
                // Which attack d20 an always-on change rides. Deliberately NOT the `critical`
                // field the per-roll conditionals use: there `normal` means "initial roll only",
                // whereas a standing bonus applies to BOTH rolls by default. Same word, opposite
                // default -- so it gets its own name. 'both' (or absent) | 'initial' | 'confirm'.
                appliesOn: ch.appliesOn || 'both' });
        }
        for (const note of entry?.contextNotes || []) {
            const text = typeof note === 'string' ? note : note.text;
            if (text) ledger.notes.push({ source, sourceKind, text,
                target: (typeof note === 'object' && note.target) || '' });
        }
    }

    // A buff's level is ITS caster level (an ally's CL-10 Heroism, a fixed-CL scroll):
    // substitute @cl/@sl here, so downstream evaluators need no per-entry ctx. Level 0 or
    // blank leaves the token in place — it surfaces as unresolved, never a silent 0.
    function applyBuffLevel(changes, level) {
        const lv = Number(level) || 0;
        if (!lv) return changes || [];
        return (changes || []).map((c) => ({
            ...c,
            formula: String(c.formula ?? '').replace(/@(?:cl|sl)\b/gi, String(lv)),
        }));
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

        // Backend-curated flaw mechanics (#66): {changes, contextNotes, description, tier}
        // keyed by flaw name, already filtered to this character's flaws. pushEntry lands
        // the penalties in the same ledger the AC grid, save buckets, skills and the Buffs
        // Permanent list read. Names pre-seed seenTraits so the generic compendium loop
        // below can't double-count a flaw that also matches a trait/feat entry.
        const seenTraits = new Set();
        for (const [name, entry] of Object.entries(data.flaw_effects_dict || {})) {
            if (!name || !entry || seenTraits.has(name)) continue;
            seenTraits.add(name);
            pushEntry(ledger, name, 'flaw', entry);
        }
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

        // Curated class-feature POWER effects (rage powers, hexes, ki powers, arcana, talents...),
        // which the compendium extract above does not cover. Auto-drafted entries the backend has not
        // vetted ship contextNotes only, so nothing unreviewed can reach the numeric totals.
        for (const [name, entry] of Object.entries(data.class_feature_changes_dict || {})) {
            if (!entry) continue;
            pushEntry(ledger, name, 'classFeat', entry);
            // `tagBuff` is deliberately NOT applied. It is a Multi-Buff-Distributor payload for
            // powers that buff OTHER creatures, with its @classes/@abilities refs already baked to
            // this character's numbers — applying it here would hand an ally's bonus to the owner.
            // Surfaced as a note so the effect is still visible on the sheet.
            const tag = entry.tagBuff;
            if (tag && (tag.changes?.length || tag.contextNotes?.length)) {
                const bits = [
                    ...(tag.changes || []).map((c) => `${c.formula} ${c.type || ''} ${c.target}`.trim()),
                    ...(tag.contextNotes || []).map((n) => n?.text).filter(Boolean),
                ];
                ledger.notes.push({ source: name, sourceKind: 'classFeat',
                    text: 'Grants to allies' + (tag.auraRange ? ` within ${tag.auraRange} ft` : '')
                        + (bits.length ? ': ' + bits.join('; ') : ''),
                    target: '' });
            }
        }

        // Armor / shield enhancements are standing bonuses, not per-roll toggles, so they belong in
        // the ledger — which puts them in the Defenses AC grid, the save buckets and the Buffs tab's
        // Permanent section with no per-tab work.
        for (const enh of collectEnhancements(data)) {
            if (enh.kind !== 'armor') continue;
            const entry = { changes: enh.entry.changes || [],
                contextNotes: enh.entry.contextNotes || [] };
            if (entry.changes.length || entry.contextNotes.length) {
                pushEntry(ledger, `${enh.quality} (${enh.itemName})`, 'enhancement', entry);
            }
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
                if (!b.changes?.length && !b.contextNotes?.length) continue;
                // Per-roll buffs (#16) are conditional-panel toggles, not standing
                // modifiers — collectRollConditionals owns them.
                if (b.activation === 'perRoll') continue;
                pushEntry(ledger, b.name || 'Buff', 'buff', {
                    changes: applyBuffLevel(b.changes, b.level),
                    contextNotes: b.contextNotes || [],
                });
            }
        }

        // Active Path of War stances behave like always-on buffs: their (possibly
        // user-overridden) benefits feed every sheet total while the stance is toggled on.
        for (const name of (data._sheet?.activeStances || [])) {
            const entry = resolveStanceEntry(data, name);
            if (entry.changes.length || entry.contextNotes.length) {
                pushEntry(ledger, name, 'stance', entry);
            }
        }

        // Active conditions (Buffs tab tray) — curated numeric penalties from
        // SheetData.CONDITION_CHANGES. loseDex/noDodge are flags derive.js reads directly
        // (a ledger change can't express "your Dex bonus stops counting").
        const condTable = window.SheetData?.CONDITION_CHANGES || {};
        const condLabels = new Map((window.SheetData?.PF1_CONDITIONS || [])
            .map((c) => [c.id, c.label]));
        for (const id of data._sheet?.conditions || []) {
            const entry = condTable[id];
            if (entry?.changes?.length) {
                pushEntry(ledger, condLabels.get(id) || id, 'condition', entry);
            }
        }

        // #21 Automatic Bonus Progression: the Unchained attunement bonuses enter the
        // always-on ledger keyed off character level, so the AC grid / save buckets /
        // attack math pick them up like any other source. It renders as a Permanent
        // Buffs row ('abp' sourceKind), so it can be inspected there; prowess abilities
        // come from the Settings picks (defaults match the Settings UI: INT / STR).
        const vr = data._sheet?.variantRules;
        if (vr?.abp && window.SheetData?.abpBonuses) {
            const b = window.SheetData.abpBonuses(data.level);
            const ch = [];
            const add = (value, target, type) =>
                ch.push({ formula: '+' + value, target, type });
            if (b.resistance) add(b.resistance, 'allSavingThrows', 'resist');
            if (b.armor) add(b.armor, 'aac', 'enh');
            if (b.weapon) { add(b.weapon, 'attack', 'enh'); add(b.weapon, 'damage', 'enh'); }
            if (b.deflection) add(b.deflection, 'ac', 'deflect');
            if (b.toughening) add(b.toughening, 'nac', 'enh');
            const picks = vr.abpChoices || {};
            b.mental.forEach((v, i) => {
                if (v) add(v, picks['mental' + (i + 1)] || 'int', 'enh');
            });
            b.physical.forEach((v, i) => {
                if (v) add(v, picks['physical' + (i + 1)] || 'str', 'enh');
            });
            if (ch.length) {
                pushEntry(ledger, 'Automatic Bonus Progression', 'abp', { changes: ch });
            }
        }

        // Checked combat toggles (conditional panel "Combat options" group) dual-write their
        // standing side — AC, saves — so every derived total updates while they're on. The
        // per-roll attack/damage side stays in collectRollConditionals; the panel owns the
        // toggle, so 'combat' is excluded from the Buffs Permanent list like 'condition'.
        const togglePrefs = data._sheet?.conditionalPrefs || {};
        for (const t of window.SheetData?.COMBAT_TOGGLES || []) {
            if (!togglePrefs[t.id] || !t.acChanges?.length) continue;
            pushEntry(ledger, t.name, 'combat', { changes: t.acChanges });
        }

        // Active marquee class features (Rage's Str/Con/Will/AC, Smite's deflection AC...)
        // dual-write the same way — the conditional panel owns the toggle, so 'marquee' is
        // excluded from the Buffs Permanent list like 'combat' and 'condition'.
        for (const t of marqueeFeaturesFor(data)) {
            if (!togglePrefs[t.id] || !t.acChanges?.length) continue;
            pushEntry(ledger, t.name, 'marquee', { changes: t.acChanges });
        }

        return ledger;
    }

    /**
     * Backend-parsed {changes, contextNotes} for an item name — the payload's
     * item_changes_dict (built from items_best.json descriptions). Case-insensitive.
     */
    function lookupBackendItemBuff(data, name) {
        const dict = data?.item_changes_dict;
        if (!dict || typeof dict !== 'object') return null;
        if (dict[name]) return dict[name];
        const lc = String(name).toLowerCase();
        for (const [k, v] of Object.entries(dict)) {
            if (String(k).toLowerCase() === lc) return v;
        }
        return null;
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
        const backendBuff = lookupBackendItemBuff(data, name);

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

        // Backend-parsed buffs (item_changes_dict) merge on top of whatever source won above,
        // deduped by change target / note text so compendium-automated items don't double-apply.
        // Skipped entirely once the user customizes the item's changes (their edits win).
        if (!customized && backendBuff) {
            const haveTargets = new Set(changes.map((c) => c && c.target));
            for (const c of (backendBuff.changes || [])) {
                if (c && c.target && !haveTargets.has(c.target)) {
                    changes.push({ ...c });
                    haveTargets.add(c.target);
                }
            }
            const haveTexts = new Set(contextNotes.map((n) => n && n.text));
            for (const n of (backendBuff.contextNotes || [])) {
                if (n && n.text && !haveTexts.has(n.text)) {
                    contextNotes.push({ ...n });
                    haveTexts.add(n.text);
                }
            }
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
        // Quantity 0 is meaningful (ammo shot dry), so only a MISSING value defaults to 1.
        const rawQty = isObj ? raw.quantity : 1;
        const quantity = rawQty == null || rawQty === ''
            ? 1
            : Math.max(0, Number(rawQty) || 0);
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
        // BAB (same source as SheetFormula's resolver) — the combat toggles scale with it
        s = s.replace(/@attributes\.bab\.total/gi,
            String(window.SheetDerive?.babTotal?.(data) ?? (Number(data?.bab_total) || 0)));
        // Class levels, STRICTLY (mirrors SheetFormula.classLevel): a class the character
        // does not have resolves to 0, never the whole level — the marquee features scale
        // with these. Lenient classLevelFor only for legacy payloads with no classes[].
        s = s.replace(/@classes\.([a-z0-9_-]+)\.level/gi, (_, cls) => {
            if (Array.isArray(data?.classes)) {
                const hit = data.classes.find((c) => [c?.name, c?.display]
                    .some((n) => String(n || '').toLowerCase().trim() === cls));
                return String(Number(hit?.level) || 0);
            }
            return String(Number(window.SheetClassInfo?.classLevelFor?.(data, cls)) || 0);
        });
        // Path of War: initiator level and initiation-stat modifier (stance/maneuver scaling)
        const initLevel = Number(data?.initiator_level) || 0;
        s = s.replace(/@pow\.initLevel/gi, String(initLevel));
        const initKey = String(data?.initiation_stat || '').toLowerCase();
        const initMod = (initKey && data?.[initKey] != null)
            ? Math.floor((Number(data[initKey]) - 10) / 2) : 0;
        s = s.replace(/@INITMOD/gi, String(initMod));
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
    // Distinct class names derived from the class-feature compendium (each entry carries
    // a `.classes` array). Memoized — the maps don't change after load.
    let classNameList = null;
    function classNames() {
        if (classNameList) return classNameList;
        const m = maps.classFeatures;
        const seen = new Map(); // lowercase -> display
        if (m?.byKey) {
            for (const entry of Object.values(m.byKey)) {
                const entries = Array.isArray(entry) ? entry : [entry];
                for (const e of entries) {
                    for (const c of e?.classes || []) {
                        const name = String(c || '').trim();
                        if (!name) continue;
                        const key = name.toLowerCase();
                        if (!seen.has(key)) seen.set(key, name);
                    }
                }
            }
        }
        classNameList = [...seen.entries()]
            .sort((a, b) => a[1].localeCompare(b[1]));
        return classNameList;
    }

    function searchCatalog(kind, query, opts = {}) {
        const limit = opts.limit || 40;
        const q = String(query || '').toLowerCase().trim();
        // Classes are a bounded list, so an empty query lists them all alphabetically
        // (lets "Browse classes" show every option before the user types).
        if ((!q || q.length < 1) && kind !== 'classes') return [];

        const out = [];
        const push = (row) => {
            if (out.length >= limit) return;
            out.push(row);
        };

        if (kind === 'classes') {
            for (const [key, name] of classNames()) {
                if (q && !key.includes(q)) continue;
                push({ key, name, kind: 'classes', subtitle: 'Class', entry: { name } });
                if (out.length >= limit) break;
            }
            out.sort((a, b) => {
                const ap = a.key.startsWith(q) ? 0 : 1;
                const bp = b.key.startsWith(q) ? 0 : 1;
                return ap !== bp ? ap - bp : a.name.localeCompare(b.name);
            });
            return out.slice(0, limit);
        }

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
        return Object.keys(maps).concat(['talents', 'classes']);
    }

    /**
     * Walk every entry of one catalog kind. `searchCatalog` answers "what matches this string";
     * this answers "what is in here at all", which is what an index over a property other than
     * the name (SheetBuffEffects, over changes[].target) needs.
     *
     * A key can hold an array (same name, several sources); every one is visited. Entries are
     * handed out by reference — callers must not mutate them.
     */
    function eachCatalogEntry(kind, fn) {
        const m = maps[kind];
        if (!m?.byKey || typeof fn !== 'function') return;
        for (const [key, entry] of Object.entries(m.byKey)) {
            for (const e of (Array.isArray(entry) ? entry : [entry])) {
                if (e) fn(key, e);
            }
        }
    }

    return {
        ready, lookup, lookupClassFeature, lookupWeapon, lookupItem,
        lookupManeuverConditional, resolvePowConditional, setPowOverride, clearPowOverride,
        stanceChangesFromModifiers, lookupStanceBenefit, resolveStanceEntry,
        setStanceOverride, clearStanceOverride, conditionalForTalent, collectChanges,
        getFeatureOverride, setFeatureOverride, clearFeatureOverride, isFeatureEdited,
        resolveFeature, resolveSpell, renameFeature, sphereNorm, OVERRIDE_KINDS,
        resolveTalentConditional,
        collectRollConditionals, normalizeInventoryEntry, powNorm,
        parseEnhancements, lookupEnhancement, collectEnhancements, coreGearItemKey,
        targetLabel, typeLabel, evalSimpleFormula, changesForTargets,
        searchCatalog, catalogKinds, eachCatalogEntry, classFeaturesAtLevel,
    };
})();
