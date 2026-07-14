// Tools drawer + shared combat rolls: freeform dice, weapon attacks, Foundry-style conditionals.
// Results stay on-page (roll log); this is a standalone sheet, not Foundry chat.

window.SheetRoll = (function () {
    'use strict';

    const TOOLS_OPEN_KEY = 'sheet.toolsOpen';
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

    // Strip Foundry source labels like "1d6[Power Attack]" and @INITMOD.
    function cleanFormula(formula, data) {
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
     * Expand Foundry spell formulas for rolling: @cl, @sl, @ablMod, ability mods,
     * then simple min()/max() and (N)dX so parseFormula can handle the result.
     */
    function expandSpellFormula(formula, ctx) {
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
                dmgTotal += r.total;
                const rolls = r.parts.filter((x) => x.kind === 'dice').flatMap((x) => x.rolls);
                const shown = rolls.length ? '[' + rolls.join(', ') + ']' : String(r.total);
                parts.push({
                    label: (parsed.formula || expanded) + (types ? ' ' + types : ''),
                    detail: shown + ' → ' + r.total,
                    value: r.total,
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

        // If nothing mechanical rolled, still log a "cast" card with riders
        pushRollCard({
            title: name,
            subtitle: [
                'Spell L' + level,
                school,
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

    function sumNumericChanges(targets) {
        // window.sheetChanges is already filtered by per-buff toggles (effectiveLedger)
        const ledger = window.sheetChanges;
        if (!ledger?.changes?.length) return { total: 0, bits: [] };
        const want = new Set(targets);
        let total = 0;
        const bits = [];
        for (const c of ledger.changes) {
            if (!want.has(c.target)) continue;
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

    function attackContext(data) {
        if (!data || data.error) return null;
        const bab = Number(data.bab_total) || 0;
        const strM = abilityMod(data, 'str');
        const dexM = abilityMod(data, 'dex');
        const enh = parseEnhancementBonus(data.weapon_enhancement_chosen_list);
        const wName = (data.weapon_name || '').trim();
        const wStats = wName ? (window.SheetDetails?.lookupWeapon(wName) || null) : null;
        const ranged = wStats ? isRangedAction(wStats.actionType) : false;
        const abKey = ranged ? 'dex' : 'str';
        const abMod = ranged ? dexM : strM;
        const dmgAbKey = (wStats?.damageAbility || 'str').toLowerCase();
        const dmgAbMod = abilityMod(data, dmgAbKey);
        const atkTargets = ranged ? ['attack', 'rattack'] : ['attack', 'mattack'];
        const dmgTargets = ranged ? ['damage', 'rdamage', 'wdamage'] : ['damage', 'mdamage', 'wdamage'];
        const atkChanges = sumNumericChanges(atkTargets);
        const dmgChanges = sumNumericChanges(dmgTargets);
        const meleeBonus = bab + strM + sumNumericChanges(['attack', 'mattack']).total;
        const rangedBonus = bab + dexM + sumNumericChanges(['attack', 'rattack']).total;
        const weaponBonus = bab + abMod + enh + atkChanges.total;
        const damageFlat = dmgAbMod + enh + dmgChanges.total;
        const damageDice = wStats?.dice || '';
        const damageFormula = formatDamageFormula(damageDice, damageFlat);

        return {
            bab, strM, dexM, enh, wName, wStats, ranged, abKey, abMod,
            dmgAbKey, dmgAbMod, damageFlat, damageDice, damageFormula,
            atkChanges, dmgChanges,
            meleeBonus, rangedBonus, weaponBonus,
            label: weaponLabel(data),
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

    function activeList() {
        return availableConditionals.filter((c) => activeConditionals.get(c.id));
    }

    /**
     * Evaluate checked conditionals for attack or damage.
     * @param {'attack'|'damage'} kind
     * @param {{ isCrit?: boolean }} opts
     */
    function evaluateConditionals(kind, opts = {}) {
        const data = currentData;
        let flat = 0;
        const bits = [];
        const diceParts = []; // { formula, source, rolled? }
        const riders = [];

        for (const cond of activeList()) {
            if (cond.rider) riders.push({ source: cond.source, text: cond.rider });
            for (const m of cond.modifiers || []) {
                const tgt = m.subTarget || m.target || '';
                const isAtk = isAttackTarget(tgt) || (m.target === 'attack');
                const isDmg = isDamageTarget(tgt) || (m.target === 'damage');
                if (kind === 'attack' && !isAtk) continue;
                if (kind === 'damage' && !isDmg) continue;

                const crit = String(m.critical || 'normal');
                if (kind === 'damage') {
                    if (crit === 'crit' && !opts.isCrit) continue;
                    if (crit === 'nonCrit' && opts.isCrit) continue;
                }

                let formula = cleanFormula(m.formula, data);
                if (!formula) continue;
                // Integer only?
                if (/^[+-]?\d+$/.test(formula)) {
                    const n = Number(formula);
                    flat += n;
                    bits.push({ source: cond.source, value: n, formula });
                    continue;
                }
                // Dice or compound — parse if possible
                const parsed = parseFormula(formula);
                if (parsed.ok) {
                    const hasDice = parsed.terms.some((t) => t.type === 'dice');
                    if (!hasDice) {
                        const r = rollTerms(parsed.terms);
                        flat += r.total;
                        bits.push({ source: cond.source, value: r.total, formula: parsed.formula });
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
        for (const p of diceParts) {
            const r = rollTerms(p.terms);
            total += r.total;
            const shown = r.parts.filter((x) => x.kind === 'dice')
                .map((x) => x.label + ':' + (x.rolls.length === 1 ? x.rolls[0] : '[' + x.rolls.join(', ') + ']'))
                .join(' ');
            details.push(`${p.formula} (${p.source}) ${shown || r.total}`);
        }
        return { total, details };
    }

    function expandRiderInlineRolls(text, data) {
        // Replace [[ formula ]] with rolled totals, keeping [[total]] so the
        // log still chips the result (and hover shows the original formula).
        return String(text || '').replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
            const raw = String(inner || '').trim();
            let f = cleanFormula(inner, data);
            const parsed = parseFormula(f);
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

    function renderConditionalPanel(host) {
        if (!host) return;
        host.innerHTML = '';
        host.classList.add('cond-panel');
        if (!currentData) {
            host.appendChild(h('p', 'tools-empty', 'Load a character for conditionals.'));
            return;
        }
        if (!availableConditionals.length) {
            host.appendChild(h('p', 'tools-empty', 'No per-roll conditionals for this character.'));
            return;
        }
        host.appendChild(h('div', 'cond-panel-title', 'Conditionals (apply to next roll)'));
        const list = h('div', 'cond-list');
        for (const c of availableConditionals) {
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
            list.appendChild(row);
        }
        host.appendChild(list);
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
                detailLines.push({
                    label: 'Confirm d20',
                    value: `${atk.confirm.natural} ${fmt(atk.bonus)} = ${atk.confirm.total}`,
                });
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

    function renderDamageBlock(dmg) {
        const block = h('div', 'roll-card-block roll-card-damage');
        const summary = h('div', 'roll-card-summary');
        summary.appendChild(h('span', 'roll-card-kind',
            dmg.critMult > 1 ? `Damage (×${dmg.critMult})` : 'Damage'));
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
        if (threatened && opts.confirm) {
            confirmNatural = randomInt(1, 20);
            confirmTotal = confirmNatural + bonus;
        }
        return {
            label: label || 'Attack',
            natural,
            total,
            bonus,
            critRange,
            threatened,
            confirm: confirmNatural != null
                ? { natural: confirmNatural, total: confirmTotal }
                : null,
            bonusLines: opts.bonusLines || [],
            conditionals: opts.conditionals || [],
        };
    }

    function conditionalAtkBonus() {
        const ev = evaluateConditionals('attack');
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

    function rollDamage(ctx, { critMult = 1, isCrit = false } = {}) {
        const w = ctx.wStats;
        const cond = evaluateConditionals('damage', { isCrit: isCrit || critMult > 1 });
        const condDice = rollConditionalDice(cond.diceParts);

        if (!w?.dice && !w?.parts?.length) {
            if (!cond.flat && !condDice.total) {
                return null;
            }
        }

        let diceTotal = 0;
        const parts = [];
        let diceFlavor = '';
        if (w?.parts?.length || w?.dice) {
            const wparts = w.parts?.length ? w.parts : [{ dice: w.dice, types: [] }];
            for (const p of wparts) {
                const parsed = parseFormula(p.dice);
                if (!parsed.ok) continue;
                const r = rollTerms(parsed.terms);
                const sub = r.total * critMult;
                diceTotal += sub;
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
        const flat = abMod + ctx.enh + ctx.dmgChanges.total + cond.flat + condDice.total;
        const total = diceTotal + flat;

        if (abMod) parts.push({ label: (w.damageAbility || 'str').toUpperCase(), value: abMod });
        if (ctx.enh) parts.push({ label: 'Enhancement', value: ctx.enh });
        for (const b of ctx.dmgChanges.bits) parts.push({ label: b.source, value: b.value });
        for (const b of cond.bits) parts.push({ label: b.source + ' (cond)', value: b.value });
        for (const d of condDice.details) parts.push({ label: 'Cond dice', detail: d });

        return {
            total,
            diceTotal,
            flat,
            critMult,
            diceFlavor,
            parts,
            conditionals: [
                ...(cond.bits || []).map((b) => ({ source: b.source, value: b.value })),
                ...(condDice.details || []).map((d) => ({ source: 'dice', value: d })),
            ],
            riders: cond.riders || [],
        };
    }

    function doWeaponAttack({ full = false, withDamage = true } = {}) {
        const ctx = attackContext(currentData);
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
        const attacks = [];
        const damages = [];
        const riderLists = [];

        for (let i = 0; i < count; i++) {
            const pen = i * 5;
            const condThis = conditionalAtkBonus();
            riderLists.push(condThis.riders);
            const bonus = ctx.weaponBonus + condThis.total - pen;
            const iterLabel = full
                ? (count > 1 ? `Attack #${i + 1}` : 'Attack')
                : 'Attack';
            const atk = rollD20Attack(bonus, iterLabel, {
                critRange,
                confirm: true,
                bonusLines: attackBonusLines(ctx, condThis, pen),
                conditionals: attackConditionalsList(condThis),
            });
            attacks.push(atk);
            if (withDamage) {
                const mult = (atk.threatened && atk.confirm?.natural !== 1) ? critMult : 1;
                const dmg = rollDamage(ctx, { critMult: mult, isCrit: mult > 1 });
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

    function doDamageOnly() {
        const ctx = attackContext(currentData);
        if (!ctx) {
            pushLog('Damage', 'Load a character first.', null, { sound: false });
            return;
        }
        if (!ctx.wName) {
            pushLog('Damage', 'No weapon on this character.', null, { sound: false });
            return;
        }
        const dmg = rollDamage(ctx, { critMult: 1, isCrit: false });
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

    // ---------------------------------------------------------------- attack UI (tools + combat)
    function makeAttackButtons(ctx) {
        const row = h('div', 'tools-btn-row combat-atk-btns no-print');
        const atkBonus = ctx.weaponBonus + (conditionalAtkBonus().flat || 0);
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

    function renderAttackCard(host, { showConditionals = true, showGeneric = true } = {}) {
        if (!host) return;
        host.innerHTML = '';
        const ctx = attackContext(currentData);
        if (!ctx) {
            host.appendChild(h('p', 'tools-empty', 'Load a character to roll attacks.'));
            return;
        }

        if (ctx.wName) {
            const block = h('div', 'tools-atk-block combat-atk-card');
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
            if (showConditionals) {
                const condHost = h('div', 'cond-panel-host');
                block.appendChild(condHost);
                renderConditionalPanel(condHost);
            }
            host.appendChild(block);
        } else {
            host.appendChild(h('p', 'tools-empty', 'No equipped weapon on this character.'));
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
                const ca = conditionalAtkBonus();
                const bonus = ctx.meleeBonus + ca.total;
                const atk = rollD20Attack(bonus, 'Melee attack', {
                    confirm: true,
                    bonusLines: [
                        { label: 'BAB', value: ctx.bab },
                        { label: 'STR', value: ctx.strM },
                        ...ca.bits.map((b) => ({ label: b.source, value: b.value })),
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
                const ca = conditionalAtkBonus();
                const bonus = ctx.rangedBonus + ca.total;
                const atk = rollD20Attack(bonus, 'Ranged attack', {
                    confirm: true,
                    bonusLines: [
                        { label: 'BAB', value: ctx.bab },
                        { label: 'DEX', value: ctx.dexM },
                        ...ca.bits.map((b) => ({ label: b.source, value: b.value })),
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
    function isOpen() {
        return document.body.classList.contains('tools-open');
    }

    function setOpen(open) {
        document.body?.classList.toggle('tools-open', open);
        try { localStorage.setItem(TOOLS_OPEN_KEY, open ? '1' : '0'); } catch { /* private mode */ }
        const btn = document.getElementById('tools-toggle');
        if (btn) {
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            btn.title = open ? 'Close tools menu' : 'Open tools menu';
        }
        const panel = document.getElementById('tools-drawer');
        if (panel) panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    }

    function toggle() {
        setOpen(!isOpen());
    }

    // ---------------------------------------------------------------- public
    function setCharacter(data) {
        currentData = data && typeof data === 'object' && !data.error ? data : null;
        seedConditionals(currentData);
        renderAttacks();
    }

    function init() {
        const toggleBtn = document.getElementById('tools-toggle');
        const closeBtn = document.getElementById('tools-close');
        const rollBtn = document.getElementById('tools-dice-roll');
        const input = document.getElementById('tools-dice-input');
        const quick = document.getElementById('tools-quick-dice');

        if (toggleBtn) toggleBtn.addEventListener('click', toggle);
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

        initSectionMinimize();
        setOpen(localStorage.getItem(TOOLS_OPEN_KEY) === '1');
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
        rollSpellCast,
        attackContext: () => attackContext(currentData),
    };
})();
