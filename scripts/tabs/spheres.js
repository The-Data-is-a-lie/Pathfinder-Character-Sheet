// scripts/tabs/spheres.js -- the Spheres tab (window.SheetTabSpheres). Extracted from
// sheet.js (Part B split); body moved verbatim. renderSheet / setActiveTab late-bind via SheetApp.
window.SheetTabSpheres = (function () {
    'use strict';
    const {
        h, htmlBlock, details, section, kv, nonEmpty, escapeHtml, parseIntLoose,
        highlightInlineRolls, dblclickEditable, bindDragReorder, reorderArray, dndHandle,
    } = window.SheetUI;
    const { sheetState, quietSave } = window.SheetState;
    const { sectionCatalogToolbar } = window.SheetModals;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);

    function renderSpheres(data) {
        const talents = [...(data.magic_talent_items || []), ...(data.combat_talent_items || [])];
        const { sec, body } = section('Spheres');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Browse sphere talents from the conditionals database, or add a custom talent name.'));
        body.appendChild(sectionCatalogToolbar({
            browseLabel: 'Browse talents',
            picker: {
                title: 'Add sphere talent',
                kinds: ['talents'],
                allowCustom: true,
                customPlaceholder: 'Custom talent name',
                onPick: (hit) => {
                    const sphere = hit.entry?.sphere || hit.subtitle?.split(' · ')[0] || 'Other';
                    const isCombat = /combat|might|athletics|barrage|alchemy|war/i.test(sphere);
                    const arrKey = isCombat ? 'combat_talent_items' : 'magic_talent_items';
                    if (!Array.isArray(data[arrKey])) data[arrKey] = [];
                    if (!data[arrKey].some((t) => t?.name?.toLowerCase() === hit.name.toLowerCase())) {
                        data[arrKey].push({
                            name: hit.name,
                            sphere,
                            description: '',
                            modifiers: hit.entry?.modifiers || [],
                            rider: hit.entry?.rider || '',
                        });
                        quietSave();
                    }
                    renderSheet(data);
                    setActiveTab('spheres');
                },
                onCustom: (name) => {
                    if (!Array.isArray(data.magic_talent_items)) data.magic_talent_items = [];
                    data.magic_talent_items.push({ name, sphere: 'Other', description: '' });
                    quietSave();
                    renderSheet(data);
                    setActiveTab('spheres');
                },
            },
        }));

        // Every NPC carries a casting tradition now (latent for non-casters), so a martial with no
        // spheres/talents still shows their tradition -- just without the spell-point pool row.
        const ct0 = data.casting_tradition || {};
        const hasTradition = !!(ct0.casting_ability_modifier
            || nonEmpty(data.sphere_drawbacks) || nonEmpty(data.sphere_boons));
        const traditionOnly = !nonEmpty(data.spheres_chosen) && !talents.length;
        if (traditionOnly && !hasTradition) {
            body.appendChild(h('p', 'tools-empty', 'No spheres or talents yet — browse to add.'));
            return sec;
        }
        if (traditionOnly) {
            body.appendChild(h('p', 'dim',
                'Latent casting tradition — how this character’s magic would work if they ever pick any up.'));
        }

        if (!traditionOnly) {
            const st = sheetState(data);
            const poolMax = Number(data.sphere_mana_pool) || 0;
            if (st.spellPointsMax == null && poolMax) st.spellPointsMax = poolMax;
            if (st.spellPointsCurrent == null) st.spellPointsCurrent = st.spellPointsMax ?? poolMax;

            const spRow = h('div', 'kv kv-stat');
            spRow.appendChild(h('span', 'k', 'Spell Points'));
            const spV = h('span', 'v');
            const spBoxes = h('div', 'hp-boxes');
            const curBox = h('div', 'hp-box');
            curBox.appendChild(h('span', 'hp-box-label', 'Current'));
            curBox.appendChild(dblclickEditable(st, 'spellPointsCurrent', {
                type: 'number', min: 0,
                format: (v) => String(v ?? 0),
                parse: (s) => parseIntLoose(s, 0),
                onChange: () => quietSave(),
            }));
            const maxBox = h('div', 'hp-box');
            maxBox.appendChild(h('span', 'hp-box-label', 'Max'));
            maxBox.appendChild(dblclickEditable(st, 'spellPointsMax', {
                type: 'number', min: 0,
                format: (v) => String(v ?? 0),
                parse: (s) => parseIntLoose(s, 0),
                onChange: () => quietSave(),
            }));
            spBoxes.append(curBox, maxBox);
            spV.appendChild(spBoxes);
            spRow.appendChild(spV);
            body.appendChild(spRow);
        }

        const ct = data.casting_tradition || {};
        if (ct.casting_ability_modifier) kv(body, 'Casting Ability', ct.casting_ability_modifier);
        for (const [label, key] of [
            ['MSB', 'sphere_msb'], ['MSD', 'sphere_msd'], ['Sphere CL', 'sphere_cl'],
        ]) {
            if (data[key] != null && data[key] !== '') kv(body, label, data[key]);
        }
        if (nonEmpty(data.spheres_chosen)) {
            kv(body, 'Spheres', data.spheres_chosen
                .map((s) => `${s.sphere} (${s.system})`).join(', '));
        }
        const detailList = (title, names, detailArr) => {
            if (!nonEmpty(names)) return;
            body.appendChild(h('h3', null, title));
            const ul = h('ul', 'plain-list');
            const byName = {};
            (detailArr || []).forEach((d) => { if (d?.name) byName[d.name] = d.description; });
            names.forEach((n) => ul.appendChild(h('li', null, null))
                .appendChild(byName[n] ? details(n, byName[n]) : h('span', null, n)));
            body.appendChild(ul);
        };
        detailList('Tradition Drawbacks', data.sphere_drawbacks, ct.drawbacks_detail);
        detailList('Tradition Boons', data.sphere_boons, ct.boons_detail);
        if (talents.length) {
            body.appendChild(h('h3', null, 'Talents'));
            const bySphere = {};
            for (const t of talents) (bySphere[t.sphere || 'Other'] ??= []).push(t);
            for (const [sphere, ts] of Object.entries(bySphere)) {
                const wrap = h('details', 'sphere-block');
                wrap.open = true;
                wrap.appendChild(h('summary', null, `${sphere} (${ts.length})`));
                const ul = h('ul', 'plain-list dnd-list');
                // Map talent objects to their source array for reorder within sphere group
                // (reorder within the combined visual list of this sphere only)
                const sphereItems = ts;
                ts.forEach((t) => {
                    const label = t.name + (t.advanced ? ' (advanced)' : '');
                    const cond = window.SheetDetails?.conditionalForTalent(t.name);
                    const hasCond = cond && (cond.modifiers?.length || cond.rider);
                    const li = h('li', 'talent-row dnd-item');
                    li.dataset.dndId = t.name;
                    li.appendChild(dndHandle());
                    const useBtn = h('button', 'inv-btn no-print', 'Use');
                    useBtn.type = 'button';
                    useBtn.addEventListener('click', () => {
                        window.SheetRoll?.setOpen?.(true);
                        const rider = cond?.rider ? ' — ' + cond.rider : '';
                        window.SheetRoll?.rollAndLog?.('d1', 'Talent: ' + t.name + rider);
                    });
                    li.appendChild(useBtn);
                    if (!t.description && !hasCond) {
                        li.appendChild(h('span', null, label));
                    } else {
                        const d = details(label, t.description || '');
                        if (hasCond) {
                            const modTxt = (cond.modifiers || []).map((m) =>
                                `${m.formula} ${m.type && m.type !== 'untyped' ? m.type + ' ' : ''}${m.subTarget || m.target || ''}`.trim()).join('; ');
                            const parts = [
                                modTxt ? `<p><strong>Per-roll modifiers:</strong> ${escapeHtml(modTxt)}</p>` : '',
                                cond.rider ? `<p><strong>Rider:</strong> ${highlightInlineRolls(cond.rider)}</p>` : '',
                            ].join('');
                            d.appendChild(htmlBlock('desc cond-rider', parts));
                        }
                        li.appendChild(d);
                    }
                    const rm = h('button', 'inv-btn inv-btn-danger no-print', '×');
                    rm.type = 'button';
                    rm.addEventListener('click', () => {
                        if (!confirm(`Remove talent “${t.name}”?`)) return;
                        for (const key of ['magic_talent_items', 'combat_talent_items']) {
                            const arr = data[key];
                            if (!Array.isArray(arr)) continue;
                            const i = arr.findIndex((x) => x?.name === t.name);
                            if (i >= 0) { arr.splice(i, 1); quietSave(); break; }
                        }
                        renderSheet(data);
                        setActiveTab('spheres');
                    });
                    li.appendChild(rm);
                    ul.appendChild(li);
                });
                wrap.appendChild(ul);
                // Reorder within this sphere: rearrange objects in their source arrays by name order
                bindDragReorder(ul, '.talent-row', (from, to) => {
                    const ordered = [...sphereItems];
                    reorderArray(ordered, from, to);
                    // Apply new order for items that live in magic/combat arrays
                    const names = ordered.map((t) => t.name);
                    for (const key of ['magic_talent_items', 'combat_talent_items']) {
                        const arr = data[key];
                        if (!Array.isArray(arr)) continue;
                        const inSphere = arr.filter((t) => (t.sphere || 'Other') === sphere);
                        const rest = arr.filter((t) => (t.sphere || 'Other') !== sphere);
                        const reordered = names.map((n) => inSphere.find((t) => t.name === n)).filter(Boolean);
                        data[key] = [...rest, ...reordered];
                    }
                    quietSave();
                    renderSheet(data);
                    setActiveTab('spheres');
                });
                body.appendChild(wrap);
            }
        }
        return sec;
    }

    return { renderSpheres };
})();
