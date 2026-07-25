// scripts/tabs/summary.js -- the Summary tab: HP/defense/saves/offense blocks, class &
// archetype rows, quick actions (window.SheetTabSummary). Extracted from sheet.js (Part B split);
// bodies moved verbatim. This module OWNS the class/archetype helper cluster (classInfoFor,
// classLevelFor, setClassInfo, seedClassSkills, archetypeDescHtml, ...), which the Features tab
// and modals.js consume -- the shell destructures the shared ones back and the modals SheetApp
// class/archetype delegates re-point here. Loads before features.js.
window.SheetTabSummary = (function () {
    'use strict';
    const {
        h, fmt, titleCase, escapeHtml, details, dblclickEditable, parseIntLoose, section,
        attachStatHint, dndHandle, bindDragReorder, reorderArray,
    } = window.SheetUI;
    const { abModOf, computeDerived, srTotal, babIterativesStr } = window.SheetDerive;
    const { quietSave, sheetState, ensureClassList, syncLegacyClasses, ensureArchetypeList } = window.SheetState;
    const { sectionCatalogToolbar, openClassSheet, openArchetypeSheet } = window.SheetModals;
    const {
        getSkillAbility, parseSkillRanks, ranksForSkill, setSkillBonus, skillAbilityKey,
        skillMiscBonus, skillUserBonus,
    } = window.SheetSkillMath;
    const {
        classKeyOf, classLevelFor, classInfoFor, setClassInfo, seedClassSkills, archetypeInfoOf,
        archetypeDescHtml, usedArchetypeArr, recordUsedArchetype, usedArchetypeHits,
        loadArchetypesByClass, classArchetypeHits,
    } = window.SheetClassInfo;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);
    const { rollBtn, rollCheck } = window.SheetStatKit;

    function doRest(data) {
        if (!data) return;
        const st = sheetState(data);
        if (Array.isArray(data.day_list)) {
            st.spellCastsRemaining = data.day_list.map((n) => Number(n) || 0);
        }
        if (st.featureUses && typeof st.featureUses === 'object') {
            for (const u of Object.values(st.featureUses)) {
                if (u && u.max != null) u.value = Number(u.max) || 0;
            }
        }
        const maxSp = st.spellPointsMax != null
            ? Number(st.spellPointsMax)
            : (Number(data.sphere_mana_pool) || null);
        if (maxSp != null && Number.isFinite(maxSp)) {
            st.spellPointsMax = maxSp;
            st.spellPointsCurrent = maxSp;
        }
        quietSave();
        window.SheetRoll?.setOpen?.(true);
        window.SheetRoll?.rollAndLog?.('d1', 'Rest — daily resources restored');
        renderSheet(data);
    }
    function summaryQuickActions(body, data, d) {
        const bar = h('div', 'quick-actions no-print');
        const mk = (label, fn, title) => {
            const b = h('button', 'quick-action-btn', label);
            b.type = 'button';
            if (title) b.title = title;
            b.addEventListener('click', fn);
            bar.appendChild(b);
        };
        mk('Initiative', () => rollCheck('Initiative', d.blocks.init.total));
        mk('Full attack', () => {
            window.SheetRoll?.setOpen?.(true);
            window.SheetRoll?.rollWeaponAttack?.({ full: true, withDamage: true });
        }, 'Full attack with damage');
        mk('Perception', () => {
            const skill = { name: 'Perception', ab: 'wis', id: 'per', acp: false };
            const ab = getSkillAbility(data, skill);
            const rankMap = parseSkillRanks(data);
            const ranks = ranksForSkill(rankMap, 'Perception');
            const abMod = abModOf(data, ab);
            const misc = skillMiscBonus(data, { ...skill, ab });
            const user = skillUserBonus(data, skillAbilityKey(skill), ranks);
            rollCheck('Perception check', ranks + abMod + misc.total + user.total);
        });
        mk('Rest', () => {
            if (!confirm('Rest and restore daily resources (spell casts, feature uses, sphere SP)?')) return;
            doRest(data);
        }, 'Restore daily casts / uses / spell points');
        mk('Tools', () => window.SheetRoll?.setOpen?.(true));
        body.appendChild(bar);
    }
    function tabSummary(data) {
        const d = computeDerived(data);
        const { sec, body } = section('Overview', 'summary-overview');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Play dashboard. Double-click values to edit; 🎲 rolls; click a class for details.'));

        summaryQuickActions(body, data, d);
        seedClassSkills(data);

        const st = sheetState(data);
        if (st.hpCurrent == null || st.hpCurrent === '') st.hpCurrent = d.blocks.hp.total;
        if (st.hpTemp == null || st.hpTemp === '') st.hpTemp = 0;
        if (st.hpNonlethal == null || st.hpNonlethal === '') st.hpNonlethal = 0;
        st.speeds ??= {};
        if (st.speeds.land == null || st.speeds.land === '') {
            st.speeds.land = Number(data.land_speed) || 30;
        }

        const line = (label) => {
            const wrap = h('div', 'summary-line');
            wrap.appendChild(h('h4', 'summary-line-label', label));
            const strip = h('div', 'summary-combat-strip combat-top-strip summary-line-strip');
            wrap.appendChild(strip);
            body.appendChild(wrap);
            return strip;
        };
        const box = (strip, label, content, opts = {}) => {
            const b = h('div', 'summary-stat-box');
            const headEl = h('div', 'summary-stat-head');
            headEl.appendChild(document.createTextNode(label + ' '));
            if (opts.rollTotal != null) {
                headEl.appendChild(rollBtn(opts.rollLabel || label, opts.rollTotal));
            }
            b.appendChild(headEl);
            const val = h('div', 'summary-stat-val');
            if (content instanceof Node) val.appendChild(content);
            else val.textContent = String(content);
            b.appendChild(val);
            attachStatHint(b, label);
            if (opts.title) b.title = opts.title;
            if (opts.cls) b.classList.add(opts.cls);
            strip.appendChild(b);
            return b;
        };
        const editNumNode = (obj, key, opts = {}) => dblclickEditable(obj, key, {
            type: 'number', min: opts.min ?? 0,
            format: (v) => (v == null || v === '' ? '0' : String(v)),
            parse: (s) => parseIntLoose(s, 0),
            onChange: opts.onChange || (() => quietSave()),
        });
        const partsTitle = (block) => (block.parts || [])
            .filter((p) => !p.info && !p.unresolved && Number(p.value))
            .map((p) => `${p.label} ${fmt(Number(p.value))}`).join('\n');

        // --- HP / Speed line
        const hpLine = line('Hit Points / Speed');
        const hpVal = h('span', 'summary-hp-pair');
        hpVal.appendChild(editNumNode(st, 'hpCurrent'));
        hpVal.appendChild(document.createTextNode(' / ' + d.blocks.hp.total));
        const cur = Number(st.hpCurrent) || 0;
        box(hpLine, 'HP', hpVal, {
            title: partsTitle(d.blocks.hp),
            cls: d.blocks.hp.total > 0 && cur <= d.blocks.hp.total / 2 ? 'is-bloodied' : undefined,
        });
        box(hpLine, 'Temp', editNumNode(st, 'hpTemp'));
        box(hpLine, 'Nonlethal', editNumNode(st, 'hpNonlethal'));
        for (const [key, label] of [
            ['land', 'Land'], ['climb', 'Climb'], ['swim', 'Swim'], ['fly', 'Fly'], ['burrow', 'Burrow'],
        ]) {
            if (st.speeds[key] == null || st.speeds[key] === '') st.speeds[key] = key === 'land' ? (Number(data.land_speed) || 30) : 0;
            const node = h('span');
            node.appendChild(editNumNode(st.speeds, key));
            if (key === 'fly') {
                const sel = h('select', 'edit-field fly-maneuver-select');
                for (const m of ['—', 'clumsy', 'poor', 'average', 'good', 'perfect']) {
                    const opt = document.createElement('option');
                    opt.value = m === '—' ? '' : m;
                    opt.textContent = m;
                    if ((st.speeds.flyManeuver || '') === opt.value) opt.selected = true;
                    sel.appendChild(opt);
                }
                sel.title = 'Fly maneuverability';
                sel.addEventListener('change', () => {
                    if (sel.value) st.speeds.flyManeuver = sel.value;
                    else delete st.speeds.flyManeuver;
                    quietSave();
                });
                node.appendChild(sel);
            }
            box(hpLine, label, node);
        }

        // --- Defense line
        const defLine = line('Defense');
        box(defLine, 'AC', String(d.blocks.ac.total), { title: partsTitle(d.blocks.ac) });
        box(defLine, 'Touch', String(d.blocks.touch.total), { title: partsTitle(d.blocks.touch) });
        box(defLine, 'Flat-footed', String(d.blocks.flat.total), { title: partsTitle(d.blocks.flat) });
        box(defLine, 'CMD', String(d.blocks.cmd.total), { title: partsTitle(d.blocks.cmd) });
        box(defLine, 'FF CMD', String(d.blocks.cmdFF.total), { title: partsTitle(d.blocks.cmdFF) });

        // --- Saves line
        const savesLine = line('Saving Throws');
        box(savesLine, 'Fort', fmt(d.blocks.fort.total),
            { rollTotal: d.blocks.fort.total, rollLabel: 'Fortitude save', title: partsTitle(d.blocks.fort) });
        box(savesLine, 'Ref', fmt(d.blocks.ref.total),
            { rollTotal: d.blocks.ref.total, rollLabel: 'Reflex save', title: partsTitle(d.blocks.ref) });
        box(savesLine, 'Will', fmt(d.blocks.will.total),
            { rollTotal: d.blocks.will.total, rollLabel: 'Will save', title: partsTitle(d.blocks.will) });
        if (st.sr == null && data.spell_resistance != null) st.sr = Number(data.spell_resistance) || 0;
        const srNode = dblclickEditable(st, 'sr', {
            type: 'number', min: 0,
            format: () => String(srTotal(data)),
            parse: (s) => parseIntLoose(s, 0),
            onChange: () => quietSave(),
        });
        box(savesLine, 'SR', srNode,
            { title: 'Spell resistance total — double-click edits the base (bonuses on Defenses)' });

        // --- Offense line
        const offLine = line('Offense');
        box(offLine, 'BAB', babIterativesStr(d.bab), { title: 'Iterative attacks (up to 4 shown)' });
        box(offLine, 'CMB', fmt(d.blocks.cmb.total),
            { rollTotal: d.blocks.cmb.total, rollLabel: 'CMB', title: partsTitle(d.blocks.cmb) });
        box(offLine, 'Initiative', fmt(d.blocks.init.total),
            { rollTotal: d.blocks.init.total, rollLabel: 'Initiative', title: partsTitle(d.blocks.init) });

        // --- Attacks
        body.appendChild(h('h3', null, 'Attacks'));
        const attackHost = h('div', null);
        attackHost.id = 'summary-attack-panel';
        body.appendChild(attackHost);
        window.SheetRoll?.renderAttackCard?.(attackHost, {
            showConditionals: false,
            showGeneric: true,
        });

        // --- Classes & Archetypes (selectable from saved data, drag to reorder)
        ensureClassList(data);
        ensureArchetypeList(data);
        loadArchetypesByClass(); // per-class archetype options for the picker
        (data.archetype_list || []).forEach(recordUsedArchetype); // grow the used-set

        const summaryRerender = () => { quietSave(); renderSheet(data); setActiveTab('summary'); };

        const entitySection = (cfg) => {
            body.appendChild(h('h3', null, cfg.title));
            if (cfg.hint) body.appendChild(h('p', 'dbl-edit-hint no-print', cfg.hint));
            body.appendChild(sectionCatalogToolbar(cfg.toolbar));
            const list = data[cfg.listKey] || [];
            if (!list.length) {
                body.appendChild(h('p', 'tools-empty', cfg.emptyText));
                return;
            }
            const ul = h('ul', 'plain-list entity-list dnd-list');
            list.forEach((name) => {
                const li = h('li', 'entity-row dnd-item');
                li.dataset.dndId = String(name);
                li.appendChild(dndHandle());
                const btn = h('button', 'entity-row-btn');
                btn.type = 'button';
                const meta = cfg.metaFor(name);
                btn.appendChild(h('span', 'class-row-name', meta.label));
                if (meta.blurb) btn.appendChild(h('span', 'class-row-blurb dim', meta.blurb));
                btn.addEventListener('click', () => cfg.onOpen(name));
                li.appendChild(btn);
                const rm = h('button', 'inv-btn inv-btn-danger entity-row-rm no-print', '×');
                rm.type = 'button';
                rm.title = 'Remove ' + cfg.noun;
                rm.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeFromArrayField(data, cfg.listKey, name);
                    cfg.afterMutate?.();
                    summaryRerender();
                });
                li.appendChild(rm);
                ul.appendChild(li);
            });
            body.appendChild(ul);
            bindDragReorder(ul, '.entity-row', (from, to) => {
                reorderArray(data[cfg.listKey], from, to);
                cfg.afterMutate?.();
                summaryRerender();
            });
        };

        entitySection({
            title: 'Classes',
            noun: 'class',
            listKey: 'class_list',
            emptyText: 'No classes yet — “Browse classes” to add one.',
            hint: 'Drag ⋮⋮ to reorder. The top two classes drive saves, casting, and class features.',
            afterMutate: () => syncLegacyClasses(data),
            metaFor: (name) => {
                const info = classInfoFor(data, name);
                return {
                    label: titleCase(name) + ' — level ' + classLevelFor(data, name),
                    blurb: info.hd
                        ? `d${info.hd} · BAB ${info.bab} · ${info.casting}`
                        : 'click for class details',
                };
            },
            onOpen: (name) => openClassSheet(data, name),
            toolbar: {
                browseLabel: 'Browse classes',
                picker: {
                    title: 'Add class',
                    kinds: ['classes'],
                    kindLabels: { classes: 'Classes' },
                    allowCustom: true,
                    // List every class alphabetically before the user types.
                    showAllOnEmpty: true,
                    localSource: (q) => window.SheetDetails?.searchCatalog?.('classes', q, { limit: 500 }) || [],
                    customPlaceholder: 'Custom class name',
                    onPick: (hit) => {
                        addToArrayField(data, 'class_list', hit.name);
                        syncLegacyClasses(data);
                        summaryRerender();
                    },
                    onCustom: (name) => {
                        addToArrayField(data, 'class_list', name);
                        syncLegacyClasses(data);
                        summaryRerender();
                    },
                },
            },
        });

        entitySection({
            title: 'Archetypes',
            noun: 'archetype',
            listKey: 'archetype_list',
            emptyText: 'No archetypes yet — “Browse archetypes” for used ones or add a custom name.',
            hint: 'Drag ⋮⋮ to reorder. The picker offers archetypes you have used before.',
            metaFor: (name) => ({
                label: titleCase(name),
                blurb: 'base level 0 — click for description',
            }),
            onOpen: (name) => openArchetypeSheet(data, name),
            toolbar: {
                browseLabel: 'Browse archetypes',
                picker: {
                    title: 'Add archetype',
                    kinds: ['archetypes'],
                    kindLabels: { archetypes: 'Archetypes' },
                    allowCustom: true,
                    customPlaceholder: 'Archetype name',
                    showAllOnEmpty: true,
                    localSource: (q) => [...classArchetypeHits(data, q), ...usedArchetypeHits(q)],
                    onPick: (hit) => {
                        addToArrayField(data, 'archetype_list', hit.name);
                        recordUsedArchetype(hit.name);
                        summaryRerender();
                    },
                    onCustom: (name) => {
                        addToArrayField(data, 'archetype_list', name);
                        recordUsedArchetype(name);
                        summaryRerender();
                    },
                },
            },
        });
        return sec;
    }

    return { tabSummary };
})();
