// scripts/domain/health-check.js -- the warn-only character audit (window.SheetHealth, #79).
//
// STANDING STANCE, and the reason this module has no "fix" button and no clamp anywhere:
// **warnings teach, blocks hurt.** A newcomer needs to be told what is off and why; a GM
// building a deliberately illegal NPC needs to be left alone. So every rule here produces a
// finding, nothing here changes a number, and every finding can be muted forever.
//
// Recomputed on render — never on a timer, never a toast. The whole surface is a ⚠ count in
// the top bar plus inline badges; at zero findings none of it is visible.
//
// V1 RULES, per the ticket's grill decision:
//   skill-rank-cap     per-skill ranks must not exceed character level (hard PF1 rule)
//   skill-rank-budget  total ranks spent vs (skills/level + Int) × level + FCB + human
//   encumbrance        a heads-up at Medium load or worse, reading SheetDerive.encumbrance
//   feat-prereq        BEST EFFORT, parsed from description prose — flagged as such in the UI
// Deliberately NOT here: ability-array legality (a GM's NPC is not a point buy), and the feat
// COUNT budget, which the Features tab's Missing/Excess badge already ships.
window.SheetHealth = (function () {
    'use strict';

    const MUTE_KEY = 'healthMuted';
    const OFF_KEY = 'healthCheckOff';

    const st = (data) => (data._sheet ??= {});
    const num = (v) => Number(v) || 0;

    // ------------------------------------------------------------------ mute / master switch
    function mutedSet(data) {
        const arr = data?._sheet?.[MUTE_KEY];
        return new Set(Array.isArray(arr) ? arr : []);
    }
    /**
     * Mutes are keyed `rule::subject`, not by index or message text, so a mute survives the
     * next audit, a reworded message, and a finding that comes and goes — the same discipline
     * `disabledBuffSources` uses for passive sources.
     */
    function setMuted(data, id, muted) {
        if (!data || !id) return;
        const set = mutedSet(data);
        if (muted) set.add(id);
        else set.delete(id);
        st(data)[MUTE_KEY] = [...set];
        invalidate();
        window.SheetApp?.quietSave?.();
    }
    function unmuteAll(data) {
        if (!data) return;
        st(data)[MUTE_KEY] = [];
        invalidate();
        window.SheetApp?.quietSave?.();
    }
    const isDisabled = (data) => data?._sheet?.[OFF_KEY] === true;
    function setDisabled(data, off) {
        if (!data) return;
        if (off) st(data)[OFF_KEY] = true;
        else delete st(data)[OFF_KEY];
        invalidate();
        window.SheetApp?.quietSave?.();
    }

    // ------------------------------------------------------------------ rules
    const finding = (rule, subject, title, detail, tab, extra = {}) => ({
        id: `${rule}::${subject}`, rule, subject, title, detail, tab, ...extra,
    });

    /** Ranks in one skill may never exceed character level. Subskills count separately. */
    function skillRankCapFindings(data, level) {
        const out = [];
        if (level <= 0) return out;
        const SM = window.SheetSkillMath;
        const map = SM?.parseSkillRanks?.(data) || {};
        const ALL = window.SheetData?.ALL_SKILLS || [];
        const nameOf = (key) => ALL.find((s) => SM?.skillRankKey?.(s.name) === key)?.name || key;
        for (const [key, ranks] of Object.entries(map)) {
            if (num(ranks) <= level) continue;
            const label = nameOf(key);
            out.push(finding('skill-rank-cap', key,
                `${label}: ${num(ranks)} ranks at level ${level}`,
                `A skill can never hold more ranks than the character has hit dice. `
                + `Trim it to ${level} or raise the level.`, 'skills', { skillKey: key }));
        }
        return out;
    }

    /** Total ranks spent against the class/Int/FCB budget. Over-spend only — under is fine. */
    function skillBudgetFinding(data) {
        const CI = window.SheetClassInfo;
        const SM = window.SheetSkillMath;
        if (!CI?.skillRankBudget || !SM?.parseSkillRanks) return null;
        const budget = CI.skillRankBudget(data);
        if (!budget || budget.total <= 0) return null;
        // #112: racial hit dice buy skill ranks too (skills/HD from the creature type), so a
        // monster with 4 racial HD is not over budget for spending them.
        const racial = window.SheetCreature?.racialContribution?.(data);
        if (racial) budget.total += racial.skillRanks;
        const map = SM.parseSkillRanks(data);
        let spent = Object.values(map).reduce((a, v) => a + num(v), 0);
        // Craft/Perform/Profession instances hold their own ranks under their own keys.
        for (const [id, labels] of Object.entries(data?._sheet?.subSkills || {})) {
            for (const label of (Array.isArray(labels) ? labels : [])) {
                spent += num(map[SM.skillRankKey(`${id} ${label}`)]);
            }
        }
        if (spent <= budget.total) return null;
        return finding('skill-rank-budget', 'total',
            `${spent} skill ranks spent, ${budget.total} available`,
            `Budget: ${budget.parts.join('; ') || 'class skill points × level'}. `
            + `That is ${spent - budget.total} over — either trim ranks or raise skills/level `
            + `on the class card. Generated NPCs routinely land here: the generator hands out `
            + `ranks more freely than RAW, so mute this one if that is the intent.`, 'skills');
    }

    /** Not a rules violation — a heads-up that gear is costing the character real numbers. */
    function encumbranceFinding(data) {
        const enc = window.SheetDerive?.encumbrance?.(data);
        // maxDex is null exactly when the load is Light, which is the "nothing to say" case.
        if (!enc || enc.maxDex == null) return null;
        // loadCategory's labels include "Over capacity", which no article fits.
        const lead = enc.label === 'Over capacity' ? 'Carrying over capacity' : `Carrying a ${enc.label} load`;
        return finding('encumbrance', 'load',
            lead,
            `${enc.label} load caps Dex to AC at +${enc.maxDex}, applies a −${enc.acp} check `
            + `penalty, and cuts speed to two-thirds. Drop or store gear on Inventory to clear it.`,
            'inventory', { severity: 'info' });
    }

    // ---------------------------------------------------------- feat prerequisites (best effort)
    const ABILS = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
    /** Pull the Prerequisites sentence out of a compendium description's HTML. */
    function prereqText(html) {
        const text = String(html || '')
            .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
        const m = text.match(/Prerequisites?\s*:?\s*(.+?)(?:Benefits?\s*:|Normal\s*:|Special\s*:|$)/i);
        return m ? m[1].trim() : '';
    }
    /**
     * Check ONE prerequisite clause. Returns null when the clause is not something this parser
     * confidently understands — silence beats a wrong warning, which is the whole reason this
     * rule is labelled best-effort in the UI.
     * @returns {{ ok: boolean, text: string } | null}
     */
    function checkClause(data, clause) {
        const c = clause.trim().replace(/\.$/, '');
        if (!c) return null;
        // "or" clauses are alternatives; one satisfied branch is enough, and a parser this
        // small should not adjudicate them at all.
        if (/\bor\b/i.test(c)) return null;
        const D = window.SheetDerive;

        let m = c.match(/^(Str|Dex|Con|Int|Wis|Cha)[a-z]*\s+(\d+)$/i);
        if (m) {
            const ab = m[1].toLowerCase();
            const have = num(D?.abilityInfo?.(data, ab)?.total);
            return { ok: have >= num(m[2]), text: `${ABILS[ab]} ${m[2]} (has ${have})` };
        }
        m = c.match(/^(?:base attack bonus|BAB)\s*\+?(\d+)/i);
        if (m) {
            const have = num(data.bab_total);
            return { ok: have >= num(m[1]), text: `base attack bonus +${m[1]} (has +${have})` };
        }
        m = c.match(/^(.+?)\s+(\d+)\s+ranks?$/i);
        if (m) {
            const SM = window.SheetSkillMath;
            const have = num(SM?.ranksForSkill?.(SM.parseSkillRanks(data), m[1].trim()));
            return { ok: have >= num(m[2]), text: `${m[1].trim()} ${m[2]} ranks (has ${have})` };
        }
        m = c.match(/^(?:character\s+)?(\d+)(?:st|nd|rd|th)[- ]level/i);
        if (m) {
            const have = num(D?.totalLevel?.(data));
            return { ok: have >= num(m[1]), text: `character level ${m[1]} (is ${have})` };
        }
        m = c.match(/^caster level\s+(\d+)/i);
        if (m) {
            const have = num(D?.casterLevelValue?.(data));
            return { ok: have >= num(m[1]), text: `caster level ${m[1]} (has ${have})` };
        }
        // A bare name: treat it as a feat prerequisite ONLY when it is a name the feat
        // compendium actually knows, so prose like "ability to cast arcane spells" is skipped
        // rather than reported as a missing feat.
        if (/^[A-Z][A-Za-z'’\- ]{2,40}(\([^)]*\))?$/.test(c)
            && window.SheetDetails?.lookup?.('feats', c)) {
            const has = window.SheetRoll?.hasFeat?.(data, c.replace(/\s*\(.*$/, ''));
            return { ok: !!has, text: `the ${c} feat` };
        }
        return null;
    }
    function featPrereqFindings(data) {
        const out = [];
        const SD = window.SheetDetails;
        const groups = window.SheetData?.FEAT_GROUPS || [];
        if (!SD?.lookup) return out;
        const seen = new Set();
        for (const g of groups) {
            for (const raw of (Array.isArray(data[g.listKey]) ? data[g.listKey] : [])) {
                // The generator labels feats "(Feat 3) Power Attack"; the compendium key is
                // the bare name, and a feat listed twice is one finding.
                const name = String(raw || '').replace(/^\([^)]*\)\s*/, '').trim();
                if (!name || seen.has(name.toLowerCase())) continue;
                seen.add(name.toLowerCase());
                const entry = SD.lookup('feats', name);
                const text = prereqText(entry?.description);
                if (!text) continue;
                const unmet = [];
                for (const clause of text.split(/[,;]/)) {
                    const r = checkClause(data, clause);
                    if (r && !r.ok) unmet.push(r.text);
                }
                if (!unmet.length) continue;
                out.push(finding('feat-prereq', name.toLowerCase(),
                    `${name}: unmet prerequisite${unmet.length > 1 ? 's' : ''}`,
                    `Missing ${unmet.join(', ')}. Read from the feat's own description text, so `
                    + `treat it as a hint — retraining, archetypes and house rules are invisible `
                    + `to this check.`, 'features', { bestEffort: true, featName: name }));
            }
        }
        return out;
    }

    // ------------------------------------------------------------------ the audit
    // Memoized for one render pass. The feat-prerequisite rule parses prose for every feat the
    // character has, and `findingsFor` is called once per skill row and once per feat row — so
    // without this a level-20 character would re-run the whole audit ~80 times per paint.
    // `invalidate()` is called at the top of renderSheet, which is the only thing that can
    // change the answer.
    let cache = { data: null, result: null };
    function invalidate() { cache = { data: null, result: null }; }

    /**
     * @returns {{ findings: Array, muted: Array, count: number, disabled: boolean }}
     * `findings` excludes muted entries; `muted` carries them so the panel can offer a restore.
     */
    function audit(data) {
        if (cache.data === data && cache.result) return cache.result;
        const result = runAudit(data);
        cache = { data, result };
        return result;
    }
    function runAudit(data) {
        const empty = { findings: [], muted: [], count: 0, disabled: false };
        if (!data || data.error) return empty;
        if (isDisabled(data)) return { ...empty, disabled: true };
        const level = num(window.SheetDerive?.totalLevel?.(data));
        let all = [];
        try {
            all = [
                ...skillRankCapFindings(data, level),
                skillBudgetFinding(data),
                encumbranceFinding(data),
                ...featPrereqFindings(data),
            ].filter(Boolean);
        } catch (err) {
            // An audit is a nicety; it must never be the reason a character fails to render.
            console.warn('SheetHealth: audit failed', err);
            return empty;
        }
        const muteSet = mutedSet(data);
        const findings = all.filter((f) => !muteSet.has(f.id));
        return {
            findings,
            muted: all.filter((f) => muteSet.has(f.id)),
            count: findings.length,
            disabled: false,
        };
    }
    /** Findings for one skill key / feat name, for the inline row badges. */
    function findingsFor(data, kind, subject) {
        const key = String(subject || '').toLowerCase();
        return audit(data).findings.filter((f) => (kind === 'skill'
            ? (f.rule === 'skill-rank-cap' && f.skillKey === key)
            : (f.rule === 'feat-prereq' && f.subject === key)));
    }

    return {
        audit, findingsFor, invalidate, setMuted, unmuteAll, mutedSet, isDisabled, setDisabled,
        prereqText, checkClause,
    };
})();
