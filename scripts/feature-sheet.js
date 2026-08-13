// scripts/feature-sheet.js — the unified Foundry-style feature sheet (#107): one modal
// (Description / Details / Changes tabs) for every name-keyed kind — feats, traits,
// class features now; spells, maneuvers, stances, talents and buffs adopt it in #108/#109.
// Clones the inventory item sheet's skeleton (modals.js openItemSheet) and rides the same
// CSS. Description/tags edits land in the per-character override layer
// (SheetDetails.featureOverrides); renames run the rename engine so every name-keyed
// store follows; the Changes tab embeds the shared feature-changes editor.
window.SheetFeatureSheet = (function () {
    'use strict';
    const { h } = window.SheetUI;
    const { quietSave } = window.SheetState;
    const { FEAT_GROUPS } = window.SheetData;
    // Late-bound (read at call time), same pattern as modals.js.
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);
    const renderUsesControls = (...a) => window.SheetApp.renderUsesControls(...a);

    const KIND_LABELS = {
        feat: 'Feat', trait: 'Trait', classFeat: 'Class Feature', spell: 'Spell',
        maneuver: 'Maneuver', stance: 'Stance', talent: 'Talent', buff: 'Buff',
    };

    function pluralizeGroupTitle(title) {
        if (title.endsWith('Feat')) return title + 's';
        if (title.endsWith('s')) return title;
        return title + ' Feats';
    }

    /** Every list a Features-tab entry can be regrouped into. */
    function groupTargets() {
        const t = [];
        const seen = new Set();
        for (const g of FEAT_GROUPS) {
            if (seen.has(g.listKey)) continue;
            seen.add(g.listKey);
            t.push({ id: 'feat:' + g.listKey, kind: 'feat', listKey: g.listKey,
                label: pluralizeGroupTitle(g.title) });
        }
        t.push({ id: 'trait:selected_traits', kind: 'trait', listKey: 'selected_traits', label: 'Traits' });
        t.push({ id: 'trait:background_traits', kind: 'trait', listKey: 'background_traits', label: 'Background Traits' });
        t.push({ id: 'trait:sphere_traits', kind: 'trait', listKey: 'sphere_traits', label: 'Sphere Traits' });
        t.push({ id: 'trait:flaw', kind: 'trait', listKey: 'flaw', label: 'Flaws' });
        t.push({ id: 'classFeat', kind: 'classFeat', label: 'Class Features' });
        return t;
    }

    function currentGroupId(ref) {
        return ref.kind === 'classFeat' ? 'classFeat' : ref.kind + ':' + ref.listKey;
    }

    /** Index of `name` in class_ability, matching on the "name_class" base. */
    function classAbilityIndex(data, name) {
        const lc = String(name).toLowerCase().trim();
        return (data.class_ability || []).findIndex((raw) => {
            const s = String(raw);
            const cut = s.lastIndexOf('_');
            const base = cut > 0 ? s.slice(0, cut) : s;
            return base.toLowerCase().trim() === lc;
        });
    }

    /**
     * Move an entry between backing lists (feat group ↔ trait group ↔ class features).
     * Feat numbering is positional, so leaving a list renumbers it for free. A kind
     * change re-tags the override, the custom-changes entry, and the disabled-source
     * sets so nothing detaches.
     */
    function moveToGroup(data, ref, target) {
        const SD = window.SheetDetails;
        const name = ref.name;
        // Remove from the current home.
        if (ref.kind === 'classFeat') {
            const idx = classAbilityIndex(data, name);
            if (idx < 0) return false; // profession abilities and choice pools don't move
            data.class_ability.splice(idx, 1);
        } else {
            const arr = data[ref.listKey];
            const idx = (arr || []).findIndex(
                (x) => String(x).toLowerCase() === String(name).toLowerCase());
            if (idx < 0) return false;
            arr.splice(idx, 1);
        }
        // Land in the new one.
        if (target.kind === 'classFeat') {
            const cls = String(data.c_class || 'class').toLowerCase().replace(/\s+/g, '');
            (data.class_ability ??= []).push(name + '_' + cls);
        } else {
            (data[target.listKey] ??= []).push(name);
        }
        if (target.kind !== ref.kind) {
            // Override entry: its key embeds the kind.
            const ov = SD.getFeatureOverride(data, ref.kind, name);
            if (ov) {
                SD.clearFeatureOverride(data, ref.kind, name);
                const { kind: _k, name: _n, ...rest } = ov;
                SD.setFeatureOverride(data, target.kind, name, rest);
            }
            // Custom typed modifiers: sourceKind rides the entry.
            const fc = data._sheet?.featureChanges?.[name];
            if (fc) fc.sourceKind = target.kind;
            // Disabled/removed passive-source sets: "<kind>::<name>".
            for (const k of ['disabledBuffSources', 'removedBuffSources']) {
                const arr = data._sheet?.[k];
                if (!Array.isArray(arr)) continue;
                arr.forEach((entry, i) => {
                    if (entry === ref.kind + '::' + name) arr[i] = target.kind + '::' + name;
                });
            }
        }
        quietSave();
        return true;
    }

    // ---- Feature bundles (#110): one entry as a portable JSON snippet -----------------
    // Everything a feat/buff/spell/maneuver/talent carries on this character — override,
    // custom changes, uses config, PoW overrides, the object itself — so it can be copied
    // to another library character or shared as homebrew.
    const clone = (x) => JSON.parse(JSON.stringify(x));

    function buildFeatureBundle(data, ref) {
        const SD = window.SheetDetails;
        const st = data._sheet || {};
        const bundle = { version: 1, kind: ref.kind, name: ref.name };
        if (ref.listKey) bundle.listKey = ref.listKey;
        if (ref.level != null) bundle.level = ref.level;
        const ov = SD.getFeatureOverride(data, ref.kind, ref.name);
        if (ov) bundle.override = clone(ov);
        if (st.featureChanges?.[ref.name]) bundle.featureChanges = clone(st.featureChanges[ref.name]);
        if (st.featureUses?.[ref.name]) {
            bundle.featureUses = clone(st.featureUses[ref.name]);
            // Charge links point at pools the target character may not have.
            delete bundle.featureUses.chargeSource;
        }
        if (ref.kind === 'maneuver' || ref.kind === 'stance') {
            const powKey = SD.powNorm(ref.name);
            if (ref.kind === 'maneuver' && st.powOverrides?.[powKey]) {
                bundle.powOverride = clone(st.powOverrides[powKey]);
            }
            if (ref.kind === 'stance' && st.stanceOverrides?.[powKey]) {
                bundle.stanceOverride = clone(st.stanceOverrides[powKey]);
            }
            const d = data.maneuvers_desc_dict?.[ref.name];
            if (d != null) bundle.descDictEntry = clone(d);
        }
        if (ref.obj) {
            bundle.object = clone(ref.obj);
            if (ref.kind === 'talent') {
                bundle.arrayKey = (data.combat_talent_items || []).includes(ref.obj)
                    ? 'combat_talent_items' : 'magic_talent_items';
            }
        }
        return bundle;
    }

    /** Land a bundle on a character. Dedup by name; existing entries only gain the extras. */
    function applyFeatureBundle(data, bundle) {
        const SD = window.SheetDetails;
        const SS = window.SheetState;
        if (!bundle || bundle.version !== 1 || !bundle.kind || !bundle.name) {
            return { ok: false, reason: 'not a feature bundle' };
        }
        const kind = bundle.kind;
        const name = String(bundle.name);
        const lc = name.toLowerCase();
        const hasName = (arr) => (arr || []).some(
            (x) => String(x?.name ?? x).toLowerCase() === lc);
        if (kind === 'buff') {
            const buffs = SS.ensureBuffs(data);
            if (!hasName(buffs)) {
                const obj = bundle.object || { name };
                delete obj.id; // fresh id on the target
                buffs.push(obj);
                SS.ensureBuffs(data); // normalize the pushed entry
            }
        } else if (kind === 'talent') {
            const arrKey = bundle.arrayKey === 'combat_talent_items'
                ? 'combat_talent_items' : 'magic_talent_items';
            if (!hasName(data.magic_talent_items) && !hasName(data.combat_talent_items)) {
                (data[arrKey] ??= []).push(bundle.object || { name, sphere: 'Other' });
            }
        } else if (kind === 'maneuver') {
            if (bundle.descDictEntry != null) {
                (data.maneuvers_desc_dict ??= {})[name] ??= bundle.descDictEntry;
            }
            const all = (data.maneuvers_choose_from || []).flat();
            if (!hasName(all)) {
                if (!Array.isArray(data.maneuvers_choose_from)) data.maneuvers_choose_from = [];
                if (!Array.isArray(data.maneuvers_choose_from[0])) data.maneuvers_choose_from[0] = [];
                data.maneuvers_choose_from[0].push(name);
            }
            if (bundle.powOverride) SD.setPowOverride(data, name, bundle.powOverride);
        } else if (kind === 'stance') {
            if (bundle.descDictEntry != null) {
                (data.maneuvers_desc_dict ??= {})[name] ??= bundle.descDictEntry;
            }
            if (!hasName(data.stances_chosen)) (data.stances_chosen ??= []).push(name);
            if (bundle.stanceOverride) SD.setStanceOverride(data, name, bundle.stanceOverride);
        } else if (kind === 'spell') {
            const lv = Math.max(0, Math.min(9, Number(bundle.level) || 0));
            if (!Array.isArray(data.spell_list_choose_from)) data.spell_list_choose_from = [];
            while (data.spell_list_choose_from.length <= lv) data.spell_list_choose_from.push([]);
            if (!(data.spell_list_choose_from || []).flat().some(
                (n) => String(n).toLowerCase() === lc)) {
                data.spell_list_choose_from[lv].push(name);
            }
        } else if (kind === 'classFeat') {
            const idx = classAbilityIndex(data, name);
            if (idx < 0) {
                const cls = String(data.c_class || 'class').toLowerCase().replace(/\s+/g, '');
                (data.class_ability ??= []).push(name + '_' + cls);
            }
        } else { // feat / trait
            const listKey = bundle.listKey
                || (kind === 'trait' ? 'selected_traits' : 'feats');
            if (!hasName(data[listKey])) (data[listKey] ??= []).push(name);
        }
        if (bundle.override) {
            const { kind: _k, name: _n, ...rest } = bundle.override;
            SD.setFeatureOverride(data, kind, name, rest);
        }
        const st = (data._sheet ??= {});
        if (bundle.featureChanges) (st.featureChanges ??= {})[name] = clone(bundle.featureChanges);
        if (bundle.featureUses) (st.featureUses ??= {})[name] = clone(bundle.featureUses);
        return { ok: true };
    }

    /** Paste-a-bundle dialog, reachable from the catalog toolbars. */
    function openBundleImport(data) {
        const body = h('div', 'bundle-import');
        body.appendChild(h('p', 'dim',
            'Paste a feature JSON exported from a feature sheet (feat, buff, spell, '
            + 'maneuver, stance, or talent).'));
        const ta = h('textarea', 'edit-field');
        ta.rows = 8;
        ta.placeholder = '{ "version": 1, "kind": "feat", "name": "…", … }';
        body.appendChild(ta);
        const apply = h('button', 'inv-btn inv-btn-primary', 'Import');
        apply.type = 'button';
        const handle = window.SheetOverlay.open({ title: 'Import feature JSON', body, footer: [apply] });
        apply.addEventListener('click', () => {
            let bundle = null;
            try { bundle = JSON.parse(ta.value); } catch { /* fall through */ }
            const r = applyFeatureBundle(data, bundle);
            if (!r.ok) {
                window.SheetOverlay?.toast?.('Import failed: ' + (r.reason || 'invalid JSON'));
                return;
            }
            quietSave();
            handle.close();
            renderSheet(data);
            window.SheetOverlay?.toast?.(`Imported “${bundle.name}”.`);
        });
    }

    /** Library picker for "Copy to…" — our answer to Foundry's cross-actor drag. */
    async function openCopyToCharacter(data, ref) {
        const lib = window.SheetLibrary;
        const records = await lib.list().catch(() => []);
        const selfId = data._sheet?.id;
        const others = records.filter((r) => r.id !== selfId);
        if (!others.length) {
            window.SheetOverlay?.toast?.('No other characters in the library yet.');
            return;
        }
        const body = h('div', 'copy-to-list');
        const handle = window.SheetOverlay.open({
            title: `Copy “${ref.name}” to…`, body,
        });
        for (const r of others) {
            const btn = h('button', 'inv-btn copy-to-row',
                `${r.name}${r.klass ? ' — ' + r.klass : ''}${r.level !== '' ? ' ' + r.level : ''}`);
            btn.type = 'button';
            btn.addEventListener('click', async () => {
                const rec = await lib.get(r.id);
                if (!rec?.data) {
                    window.SheetOverlay?.toast?.('Could not load that character.');
                    return;
                }
                const res = applyFeatureBundle(rec.data, buildFeatureBundle(data, ref));
                if (!res.ok) {
                    window.SheetOverlay?.toast?.('Copy failed: ' + res.reason);
                    return;
                }
                await lib.save(rec.data);
                handle.close();
                window.SheetOverlay?.toast?.(`Copied “${ref.name}” to ${r.name}.`);
            });
            body.appendChild(btn);
        }
    }

    let sheetHandle = null;

    /**
     * Open the feature sheet.
     * ref: { kind, name, listKey?, sourceKind?, fallbackDesc?, typeLabel?, classes?,
     *        showUses?, canRegroup?, canRename?, obj?, panels? }
     * Object-backed kinds (buffs, talents) pass `obj` — description edits land on the
     * object itself, not the override layer — plus prebuilt Details/Changes `panels`.
     */
    function openFeatureSheet(data, ref) {
        sheetHandle?.close(); // replace-on-reopen, same as the item sheet
        const SD = window.SheetDetails;
        const SM = window.SheetModals;
        const kind = ref.kind;
        const obj = ref.obj || null;
        const resolved = SD.resolveFeature(data, kind, ref.name,
            { classes: ref.classes, fallbackDesc: ref.fallbackDesc });

        let handle = null;
        const close = () => handle?.close();

        const card = h('div', 'item-sheet-card feature-sheet-card');

        // ---- header: editable name (runs the rename engine), close ----
        const head = h('div', 'item-sheet-head');
        const titles = h('div', 'item-sheet-titles');
        const nameIn = h('input', 'item-sheet-name');
        nameIn.type = 'text';
        nameIn.value = ref.name;
        nameIn.placeholder = KIND_LABELS[kind] + ' name';
        if (ref.canRename === false) nameIn.disabled = true;
        nameIn.addEventListener('change', () => {
            const next = nameIn.value.trim();
            if (!next || next === ref.name) { nameIn.value = ref.name; return; }
            const r = SD.renameFeature(data, kind, ref.name, next);
            if (!r.ok) {
                window.SheetOverlay?.toast?.(r.reason === 'duplicate'
                    ? `“${next}” already exists — rename cancelled.`
                    : 'Rename failed.');
                nameIn.value = ref.name;
                return;
            }
            quietSave();
            renderSheet(data);
            openFeatureSheet(data, { ...ref, name: next });
        });
        titles.appendChild(nameIn);
        head.appendChild(titles);
        const closeBtn = h('button', 'catalog-picker-close', '×');
        closeBtn.type = 'button';
        closeBtn.title = 'Close';
        closeBtn.addEventListener('click', close);
        head.appendChild(closeBtn);
        card.appendChild(head);

        const grid = h('div', 'item-sheet-grid');

        // ---- sidebar ----
        const side = h('div', 'item-sheet-side');
        side.appendChild(h('h4', 'item-sheet-type', ref.typeLabel || KIND_LABELS[kind] || 'Feature'));

        const badge = h('p', 'item-sheet-subtype fs-edited-badge', '✎ edited');
        badge.title = 'This entry has per-character edits layered over the compendium text';
        const revertBtn = h('button', 'inv-btn fs-revert-btn no-print', 'Revert to original');
        revertBtn.type = 'button';
        revertBtn.title = 'Drop every edit on this entry and go back to the compendium/backend text';
        const syncEdited = () => {
            const on = SD.isFeatureEdited(data, kind, ref.name) || !!ref.extraEdited?.();
            badge.style.display = on ? '' : 'none';
            revertBtn.style.display = on ? '' : 'none';
        };
        revertBtn.addEventListener('click', () => {
            SD.clearFeatureOverride(data, kind, ref.name);
            ref.onRevert?.(); // kind-specific stores (powOverrides, stanceOverrides, …)
            quietSave();
            const base = SD.resolveFeature(data, kind, ref.name,
                { classes: ref.classes, fallbackDesc: ref.fallbackDesc });
            descEditor?.setHtml(base.description || '');
            tagsIn.value = (base.tags || []).join(', ');
            syncEdited();
            window.SheetOverlay?.toast?.('Reverted to the original text.');
        });
        side.append(badge, revertBtn);

        // Active checkbox for object-backed buffs (mirrors the Buffs-tab column).
        if (kind === 'buff' && obj) {
            const row = h('label', 'item-sheet-stat');
            row.appendChild(h('span', 'item-sheet-stat-label', 'Active'));
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = obj.active !== false;
            cb.addEventListener('change', () => {
                obj.active = cb.checked;
                quietSave();
                window.SheetState.refreshDerived?.();
            });
            row.appendChild(cb);
            side.appendChild(row);
        }

        // Uses tracker — same control the Features tab renders.
        if (ref.showUses !== false && (kind === 'feat' || kind === 'classFeat')) {
            const usesRow = h('div', 'item-sheet-stat');
            usesRow.appendChild(h('span', 'item-sheet-stat-label', 'Uses'));
            usesRow.appendChild(renderUsesControls(data, ref.name));
            side.appendChild(usesRow);
        }

        // Group select — moving between lists is Details-tab freedom in Foundry terms.
        if (ref.canRegroup !== false && (kind === 'feat' || kind === 'trait' || kind === 'classFeat')) {
            const row = h('label', 'item-sheet-stat');
            row.appendChild(h('span', 'item-sheet-stat-label', 'Group'));
            const sel = h('select', 'item-sheet-select');
            const targets = groupTargets();
            const curId = currentGroupId(ref);
            for (const t of targets) {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.label;
                if (t.id === curId) opt.selected = true;
                sel.appendChild(opt);
            }
            sel.addEventListener('change', () => {
                const target = targets.find((t) => t.id === sel.value);
                if (!target || target.id === curId) return;
                if (!moveToGroup(data, ref, target)) {
                    window.SheetOverlay?.toast?.('This entry can’t be moved.');
                    sel.value = curId;
                    return;
                }
                renderSheet(data);
                setActiveTab('features');
                openFeatureSheet(data, {
                    ...ref,
                    kind: target.kind,
                    listKey: target.listKey,
                    sourceKind: target.kind,
                });
            });
            row.appendChild(sel);
            side.appendChild(row);
        }

        // Copy / share (#110) — the entry plus its overrides, changes and uses config.
        const copyBtn = h('button', 'inv-btn fs-share-btn no-print', 'Copy to…');
        copyBtn.type = 'button';
        copyBtn.title = 'Copy this entry (with your edits) to another library character';
        copyBtn.addEventListener('click', () => openCopyToCharacter(data, ref));
        const exportBtn = h('button', 'inv-btn fs-share-btn no-print', 'Export JSON');
        exportBtn.type = 'button';
        exportBtn.title = 'Copy this entry as a JSON snippet for sharing (Import JSON pastes it)';
        exportBtn.addEventListener('click', async () => {
            const json = JSON.stringify(buildFeatureBundle(data, ref), null, 2);
            try {
                await navigator.clipboard.writeText(json);
                window.SheetOverlay?.toast?.('Feature JSON copied to the clipboard.');
            } catch {
                window.prompt('Copy the feature JSON:', json);
            }
        });
        side.append(copyBtn, exportBtn);
        grid.appendChild(side);

        // ---- tabs ----
        const content = h('div', 'item-sheet-content');
        const tabBar = h('div', 'item-sheet-tabs');
        const panes = {};
        for (const [id, label] of [['description', 'Description'], ['details', 'Details'], ['changes', 'Changes']]) {
            const btn = h('button', 'item-sheet-tab' + (id === 'description' ? ' is-active' : ''), label);
            btn.type = 'button';
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

        // Description — the shared rich editor. Override-layer kinds clear the override
        // when the edit matches the base text; object-backed kinds write the object.
        const descPane = h('div', 'item-sheet-pane');
        const baseDesc = () => {
            const base = SD.resolveFeature(data, kind, ref.name,
                { classes: ref.classes, fallbackDesc: ref.fallbackDesc });
            return base.base?.description ?? ref.fallbackDesc ?? '';
        };
        let descEditor = null;
        descEditor = window.SheetRichText.richTextEditor({
            html: (obj ? obj.description : resolved.description) || '',
            placeholder: 'Description…',
            onCommit: (html) => {
                if (obj) {
                    obj.description = html;
                } else {
                    const same = html === baseDesc() || (!html && !baseDesc());
                    SD.setFeatureOverride(data, kind, ref.name,
                        { description: same ? null : html });
                }
                quietSave();
                syncEdited();
            },
        });
        descPane.appendChild(descEditor.el);
        panes.description = descPane;

        // Details — a prebuilt kind panel when given (buffs, later spells/PoW), else
        // the generic tags editor.
        const detPane = h('div', 'item-sheet-pane hidden');
        const tagsIn = h('input', 'item-sheet-text'); // referenced by revert even when unused
        if (ref.panels?.details) {
            detPane.appendChild(ref.panels.details);
        } else {
            detPane.appendChild(h('h4', 'item-sheet-h', 'Identity'));
            const tagsRow = h('label', 'item-sheet-stat');
            tagsRow.appendChild(h('span', 'item-sheet-stat-label', 'Tags'));
            tagsIn.type = 'text';
            tagsIn.placeholder = 'Combat, Teamwork, …';
            tagsIn.value = (resolved.tags || []).join(', ');
            tagsIn.addEventListener('change', () => {
                const tags = tagsIn.value.split(',').map((s) => s.trim()).filter(Boolean);
                const baseTags = (resolved.base?.tags || []).join('|');
                SD.setFeatureOverride(data, kind, ref.name,
                    { tags: tags.join('|') === baseTags ? null : tags });
                quietSave();
                syncEdited();
            });
            tagsRow.appendChild(tagsIn);
            detPane.appendChild(tagsRow);
        }
        if (ref.detailRows) for (const row of ref.detailRows) detPane.appendChild(row);
        panes.details = detPane;

        // Changes — a prebuilt panel (buff changes) or the shared feature-changes editor.
        const chgPane = h('div', 'item-sheet-pane hidden');
        chgPane.appendChild(ref.panels?.changes
            || SM.buildFeatureChangesPanel(data, ref.name, ref.sourceKind || kind));
        panes.changes = chgPane;

        for (const pane of Object.values(panes)) content.appendChild(pane);
        grid.appendChild(content);
        card.appendChild(grid);

        syncEdited();
        handle = SM.openFrameless(card, {
            label: KIND_LABELS[kind] + ' sheet — ' + ref.name,
            onClose: () => {
                if (sheetHandle === handle) sheetHandle = null;
                renderSheet(data);
            },
        });
        sheetHandle = handle;
    }

    /** Unique "New Feat"-style name against a membership list. */
    function blankName(base, existing) {
        const lc = new Set((existing || []).map((x) => String(x).toLowerCase()));
        if (!lc.has(base.toLowerCase())) return base;
        for (let i = 2; i < 100; i++) {
            if (!lc.has((base + ' ' + i).toLowerCase())) return base + ' ' + i;
        }
        return base + ' ' + Date.now();
    }

    return {
        openFeatureSheet, blankName, groupTargets,
        buildFeatureBundle, applyFeatureBundle, openBundleImport, openCopyToCharacter,
    };
})();
