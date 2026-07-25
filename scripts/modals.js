// scripts/modals.js -- the cross-tab overlay/dialog layer (window.SheetModals). Extracted from
// sheet.js (Part B split); bodies moved verbatim. Loads after theme.js, before the tab modules.
// These overlays are opened FROM tabs and reach INTO tab internals, so a set of tab/shell helpers
// is late-bound via window.SheetApp (read at call time). When a given tab is later extracted its
// helpers move to that module and the shell re-points the SheetApp delegate. window.SheetDetails /
// window.SheetOverlay are read at call time.
window.SheetModals = (function () {
    'use strict';
    const {
        h, htmlBlock, details, section, fmt, mod, toInt, titleCase, nonEmpty, escapeHtml,
        parseIntLoose, fmtWeight, fmtPrice, foundry, cloneChanges,
    } = window.SheetUI;
    const {
        sheetState, quietSave, refreshDerived, ensureInventoryObjects, featureCustomEntry,
        featureCustomList, pruneFeatureCustom, isBuffSourceActive, setBuffSourceActive,
        BUFF_SUBTYPES, BUFF_DURATION_UNITS,
    } = window.SheetState;
    const { effectiveLedger } = window.SheetDerive;
    const { ALL_SKILLS } = window.SheetData;
    // Shell/tab helpers, late-bound via SheetApp (read at call time).
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);
    const inventoryCategory = (...a) => window.SheetApp.inventoryCategory(...a);
    const invRerender = (...a) => window.SheetApp.invRerender(...a);
    const { skillAbilityKey, skillBonusEntry, setSkillBonus } = window.SheetSkillMath;
    const setClassInfo = (...a) => window.SheetApp.setClassInfo(...a);
    const classInfoFor = (...a) => window.SheetApp.classInfoFor(...a);
    const classLevelFor = (...a) => window.SheetApp.classLevelFor(...a);
    const refreshFeatureLedger = (...a) => window.SheetApp.refreshFeatureLedger(...a);
    const featureBuffGroup = (...a) => window.SheetApp.featureBuffGroup(...a);
    const archetypeDescHtml = (...a) => window.SheetApp.archetypeDescHtml(...a);

    function openBuffEditor(data, buff, host) {
        const existing = host.querySelector('.buff-editor-panel');
        if (existing) {
            existing.remove();
            return;
        }
        const SD = window.SheetDetails;
        const panel = h('div', 'buff-editor-panel inv-buffs-editor no-print');
        panel.appendChild(h('div', 'inv-buffs-title', 'Edit buff'));

        const meta = h('div', 'buff-editor-meta');
        const nameIn = h('input', 'edit-field');
        nameIn.value = buff.name || '';
        nameIn.placeholder = 'Buff name';
        const subSel = h('select', 'edit-field');
        for (const s of BUFF_SUBTYPES) {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.label;
            if (s.id === buff.subType) opt.selected = true;
            subSel.appendChild(opt);
        }
        const levelIn = h('input', 'edit-field');
        levelIn.type = 'number';
        levelIn.min = '0';
        levelIn.max = '40';
        levelIn.value = String(buff.level || 0);
        levelIn.title = 'Buff level (for scaling formulas)';
        const durVal = h('input', 'edit-field');
        durVal.placeholder = 'Duration value';
        durVal.value = buff.duration?.value || '';
        const durUnit = h('select', 'edit-field');
        for (const u of BUFF_DURATION_UNITS) {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = u.label;
            if (u.id === (buff.duration?.units || '')) opt.selected = true;
            durUnit.appendChild(opt);
        }
        const addField = (label, el) => {
            const lab = h('label', 'buff-editor-field');
            lab.appendChild(h('span', null, label));
            lab.appendChild(el);
            meta.appendChild(lab);
        };
        addField('Name', nameIn);
        addField('Category', subSel);
        addField('Level', levelIn);
        addField('Duration', durVal);
        addField('Units', durUnit);
        panel.appendChild(meta);

        const notesIn = h('textarea', 'edit-field buff-editor-notes');
        notesIn.rows = 2;
        notesIn.placeholder = 'Notes / description (optional)';
        notesIn.value = buff.notes || '';
        panel.appendChild(notesIn);

        panel.appendChild(h('h4', null, 'Changes'));
        const list = h('div', 'inv-buffs-list');
        function redrawList() {
            list.innerHTML = '';
            const changes = Array.isArray(buff.changes) ? buff.changes : [];
            if (!changes.length) {
                list.appendChild(h('p', 'tools-empty', 'No mechanical changes — add one below.'));
                return;
            }
            changes.forEach((c, idx) => {
                const row = h('div', 'inv-buffs-row');
                row.appendChild(h('span', 'inv-buffs-line', formatChangeLine(c, SD)));
                const del = h('button', 'inv-btn inv-btn-danger', '×');
                del.type = 'button';
                del.addEventListener('click', () => {
                    buff.changes.splice(idx, 1);
                    quietSave();
                    redrawList();
                    refreshDerived();
                });
                row.appendChild(del);
                list.appendChild(row);
            });
        }
        redrawList();
        panel.appendChild(list);

        const form = h('div', 'inv-buffs-add');
        const formulaIn = h('input', 'edit-field');
        formulaIn.placeholder = 'Formula (e.g. 2 or +1)';
        const targetSel = h('select', 'edit-field');
        for (const t of INV_TARGET_OPTIONS) {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = SD?.targetLabel?.(t) || t;
            targetSel.appendChild(opt);
        }
        targetSel.value = 'ac';
        const typeSel = h('select', 'edit-field');
        for (const t of INV_TYPE_OPTIONS) {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t === 'untyped' ? 'untyped' : (SD?.typeLabel?.(t) || t);
            typeSel.appendChild(opt);
        }
        const addBtn = h('button', 'inv-btn', 'Add change');
        addBtn.type = 'button';
        addBtn.addEventListener('click', () => {
            let formula = String(formulaIn.value || '').trim();
            if (!formula) { formulaIn.focus(); return; }
            if (/^\+\d+$/.test(formula)) formula = formula.slice(1);
            (buff.changes ??= []).push({
                formula,
                target: targetSel.value,
                type: typeSel.value || 'untyped',
                operator: 'add',
                priority: 0,
            });
            formulaIn.value = '';
            quietSave();
            redrawList();
            refreshDerived();
        });
        form.append(formulaIn, targetSel, typeSel, addBtn);
        panel.appendChild(form);

        const actions = h('div', 'inv-buffs-actions');
        const saveBtn = h('button', 'inv-btn inv-btn-primary', 'Save');
        saveBtn.type = 'button';
        saveBtn.addEventListener('click', () => {
            buff.name = String(nameIn.value || '').trim() || buff.name;
            buff.subType = subSel.value;
            buff.level = parseIntLoose(levelIn.value, 0);
            buff.duration = {
                value: String(durVal.value || '').trim(),
                units: durUnit.value || '',
            };
            buff.notes = notesIn.value || '';
            quietSave();
            renderSheet(data);
            setActiveTab('buffs');
        });
        const closeBtn = h('button', 'inv-btn', 'Close');
        closeBtn.type = 'button';
        closeBtn.addEventListener('click', () => {
            // Apply meta fields on close too
            buff.name = String(nameIn.value || '').trim() || buff.name;
            buff.subType = subSel.value;
            buff.level = parseIntLoose(levelIn.value, 0);
            buff.duration = {
                value: String(durVal.value || '').trim(),
                units: durUnit.value || '',
            };
            buff.notes = notesIn.value || '';
            quietSave();
            renderSheet(data);
            setActiveTab('buffs');
        });
        actions.append(saveBtn, closeBtn);
        panel.appendChild(actions);
        host.appendChild(panel);
    }
    // ---------------------------------------------------------------- section renderers
    // --- Character portrait ---------------------------------------------------------
    // A single character image kept on _sheet.portrait as a compressed data URL, so it
    // rides along with every save (IndexedDB + disk mirror) and JSON export/import with no
    // extra plumbing. Uploads are downscaled to keep those payloads small.
    const PORTRAIT_MAX = 768; // longest edge, px
    function processPortraitFile(file, cb) {
        if (!file || !/^image\//.test(file.type || '')) return;
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                let iw = img.naturalWidth || img.width;
                let ih = img.naturalHeight || img.height;
                if (!iw || !ih) return;
                const scale = Math.min(1, PORTRAIT_MAX / Math.max(iw, ih));
                iw = Math.max(1, Math.round(iw * scale));
                ih = Math.max(1, Math.round(ih * scale));
                const canvas = document.createElement('canvas');
                canvas.width = iw;
                canvas.height = ih;
                canvas.getContext('2d').drawImage(img, 0, 0, iw, ih);
                // WebP where supported (smaller); fall back to JPEG otherwise.
                let url = '';
                try { url = canvas.toDataURL('image/webp', 0.85); } catch (e) { url = ''; }
                if (url.slice(0, 15) !== 'data:image/webp') url = canvas.toDataURL('image/jpeg', 0.85);
                cb(url);
            };
            img.onerror = () => { /* unreadable image — ignore */ };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    }
    /** Full-screen lightbox showing the portrait at its stored resolution. */
    function openPortraitLightbox(url) {
        if (!url) return;
        document.getElementById('portrait-lightbox')?.remove();
        const overlay = h('div', 'portrait-lightbox no-print');
        overlay.id = 'portrait-lightbox';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Character portrait');
        const img = h('img', 'portrait-lightbox-img');
        img.src = url;
        img.alt = 'Character portrait';
        overlay.appendChild(img);
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
        const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', close); // click anywhere (image or backdrop) closes
        document.body.appendChild(overlay);
    }
    // ---------------------------------------------------------------- inventory (equipment_list)
    const INV_TARGET_OPTIONS = [
        'ac', 'aac', 'sac', 'nac', 'tac', 'ffac',
        'attack', 'mattack', 'rattack', 'damage', 'mdamage', 'rdamage', 'wdamage',
        'fort', 'ref', 'will', 'allSavingThrows',
        'str', 'dex', 'con', 'int', 'wis', 'cha',
        'cmb', 'cmd', 'init', 'bab', 'mhp', 'hp',
        'skills', 'strSkills', 'dexSkills', 'conSkills', 'intSkills', 'wisSkills', 'chaSkills',
        'landSpeed', 'allSpeeds', 'cl', 'concentration', 'spellResist',
    ];
    const INV_TYPE_OPTIONS = [
        'untyped', 'enh', 'deflect', 'dodge', 'resist', 'morale', 'competence',
        'insight', 'luck', 'sacred', 'profane', 'alchemical', 'circumstance',
        'inherent', 'racial', 'size', 'trait', 'penalty',
    ];
    /** "Longsword [+1, flaming]" → ['+1', 'flaming']; plain names → []. */
    function parseEnhancements(name) {
        const m = String(name || '').match(/\[([^\]]+)\]\s*$/);
        if (!m) return [];
        return m[1].split(',').map((s) => s.trim()).filter(Boolean);
    }
    /**
     * What an enhancement does. Priority: backend `enhancement_desc_dict`
     * ({ "<name lowercase>": "<html|text>" } — new payload field, shared with the
     * FoundryVTT module), then the local compendium, then generic +N wording.
     */
    function enhancementDescHtml(data, enh, kind) {
        const dict = data?.enhancement_desc_dict || {};
        const key = String(enh).toLowerCase().trim();
        let hit = dict[key] ?? dict[enh];
        if (hit == null) {
            hit = Object.entries(dict)
                .find(([k]) => String(k).toLowerCase().trim() === key)?.[1];
        }
        if (hit != null) {
            const html = typeof hit === 'object' ? (hit.description || '') : String(hit);
            if (html) return /</.test(html) ? html : '<p>' + escapeHtml(html) + '</p>';
        }
        const plusN = key.match(/^\+(\d+)$/);
        if (plusN) {
            return kind === 'armor'
                ? `<p>+${plusN[1]} enhancement bonus to AC.</p>`
                : `<p>+${plusN[1]} enhancement bonus on attack and damage rolls.</p>`;
        }
        const local = window.SheetDetails?.lookupItem?.(enh);
        if (local?.description) return local.description;
        return '<p class="dim">No description on file — the backend can supply it via '
            + '<code>enhancement_desc_dict</code>.</p>';
    }
    /**
     * One-line mechanics summary for a weapon/armor quality from the backend's
     * enhancement_effects_dict (quality_effects.json): change bonuses, conditional
     * riders (with the [[ ]] roll markup stripped for display), and context notes.
     */
    function enhancementEffectHtml(data, enh, kind) {
        const eff = data?.enhancement_effects_dict || {};
        const section = kind === 'armor'
            ? { ...(eff.armor || {}), ...(eff.shield || {}) }
            : (eff.weapon || {});
        const key = String(enh).toLowerCase().trim();
        const hit = Object.entries(section)
            .find(([k]) => String(k).toLowerCase().trim() === key)?.[1];
        if (!hit) return '';
        const bits = [];
        for (const c of hit.changes || []) {
            const sign = c.operator === 'set' ? '=' : '+';
            bits.push(`${sign}${c.formula} ${c.type || 'untyped'} → ${c.target}`);
        }
        for (const cond of hit.conditionals || []) {
            if (cond?.name) bits.push(String(cond.name).replace(/\[\[|\]\]/g, ''));
        }
        for (const n of hit.contextNotes || []) {
            if (n?.text) bits.push(n.text);
        }
        if (!bits.length) return '';
        return '<p class="item-sheet-enh-fx dim">' + bits.map(escapeHtml).join(' • ') + '</p>';
    }
    /** Empty item shell (no compendium link) — filled in via the item sheet. */
    function addBlankInventoryItem(data, itemType) {
        ensureInventoryObjects(data);
        const item = {
            id: 'eq:blank-' + Date.now(),
            name: 'New Item',
            equipped: false,
            carried: true,
            identified: true,
            quantity: 1,
            weight: null,
            price: null,
            description: '',
            changes: [],
            contextNotes: [],
            changesCustomized: false,
            subType: '',
            equipmentSubtype: '',
            armor: null,
            slot: '',
            itemType: itemType || '',
            containerId: null,
        };
        data.equipment_list.push(item);
        quietSave();
        return item;
    }
    function formatChangeLine(c, SD) {
        const t = SD?.typeLabel?.(c.type) || (c.type && c.type !== 'untyped' ? c.type : '');
        const num = /^-?\d+$/.test(String(c.formula || '').trim())
            ? fmt(Number(c.formula))
            : String(c.formula || '?');
        const tgt = SD?.targetLabel?.(c.target) || c.target || '?';
        return `${num}${t ? ' ' + t : ''} → ${tgt}`;
    }
    /**
     * Foundry-style catalog browser: search slim data/*.json, pick a result, or add custom.
     * @param {{ title: string, kinds: string[]|string, kindLabels?: object, allowCustom?: boolean,
     *   customPlaceholder?: string, onPick: (hit: object) => void, onCustom?: (name: string) => void }} opts
     */
    function openCatalogPicker(opts) {
        const kinds = Array.isArray(opts.kinds) ? opts.kinds : [opts.kinds || 'items'];
        const kindLabels = opts.kindLabels || {
            items: 'Items', weapons: 'Weapons', feats: 'Feats', traits: 'Traits',
            spells: 'Spells', classFeatures: 'Class features', talents: 'Talents',
        };
        // Remove existing picker
        document.getElementById('catalog-picker')?.remove();

        const overlay = h('div', 'catalog-picker no-print');
        overlay.id = 'catalog-picker';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', opts.title || 'Browse catalog');

        const card = h('div', 'catalog-picker-card');
        const head = h('div', 'catalog-picker-head');
        head.appendChild(h('h3', null, opts.title || 'Browse catalog'));
        const closeBtn = h('button', 'catalog-picker-close', '×');
        closeBtn.type = 'button';
        closeBtn.title = 'Close';
        closeBtn.addEventListener('click', () => overlay.remove());
        head.appendChild(closeBtn);
        card.appendChild(head);

        const lead = h('p', 'catalog-picker-lead dim',
            'Search the item database. Pick a result, or add a custom name if it is not listed.');
        card.appendChild(lead);

        let activeKind = kinds[0];
        if (kinds.length > 1) {
            const tabs = h('div', 'catalog-kind-tabs');
            kinds.forEach((k) => {
                const b = h('button', 'catalog-kind-tab' + (k === activeKind ? ' is-active' : ''),
                    kindLabels[k] || k);
                b.type = 'button';
                b.addEventListener('click', () => {
                    activeKind = k;
                    tabs.querySelectorAll('.catalog-kind-tab').forEach((t) => t.classList.remove('is-active'));
                    b.classList.add('is-active');
                    runSearch();
                });
                tabs.appendChild(b);
            });
            card.appendChild(tabs);
        }

        const searchRow = h('div', 'catalog-search-row');
        const input = h('input', 'edit-field catalog-search-input');
        input.type = 'search';
        input.placeholder = 'Type to search…';
        input.autocomplete = 'off';
        searchRow.appendChild(input);
        card.appendChild(searchRow);

        const results = h('div', 'catalog-results');
        results.setAttribute('role', 'listbox');
        card.appendChild(results);

        if (opts.allowCustom !== false) {
            const customRow = h('div', 'catalog-custom-row');
            const customIn = h('input', 'edit-field');
            customIn.placeholder = opts.customPlaceholder || 'Custom name (not in database)';
            const customBtn = h('button', 'inv-btn inv-btn-primary', 'Add custom');
            customBtn.type = 'button';
            const doCustom = () => {
                const name = String(customIn.value || input.value || '').trim();
                if (!name) { customIn.focus(); return; }
                overlay.remove();
                if (opts.onCustom) opts.onCustom(name);
                else opts.onPick?.({ name, kind: activeKind, custom: true, entry: null });
            };
            customBtn.addEventListener('click', doCustom);
            customIn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); doCustom(); }
            });
            customRow.append(customIn, customBtn);
            if (opts.onBlank) {
                const blankBtn = h('button', 'inv-btn', 'Blank item');
                blankBtn.type = 'button';
                blankBtn.title = 'Create an empty item and open its sheet';
                blankBtn.addEventListener('click', () => {
                    overlay.remove();
                    opts.onBlank();
                });
                customRow.appendChild(blankBtn);
            }
            card.appendChild(customRow);
        }

        function runSearch() {
            results.innerHTML = '';
            const q = input.value.trim();
            // showAllOnEmpty lets a local source (e.g. per-class archetypes) list every
            // option before the user types; the bundled catalog still needs a query.
            if (q.length < 1 && !(opts.showAllOnEmpty && opts.localSource)) {
                results.appendChild(h('p', 'catalog-empty dim', 'Start typing to search the catalog.'));
                return;
            }
            // Catalog hits (if the active kind has bundled data) plus any caller-supplied
            // local options (e.g. previously-used archetypes), deduped by name.
            const catalogHits = q.length >= 1
                ? (window.SheetDetails?.searchCatalog?.(activeKind, q, { limit: 50 }) || [])
                : [];
            const localHits = opts.localSource ? (opts.localSource(q) || []) : [];
            const seen = new Set();
            const hits = [];
            for (const hit of [...localHits, ...catalogHits]) {
                const key = String(hit?.name || '').toLowerCase();
                if (!key || seen.has(key)) continue;
                seen.add(key);
                hits.push(hit);
            }
            if (!hits.length) {
                results.appendChild(h('p', 'catalog-empty dim',
                    'No matches. Use “Add custom” below for homebrew names.'));
                return;
            }
            for (const hit of hits) {
                const row = h('button', 'catalog-result');
                row.type = 'button';
                row.setAttribute('role', 'option');
                const main = h('span', 'catalog-result-name', hit.name);
                row.appendChild(main);
                if (hit.subtitle) {
                    row.appendChild(h('span', 'catalog-result-sub', hit.subtitle));
                }
                row.addEventListener('click', () => {
                    overlay.remove();
                    opts.onPick?.(hit);
                });
                results.appendChild(row);
            }
        }

        let timer = null;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(runSearch, 120);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); overlay.remove(); }
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        overlay.appendChild(card);
        document.body.appendChild(overlay);
        runSearch();
        setTimeout(() => input.focus(), 30);
    }
    function sectionCatalogToolbar(opts) {
        const bar = h('div', 'section-catalog-bar no-print');
        const browse = h('button', 'inv-btn inv-btn-primary catalog-browse-btn', opts.browseLabel || 'Browse catalog');
        browse.type = 'button';
        browse.title = opts.browseTitle || 'Search the local database and add an entry';
        browse.addEventListener('click', () => openCatalogPicker(opts.picker));
        bar.appendChild(browse);
        if (opts.extra) bar.appendChild(opts.extra);
        return bar;
    }
    /** Mechanical-buffs (changes) editor panel — embedded in the item sheet's Changes tab. */
    function buildItemBuffsPanel(data, item, opts = {}) {
        const SD = window.SheetDetails;
        const panel = h('div', 'inv-buffs-editor no-print');
        panel.appendChild(h('div', 'inv-buffs-title', 'Mechanical buffs — ' + item.name));
        panel.appendChild(h('p', 'dim inv-buffs-hint',
            'These apply while the item is equipped. Edits save with the character.'));

        const list = h('div', 'inv-buffs-list');
        function redrawList() {
            list.innerHTML = '';
            const changes = Array.isArray(item.changes) ? item.changes : [];
            if (!changes.length) {
                list.appendChild(h('p', 'tools-empty', 'No mechanical buffs on this item.'));
                return;
            }
            changes.forEach((c, idx) => {
                const row = h('div', 'inv-buffs-row');
                row.appendChild(h('span', 'inv-buffs-line', formatChangeLine(c, SD)));
                const del = h('button', 'inv-btn inv-btn-danger', '×');
                del.type = 'button';
                del.title = 'Remove this buff';
                del.addEventListener('click', () => {
                    item.changes.splice(idx, 1);
                    item.changesCustomized = true;
                    quietSave();
                    redrawList();
                    // Refresh derived math without losing open editor
                    refreshDerived();
                    window.sheetChangesFull = SD?.collectChanges?.(data);
                    window.sheetChanges = effectiveLedger(data);
                });
                row.appendChild(del);
                list.appendChild(row);
            });
        }
        redrawList();
        panel.appendChild(list);

        const form = h('div', 'inv-buffs-add');
        const formulaIn = h('input', 'edit-field');
        formulaIn.type = 'text';
        formulaIn.placeholder = 'Formula (e.g. 2 or +1)';
        formulaIn.title = 'Numeric formula';
        const targetSel = h('select', 'edit-field');
        for (const t of INV_TARGET_OPTIONS) {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = SD?.targetLabel?.(t) || t;
            targetSel.appendChild(opt);
        }
        targetSel.value = 'ac';
        const typeSel = h('select', 'edit-field');
        for (const t of INV_TYPE_OPTIONS) {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t === 'untyped' ? 'untyped' : (SD?.typeLabel?.(t) || t);
            typeSel.appendChild(opt);
        }
        const addBtn = h('button', 'inv-btn', 'Add buff');
        addBtn.type = 'button';
        addBtn.addEventListener('click', () => {
            let formula = String(formulaIn.value || '').trim();
            if (!formula) {
                formulaIn.focus();
                return;
            }
            // Normalize leading + for pure numbers
            if (/^\+\d+$/.test(formula)) formula = formula.slice(1);
            (item.changes ??= []).push({
                formula,
                target: targetSel.value,
                type: typeSel.value || 'untyped',
                operator: 'add',
                priority: 0,
            });
            item.changesCustomized = true;
            formulaIn.value = '';
            quietSave();
            redrawList();
            refreshDerived();
            window.sheetChangesFull = SD?.collectChanges?.(data);
            window.sheetChanges = effectiveLedger(data);
        });
        form.append(formulaIn, targetSel, typeSel, addBtn);
        panel.appendChild(form);

        const actions = h('div', 'inv-buffs-actions');
        const resetBtn = h('button', 'inv-btn', 'Reset to compendium');
        resetBtn.type = 'button';
        resetBtn.title = 'Restore the default changes for this item';
        resetBtn.addEventListener('click', () => {
            const foundry = SD?.lookupItem?.(String(item.name || '').split(' [')[0].trim());
            item.changes = cloneChanges(foundry?.changes);
            item.contextNotes = (foundry?.contextNotes || []).map((n) => ({ ...n }));
            item.changesCustomized = false;
            if (foundry?.weight != null) item.weight = foundry.weight;
            if (foundry?.description && !item.description) item.description = foundry.description;
            quietSave();
            redrawList();
            refreshDerived();
            window.sheetChangesFull = SD?.collectChanges?.(data);
            window.sheetChanges = effectiveLedger(data);
        });
        actions.append(resetBtn);
        if (opts.closable) {
            const closeBtn = h('button', 'inv-btn', 'Close');
            closeBtn.type = 'button';
            closeBtn.addEventListener('click', () => panel.remove());
            actions.append(closeBtn);
        }
        panel.appendChild(actions);
        return panel;
    }
    /** camelCase / lowercase tokens → "Title Case" for type captions. */
    function prettyTypeWord(s) {
        return String(s || '')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/(^|\s)\w/g, (c) => c.toUpperCase());
    }
    /**
     * Foundry-style pf1 item sheet (modal): stats sidebar (type, qty, weight, price,
     * HP/hardness, state checkboxes, property chips) + Description / Details / Changes
     * tabs. Everything editable; the inventory re-renders on close.
     */
    function openItemSheet(data, item) {
        document.getElementById('item-sheet-modal')?.remove();
        const SD = window.SheetDetails;
        // Migrated core gear carries an "[enhancements]" suffix — look up by base name.
        const baseName = String(item.name || '').split(' [')[0].trim();
        // Per-item overrides (item.weapon / item.armor) win over compendium lookups.
        const wBase = SD?.lookupWeapon?.(baseName);
        const weapon = (wBase || item.weapon) ? { ...(wBase || {}), ...(item.weapon || {}) } : null;
        const compendium = SD?.lookupItem?.(baseName);
        const armor = item.armor || compendium?.armor || null;

        const overlay = h('div', 'catalog-picker item-sheet-overlay no-print');
        overlay.id = 'item-sheet-modal';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Item sheet — ' + (item.name || 'item'));

        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
        };
        const close = () => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            invRerender(data);
        };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        const card = h('div', 'item-sheet-card');

        // ---- header: name + unidentified name (both editable), type caption, close
        const head = h('div', 'item-sheet-head');
        const titles = h('div', 'item-sheet-titles');
        const nameIn = h('input', 'item-sheet-name');
        nameIn.type = 'text';
        nameIn.value = item.name || '';
        nameIn.placeholder = 'Item name';
        nameIn.addEventListener('change', () => {
            const next = nameIn.value.trim();
            if (!next || next === item.name) return;
            // Re-key the shared description map so the row expander keeps working.
            if (data.equip_descrip?.[item.name]) {
                data.equip_descrip[next] = data.equip_descrip[item.name];
            }
            item.name = next;
            quietSave();
        });
        const unidIn = h('input', 'item-sheet-unid-name');
        unidIn.type = 'text';
        unidIn.value = item.unidName || '';
        unidIn.placeholder = 'Unidentified Name';
        unidIn.title = 'Shown on the sheet while the item is unidentified';
        unidIn.addEventListener('change', () => {
            item.unidName = unidIn.value.trim();
            quietSave();
        });
        titles.append(nameIn, unidIn);
        head.appendChild(titles);
        const closeBtn = h('button', 'catalog-picker-close', '×');
        closeBtn.type = 'button';
        closeBtn.title = 'Close';
        closeBtn.addEventListener('click', close);
        head.appendChild(closeBtn);
        card.appendChild(head);

        const grid = h('div', 'item-sheet-grid');

        // ---- sidebar
        const side = h('div', 'item-sheet-side');
        const typeBits = [
            prettyTypeWord(item.itemType) || prettyTypeWord(inventoryCategory(item)),
            item.subType && item.subType !== item.itemType ? prettyTypeWord(item.subType) : '',
            item.equipmentSubtype ? prettyTypeWord(item.equipmentSubtype) : '',
        ].filter(Boolean);
        side.appendChild(h('h4', 'item-sheet-type', typeBits[0] || 'Item'));
        for (const bit of typeBits.slice(1)) side.appendChild(h('p', 'item-sheet-subtype', bit));

        const numRow = (label, get, set, o = {}) => {
            const row = h('label', 'item-sheet-stat');
            row.appendChild(h('span', 'item-sheet-stat-label', label));
            const inp = h('input', 'item-sheet-num');
            inp.type = 'number';
            if (o.min != null) inp.min = String(o.min);
            inp.step = o.step || 'any';
            const v = get();
            inp.value = v == null || v === '' ? '' : String(v);
            if (o.placeholder) inp.placeholder = o.placeholder;
            inp.addEventListener('change', () => {
                const n = inp.value === '' ? null : Number(inp.value);
                set(Number.isFinite(n) ? n : null);
                quietSave();
            });
            row.appendChild(inp);
            return row;
        };
        const textRow = (label, get, set, placeholder) => {
            const row = h('label', 'item-sheet-stat');
            row.appendChild(h('span', 'item-sheet-stat-label', label));
            const inp = h('input', 'item-sheet-text');
            inp.type = 'text';
            inp.value = get() || '';
            if (placeholder) inp.placeholder = placeholder;
            inp.addEventListener('change', () => {
                set(inp.value.trim());
                quietSave();
            });
            row.appendChild(inp);
            return row;
        };
        const selectRow = (label, options, get, set) => {
            const row = h('label', 'item-sheet-stat');
            row.appendChild(h('span', 'item-sheet-stat-label', label));
            const sel = h('select', 'item-sheet-select');
            for (const [val, lab] of options) {
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = lab;
                sel.appendChild(opt);
            }
            sel.value = get() ?? '';
            sel.addEventListener('change', () => {
                set(sel.value);
                quietSave();
            });
            row.appendChild(sel);
            return row;
        };
        side.appendChild(numRow('Quantity',
            () => item.quantity ?? 1,
            (v) => { item.quantity = Math.max(1, Math.round(v ?? 1)); }, { min: 1, step: '1' }));
        side.appendChild(numRow('Weight', () => item.weight, (v) => { item.weight = v; }, { min: 0 }));
        side.appendChild(numRow('Price', () => item.price, (v) => { item.price = v; }, { min: 0 }));
        side.appendChild(numRow('Unid. Price', () => item.unidPrice, (v) => { item.unidPrice = v; }, { min: 0 }));

        // HP value / max on one row (pf1 defaults 10/10)
        const hpRow = h('div', 'item-sheet-stat');
        hpRow.appendChild(h('span', 'item-sheet-stat-label', 'HP'));
        const hpPair = h('span', 'item-sheet-hp');
        const hpIn = h('input', 'item-sheet-num');
        hpIn.type = 'number';
        hpIn.value = String(item.hp ?? 10);
        hpIn.addEventListener('change', () => {
            item.hp = parseIntLoose(hpIn.value, 10);
            quietSave();
        });
        const hpMaxIn = h('input', 'item-sheet-num');
        hpMaxIn.type = 'number';
        hpMaxIn.value = String(item.hpMax ?? 10);
        hpMaxIn.addEventListener('change', () => {
            item.hpMax = parseIntLoose(hpMaxIn.value, 10);
            quietSave();
        });
        hpPair.append(hpIn, h('span', 'item-sheet-hp-sep', '/'), hpMaxIn);
        hpRow.appendChild(hpPair);
        side.appendChild(hpRow);
        side.appendChild(numRow('Hardness',
            () => item.hardness ?? 10,
            (v) => { item.hardness = v == null ? null : Math.max(0, Math.round(v)); }, { min: 0, step: '1' }));

        const checks = h('div', 'item-sheet-checks');
        const checkRow = (label, get, set, title) => {
            const row = h('label', 'item-sheet-check');
            const cb = h('input');
            cb.type = 'checkbox';
            cb.checked = !!get();
            if (title) row.title = title;
            cb.addEventListener('change', () => { set(cb.checked); quietSave(); });
            row.append(cb, h('span', null, label));
            return row;
        };
        checks.append(
            checkRow('Equipped', () => item.equipped, (v) => { item.equipped = v; },
                'Applies the item buffs'),
            checkRow('Carried', () => item.carried !== false, (v) => { item.carried = v; },
                'Stowed items do not count for encumbrance'),
            checkRow('Broken', () => item.broken, (v) => { item.broken = v; }),
            checkRow('Masterwork', () => item.masterwork, (v) => { item.masterwork = v; }),
            checkRow('Identified', () => item.identified !== false, (v) => { item.identified = v; },
                'Unidentified items show the unidentified name on the sheet'),
        );
        side.appendChild(checks);

        // Property chips — the data we actually have (armor numbers, weapon dice/crit)
        const chips = [];
        if (armor && armor.value != null) {
            chips.push('AC +' + armor.value);
            if (armor.dex != null) chips.push('Max Dex ' + armor.dex);
            if (armor.acp != null && armor.acp !== 0) chips.push('ACP ' + armor.acp);
        }
        if (weapon) {
            if (weapon.dice) chips.push(weapon.dice);
            const cr = Number(weapon.critRange) || 20;
            chips.push((cr >= 20 ? '20' : cr + '–20') + '/×' + (weapon.critMult || 2));
            for (const p of weapon.parts || []) for (const t of p.types || []) chips.push(t);
        }
        if (chips.length) {
            side.appendChild(h('p', 'item-sheet-chips-title', 'Properties'));
            const chipRow = h('div', 'item-sheet-chips');
            for (const c of [...new Set(chips)]) chipRow.appendChild(h('span', 'feat-tag', c));
            side.appendChild(chipRow);
        }
        grid.appendChild(side);

        // ---- content: Description | Details | Changes tabs
        const content = h('div', 'item-sheet-content');
        const tabBar = h('div', 'item-sheet-tabs');
        const panes = {};
        const tabs = [['description', 'Description'], ['details', 'Details'], ['changes', 'Changes']];
        for (const [id, label] of tabs) {
            const btn = h('button', 'item-sheet-tab' + (id === 'description' ? ' is-active' : ''), label);
            btn.type = 'button';
            btn.dataset.pane = id;
            btn.addEventListener('click', () => {
                tabBar.querySelectorAll('.item-sheet-tab').forEach((b) =>
                    b.classList.toggle('is-active', b === btn));
                for (const [pid, pane] of Object.entries(panes)) {
                    pane.classList.toggle('hidden', pid !== id);
                }
            });
            tabBar.appendChild(btn);
        }
        content.appendChild(tabBar);

        // Description pane — Superficial (unidentified) + Identified Properties
        const descPane = h('div', 'item-sheet-pane');
        descPane.appendChild(h('h4', 'item-sheet-h', 'Superficial Details'));
        const unidDesc = h('textarea', 'edit-field item-sheet-unid-desc');
        unidDesc.placeholder = 'No description.';
        unidDesc.value = item.unidDescription || '';
        unidDesc.title = 'What the item looks like before identification';
        unidDesc.addEventListener('change', () => {
            item.unidDescription = unidDesc.value;
            quietSave();
        });
        descPane.appendChild(unidDesc);
        descPane.appendChild(h('h4', 'item-sheet-h', 'Identified Properties'));
        const descHtml = () => item.description || data.equip_descrip?.[item.name] || '';
        const descView = htmlBlock('desc item-sheet-desc', descHtml() || '<p class="dim">No description.</p>');
        descPane.appendChild(descView);
        const descEditBtn = h('button', 'inv-btn item-sheet-desc-edit', 'Edit description');
        descEditBtn.type = 'button';
        const descEdit = h('textarea', 'edit-field item-sheet-desc-src hidden');
        descEdit.value = descHtml();
        descEdit.placeholder = '<p>Description HTML…</p>';
        descEdit.addEventListener('change', () => {
            item.description = descEdit.value;
            (data.equip_descrip ??= {})[item.name] = descEdit.value;
            descView.innerHTML = descEdit.value || '<p class="dim">No description.</p>';
            quietSave();
        });
        descEditBtn.addEventListener('click', () => descEdit.classList.toggle('hidden'));
        descPane.append(descEditBtn, descEdit);
        // Enhancements from the "[+1, flaming]" suffix — each with what it does
        const enhList = parseEnhancements(item.name);
        if (enhList.length) {
            descPane.appendChild(h('h4', 'item-sheet-h', 'Enhancements'));
            const enhKind = inventoryCategory(item) === 'armor' ? 'armor' : 'weapon';
            for (const enh of enhList) {
                descPane.appendChild(htmlBlock('desc item-sheet-enh',
                    `<p><strong>${escapeHtml(titleCase(enh))}</strong></p>`
                    + enhancementDescHtml(data, enh, enhKind)
                    + enhancementEffectHtml(data, enh, enhKind)));
            }
        }
        panes.description = descPane;

        // Details pane — everything editable; overrides persist on the item
        const detPane = h('div', 'item-sheet-pane hidden');
        detPane.appendChild(h('h4', 'item-sheet-h', 'Identity'));
        detPane.appendChild(selectRow('Type', [
            ['', '—'], ['weapon', 'Weapon'], ['equipment', 'Equipment'],
            ['consumable', 'Consumable'], ['loot', 'Loot'], ['container', 'Container'],
        ], () => item.itemType || '', (v) => { item.itemType = v; }));
        detPane.appendChild(textRow('Subtype',
            () => item.subType, (v) => { item.subType = v; }, 'wondrous, armor, tool, …'));
        detPane.appendChild(textRow('Equipment type',
            () => item.equipmentSubtype, (v) => { item.equipmentSubtype = v; }, 'lightArmor, clothing, …'));
        detPane.appendChild(textRow('Slot',
            () => item.slot, (v) => { item.slot = v; }, 'weapon, armor, wrists, ring, …'));

        if (weapon || item.itemType === 'weapon' || inventoryCategory(item) === 'weapons') {
            detPane.appendChild(h('h4', 'item-sheet-h', 'Weapon'));
            // First edit snapshots the compendium values so later edits stack sanely.
            const wOv = () => (item.weapon ??= {
                dice: weapon?.dice ?? '',
                damageAbility: weapon?.damageAbility ?? '',
                critRange: weapon?.critRange ?? 20,
                critMult: weapon?.critMult ?? 2,
            });
            detPane.appendChild(textRow('Damage dice',
                () => item.weapon?.dice ?? weapon?.dice ?? '',
                (v) => { wOv().dice = v; }, '1d8'));
            detPane.appendChild(selectRow('Damage ability', [
                ['', '—'], ['str', 'STR'], ['dex', 'DEX'], ['con', 'CON'],
                ['int', 'INT'], ['wis', 'WIS'], ['cha', 'CHA'],
            ], () => String(item.weapon?.damageAbility ?? weapon?.damageAbility ?? '').toLowerCase(),
                (v) => { wOv().damageAbility = v; }));
            detPane.appendChild(numRow('Crit range',
                () => item.weapon?.critRange ?? weapon?.critRange ?? 20,
                (v) => { wOv().critRange = v == null ? 20 : Math.round(v); }, { min: 2, step: '1' }));
            detPane.appendChild(numRow('Crit multiplier',
                () => item.weapon?.critMult ?? weapon?.critMult ?? 2,
                (v) => { wOv().critMult = v == null ? 2 : Math.round(v); }, { min: 2, step: '1' }));
        }

        if (armor || inventoryCategory(item) === 'armor') {
            detPane.appendChild(h('h4', 'item-sheet-h', 'Armor'));
            const aOv = () => (item.armor ??= { ...(armor || {}) });
            detPane.appendChild(numRow('Armor bonus',
                () => armor?.value ?? item.armor?.value,
                (v) => { aOv().value = v; }, { min: 0, step: '1' }));
            detPane.appendChild(numRow('Max Dex',
                () => armor?.dex ?? item.armor?.dex,
                (v) => { aOv().dex = v; }, { step: '1' }));
            detPane.appendChild(numRow('Check penalty',
                () => armor?.acp ?? item.armor?.acp,
                (v) => { aOv().acp = v; }, { step: '1' }));
        }
        const notes = item.contextNotes || [];
        if (notes.length) {
            detPane.appendChild(h('h4', 'item-sheet-h', 'Context notes'));
            const ul = h('ul', 'plain-list item-sheet-notes');
            for (const n of notes) {
                ul.appendChild(h('li', null, typeof n === 'string' ? n : (n.text || JSON.stringify(n))));
            }
            detPane.appendChild(ul);
        }
        panes.details = detPane;

        // Changes pane — shared mechanical-buffs editor
        const chgPane = h('div', 'item-sheet-pane hidden');
        chgPane.appendChild(buildItemBuffsPanel(data, item));
        panes.changes = chgPane;

        for (const pane of Object.values(panes)) content.appendChild(pane);
        grid.appendChild(content);
        card.appendChild(grid);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
    }
    /**
     * Anchored popover to manage a feature's buffs: toggle built-in modifiers on/off and
     * add/remove your own typed modifiers (same targets/types as inventory item buffs).
     * Custom buffs persist on _sheet.featureChanges and feed the whole sheet math.
     */
    function openFeatureBuffMenu(anchor, data, name, sourceKind = 'feat') {
        const SD = window.SheetDetails;
        document.getElementById('feat-buff-menu')?.remove();
        const menu = h('div', 'feat-buff-menu no-print');
        menu.id = 'feat-buff-menu';
        menu.appendChild(h('div', 'feat-buff-menu-title', name));

        // Recompute the built-in vs custom split from the live ledger each redraw.
        const bodyWrap = h('div', 'feat-buff-menu-body');
        menu.appendChild(bodyWrap);

        // Apply an edit: persist, refresh the derived ledger in place, redraw the popover.
        const commit = () => {
            pruneFeatureCustom(data, name);
            quietSave();
            refreshDerived();
            window.sheetChangesFull = SD?.collectChanges?.(data);
            window.sheetChanges = effectiveLedger(data);
            refreshFeatureLedger(data);
            redraw();
        };

        function redraw() {
            bodyWrap.innerHTML = '';
            const group = featureBuffGroup(name); // ledger lines for this source (or null)
            const builtin = (group?.lines || []).filter((c) => !c.custom);
            const customList = featureCustomList(data, name);
            const hasAny = builtin.length || customList.length;

            // Active toggle (governs the whole source) — only when there is something to toggle.
            if (hasAny) {
                const active = isBuffSourceActive(data, name, group?.sourceKind || sourceKind);
                const lbl = h('label', 'feat-buff-menu-toggle');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = active;
                cb.addEventListener('change', () => {
                    setBuffSourceActive(data, name, group?.sourceKind || sourceKind, cb.checked);
                    refreshFeatureLedger(data);
                    redraw();
                });
                lbl.append(cb, h('span', null, 'Active — apply these modifiers'));
                bodyWrap.appendChild(lbl);
            }

            // Built-in (read-only) modifiers from the compendium / feat data.
            if (builtin.length) {
                bodyWrap.appendChild(h('div', 'feat-buff-menu-section', 'Built-in'));
                const ul = h('ul', 'feat-buff-menu-list');
                for (const c of builtin) ul.appendChild(h('li', null, formatChangeLine(c, SD)));
                bodyWrap.appendChild(ul);
            }

            // Custom (editable) modifiers the user added.
            bodyWrap.appendChild(h('div', 'feat-buff-menu-section', 'Your buffs'));
            if (customList.length) {
                const ul = h('ul', 'feat-buff-menu-list feat-buff-menu-custom');
                customList.forEach((c, idx) => {
                    const li = h('li', null);
                    li.appendChild(h('span', 'feat-buff-line', formatChangeLine(c, SD)));
                    const del = h('button', 'inv-btn inv-btn-danger', '×');
                    del.type = 'button';
                    del.title = 'Remove this buff';
                    del.addEventListener('click', () => {
                        customList.splice(idx, 1);
                        commit();
                    });
                    li.appendChild(del);
                    ul.appendChild(li);
                });
                bodyWrap.appendChild(ul);
            } else {
                bodyWrap.appendChild(h('p', 'tools-empty', 'No custom buffs yet.'));
            }

            // Add form: formula + target + type + Add (same options as item buffs).
            const form = h('div', 'feat-buff-menu-add');
            const formulaIn = h('input', 'edit-field');
            formulaIn.type = 'text';
            formulaIn.placeholder = 'Formula (e.g. 2 or +1)';
            formulaIn.title = 'Numeric formula';
            const targetSel = h('select', 'edit-field');
            for (const t of INV_TARGET_OPTIONS) {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = SD?.targetLabel?.(t) || t;
                targetSel.appendChild(opt);
            }
            targetSel.value = 'ac';
            const typeSel = h('select', 'edit-field');
            for (const t of INV_TYPE_OPTIONS) {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t === 'untyped' ? 'untyped' : (SD?.typeLabel?.(t) || t);
                typeSel.appendChild(opt);
            }
            const addBtn = h('button', 'inv-btn', 'Add buff');
            addBtn.type = 'button';
            addBtn.addEventListener('click', () => {
                let formula = String(formulaIn.value || '').trim();
                if (!formula) { formulaIn.focus(); return; }
                if (/^\+\d+$/.test(formula)) formula = formula.slice(1);
                const entry = featureCustomEntry(data, name, sourceKind);
                entry.changes.push({
                    formula,
                    target: targetSel.value,
                    type: typeSel.value || 'untyped',
                    operator: 'add',
                    priority: 0,
                });
                commit();
            });
            form.append(formulaIn, targetSel, typeSel, addBtn);
            bodyWrap.appendChild(form);

            bodyWrap.appendChild(h('p', 'feat-buff-menu-hint',
                'Applies to the whole sheet. Also manageable on the Buffs & Conditions tab.'));
        }

        redraw();
        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect();
        const w = menu.offsetWidth || 260;
        menu.style.top = (window.scrollY + r.bottom + 4) + 'px';
        menu.style.left = (window.scrollX
            + Math.max(4, Math.min(r.left, window.innerWidth - w - 8))) + 'px';

        const close = () => {
            menu.remove();
            document.removeEventListener('mousedown', onDoc, true);
            document.removeEventListener('keydown', onKey, true);
        };
        const onDoc = (e) => {
            if (!menu.contains(e.target) && e.target !== anchor) close();
        };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        setTimeout(() => {
            document.addEventListener('mousedown', onDoc, true);
            document.addEventListener('keydown', onKey, true);
        }, 0);
    }
    /**
     * Inline editor for a maneuver/stance's mechanical modifiers, stored per-character as a
     * Path of War override. Both the roll conditionals and (for stances) the sheet math read
     * through SheetDetails.resolvePowConditional, so an edit here shows up in both places.
     */
    function openPowModifierEditor(data, name, host, opts = {}) {
        const existing = host.querySelector('.pow-mod-editor');
        if (existing) { existing.remove(); return; }
        // Only one editor open at a time within Path of War.
        host.closest('.section-body')?.querySelectorAll('.pow-mod-editor')
            .forEach((p) => p.remove());
        const SD = window.SheetDetails;
        // 'changes' = stance always-on benefits (pf1 change shape, feed the sheet math);
        // 'modifiers' = maneuver per-roll conditionals (feed the roll dialog).
        const isStance = opts.mode === 'changes';

        // Working array of edit rows in their native shape.
        let rows;
        let rider = '';
        if (isStance) {
            const resolved = SD?.resolveStanceEntry?.(data, name) || { changes: [], contextNotes: [] };
            rows = (resolved.changes || []).map((c) => ({ ...c }));
        } else {
            const resolved = SD?.resolvePowConditional?.(data, name) || {};
            rows = (resolved.modifiers || []).map((m) => ({ ...m }));
            rider = resolved.rider || '';
        }

        const panel = h('div', 'pow-mod-editor inv-buffs-editor no-print');
        panel.appendChild(h('div', 'inv-buffs-title',
            (isStance ? 'Edit benefits · ' : 'Edit modifiers · ') + name));
        panel.appendChild(h('p', 'dbl-edit-hint', isStance
            ? 'These apply to the sheet while the stance is active.'
            : 'These feed the roll conditionals for this maneuver.'));

        const persist = () => {
            if (isStance) SD?.setStanceOverride?.(data, name, { changes: rows, contextNotes: [] });
            else SD?.setPowOverride?.(data, name, { modifiers: rows, rider });
            quietSave();
            refreshDerived();
        };

        // A working row -> a change object for display (stances already are changes).
        const asChange = (r) => (isStance
            ? r
            : (SD?.stanceChangesFromModifiers?.([r])?.[0]
                || { formula: r.formula, target: r.target, type: r.type }));

        const list = h('div', 'inv-buffs-list');
        function redraw() {
            list.innerHTML = '';
            if (!rows.length) {
                list.appendChild(h('p', 'tools-empty',
                    isStance ? 'No benefits — add one below.' : 'No modifiers — add one below.'));
                return;
            }
            rows.forEach((r, idx) => {
                const row = h('div', 'inv-buffs-row');
                row.appendChild(h('span', 'inv-buffs-line', formatChangeLine(asChange(r), SD)));
                const del = h('button', 'inv-btn inv-btn-danger', '×');
                del.type = 'button';
                del.addEventListener('click', () => {
                    rows.splice(idx, 1);
                    persist();
                    redraw();
                });
                row.appendChild(del);
                list.appendChild(row);
            });
        }
        redraw();
        panel.appendChild(list);

        const form = h('div', 'inv-buffs-add');
        const formulaIn = h('input', 'edit-field');
        formulaIn.placeholder = 'Formula (e.g. 2 or 1d6)';
        const targetSel = h('select', 'edit-field');
        for (const t of INV_TARGET_OPTIONS) {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = SD?.targetLabel?.(t) || t;
            targetSel.appendChild(opt);
        }
        targetSel.value = isStance ? 'ac' : 'damage';
        const typeSel = h('select', 'edit-field');
        for (const t of INV_TYPE_OPTIONS) {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t === 'untyped' ? 'untyped' : (SD?.typeLabel?.(t) || t);
            typeSel.appendChild(opt);
        }
        const addBtn = h('button', 'inv-btn', isStance ? 'Add benefit' : 'Add modifier');
        addBtn.type = 'button';
        addBtn.addEventListener('click', () => {
            let formula = String(formulaIn.value || '').trim();
            if (!formula) { formulaIn.focus(); return; }
            if (/^\+\d+$/.test(formula)) formula = formula.slice(1);
            const target = targetSel.value;
            const type = typeSel.value || 'untyped';
            if (isStance) {
                rows.push({ formula, target, type, operator: 'add', priority: 0 });
            } else {
                const mod = { formula, target, type, critical: 'normal' };
                if (target === 'attack') mod.subTarget = 'allAttack';
                else if (target === 'damage') mod.subTarget = 'allDamage';
                rows.push(mod);
            }
            formulaIn.value = '';
            persist();
            redraw();
        });
        form.append(formulaIn, targetSel, typeSel, addBtn);
        panel.appendChild(form);

        const actions = h('div', 'inv-buffs-actions');
        const resetBtn = h('button', 'inv-btn', 'Reset to default');
        resetBtn.type = 'button';
        resetBtn.title = 'Discard custom edits and restore the compendium values';
        resetBtn.addEventListener('click', () => {
            if (isStance) SD?.clearStanceOverride?.(data, name);
            else SD?.clearPowOverride?.(data, name);
            quietSave();
            refreshDerived();
            renderSheet(data);
            setActiveTab('path-of-war');
        });
        const closeBtn = h('button', 'inv-btn', 'Close');
        closeBtn.type = 'button';
        closeBtn.addEventListener('click', () => {
            renderSheet(data);
            setActiveTab('path-of-war');
        });
        actions.append(resetBtn, closeBtn);
        panel.appendChild(actions);
        host.appendChild(panel);
    }
    /** Class detail popup — defaults line + editable chassis + class-skill checkboxes. */
    function openClassSheet(data, clsName) {
        document.getElementById('class-sheet-modal')?.remove();
        const overlay = h('div', 'catalog-picker item-sheet-overlay no-print');
        overlay.id = 'class-sheet-modal';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
        };
        const close = () => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            renderSheet(data);
        };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        const card = h('div', 'item-sheet-card class-sheet-card');
        const head = h('div', 'item-sheet-head');
        head.appendChild(h('h3', 'class-sheet-title',
            titleCase(clsName) + ' — level ' + classLevelFor(data, clsName)));
        const closeBtn = h('button', 'catalog-picker-close', '×');
        closeBtn.type = 'button';
        closeBtn.addEventListener('click', close);
        head.appendChild(closeBtn);
        card.appendChild(head);

        const bodyEl = h('div', 'class-sheet-body');
        const info = classInfoFor(data, clsName);
        bodyEl.appendChild(h('p', 'class-sheet-summary',
            `HD d${info.hd ?? '—'} · BAB ${info.bab} · Fort ${info.fort} / Ref ${info.ref} / Will ${info.will}`
            + ` · Skills ${info.skills ?? '—'} + Int per level`));

        bodyEl.appendChild(h('h4', 'item-sheet-h', 'Details (editable)'));
        const grid = h('div', 'class-sheet-grid');
        const row = (label, field, opts = {}) => {
            const wrap = h('label', 'item-sheet-stat');
            wrap.appendChild(h('span', 'item-sheet-stat-label', label));
            const cur = classInfoFor(data, clsName)[field];
            if (opts.select) {
                const sel = h('select', 'item-sheet-select');
                for (const o of opts.select) {
                    const opt = document.createElement('option');
                    opt.value = o;
                    opt.textContent = o;
                    if (o === cur) opt.selected = true;
                    sel.appendChild(opt);
                }
                sel.addEventListener('change', () => setClassInfo(data, clsName, field, sel.value));
                wrap.appendChild(sel);
            } else {
                const inp = h('input', opts.number ? 'item-sheet-num' : 'item-sheet-text');
                inp.type = opts.number ? 'number' : 'text';
                inp.value = cur == null || cur === '—' ? '' : String(cur);
                inp.placeholder = '—';
                inp.addEventListener('change', () => {
                    const v = opts.number
                        ? (inp.value === '' ? null : parseIntLoose(inp.value, 0))
                        : inp.value.trim();
                    setClassInfo(data, clsName, field, v);
                });
                wrap.appendChild(inp);
            }
            grid.appendChild(wrap);
        };
        row('Hit die (d)', 'hd', { number: true });
        // Rolled HP is character data (feeds the HP formula), not a class override
        {
            const wrap = h('label', 'item-sheet-stat');
            wrap.appendChild(h('span', 'item-sheet-stat-label', 'Rolled HP (dice total)'));
            const inp = h('input', 'item-sheet-num');
            inp.type = 'number';
            inp.value = data.total_rolled_hp != null ? String(data.total_rolled_hp) : '';
            inp.placeholder = '—';
            inp.addEventListener('change', () => {
                data.total_rolled_hp = inp.value === '' ? null : parseIntLoose(inp.value, 0);
                quietSave();
            });
            wrap.appendChild(inp);
            grid.appendChild(wrap);
        }
        row('Skills / level', 'skills', { number: true });
        row('Alignment restrictions', 'alignment');
        row('Fortitude', 'fort', { select: ['Good', 'Poor'] });
        row('Reflex', 'ref', { select: ['Good', 'Poor'] });
        row('Will', 'will', { select: ['Good', 'Poor'] });
        row('Spellcasting', 'casting');
        row('Maneuver progression', 'maneuvers');
        row('Favored class bonus', 'fcb');
        row('Weapon proficiencies', 'weaponProf');
        row('Armor proficiencies', 'armorProf');
        bodyEl.appendChild(grid);

        bodyEl.appendChild(h('h4', 'item-sheet-h', 'Class skills'));
        bodyEl.appendChild(h('p', 'dim class-skill-hint',
            'Checked = class skill — syncs the Skills tab CS toggle (+3 with at least 1 rank).'));
        const skGrid = h('div', 'class-skill-grid');
        for (const skill of ALL_SKILLS) {
            const lab = h('label', 'class-skill-check');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!skillBonusEntry(data, skillAbilityKey(skill)).cs;
            cb.addEventListener('change', () => {
                setSkillBonus(data, skillAbilityKey(skill), 'cs', cb.checked);
            });
            lab.append(cb, h('span', null, skill.name));
            skGrid.appendChild(lab);
        }
        bodyEl.appendChild(skGrid);

        card.appendChild(bodyEl);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
    }
    /** Archetype popup — scraped description (if any) for the named archetype, base level 0. */
    function openArchetypeSheet(data, name) {
        let obj = data?.archetype_info;
        if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { obj = null; } }
        const archName = name
            || (obj && typeof obj === 'object' ? Object.keys(obj)[0] : null);
        if (!archName) return;
        const info = { name: archName, raw: (obj && typeof obj === 'object') ? obj[archName] : null };
        document.getElementById('class-sheet-modal')?.remove();
        const overlay = h('div', 'catalog-picker item-sheet-overlay no-print');
        overlay.id = 'class-sheet-modal';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
        };
        const close = () => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
        };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
        const card = h('div', 'item-sheet-card class-sheet-card');
        const head = h('div', 'item-sheet-head');
        head.appendChild(h('h3', 'class-sheet-title', info.name));
        const closeBtn = h('button', 'catalog-picker-close', '×');
        closeBtn.type = 'button';
        closeBtn.addEventListener('click', close);
        head.appendChild(closeBtn);
        card.appendChild(head);
        const bodyEl = h('div', 'class-sheet-body');
        bodyEl.appendChild(h('p', 'dim', 'Archetype — base level 0.'));
        bodyEl.appendChild(htmlBlock('desc', archetypeDescHtml(info.raw)));
        card.appendChild(bodyEl);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
    }

    return {
        openItemSheet, openClassSheet, openArchetypeSheet, openCatalogPicker, openBuffEditor,
        openPortraitLightbox, openPowModifierEditor, openFeatureBuffMenu, buildItemBuffsPanel,
        sectionCatalogToolbar, prettyTypeWord, formatChangeLine, parseEnhancements,
        enhancementDescHtml, enhancementEffectHtml, addBlankInventoryItem, processPortraitFile,
    };
})();
