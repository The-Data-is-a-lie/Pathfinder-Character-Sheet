// scripts/domain/enrichers.js -- inline @Save / @Damage / @Heal enrichers in feature and spell
// text (window.SheetEnrich, #147). Two sources produce the same buttons:
//
//   1. pf1's enricher tokens, verbatim: `@Save[ref;dc=15]{label}`, `@Damage[2d6;fire]`,
//      `@Heal[1d8+@cl]` — what Foundry text and hand-written descriptions carry.
//   2. The same three things in plain prose, because the shipped compendium extracts carry
//      almost no tokens (none in data/*.json; two in the whole pf1 system pack set): "DC 15
//      Reflex", "Fortitude save (DC 14)", "2d6 points of fire damage", "cures 1d8+5".
//      A phrase that scales ("1d6 … per caster level") is left alone: a button that rolled
//      the unscaled dice would be a confident wrong number.
//
// `scan(text)` is pure (string → matches). `enrich(root)` rewrites text nodes under a rendered
// description into buttons, never inside links, buttons, form fields or editable surfaces.
// One delegated click listener runs every button: a save rolls THIS character's save against
// the DC (pf1 rolls the selected token's; on a one-character sheet that is the character);
// damage posts a damage block whose Apply goes through the #146 calculator; heal posts a heal
// block. Formulas resolve through SheetFormula.
window.SheetEnrich = (function () {
    'use strict';

    const SAVE_KEYS = { fort: 'fort', fortitude: 'fort', ref: 'ref', reflex: 'ref', will: 'will' };
    const SAVE_NAMES = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' };
    const ENERGY = ['fire', 'cold', 'electricity', 'acid', 'sonic', 'force',
        'negative energy', 'positive energy'];
    const DAMAGE_WORDS = [...ENERGY, 'bludgeoning', 'piercing', 'slashing', 'nonlethal'];

    const DICE = String.raw`\d+d\d+(?:\s*[+\-]\s*\d+(?!d))?`;
    const TOKEN_RE = /@(Save|Damage|Heal)\[([^\]]*)\](?:\{([^}]*)\})?/g;
    const PROSE = [
        // "DC 15 Reflex", "DC 15 Fortitude save", "DC 15 Will negates"
        { kind: 'save', re: /\bDC\s*(\d{1,2})\s+(Fortitude|Reflex|Will|Fort|Ref)\b(?:\s+save\b)?/gi, save: 2, dc: 1 },
        // "Reflex save (DC 15)", "Will save DC 14", "Fort DC 12"
        { kind: 'save', re: /\b(Fortitude|Reflex|Will|Fort|Ref)(?:\s+save)?\s*\(?\s*DC\s*(\d{1,2})\)?/gi, save: 1, dc: 2 },
        // "cures 1d8+5", "heals 2d4 points", "regains 1d6 hit points"
        { kind: 'heal', re: new RegExp(String.raw`\b(?:cures?|heals?|regains?)\s+(${DICE})`, 'gi'), formula: 1 },
        // "2d6 points of fire damage", "1d4+1 damage", "3d6 points of nonlethal damage"
        {
            kind: 'damage',
            re: new RegExp(String.raw`\b(${DICE})\s+(?:points?\s+of\s+)?(?:(${DAMAGE_WORDS.join('|')})\s+)?damage\b`, 'gi'),
            formula: 1,
            type: 2,
        },
    ];
    // "… per caster level", "… per level", "… per two levels", "… for every …" right after the
    // match means the dice scale; skip rather than roll a misleadingly small number.
    // Also "+ 1 point of damage per caster level", "plus 1d6 … for every two levels" (channel
    // energy) and "… hit points per vigor point".
    const SCALING_AFTER = /^\s*(?:(?:hit\s+)?points?\s+(?:of\s+damage\s+)?)?(?:\(|,)?\s*(?:per|for\s+every|for\s+each|\/)\s|^\s*(?:plus|\+)\s*\d+(?:d\d+)?\b[^.]{0,50}?\b(?:per|for\s+every|for\s+each)\b/i;
    // "DC 15 + spell level", "DC 10 + 1/2 your level": the DC is a formula, not this number.
    const DC_SCALES_AFTER = /^\s*\+/;
    // "cures a target it hits of 1d6 points of damage" is healing, whatever the noun says.
    const HEAL_BEFORE = /\b(?:cures?|heals?|healing)\b[^.]{0,40}$/i;

    function parseToken(kind, body, label) {
        const segs = String(body || '').split(/[;|]/).map((s) => s.trim()).filter(Boolean);
        const opts = {};
        const bare = [];
        for (const s of segs) {
            const m = s.match(/^([a-z]+)\s*=\s*(.+)$/i);
            if (m) opts[m[1].toLowerCase()] = m[2].trim();
            else bare.push(s);
        }
        if (kind === 'save') {
            const save = SAVE_KEYS[String(opts.type || bare[0] || '').toLowerCase()];
            if (!save) return null;
            return { kind, save, dc: String(opts.dc ?? bare[1] ?? ''), label: label || null };
        }
        const formula = opts.formula || bare.shift() || '';
        if (!formula) return null;
        const types = (opts.type || opts.types || bare.join(',')).split(/[,\s]+/)
            .map((t) => t.toLowerCase()).filter((t) => DAMAGE_WORDS.includes(t));
        return { kind, formula, types, label: label || null };
    }

    /**
     * Find enrichable spans in plain text. Returns non-overlapping matches sorted by position:
     * `{ start, end, text, kind: 'save'|'damage'|'heal', save?, dc?, formula?, types? }`.
     * Tokens win over prose where they overlap.
     */
    function scan(text) {
        const s = String(text || '');
        const out = [];
        const taken = (a, b) => out.some((m) => a < m.end && b > m.start);
        for (const m of s.matchAll(TOKEN_RE)) {
            const parsed = parseToken(m[1].toLowerCase(), m[2], m[3]);
            if (!parsed) continue;
            out.push({ ...parsed, start: m.index, end: m.index + m[0].length, text: m[0], token: true });
        }
        for (const rule of PROSE) {
            for (const m of s.matchAll(rule.re)) {
                const start = m.index;
                const end = start + m[0].length;
                if (taken(start, end)) continue;
                const after = s.slice(end, end + 60);
                if (rule.kind !== 'save' && SCALING_AFTER.test(after)) continue;
                if (rule.kind === 'save') {
                    // Pattern 2 ends on the number; pattern 1 ends on the save word, so look
                    // right after the number itself.
                    const numEnd = start + m[0].indexOf(m[rule.dc]) + m[rule.dc].length;
                    if (DC_SCALES_AFTER.test(s.slice(numEnd, numEnd + 4))) continue;
                    out.push({ kind: 'save', save: SAVE_KEYS[m[rule.save].toLowerCase()], dc: m[rule.dc], start, end, text: m[0] });
                } else {
                    const formula = m[rule.formula].replace(/\s+/g, '');
                    const t = rule.type ? String(m[rule.type] || '').toLowerCase() : '';
                    const kind = rule.kind === 'damage' && !t && HEAL_BEFORE.test(s.slice(Math.max(0, start - 50), start))
                        ? 'heal' : rule.kind;
                    out.push({ kind, formula, types: t ? [t] : [], start, end, text: m[0] });
                }
            }
        }
        return out.sort((a, b) => a.start - b.start);
    }

    function buttonFor(m) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `enricher enricher-${m.kind}`;
        b.dataset.enrich = m.kind;
        if (m.kind === 'save') {
            b.dataset.save = m.save;
            if (m.dc) b.dataset.dc = m.dc;
            b.title = `Roll ${SAVE_NAMES[m.save]} save${m.dc ? ' vs DC ' + m.dc : ''}`;
        } else {
            b.dataset.formula = m.formula;
            if (m.types?.length) b.dataset.types = m.types.join(',');
            b.title = m.kind === 'heal' ? `Roll ${m.formula} healing`
                : `Roll ${m.formula}${m.types?.length ? ' ' + m.types.join('/') : ''} damage; Apply goes through your defenses`;
        }
        // Prose keeps its own words; a token shows its {label} or a short readable form.
        b.textContent = !m.token ? m.text
            : (m.label || (m.kind === 'save'
                ? `${SAVE_NAMES[m.save]}${m.dc ? ' DC ' + m.dc : ''}`
                : `${m.formula}${m.types?.length ? ' ' + m.types.join('/') : ''}${m.kind === 'heal' ? ' healing' : ''}`));
        return b;
    }

    const SKIP = 'a, button, input, textarea, select, code, pre, [contenteditable], .enricher, .inline-roll';

    /** Rewrite enrichable text under `root` into buttons. Idempotent (skips existing buttons). */
    function enrich(root) {
        if (!root || !root.ownerDocument) return root;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => (!n.nodeValue || !/\d|@/.test(n.nodeValue) || n.parentElement?.closest(SKIP)
                ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
            const text = node.nodeValue;
            const hits = scan(text);
            if (!hits.length) continue;
            const frag = document.createDocumentFragment();
            let at = 0;
            for (const m of hits) {
                if (m.start > at) frag.appendChild(document.createTextNode(text.slice(at, m.start)));
                frag.appendChild(buttonFor(m));
                at = m.end;
            }
            if (at < text.length) frag.appendChild(document.createTextNode(text.slice(at)));
            node.replaceWith(frag);
        }
        return root;
    }

    /** Enrich a <details> body on first open — description lists render hundreds eagerly. */
    function enrichOnOpen(det, body) {
        if (!det || !body) return;
        if (det.open) { enrich(body); return; }
        det.addEventListener('toggle', function once() {
            if (!det.open) return;
            det.removeEventListener('toggle', once);
            enrich(body);
        });
    }

    // ------------------------------------------------------------------ actions
    function rollable(formula, data) {
        const F = window.SheetFormula;
        const r = F?.evaluateToRollable ? F.evaluateToRollable(formula, data, {}) : { ok: true, formula };
        return r.ok ? r.formula : formula;
    }

    function doSave(save, dc) {
        const data = window.SheetApp?.current;
        const R = window.SheetRoll;
        if (!data || !R) return;
        const block = window.SheetDerive?.computeDerived?.(data)?.blocks?.[save];
        const bonus = Number(block?.total) || 0;
        const r = R.roll('1d20' + (bonus >= 0 ? '+' : '') + bonus);
        if (!r.ok) return;
        const nat = r.parts.find((p) => p.kind === 'dice')?.rolls?.[0];
        const target = Number(dc);
        let verdict = '';
        if (Number.isFinite(target) && dc !== '' && dc != null) {
            const pass = nat === 20 || (nat !== 1 && r.total >= target);
            verdict = (pass ? 'Success' : 'Failure') + (nat === 20 ? ' (natural 20)' : nat === 1 ? ' (natural 1)' : '');
        }
        R.postCard({
            title: `${SAVE_NAMES[save]} save`,
            subtitle: dc ? `DC ${dc}` : 'no DC given',
            riders: [
                { source: 'Roll', text: `${r.detail} ${bonus >= 0 ? '+' : ''}${bonus} = ${r.total}` },
                ...(verdict ? [{ source: verdict.startsWith('Success') ? 'Saved' : 'Failed', text: `${r.total} vs DC ${dc}: ${verdict}` }] : []),
            ],
        });
        window.SheetRoll?.setOpen?.(true);
    }

    function doDamage(kind, formula, types) {
        const data = window.SheetApp?.current;
        const R = window.SheetRoll;
        if (!R) return;
        const f = rollable(formula, data);
        const r = R.roll(f);
        if (!r.ok) {
            window.SheetOverlay?.toast?.(`Can't roll “${formula}”`);
            return;
        }
        const heal = kind === 'heal';
        const nonlethal = types.includes('nonlethal');
        const typesNoNl = types.filter((t) => t !== 'nonlethal');
        const energy = typesNoNl.find((t) => ENERGY.includes(t));
        const dmg = {
            total: r.total,
            diceTotal: r.total,
            flat: 0,
            critMult: 1,
            diceFlavor: r.formula,
            label: heal ? '' : (typesNoNl.join('/') || ''),
            parts: [{ label: r.formula, detail: r.detail, value: r.total }],
            conditionals: [],
        };
        if (heal) dmg.isHeal = true;
        else {
            dmg.typed = energy
                ? { phys: 0, physTypes: [], energy: { [energy]: r.total }, bypass: [] }
                : { phys: r.total, physTypes: typesNoNl, energy: {}, bypass: [] };
        }
        R.postCard({
            title: heal ? 'Healing' : (nonlethal ? 'Nonlethal damage' : 'Damage'),
            subtitle: formula + (typesNoNl.length ? ' · ' + typesNoNl.join('/') : ''),
            damages: [dmg],
        });
        R.setOpen?.(true);
    }

    function onClick(ev) {
        const b = ev.target?.closest?.('.enricher');
        if (!b) return;
        ev.preventDefault();
        ev.stopPropagation();
        const k = b.dataset.enrich;
        if (k === 'save') doSave(b.dataset.save, b.dataset.dc || '');
        else if (k === 'damage' || k === 'heal') {
            doDamage(k, b.dataset.formula, (b.dataset.types || '').split(',').filter(Boolean));
        }
    }
    // Capture phase: description buttons live inside <summary>-adjacent rows and clickable
    // feature rows whose own handlers would otherwise toggle or open something first.
    document.addEventListener('click', onClick, true);

    return { scan, enrich, enrichOnOpen, parseToken };
})();
