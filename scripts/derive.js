// scripts/derive.js -- pure derived-stat math for the character sheet (window.SheetDerive).
// Extracted from sheet.js (Part B split); function bodies are moved verbatim.
// Loads AFTER ui.js and BEFORE state.js, so its few state deps (sheetState, the buff-source
// sets, ensureCastingAbility) are late-bound via window.SheetState and read at call time.
// window.SheetDetails is likewise read at call time.
window.SheetDerive = (function () {
    'use strict';
    const { fmt, mod, toInt, titleCase } = window.SheetUI;
    // Late-bound state helpers (state.js loads after this module).
    const sheetState = (d) => window.SheetState.sheetState(d);
    const disabledBuffSet = (d) => window.SheetState.disabledBuffSet(d);
    const removedBuffSet = (d) => window.SheetState.removedBuffSet(d);
    const buffSourceKey = (s, k) => window.SheetState.buffSourceKey(s, k);
    const ensureCastingAbility = (d) => window.SheetState.ensureCastingAbility(d);

    // Good-save progressions per class, extracted from the pf1e_random_char_generator module's
    // every_class.json (pf1 + pf1-pow compendium export). Stalker/Zealot are absent from that
    // compendium; their entries follow the d20pfsrd Path of War class tables.
    // FALLBACK ONLY for payloads without save_bases — the backend now stacks saves per class
    // server-side (Backend/utils/data.py good_saves in the generator repo). Keep in sync.
    const GOOD_SAVES = {
        'alchemist': ['fort', 'ref'], 'antipaladin': ['fort', 'will'], 'arcanist': ['will'],
        'barbarian': ['fort'], 'barbarian (unchained)': ['fort'], 'bard': ['ref', 'will'],
        'bloodrager': ['fort'], 'brawler': ['fort', 'ref'], 'cavalier': ['fort'],
        'cleric': ['fort', 'will'], 'druid': ['fort', 'will'], 'fighter': ['fort'],
        'gunslinger': ['fort', 'ref'], 'harbinger': ['fort', 'will'], 'hunter': ['fort', 'ref'],
        'inquisitor': ['fort', 'will'], 'investigator': ['ref', 'will'],
        'kineticist': ['fort', 'ref'], 'magus': ['fort', 'will'], 'medic': ['fort', 'will'],
        'medium': ['will'], 'mesmerist': ['ref', 'will'], 'monk': ['fort', 'ref', 'will'],
        'monk (unchained)': ['fort', 'ref'], 'mystic': ['will'], 'ninja': ['ref'],
        'occultist': ['fort', 'will'], 'oracle': ['will'], 'paladin': ['fort', 'will'],
        'psychic': ['will'], 'ranger': ['fort', 'ref'], 'rogue': ['ref'],
        'rogue (unchained)': ['ref'], 'samurai': ['fort'], 'shaman': ['will'],
        'shifter': ['fort', 'ref'], 'skald': ['fort', 'will'], 'slayer': ['fort', 'ref'],
        'sorcerer': ['will'], 'spiritualist': ['fort', 'will'], 'stalker': ['will'],
        'summoner': ['will'], 'summoner (unchained)': ['will'], 'swashbuckler': ['ref'],
        'vigilante': ['ref', 'will'], 'warder': ['fort', 'will'], 'warlord': ['fort'],
        'warpriest': ['fort', 'will'], 'witch': ['will'], 'wizard': ['will'],
        'zealot': ['fort', 'will'],
    };
    /**
     * Effective ability score & modifier, pf1-style. The generator's exported score
     * (data[ab]) already bakes in the racial modifier; the backend also ships per-stat
     * inherent (data.inherents) and level-up (data.level_up_stats) dicts that are NOT in
     * that base, so they are added here. On top sit the user's manual boxes and the buff
     * ledger. ability Damage penalizes the MOD (−1 per 2). Optional data.racial_stats, if
     * the generator exports it, only splits the racial part out of the base for display.
     * User boxes persist on _sheet.abilityAdjust[ab] =
     * { racial, enhancement, inherent, misc, damage, drain }.
     */
    function abilityInfo(data, ab) {
        const base = Number(data?.[ab]);
        const adj = data?._sheet?.abilityAdjust?.[ab] || {};
        const racial = Number(adj.racial) || 0;
        const enhancement = Number(adj.enhancement) || 0;
        const inherent = Number(adj.inherent) || 0;
        const levelup = Number(adj.levelup) || 0;
        const misc = Number(adj.misc) || 0;
        const damage = Number(adj.damage) || 0;
        const drain = Number(adj.drain) || 0;
        // Generator's racial modifier is inside the base score only until seedRacialColumn
        // moves it into the Racial column; after that the split is already explicit.
        const autoRacial = data?._sheet?.racialSeeded ? 0 : Number(data?.racial_stats?.[ab]) || 0;
        const bits = [];
        let ledgerSum = 0;
        // Ledger bonuses (equipped items, buffs, feats…) bucketed into the ability table's typed
        // columns so an equipped belt's enhancement shows in the Enhance column instead of only in
        // the Total's hover. enh/inherent/racial map to their columns; anything else lands in Misc,
        // so the displayed columns always reconcile with the Total.
        const TYPE_TO_COL = { enh: 'enhancement', inherent: 'inherent', racial: 'racial' };
        const autoByCol = { racial: 0, enhancement: 0, inherent: 0, misc: 0 };
        const autoSrc = { racial: [], enhancement: [], inherent: [], misc: [] };
        const SD = window.SheetDetails;
        if (SD && data) {
            for (const c of (effectiveLedger(data).changes || [])) {
                if (c.target !== ab) continue;
                const ev = SD.evalSimpleFormula(c.formula, data);
                if (ev?.ok && ev.value) {
                    ledgerSum += ev.value;
                    bits.push(`${c.source} ${fmt(ev.value)}`);
                    const col = TYPE_TO_COL[c.type] || 'misc';
                    autoByCol[col] += ev.value;
                    autoSrc[col].push(`${c.source} ${fmt(ev.value)}`);
                }
            }
        }
        const parts = { base, racial, enhancement, inherent, levelup, misc, damage, drain,
            autoRacial, autoByCol, autoSrc };
        if (!Number.isFinite(base)) {
            return { ...parts, base: null, total: null, mod: 0, formula: 'no score' };
        }
        // Inherent + level-up now live in their own columns (seeded from the backend), so
        // the total is simply base + every typed bonus − drain.
        const manual = racial + enhancement + inherent + levelup + misc;
        const total = base + ledgerSum + manual - drain;
        const damagePen = Math.floor(damage / 2);
        const rollBase = base - autoRacial; // base already includes the racial modifier
        const formula = [
            'base ' + rollBase,
            autoRacial ? 'racial ' + fmt(autoRacial) : null,
            racial ? (autoRacial ? 'racial+ ' : 'racial ') + fmt(racial) : null,
            ...bits,
            levelup ? 'level-up ' + fmt(levelup) : null,
            enhancement ? 'enhancement ' + fmt(enhancement) : null,
            inherent ? 'inherent ' + fmt(inherent) : null,
            misc ? 'misc ' + fmt(misc) : null,
            drain ? 'drain ' + drain : null,
        ].filter(Boolean).join(' + ').replace(/\+ drain/g, '− drain')
            + ' = ' + total
            + (damagePen ? ` · mod −${damagePen} (${damage} ability damage)` : '');
        return { ...parts, base, total, mod: mod(total) - damagePen, formula };
    }
    /** Effective ability modifier (ledger + damage/drain/misc aware). */
    function abModOf(data, ab) {
        return abilityInfo(data, ab).mod;
    }
    /** Full ledger with inactive sources' changes stripped (notes/conditionals kept for UI). */
    function effectiveLedger(data) {
        const SD = window.SheetDetails;
        const full = SD ? SD.collectChanges(data) : (window.sheetChangesFull || window.sheetChanges
            || { changes: [], notes: [], conditionals: [] });
        const disabled = disabledBuffSet(data);
        const removed = removedBuffSet(data);
        if (!disabled.size && !removed.size) return full;
        return {
            changes: (full.changes || []).filter((c) => {
                const key = buffSourceKey(c.source, c.sourceKind);
                return !disabled.has(key) && !removed.has(key);
            }),
            notes: full.notes || [],
            conditionals: full.conditionals || [],
        };
    }
    /** Group always-on changes by source for per-buff toggles. */
    function groupChangesBySource(changes) {
        const map = new Map();
        for (const c of changes || []) {
            const key = buffSourceKey(c.source, c.sourceKind);
            if (!map.has(key)) {
                map.set(key, {
                    key,
                    source: c.source,
                    sourceKind: c.sourceKind || 'buff',
                    lines: [],
                });
            }
            map.get(key).lines.push(c);
        }
        return [...map.values()].sort((a, b) =>
            String(a.source).localeCompare(String(b.source)));
    }
    // ---------------------------------------------------------------- size / conditions / load
    /**
     * Effective size category. Explicit `_sheet.size` wins; unset defaults from the race
     * (Small races → small, else medium). Any ACTIVE buff with `setSize` (Enlarge Person)
     * overrides — last active buff in list order wins. `special` is the CMB/CMD modifier.
     */
    function sizeInfo(data) {
        const SDta = window.SheetData;
        const sizes = SDta?.SIZES || [];
        let id = String(data?._sheet?.size || '').toLowerCase();
        if (!sizes.some((s) => s.id === id)) {
            const race = String(data?.race || data?.c_race || '').toLowerCase();
            id = SDta?.SMALL_RACES?.has(race) ? 'small' : 'medium';
        }
        for (const b of (data?._sheet?.buffs || [])) {
            if (b && b.active !== false && b.setSize
                && sizes.some((s) => s.id === b.setSize)) id = b.setSize;
        }
        const s = sizes.find((x) => x.id === id)
            || { id: 'medium', label: 'Medium', mod: 0, steps: 0 };
        return { ...s, special: -s.mod };
    }
    /**
     * #112: the DR / resistance / immunity chips ACTIVE buffs contribute to the Defenses tab.
     *
     * Read directly off `buff.grants`, exactly as `sizeInfo` above reads `buff.setSize` — the
     * changes ledger is a vocabulary of scalars and cannot carry "DR 10/adamantine".
     *
     * PF1 stacking is applied here rather than in the tab, because it is a rule, not a layout:
     * **DR and energy resistance of the same kind do not stack — the best one applies.** A chip
     * that loses keeps its place in `superseded` so the Defenses tab can say which buff is being
     * shadowed instead of silently dropping it.
     *
     * Returns `{ dr, resist, dmgImmune, dmgVuln, condResist, condImmune }`, every entry tagged
     * with `source` (the buff's name) and `buffId`.
     */
    function grantedDefenses(data) {
        const keys = window.SheetState?.GRANT_KEYS
            || ['dr', 'resist', 'dmgImmune', 'dmgVuln', 'condResist', 'condImmune'];
        const out = {};
        for (const key of keys) out[key] = [];
        const superseded = [];
        for (const buff of (data?._sheet?.buffs || [])) {
            if (!buff || buff.active === false || !buff.grants) continue;
            for (const key of keys) {
                for (const entry of (buff.grants[key] || [])) {
                    out[key].push({ ...entry, source: buff.name || 'Buff', buffId: buff.id });
                }
            }
        }
        // Best-of, per kind: DR by bypass type, resistance by energy type. Immunities are
        // boolean, so a duplicate is just a duplicate and is deduped by type.
        const bestBy = (list, keyOf) => {
            const best = new Map();
            for (const entry of list) {
                const k = keyOf(entry);
                const prior = best.get(k);
                if (!prior || (Number(entry.amount) || 0) > (Number(prior.amount) || 0)) {
                    if (prior) superseded.push(prior);
                    best.set(k, entry);
                } else {
                    superseded.push(entry);
                }
            }
            return [...best.values()];
        };
        out.dr = bestBy(out.dr, (e) => String(e.bypass || '—').toLowerCase());
        out.resist = bestBy(out.resist, (e) => String(e.type || '').toLowerCase());
        for (const key of ['dmgImmune', 'dmgVuln', 'condResist', 'condImmune']) {
            const seen = new Set();
            out[key] = out[key].filter((e) => {
                const k = String(e.type || '').toLowerCase();
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
            });
        }
        out.superseded = superseded;
        return out;
    }
    /** Dex-denial / dodge-loss flags from active conditions (CONDITION_CHANGES). */
    function conditionFlags(data) {
        const table = window.SheetData?.CONDITION_CHANGES || {};
        const out = { loseDex: false, noDodge: false, sources: [] };
        for (const id of data?._sheet?.conditions || []) {
            const e = table[id];
            if (!e) continue;
            if (e.loseDex) { out.loseDex = true; out.sources.push(id); }
            if (e.noDodge) out.noDodge = true;
        }
        return out;
    }
    /** Total carried weight in lbs (same rule as the Inventory footer: carried × quantity). */
    function carriedWeightLbs(data) {
        const IM = window.SheetInventoryModel;
        const list = data?.equipment_list || [];
        let total = 0;
        for (const it of list) {
            if (!it || typeof it !== 'object') continue;
            // #10: contents inherit the container's carried state; a weightless
            // container's contents weigh nothing.
            if (IM?.effectiveCarried ? !IM.effectiveCarried(list, it) : it.carried === false) continue;
            if (IM?.weightCounts && !IM.weightCounts(list, it)) continue;
            const w = Number(it.weight);
            if (Number.isFinite(w)) total += w * (Number(it.quantity) || 1);
        }
        total += Number(IM?.coinWeightLbs?.(data)) || 0;
        return total;
    }
    /**
     * Encumbrance consequences. Medium load: max Dex +3, check penalty −3; Heavy (and over
     * capacity): +1 / −6; both reduce speed (see loadReducedSpeed). Light load returns
     * null caps so callers can tell "no consequence" from "cap of 0".
     */
    function encumbrance(data) {
        const effStr = abilityInfo(data, 'str').total ?? Number(data?.str);
        const weight = carriedWeightLbs(data);
        const load = loadCategory(weight, effStr);
        const caps = {
            Medium: { maxDex: 3, acp: 3 },
            Heavy: { maxDex: 1, acp: 6 },
            'Over capacity': { maxDex: 1, acp: 6 },
        }[load.label] || null;
        return {
            weight, label: load.label, cls: load.cls, lim: load.lim,
            maxDex: caps ? caps.maxDex : null,
            acp: caps ? caps.acp : 0,
            reducesSpeed: !!caps,
        };
    }
    /** Speed under Medium/Heavy load: ×2/3 rounded up to 5 ft (30→20, 20→15, 50→35). */
    function loadReducedSpeed(ft) {
        const n = Number(ft) || 0;
        return n > 0 ? Math.ceil((n * 2) / 3 / 5) * 5 : n;
    }

    // ---------------------------------------------------------------- derived stats + sources
    function part(label, value, opts = {}) {
        return {
            label,
            value: value == null ? 0 : value,
            kind: opts.kind || 'base',
            type: opts.type || '',
            sourceKind: opts.sourceKind || '', // feat/trait/item/buff… for defense buckets
            unresolved: !!opts.unresolved,
            formula: opts.formula || '',
            info: !!opts.info, // listed but not added to total (e.g. HP ledger)
        };
    }
    function sumParts(parts) {
        let total = 0;
        for (const p of parts) {
            if (p.unresolved || p.info) continue;
            total += Number(p.value) || 0;
        }
        return total;
    }
    function appendLedgerParts(parts, data, ledger, targets, opts = {}) {
        const SD = window.SheetDetails;
        if (!SD || !ledger) return;
        const list = SD.changesForTargets(ledger, targets);
        const skipDodge = !!opts.skipDodge;
        const skipArmorShield = !!opts.skipArmorShield; // for touch: drop aac/sac targets
        for (const c of list) {
            if (skipDodge && (c.type === 'dodge')) continue;
            if (skipArmorShield && (c.target === 'aac' || c.target === 'sac')) continue;
            // On touch AC, only keep dodge/deflect/insight/luck/etc. and tac — still include
            // generic `ac` non-armor types; skip enhancement armor-ish is hard without more data.
            if (opts.touchOnly) {
                if (c.target === 'aac' || c.target === 'sac') continue;
                if (c.type === 'armor' || c.type === 'shield') continue;
            }
            const typeStr = SD.typeLabel(c.type);
            const label = (typeStr ? typeStr + ' ' : '') + `(${c.source})`;
            const ev = SD.evalSimpleFormula(c.formula, data);
            if (ev.ok) {
                parts.push(part(label, ev.value, {
                    kind: 'ledger', type: c.type || '', sourceKind: c.sourceKind || '',
                    info: !!opts.infoOnly,
                }));
            } else {
                parts.push(part(label, 0, {
                    kind: 'ledger', type: c.type || '', sourceKind: c.sourceKind || '',
                    unresolved: true,
                    formula: ev.formula || c.formula, info: !!opts.infoOnly,
                }));
            }
        }
    }
    /**
     * Full derived combat numbers with source parts (base + gear + ability + change ledger).
     */
    function computeDerived(data) {
        const SD = window.SheetDetails;
        // Full ledger for Buffs tab; effective (maybe empty changes) for math
        const fullLedger = SD ? SD.collectChanges(data) : (window.sheetChangesFull || { changes: [] });
        window.sheetChangesFull = fullLedger;
        const ledger = effectiveLedger(data);
        window.sheetChanges = ledger;

        // Simple-sheet total edits land here as flat deltas (visible in every sources list).
        const manual = sheetState(data).manualAdjust || {};
        const manualPart = (parts, key) => {
            const v = Number(manual[key]) || 0;
            if (v) parts.push(part('Manual adjustment', v, { kind: 'manual' }));
        };

        // PF1 negative levels: −1 per level on attack rolls, saves, skill and ability
        // checks; −5 HP each. (CL / spell-slot loss is flagged on Attributes, not automated.)
        const negLv = Number(sheetState(data).negativeLevels) || 0;
        const negPart = (parts) => {
            if (negLv) {
                parts.push(part('Negative levels', -negLv, { kind: 'ledger', type: 'penalty' }));
            }
        };

        const level = Number(data.level) || 0;
        const frac = fractionalBases(data);
        // #112: racial hit dice stack ON TOP of class levels (a gnoll fighter 3 is 2 racial HD +
        // 3 class levels), so their BAB and base saves are separate parts rather than a different
        // way of computing the class ones. null for every ordinary character, which is the
        // overwhelmingly common case and leaves every number below untouched.
        const racial = window.SheetCreature?.racialContribution?.(data) || null;
        const bab = (frac ? frac.bab : (Number(data.bab_total) || 0)) + (racial ? racial.bab : 0);
        const strM = abModOf(data, 'str'), dexM = abModOf(data, 'dex'), conM = abModOf(data, 'con');
        const wisM = abModOf(data, 'wis'), intM = abModOf(data, 'int'), chaM = abModOf(data, 'cha');
        const armorAc = toInt(data.armor_ac) ?? 0;
        const shieldAc = toInt(data.shield_ac) ?? 0;
        const size = sizeInfo(data);
        const condFlags = conditionFlags(data);
        const enc = encumbrance(data);
        // Max Dex to AC: the tighter of the armor's cap and the load's cap.
        const armorMaxDex = toInt(data.armor_max_dex_bonus);
        const maxDex = [armorMaxDex, enc.maxDex].filter((v) => v != null)
            .reduce((a, b) => Math.min(a, b), Infinity);
        const hasDexCap = Number.isFinite(maxDex);
        const dexCapSource = hasDexCap
            ? (enc.maxDex != null && (armorMaxDex == null || enc.maxDex < armorMaxDex)
                ? `${enc.label.toLowerCase()} load` : 'armor')
            : '';
        const dexCapped = hasDexCap && dexM > maxDex;
        let effDex = dexCapped ? maxDex : dexM;
        // Dex-denying conditions: a POSITIVE Dex bonus stops counting (penalties still apply).
        const dexDenied = condFlags.loseDex && effDex > 0;
        if (dexDenied) effDex = 0;
        const dexAcLabel = dexDenied
            ? `Dex (denied — ${condFlags.sources.join(', ')})`
            : (dexCapped ? `Dex (capped by ${dexCapSource} max ${maxDex})` : 'Dex');
        const armorName = (data.armor_name || '').trim() || 'Armor';
        const shieldName = (data.shield_name || '').trim() || 'Shield';
        const className = String(data.c_class || '').toLowerCase();
        const goods = GOOD_SAVES[className];
        // multiclass payloads carry save_bases stacked per class server-side — authoritative;
        // GOOD_SAVES + level is the fallback for older cached payloads (first class only)
        const saveBases = (data.save_bases && typeof data.save_bases === 'object')
            ? data.save_bases : null;
        const multiclassSaves = Boolean(data.c_class_2) && !saveBases;
        const classBase = (save) => {
            if (frac) return frac.saves[save];
            if (saveBases && Number.isFinite(Number(saveBases[save]))) return Number(saveBases[save]);
            if (!goods || !level) return null;
            return goods.includes(save) ? 2 + Math.floor(level / 2) : Math.floor(level / 3);
        };

        // ---- AC ----
        const sizePart = () => part(`Size (${size.label})`, size.mod, { kind: 'base' });
        const acParts = [part('Base', 10)];
        if (armorAc || data.armor_name) {
            acParts.push(part(`Armor (${armorName})`, armorAc, { kind: 'gear' }));
        }
        if (shieldAc || data.shield_name) {
            acParts.push(part(`Shield (${shieldName})`, shieldAc, { kind: 'gear' }));
        }
        acParts.push(part(dexAcLabel, effDex, { kind: 'ability' }));
        if (size.mod) acParts.push(sizePart());
        appendLedgerParts(acParts, data, ledger, ['ac', 'aac', 'sac', 'nac'], {
            skipDodge: condFlags.noDodge,
        });
        manualPart(acParts, 'ac');

        const touchParts = [part('Base', 10)];
        touchParts.push(part(dexAcLabel, effDex, { kind: 'ability' }));
        if (size.mod) touchParts.push(sizePart());
        appendLedgerParts(touchParts, data, ledger, ['ac', 'tac', 'nac'], {
            touchOnly: true, skipDodge: condFlags.noDodge,
        });
        manualPart(touchParts, 'touch');

        const flatParts = [part('Base', 10)];
        if (armorAc || data.armor_name) {
            flatParts.push(part(`Armor (${armorName})`, armorAc, { kind: 'gear' }));
        }
        if (shieldAc || data.shield_name) {
            flatParts.push(part(`Shield (${shieldName})`, shieldAc, { kind: 'gear' }));
        }
        if (size.mod) flatParts.push(sizePart());
        appendLedgerParts(flatParts, data, ledger, ['ac', 'ffac', 'aac', 'sac', 'nac'], {
            skipDodge: true,
        });
        manualPart(flatParts, 'flat');

        // ---- Saves ----
        function saveBlock(save, abLabel, abMod) {
            const parts = [];
            if (racial) parts.push(part(racial.label, racial.saves[save], { kind: 'base' }));
            const base = classBase(save);
            if (base == null) {
                parts.push(part('Class base (unknown class progression)', 0, {
                    kind: 'base', unresolved: true, formula: '?',
                }));
            } else if (saveBases && Array.isArray(data.classes) && data.classes.length > 1) {
                parts.push(part(
                    `Class base (stacked: ${data.classes.map((c) => `${titleCase(c.display || c.name)} ${c.level}`).join(' / ')})`,
                    base, { kind: 'base' }));
            } else {
                const good = !!(goods && goods.includes(save));
                parts.push(part(
                    `Class base (${good ? 'good' : 'poor'}${className ? ', ' + titleCase(className) : ''})`,
                    base, { kind: 'base' }));
            }
            parts.push(part(abLabel, abMod, { kind: 'ability' }));
            appendLedgerParts(parts, data, ledger, [save, 'allSavingThrows']);
            manualPart(parts, save);
            negPart(parts);
            return { total: sumParts(parts), parts };
        }
        const fort = saveBlock('fort', 'Constitution', conM);
        const ref = saveBlock('ref', 'Dexterity', dexM);
        const will = saveBlock('will', 'Wisdom', wisM);

        // ---- Init / attacks / CMB / CMD ----
        const initParts = [part('Dexterity', dexM, { kind: 'ability' })];
        appendLedgerParts(initParts, data, ledger, ['init']);
        manualPart(initParts, 'init');
        negPart(initParts);

        const meleeParts = [
            part('BAB', bab, { kind: 'base' }),
            part('Strength', strM, { kind: 'ability' }),
        ];
        if (size.mod) meleeParts.push(sizePart());
        appendLedgerParts(meleeParts, data, ledger, ['attack', 'mattack']);
        manualPart(meleeParts, 'melee');
        negPart(meleeParts);

        const rangedParts = [
            part('BAB', bab, { kind: 'base' }),
            part('Dexterity', dexM, { kind: 'ability' }),
        ];
        if (size.mod) rangedParts.push(sizePart());
        appendLedgerParts(rangedParts, data, ledger, ['attack', 'rattack']);
        manualPart(rangedParts, 'ranged');
        negPart(rangedParts);

        // ---- Weapon damage (dice + ability + enh + ledger) — same breakdown style as attacks ----
        const wName = (data.weapon_name || '').trim();
        const wStats = wName && SD ? SD.lookupWeapon(wName) : null;
        let weaponEnh = 0;
        if (Array.isArray(data.weapon_enhancement_chosen_list)) {
            for (const raw of data.weapon_enhancement_chosen_list) {
                const m = String(raw).match(/^\s*\+(\d+)\b/);
                if (m) weaponEnh = Math.max(weaponEnh, parseInt(m[1], 10));
            }
        }
        const dmgAbKey = (wStats?.damageAbility || 'str').toLowerCase();
        const dmgAbMod = ({ str: strM, dex: dexM, con: conM, int: intM, wis: wisM, cha: chaM })[dmgAbKey] ?? 0;
        const damageParts = [];
        if (wStats?.dice) {
            // Dice is not a flat number — list as info so sources show it without double-counting
            damageParts.push(part('Weapon dice', 0, {
                kind: 'base', info: true, formula: wStats.dice,
            }));
        } else if (wName) {
            damageParts.push(part('Weapon dice', 0, {
                kind: 'base', unresolved: true, formula: 'no weapon stats',
            }));
        }
        if (wStats || wName) {
            damageParts.push(part(dmgAbKey.toUpperCase(), dmgAbMod, { kind: 'ability' }));
        }
        if (weaponEnh) {
            damageParts.push(part('Enhancement', weaponEnh, { kind: 'gear' }));
        }
        const dmgTargets = wStats && (wStats.actionType === 'rwak' || wStats.actionType === 'rsak' || wStats.actionType === 'twak')
            ? ['damage', 'rdamage', 'wdamage']
            : ['damage', 'mdamage', 'wdamage'];
        appendLedgerParts(damageParts, data, ledger, dmgTargets);
        const damageFlat = sumParts(damageParts);
        // Weapon dice step with the character's effective size (compendium dice are Medium).
        const damageDice = wStats?.dice
            ? (window.SheetData?.stepDice?.(wStats.dice, size.steps) ?? wStats.dice)
            : '';
        let damageTotal;
        if (damageDice && damageFlat) {
            damageTotal = damageDice + (damageFlat >= 0 ? '+' : '') + damageFlat;
        } else if (damageDice) {
            damageTotal = damageDice;
        } else if (damageParts.length) {
            damageTotal = (damageFlat >= 0 ? '+' : '') + damageFlat;
        } else {
            damageTotal = '';
        }
        const damage = damageParts.length
            ? { total: damageTotal, parts: damageParts }
            : null;

        const specialSizePart = () => part(`Size, special (${size.label})`, size.special, { kind: 'base' });
        const cmbParts = [
            part('BAB', bab, { kind: 'base' }),
            part('Strength', strM, { kind: 'ability' }),
        ];
        if (size.special) cmbParts.push(specialSizePart());
        appendLedgerParts(cmbParts, data, ledger, ['cmb']);
        manualPart(cmbParts, 'cmb');
        negPart(cmbParts);

        // CMD Dex follows the same denial rule as AC (flat-footed CMD is the separate stat).
        const cmdParts = [
            part('Base', 10),
            part('BAB', bab, { kind: 'base' }),
            part('Strength', strM, { kind: 'ability' }),
            part(dexDenied ? `Dexterity (denied — ${condFlags.sources.join(', ')})` : 'Dexterity',
                dexDenied ? Math.min(dexM, 0) : dexM, { kind: 'ability' }),
        ];
        if (size.special) cmdParts.push(specialSizePart());
        appendLedgerParts(cmdParts, data, ledger, ['cmd']);
        manualPart(cmdParts, 'cmd');

        // Flat-footed CMD (PF1): CMD without Dexterity and dodge bonuses
        const cmdFFParts = cmdParts.filter((p) =>
            !(p.kind === 'ability' && p.label.startsWith('Dexterity')) && p.type !== 'dodge');

        // ---- HP: rolled dice + CON×level, then mhp feats (Toughness, …) on top ----
        // Mirrors Foundry: total_rolled_hp → hp.base; Con is ability contribution; Toughness → mhp.
        const hpParts = [];
        let rolled = toInt(data.total_rolled_hp);
        const hadRolledField = data.total_rolled_hp != null && data.total_rolled_hp !== '';
        const genTotal = toInt(data.Total_HP);
        const conHp = level > 0 ? conM * level : 0;

        // Pre-sum mhp ledger so we can reverse-estimate dice from Total_HP if needed
        let mhpBonus = 0;
        if (SD && ledger) {
            for (const c of SD.changesForTargets(ledger, ['mhp', 'hp'])) {
                const ev = SD.evalSimpleFormula(c.formula, data);
                if (ev.ok) mhpBonus += ev.value;
            }
        }
        if (rolled == null && genTotal != null) {
            rolled = genTotal - conHp - mhpBonus;
        }

        if (rolled != null) {
            hpParts.push(part(
                hadRolledField ? 'Hit dice (rolled)' : 'Hit dice (estimated from total − Con − feats)',
                rolled, { kind: 'base' }));
        } else {
            hpParts.push(part('Hit dice (rolled)', 0, {
                kind: 'base', unresolved: true, formula: 'missing total_rolled_hp',
            }));
        }
        if (level > 0) {
            hpParts.push(part(
                `Constitution (${fmt(conM)} × ${level} HD)`,
                conHp, { kind: 'ability' }));
            // Racial HD are hit dice too: Con applies to each of them as well.
            if (racial) {
                hpParts.push(part(
                    `Constitution (${fmt(conM)} × ${racial.count} racial HD)`,
                    conM * racial.count, { kind: 'ability' }));
            }
        } else {
            hpParts.push(part('Constitution (no level/HD)', 0, { kind: 'ability' }));
        }
        // Feats/traits/talents that grant mhp/hp (Toughness: max(3, HD), etc.) — additive
        appendLedgerParts(hpParts, data, ledger, ['mhp', 'hp'], { infoOnly: false });
        if (negLv) {
            hpParts.push(part('Negative levels (−5 each)', -5 * negLv, {
                kind: 'ledger', type: 'penalty',
            }));
        }

        const ac = { total: sumParts(acParts), parts: acParts };
        const touch = { total: sumParts(touchParts), parts: touchParts };
        const flat = { total: sumParts(flatParts), parts: flatParts };
        const init = { total: sumParts(initParts), parts: initParts };
        const melee = { total: sumParts(meleeParts), parts: meleeParts };
        const ranged = { total: sumParts(rangedParts), parts: rangedParts };
        const cmb = { total: sumParts(cmbParts), parts: cmbParts };
        const cmd = { total: sumParts(cmdParts), parts: cmdParts };
        const cmdFF = { total: sumParts(cmdFFParts), parts: cmdFFParts };

        const computedHp = sumParts(hpParts);
        let hpNote = null;
        if (rolled == null && genTotal == null) {
            hpNote = 'Set hit-dice rolls (total_rolled_hp) and Con/level to compute HP.';
        } else if (!hadRolledField) {
            hpNote = 'Hit-dice rolls estimated — double-click “dice” to set total_rolled_hp.';
        }
        if (hadRolledField || rolled != null) data.Total_HP = computedHp;
        const hp = {
            total: computedHp,
            parts: hpParts,
            note: hpNote,
        };

        // Legacy-compatible flat fields for older call sites
        return {
            level, bab, strM, dexM, conM, wisM, intM, chaM,
            armorAc, shieldAc, maxDex: hasDexCap ? maxDex : null, effDex,
            size, conditionFlags: condFlags, encumbrance: enc,
            ac: ac.total, touch: touch.total, flat: flat.total,
            cmb: cmb.total, cmd: cmd.total,
            blocks: { ac, touch, flat, fort, ref, will, init, melee, ranged, damage, cmb, cmd, cmdFF, hp },
            multiclassSaves,
            savesText: goods && level
                ? `Fort ${fmt(fort.total)}, Ref ${fmt(ref.total)}, Will ${fmt(will.total)}`
                    + (multiclassSaves ? ' (class base: first class only)' : '')
                : null,
        };
    }
    /** @deprecated use computeDerived — kept name as alias for readability at call sites */
    function combatStats(data) {
        return computeDerived(data);
    }
    /** PF1 heavy-load lbs (medium creature); light = ⌊H/3⌋, medium = ⌊2H/3⌋. */
    function carryLimits(strScore) {
        const s = Math.max(1, Math.min(40, Number(strScore) || 10));
        const table = {
            1: 10, 2: 20, 3: 30, 4: 40, 5: 50, 6: 60, 7: 70, 8: 80, 9: 90, 10: 100,
            11: 115, 12: 130, 13: 150, 14: 175, 15: 200, 16: 230, 17: 260, 18: 300,
            19: 350, 20: 400, 21: 460, 22: 520, 23: 600, 24: 700, 25: 800, 26: 920,
            27: 1040, 28: 1200, 29: 1400, 30: 1600,
        };
        let heavy = table[s];
        if (heavy == null) {
            heavy = Math.round(1600 * Math.pow(1.2, s - 30));
        }
        return {
            light: Math.floor(heavy / 3),
            medium: Math.floor((2 * heavy) / 3),
            heavy,
        };
    }
    function loadCategory(totalLbs, strScore) {
        const lim = carryLimits(strScore);
        if (totalLbs <= lim.light) return { label: 'Light', lim, cls: 'load-light' };
        if (totalLbs <= lim.medium) return { label: 'Medium', lim, cls: 'load-medium' };
        if (totalLbs <= lim.heavy) return { label: 'Heavy', lim, cls: 'load-heavy' };
        return { label: 'Over capacity', lim, cls: 'load-over' };
    }
    function castingAbilityMod(data) {
        const key = ensureCastingAbility(data);
        return abModOf(data, key);
    }
    /**
     * Total character level across every class.
     *
     * DERIVED, never read from the payload's stored `total_level`: `level` is editable in the header
     * (and means the PRIMARY class's level -- see the "Fighter 6 / Wizard 4" block in the identity
     * section), while classes[] and total_level are not editable anywhere, so the stored total goes
     * stale the moment someone edits a level. classes[] arrives level-descending from the backend, so
     * classes[0] is the primary and slice(1) is exactly the static "/ Wizard 4" tail the header prints.
     * Single-class and pre-multiclass payloads fall through to `level`, unchanged.
     */
    function totalLevel(data) {
        const primary = Number(data?.level) || 0;
        const rest = (Array.isArray(data?.classes) ? data.classes.slice(1) : [])
            .reduce((n, c) => n + (Number(c.level) || 0), 0);
        return primary + rest;
    }
    /**
     * #112: hit dice — class levels PLUS racial hit dice. This is what "HD" means in every PF1
     * rule that says HD (a template's DR band, `@attributes.hd.total`, a monster's skill budget);
     * `totalLevel` above stays the answer to "what level is this character", which is a different
     * question the moment a creature has racial HD.
     */
    function totalHD(data) {
        return totalLevel(data) + (window.SheetCreature?.racialHD?.(data) || 0);
    }
    /**
     * Caster level. `caster_level` is user-entered only (the generator never ships it), so an explicit
     * override always wins; otherwise use the campaign's homebrew COMBINED caster level -- every
     * casting class contributes its full class level, or level-3 for a 'low' caster, summed and
     * floored to 1. The backend already bakes the -3 into each spellbook's casting_level_num, so
     * summing the books reproduces the rule (this mirrors spellCLExpr() in the Foundry module).
     * Falls back to total level for payloads with no spellbooks.
     */
    function casterLevelValue(data) {
        const n = Number(data.caster_level);
        if (Number.isFinite(n) && n > 0) return n;
        const books = data?.spellbooks;
        if (Array.isArray(books) && books.length) {
            const combined = books.reduce(
                (sum, b) => sum + Math.max(0, Number(b?.casting_level_num) || 0), 0);
            if (combined > 0) return combined;
        }
        return totalLevel(data) || 1;
    }
    function spellSaveDC(data, level) {
        const sl = Math.max(0, Number(level) || 0);
        return 10 + sl + castingAbilityMod(data);
    }
    function concentrationBonus(data) {
        return casterLevelValue(data) + castingAbilityMod(data);
    }
    /** #21 fractional base bonuses (Unchained): BAB and saves accumulate as exact
     *  fractions across classes and floor once at the end; a good save's +2 kicker
     *  counts once no matter how many classes share it. Returns null when the variant
     *  is off, the class list is empty, or any chassis is unknown — the backend's
     *  stacked integers stay authoritative in every fallback. */
    function fractionalBases(data) {
        const st = sheetState(data);
        if (!st.variantRules?.fractionalBases) return null;
        const CI = window.SheetClassInfo;
        const SS = window.SheetState;
        if (!CI || !SS) return null;
        const list = SS.ensureClassList(data).filter(Boolean);
        if (!list.length) return null;
        let babQuarters = 0;
        const sixths = { fort: 0, ref: 0, will: 0 };
        const anyGood = { fort: false, ref: false, will: false };
        for (let i = 0; i < list.length; i++) {
            const info = CI.classInfoFor(data, list[i]);
            const key = CI.classKeyOf(list[i]);
            const hit = (Array.isArray(data.classes) ? data.classes : [])
                .find((c) => CI.classKeyOf(c.name) === key || CI.classKeyOf(c.display) === key);
            const lvl = Number(hit?.level) || (i === 0 ? Number(data.level) || 0 : 0);
            if (!lvl) continue;
            const prog = String(info.bab || '').toLowerCase();
            const quarters = prog === 'full' ? 4 : (prog === '3/4' ? 3 : (prog === '1/2' ? 2 : null));
            if (quarters == null) return null;
            babQuarters += lvl * quarters;
            for (const s of ['fort', 'ref', 'will']) {
                const good = String(info[s] || '').toLowerCase() === 'good';
                if (good) anyGood[s] = true;
                sixths[s] += lvl * (good ? 3 : 2);
            }
        }
        const saves = {};
        for (const s of ['fort', 'ref', 'will']) {
            saves[s] = Math.floor(sixths[s] / 6) + (anyGood[s] ? 2 : 0);
        }
        return { bab: Math.floor(babQuarters / 4), saves };
    }
    /** BAB for external read sites (touch attacks, @attributes.bab.total): fractional
     *  when the variant is on, else the backend's bab_total. */
    function babTotal(data) {
        const frac = fractionalBases(data);
        return frac ? frac.bab : (Number(data?.bab_total) || 0);
    }
    /** Bucket AC parts into per-bonus-type totals for the Defenses grid. */
    function acTypeTotals(parts) {
        const order = ['Armor', 'Shield', 'Deflection', 'Dodge', 'Natural Armor',
            'Enhancement', 'Insight', 'Luck', 'Profane', 'Sacred', 'Trait', 'Other'];
        const typeMap = {
            armor: 'Armor', shield: 'Shield', deflect: 'Deflection', dodge: 'Dodge',
            nac: 'Natural Armor', enh: 'Enhancement', insight: 'Insight', luck: 'Luck',
            profane: 'Profane', sacred: 'Sacred', trait: 'Trait',
        };
        const buckets = new Map(order.map((k) => [k, { total: 0, sources: [] }]));
        for (const p of parts || []) {
            if (p.info || p.unresolved) continue;
            let bucket = null;
            if (p.kind === 'gear') {
                bucket = /^Shield/.test(p.label) ? 'Shield'
                    : (/^Armor/.test(p.label) ? 'Armor' : null);
            } else if (p.kind === 'ledger' || p.kind === 'manual') {
                bucket = typeMap[p.type] || 'Other';
            }
            if (!bucket) continue; // Base 10 / Dex are not bonuses
            const b = buckets.get(bucket);
            b.total += Number(p.value) || 0;
            b.sources.push(p.label + ' ' + fmt(Number(p.value) || 0));
        }
        return order.map((label) => ({ label, ...buckets.get(label) }));
    }
    /** Bucket a save block's parts: Base / Abl / Enhance / Resist / Feat / Trait / Misc / Temp. */
    function saveBuckets(block) {
        const out = { base: 0, ability: 0, enh: 0, resist: 0,
            feat: 0, trait: 0, misc: 0, temp: 0 };
        for (const p of block?.parts || []) {
            if (p.info || p.unresolved) continue;
            const v = Number(p.value) || 0;
            if (p.kind === 'base') out.base += v;
            else if (p.kind === 'ability') out.ability += v;
            else if (p.kind === 'manual' || p.sourceKind === 'buff') out.temp += v;
            else if (p.type === 'enh') out.enh += v;
            else if (p.type === 'resist') out.resist += v;
            else if (p.sourceKind === 'feat') out.feat += v;
            else if (p.sourceKind === 'trait') out.trait += v;
            else out.misc += v;
        }
        return out;
    }
    /**
     * SR = editable base (seeded from the generator) + feat/trait/class/misc boxes + anything
     * in the changes ledger targeting `spellResist`.
     *
     * The ledger term arrived with #78: a celestial/fiendish/entropic/resolute template's ONE
     * numeric defensive part is its SR, and without this it would sit visibly in the buff and
     * silently do nothing to the number on Defenses. Same treatment every other ledger target
     * already gets.
     */
    function srTotal(data) {
        const st = sheetState(data);
        const b = st.srBonus || {};
        let ledger = 0;
        for (const c of (effectiveLedger(data).changes || [])) {
            if (c?.target !== 'spellResist') continue;
            const r = window.SheetFormula?.evaluate?.(c.formula, data);
            if (r?.ok) ledger += Number(r.value) || 0;
        }
        return (Number(st.sr) || 0) + (Number(b.feat) || 0) + (Number(b.trait) || 0)
            + (Number(b.class) || 0) + (Number(b.misc) || 0) + ledger;
    }
    /** Iterative attack string from BAB: "+11/+6/+1" (max 4 attacks, PF1-style). */
    function babIterativesStr(bab) {
        const b = Number(bab) || 0;
        const parts = [fmt(b)];
        for (let a = b - 5; a > 0 && parts.length < 4; a -= 5) parts.push(fmt(a));
        return parts.join('/');
    }

    return {
        part, sumParts, appendLedgerParts, abilityInfo, abModOf, effectiveLedger,
        groupChangesBySource, computeDerived, combatStats, carryLimits, loadCategory,
        castingAbilityMod, totalLevel, casterLevelValue, spellSaveDC, concentrationBonus,
        acTypeTotals, saveBuckets, srTotal, babIterativesStr, GOOD_SAVES,
        fractionalBases, babTotal,
        totalHD, sizeInfo, grantedDefenses, conditionFlags, encumbrance, carriedWeightLbs, loadReducedSpeed,
    };
})();
