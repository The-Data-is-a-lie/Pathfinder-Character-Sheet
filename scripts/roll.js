// Tools drawer + shared combat rolls: freeform dice, weapon attacks, Foundry-style conditionals.
// Results stay on-page (roll log); this is a standalone sheet, not Foundry chat.

window.SheetRoll = (function () {
    'use strict';

    const TOOLS_OPEN_KEY = 'sheet.toolsOpen';
    const TOOLS_WIDTH_KEY = 'sheet.toolsWidth';
    const TOOLS_SECTIONS_KEY = 'sheet.toolsSectionsCollapsed';
    const LOG_MAX = 50;
    const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100];

    let currentData = null;
    /** @type {Array} */
    let availableConditionals = [];
    /** id -> boolean (session; seeded from defaults + optional _sheet.conditionalPrefs) */
    const activeConditionals = new Map();
    const history = [];
    let nextLogId = 1;

    // ---------------------------------------------------------------- tiny DOM
    function h(tag, cls, content) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (content !== undefined && content !== null) {
            if (content instanceof Node) el.appendChild(content);
            else el.textContent = String(content);
        }
        return el;
    }

    const fmt = (n) => (n >= 0 ? '+' + n : String(n));
    const mod = (score) => Math.floor((Number(score) - 10) / 2);

    // ---------------------------------------------------------------- dice engine
    function randomInt(min, max) {
        const span = max - min + 1;
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const buf = new Uint32Array(1);
            const limit = Math.floor(0x100000000 / span) * span;
            let x;
            do {
                crypto.getRandomValues(buf);
                x = buf[0];
            } while (x >= limit);
            return min + (x % span);
        }
        return min + Math.floor(Math.random() * span);
    }

    function normalizeInput(raw) {
        let s = String(raw || '').trim();
        s = s.replace(/^\/r(?:oll)?\s+/i, '');
        return s.trim();
    }

    function parseFormula(input) {
        const s = normalizeInput(input);
        if (!s) return { ok: false, error: 'Enter a formula (e.g. d20 or 2d6+3)' };

        const re = /([+-])?\s*(?:(\d*)d(\d+)|(\d+))/gi;
        const terms = [];
        let last = 0;
        let m;
        while ((m = re.exec(s)) !== null) {
            const gap = s.slice(last, m.index).replace(/\s+/g, '');
            if (gap) return { ok: false, error: 'Invalid formula: ' + s };
            last = re.lastIndex;

            const sign = m[1] === '-' ? -1 : 1;
            if (m[3] !== undefined) {
                const n = m[2] === '' ? 1 : parseInt(m[2], 10);
                const sides = parseInt(m[3], 10);
                if (!Number.isFinite(n) || n < 1 || n > 999) {
                    return { ok: false, error: 'Die count must be 1–999' };
                }
                if (!Number.isFinite(sides) || sides < 1 || sides > 10000) {
                    return { ok: false, error: 'Die size must be 1–10000' };
                }
                terms.push({ type: 'dice', n, sides, sign });
            } else {
                terms.push({ type: 'flat', value: sign * parseInt(m[4], 10) });
            }
        }
        if (!terms.length || last < s.replace(/\s+$/, '').length) {
            return { ok: false, error: 'Invalid formula: ' + s };
        }
        let formula = '';
        for (let i = 0; i < terms.length; i++) {
            const t = terms[i];
            if (t.type === 'dice') {
                const body = (t.n === 1 ? '' : t.n) + 'd' + t.sides;
                if (i === 0) formula += (t.sign < 0 ? '-' : '') + body;
                else formula += (t.sign < 0 ? '-' : '+') + body;
            } else {
                if (i === 0) formula += String(t.value);
                else formula += (t.value >= 0 ? '+' : '') + t.value;
            }
        }
        return { ok: true, terms, formula };
    }

    function rollTerms(terms) {
        const parts = [];
        let total = 0;
        for (const t of terms) {
            if (t.type === 'dice') {
                const rolls = [];
                for (let i = 0; i < t.n; i++) rolls.push(randomInt(1, t.sides));
                const sum = rolls.reduce((a, b) => a + b, 0) * (t.sign < 0 ? -1 : 1);
                total += sum;
                const label = (t.n === 1 ? '' : t.n) + 'd' + t.sides;
                parts.push({
                    kind: 'dice',
                    label: (t.sign < 0 ? '-' : '') + label,
                    rolls,
                    subtotal: sum,
                });
            } else {
                total += t.value;
                parts.push({ kind: 'flat', label: fmt(t.value), value: t.value });
            }
        }
        return { total, parts };
    }

    function roll(input) {
        const parsed = parseFormula(input);
        if (!parsed.ok) return parsed;
        const { total, parts } = rollTerms(parsed.terms);
        const detail = parts.map((p) => {
            if (p.kind === 'dice') {
                const shown = p.rolls.length === 1 ? String(p.rolls[0]) : '[' + p.rolls.join(', ') + ']';
                return p.label + ':' + shown;
            }
            return p.label;
        }).join(' ');
        return { ok: true, formula: parsed.formula, total, parts, detail };
    }

    /**
     * Resolve a Foundry formula down to the `±NdS±N` shape parseFormula understands, reporting
     * anything it could not follow.
     *
     * Prefer this over cleanFormula(): it delegates to SheetFormula, so `@classes.x.level`,
     * `floor()/min()/ifelse()` and computed dice counts (`(floor(@classes.magus.level / 3))d6`) all
     * resolve, and an unknown `@token` comes back in `unresolved` instead of silently becoming 0.
     */
    function cleanFormulaSafe(formula, data) {
        const F = window.SheetFormula;
        const ctx = { INITMOD: initiationMod(data) };
        if (!F) return { formula: cleanFormula(formula, data), unresolved: [] };
        const r = F.evaluateToRollable(formula, data, ctx);
        if (r.ok) return { formula: r.formula, unresolved: r.unresolved };
        return { formula: '', unresolved: r.unresolved, error: r.error };
    }

    /**
     * Legacy formula cleaner: same bare-string signature it always had, so existing callers are
     * unaffected. It now resolves through SheetFormula first and only falls back to the old
     * zero-every-unknown-@token behaviour when that fails — the fallback is what keeps a formula the
     * evaluator can't express (e.g. `1d4 * @abilities.cha.mod`, which Foundry rolls then multiplies)
     * degrading exactly as it did before rather than becoming an empty string.
     */
    function cleanFormula(formula, data) {
        const F = window.SheetFormula;
        if (F) {
            const r = F.evaluateToRollable(formula, data, { INITMOD: initiationMod(data) });
            if (r.ok && !r.unresolved.length) return r.formula;
        }
        let s = String(formula || '').trim();
        // Remove [label] flavor tags
        s = s.replace(/\[[^\]]*\]/g, '');
        const init = initiationMod(data);
        s = s.replace(/@INITMOD/gi, String(init));
        // Drop leftover @ references we can't evaluate — treat as 0 if whole token
        s = s.replace(/@[a-zA-Z0-9_.]+/g, '0');
        s = s.replace(/\s+/g, '');
        return s;
    }

    function initiationMod(data) {
        if (!data) return 0;
        const key = String(data.initiation_stat || '').toLowerCase();
        if (key && data[key] != null) return mod(data[key]);
        // highest mental
        return Math.max(mod(data.int), mod(data.wis), mod(data.cha));
    }

    /**
     * Expand Foundry spell formulas for rolling: @cl, @sl, @ablMod, ability mods, then the
     * arithmetic around them, so parseFormula can handle the result.
     *
     * Delegates to SheetFormula, which handles nested functions and non-literal arguments the old
     * regex pass could not (`min(10, floor((@cl + 1) / 2))`). Falls back to the original expander
     * when the evaluator can't resolve the whole formula, so a spell that rolled before still rolls
     * — spell casting stays deliberately lenient about unknown `@tokens` where the per-roll
     * conditionals are strict, because a half-resolved damage formula still beats no damage roll.
     */
    function expandSpellFormula(formula, ctx) {
        const F = window.SheetFormula;
        if (F) {
            const r = F.evaluateToRollable(formula, ctx?.data, {
                cl: Number(ctx?.cl) || 0,
                sl: Number(ctx?.sl) || 0,
                ablMod: Number(ctx?.ablMod) || 0,
                INITMOD: initiationMod(ctx?.data),
            });
            if (r.ok && !r.unresolved.length) return r.formula;
            if (r.unresolved.length) {
                console.warn('expandSpellFormula: unresolved', r.unresolved, 'in', formula);
            }
        }
        return expandSpellFormulaLegacy(formula, ctx);
    }

    function expandSpellFormulaLegacy(formula, ctx) {
        let s = String(formula || '').trim();
        if (!s) return '';
        s = s.replace(/\[[^\]]*\]/g, '');
        const cl = Number(ctx.cl) || 0;
        const sl = Number(ctx.sl) || 0;
        const abl = Number(ctx.ablMod) || 0;
        const data = ctx.data;
        s = s.replace(/@cl\b/gi, String(cl));
        s = s.replace(/@sl\b/gi, String(sl));
        s = s.replace(/@ablMod\b/gi, String(abl));
        s = s.replace(/@abilities\.([a-z]+)\.mod\b/gi, (_, ab) => String(abilityMod(data, ab)));
        s = s.replace(/@abilities\.([a-z]+)\.total\b/gi, (_, ab) => {
            const k = String(ab).toLowerCase();
            return String(data?.[k] != null ? Number(data[k]) || 0 : 0);
        });
        // Nested min/max of numeric args (Fireball: min(10,@cl))
        let prev;
        do {
            prev = s;
            s = s.replace(/min\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/gi,
                (_, a, b) => String(Math.min(Number(a), Number(b))));
            s = s.replace(/max\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/gi,
                (_, a, b) => String(Math.max(Number(a), Number(b))));
        } while (s !== prev);
        s = s.replace(/\((-?\d+)\)\s*d/gi, '$1d');
        s = s.replace(/\((-?\d+)\)/g, '$1');
        s = s.replace(/@[a-zA-Z0-9_.]+/g, '0');
        s = s.replace(/\s+/g, '');
        return s;
    }

    function isSpellAttackType(t) {
        const s = String(t || '').toLowerCase();
        return s === 'rsak' || s === 'msak' || s === 'twak' || s === 'rwak' || s === 'mwak'
            || s === 'rcman' || s === 'mcman';
    }

    /**
     * Foundry-style spell cast → roll log card (attack / damage / save DC).
     * @param {{ name, level, data, spellData, castingAbility, castingMod, casterLevel, saveDC, concentration, bab }} opts
     */
    function rollSpellCast(opts = {}) {
        const name = opts.name || 'Spell';
        const level = Number(opts.level) || 0;
        const data = opts.data || currentData;
        const sd = opts.spellData || {};
        const castMod = Number(opts.castingMod) || 0;
        const cl = Number(opts.casterLevel) || 1;
        const bab = Number(opts.bab) || 0;
        const saveDC = opts.saveDC != null ? Number(opts.saveDC) : (10 + level + castMod);
        const act = (sd.actions && sd.actions[0]) || {};
        const actionType = act.actionType || '';
        const ctx = { cl, sl: level, ablMod: castMod, data };

        const school = sd.school
            ? ({ abj: 'Abjuration', con: 'Conjuration', div: 'Divination', enc: 'Enchantment',
                evo: 'Evocation', ill: 'Illusion', nec: 'Necromancy', trs: 'Transmutation',
                uni: 'Universal' }[sd.school] || sd.school)
            : '';

        const attacks = [];
        const damages = [];
        const riders = [];

        // A Quickened cast is a swift action — the roll proves it, so spend the slot (#19).
        if (opts.metamagic?.names?.includes('Quicken Spell') && (data === currentData)) {
            const spent = autoSpendSwift('Quickened cast');
            if (spent) riders.push(spent);
        }

        if (isSpellAttackType(actionType)) {
            const atkAbKey = String(act.ability?.attack || opts.castingAbility || 'int').toLowerCase();
            const atkAbMod = abilityMod(data, atkAbKey);
            // PF1 spell attack: BAB + casting (or specified) ability mod
            const bonus = bab + atkAbMod;
            const natural = randomInt(1, 20);
            const total = natural + bonus;
            attacks.push({
                label: actionType === 'msak' || actionType === 'mwak' ? 'Melee touch' : 'Ranged touch',
                natural,
                total,
                bonus,
                critRange: 20,
                threatened: natural >= 20,
                confirm: null,
                bonusLines: [
                    { label: 'BAB', value: bab },
                    { label: atkAbKey.toUpperCase(), value: atkAbMod },
                ],
                conditionals: [],
            });
        }

        const mm = opts.metamagic || null;
        const dmgPartsRaw = act.damage?.parts || [];
        if (dmgPartsRaw.length) {
            let dmgTotal = 0;
            const parts = [];
            let diceFlavor = '';
            for (const p of dmgPartsRaw) {
                const expanded = expandSpellFormula(p.formula, ctx);
                const types = (p.type?.values || []).join(', ');
                const parsed = parseFormula(expanded);
                if (!parsed.ok) {
                    parts.push({
                        label: (p.formula || '?') + (types ? ' ' + types : ''),
                        detail: expanded || '(unparsed)',
                        value: 0,
                    });
                    continue;
                }
                const r = rollTerms(parsed.terms);
                // Metamagic damage math (pf1 RAW): Maximize = every die at max; Empower =
                // ×1.5 the rolled result; both = maximized + half the ROLLED total.
                let value = r.total;
                let mmTag = '';
                if (mm?.maximize) {
                    const maxed = r.parts.reduce((sum, x) => {
                        if (x.kind !== 'dice') return sum + (Number(x.value) || 0);
                        const sides = Number((x.label.match(/d(\d+)/) || [])[1]) || 0;
                        return sum + (x.label.startsWith('-') ? -1 : 1) * x.rolls.length * sides;
                    }, 0);
                    value = maxed + (mm.empower ? Math.floor(r.total / 2) : 0);
                    mmTag = mm.empower ? ' (max+emp)' : ' (maximized)';
                } else if (mm?.empower) {
                    value = Math.floor(r.total * 1.5);
                    mmTag = ' (empowered)';
                }
                dmgTotal += value;
                const rolls = r.parts.filter((x) => x.kind === 'dice').flatMap((x) => x.rolls);
                const shown = rolls.length ? '[' + rolls.join(', ') + ']' : String(r.total);
                parts.push({
                    label: (parsed.formula || expanded) + (types ? ' ' + types : '') + mmTag,
                    detail: shown + ' → ' + value,
                    value,
                });
                if (!diceFlavor) diceFlavor = parsed.formula + shown;
            }
            damages.push({
                total: dmgTotal,
                diceTotal: dmgTotal,
                flat: 0,
                critMult: 1,
                diceFlavor,
                parts,
                conditionals: [],
                // Cure spells carry actionType 'heal' in spell_details.json — the block
                // renders an Apply-healing button instead of the damage buttons (#20).
                isHeal: actionType === 'heal',
            });
        }

        // Save / meta riders (always show DC when save or spellsave)
        const metaBits = [];
        if (act.save?.type || actionType === 'spellsave' || actionType === 'save') {
            const saveLab = act.save?.description || act.save?.type || 'Save';
            metaBits.push(`Save: ${saveLab} · DC ${saveDC}`);
        }
        if (act.range?.units) {
            metaBits.push(`Range: ${act.range.value ?? ''} ${act.range.units}`.trim());
        }
        if (act.duration?.units) {
            const dur = expandSpellFormula(String(act.duration.value || ''), ctx)
                || act.duration.value || '';
            metaBits.push(`Duration: ${dur} ${act.duration.units}`.trim());
        }
        if (act.measureTemplate?.type) {
            metaBits.push(`Area: ${act.measureTemplate.type}${act.measureTemplate.size ? ' ' + act.measureTemplate.size : ''}`);
        }
        metaBits.push(`CL ${cl}`);
        metaBits.push(`Concentration ${fmt(Number(opts.concentration) || (cl + castMod))}`);

        riders.push({
            source: 'Spell',
            text: metaBits.join(' · '),
        });
        if (mm?.names?.length) {
            riders.push({
                source: 'Metamagic',
                text: mm.names.join(', ')
                    + (mm.slotLevel != null && mm.slotLevel !== level
                        ? ` — cast from a level ${mm.slotLevel} slot` : ''),
            });
        }

        // If nothing mechanical rolled, still log a "cast" card with riders
        pushRollCard({
            title: name,
            subtitle: [
                'Spell L' + level,
                school,
                mm?.names?.length ? 'Metamagic' : null,
                actionType || null,
            ].filter(Boolean).join(' · '),
            attacks,
            damages,
            riders,
            // Full spell text (UUID links already enriched by the caller) so it's easy
            // to read what the spell does right after casting.
            descHtml: opts.descHtml || '',
        });
    }

    // ---------------------------------------------------------------- character attack math
    function abilityMod(data, ab) {
        if (!data || !ab) return 0;
        const key = String(ab).toLowerCase();
        if (data[key] == null) return 0;
        return mod(data[key]);
    }

    function parseEnhancementBonus(list) {
        if (!Array.isArray(list)) return 0;
        let best = 0;
        for (const raw of list) {
            const m = String(raw).match(/^\s*\+(\d+)\b/);
            if (m) best = Math.max(best, parseInt(m[1], 10));
        }
        return best;
    }

    /**
     * @param {string[]} targets
     * @param {'initial'|'confirm'|null} phase which attack d20 to sum for. A change's `appliesOn`
     *   is 'both' unless the user narrowed it, so standing bonuses keep reaching both rolls;
     *   pass null (non-attack sums like AC) to ignore phase entirely.
     */
    function sumNumericChanges(targets, phase = null) {
        // window.sheetChanges is already filtered by per-buff toggles (effectiveLedger)
        const ledger = window.sheetChanges;
        if (!ledger?.changes?.length) return { total: 0, bits: [] };
        const want = new Set(targets);
        let total = 0;
        const bits = [];
        for (const c of ledger.changes) {
            if (!want.has(c.target)) continue;
            if (phase) {
                const on = c.appliesOn || 'both';
                if (on !== 'both' && on !== phase) continue;
            }
            const f = String(c.formula).trim();
            if (!/^[+-]?\d+$/.test(f)) continue;
            const n = Number(f);
            total += n;
            bits.push({ source: c.source, value: n, target: c.target });
        }
        return { total, bits };
    }

    // Free procedural dice-roll SFX (Web Audio — no asset file / license).
    let audioCtx = null;
    function playDiceSound() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            audioCtx ||= new AC();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const ctx = audioCtx;
            const now = ctx.currentTime;
            // Short noise burst + a few pitched "clacks" for a generic dice rattle
            const dur = 0.28;
            const bufferSize = Math.floor(ctx.sampleRate * dur);
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                const t = i / bufferSize;
                const env = Math.pow(1 - t, 2.2);
                data[i] = (Math.random() * 2 - 1) * env * 0.55;
            }
            const noise = ctx.createBufferSource();
            noise.buffer = buffer;
            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 1200;
            filter.Q.value = 0.8;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.35, now + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            noise.start(now);
            noise.stop(now + dur + 0.02);

            // 3 wooden-ish ticks
            for (let k = 0; k < 3; k++) {
                const t0 = now + 0.02 + k * 0.055;
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(180 + k * 40 + Math.random() * 30, t0);
                osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.06);
                g.gain.setValueAtTime(0.0001, t0);
                g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.008);
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
                osc.connect(g);
                g.connect(ctx.destination);
                osc.start(t0);
                osc.stop(t0 + 0.08);
            }
        } catch {
            /* audio blocked or unsupported — silent ok */
        }
    }

    function rollAndLog(formula, title) {
        const result = roll(formula);
        if (!result.ok) {
            pushLog(title || formula, result.error || 'Invalid roll', null, { sound: false });
            return result;
        }
        pushLog(title || ('/roll ' + result.formula), result.detail, result.total);
        return result;
    }

    function iterativeCount(bab) {
        const b = Math.max(0, Number(bab) || 0);
        return Math.min(4, 1 + Math.floor(Math.max(0, b - 1) / 5));
    }

    function isRangedAction(actionType) {
        return actionType === 'rwak' || actionType === 'rsak' || actionType === 'twak';
    }

    function weaponLabel(data) {
        const name = (data?.weapon_name || '').trim();
        if (!name) return null;
        const enh = data.weapon_enhancement_chosen_list;
        return name + (Array.isArray(enh) && enh.length ? ' [' + enh.join(', ') + ']' : '');
    }

    /** Static weapon damage formula (no conditionals), e.g. "1d8+5" or "1d6". */
    function formatDamageFormula(dice, flat) {
        const d = (dice || '').trim();
        const n = Number(flat) || 0;
        if (!d && !n) return '';
        if (!d) return fmt(n);
        if (!n) return d;
        return d + (n >= 0 ? '+' : '') + n;
    }

    /** Inventory item by id. equipment_list is object-normalized by ensureInventoryObjects
     *  on every render, so a plain id scan is enough here. */
    function findInventoryItem(data, itemKey) {
        if (!data || !itemKey) return null;
        for (const it of data.equipment_list || []) {
            if (it && typeof it === 'object' && it.id === itemKey) return it;
        }
        return null;
    }

    /** Equipped inventory weapons, in list order. */
    function equippedWeapons(data) {
        if (!data) return [];
        const list = window.SheetState?.ensureInventoryObjects?.(data) || data.equipment_list || [];
        const cat = window.SheetInventoryModel?.inventoryCategory;
        return list.filter((it) => it && typeof it === 'object' && it.equipped !== false
            && (!cat || cat(it) === 'weapons'));
    }

    /** "Longsword [+1, flaming]" → "Longsword" (compendium lookups want the base name). */
    function stripEnhSuffix(name) {
        return String(name || '').replace(/\s*\[[^\]]+\]\s*$/, '').trim();
    }

    /**
     * How the weapon is held, for Power Attack's damage multiplier: 'two' | 'one' | 'light'.
     * The item sheet's per-item override (`item.weapon.grip`) wins; otherwise the curated
     * two-handed list decides by base name; anything unlisted counts as one-handed.
     * 'offhand' is never returned here — off-hand is a property of the attack (a TWF routine
     * line), not the weapon, and the routine roller passes it explicitly.
     */
    function weaponGrip(ctx) {
        const ov = ctx?.item?.weapon?.grip;
        if (ov === 'two' || ov === 'one' || ov === 'light') return ov;
        const base = stripEnhSuffix(ctx?.wName).toLowerCase();
        return window.SheetData?.TWO_HANDED_WEAPONS?.has(base) ? 'two' : 'one';
    }

    /** Merged roll stats for an inventory weapon: compendium base (by name minus the
     *  enhancement suffix) under the item sheet's per-item overrides (item.weapon) —
     *  the same merge the item sheet's Details tab edits against (modals.js). */
    function itemWeaponStats(item) {
        const wBase = window.SheetDetails?.lookupWeapon?.(stripEnhSuffix(item?.name));
        if (!wBase && !item?.weapon) return null;
        return { ...(wBase || {}), ...(item.weapon || {}) };
    }

    /**
     * Attack math for one weapon. `itemKey` picks an inventory weapon (per-row rolls and
     * routine lines pass it); omitted, the active weapon — the picker selection when set,
     * else the generated weapon_name — is used, which is the old single-weapon behaviour.
     */
    function attackContext(data, itemKey) {
        if (!data || data.error) return null;
        const bab = Number(data.bab_total) || 0;
        const strM = abilityMod(data, 'str');
        const dexM = abilityMod(data, 'dex');
        const key = itemKey !== undefined ? itemKey : activeWeaponItemKey(data);
        const item = key ? findInventoryItem(data, key) : null;
        let enh, wName, wStats, label;
        if (item) {
            wName = stripEnhSuffix(item.name);
            wStats = itemWeaponStats(item);
            enh = parseEnhancementBonus(window.SheetDetails?.parseEnhancements?.(item.name) || []);
            label = item.name;
        } else {
            // Legacy path: unmigrated core gear only exists as weapon_name + enhancement list.
            enh = parseEnhancementBonus(data.weapon_enhancement_chosen_list);
            wName = (data.weapon_name || '').trim();
            wStats = wName ? (window.SheetDetails?.lookupWeapon(wName) || null) : null;
            label = weaponLabel(data);
        }
        const ranged = wStats ? isRangedAction(wStats.actionType) : false;
        const abKey = ranged ? 'dex' : 'str';
        const abMod = ranged ? dexM : strM;
        const dmgAbKey = (wStats?.damageAbility || 'str').toLowerCase();
        const dmgAbMod = abilityMod(data, dmgAbKey);
        // Size: attack modifier + damage-dice step (compendium dice are Medium).
        const size = window.SheetDerive?.sizeInfo?.(data) || { mod: 0, steps: 0, label: 'Medium' };
        const atkTargets = ranged ? ['attack', 'rattack'] : ['attack', 'mattack'];
        const dmgTargets = ranged ? ['damage', 'rdamage', 'wdamage'] : ['damage', 'mdamage', 'wdamage'];
        const atkChanges = sumNumericChanges(atkTargets, 'initial');
        // The confirm-phase deltas: what a 'confirm'-only change adds on top of, and what an
        // 'initial'-only change withholds from, the confirmation roll.
        const atkChangesConfirm = sumNumericChanges(atkTargets, 'confirm');
        const dmgChanges = sumNumericChanges(dmgTargets);
        const meleeBonus = bab + strM + size.mod + sumNumericChanges(['attack', 'mattack'], 'initial').total;
        const rangedBonus = bab + dexM + size.mod + sumNumericChanges(['attack', 'rattack'], 'initial').total;
        const meleeBonusConfirm = bab + strM + size.mod + sumNumericChanges(['attack', 'mattack'], 'confirm').total;
        const rangedBonusConfirm = bab + dexM + size.mod + sumNumericChanges(['attack', 'rattack'], 'confirm').total;
        const weaponBonus = bab + abMod + enh + size.mod + atkChanges.total;
        const weaponBonusConfirm = bab + abMod + enh + size.mod + atkChangesConfirm.total;
        const damageFlat = dmgAbMod + enh + dmgChanges.total;
        const stepDice = (d) => (d && size.steps
            ? (window.SheetData?.stepDice?.(d, size.steps) ?? d) : d);
        const damageDice = stepDice(wStats?.dice || '');
        // Multi-part damage (holy longsword: slashing + good dice) — step each part too.
        if (wStats?.parts?.length && size.steps) {
            wStats = { ...wStats, parts: wStats.parts.map((p) => ({ ...p, dice: stepDice(p.dice) })) };
        }
        if (wStats && size.steps && wStats.dice) wStats = { ...wStats, dice: damageDice };
        const damageFormula = formatDamageFormula(damageDice, damageFlat);

        return {
            bab, strM, dexM, enh, wName, wStats, ranged, abKey, abMod,
            dmgAbKey, dmgAbMod, damageFlat, damageDice, damageFormula,
            atkChanges, dmgChanges, atkChangesConfirm,
            weaponBonusConfirm, meleeBonusConfirm, rangedBonusConfirm,
            meleeBonus, rangedBonus, weaponBonus,
            size,
            itemKey: key || null,
            item,
            label,
            iters: iterativeCount(bab),
        };
    }

    // ---------------------------------------------------------------- conditionals
    function isAttackTarget(t) {
        const s = String(t || '').toLowerCase();
        return s === 'attack' || s === 'mattack' || s === 'rattack' || s === 'allattack'
            || s.endsWith('attack');
    }

    function isDamageTarget(t) {
        const s = String(t || '').toLowerCase();
        return s === 'damage' || s === 'mdamage' || s === 'rdamage' || s === 'wdamage'
            || s === 'alldamage' || s.endsWith('damage');
    }

    /**
     * Inventory id of the weapon the roller is currently on. Enhancement conditionals are tagged
     * with the item that carries them, and this is what they get matched against.
     *
     * Priority: the weapon picker's selection (`_sheet.activeWeaponKey`, ignored once the item is
     * gone or unequipped) → the generated weapon_name → the first equipped inventory weapon.
     * Per-row rolls and routine lines bypass this entirely via an explicit `itemKey`.
     */
    function activeWeaponItemKey(data) {
        const d = data || currentData;
        if (!d) return null;
        const sel = d._sheet?.activeWeaponKey;
        if (sel) {
            const it = findInventoryItem(d, sel);
            if (it && it.equipped !== false) return sel;
        }
        const nm = String(d?.weapon_name || '').trim();
        if (nm) return window.SheetDetails?.coreGearItemKey?.(d, nm) || null;
        const ws = equippedWeapons(d);
        return ws.length ? ws[0].id : null;
    }

    function activeList() {
        return availableConditionals.filter((c) => activeConditionals.get(c.id));
    }

    /**
     * Conditionals that apply to the weapon being rolled. An entry with no `itemKey` (feats,
     * stances, spells, class features) is weapon-independent and always applies; the filter is
     * opt-in, so only the enhancement entries are ever narrowed. The sentinel `'none'` means
     * "no weapon at all" (natural-attack lines): every item-tagged entry is excluded.
     */
    function scopedList(itemKey) {
        const key = itemKey === undefined ? activeWeaponItemKey() : itemKey;
        if (key === 'none') return activeList().filter((c) => !c.itemKey);
        return activeList().filter((c) => !c.itemKey || !key || c.itemKey === key);
    }

    /**
     * Evaluate checked conditionals for attack or damage.
     *
     * pf1 splits an ATTACK modifier by its `critical` field: `normal` parts belong to the initial
     * attack roll only, `crit` parts to the critical-confirmation roll only. That is why the
     * curated data gives a standing to-hit bonus a `crit` TWIN rather than one entry covering both
     * rolls — so evaluating every modifier on the initial d20 both double-counts the twins and
     * fires confirm-only feats (Object Of Legend, Desperate Swing, …) on the wrong roll.
     *
     * @param {'attack'|'damage'} kind
     * @param {{ isCrit?: boolean, phase?: 'normal'|'crit', itemKey?: string|null }} opts
     *   `itemKey` overrides which weapon's enhancement conditionals count; omit it to use the
     *   weapon the roller is on. Pass `null` to include every weapon's qualities.
     *   `isCrit` filters damage (existing behaviour); `phase` picks which attack d20 is being
     *   rolled. A missing/unknown `critical` counts as `normal`, as the damage branch already
     *   assumes; `nonCrit` is a damage concept and falls in the initial bucket on attacks.
     *   `ranged` (boolean) scopes melee-only (mattack/mdamage) and ranged-only
     *   (rattack/rdamage) modifiers to the roll actually being made — omitted = no filter,
     *   preserving old behaviour for callers without a weapon context. `grip`
     *   ('two'|'one'|'light'|'offhand') drives the `gripScale` damage adjustment
     *   (Power Attack: ×1.5 two-handed, ×0.5 off-hand, PF1 round-down).
     */
    function evaluateConditionals(kind, opts = {}) {
        const data = currentData;
        let flat = 0;
        const bits = [];
        const diceParts = []; // { formula, source, rolled? }
        const riders = [];
        const gripScaled = (m, n) => {
            if (!m.gripScale || kind !== 'damage') return { value: n, note: '' };
            if (opts.grip === 'two') return { value: Math.floor(n * 1.5), note: ' (two-handed ×1.5)' };
            if (opts.grip === 'offhand') return { value: Math.floor(n * 0.5), note: ' (off-hand ×0.5)' };
            return { value: n, note: '' };
        };

        for (const cond of scopedList(opts.itemKey)) {
            if (cond.rider) riders.push({ source: cond.source, text: cond.rider });
            for (const m of cond.modifiers || []) {
                const tgt = m.subTarget || m.target || '';
                const isAtk = isAttackTarget(tgt) || (m.target === 'attack');
                const isDmg = isDamageTarget(tgt) || (m.target === 'damage');
                if (kind === 'attack' && !isAtk) continue;
                if (kind === 'damage' && !isDmg) continue;
                if (typeof opts.ranged === 'boolean') {
                    const t = String(tgt).toLowerCase();
                    if (opts.ranged && (t === 'mattack' || t === 'mdamage')) continue;
                    if (!opts.ranged && (t === 'rattack' || t === 'rdamage')) continue;
                }

                const crit = String(m.critical || 'normal');
                if (kind === 'damage') {
                    if (crit === 'crit' && !opts.isCrit) continue;
                    if (crit === 'nonCrit' && opts.isCrit) continue;
                } else if (kind === 'attack') {
                    // Confirmation roll takes the crit-flagged parts and nothing else; the
                    // initial roll takes everything else.
                    if (opts.phase === 'crit') { if (crit !== 'crit') continue; }
                    else if (crit === 'crit') continue;
                }

                const resolved = cleanFormulaSafe(m.formula, data);
                const formula = resolved.formula;
                if (!formula) {
                    // Show the reference we couldn't follow rather than dropping the modifier: a
                    // conditional that quietly contributes nothing is indistinguishable from one
                    // that works, and the whole point of checking the box is to see its effect.
                    if (resolved.unresolved?.length || resolved.error) {
                        bits.push({ source: cond.source, value: 0,
                            formula: String(m.formula) + (resolved.unresolved?.length
                                ? ' (unresolved ' + resolved.unresolved.join(', ') + ')'
                                : ' (unparsed)') });
                    }
                    continue;
                }
                // Integer only?
                if (/^[+-]?\d+$/.test(formula)) {
                    const g = gripScaled(m, Number(formula));
                    flat += g.value;
                    bits.push({ source: cond.source + g.note, value: g.value, formula });
                    continue;
                }
                // Dice or compound — parse if possible
                const parsed = parseFormula(formula);
                if (parsed.ok) {
                    const hasDice = parsed.terms.some((t) => t.type === 'dice');
                    if (!hasDice) {
                        const r = rollTerms(parsed.terms);
                        const g = gripScaled(m, r.total);
                        flat += g.value;
                        bits.push({ source: cond.source + g.note, value: g.value, formula: parsed.formula });
                    } else {
                        diceParts.push({ formula: parsed.formula, terms: parsed.terms, source: cond.source });
                    }
                } else {
                    bits.push({ source: cond.source, value: 0, formula: formula + ' (unparsed)' });
                }
            }
        }
        return { flat, bits, diceParts, riders };
    }

    function rollConditionalDice(diceParts) {
        let total = 0;
        const details = [];
        const parts = []; // { source, total } — per-part, so damage typing can bucket them
        for (const p of diceParts) {
            const r = rollTerms(p.terms);
            total += r.total;
            parts.push({ source: p.source, total: r.total });
            const shown = r.parts.filter((x) => x.kind === 'dice')
                .map((x) => x.label + ':' + (x.rolls.length === 1 ? x.rolls[0] : '[' + x.rolls.join(', ') + ']'))
                .join(' ');
            details.push(`${p.formula} (${p.source}) ${shown || r.total}`);
        }
        return { total, details, parts };
    }

    // ------------------------------------------------- damage typing & mitigation (#4)
    // Damage blocks are TYPED at roll time: the weapon's physical bucket vs energy riders
    // (flaming → fire), plus the DR-bypass context inferred from the rolled weapon. Apply
    // then routes through the Defenses tab automatically, appending the arithmetic to the
    // card. Spell/freeform blocks carry no `typed` and keep the raw Apply path.
    const ENERGY_TYPE_SET = new Set(['acid', 'cold', 'electricity', 'fire', 'sonic',
        'force', 'negative energy', 'positive energy']);
    // Enhancement-quality / rider-source names → the energy type their dice deal.
    const ENERGY_SOURCE_HINTS = [
        [/thunder|sonic/i, 'sonic'],
        [/flam|fire|burn|scorch|blaz/i, 'fire'],
        [/frost|icy|ice\b|cold|freez/i, 'cold'],
        [/shock|lightning|electric/i, 'electricity'],
        [/corros|acid/i, 'acid'],
        [/\bforce\b/i, 'force'],
    ];
    function inferEnergyType(source) {
        const s = String(source || '');
        for (const [re, type] of ENERGY_SOURCE_HINTS) {
            if (re.test(s)) return type;
        }
        return null;
    }

    /**
     * What this weapon's damage overcomes, for DR matching: 'magic' from any enhancement
     * bonus (PF1: +1 or better beats DR/magic), materials from the base name, alignments
     * from the aligned qualities. A missing/unknown weapon returns [] — DR applies in full
     * when the context is absent (the #4 decision).
     */
    function damageBypassFor(ctx) {
        const out = new Set();
        if ((Number(ctx?.enh) || 0) >= 1) out.add('magic');
        const name = String(ctx?.wName || ctx?.item?.name || '').toLowerCase();
        if (/cold iron/.test(name)) out.add('cold iron');
        if (/\bsilver|mithral/.test(name)) out.add('silver');
        if (/adamantine/.test(name)) out.add('adamantine');
        const quals = (name.match(/\[([^\]]+)\]\s*$/)?.[1] || '').split(',');
        for (const q of quals) {
            const t = q.trim().toLowerCase();
            if (t === 'holy') out.add('good');
            if (t === 'unholy') out.add('evil');
            if (t === 'axiomatic') out.add('lawful');
            if (t === 'anarchic') out.add('chaotic');
        }
        return [...out];
    }

    /** One DR entry vs this damage's context. 'or' lists need any part, 'and' lists every
     *  part; DR/— (or blank) is never bypassed. Physical-type DR (DR 5/bludgeoning) is
     *  beaten by the weapon's own damage types. */
    function drBypassed(bypass, typed) {
        const b = String(bypass || '').trim().toLowerCase();
        if (!b || b === '—' || b === '-') return false;
        const anyMode = / or /.test(b);
        const partsList = b.split(/ or | and /).map((s) => s.trim()).filter(Boolean);
        const hit = (p) => (typed.bypass || []).includes(p)
            || (typed.physTypes || []).map((t) => String(t).toLowerCase()).includes(p);
        return anyMode ? partsList.some(hit) : partsList.every(hit);
    }

    /**
     * Route a typed damage block through the Defenses tab: immunity → 0, vulnerability
     * ×1.5, energy resistance per type, the single largest applicable DR against the
     * physical bucket. `half` halves each bucket first (save made). Returns the mitigated
     * total plus human-readable arithmetic for the card.
     */
    function mitigateDamage(dmg, { half = false } = {}) {
        const defs = currentData?._sheet?.defenses || {};
        const t = dmg.typed;
        const steps = [];
        const lower = (list) => (list || []).map((e) => String(e.type || '').toLowerCase());
        const immune = lower(defs.dmgImmune);
        const vuln = lower(defs.dmgVuln);
        let out = 0;

        const bucket = (label, raw, types, isPhys) => {
            let n = half ? Math.floor(raw / 2) : raw;
            if (half && raw) steps.push(`${label} ${raw} → ${n} (half)`);
            if (n <= 0) return;
            const tl = types.map((x) => String(x).toLowerCase());
            if (tl.length && tl.every((x) => immune.includes(x))) {
                steps.push(`immune to ${types.join('/')}: ${n} → 0`);
                return;
            }
            if (tl.some((x) => vuln.includes(x))) {
                const v = Math.floor(n * 1.5);
                steps.push(`vulnerable (${types.join('/')}): ${n} → ${v}`);
                n = v;
            }
            if (isPhys) {
                const applicable = (defs.dr || [])
                    .filter((e) => (Number(e.amount) || 0) > 0 && !drBypassed(e.bypass, t));
                if (applicable.length) {
                    const best = applicable.reduce((a, b) =>
                        ((Number(b.amount) || 0) > (Number(a.amount) || 0) ? b : a));
                    const after = Math.max(0, n - Number(best.amount));
                    steps.push(`DR ${best.amount}/${best.bypass || '—'}: ${n} → ${after}`);
                    n = after;
                } else if ((defs.dr || []).some((e) => (Number(e.amount) || 0) > 0)) {
                    steps.push(`DR bypassed (${(t.bypass || []).join(', ') || 'damage type'})`);
                }
            } else {
                const resist = (defs.resist || [])
                    .filter((e) => tl.includes(String(e.type || '').toLowerCase()))
                    .reduce((a, e) => Math.max(a, Number(e.amount) || 0), 0);
                if (resist > 0) {
                    const after = Math.max(0, n - resist);
                    steps.push(`${types.join('/')} resist ${resist}: ${n} → ${after}`);
                    n = after;
                }
            }
            out += n;
        };

        bucket('physical', t.phys || 0, t.physTypes?.length ? t.physTypes : [], true);
        for (const [etype, amount] of Object.entries(t.energy || {})) {
            bucket(etype, amount, [etype], false);
        }
        return { total: out, steps };
    }

    function expandRiderInlineRolls(text, data) {
        // Replace [[ formula ]] with rolled totals, keeping [[total]] so the
        // log still chips the result (and hover shows the original formula).
        return String(text || '').replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
            const raw = String(inner || '').trim();
            // Some curated riders put PROSE in the roll brackets ("[[ DC 15 ]]", "[[ 15 +
            // enhancement bonus ]]"). Those legitimately fail to parse and must survive as their
            // original text, which is why this returns the raw marker rather than zeroing anything.
            const { formula: f } = cleanFormulaSafe(inner, data);
            const parsed = f ? parseFormula(f) : { ok: false };
            if (!parsed.ok) return '[[' + raw + ']]';
            const r = rollTerms(parsed.terms);
            // [[result¦formula]] — highlightInlineRolls splits on the separator
            return '[[' + r.total + '\u00a6' + (parsed.formula || raw) + ']]';
        });
    }

    const escapeHtml = (s) => String(s).replace(/[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    /**
     * Foundry-style inline rolls: wrap [[formula]] as accent chips so dice
     * expressions scan as hero numbers (typography hierarchy + single accent).
     * Brackets are dropped; formula stays monospace/bold for non-color signal.
     * After expandRiderInlineRolls: [[total¦formula]] shows total, titles formula.
     */
    function highlightInlineRolls(text) {
        const s = String(text || '');
        let out = '';
        let last = 0;
        const re = /\[\[([^\]]+)\]\]/g;
        let m;
        while ((m = re.exec(s)) !== null) {
            out += escapeHtml(s.slice(last, m.index));
            const inner = String(m[1] || '').trim();
            // Expanded form: total + broken-bar + original formula
            const sep = inner.indexOf('\u00a6');
            const display = sep >= 0 ? inner.slice(0, sep).trim() : inner;
            const formula = sep >= 0 ? inner.slice(sep + 1).trim() : inner;
            const title = formula && formula !== display
                ? `Rolled ${display} from ${formula}`
                : `Inline roll: ${display}`;
            out += `<span class="inline-roll" title="${escapeHtml(title)}">`
                + escapeHtml(display)
                + '</span>';
            last = re.lastIndex;
        }
        out += escapeHtml(s.slice(last));
        return out;
    }

    /** Fill a node with text, highlighting any [[inline rolls]]. */
    function setTextWithInlineRolls(el, text) {
        if (!el) return;
        const s = String(text || '');
        if (!/\[\[/.test(s)) {
            el.textContent = s;
            return;
        }
        el.innerHTML = highlightInlineRolls(s);
    }

    function setConditional(id, on) {
        activeConditionals.set(id, !!on);
        if (currentData) {
            (currentData._sheet ??= {}).conditionalPrefs ??= {};
            currentData._sheet.conditionalPrefs[id] = !!on;
        }
        // Keep all panels in sync without full re-render of character
        const esc = (typeof CSS !== 'undefined' && CSS.escape)
            ? CSS.escape(id)
            : String(id).replace(/["\\]/g, '\\$&');
        document.querySelectorAll(`.cond-check[data-cond-id="${esc}"]`).forEach((el) => {
            el.checked = !!on;
        });
        refreshCondGroupCounts();
        const marquee = (window.SheetData?.MARQUEE_FEATURES || []).find((t) => t.id === id);
        if (currentData && marquee) handleMarqueeToggle(marquee, !!on);
        // Combat options with a standing side (acChanges dual-written into the ledger by
        // collectChanges) move AC/saves/CMD the moment they flip — recompute derived totals.
        // renderSheet restores the active tab itself, so this is safe from any panel.
        if (currentData && (combatToggleHasAcChanges(id)
            || marquee?.acChanges?.length || (marquee && !on && marquee.endCondition))) {
            window.SheetApp?.renderSheet?.(currentData);
        }
    }

    /**
     * Uses/rounds side of a marquee class-feature toggle (never blocks — warns and keeps
     * going, house style). ON: seed the Features-tab uses pool from its formula when still
     * unset, then spend 1 use (non-timed) or announce the rounds pool (timed — advanceRound
     * does the spending). OFF with an endCondition: Rage's end applies fatigued.
     */
    function handleMarqueeToggle(t, on) {
        const data = currentData;
        const toast = (m) => window.SheetOverlay?.toast?.(m);
        if (!on) {
            if (t.endCondition) {
                window.SheetState.setConditionActive(data, t.endCondition, true);
                toast(`${t.name} ends — ${t.endCondition} applied`);
            }
            return;
        }
        if (!t.uses) return;
        const u = window.SheetState.featureUses(data, t.uses.name || t.name);
        if (!u.max && t.uses.max) {
            const ev = window.SheetDetails?.evalSimpleFormula?.(t.uses.max, data);
            const n = Math.max(1, ev?.ok ? ev.value : 1);
            u.max = n;
            u.value = n;
        }
        if (t.timed) {
            toast(u.value > 0
                ? `${t.name}: ${u.value}/${u.max} rounds — spends on Next round`
                : `${t.name}: out of ${t.uses.name || t.name} rounds! (running on empty)`);
        } else if (u.value <= 0) {
            toast(`${t.name}: out of uses! (0/${u.max} — spending anyway)`);
        } else {
            u.value -= 1;
            toast(`${t.name}: ${u.value}/${u.max} uses left`);
        }
        window.SheetState.quietSave?.();
    }

    // ------------------------------------------------- per-round action economy (#19)
    // One shared swift/immediate slot + the AoO counter, stored in _sheet.actionEconomy.
    // Rendered as chips on the round strip (Buffs tab AND the Tools drawer attack section);
    // every mounted strip repaints from state via syncRoundStrips — the same one-state,
    // many-surfaces trick the conditional checkboxes use.

    /** AoO/round: user override wins; else 1, or 1 + Dex mod with Combat Reflexes. */
    function aooMaxFor(data) {
        const ae = window.SheetState.ensureActionEconomy(data);
        const ov = Number(ae.aooMax);
        if (ae.aooMax != null && ae.aooMax !== '' && Number.isFinite(ov)) return Math.max(0, ov);
        let max = 1;
        if (hasFeat(data, 'Combat Reflexes')) max += Math.max(0, abilityMod(data, 'dex'));
        return max;
    }

    function syncRoundStrips() {
        if (!currentData) return;
        const st = currentData._sheet || {};
        const ae = window.SheetState.ensureActionEconomy(currentData);
        document.querySelectorAll('.round-strip-num').forEach((el) => {
            el.textContent = `Round ${Number(st.roundCounter) || 0}`;
        });
        document.querySelectorAll('.ae-swift').forEach((el) => {
            el.textContent = ae.swiftSpent ? 'Swift spent' : 'Swift ready';
            el.classList.toggle('ae-spent', ae.swiftSpent);
        });
        document.querySelectorAll('.ae-aoo').forEach((el) => {
            el.textContent = `AoO ${ae.aooUsed}/${aooMaxFor(currentData)}`;
            el.classList.toggle('ae-spent', ae.aooUsed >= aooMaxFor(currentData));
        });
    }

    /**
     * Auto-spend the swift slot when a roll proves a swift action happened (Quickened
     * cast, Boost maneuver). Warns when it was already spent — and rolls anyway, house
     * style. Returns a rider line for the card.
     */
    function autoSpendSwift(reason) {
        if (!currentData) return null;
        const ae = window.SheetState.ensureActionEconomy(currentData);
        let text;
        if (ae.swiftSpent) {
            text = `Swift already used this round (${reason}) — rolled anyway`;
        } else {
            ae.swiftSpent = true;
            text = `Swift action spent (${reason})`;
        }
        window.SheetState.quietSave?.();
        syncRoundStrips();
        return { source: 'Action economy', text };
    }

    /** Rider line for any checked Boost maneuvers on this attack action, or null. */
    function boostSwiftRider() {
        const boosts = availableConditionals.filter((c) => c.sourceKind === 'maneuver'
            && c.powType === 'boost' && activeConditionals.get(c.id));
        if (!boosts.length) return null;
        return autoSpendSwift('Boost: ' + boosts.map((b) => b.source).join(', '));
    }

    /** The round strip: Round N · Next round (· Reset) · Swift chip · AoO chip. */
    function renderRoundStrip({ withReset = false } = {}) {
        const data = currentData;
        const strip = h('div', 'round-counter round-strip no-print');
        if (!data) return strip;
        const st = data._sheet || {};
        const ae = window.SheetState.ensureActionEconomy(data);
        strip.appendChild(h('span', 'round-counter-label round-strip-num',
            `Round ${Number(st.roundCounter) || 0}`));

        const next = h('button', 'inv-btn inv-btn-primary', 'Next round');
        next.type = 'button';
        next.title = 'Advance one round: durations tick, rage/performance rounds spend, '
            + 'fast healing applies, swift & AoOs refresh';
        next.addEventListener('click', () => {
            const res = window.SheetState.advanceRound(data);
            const bits = [];
            if (res.expired.length) bits.push('expired: ' + res.expired.join(', '));
            if (res.healed) bits.push(`healed ${res.healed} (fast healing/regen)`);
            window.SheetOverlay?.toast?.(`Round ${res.round}`
                + (bits.length ? ' — ' + bits.join(' · ') : ''));
            window.SheetApp?.renderSheet?.(data);
        });
        strip.appendChild(next);

        if (withReset) {
            const reset = h('button', 'inv-btn', 'Reset');
            reset.type = 'button';
            reset.title = 'Reset the round counter to 0 and refresh swift/AoOs '
                + '(durations are not restored)';
            reset.addEventListener('click', () => {
                window.SheetState.resetRoundCounter(data);
                window.SheetApp?.renderSheet?.(data);
            });
            strip.appendChild(reset);
        }

        const swift = h('button', 'inv-btn ae-chip ae-swift',
            ae.swiftSpent ? 'Swift spent' : 'Swift ready');
        swift.type = 'button';
        swift.title = 'Swift & immediate actions share one per-round slot — click to '
            + 'spend or restore it. Quickened casts and Boost maneuvers spend it themselves.';
        swift.classList.toggle('ae-spent', ae.swiftSpent);
        swift.addEventListener('click', () => {
            ae.swiftSpent = !ae.swiftSpent;
            window.SheetState.quietSave?.();
            syncRoundStrips();
        });
        strip.appendChild(swift);

        const aoo = h('button', 'inv-btn ae-chip ae-aoo',
            `AoO ${ae.aooUsed}/${aooMaxFor(data)}`);
        aoo.type = 'button';
        aoo.title = 'Attacks of opportunity this round — click to spend one, − to give it '
            + 'back, double-click to edit the max (auto: 1, or 1 + Dex with Combat Reflexes)';
        aoo.addEventListener('click', () => {
            ae.aooUsed += 1;
            if (ae.aooUsed > aooMaxFor(data)) {
                window.SheetOverlay?.toast?.(
                    `Out of AoOs (${ae.aooUsed}/${aooMaxFor(data)}) — your call`);
            }
            window.SheetState.quietSave?.();
            syncRoundStrips();
        });
        // Double-click edits the max in place (override stored in ae.aooMax; blank = auto).
        aoo.addEventListener('dblclick', (ev) => {
            ev.preventDefault();
            const input = h('input', 'edit-field ae-aoo-edit');
            input.type = 'number';
            input.min = '0';
            input.value = String(aooMaxFor(data));
            input.style.width = '3.2em';
            aoo.replaceWith(input);
            input.focus();
            input.select();
            const commit = () => {
                const raw = input.value.trim();
                ae.aooMax = raw === '' ? null : Math.max(0, Number(raw) || 0);
                window.SheetState.quietSave?.();
                input.replaceWith(aoo);
                syncRoundStrips();
            };
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') input.blur();
                if (e.key === 'Escape') { input.value = String(aooMaxFor(data)); input.blur(); }
            });
        });
        strip.appendChild(aoo);

        const undo = h('button', 'inv-btn ae-chip ae-aoo-undo', '−');
        undo.type = 'button';
        undo.title = 'Give back one attack of opportunity';
        undo.addEventListener('click', () => {
            ae.aooUsed = Math.max(0, ae.aooUsed - 1);
            window.SheetState.quietSave?.();
            syncRoundStrips();
        });
        strip.appendChild(undo);

        return strip;
    }

    let combatAcToggleIds = null;
    function combatToggleHasAcChanges(id) {
        if (!combatAcToggleIds) {
            combatAcToggleIds = new Set((window.SheetData?.COMBAT_TOGGLES || [])
                .filter((t) => t.acChanges?.length).map((t) => t.id));
        }
        return combatAcToggleIds.has(id);
    }

    /**
     * Repaint the "N on" badges from the checkboxes themselves. Reads the DOM rather than the
     * conditional state so it stays correct in every mounted panel (Tools drawer AND Combat card)
     * without a re-render, exactly like the checkbox sync above.
     */
    function refreshCondGroupCounts() {
        document.querySelectorAll('.cond-group').forEach((box) => {
            const badge = box.querySelector('.cond-group-count');
            if (!badge) return;
            const boxes = [...box.querySelectorAll('.cond-check')];
            const on = boxes.filter((el) => el.checked).length;
            badge.textContent = on ? `${on} on` : `${boxes.length}`;
        });
    }

    function seedConditionals(data) {
        availableConditionals = window.SheetDetails?.collectRollConditionals?.(data) || [];
        const prefs = data?._sheet?.conditionalPrefs || {};
        const nextIds = new Set(availableConditionals.map((c) => c.id));
        // Drop stale
        for (const id of [...activeConditionals.keys()]) {
            if (!nextIds.has(id)) activeConditionals.delete(id);
        }
        for (const c of availableConditionals) {
            if (Object.prototype.hasOwnProperty.call(prefs, c.id)) {
                activeConditionals.set(c.id, !!prefs[c.id]);
            } else if (!activeConditionals.has(c.id)) {
                activeConditionals.set(c.id, !!c.defaultOn);
            }
        }
    }

    // Panel grouping. Order is roughly "most likely to be toggled this round" first; anything with an
    // unlisted sourceKind falls into Other rather than disappearing.
    const COND_GROUPS = [
        ['combat', 'Combat options'],
        ['enhancement', 'Weapon qualities'],
        ['classFeature', 'Class features'],
        ['feat', 'Feats'],
        ['maneuver', 'Maneuvers'],
        ['stance', 'Stances'],
        ['talent', 'Talents'],
        ['spell', 'Spells'],
        ['other', 'Other'],
    ];
    const COND_GROUP_KEYS = new Set(COND_GROUPS.map(([k]) => k));
    const condGroupKey = (c) =>
        (COND_GROUP_KEYS.has(c.sourceKind) ? c.sourceKind : 'other');

    function condGroupOpen(key, hasActive) {
        const stored = currentData?._sheet?.conditionalGroupsOpen?.[key];
        // Default open only where something is already switched on -- a group whose entries default
        // to active (stances, flaming) is one the user needs to SEE to know it is applying.
        // Combat options is the exception: universal, most-toggled-per-round, open by default.
        return stored === undefined ? (key === 'combat' || hasActive) : !!stored;
    }

    function setCondGroupOpen(key, open) {
        if (!currentData) return;
        const st = (currentData._sheet ??= {});
        (st.conditionalGroupsOpen ??= {})[key] = !!open;
        window.SheetApp?.quietSave?.();
    }

    function condRow(c) {
        const row = h('label', 'cond-row');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'cond-check';
        cb.dataset.condId = c.id;
        cb.checked = !!activeConditionals.get(c.id);
        cb.addEventListener('change', () => {
            setConditional(c.id, cb.checked);
            // Persist quietly if sheet exposes saver
            window.SheetApp?.quietSave?.();
        });
        const text = h('span', 'cond-label');
        setTextWithInlineRolls(text, c.label);
        // Truncate very long riders in the label display via CSS; full title on hover
        row.title = c.label;
        row.append(cb, text);
        return row;
    }

    function renderConditionalPanel(host) {
        if (!host) return;
        host.innerHTML = '';
        host.classList.add('cond-panel');
        if (!currentData) {
            host.appendChild(h('p', 'tools-empty', 'Load a character for conditionals.'));
            return;
        }
        // Only the rolled weapon's qualities belong here — a character with four magic weapons would
        // otherwise be asked about all four sets on every swing. Same rule as scopedList(), applied
        // to what is AVAILABLE rather than what is checked.
        const weaponKey = activeWeaponItemKey();
        const shown = availableConditionals
            .filter((c) => !c.itemKey || !weaponKey || c.itemKey === weaponKey);
        if (!shown.length) {
            host.appendChild(h('p', 'tools-empty', 'No per-roll conditionals for this character.'));
            return;
        }
        host.appendChild(h('div', 'cond-panel-title', 'Conditionals (apply to next roll)'));

        const byGroup = new Map();
        for (const c of shown) {
            const key = condGroupKey(c);
            if (!byGroup.has(key)) byGroup.set(key, []);
            byGroup.get(key).push(c);
        }

        for (const [key, title] of COND_GROUPS) {
            const items = byGroup.get(key);
            if (!items?.length) continue;
            const activeCount = items.filter((c) => activeConditionals.get(c.id)).length;
            const box = document.createElement('details');
            box.className = 'cond-group';
            box.open = condGroupOpen(key, activeCount > 0);
            box.addEventListener('toggle', () => setCondGroupOpen(key, box.open));
            const sum = document.createElement('summary');
            sum.className = 'cond-group-summary';
            sum.append(h('span', 'cond-group-title', title));
            sum.append(h('span', 'cond-group-count',
                activeCount ? `${activeCount} on` : `${items.length}`));
            box.appendChild(sum);
            const list = h('div', 'cond-list');
            for (const c of items) list.appendChild(condRow(c));
            box.appendChild(list);
            host.appendChild(box);
        }
    }

    // ---------------------------------------------------------------- log (Foundry-style cards + simple dice)
    function pushLog(title, body, total, opts = {}) {
        if (opts.sound !== false && total != null) playDiceSound();
        const entry = { id: nextLogId++, type: 'simple', time: new Date(), title, body, total };
        history.unshift(entry);
        if (history.length > LOG_MAX) history.length = LOG_MAX;
        renderLog();
        return entry;
    }

    function pushRollCard(card, opts = {}) {
        if (opts.sound !== false) playDiceSound();
        const entry = { id: nextLogId++, type: 'card', time: new Date(), ...card };
        history.unshift(entry);
        if (history.length > LOG_MAX) history.length = LOG_MAX;
        renderLog();
        return entry;
    }

    function removeLogEntry(id) {
        const idx = history.findIndex((e) => e.id === id);
        if (idx < 0) return false;
        history.splice(idx, 1);
        renderLog();
        return true;
    }

    /** Right-click a roll log entry to remove it. */
    function bindLogRemove(el, entry) {
        el.classList.add('tools-log-removable');
        el.title = (el.title ? el.title + ' · ' : '') + 'Right-click to remove';
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeLogEntry(entry.id);
        });
    }

    function fmtTime(t) {
        const hh = String(t.getHours()).padStart(2, '0');
        const mm = String(t.getMinutes()).padStart(2, '0');
        const ss = String(t.getSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
    }

    function bindExpandable(block) {
        block.tabIndex = 0;
        block.setAttribute('role', 'button');
        block.title = 'Click or hover for breakdown';
        const toggle = () => block.classList.toggle('is-open');
        block.addEventListener('click', (e) => {
            e.preventDefault();
            toggle();
        });
        block.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            }
        });
    }

    function renderDetailLines(lines) {
        const ul = h('ul', 'roll-card-detail-list');
        for (const line of lines || []) {
            if (!line) continue;
            if (typeof line === 'string') {
                ul.appendChild(h('li', null, line));
            } else {
                const li = h('li', line.cls || null);
                if (line.label != null && line.value != null) {
                    li.append(
                        h('span', 'roll-card-dlabel', line.label),
                        h('span', 'roll-card-dval', String(line.value)),
                    );
                } else {
                    li.textContent = line.text || '';
                }
                ul.appendChild(li);
            }
        }
        return ul;
    }

    function renderAttackBlock(atk) {
        const block = h('div', 'roll-card-block roll-card-attack');
        const summary = h('div', 'roll-card-summary');
        summary.appendChild(h('span', 'roll-card-kind', atk.label || 'Attack'));
        const result = h('span', 'roll-card-result', String(atk.total));
        if (atk.threatened) result.classList.add('is-threat');
        if (atk.natural === 20) result.classList.add('is-nat20');
        if (atk.natural === 1) result.classList.add('is-nat1');
        summary.appendChild(result);
        const flavor = h('span', 'roll-card-flavor', `d20:${atk.natural}`);
        if (atk.threatened) flavor.textContent += ' · threat';
        summary.appendChild(flavor);
        block.appendChild(summary);

        const detailLines = [];
        detailLines.push({ label: 'd20', value: String(atk.natural) });
        detailLines.push({ label: 'Bonus', value: fmt(atk.bonus) });
        for (const b of atk.bonusLines || []) {
            detailLines.push({ label: b.label, value: typeof b.value === 'number' ? fmt(b.value) : String(b.value) });
        }
        if (atk.conditionals?.length) {
            detailLines.push({ text: 'Conditionals', cls: 'roll-card-section-label' });
            for (const c of atk.conditionals) {
                detailLines.push({
                    label: c.source,
                    value: typeof c.value === 'number' ? fmt(c.value) : String(c.value),
                    cls: 'roll-card-cond',
                });
            }
        }
        if (atk.threatened) {
            detailLines.push({
                text: `Critical threat (${atk.critRange}–20)`,
                cls: 'roll-card-section-label',
            });
            if (atk.confirm) {
                // The confirm carries its OWN bonus (crit-flagged conditionals only), so show
                // that rather than the initial one -- otherwise the arithmetic on this line
                // wouldn't add up whenever a crit modifier applied.
                const cb = atk.confirm.bonus ?? atk.bonus;
                detailLines.push({
                    label: 'Confirm d20',
                    value: `${atk.confirm.natural} ${fmt(cb)} = ${atk.confirm.total}`,
                });
                for (const c of atk.confirm.conditionals || []) {
                    detailLines.push({
                        label: c.source + ' (crit)',
                        value: typeof c.value === 'number' ? fmt(c.value) : String(c.value),
                        cls: 'roll-card-cond',
                    });
                }
            }
        }
        if (atk.natural === 20) detailLines.push({ text: 'Natural 20', cls: 'roll-card-flag' });
        if (atk.natural === 1) detailLines.push({ text: 'Natural 1', cls: 'roll-card-flag' });

        const detail = h('div', 'roll-card-detail');
        detail.appendChild(renderDetailLines(detailLines));
        block.appendChild(detail);
        bindExpandable(block);
        return block;
    }

    /** Apply rolled damage to the loaded character's HP. Temp HP absorbs first (lethal);
     *  nonlethal accumulates in its own pool. hpCurrent seeds from max on first touch. */
    function applyDamageToHp(amount, { nonlethal = false } = {}) {
        const n = Math.max(0, Math.floor(Number(amount) || 0));
        if (!currentData || !n) return;
        const st = (currentData._sheet ??= {});
        const max = Number(currentData.Total_HP) || 0;
        if (nonlethal) {
            st.hpNonlethal = (Number(st.hpNonlethal) || 0) + n;
            window.SheetOverlay?.toast?.(`${n} nonlethal damage (total ${st.hpNonlethal})`);
        } else {
            let rest = n;
            const temp = Number(st.hpTemp) || 0;
            if (temp > 0) {
                const used = Math.min(temp, rest);
                st.hpTemp = temp - used;
                rest -= used;
            }
            const cur = st.hpCurrent == null || st.hpCurrent === ''
                ? max : Number(st.hpCurrent) || 0;
            st.hpCurrent = cur - rest;
            window.SheetOverlay?.toast?.(
                `${n} damage — HP ${st.hpCurrent}/${max}`
                + (st.hpCurrent < 0 ? ' · below 0!' : ''));
        }
        window.SheetApp?.quietSave?.();
        window.SheetApp?.renderSheet?.(currentData);
    }

    /** Apply healing to HP: raises hpCurrent capped at max, reduces nonlethal alongside
     *  (PF1: healing removes an equal amount of nonlethal). Returns what happened so the
     *  card can note overheal wasted. */
    function applyHealingToHp(amount) {
        const n = Math.max(0, Math.floor(Number(amount) || 0));
        if (!currentData || !n) return null;
        const st = (currentData._sheet ??= {});
        const max = Number(currentData.Total_HP) || 0;
        const cur = st.hpCurrent == null || st.hpCurrent === ''
            ? max : Number(st.hpCurrent) || 0;
        const healed = Math.max(0, Math.min(n, max - cur));
        st.hpCurrent = Math.min(max, cur + n);
        const nl = Number(st.hpNonlethal) || 0;
        const nlHealed = Math.min(nl, n);
        if (nlHealed > 0) st.hpNonlethal = nl - nlHealed;
        window.SheetOverlay?.toast?.(`Healed ${healed} — HP ${st.hpCurrent}/${max}`
            + (nlHealed ? ` · ${nlHealed} nonlethal removed` : ''));
        window.SheetApp?.quietSave?.();
        window.SheetApp?.renderSheet?.(currentData);
        return { healed, nlHealed, over: n - Math.max(healed, nlHealed) };
    }

    function renderDamageBlock(dmg) {
        const block = h('div', 'roll-card-block roll-card-damage');
        const summary = h('div', 'roll-card-summary');
        summary.appendChild(h('span', 'roll-card-kind',
            (dmg.isHeal ? 'Healing'
                : (dmg.critMult > 1 ? `Damage (×${dmg.critMult})` : 'Damage'))
            + (dmg.label ? ` · ${dmg.label}` : '')));
        summary.appendChild(h('span', 'roll-card-result damage', String(dmg.total)));
        if (dmg.diceFlavor) {
            summary.appendChild(h('span', 'roll-card-flavor', dmg.diceFlavor));
        }
        block.appendChild(summary);

        const detailLines = [];
        for (const p of dmg.parts || []) {
            detailLines.push({
                label: p.label,
                value: p.detail != null ? String(p.detail) : (typeof p.value === 'number' ? fmt(p.value) : String(p.value)),
            });
        }
        if (dmg.conditionals?.length) {
            detailLines.push({ text: 'Conditionals', cls: 'roll-card-section-label' });
            for (const c of dmg.conditionals) {
                detailLines.push({
                    label: c.source,
                    value: typeof c.value === 'number' ? fmt(c.value) : String(c.value),
                    cls: 'roll-card-cond',
                });
            }
        }
        const detail = h('div', 'roll-card-detail');
        detail.appendChild(renderDetailLines(detailLines));
        block.appendChild(detail);
        // Apply-to-HP row (Foundry's chat-card apply buttons): full, half, nonlethal.
        // Typed blocks (weapon / natural damage) route through the Defenses tab — DR,
        // energy resistance, immunities, vulnerabilities — and append the arithmetic to
        // the card. Untyped blocks (spells, freeform) keep the raw path. Heal blocks get
        // a single Apply-healing button instead (#20).
        const applyRow = h('div', 'roll-card-apply no-print');
        const mitNote = h('div', 'roll-card-mitigation no-print');
        if (dmg.isHeal) {
            const b = h('button', 'roll-card-apply-btn', 'Heal ' + dmg.total);
            b.type = 'button';
            b.title = 'Raise HP (capped at max); nonlethal reduced alongside';
            b.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const res = applyHealingToHp(dmg.total);
                if (!res) return;
                mitNote.textContent = `Healed ${res.healed}`
                    + (res.nlHealed ? ` · ${res.nlHealed} nonlethal removed` : '')
                    + (res.over > 0 ? ` · ${res.over} wasted (already at full)` : '');
                if (!mitNote.parentNode) block.appendChild(mitNote);
            });
            applyRow.appendChild(b);
            block.appendChild(applyRow);
            bindExpandable(block);
            return block;
        }
        const doApply = ({ half = false, nonlethal = false } = {}) => {
            if (!dmg.typed) {
                applyDamageToHp(half ? Math.floor(dmg.total / 2) : dmg.total, { nonlethal });
                return;
            }
            const m = mitigateDamage(dmg, { half });
            applyDamageToHp(m.total, { nonlethal });
            mitNote.textContent = `Applied ${m.total}${nonlethal ? ' nonlethal' : ''}`
                + (m.steps.length ? ' — ' + m.steps.join(' · ')
                    : (m.total === dmg.total ? ' (no defenses matched)' : ''));
            if (!mitNote.parentNode) block.appendChild(mitNote);
        };
        const mkApply = (label, title, fn) => {
            const b = h('button', 'roll-card-apply-btn', label);
            b.type = 'button';
            b.title = title;
            b.addEventListener('click', (ev) => {
                ev.stopPropagation();
                fn();
            });
            applyRow.appendChild(b);
        };
        const via = dmg.typed ? ' through DR / resistances (Defenses tab)' : '';
        mkApply('Apply ' + dmg.total, 'Subtract from HP' + via + ' — temp HP absorbs first',
            () => doApply());
        mkApply('½', 'Apply half (save made)' + via,
            () => doApply({ half: true }));
        mkApply('NL', 'Apply as nonlethal damage' + via,
            () => doApply({ nonlethal: true }));
        block.appendChild(applyRow);
        bindExpandable(block);
        return block;
    }

    function renderCardEntry(e) {
        const card = h('div', 'roll-card tools-log-entry');
        const head = h('div', 'roll-card-head');
        head.appendChild(h('span', 'tools-log-time', fmtTime(e.time)));
        head.appendChild(h('span', 'roll-card-title', e.title || 'Roll'));
        if (e.subtitle) head.appendChild(h('span', 'roll-card-sub', e.subtitle));
        card.appendChild(head);

        const body = h('div', 'roll-card-body');
        for (const atk of e.attacks || []) body.appendChild(renderAttackBlock(atk));
        for (const dmg of e.damages || []) body.appendChild(renderDamageBlock(dmg));
        if (e.riders?.length) {
            const riders = h('div', 'roll-card-riders');
            for (const r of e.riders) {
                // One box per conditional rider so multiple effects stay distinct.
                const line = h('div', 'roll-card-rider');
                line.appendChild(h('span', 'roll-card-rider-src', r.source || 'Conditional'));
                const text = h('span', 'roll-card-rider-text');
                // Expanded totals stay as [[n¦formula]]; unexpanded [[dice]] still chip.
                setTextWithInlineRolls(text, r.text || '');
                line.appendChild(text);
                riders.appendChild(line);
            }
            body.appendChild(riders);
        }
        // Full spell description (collapsible, open by default) — shown after casting so
        // the effect text is right there in the log without reopening the Spells tab.
        if (e.descHtml) {
            const det = document.createElement('details');
            det.className = 'roll-card-desc';
            det.open = true;
            const sum = document.createElement('summary');
            sum.textContent = 'Description';
            det.appendChild(sum);
            const inner = h('div', 'roll-card-desc-body');
            inner.innerHTML = e.descHtml;
            det.appendChild(inner);
            body.appendChild(det);
        }
        card.appendChild(body);
        bindLogRemove(card, e);
        return card;
    }

    function renderSimpleEntry(e) {
        const row = h('div', 'tools-log-entry');
        row.appendChild(h('span', 'tools-log-time', fmtTime(e.time)));
        const main = h('div', 'tools-log-main');
        main.appendChild(h('div', 'tools-log-title', e.title));
        if (e.body) main.appendChild(h('div', 'tools-log-body', e.body));
        if (e.total != null) main.appendChild(h('div', 'tools-log-total', '= ' + e.total));
        row.appendChild(main);
        bindLogRemove(row, e);
        return row;
    }

    function renderLog() {
        const el = document.getElementById('tools-log');
        if (!el) return;
        el.innerHTML = '';
        if (!history.length) {
            el.appendChild(h('p', 'tools-empty', 'No rolls yet.'));
            return;
        }
        for (const e of history) {
            el.appendChild(e.type === 'card' ? renderCardEntry(e) : renderSimpleEntry(e));
        }
    }

    // ---------------------------------------------------------------- section minimize (Dice / Attacks / Log)
    function loadSectionCollapsed() {
        try {
            const raw = localStorage.getItem(TOOLS_SECTIONS_KEY);
            if (!raw) return {};
            const obj = JSON.parse(raw);
            return obj && typeof obj === 'object' ? obj : {};
        } catch {
            return {};
        }
    }

    function saveSectionCollapsed(map) {
        try { localStorage.setItem(TOOLS_SECTIONS_KEY, JSON.stringify(map)); } catch { /* private mode */ }
    }

    function setSectionCollapsed(sectionEl, collapsed) {
        if (!sectionEl) return;
        sectionEl.classList.toggle('is-collapsed', collapsed);
        const btn = sectionEl.querySelector('.tools-section-min');
        if (btn) {
            btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            btn.textContent = collapsed ? '+' : '−';
            const name = sectionEl.querySelector('h3')?.textContent || 'section';
            btn.title = collapsed ? `Expand ${name}` : `Minimize ${name}`;
            btn.setAttribute('aria-label', btn.title);
        }
    }

    function initSectionMinimize() {
        const collapsed = loadSectionCollapsed();
        document.querySelectorAll('.tools-section[data-menu-section]').forEach((sec) => {
            const key = sec.getAttribute('data-menu-section');
            setSectionCollapsed(sec, !!collapsed[key]);
            const btn = sec.querySelector('.tools-section-min');
            if (!btn) return;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const next = !sec.classList.contains('is-collapsed');
                setSectionCollapsed(sec, next);
                const map = loadSectionCollapsed();
                if (next) map[key] = true;
                else delete map[key];
                saveSectionCollapsed(map);
            });
        });
    }

    // ---------------------------------------------------------------- attack rolls
    function rollD20Attack(bonus, label, opts = {}) {
        const natural = randomInt(1, 20);
        const total = natural + bonus;
        const critRange = opts.critRange ?? 20;
        const threatened = natural >= critRange;
        let confirmNatural = null;
        let confirmTotal = null;
        let confirmBonus = null;
        let confirmCond = null;
        if (threatened && opts.confirm) {
            // getConfirmBonus is a CALLBACK, not a value, so the crit-phase conditionals -- which
            // roll dice -- are only evaluated on an actual threat instead of on every swing.
            // Absent, the confirm reuses the initial bonus, which is the old behaviour.
            const cb = opts.getConfirmBonus ? opts.getConfirmBonus() : null;
            confirmBonus = cb ? cb.bonus : bonus;
            confirmCond = cb ? cb.cond : null;
            confirmNatural = randomInt(1, 20);
            confirmTotal = confirmNatural + confirmBonus;
        }
        return {
            label: label || 'Attack',
            natural,
            total,
            bonus,
            critRange,
            threatened,
            confirm: confirmNatural != null
                ? {
                    natural: confirmNatural,
                    total: confirmTotal,
                    bonus: confirmBonus,
                    conditionals: confirmCond ? attackConditionalsList(confirmCond) : [],
                }
                : null,
            bonusLines: opts.bonusLines || [],
            conditionals: opts.conditionals || [],
        };
    }

    /**
     * @param {'normal'|'crit'} phase which attack d20 this is for (see evaluateConditionals).
     * @param {string|null} [itemKey] which weapon's enhancement conditionals count
     *   (see evaluateConditionals; `'none'` = natural attack, undefined = active weapon).
     * @param {{ ranged?: boolean }} [extra] melee/ranged scope for mattack/rattack-targeted
     *   modifiers.
     */
    function conditionalAtkBonus(phase = 'normal', itemKey = undefined, extra = {}) {
        const ev = evaluateConditionals('attack', { phase, itemKey, ...extra });
        let diceTotal = 0;
        const diceDetails = [];
        if (ev.diceParts.length) {
            const r = rollConditionalDice(ev.diceParts);
            diceTotal = r.total;
            diceDetails.push(...r.details);
        }
        return {
            flat: ev.flat,
            diceTotal,
            bits: ev.bits,
            diceDetails,
            total: ev.flat + diceTotal,
            riders: ev.riders,
        };
    }

    function attackBonusLines(ctx, condAtk, iterativePen) {
        const lines = [
            { label: 'BAB', value: ctx.bab },
            { label: ctx.abKey.toUpperCase(), value: ctx.abMod },
        ];
        if (ctx.enh) lines.push({ label: 'Enhancement', value: ctx.enh });
        if (ctx.size?.mod) lines.push({ label: `Size (${ctx.size.label})`, value: ctx.size.mod });
        for (const b of ctx.atkChanges.bits) lines.push({ label: b.source, value: b.value });
        for (const b of condAtk.bits) lines.push({ label: b.source + ' (cond)', value: b.value });
        for (const d of condAtk.diceDetails) lines.push({ label: 'Cond dice', value: d });
        if (iterativePen) lines.push({ label: 'Iterative', value: -iterativePen });
        return lines;
    }

    function attackConditionalsList(condAtk) {
        const out = [];
        for (const b of condAtk.bits || []) out.push({ source: b.source, value: b.value });
        for (const d of condAtk.diceDetails || []) out.push({ source: 'dice', value: d });
        return out;
    }

    function collectRiders(...lists) {
        const seen = new Set();
        const out = [];
        for (const list of lists) {
            for (const r of list || []) {
                const key = r.source + '|' + r.text;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({
                    source: r.source,
                    text: expandRiderInlineRolls(r.text, currentData),
                });
            }
        }
        return out;
    }

    function rollDamage(ctx, { critMult = 1, isCrit = false, oneOff = null, label = '', grip = undefined } = {}) {
        const w = ctx.wStats;
        const cond = evaluateConditionals('damage',
            { isCrit: isCrit || critMult > 1, itemKey: ctx.itemKey,
                ranged: ctx.ranged, grip: grip || weaponGrip(ctx) });
        const condDice = rollConditionalDice(cond.diceParts);

        if (!w?.dice && !w?.parts?.length) {
            if (!cond.flat && !condDice.total) {
                return null;
            }
        }

        let diceTotal = 0;
        const parts = [];
        let diceFlavor = '';
        // Typed buckets for defense routing: physical vs energy, plus DR-bypass context.
        const typed = { phys: 0, physTypes: [], energy: {}, bypass: damageBypassFor(ctx) };
        const addEnergy = (type, n) => { typed.energy[type] = (typed.energy[type] || 0) + n; };
        if (w?.parts?.length || w?.dice) {
            const wparts = w.parts?.length ? w.parts : [{ dice: w.dice, types: [] }];
            for (const p of wparts) {
                const parsed = parseFormula(p.dice);
                if (!parsed.ok) continue;
                const r = rollTerms(parsed.terms);
                const sub = r.total * critMult;
                diceTotal += sub;
                const energyType = (p.types || []).map((x) => String(x).toLowerCase())
                    .find((x) => ENERGY_TYPE_SET.has(x));
                if (energyType) addEnergy(energyType, sub);
                else {
                    typed.phys += sub;
                    for (const ty of p.types || []) {
                        if (!typed.physTypes.includes(ty)) typed.physTypes.push(ty);
                    }
                }
                const rolls = r.parts.filter((x) => x.kind === 'dice').flatMap((x) => x.rolls);
                const shown = rolls.length ? '[' + rolls.join(', ') + ']' : p.dice;
                const mult = critMult > 1 ? `×${critMult}` : '';
                const types = (p.types || []).join(', ');
                parts.push({
                    label: (p.dice || 'weapon') + mult + (types ? ' ' + types : ''),
                    detail: shown + ' → ' + sub,
                    value: sub,
                });
                if (!diceFlavor) diceFlavor = (p.dice || '') + mult + shown;
            }
        }
        const abMod = w ? abilityMod(currentData, w.damageAbility || 'str') : 0;
        // One-off situational damage (rolled fresh per attack so dice one-offs behave).
        let ooVal = 0;
        if (oneOff?.spec) ooVal = rollTerms(oneOff.spec.terms).total;
        const flat = abMod + ctx.enh + ctx.dmgChanges.total + cond.flat + condDice.total + ooVal;
        const total = diceTotal + flat;
        // Flat modifiers ride the physical bucket (PF1: DR reduces the attack's whole
        // non-energy total); conditional dice split by their source's inferred energy type
        // (Flaming → fire) so resistances catch exactly the rider they resist.
        typed.phys += abMod + ctx.enh + ctx.dmgChanges.total + cond.flat + ooVal;
        for (const p of condDice.parts || []) {
            const etype = inferEnergyType(p.source);
            if (etype) addEnergy(etype, p.total);
            else typed.phys += p.total;
        }

        if (abMod) parts.push({ label: (w.damageAbility || 'str').toUpperCase(), value: abMod });
        if (ctx.enh) parts.push({ label: 'Enhancement', value: ctx.enh });
        for (const b of ctx.dmgChanges.bits) parts.push({ label: b.source, value: b.value });
        for (const b of cond.bits) parts.push({ label: b.source + ' (cond)', value: b.value });
        for (const d of condDice.details) parts.push({ label: 'Cond dice', detail: d });
        if (oneOff?.spec) {
            parts.push({ label: (oneOff.label || 'Situational') + ' (one-off)', value: ooVal });
        }

        return {
            total,
            diceTotal,
            flat,
            critMult,
            diceFlavor,
            label,
            parts,
            typed,
            conditionals: [
                ...(cond.bits || []).map((b) => ({ source: b.source, value: b.value })),
                ...(condDice.details || []).map((d) => ({ source: 'dice', value: d })),
            ],
            riders: cond.riders || [],
        };
    }

    // ---------------------------------------------------------------- one-off modifiers
    // "Flanking +2, just this attack" — typed into the attack panel, consumed by the next
    // attack action (every line of it), then cleared. Raw strings so dice work ("1d6").
    const oneOffInput = { attack: '', damage: '', label: '' };

    function setOneOff(kind, value) {
        oneOffInput[kind] = String(value ?? '');
        // Mirror into every mounted panel (Tools drawer AND Combat card), same trick as
        // the conditional checkboxes.
        document.querySelectorAll(`.oneoff-input[data-oneoff="${kind}"]`).forEach((el) => {
            if (el.value !== oneOffInput[kind]) el.value = oneOffInput[kind];
        });
    }

    function clearOneOff() {
        for (const kind of ['attack', 'damage', 'label']) setOneOff(kind, '');
    }

    /** Parse-and-consume the one-off inputs. Null when both boxes are empty. */
    function takeOneOff() {
        const out = { attack: null, damage: null, label: String(oneOffInput.label || '').trim() };
        for (const kind of ['attack', 'damage']) {
            const raw = String(oneOffInput[kind] || '').trim();
            if (!raw) continue;
            const parsed = parseFormula(raw);
            if (parsed.ok) out[kind] = { terms: parsed.terms, formula: parsed.formula };
        }
        if (!out.attack && !out.damage) return null;
        clearOneOff();
        return out;
    }

    /** Attack-side one-off, rolled fresh for one attack line. */
    function rollOneOffAtk(oo) {
        if (!oo?.attack) return null;
        const r = rollTerms(oo.attack.terms);
        return {
            value: r.total,
            line: { label: (oo.label || 'Situational') + ' (one-off)', value: r.total },
        };
    }

    function oneOffDmgOpt(oo) {
        return oo?.damage ? { spec: oo.damage, label: oo.label } : null;
    }

    function doWeaponAttack({ full = false, withDamage = true, itemKey = undefined } = {}) {
        const ctx = attackContext(currentData, itemKey);
        if (!ctx) {
            pushLog('Attack', 'Load a character first.', null, { sound: false });
            return;
        }
        if (!ctx.wName) {
            pushLog('Attack', 'No weapon on this character.', null, { sound: false });
            return;
        }
        const critRange = ctx.wStats?.critRange ?? 20;
        const critMult = ctx.wStats?.critMult ?? 2;
        const count = full ? ctx.iters : 1;
        const labelBase = ctx.label || ctx.wName;
        const oo = takeOneOff();
        const attacks = [];
        const damages = [];
        const riderLists = [];
        const boostRider = boostSwiftRider();
        if (boostRider) riderLists.push([boostRider]);

        for (let i = 0; i < count; i++) {
            const pen = i * 5;
            const condThis = conditionalAtkBonus('normal', ctx.itemKey, { ranged: ctx.ranged });
            riderLists.push(condThis.riders);
            const ooAtk = rollOneOffAtk(oo);
            const bonus = ctx.weaponBonus + condThis.total + (ooAtk?.value || 0) - pen;
            const iterLabel = full
                ? (count > 1 ? `Attack #${i + 1}` : 'Attack')
                : 'Attack';
            const bonusLines = attackBonusLines(ctx, condThis, pen);
            if (ooAtk) bonusLines.push(ooAtk.line);
            const atk = rollD20Attack(bonus, iterLabel, {
                critRange,
                confirm: true,
                getConfirmBonus: () => {
                    const cc = conditionalAtkBonus('crit', ctx.itemKey, { ranged: ctx.ranged });
                    return {
                        bonus: ctx.weaponBonusConfirm + cc.total + (ooAtk?.value || 0) - pen,
                        cond: cc,
                    };
                },
                bonusLines,
                conditionals: attackConditionalsList(condThis),
            });
            attacks.push(atk);
            if (withDamage) {
                const mult = (atk.threatened && atk.confirm?.natural !== 1) ? critMult : 1;
                const dmg = rollDamage(ctx, {
                    critMult: mult, isCrit: mult > 1, oneOff: oneOffDmgOpt(oo),
                });
                if (dmg) {
                    damages.push(dmg);
                    riderLists.push(dmg.riders);
                }
            }
        }

        pushRollCard({
            title: labelBase,
            subtitle: full
                ? (withDamage ? `Full attack (${count}) + damage` : `Full attack (${count})`)
                : (withDamage ? 'Attack & damage' : 'Attack'),
            attacks,
            damages,
            riders: collectRiders(...riderLists),
        });
    }

    function doDamageOnly({ itemKey = undefined } = {}) {
        const ctx = attackContext(currentData, itemKey);
        if (!ctx) {
            pushLog('Damage', 'Load a character first.', null, { sound: false });
            return;
        }
        if (!ctx.wName) {
            pushLog('Damage', 'No weapon on this character.', null, { sound: false });
            return;
        }
        const oo = takeOneOff();
        const dmg = rollDamage(ctx, { critMult: 1, isCrit: false, oneOff: oneOffDmgOpt(oo) });
        if (!dmg) {
            pushLog('Damage', 'No weapon damage stats for “' + (ctx.wName || '?') + '”.', null, { sound: false });
            return;
        }
        pushRollCard({
            title: ctx.label || ctx.wName,
            subtitle: 'Damage',
            attacks: [],
            damages: [dmg],
            riders: collectRiders(dmg.riders),
        });
    }

    // ---------------------------------------------------------------- attack routines
    // A routine is a persisted, named full-attack sequence: one line = one d20. Lines are
    // seeded from BAB iteratives + detected feats but stay fully editable — weird builds
    // fix the numbers by hand instead of fighting a rules engine.
    //   { id, name, lines: [
    //       { type:'weapon', itemKey, label, adjust, ammoKey } |
    //       { type:'natural', name, atkMod, dmg, adjust } ] }

    /** Does the character know a feat, by base name (parenthetical picks ignored)? Scans
     *  every FEAT_GROUPS list plus the feat-tax chains riding on them. */
    function hasFeat(data, name) {
        if (!data) return false;
        const want = String(name).toLowerCase();
        const matches = (f) => String(f).toLowerCase().split(' (')[0].trim() === want;
        for (const g of window.SheetData?.FEAT_GROUPS || []) {
            const list = data[g.listKey];
            if (Array.isArray(list) && list.some(matches)) return true;
            const tax = g.taxKey && data[g.taxKey];
            if (tax && typeof tax === 'object'
                && Object.values(tax).some((kids) => Array.isArray(kids) && kids.some(matches))) {
                return true;
            }
        }
        return false;
    }

    function routineList(data) {
        const st = ((data || currentData) || {})._sheet;
        return Array.isArray(st?.attackRoutines) ? st.attackRoutines : [];
    }

    function saveRoutines(routines) {
        if (!currentData) return;
        (currentData._sheet ??= {}).attackRoutines = routines;
        window.SheetApp?.quietSave?.();
    }

    /**
     * Default full-attack lines for this character: main-weapon iteratives, an extra
     * Rapid Shot attack (ranged), and off-hand attacks for the TWF chain. Penalties are
     * baked into each line's `adjust` (TWF assumes a light off-hand: −2/−2) so the seed
     * is honest, visible, and editable.
     */
    function seedRoutineLines(data) {
        const mainKey = activeWeaponItemKey(data);
        const ctx = attackContext(data, mainKey);
        if (!ctx?.wName) return [];
        const name = ctx.label || ctx.wName;
        const lines = [];
        const rapid = ctx.ranged && hasFeat(data, 'Rapid Shot');
        const offhand = !ctx.ranged
            && hasFeat(data, 'Two-Weapon Fighting')
            && equippedWeapons(data).find((it) => {
                if (it.id === ctx.itemKey) return false;
                const w = itemWeaponStats(it);
                return w && !isRangedAction(w.actionType);
            });
        const globalAdj = (rapid ? -2 : 0) + (offhand ? -2 : 0);
        for (let i = 0; i < ctx.iters; i++) {
            lines.push({
                type: 'weapon', itemKey: ctx.itemKey, ammoKey: null,
                label: ctx.iters > 1 ? `${name} #${i + 1}` : name,
                adjust: -5 * i + globalAdj,
            });
        }
        if (rapid) {
            lines.splice(1, 0, {
                type: 'weapon', itemKey: ctx.itemKey, ammoKey: null,
                label: `${name} (Rapid Shot)`, adjust: globalAdj,
            });
        }
        if (offhand) {
            const offAtks = 1 + (hasFeat(data, 'Improved Two-Weapon Fighting') ? 1 : 0)
                + (hasFeat(data, 'Greater Two-Weapon Fighting') ? 1 : 0);
            for (let j = 0; j < offAtks; j++) {
                lines.push({
                    type: 'weapon', itemKey: offhand.id, ammoKey: null,
                    label: `Off-hand: ${offhand.name}` + (offAtks > 1 ? ` #${j + 1}` : ''),
                    adjust: -2 - 5 * j,
                });
            }
        }
        return lines;
    }

    let routineSeq = 1;
    function newRoutine(data, nameHint) {
        const lines = seedRoutineLines(data);
        return {
            id: 'rt-' + Date.now() + '-' + routineSeq++,
            name: nameHint || 'Full attack',
            lines,
        };
    }

    /** Routines, seeding a default on first touch (only when a weapon exists to seed from). */
    function ensureRoutines(data) {
        const existing = routineList(data);
        if (existing.length) return existing;
        const seeded = newRoutine(data);
        if (!seeded.lines.length) return [];
        (data._sheet ??= {}).attackRoutines = [seeded];
        window.SheetApp?.quietSave?.();
        return data._sheet.attackRoutines;
    }

    function selectedRoutine(data) {
        const routines = routineList(data);
        const sel = data?._sheet?.attackRoutineSel;
        return routines.find((r) => r.id === sel) || routines[0] || null;
    }

    /** Natural-attack damage from a raw formula string ("1d6+4"). Crit doubles dice only,
     *  matching the weapon path's existing convention. */
    function rollNaturalDamage(line, { critMult = 1, oneOff = null } = {}) {
        // Natural attacks are melee: melee-scoped conditionals (Power Attack) apply at the
        // base rate — primary/secondary ×1.5/×0.5 nuances stay the editable line's business.
        const cond = evaluateConditionals('damage',
            { isCrit: critMult > 1, itemKey: 'none', ranged: false });
        const condDice = rollConditionalDice(cond.diceParts);
        const parsed = line.dmg ? parseFormula(line.dmg) : { ok: false };
        let diceTotal = 0;
        let flat = cond.flat + condDice.total;
        let diceFlavor = '';
        const parts = [];
        if (parsed.ok) {
            const r = rollTerms(parsed.terms);
            const dice = r.parts.filter((x) => x.kind === 'dice');
            const diceSum = dice.reduce((n, x) => n + x.rolls.reduce((a, b) => a + b, 0), 0);
            const staticPart = r.total - diceSum;
            diceTotal = diceSum * critMult;
            flat += staticPart;
            const rolls = dice.flatMap((x) => x.rolls);
            const mult = critMult > 1 ? `×${critMult}` : '';
            diceFlavor = parsed.formula + mult + (rolls.length ? '[' + rolls.join(', ') + ']' : '');
            if (diceSum || rolls.length) {
                parts.push({
                    label: parsed.formula + mult,
                    detail: (rolls.length ? '[' + rolls.join(', ') + ']' : '') + ' → ' + diceTotal,
                });
            }
            if (staticPart) parts.push({ label: 'Static', value: staticPart });
        } else if (!cond.flat && !condDice.total) {
            return null;
        }
        let ooVal = 0;
        if (oneOff?.spec) ooVal = rollTerms(oneOff.spec.terms).total;
        flat += ooVal;
        for (const b of cond.bits) parts.push({ label: b.source + ' (cond)', value: b.value });
        for (const d of condDice.details) parts.push({ label: 'Cond dice', detail: d });
        if (oneOff?.spec) {
            parts.push({ label: (oneOff.label || 'Situational') + ' (one-off)', value: ooVal });
        }
        // Typed for defense routing: a natural attack has no weapon context (bypass []),
        // so DR applies in full; energy riders still split out by source name.
        const typed = { phys: 0, physTypes: [], energy: {}, bypass: [] };
        typed.phys = diceTotal + flat - condDice.total;
        for (const p of condDice.parts || []) {
            const etype = inferEnergyType(p.source);
            if (etype) typed.energy[etype] = (typed.energy[etype] || 0) + p.total;
            else typed.phys += p.total;
        }
        return {
            total: diceTotal + flat,
            diceTotal,
            flat,
            critMult,
            diceFlavor,
            label: line.name || 'Natural attack',
            parts,
            typed,
            conditionals: [
                ...(cond.bits || []).map((b) => ({ source: b.source, value: b.value })),
                ...(condDice.details || []).map((d) => ({ source: 'dice', value: d })),
            ],
            riders: cond.riders || [],
        };
    }

    /** Roll every line of a routine into one card. Ranged lines linked to an ammo item
     *  spend one each; an empty quiver still rolls but flags the line loudly. */
    function doRoutineAttack(routine) {
        if (!currentData || !routine?.lines?.length) {
            pushLog('Full attack', 'No routine to roll — add attacks in the editor.', null, { sound: false });
            return;
        }
        const oo = takeOneOff();
        const attacks = [];
        const damages = [];
        const riderLists = [];
        const notes = [];
        const ctxCache = new Map();
        let ammoSpent = false;
        const boostRider = boostSwiftRider();
        if (boostRider) riderLists.push([boostRider]);

        for (const line of routine.lines) {
            const adjust = Number(line.adjust) || 0;
            if (line.type === 'natural') {
                const cond = conditionalAtkBonus('normal', 'none', { ranged: false });
                riderLists.push(cond.riders);
                const ooAtk = rollOneOffAtk(oo);
                const atkMod = Number(line.atkMod) || 0;
                const bonus = atkMod + adjust + cond.total + (ooAtk?.value || 0);
                const bonusLines = [{ label: 'Attack mod', value: atkMod }];
                if (adjust) bonusLines.push({ label: 'Adjust', value: adjust });
                for (const b of cond.bits) bonusLines.push({ label: b.source, value: b.value });
                if (ooAtk) bonusLines.push(ooAtk.line);
                const atk = rollD20Attack(bonus, line.name || 'Natural attack', {
                    critRange: 20,
                    confirm: true,
                    getConfirmBonus: () => {
                        const cc = conditionalAtkBonus('crit', 'none', { ranged: false });
                        return { bonus: atkMod + adjust + cc.total + (ooAtk?.value || 0), cond: cc };
                    },
                    bonusLines,
                    conditionals: attackConditionalsList(cond),
                });
                attacks.push(atk);
                const mult = (atk.threatened && atk.confirm?.natural !== 1) ? 2 : 1;
                const dmg = rollNaturalDamage(line, { critMult: mult, oneOff: oneOffDmgOpt(oo) });
                if (dmg) {
                    damages.push(dmg);
                    riderLists.push(dmg.riders);
                }
                continue;
            }

            let ctx = ctxCache.get(line.itemKey);
            if (ctx === undefined) {
                ctx = attackContext(currentData, line.itemKey);
                ctxCache.set(line.itemKey, ctx);
            }
            if (!ctx?.wName) {
                notes.push({ source: line.label || 'Attack', text: 'Weapon not found — edit the routine.' });
                continue;
            }
            const label = line.label || ctx.label || ctx.wName;

            // Ammo: spend one per attack line; keep rolling at zero but say so.
            if (line.ammoKey) {
                const ammo = findInventoryItem(currentData, line.ammoKey);
                if (!ammo) {
                    notes.push({ source: label, text: 'Linked ammo is gone from the inventory.' });
                } else if ((Number(ammo.quantity) || 0) <= 0) {
                    notes.push({ source: label, text: `Out of ${ammo.name}!` });
                } else {
                    ammo.quantity = (Number(ammo.quantity) || 0) - 1;
                    ammoSpent = true;
                    if (ammo.quantity === 0) notes.push({ source: label, text: `${ammo.name}: last one spent.` });
                }
            }

            // A TWF off-hand line halves grip-scaled damage bonuses (Power Attack) — off-hand
            // is a property of the attack line, not the weapon, so it's detected here.
            const offHand = /\boff-?hand\b/i.test(String(line.label || ''));
            const condThis = conditionalAtkBonus('normal', ctx.itemKey, { ranged: ctx.ranged });
            riderLists.push(condThis.riders);
            const ooAtk = rollOneOffAtk(oo);
            const bonus = ctx.weaponBonus + condThis.total + (ooAtk?.value || 0) + adjust;
            const bonusLines = attackBonusLines(ctx, condThis, 0);
            if (adjust) bonusLines.push({ label: 'Adjust', value: adjust });
            if (ooAtk) bonusLines.push(ooAtk.line);
            const atk = rollD20Attack(bonus, label, {
                critRange: ctx.wStats?.critRange ?? 20,
                confirm: true,
                getConfirmBonus: () => {
                    const cc = conditionalAtkBonus('crit', ctx.itemKey, { ranged: ctx.ranged });
                    return {
                        bonus: ctx.weaponBonusConfirm + cc.total + (ooAtk?.value || 0) + adjust,
                        cond: cc,
                    };
                },
                bonusLines,
                conditionals: attackConditionalsList(condThis),
            });
            attacks.push(atk);
            const critMult = ctx.wStats?.critMult ?? 2;
            const mult = (atk.threatened && atk.confirm?.natural !== 1) ? critMult : 1;
            const dmg = rollDamage(ctx, {
                critMult: mult, isCrit: mult > 1, oneOff: oneOffDmgOpt(oo), label,
                grip: offHand ? 'offhand' : undefined,
            });
            if (dmg) {
                damages.push(dmg);
                riderLists.push(dmg.riders);
            }
        }

        pushRollCard({
            title: routine.name || 'Full attack',
            subtitle: `Full attack (${attacks.length} attack${attacks.length === 1 ? '' : 's'})`,
            attacks,
            damages,
            riders: [...notes, ...collectRiders(...riderLists)],
        });
        if (ammoSpent) {
            window.SheetApp?.quietSave?.();
            // Repaint so Inventory quantity and the routine editor's ammo counts agree.
            window.SheetApp?.renderSheet?.(currentData);
        }
    }

    // ---------------------------------------------------------------- attack UI (tools + combat)
    /** Weapon picker — which equipped weapon the single-weapon buttons + panel are on. */
    function weaponPickerRow() {
        const ws = equippedWeapons(currentData);
        if (ws.length < 2) return null;
        const row = h('div', 'atk-weapon-pick no-print');
        const id = 'atk-weapon-pick-' + Math.random().toString(36).slice(2, 8);
        const lab = h('label', null, 'Weapon');
        lab.htmlFor = id;
        const sel = document.createElement('select');
        sel.id = id;
        const cur = activeWeaponItemKey(currentData);
        for (const it of ws) {
            const opt = document.createElement('option');
            opt.value = it.id;
            opt.textContent = it.name;
            if (it.id === cur) opt.selected = true;
            sel.appendChild(opt);
        }
        sel.addEventListener('change', () => {
            (currentData._sheet ??= {}).activeWeaponKey = sel.value;
            window.SheetApp?.quietSave?.();
            renderAttacks();
        });
        row.append(lab, sel);
        return row;
    }

    /** "Next roll only" inputs: label + attack + damage. State is module-level so the
     *  Tools drawer and the Combat card stay in sync (see setOneOff). */
    function oneOffBox() {
        const box = h('div', 'atk-oneoff no-print');
        box.title = 'One-off modifier for the next attack action only (flanking, cover, '
            + 'higher ground…). Dice formulas work. Cleared after the roll.';
        box.appendChild(h('span', 'atk-oneoff-label', 'Next roll:'));
        const mk = (kind, ph, cls) => {
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'oneoff-input' + (cls ? ' ' + cls : '');
            inp.dataset.oneoff = kind;
            inp.placeholder = ph;
            inp.setAttribute('aria-label', 'One-off ' + (kind === 'label' ? 'reason' : kind + ' modifier'));
            inp.value = oneOffInput[kind];
            inp.addEventListener('input', () => setOneOff(kind, inp.value));
            return inp;
        };
        box.appendChild(mk('label', 'why (flanking…)', 'oneoff-why'));
        box.appendChild(mk('attack', '+atk', 'oneoff-num'));
        box.appendChild(mk('damage', '+dmg', 'oneoff-num'));
        return box;
    }

    /** Items an attack line can spend as ammo (anything that isn't a weapon or armor). */
    function ammoOptions(data) {
        const list = window.SheetState?.ensureInventoryObjects?.(data) || [];
        const cat = window.SheetInventoryModel?.inventoryCategory;
        return list.filter((it) => it && typeof it === 'object'
            && (!cat || cat(it) === 'consumables' || cat(it) === 'equipment'));
    }

    let routineEditorOpen = false;

    function routineEditor(data, routine) {
        const wrap = h('div', 'atk-routine-editor no-print');
        const weapons = equippedWeapons(data);
        const ammo = ammoOptions(data);

        const nameRow = h('div', 'atk-routine-line atk-routine-name-row');
        const nameInp = document.createElement('input');
        nameInp.type = 'text';
        nameInp.className = 'atk-routine-name';
        nameInp.value = routine.name || '';
        nameInp.placeholder = 'Routine name';
        nameInp.setAttribute('aria-label', 'Routine name');
        nameInp.addEventListener('change', () => {
            routine.name = nameInp.value.trim() || 'Full attack';
            window.SheetApp?.quietSave?.();
            renderAttacks();
        });
        nameRow.appendChild(nameInp);
        wrap.appendChild(nameRow);

        const mkSelect = (options, value, onChange, aria) => {
            const sel = document.createElement('select');
            sel.setAttribute('aria-label', aria);
            for (const [val, text] of options) {
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = text;
                if (val === value) opt.selected = true;
                sel.appendChild(opt);
            }
            sel.addEventListener('change', () => onChange(sel.value));
            return sel;
        };
        const mkInput = (type, value, ph, onChange, cls, aria) => {
            const inp = document.createElement('input');
            inp.type = type;
            if (cls) inp.className = cls;
            inp.value = value ?? '';
            inp.placeholder = ph;
            inp.setAttribute('aria-label', aria || ph);
            inp.addEventListener('change', () => onChange(inp.value));
            return inp;
        };

        routine.lines.forEach((line, idx) => {
            const row = h('div', 'atk-routine-line');
            if (line.type === 'natural') {
                row.appendChild(mkInput('text', line.name, 'Bite, claw…', (v) => {
                    line.name = v;
                    window.SheetApp?.quietSave?.();
                }, 'atk-line-name', 'Natural attack name'));
                row.appendChild(mkInput('number', line.atkMod, '+atk', (v) => {
                    line.atkMod = Number(v) || 0;
                    window.SheetApp?.quietSave?.();
                }, 'atk-line-num', 'Attack modifier'));
                row.appendChild(mkInput('text', line.dmg, '1d6+4', (v) => {
                    line.dmg = v.trim();
                    window.SheetApp?.quietSave?.();
                }, 'atk-line-dmg', 'Damage formula'));
            } else {
                const wOpts = weapons.map((it) => [it.id, it.name]);
                if (line.itemKey && !weapons.some((it) => it.id === line.itemKey)) {
                    wOpts.push([line.itemKey, '(missing weapon)']);
                }
                row.appendChild(mkSelect(wOpts, line.itemKey, (v) => {
                    line.itemKey = v;
                    window.SheetApp?.quietSave?.();
                }, 'Weapon for this attack'));
                row.appendChild(mkInput('text', line.label, 'label', (v) => {
                    line.label = v.trim();
                    window.SheetApp?.quietSave?.();
                }, 'atk-line-name', 'Attack label'));
                row.appendChild(mkSelect(
                    [['', 'no ammo'], ...ammo.map((it) => [it.id,
                        `${it.name} (${Number(it.quantity) || 0})`])],
                    line.ammoKey || '',
                    (v) => {
                        line.ammoKey = v || null;
                        window.SheetApp?.quietSave?.();
                    }, 'Ammo item spent per attack'));
            }
            row.appendChild(mkInput('number', line.adjust ?? 0, '±0', (v) => {
                line.adjust = Number(v) || 0;
                window.SheetApp?.quietSave?.();
            }, 'atk-line-num', 'Flat adjustment (iterative/TWF penalties live here)'));
            const del = h('button', 'atk-line-del', '×');
            del.type = 'button';
            del.title = 'Remove this attack';
            del.addEventListener('click', () => {
                routine.lines.splice(idx, 1);
                window.SheetApp?.quietSave?.();
                renderAttacks();
            });
            row.appendChild(del);
            wrap.appendChild(row);
        });

        const addRow = h('div', 'atk-routine-line atk-routine-add-row');
        const addWeapon = h('button', null, '+ Weapon attack');
        addWeapon.type = 'button';
        addWeapon.addEventListener('click', () => {
            routine.lines.push({
                type: 'weapon', itemKey: activeWeaponItemKey(data), ammoKey: null,
                label: '', adjust: 0,
            });
            window.SheetApp?.quietSave?.();
            renderAttacks();
        });
        const addNatural = h('button', null, '+ Natural attack');
        addNatural.type = 'button';
        addNatural.addEventListener('click', () => {
            routine.lines.push({ type: 'natural', name: '', atkMod: 0, dmg: '', adjust: 0 });
            window.SheetApp?.quietSave?.();
            renderAttacks();
        });
        const reseed = h('button', null, 'Re-seed');
        reseed.type = 'button';
        reseed.title = 'Rebuild the lines from BAB iteratives + feats (TWF, Rapid Shot). '
            + 'Replaces the current lines.';
        reseed.addEventListener('click', () => {
            routine.lines = seedRoutineLines(data);
            window.SheetApp?.quietSave?.();
            renderAttacks();
        });
        addRow.append(addWeapon, addNatural, reseed);
        wrap.appendChild(addRow);
        return wrap;
    }

    function renderRoutinePanel() {
        const data = currentData;
        if (!data) return null;
        const routines = ensureRoutines(data);
        const panel = h('div', 'atk-routines');
        panel.appendChild(h('div', 'cond-panel-title', 'Full-attack routines'));
        const current = selectedRoutine(data);

        const row = h('div', 'atk-routine-row no-print');
        if (routines.length) {
            const sel = document.createElement('select');
            sel.setAttribute('aria-label', 'Attack routine');
            for (const r of routines) {
                const opt = document.createElement('option');
                opt.value = r.id;
                opt.textContent = `${r.name} (${r.lines.length})`;
                if (current && r.id === current.id) opt.selected = true;
                sel.appendChild(opt);
            }
            sel.addEventListener('change', () => {
                (data._sheet ??= {}).attackRoutineSel = sel.value;
                window.SheetApp?.quietSave?.();
                renderAttacks();
            });
            row.appendChild(sel);
            const rollIt = h('button', 'atk-routine-roll', 'Roll full attack');
            rollIt.type = 'button';
            rollIt.title = 'Roll every attack line of this routine, each with damage';
            rollIt.addEventListener('click', () => doRoutineAttack(selectedRoutine(data)));
            row.appendChild(rollIt);
            const edit = h('button', null, routineEditorOpen ? 'Done' : 'Edit');
            edit.type = 'button';
            edit.title = 'Edit the attack lines of this routine';
            edit.addEventListener('click', () => {
                routineEditorOpen = !routineEditorOpen;
                renderAttacks();
            });
            row.appendChild(edit);
        }
        const add = h('button', null, '+ New');
        add.type = 'button';
        add.title = 'New routine, seeded from BAB + feats';
        add.addEventListener('click', () => {
            const next = [...routineList(data), newRoutine(data, 'Routine ' + (routines.length + 1))];
            saveRoutines(next);
            (data._sheet ??= {}).attackRoutineSel = next[next.length - 1].id;
            routineEditorOpen = true;
            renderAttacks();
        });
        row.appendChild(add);
        if (routines.length) {
            const del = h('button', null, '× Delete');
            del.type = 'button';
            del.title = 'Delete this routine';
            del.addEventListener('click', () => {
                const cur = selectedRoutine(data);
                saveRoutines(routineList(data).filter((r) => r !== cur));
                renderAttacks();
            });
            row.appendChild(del);
        }
        panel.appendChild(row);
        if (routineEditorOpen && current) panel.appendChild(routineEditor(data, current));
        return panel;
    }

    function makeAttackButtons(ctx) {
        const row = h('div', 'tools-btn-row combat-atk-btns no-print');
        const atkBonus = ctx.weaponBonus
            + (conditionalAtkBonus('normal', undefined, { ranged: ctx.ranged }).flat || 0);
        const dmgF = ctx.damageFormula || '';
        // Same label style: kind + value (Attack +12 · Damage 1d8+5)
        const atkBtn = h('button', null, 'Attack ' + fmt(atkBonus));
        atkBtn.type = 'button';
        atkBtn.title = dmgF
            ? `1d20 ${fmt(atkBonus)} then damage ${dmgF} (crit mult on threat)`
            : `1d20 ${fmt(atkBonus)} then damage`;
        atkBtn.addEventListener('click', () => doWeaponAttack({ full: false, withDamage: true }));
        const fullBtn = h('button', null, 'Full attack');
        fullBtn.type = 'button';
        fullBtn.title = ctx.iters + ' attack(s) at −5 steps, each with damage';
        fullBtn.addEventListener('click', () => doWeaponAttack({ full: true, withDamage: true }));
        const dmgBtn = h('button', null, dmgF ? 'Damage ' + dmgF : 'Damage');
        dmgBtn.type = 'button';
        dmgBtn.title = dmgF ? 'Weapon damage only: ' + dmgF : 'Roll weapon damage';
        dmgBtn.addEventListener('click', () => doDamageOnly());
        row.append(atkBtn, fullBtn, dmgBtn);
        return row;
    }

    function renderAttackCard(host, { showConditionals = true, showGeneric = true,
        roundStrip = false } = {}) {
        if (!host) return;
        host.innerHTML = '';
        const ctx = attackContext(currentData);
        if (!ctx) {
            host.appendChild(h('p', 'tools-empty', 'Load a character to roll attacks.'));
            return;
        }
        // The Buffs-tab round strip mirrored mid-combat surface-side (#19): one state,
        // two surfaces, no tab switch to advance the round or spend the swift.
        if (roundStrip) host.appendChild(renderRoundStrip());

        if (ctx.wName) {
            const block = h('div', 'tools-atk-block combat-atk-card');
            const pick = weaponPickerRow();
            if (pick) block.appendChild(pick);
            block.appendChild(h('div', 'tools-atk-name', ctx.label || ctx.wName));

            // Two rows, identical structure: Kind · Value · flavor
            const stats = h('div', 'tools-atk-stats');
            const atkRow = h('div', 'tools-atk-line');
            atkRow.append(
                h('span', 'tools-atk-kind', 'Attack'),
                h('span', 'tools-atk-value', fmt(ctx.weaponBonus)),
            );
            const atkFlavor = [ctx.ranged ? 'ranged' : 'melee'];
            if (ctx.wStats) {
                atkFlavor.push(`crit ${ctx.wStats.critRange}–20/×${ctx.wStats.critMult}`);
            } else {
                atkFlavor.push('no weapon stats');
            }
            atkRow.appendChild(h('span', 'tools-atk-flavor', atkFlavor.join(' · ')));
            stats.appendChild(atkRow);

            const dmgRow = h('div', 'tools-atk-line');
            const dmgVal = ctx.damageFormula
                || (ctx.wStats?.dice ? ctx.wStats.dice : null)
                || '—';
            dmgRow.append(
                h('span', 'tools-atk-kind', 'Damage'),
                h('span', 'tools-atk-value', dmgVal),
            );
            const dmgFlavor = [];
            if (ctx.wStats?.parts?.length) {
                const types = [...new Set(ctx.wStats.parts.flatMap((p) => p.types || []).filter(Boolean))];
                if (types.length) dmgFlavor.push(types.join('/'));
            }
            if (ctx.dmgAbKey) dmgFlavor.push(ctx.dmgAbKey.toUpperCase());
            if (ctx.enh) dmgFlavor.push('enh ' + fmt(ctx.enh));
            if (dmgFlavor.length) {
                dmgRow.appendChild(h('span', 'tools-atk-flavor', dmgFlavor.join(' · ')));
            }
            stats.appendChild(dmgRow);
            block.appendChild(stats);

            block.appendChild(makeAttackButtons(ctx));
            block.appendChild(oneOffBox());
            const routines = renderRoutinePanel();
            if (routines) block.appendChild(routines);
            if (showConditionals) {
                const condHost = h('div', 'cond-panel-host');
                block.appendChild(condHost);
                renderConditionalPanel(condHost);
            }
            host.appendChild(block);
        } else {
            host.appendChild(h('p', 'tools-empty', 'No equipped weapon on this character.'));
            host.appendChild(oneOffBox());
            // Natural-attack-only characters still get routines (all-natural lines).
            const routines = renderRoutinePanel();
            if (routines) host.appendChild(routines);
            if (showConditionals) {
                const condHost = h('div', 'cond-panel-host');
                host.appendChild(condHost);
                renderConditionalPanel(condHost);
            }
        }

        if (showGeneric) {
            const gen = h('div', 'tools-atk-block');
            gen.appendChild(h('div', 'tools-atk-name', 'Generic'));
            const gRow = h('div', 'tools-btn-row no-print');
            const mBtn = h('button', null, `Melee ${fmt(ctx.meleeBonus)}`);
            mBtn.type = 'button';
            mBtn.addEventListener('click', () => {
                const ca = conditionalAtkBonus('normal', undefined, { ranged: false });
                const ooAtk = rollOneOffAtk(takeOneOff());
                const bonus = ctx.meleeBonus + ca.total + (ooAtk?.value || 0);
                const atk = rollD20Attack(bonus, 'Melee attack', {
                    confirm: true,
                    getConfirmBonus: () => {
                        const cc = conditionalAtkBonus('crit', undefined, { ranged: false });
                        return {
                            bonus: ctx.meleeBonusConfirm + cc.total + (ooAtk?.value || 0),
                            cond: cc,
                        };
                    },
                    bonusLines: [
                        { label: 'BAB', value: ctx.bab },
                        { label: 'STR', value: ctx.strM },
                        ...ca.bits.map((b) => ({ label: b.source, value: b.value })),
                        ...(ooAtk ? [ooAtk.line] : []),
                    ],
                    conditionals: attackConditionalsList(ca),
                });
                pushRollCard({
                    title: currentData?.character_full_name || 'Melee',
                    subtitle: 'Melee attack',
                    attacks: [atk],
                    damages: [],
                    riders: collectRiders(ca.riders),
                });
            });
            const rBtn = h('button', null, `Ranged ${fmt(ctx.rangedBonus)}`);
            rBtn.type = 'button';
            rBtn.addEventListener('click', () => {
                const ca = conditionalAtkBonus('normal', undefined, { ranged: true });
                const ooAtk = rollOneOffAtk(takeOneOff());
                const bonus = ctx.rangedBonus + ca.total + (ooAtk?.value || 0);
                const atk = rollD20Attack(bonus, 'Ranged attack', {
                    confirm: true,
                    getConfirmBonus: () => {
                        const cc = conditionalAtkBonus('crit', undefined, { ranged: true });
                        return {
                            bonus: ctx.rangedBonusConfirm + cc.total + (ooAtk?.value || 0),
                            cond: cc,
                        };
                    },
                    bonusLines: [
                        { label: 'BAB', value: ctx.bab },
                        { label: 'DEX', value: ctx.dexM },
                        ...ca.bits.map((b) => ({ label: b.source, value: b.value })),
                        ...(ooAtk ? [ooAtk.line] : []),
                    ],
                    conditionals: attackConditionalsList(ca),
                });
                pushRollCard({
                    title: currentData?.character_full_name || 'Ranged',
                    subtitle: 'Ranged attack',
                    attacks: [atk],
                    damages: [],
                    riders: collectRiders(ca.riders),
                });
            });
            gRow.append(mBtn, rBtn);
            gen.appendChild(gRow);
            host.appendChild(gen);
        }
    }

    function renderAttacks() {
        renderAttackCard(document.getElementById('tools-attacks'), {
            showConditionals: true,
            showGeneric: true,
            roundStrip: true,
        });
        // Combat tab host if present
        const combatHost = document.getElementById('combat-attack-panel');
        if (combatHost) {
            renderAttackCard(combatHost, { showConditionals: true, showGeneric: true });
        }
    }

    // ---------------------------------------------------------------- freeform dice UI
    function doFreeformRoll() {
        const input = document.getElementById('tools-dice-input');
        const err = document.getElementById('tools-dice-error');
        if (!input) return;
        const result = roll(input.value);
        if (!result.ok) {
            if (err) err.textContent = result.error;
            return;
        }
        if (err) err.textContent = '';
        pushLog('/roll ' + result.formula, result.detail, result.total);
    }

    // Note: quick-dice and freeform use pushLog → dice SFX automatically.

    // ---------------------------------------------------------------- drawer open/close
    // Open/close/resize all belong to the shared SheetEdgePanel (scripts/edgepanel.js); this
    // keeps the same three functions as its public face so nothing else has to know.
    let drawerPanel = null;

    function isOpen() {
        return document.body.classList.contains('tools-open');
    }

    function setOpen(open) {
        if (drawerPanel) (open ? drawerPanel.open() : drawerPanel.close());
    }

    function toggle() {
        drawerPanel?.toggle();
    }

    // ---------------------------------------------------------------- drawer resize
    const TOOLS_DEFAULT_W = 320;   // ≈ 20rem, the original fixed width
    const TOOLS_MIN_W = 220;       // usable floor while resizing
    const TOOLS_CLOSE_AT = 140;    // release narrower than this → close (acts like ×)

    function initDrawer() {
        const drawer = document.getElementById('tools-drawer');
        const toggleBtn = document.getElementById('tools-toggle');
        if (!drawer || !window.SheetEdgePanel) return;
        drawerPanel = window.SheetEdgePanel.attach({
            side: 'left',
            panel: drawer,
            handle: toggleBtn,
            grip: document.getElementById('tools-resize'),
            openClass: 'tools-open',
            resizingClass: 'tools-resizing',
            keys: { open: TOOLS_OPEN_KEY, size: TOOLS_WIDTH_KEY },
            min: TOOLS_MIN_W,
            closeAt: TOOLS_CLOSE_AT,
            defaultSize: TOOLS_DEFAULT_W,
            defaultOpen: false,
            applySize: (px) => {
                document.documentElement.style.setProperty('--tools-width', px + 'px');
            },
            onToggle: (open) => {
                if (toggleBtn) {
                    toggleBtn.title = (open ? 'Close tools menu' : 'Open tools menu')
                        + ' · hold and drag to resize';
                }
            },
        });
    }


    // ---------------------------------------------------------------- public
    function setCharacter(data) {
        currentData = data && typeof data === 'object' && !data.error ? data : null;
        seedConditionals(currentData);
        renderAttacks();
    }

    // Save-vs-DC quick row (#20): Fort/Ref/Will segmented control + DC input + Roll.
    // A filled DC stamps PASS/FAIL on the card; an empty DC just rolls. One surface only.
    function initSaveRow() {
        const host = document.getElementById('tools-save-row');
        if (!host) return;
        let save = 'fort';
        const seg = h('div', 'tools-save-seg');
        const segBtns = {};
        for (const [id, label] of [['fort', 'Fort'], ['ref', 'Ref'], ['will', 'Will']]) {
            const b = h('button', 'tools-quick tools-save-pick' + (id === save ? ' is-on' : ''), label);
            b.type = 'button';
            b.addEventListener('click', () => {
                save = id;
                for (const [k, el] of Object.entries(segBtns)) {
                    el.classList.toggle('is-on', k === save);
                }
            });
            segBtns[id] = b;
            seg.appendChild(b);
        }
        const dcInput = h('input', 'edit-field tools-save-dc');
        dcInput.type = 'number';
        dcInput.placeholder = 'DC';
        dcInput.min = '0';
        const go = h('button', 'tools-quick tools-save-go', 'Save');
        go.type = 'button';
        go.title = 'Roll the selected save; with a DC filled in the card stamps PASS/FAIL';
        const doSave = () => {
            if (!currentData) {
                pushLog('Save', 'Load a character first.', null, { sound: false });
                return;
            }
            const labels = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' };
            const total = Number(window.SheetDerive?.computeDerived?.(currentData)
                ?.blocks?.[save]?.total) || 0;
            const r = roll('1d20' + (total ? (total > 0 ? '+' : '') + total : ''));
            if (!r.ok) return;
            const dc = dcInput.value.trim() === '' ? null : Number(dcInput.value);
            const title = `${labels[save]} save` + (dc != null ? ` vs DC ${dc}` : '');
            const stamp = dc != null ? ` · ${r.total >= dc ? 'PASS ✓' : 'FAIL ✗'}` : '';
            pushLog(title, r.detail + stamp, r.total);
        };
        go.addEventListener('click', doSave);
        dcInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                doSave();
            }
        });
        host.append(seg, dcInput, go);
    }

    function init() {
        const closeBtn = document.getElementById('tools-close');
        const rollBtn = document.getElementById('tools-dice-roll');
        const input = document.getElementById('tools-dice-input');
        const quick = document.getElementById('tools-quick-dice');

        // The ☰ toggle's own click/drag wiring lives in SheetEdgePanel.
        if (closeBtn) closeBtn.addEventListener('click', () => setOpen(false));
        if (rollBtn) rollBtn.addEventListener('click', doFreeformRoll);
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    doFreeformRoll();
                }
            });
        }
        if (quick) {
            for (const sides of QUICK_DICE) {
                const b = h('button', 'tools-quick', 'd' + sides);
                b.type = 'button';
                b.addEventListener('click', () => {
                    if (input) input.value = '/roll d' + sides;
                    const result = roll('d' + sides);
                    if (result.ok) pushLog('/roll d' + sides, result.detail, result.total);
                });
                quick.appendChild(b);
            }
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen()) setOpen(false);
        });

        initSaveRow();
        initSectionMinimize();
        initDrawer();   // attaches SheetEdgePanel, which restores the stored width + open state
        renderLog();
        renderAttacks();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        parseFormula,
        roll,
        rollAndLog,
        setCharacter,
        setOpen,
        toggle,
        renderAttackCard,
        renderConditionalPanel,
        highlightInlineRolls,
        rollWeaponAttack: doWeaponAttack,
        rollDamage: doDamageOnly,
        renderRoundStrip,
        aooMaxFor,
        rollWeaponAttackFor: (itemKey, opts = {}) => doWeaponAttack({ ...opts, itemKey }),
        rollDamageFor: (itemKey) => doDamageOnly({ itemKey }),
        rollSpellCast,
        hasFeat: (data, name) => hasFeat(data || currentData, name),
        attackContext: (itemKey) => attackContext(currentData, itemKey),
    };
})();
