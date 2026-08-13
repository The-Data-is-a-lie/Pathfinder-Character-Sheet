// scripts/statblock.js -- #82: Paizo-style plain-text stat block (window.SheetStatblock).
// A formatter only: every number is read from SheetDerive / SheetSkillMath / SheetFormula,
// so the text can never disagree with the sheet. Copy lands on the clipboard for prep docs
// and forum posts — deliberately zero layout, unlike the #58 print handout.
window.SheetStatblock = (function () {
    'use strict';

    const fmtMod = (n) => (Number(n) >= 0 ? '+' : '') + (Number(n) || 0);
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const RULE = '--------------------';

    function classLine(data) {
        // ensureClassList entries are strings for legacy characters, objects
        // ({name, display, level}) once the Summary Classes list has been touched.
        const classes = window.SheetState?.ensureClassList?.(data) || [];
        const entries = classes.map((c) => (typeof c === 'string'
            ? { name: c, level: null }
            : { name: c?.display || c?.name || '', level: c?.level }));
        const named = entries.filter((e) => clean(e.name));
        if (!named.length) return `${clean(data.c_class).toLowerCase()} ${data.level || ''}`.trim();
        return named.map((e) => {
            const lvl = e.level ?? (named.length === 1 ? data.level : '');
            return `${clean(e.name).toLowerCase()}${lvl ? ' ' + lvl : ''}`;
        }).join('/');
    }

    /** BAB iteratives, tolerating hand-made JSONs that only carry bab_total. */
    function babIters(data) {
        const iters = String(window.SheetDerive.babIterativesStr(data) || '+0')
            .split('/').map((s) => Number(s) || 0);
        if (iters[0] === 0 && Number(data.bab_total) > 0) {
            const out = [];
            for (let b = Number(data.bab_total); b > 0 && out.length < 4; b -= 5) out.push(b);
            return out.length ? out : [0];
        }
        return iters;
    }

    function featNames(data) {
        const names = [];
        for (const g of window.SheetData?.FEAT_GROUPS || []) {
            const list = data[g.listKey];
            if (Array.isArray(list)) names.push(...list.map((f) => clean(f)));
        }
        return [...new Set(names.filter(Boolean))];
    }

    function skillLines(data) {
        const SM = window.SheetSkillMath;
        const F = window.SheetFormula;
        if (!SM || !F) return [];
        const rankMap = SM.parseSkillRanks(data);
        const vr = data._sheet?.variantRules || {};
        const out = [];
        for (const sk of window.SheetData?.ALL_SKILLS || []) {
            if (sk.variant && !vr[sk.variant]) continue;
            if (!SM.ranksForSkill(rankMap, sk.name)) continue;   // Paizo lists trained skills
            const r = F.evaluate('@skills.' + sk.id + '.mod', data);
            if (r?.ok && Number.isFinite(r.value)) out.push(`${sk.name} ${fmtMod(r.value)}`);
        }
        return out;
    }

    function gearLine(data) {
        const items = (data.equipment_list || []).map((it) => {
            if (typeof it === 'string') return clean(it);
            if (!it || typeof it !== 'object' || it.carried === false) return '';
            const qty = Number(it.quantity) || 1;
            return clean(it.name) + (qty > 1 ? ` (${qty})` : '');
        }).filter(Boolean);
        return items.join(', ');
    }

    function meleeLine(data, derived) {
        const name = clean(data.weapon_name);
        if (!name) return '';
        const iters = babIters(data);
        const delta = (derived.blocks.melee?.total || 0) - (iters[0] || 0);
        const attacks = iters.map((i) => fmtMod(i + delta)).join('/');
        const w = window.SheetDetails?.lookupWeapon?.(name);
        let dmg = '';
        if (w?.dice) {
            const dmgMod = Number(derived.blocks.damage?.total) || 0;
            const crit = (Number(w.critRange) && w.critRange < 20 ? `/${w.critRange}-20` : '')
                + (Number(w.critMult) > 2 ? `/×${w.critMult}` : '');
            dmg = ` (${w.dice}${dmgMod ? fmtMod(dmgMod) : ''}${crit})`;
        }
        return `${name.toLowerCase()} ${attacks}${dmg}`;
    }

    function buildStatBlock(data) {
        const D = window.SheetDerive;
        const derived = D.computeDerived(data);
        const b = derived.blocks;
        const st = data._sheet || {};
        const misc = st.miscInfo || {};
        const defs = st.defenses || {};
        const F = window.SheetFormula;
        const per = F?.evaluate?.('@skills.per.mod', data);
        const abs = ['str', 'dex', 'con', 'int', 'wis', 'cha']
            .map((ab) => `${ab[0].toUpperCase() + ab.slice(1)} ${D.abilityInfo(data, ab).total}`)
            .join(', ');

        const lines = [];
        lines.push(clean(data.character_full_name) || 'Unnamed');
        lines.push(clean([data.gender, clean(data.race).toLowerCase(), classLine(data)]
            .filter(Boolean).join(' ')));
        const sizeName = derived.size?.name || derived.size?.label || '';
        lines.push(clean([data.alignment, sizeName, 'humanoid'].filter(Boolean).join(' ')));
        lines.push(`Init ${fmtMod(b.init?.total)}; Senses ${clean(misc.senses) || '—'}`
            + (per?.ok ? `; Perception ${fmtMod(per.value)}` : ''));

        lines.push(RULE, 'DEFENSE', RULE);
        lines.push(`AC ${derived.ac}, touch ${derived.touch}, flat-footed ${derived.flat}`);
        lines.push(`hp ${b.hp?.total ?? data.Total_HP ?? '?'}`);
        lines.push(`Fort ${fmtMod(b.fort?.total)}, Ref ${fmtMod(b.ref?.total)}, Will ${fmtMod(b.will?.total)}`);
        const drTxt = (defs.dr || []).map((e) => `${e.amount}/${e.bypass || '—'}`).join(', ');
        const resistTxt = (defs.resist || []).map((e) => `${e.type} ${e.amount}`).join(', ');
        const sr = D.srTotal(data);
        const dLine = [
            drTxt && `DR ${drTxt}`,
            resistTxt && `Resist ${resistTxt}`,
            (Number(sr) > 0) && `SR ${sr}`,
        ].filter(Boolean).join('; ');
        if (dLine) lines.push(dLine);

        lines.push(RULE, 'OFFENSE', RULE);
        const speeds = st.speeds || {};
        const spBits = [`${Number(speeds.land) || Number(data.land_speed) || 30} ft.`];
        for (const [k, label] of [['fly', 'fly'], ['swim', 'swim'], ['climb', 'climb'], ['burrow', 'burrow']]) {
            if (Number(speeds[k]) > 0) spBits.push(`${label} ${Number(speeds[k])} ft.`);
        }
        lines.push(`Speed ${spBits.join(', ')}`);
        const melee = meleeLine(data, derived);
        if (melee) lines.push(`Melee ${melee}`);
        lines.push(`Ranged (touch) ${fmtMod(b.ranged?.total)}`);

        lines.push(RULE, 'STATISTICS', RULE);
        lines.push(abs);
        lines.push(`Base Atk ${fmtMod(babIters(data)[0])};`
            + ` CMB ${fmtMod(derived.cmb)}; CMD ${derived.cmd}`);
        const feats = featNames(data);
        if (feats.length) lines.push(`Feats ${feats.join(', ')}`);
        const skills = skillLines(data);
        if (skills.length) lines.push(`Skills ${skills.join(', ')}`);
        const langs = clean(misc.languages || data.languages);
        if (langs) lines.push(`Languages ${langs}`);
        const gear = gearLine(data);
        if (gear) lines.push(`Gear ${gear}`);
        return lines.join('\n');
    }

    async function copyStatBlock(data) {
        const d = data || window.SheetApp?.current;
        if (!d || d.error) {
            window.SheetOverlay?.toast?.('Load a character first');
            return '';
        }
        const text = buildStatBlock(d);
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // http:// or denied permission — the textarea fallback still works everywhere.
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch { /* clipboard stays empty */ }
            ta.remove();
        }
        window.SheetOverlay?.toast?.('Stat block copied to the clipboard');
        return text;
    }

    return { buildStatBlock, copyStatBlock };
})();
