// scripts/levelup.js -- the sheet-side level-up wizard (window.SheetLevelUp). Fully
// client-side: preserves every manual edit instead of regenerating the character. One
// SheetOverlay flow: pick class → HP (roll or average) → feat at odd levels → ability
// bump at every 4th → Apply, with a live diff summary before anything is written.
//
// What it writes: classes[]/class_list/level (chosen class +1), bab_total and
// save_bases deltas from the classInfo chassis progression, total_rolled_hp (+ the HP
// gain; Con is added automatically by the HP formula), _sheet.abilityAdjust[ab].levelup,
// and data.feats. Skill ranks and caster slots stay manual — the closing toast says how
// many rank points to spend, and slots are edited on the Spells tab's per-day table.
window.SheetLevelUp = (function () {
    'use strict';
    const { h } = window.SheetUI;
    const { classKeyOf, classLevelFor, classInfoFor } = window.SheetClassInfo;

    const AB_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution',
        int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

    const babFor = (prog, lvl) => {
        const p = String(prog || '').toLowerCase();
        if (p === 'full') return lvl;
        if (p === '1/2') return Math.floor(lvl / 2);
        if (p === '3/4') return Math.floor((lvl * 3) / 4);
        return null; // unknown chassis — leave BAB alone and say so
    };
    // Zero levels in a class contribute nothing — the good-save +2 arrives WITH level 1.
    const saveFor = (good, lvl) => (lvl <= 0 ? 0
        : (good ? 2 + Math.floor(lvl / 2) : Math.floor(lvl / 3)));

    /**
     * Warn-only feat-prereq check (#13): parse the compendium description's
     * "Prerequisites:" sentence and verify what the sheet can — ability minimums, BAB,
     * character level, and prerequisite feats (only tokens that resolve to a real catalog
     * feat; class features and prose stay unverified rather than false-warning).
     * Returns display strings for the unmet ones.
     */
    function featPrereqIssues(data, featName, newLevel) {
        const sd = window.SheetDetails?.lookup?.('feats', featName);
        const text = String(sd?.description || '').replace(/<[^>]+>/g, ' ');
        const m = text.match(/Prerequisites?\s*:?\s*(.*?)(?:\.\s|\.$|Benefits?\s*:)/is);
        if (!m) return [];
        const unmet = [];
        for (const raw of m[1].split(/[,;]|\band\b/i)) {
            const t = raw.trim();
            if (!t) continue;
            let mm;
            if ((mm = t.match(/^(Str|Dex|Con|Int|Wis|Cha)\w*\s+(\d+)/i))) {
                const ab = mm[1].toLowerCase().slice(0, 3);
                const have = Number(window.SheetDerive?.abilityInfo?.(data, ab)?.total) || 0;
                if (have < Number(mm[2])) unmet.push(`${mm[1]} ${mm[2]} (have ${have})`);
            } else if ((mm = t.match(/base attack bonus \+?(\d+)/i))) {
                const have = Number(data.bab_total) || 0;
                if (have < Number(mm[1])) unmet.push(`BAB +${mm[1]} (have +${have})`);
            } else if ((mm = t.match(/character level (\d+)/i))) {
                if (newLevel < Number(mm[1])) unmet.push(t);
            } else if (window.SheetDetails?.lookup?.('feats', t)) {
                if (!window.SheetRoll?.hasFeat?.(data, t)) unmet.push(t);
            }
        }
        return unmet;
    }

    function classesArr(data) {
        if (!Array.isArray(data.classes) || !data.classes.length) {
            // Seed from legacy fields so single-class payloads level cleanly.
            data.classes = window.SheetState.ensureClassList(data)
                .map((name, i) => ({ name, display: name,
                    level: i === 0 ? (Number(data.level) || 1) : 1 }));
        }
        return data.classes;
    }

    function open(data) {
        if (!data || data.error || !window.SheetOverlay?.open) return;
        const classes = classesArr(data);
        const totalNow = window.SheetDerive.totalLevel(data);
        const totalNext = totalNow + 1;

        const body = h('div', 'levelup-body');
        body.appendChild(h('p', 'dim',
            `Level ${totalNow} → ${totalNext}. Pick the class taking the level; the chassis `
            + '(HD, BAB, saves) comes from the class table — editable per character via the '
            + 'class popup if yours differs.'));

        // --- class pick
        const clsRow = h('label', 'levelup-row');
        clsRow.appendChild(h('span', 'levelup-label', 'Class'));
        const clsSel = h('select', 'edit-field');
        for (const c of classes) {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = `${c.display || c.name} (${classLevelFor(data, c.name)} → ${classLevelFor(data, c.name) + 1})`;
            clsSel.appendChild(opt);
        }
        for (const c of window.SheetData.CLASSES) {
            if (c === 'Random') continue;
            if (classes.some((x) => classKeyOf(x.name) === classKeyOf(c))) continue;
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c + ' (new class, level 1)';
            clsSel.appendChild(opt);
        }
        clsRow.appendChild(clsSel);
        body.appendChild(clsRow);

        // --- HP
        const hpRow = h('div', 'levelup-row');
        hpRow.appendChild(h('span', 'levelup-label', 'Hit points'));
        const hpVal = h('span', 'levelup-hp-val', '—');
        const rollBtn = h('button', 'inv-btn', '🎲 Roll');
        rollBtn.type = 'button';
        const avgBtn = h('button', 'inv-btn', 'Average');
        avgBtn.type = 'button';
        hpRow.append(rollBtn, avgBtn, hpVal,
            h('span', 'dim', ' (Con is added automatically)'));
        body.appendChild(hpRow);
        let hpGain = null;
        const hdOf = () => Number(classInfoFor(data, clsSel.value).hd) || 8;
        rollBtn.addEventListener('click', () => {
            hpGain = 1 + Math.floor(Math.random() * hdOf());
            hpVal.textContent = `${hpGain} (d${hdOf()})`;
            updateSummary();
        });
        avgBtn.addEventListener('click', () => {
            hpGain = Math.floor(hdOf() / 2) + 1;
            hpVal.textContent = `${hpGain} (avg d${hdOf()})`;
            updateSummary();
        });
        clsSel.addEventListener('change', () => {
            hpGain = null;
            hpVal.textContent = '—';
            updateSummary();
        });

        // --- feat at odd character level (with warn-only prereq badges, #13)
        let featName = null;
        let featBadge = null;
        if (totalNext % 2 === 1) {
            const featRow = h('div', 'levelup-row');
            featRow.appendChild(h('span', 'levelup-label', 'Feat'));
            const featBtn = h('button', 'inv-btn', 'Pick feat…');
            featBtn.type = 'button';
            const featVal = h('span', 'levelup-feat-val dim', `level ${totalNext} grants a feat`);
            featBadge = h('span', 'levelup-prereq-badge');
            const setFeat = (name) => {
                featName = name;
                featVal.textContent = featName;
                const unmet = featPrereqIssues(data, featName, totalNext);
                featBadge.textContent = unmet.length
                    ? '⚠ prereqs: ' + unmet.join(', ') : '';
                featBadge.title = unmet.length
                    ? 'Warn-only — the sheet never blocks a pick' : '';
                updateSummary();
            };
            featBtn.addEventListener('click', () => {
                window.SheetModals.openCatalogPicker({
                    title: 'Pick the new feat',
                    kinds: ['feats'],
                    allowCustom: true,
                    customPlaceholder: 'Custom feat name',
                    onPick: (hit) => setFeat(hit.name),
                    onCustom: (name) => setFeat(String(name).trim()),
                });
            });
            featRow.append(featBtn, featVal, featBadge);
            body.appendChild(featRow);
        }

        // --- ability bump at every 4th
        let bumpSel = null;
        if (totalNext % 4 === 0) {
            const abRow = h('label', 'levelup-row');
            abRow.appendChild(h('span', 'levelup-label', 'Ability +1'));
            bumpSel = h('select', 'edit-field');
            for (const [k, name] of Object.entries(AB_NAMES)) {
                const opt = document.createElement('option');
                opt.value = k;
                opt.textContent = name;
                bumpSel.appendChild(opt);
            }
            bumpSel.addEventListener('change', updateSummary);
            abRow.appendChild(bumpSel);
            body.appendChild(abRow);
        }

        // --- in-wizard skill-rank spending (#13, budget model from #12)
        const pendingRanks = {}; // rank key -> ranks added this level
        const intMod = window.SheetDerive.abModOf(data, 'int');
        const isHuman = /human/.test(String(data.race || '').toLowerCase())
            && !/half/.test(String(data.race || '').toLowerCase());
        const ranksThisLevel = () => {
            const info = classInfoFor(data, clsSel.value);
            return Math.max(1, (Number(info.skills) || 2) + intMod) + (isHuman ? 1 : 0);
        };
        const ranksSpent = () => Object.values(pendingRanks).reduce((a, v) => a + v, 0);
        const ranksBox = h('details', 'levelup-ranks');
        const ranksSummary = h('summary', null, '');
        ranksBox.appendChild(ranksSummary);
        const ranksGrid = h('div', 'levelup-ranks-grid');
        ranksBox.appendChild(ranksGrid);
        const rankMap = window.SheetState.ensureSkillRanksObject(data);
        const refreshRanksHeader = () => {
            const left = ranksThisLevel() - ranksSpent();
            ranksSummary.textContent = `Skill ranks — ${ranksThisLevel()} to spend`
                + (ranksSpent() ? ` (${left < 0 ? left : left + ' left'}${left < 0 ? ' — over!' : ''})` : '');
            ranksSummary.classList.toggle('is-over', left < 0);
        };
        {
            const { skillRankKey } = window.SheetSkillMath;
            for (const skill of window.SheetData.ALL_SKILLS) {
                const key = skillRankKey(skill.name);
                const row = h('div', 'levelup-rank-row');
                const cur = Number(rankMap[key]) || 0;
                const label = h('span', 'levelup-rank-name',
                    `${skill.name}${cur ? ` (${cur})` : ''}`);
                const count = h('span', 'levelup-rank-count', '');
                const minus = h('button', 'inv-btn', '−');
                minus.type = 'button';
                const plus = h('button', 'inv-btn', '+');
                plus.type = 'button';
                const paint = () => {
                    const n = pendingRanks[key] || 0;
                    count.textContent = n ? `+${n}` : '';
                    // Max ranks = new character level; warn, never clamp.
                    row.classList.toggle('is-over', cur + n > totalNext);
                    row.title = cur + n > totalNext
                        ? `Over the max-ranks cap (${totalNext} = character level)` : '';
                };
                minus.addEventListener('click', () => {
                    if (!pendingRanks[key]) return;
                    pendingRanks[key] -= 1;
                    if (!pendingRanks[key]) delete pendingRanks[key];
                    paint();
                    refreshRanksHeader();
                    updateSummary();
                });
                plus.addEventListener('click', () => {
                    pendingRanks[key] = (pendingRanks[key] || 0) + 1;
                    paint();
                    refreshRanksHeader();
                    updateSummary();
                });
                paint();
                row.append(label, count, minus, plus);
                ranksGrid.appendChild(row);
            }
        }
        refreshRanksHeader();
        clsSel.addEventListener('change', refreshRanksHeader);
        body.appendChild(ranksBox);

        // --- spells known for spontaneous casters (#13). Picks land in the PRIMARY
        // book's known list at the chosen level; extra books stay Spells-tab edits.
        const spellPicks = []; // { name, level }
        const spellsRow = h('div', 'levelup-row levelup-spells');
        spellsRow.appendChild(h('span', 'levelup-label', 'Spells known'));
        const spellsBtn = h('button', 'inv-btn', 'Pick spell…');
        spellsBtn.type = 'button';
        const spellsList = h('span', 'levelup-spells-list');
        const paintSpells = () => {
            spellsList.innerHTML = '';
            spellPicks.forEach((p, idx) => {
                const chip = h('span', 'feat-tag levelup-spell-chip');
                chip.appendChild(document.createTextNode(p.name + ' '));
                const lvSel = h('select', 'edit-field levelup-spell-lv');
                for (let lv = 0; lv <= 9; lv++) {
                    const opt = document.createElement('option');
                    opt.value = String(lv);
                    opt.textContent = 'L' + lv;
                    if (lv === p.level) opt.selected = true;
                    lvSel.appendChild(opt);
                }
                lvSel.addEventListener('change', () => {
                    p.level = parseInt(lvSel.value, 10) || 0;
                });
                const rm = h('button', 'inv-btn inv-btn-danger', '×');
                rm.type = 'button';
                rm.addEventListener('click', () => {
                    spellPicks.splice(idx, 1);
                    paintSpells();
                    updateSummary();
                });
                chip.append(lvSel, rm);
                spellsList.appendChild(chip);
            });
        };
        spellsBtn.addEventListener('click', () => {
            window.SheetModals.openCatalogPicker({
                title: 'New spell known',
                kinds: ['spells'],
                allowCustom: true,
                customPlaceholder: 'Custom spell name',
                onPick: (hit) => {
                    const sd = window.SheetDetails?.lookup?.('spells', hit.name);
                    spellPicks.push({ name: hit.name,
                        level: Number.isFinite(Number(sd?.level)) ? Number(sd.level) : 1 });
                    paintSpells();
                    updateSummary();
                },
                onCustom: (name) => {
                    spellPicks.push({ name: String(name).trim(), level: 1 });
                    paintSpells();
                    updateSummary();
                },
            });
        });
        spellsRow.append(spellsBtn, spellsList);
        const syncSpellsRow = () => {
            const casting = String(classInfoFor(data, clsSel.value).casting || '');
            spellsRow.classList.toggle('hidden', !/spontaneous/i.test(casting));
        };
        syncSpellsRow();
        clsSel.addEventListener('change', syncSpellsRow);
        body.appendChild(spellsRow);

        // --- class features gained at the new level (#24). Compendium suggestions from
        // the "at Nth level" description markers — preselected, untickable; choice pools
        // (rage powers, hexes…) have no marker and stay Browse-only by design.
        let featurePicks = []; // { name, on }
        const ownsFeature = (name) => (Array.isArray(data.class_ability) ? data.class_ability : [])
            .some((x) => String(x).toLowerCase().includes(String(name).toLowerCase()));
        const featuresBox = h('div', 'levelup-row levelup-features');
        const featuresLabel = h('span', 'levelup-label', 'Class features');
        const featuresList = h('span', 'levelup-features-list');
        featuresBox.append(featuresLabel, featuresList);
        body.appendChild(featuresBox);
        const refreshFeatures = () => {
            const { clsName, newLvl } = pendingDiff();
            const found = (window.SheetDetails?.classFeaturesAtLevel?.(clsName, newLvl) || [])
                .filter((e) => !ownsFeature(e.name));
            // The measured core progression runs 0–4 features per level; a bigger crop
            // means pool leakage (wizard school powers, domain auras) — offer those
            // unchecked so a misparse costs a tick, not an untick-hunt.
            const pool = found.length > 4;
            featurePicks = found.map((e) => ({ name: e.name, on: !pool }));
            featuresList.innerHTML = '';
            if (!featurePicks.length) {
                featuresList.appendChild(h('span', 'dim',
                    `none marked for ${clsName} ${newLvl} — choice pools (rage powers, `
                    + 'hexes…) are added via Browse on the Features tab'));
            } else if (pool) {
                featuresList.appendChild(h('span', 'dim',
                    `${found.length} parsed — reads like a choice pool; `
                    + 'tick only what your build actually grants: '));
            }
            for (const pick of featurePicks) {
                const lab = h('label', 'levelup-feature-pick');
                const cb = h('input');
                cb.type = 'checkbox';
                cb.checked = pick.on;
                cb.addEventListener('change', () => {
                    pick.on = cb.checked;
                    updateSummary();
                });
                lab.append(cb, h('span', null, pick.name));
                featuresList.appendChild(lab);
            }
            updateSummary();
        };
        clsSel.addEventListener('change', refreshFeatures);

        // --- live diff summary
        const summary = h('ul', 'levelup-summary');
        body.appendChild(h('h4', null, 'Will apply'));
        body.appendChild(summary);

        function pendingDiff() {
            const clsName = clsSel.value;
            const info = classInfoFor(data, clsName);
            const existing = classes.find((c) => classKeyOf(c.name) === classKeyOf(clsName));
            const oldLvl = existing ? (Number(existing.level) || 0) : 0;
            const newLvl = oldLvl + 1;
            const babOld = babFor(info.bab, oldLvl);
            const babNew = babFor(info.bab, newLvl);
            const babDelta = babOld == null || babNew == null ? null : babNew - babOld;
            const saveDelta = {};
            for (const s of ['fort', 'ref', 'will']) {
                const good = String(info[s] || '').toLowerCase() === 'good';
                saveDelta[s] = saveFor(good, newLvl) - saveFor(good, oldLvl);
            }
            const skillPts = (Number(info.skills) || 0)
                + window.SheetDerive.abModOf(data, 'int');
            return { clsName, info, existing, oldLvl, newLvl, babDelta, saveDelta, skillPts };
        }
        function updateSummary() {
            const p = pendingDiff();
            summary.innerHTML = '';
            const li = (text) => summary.appendChild(h('li', null, text));
            li(`${p.clsName}: level ${p.oldLvl} → ${p.newLvl}`
                + (p.existing ? '' : ' (new class)'));
            li(p.babDelta == null
                ? 'BAB: unknown progression — adjust manually'
                : `BAB: ${p.babDelta ? '+' + p.babDelta : 'unchanged'}`);
            const saves = ['fort', 'ref', 'will']
                .filter((s) => p.saveDelta[s])
                .map((s) => `${s} +${p.saveDelta[s]}`);
            li('Saves: ' + (saves.length ? saves.join(', ') : 'unchanged')
                + (data.save_bases ? '' : ' (no save_bases on payload — derived from level)'));
            li('HP: ' + (hpGain == null ? 'roll or take average above' : `+${hpGain} + Con`));
            if (totalNext % 2 === 1) li('Feat: ' + (featName || 'none picked yet'));
            if (bumpSel) li(`Ability: ${AB_NAMES[bumpSel.value]} +1 (Level-up column)`);
            const spent = ranksSpent();
            li(`Skill ranks: ${spent}/${ranksThisLevel()} spent in the wizard`
                + (spent < ranksThisLevel() ? ' (the rest stays spendable on the Skills tab)'
                    : spent > ranksThisLevel() ? ' — over budget (warn only)' : ''));
            if (spellPicks.length) {
                li('Spells known: + ' + spellPicks.map((s) => `${s.name} (L${s.level})`).join(', '));
            }
            const featsOn = featurePicks.filter((f) => f.on);
            if (featsOn.length) {
                li('Class features: + ' + featsOn.map((f) => f.name).join(', '));
            }
            if (String(p.info.casting || '—') !== '—' && p.info.casting !== 'None') {
                li('Caster: update slots on the Spells tab (per-day table is editable)');
            }
        }
        updateSummary();
        refreshFeatures();

        const applyBtn = h('button', 'inv-btn inv-btn-primary', `Apply level ${totalNext}`);
        applyBtn.type = 'button';
        const handle = window.SheetOverlay.open({
            title: `Level up — ${data.character_full_name || 'character'}`,
            body,
            footer: [applyBtn],
        });
        applyBtn.addEventListener('click', () => {
            if (hpGain == null) {
                alert('Roll or take average HP first.');
                return;
            }
            // #80: a level is the classic "wish I could go back" boundary — snapshot the
            // pre-level state (fire-and-forget; the apply itself must not wait on IDB).
            window.SheetLibrary?.takeSnapshot?.(data, `before level ${totalNext}`);
            const p = pendingDiff();
            // Class level
            if (p.existing) {
                p.existing.level = p.newLvl;
            } else {
                classes.push({ name: p.clsName, display: p.clsName, level: 1 });
                if (Array.isArray(data.class_list)) data.class_list.push(p.clsName);
                window.SheetState.syncLegacyClasses(data);
            }
            if (classKeyOf(classes[0]?.name) === classKeyOf(p.clsName)) {
                data.level = p.newLvl; // header level tracks the primary class
            }
            // BAB / saves
            if (p.babDelta) data.bab_total = (Number(data.bab_total) || 0) + p.babDelta;
            if (data.save_bases && typeof data.save_bases === 'object') {
                for (const s of ['fort', 'ref', 'will']) {
                    if (p.saveDelta[s]) {
                        data.save_bases[s] = (Number(data.save_bases[s]) || 0) + p.saveDelta[s];
                    }
                }
            }
            // HP (rolled dice only; Con × level follows automatically in the HP formula)
            data.total_rolled_hp = (Number(data.total_rolled_hp) || 0) + hpGain;
            // Feat / ability bump
            if (featName) {
                if (!Array.isArray(data.feats)) data.feats = [];
                data.feats.push(featName);
            }
            if (bumpSel) {
                const st = (data._sheet ??= {});
                st.abilityAdjust ??= {};
                st.abilityAdjust[bumpSel.value] ??= {};
                st.abilityAdjust[bumpSel.value].levelup =
                    (Number(st.abilityAdjust[bumpSel.value].levelup) || 0) + 1;
            }
            // Skill ranks picked in the wizard (#13)
            const spentNow = ranksSpent();
            for (const [key, n] of Object.entries(pendingRanks)) {
                if (n > 0) rankMap[key] = (Number(rankMap[key]) || 0) + n;
            }
            // Class features gained (#24) — the same class_ability shape the Features
            // tab's Browse add writes, so curated changes apply immediately.
            const featsOn = featurePicks.filter((f) => f.on && !ownsFeature(f.name));
            if (featsOn.length) {
                if (!Array.isArray(data.class_ability)) data.class_ability = [];
                const clsSuffix = String(p.clsName).toLowerCase().replace(/\s+/g, '');
                for (const f of featsOn) data.class_ability.push(f.name + '_' + clsSuffix);
            }
            // Spells known (spontaneous casters): into the primary book's known list
            for (const s of spellPicks) {
                if (!Array.isArray(data.spell_list_choose_from)) data.spell_list_choose_from = [];
                while (data.spell_list_choose_from.length <= s.level) {
                    data.spell_list_choose_from.push([]);
                }
                const bucket = data.spell_list_choose_from[s.level];
                if (!bucket.some((n) => String(n).toLowerCase() === s.name.toLowerCase())) {
                    bucket.push(s.name);
                }
            }
            handle.close();
            window.SheetApp.quietSave?.();
            window.SheetApp.renderSheet(data);
            const leftover = ranksThisLevel() - spentNow;
            window.SheetOverlay.toast?.(
                `Level ${totalNext}: ${p.clsName} ${p.newLvl}`
                + (spentNow ? ` — ${spentNow} ranks placed` : '')
                + (leftover > 0 ? ` — ${leftover} skill ranks left for the Skills tab` : '')
                + (spellPicks.length ? ` — ${spellPicks.length} spells learned` : '')
                + (featsOn.length ? ` — ${featsOn.length} class feature${featsOn.length === 1 ? '' : 's'} gained` : '')
                + '.');
        });
    }

    return { open };
})();
