// scripts/domain/formula.js -- the formula domain (window.SheetFormula): resolve the `@` variables
// a Foundry pf1 formula refers to, evaluate the arithmetic around them, and hand the result back as
// something the dice engine can roll.
//
// Why this exists: the curated conditional data (weapon qualities, class-feature powers, maneuvers)
// speaks real pf1 formula language -- `1 + floor(@classes.barbarian.level / 4)`,
// `ifelse(gte(@classes.vigilante.level, 8), 2, 1)`, `min(@classes.oracle.level, 10)`. The old
// roll.js helpers could not express any of that: cleanFormula() replaced every `@token` with `0`
// and parseFormula() tokenizes only `±NdS` / `±N` terms, so a level-scaled bonus silently became a
// flat `1` and nobody could tell. Rather than grow another regex cascade, this module does the job
// properly: variable resolution, then a real expression parser, then dice-term extraction.
//
// Loaded BEFORE roll.js (it is roll.js's evaluator), and reaches SheetDerive / SheetClassInfo only
// at call time, so their later load positions in index.html are fine.
window.SheetFormula = (function () {
    'use strict';

    const abilityMod = (score) => Math.floor(((Number(score) || 10) - 10) / 2);

    // ------------------------------------------------------------------ stage A: variables
    /**
     * Level of one named class, STRICTLY. SheetClassInfo.classLevelFor falls back to the whole
     * character level when the class isn't on the sheet, which is right for a class card label and
     * badly wrong here: `@classes.barbarian.level` on a character with no barbarian levels must be
     * 0, not 12, or a mis-keyed formula quietly scales off an unrelated class. The lenient fallback
     * is kept only for legacy payloads that have no `classes[]` at all.
     */
    function classLevel(data, clsName) {
        const key = String(clsName || '').toLowerCase().trim();
        if (Array.isArray(data?.classes)) {
            const hit = data.classes.find((c) => String(c?.name || '').toLowerCase().trim() === key
                || String(c?.display || '').toLowerCase().trim() === key);
            return Number(hit?.level) || 0;
        }
        return Number(window.SheetClassInfo?.classLevelFor?.(data, clsName)) || 0;
    }

    /** Effective ability score -- includes items/buffs/misc, not the raw base in data[ab]. */
    function abilityTotal(data, ab) {
        const key = String(ab || '').toLowerCase();
        const info = window.SheetDerive?.abilityInfo?.(data, key);
        if (info && info.total != null) return Number(info.total) || 0;
        return Number(data?.[key]) || 0;
    }

    function characterLevel(data) {
        return Number(window.SheetDerive?.totalLevel?.(data))
            || Number(data?.total_level) || Number(data?.level) || 0;
    }

    // Each entry: [pattern, resolver]. Resolvers return a number, or null to leave the token
    // unresolved. Ordered most-specific-first; every pattern must be global + case-insensitive.
    const VARS = [
        [/@INITMOD\b/gi, (_m, data, ctx) => ctx.INITMOD ?? null],
        // Path of War initiator level -- the payload ships it, and maneuver riders ask for it by this
        // name alongside the @INITMOD they already resolve.
        [/@pow\.initLevel\b/gi, (_m, data) => Number(data?.initiator_level) || null],
        [/@abilities\.([a-z]+)\.mod\b/gi, (m, data) => abilityMod(abilityTotal(data, m[1]))],
        [/@abilities\.([a-z]+)\.total\b/gi, (m, data) => abilityTotal(data, m[1])],
        [/@classes\.([a-z0-9_-]+)\.level\b/gi, (m, data) => classLevel(data, m[1])],
        // Foundry's "the class that granted this item" shorthand; on a single-class sheet it is the
        // character level, which is what the curated contextNotes assume.
        [/@class\.level\b/gi, (_m, data) => characterLevel(data)],
        [/@attributes\.hd\.total\b/gi, (_m, data) => characterLevel(data)],
        [/@attributes\.bab\.total\b/gi, (_m, data) => Number(data?.bab_total) || 0],
        [/@cl\b/gi, (_m, data, ctx) => ctx.cl ?? null],
        [/@sl\b/gi, (_m, data, ctx) => ctx.sl ?? null],
        [/@ablMod\b/gi, (_m, data, ctx) => ctx.ablMod ?? null],
    ];

    /** Register another `@token` resolver at runtime. Pattern must be a global RegExp. */
    function registerVar(pattern, fn) {
        VARS.unshift([pattern, fn]);
    }

    /**
     * Substitute every `@token` we know how to resolve; leave the rest ALONE and report them.
     * Deliberately not the old zero-substitution: a formula that silently becomes `0 + 1` looks
     * like a working `1`, whereas a formula that still reads `@bogus + 1` fails loudly and the
     * caller can show the user which reference it could not follow.
     */
    function resolveVars(formula, data, extraCtx) {
        let s = String(formula ?? '');
        const ctx = extraCtx || {};
        for (const [pattern, fn] of VARS) {
            pattern.lastIndex = 0;
            s = s.replace(pattern, (...args) => {
                const m = args.slice(0, -2);
                let val = null;
                try {
                    val = fn(m, data, ctx);
                } catch (err) {
                    val = null;
                }
                if (val == null || !Number.isFinite(Number(val))) return m[0];
                const n = Number(val);
                // Parenthesized so a negative mod keeps its meaning inside `2 * @abilities.str.mod`.
                return n < 0 ? '(' + n + ')' : String(n);
            });
        }
        const unresolved = [...new Set(s.match(/@[a-zA-Z0-9_.]+/g) || [])];
        return { formula: s, unresolved };
    }

    // ------------------------------------------------------------------ stage B: tokenize + parse
    const TOKENS = [
        ['ws', /^\s+/],
        ['dice', /^(\d*)d(\d+)/i],
        ['num', /^\d+(?:\.\d+)?/],
        ['ident', /^[a-zA-Z_][a-zA-Z0-9_]*/],
        ['at', /^@[a-zA-Z0-9_.]+/],
        ['punct', /^[+\-*/(),]/],
    ];

    function tokenize(src) {
        const out = [];
        let s = String(src);
        let pos = 0;
        while (s.length) {
            let matched = false;
            for (const [kind, re] of TOKENS) {
                const m = re.exec(s);
                if (!m) continue;
                matched = true;
                if (kind === 'dice') {
                    // `explicit` records whether a COUNT was written. It distinguishes a plain `d6`
                    // from the `d6` tail of `(floor(@classes.magus.level / 3))d6`, where the count is
                    // the preceding parenthesized expression -- see primary().
                    out.push({ kind, n: m[1] === '' ? 1 : Number(m[1]), sides: Number(m[2]),
                        explicit: m[1] !== '', pos });
                } else if (kind === 'num') {
                    out.push({ kind, value: Number(m[0]), pos });
                } else if (kind !== 'ws') {
                    out.push({ kind, text: m[0], pos });
                }
                s = s.slice(m[0].length);
                pos += m[0].length;
                break;
            }
            if (!matched) throw new Error(`unexpected character "${s[0]}" at ${pos}`);
        }
        return out;
    }

    const FUNCS = {
        floor: [1, (a) => Math.floor(a)],
        ceil: [1, (a) => Math.ceil(a)],
        round: [1, (a) => Math.round(a)],
        abs: [1, (a) => Math.abs(a)],
        sign: [1, (a) => Math.sign(a)],
        min: [-1, (...a) => Math.min(...a)],
        max: [-1, (...a) => Math.max(...a)],
        eq: [2, (a, b) => (a === b ? 1 : 0)],
        gt: [2, (a, b) => (a > b ? 1 : 0)],
        gte: [2, (a, b) => (a >= b ? 1 : 0)],
        lt: [2, (a, b) => (a < b ? 1 : 0)],
        lte: [2, (a, b) => (a <= b ? 1 : 0)],
        ifelse: [3, (c, a, b) => (c ? a : b)],
    };

    const PREC = { '+': 1, '-': 1, '*': 2, '/': 2 };

    /** Precedence-climbing parser. Needed over regex collapsing: `ifelse` is 3-arity and the
     *  precedence between `*` and `+` has to be real, neither of which a regex pass can express. */
    function parse(tokens) {
        let i = 0;
        const peek = () => tokens[i];
        const eat = (text) => {
            const t = tokens[i];
            if (!t || t.kind !== 'punct' || t.text !== text) {
                throw new Error(`expected "${text}"` + (t ? ` at ${t.pos}` : ' at end of formula'));
            }
            i += 1;
            return t;
        };

        // `(expr)d6` / `min(2, @cl)d6` — a COMPUTED DICE COUNT. 54 curated class-feature formulas
        // scale the number of dice off a class level, so a group or call followed by an
        // implicit-count die means "roll that many". Only an implicit-count `d6` binds this way, so
        // `(1+2)2d6` stays the syntax error it is.
        function diceTail(count) {
            const next = peek();
            if (next && next.kind === 'dice' && !next.explicit) {
                i += 1;
                return { type: 'dicecount', count, sides: next.sides };
            }
            return count;
        }

        function primary() {
            const t = peek();
            if (!t) throw new Error('unexpected end of formula');
            if (t.kind === 'at') throw new Error(`unresolved variable ${t.text}`);
            if (t.kind === 'num') { i += 1; return { type: 'num', value: t.value }; }
            if (t.kind === 'dice') { i += 1; return { type: 'dice', n: t.n, sides: t.sides }; }
            if (t.kind === 'ident') {
                const name = t.text.toLowerCase();
                if (!FUNCS[name]) throw new Error(`unknown function "${t.text}"`);
                i += 1;
                eat('(');
                const args = [];
                if (!(peek() && peek().kind === 'punct' && peek().text === ')')) {
                    args.push(expr(1));
                    while (peek() && peek().kind === 'punct' && peek().text === ',') {
                        i += 1;
                        args.push(expr(1));
                    }
                }
                eat(')');
                const arity = FUNCS[name][0];
                if (arity >= 0 && args.length !== arity) {
                    throw new Error(`${name}() takes ${arity} argument(s), got ${args.length}`);
                }
                if (arity < 0 && !args.length) throw new Error(`${name}() needs arguments`);
                return diceTail({ type: 'call', name, args });
            }
            if (t.kind === 'punct' && t.text === '(') {
                i += 1;
                const inner = expr(1);
                eat(')');
                return diceTail(inner);
            }
            throw new Error(`unexpected "${t.text ?? t.kind}" at ${t.pos}`);
        }

        function unary() {
            const t = peek();
            if (t && t.kind === 'punct' && (t.text === '-' || t.text === '+')) {
                i += 1;
                const x = unary();
                return t.text === '-' ? { type: 'neg', x } : x;
            }
            return primary();
        }

        function expr(minPrec) {
            let left = unary();
            for (;;) {
                const t = peek();
                if (!t || t.kind !== 'punct' || !(t.text in PREC)) break;
                const prec = PREC[t.text];
                if (prec < minPrec) break;
                i += 1;
                const right = expr(prec + 1);
                left = { type: 'bin', op: t.text, l: left, r: right };
            }
            return left;
        }

        const ast = expr(1);
        if (i < tokens.length) {
            const t = tokens[i];
            throw new Error(`unexpected "${t.text ?? t.kind}" at ${t.pos}`);
        }
        return ast;
    }

    // ------------------------------------------------------------------ stage C: fold, keep dice
    // A folded value is { flat, dice: [{ sign, n, sides }] }. Arithmetic on the additive chain keeps
    // dice terms intact so `2d6 + floor(@classes.oracle.level / 2)` still ROLLS its 2d6; everything
    // else collapses to a number. Dice inside a function call or a `*`/`/` are rejected rather than
    // silently averaged -- no curated formula does that, and guessing would be worse than failing.
    const numVal = (v) => ({ flat: v, dice: [] });
    const isPure = (v) => !v.dice.length;

    function pureNumber(v, what) {
        if (!isPure(v)) throw new Error(`dice are not supported ${what}`);
        return v.flat;
    }

    function fold(node) {
        switch (node.type) {
            case 'num':
                return numVal(node.value);
            case 'dice':
                return { flat: 0, dice: [{ sign: 1, n: node.n, sides: node.sides }] };
            case 'dicecount': {
                const n = Math.floor(pureNumber(fold(node.count), 'as a dice count'));
                // A count that scales from level can legitimately be 0 at low level (`(floor(lvl/3))d6`
                // below 3rd) -- that is "no dice", not "one die".
                if (!(n > 0)) return numVal(0);
                return { flat: 0, dice: [{ sign: 1, n, sides: node.sides }] };
            }
            case 'neg': {
                const x = fold(node.x);
                return { flat: -x.flat, dice: x.dice.map((d) => ({ ...d, sign: -d.sign })) };
            }
            case 'bin': {
                const l = fold(node.l);
                const r = fold(node.r);
                if (node.op === '+') return { flat: l.flat + r.flat, dice: [...l.dice, ...r.dice] };
                if (node.op === '-') {
                    return { flat: l.flat - r.flat,
                        dice: [...l.dice, ...r.dice.map((d) => ({ ...d, sign: -d.sign }))] };
                }
                const a = pureNumber(l, `on the left of "${node.op}"`);
                const b = pureNumber(r, `on the right of "${node.op}"`);
                if (node.op === '/') {
                    if (b === 0) throw new Error('division by zero');
                    return numVal(a / b);
                }
                return numVal(a * b);
            }
            case 'call': {
                const args = node.args.map((a, idx) =>
                    pureNumber(fold(a), `as argument ${idx + 1} of ${node.name}()`));
                return numVal(FUNCS[node.name][1](...args));
            }
            default:
                throw new Error('bad node ' + node.type);
        }
    }

    /** Render a folded value back into the `±NdS±N` shape roll.js's parseFormula understands. */
    function toFormulaString(v) {
        let out = '';
        for (const d of v.dice) {
            out += (d.sign < 0 ? '-' : '+') + d.n + 'd' + d.sides;
        }
        if (v.flat || !out) {
            const n = Number.isInteger(v.flat) ? v.flat : Math.round(v.flat * 100) / 100;
            out += (n < 0 ? '-' : '+') + Math.abs(n);
        }
        return out.replace(/^\+/, '');
    }

    // ------------------------------------------------------------------ public
    /** Strip Foundry's `1d6[Power Attack]` source labels -- flavour only, never arithmetic. */
    const stripLabels = (s) => String(s ?? '').replace(/\[[^\]]*\]/g, '');

    function run(formula, data, extraCtx) {
        const src = stripLabels(formula).trim();
        // An empty formula is a legitimate "no modifier", not an error -- but it still has to come
        // back as a FOLDED value ({flat, dice}) so evaluate()/evaluateToRollable() can read it the
        // same way they read every other result.
        if (!src) return { ok: true, value: numVal(0), formula: '0', unresolved: [], dice: [] };
        const { formula: resolved, unresolved } = resolveVars(src, data, extraCtx);
        try {
            const value = fold(parse(tokenize(resolved)));
            return { ok: true, value, formula: toFormulaString(value), unresolved,
                dice: value.dice };
        } catch (err) {
            return { ok: false, value: null, formula: resolved, unresolved,
                error: err && err.message ? err.message : String(err) };
        }
    }

    /**
     * Evaluate to a single NUMBER. Fails (ok:false) when the formula still contains dice -- ask for
     * evaluateToRollable instead when a die roll is a legitimate answer.
     */
    function evaluate(formula, data, extraCtx) {
        const r = run(formula, data, extraCtx);
        if (!r.ok) return { ok: false, value: null, formula: r.formula, unresolved: r.unresolved, error: r.error };
        if (r.dice.length) {
            return { ok: false, value: null, formula: r.formula, unresolved: r.unresolved,
                error: 'formula contains dice' };
        }
        return { ok: true, value: r.value.flat, formula: r.formula, unresolved: r.unresolved };
    }

    /**
     * Evaluate everything that can be folded to constants and hand back a formula string with the
     * dice terms still in it, ready for roll.js's parseFormula/rollTerms.
     */
    function evaluateToRollable(formula, data, extraCtx) {
        const r = run(formula, data, extraCtx);
        if (!r.ok) {
            return { ok: false, formula: r.formula, unresolved: r.unresolved, error: r.error };
        }
        return { ok: true, formula: r.formula, unresolved: r.unresolved, hasDice: !!r.dice.length };
    }

    return { resolveVars, evaluate, evaluateToRollable, registerVar, stripLabels, FUNCS };
})();
