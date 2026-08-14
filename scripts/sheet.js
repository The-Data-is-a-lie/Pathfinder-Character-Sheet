// Read-only pf1-style character sheet, rendered client-side from the generator's JSON.
// Standalone static build: character generation happens on the Flask backend (Render); this
// page only POSTs to it. Item details (descriptions, prerequisites, numeric changes) come
// from the slim Foundry-data extracts loaded by scripts/details.js; saved characters live in
// the SheetLibrary (scripts/library.js — IndexedDB + optional connected disk folder).
//
// Layout: a persistent header (name / class line / ability boxes) over a fixed FoundryVTT-style
// tab bar — Summary/Attributes/Combat/Defenses/Inventory/Features/Skills/Path of War/Spells/
// Buffs/Biography/Notes/Settings/Spheres. Every character gets the identical tabs (empty ones show
// a placeholder); ALL panes are rendered up front and toggled by CSS class, so switching tabs is
// instant and printing shows the whole sheet.

(function () {
    'use strict';

    // DOM + presentation kit, lifted into scripts/ui.js. Pulled back into this scope so the
    // ~hundreds of existing call sites (h(), section(), kvStat(), spTable(), …) are untouched.
    const {
        h, htmlBlock, details, section, emptyState, compose, wrapWideTables,
        fmt, termHint, kLabel, kv, kvStat, attachStatHint,
        spCell, spHeading, spBoxBig, spTable,
        titleCase, mod, toInt, nonEmpty, escapeHtml, parseIntLoose, fmtWeight, fmtPrice,
        foundry, highlightInlineRolls,
        editableField, kvEdit, dblclickEditable, kvDbl,
        bindDragReorder, reorderArray, dndHandle, cloneChanges,
    } = window.SheetUI;

    // Static data tables, lifted into scripts/data.js (window.SheetData). The boot wires the
    // gen form from these option lists; the class/condition tables are consumed directly by the
    // summary/defenses/buffs tab modules.
    const { REGIONS, RACES, CLASSES, CORE_RACES, CORE_CLASSES, DEITIES } = window.SheetData;

    // Derived-stat math, lifted into scripts/derive.js (window.SheetDerive). Pulled back into
    // this scope so the many existing call sites (computeDerived, part, saveBuckets, …) stay
    // untouched. derive.js late-binds its state deps via window.SheetState (state.js), read at
    // call time.
    const {
        part, sumParts, appendLedgerParts, abilityInfo, abModOf, effectiveLedger,
        groupChangesBySource, computeDerived, combatStats, carryLimits, loadCategory,
        castingAbilityMod, totalLevel, casterLevelValue, spellSaveDC, concentrationBonus,
        acTypeTotals, saveBuckets, srTotal, babIterativesStr, GOOD_SAVES,
    } = window.SheetDerive;

    // Per-character _sheet state, lifted into scripts/state.js (window.SheetState). Pulled back
    // into this scope so the many call sites (sheetState, quietSave, ensureBuffs, …) stay
    // untouched. state.js owns window.SheetState; the shell delegates quietSave/refreshDerived/
    // isBuffSourceActive to it via SheetApp below.
    const {
        sheetState, quietSave, refreshDerived, seedBackendStatBonuses, seedRacialColumn,
        disabledBuffSet, buffSourceKey, removedBuffSet, isBuffSourceActive, isBuffSourceRemoved,
        setBuffSourceActive, removeBuffSource, restoreRemovedBuffSources, activeStanceSet,
        setStanceActive, activeConditions, setConditionActive, notesForTargets, attachNotesHover,
        featureCustomList, featureCustomEntry, pruneFeatureCustom, ensureBuffs, normalizeBuffEntry,
        formatBuffDuration, createBuff, addBuffFromCatalog, ensureSpellCasts, spendSpellSlot,
        ensureCastingAbility, ensureInitiationStat, ensureInventoryObjects, ensureDefenses,
        ensureClassList, syncLegacyClasses, ensureArchetypeList, ensureSkillRanksObject,
        BUFF_SUBTYPES, BUFF_DURATION_UNITS,
    } = window.SheetState;

    // Appearance/theme colour engine, lifted into scripts/theme.js (window.SheetTheme). The
    // shell keeps onboarding (Start here / Instructions / audience), which theme.js late-binds
    // via SheetApp; only the handful of theme fns the shell still calls are pulled back here.
    const {
        themePreference, syncThemeControls, renderThemeCards, isThemeChoice, initTheme,
        buildCustomThemeControls, applyTheme, openThemeModal,
    } = window.SheetTheme;

    // Cross-tab overlays, lifted into scripts/modals.js (window.SheetModals). They reach into
    // tab internals, which the shell late-binds to them via SheetApp below; here we just pull
    // back the overlays the shell itself opens.
    const {
        openItemSheet, openClassSheet, openArchetypeSheet, openCatalogPicker, openBuffEditor,
        openPortraitLightbox, openPowModifierEditor, openFeatureBuffMenu, sectionCatalogToolbar,
        formatChangeLine, addBlankInventoryItem, processPortraitFile,
    } = window.SheetModals;

    // Identity header (portrait / id grid / ability rows), lifted into scripts/header.js.
    const { renderHeader, renderPortrait, renderAbilities } = window.SheetHeader;

    // Character library ops, lifted into scripts/roster.js (window.SheetRoster). currentData /
    // CURRENT_KEY / ensureProse are shell-owned; roster.js reaches them via SheetApp below.
    const {
        rosterSelect, refreshRoster, saveCurrent, loadCharacter, deleteCurrent, adoptCharacter,
        cloneCurrent,
    } = window.SheetRoster;

    // Generation form, lifted into scripts/generate.js (window.SheetGenerate). backendUrl /
    // togglePanel / FORM_KEY stay shell-owned and are reached via SheetApp.
    const {
        fillSelect, fillGroupedSelect, buildPayload, quickLevelSelect, fillQuickLevel,
        applyQuickLevel, syncQuickLevel, applyGenPreset, surpriseMe, generate, loadJsonText,
    } = window.SheetGenerate;

    // App-chrome layer, lifted into scripts/shell-ui.js (window.SheetShellUI): view-state, the
    // top-bar/rail primary actions, and onboarding. The boot + renderSheet use these directly;
    // the theme-facing audience/onboarding delegates on SheetApp below re-point to these names
    // (theme.js loads before shell-ui, so it keeps late-binding them via SheetApp).
    const {
        viewMode, applyExplainMode, applyDensity, renderPrimaryActions, syncPrimaryActions,
        initRail, togglePanel, shouldAutoOpenStartHere,
        audience, audienceDefault, setAudience, openStartHere, openInstructions,
    } = window.SheetShellUI;

    // Per-tab renderers, lifted into scripts/tabs/*.js. Each exports its render fn, pulled back
    // here so the TABS array entries stay unchanged.
    const { renderSpheres } = window.SheetTabSpheres;
    const { renderCompanions } = window.SheetTabCompanions;
    const { renderPathOfWar } = window.SheetTabPathOfWar;
    // notes.js is the prose home; ensureProse/bindProseTextarea are shared with the Biography
    // tab and others (SheetApp.ensureProse below re-points here for roster.js).
    const {
        tabNotes, ensureProse, bindProseTextarea,
    } = window.SheetTabNotes;
    const { renderBiographyVitals } = window.SheetTabBiography;
    const { tabSettings } = window.SheetTabSettings;
    const { tabAttributes } = window.SheetTabAttributes;
    const { renderSkills } = window.SheetTabSkills;
    const { renderSpells } = window.SheetTabSpells;
    const { renderPsionics } = window.SheetTabPsionics;
    const { renderSimpleSheet } = window.SheetSimple;
    const { tabSummary } = window.SheetTabSummary;
    const {
        renderFeaturesToolbar, renderFeats, renderTraits, renderClassFeatures,
    } = window.SheetTabFeatures;
    const { tabCombat } = window.SheetTabCombat;
    const { tabDefenses } = window.SheetTabDefenses;
    // renderUsesControls is consumed by features.js via SheetApp; this re-points its delegate.
    const { renderModifiers, renderUsesControls } = window.SheetTabBuffs;
    // inventory render helpers; the shared render-cycle ones (renderInventoryItemCard, invRerender)
    // stay tab-owned and late-bind via SheetApp for combat/defenses/modals.
    const { renderGear, renderInventoryItemCard, invRerender } = window.SheetTabInventory;

    const LEGACY_CHAR_KEY = 'sheet.characterData'; // pre-library single slot (migrated once)
    const FORM_KEY = 'sheet.formData';
    const BACKEND_KEY = 'sheet.backendUrl';
    const TAB_KEY = 'sheet.activeTab';
    const CURRENT_KEY = 'sheet.currentId';
    const DEFAULT_BACKEND = 'https://pathfinder-char-creator-web-public-use.onrender.com';


    // Generation backend base URL: default the hosted server, overridable via the Settings tab
    // or ?backend=http://127.0.0.1:5001 (persisted) — ?backend=default clears the override.
    function backendUrl() {
        return localStorage.getItem(BACKEND_KEY) || DEFAULT_BACKEND;
    }
































    // Backdrop / Escape / scroll-lock / focus all come from SheetOverlay; this only supplies
    // the content and remembers the "don't show again" choice on the way out.



    // ---------------------------------------------------------------- instructions


    // ---------------------------------------------------------------- start here
    // The short on-ramp. "Show me everything" opens the full instructions ON TOP of it — the
    // overlay stack handles that, and Escape peels them back one at a time.







    // ---------------------------------------------------------------- moved-out kits
    // DOM helpers (h / section / kv / kvStat / titleCase / mod …) live in scripts/ui.js.
    // Derived-stat math (computeDerived / part / saveBuckets …) lives in scripts/derive.js.


    // fmt / toInt / nonEmpty / escapeHtml / highlightInlineRolls / foundry live in ui.js.














    // editableField / kvEdit / dblclickEditable / kvDbl live in ui.js (window.SheetUI).






    /** kv row with total + collapsible source list */
    // kvStat now lives in scripts/ui.js (window.SheetUI).



















































































    /**
     * HTML5 drag-and-drop reorder for list containers (Foundry-like item rows).
     * @param {HTMLElement} container
     * @param {string} itemSelector - children that are reorderable
     * @param {(fromIndex: number, toIndex: number) => void} onReorder
     */






























































    // ---------------------------------------------------------------- tab composites
    // emptyState / compose now live in scripts/ui.js (window.SheetUI).














































    // termHint / attachStatHint now live in scripts/ui.js (window.SheetUI).







    // spCell / spHeading / spBoxBig / spTable now live in scripts/ui.js (window.SheetUI).


    const TABS = [
        { id: 'summary', label: 'Summary', render: tabSummary },
        { id: 'attributes', label: 'Attributes', render: tabAttributes },
        { id: 'combat', label: 'Combat', render: tabCombat },
        { id: 'defenses', label: 'Defenses', render: tabDefenses },
        { id: 'inventory', label: 'Inventory', render: (d) => renderGear(d) || emptyState('No gear.') },
        { id: 'features', label: 'Features', render: (d) => compose(renderFeaturesToolbar(d), renderFeats(d), renderTraits(d), renderClassFeatures(d)) },
        { id: 'skills', label: 'Skills', render: (d) => renderSkills(d) },
        { id: 'path-of-war', label: 'Path of War', render: (d) => renderPathOfWar(d) || emptyState('Not an initiator — no maneuvers or stances.') },
        { id: 'spells', label: 'Spells', render: (d) => renderSpells(d) },
        { id: 'psionics', label: 'Psionics', render: (d) => renderPsionics(d) || emptyState('Not a manifester — no powers, power points or mind blade.') },
        { id: 'buffs', label: 'Buffs', render: (d) => renderModifiers(d) },
        { id: 'companions', label: 'Companions', render: (d) => renderCompanions(d) },
        { id: 'biography', label: 'Biography', render: (d) => renderBiographyVitals(d) },
        { id: 'notes', label: 'Notes', render: tabNotes },
        { id: 'settings', label: 'Settings', render: tabSettings },
        { id: 'spheres', label: 'Spheres', render: (d) => renderSpheres(d) },
    ];

    // ---------------------------------------------------------------- sheet shell
    let currentData = null;

    function activeTabId() {
        const saved = localStorage.getItem(TAB_KEY);
        return TABS.some((t) => t.id === saved) ? saved : 'summary';
    }

    // wrapWideTables now lives in scripts/ui.js (window.SheetUI).

    function setActiveTab(id) {
        const prev = localStorage.getItem(TAB_KEY);
        localStorage.setItem(TAB_KEY, id);
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
        document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.tab === id));
        // When opening a math-sensitive tab, re-hydrate inventory buffs from the compendium
        // and rebuild derived panes if items gained changes since last full render (e.g. details
        // loaded after first paint, or empty changes[] from an earlier migration).
        if (!currentData || currentData.error) return;
        const mathTabs = new Set(['combat', 'defenses', 'buffs', 'inventory', 'summary', 'attributes', 'skills']);
        if (!mathTabs.has(id)) return;
        ensureInventoryObjects(currentData);
        const SD = window.SheetDetails;
        if (SD) {
            window.sheetChangesFull = SD.collectChanges(currentData);
            window.sheetChanges = effectiveLedger(currentData);
        }
        window.SheetRoll?.setCharacter(currentData);
        // Rebuild the active pane so AC / sources reflect newly applied item buffs.
        // Skip when setActiveTab is called from inside renderSheet (same tab, just painted).
        if (prev === id) return;
        const pane = document.querySelector(`.tab-pane[data-tab="${id}"]`);
        const tab = TABS.find((t) => t.id === id);
        if (!pane || !tab) return;
        const keepScroll = pane.scrollTop;
        pane.innerHTML = '';
        pane.appendChild(h('h2', 'print-only tab-print-title', tab.label));
        pane.appendChild(tab.render(currentData) || emptyState('Nothing here.'));
        wrapWideTables(pane);
        pane.scrollTop = keepScroll;
    }

    function renderSheet(data) {
        // Any render of something other than the sample retires the sample banner (Generate,
        // Load JSON, picking from the roster). Re-rendering the sample itself keeps it.
        if (demoData && data !== demoData) clearDemoBanner();

        // Keep un-debounced prose edits when re-rendering (details-ready, manual save, …).
        if (currentData) {
            const prose = ensureProse(currentData);
            for (const key of ['description', 'personality', 'notes']) {
                const el = document.getElementById('notes-prose-' + key);
                if (el) prose[key] = el.value;
            }
            // Legacy single-box id (older sessions)
            const legacy = document.getElementById('notes-text');
            if (legacy && !document.getElementById('notes-prose-notes')) {
                prose.notes = legacy.value;
            }
            (currentData._sheet ??= {}).notes = prose.notes || '';
        }

        currentData = data;
        // #79: the audit is memoized for one paint (its feat-prerequisite rule parses prose for
        // every feat, and every skill/feat row asks it a question). A render is the only thing
        // that can change the answer, so this is where the memo is dropped.
        window.SheetHealth?.invalidate?.();
        const sheet = document.getElementById('sheet');
        sheet.innerHTML = '';
        if (!data || typeof data !== 'object' || data.error) {
            sheet.appendChild(h('p', 'placeholder error', data?.error ? 'Backend error: ' + data.error : 'No character yet — hit Generate or Load JSON above.'));
            sheet.appendChild(tabSettings()); // themes, folder, backend stay reachable without a character
            syncThemeControls(themePreference());
            window.sheetChanges = { changes: [], notes: [], conditionals: [] };
            window.SheetRoll?.setCharacter(null);
            window.SheetHealthUI?.syncIndicator?.();
            return;
        }

        // Hydrate equipment (and re-fill empty non-customized changes from compendium)
        // before any tab computes AC / attacks / buffs.
        ensureInventoryObjects(data);
        // Seed the Inherent / Level-up / Racial columns from the generator before any ability math.
        seedBackendStatBonuses(data);
        seedRacialColumn(data);
        // Seed generated bonded creatures into the user-owned companions array. Own flag, exactly as
        // the two above, and ABOVE the simple-view early return so the fill happens in both view
        // modes and on loadCharacter() as well as on a fresh generation.
        window.SheetTabCompanions?.seedCompanions?.(data);

        if (viewMode() === 'simple') {
            sheet.appendChild(renderSimpleSheet(data));
            wrapWideTables(sheet);
            syncThemeControls(themePreference());
            window.SheetRoll?.setCharacter(data);
            window.SheetHealthUI?.syncIndicator?.();   // #79 — no rows to badge, but the count holds
            return;
        }

        sheet.appendChild(renderHeader(data));

        const nav = h('nav', 'tab-nav no-print');
        const panes = h('div', 'tab-panes');
        for (const tab of TABS) {
            const btn = h('button', 'tab-btn', tab.label);
            btn.type = 'button';
            btn.dataset.tab = tab.id;
            btn.addEventListener('click', () => setActiveTab(tab.id));
            nav.appendChild(btn);

            const pane = h('div', 'tab-pane');
            pane.dataset.tab = tab.id;
            pane.appendChild(h('h2', 'print-only tab-print-title', tab.label));
            const content = tab.render(data);
            pane.appendChild(content || emptyState('Nothing here.'));
            wrapWideTables(pane);
            panes.appendChild(pane);
        }
        sheet.append(nav, panes);
        setActiveTab(activeTabId());
        syncThemeControls(themePreference());
        // Tools drawer attacks refresh after tabs run (Buffs sets window.sheetChanges).
        window.SheetRoll?.setCharacter(data);
        // #79: last, so the count reflects the ledger the tabs just built.
        window.SheetHealthUI?.syncIndicator?.();
    }

    // Print = the 2-page handout, from either view. Simple view already IS the handout;
    // in complex view the simple sheet is rendered into a hidden print-only holder so the
    // tabbed view (and any in-flight inline edit) is left untouched. Browser print (Ctrl+P)
    // still prints the current view, so the all-tabs dump stays reachable.
    function printHandout() {
        if (viewMode() === 'simple' || !currentData || currentData.error) {
            window.print();
            return;
        }
        const holder = h('div', '');
        holder.id = 'print-handout';
        holder.appendChild(renderSimpleSheet(currentData));
        wrapWideTables(holder);
        document.body.appendChild(holder);
        document.body.classList.add('printing-handout');
        const cleanup = () => {
            holder.remove();
            document.body.classList.remove('printing-handout');
            window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        window.print();
    }

    // Exposed for console debugging, Tools drawer, and inline editors.
    window.renderSheet = renderSheet;
    window.SheetApp = {
        quietSave,
        refreshDerived,
        isBuffSourceActive: (source, kind) => isBuffSourceActive(currentData, source, kind),
        get current() { return currentData; },
        // roster.js writes the shell's currentData pointer through this, and reads CURRENT_KEY /
        // ensureProse (a deferred state fn) from here.
        setCurrent(v) { currentData = v; },
        get CURRENT_KEY() { return CURRENT_KEY; },
        ensureProse: (d) => ensureProse(d),
        // generate.js reads these shell-owned bits.
        backendUrl: () => backendUrl(),
        get FORM_KEY() { return FORM_KEY; },
        renderUsesControls: (...a) => renderUsesControls(...a),
        renderInventoryItemCard: (...a) => renderInventoryItemCard(...a),
        get BACKEND_KEY() { return BACKEND_KEY; },
        // state.js late-binds these (renderSheet / saveCurrent are shell-owned).
        renderSheet: (d) => renderSheet(d),
        saveCurrent: (opts) => saveCurrent(opts),
        // theme.js late-binds the audience/onboarding surface (it loads before shell-ui, so it
        // can't destructure from it); these delegate to the shell-ui functions destructured above.
        audience: () => audience(),
        audienceDefault: (f) => audienceDefault(f),
        setAudience: (l) => setAudience(l),
        openStartHere: () => openStartHere(),
        openInstructions: () => openInstructions(),
        shouldAutoOpenStartHere: () => shouldAutoOpenStartHere(),
        // modals.js late-binds these tab/shell helpers (each moves to its tab module later,
        // when the shell re-points the delegate).
        setActiveTab: (id) => setActiveTab(id),
        invRerender: (...a) => invRerender(...a),
    };




    // ------------------------------------------------------------ demo character
    // A first-time visitor otherwise lands on an empty placeholder, and the only way out
    // is Generate — which cold-starts the free backend and can take up to a minute. So we
    // render a bundled sample instead: a level-20 cleric who also walks the Path of War
    // Martial Training chain, which fills the Spells and Path of War tabs at once.
    //
    // Render-only, deliberately: the sample is NEVER written to the library, so it can't
    // pollute a real roster or turn into a record someone has to delete. It shows only
    // when the library is genuinely empty, so returning users never see it.
    let demoData = null;

    function clearDemoBanner() {
        demoData = null;
        document.getElementById('demo-banner')?.remove();
    }

    function showDemoBanner() {
        document.getElementById('demo-banner')?.remove();
        const bar = h('div', 'demo-banner no-print');
        bar.id = 'demo-banner';
        bar.appendChild(h('span', '', 'Sample character — a level 20 cleric, to show the sheet with something in it. Hit Generate to roll your own.'));
        const close = h('button', 'demo-banner-x', '×');
        close.type = 'button';
        close.title = 'Dismiss';
        close.addEventListener('click', clearDemoBanner);
        bar.appendChild(close);
        document.getElementById('sheet')?.before(bar);
    }

    async function loadDemoCharacter() {
        try {
            const records = await window.SheetLibrary.list().catch(() => []);
            if (records.length) return false;             // real characters win, always
            const resp = await fetch('data/demo-character.json', { cache: 'no-store' });
            if (!resp.ok) return false;
            const data = await resp.json();
            if (!data || typeof data !== 'object' || data.error) return false;
            demoData = data;
            renderSheet(data);
            showDemoBanner();
            return true;
        } catch {
            return false;                                  // no demo file / offline: fall through
        }
    }

















    // ---------------------------------------------------------------- wiring
    document.addEventListener('DOMContentLoaded', async () => {
        // Core topbar buttons FIRST, before anything that can throw — a bad stored
        // theme/form value must never take Print or Generate down with it.
        document.getElementById('toggle-load').addEventListener('click', () => togglePanel('load-panel'));
        document.getElementById('print-btn').addEventListener('click', () => printHandout());
        document.getElementById('health-btn').addEventListener('click',
            () => window.SheetHealthUI?.openPanel?.(currentData));
        // Generate / view switch / Explain / Start here render into the top bar AND the rail
        // from one definition, so the two can't disagree about state or wording.
        applyExplainMode();
        applyDensity();
        syncPrimaryActions();
        initRail();

        // Theme: topbar + Settings + localStorage; ?theme=parchment|dusk|…|system applies (persisted).
        try {
            initTheme();
            const themeParam = new URLSearchParams(location.search).get('theme');
            if (themeParam && isThemeChoice(themeParam)) applyTheme(themeParam);
        } catch (err) {
            console.error('Theme boot failed (continuing):', err);
        }

        // ?backend=http://host:port overrides the generation backend (persisted);
        // ?backend=default clears the override. Also editable in the Settings tab.
        const backendParam = new URLSearchParams(location.search).get('backend');
        if (backendParam === 'default') localStorage.removeItem(BACKEND_KEY);
        else if (backendParam) localStorage.setItem(BACKEND_KEY, backendParam.replace(/\/+$/, ''));

        const form = document.getElementById('gen-form');
        fillSelect(form.elements.region, REGIONS);
        // Race/class are the two kid-facing picks, so the iconic options float to the top of
        // the list instead of being buried alphabetically among 50 and 46 entries.
        fillGroupedSelect(form.elements.race, RACES, CORE_RACES, 'More races',
            (r) => r.toLowerCase().replace(/\s/g, '-'));
        fillGroupedSelect(form.elements.class, CLASSES, CORE_CLASSES, 'More classes',
            (c) => c.toLowerCase().replace(/\s/g, '-'));
        fillSelect(form.elements.deity, DEITIES);
        fillQuickLevel(form);
        form.elements.highestLevel.value = '5';
        form.elements.lowestLevel.value = '5';

        // Restore the saved generator form; a corrupt value self-heals instead of
        // killing the rest of the boot.
        try {
            const savedForm = JSON.parse(localStorage.getItem(FORM_KEY) || 'null');
            if (savedForm) {
                for (const [k, v] of Object.entries(savedForm)) {
                    // Disabled controls keep their default; a stale saved value may no longer
                    // be a valid option.
                    if (form.elements[k] && !form.elements[k].disabled) form.elements[k].value = v;
                }
            }
        } catch (err) {
            console.error('Stored generator form was corrupt — clearing it:', err);
            localStorage.removeItem(FORM_KEY);
        }

        syncQuickLevel(form);
        quickLevelSelect(form)?.addEventListener('change', () => applyQuickLevel(form));
        for (const name of ['highestLevel', 'lowestLevel']) {
            form.elements[name].addEventListener('change', () => syncQuickLevel(form));
        }
        document.getElementById('gen-surprise')?.addEventListener('click', () => surpriseMe(form));
        // #44: the guided-create wizard (concept → abilities → generate → finish checklist).
        document.getElementById('gen-guided')?.addEventListener('click',
            () => window.SheetCreate?.open());
        // #43: the combat HUD — one-tap phone/tablet surface over the loaded character.
        document.getElementById('hud-btn')?.addEventListener('click',
            () => window.SheetCombatHud?.openHud());
        document.querySelectorAll('.gen-preset').forEach((btn) => {
            btn.addEventListener('click', () => applyGenPreset(form, btn.dataset.preset));
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            // Deliberately NOT applyQuickLevel(form): the select mirrors on its own change event,
            // so copying again here would only ever flatten a Lowest/Highest range into one level.
            generate(form);
        });
        document.getElementById('render-paste').addEventListener('click', () =>
            loadJsonText(document.getElementById('json-paste').value));
        document.getElementById('json-file').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) file.text().then(loadJsonText);
        });

        rosterSelect().addEventListener('change', (e) => { if (e.target.value) loadCharacter(e.target.value); });
        document.getElementById('save-btn').addEventListener('click', () => saveCurrent());
        document.getElementById('clone-btn').addEventListener('click', () => cloneCurrent());
        document.getElementById('delete-btn').addEventListener('click', deleteCurrent);
        const reconnectChip = document.getElementById('reconnect-chip');
        reconnectChip.addEventListener('click', async () => {
            await window.SheetLibrary.reconnectFolder();
            reconnectChip.classList.toggle('hidden', window.SheetLibrary.status().state !== 'need-permission');
            await refreshRoster();
            const id = localStorage.getItem(CURRENT_KEY);
            if (id && !currentData) loadCharacter(id);
        });

        await window.SheetLibrary?.init();
        reconnectChip.classList.toggle('hidden', window.SheetLibrary?.status().state !== 'need-permission');

        // One-time migration of the pre-library single character slot.
        const legacy = localStorage.getItem(LEGACY_CHAR_KEY);
        if (legacy) {
            try {
                const data = JSON.parse(legacy);
                const record = await window.SheetLibrary.save(data);
                localStorage.setItem(CURRENT_KEY, record.id);
            } catch { /* corrupt legacy slot — drop it */ }
            localStorage.removeItem(LEGACY_CHAR_KEY);
        }

        await refreshRoster();
        const startId = localStorage.getItem(CURRENT_KEY);
        let loaded = false;
        if (startId) {
            const record = await window.SheetLibrary.get(startId);
            if (record) {
                renderSheet(record.data);
                loaded = true;
            }
            await refreshRoster(startId);
        }
        // Nothing to restore: an empty library means a first-time visitor, so show the
        // bundled sample rather than an empty sheet (see loadDemoCharacter).
        if (!loaded) loaded = await loadDemoCharacter();
        // Still nothing: render Settings so themes/backend/folder are visible.
        if (!loaded) renderSheet(null);

        // The details data usually lands after first paint — re-render once so descriptions
        // and the Buffs ledger fill in.
        window.SheetDetails?.ready.then(() => { if (currentData) renderSheet(currentData); });
    });
})();
