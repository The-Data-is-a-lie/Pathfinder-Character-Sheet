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
    const { rollBtn, rollAllBar } = window.SheetStatKit;
    const {
        parseSkillRanks, ranksForSkill, skillAbilityKey, getSkillAbility, setSkillAbility,
        skillBonusEntry, setSkillBonus, skillUserBonus, skillMiscBonus, skillRankKey, ranksEditor,
        skillFlags, setSkillFlag, allSkills, addCustomSkill, removeCustomSkill,
    } = window.SheetSkillMath;
    const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

    /**
     * Subsystem skills (Autohypnosis, Knowledge (psionics), Knowledge (martial)) belong to
     * pf1-psionics / pf1-pow, not to core PF1 — so they are gated, but NOT the way Artistry and
     * Lore are. A variant rule is a table decision someone opts into; a psion simply HAS
     * Autohypnosis. The row shows when the character is in the subsystem — by class family, by
     * generated content, or because ranks are already recorded — and stays hidden for everyone
     * else, so a fighter's skill list doesn't grow three rows it can never use.
     */
    function subsystemSkillOn(data, sub, rankKey) {
        if (Number(data.skill_ranks?.[rankKey]) > 0) return true;
        if (sub === 'psionics' && (data.manifesters || []).length) return true;
        if (sub === 'pow' && ((data.maneuvers_known_list || []).length
            || (data.stances_chosen || []).length)) return true;
        const token = sub === 'psionics' ? 'psionic' : 'pow';
        const family = (window.SheetData.CLASS_GROUPS || []).find((g) => g.token === token);
        if (!family) return false;
        const names = new Set(family.classes.map((c) => c.toLowerCase()));
        const classes = window.SheetState.ensureClassList?.(data) || [];
        return [...classes, { name: data.c_class }, { name: data.c_class_2 }]
            .some((c) => names.has(String(c?.name || c?.display || '').toLowerCase().trim()));
    }

    function renderSkills(data) {
        const rankMap = ensureSkillRanksObject(data);
        const { sec, body } = section('Skills');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Double-click ranks to edit. Change ability via the Abl dropdown. Roll = 1d20 + ranks + ability + misc.'));

        const unlockSkill = (data.skill_unlock?.base_skill || '').toLowerCase();
        // #155: the lock freezes each skill's ability, its ACP / RT flags and the custom-skill
        // list (ranks and bonuses stay editable — they change every level; those don't).
        const st = sheetState(data);
        const locked = !!st.skillsLocked;
        const rerender = () => { renderSheet(data); setActiveTab('skills'); };
        const lockBtn = h('button', 'inv-btn skills-lock-btn no-print' + (locked ? ' is-locked' : ''),
            locked ? '🔒 Skill setup locked' : '🔓 Lock skill setup');
        lockBtn.type = 'button';
        lockBtn.setAttribute('aria-pressed', String(locked));
        lockBtn.title = locked
            ? 'Abilities, ACP / trained-only flags and custom skills are locked — click to edit them'
            : 'Lock each skill\'s ability, flags and the custom-skill list against accidental edits';
        lockBtn.addEventListener('click', () => {
            if (locked) delete st.skillsLocked;
            else st.skillsLocked = true;
            quietSave();
            rerender();
        });
        body.appendChild(lockBtn);

        const table = h('table', 'skills-table skills-table-full' + (locked ? ' is-locked' : ''));
        const hd = h('tr');
        ['', 'Skill', 'Abl', 'Flags', 'Ranks', 'Mod', 'Racial', 'Feat', 'Trait', 'Misc', 'Buffs', 'CS', 'Total']
            .forEach((t) => hd.appendChild(h('th', null, t)));
        hd.children[3].title = 'ACP: armor check penalty applies · RT: trained only (no use at 0 ranks)';
        table.appendChild(hd);

        // #155 flag chips: ACP / RT, pressed = on. A trained-only skill at 0 ranks is dimmed and
        // its roll says so — warned, never blocked.
        const flagsCell = (skill) => {
            const td = h('td', 'skill-flags-cell');
            const f = skillFlags(data, skill);
            for (const [flag, label, title] of [
                ['acp', 'ACP', 'Armor check penalty applies to this skill'],
                ['rt', 'RT', 'Trained only: needs at least 1 rank to use'],
            ]) {
                const b = h('button', 'skill-flag' + (f[flag] ? ' is-on' : ''), label);
                b.type = 'button';
                b.dataset.flag = flag;
                b.setAttribute('aria-pressed', String(!!f[flag]));
                b.title = title + (f[flag] ? ' (on)' : ' (off)') + (locked ? ' — unlock to change' : '');
                b.disabled = locked;
                b.addEventListener('click', () => { setSkillFlag(data, skill, flag, !f[flag]); rerender(); });
                td.appendChild(b);
            }
            return td;
        };

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

        // Multi-instance skills (Foundry subskills): user-added Craft/Perform/Profession
        // variants, stored as labels in _sheet.subSkills[skillId]. Each instance keeps its
        // own ranks (skill_ranks under "craft (weapons)") and bonus row ("crf:weapons").
        const SUBSKILL_PARENTS = {
            crf: 'Craft', prf: 'Perform', pro: 'Profession',
            art: 'Artistry', lor: 'Lore', // background-skills variant rows
        };
        const subSkillsOf = (id) => {
            const st = (data._sheet ??= {});
            st.subSkills ??= {};
            if (!Array.isArray(st.subSkills[id])) st.subSkills[id] = [];
            return st.subSkills[id];
        };
        const subSkillRow = (skill, label) => {
            const display = `${skill.name} (${label})`;
            const rKey = skillRankKey(display);
            const bonusKey = `${skill.id}:${String(label).toLowerCase()}`;
            const ranks = ranksForSkill(rankMap, display);
            const abMod = abModOf(data, skill.ab);
            const misc = skillMiscBonus(data, skill);
            const entry = skillBonusEntry(data, bonusKey);
            const user = skillUserBonus(data, bonusKey, ranks);
            const total = ranks + abMod + misc.total + user.total;
            const tr = h('tr', 'skill-subskill-row');
            const rollTd = h('td', 'skill-roll-cell no-print');
            rollTd.appendChild(rollBtn(display + ' check', total, `1d20${fmt(total)}`));
            tr.appendChild(rollTd);
            const nameTd = h('td', 'skill-subskill-name', '↳ ' + display);
            const rm = h('button', 'inv-btn inv-btn-danger no-print skill-subskill-del', '×');
            rm.type = 'button';
            rm.title = 'Remove this ' + skill.name.toLowerCase() + ' entry';
            rm.addEventListener('click', () => {
                if (!confirm(`Remove “${display}”?`)) return;
                const arr = subSkillsOf(skill.id);
                const i = arr.indexOf(label);
                if (i >= 0) arr.splice(i, 1);
                quietSave();
                renderSheet(data);
                setActiveTab('skills');
            });
            nameTd.appendChild(rm);
            tr.appendChild(nameTd);
            tr.appendChild(h('td', 'num', String(skill.ab).toUpperCase()));
            tr.appendChild(h('td', 'skill-flags-cell dim'));
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
            tr.appendChild(h('td', 'num skill-total', fmt(total)));
            return tr;
        };
        const subSkillAddRow = (skill) => {
            const tr = h('tr', 'skill-subskill-add no-print');
            const td = h('td');
            td.setAttribute('colspan', '13');
            const btn = h('button', 'inv-btn', `+ ${skill.name} type…`);
            btn.type = 'button';
            btn.addEventListener('click', () => {
                const label = prompt(`${skill.name} type (e.g. ${skill.id === 'prf'
                    ? 'Oratory' : skill.id === 'pro' ? 'Sailor' : 'Weapons'}):`, '');
                if (!label || !String(label).trim()) return;
                const arr = subSkillsOf(skill.id);
                if (!arr.some((l) => l.toLowerCase() === String(label).trim().toLowerCase())) {
                    arr.push(String(label).trim());
                }
                quietSave();
                renderSheet(data);
                setActiveTab('skills');
            });
            td.appendChild(btn);
            tr.appendChild(td);
            return tr;
        };

        const craftLabel = data.craft_type ? `Craft (${data.craft_type})` : 'Craft';
        for (const skill of allSkills(data)) {
            // Variant-gated rows (Artistry / Lore) render only while their rule is on;
            // ranks typed into them survive a toggle-off in skill_ranks, just unlisted.
            if (skill.variant && !window.SheetState.variantRuleOn?.(data, skill.variant)) continue;
            if (skill.subsystem
                && !subsystemSkillOn(data, skill.subsystem, skillRankKey(skill.name))) continue;
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
            const flags = skillFlags(data, skillEff);
            const untrained = flags.rt && ranks < 1;
            const tr = h('tr', [
                displayName.toLowerCase().includes(unlockSkill) && unlockSkill ? 'unlocked' : null,
                untrained ? 'is-untrained' : null,
                skill.custom ? 'skill-custom-row' : null,
            ].filter(Boolean).join(' ') || null);
            tr.dataset.skill = skill.id;

            const rollTd = h('td', 'skill-roll-cell no-print');
            rollTd.appendChild(rollBtn(displayName + (untrained ? ' check (untrained — trained only!)' : ' check'),
                total, untrained ? `1d20${fmt(total)} — trained only: no ranks yet` : `1d20${fmt(total)}`));
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
            // #79: ⚠ on a skill carrying more ranks than the character has hit dice. Warn only —
            // the rank field stays fully editable.
            const healthMark = window.SheetHealthUI?.rowBadge?.(data, 'skill', rKey);
            if (healthMark) nameTd.appendChild(healthMark);
            if (skill.custom && !locked) {
                const rm = h('button', 'inv-btn inv-btn-danger no-print skill-custom-del', '×');
                rm.type = 'button';
                rm.title = 'Remove this custom skill (its ranks are kept)';
                rm.addEventListener('click', () => {
                    const undo = removeCustomSkill(data, skill.id);
                    rerender();
                    if (undo) {
                        window.SheetOverlay?.toast?.(`Removed “${skill.name}”`, {
                            action: { label: 'Undo', onClick: () => { undo(); rerender(); } },
                        });
                    }
                });
                nameTd.appendChild(rm);
            }

            const abTd = h('td', 'num skill-ab-cell');
            const abSel = h('select', 'skill-ability-select edit-field');
            abSel.title = 'Key ability (default ' + String(skill.ab).toUpperCase() + ')'
                + (locked ? ' — unlock skill setup to change' : '');
            abSel.disabled = locked;
            for (const a of ABILITIES) {
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
            tr.appendChild(flagsCell(skillEff));

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
            if (SUBSKILL_PARENTS[skill.id]) {
                for (const label of subSkillsOf(skill.id)) {
                    table.appendChild(subSkillRow(skill, label));
                }
                table.appendChild(subSkillAddRow(skill));
            }
        }
        // #155: add a custom skill inline — name + ability, Enter or Add. No dialog.
        if (!locked) {
            const tr = h('tr', 'skill-custom-add no-print');
            const td = h('td');
            td.setAttribute('colspan', '13');
            const name = h('input', 'edit-field skill-custom-name');
            name.type = 'text';
            name.placeholder = 'New custom skill (e.g. Knowledge (Golarion), Sailing)…';
            name.setAttribute('aria-label', 'Custom skill name');
            const ab = h('select', 'edit-field skill-custom-ab');
            ab.setAttribute('aria-label', 'Custom skill ability');
            for (const a of ABILITIES) {
                const opt = h('option', null, a.toUpperCase());
                opt.value = a;
                if (a === 'int') opt.selected = true;
                ab.appendChild(opt);
            }
            const add = h('button', 'inv-btn skill-custom-add-btn', '+ Add skill');
            add.type = 'button';
            const doAdd = () => {
                const nm = name.value.trim();
                if (!nm) { name.focus(); return; }
                if (!addCustomSkill(data, nm, ab.value)) {
                    window.SheetOverlay?.toast?.(`There is already a skill called “${nm}”`);
                    return;
                }
                rerender();
            };
            add.addEventListener('click', doAdd);
            name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
            td.append(name, ab, add);
            tr.appendChild(td);
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

        // #12: rank budget footer (feat-footer style). Badges only — nothing blocked.
        body.appendChild(renderRankBudgetFooter(data, rankMap));
        return sec;
    }

    /** Spent = every rank in skill_ranks (subskill instances live there too). Budget =
     *  SheetClassInfo.skillRankBudget. Hover the Budget box for the formula. */
    function renderRankBudgetFooter(data, rankMap) {
        const spent = Object.values(rankMap).reduce((a, v) => a + (Number(v) || 0), 0);
        const budget = window.SheetClassInfo?.skillRankBudget?.(data) || { total: 0, parts: [] };
        const box = (label, value, cls) => {
            const b = h('div', 'feat-count-box' + (cls ? ' ' + cls : ''));
            b.appendChild(h('span', 'feat-count-label', label));
            b.appendChild(h('span', 'feat-count-value', String(value)));
            return b;
        };
        // Background-skills variant (#21): ranks in background skills draw on their own
        // 2/level pool first; only the overflow counts against the adventuring budget.
        let bg = null;
        if (window.SheetState.variantRuleOn?.(data, 'backgroundSkills')) {
            const ids = new Set(window.SheetData.BACKGROUND_SKILL_IDS || []);
            const bgNames = new Set((window.SheetData.ALL_SKILLS || [])
                .filter((s) => ids.has(s.id)).map((s) => s.name.toLowerCase()));
            let bgSpent = 0;
            for (const [k, v] of Object.entries(rankMap)) {
                const n = Number(v) || 0;
                if (!n) continue;
                const kl = String(k).toLowerCase().trim();
                const base = kl.replace(/\s*\(.*$/, '').trim();
                if (bgNames.has(kl) || bgNames.has(base)) bgSpent += n;
            }
            const bgBudget = 2 * (Number(budget.levelSum) || 0);
            bg = { spent: bgSpent, budget: bgBudget, used: Math.min(bgSpent, bgBudget) };
        }
        const advSpent = spent - (bg ? bg.used : 0);
        const wrap = h('div', 'feat-counts skill-rank-footer');
        const joined = h('div', 'feat-count-joined');
        const budgetBox = box('Budget', budget.total);
        budgetBox.title = budget.parts.length
            ? budget.parts.join('\n') + '\nFCB skill levels are set on each class popup.'
            : 'No class levels found';
        joined.append(box(bg ? 'Adventuring' : 'Ranks spent', advSpent), budgetBox);
        if (bg) {
            const bgBox = box('Background', `${bg.spent}/${bg.budget}`);
            bgBox.title = '2 background ranks per class level (Unchained). Background-skill '
                + 'ranks past this pool count against the adventuring budget.';
            joined.append(bgBox);
        }
        wrap.appendChild(joined);
        if (budget.total > 0 && advSpent !== budget.total) {
            const diff = budget.total - advSpent;
            const badge = box(diff > 0 ? 'Unspent' : 'Over budget', Math.abs(diff),
                diff > 0 ? 'is-missing' : 'is-excess');
            badge.title = diff > 0
                ? `${diff} rank${diff === 1 ? '' : 's'} still to place`
                : `${-diff} more rank${diff === -1 ? '' : 's'} than the budget allows — the sheet warns, it never blocks`;
            wrap.appendChild(badge);
        }
        return wrap;
    }

    return { renderSkills };
})();
