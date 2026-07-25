// scripts/tabs/spells.js -- the Spells tab: known/prepared lists, cast action, DC/CL math
// display (window.SheetTabSpells). Extracted from sheet.js (Part B split); bodies moved verbatim
// except currentData reads (via SheetApp.current). renderSheet / setActiveTab late-bind via SheetApp.
window.SheetTabSpells = (function () {
    'use strict';
    const {
        h, section, details, kv, kvDbl, fmt, mod, nonEmpty, escapeHtml, parseIntLoose, titleCase,
        foundry, dblclickEditable, dndHandle, bindDragReorder, reorderArray,
    } = window.SheetUI;
    const { spellSaveDC, castingAbilityMod, casterLevelValue, concentrationBonus } = window.SheetDerive;
    const {
        quietSave, ensureCastingAbility, spendSpellSlot, ensureClassList, ensureSpellCasts,
    } = window.SheetState;
    const { sectionCatalogToolbar } = window.SheetModals;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);

    function castSpell(data, level, name) {
        const preparedMode = isPreparedCaster(data);
        if (preparedMode && level > 0 && !preparedSpellSetAtLevel(data, level).has(name)) {
            alert('That spell is not prepared.');
            return;
        }
        if (!(preparedMode && level === 0)) {
            if (!spendSpellSlot(data, level)) {
                alert('No casts remaining at this level.');
                return;
            }
        }
        const sd = foundry('spells', name);
        window.SheetRoll?.setOpen?.(true);
        if (window.SheetRoll?.rollSpellCast) {
            window.SheetRoll.rollSpellCast({
                name,
                level,
                data,
                spellData: sd,
                descHtml: sd?.description ? enrichSpellHtml(sd.description) : '',
                castingAbility: ensureCastingAbility(data),
                castingMod: castingAbilityMod(data),
                casterLevel: casterLevelValue(data),
                saveDC: spellSaveDC(data, level),
                concentration: concentrationBonus(data),
                bab: Number(data.bab_total) || 0,
            });
        } else {
            const bits = ['Cast: ' + name, 'L' + level];
            if (sd?.school) bits.push(SPELL_SCHOOLS[sd.school] || sd.school);
            bits.push('DC ' + spellSaveDC(data, level));
            window.SheetRoll?.rollAndLog?.('d1', bits.join(' · '));
        }
        if (window.SheetApp.current === data) {
            renderSheet(data);
            setActiveTab('spells');
        }
    }
    // pf1 abbreviates spell schools in item data.
    const SPELL_SCHOOLS = { abj: 'Abjuration', con: 'Conjuration', div: 'Divination',
        enc: 'Enchantment', evo: 'Evocation', ill: 'Illusion', nec: 'Necromancy',
        trs: 'Transmutation', uni: 'Universal' };
// Classes that prepare spells (Foundry module prepared_caster_list). Spontaneous casters
    // still see their list but without prepared checkboxes.
    const PREPARED_CASTERS = new Set([
        'alchemist', 'cleric', 'druid', 'inquisitor', 'investigator', 'magus',
        'paladin', 'ranger', 'warpriest', 'wizard', 'witch',
    ]);
    function isPreparedCaster(data) {
        const strip = (s) => String(s || '').toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();
        for (const cls of ensureClassList(data)) {
            if (PREPARED_CASTERS.has(strip(cls))) return true;
        }
        const prep = data.spells_prepared_per_level;
        return Array.isArray(prep) && prep.some((n) => Number(n) > 0);
    }
    /** Level-bucketed prepared names (same shape as maneuvers_readied_names). */
    function preparedSpellBuckets(data) {
        if (!Array.isArray(data.spells_prepared_names)) data.spells_prepared_names = [];
        return data.spells_prepared_names;
    }
    function preparedSpellSetAtLevel(data, level) {
        const buckets = preparedSpellBuckets(data);
        return new Set((buckets[level] || []).filter(Boolean));
    }
    function writePreparedSpellAtLevel(data, level, name, on) {
        const buckets = preparedSpellBuckets(data);
        while (buckets.length <= level) buckets.push([]);
        const set = new Set((buckets[level] || []).filter(Boolean));
        if (on) set.add(name);
        else set.delete(name);
        buckets[level] = [...set];
        data.spells_prepared_names = buckets;
    }
    /**
     * Seed prepared checkboxes once, mirroring Foundry processSpells:
     * cantrips/orisons all prepared; other levels take first N from spells_prepared_per_level
     * (fallback: day_list / full list for divine loadouts).
     */
    function ensurePreparedSpellsSeeded(data, lists) {
        if (!isPreparedCaster(data) || !nonEmpty(lists)) return;
        if (Array.isArray(data.spells_prepared_names) && data.spells_prepared_names.some((b) => nonEmpty(b))) {
            return; // user or prior seed already set
        }
        const prepPer = Array.isArray(data.spells_prepared_per_level) ? data.spells_prepared_per_level : [];
        const perDay = Array.isArray(data.day_list) ? data.day_list : [];
        const buckets = [];
        lists.forEach((spells, level) => {
            if (!nonEmpty(spells)) {
                buckets[level] = [];
                return;
            }
            if (level === 0) {
                buckets[level] = [...spells];
                return;
            }
            let n = Number(prepPer[level]);
            if (!Number.isFinite(n) || n <= 0) n = Number(perDay[level]) || 0;
            if (!n || n >= spells.length) n = spells.length;
            buckets[level] = spells.slice(0, n);
        });
        data.spells_prepared_names = buckets;
    }
    const ACTION_TYPE_LABELS = {
        spellsave: 'Save', save: 'Save', rsak: 'Ranged touch', msak: 'Melee touch',
        twak: 'Thrown', rwak: 'Ranged', mwak: 'Melee', heal: 'Heal',
        util: 'Utility', other: 'Other',
    };
    /**
     * Clean Foundry description markup for the static sheet. There is no live VTT
     * compendium here, so @UUID[Compendium…]{Label} cross-references are rendered as
     * inline reference text (the label) instead of dead links, and Foundry roll syntax
     * ([[/r 3d6]], [[3d6]]) becomes styled inline-roll chips. The description HTML itself
     * comes from the data the python server ships (spell_details.json), not a compendium.
     */
    function enrichSpellHtml(html) {
        let s = String(html || '');
        // Labeled cross-reference → keep the human label as an inline reference.
        s = s.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, (_m, label) =>
            `<span class="spell-ref" title="Linked entry (from spell data)">${escapeHtml(label)}</span>`);
        // Labelless UUID → no name available in the slim data; show a muted marker.
        s = s.replace(/@UUID\[[^\]]*\]/g,
            '<span class="spell-ref spell-ref-bare" title="Linked entry">↗</span>');
        // Foundry inline rolls, optionally command-prefixed ([[/r 3d6]] → 3d6 chip).
        s = s.replace(/\[\[([^\]]+)\]\]/g, (_m, inner) => {
            const f = String(inner).replace(/^\/[a-z]+\s+/i, '').trim();
            return `<span class="inline-roll" title="Roll: ${escapeHtml(f)}">${escapeHtml(f)}</span>`;
        });
        return s;
    }
    // One expandable entry per spell: compendium description plus a compact meta line
    // (school / action / save+DC / damage / range / duration) from the slim spell extract.
    function spellItem(name, data, level) {
        const sd = foundry('spells', name);
        if (!sd?.description && !sd?.actions?.length) return h('span', 'spell-name', name);
        const act = sd?.actions?.[0] || {};
        const dmgParts = (act.damage?.parts || [])
            .map((p) => {
                const types = (p.type?.values || []).join('/');
                return (p.formula || '') + (types ? ' ' + types : '');
            })
            .filter(Boolean);
        const dc = spellSaveDC(data, level);
        const meta = [
            sd?.school ? 'School: ' + (SPELL_SCHOOLS[sd.school] || titleCase(sd.school)) : null,
            act.actionType
                ? 'Action: ' + (ACTION_TYPE_LABELS[act.actionType] || act.actionType)
                : null,
            act.save?.type
                ? 'Save: ' + (act.save.description || act.save.type) + ' DC ' + dc
                : null,
            dmgParts.length ? 'Damage: ' + dmgParts.join(' + ') : null,
            act.range?.units ? 'Range: ' + `${act.range.value ?? ''} ${act.range.units}`.trim() : null,
            act.duration?.units
                ? 'Duration: ' + `${act.duration.value ?? ''} ${act.duration.units}`.trim()
                : null,
            act.measureTemplate?.type
                ? 'Area: ' + act.measureTemplate.type
                    + (act.measureTemplate.size ? ' ' + act.measureTemplate.size : '')
                : null,
        ].filter(Boolean).join(' · ');
        const metaHtml = meta ? `<p><em>${escapeHtml(meta)}</em></p>` : '';
        const desc = sd?.description
            ? enrichSpellHtml(sd.description)
            : '<p class="dim">No description on file.</p>';
        return details(name, metaHtml + desc, 'spell-details');
    }
    function renderSpells(data) {
        let perDay = data.day_list, known = data.known_list, lists = data.spell_list_choose_from;
        // Allow empty casters to start a list via catalog
        if (!Array.isArray(lists)) lists = data.spell_list_choose_from = [];
        if (!Array.isArray(perDay)) perDay = data.day_list = [];
        const preparedMode = isPreparedCaster(data);
        if (preparedMode) ensurePreparedSpellsSeeded(data, lists);
        const casts = ensureSpellCasts(data);
        ensureCastingAbility(data);
        const castAb = ensureCastingAbility(data);
        const castMod = castingAbilityMod(data);
        const cl = casterLevelValue(data);
        const conc = concentrationBonus(data);

        const { sec, body } = section('Spellcasting');
        if (data.casting_level_str_foundry) kv(body, 'Caster progression', data.casting_level_str_foundry);

        // Foundry-style spellbook header: ability, CL, concentration, DC formula
        const abRow = h('div', 'kv kv-stat');
        abRow.appendChild(h('span', 'k', 'Casting ability'));
        const abV = h('span', 'v');
        const abSel = h('select', 'edit-field spell-cast-ability');
        for (const a of ['int', 'wis', 'cha', 'str', 'dex', 'con']) {
            const opt = document.createElement('option');
            opt.value = a;
            opt.textContent = a.toUpperCase();
            if (a === castAb) opt.selected = true;
            abSel.appendChild(opt);
        }
        abSel.addEventListener('change', () => {
            data.casting_stat = abSel.value;
            quietSave();
            renderSheet(data);
            setActiveTab('spells');
        });
        abV.appendChild(abSel);
        abV.appendChild(h('span', 'dim',
            `  mod ${fmt(castMod)} · DC = 10 + level ${fmt(castMod)}`));
        abRow.appendChild(abV);
        body.appendChild(abRow);

        kvDbl(body, 'Caster level', data, 'caster_level', {
            type: 'number', min: 0, max: 40,
            format: (v) => (v == null || v === '' ? String(cl) : String(v)),
            parse: (s) => parseIntLoose(s, cl),
            onChange: () => {
                quietSave();
                renderSheet(data);
                setActiveTab('spells');
            },
        });
        kv(body, 'Concentration', fmt(conc) + ` (CL ${cl} + ${castAb.toUpperCase()} ${fmt(castMod)})`);
        kv(body, 'Casting style', preparedMode
            ? 'Prepared (Prep checkbox · Cast spends a slot)'
            : 'Spontaneous (Cast spends remaining/day)');
        body.appendChild(h('p', 'dim',
            `Basic save DC = 10 + spell level + ${castAb.toUpperCase()} (${fmt(castMod)}) — listed on each level box.`));

        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Browse spells to add to a level. Cast rolls attack/damage/DC and spends a slot. Minimize a level with −.'));

        // Add spell from catalog to a chosen level
        const levelSel = h('select', 'edit-field');
        levelSel.title = 'Spell level for new spells';
        for (let lv = 0; lv <= 9; lv++) {
            const opt = document.createElement('option');
            opt.value = String(lv);
            opt.textContent = lv === 0 ? 'Level 0 (cantrips)' : 'Level ' + lv;
            levelSel.appendChild(opt);
        }
        body.appendChild(sectionCatalogToolbar({
            browseLabel: 'Browse spells',
            extra: levelSel,
            picker: {
                title: 'Add spell to list',
                kinds: ['spells'],
                allowCustom: true,
                customPlaceholder: 'Custom spell name',
                onPick: (hit) => {
                    const lv = parseInt(levelSel.value, 10) || 0;
                    if (!Array.isArray(data.spell_list_choose_from)) data.spell_list_choose_from = [];
                    while (data.spell_list_choose_from.length <= lv) data.spell_list_choose_from.push([]);
                    const bucket = data.spell_list_choose_from[lv];
                    if (!bucket.some((n) => String(n).toLowerCase() === hit.name.toLowerCase())) {
                        bucket.push(hit.name);
                        quietSave();
                    }
                    renderSheet(data);
                    setActiveTab('spells');
                },
                onCustom: (name) => {
                    const lv = parseInt(levelSel.value, 10) || 0;
                    if (!Array.isArray(data.spell_list_choose_from)) data.spell_list_choose_from = [];
                    while (data.spell_list_choose_from.length <= lv) data.spell_list_choose_from.push([]);
                    data.spell_list_choose_from[lv].push(name);
                    quietSave();
                    renderSheet(data);
                    setActiveTab('spells');
                },
            },
        }));

        if (nonEmpty(perDay)) {
            const table = h('table', 'spell-table');
            const hd = h('tr');
            const cols = preparedMode
                ? ['Spell Level', 'Per Day', 'Left', 'Prepared', 'In list']
                : ['Spell Level', 'Per Day', 'Left', 'Known'];
            cols.forEach((t) => hd.appendChild(h('th', null, t)));
            table.appendChild(hd);
            perDay.forEach((d, i) => {
                const tr = h('tr');
                tr.appendChild(h('td', null, i === 0 ? '0 (cantrips)' : String(i)));
                tr.appendChild(h('td', 'num', d));
                const leftTd = h('td', 'num');
                const bag = { left: casts[i] ?? 0 };
                leftTd.appendChild(dblclickEditable(bag, 'left', {
                    type: 'number', min: 0,
                    format: (v) => String(v ?? 0),
                    parse: (s) => parseIntLoose(s, 0),
                    onChange: (v) => {
                        casts[i] = Number(v) || 0;
                        quietSave();
                    },
                }));
                tr.appendChild(leftTd);
                if (preparedMode) {
                    const prepCell = h('td', 'num spell-prep-count');
                    prepCell.dataset.spellLevel = String(i);
                    prepCell.textContent = String(preparedSpellSetAtLevel(data, i).size);
                    tr.appendChild(prepCell);
                    tr.appendChild(h('td', 'num', lists?.[i]?.length ?? '—'));
                } else {
                    tr.appendChild(h('td', 'num', known?.[i] ?? '—'));
                }
                table.appendChild(tr);
            });
            body.appendChild(table);
        }

        if (nonEmpty(lists)) {
            if (preparedMode) {
                const filt = h('label', 'spell-filter-prep no-print');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.addEventListener('change', () => {
                    body.querySelectorAll('.spell-prep-row').forEach((row) => {
                        const prepared = row.querySelector('.spell-prep-check')?.checked;
                        row.style.display = cb.checked && !prepared ? 'none' : '';
                    });
                });
                filt.append(cb, document.createTextNode(' Show prepared only'));
                body.appendChild(filt);
            }
            const collapsedMap = loadSpellLevelCollapsed();
            lists.forEach((spells, level) => {
                if (!nonEmpty(spells)) return;
                const levelWrap = h('div', 'spell-level-block');
                levelWrap.dataset.spellLevel = String(level);
                const left = casts[level] ?? 0;
                const dc = spellSaveDC(data, level);
                const levelLabel = level === 0
                    ? 'Level 0 (cantrips/orisons)'
                    : 'Level ' + level;

                // Minimizable head: title + save DC + slot summary
                const head = h('div', 'spell-level-head');
                const headMain = h('div', 'spell-level-head-main');
                headMain.appendChild(h('h3', 'spell-level-title', levelLabel));
                const dcEl = h('span', 'spell-level-dc', 'Save DC ' + dc);
                dcEl.title = `10 + spell level ${level} + ${castAb.toUpperCase()} ${fmt(castMod)}`
                    + ` = 10 + ${level} + ${castMod}`;
                headMain.appendChild(dcEl);
                const metaBits = [
                    `${left} left / ${perDay?.[level] ?? '—'} day`,
                ];
                if (preparedMode) {
                    metaBits.push(`${preparedSpellSetAtLevel(data, level).size} prepared`);
                }
                metaBits.push(`${spells.length} in list`);
                headMain.appendChild(h('span', 'spell-level-meta dim', metaBits.join(' · ')));
                head.appendChild(headMain);

                const minBtn = h('button', 'spell-level-min no-print', '−');
                minBtn.type = 'button';
                minBtn.setAttribute('aria-expanded', 'true');
                minBtn.title = 'Minimize ' + levelLabel;
                minBtn.setAttribute('aria-label', minBtn.title);
                head.appendChild(minBtn);
                levelWrap.appendChild(head);

                const bodyBox = h('div', 'spell-level-body');
                const list = h('div', 'spell-prep-list dnd-list');
                const prepSet = preparedMode ? preparedSpellSetAtLevel(data, level) : null;
                spells.forEach((name) => {
                    const row = h('div', 'spell-prep-row dnd-item');
                    row.dataset.dndId = String(name);
                    row.appendChild(dndHandle());
                    if (preparedMode) {
                        const lab = h('label', 'pow-ready-label spell-prep-label');
                        const pcb = document.createElement('input');
                        pcb.type = 'checkbox';
                        pcb.className = 'pow-ready-check spell-prep-check';
                        pcb.checked = prepSet.has(name);
                        pcb.addEventListener('change', () => {
                            writePreparedSpellAtLevel(data, level, name, pcb.checked);
                            quietSave();
                        });
                        lab.append(pcb, h('span', 'pow-ready-tag', 'Prep'));
                        row.appendChild(lab);
                    }
                    const castBtn = h('button', 'inv-btn spell-cast-btn no-print', 'Cast');
                    castBtn.type = 'button';
                    castBtn.title = 'Cast and spend a slot (if required)';
                    castBtn.addEventListener('click', () => castSpell(data, level, name));
                    row.appendChild(castBtn);
                    row.appendChild(spellItem(name, data, level));
                    const rm = h('button', 'inv-btn inv-btn-danger no-print', '×');
                    rm.type = 'button';
                    rm.title = 'Remove from spell list';
                    rm.addEventListener('click', () => {
                        if (!confirm(`Remove “${name}” from level ${level}?`)) return;
                        const bucket = data.spell_list_choose_from[level];
                        if (!Array.isArray(bucket)) return;
                        const i = bucket.findIndex((n) => String(n) === String(name));
                        if (i >= 0) {
                            bucket.splice(i, 1);
                            writePreparedSpellAtLevel(data, level, name, false);
                            quietSave();
                            renderSheet(data);
                            setActiveTab('spells');
                        }
                    });
                    row.appendChild(rm);
                    list.appendChild(row);
                });
                bodyBox.appendChild(list);
                levelWrap.appendChild(bodyBox);

                bindDragReorder(list, '.spell-prep-row', (from, to) => {
                    const bucket = data.spell_list_choose_from[level];
                    if (!Array.isArray(bucket)) return;
                    reorderArray(bucket, from, to);
                    quietSave();
                    renderSheet(data);
                    setActiveTab('spells');
                });

                const setCollapsed = (collapsed) => {
                    levelWrap.classList.toggle('is-collapsed', collapsed);
                    minBtn.textContent = collapsed ? '+' : '−';
                    minBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                    minBtn.title = (collapsed ? 'Expand ' : 'Minimize ') + levelLabel;
                    minBtn.setAttribute('aria-label', minBtn.title);
                };
                minBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const next = !levelWrap.classList.contains('is-collapsed');
                    setCollapsed(next);
                    const map = loadSpellLevelCollapsed();
                    if (next) map[String(level)] = true;
                    else delete map[String(level)];
                    saveSpellLevelCollapsed(map);
                });
                // Click header (not just button) to toggle
                head.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    minBtn.click();
                });
                setCollapsed(!!collapsedMap[String(level)]);

                body.appendChild(levelWrap);
            });
        }
        return sec;
    }
    const SPELL_LEVEL_COLLAPSED_KEY = 'sheet.spellLevelCollapsed';
    function loadSpellLevelCollapsed() {
        try {
            const raw = localStorage.getItem(SPELL_LEVEL_COLLAPSED_KEY);
            if (!raw) return {};
            const obj = JSON.parse(raw);
            return obj && typeof obj === 'object' ? obj : {};
        } catch {
            return {};
        }
    }
    function saveSpellLevelCollapsed(map) {
        try {
            localStorage.setItem(SPELL_LEVEL_COLLAPSED_KEY, JSON.stringify(map));
        } catch { /* private mode */ }
    }

    return { renderSpells };
})();
