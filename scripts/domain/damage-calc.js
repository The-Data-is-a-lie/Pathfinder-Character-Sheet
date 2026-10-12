// scripts/domain/damage-calc.js -- incoming damage through DR / energy resistance / immunity /
// vulnerability (window.SheetDamageCalc, #146). Pure: no DOM, no sheet state. The Defenses-tab
// calculator, every roll-log Apply button and the Tools damage row all evaluate through
// `evaluate`, so a number on a card and a number in the calculator can never disagree.
//
// One shape goes in, everywhere:
//   incoming = { parts: [{ amount, types: ['slashing'] | ['fire'] | [] }],
//                bypass: ['magic', 'silver', …],   // what the attack overcomes
//                spell: false }                     // spells ignore DR (CRB, Damage Reduction)
// Every non-energy part is pooled into ONE physical bucket, because DR applies once per attack,
// not once per die; each energy type is its own bucket, because resistance is per type.
window.SheetDamageCalc = (function () {
    'use strict';

    const PHYSICAL_TYPES = ['slashing', 'piercing', 'bludgeoning'];
    const ENERGY_TYPES = ['fire', 'cold', 'electricity', 'acid', 'sonic', 'force',
        'negative energy', 'positive energy'];
    // Everything an attack can overcome DR with besides its own physical type.
    const BYPASS_TYPES = ['magic', 'cold iron', 'silver', 'adamantine',
        'good', 'evil', 'lawful', 'chaotic', 'epic'];
    // The type picker: physical first, then energy, then the explicit "no type" escape hatch.
    const INPUT_TYPES = [...PHYSICAL_TYPES, ...ENERGY_TYPES, 'untyped'];

    const lc = (s) => String(s ?? '').trim().toLowerCase();
    const isEnergy = (t) => ENERGY_TYPES.includes(lc(t));

    /**
     * Hand-typed chips (`_sheet.defenses`) plus chips an active buff grants
     * (`SheetDerive.grantedDefenses`, #112). Concatenated, not deduped: `evaluate` already takes
     * the best DR / resistance per kind, so a duplicate can never stack.
     */
    function effectiveDefenses(data) {
        const hand = data?._sheet?.defenses || {};
        const granted = window.SheetDerive?.grantedDefenses?.(data) || {};
        const out = {};
        for (const key of ['dr', 'resist', 'dmgImmune', 'dmgVuln']) {
            out[key] = [...(hand[key] || []), ...(granted[key] || [])];
        }
        return out;
    }

    /** Does an attack with these physical types + bypasses overcome "DR x/<bypass>"? */
    function drBypassed(bypass, physTypes, overcomes) {
        const b = lc(bypass);
        if (!b || b === '—' || b === '-') return false;
        const have = new Set([...physTypes, ...overcomes].map(lc));
        const anyMode = / or /.test(b);
        const need = b.split(/ or | and /).map((s) => s.trim()).filter(Boolean);
        return anyMode ? need.some((p) => have.has(p)) : need.every((p) => have.has(p));
    }

    const drLabel = (e) => `DR ${Number(e.amount) || 0}/${e.bypass || '—'}`;
    const typeLabel = (types) => (types.length ? types.join('/') : 'physical');

    /**
     * Run incoming damage through the defenses. Returns the net plus two views of the work:
     *   buckets — per damage bucket, raw → net with the arithmetic steps (the card note)
     *   checks  — per defense the character HAS, whether it applied, was bypassed, or did not
     *             come into play (the calculator's "which defenses matter" list)
     * `half` halves each bucket first (save made), rounding down as PF1 does.
     */
    function evaluate(incoming, defs, { half = false } = {}) {
        const parts = (incoming?.parts || [])
            .map((p) => ({ amount: Math.max(0, Math.floor(Number(p.amount) || 0)), types: (p.types || []).map(lc).filter(Boolean) }))
            .filter((p) => p.amount > 0);
        const overcomes = (incoming?.bypass || []).map(lc);
        const spell = Boolean(incoming?.spell);
        const immune = (defs?.dmgImmune || []).map((e) => lc(e.type));
        const vuln = (defs?.dmgVuln || []).map((e) => lc(e.type));
        const drs = (defs?.dr || []).filter((e) => (Number(e.amount) || 0) > 0);
        const resists = (defs?.resist || []).filter((e) => (Number(e.amount) || 0) > 0);

        // Pool into buckets: one physical, one per energy type.
        const phys = { kind: 'physical', types: [], raw: 0 };
        const energy = new Map();
        for (const p of parts) {
            const e = p.types.find(isEnergy);
            if (e) {
                const b = energy.get(e) || { kind: 'energy', types: [e], raw: 0 };
                b.raw += p.amount;
                energy.set(e, b);
            } else {
                phys.raw += p.amount;
                for (const t of p.types) {
                    if (t !== 'untyped' && !phys.types.includes(t)) phys.types.push(t);
                }
            }
        }
        const buckets = [];
        if (phys.raw > 0) buckets.push(phys);
        buckets.push(...energy.values());

        const checks = [];
        const check = (kind, label, status, note) => checks.push({ kind, label, status, note });
        let total = 0;
        let raw = 0;
        for (const b of buckets) {
            raw += b.raw;
            const steps = [];
            const name = typeLabel(b.types);
            let n = half ? Math.floor(b.raw / 2) : b.raw;
            if (half) steps.push(`${name} ${b.raw} → ${n} (half)`);
            if (b.types.length && b.types.every((t) => immune.includes(t))) {
                steps.push(`immune to ${name}: ${n} → 0`);
                check('immune', `Immune: ${name}`, 'applied', `${n} → 0`);
                b.net = 0;
                b.steps = steps;
                continue;
            }
            if (b.types.some((t) => vuln.includes(t))) {
                const v = Math.floor(n * 1.5);
                steps.push(`vulnerable (${name}): ${n} → ${v}`);
                check('vuln', `Vulnerable: ${name}`, 'applied', `${n} → ${v}`);
                n = v;
            }
            if (b.kind === 'physical') {
                if (drs.length && spell) {
                    steps.push('spell damage ignores DR');
                    for (const e of drs) check('dr', drLabel(e), 'bypassed', 'spells ignore DR');
                } else if (drs.length) {
                    const live = drs.filter((e) => !drBypassed(e.bypass, b.types, overcomes));
                    const best = live.reduce((a, e) => (!a || Number(e.amount) > Number(a.amount) ? e : a), null);
                    for (const e of drs) {
                        if (!live.includes(e)) {
                            check('dr', drLabel(e), 'bypassed', `overcome by ${e.bypass}`);
                        } else if (e !== best) {
                            check('dr', drLabel(e), 'unused', `doesn't stack — ${drLabel(best)} is higher`);
                        }
                    }
                    if (best) {
                        const after = Math.max(0, n - Number(best.amount));
                        steps.push(`${drLabel(best)}: ${n} → ${after}`);
                        check('dr', drLabel(best), 'applied', `${n} → ${after}`);
                        n = after;
                    } else {
                        steps.push(`DR bypassed (${[...b.types, ...overcomes].join(', ')})`);
                    }
                }
            } else {
                const t = b.types[0];
                const mine = resists.filter((e) => lc(e.type) === t);
                const best = mine.reduce((a, e) => Math.max(a, Number(e.amount) || 0), 0);
                if (best > 0) {
                    const after = Math.max(0, n - best);
                    steps.push(`${t} resist ${best}: ${n} → ${after}`);
                    check('resist', `Resist ${t} ${best}`, 'applied', `${n} → ${after}`);
                    n = after;
                }
            }
            b.net = n;
            b.steps = steps;
            total += n;
        }

        // Defenses that never met a matching bucket still get a line, so the calculator can say
        // "you have fire resistance 10 — not in play" instead of silently leaving it out.
        const seen = new Set(checks.map((c) => c.label));
        const note = (kind, label, why) => { if (!seen.has(label)) check(kind, label, 'idle', why); };
        if (!buckets.some((b) => b.kind === 'physical')) {
            for (const e of drs) note('dr', drLabel(e), 'no physical damage');
        }
        for (const e of resists) note('resist', `Resist ${lc(e.type)} ${Number(e.amount)}`, `no ${lc(e.type)} damage`);
        for (const t of immune) note('immune', `Immune: ${t}`, `no ${t} damage`);
        for (const t of vuln) note('vuln', `Vulnerable: ${t}`, `no ${t} damage`);

        return {
            total,
            raw,
            buckets: buckets.map((b) => ({ kind: b.kind, types: b.types, raw: b.raw, net: b.net, steps: b.steps })),
            steps: buckets.flatMap((b) => b.steps),
            checks,
        };
    }

    /**
     * The roll card's typed shape (`{phys, physTypes, energy: {type: n}, bypass}`, #4) as an
     * incoming-damage object, so weapon cards evaluate through the same function.
     */
    function fromTyped(typed, { spell = false } = {}) {
        const parts = [];
        if (typed?.phys) parts.push({ amount: typed.phys, types: [...(typed.physTypes || [])] });
        for (const [type, amount] of Object.entries(typed?.energy || {})) {
            parts.push({ amount, types: [type] });
        }
        return { parts, bypass: [...(typed?.bypass || [])], spell: spell || Boolean(typed?.spell) };
    }

    /**
     * Spell damage types, read off the description, because the compendium extract carries none
     * (every `damage.parts[].type` in spell_details.json is empty at the source). Only a phrase
     * that ties an energy word to "damage" counts — "points of fire damage", "acid damage" — and
     * only a SINGLE type is trusted: Flame Strike (fire + divine) or a chosen-energy spell return
     * [] and stay untyped rather than being resisted by the wrong chip.
     */
    function inferSpellTypes(descriptionHtml) {
        const text = String(descriptionHtml || '').replace(/<[^>]+>/g, ' ').toLowerCase();
        const found = new Set();
        const re = /\b(fire|cold|electricity|acid|sonic|force|negative energy|positive energy|divine|bludgeoning|piercing|slashing)\s+damage\b/g;
        let m;
        while ((m = re.exec(text)) !== null) found.add(m[1]);
        // Chosen energy, or a split like Flame Strike's "half the damage is fire … the other half".
        if (/\benergy (?:type )?of your choice|\bchoose (?:one|an) energy\b|\bthe other half\b/.test(text)) return [];
        const list = [...found];
        if (list.length !== 1 || list[0] === 'divine') return [];
        return list;
    }

    return {
        PHYSICAL_TYPES, ENERGY_TYPES, BYPASS_TYPES, INPUT_TYPES,
        effectiveDefenses, evaluate, fromTyped, inferSpellTypes, drBypassed,
    };
})();
