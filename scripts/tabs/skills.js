// scripts/tabs/skills.js -- the Skills tab + the shared skill-math helpers
// (window.SheetTabSkills). Extracted from sheet.js (Part B split); bodies moved verbatim except
// currentData / ALL_SKILLS reads (routed through SheetApp). Several helpers (skillAbilityKey,
// skillBonusEntry, setSkillBonus, ranksForSkill, ...) are consumed by other tabs and by modals.js
// via SheetApp -- the shell destructures them back and the modals SheetApp delegates re-point here.
window.SheetTabSkills = (function () {
    'use strict';
    const {
        h, section, details, kv, fmt, toInt, nonEmpty, parseIntLoose, dblclickEditable,
    } = window.SheetUI;
    const { abModOf, effectiveLedger } = window.SheetDerive;
    const { sheetState, quietSave, ensureSkillRanksObject, attachNotesHover } = window.SheetState;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);
    const rollBtn = (...a) => window.SheetApp.rollBtn(...a);
    const rollAllBar = (...a) => window.SheetApp.rollAllBar(...a);

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
    function skillMiscBonus(data, skill) {
        const SD = window.SheetDetails;
        const ab = getSkillAbility(data, skill);
        // Use effective ledger so per-buff toggles apply
        const ledger = effectiveLedger(data);
        // ACP applies when skill is Str/Dex based (Foundry-style) or originally marked acp
        const acpApplies = skill.acp || ab === 'str' || ab === 'dex';
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
            const acp = toInt(data.armor_armor_check_penalty);
            if (acp != null && acp !== 0) {
                const pen = acp > 0 ? -acp : acp;
                total += pen;
                bits.push({ source: 'Armor check', value: pen });
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
        if (map[rankKey] == null && currentRanks) map[rankKey] = currentRanks;
        // Hold ranks on a bag; onChange syncs into skill_ranks map
        const bag = { ranks: map[rankKey] || 0 };
        return dblclickEditable(bag, 'ranks', {
            type: 'number',
            min: 0,
            max: 40,
            format: (raw) => String(raw == null || raw === '' ? 0 : raw),
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
    function renderSkills(data) {
        const rankMap = ensureSkillRanksObject(data);
        const { sec, body } = section('Skills');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Double-click ranks to edit. Change ability via the Abl dropdown. Roll = 1d20 + ranks + ability + misc.'));

        const unlockSkill = (data.skill_unlock?.base_skill || '').toLowerCase();
        const table = h('table', 'skills-table skills-table-full');
        const hd = h('tr');
        ['', 'Skill', 'Abl', 'Ranks', 'Mod', 'Racial', 'Feat', 'Trait', 'Misc', 'Buffs', 'CS', 'Total']
            .forEach((t) => hd.appendChild(h('th', null, t)));
        table.appendChild(hd);

        // Bulk roll: drive the per-row Roll buttons this table already builds, so the totals
        // and log formatting stay in one place.
        body.appendChild(rollAllBar('🎲 Roll all skills',
            'Roll 1d20 for every skill into the Tools log', table));

        // Editable user-bonus cell (Racial / Feat / Trait / Misc)
        const bonusCell = (key, field, entry) => {
            const td = h('td', 'num skill-bonus-cell');
            const bag = { v: Number(entry[field]) || 0 };
            td.appendChild(dblclickEditable(bag, 'v', {
                type: 'number', min: -99, max: 99,
                format: (v) => (Number(v) ? fmt(Number(v)) : '—'),
                parse: (s) => parseIntLoose(s, 0),
                onChange: (v) => {
                    setSkillBonus(data, key, field, v);
                    renderSheet(data);
                    setActiveTab('skills');
                },
            }));
            return td;
        };
        // Class-skill toggle: +3 once the skill has at least 1 rank (PF1)
        const csCell = (key, entry, ranks) => {
            const td = h('td', 'num skill-cs-cell');
            const on = !!entry.cs;
            const btn = h('button', 'skill-cs-btn' + (on ? ' is-on' : ''),
                on ? (ranks >= 1 ? '+3' : '✓') : '—');
            btn.type = 'button';
            btn.title = on
                ? (ranks >= 1 ? 'Class skill: +3 applied — click to clear'
                    : 'Class skill (+3 needs at least 1 rank) — click to clear')
                : 'Mark as class skill (+3 with at least 1 rank)';
            btn.addEventListener('click', () => {
                setSkillBonus(data, key, 'cs', !on);
                renderSheet(data);
                setActiveTab('skills');
            });
            td.appendChild(btn);
            return td;
        };

        const craftLabel = data.craft_type ? `Craft (${data.craft_type})` : 'Craft';
        for (const skill of window.SheetApp.ALL_SKILLS) {
            const displayName = skill.name === 'Craft' ? craftLabel
                : skill.name === 'Profession' && nonEmpty(data.profession_ranks)
                    ? null // handled in profession block with detail
                    : skill.name;
            if (displayName === null) continue;

            const rKey = skillRankKey(
                skill.name === 'Craft' && data.craft_type ? craftLabel : skill.name,
            );
            const ranks = ranksForSkill(rankMap, skill.name)
                || ranksForSkill(rankMap, displayName)
                || (skill.name === 'Craft' && data.craft_type
                    ? ranksForSkill(rankMap, 'craft') : 0);
            const ab = getSkillAbility(data, skill);
            const abMod = abModOf(data, ab);
            const skillEff = { ...skill, ab };
            const misc = skillMiscBonus(data, skillEff);
            const bonusKey = skillAbilityKey(skill);
            const entry = skillBonusEntry(data, bonusKey);
            const user = skillUserBonus(data, bonusKey, ranks);
            const total = ranks + abMod + misc.total + user.total;
            const tr = h('tr', displayName.toLowerCase().includes(unlockSkill) && unlockSkill
                ? 'unlocked' : null);

            const rollTd = h('td', 'skill-roll-cell no-print');
            rollTd.appendChild(rollBtn(displayName + ' check', total, `1d20${fmt(total)}`));
            tr.appendChild(rollTd);
            const nameTd = h('td', null,
                displayName + (unlockSkill && displayName.toLowerCase().includes(unlockSkill) ? ' ★' : ''));
            tr.appendChild(nameTd);
            // Situational context notes (e.g. trait bonuses vs specific targets) hover here
            const abBucket = {
                str: 'strSkills', dex: 'dexSkills', con: 'conSkills',
                int: 'intSkills', wis: 'wisSkills', cha: 'chaSkills',
            }[ab];
            attachNotesHover(nameTd, data,
                ['skills', abBucket, skill.id ? 'skill.' + skill.id : null].filter(Boolean));

            const abTd = h('td', 'num skill-ab-cell');
            const abSel = h('select', 'skill-ability-select edit-field');
            abSel.title = 'Key ability (default ' + String(skill.ab).toUpperCase() + ')';
            for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
                const opt = document.createElement('option');
                opt.value = a;
                opt.textContent = a.toUpperCase();
                if (a === ab) opt.selected = true;
                abSel.appendChild(opt);
            }
            abSel.addEventListener('change', () => {
                setSkillAbility(data, skill, abSel.value);
                renderSheet(data);
                setActiveTab('skills');
            });
            abTd.appendChild(abSel);
            tr.appendChild(abTd);

            const rankTd = h('td', 'num skill-ranks-cell');
            rankTd.appendChild(ranksEditor(data, rKey, ranks));
            tr.appendChild(rankTd);
            tr.appendChild(h('td', 'num', fmt(abMod)));
            tr.appendChild(bonusCell(bonusKey, 'racial', entry));
            tr.appendChild(bonusCell(bonusKey, 'feat', entry));
            tr.appendChild(bonusCell(bonusKey, 'trait', entry));
            tr.appendChild(bonusCell(bonusKey, 'misc', entry));
            tr.appendChild(h('td', 'num', misc.total ? fmt(misc.total) : '—'));
            tr.appendChild(csCell(bonusKey, entry, ranks));
            const totalTd = h('td', 'num skill-total', fmt(total));
            totalTd.title = `ranks ${ranks} + ${ab.toUpperCase()} ${fmt(abMod)}`
                + (misc.total ? ` + buffs ${fmt(misc.total)}` : '')
                + (user.racial ? ` + racial ${fmt(user.racial)}` : '')
                + (user.feat ? ` + feat ${fmt(user.feat)}` : '')
                + (user.trait ? ` + trait ${fmt(user.trait)}` : '')
                + (user.misc ? ` + misc ${fmt(user.misc)}` : '')
                + (user.csBonus ? ' + class skill +3' : '');
            tr.appendChild(totalTd);
            table.appendChild(tr);
        }
        body.appendChild(table);

        if (data.skill_unlock?.skill) {
            const u = data.skill_unlock;
            const tiers = Object.entries(u.unlock || {})
                .map(([lv, txt]) => `<p><strong>${lv} ranks:</strong> ${txt}</p>`).join('');
            body.appendChild(details(`★ Skill Unlock: ${u.skill}`, tiers));
        }
        if (nonEmpty(data.profession_ranks)) {
            body.appendChild(h('h3', null, 'Professions'));
            const t2 = h('table', 'skills-table skills-table-full professions');
            const phd = h('tr');
            ['', 'Profession', 'Abl', 'Ranks', 'Mod', 'Racial', 'Feat', 'Trait', 'Misc', 'Buffs', 'CS', 'Total']
                .forEach((t) => phd.appendChild(h('th', null, t)));
            t2.appendChild(phd);
            data.profession_ranks.forEach((p, idx) => {
                const label = p.skill_label || p.name || 'Profession';
                const ranks = Number(p.ranks) || 0;
                const abMod = abModOf(data, 'wis');
                const misc = skillMiscBonus(data, { ab: 'wis', id: 'pro', acp: false });
                const proKey = 'pro:' + label;
                const entry = skillBonusEntry(data, proKey);
                const user = skillUserBonus(data, proKey, ranks);
                const total = ranks + abMod + misc.total + user.total;
                const tr = h('tr');
                const rollTd = h('td', 'skill-roll-cell no-print');
                rollTd.appendChild(rollBtn(label + ' check', total));
                tr.appendChild(rollTd);
                const proNameTd = h('td', null, label);
                tr.appendChild(proNameTd);
                attachNotesHover(proNameTd, data, ['skills', 'wisSkills', 'skill.pro']);
                tr.appendChild(h('td', 'num', 'WIS'));
                const rankTd = h('td', 'num skill-ranks-cell');
                rankTd.appendChild(dblclickEditable(p, 'ranks', {
                    type: 'number', min: 0, max: 40,
                    format: (raw) => String(raw == null ? 0 : raw) + (p.cap != null ? `/${p.cap}` : ''),
                    parse: (s) => parseIntLoose(s, 0),
                    onChange: () => {
                        quietSave();
                        if (window.SheetApp.current) {
                            renderSheet(window.SheetApp.current);
                            setActiveTab('skills');
                        }
                    },
                }));
                tr.appendChild(rankTd);
                tr.appendChild(h('td', 'num', fmt(abMod)));
                tr.appendChild(bonusCell(proKey, 'racial', entry));
                tr.appendChild(bonusCell(proKey, 'feat', entry));
                tr.appendChild(bonusCell(proKey, 'trait', entry));
                tr.appendChild(bonusCell(proKey, 'misc', entry));
                tr.appendChild(h('td', 'num', misc.total ? fmt(misc.total) : '—'));
                tr.appendChild(csCell(proKey, entry, ranks));
                tr.appendChild(h('td', 'num skill-total', fmt(total)));
                t2.appendChild(tr);
            });
            body.appendChild(t2);
            if (data.profession_pool != null) kv(body, 'Profession rank pool', data.profession_pool);
        }
        return sec;
    }

    return {
        parseSkillRanks, ranksForSkill, skillAbilityKey, getSkillAbility, setSkillAbility,
        skillBonusEntry, setSkillBonus, skillUserBonus, skillMiscBonus, skillRankKey,
        ranksEditor, renderSkills,
    };
})();
