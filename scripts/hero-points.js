// scripts/hero-points.js -- Hero Points variant (#158), window.SheetHeroPoints.
//
// The APG hero-point pool (`data.hero_points`, the same field the luck block already edits) with a
// Spend menu. Each use takes its cost from the pool, does what the sheet can do for it, and logs a
// card:
//   +8 before a roll    arms a one-shot +8 on the next d20 (check, save, skill or attack)
//   +4 after a roll     posts the newest roll's total + 4
//   Extra action        gives back the standard action on the #161 tracker
//   Reroll              re-runs the newest roll (you must take the new result)
//   Recall              a used spell or daily ability back — log only, you restore it by hand
//   Cheat death (2)     dead → stable at -1 HP
// Warn, never block: spending with too few points still happens (the pool stops at 0) and says so.
// On when Settings → Variant rules → Hero points is ticked, or when the character has any points.
window.SheetHeroPoints = (function () {
    'use strict';
    const { h } = window.SheetUI;
    const toast = (t) => window.SheetOverlay?.toast?.(t);
    const MAX = 3; // APG: a character can't hold more than 3 hero points

    const USES = [
        { id: 'bonus8', label: '+8 before a roll', cost: 1,
            hint: 'Declare before rolling: +8 on your next d20 roll (attack, save, skill or check).' },
        { id: 'bonus4', label: '+4 after a roll', cost: 1,
            hint: 'Declare after rolling: +4 to the roll you just made (the newest in the log).' },
        { id: 'action', label: 'Extra standard action', cost: 1,
            hint: 'Take an extra standard action this turn (gives back the Standard chip).' },
        { id: 'reroll', label: 'Reroll', cost: 1,
            hint: 'Reroll the newest roll in the log. You must take the second result.' },
        { id: 'recall', label: 'Recall a spell or ability', cost: 1,
            hint: 'Get back a cast spell or a daily use. Restore the slot or use yourself.' },
        { id: 'cheat', label: 'Cheat death', cost: 2,
            hint: 'A blow that would kill you leaves you alive, stable at negative hit points.' },
    ];

    const pool = (data) => Math.max(0, Number(data?.hero_points) || 0);
    const enabled = (data) => !!(window.SheetState?.variantRuleOn?.(data, 'heroPoints') || pool(data) > 0);

    /** Feats that interact with hero points, as reminders (the compendium text says so). */
    function heroicFeats(data) {
        const SD = window.SheetDetails;
        const names = new Set();
        for (const key of ['feats', 'story_feats', 'teamwork_feats', 'mt_feats', 'sphere_feats']) {
            for (const n of Array.isArray(data?.[key]) ? data[key] : []) if (n) names.add(String(n));
        }
        const out = [];
        for (const name of names) {
            const desc = SD?.resolveFeature?.(data, 'feat', name)?.description || '';
            if (/hero points?/i.test(desc)) out.push(name);
        }
        return out;
    }

    function card(title, riders) {
        window.SheetRoll?.postCard?.({ title: 'Hero point — ' + title, subtitle: 'Hero points', riders });
        window.SheetRoll?.setOpen?.(true);
    }

    /** Spend one use. Returns { ok, left, note } — ok is false only for an unknown use id. */
    function spend(data, id) {
        const use = USES.find((u) => u.id === id);
        if (!use || !data) return { ok: false };
        const had = pool(data);
        const short = had < use.cost;
        data.hero_points = Math.max(0, had - use.cost);
        const left = data.hero_points;
        const riders = [];
        const R = window.SheetRoll;
        const S = window.SheetState;
        switch (id) {
            case 'bonus8':
                R?.armNextD20?.(8, 'Hero point');
                riders.push({ source: 'Armed', text: '+8 on your next d20 roll' });
                break;
            case 'bonus4': {
                const last = R?.lastRoll?.();
                riders.push(last
                    ? { source: last.title, text: `${last.total} + 4 = ${last.total + 4}` }
                    : { source: 'No roll', text: 'no roll in the log yet — add +4 to it yourself' });
                break;
            }
            case 'action': {
                const ae = S?.ensureActionEconomy?.(data);
                if (ae) {
                    delete ae.used.standard;
                    delete ae.used.full;
                }
                riders.push({ source: 'Action', text: 'an extra standard action this turn' });
                break;
            }
            case 'reroll': {
                const did = R?.rerollLast?.();
                riders.push({ source: 'Reroll', text: did
                    ? 'the newest roll was rolled again (above) — the new result stands'
                    : 'nothing in the log to reroll — roll it again yourself' });
                break;
            }
            case 'recall':
                riders.push({ source: 'Recall', text: 'restore the spell slot or daily use by hand' });
                break;
            case 'cheat': {
                const st = (data._sheet ??= {});
                const con = window.SheetDerive?.abilityInfo?.(data, 'con')?.total ?? 10;
                const cur = Number(st.hpCurrent);
                if (Number.isFinite(cur) && cur <= -con) {
                    st.hpCurrent = -1;
                    riders.push({ source: 'Cheat death', text: `HP ${cur} → -1, alive and stable` });
                } else {
                    riders.push({ source: 'Cheat death', text: 'the killing blow leaves you alive and stable at negative HP' });
                }
                break;
            }
            default:
                break;
        }
        if (short) {
            riders.push({ source: 'Warning', text: `you had ${had} hero point${had === 1 ? '' : 's'} and this costs ${use.cost}` });
        }
        riders.push({ source: 'Pool', text: `${left} left` });
        // The card goes first; the reroll above already posted its own fresh roll.
        card(use.label, riders);
        window.SheetState?.quietSave?.();
        toast(short ? `Spent ${use.label} with only ${had} point${had === 1 ? '' : 's'} — ${left} left`
            : `Hero point: ${use.label} — ${left} left`);
        return { ok: true, left, short };
    }

    function openMenu(data, { onDone } = {}) {
        const body = h('div', 'hero-menu');
        body.appendChild(h('p', 'hero-pool', `You have ${pool(data)} hero point${pool(data) === 1 ? '' : 's'} (max ${MAX}).`));
        let handle = null;
        for (const use of USES) {
            const btn = h('button', 'hero-use-btn');
            btn.type = 'button';
            btn.dataset.use = use.id;
            btn.appendChild(h('span', 'hero-use-name', `${use.label}${use.cost > 1 ? ` (${use.cost} points)` : ''}`));
            btn.appendChild(h('span', 'hero-use-hint dim', use.hint));
            if (pool(data) < use.cost) btn.classList.add('is-short');
            btn.addEventListener('click', () => {
                handle?.close();
                spend(data, use.id);
                onDone?.();
            });
            body.appendChild(btn);
        }
        const feats = heroicFeats(data);
        if (feats.length) {
            body.appendChild(h('p', 'hero-feats dim', 'Your feats that use hero points: ' + feats.join(', ')));
        }
        handle = window.SheetOverlay.open({ title: 'Spend a hero point', body });
        return handle;
    }

    /** "N / 3 · Spend" for a stat box, plus a badge while +8 is armed. */
    function widget(data, { onChange } = {}) {
        const wrap = h('span', 'hero-widget');
        const n = pool(data);
        const num = h('span', 'hero-count', String(n));
        num.title = `Hero points (APG max ${MAX})`;
        wrap.appendChild(num);
        wrap.appendChild(document.createTextNode(` / ${MAX} `));
        if (n > MAX) wrap.appendChild(h('span', 'hero-over dim', 'over max '));
        const spendBtn = h('button', 'inv-btn hero-spend-btn no-print', 'Spend');
        spendBtn.type = 'button';
        spendBtn.title = 'Spend a hero point: +8 / +4 on a roll, extra action, reroll, recall, cheat death';
        spendBtn.addEventListener('click', () => openMenu(data, { onDone: onChange }));
        wrap.appendChild(spendBtn);
        const armed = h('span', 'feat-tag hero-armed' + (window.SheetRoll?.nextD20Bonus?.() ? '' : ' hidden'), '+8 armed');
        armed.title = 'Your next d20 roll gets +8';
        wrap.appendChild(armed);
        return wrap;
    }

    return { USES, MAX, pool, enabled, spend, openMenu, widget, heroicFeats };
})();
