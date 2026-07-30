// scripts/tabs/spells.js -- the Spells tab: per-class spellbooks, known/prepared lists, cast
// action with metamagic, DC/CL math, concentration + CL-check rolls (window.SheetTabSpells).
//
// Spellbook model: the PRIMARY book is the legacy payload fields (day_list,
// spell_list_choose_from, spells_prepared_names, casting_stat, _sheet.spellCastsRemaining) —
// stored exactly as before, so old characters round-trip untouched. Additional books (real
// multiclass casters) live in _sheet.extraSpellbooks[] with the same shape per book:
//   { id, name, castAb, cl, preparedMode, dayList[], lists[][], prepared[][], casts[] }
// Every read/write goes through a "book view" so the render code is book-agnostic.
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

    // ---------------------------------------------------------------- spellbook views
    const AB_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    function extraBooks(data) {
        const st = (data._sheet ??= {});
        if (!Array.isArray(st.extraSpellbooks)) st.extraSpellbooks = [];
        for (const b of st.extraSpellbooks) {
            b.id ||= 'book-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            b.name ||= 'Spellbook';
            if (!AB_KEYS.includes(b.castAb)) b.castAb = 'int';
            if (!Array.isArray(b.dayList)) b.dayList = Array(10).fill(0);
            if (!Array.isArray(b.lists)) b.lists = [];
            if (!Array.isArray(b.prepared)) b.prepared = [];
            if (!Array.isArray(b.casts)) b.casts = b.dayList.map((n) => Number(n) || 0);
            b.preparedMode = !!b.preparedMode;
        }
        return st.extraSpellbooks;
    }
    function bookViews(data) {
        if (!Array.isArray(data.spell_list_choose_from)) data.spell_list_choose_from = [];
        if (!Array.isArray(data.day_list)) data.day_list = [];
        const views = [{
            id: 'main', legacy: true, raw: null,
            name: data.c_class ? titleCase(String(data.c_class)) : 'Spellbook',
            perDay: data.day_list,
            known: data.known_list,
            lists: data.spell_list_choose_from,
            casts: ensureSpellCasts(data),
            preparedMode: isPreparedCaster(data),
            castAb: ensureCastingAbility(data),
            castMod: castingAbilityMod(data),
            cl: casterLevelValue(data),
            conc: concentrationBonus(data),
        }];
        for (const b of extraBooks(data)) {
            const castMod = window.SheetDerive.abModOf(data, b.castAb);
            const cl = Number(b.cl) || window.SheetDerive.totalLevel(data) || 1;
            views.push({
                id: b.id, legacy: false, raw: b,
                name: b.name, perDay: b.dayList, known: null,
                lists: b.lists, casts: b.casts,
                preparedMode: !!b.preparedMode,
                castAb: b.castAb, castMod, cl, conc: cl + castMod,
            });
        }
        return views;
    }
    const bookDC = (bk, level) => 10 + level + bk.castMod;
    function preparedBuckets(data, bk) {
        if (bk.legacy) {
            if (!Array.isArray(data.spells_prepared_names)) data.spells_prepared_names = [];
            return data.spells_prepared_names;
        }
        return bk.raw.prepared;
    }
    function preparedSetAt(data, bk, level) {
        return new Set((preparedBuckets(data, bk)[level] || []).filter(Boolean));
    }
    function writePreparedAt(data, bk, level, name, on) {
        const buckets = preparedBuckets(data, bk);
        while (buckets.length <= level) buckets.push([]);
        const set = new Set((buckets[level] || []).filter(Boolean));
        if (on) set.add(name);
        else set.delete(name);
        buckets[level] = [...set];
    }
    function spendBookSlot(data, bk, level) {
        if (bk.legacy) return spendSpellSlot(data, level);
        const casts = bk.casts;
        while (casts.length <= level) casts.push(0);
        if ((casts[level] || 0) <= 0) return false;
        casts[level] -= 1;
        quietSave();
        return true;
    }
    /**
     * Seed prepared checkboxes once (main book only), mirroring Foundry processSpells:
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

    // ---------------------------------------------------------------- casting + metamagic
    /** name → slot-level cost. Heighten is special: its cost is the chosen raise. */
    const METAMAGIC_FEATS = {
        'Bouncing Spell': 1, 'Disruptive Spell': 1, 'Ectoplasmic Spell': 1, 'Elemental Spell': 1,
        'Empower Spell': 2, 'Enlarge Spell': 1, 'Extend Spell': 1, 'Focused Spell': 1,
        'Heighten Spell': 0, 'Intensified Spell': 1, 'Maximize Spell': 3, 'Merciful Spell': 0,
        'Persistent Spell': 2, 'Piercing Spell': 1, 'Quicken Spell': 4, 'Reach Spell': 1,
        'Rime Spell': 1, 'Selective Spell': 1, 'Sickening Spell': 2, 'Silent Spell': 1,
        'Still Spell': 1, 'Thundering Spell': 2, 'Toppling Spell': 1, 'Widen Spell': 3,
    };
    function knownMetamagic(data) {
        return Object.keys(METAMAGIC_FEATS)
            .filter((n) => window.SheetRoll?.hasFeat?.(data, n));
    }
    function castSpell(data, bk, level, name, mm = null) {
        const slotLevel = mm ? mm.slotLevel : level;
        if (bk.preparedMode && level > 0 && !preparedSetAt(data, bk, level).has(name)) {
            alert('That spell is not prepared.');
            return;
        }
        if (!(bk.preparedMode && slotLevel === 0)) {
            if (!spendBookSlot(data, bk, slotLevel)) {
                alert(`No casts remaining at level ${slotLevel}.`);
                return;
            }
        }
        const sd = foundry('spells', name);
        const dcLevel = mm ? mm.dcLevel : level;
        window.SheetRoll?.setOpen?.(true);
        if (window.SheetRoll?.rollSpellCast) {
            window.SheetRoll.rollSpellCast({
                name,
                level,
                data,
                spellData: sd,
                descHtml: sd?.description ? enrichSpellHtml(sd.description) : '',
                castingAbility: bk.castAb,
                castingMod: bk.castMod,
                casterLevel: bk.cl,
                saveDC: bookDC(bk, dcLevel),
                concentration: bk.conc,
                bab: Number(data.bab_total) || 0,
                metamagic: mm && mm.names.length ? mm : null,
            });
        } else {
            const bits = ['Cast: ' + name, 'L' + level];
            if (sd?.school) bits.push(SPELL_SCHOOLS[sd.school] || sd.school);
            bits.push('DC ' + bookDC(bk, dcLevel));
            window.SheetRoll?.rollAndLog?.('d1', bits.join(' · '));
        }
        if (window.SheetApp.current === data) {
            renderSheet(data);
            setActiveTab('spells');
        }
    }
    /** Cast entry point: direct cast, or a metamagic picker when the character has any. */
    function promptCast(data, bk, level, name) {
        const mmNames = knownMetamagic(data);
        if (!mmNames.length || !window.SheetOverlay?.open) {
            castSpell(data, bk, level, name, null);
            return;
        }
        const body = h('div', 'mm-picker');
        body.appendChild(h('p', 'dim',
            'Metamagic raises the slot the spell is cast from. DC changes only via Heighten.'));
        const boxes = new Map();
        for (const feat of mmNames) {
            const row = h('label', 'mm-row');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            boxes.set(feat, cb);
            row.append(cb, h('span', 'mm-name', feat),
                h('span', 'mm-cost dim',
                    feat === 'Heighten Spell' ? '+chosen' : `+${METAMAGIC_FEATS[feat]} slot`));
            cb.addEventListener('change', updateSummary);
            body.appendChild(row);
        }
        let heightenInp = null;
        if (boxes.has('Heighten Spell')) {
            const hRow = h('label', 'mm-row mm-heighten');
            heightenInp = document.createElement('input');
            heightenInp.type = 'number';
            heightenInp.min = '0';
            heightenInp.max = String(9 - level);
            heightenInp.value = '0';
            heightenInp.addEventListener('input', updateSummary);
            hRow.append(h('span', 'mm-name', 'Heighten by'), heightenInp);
            body.appendChild(hRow);
        }
        const summary = h('p', 'mm-summary');
        body.appendChild(summary);
        const chosen = () => [...boxes.entries()].filter(([, cb]) => cb.checked).map(([n]) => n);
        const buildMM = () => {
            const names = chosen();
            const heighten = names.includes('Heighten Spell')
                ? Math.max(0, parseIntLoose(heightenInp?.value, 0)) : 0;
            const cost = names.reduce((n, f) => n + (METAMAGIC_FEATS[f] || 0), 0) + heighten;
            return {
                names,
                empower: names.includes('Empower Spell'),
                maximize: names.includes('Maximize Spell'),
                heighten,
                slotLevel: level + cost,
                dcLevel: level + heighten,
            };
        };
        function updateSummary() {
            const mm = buildMM();
            const left = bk.casts[mm.slotLevel] ?? 0;
            summary.textContent = mm.names.length
                ? `Cast from a level ${mm.slotLevel} slot (${left} left) · DC ${bookDC(bk, mm.dcLevel)}`
                : `Cast plain from a level ${level} slot (${bk.casts[level] ?? 0} left) · DC ${bookDC(bk, level)}`;
            summary.classList.toggle('mm-overflow', mm.slotLevel > 9);
        }
        updateSummary();
        const castBtn = h('button', 'inv-btn inv-btn-primary', 'Cast');
        castBtn.type = 'button';
        const handle = window.SheetOverlay.open({
            title: `Cast ${name} (L${level})`,
            body,
            footer: [castBtn],
        });
        castBtn.addEventListener('click', () => {
            const mm = buildMM();
            if (mm.slotLevel > 9) {
                alert('That combination needs a slot above 9th level.');
                return;
            }
            handle.close();
            castSpell(data, bk, level, name, mm);
        });
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
    function spellItem(name, dc) {
        const sd = foundry('spells', name);
        if (!sd?.description && !sd?.actions?.length) return h('span', 'spell-name', name);
        const act = sd?.actions?.[0] || {};
        const dmgParts = (act.damage?.parts || [])
            .map((p) => {
                const types = (p.type?.values || []).join('/');
                return (p.formula || '') + (types ? ' ' + types : '');
            })
            .filter(Boolean);
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

    // ---------------------------------------------------------------- render (per book)
    /** Small 🎲 that posts a d20 check to the roll log (same style as saves/skills). */
    function d20Btn(label, bonus) {
        const b = window.SheetStatKit?.rollBtn?.(label, bonus);
        if (b) return b;
        const btn = h('button', 'inv-btn no-print', '🎲');
        btn.type = 'button';
        btn.addEventListener('click', () => {
            window.SheetRoll?.setOpen?.(true);
            window.SheetRoll?.rollAndLog?.('1d20' + (bonus >= 0 ? '+' + bonus : String(bonus)), label);
        });
        return btn;
    }
    function renderSpellbook(body, data, bk, multi) {
        const wrap = h('div', 'spellbook-block');
        wrap.dataset.bookId = bk.id;
        if (multi || !bk.legacy) {
            const head = h('div', 'spellbook-head');
            if (bk.legacy) {
                head.appendChild(h('h3', 'spellbook-title', bk.name));
            } else {
                const nameInp = h('input', 'edit-field spellbook-name');
                nameInp.value = bk.name;
                nameInp.title = 'Spellbook name (usually the casting class)';
                nameInp.addEventListener('change', () => {
                    bk.raw.name = nameInp.value.trim() || 'Spellbook';
                    quietSave();
                });
                head.appendChild(nameInp);
                const del = h('button', 'inv-btn inv-btn-danger no-print', '× Remove book');
                del.type = 'button';
                del.addEventListener('click', () => {
                    if (!confirm(`Remove spellbook “${bk.name}” and its lists?`)) return;
                    const arr = extraBooks(data);
                    const i = arr.indexOf(bk.raw);
                    if (i >= 0) arr.splice(i, 1);
                    quietSave();
                    renderSheet(data);
                    setActiveTab('spells');
                });
                head.appendChild(del);
            }
            wrap.appendChild(head);
        }
        if (bk.legacy && data.casting_level_str_foundry) {
            kv(wrap, 'Caster progression', data.casting_level_str_foundry);
        }

        // Casting ability
        const abRow = h('div', 'kv kv-stat');
        abRow.appendChild(h('span', 'k', 'Casting ability'));
        const abV = h('span', 'v');
        const abSel = h('select', 'edit-field spell-cast-ability');
        for (const a of ['int', 'wis', 'cha', 'str', 'dex', 'con']) {
            const opt = document.createElement('option');
            opt.value = a;
            opt.textContent = a.toUpperCase();
            if (a === bk.castAb) opt.selected = true;
            abSel.appendChild(opt);
        }
        abSel.addEventListener('change', () => {
            if (bk.legacy) data.casting_stat = abSel.value;
            else bk.raw.castAb = abSel.value;
            quietSave();
            renderSheet(data);
            setActiveTab('spells');
        });
        abV.appendChild(abSel);
        abV.appendChild(h('span', 'dim',
            `  mod ${fmt(bk.castMod)} · DC = 10 + level ${fmt(bk.castMod)}`));
        abRow.appendChild(abV);
        wrap.appendChild(abRow);

        // Caster level (override) — legacy writes data.caster_level, extra books their own.
        if (bk.legacy) {
            kvDbl(wrap, 'Caster level', data, 'caster_level', {
                type: 'number', min: 0, max: 40,
                format: (v) => (v == null || v === '' ? String(bk.cl) : String(v)),
                parse: (s) => parseIntLoose(s, bk.cl),
                onChange: () => {
                    quietSave();
                    renderSheet(data);
                    setActiveTab('spells');
                },
            });
        } else {
            kvDbl(wrap, 'Caster level', bk.raw, 'cl', {
                type: 'number', min: 0, max: 40,
                format: (v) => (v == null || v === '' || Number(v) === 0 ? String(bk.cl) : String(v)),
                parse: (s) => parseIntLoose(s, 0),
                onChange: () => {
                    quietSave();
                    renderSheet(data);
                    setActiveTab('spells');
                },
            });
        }

        // Concentration + caster-level check, both rollable.
        const concRow = h('div', 'kv kv-stat');
        concRow.appendChild(h('span', 'k', 'Concentration'));
        const concV = h('span', 'v');
        concV.appendChild(document.createTextNode(
            `${fmt(bk.conc)} (CL ${bk.cl} + ${bk.castAb.toUpperCase()} ${fmt(bk.castMod)}) `));
        concV.appendChild(d20Btn(`Concentration (${bk.name})`, bk.conc));
        concRow.appendChild(concV);
        wrap.appendChild(concRow);

        const clRow = h('div', 'kv kv-stat');
        clRow.appendChild(h('span', 'k', 'CL check vs SR'));
        const clV = h('span', 'v');
        clV.appendChild(document.createTextNode(`1d20 ${fmt(bk.cl)} `));
        clV.appendChild(d20Btn(`Caster level check vs SR (${bk.name})`, bk.cl));
        clRow.appendChild(clV);
        wrap.appendChild(clRow);

        // Casting style
        if (bk.legacy) {
            kv(wrap, 'Casting style', bk.preparedMode
                ? 'Prepared (Prep checkbox · Cast spends a slot)'
                : 'Spontaneous (Cast spends remaining/day)');
        } else {
            const styleRow = h('div', 'kv kv-stat');
            styleRow.appendChild(h('span', 'k', 'Casting style'));
            const styleV = h('span', 'v');
            const styleSel = h('select', 'edit-field');
            for (const [val, lab] of [['', 'Spontaneous'], ['1', 'Prepared']]) {
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = lab;
                if (!!val === bk.preparedMode) opt.selected = true;
                styleSel.appendChild(opt);
            }
            styleSel.addEventListener('change', () => {
                bk.raw.preparedMode = !!styleSel.value;
                quietSave();
                renderSheet(data);
                setActiveTab('spells');
            });
            styleV.appendChild(styleSel);
            styleRow.appendChild(styleV);
            wrap.appendChild(styleRow);
        }
        const mmKnown = knownMetamagic(data);
        if (mmKnown.length) {
            kv(wrap, 'Metamagic', mmKnown.join(', ') + ' — picker opens on Cast');
        }
        wrap.appendChild(h('p', 'dim',
            `Basic save DC = 10 + spell level + ${bk.castAb.toUpperCase()} (${fmt(bk.castMod)}) — listed on each level box.`));

        // Add spell from catalog to a chosen level
        const levelSel = h('select', 'edit-field');
        levelSel.title = 'Spell level for new spells';
        for (let lv = 0; lv <= 9; lv++) {
            const opt = document.createElement('option');
            opt.value = String(lv);
            opt.textContent = lv === 0 ? 'Level 0 (cantrips)' : 'Level ' + lv;
            levelSel.appendChild(opt);
        }
        const addSpellAt = (lv, name) => {
            while (bk.lists.length <= lv) bk.lists.push([]);
            const bucket = bk.lists[lv];
            if (!bucket.some((n) => String(n).toLowerCase() === String(name).toLowerCase())) {
                bucket.push(name);
                quietSave();
            }
            renderSheet(data);
            setActiveTab('spells');
        };
        wrap.appendChild(sectionCatalogToolbar({
            browseLabel: 'Browse spells',
            extra: levelSel,
            picker: {
                title: 'Add spell to ' + bk.name,
                kinds: ['spells'],
                allowCustom: true,
                customPlaceholder: 'Custom spell name',
                onPick: (hit) => addSpellAt(parseInt(levelSel.value, 10) || 0, hit.name),
                onCustom: (name) => addSpellAt(parseInt(levelSel.value, 10) || 0, name),
            },
        }));

        // Slots table. Per Day is dblclick-editable (extra books start all zeroes).
        const levelCount = bk.legacy
            ? bk.perDay.length
            : Math.max(bk.perDay.length, bk.lists.length);
        if (levelCount > 0 && (nonEmpty(bk.perDay) || !bk.legacy)) {
            const table = h('table', 'spell-table');
            const hd = h('tr');
            const cols = bk.preparedMode
                ? ['Spell Level', 'Per Day', 'Left', 'Prepared', 'In list']
                : ['Spell Level', 'Per Day', 'Left', bk.legacy ? 'Known' : 'In list'];
            cols.forEach((t) => hd.appendChild(h('th', null, t)));
            table.appendChild(hd);
            for (let i = 0; i < levelCount; i++) {
                const tr = h('tr');
                tr.appendChild(h('td', null, i === 0 ? '0 (cantrips)' : String(i)));
                const pdTd = h('td', 'num');
                pdTd.appendChild(dblclickEditable(bk.perDay, i, {
                    type: 'number', min: 0, max: 99,
                    format: (v) => String(v ?? 0),
                    parse: (s) => parseIntLoose(s, 0),
                    onChange: () => quietSave(),
                }));
                tr.appendChild(pdTd);
                const leftTd = h('td', 'num');
                const bag = { left: bk.casts[i] ?? 0 };
                leftTd.appendChild(dblclickEditable(bag, 'left', {
                    type: 'number', min: 0,
                    format: (v) => String(v ?? 0),
                    parse: (s) => parseIntLoose(s, 0),
                    onChange: (v) => {
                        bk.casts[i] = Number(v) || 0;
                        quietSave();
                    },
                }));
                tr.appendChild(leftTd);
                if (bk.preparedMode) {
                    const prepCell = h('td', 'num spell-prep-count');
                    prepCell.dataset.spellLevel = String(i);
                    prepCell.textContent = String(preparedSetAt(data, bk, i).size);
                    tr.appendChild(prepCell);
                    tr.appendChild(h('td', 'num', bk.lists?.[i]?.length ?? '—'));
                } else {
                    tr.appendChild(h('td', 'num',
                        bk.legacy ? (bk.known?.[i] ?? '—') : (bk.lists?.[i]?.length ?? '—')));
                }
                table.appendChild(tr);
            }
            wrap.appendChild(table);
        }

        // Level blocks with the spell lists
        if (nonEmpty(bk.lists)) {
            if (bk.preparedMode) {
                const filt = h('label', 'spell-filter-prep no-print');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.addEventListener('change', () => {
                    wrap.querySelectorAll('.spell-prep-row').forEach((row) => {
                        const prepared = row.querySelector('.spell-prep-check')?.checked;
                        row.style.display = cb.checked && !prepared ? 'none' : '';
                    });
                });
                filt.append(cb, document.createTextNode(' Show prepared only'));
                wrap.appendChild(filt);
            }
            const collapsedMap = loadSpellLevelCollapsed();
            bk.lists.forEach((spells, level) => {
                if (!nonEmpty(spells)) return;
                const levelWrap = h('div', 'spell-level-block');
                levelWrap.dataset.spellLevel = String(level);
                const left = bk.casts[level] ?? 0;
                const dc = bookDC(bk, level);
                const levelLabel = level === 0
                    ? 'Level 0 (cantrips/orisons)'
                    : 'Level ' + level;

                // Minimizable head: title + save DC + slot summary
                const head = h('div', 'spell-level-head');
                const headMain = h('div', 'spell-level-head-main');
                headMain.appendChild(h('h3', 'spell-level-title', levelLabel));
                const dcEl = h('span', 'spell-level-dc', 'Save DC ' + dc);
                dcEl.title = `10 + spell level ${level} + ${bk.castAb.toUpperCase()} ${fmt(bk.castMod)}`
                    + ` = 10 + ${level} + ${bk.castMod}`;
                headMain.appendChild(dcEl);
                const metaBits = [
                    `${left} left / ${bk.perDay?.[level] ?? '—'} day`,
                ];
                if (bk.preparedMode) {
                    metaBits.push(`${preparedSetAt(data, bk, level).size} prepared`);
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
                const prepSet = bk.preparedMode ? preparedSetAt(data, bk, level) : null;
                spells.forEach((name) => {
                    const row = h('div', 'spell-prep-row dnd-item');
                    row.dataset.dndId = String(name);
                    row.appendChild(dndHandle());
                    if (bk.preparedMode) {
                        const lab = h('label', 'pow-ready-label spell-prep-label');
                        const pcb = document.createElement('input');
                        pcb.type = 'checkbox';
                        pcb.className = 'pow-ready-check spell-prep-check';
                        pcb.checked = prepSet.has(name);
                        pcb.addEventListener('change', () => {
                            writePreparedAt(data, bk, level, name, pcb.checked);
                            quietSave();
                        });
                        lab.append(pcb, h('span', 'pow-ready-tag', 'Prep'));
                        row.appendChild(lab);
                    }
                    const castBtn = h('button', 'inv-btn spell-cast-btn no-print', 'Cast');
                    castBtn.type = 'button';
                    castBtn.title = 'Cast and spend a slot (if required)';
                    castBtn.addEventListener('click', () => promptCast(data, bk, level, name));
                    row.appendChild(castBtn);
                    row.appendChild(spellItem(name, dc));
                    const rm = h('button', 'inv-btn inv-btn-danger no-print', '×');
                    rm.type = 'button';
                    rm.title = 'Remove from spell list';
                    rm.addEventListener('click', () => {
                        if (!confirm(`Remove “${name}” from level ${level}?`)) return;
                        const bucket = bk.lists[level];
                        if (!Array.isArray(bucket)) return;
                        const i = bucket.findIndex((n) => String(n) === String(name));
                        if (i >= 0) {
                            bucket.splice(i, 1);
                            writePreparedAt(data, bk, level, name, false);
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
                    const bucket = bk.lists[level];
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

                levelWrap.dataset.bookId = bk.id;
                wrap.appendChild(levelWrap);
            });
        }
        body.appendChild(wrap);
    }

    function renderSpells(data) {
        const { sec, body } = section('Spellcasting');
        // Seed main-book prepared checkboxes once (legacy behaviour, unchanged storage).
        if (isPreparedCaster(data) && Array.isArray(data.spell_list_choose_from)) {
            ensurePreparedSpellsSeeded(data, data.spell_list_choose_from);
        }
        const books = bookViews(data);
        const multi = books.length > 1;
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Browse spells to add to a level. Cast rolls attack/damage/DC and spends a slot'
            + (knownMetamagic(data).length ? ' (metamagic picker opens first)' : '')
            + '. Multiclass casters: each class gets its own spellbook below.'));
        for (const bk of books) renderSpellbook(body, data, bk, multi);

        const addBook = h('button', 'inv-btn no-print spellbook-add', '+ Add spellbook');
        addBook.type = 'button';
        addBook.title = 'Second casting class? Give it its own book: ability, CL, slots, lists.';
        addBook.addEventListener('click', () => {
            const name = prompt('Spellbook name (usually the class):', 'Second class');
            if (name == null) return;
            extraBooks(data).push({
                id: 'book-' + Date.now(),
                name: String(name).trim() || 'Spellbook',
                castAb: 'int', cl: 0, preparedMode: false,
                dayList: Array(10).fill(0), lists: [], prepared: [], casts: Array(10).fill(0),
            });
            quietSave();
            renderSheet(data);
            setActiveTab('spells');
        });
        body.appendChild(addBook);
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
