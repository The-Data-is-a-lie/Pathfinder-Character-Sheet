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

    return { openFeatureSheet, blankName, groupTargets };
})();
