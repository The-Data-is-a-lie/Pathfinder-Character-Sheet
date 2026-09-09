// scripts/tabs/features.js -- the Features tab: feats / traits / class features lists, toolbar,
// feat-count footer (window.SheetTabFeatures). Extracted from sheet.js (Part B split); bodies
// verbatim. refreshFeatureLedger / featureBuffGroup are consumed by modals.js (openFeatureBuffMenu)
// via SheetApp -- the shell destructures them back and the delegates re-point here. Loads after
// summary.js (uses archetypeDescHtml).
window.SheetTabFeatures = (function () {
    'use strict';
    const {
        h, foundry, nonEmpty, details, titleCase, section, escapeHtml, kv,
        bindDragList, reorderArray, dndHandle,
    } = window.SheetUI;
    const toast = (text, opts) => window.SheetOverlay?.toast(text, opts);
    const { totalLevel } = window.SheetDerive;
    const { quietSave, isBuffSourceActive, ensureClassList } = window.SheetState;
    const { sectionCatalogToolbar, formatChangeLine, openFeatureBuffMenu } = window.SheetModals;
    const { archetypeDescHtml } = window.SheetClassInfo;
    const { FEAT_GROUPS } = window.SheetData;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);
    const renderUsesControls = (...a) => window.SheetApp.renderUsesControls(...a);
    const { refreshFeatureLedger, featureBuffGroup } = window.SheetFeatureLedger;

    // Tags that read like Foundry "type" chips (skip edition/race noise).
    const FEAT_TAG_SHOW = new Set([
        'Combat', 'Teamwork', 'Metamagic', 'Story', 'Style', 'Critical', 'General',
        'Monster', 'Item Mastery', 'Channeling', 'Panache', 'Meditation', 'Mythic',
        'Combination', 'Betrayal', 'Trick', 'Conduit', 'Targeting', 'Blood Hex',
        'Racial', 'Faction', 'Alignment',
    ]);
    function featDisplayName(name) {
        const entry = foundry('feats', name);
        return entry?.name || name;
    }
    function featTags(data, name) {
        // Per-character tag edits (#107) win over the compendium's tag list.
        const ov = window.SheetDetails?.getFeatureOverride?.(data, 'feat', name);
        if (Array.isArray(ov?.tags)) return ov.tags;
        const tags = foundry('feats', name)?.tags || [];
        return tags.filter((t) => FEAT_TAG_SHOW.has(t));
    }
    /** Resolve tax-chain children for a feat (backend *_feat_tax_dict). */
    function featTaxChain(name, taxDict) {
        if (!taxDict || !name) return [];
        const raw = taxDict[name] ?? taxDict[String(name).toLowerCase()];
        if (!Array.isArray(raw) || !raw.length) return [];
        return raw.map((c) => String(c)).filter(Boolean);
    }
    /**
     * Feat row title — matches the generator mod's addingReceivedLocationToName():
     * per-feat backend label ("Fighter 1: Weapon Focus") when present, else
     * "(Prefix N) Name" with N from the group's start/step/customLevels. The feat-tax
     * chain rides along as " > Child" like the mod's applyFeatTax(). Numbering is
     * positional, so drag-reorder renumbers the acquisition slots live.
     */
    function foundryFeatTitle(name, index, group) {
        const disp = featDisplayName(name);
        const tax = group.taxChain || [];
        const taxSuffix = tax.length
            ? ' > ' + tax.map((t) => featDisplayName(t)).join(' > ')
            : '';
        const labels = group.labels || null;
        if (labels?.[index] != null && String(labels[index]).trim()) {
            const lab = String(labels[index]).trim().replace(/^\(|\)$/g, '');
            // Avoid "Power Attack: Power Attack" when the backend label embeds the name
            if (lab.toLowerCase().includes(String(name).toLowerCase().split(' (')[0])) {
                return lab + taxSuffix;
            }
            return lab + ': ' + disp + taxSuffix;
        }
        const level = group.customLevels?.[index] ?? ((group.start ?? 1) + index * (group.step ?? 1));
        return `(${group.prefix} ${level}) ${disp}${taxSuffix}`;
    }
    /** Primary description + Foundry-style tax children under <hr><strong>Name</strong>. */
    function featDescriptionHtml(data, name, descSource, taxChain) {
        const ov = window.SheetDetails?.getFeatureOverride?.(data, 'feat', name);
        const primary = ov?.description
            ?? (foundry('feats', name)?.description
                || descSource?.[name]
                || descSource?.[String(name).toLowerCase()]
                || '');
        const parts = [];
        if (primary) parts.push(primary);
        for (const child of taxChain || []) {
            const childName = featDisplayName(child);
            const childDesc = foundry('feats', child)?.description
                || descSource?.[child]
                || descSource?.[String(child).toLowerCase()]
                || '';
            parts.push(
                `<hr class="feat-tax-sep"><p class="feat-tax-name"><strong>${escapeHtml(childName)}</strong>`
                + ` <span class="feat-tax-badge">feat tax</span></p>`
                + (childDesc || '<p class="dim">No description on file.</p>'),
            );
        }
        return parts.join('');
    }
    /**
     * Foundry-style feature row (pf1 actor-features.hbs item rows):
     * name (expandable) | type chips | uses | post-to-chat | remove ×.
     * Cells are direct grid children so header and item rows share column tracks.
     */
    function featureRow(opts) {
        const li = h('li', 'feat-item dnd-item feat-grid' + (opts.extraClass ? ' ' + opts.extraClass : ''));
        li.dataset.featName = String(opts.name).toLowerCase();
        li.dataset.dndId = String(opts.name);

        const SD = window.SheetDetails;
        const buffGroup = opts.data ? featureBuffGroup(opts.name) : null;
        const sourceKind = opts.sourceKind || 'feat';

        const nameCell = h('div', 'feat-cell feat-cell-name');
        nameCell.appendChild(dndHandle());
        nameCell.appendChild(opts.descHtml
            ? details(opts.title, opts.descHtml, 'feat-details')
            : h('span', 'feat-title', opts.title));
        // Per-character edits marker (#107) — the feature sheet's Revert clears it.
        if (opts.sheetRef
            && window.SheetDetails?.isFeatureEdited?.(opts.data, opts.sheetRef.kind, opts.name)) {
            const chip = h('span', 'feat-edited-chip', '✎');
            chip.title = 'Edited on this character — open the sheet to revert';
            nameCell.appendChild(chip);
        }
        // ✦ marker when this feature carries built-in modifiers (dimmed if toggled off).
        if (buffGroup) {
            const active = isBuffSourceActive(opts.data, buffGroup.source, buffGroup.sourceKind);
            const mark = h('span', 'feat-buff-mark' + (active ? '' : ' buff-off'), '✦');
            const bits = buffGroup.lines.map((c) => formatChangeLine(c, SD)).join('; ');
            mark.title = (active ? 'Built-in buffs (active): ' : 'Built-in buffs (inactive): ')
                + bits;
            nameCell.appendChild(mark);
        }
        // #79: ⚠ when the audit could not satisfy this feat's own stated prerequisites. Best
        // effort by construction (it reads prose), so it flags and explains — never blocks.
        if (opts.data) {
            const healthMark = window.SheetHealthUI?.rowBadge?.(opts.data, 'feat',
                String(opts.name).replace(/^\([^)]*\)\s*/, '').trim());
            if (healthMark) nameCell.appendChild(healthMark);
        }
        li.appendChild(nameCell);

        const typeCell = h('div', 'feat-cell feat-cell-type');
        if (opts.typeLabel) typeCell.appendChild(h('span', 'feat-type', opts.typeLabel));
        for (const t of opts.tags || []) typeCell.appendChild(h('span', 'feat-tag', t));
        li.appendChild(typeCell);

        const usesCell = h('div', 'feat-cell feat-cell-uses');
        if (opts.data && opts.showUses !== false) {
            usesCell.appendChild(renderUsesControls(opts.data, opts.name));
        }
        li.appendChild(usesCell);

        const chatCell = h('div', 'feat-cell feat-cell-chat no-print');
        // ⚙ buff settings — on every feature (add custom buffs, toggle built-in ones).
        if (opts.data) {
            const gear = h('button', 'inv-btn feat-buff-btn', '⚙');
            gear.type = 'button';
            gear.title = 'Buff settings — add your own modifiers or toggle built-in ones';
            gear.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openFeatureBuffMenu(gear, opts.data, opts.name, sourceKind);
            });
            chatCell.appendChild(gear);
        }
        const chat = h('button', 'inv-btn feat-chat-btn', '🎲');
        chat.type = 'button';
        chat.title = 'Post to the roll log';
        chat.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.SheetRoll?.setOpen?.(true);
            // #101: a real card (name, type, description, uses + Use) — not a d1 roll.
            window.SheetRoll?.postFeatureCard?.({
                title: opts.title,
                name: opts.name,
                kind: opts.chatKind || 'Feature',
                typeLabel: opts.typeLabel,
                descHtml: opts.descHtml || '',
            });
        });
        chatCell.appendChild(chat);
        li.appendChild(chatCell);

        const ctrlCell = h('div', 'feat-cell feat-cell-controls no-print');
        // ✎ opens the full feature sheet (#107) — description, details, changes, rename.
        if (opts.sheetRef && opts.data) {
            const edit = h('button', 'inv-btn feat-edit-btn', '✎');
            edit.type = 'button';
            edit.title = 'Open the feature sheet — edit description, rename, move, revert';
            edit.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.SheetFeatureSheet?.openFeatureSheet?.(opts.data, {
                    name: opts.name,
                    typeLabel: opts.typeLabel,
                    ...opts.sheetRef,
                });
            });
            ctrlCell.appendChild(edit);
        }
        if (opts.onRemove) {
            const rm = h('button', 'inv-btn inv-btn-danger feat-remove', '×');
            rm.type = 'button';
            rm.title = 'Remove from character';
            rm.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!confirm(`Remove “${opts.name}”?`)) return;
                opts.onRemove(opts.name);
            });
            ctrlCell.appendChild(rm);
        }
        li.appendChild(ctrlCell);
        return li;
    }
    /** Column header row (pf1 item-list-header). Not a .feat-item, so dnd skips it. */
    function featureListHeader() {
        const li = h('li', 'feat-list-header feat-grid no-print');
        li.append(
            h('span', 'feat-cell feat-cell-name', 'Name'),
            h('span', 'feat-cell feat-cell-type', 'Type'),
            h('span', 'feat-cell feat-cell-uses', 'Uses'),
            h('span', 'feat-cell feat-cell-chat', ''),
            h('span', 'feat-cell feat-cell-controls', ''),
        );
        return li;
    }
    function featureGroupSlug(ns, label) {
        return ns + '-' + String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    /**
     * Wrapper div a filter pill can hide; carries the group's divider heading.
     *
     * `opts.cadence` is the level-rhythm suffix ("(1, 3, 5, 7, …)"); `opts.empty` marks a group
     * with no members. Empty groups still render, because they are the drop targets that let a
     * drag re-file a row into a category the character has nothing in yet. CSS hides them at
     * rest and reveals them as drop strips for the duration of a drag.
     *
     * `is-empty` is deliberately NOT the `hidden` class the filter pills use: applyFilters
     * REMOVES `hidden` from every [data-fgroup] when no pill is active, which would reveal every
     * empty group the moment a pill was cleared. Two classes, two independent rules.
     */
    function featureGroup(body, slug, headerTitle, opts) {
        const { cadence = '', empty = false } = opts || {};
        const wrap = h('div', 'feature-group' + (empty ? ' is-empty' : ''));
        wrap.dataset.fgroup = slug;
        if (headerTitle) {
            const head = h('h3', 'feature-group-head');
            head.appendChild(h('span', 'feature-group-name', headerTitle));
            if (cadence) head.appendChild(h('span', 'feature-group-cadence', cadence));
            wrap.appendChild(head);
        }
        body.appendChild(wrap);
        return wrap;
    }
    /** The four trait lists, in render order: heading, backing array, row type chip. */
    const TRAIT_GROUPS = [
        ['Traits', 'selected_traits', 'Trait'],
        ['Background', 'background_traits', 'Background'],
        ['Sphere Traits', 'sphere_traits', 'Sphere'],
        ['Flaws', 'flaw', 'Flaw'],
    ];

    /**
     * The levels a feat group fills at, as a header suffix — read off FEAT_GROUPS rather than
     * curated, so a new group entry gets one for free.
     *
     * Groups that fire at EVERY level (step 1: Flavor, Flaw, Trainer, Profession, Bloodline,
     * Sphere) get nothing — "(1, 2, 3, 4, …)" is noise, not information. customLevels are a
     * complete list within play range, so they print in full with no ellipsis; a start/step run
     * is open-ended and shows four terms then "…".
     */
    const CADENCE_TERMS = 4;
    const MAX_LEVEL = 20;
    function groupCadence(g) {
        if (Array.isArray(g.customLevels) && g.customLevels.length) {
            const inPlay = g.customLevels.filter((n) => Number(n) <= MAX_LEVEL);
            return inPlay.length ? '(' + inPlay.join(', ') + ')' : '';
        }
        const step = g.step ?? 1;
        if (step <= 1) return '';
        const start = g.start ?? 1;
        const terms = [];
        for (let i = 0; i < CADENCE_TERMS; i += 1) terms.push(start + i * step);
        return '(' + terms.join(', ') + ', …)';
    }

    /** Heading for a backing array, for the toast a cross-group drop fires. */
    function groupLabelFor(listKey) {
        const g = FEAT_GROUPS.find((x) => x.listKey === listKey);
        if (g) return pluralizeFeatSection(g.title);
        const t = TRAIT_GROUPS.find((x) => x[1] === listKey);
        return t ? t[0] : listKey;
    }

    /**
     * Cross-group drop: re-file the row into another list at the position it was dropped.
     *
     * The move itself goes through the feature sheet's own moveToGroup, which is what makes a
     * dialog-free drag defensible — it re-tags the per-character override, the custom-changes
     * sourceKind and the disabled/removed source keys, so nothing detaches from the row on the
     * way across. Re-implementing that here would be the bug.
     */
    function refileFeature(data, m, kind) {
        const name = m.row?.dataset.dndId;
        const from = m.fromSection;
        const to = m.toSection;
        if (!name || !from || !to) return;
        // Captured before the move, so Undo restores the position as well as the category.
        const backIndex = (data[from] || []).indexOf(name);
        const moved = window.SheetFeatureSheet?.moveToGroup?.(
            data, { kind, name, listKey: from }, { kind, listKey: to }, m.toIndex);
        if (!moved) {
            toast('This entry can’t be moved.');
            return;
        }
        quietSave();
        toast(`“${name}” moved to ${groupLabelFor(to)}`, {
            action: {
                onClick: () => {
                    window.SheetFeatureSheet?.moveToGroup?.(
                        data, { kind, name, listKey: to }, { kind, listKey: from }, backIndex);
                    quietSave();
                    renderSheet(data);
                    setActiveTab('features');
                    toast(`“${name}” back in ${groupLabelFor(from)}`);
                },
            },
        });
    }

    /**
     * Drag binding for one Features-tab group.
     *
     * `group` is what confines the gesture to a single card: every feat group shares one, every
     * trait group another, so a feat can never be dropped into Flaws-the-trait-list. Moving a
     * row across cards stays the ✎ dialog's job, where the target is picked deliberately from a
     * list rather than by a drag that has to travel past ~70 rows to get there.
     */
    function bindFeatureDrag(ul, data, group, listKey, kind) {
        bindDragList({
            container: ul,
            itemSelector: '.feat-item',
            group,
            sectionId: listKey,
            canAccept: () => true,
            onDrop: (m) => {
                if (m.fromSection === m.toSection) {
                    reorderArray(data[listKey], m.fromIndex, m.toIndex);
                    quietSave();
                } else {
                    refileFeature(data, m, kind);
                }
                renderSheet(data);
                setActiveTab('features');
            },
        });
    }

    function removeFromArrayField(data, key, name) {
        const arr = data[key];
        if (!Array.isArray(arr)) return false;
        const i = arr.findIndex((x) => String(x) === String(name));
        if (i < 0) return false;
        arr.splice(i, 1);
        quietSave();
        return true;
    }
    function addToArrayField(data, key, name) {
        if (!Array.isArray(data[key])) data[key] = [];
        if (data[key].some((x) => String(x).toLowerCase() === String(name).toLowerCase())) {
            return false;
        }
        data[key].push(name);
        quietSave();
        return true;
    }
    /**
     * Backing array for a list key. Not every backend field is an array — teamwork_feats
     * arrives as an integer on some payloads — and an empty group now RENDERS rather than being
     * filtered out upstream, so a bare `|| []` (which an integer slips straight past) is no
     * longer enough.
     */
    function arrField(data, key) {
        return Array.isArray(data[key]) ? data[key] : [];
    }

    /** Pill list for the features toolbar — mirrors the groups the renderers emit. */
    function featuresFilterEntries(data) {
        const entries = [];
        const push = (ns, label, count) => {
            if (!count) return;
            const slug = featureGroupSlug(ns, label);
            const found = entries.find((e) => e.slug === slug);
            if (found) found.count += count; // e.g. the two "Class Bonus Feat" groups merge
            else entries.push({ slug, label, count });
        };
        for (const g of FEAT_GROUPS) {
            push('feats', pluralizeFeatSection(g.title), arrField(data, g.listKey).length);
        }
        for (const [title, key] of TRAIT_GROUPS) push('traits', title, arrField(data, key).length);
        push('class', 'Class Features', arrField(data, 'class_ability').length);
        push('class', 'Profession Abilities', arrField(data, 'profession_ability_items').length);
        return entries;
    }
    /**
     * Tab-wide toolbar (pf1 actor-item-nav-filters.hbs): one search box over every
     * section plus filter pills per group. No active pill = show all; active pills
     * narrow to those groups. Hides via classes — never rebuilds the lists.
     */
    function renderFeaturesToolbar(data) {
        const entries = featuresFilterEntries(data);
        if (!entries.length) return null;
        const bar = h('div', 'features-toolbar no-print');
        const search = h('input', 'edit-field feature-search');
        search.type = 'search';
        search.placeholder = 'Search features…';
        const pillRow = h('div', 'feature-filter-pills');

        const applyFilters = () => {
            const pane = bar.parentElement;
            if (!pane) return;
            const q = search.value.toLowerCase().trim();
            const active = new Set([...pillRow.querySelectorAll('.filter-pill.is-active')]
                .map((p) => p.dataset.fgroup));
            // `.feature-group[data-fgroup]`, not a bare `[data-fgroup]`: the pill BUTTONS carry
            // the same attribute, so the bare selector hid every other pill the moment one went
            // active (a global `.hidden {display:none}` backs it) — leaving no way to select a
            // second group, and no way back except the one pill still on screen.
            pane.querySelectorAll('.feature-group[data-fgroup]').forEach((grp) => {
                grp.classList.toggle('hidden', active.size > 0 && !active.has(grp.dataset.fgroup));
            });
            pane.querySelectorAll('.feat-item').forEach((el) => {
                const t = (el.dataset.featName || '') + ' ' + el.textContent.toLowerCase();
                el.style.display = !q || t.includes(q) ? '' : 'none';
            });
        };

        search.addEventListener('input', applyFilters);
        for (const entry of entries) {
            const pill = h('button', 'filter-pill');
            pill.type = 'button';
            pill.dataset.fgroup = entry.slug;
            pill.appendChild(h('span', null, entry.label));
            pill.appendChild(h('span', 'pill-count', String(entry.count)));
            pill.title = 'Show only selected groups (click again to clear)';
            pill.setAttribute('aria-pressed', 'false');
            pill.addEventListener('click', () => {
                pill.classList.toggle('is-active');
                pill.setAttribute('aria-pressed', pill.classList.contains('is-active') ? 'true' : 'false');
                applyFilters();
            });
            pillRow.appendChild(pill);
        }
        bar.append(search, pillRow);
        return bar;
    }
    /** pf1 features footer: feat counts vs the odd-level budget (info boxes). */
    function renderFeatCounts(data) {
        const owned = arrField(data, 'feats').length;
        // PF1 feats at 1, 3, 5, … — off TOTAL level, not `level` (the primary class's level), which
        // told a level-20 multiclass character it was owed 4 feats and flagged the rest as "Excess".
        const byLevel = Math.ceil(totalLevel(data) / 2);
        let bonus = 0;
        for (const g of FEAT_GROUPS) {
            if (g.listKey === 'feats') continue;
            bonus += arrField(data, g.listKey).length;
        }
        const box = (label, value, cls) => {
            const b = h('div', 'feat-count-box' + (cls ? ' ' + cls : ''));
            b.appendChild(h('span', 'feat-count-label', label));
            b.appendChild(h('span', 'feat-count-value', String(value)));
            return b;
        };
        const wrap = h('div', 'feat-counts');
        const joined = h('div', 'feat-count-joined');
        // "Advancement", not "Feats": this box counts data.feats alone and is the one compared
        // against By level for the Missing/Excess badge. The Bonus box beside it is feats too.
        joined.append(box('Advancement', owned), box('By level', byLevel),
            box('Bonus', bonus), box('Total', owned + bonus));
        wrap.appendChild(joined);
        if (byLevel > 0 && owned !== byLevel) {
            const missing = byLevel - owned;
            wrap.appendChild(missing > 0
                ? box('Missing', missing, 'is-missing')
                : box('Excess', -missing, 'is-excess'));
        }
        return wrap;
    }
    function renderFeats(data) {
        refreshFeatureLedger(data);
        const descs = data.homebrew_feat_desc_dict || {};
        // Every group is built, empty ones included: they are the drop targets that let a drag
        // re-file a feat into a category this character has nothing in yet. CSS keeps them out
        // of sight until a drag is actually in flight.
        const groups = FEAT_GROUPS.map((g) => ({
            ...g,
            list: arrField(data, g.listKey),
            labels: g.labelsKey ? data[g.labelsKey] : null,
            taxDict: g.taxKey ? (data[g.taxKey] || null) : null,
        }));
        const { sec, body } = section('Feats');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Add feats to the bottom of the list. Drag ⋮⋮ to reorder. Set uses with max / −.'));
        body.appendChild(sectionCatalogToolbar({
            browseLabel: 'Browse feats',
            picker: {
                title: 'Add feat',
                kinds: ['feats'],
                allowCustom: true,
                customPlaceholder: 'Custom feat name',
                onPick: (hit) => {
                    addToArrayField(data, 'feats', hit.name);
                    renderSheet(data);
                    setActiveTab('features');
                },
                onCustom: (name) => {
                    addToArrayField(data, 'feats', name);
                    renderSheet(data);
                    setActiveTab('features');
                },
            },
            importBundles: data,
            onBlank: () => {
                const name = window.SheetFeatureSheet.blankName('New Feat', data.feats);
                addToArrayField(data, 'feats', name);
                renderSheet(data);
                setActiveTab('features');
                window.SheetFeatureSheet.openFeatureSheet(data,
                    { kind: 'feat', name, listKey: 'feats', sourceKind: 'feat' });
            },
        }));
        // With nothing at all on the character there is nothing to drag either, so the empty
        // drop strips would be ten labels and no purpose.
        if (!groups.some((g) => g.list.length)) {
            body.appendChild(h('p', 'tools-empty', 'No feats yet — browse the catalog to add some.'));
            body.appendChild(renderFeatCounts(data));
            return sec;
        }
        // One list per source array so drag-reorder maps cleanly (like Foundry sections)
        for (const g of groups) {
            const label = pluralizeFeatSection(g.title);
            const wrap = featureGroup(body, featureGroupSlug('feats', label), label, {
                cadence: groupCadence(g),
                empty: !g.list.length,
            });
            const ul = h('ul', 'plain-list feat-list dnd-list');
            wrap.appendChild(ul);
            ul.appendChild(featureListHeader());
            const descSource = g.listKey === 'profession_feats'
                ? { ...descs, ...(data.profession_feat_desc || {}) } : descs;
            const listKey = g.listKey;
            const list = g.list;
            list.forEach((f, i) => {
                const tax = featTaxChain(f, g.taxDict);
                const tags = featTags(data, f);
                ul.appendChild(featureRow({
                    name: f,
                    title: foundryFeatTitle(f, i, { ...g, taxChain: tax }),
                    descHtml: featDescriptionHtml(data, f, descSource, tax),
                    typeLabel: tags[0] || 'Feat',
                    tags: tags.slice(1),
                    data,
                    sourceKind: 'feat',
                    chatKind: 'Feat',
                    sheetRef: {
                        kind: 'feat',
                        listKey,
                        sourceKind: 'feat',
                        fallbackDesc: descSource?.[f] ?? descSource?.[String(f).toLowerCase()] ?? '',
                    },
                    extraClass: tax.length ? 'has-feat-tax' : '',
                    onRemove: (nm) => {
                        removeFromArrayField(data, listKey, nm);
                        renderSheet(data);
                        setActiveTab('features');
                    },
                }));
            });
            bindFeatureDrag(ul, data, 'features-feats', listKey, 'feat');
        }
        body.appendChild(renderFeatCounts(data));
        return sec;
    }
    function pluralizeFeatSection(title) {
        if (title.endsWith('Feat')) return title + 's';
        if (title.endsWith('s')) return title;
        return title + ' Feats'; // Flavor, Flaw, Trainer, Profession
    }
    function renderTraits(data) {
        refreshFeatureLedger(data);
        const backendDesc = {};
        for (const t of data.selected_traits_desc || []) {
            if (t?.name && t.description) backendDesc[t.name] = t.description;
        }
        const { sec, body } = section('Traits & Flaws');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Browse traits from the database or add a custom name.'));
        body.appendChild(sectionCatalogToolbar({
            browseLabel: 'Browse traits',
            picker: {
                title: 'Add trait',
                kinds: ['traits'],
                allowCustom: true,
                onPick: (hit) => {
                    addToArrayField(data, 'selected_traits', hit.name);
                    renderSheet(data);
                    setActiveTab('features');
                },
                onCustom: (name) => {
                    addToArrayField(data, 'selected_traits', name);
                    renderSheet(data);
                    setActiveTab('features');
                },
            },
            importBundles: data,
            onBlank: () => {
                const name = window.SheetFeatureSheet.blankName('New Trait', data.selected_traits);
                addToArrayField(data, 'selected_traits', name);
                renderSheet(data);
                setActiveTab('features');
                window.SheetFeatureSheet.openFeatureSheet(data,
                    { kind: 'trait', name, listKey: 'selected_traits', sourceKind: 'trait' });
            },
        }));
        // Same as the feat groups: empty trait lists are still built, as the drop targets that
        // let a drag file the character's first Flaw or Sphere Trait.
        const built = TRAIT_GROUPS.map(([title, key, chip]) => (
            { title, key, chip, list: arrField(data, key) }));
        const any = built.some((g) => g.list.length);
        for (const { title, key: fieldKey, chip, list } of built) {
            if (!any) break;
            const wrap = featureGroup(body, featureGroupSlug('traits', title), title,
                { empty: !list.length });
            const ul = h('ul', 'plain-list feat-list dnd-list');
            wrap.appendChild(ul);
            ul.appendChild(featureListHeader());
            list.forEach((t) => {
                const ov = window.SheetDetails?.getFeatureOverride?.(data, 'trait', t);
                const desc = ov?.description
                    ?? (foundry('traits', t)?.description
                        || foundry('feats', t)?.description || backendDesc[t]);
                ul.appendChild(featureRow({
                    name: t,
                    title: t,
                    descHtml: desc,
                    typeLabel: chip,
                    data,
                    sourceKind: 'trait',
                    showUses: false,
                    chatKind: chip,
                    sheetRef: {
                        kind: 'trait',
                        listKey: fieldKey,
                        sourceKind: 'trait',
                        fallbackDesc: backendDesc[t] || '',
                        showUses: false,
                    },
                    onRemove: (nm) => {
                        removeFromArrayField(data, fieldKey, nm);
                        renderSheet(data);
                        setActiveTab('features');
                    },
                }));
            });
            bindFeatureDrag(ul, data, 'features-traits', fieldKey, 'trait');
        }
        if (!any) body.appendChild(h('p', 'tools-empty', 'No traits yet.'));
        return sec;
    }
    // Foundry-style class choices live in the exported `class_features` dict, shaped
    // { bucketName: { choiceName: description } } — e.g. { hexes: { "Evil Eye": … } }.
    // Each bucket becomes a parent row with its chosen options as sub-rows. Known buckets
    // get a nice label + singular "(Chosen)" tag; unknown / colon-keyed keys fall back to
    // a prettified label with no tag.
    const CLASS_CHOICE_BUCKETS = {
        hexes: { label: 'Hexes', singular: 'Hex' },
        rage_powers: { label: 'Rage Powers', singular: 'Rage Power' },
        discoveries: { label: 'Discoveries', singular: 'Discovery' },
        arcana: { label: 'Magus Arcana', singular: 'Arcana' },
        exploits: { label: 'Arcanist Exploits', singular: 'Exploit' },
        mysteries: { label: 'Mystery & Revelations', singular: 'Revelation' },
        revelations: { label: 'Revelations', singular: 'Revelation' },
        curses: { label: 'Oracle Curse', singular: 'Curse' },
        rogue_talents: { label: 'Rogue Talents', singular: 'Rogue Talent' },
        ninja_talents: { label: 'Ninja Talents', singular: 'Ninja Talent' },
        slayer_talents: { label: 'Slayer Talents', singular: 'Slayer Talent' },
        investigator_talents: { label: 'Investigator Talents', singular: 'Talent' },
        vigilante_talents: { label: 'Vigilante Talents', singular: 'Talent' },
        orders: { label: 'Order', singular: 'Order' },
        blessings: { label: 'Blessings', singular: 'Blessing' },
        inquisitions: { label: 'Inquisitions', singular: 'Inquisition' },
        bloodline: { label: 'Bloodline', singular: 'Bloodline' },
        spirits: { label: 'Spirits', singular: 'Spirit' },
        // Occult Adventures. Labels match the generator module's CLASS_FEATURE_BUCKETS verbatim so
        // the two sheets name the same pick the same way. 'medium_spirit', not 'spirit' -- the
        // shaman already owns 'spirits' just above, and two buckets one letter apart is a trap.
        implements: { label: 'Implement Schools', singular: 'Implement' },
        focus_powers: { label: 'Focus Powers', singular: 'Focus Power' },
        elemental_focus: { label: 'Elemental Focus', singular: 'Element' },
        wild_talents: { label: 'Wild Talents', singular: 'Wild Talent' },
        infusions: { label: 'Infusions', singular: 'Infusion' },
        medium_spirit: { label: 'Channeled Spirit', singular: 'Spirit' },
        mesmerist_tricks: { label: 'Mesmerist Tricks', singular: 'Trick' },
        bold_stare: { label: 'Bold Stare', singular: 'Bold Stare' },
        psychic_discipline: { label: 'Psychic Discipline', singular: 'Discipline' },
        phrenic_amplifications: { label: 'Phrenic Amplifications', singular: 'Amplification' },
        emotional_focus: { label: 'Phantom Emotional Focus', singular: 'Emotional Focus' },
    };
    function classChoiceLabels(bucket) {
        const known = CLASS_CHOICE_BUCKETS[String(bucket).toLowerCase()];
        if (known) return known;
        // Prettify at word starts only (not after an apostrophe, so "witch's" stays lower).
        const label = String(bucket).replace(/_/g, ' ')
            .replace(/(^|\s)\w/g, (c) => c.toUpperCase());
        return { label, singular: null }; // unknown / "Skill Unlock: Bluff" → no tag
    }
    /** Render a class-choice's exported description (string / array / object) or '' if empty. */
    function classChoiceDescHtml(desc) {
        if (desc == null || desc === '') return '';
        if (typeof desc === 'string') return desc.trim() ? archetypeDescHtml(desc) : '';
        if (typeof desc === 'object' && !Object.keys(desc).length) return '';
        return archetypeDescHtml(desc);
    }
    function renderClassFeatures(data) {
        refreshFeatureLedger(data);
        const classes = ensureClassList(data);
        // Two arrays, two sections. They used to share one list, which is why reordering was
        // dead here: the old binding only attached when class_ability.length happened to equal
        // the combined row count, so any character with a profession ability (the shipped demo
        // included) lost drag for the whole card. They are also genuinely different shapes —
        // class_ability holds "name_class" strings, profession_ability_items holds objects with
        // their own changes/uses — and moveToGroup refuses to move the latter, so keeping them
        // in separate dnd groups makes a cross-drop impossible by construction rather than by
        // a guard that has to be remembered.
        const classItems = arrField(data, 'class_ability').map((entry) => {
            // entries look like "arcane school_wizard" -> name + owning class
            const cut = String(entry).lastIndexOf('_');
            const name = cut > 0 ? entry.slice(0, cut) : entry;
            const cls = cut > 0 ? titleCase(String(entry).slice(cut + 1)) : '';
            const ov = window.SheetDetails?.getFeatureOverride?.(data, 'classFeat', name);
            const desc = ov?.description
                ?? (window.SheetDetails?.lookupClassFeature(name, classes)?.description
                    || data.class_ability_desc?.[name] || data.class_features?.[name]?.description);
            return [titleCase(name), desc, cls, name];
        });
        const professionItems = arrField(data, 'profession_ability_items')
            .map((pa) => [pa.name, pa.description, 'Profession']);
        const { sec, body } = section('Class Features & Abilities');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Browse class features or add custom. Set max uses; Rest restores them.'));
        body.appendChild(sectionCatalogToolbar({
            browseLabel: 'Browse class features',
            picker: {
                title: 'Add class feature',
                kinds: ['classFeatures'],
                allowCustom: true,
                onPick: (hit) => {
                    const cls = data.c_class || 'class';
                    const entry = hit.name + '_' + String(cls).toLowerCase().replace(/\s+/g, '');
                    if (!Array.isArray(data.class_ability)) data.class_ability = [];
                    if (!data.class_ability.some((x) => String(x).toLowerCase().includes(hit.name.toLowerCase()))) {
                        data.class_ability.push(entry);
                        quietSave();
                    }
                    renderSheet(data);
                    setActiveTab('features');
                },
                onCustom: (name) => {
                    if (!Array.isArray(data.class_ability)) data.class_ability = [];
                    data.class_ability.push(name);
                    quietSave();
                    renderSheet(data);
                    setActiveTab('features');
                },
            },
            importBundles: data,
            onBlank: () => {
                const bases = (data.class_ability || []).map((e) => {
                    const cut = String(e).lastIndexOf('_');
                    return cut > 0 ? String(e).slice(0, cut) : String(e);
                });
                const name = window.SheetFeatureSheet.blankName('New Class Feature', bases);
                if (!Array.isArray(data.class_ability)) data.class_ability = [];
                data.class_ability.push(name);
                quietSave();
                renderSheet(data);
                setActiveTab('features');
                window.SheetFeatureSheet.openFeatureSheet(data,
                    { kind: 'classFeat', name, sourceKind: 'classFeat', classes: ensureClassList(data) });
            },
        }));
        const extras = [
            ['Wizard School', data.school !== 'N/A' ? data.school : null],
            // Specialization detail (#68): focused schools, and counter_schools as the
            // newer array form of the legacy opposing_school field (legacy wins when set).
            ['Focused Schools', nonEmpty(data.specialty_schools) ? data.specialty_schools.join(', ') : null],
            ['Opposition Schools', nonEmpty(data.opposing_school) ? data.opposing_school.join(', ')
                : (nonEmpty(data.counter_schools) ? data.counter_schools.join(', ') : null)],
            ['Chosen Descriptors', nonEmpty(data.chosen_spell_descriptor) ? data.chosen_spell_descriptor.join(', ') : null],
            ['Opposition Descriptors', nonEmpty(data.counter_spell_descriptor) ? data.counter_spell_descriptor.join(', ') : null],
            ['Bloodline', data.bloodline && data.bloodline !== 'N/A' ? data.bloodline : null],
            ['Domains', nonEmpty(data.full_domain) ? data.full_domain.join(', ') : null],
        ];
        for (const [k, v] of extras) if (v) kv(body, k, titleCase(String(v)));
        // Chosen class options exported in class_features: { bucket: { choice: desc } }.
        const cfBuckets = Object.entries(data.class_features || {})
            .filter(([, choices]) => choices && typeof choices === 'object'
                && !Array.isArray(choices) && Object.keys(choices).length);
        if (!classItems.length && !professionItems.length && !cfBuckets.length) {
            body.appendChild(h('p', 'tools-empty', 'No class features yet — browse the catalog.'));
            return sec;
        }
        const rawList = arrField(data, 'class_ability');
        const classWrap = featureGroup(body, featureGroupSlug('class', 'Class Features'),
            'Class Features');
        const ul = h('ul', 'plain-list feat-list dnd-list');
        classWrap.appendChild(ul);
        ul.appendChild(featureListHeader());
        for (const [name, desc, cls] of classItems) {
            ul.appendChild(featureRow({
                name,
                title: name,
                descHtml: desc,
                typeLabel: cls || 'Class',
                data,
                sourceKind: 'classFeat',
                chatKind: 'Class Feature',
                sheetRef: {
                    kind: 'classFeat',
                    sourceKind: 'classFeat',
                    classes,
                    fallbackDesc: data.class_ability_desc?.[name]
                        ?? data.class_ability_desc?.[String(name).toLowerCase()] ?? '',
                },
                onRemove: (nm) => {
                    const idx = rawList.findIndex((raw) => {
                        const cut = String(raw).lastIndexOf('_');
                        const n = cut > 0 ? String(raw).slice(0, cut) : String(raw);
                        return titleCase(n) === nm || n.toLowerCase() === nm.toLowerCase();
                    });
                    if (idx < 0) return;
                    rawList.splice(idx, 1);
                    quietSave();
                    renderSheet(data);
                    setActiveTab('features');
                },
            }));
        }
        // No `group`: nothing else on the tab can accept a class feature, and a class feature
        // cannot accept anything. Reorder only, which is all moveToGroup would allow anyway.
        bindDragList({
            container: ul,
            itemSelector: '.feat-item',
            sectionId: 'class_ability',
            onDrop: ({ fromIndex, toIndex }) => {
                reorderArray(data.class_ability, fromIndex, toIndex);
                quietSave();
                renderSheet(data);
                setActiveTab('features');
            },
        });

        if (professionItems.length) {
            const proWrap = featureGroup(body,
                featureGroupSlug('class', 'Profession Abilities'), 'Profession Abilities');
            const proUl = h('ul', 'plain-list feat-list dnd-list');
            proWrap.appendChild(proUl);
            proUl.appendChild(featureListHeader());
            for (const [name, desc, cls] of professionItems) {
                proUl.appendChild(featureRow({
                    name,
                    title: name,
                    descHtml: desc,
                    typeLabel: cls,
                    data,
                    sourceKind: 'classFeat',
                    chatKind: 'Class Feature',
                    // Same ref these rows already carried when both lists shared one loop. The
                    // sheet's move dropdown still refuses them (moveToGroup returns false for a
                    // profession ability), which is the behaviour the split now mirrors in drag.
                    sheetRef: {
                        kind: 'classFeat',
                        sourceKind: 'classFeat',
                        classes,
                        fallbackDesc: '',
                    },
                    onRemove: (nm) => {
                        const pro = arrField(data, 'profession_ability_items');
                        const pIdx = pro.findIndex(
                            (pa) => String(pa?.name).toLowerCase() === nm.toLowerCase());
                        if (pIdx < 0) return;
                        pro.splice(pIdx, 1);
                        quietSave();
                        renderSheet(data);
                        setActiveTab('features');
                    },
                }));
            }
            bindDragList({
                container: proUl,
                itemSelector: '.feat-item',
                sectionId: 'profession_ability_items',
                onDrop: ({ fromIndex, toIndex }) => {
                    reorderArray(data.profession_ability_items, fromIndex, toIndex);
                    quietSave();
                    renderSheet(data);
                    setActiveTab('features');
                },
            });
        }

        // Foundry-style chosen class options: one parent group per class_features bucket
        // with each selected option as an indented sub-row (expandable when it has text).
        for (const [bucket, choices] of cfBuckets) {
            const { label, singular } = classChoiceLabels(bucket);
            // Mythic buckets stamp class_feature_levels with a TIER, not a character level
            // (backend: mythic.py's _record_choice_level calls). The generator already tells us
            // which buckets those are via class_feature_owners, which this sheet has always been
            // sent and never read. Without this a tier-5 ability on a level-12 character reads
            // "· level 5" — plausible enough to be believed, which is what makes it worth fixing.
            // The Foundry module solved the same problem the same way; see its class-features.js
            // mythic band, which puts "Gained at mythic tier N" in the description rather than
            // borrowing the "(Rage Power 4)" level convention.
            const isMythic = String(data.class_feature_owners?.[bucket] ?? '')
                .toLowerCase() === 'mythic';
            // The tradition's boons/qualities/flaws are all granted at once; their stamp is a
            // bookkeeping 1, not a tier anyone gained anything at. The module omits it too.
            const stampIsMeaningful = !/^mythic tradition$/i.test(String(bucket));
            const groupLi = h('li', 'feat-choice-group');
            groupLi.appendChild(h('span', 'feat-choice-group-name', label));
            // The tier itself had no readout anywhere on this sheet: `mythic.tier` and
            // `mythic.path_display` are sent on every mythic payload and were never read, so the
            // tier was only ever IMPLIED by the highest "· tier N" stamp below. That misleads in
            // both directions — a tier-8 character whose highest pick came at tier 6 reads as 6,
            // and Amazing Initiative's own text says "equal to your mythic tier" without ever
            // naming it. Fall back to the bare chip when either field is absent (a pre-§14
            // payload, or a bucket owned by mythic on a character with no `mythic` block).
            const mythicTier = Number(data.mythic?.tier);
            const mythicPath = String(data.mythic?.path_display ?? '').trim();
            const mythicChip = (Number.isFinite(mythicTier) && mythicTier > 0)
                ? (mythicPath ? `Mythic ${mythicTier} (${mythicPath})` : `Mythic ${mythicTier}`)
                : 'Mythic';
            groupLi.appendChild(h('span', 'feat-tag feat-choice-chip',
                isMythic ? mythicChip : 'Class Choice'));
            ul.appendChild(groupLi);
            const bucketLevels = data.class_feature_levels?.[bucket] || {};
            for (const [choiceName, desc] of Object.entries(choices)) {
                const li = h('li', 'feat-subitem');
                if (singular) {
                    li.appendChild(h('span', 'feat-subitem-tag', singular + ' (Chosen)'));
                }
                const descHtml = classChoiceDescHtml(desc);
                if (descHtml) {
                    li.appendChild(details(choiceName, descHtml, 'feat-subitem-details'));
                } else {
                    li.appendChild(h('span', 'feat-subitem-name', choiceName));
                }
                // Level the option was picked at (exported by the generator, when present) —
                // or the mythic tier it was gained at, which is a different axis entirely.
                const lvl = Number(bucketLevels[choiceName]);
                if (Number.isFinite(lvl) && lvl > 0 && (stampIsMeaningful || !isMythic)) {
                    li.appendChild(h('span', 'feat-subitem-level',
                        (isMythic ? '· tier ' : '· level ') + lvl));
                }
                ul.appendChild(li);
            }
        }
        return sec;
    }

    return { renderFeaturesToolbar, renderFeats, renderTraits, renderClassFeatures };
})();
