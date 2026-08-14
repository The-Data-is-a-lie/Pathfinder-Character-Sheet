// scripts/tabs/features.js -- the Features tab: feats / traits / class features lists, toolbar,
// feat-count footer (window.SheetTabFeatures). Extracted from sheet.js (Part B split); bodies
// verbatim. refreshFeatureLedger / featureBuffGroup are consumed by modals.js (openFeatureBuffMenu)
// via SheetApp -- the shell destructures them back and the delegates re-point here. Loads after
// summary.js (uses archetypeDescHtml).
window.SheetTabFeatures = (function () {
    'use strict';
    const {
        h, foundry, nonEmpty, details, titleCase, section, escapeHtml, kv,
        bindDragReorder, reorderArray, dndHandle,
    } = window.SheetUI;
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
    function featTags(name) {
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
    function featDescriptionHtml(name, descSource, taxChain) {
        const primary = foundry('feats', name)?.description
            || descSource?.[name]
            || descSource?.[String(name).toLowerCase()]
            || '';
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
        // ✦ marker when this feature carries built-in modifiers (dimmed if toggled off).
        if (buffGroup) {
            const active = isBuffSourceActive(opts.data, buffGroup.source, buffGroup.sourceKind);
            const mark = h('span', 'feat-buff-mark' + (active ? '' : ' buff-off'), '✦');
            const bits = buffGroup.lines.map((c) => formatChangeLine(c, SD)).join('; ');
            mark.title = (active ? 'Built-in buffs (active): ' : 'Built-in buffs (inactive): ')
                + bits;
            nameCell.appendChild(mark);
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
    /** Wrapper div a filter pill can hide; carries the group heading. */
    function featureGroup(body, slug, headerTitle) {
        const wrap = h('div', 'feature-group');
        wrap.dataset.fgroup = slug;
        if (headerTitle) wrap.appendChild(h('h3', null, headerTitle));
        body.appendChild(wrap);
        return wrap;
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
            push('feats', pluralizeFeatSection(g.title), (data[g.listKey] || []).length);
        }
        push('traits', 'Traits', (data.selected_traits || []).length);
        push('traits', 'Background', (data.background_traits || []).length);
        push('traits', 'Sphere Traits', (data.sphere_traits || []).length);
        push('traits', 'Flaws', (data.flaw || []).length);
        push('class', 'Class Features',
            (data.class_ability || []).length + (data.profession_ability_items || []).length);
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
            pane.querySelectorAll('[data-fgroup]').forEach((grp) => {
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
        const owned = (data.feats || []).length;
        // PF1 feats at 1, 3, 5, … — off TOTAL level, not `level` (the primary class's level), which
        // told a level-20 multiclass character it was owed 4 feats and flagged the rest as "Excess".
        const byLevel = Math.ceil(totalLevel(data) / 2);
        let bonus = 0;
        for (const g of FEAT_GROUPS) {
            if (g.listKey === 'feats') continue;
            bonus += (data[g.listKey] || []).length;
        }
        const box = (label, value, cls) => {
            const b = h('div', 'feat-count-box' + (cls ? ' ' + cls : ''));
            b.appendChild(h('span', 'feat-count-label', label));
            b.appendChild(h('span', 'feat-count-value', String(value)));
            return b;
        };
        const wrap = h('div', 'feat-counts');
        const joined = h('div', 'feat-count-joined');
        joined.append(box('Feats', owned), box('By level', byLevel),
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
        const groups = FEAT_GROUPS
            .map((g) => ({
                ...g,
                list: data[g.listKey],
                labels: g.labelsKey ? data[g.labelsKey] : null,
                taxDict: g.taxKey ? (data[g.taxKey] || null) : null,
            }))
            .filter((g) => nonEmpty(g.list));
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
        }));
        if (!groups.length) {
            body.appendChild(h('p', 'tools-empty', 'No feats yet — browse the catalog to add some.'));
            body.appendChild(renderFeatCounts(data));
            return sec;
        }
        // One list per source array so drag-reorder maps cleanly (like Foundry sections)
        for (const g of groups) {
            const label = pluralizeFeatSection(g.title);
            const wrap = featureGroup(body, featureGroupSlug('feats', label), label);
            const ul = h('ul', 'plain-list feat-list dnd-list');
            wrap.appendChild(ul);
            ul.appendChild(featureListHeader());
            const descSource = g.listKey === 'profession_feats'
                ? { ...descs, ...(data.profession_feat_desc || {}) } : descs;
            const listKey = g.listKey;
            const list = data[listKey] || [];
            list.forEach((f, i) => {
                const tax = featTaxChain(f, g.taxDict);
                const tags = featTags(f);
                ul.appendChild(featureRow({
                    name: f,
                    title: foundryFeatTitle(f, i, { ...g, taxChain: tax }),
                    descHtml: featDescriptionHtml(f, descSource, tax),
                    typeLabel: tags[0] || 'Feat',
                    tags: tags.slice(1),
                    data,
                    sourceKind: 'feat',
                    chatKind: 'Feat',
                    extraClass: tax.length ? 'has-feat-tax' : '',
                    onRemove: (nm) => {
                        removeFromArrayField(data, listKey, nm);
                        renderSheet(data);
                        setActiveTab('features');
                    },
                }));
            });
            bindDragReorder(ul, '.feat-item', (from, to) => {
                reorderArray(data[listKey], from, to);
                quietSave();
                renderSheet(data);
                setActiveTab('features');
            });
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
        const keyMap = {
            Traits: 'selected_traits',
            Background: 'background_traits',
            'Sphere Traits': 'sphere_traits',
            Flaws: 'flaw',
        };
        const groups = [
            ['Traits', data.selected_traits, 'selected_traits'],
            ['Background', data.background_traits, 'background_traits'],
            ['Sphere Traits', data.sphere_traits, 'sphere_traits'],
            ['Flaws', data.flaw, 'flaw'],
        ];
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
        }));
        const typeLabels = {
            Traits: 'Trait',
            Background: 'Background',
            'Sphere Traits': 'Sphere',
            Flaws: 'Flaw',
        };
        let any = false;
        for (const [title, list, fieldKey] of groups) {
            if (!nonEmpty(list)) continue;
            any = true;
            const wrap = featureGroup(body, featureGroupSlug('traits', title), title);
            const ul = h('ul', 'plain-list feat-list dnd-list');
            wrap.appendChild(ul);
            ul.appendChild(featureListHeader());
            list.forEach((t) => {
                const desc = foundry('traits', t)?.description
                    || foundry('feats', t)?.description || backendDesc[t];
                ul.appendChild(featureRow({
                    name: t,
                    title: t,
                    descHtml: desc,
                    typeLabel: typeLabels[title] || 'Trait',
                    data,
                    sourceKind: 'trait',
                    showUses: false,
                    chatKind: typeLabels[title] || 'Trait',
                    onRemove: (nm) => {
                        removeFromArrayField(data, fieldKey, nm);
                        renderSheet(data);
                        setActiveTab('features');
                    },
                }));
            });
            bindDragReorder(ul, '.feat-item', (from, to) => {
                reorderArray(data[fieldKey], from, to);
                quietSave();
                renderSheet(data);
                setActiveTab('features');
            });
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
        const list = data.class_ability;
        const classes = ensureClassList(data);
        const items = [];
        if (nonEmpty(list)) {
            for (const entry of list) {
                // entries look like "arcane school_wizard" -> name + owning class
                const cut = String(entry).lastIndexOf('_');
                const name = cut > 0 ? entry.slice(0, cut) : entry;
                const cls = cut > 0 ? titleCase(String(entry).slice(cut + 1)) : '';
                const desc = window.SheetDetails?.lookupClassFeature(name, classes)?.description
                    || data.class_ability_desc?.[name] || data.class_features?.[name]?.description;
                items.push([titleCase(name), desc, cls]);
            }
        }
        for (const pa of data.profession_ability_items || []) {
            items.push([pa.name, pa.description, 'Profession']);
        }
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
        if (!items.length && !cfBuckets.length) {
            body.appendChild(h('p', 'tools-empty', 'No class features yet — browse the catalog.'));
            return sec;
        }
        const wrap = featureGroup(body, featureGroupSlug('class', 'Class Features'), null);
        const ul = h('ul', 'plain-list feat-list dnd-list');
        wrap.appendChild(ul);
        ul.appendChild(featureListHeader());
        // Map display name back to raw class_ability entry for delete
        const rawList = data.class_ability || [];
        // Build order: class_ability first, then profession abilities as non-reorder with class list
        for (const [name, desc, cls] of items) {
            ul.appendChild(featureRow({
                name,
                title: name,
                descHtml: desc,
                typeLabel: cls || 'Class',
                data,
                sourceKind: 'classFeat',
                chatKind: 'Class Feature',
                onRemove: (nm) => {
                    const idx = rawList.findIndex((raw) => {
                        const cut = String(raw).lastIndexOf('_');
                        const n = cut > 0 ? String(raw).slice(0, cut) : String(raw);
                        return titleCase(n) === nm || n.toLowerCase() === nm.toLowerCase();
                    });
                    if (idx >= 0) {
                        rawList.splice(idx, 1);
                    } else {
                        // Profession abilities live in their own array
                        const pro = data.profession_ability_items;
                        const pIdx = Array.isArray(pro)
                            ? pro.findIndex((pa) => String(pa?.name).toLowerCase() === nm.toLowerCase())
                            : -1;
                        if (pIdx < 0) return;
                        pro.splice(pIdx, 1);
                    }
                    quietSave();
                    renderSheet(data);
                    setActiveTab('features');
                },
            }));
        }
        // Reorder only class_ability entries (profession items sit at end; skip if mixed)
        if (nonEmpty(rawList) && rawList.length === items.length) {
            bindDragReorder(ul, '.feat-item', (from, to) => {
                reorderArray(data.class_ability, from, to);
                quietSave();
                renderSheet(data);
                setActiveTab('features');
            });
        }

        // Foundry-style chosen class options: one parent group per class_features bucket
        // with each selected option as an indented sub-row (expandable when it has text).
        for (const [bucket, choices] of cfBuckets) {
            const { label, singular } = classChoiceLabels(bucket);
            const groupLi = h('li', 'feat-choice-group');
            groupLi.appendChild(h('span', 'feat-choice-group-name', label));
            groupLi.appendChild(h('span', 'feat-tag feat-choice-chip', 'Class Choice'));
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
                // Level the option was picked at (exported by the generator, when present).
                const lvl = Number(bucketLevels[choiceName]);
                if (Number.isFinite(lvl) && lvl > 0) {
                    li.appendChild(h('span', 'feat-subitem-level', '· level ' + lvl));
                }
                ul.appendChild(li);
            }
        }
        return sec;
    }

    return { renderFeaturesToolbar, renderFeats, renderTraits, renderClassFeatures };
})();
