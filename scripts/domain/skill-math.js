// scripts/domain/skill-math.js -- the skill-computation domain (window.SheetSkillMath): rank
// parsing, per-skill ability + bonus math, the class-skill toggle, and the rank-edit widget.
// Part D.1: a deep module named after the domain, modals-free, loaded before modals so the
// Skills tab, the simple sheet, the Summary class-skill grid and modals' class sheet all import
// it directly instead of routing through SheetApp. renderSheet/setActiveTab late-bind via SheetApp.
window.SheetSkillMath = (function () {
    'use strict';
    const { toInt, dblclickEditable, parseIntLoose } = window.SheetUI;
    const { effectiveLedger } = window.SheetDerive;
    const { sheetState, quietSave, ensureSkillRanksObject } = window.SheetState;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);

    function parseSkillRanks(data) {
        let ranks = data.skill_ranks;
        if (typeof ranks === 'string') {
            try { ranks = JSON.parse(ranks); } catch { ranks = {}; }
        }
        if (!ranks || typeof ranks !== 'object') ranks = {};
        // Normalize keys to lowercase for lookup
        const map = {};
        for (const [k, v] of Object.entries(ranks)) {
            map[String(k).toLowerCase().trim()] = Number(v) || 0;
        }
        return map;
    }
    function ranksForSkill(rankMap, skillName) {
        const lc = skillName.toLowerCase();
        if (rankMap[lc] != null) return rankMap[lc];
        // Loose match: "knowledge arcana" vs "Knowledge (Arcana)"
        const loose = lc.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
        for (const [k, v] of Object.entries(rankMap)) {
            const kl = k.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
            if (kl === loose || kl.includes(loose) || loose.includes(kl)) return v;
        }
        return 0;
    }
    /** Effective ability for a skill (Foundry: per-skill ability select). Stored on _sheet.skillAbilities. */
    function skillAbilityKey(skill) {
        return skill.id || skillRankKey(skill.name);
    }
    function getSkillAbility(data, skill) {
        const st = sheetState(data);
        st.skillAbilities ??= {};
        const key = skillAbilityKey(skill);
        const override = st.skillAbilities[key] || st.skillAbilities[skillRankKey(skill.name)];
        const ab = String(override || skill.ab || 'str').toLowerCase();
        return ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(ab) ? ab : (skill.ab || 'str');
    }
    function setSkillAbility(data, skill, ab) {
        const st = sheetState(data);
        st.skillAbilities ??= {};
        const key = skillAbilityKey(skill);
        const def = skill.ab || 'str';
        if (!ab || ab === def) delete st.skillAbilities[key];
        else st.skillAbilities[key] = ab;
        quietSave();
    }
    // ---- per-skill user bonuses: Racial / Feat / Trait / Misc + class-skill toggle
    // Stored on _sheet.skillBonuses[key] = { racial, feat, trait, misc, cs }.
    function skillBonusEntry(data, key) {
        const st = sheetState(data);
        st.skillBonuses ??= {};
        return st.skillBonuses[key] || {};
    }
    function setSkillBonus(data, key, field, value) {
        const st = sheetState(data);
        st.skillBonuses ??= {};
        const entry = { ...(st.skillBonuses[key] || {}) };
        if (field === 'cs') {
            if (value) entry.cs = true;
            else delete entry.cs;
        } else {
            const n = Number(value) || 0;
            if (n) entry[field] = n;
            else delete entry[field];
        }
        // Drop the key entirely when everything is zero/off
        if (Object.keys(entry).length) st.skillBonuses[key] = entry;
        else delete st.skillBonuses[key];
        quietSave();
    }
    /** User-entered skill bonuses; class skill gives PF1's +3 only with ≥1 rank. */
    function skillUserBonus(data, key, ranks) {
        const e = skillBonusEntry(data, key);
        const racial = Number(e.racial) || 0;
        const feat = Number(e.feat) || 0;
        const trait = Number(e.trait) || 0;
        const misc = Number(e.misc) || 0;
        const csBonus = e.cs && (Number(ranks) || 0) >= 1 ? 3 : 0;
        return { racial, feat, trait, misc, cs: !!e.cs, csBonus,
            total: racial + feat + trait + misc + csBonus };
    }
    // ---- #155 per-skill flags + custom skills -------------------------------------------
    // Flags: _sheet.skillFlags[key] = { acp?, rt? }, stored only where they differ from the
    // default, so an untouched character carries nothing. ACP's default stays the old
    // Foundry-style rule (marked acp, or Str/Dex-based); trained-only comes from the PF1 table.
    function defaultFlags(data, skill) {
        const ab = getSkillAbility(data, skill);
        return { acp: !!(skill.acp || ab === 'str' || ab === 'dex'), rt: !!skill.rt };
    }
    function skillFlags(data, skill) {
        const def = defaultFlags(data, skill);
        const f = data?._sheet?.skillFlags?.[skillAbilityKey(skill)] || {};
        return {
            acp: typeof f.acp === 'boolean' ? f.acp : def.acp,
            rt: typeof f.rt === 'boolean' ? f.rt : def.rt,
        };
    }
    function setSkillFlag(data, skill, flag, on) {
        const st = sheetState(data);
        const key = skillAbilityKey(skill);
        const map = (st.skillFlags ??= {});
        const entry = { ...(map[key] || {}) };
        if (Boolean(on) === defaultFlags(data, skill)[flag]) delete entry[flag];
        else entry[flag] = Boolean(on);
        if (Object.keys(entry).length) map[key] = entry;
        else delete map[key];
        if (!Object.keys(map).length) delete st.skillFlags;
        quietSave();
    }
    /** Custom skills: _sheet.customSkills = [{ id: 'cus_…', name, ab, acp?, rt? }]. Ids are
     *  [a-z0-9_] so @skills.<id>.mod resolves them. */
    function customSkills(data) {
        const list = data?._sheet?.customSkills;
        return Array.isArray(list) ? list.filter((s) => s && s.id && s.name) : [];
    }
    /** Every skill row the character has: the PF1 table plus their custom skills. */
    function allSkills(data) {
        return [...(window.SheetData?.ALL_SKILLS || []), ...customSkills(data).map((s) => ({ ...s, custom: true }))];
    }
    function addCustomSkill(data, name, ab) {
        const nm = String(name || '').trim();
        if (!nm) return null;
        const st = sheetState(data);
        const list = (st.customSkills ??= []);
        const taken = new Set(allSkills(data).map((s) => s.name.toLowerCase()));
        if (taken.has(nm.toLowerCase())) return null;
        const slug = nm.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'skill';
        let id = 'cus_' + slug;
        for (let i = 2; list.some((s) => s.id === id); i++) id = `cus_${slug}_${i}`;
        const skill = { id, name: nm, ab: ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(ab) ? ab : 'int' };
        list.push(skill);
        quietSave();
        return skill;
    }
    /** Remove a custom skill. → undo() (ranks in skill_ranks are left alone, so undo is exact). */
    function removeCustomSkill(data, id) {
        const list = sheetState(data).customSkills || [];
        const i = list.findIndex((s) => s.id === id);
        if (i < 0) return null;
        const [gone] = list.splice(i, 1);
        quietSave();
        return () => { list.splice(Math.min(i, list.length), 0, gone); quietSave(); };
    }

    function skillMiscBonus(data, skill) {
        const SD = window.SheetDetails;
        const ab = getSkillAbility(data, skill);
        // Use effective ledger so per-buff toggles apply
        const ledger = effectiveLedger(data);
        // ACP: the per-skill flag (#155), defaulting to marked-acp or Str/Dex-based.
        const acpApplies = skillFlags(data, skill).acp;
        const hasNegLv = (Number(data?._sheet?.negativeLevels) || 0) > 0;
        if (!ledger?.changes?.length && !acpApplies && !hasNegLv) return { total: 0, bits: [] };
        const abBucket = {
            str: 'strSkills', dex: 'dexSkills', con: 'conSkills',
            int: 'intSkills', wis: 'wisSkills', cha: 'chaSkills',
        }[ab];
        const targets = new Set(['skills', abBucket, skill.id ? 'skill.' + skill.id : null].filter(Boolean));
        let total = 0;
        const bits = [];
        for (const c of ledger.changes || []) {
            if (!targets.has(c.target)) continue;
            const ev = SD?.evalSimpleFormula(c.formula, data);
            if (ev?.ok) {
                total += ev.value;
                bits.push({ source: c.source, value: ev.value });
            }
        }
        if (acpApplies) {
            // Armor check penalty and the encumbrance check penalty do not stack — the
            // worse of the two applies (PF1 carrying-capacity rules).
            const armorAcp = Math.abs(toInt(data.armor_armor_check_penalty) ?? 0);
            const enc = window.SheetDerive?.encumbrance?.(data);
            const loadAcp = Math.abs(enc?.acp || 0);
            const acp = Math.max(armorAcp, loadAcp);
            if (acp) {
                total -= acp;
                bits.push({
                    source: loadAcp > armorAcp ? `${enc.label} load check` : 'Armor check',
                    value: -acp,
                });
            }
        }
        // PF1 negative levels: −1 per level on all skill checks
        const negLv = Number(data?._sheet?.negativeLevels) || 0;
        if (negLv) {
            total -= negLv;
            bits.push({ source: 'Negative levels', value: -negLv });
        }
        return { total, bits };
    }
    function skillRankKey(skillName) {
        return String(skillName).toLowerCase().trim();
    }
    function ranksEditor(data, rankKey, currentRanks) {
        const map = ensureSkillRanksObject(data);
        // Display falls back to the loose-matched value (currentRanks) but rendering must
        // NOT write it into the map: seeding here materialized the fallback — a Craft
        // parent row loose-matching "craft (traps)" copied the subskill's ranks into
        // 'craft' and double-counted the #12 budget. onChange persists real edits only.
        // Max ranks per skill = character level (#12): over-cap shows ⚠, never clamps.
        const levelCap = Number(data?.level) || 0;
        const bag = { ranks: map[rankKey] != null ? map[rankKey] : (currentRanks || 0) };
        return dblclickEditable(bag, 'ranks', {
            type: 'number',
            min: 0,
            max: 40,
            format: (raw) => {
                const n = Number(raw) || 0;
                return String(raw == null || raw === '' ? 0 : raw)
                    + (levelCap > 0 && n > levelCap ? ' ⚠' : '');
            },
            parse: (s) => parseIntLoose(s, 0),
            onChange: (v) => {
                const m = ensureSkillRanksObject(data);
                const n = Number(v) || 0;
                if (n <= 0) delete m[rankKey];
                else m[rankKey] = n;
                quietSave();
                if (window.SheetApp.current) {
                    renderSheet(window.SheetApp.current);
                    setActiveTab('skills');
                }
            },
        });
    }

    return {
        parseSkillRanks, ranksForSkill, skillAbilityKey, getSkillAbility, setSkillAbility,
        skillBonusEntry, setSkillBonus, skillUserBonus, skillMiscBonus, skillRankKey, ranksEditor,
        skillFlags, setSkillFlag, customSkills, allSkills, addCustomSkill, removeCustomSkill,
    };
})();
