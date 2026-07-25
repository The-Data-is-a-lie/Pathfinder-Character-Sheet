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
    } = window.SheetRoster;

    // Generation form, lifted into scripts/generate.js (window.SheetGenerate). backendUrl /
    // togglePanel / FORM_KEY stay shell-owned and are reached via SheetApp.
    const {
        fillSelect, fillGroupedSelect, buildPayload, quickLevelSelect, fillQuickLevel,
        applyQuickLevel, syncQuickLevel, applyGenPreset, surpriseMe, generate, loadJsonText,
    } = window.SheetGenerate;

    // Per-tab renderers, lifted into scripts/tabs/*.js. Each exports its render fn, pulled back
    // here so the TABS array entries stay unchanged.
    const { renderSpheres } = window.SheetTabSpheres;
    const { renderPathOfWar } = window.SheetTabPathOfWar;
    // notes.js is the prose home; ensureProse/renderBioFacts/bindProseTextarea are shared with
    // the Biography tab and others (SheetApp.ensureProse below re-points here for roster.js).
    const {
        tabNotes, ensureProse, renderBioFacts, bindProseTextarea,
    } = window.SheetTabNotes;
    const { renderBiographyVitals } = window.SheetTabBiography;
    const { tabSettings } = window.SheetTabSettings;
    const { tabAttributes } = window.SheetTabAttributes;
    // skills.js owns the skill-math helpers other tabs + modals consume (via SheetApp delegates).
    const {
        parseSkillRanks, ranksForSkill, skillAbilityKey, getSkillAbility, skillBonusEntry,
        setSkillBonus, skillUserBonus, skillMiscBonus, skillRankKey, ranksEditor, renderSkills,
    } = window.SheetTabSkills;
    const { renderSpells } = window.SheetTabSpells;
    const { renderSimpleSheet } = window.SheetSimple;
    // summary.js owns the class/archetype helpers the Features tab (still in the shell) and the
    // modals SheetApp delegates consume.
    const {
        tabSummary, classInfoFor, classLevelFor, setClassInfo, archetypeDescHtml,
    } = window.SheetTabSummary;
    // features.js owns refreshFeatureLedger / featureBuffGroup (modals delegates re-point here).
    const {
        renderFeaturesToolbar, renderFeats, renderTraits, renderClassFeatures,
        refreshFeatureLedger, featureBuffGroup,
    } = window.SheetTabFeatures;
    const { tabCombat } = window.SheetTabCombat;
    const { tabDefenses } = window.SheetTabDefenses;
    // renderUsesControls is consumed by features.js via SheetApp; this re-points its delegate.
    const { renderModifiers, renderUsesControls } = window.SheetTabBuffs;
    // inventory.js owns the gear helpers combat/defenses/simple + modals reach via SheetApp; these
    // destructured names back those delegates.
    const {
        renderGear, inventoryCategory, renderInventoryItemCard, migrateCoreGear,
        addInventoryItem, gearLine, invRerender,
    } = window.SheetTabInventory;

    const LEGACY_CHAR_KEY = 'sheet.characterData'; // pre-library single slot (migrated once)
    const FORM_KEY = 'sheet.formData';
    const BACKEND_KEY = 'sheet.backendUrl';
    const TAB_KEY = 'sheet.activeTab';
    const VIEW_KEY = 'sheet.viewMode'; // 'full' (tabbed) | 'simple' (classic printable sheet)
    // Unset means a first-time visitor, who starts on the simple sheet and with plain-English
    // hints on. Both stick to whatever the user picks after that. The stored view value stays
    // 'full'/'simple' — only the user-facing word for 'full' became "Complex".
    const EXPLAIN_KEY = 'sheet.explainMode'; // '1' | '0'
    const DENSITY_KEY = 'sheet.density';     // 'compact' | unset (comfortable); complex view only
    // Who is holding the sheet. Owns the DEFAULT for every beginner-facing surface below
    // (view, explain, rail, the Start-here card) so there is one place to lean harder into
    // newcomers — or, for an experienced player, to strip the training wheels in one move.
    // Once the user touches an individual toggle, that stored value wins from then on.
    const AUDIENCE_KEY = 'sheet.audience';       // 'beginner' | 'expert'; unset ⇒ beginner
    const START_SEEN_KEY = 'sheet.seenStartHere'; // '1' once the Start-here card has been shown
    const RAIL_OPEN_KEY = 'sheet.railOpen';       // '1' | '0'
    const RAIL_SIZE_KEY = 'sheet.railWidth';      // px; converted to --rail-scale
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
    let guideOverlay = null;

    function openInstructions() {
        if (guideOverlay) {
            guideOverlay.close();
            return;
        }
        if (!window.SheetOverlay || !window.SheetGuide) return;
        guideOverlay = window.SheetOverlay.open({
            title: 'How to use this sheet',
            body: window.SheetGuide.buildInstructions(),
            cls: 'guide-overlay',
            onClose() { guideOverlay = null; },
        });
    }

    // ---------------------------------------------------------------- start here
    // The short on-ramp. "Show me everything" opens the full instructions ON TOP of it — the
    // overlay stack handles that, and Escape peels them back one at a time.
    let startOverlay = null;

    function openStartHere() {
        if (startOverlay) {
            startOverlay.close();
            return;
        }
        if (!window.SheetOverlay || !window.SheetGuide) return;
        localStorage.setItem(START_SEEN_KEY, '1');
        startOverlay = window.SheetOverlay.open({
            title: 'Start here',
            cls: 'start-overlay',
            body: window.SheetGuide.buildStartHere({
                onGenerate() {
                    startOverlay?.close();
                    const panel = document.getElementById('gen-panel');
                    if (panel && panel.classList.contains('hidden')) togglePanel('gen-panel');
                },
                onFull: () => openInstructions(),
                onExpert() {
                    startOverlay?.close();
                    setAudience('expert');
                    // Someone who has played before is exactly who the theme picker was
                    // written for, so it becomes their first screen instead of this one.
                    openThemeModal();
                },
            }),
            onClose() { startOverlay = null; },
        });
    }

    /** First visit only, and only for someone who hasn't said they've played before. */
    function shouldAutoOpenStartHere() {
        return audienceDefault('startHere') && localStorage.getItem(START_SEEN_KEY) !== '1';
    }



    // ---------------------------------------------------------------- form option data
    // Mirrors the Foundry module's generator dialog (button.js) so both clients send the
    // same values to /update_character_data.
    const REGIONS = ['Random', 'Tal-falko', 'Dolestan', 'Sojoria', 'Ieso', 'Spire', 'Feyador',
        'Esterdragon', 'Grundykin Damplands', 'Dust Cairn', 'Kaeru no Tochi'];
    const RACES = ['Random', 'Dwarf', 'Elf', 'Gnome', 'Half-Elf', 'Halfling', 'Half-Orc', 'Human',
        'Aasimar', 'Aquatic Elf', 'Catfolk', 'Changeling', 'Dhampir', 'Drow', 'Fetchling',
        'Gathlain', 'Ghoran', 'Gillman', 'Goblin', 'Grippli', 'Hobgoblin', 'Ifrit', 'Kitsune',
        'Kobold', 'Locathah', 'Merfolk', 'Monkey Goblin', 'Nagaji', 'Orc', 'Oread', 'Ratfolk',
        'Sahuagin', 'Skinwalker', 'Strix', 'Svirfneblin', 'Sylph', 'Syrinx', 'Tengu', 'Tiefling',
        'Triaxian', 'Triton', 'Undine', 'Vanara', 'Vine Leshy', 'Vishkanya', 'Wayang', 'Wyrwood',
        'Wyvaran', 'Yaddithian'];
    // Unlike the Foundry module, the web sheet has no compendium constraint, so Stalker and
    // Zealot are selectable here even while they stay out of the module's class list.
    const CLASSES = ['Random', 'Alchemist', 'Antipaladin', 'Arcanist', 'Barbarian',
        'Barbarian (Unchained)', 'Bard', 'Bloodrager', 'Brawler', 'Cavalier', 'Cleric', 'Druid',
        'Fighter', 'Gunslinger', 'Hunter', 'Inquisitor', 'Investigator', 'Magus', 'Monk',
        'Monk (Unchained)', 'Ninja', 'Oracle', 'Paladin', 'Ranger', 'Rogue', 'Rogue (Unchained)',
        'Samurai', 'Shaman', 'Shifter', 'Skald', 'Slayer', 'Sorcerer', 'Summoner',
        'Summoner (Unchained)', 'Swashbuckler', 'Vigilante', 'Warpriest', 'Witch', 'Wizard',
        'Warlord', 'Warder', 'Harbinger', 'Mystic', 'Medic', 'Stalker', 'Zealot'];
    // Beginner grouping for the quick generate form: these float to a "Common" optgroup and
    // everything else falls into "More…". Membership only — RACES/CLASSES above stay the
    // single source of truth, so a new entry there still shows up (just under More).
    const CORE_RACES = new Set(['Human', 'Elf', 'Dwarf', 'Halfling', 'Gnome', 'Half-Elf', 'Half-Orc']);
    const CORE_CLASSES = new Set(['Fighter', 'Wizard', 'Rogue', 'Cleric', 'Ranger', 'Paladin',
        'Barbarian', 'Bard', 'Druid', 'Monk', 'Sorcerer']);

    const DEITIES = ['random', 'Abadar', 'Achaekek', 'Ahriman', 'Alazhra', 'Alseta', 'Apsu',
        'Arazni', 'Asmodeus', 'Besmara', 'Calistria', 'Cayden Cailean', 'Desna', 'Easivra',
        'Erastil', 'Erecura', 'Gorum', 'Gozreh', 'Groetus', 'Hanspur', 'Iomedae', 'Irori',
        'Kurgess', 'Lamashtu', 'Lissala', 'Nethys', 'Norgorber', 'Pharasma', 'Rovagug',
        'Sarenrae', 'Shelyn', 'Torag', 'Urgathoa', 'Zon-Kuthon', 'Zyphus'];

    // ---------------------------------------------------------------- moved-out kits
    // DOM helpers (h / section / kv / kvStat / titleCase / mod …) live in scripts/ui.js.
    // Derived-stat math (computeDerived / part / saveBuckets …) lives in scripts/derive.js.


    // fmt / toInt / nonEmpty / escapeHtml / highlightInlineRolls / foundry live in ui.js.














    // editableField / kvEdit / dblclickEditable / kvDbl live in ui.js (window.SheetUI).






    /** kv row with total + collapsible source list */
    // kvStat now lives in scripts/ui.js (window.SheetUI).




    /** Roll 1d20+bonus into tools log (opens tools drawer). */
    function rollCheck(label, total) {
        const formula = total >= 0 ? `1d20+${total}` : `1d20${total}`;
        window.SheetRoll?.setOpen?.(true);
        window.SheetRoll?.rollAndLog?.(formula, label);
    }

    function rollBtn(label, total, title) {
        const btn = h('button', 'stat-roll-btn no-print', 'Roll');
        btn.type = 'button';
        btn.title = title || (`1d20${fmt(total)} — ${label}`);
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            rollCheck(label, total);
        });
        return btn;
    }

    /**
     * A "Roll all" bar that fires every per-row Roll button inside `scopeTable` — the buttons
     * already own the totals and log formatting, so bulk rolling stays DRY. Returns the bar.
     */
    function rollAllBar(label, title, scopeTable) {
        const bar = h('div', 'roll-all-bar no-print');
        const btn = h('button', 'roll-all-btn', label);
        btn.type = 'button';
        btn.title = title;
        btn.addEventListener('click', () => {
            const rolls = scopeTable.querySelectorAll('.skill-roll-cell .stat-roll-btn');
            rolls.forEach((b) => b.click());
            toast(`Rolled ${rolls.length} into the Tools log`);
        });
        bar.appendChild(btn);
        return bar;
    }

    function kvSaves(body, d) {
        const b = d.blocks;
        const wrap = h('div', 'saves-block');
        for (const [name, block] of [
            ['Fortitude', b.fort],
            ['Reflex', b.ref],
            ['Will', b.will],
        ]) {
            const row = h('div', 'kv kv-stat save-row');
            const k = h('span', 'k');
            k.append(document.createTextNode(name + ' '), rollBtn(name + ' save', block.total));
            row.appendChild(k);
            const v = h('span', 'v');
            v.appendChild(h('span', 'stat-total', fmt(block.total)));
            if (block.parts?.length) {
                const det = h('details', 'stat-sources');
                det.appendChild(h('summary', null, 'sources'));
                const list = h('ul', 'stat-source-list');
                for (const p of block.parts) {
                    const li = h('li', 'stat-source-line'
                        + (p.unresolved ? ' unresolved' : '')
                        + (p.info ? ' info' : ''));
                    li.append(
                        h('span', 'stat-source-label', p.label),
                        h('span', 'stat-source-value',
                            p.unresolved ? (p.formula || '?') : fmt(Number(p.value) || 0)),
                    );
                    list.appendChild(li);
                }
                det.appendChild(list);
                v.appendChild(det);
            }
            row.appendChild(v);
            wrap.appendChild(row);
        }
        if (d.multiclassSaves) {
            wrap.appendChild(h('p', 'stat-footnote',
                'Class save bases use the first class only (multiclass not fully modeled).'));
        }
        if (!d.savesText) {
            wrap.appendChild(h('p', 'stat-footnote',
                'Unknown class progression — ability mods and feature bonuses only where listed.'));
        }
        const row = h('div', 'kv kv-stat kv-saves');
        row.appendChild(h('span', 'k', 'Saves'));
        const v = h('span', 'v');
        v.appendChild(wrap);
        row.appendChild(v);
        body.appendChild(row);
        return row;
    }

    /**
     * HP: current / max / temp / nonlethal (Foundry-style) + hit-dice edit + sources.
     * Session trackers live on data._sheet; max is derived.
     */
    function kvHp(body, data, d) {
        const block = d.blocks.hp;
        const max = block.total;
        const st = sheetState(data);
        if (st.hpCurrent == null || st.hpCurrent === '') st.hpCurrent = max;
        if (st.hpTemp == null || st.hpTemp === '') st.hpTemp = 0;
        if (st.hpNonlethal == null || st.hpNonlethal === '') st.hpNonlethal = 0;

        const row = h('div', 'kv kv-stat hp-block');
        row.appendChild(h('span', 'k', 'HP'));
        const v = h('span', 'v');

        const boxes = h('div', 'hp-boxes');
        const addBox = (label, key, opts = {}) => {
            const box = h('div', 'hp-box' + (opts.cls ? ' ' + opts.cls : ''));
            box.appendChild(h('span', 'hp-box-label', label));
            if (opts.readonly) {
                box.appendChild(h('span', 'hp-box-value', String(opts.value)));
            } else {
                const edit = dblclickEditable(st, key, {
                    type: 'number',
                    min: opts.min != null ? opts.min : 0,
                    format: (raw) => (raw == null || raw === '' ? '0' : String(raw)),
                    parse: (s) => parseIntLoose(s, 0),
                    onChange: () => quietSave(),
                });
                edit.classList.add('hp-box-edit');
                box.appendChild(edit);
            }
            boxes.appendChild(box);
        };
        const cur = Number(st.hpCurrent) || 0;
        const bloodied = max > 0 && cur <= max / 2;
        addBox('Current', 'hpCurrent', { cls: bloodied ? 'is-bloodied' : '' });
        addBox('Max', null, { readonly: true, value: max });
        addBox('Temp', 'hpTemp');
        addBox('Nonlethal', 'hpNonlethal');
        v.appendChild(boxes);

        if (bloodied) {
            v.appendChild(h('span', 'hp-status-badge', 'Bloodied'));
        }

        const diceEdit = dblclickEditable(data, 'total_rolled_hp', {
            type: 'number',
            min: 0,
            format: (raw) => {
                if (raw == null || raw === '') return 'dice: — (dbl-click to set)';
                return 'dice: ' + raw;
            },
            parse: (s) => parseIntLoose(s, 0),
            onChange: () => {
                const again = computeDerived(data);
                data.Total_HP = again.blocks.hp.total;
                // If current was at old max, bump with max
                if (st.hpCurrent === max || st.hpCurrent == null) {
                    st.hpCurrent = again.blocks.hp.total;
                }
            },
        });
        diceEdit.classList.add('hp-dice-edit');
        v.appendChild(diceEdit);

        const det = h('details', 'stat-sources');
        det.appendChild(h('summary', null, 'sources'));
        const list = h('ul', 'stat-source-list');
        for (const p of block.parts) {
            const li = h('li', 'stat-source-line'
                + (p.info ? ' info' : '')
                + (p.unresolved ? ' unresolved' : ''));
            li.append(
                h('span', 'stat-source-label', p.label),
                h('span', 'stat-source-value',
                    p.unresolved ? (p.formula || '?') : fmt(Number(p.value) || 0)),
            );
            list.appendChild(li);
        }
        if (block.note) list.appendChild(h('li', 'stat-source-note', block.note));
        det.appendChild(list);
        v.appendChild(det);
        row.appendChild(v);
        body.appendChild(row);
        return row;
    }

    // ---------------------------------------------------------------- PF1 conditions tray
    const PF1_CONDITIONS = [
        { id: 'blinded', label: 'Blinded', note: '−2 AC; lose Dex to AC; 50% miss chance' },
        { id: 'confused', label: 'Confused', note: 'Act randomly each turn' },
        { id: 'cowering', label: 'Cowering', note: '−2 AC; lose Dex to AC' },
        { id: 'dazed', label: 'Dazed', note: 'No actions' },
        { id: 'dazzled', label: 'Dazzled', note: '−1 attack & Perception' },
        { id: 'deafened', label: 'Deafened', note: '−4 initiative; 20% spell fail (verbal)' },
        { id: 'entangled', label: 'Entangled', note: '−2 attack; −4 Dex; half speed' },
        { id: 'exhausted', label: 'Exhausted', note: '−6 Str/Dex; half speed' },
        { id: 'fascinated', label: 'Fascinated', note: 'Stand still; −4 Perception' },
        { id: 'fatigued', label: 'Fatigued', note: '−2 Str/Dex; cannot run/charge' },
        { id: 'flat-footed', label: 'Flat-footed', note: 'Lose Dex to AC; no AoO' },
        { id: 'frightened', label: 'Frightened', note: '−2 attacks/saves/skills; must flee' },
        { id: 'grappled', label: 'Grappled', note: '−2 attack/combat man.; −4 Dex' },
        { id: 'helpless', label: 'Helpless', note: 'Dex 0 (−5); coup de grace' },
        { id: 'invisible', label: 'Invisible', note: '+2 attack; deny Dex to targets' },
        { id: 'nauseated', label: 'Nauseated', note: 'Only a single move action' },
        { id: 'panicked', label: 'Panicked', note: '−2; drop items; flee' },
        { id: 'paralyzed', label: 'Paralyzed', note: 'Str/Dex 0; helpless' },
        { id: 'pinned', label: 'Pinned', note: '−4 AC; limited actions' },
        { id: 'prone', label: 'Prone', note: '−4 melee attack; +4 AC vs ranged' },
        { id: 'shaken', label: 'Shaken', note: '−2 attacks/saves/skills/ability checks' },
        { id: 'sickened', label: 'Sickened', note: '−2 attacks/damage/saves/skills' },
        { id: 'staggered', label: 'Staggered', note: 'Single move or standard' },
        { id: 'stunned', label: 'Stunned', note: '−2 AC; drop items; no actions' },
    ];





























    /** Compact AC line: total + touch/ff + sources for each. */
    function kvAc(body, d) {
        const b = d.blocks;
        const row = h('div', 'kv kv-stat');
        row.appendChild(h('span', 'k', 'AC'));
        const v = h('span', 'v');
        v.appendChild(h('span', 'stat-total',
            `${b.ac.total} (touch ${b.touch.total}, flat-footed ${b.flat.total})`));
        const det = h('details', 'stat-sources');
        det.appendChild(h('summary', null, 'sources'));
        const list = h('ul', 'stat-source-list');
        const addGroup = (title, block) => {
            list.appendChild(h('li', 'stat-source-group', title + ' = ' + block.total));
            for (const p of block.parts) {
                const li = h('li', 'stat-source-line'
                    + (p.unresolved ? ' unresolved' : '')
                    + (p.info ? ' info' : ''));
                li.append(
                    h('span', 'stat-source-label', p.label),
                    h('span', 'stat-source-value',
                        p.unresolved ? (p.formula || '?') : fmt(Number(p.value) || 0)),
                );
                list.appendChild(li);
            }
        };
        addGroup('Normal AC', b.ac);
        addGroup('Touch AC', b.touch);
        addGroup('Flat-footed AC', b.flat);
        det.appendChild(list);
        v.appendChild(det);
        row.appendChild(v);
        body.appendChild(row);
        return row;
    }



































    // Full PF1 skill list (display name, ability, optional pf1 id for ledger targets).
    const ALL_SKILLS = [
        { name: 'Acrobatics', ab: 'dex', id: 'acr', acp: true },
        { name: 'Appraise', ab: 'int', id: 'apr' },
        { name: 'Bluff', ab: 'cha', id: 'blf' },
        { name: 'Climb', ab: 'str', id: 'clm', acp: true },
        { name: 'Craft', ab: 'int', id: 'crf' },
        { name: 'Diplomacy', ab: 'cha', id: 'dip' },
        { name: 'Disable Device', ab: 'dex', id: 'dev', acp: true },
        { name: 'Disguise', ab: 'cha', id: 'dis' },
        { name: 'Escape Artist', ab: 'dex', id: 'esc', acp: true },
        { name: 'Fly', ab: 'dex', id: 'fly', acp: true },
        { name: 'Handle Animal', ab: 'cha', id: 'han' },
        { name: 'Heal', ab: 'wis', id: 'hea' },
        { name: 'Intimidate', ab: 'cha', id: 'int' },
        { name: 'Knowledge (Arcana)', ab: 'int', id: 'kar' },
        { name: 'Knowledge (Dungeoneering)', ab: 'int', id: 'kdu' },
        { name: 'Knowledge (Engineering)', ab: 'int', id: 'ken' },
        { name: 'Knowledge (Geography)', ab: 'int', id: 'kge' },
        { name: 'Knowledge (History)', ab: 'int', id: 'khi' },
        { name: 'Knowledge (Local)', ab: 'int', id: 'klo' },
        { name: 'Knowledge (Nature)', ab: 'int', id: 'kna' },
        { name: 'Knowledge (Nobility)', ab: 'int', id: 'kno' },
        { name: 'Knowledge (Planes)', ab: 'int', id: 'kpl' },
        { name: 'Knowledge (Religion)', ab: 'int', id: 'kre' },
        { name: 'Linguistics', ab: 'int', id: 'lin' },
        { name: 'Perception', ab: 'wis', id: 'per' },
        { name: 'Perform', ab: 'cha', id: 'prf' },
        { name: 'Profession', ab: 'wis', id: 'pro' },
        { name: 'Ride', ab: 'dex', id: 'rid', acp: true },
        { name: 'Sense Motive', ab: 'wis', id: 'sen' },
        { name: 'Sleight of Hand', ab: 'dex', id: 'slt', acp: true },
        { name: 'Spellcraft', ab: 'int', id: 'spl' },
        { name: 'Stealth', ab: 'dex', id: 'ste', acp: true },
        { name: 'Survival', ab: 'wis', id: 'sur' },
        { name: 'Swim', ab: 'str', id: 'swm', acp: true },
        { name: 'Use Magic Device', ab: 'cha', id: 'umd' },
    ];










    /**
     * HTML5 drag-and-drop reorder for list containers (Foundry-like item rows).
     * @param {HTMLElement} container
     * @param {string} itemSelector - children that are reorderable
     * @param {(fromIndex: number, toIndex: number) => void} onReorder
     */





























































    /** Currency row: pp / gp / sp / cp (reads legacy platnium typo). */
    function kvCurrency(body, data) {
        // Migrate legacy misspelling once
        if (data.platinum == null && data.platnium != null) {
            data.platinum = data.platnium;
        }
        const row = h('div', 'kv kv-stat currency-row');
        row.appendChild(h('span', 'k', 'Currency'));
        const v = h('span', 'v');
        const boxes = h('div', 'currency-boxes');
        for (const [label, key] of [
            ['pp', 'platinum'],
            ['gp', 'gold'],
            ['sp', 'silver'],
            ['cp', 'copper'],
        ]) {
            if (data[key] == null || data[key] === '') data[key] = key === 'gold' ? (data.gold || 0) : 0;
            const box = h('div', 'currency-box');
            box.appendChild(h('span', 'currency-label', label));
            box.appendChild(dblclickEditable(data, key, {
                type: 'number',
                min: 0,
                format: (raw) => (raw == null || raw === '' ? '0' : String(raw)),
                parse: (s) => parseIntLoose(s, 0),
                onChange: () => {
                    if (key === 'platinum') data.platnium = data.platinum; // keep legacy in sync
                    quietSave();
                },
            }));
            boxes.appendChild(box);
        }
        v.appendChild(boxes);
        row.appendChild(v);
        body.appendChild(row);
        return row;
    }

    // ---------------------------------------------------------------- tab composites
    // emptyState / compose now live in scripts/ui.js (window.SheetUI).

    function summaryCombatStrip(body, data, d) {
        const strip = h('div', 'summary-combat-strip');
        const add = (label, value, opts = {}) => {
            const box = h('div', 'summary-stat-box');
            const head = h('div', 'summary-stat-head');
            head.appendChild(h('span', null, label));
            if (opts.rollTotal != null) {
                head.appendChild(rollBtn(opts.rollLabel || label, opts.rollTotal));
            }
            box.appendChild(head);
            box.appendChild(h('div', 'summary-stat-val', value));
            attachStatHint(box, label);
            strip.appendChild(box);
        };
        add('Init', fmt(d.blocks.init.total), { rollTotal: d.blocks.init.total, rollLabel: 'Initiative' });
        add('BAB', fmt(d.bab));
        add('Melee', fmt(d.blocks.melee.total));
        add('Ranged', fmt(d.blocks.ranged.total));
        add('CMB', fmt(d.blocks.cmb.total), { rollTotal: d.blocks.cmb.total, rollLabel: 'CMB' });
        add('CMD', String(d.blocks.cmd.total));
        const st = sheetState(data);
        if (st.sr == null && data.spell_resistance != null) st.sr = data.spell_resistance;
        if (st.sr == null) st.sr = 0;
        const srBox = h('div', 'summary-stat-box');
        srBox.title = 'SR total (base + feat/trait/class/misc — see Combat → Defenses). Double-click edits the base.';
        srBox.appendChild(h('div', 'summary-stat-head', 'SR'));
        srBox.appendChild(dblclickEditable(st, 'sr', {
            type: 'number', min: 0,
            format: () => String(srTotal(data)),
            parse: (s) => parseIntLoose(s, 0),
            onChange: () => quietSave(),
        }));
        attachStatHint(srBox, 'SR');
        strip.appendChild(srBox);
        body.appendChild(strip);
    }

    function summarySpeeds(body, data) {
        const st = sheetState(data);
        st.speeds ??= {};
        // Seed land from character field
        if (st.speeds.land == null && data.land_speed != null) {
            st.speeds.land = Number(data.land_speed) || 0;
        }
        const row = h('div', 'kv kv-stat');
        row.appendChild(h('span', 'k', 'Speeds (ft)'));
        const v = h('span', 'v');
        const boxes = h('div', 'speed-boxes');
        for (const [key, label] of [
            ['land', 'Land'], ['climb', 'Climb'], ['swim', 'Swim'],
            ['fly', 'Fly'], ['burrow', 'Burrow'],
        ]) {
            if (st.speeds[key] == null || st.speeds[key] === '') st.speeds[key] = key === 'land' ? (Number(data.land_speed) || 30) : 0;
            const box = h('div', 'speed-box');
            box.appendChild(h('span', 'speed-label', label));
            box.appendChild(dblclickEditable(st.speeds, key, {
                type: 'number', min: 0,
                format: (raw) => String(raw == null || raw === '' ? 0 : raw),
                parse: (s) => parseIntLoose(s, 0),
                onChange: () => {
                    if (key === 'land') data.land_speed = st.speeds.land;
                    quietSave();
                },
            }));
            boxes.appendChild(box);
        }
        v.appendChild(boxes);
        row.appendChild(v);
        body.appendChild(row);
    }


    // ------------------------------------------------------------ class & archetype info
    // Built-in PF1 class chassis (best effort — every field is editable per character
    // via _sheet.classInfo overrides in the class popup). classSkills use ALL_SKILLS ids.
    const CLASS_STATS = {
        alchemist: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Good', will: 'Poor', skills: 4, casting: 'Extracts (Int, 6th-level)', weaponProf: 'Simple + bombs', armorProf: 'Light', classSkills: ['apr', 'crf', 'dev', 'fly', 'hea', 'kar', 'kna', 'per', 'pro', 'slt', 'spl', 'sur'] },
        antipaladin: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Good', skills: 2, casting: 'Divine (Cha, 4th-level)', alignment: 'Chaotic evil only', weaponProf: 'Simple, martial', armorProf: 'All armor, shields', classSkills: ['blf', 'crf', 'dis', 'han', 'int', 'kre', 'pro', 'rid', 'sen', 'ste', 'spl'] },
        arcanist: { hd: 6, bab: '1/2', fort: 'Poor', ref: 'Poor', will: 'Good', skills: 2, casting: 'Arcane (Int, 9th-level, prepared-spontaneous)', weaponProf: 'Simple', armorProf: 'None', classSkills: ['apr', 'crf', 'fly', 'kar', 'kdu', 'ken', 'kge', 'khi', 'klo', 'kna', 'kno', 'kpl', 'kre', 'lin', 'pro', 'spl', 'umd'] },
        barbarian: { hd: 12, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Poor', skills: 4, casting: 'None', alignment: 'Any nonlawful', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['acr', 'clm', 'crf', 'han', 'int', 'kna', 'per', 'rid', 'sur', 'swm'] },
        bard: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Good', will: 'Good', skills: 6, casting: 'Arcane (Cha, 6th-level, spontaneous)', weaponProf: 'Simple + bard list', armorProf: 'Light, shields', classSkills: ['acr', 'apr', 'blf', 'clm', 'crf', 'dip', 'dis', 'esc', 'int', 'kar', 'kdu', 'ken', 'kge', 'khi', 'klo', 'kna', 'kno', 'kpl', 'kre', 'lin', 'per', 'prf', 'pro', 'sen', 'slt', 'spl', 'ste', 'umd'] },
        bloodrager: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Poor', skills: 4, casting: 'Arcane (Cha, 4th-level, spontaneous)', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['acr', 'clm', 'crf', 'han', 'int', 'kar', 'per', 'rid', 'spl', 'sur', 'swm'] },
        brawler: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Good', will: 'Poor', skills: 4, casting: 'None', weaponProf: 'Simple + close weapons', armorProf: 'Light, shields', classSkills: ['acr', 'clm', 'crf', 'esc', 'han', 'int', 'kdu', 'klo', 'per', 'pro', 'rid', 'sen', 'swm'] },
        cavalier: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Poor', skills: 4, casting: 'None', weaponProf: 'Simple, martial', armorProf: 'All armor, shields', classSkills: ['blf', 'clm', 'crf', 'dip', 'han', 'int', 'pro', 'rid', 'sen', 'swm'] },
        cleric: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Poor', will: 'Good', skills: 2, casting: 'Divine (Wis, 9th-level, prepared)', weaponProf: 'Simple + deity favored', armorProf: 'Light, medium, shields', classSkills: ['apr', 'crf', 'dip', 'hea', 'kar', 'khi', 'kno', 'kpl', 'kre', 'lin', 'pro', 'sen', 'spl'] },
        druid: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Poor', will: 'Good', skills: 4, casting: 'Divine (Wis, 9th-level, prepared)', alignment: 'Any neutral', weaponProf: 'Druid list', armorProf: 'Light, medium, shields (no metal)', classSkills: ['clm', 'crf', 'fly', 'han', 'hea', 'kge', 'kna', 'per', 'pro', 'rid', 'spl', 'sur', 'swm'] },
        fighter: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Poor', skills: 2, casting: 'None', weaponProf: 'Simple, martial', armorProf: 'All armor, shields (incl. tower)', classSkills: ['clm', 'crf', 'han', 'int', 'kdu', 'ken', 'pro', 'rid', 'sur', 'swm'] },
        gunslinger: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Good', will: 'Poor', skills: 4, casting: 'None', weaponProf: 'Simple, martial + firearms', armorProf: 'Light', classSkills: ['acr', 'blf', 'clm', 'crf', 'han', 'hea', 'int', 'ken', 'klo', 'per', 'pro', 'rid', 'slt', 'sur', 'swm'] },
        hunter: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Good', will: 'Poor', skills: 6, casting: 'Divine (Wis, 6th-level, spontaneous)', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['clm', 'crf', 'han', 'hea', 'int', 'kdu', 'kge', 'kna', 'per', 'pro', 'rid', 'spl', 'ste', 'sur', 'swm'] },
        inquisitor: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Poor', will: 'Good', skills: 6, casting: 'Divine (Wis, 6th-level, spontaneous)', weaponProf: 'Simple + deity favored', armorProf: 'Light, medium, shields', classSkills: ['blf', 'clm', 'crf', 'dip', 'dis', 'hea', 'int', 'kar', 'kdu', 'kna', 'kpl', 'kre', 'per', 'pro', 'rid', 'sen', 'spl', 'ste', 'sur', 'swm'] },
        investigator: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Good', will: 'Good', skills: 6, casting: 'Extracts (Int, 6th-level)', weaponProf: 'Simple + a few martial', armorProf: 'Light', classSkills: ['acr', 'apr', 'blf', 'clm', 'crf', 'dip', 'dev', 'dis', 'esc', 'hea', 'int', 'kar', 'kdu', 'ken', 'kge', 'khi', 'klo', 'kna', 'kno', 'kpl', 'kre', 'lin', 'per', 'pro', 'sen', 'slt', 'spl', 'ste'] },
        magus: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Poor', will: 'Good', skills: 2, casting: 'Arcane (Int, 6th-level, prepared)', weaponProf: 'Simple, martial', armorProf: 'Light (armored casting)', classSkills: ['clm', 'crf', 'dip', 'fly', 'int', 'kar', 'kdu', 'kpl', 'pro', 'rid', 'spl', 'swm', 'umd'] },
        monk: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Good', will: 'Good', skills: 4, casting: 'None', alignment: 'Any lawful', weaponProf: 'Monk weapons', armorProf: 'None', classSkills: ['acr', 'clm', 'crf', 'esc', 'int', 'khi', 'kre', 'per', 'prf', 'pro', 'rid', 'sen', 'ste', 'swm'] },
        'monk (unchained)': { hd: 10, bab: 'Full', fort: 'Good', ref: 'Good', will: 'Poor', skills: 4, casting: 'None', alignment: 'Any lawful', weaponProf: 'Monk weapons', armorProf: 'None', classSkills: ['acr', 'clm', 'crf', 'esc', 'int', 'khi', 'kre', 'per', 'prf', 'pro', 'rid', 'sen', 'ste', 'swm'] },
        ninja: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Good', will: 'Poor', skills: 8, casting: 'None (ki tricks)', weaponProf: 'Simple + ninja weapons', armorProf: 'Light', classSkills: ['acr', 'apr', 'blf', 'clm', 'crf', 'dip', 'dev', 'dis', 'esc', 'int', 'klo', 'kno', 'lin', 'per', 'prf', 'pro', 'sen', 'slt', 'ste', 'swm', 'umd'] },
        oracle: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Poor', will: 'Good', skills: 4, casting: 'Divine (Cha, 9th-level, spontaneous)', weaponProf: 'Simple', armorProf: 'Light, medium, shields', classSkills: ['crf', 'dip', 'hea', 'khi', 'kpl', 'kre', 'pro', 'sen', 'spl'] },
        paladin: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Good', skills: 2, casting: 'Divine (Cha, 4th-level)', alignment: 'Lawful good only', weaponProf: 'Simple, martial', armorProf: 'All armor, shields', classSkills: ['crf', 'dip', 'han', 'hea', 'kno', 'kre', 'pro', 'rid', 'sen', 'spl'] },
        ranger: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Good', will: 'Poor', skills: 6, casting: 'Divine (Wis, 4th-level)', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['clm', 'crf', 'han', 'hea', 'int', 'kdu', 'kge', 'kna', 'per', 'pro', 'rid', 'spl', 'ste', 'sur', 'swm'] },
        rogue: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Good', will: 'Poor', skills: 8, casting: 'None', weaponProf: 'Simple + rogue weapons', armorProf: 'Light', classSkills: ['acr', 'apr', 'blf', 'clm', 'crf', 'dip', 'dev', 'dis', 'esc', 'int', 'kdu', 'klo', 'lin', 'per', 'prf', 'pro', 'sen', 'slt', 'spl', 'ste', 'swm', 'umd'] },
        samurai: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Poor', skills: 4, casting: 'None', weaponProf: 'Simple, martial + katana', armorProf: 'All armor, shields', classSkills: ['blf', 'clm', 'crf', 'dip', 'han', 'int', 'pro', 'rid', 'sen', 'swm'] },
        shaman: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Poor', will: 'Good', skills: 4, casting: 'Divine (Wis, 9th-level, prepared)', weaponProf: 'Simple', armorProf: 'Light, medium (no metal)', classSkills: ['crf', 'dip', 'fly', 'han', 'hea', 'kna', 'kpl', 'kre', 'lin', 'pro', 'rid', 'spl', 'sur'] },
        shifter: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Good', will: 'Poor', skills: 4, casting: 'None', alignment: 'Any neutral', weaponProf: 'Simple + natural attacks', armorProf: 'Light (no metal)', classSkills: ['acr', 'clm', 'crf', 'fly', 'han', 'kna', 'per', 'pro', 'rid', 'ste', 'sur', 'swm'] },
        skald: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Poor', will: 'Good', skills: 4, casting: 'Arcane (Cha, 6th-level, spontaneous)', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['acr', 'apr', 'blf', 'clm', 'crf', 'dip', 'esc', 'han', 'int', 'kar', 'kdu', 'ken', 'kge', 'khi', 'klo', 'kna', 'kno', 'kpl', 'kre', 'lin', 'per', 'prf', 'pro', 'rid', 'sen', 'spl', 'swm', 'umd'] },
        slayer: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Good', will: 'Poor', skills: 6, casting: 'None', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['acr', 'blf', 'clm', 'crf', 'dis', 'han', 'hea', 'int', 'kdu', 'kge', 'klo', 'per', 'pro', 'rid', 'sen', 'ste', 'sur', 'swm'] },
        sorcerer: { hd: 6, bab: '1/2', fort: 'Poor', ref: 'Poor', will: 'Good', skills: 2, casting: 'Arcane (Cha, 9th-level, spontaneous)', weaponProf: 'Simple', armorProf: 'None', classSkills: ['apr', 'blf', 'crf', 'fly', 'int', 'kar', 'pro', 'spl', 'umd'] },
        summoner: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Poor', will: 'Good', skills: 2, casting: 'Arcane (Cha, 6th-level, spontaneous)', weaponProf: 'Simple', armorProf: 'Light', classSkills: ['crf', 'fly', 'han', 'kar', 'kdu', 'ken', 'kge', 'khi', 'klo', 'kna', 'kno', 'kpl', 'kre', 'lin', 'pro', 'rid', 'spl', 'umd'] },
        warpriest: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Poor', will: 'Good', skills: 2, casting: 'Divine (Wis, 6th-level, prepared)', weaponProf: 'Simple, martial + deity favored', armorProf: 'All armor, shields', classSkills: ['clm', 'crf', 'dip', 'han', 'hea', 'int', 'ken', 'kre', 'pro', 'rid', 'sen', 'spl', 'sur', 'swm'] },
        witch: { hd: 6, bab: '1/2', fort: 'Poor', ref: 'Poor', will: 'Good', skills: 2, casting: 'Arcane (Int, 9th-level, prepared)', weaponProf: 'Simple', armorProf: 'None', classSkills: ['crf', 'fly', 'hea', 'int', 'kar', 'khi', 'kna', 'kpl', 'pro', 'spl', 'umd'] },
        wizard: { hd: 6, bab: '1/2', fort: 'Poor', ref: 'Poor', will: 'Good', skills: 2, casting: 'Arcane (Int, 9th-level, prepared)', weaponProf: 'Wizard list', armorProf: 'None', classSkills: ['apr', 'crf', 'fly', 'kar', 'kdu', 'ken', 'kge', 'khi', 'klo', 'kna', 'kno', 'kpl', 'kre', 'lin', 'pro', 'spl'] },
        stalker: { hd: 8, bab: '3/4', fort: 'Poor', ref: 'Good', will: 'Good', skills: 6, casting: 'None', maneuvers: 'Full initiator (Path of War)', weaponProf: 'Simple, martial', armorProf: 'Light', classSkills: ['acr', 'blf', 'clm', 'esc', 'int', 'per', 'sen', 'slt', 'ste', 'sur', 'swm'] },
        warder: { hd: 10, bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Good', skills: 4, casting: 'None', maneuvers: 'Full initiator (Path of War)', weaponProf: 'Simple, martial', armorProf: 'All armor, shields', classSkills: ['acr', 'clm', 'crf', 'dip', 'int', 'kdu', 'ken', 'khi', 'klo', 'kno', 'per', 'pro', 'rid', 'sen', 'swm'] },
        warlord: { hd: 10, bab: 'Full', fort: 'Poor', ref: 'Good', will: 'Poor', skills: 4, casting: 'None', maneuvers: 'Full initiator (Path of War)', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['acr', 'blf', 'clm', 'crf', 'dip', 'han', 'int', 'khi', 'klo', 'per', 'prf', 'pro', 'rid', 'sen', 'swm'] },
        zealot: { hd: 8, bab: '3/4', fort: 'Good', ref: 'Poor', will: 'Good', skills: 4, casting: 'Psionic-flavored (Path of War: Zealot)', maneuvers: 'Full initiator (Path of War)', weaponProf: 'Simple, martial', armorProf: 'Light, medium, shields', classSkills: ['blf', 'clm', 'crf', 'dip', 'hea', 'int', 'khi', 'klo', 'kre', 'per', 'pro', 'sen', 'spl', 'swm'] },
    };
    CLASS_STATS['barbarian (unchained)'] = CLASS_STATS.barbarian;
    CLASS_STATS['rogue (unchained)'] = CLASS_STATS.rogue;

    const DEFAULT_CLASS_INFO = {
        hd: null, bab: '—', fort: '—', ref: '—', will: '—', skills: null,
        casting: '—', maneuvers: '—', fcb: '+1 HP or +1 skill point',
        weaponProf: '—', armorProf: '—', alignment: 'Any', classSkills: [],
    };









    // Previously-used archetype names, persisted across characters ("saved data" the
    // archetype picker offers). Grows as you add archetypes or load characters that have them.
    const USED_ARCHETYPES_KEY = 'sheet.usedArchetypes';



















    /** Brief non-modal confirmation (scripts/overlay.js). No-ops if overlay.js is absent. */
    function toast(text) {
        window.SheetOverlay?.toast?.(text);
    }

    // ---------------------------------------------------------------- audience
    // One switch behind every beginner-facing default. Nothing reads a hard-coded fallback
    // any more — they all come through AUDIENCE_DEFAULTS, so adding or removing "basic
    // stuff" for newcomers is a single-table edit.
    const AUDIENCE_DEFAULTS = {
        beginner: { view: 'simple', explain: true, railOpen: true, startHere: true },
        expert: { view: 'full', explain: false, railOpen: false, startHere: false },
    };

    function audience() {
        return localStorage.getItem(AUDIENCE_KEY) === 'expert' ? 'expert' : 'beginner';
    }

    function audienceDefault(feature) {
        return AUDIENCE_DEFAULTS[audience()][feature];
    }

    /**
     * Explicit command, not a default: switching audience REWRITES the per-feature keys, so
     * "I've played before" strips the training wheels in one move even if the user has
     * already toggled some of them by hand.
     */
    function setAudience(level) {
        const next = level === 'expert' ? 'expert' : 'beginner';
        const want = AUDIENCE_DEFAULTS[next];
        localStorage.setItem(AUDIENCE_KEY, next);
        localStorage.setItem(VIEW_KEY, want.view);
        localStorage.setItem(EXPLAIN_KEY, want.explain ? '1' : '0');
        localStorage.setItem(RAIL_OPEN_KEY, want.railOpen ? '1' : '0');
        applyExplainMode();
        railPanel?.[want.railOpen ? 'open' : 'close']();
        renderSheet(currentData);
        toast(next === 'expert'
            ? '🎓 Beginner helpers are off — turn them back on in Settings'
            : '🌱 Beginner helpers are on');
    }

    // ---------------------------------------------------------------- simple printable sheet
    // Classic paper-style sheet (PZO1110-like): static values, write-in blanks, two print pages.
    function viewMode() {
        const stored = localStorage.getItem(VIEW_KEY);
        if (stored === 'simple' || stored === 'full') return stored;
        return audienceDefault('view');
    }

    function setViewMode(mode) {
        localStorage.setItem(VIEW_KEY, mode === 'simple' ? 'simple' : 'full');
        syncPrimaryActions();
    }

    // ---------------------------------------------------------------- explain mode
    // Plain-English sublabels (see scripts/guide.js) on stat labels in BOTH views. Purely a
    // body class so toggling never re-renders — in-flight edits and scroll position survive.
    function explainMode() {
        const stored = localStorage.getItem(EXPLAIN_KEY);
        if (stored === '1' || stored === '0') return stored === '1';
        return audienceDefault('explain');
    }

    function applyExplainMode() {
        document.body.classList.toggle('explain', explainMode());
    }

    // Compact density: a power-user preference that tightens the tabbed (complex) view's
    // tables and type. Like explain, it is purely a body class, so it never re-renders and
    // leaves the simple/print sheets (which use .simple-*) untouched.
    function densityCompact() {
        return localStorage.getItem(DENSITY_KEY) === 'compact';
    }

    function applyDensity() {
        document.body.classList.toggle('density-compact', densityCompact());
    }

    function setDensityCompact(on) {
        localStorage.setItem(DENSITY_KEY, on ? 'compact' : 'comfortable');
        applyDensity();
    }

    function setExplainMode(on) {
        localStorage.setItem(EXPLAIN_KEY, on ? '1' : '0');
        applyExplainMode();
        syncPrimaryActions();
        // The button colour alone is easy to miss, and if you happen to be looking at a part
        // of the sheet with no glossary hits, nothing else visibly changes.
        toast(on
            ? '💡 Explain is ON — plain-English notes now show under the numbers'
            : '💡 Explain is OFF — just the numbers now');
    }

    // termHint / attachStatHint now live in scripts/ui.js (window.SheetUI).

    // ---------------------------------------------------------------- primary actions
    // The three-and-a-bit beginner actions, declared once and rendered into both the top bar
    // and the right-hand rail so the two surfaces can never disagree about state or wording.
    const PRIMARY_ACTIONS = [
        {
            id: 'generate',
            kind: 'button',
            icon: '🎲',
            label: 'Generate',
            hint: 'Make a new character',
            run: () => togglePanel('gen-panel'),
        },
        {
            id: 'view',
            kind: 'segmented',
            icon: '🔀',
            label: 'View',
            hint: 'Swap between the one-page sheet and the detailed tabs',
            segments: [
                { value: 'simple', label: 'Simple', hint: 'One page, like a paper sheet' },
                { value: 'full', label: 'Complex', hint: 'Every detail, across tabs' },
            ],
            current: () => viewMode(),
            pick: (value) => {
                if (viewMode() === value) return;
                setViewMode(value);
                renderSheet(currentData);
            },
        },
        {
            id: 'explain',
            kind: 'button',
            icon: '💡',
            label: 'Explain',
            hint: 'Show or hide plain-English notes under the numbers',
            pressed: () => explainMode(),
            run: () => setExplainMode(!explainMode()),
        },
        {
            // The short on-ramp, not the manual — the manual is one click deeper, inside it.
            id: 'start',
            kind: 'button',
            icon: '❓',
            label: 'Start here',
            hint: 'Four steps to your first character',
            run: () => openStartHere(),
        },
    ];

    function renderPrimaryActions(host, variant) {
        if (!host) return;
        host.innerHTML = '';
        host.classList.add('primary-actions', 'primary-actions-' + variant);
        for (const action of PRIMARY_ACTIONS) {
            if (action.kind === 'segmented') {
                const group = h('div', 'view-segmented');
                group.setAttribute('role', 'group');
                group.setAttribute('aria-label', action.hint);
                if (variant === 'rail') {
                    group.appendChild(h('span', 'view-segmented-cap', action.icon + ' ' + action.label));
                }
                const active = action.current();
                for (const seg of action.segments) {
                    const on = seg.value === active;
                    const btn = h('button', 'view-seg' + (on ? ' is-on' : ''));
                    btn.type = 'button';
                    btn.title = seg.hint;
                    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                    btn.appendChild(h('span', 'view-seg-dot', on ? '●' : ''));
                    btn.appendChild(h('span', 'view-seg-label', seg.label));
                    btn.addEventListener('click', () => action.pick(seg.value));
                    group.appendChild(btn);
                }
                host.appendChild(group);
                continue;
            }
            const btn = h('button', 'primary-action pa-' + action.id);
            btn.type = 'button';
            btn.title = action.hint;
            if (action.id === 'generate') btn.id = variant === 'topbar' ? 'toggle-gen' : 'rail-gen';
            if (action.pressed) {
                const on = action.pressed();
                btn.classList.toggle('is-on', on);
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            }
            btn.appendChild(h('span', 'pa-icon', action.icon));
            btn.appendChild(h('span', 'pa-label', action.label));
            btn.addEventListener('click', action.run);
            host.appendChild(btn);
        }
    }

    function syncPrimaryActions() {
        renderPrimaryActions(document.getElementById('topbar-primary'), 'topbar');
        // #rail-actions, not #action-rail — renderPrimaryActions clears its host, and the
        // resize grip is a sibling that has to survive every repaint.
        renderPrimaryActions(document.getElementById('rail-actions'), 'rail');
    }

    // ---------------------------------------------------------------- action rail
    // Same drag / collapse behaviour as the left Tools drawer, from the same module. The one
    // difference: the measured width drives --rail-scale rather than a raw width, because the
    // rail is sized off that single knob (styles/sheet.css) — so dragging it wider grows the
    // icons and labels too, which is what "make it bigger" means to a newcomer.
    const RAIL_UNIT = 104;          // px per 1.0 of --rail-scale (6.5rem at a 16px root)
    const RAIL_MIN_SCALE = 1.0;     // compact but still legible
    const RAIL_MAX_SCALE = 3.5;
    const RAIL_DEFAULT_W = Math.round(RAIL_UNIT * 2.5);  // the scale the rail shipped with
    let railPanel = null;

    function initRail() {
        const rail = document.getElementById('action-rail');
        const toggleBtn = document.getElementById('rail-toggle');
        if (!rail || !window.SheetEdgePanel) return;
        const narrow = () => window.matchMedia('(max-width: 899px)').matches;
        railPanel = window.SheetEdgePanel.attach({
            side: 'right',
            panel: rail,
            handle: toggleBtn,
            grip: document.getElementById('rail-resize'),
            openClass: 'rail-open',
            resizingClass: 'rail-resizing',
            keys: { open: RAIL_OPEN_KEY, size: RAIL_SIZE_KEY },
            min: Math.round(RAIL_UNIT * RAIL_MIN_SCALE),
            max: Math.round(RAIL_UNIT * RAIL_MAX_SCALE),
            closeAt: 90,
            defaultSize: RAIL_DEFAULT_W,
            defaultOpen: audienceDefault('railOpen'),
            applySize: (px) => {
                const scale = Math.max(RAIL_MIN_SCALE,
                    Math.min(RAIL_MAX_SCALE, px / RAIL_UNIT));
                document.documentElement.style.setProperty('--rail-scale', scale.toFixed(3));
            },
            onToggle: (open) => {
                if (toggleBtn) {
                    toggleBtn.title = (open ? 'Hide the main actions' : 'Show the main actions')
                        + (narrow() ? '' : ' · hold and drag to resize');
                }
            },
            // A full-width bottom bar has no horizontal extent to drag; tap to collapse only.
            dragDisabled: narrow,
        });
    }

    function togglePanel(id) {
        const panel = document.getElementById(id);
        if (!panel) return;
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) {
            panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

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
        { id: 'buffs', label: 'Buffs', render: (d) => renderModifiers(d) },
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
        const sheet = document.getElementById('sheet');
        sheet.innerHTML = '';
        if (!data || typeof data !== 'object' || data.error) {
            sheet.appendChild(h('p', 'placeholder error', data?.error ? 'Backend error: ' + data.error : 'No character yet — hit Generate or Load JSON above.'));
            sheet.appendChild(tabSettings()); // themes, folder, backend stay reachable without a character
            syncThemeControls(themePreference());
            window.sheetChanges = { changes: [], notes: [], conditionals: [] };
            window.SheetRoll?.setCharacter(null);
            return;
        }

        // Hydrate equipment (and re-fill empty non-customized changes from compendium)
        // before any tab computes AC / attacks / buffs.
        ensureInventoryObjects(data);
        // Seed the Inherent / Level-up / Racial columns from the generator before any ability math.
        seedBackendStatBonuses(data);
        seedRacialColumn(data);

        if (viewMode() === 'simple') {
            sheet.appendChild(renderSimpleSheet(data));
            wrapWideTables(sheet);
            syncThemeControls(themePreference());
            window.SheetRoll?.setCharacter(data);
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
        togglePanel: (id) => togglePanel(id),
        get FORM_KEY() { return FORM_KEY; },
        // Shared roll-UI helpers, used by many tab modules (attributes/combat/summary/skills/…).
        rollBtn: (...a) => rollBtn(...a),
        rollAllBar: (...a) => rollAllBar(...a),
        rollCheck: (...a) => rollCheck(...a),
        // summary.js's classInfoFor reads these PF1 class-chassis data tables (kept in the shell
        // because they carry post-init statements).
        get CLASS_STATS() { return CLASS_STATS; },
        get DEFAULT_CLASS_INFO() { return DEFAULT_CLASS_INFO; },
        // PF1 conditions table, shared by the Defenses (condition immunities) and Buffs
        // (conditions tray) tabs.
        get PF1_CONDITIONS() { return PF1_CONDITIONS; },
        // Shell helpers simple.js reads (kvHp is a live stat builder; gear helpers are inventory's,
        // to be re-pointed when inventory.js is extracted).
        kvHp: (...a) => kvHp(...a),
        gearLine: (...a) => gearLine(...a),
        addInventoryItem: (...a) => addInventoryItem(...a),
        renderUsesControls: (...a) => renderUsesControls(...a),
        renderInventoryItemCard: (...a) => renderInventoryItemCard(...a),
        migrateCoreGear: (...a) => migrateCoreGear(...a),
        // settings.js late-binds the shell view-state getters/setters + the backend key.
        viewMode: () => viewMode(),
        setViewMode: (m) => setViewMode(m),
        explainMode: () => explainMode(),
        setExplainMode: (v) => setExplainMode(v),
        densityCompact: () => densityCompact(),
        setDensityCompact: (v) => setDensityCompact(v),
        get BACKEND_KEY() { return BACKEND_KEY; },
        // state.js late-binds these (renderSheet / saveCurrent are shell-owned).
        renderSheet: (d) => renderSheet(d),
        saveCurrent: (opts) => saveCurrent(opts),
        // theme.js late-binds the shell's onboarding/audience surface.
        audience: () => audience(),
        audienceDefault: (f) => audienceDefault(f),
        setAudience: (l) => setAudience(l),
        openStartHere: () => openStartHere(),
        openInstructions: () => openInstructions(),
        shouldAutoOpenStartHere: () => shouldAutoOpenStartHere(),
        // modals.js late-binds these tab/shell helpers (each moves to its tab module later,
        // when the shell re-points the delegate). ALL_SKILLS is shared with the Skills tab.
        setActiveTab: (id) => setActiveTab(id),
        inventoryCategory: (...a) => inventoryCategory(...a),
        invRerender: (...a) => invRerender(...a),
        skillAbilityKey: (...a) => skillAbilityKey(...a),
        setClassInfo: (...a) => setClassInfo(...a),
        classInfoFor: (...a) => classInfoFor(...a),
        classLevelFor: (...a) => classLevelFor(...a),
        refreshFeatureLedger: (...a) => refreshFeatureLedger(...a),
        featureBuffGroup: (...a) => featureBuffGroup(...a),
        skillBonusEntry: (...a) => skillBonusEntry(...a),
        setSkillBonus: (...a) => setSkillBonus(...a),
        archetypeDescHtml: (...a) => archetypeDescHtml(...a),
        get ALL_SKILLS() { return ALL_SKILLS; },
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
        document.getElementById('print-btn').addEventListener('click', () => window.print());
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
        document.querySelectorAll('.gen-preset').forEach((btn) => {
            btn.addEventListener('click', () => applyGenPreset(form, btn.dataset.preset));
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            applyQuickLevel(form);
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
