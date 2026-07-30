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

        // --- feat at odd character level
        let featName = null;
        if (totalNext % 2 === 1) {
            const featRow = h('div', 'levelup-row');
            featRow.appendChild(h('span', 'levelup-label', 'Feat'));
            const featBtn = h('button', 'inv-btn', 'Pick feat…');
            featBtn.type = 'button';
            const featVal = h('span', 'levelup-feat-val dim', `level ${totalNext} grants a feat`);
            featBtn.addEventListener('click', () => {
                window.SheetModals.openCatalogPicker({
                    title: 'Pick the new feat',
                    kinds: ['feats'],
                    allowCustom: true,
                    customPlaceholder: 'Custom feat name',
                    onPick: (hit) => {
                        featName = hit.name;
                        featVal.textContent = featName;
                        updateSummary();
                    },
                    onCustom: (name) => {
                        featName = String(name).trim();
                        featVal.textContent = featName;
                        updateSummary();
                    },
                });
            });
            featRow.append(featBtn, featVal);
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
            li(`Skill ranks to spend on the Skills tab: ${p.skillPts}/level`);
            if (String(p.info.casting || '—') !== '—' && p.info.casting !== 'None') {
                li('Caster: update slots/known on the Spells tab (per-day table is editable)');
            }
        }
        updateSummary();

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
            handle.close();
            window.SheetApp.quietSave?.();
            window.SheetApp.renderSheet(data);
            window.SheetOverlay.toast?.(
                `Level ${totalNext}: ${p.clsName} ${p.newLvl} — spend ${p.skillPts} skill ranks on the Skills tab.`);
        });
    }

    return { open };
})();
