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





    function doRest(data) {
        if (!data) return;
        const st = sheetState(data);
        if (Array.isArray(data.day_list)) {
            st.spellCastsRemaining = data.day_list.map((n) => Number(n) || 0);
        }
        if (st.featureUses && typeof st.featureUses === 'object') {
            for (const u of Object.values(st.featureUses)) {
                if (u && u.max != null) u.value = Number(u.max) || 0;
            }
        }
        const maxSp = st.spellPointsMax != null
            ? Number(st.spellPointsMax)
            : (Number(data.sphere_mana_pool) || null);
        if (maxSp != null && Number.isFinite(maxSp)) {
            st.spellPointsMax = maxSp;
            st.spellPointsCurrent = maxSp;
        }
        quietSave();
        window.SheetRoll?.setOpen?.(true);
        window.SheetRoll?.rollAndLog?.('d1', 'Rest — daily resources restored');
        renderSheet(data);
    }










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
        if (currentData === data) {
            renderSheet(data);
            setActiveTab('spells');
        }
    }

    function featureUsesEntry(data, name) {
        const st = sheetState(data);
        st.featureUses ??= {};
        if (!st.featureUses[name]) st.featureUses[name] = { value: 0, max: 0 };
        return st.featureUses[name];
    }

    function renderUsesControls(data, name) {
        const u = featureUsesEntry(data, name);
        const wrap = h('span', 'uses-controls no-print');
        const label = h('span', 'uses-label', `${u.value || 0}/${u.max || 0}`);
        const bag = { max: u.max || 0 };
        const maxEdit = dblclickEditable(bag, 'max', {
            type: 'number', min: 0, max: 99,
            format: (v) => 'max ' + (v || 0),
            parse: (s) => parseIntLoose(s, 0),
            onChange: (v) => {
                const n = Number(v) || 0;
                u.max = n;
                if (u.value > n) u.value = n;
                if (n > 0 && !u.value) u.value = n;
                quietSave();
                label.textContent = `${u.value || 0}/${u.max || 0}`;
            },
        });
        const dec = h('button', 'inv-btn uses-dec', '−');
        dec.type = 'button';
        dec.title = 'Spend one use';
        dec.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if ((u.value || 0) <= 0) return;
            u.value -= 1;
            quietSave();
            label.textContent = `${u.value || 0}/${u.max || 0}`;
        });
        wrap.append(label, dec, maxEdit);
        return wrap;
    }

    function renderConditionsTray(body, data) {
        body.appendChild(h('h3', null, 'Conditions'));
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Click to toggle. Double-click an active chip to set a duration note.'));
        const grid = h('div', 'conditions-grid no-print');
        const active = activeConditions(data);
        const st = sheetState(data);
        st.conditionDurations ??= {};
        for (const c of PF1_CONDITIONS) {
            const on = active.has(c.id);
            const dur = st.conditionDurations[c.id];
            const btn = h('button', 'condition-chip' + (on ? ' is-active' : ''),
                c.label + (on && dur ? ` (${dur})` : ''));
            btn.type = 'button';
            btn.title = c.note + (on ? ' — click clear · dbl-click duration' : ' — click to activate');
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            btn.addEventListener('click', () => {
                setConditionActive(data, c.id, !on);
                if (on) delete st.conditionDurations[c.id];
                renderSheet(data);
                setActiveTab('buffs');
            });
            btn.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!activeConditions(data).has(c.id)) setConditionActive(data, c.id, true);
                const next = prompt('Duration note (e.g. 5 rounds):',
                    st.conditionDurations[c.id] || '');
                if (next == null) return;
                if (String(next).trim()) st.conditionDurations[c.id] = String(next).trim();
                else delete st.conditionDurations[c.id];
                quietSave();
                renderSheet(data);
                setActiveTab('buffs');
            });
            grid.appendChild(btn);
        }
        body.appendChild(grid);
        const activeList = PF1_CONDITIONS.filter((c) => active.has(c.id));
        if (activeList.length) {
            body.appendChild(h('p', 'conditions-active-summary',
                'Active: ' + activeList.map((c) => {
                    const d = st.conditionDurations[c.id];
                    return c.label + (d ? ` (${d})` : '');
                }).join(', ')));
        }
    }








    const PASSIVE_KIND_TAGS = {
        feat: 'Feat', trait: 'Trait', classFeat: 'Class', item: 'Item', talent: 'Talent',
    };

    /**
     * Always-on source (feat/trait/item/class feature) as a row in the Permanent buff
     * section: Active checkbox toggles it in sheet math, × deletes it (restorable).
     */
    function renderPassiveSourceRow(data, g) {
        const SD = window.SheetDetails;
        const active = isBuffSourceActive(data, g.source, g.sourceKind);
        const row = h('div', 'buffs-row buffs-row-derived' + (active ? '' : ' buff-off'));
        const nameCell = h('div', 'buffs-col-name');
        const nameLine = h('span', 'buff-source-name', g.source || '?');
        nameCell.appendChild(nameLine);
        nameCell.appendChild(h('span', 'feat-tag buff-kind-tag',
            PASSIVE_KIND_TAGS[g.sourceKind] || 'Other'));
        const bits = g.lines.map((c) => formatChangeLine(c, SD)).join('; ');
        if (bits) nameCell.appendChild(h('div', 'buff-source-effects', bits));
        // Situational notes from this source surface on hover (they also hover on the
        // relevant skill / attack rows via notesForTargets).
        const srcNotes = [...new Set((window.sheetChangesFull?.notes || [])
            .filter((n) => n.source === g.source && n.sourceKind === g.sourceKind)
            .map((n) => String(n.text || '').replace(/<[^>]*>/g, '').trim())
            .filter(Boolean))];
        if (srcNotes.length) row.title = 'Situational: ' + srcNotes.join('; ');
        row.appendChild(nameCell);

        row.appendChild(h('span', 'buffs-col-dur', 'Permanent'));
        row.appendChild(h('span', 'buffs-col-lv', '—'));

        const activeCell = h('label', 'buffs-col-active');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = active;
        cb.title = active ? 'Active — applied to sheet math' : 'Inactive';
        cb.addEventListener('change', () => {
            setBuffSourceActive(data, g.source, g.sourceKind, cb.checked);
            setActiveTab('buffs');
        });
        activeCell.appendChild(cb);
        row.appendChild(activeCell);

        const ctrl = h('div', 'buffs-col-ctrl no-print');
        const rm = h('button', 'inv-btn inv-btn-danger', '×');
        rm.type = 'button';
        rm.title = 'Delete this source from the sheet math and list';
        rm.addEventListener('click', () => {
            if (!confirm(`Delete “${g.source}”? Its modifiers stop applying (restorable via the button below).`)) return;
            removeBuffSource(data, g.source, g.sourceKind);
            setActiveTab('buffs');
        });
        ctrl.appendChild(rm);
        row.appendChild(ctrl);
        return row;
    }

    function renderBuffSections(body, data, passive = { groups: [], removed: [] }) {
        const buffs = ensureBuffs(data);
        const SD = window.SheetDetails;

        body.appendChild(h('h3', null, 'Buffs'));
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Grouped by category. Active checkbox applies changes. Duration & level are session bookkeeping.'));

        // Column legend
        const legend = h('div', 'buffs-col-legend no-print');
        legend.innerHTML = '<span class="buffs-col-name">Name</span>'
            + '<span class="buffs-col-dur">Duration</span>'
            + '<span class="buffs-col-lv">Level</span>'
            + '<span class="buffs-col-active">Active</span>'
            + '<span class="buffs-col-ctrl"></span>';
        body.appendChild(legend);

        for (const sec of BUFF_SUBTYPES) {
            const sectionEl = h('div', 'buffs-section');
            sectionEl.dataset.buffSubtype = sec.id;
            const head = h('div', 'buffs-section-head');
            head.appendChild(h('h4', 'buffs-section-title', sec.label));
            const headCtrl = h('div', 'buffs-section-controls no-print');
            const addBtn = h('button', 'inv-btn inv-btn-primary', '+');
            addBtn.type = 'button';
            addBtn.title = 'Create ' + sec.label.toLowerCase() + ' buff';
            addBtn.addEventListener('click', () => {
                createBuff(data, { name: 'New ' + sec.label.toLowerCase() + ' buff', subType: sec.id });
                renderSheet(data);
                setActiveTab('buffs');
            });
            const browseBtn = h('button', 'inv-btn', 'Browse');
            browseBtn.type = 'button';
            browseBtn.title = 'Add from catalog into ' + sec.label;
            browseBtn.addEventListener('click', () => {
                openCatalogPicker({
                    title: 'Add ' + sec.label.toLowerCase() + ' buff',
                    kinds: ['feats', 'items'],
                    allowCustom: true,
                    customPlaceholder: 'Custom buff name',
                    onPick: (hit) => {
                        addBuffFromCatalog(data, hit.name, hit.entry, sec.id);
                        renderSheet(data);
                        setActiveTab('buffs');
                    },
                    onCustom: (name) => {
                        createBuff(data, { name, subType: sec.id });
                        renderSheet(data);
                        setActiveTab('buffs');
                    },
                });
            });
            headCtrl.append(addBtn, browseBtn);
            head.appendChild(headCtrl);
            sectionEl.appendChild(head);

            const items = buffs.filter((b) => b.subType === sec.id);
            // Always-on sources (feats/traits/items/class features) live in Permanent
            const derived = sec.id === 'perm' ? (passive.groups || []) : [];
            const list = h('div', 'buffs-list');
            if (!items.length && !derived.length) {
                list.appendChild(h('p', 'tools-empty buffs-empty', 'No ' + sec.label.toLowerCase() + ' buffs.'));
            } else {
                for (const buff of items) {
                    const row = h('div', 'buffs-row' + (buff.active === false ? ' buff-off' : ''));
                    const nameCell = h('div', 'buffs-col-name');
                    nameCell.appendChild(h('span', 'buff-source-name', buff.name));
                    const bits = (buff.changes || []).map((c) => formatChangeLine(c, SD)).join('; ');
                    if (bits) {
                        nameCell.appendChild(h('div', 'buff-source-effects', bits));
                    }
                    if (buff.notes) {
                        nameCell.appendChild(h('div', 'dim buff-notes-preview', buff.notes));
                    }
                    row.appendChild(nameCell);

                    row.appendChild(h('span', 'buffs-col-dur', formatBuffDuration(buff)));

                    const lvCell = h('span', 'buffs-col-lv');
                    lvCell.appendChild(dblclickEditable(buff, 'level', {
                        type: 'number', min: 0, max: 40,
                        format: (v) => (v == null || v === '' || Number(v) === 0 ? '—' : String(v)),
                        parse: (s) => parseIntLoose(s, 0),
                        onChange: () => quietSave(),
                    }));
                    row.appendChild(lvCell);

                    const activeCell = h('label', 'buffs-col-active');
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = buff.active !== false;
                    cb.title = buff.active !== false ? 'Active — applied to sheet math' : 'Inactive';
                    cb.addEventListener('change', () => {
                        buff.active = cb.checked;
                        quietSave();
                        renderSheet(data);
                        setActiveTab('buffs');
                    });
                    activeCell.appendChild(cb);
                    row.appendChild(activeCell);

                    const ctrl = h('div', 'buffs-col-ctrl no-print');
                    const editBtn = h('button', 'inv-btn', 'Edit');
                    editBtn.type = 'button';
                    editBtn.addEventListener('click', () => openBuffEditor(data, buff, row));
                    const dupBtn = h('button', 'inv-btn', '⧉');
                    dupBtn.type = 'button';
                    dupBtn.title = 'Duplicate buff';
                    dupBtn.addEventListener('click', () => {
                        createBuff(data, {
                            name: (buff.name || 'Buff') + ' (copy)',
                            subType: buff.subType,
                            active: false,
                            level: buff.level,
                            duration: { ...buff.duration },
                            changes: cloneChanges(buff.changes),
                            notes: buff.notes,
                            seedDefault: false,
                        });
                        renderSheet(data);
                        setActiveTab('buffs');
                    });
                    const rm = h('button', 'inv-btn inv-btn-danger', '×');
                    rm.type = 'button';
                    rm.title = 'Delete buff';
                    rm.addEventListener('click', () => {
                        if (!confirm(`Delete buff “${buff.name}”?`)) return;
                        const arr = ensureBuffs(data);
                        let i = arr.indexOf(buff);
                        if (i < 0) i = arr.findIndex((x) => x?.id === buff.id);
                        if (i >= 0) arr.splice(i, 1);
                        quietSave();
                        renderSheet(data);
                        setActiveTab('buffs');
                    });
                    ctrl.append(editBtn, dupBtn, rm);
                    row.appendChild(ctrl);
                    list.appendChild(row);
                }
            }
            for (const g of derived) list.appendChild(renderPassiveSourceRow(data, g));
            sectionEl.appendChild(list);
            if (sec.id === 'perm' && (passive.removed || []).length) {
                const restore = h('button', 'inv-btn no-print',
                    'Restore removed sources (' + passive.removed.length + ')');
                restore.type = 'button';
                restore.title = 'Bring back: ' + passive.removed.map((g) => g.source).join(', ');
                restore.addEventListener('click', () => {
                    restoreRemovedBuffSources(data);
                    setActiveTab('buffs');
                });
                sectionEl.appendChild(restore);
            }
            body.appendChild(sectionEl);
        }
    }

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

    const gearLine = (name, enhList) => name && name.trim()
        ? name + (nonEmpty(enhList) ? ' [' + enhList.join(', ') + ']' : '') : null;







    // Foundry-like Buffs tab: Conditions → Buff sections (Permanent holds always-on sources)
    function renderModifiers(data) {
        const SD = window.SheetDetails;
        const { sec, body } = section('Buffs & Conditions', 'modifiers buffs-tab');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Conditions strip, then buffs by category (toggle Active). Always-on modifiers from feats, traits, items, and class features live under Permanent.'));

        // 1) Conditions (Foundry buffs-conditions)
        renderConditionsTray(body, data);

        // Ledger first: the Permanent section lists always-on sources as rows.
        let passive = { groups: [], removed: [] };
        let ledger = null;
        if (SD) {
            ledger = SD.collectChanges(data);
            window.sheetChangesFull = ledger;
            window.sheetChanges = effectiveLedger(data);
            const passiveChanges = (ledger.changes || []).filter((c) => c.sourceKind !== 'buff');
            const allGroups = groupChangesBySource(passiveChanges);
            passive = {
                groups: allGroups.filter((g) => !isBuffSourceRemoved(data, g.source, g.sourceKind)),
                removed: allGroups.filter((g) => isBuffSourceRemoved(data, g.source, g.sourceKind)),
            };
        }

        // 2) Foundry-style buff item sections
        renderBuffSections(body, data, passive);

        if (!SD) {
            body.appendChild(h('p', 'tools-empty', 'Item details not loaded yet — permanent sources unavailable.'));
            return sec;
        }

        // Print: active modifiers by target
        const activeChanges = effectiveLedger(data).changes;
        if (activeChanges.length) {
            body.appendChild(h('h3', 'print-only', 'Active modifiers (print)'));
            const byTarget = {};
            for (const c of activeChanges) (byTarget[SD.targetLabel(c.target)] ??= []).push(c);
            for (const [label, clist] of Object.entries(byTarget).sort((a, b) => a[0].localeCompare(b[0]))) {
                const line = h('div', 'mod-line print-only');
                line.appendChild(h('span', 'mod-target', label + ': '));
                line.appendChild(h('span', null, clist.map((c) => {
                    const t = SD.typeLabel(c.type);
                    const num = /^-?\d+$/.test(String(c.formula).trim())
                        ? fmt(Number(c.formula)) : String(c.formula);
                    return `${num}${t ? ' ' + t : ''} (${c.source})`;
                }).join(', ')));
                body.appendChild(line);
            }
        }

        // Situational notes render as ⓘ hover tooltips on the relevant skill / attack
        // rows (notesForTargets) — no panel here.

        // Per-roll conditionals — pointer only
        if (ledger.conditionals.length) {
            body.appendChild(h('p', 'dim buffs-cond-pointer',
                ledger.conditionals.length + ' per-roll conditionals — toggle them on the Combat / Tools attack panel, not here.'));
        }
        return sec;
    }





    function addInventoryItem(data, name) {
        const nm = String(name || '').trim();
        if (!nm) return null;
        ensureInventoryObjects(data);
        const foundry = window.SheetDetails?.lookupItem?.(nm);
        const item = {
            id: 'eq:' + nm.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(),
            name: foundry?.name || nm,
            equipped: true,
            carried: true,
            identified: true,
            quantity: 1,
            weight: foundry?.weight != null ? Number(foundry.weight) : null,
            price: foundry?.price != null ? Number(foundry.price) : null,
            description: foundry?.description || '',
            changes: cloneChanges(foundry?.changes),
            contextNotes: (foundry?.contextNotes || []).map((n) => ({ ...n })),
            changesCustomized: false,
            subType: foundry?.subType || '',
            equipmentSubtype: foundry?.equipmentSubtype || '',
            armor: foundry?.armor ? { ...foundry.armor } : null,
            slot: foundry?.slot || '',
            itemType: foundry?.itemType || '',
            containerId: null,
        };
        data.equipment_list.push(item);
        if (item.description) (data.equip_descrip ??= {})[item.name] = item.description;
        quietSave();
        return item;
    }





    /**
     * One-time migration: the generated weapon / armor / shield (weapon_name & co.)
     * become regular equipment_list items with full item sheets. Combat math keeps
     * reading data.weapon_name — only the inventory display moves into the list.
     */
    function migrateCoreGear(data) {
        const st = (data._sheet ??= {});
        if (st.coreGearMigrated) return;
        st.coreGearMigrated = true;
        const list = ensureInventoryObjects(data);
        let touched = false;
        const seed = (name, enhList, slot) => {
            const nm = String(name || '').trim();
            if (!nm || /^(none|n\/a|-)$/i.test(nm)) return;
            const display = gearLine(nm, enhList) || nm;
            const has = (v) => list.some((it) =>
                String(it.name).toLowerCase() === String(v).toLowerCase());
            if (has(display) || has(nm)) return;
            const it = addInventoryItem(data, nm); // hydrates from the compendium
            if (!it) return;
            if (display !== nm) it.name = display; // keep the enhancement suffix visible
            if (!it.slot) it.slot = slot;
            if (!it.itemType) it.itemType = slot === 'weapon' ? 'weapon' : 'equipment';
            it.equipped = true;
            touched = true;
        };
        seed(data.weapon_name, data.weapon_enhancement_chosen_list, 'weapon');
        seed(data.armor_name, data.armor_enhancement_chosen_list, 'armor');
        seed(data.shield_name, data.shield_enhancement_chosen_list, 'shield');
        if (touched) quietSave();
    }








    /** Foundry-style inventory category for grouping. */
    function inventoryCategory(item) {
        const t = String(item.itemType || '').toLowerCase();
        const slot = String(item.slot || '').toLowerCase();
        const sub = String(item.subType || '').toLowerCase();
        if (t === 'weapon' || slot === 'weapon' || sub === 'weapon') return 'weapons';
        if (t === 'armor' || slot === 'armor' || slot === 'shield'
            || sub === 'armor' || sub === 'shield') return 'armor';
        if (t === 'container' || sub === 'container') return 'containers';
        if (t === 'consumable' || sub === 'potion' || sub === 'scroll' || sub === 'wand'
            || sub === 'consumable') return 'consumables';
        if (t === 'equipment' || t === 'loot' || t === 'implants') return 'equipment';
        const SD = window.SheetDetails;
        if (SD?.lookupWeapon?.(item.name)) return 'weapons';
        const fi = SD?.lookupItem?.(item.name);
        if (fi?.itemType === 'weapon') return 'weapons';
        if (fi?.itemType === 'armor' || fi?.slot === 'armor' || fi?.slot === 'shield') return 'armor';
        if (fi?.itemType === 'container') return 'containers';
        if (fi?.itemType === 'consumable') return 'consumables';
        return 'equipment';
    }

    const INV_CATEGORY_ORDER = [
        ['weapons', 'Weapons'],
        ['armor', 'Armor & Shields'],
        ['equipment', 'Equipment'],
        ['consumables', 'Consumables'],
        ['containers', 'Containers'],
    ];

    function invRerender(data) {
        // renderSheet restores the active tab itself — don't force a jump to Inventory
        // (inventory-style weapon rows also live on the Combat tab).
        renderSheet(data);
    }

    /** Slot / type column label (Belt, Ring, Armor, …). */
    function invSlotLabel(item) {
        let s = String(item.slot || item.subType || '').replace(/[_-]+/g, ' ').trim();
        if (!s || s === 'none' || s === 'slotless') return '';
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    /** Checkbox cell for the identified / carried / equipped columns. */
    function invCheckCell(checked, title, onChange) {
        const wrap = h('span', 'inv-check');
        const cb = h('input');
        cb.type = 'checkbox';
        cb.checked = checked;
        cb.title = title;
        cb.setAttribute('aria-label', title);
        cb.addEventListener('change', () => onChange(cb.checked));
        wrap.appendChild(cb);
        return wrap;
    }

    function renderInventoryItemCard(data, item, index) {
        const SD = window.SheetDetails;
        const card = h('div', 'inv-item dnd-item'
            + (item.equipped ? ' is-equipped' : ' is-unequipped')
            + (item.carried === false ? ' is-stowed' : '')
            + (item.identified === false ? ' is-unidentified' : ''));
        card.dataset.invId = item.id || String(index);
        card.dataset.dndId = item.id || String(index);

        // Table row: handle · qty(−/+) · name · slot · weight · value · ✓id · ✓carried · ✓equipped · actions
        const row = h('div', 'inv-row');
        row.appendChild(dndHandle());

        const qtyCell = h('span', 'inv-qty');
        if (item.quantity == null) item.quantity = 1;
        const stepQty = (d) => {
            item.quantity = Math.max(1, (Number(item.quantity) || 1) + d);
            quietSave();
            invRerender(data);
        };
        const minusBtn = h('button', 'inv-step no-print', '−');
        minusBtn.type = 'button';
        minusBtn.title = 'Decrease quantity';
        minusBtn.addEventListener('click', () => stepQty(-1));
        const plusBtn = h('button', 'inv-step no-print', '+');
        plusBtn.type = 'button';
        plusBtn.title = 'Increase quantity';
        plusBtn.addEventListener('click', () => stepQty(1));
        qtyCell.appendChild(minusBtn);
        qtyCell.appendChild(dblclickEditable(item, 'quantity', {
            type: 'number', min: 1, max: 999,
            format: (v) => String(v == null || v === '' ? 1 : v),
            parse: (s) => Math.max(1, parseIntLoose(s, 1)),
            onChange: () => quietSave(),
        }));
        qtyCell.appendChild(plusBtn);
        row.appendChild(qtyCell);

        const nameEl = h('span', 'inv-item-name');
        // Foundry behavior: clicking the name opens the item sheet (rename lives there).
        const nameBtn = h('button', 'inv-item-open',
            item.identified === false ? (item.unidName || 'Unidentified item') : (item.name || '—'));
        nameBtn.type = 'button';
        nameBtn.title = 'Open item sheet';
        nameBtn.addEventListener('click', () => openItemSheet(data, item));
        nameEl.appendChild(nameBtn);
        const buffBits = (item.changes || []).map((c) => formatChangeLine(c, SD));
        if (buffBits.length) {
            const buffMark = h('span', 'inv-buff-mark', '✦');
            buffMark.title = 'Buffs while equipped: ' + buffBits.join('; ');
            nameEl.appendChild(buffMark);
        }
        row.appendChild(nameEl);

        row.appendChild(h('span', 'inv-slot', invSlotLabel(item)));

        row.appendChild(h('span', 'inv-weight', fmtWeight(
            (Number(item.weight) || 0) * (Number(item.quantity) || 1))));

        const priceCell = h('span', 'inv-price');
        priceCell.appendChild(dblclickEditable(item, 'price', {
            type: 'number', min: 0,
            format: (v) => fmtPrice(v),
            parse: (s) => {
                const n = parseFloat(String(s).replace(/[^\d.-]/g, ''));
                return Number.isFinite(n) ? n : null;
            },
            onChange: () => quietSave(),
        }));
        row.appendChild(priceCell);

        row.appendChild(invCheckCell(item.identified !== false,
            'Identified (known vs mystery item)', (on) => {
                item.identified = on;
                quietSave();
                invRerender(data);
            }));
        row.appendChild(invCheckCell(item.carried !== false,
            'Carried (stowed items do not count for encumbrance)', (on) => {
                item.carried = on;
                quietSave();
                invRerender(data);
            }));
        row.appendChild(invCheckCell(!!item.equipped,
            'Equipped (applies the item buffs)', (on) => {
                item.equipped = on;
                quietSave();
                invRerender(data);
            }));

        const btns = h('div', 'inv-item-actions no-print');
        const buffsBtn = h('button', 'inv-icon-btn', '⚙');
        buffsBtn.type = 'button';
        buffsBtn.title = 'Open item sheet';
        buffsBtn.addEventListener('click', () => openItemSheet(data, item));
        const removeBtn = h('button', 'inv-icon-btn inv-btn-danger', '×');
        removeBtn.type = 'button';
        removeBtn.title = 'Remove from inventory';
        removeBtn.addEventListener('click', () => {
            if (!confirm(`Remove “${item.name}” from inventory?`)) return;
            const list = data.equipment_list || [];
            const idx = list.indexOf(item);
            if (idx >= 0) list.splice(idx, 1);
            else if (index >= 0 && index < list.length) list.splice(index, 1);
            quietSave();
            invRerender(data);
        });
        btns.append(buffsBtn, removeBtn);
        row.appendChild(btns);

        // The full description lives in the item sheet (open via the ⚙ button); the
        // inline row expander was removed. Unidentified items still get a hint here.
        if (item.identified === false) {
            row.appendChild(h('span', 'dim inv-unid-hint', '(unidentified)'));
        }
        card.appendChild(row);
        return card;
    }

    /** Currency bar pinned at the top of the Inventory tab: PP · GP · SP · CP inputs. */
    function invCurrencyBar(data) {
        if (data.platinum == null && data.platnium != null) data.platinum = data.platnium;
        const bar = h('div', 'inv-currency-bar');
        bar.appendChild(h('span', 'inv-currency-title', 'Currency'));
        for (const [label, key] of [
            ['PP', 'platinum'],
            ['GP', 'gold'],
            ['SP', 'silver'],
            ['CP', 'copper'],
        ]) {
            if (data[key] == null || data[key] === '') data[key] = 0;
            const box = h('label', 'inv-currency-box');
            box.appendChild(h('span', 'inv-currency-label', label));
            const input = h('input', 'inv-currency-input');
            input.type = 'number';
            input.min = '0';
            input.value = String(Number(data[key]) || 0);
            input.addEventListener('change', () => {
                data[key] = Math.max(0, parseIntLoose(input.value, 0));
                input.value = String(data[key]);
                if (key === 'platinum') data.platnium = data.platinum; // keep legacy in sync
                quietSave();
            });
            box.appendChild(input);
            bar.appendChild(box);
        }
        return bar;
    }

    // Category → itemType preset for the per-category "+" add buttons.
    const INV_CAT_ITEMTYPE = {
        weapons: 'weapon', armor: 'armor', equipment: 'equipment',
        consumables: 'consumable', containers: 'container',
    };

    function renderGear(data) {
        const { sec, body } = section('Inventory', 'inventory-tab');

        body.appendChild(invCurrencyBar(data));

        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Add items with Browse or a category +. Drag ⋮⋮ to reorder. Checkboxes: identified · carried · equipped (equip applies buffs).'));

        const filterIn = h('input', 'edit-field inv-filter');
        filterIn.type = 'search';
        filterIn.placeholder = 'Search filter…';
        filterIn.addEventListener('input', () => {
            const q = filterIn.value.toLowerCase().trim();
            body.querySelectorAll('.inv-item').forEach((el) => {
                const n = (el.querySelector('.inv-item-name')?.textContent
                    || el.textContent || '').toLowerCase();
                el.style.display = !q || n.includes(q) ? '' : 'none';
            });
        });

        // Category jump links (scroll to the section header)
        const catNav = h('div', 'inv-cat-nav no-print');
        for (const [cat, label] of INV_CATEGORY_ORDER) {
            const btn = h('button', 'inv-cat-link', label);
            btn.type = 'button';
            btn.dataset.invNav = cat;
            btn.addEventListener('click', () => {
                body.querySelector(`[data-inv-cat="${cat}"]`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            catNav.appendChild(btn);
        }
        const toolbarExtra = h('div', 'inv-toolbar-extra');
        toolbarExtra.append(filterIn, catNav);

        body.appendChild(sectionCatalogToolbar({
            browseLabel: 'Browse items',
            browseTitle: 'Search weapons & equipment',
            extra: toolbarExtra,
            picker: {
                title: 'Add inventory item',
                kinds: ['items', 'weapons'],
                allowCustom: true,
                customPlaceholder: 'Custom item name',
                onPick: (hit) => {
                    addInventoryItem(data, hit.name);
                    invRerender(data);
                },
                onCustom: (name) => {
                    addInventoryItem(data, name);
                    invRerender(data);
                },
                onBlank: () => {
                    const it = addBlankInventoryItem(data);
                    invRerender(data);
                    openItemSheet(data, it);
                },
            },
        }));

        // Generated weapon / armor / shield live in the list as regular items
        // (migrated once) — no separate core-slots block.
        migrateCoreGear(data);

        const list = ensureInventoryObjects(data);
        if (!list.length) {
            body.appendChild(h('p', 'dim no-print', 'No items yet — use Browse or a category + below.'));
        }

        // Group by category (display only; list order preserved within groups
        // via original indices for reorder — reorder stays within each section list).
        const groups = new Map();
        list.forEach((item, i) => {
            const cat = inventoryCategory(item);
            if (!groups.has(cat)) groups.set(cat, []);
            groups.get(cat).push({ item, index: i });
        });

        let totalWeight = 0;
        for (const [cat, label] of INV_CATEGORY_ORDER) {
            const entries = groups.get(cat) || [];
            const secWrap = h('div', 'inv-category');
            secWrap.dataset.invCat = cat;

            // Category header row: title + column captions + per-category add button.
            const head = h('div', 'inv-row inv-cat-head');
            head.appendChild(h('span'));           // handle col
            head.appendChild(h('span', 'inv-col-cap', 'Qty'));
            head.appendChild(h('span', 'inv-cat-title',
                label + (entries.length ? ' (' + entries.length + ')' : '')));
            head.appendChild(h('span', 'inv-col-cap', 'Slot'));
            head.appendChild(h('span', 'inv-col-cap inv-col-cap-right', 'Weight'));
            head.appendChild(h('span', 'inv-col-cap inv-col-cap-right', 'Value'));
            head.appendChild(h('span', 'inv-col-cap inv-col-cap-mid', 'ID'));
            head.appendChild(h('span', 'inv-col-cap inv-col-cap-mid', 'Car'));
            head.appendChild(h('span', 'inv-col-cap inv-col-cap-mid', 'Eq'));
            const addWrap = h('span', 'inv-cat-add no-print');
            const addBtn = h('button', 'inv-icon-btn inv-add-btn', '+');
            addBtn.type = 'button';
            addBtn.title = 'Add to ' + label.toLowerCase();
            addBtn.addEventListener('click', () => openCatalogPicker({
                title: 'Add — ' + label.toLowerCase(),
                kinds: cat === 'weapons' ? ['weapons', 'items'] : ['items', 'weapons'],
                allowCustom: true,
                customPlaceholder: 'Custom item name',
                onPick: (hit) => {
                    const it = addInventoryItem(data, hit.name);
                    // Known items keep their natural category; unknowns land here.
                    if (it && inventoryCategory(it) !== cat && INV_CAT_ITEMTYPE[cat]) {
                        it.itemType = INV_CAT_ITEMTYPE[cat];
                        quietSave();
                    }
                    invRerender(data);
                },
                onCustom: (name) => {
                    const it = addInventoryItem(data, name);
                    if (it && INV_CAT_ITEMTYPE[cat]) {
                        it.itemType = INV_CAT_ITEMTYPE[cat];
                        quietSave();
                    }
                    invRerender(data);
                },
                onBlank: () => {
                    const it = addBlankInventoryItem(data, INV_CAT_ITEMTYPE[cat]);
                    invRerender(data);
                    openItemSheet(data, it);
                },
            }));
            addWrap.appendChild(addBtn);
            head.appendChild(addWrap);
            secWrap.appendChild(head);

            const pack = h('div', 'inv-list dnd-list');
            for (const { item, index } of entries) {
                pack.appendChild(renderInventoryItemCard(data, item, index));
                if (item.carried === false) continue;
                if (item.weight != null && Number.isFinite(Number(item.weight))) {
                    totalWeight += Number(item.weight) * (Number(item.quantity) || 1);
                }
            }
            // Reorder within category maps to equipment_list indices
            bindDragReorder(pack, '.inv-item', (from, to) => {
                const fromId = entries[from]?.item?.id;
                const toId = entries[to]?.item?.id;
                const listNow = data.equipment_list || [];
                const fromIdx = listNow.findIndex((it) => it.id === fromId);
                const toIdx = listNow.findIndex((it) => it.id === toId);
                if (fromIdx < 0 || toIdx < 0) return;
                reorderArray(listNow, fromIdx, toIdx);
                quietSave();
                invRerender(data);
            });
            secWrap.appendChild(pack);
            body.appendChild(secWrap);
        }

        const load = loadCategory(totalWeight, data.str);
        const eqCount = list.filter((it) => it.equipped).length;
        const carried = list.filter((it) => it.carried !== false).length;
        const valueSum = list.reduce((sum, it) => {
            const p = Number(it.price);
            if (!Number.isFinite(p)) return sum;
            return sum + p * (Number(it.quantity) || 1);
        }, 0);

        const foot = h('div', 'inv-footer');

        const statLine = h('div', 'inv-foot-stats');
        statLine.appendChild(h('span', load.cls, `Carrying ${fmtWeight(totalWeight)}`));
        statLine.appendChild(h('span', 'dim',
            `${eqCount} equipped · ${carried} carried · ${list.length} total`
            + (valueSum ? ` · Total item value: ${fmtPrice(valueSum)}` : '')));
        foot.appendChild(statLine);

        // Load bar: Light / Medium / Heavy segments; the current band is highlighted.
        const bar = h('div', 'inv-load-bar');
        for (const [segLabel, limit, cls] of [
            ['Light Load', load.lim.light, 'load-light'],
            ['Medium Load', load.lim.medium, 'load-medium'],
            ['Heavy Load', load.lim.heavy, 'load-heavy'],
        ]) {
            const seg = h('span', 'inv-load-seg ' + cls
                + (load.label.startsWith(segLabel.split(' ')[0]) ? ' is-active' : '')
                + (load.label === 'Over capacity' ? ' is-over' : ''),
                `${segLabel} (${limit})`);
            seg.title = `${segLabel}: up to ${limit} lbs`;
            bar.appendChild(seg);
        }
        foot.appendChild(bar);

        // Lift & drag capacities (PF1: above head = heavy; off ground = ×2; drag & push = ×5)
        const caps = h('div', 'inv-capacity-row');
        for (const [capLabel, val] of [
            ['Above Head', load.lim.heavy],
            ['Off Ground', load.lim.heavy * 2],
            ['Drag & Push', load.lim.heavy * 5],
        ]) {
            const box = h('div', 'inv-capacity-box');
            box.appendChild(h('span', 'inv-capacity-label', capLabel));
            box.appendChild(h('span', 'inv-capacity-value', String(val)));
            caps.appendChild(box);
        }
        foot.appendChild(caps);

        body.appendChild(foot);

        return sec;
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

    function parseSkillRanks(data) {
        let ranks = data.skill_ranks;
        if (typeof ranks === 'string') {
            try { ranks = JSON.parse(ranks); } catch { ranks = {}; }
        }
        if (!ranks || typeof ranks !== 'object') ranks = {};
        // Normalize keys to lowercase for lookup
        const map = {};
        for (const [k, v] of Object.entries(ranks)) {
            map[String(k).toLowerCase().trim()] = Number(v) || 0;
        }
        return map;
    }

    function ranksForSkill(rankMap, skillName) {
        const lc = skillName.toLowerCase();
        if (rankMap[lc] != null) return rankMap[lc];
        // Loose match: "knowledge arcana" vs "Knowledge (Arcana)"
        const loose = lc.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
        for (const [k, v] of Object.entries(rankMap)) {
            const kl = k.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
            if (kl === loose || kl.includes(loose) || loose.includes(kl)) return v;
        }
        return 0;
    }

    /** Effective ability for a skill (Foundry: per-skill ability select). Stored on _sheet.skillAbilities. */
    function skillAbilityKey(skill) {
        return skill.id || skillRankKey(skill.name);
    }

    function getSkillAbility(data, skill) {
        const st = sheetState(data);
        st.skillAbilities ??= {};
        const key = skillAbilityKey(skill);
        const override = st.skillAbilities[key] || st.skillAbilities[skillRankKey(skill.name)];
        const ab = String(override || skill.ab || 'str').toLowerCase();
        return ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(ab) ? ab : (skill.ab || 'str');
    }

    function setSkillAbility(data, skill, ab) {
        const st = sheetState(data);
        st.skillAbilities ??= {};
        const key = skillAbilityKey(skill);
        const def = skill.ab || 'str';
        if (!ab || ab === def) delete st.skillAbilities[key];
        else st.skillAbilities[key] = ab;
        quietSave();
    }

    // ---- per-skill user bonuses: Racial / Feat / Trait / Misc + class-skill toggle
    // Stored on _sheet.skillBonuses[key] = { racial, feat, trait, misc, cs }.
    function skillBonusEntry(data, key) {
        const st = sheetState(data);
        st.skillBonuses ??= {};
        return st.skillBonuses[key] || {};
    }

    function setSkillBonus(data, key, field, value) {
        const st = sheetState(data);
        st.skillBonuses ??= {};
        const entry = { ...(st.skillBonuses[key] || {}) };
        if (field === 'cs') {
            if (value) entry.cs = true;
            else delete entry.cs;
        } else {
            const n = Number(value) || 0;
            if (n) entry[field] = n;
            else delete entry[field];
        }
        // Drop the key entirely when everything is zero/off
        if (Object.keys(entry).length) st.skillBonuses[key] = entry;
        else delete st.skillBonuses[key];
        quietSave();
    }

    /** User-entered skill bonuses; class skill gives PF1's +3 only with ≥1 rank. */
    function skillUserBonus(data, key, ranks) {
        const e = skillBonusEntry(data, key);
        const racial = Number(e.racial) || 0;
        const feat = Number(e.feat) || 0;
        const trait = Number(e.trait) || 0;
        const misc = Number(e.misc) || 0;
        const csBonus = e.cs && (Number(ranks) || 0) >= 1 ? 3 : 0;
        return { racial, feat, trait, misc, cs: !!e.cs, csBonus,
            total: racial + feat + trait + misc + csBonus };
    }

    function skillMiscBonus(data, skill) {
        const SD = window.SheetDetails;
        const ab = getSkillAbility(data, skill);
        // Use effective ledger so per-buff toggles apply
        const ledger = effectiveLedger(data);
        // ACP applies when skill is Str/Dex based (Foundry-style) or originally marked acp
        const acpApplies = skill.acp || ab === 'str' || ab === 'dex';
        const hasNegLv = (Number(data?._sheet?.negativeLevels) || 0) > 0;
        if (!ledger?.changes?.length && !acpApplies && !hasNegLv) return { total: 0, bits: [] };
        const abBucket = {
            str: 'strSkills', dex: 'dexSkills', con: 'conSkills',
            int: 'intSkills', wis: 'wisSkills', cha: 'chaSkills',
        }[ab];
        const targets = new Set(['skills', abBucket, skill.id ? 'skill.' + skill.id : null].filter(Boolean));
        let total = 0;
        const bits = [];
        for (const c of ledger.changes || []) {
            if (!targets.has(c.target)) continue;
            const ev = SD?.evalSimpleFormula(c.formula, data);
            if (ev?.ok) {
                total += ev.value;
                bits.push({ source: c.source, value: ev.value });
            }
        }
        if (acpApplies) {
            const acp = toInt(data.armor_armor_check_penalty);
            if (acp != null && acp !== 0) {
                const pen = acp > 0 ? -acp : acp;
                total += pen;
                bits.push({ source: 'Armor check', value: pen });
            }
        }
        // PF1 negative levels: −1 per level on all skill checks
        const negLv = Number(data?._sheet?.negativeLevels) || 0;
        if (negLv) {
            total -= negLv;
            bits.push({ source: 'Negative levels', value: -negLv });
        }
        return { total, bits };
    }

    /**
     * HTML5 drag-and-drop reorder for list containers (Foundry-like item rows).
     * @param {HTMLElement} container
     * @param {string} itemSelector - children that are reorderable
     * @param {(fromIndex: number, toIndex: number) => void} onReorder
     */




    function skillRankKey(skillName) {
        return String(skillName).toLowerCase().trim();
    }

    function ranksEditor(data, rankKey, currentRanks) {
        const map = ensureSkillRanksObject(data);
        if (map[rankKey] == null && currentRanks) map[rankKey] = currentRanks;
        // Hold ranks on a bag; onChange syncs into skill_ranks map
        const bag = { ranks: map[rankKey] || 0 };
        return dblclickEditable(bag, 'ranks', {
            type: 'number',
            min: 0,
            max: 40,
            format: (raw) => String(raw == null || raw === '' ? 0 : raw),
            parse: (s) => parseIntLoose(s, 0),
            onChange: (v) => {
                const m = ensureSkillRanksObject(data);
                const n = Number(v) || 0;
                if (n <= 0) delete m[rankKey];
                else m[rankKey] = n;
                quietSave();
                if (currentData) {
                    renderSheet(currentData);
                    setActiveTab('skills');
                }
            },
        });
    }

    function renderSkills(data) {
        const rankMap = ensureSkillRanksObject(data);
        const { sec, body } = section('Skills');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Double-click ranks to edit. Change ability via the Abl dropdown. Roll = 1d20 + ranks + ability + misc.'));

        const unlockSkill = (data.skill_unlock?.base_skill || '').toLowerCase();
        const table = h('table', 'skills-table skills-table-full');
        const hd = h('tr');
        ['', 'Skill', 'Abl', 'Ranks', 'Mod', 'Racial', 'Feat', 'Trait', 'Misc', 'Buffs', 'CS', 'Total']
            .forEach((t) => hd.appendChild(h('th', null, t)));
        table.appendChild(hd);

        // Bulk roll: drive the per-row Roll buttons this table already builds, so the totals
        // and log formatting stay in one place.
        body.appendChild(rollAllBar('🎲 Roll all skills',
            'Roll 1d20 for every skill into the Tools log', table));

        // Editable user-bonus cell (Racial / Feat / Trait / Misc)
        const bonusCell = (key, field, entry) => {
            const td = h('td', 'num skill-bonus-cell');
            const bag = { v: Number(entry[field]) || 0 };
            td.appendChild(dblclickEditable(bag, 'v', {
                type: 'number', min: -99, max: 99,
                format: (v) => (Number(v) ? fmt(Number(v)) : '—'),
                parse: (s) => parseIntLoose(s, 0),
                onChange: (v) => {
                    setSkillBonus(data, key, field, v);
                    renderSheet(data);
                    setActiveTab('skills');
                },
            }));
            return td;
        };
        // Class-skill toggle: +3 once the skill has at least 1 rank (PF1)
        const csCell = (key, entry, ranks) => {
            const td = h('td', 'num skill-cs-cell');
            const on = !!entry.cs;
            const btn = h('button', 'skill-cs-btn' + (on ? ' is-on' : ''),
                on ? (ranks >= 1 ? '+3' : '✓') : '—');
            btn.type = 'button';
            btn.title = on
                ? (ranks >= 1 ? 'Class skill: +3 applied — click to clear'
                    : 'Class skill (+3 needs at least 1 rank) — click to clear')
                : 'Mark as class skill (+3 with at least 1 rank)';
            btn.addEventListener('click', () => {
                setSkillBonus(data, key, 'cs', !on);
                renderSheet(data);
                setActiveTab('skills');
            });
            td.appendChild(btn);
            return td;
        };

        const craftLabel = data.craft_type ? `Craft (${data.craft_type})` : 'Craft';
        for (const skill of ALL_SKILLS) {
            const displayName = skill.name === 'Craft' ? craftLabel
                : skill.name === 'Profession' && nonEmpty(data.profession_ranks)
                    ? null // handled in profession block with detail
                    : skill.name;
            if (displayName === null) continue;

            const rKey = skillRankKey(
                skill.name === 'Craft' && data.craft_type ? craftLabel : skill.name,
            );
            const ranks = ranksForSkill(rankMap, skill.name)
                || ranksForSkill(rankMap, displayName)
                || (skill.name === 'Craft' && data.craft_type
                    ? ranksForSkill(rankMap, 'craft') : 0);
            const ab = getSkillAbility(data, skill);
            const abMod = abModOf(data, ab);
            const skillEff = { ...skill, ab };
            const misc = skillMiscBonus(data, skillEff);
            const bonusKey = skillAbilityKey(skill);
            const entry = skillBonusEntry(data, bonusKey);
            const user = skillUserBonus(data, bonusKey, ranks);
            const total = ranks + abMod + misc.total + user.total;
            const tr = h('tr', displayName.toLowerCase().includes(unlockSkill) && unlockSkill
                ? 'unlocked' : null);

            const rollTd = h('td', 'skill-roll-cell no-print');
            rollTd.appendChild(rollBtn(displayName + ' check', total, `1d20${fmt(total)}`));
            tr.appendChild(rollTd);
            const nameTd = h('td', null,
                displayName + (unlockSkill && displayName.toLowerCase().includes(unlockSkill) ? ' ★' : ''));
            tr.appendChild(nameTd);
            // Situational context notes (e.g. trait bonuses vs specific targets) hover here
            const abBucket = {
                str: 'strSkills', dex: 'dexSkills', con: 'conSkills',
                int: 'intSkills', wis: 'wisSkills', cha: 'chaSkills',
            }[ab];
            attachNotesHover(nameTd, data,
                ['skills', abBucket, skill.id ? 'skill.' + skill.id : null].filter(Boolean));

            const abTd = h('td', 'num skill-ab-cell');
            const abSel = h('select', 'skill-ability-select edit-field');
            abSel.title = 'Key ability (default ' + String(skill.ab).toUpperCase() + ')';
            for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
                const opt = document.createElement('option');
                opt.value = a;
                opt.textContent = a.toUpperCase();
                if (a === ab) opt.selected = true;
                abSel.appendChild(opt);
            }
            abSel.addEventListener('change', () => {
                setSkillAbility(data, skill, abSel.value);
                renderSheet(data);
                setActiveTab('skills');
            });
            abTd.appendChild(abSel);
            tr.appendChild(abTd);

            const rankTd = h('td', 'num skill-ranks-cell');
            rankTd.appendChild(ranksEditor(data, rKey, ranks));
            tr.appendChild(rankTd);
            tr.appendChild(h('td', 'num', fmt(abMod)));
            tr.appendChild(bonusCell(bonusKey, 'racial', entry));
            tr.appendChild(bonusCell(bonusKey, 'feat', entry));
            tr.appendChild(bonusCell(bonusKey, 'trait', entry));
            tr.appendChild(bonusCell(bonusKey, 'misc', entry));
            tr.appendChild(h('td', 'num', misc.total ? fmt(misc.total) : '—'));
            tr.appendChild(csCell(bonusKey, entry, ranks));
            const totalTd = h('td', 'num skill-total', fmt(total));
            totalTd.title = `ranks ${ranks} + ${ab.toUpperCase()} ${fmt(abMod)}`
                + (misc.total ? ` + buffs ${fmt(misc.total)}` : '')
                + (user.racial ? ` + racial ${fmt(user.racial)}` : '')
                + (user.feat ? ` + feat ${fmt(user.feat)}` : '')
                + (user.trait ? ` + trait ${fmt(user.trait)}` : '')
                + (user.misc ? ` + misc ${fmt(user.misc)}` : '')
                + (user.csBonus ? ' + class skill +3' : '');
            tr.appendChild(totalTd);
            table.appendChild(tr);
        }
        body.appendChild(table);

        if (data.skill_unlock?.skill) {
            const u = data.skill_unlock;
            const tiers = Object.entries(u.unlock || {})
                .map(([lv, txt]) => `<p><strong>${lv} ranks:</strong> ${txt}</p>`).join('');
            body.appendChild(details(`★ Skill Unlock: ${u.skill}`, tiers));
        }
        if (nonEmpty(data.profession_ranks)) {
            body.appendChild(h('h3', null, 'Professions'));
            const t2 = h('table', 'skills-table skills-table-full professions');
            const phd = h('tr');
            ['', 'Profession', 'Abl', 'Ranks', 'Mod', 'Racial', 'Feat', 'Trait', 'Misc', 'Buffs', 'CS', 'Total']
                .forEach((t) => phd.appendChild(h('th', null, t)));
            t2.appendChild(phd);
            data.profession_ranks.forEach((p, idx) => {
                const label = p.skill_label || p.name || 'Profession';
                const ranks = Number(p.ranks) || 0;
                const abMod = abModOf(data, 'wis');
                const misc = skillMiscBonus(data, { ab: 'wis', id: 'pro', acp: false });
                const proKey = 'pro:' + label;
                const entry = skillBonusEntry(data, proKey);
                const user = skillUserBonus(data, proKey, ranks);
                const total = ranks + abMod + misc.total + user.total;
                const tr = h('tr');
                const rollTd = h('td', 'skill-roll-cell no-print');
                rollTd.appendChild(rollBtn(label + ' check', total));
                tr.appendChild(rollTd);
                const proNameTd = h('td', null, label);
                tr.appendChild(proNameTd);
                attachNotesHover(proNameTd, data, ['skills', 'wisSkills', 'skill.pro']);
                tr.appendChild(h('td', 'num', 'WIS'));
                const rankTd = h('td', 'num skill-ranks-cell');
                rankTd.appendChild(dblclickEditable(p, 'ranks', {
                    type: 'number', min: 0, max: 40,
                    format: (raw) => String(raw == null ? 0 : raw) + (p.cap != null ? `/${p.cap}` : ''),
                    parse: (s) => parseIntLoose(s, 0),
                    onChange: () => {
                        quietSave();
                        if (currentData) {
                            renderSheet(currentData);
                            setActiveTab('skills');
                        }
                    },
                }));
                tr.appendChild(rankTd);
                tr.appendChild(h('td', 'num', fmt(abMod)));
                tr.appendChild(bonusCell(proKey, 'racial', entry));
                tr.appendChild(bonusCell(proKey, 'feat', entry));
                tr.appendChild(bonusCell(proKey, 'trait', entry));
                tr.appendChild(bonusCell(proKey, 'misc', entry));
                tr.appendChild(h('td', 'num', misc.total ? fmt(misc.total) : '—'));
                tr.appendChild(csCell(proKey, entry, ranks));
                tr.appendChild(h('td', 'num skill-total', fmt(total)));
                t2.appendChild(tr);
            });
            body.appendChild(t2);
            if (data.profession_pool != null) kv(body, 'Profession rank pool', data.profession_pool);
        }
        return sec;
    }

    // Mirrors Foundry module addingReceivedLocationToName / Feats_n_Traits prefixes.
    // labelArray → "Label: Feat"; taxDict → "Name > Child > …" (applyFeatTax).
    const FEAT_GROUPS = [
        { title: 'Flavor', listKey: 'flavor_feats', prefix: 'Flavor', start: 1, step: 1,
            taxKey: 'flavor_feat_tax_dict' },
        { title: 'Flaw', listKey: 'flaw_feats', prefix: 'Flaw', start: 1, step: 1,
            taxKey: 'flaw_feat_tax_dict' },
        { title: 'Story Feat', listKey: 'story_feats', prefix: 'Story Feat',
            customLevels: [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
            taxKey: 'story_feat_tax_dict' },
        { title: 'Feat', listKey: 'feats', prefix: 'Feat', start: 1, step: 2,
            taxKey: 'feats_feat_tax_dict' },
        { title: 'Class Bonus Feat', listKey: 'teamwork_feats', labelsKey: 'teamwork_feat_labels',
            prefix: 'Class Bonus Feat', start: 3, step: 3 },
        { title: 'Class Bonus Feat', listKey: 'class_feats', labelsKey: 'class_feat_labels',
            prefix: 'Class Bonus Feat', start: 1, step: 2, taxKey: 'class_feat_tax_dict' },
        { title: 'Bloodline Feat', listKey: 'bloodline_feats', labelsKey: 'bloodline_feat_labels',
            prefix: 'Bloodline Feat', start: 1, step: 1 },
        { title: 'Trainer', listKey: 'trainer_feats', labelsKey: 'trainer_feat_labels',
            prefix: 'Trainer', start: 1, step: 1, taxKey: 'trainer_feat_tax_dict' },
        { title: 'Profession', listKey: 'profession_feats', prefix: 'Profession', start: 1, step: 1 },
        { title: 'Sphere Feat', listKey: 'sphere_feats', prefix: 'Sphere Feat', start: 1, step: 1 },
        // No `mt_feats` group: the backend distributes every Martial Training feat into the normal
        // feats / class_feats / trainer_feats buckets (mentor-funded ones land under a Trainer slot),
        // so a dedicated group here would render each one twice and double-count it in the Bonus/Total
        // tallies. This mirrors the Foundry module, which renders MT feats only through those buckets
        // and uses the mt_feats array solely to detect martial characters.
    ];

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

    // Full changes ledger for the Features tab, recomputed once per feature-section
    // render so each row can show its source's built-in buffs without re-collecting.
    let featureLedgerCache = null;
    function refreshFeatureLedger(data) {
        const SD = window.SheetDetails;
        featureLedgerCache = SD ? SD.collectChanges(data)
            : (window.sheetChangesFull || null);
        return featureLedgerCache;
    }
    /** Grouped built-in changes a feature (feat/trait/class feature) contributes, or null. */
    function featureBuffGroup(name) {
        const led = featureLedgerCache;
        if (!led || !name) return null;
        const lines = (led.changes || []).filter((c) => c.source === name);
        if (!lines.length) return null;
        return { source: name, sourceKind: lines[0].sourceKind || 'feat', lines };
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
            window.SheetRoll?.rollAndLog?.('d1', (opts.chatKind || 'Feature') + ': ' + opts.title);
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
            ['Opposition Schools', nonEmpty(data.opposing_school) ? data.opposing_school.join(', ') : null],
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

















    /** Biography tab: vitals only — freeform description/personality live on Notes. */
    function renderBiographyVitals(data) {
        const { sec, body } = section('Biography');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Physical vitals. Description, personality, family, and backstory are freeform on the Notes tab.'));
        kvDbl(body, 'Age', data, 'age_number', { type: 'number', min: 0 });
        kvDbl(body, 'Height', data, 'height_number');
        kvDbl(body, 'Weight (lbs)', data, 'weight_number', { type: 'number', min: 0 });
        // Languages moved to Attributes (with senses / aura / proficiencies).
        body.appendChild(h('p', 'dim no-print',
            'Tip: open Notes for Description, Personality, and session / background text.'));
        return sec;
    }

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

    function summaryQuickActions(body, data, d) {
        const bar = h('div', 'quick-actions no-print');
        const mk = (label, fn, title) => {
            const b = h('button', 'quick-action-btn', label);
            b.type = 'button';
            if (title) b.title = title;
            b.addEventListener('click', fn);
            bar.appendChild(b);
        };
        mk('Initiative', () => rollCheck('Initiative', d.blocks.init.total));
        mk('Full attack', () => {
            window.SheetRoll?.setOpen?.(true);
            window.SheetRoll?.rollWeaponAttack?.({ full: true, withDamage: true });
        }, 'Full attack with damage');
        mk('Perception', () => {
            const skill = { name: 'Perception', ab: 'wis', id: 'per', acp: false };
            const ab = getSkillAbility(data, skill);
            const rankMap = parseSkillRanks(data);
            const ranks = ranksForSkill(rankMap, 'Perception');
            const abMod = abModOf(data, ab);
            const misc = skillMiscBonus(data, { ...skill, ab });
            const user = skillUserBonus(data, skillAbilityKey(skill), ranks);
            rollCheck('Perception check', ranks + abMod + misc.total + user.total);
        });
        mk('Rest', () => {
            if (!confirm('Rest and restore daily resources (spell casts, feature uses, sphere SP)?')) return;
            doRest(data);
        }, 'Restore daily casts / uses / spell points');
        mk('Tools', () => window.SheetRoll?.setOpen?.(true));
        body.appendChild(bar);
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

    function classKeyOf(name) {
        return String(name || '').toLowerCase().trim();
    }

    /**
     * Level of ONE named class, for per-class labels. Without this every class card showed the
     * PRIMARY class's level, so the Wizard card on a Monk 8 / Wizard 5 read "Wizard — level 8".
     * Falls back to the legacy `level` so old payloads (no classes[]) and user-added classes with no
     * payload entry render exactly as they do today, rather than inheriting a fabricated total.
     */
    function classLevelFor(data, clsName) {
        const key = classKeyOf(clsName);
        const hit = (Array.isArray(data?.classes) ? data.classes : [])
            .find((c) => classKeyOf(c.name) === key || classKeyOf(c.display) === key);
        return Number(hit?.level) || (Number(data?.level) || 0);
    }

    /** Built-in chassis + per-character overrides (_sheet.classInfo[key]). */
    function classInfoFor(data, clsName) {
        const key = classKeyOf(clsName);
        const base = CLASS_STATS[key] || {};
        const over = data?._sheet?.classInfo?.[key] || {};
        return { ...DEFAULT_CLASS_INFO, ...base, ...over };
    }

    function setClassInfo(data, clsName, field, value) {
        const st = sheetState(data);
        st.classInfo ??= {};
        const key = classKeyOf(clsName);
        st.classInfo[key] ??= {};
        if (value == null || value === '' || value === '—') delete st.classInfo[key][field];
        else st.classInfo[key][field] = value;
        if (!Object.keys(st.classInfo[key]).length) delete st.classInfo[key];
        if (!Object.keys(st.classInfo).length) delete st.classInfo;
        quietSave();
    }

    /** One-time: check the class-skill CS toggles from the class defaults. */
    function seedClassSkills(data) {
        const st = sheetState(data);
        if (st.classSkillsSeeded) return;
        st.classSkillsSeeded = true;
        for (const cls of ensureClassList(data)) {
            if (!cls) continue;
            for (const id of classInfoFor(data, cls).classSkills || []) {
                setSkillBonus(data, id, 'cs', true);
            }
        }
        quietSave();
    }

    /** { name, raw } from the backend archetype_info ({ "<Name>": <description> }). */
    function archetypeInfoOf(data) {
        let obj = data?.archetype_info;
        if (typeof obj === 'string') {
            try { obj = JSON.parse(obj); } catch { return null; }
        }
        if (!obj || typeof obj !== 'object') return null;
        const name = Object.keys(obj)[0];
        return name ? { name, raw: obj[name] } : null;
    }

    /** Render scraped archetype content (string / array / object) as readable HTML. */
    function archetypeDescHtml(raw) {
        if (raw == null) return '<p class="dim">No description.</p>';
        if (typeof raw === 'string') {
            return /</.test(raw) ? raw : '<p>' + escapeHtml(raw) + '</p>';
        }
        if (Array.isArray(raw)) {
            return raw.map((x) => archetypeDescHtml(x)).join('');
        }
        return Object.entries(raw).map(([k, v]) =>
            `<p><strong>${escapeHtml(titleCase(k.replace(/_/g, ' ')))}:</strong></p>`
            + archetypeDescHtml(v)).join('');
    }


    // Previously-used archetype names, persisted across characters ("saved data" the
    // archetype picker offers). Grows as you add archetypes or load characters that have them.
    const USED_ARCHETYPES_KEY = 'sheet.usedArchetypes';
    function usedArchetypeArr() {
        try {
            const arr = JSON.parse(localStorage.getItem(USED_ARCHETYPES_KEY));
            return Array.isArray(arr) ? arr : [];
        } catch { return []; }
    }
    function recordUsedArchetype(name) {
        const nm = String(name || '').trim();
        if (!nm) return;
        const arr = usedArchetypeArr();
        if (arr.some((x) => x.toLowerCase() === nm.toLowerCase())) return;
        arr.push(nm);
        try { localStorage.setItem(USED_ARCHETYPES_KEY, JSON.stringify(arr)); } catch { /* private */ }
    }
    function usedArchetypeHits(query) {
        const q = String(query || '').toLowerCase();
        return usedArchetypeArr()
            .filter((nm) => nm.toLowerCase().includes(q))
            .sort((a, b) => a.localeCompare(b))
            .map((nm) => ({ name: nm, kind: 'archetypes', subtitle: 'Used before' }));
    }

    // Per-class archetype catalog (slim class -> [names] extract, data/archetypes_by_class.json).
    let archetypesByClass = null;
    function loadArchetypesByClass() {
        if (archetypesByClass) return;
        fetch('data/archetypes_by_class.json')
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => { if (j && typeof j === 'object') archetypesByClass = j; })
            .catch(() => { /* offline / missing file — picker falls back to used + custom */ });
    }
    /** Archetypes available to the character's current classes, filtered by query. */
    function classArchetypeHits(data, query) {
        if (!archetypesByClass) return [];
        const q = String(query || '').toLowerCase();
        const seen = new Set();
        const out = [];
        for (const cls of ensureClassList(data)) {
            const key = String(cls).toLowerCase();
            for (const name of archetypesByClass[key] || []) {
                const k = name.toLowerCase();
                if (seen.has(k) || !k.includes(q)) continue;
                seen.add(k);
                out.push({ name, kind: 'archetypes', subtitle: titleCase(cls) + ' archetype' });
            }
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }



    function tabSummary(data) {
        const d = computeDerived(data);
        const { sec, body } = section('Overview', 'summary-overview');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Play dashboard. Double-click values to edit; 🎲 rolls; click a class for details.'));

        summaryQuickActions(body, data, d);
        seedClassSkills(data);

        const st = sheetState(data);
        if (st.hpCurrent == null || st.hpCurrent === '') st.hpCurrent = d.blocks.hp.total;
        if (st.hpTemp == null || st.hpTemp === '') st.hpTemp = 0;
        if (st.hpNonlethal == null || st.hpNonlethal === '') st.hpNonlethal = 0;
        st.speeds ??= {};
        if (st.speeds.land == null || st.speeds.land === '') {
            st.speeds.land = Number(data.land_speed) || 30;
        }

        const line = (label) => {
            const wrap = h('div', 'summary-line');
            wrap.appendChild(h('h4', 'summary-line-label', label));
            const strip = h('div', 'summary-combat-strip combat-top-strip summary-line-strip');
            wrap.appendChild(strip);
            body.appendChild(wrap);
            return strip;
        };
        const box = (strip, label, content, opts = {}) => {
            const b = h('div', 'summary-stat-box');
            const headEl = h('div', 'summary-stat-head');
            headEl.appendChild(document.createTextNode(label + ' '));
            if (opts.rollTotal != null) {
                headEl.appendChild(rollBtn(opts.rollLabel || label, opts.rollTotal));
            }
            b.appendChild(headEl);
            const val = h('div', 'summary-stat-val');
            if (content instanceof Node) val.appendChild(content);
            else val.textContent = String(content);
            b.appendChild(val);
            attachStatHint(b, label);
            if (opts.title) b.title = opts.title;
            if (opts.cls) b.classList.add(opts.cls);
            strip.appendChild(b);
            return b;
        };
        const editNumNode = (obj, key, opts = {}) => dblclickEditable(obj, key, {
            type: 'number', min: opts.min ?? 0,
            format: (v) => (v == null || v === '' ? '0' : String(v)),
            parse: (s) => parseIntLoose(s, 0),
            onChange: opts.onChange || (() => quietSave()),
        });
        const partsTitle = (block) => (block.parts || [])
            .filter((p) => !p.info && !p.unresolved && Number(p.value))
            .map((p) => `${p.label} ${fmt(Number(p.value))}`).join('\n');

        // --- HP / Speed line
        const hpLine = line('Hit Points / Speed');
        const hpVal = h('span', 'summary-hp-pair');
        hpVal.appendChild(editNumNode(st, 'hpCurrent'));
        hpVal.appendChild(document.createTextNode(' / ' + d.blocks.hp.total));
        const cur = Number(st.hpCurrent) || 0;
        box(hpLine, 'HP', hpVal, {
            title: partsTitle(d.blocks.hp),
            cls: d.blocks.hp.total > 0 && cur <= d.blocks.hp.total / 2 ? 'is-bloodied' : undefined,
        });
        box(hpLine, 'Temp', editNumNode(st, 'hpTemp'));
        box(hpLine, 'Nonlethal', editNumNode(st, 'hpNonlethal'));
        for (const [key, label] of [
            ['land', 'Land'], ['climb', 'Climb'], ['swim', 'Swim'], ['fly', 'Fly'], ['burrow', 'Burrow'],
        ]) {
            if (st.speeds[key] == null || st.speeds[key] === '') st.speeds[key] = key === 'land' ? (Number(data.land_speed) || 30) : 0;
            const node = h('span');
            node.appendChild(editNumNode(st.speeds, key));
            if (key === 'fly') {
                const sel = h('select', 'edit-field fly-maneuver-select');
                for (const m of ['—', 'clumsy', 'poor', 'average', 'good', 'perfect']) {
                    const opt = document.createElement('option');
                    opt.value = m === '—' ? '' : m;
                    opt.textContent = m;
                    if ((st.speeds.flyManeuver || '') === opt.value) opt.selected = true;
                    sel.appendChild(opt);
                }
                sel.title = 'Fly maneuverability';
                sel.addEventListener('change', () => {
                    if (sel.value) st.speeds.flyManeuver = sel.value;
                    else delete st.speeds.flyManeuver;
                    quietSave();
                });
                node.appendChild(sel);
            }
            box(hpLine, label, node);
        }

        // --- Defense line
        const defLine = line('Defense');
        box(defLine, 'AC', String(d.blocks.ac.total), { title: partsTitle(d.blocks.ac) });
        box(defLine, 'Touch', String(d.blocks.touch.total), { title: partsTitle(d.blocks.touch) });
        box(defLine, 'Flat-footed', String(d.blocks.flat.total), { title: partsTitle(d.blocks.flat) });
        box(defLine, 'CMD', String(d.blocks.cmd.total), { title: partsTitle(d.blocks.cmd) });
        box(defLine, 'FF CMD', String(d.blocks.cmdFF.total), { title: partsTitle(d.blocks.cmdFF) });

        // --- Saves line
        const savesLine = line('Saving Throws');
        box(savesLine, 'Fort', fmt(d.blocks.fort.total),
            { rollTotal: d.blocks.fort.total, rollLabel: 'Fortitude save', title: partsTitle(d.blocks.fort) });
        box(savesLine, 'Ref', fmt(d.blocks.ref.total),
            { rollTotal: d.blocks.ref.total, rollLabel: 'Reflex save', title: partsTitle(d.blocks.ref) });
        box(savesLine, 'Will', fmt(d.blocks.will.total),
            { rollTotal: d.blocks.will.total, rollLabel: 'Will save', title: partsTitle(d.blocks.will) });
        if (st.sr == null && data.spell_resistance != null) st.sr = Number(data.spell_resistance) || 0;
        const srNode = dblclickEditable(st, 'sr', {
            type: 'number', min: 0,
            format: () => String(srTotal(data)),
            parse: (s) => parseIntLoose(s, 0),
            onChange: () => quietSave(),
        });
        box(savesLine, 'SR', srNode,
            { title: 'Spell resistance total — double-click edits the base (bonuses on Defenses)' });

        // --- Offense line
        const offLine = line('Offense');
        box(offLine, 'BAB', babIterativesStr(d.bab), { title: 'Iterative attacks (up to 4 shown)' });
        box(offLine, 'CMB', fmt(d.blocks.cmb.total),
            { rollTotal: d.blocks.cmb.total, rollLabel: 'CMB', title: partsTitle(d.blocks.cmb) });
        box(offLine, 'Initiative', fmt(d.blocks.init.total),
            { rollTotal: d.blocks.init.total, rollLabel: 'Initiative', title: partsTitle(d.blocks.init) });

        // --- Attacks
        body.appendChild(h('h3', null, 'Attacks'));
        const attackHost = h('div', null);
        attackHost.id = 'summary-attack-panel';
        body.appendChild(attackHost);
        window.SheetRoll?.renderAttackCard?.(attackHost, {
            showConditionals: false,
            showGeneric: true,
        });

        // --- Classes & Archetypes (selectable from saved data, drag to reorder)
        ensureClassList(data);
        ensureArchetypeList(data);
        loadArchetypesByClass(); // per-class archetype options for the picker
        (data.archetype_list || []).forEach(recordUsedArchetype); // grow the used-set

        const summaryRerender = () => { quietSave(); renderSheet(data); setActiveTab('summary'); };

        const entitySection = (cfg) => {
            body.appendChild(h('h3', null, cfg.title));
            if (cfg.hint) body.appendChild(h('p', 'dbl-edit-hint no-print', cfg.hint));
            body.appendChild(sectionCatalogToolbar(cfg.toolbar));
            const list = data[cfg.listKey] || [];
            if (!list.length) {
                body.appendChild(h('p', 'tools-empty', cfg.emptyText));
                return;
            }
            const ul = h('ul', 'plain-list entity-list dnd-list');
            list.forEach((name) => {
                const li = h('li', 'entity-row dnd-item');
                li.dataset.dndId = String(name);
                li.appendChild(dndHandle());
                const btn = h('button', 'entity-row-btn');
                btn.type = 'button';
                const meta = cfg.metaFor(name);
                btn.appendChild(h('span', 'class-row-name', meta.label));
                if (meta.blurb) btn.appendChild(h('span', 'class-row-blurb dim', meta.blurb));
                btn.addEventListener('click', () => cfg.onOpen(name));
                li.appendChild(btn);
                const rm = h('button', 'inv-btn inv-btn-danger entity-row-rm no-print', '×');
                rm.type = 'button';
                rm.title = 'Remove ' + cfg.noun;
                rm.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeFromArrayField(data, cfg.listKey, name);
                    cfg.afterMutate?.();
                    summaryRerender();
                });
                li.appendChild(rm);
                ul.appendChild(li);
            });
            body.appendChild(ul);
            bindDragReorder(ul, '.entity-row', (from, to) => {
                reorderArray(data[cfg.listKey], from, to);
                cfg.afterMutate?.();
                summaryRerender();
            });
        };

        entitySection({
            title: 'Classes',
            noun: 'class',
            listKey: 'class_list',
            emptyText: 'No classes yet — “Browse classes” to add one.',
            hint: 'Drag ⋮⋮ to reorder. The top two classes drive saves, casting, and class features.',
            afterMutate: () => syncLegacyClasses(data),
            metaFor: (name) => {
                const info = classInfoFor(data, name);
                return {
                    label: titleCase(name) + ' — level ' + classLevelFor(data, name),
                    blurb: info.hd
                        ? `d${info.hd} · BAB ${info.bab} · ${info.casting}`
                        : 'click for class details',
                };
            },
            onOpen: (name) => openClassSheet(data, name),
            toolbar: {
                browseLabel: 'Browse classes',
                picker: {
                    title: 'Add class',
                    kinds: ['classes'],
                    kindLabels: { classes: 'Classes' },
                    allowCustom: true,
                    // List every class alphabetically before the user types.
                    showAllOnEmpty: true,
                    localSource: (q) => window.SheetDetails?.searchCatalog?.('classes', q, { limit: 500 }) || [],
                    customPlaceholder: 'Custom class name',
                    onPick: (hit) => {
                        addToArrayField(data, 'class_list', hit.name);
                        syncLegacyClasses(data);
                        summaryRerender();
                    },
                    onCustom: (name) => {
                        addToArrayField(data, 'class_list', name);
                        syncLegacyClasses(data);
                        summaryRerender();
                    },
                },
            },
        });

        entitySection({
            title: 'Archetypes',
            noun: 'archetype',
            listKey: 'archetype_list',
            emptyText: 'No archetypes yet — “Browse archetypes” for used ones or add a custom name.',
            hint: 'Drag ⋮⋮ to reorder. The picker offers archetypes you have used before.',
            metaFor: (name) => ({
                label: titleCase(name),
                blurb: 'base level 0 — click for description',
            }),
            onOpen: (name) => openArchetypeSheet(data, name),
            toolbar: {
                browseLabel: 'Browse archetypes',
                picker: {
                    title: 'Add archetype',
                    kinds: ['archetypes'],
                    kindLabels: { archetypes: 'Archetypes' },
                    allowCustom: true,
                    customPlaceholder: 'Archetype name',
                    showAllOnEmpty: true,
                    localSource: (q) => [...classArchetypeHits(data, q), ...usedArchetypeHits(q)],
                    onPick: (hit) => {
                        addToArrayField(data, 'archetype_list', hit.name);
                        recordUsedArchetype(hit.name);
                        summaryRerender();
                    },
                    onCustom: (name) => {
                        addToArrayField(data, 'archetype_list', name);
                        recordUsedArchetype(name);
                        summaryRerender();
                    },
                },
            },
        });
        return sec;
    }

    function kvInitiative(body, d) {
        const block = d.blocks.init;
        const row = h('div', 'kv kv-stat');
        const k = h('span', 'k');
        k.append(document.createTextNode('Initiative '), rollBtn('Initiative', block.total));
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
        body.appendChild(row);
        return row;
    }

    function tabAttributes(data) {
        const d = computeDerived(data);
        const { sec, body } = section('Attributes', 'attributes-tab');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Double-click a value to edit. Expand “sources” for calculated breakdowns. Use Roll for checks.'));

        kvInitiative(body, d);
        // Speed lives on Summary; BAB on Combat; saves on Defenses.

        // Misc info — senses / aura / languages / proficiencies (_sheet.miscInfo)
        const stMisc = sheetState(data);
        stMisc.miscInfo ??= {};
        const miscRow = (label, field, hint) => {
            const row = h('div', 'kv');
            row.appendChild(h('span', 'k', label));
            const v = h('span', 'v');
            const bag = { t: stMisc.miscInfo[field] || '' };
            v.appendChild(dblclickEditable(bag, 't', {
                format: (x) => (x && String(x).trim() ? String(x) : '—'),
                parse: (s) => String(s),
                onChange: (x) => {
                    const t = String(x || '').trim();
                    if (t) stMisc.miscInfo[field] = t;
                    else delete stMisc.miscInfo[field];
                    quietSave();
                },
            }));
            v.title = hint;
            row.appendChild(v);
            body.appendChild(row);
        };
        miscRow('Senses', 'senses', 'e.g. darkvision 60 ft., low-light vision, scent');
        miscRow('Aura', 'aura', 'e.g. courage 10 ft., fear aura (DC 16)');
        kvDbl(body, 'Languages', data, 'language_text', {
            asArray: true,
            format: (v) => {
                const list = Array.isArray(v) ? v : (v ? [String(v)] : []);
                return list.length ? list.join(', ') : '—';
            },
        });
        miscRow('Weapon proficiencies', 'weaponProf', 'e.g. simple, martial, whip');
        miscRow('Armor proficiencies', 'armorProf', 'e.g. light, medium, heavy, shields');

        // Negative levels — PF1: each gives −1 attacks/saves/skill & ability checks,
        // −5 HP, −1 effective level; equal to HD = death. Applied to sheet math.
        const nlRow = h('div', 'kv');
        nlRow.appendChild(h('span', 'k', 'Negative levels'));
        const nlV = h('span', 'v');
        const nlBag = { v: Number(stMisc.negativeLevels) || 0 };
        nlV.appendChild(dblclickEditable(nlBag, 'v', {
            type: 'number', min: 0, max: 40,
            format: (v) => String(Number(v) || 0),
            parse: (s) => parseIntLoose(s, 0),
            onChange: (v) => {
                const n = Number(v) || 0;
                if (n) stMisc.negativeLevels = n;
                else delete stMisc.negativeLevels;
                quietSave();
                renderSheet(data);
                setActiveTab('attributes');
            },
        }));
        nlRow.appendChild(nlV);
        body.appendChild(nlRow);
        const negLv = Number(stMisc.negativeLevels) || 0;
        if (negLv) {
            body.appendChild(h('p', 'neg-level-warning',
                `⚠ ${negLv} negative level${negLv > 1 ? 's' : ''}: −${negLv} on attack rolls, `
                + `saves, skill and ability checks; −${5 * negLv} max HP; effective level −${negLv}. `
                + `Applied automatically to attacks, saves, skills, initiative, and HP. `
                + `Casters also lose ${negLv} highest-level spell slot${negLv > 1 ? 's' : ''} `
                + `(adjust on Spells); negative levels equal to Hit Dice mean death.`));
        }

        // FoundryVTT-style ability rows: spelled-out name + Total / Modifier /
        // typed bonuses (Racial / Enhance / Inherent / Level-up / Misc) / Damage / Drain,
        // full width. Inherent & Level-up are pre-filled from the generator. Total hover
        // shows the full source formula.
        const ABILITY_NAMES = {
            str: 'Strength', dex: 'Dexterity', con: 'Constitution',
            int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
        };
        const st = sheetState(data);
        const abT = h('table', 'skills-table ability-table');
        const abHd = h('tr');
        ['Ability', 'Total', 'Modifier', 'Base', 'Racial', 'Enhance', 'Inherent',
            'Level-up', 'Misc', 'Damage', 'Drain']
            .forEach((t) => abHd.appendChild(h('th', null, t)));
        abT.appendChild(abHd);
        const rerenderAttrs = () => {
            quietSave();
            renderSheet(data);
            setActiveTab('attributes');
        };
        for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
            const info = abilityInfo(data, ab);
            const tr = h('tr');
            tr.appendChild(h('td', 'ability-name', ABILITY_NAMES[ab]));

            // Total = computed effective score (read-only); hover shows the full formula.
            const totTd = h('td', 'num ability-total', (info.total ?? '—') + '');
            totTd.title = info.formula;
            tr.appendChild(totTd);

            const modTd = h('td', 'num ability-mod', fmt(info.mod));
            modTd.title = 'floor((total − 10) / 2)'
                + (info.damage ? ` − ${Math.floor(info.damage / 2)} (ability damage)` : '');
            tr.appendChild(modTd);

            // Base = the rolled score; racial is split into the Racial column once seeded
            // (older unseeded saves that carry racial_stats still have it baked in).
            const baseTd = h('td', 'num ability-base');
            const racialBaked = !st.racialSeeded && data?.racial_stats;
            baseTd.title = (racialBaked
                ? 'Rolled base score (includes racial modifier). '
                : 'Rolled base score. ') + 'Double-click to edit.';
            baseTd.appendChild(dblclickEditable(data, ab, {
                type: 'number', min: 1, max: 99,
                format: (v) => (Number(v) ? String(Number(v)) : '—'),
                parse: (s) => parseIntLoose(s, 10),
                onChange: rerenderAttrs,
            }));
            tr.appendChild(baseTd);

            const ADJ_HINTS = {
                racial: 'Racial ability modifier (e.g. +2 from race/heritage). '
                    + 'Pre-filled from the generator; editable.',
                enhancement: 'Enhancement bonus (belts, bull’s strength). Equipped items and buffs '
                    + 'add the dim auto value; the editable box is a manual override on top.',
                inherent: 'Inherent bonus (tomes/manuals, wish). Max +5, stacks with '
                    + 'enhancement. Pre-filled from the generator; editable.',
                levelup: 'Level-up ability increases (+1 per 4 levels). Pre-filled from '
                    + 'the generator; editable.',
                misc: 'Any other untyped/situational adjustment to the score. Untyped bonuses '
                    + 'from items/buffs add the dim auto value.',
                damage: 'Ability damage: −1 to the modifier per 2 points.',
                drain: 'Ability drain: −1 to the score per point (permanent).',
            };
            const adjCell = (field, signed) => {
                const td = h('td', 'num');
                if (ADJ_HINTS[field]) td.title = ADJ_HINTS[field];
                const bag = { v: (st.abilityAdjust?.[ab]?.[field]) || 0 };
                td.appendChild(dblclickEditable(bag, 'v', {
                    type: 'number', min: signed ? -99 : 0, max: 99,
                    format: (v) => (Number(v) ? (signed ? fmt(Number(v)) : String(v)) : '—'),
                    parse: (s) => parseIntLoose(s, 0),
                    onChange: (v) => {
                        st.abilityAdjust ??= {};
                        st.abilityAdjust[ab] ??= {};
                        const n = Number(v) || 0;
                        if (n) st.abilityAdjust[ab][field] = n;
                        else delete st.abilityAdjust[ab][field];
                        if (!Object.keys(st.abilityAdjust[ab]).length) delete st.abilityAdjust[ab];
                        rerenderAttrs();
                    },
                }));
                // Auto value from equipped items / buffs (the ledger), shown dim beside the manual
                // box so the enhancement from a belt etc. is visible in its own column.
                const auto = info.autoByCol?.[field] || 0;
                if (auto) {
                    const badge = h('span', 'ability-auto', fmt(auto));
                    badge.title = 'From items/buffs: ' + (info.autoSrc?.[field] || []).join(', ');
                    td.appendChild(badge);
                }
                return td;
            };
            tr.appendChild(adjCell('racial', true));
            tr.appendChild(adjCell('enhancement', true));
            tr.appendChild(adjCell('inherent', true));
            tr.appendChild(adjCell('levelup', true));
            tr.appendChild(adjCell('misc', true));
            tr.appendChild(adjCell('damage', false));
            tr.appendChild(adjCell('drain', false));
            abT.appendChild(tr);
        }
        body.appendChild(abT);
        body.appendChild(h('p', 'dim attr-cols-note',
            'Racial, Inherent and Level-up columns are pre-filled from the generator (editable). '
            + (st.racialSeeded || !data?.racial_stats
                ? 'Older characters without generator racial data keep the Racial column blank.'
                : 'Racial modifiers are already included in the base score.')));

        return sec;
    }

    // ---------------------------------------------------------------- defenses block
    const DR_BYPASS_TYPES = ['—', 'adamantine', 'bludgeoning', 'chaotic', 'cold iron',
        'epic', 'evil', 'good', 'lawful', 'magic', 'piercing', 'silver', 'slashing'];
    const ENERGY_TYPES = ['acid', 'cold', 'electricity', 'fire', 'sonic', 'force',
        'negative energy', 'positive energy'];




    const DAMAGE_TYPES = [...ENERGY_TYPES, 'bludgeoning', 'piercing', 'slashing'];


    function renderDefenses(body, data, d) {
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'AC bonuses by type (hover a box for sources), save buckets, and editable DR / resistances / SR. + adds an entry; × removes it.'));
        const st = sheetState(data);
        const defs = ensureDefenses(data);
        const rerender = () => {
            quietSave();
            renderSheet(data);
            setActiveTab('defenses');
        };

        // --- AC composition by bonus type
        const grid = h('div', 'defense-grid');
        for (const b of acTypeTotals(d.blocks.ac.parts)) {
            const box = h('div', 'feat-count-box def-box');
            box.appendChild(h('span', 'feat-count-label', b.label));
            box.appendChild(h('span', 'feat-count-value', b.total ? fmt(b.total) : '—'));
            if (b.sources.length) box.title = b.sources.join('\n');
            grid.appendChild(box);
        }
        body.appendChild(grid);

        // --- Saves breakdown (rollable — every ledger boost is already in block.total)
        const table = h('table', 'skills-table saves-breakdown');
        const hd = h('tr');
        ['', 'Save', 'Base', 'Abl', 'Enhance', 'Resist', 'Feat', 'Trait', 'Misc', 'Temp', 'Total']
            .forEach((t) => hd.appendChild(h('th', null, t)));
        table.appendChild(hd);
        for (const [label, block] of [
            ['Fortitude', d.blocks.fort], ['Reflex', d.blocks.ref], ['Will', d.blocks.will],
        ]) {
            const bk = saveBuckets(block);
            const tr = h('tr');
            const rollTd = h('td', 'skill-roll-cell no-print');
            rollTd.appendChild(rollBtn(label + ' save', block.total));
            tr.appendChild(rollTd);
            tr.appendChild(h('td', null, label));
            for (const key of ['base', 'ability', 'enh', 'resist', 'feat', 'trait', 'misc', 'temp']) {
                tr.appendChild(h('td', 'num', bk[key] ? fmt(bk[key]) : '—'));
            }
            tr.appendChild(h('td', 'num skill-total', fmt(block.total)));
            table.appendChild(tr);
        }
        body.appendChild(rollAllBar('🎲 Roll all saves',
            'Roll Fort, Ref and Will into the Tools log', table));
        body.appendChild(table);

        // --- shared chip-list builder (DR, resistances, immunities, vulnerabilities)
        const chipSection = (title, list, chipParts, selOptions, onAdd, opts = {}) => {
            const head = h('div', 'def-line-head');
            head.appendChild(h('h4', 'def-h', title));
            const addBtn = h('button', 'inv-btn def-add-btn no-print', '+');
            addBtn.type = 'button';
            addBtn.title = 'Add ' + title.toLowerCase();
            head.appendChild(addBtn);
            body.appendChild(head);

            const row = h('div', 'def-chips');
            list.forEach((entry, idx) => {
                const chip = h('span', 'def-chip');
                chipParts(chip, entry);
                const rm = h('button', 'inv-btn inv-btn-danger def-chip-rm no-print', '×');
                rm.type = 'button';
                rm.title = 'Remove';
                rm.addEventListener('click', () => {
                    list.splice(idx, 1);
                    rerender();
                });
                chip.appendChild(rm);
                row.appendChild(chip);
            });
            if (!list.length) row.appendChild(h('span', 'dim', 'None'));
            body.appendChild(row);

            const form = h('div', 'def-add-row no-print hidden');
            const amt = h('input', 'edit-field def-amt');
            amt.type = 'number';
            amt.min = '0';
            amt.placeholder = '5';
            const sel = h('select', 'edit-field');
            for (const t of selOptions) {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t;
                sel.appendChild(opt);
            }
            const customOpt = document.createElement('option');
            customOpt.value = '__custom';
            customOpt.textContent = 'custom…';
            sel.appendChild(customOpt);
            const custom = h('input', 'edit-field def-custom hidden');
            custom.type = 'text';
            custom.placeholder = 'custom type';
            sel.addEventListener('change', () => {
                custom.classList.toggle('hidden', sel.value !== '__custom');
            });
            const go = h('button', 'inv-btn inv-btn-primary', 'Add');
            go.type = 'button';
            go.addEventListener('click', () => {
                const amount = opts.noAmount ? 0 : parseIntLoose(amt.value, 0);
                if (!opts.noAmount && !amount) {
                    amt.focus();
                    return;
                }
                const type = sel.value === '__custom'
                    ? (custom.value.trim() || '—') : sel.value;
                onAdd(amount, type);
                rerender();
            });
            if (!opts.noAmount) form.append(amt);
            form.append(sel, custom, go);
            body.appendChild(form);
            addBtn.addEventListener('click', () => form.classList.toggle('hidden'));
        };

        // --- Damage reduction: chips like "5/cold iron", amount dblclick-editable
        chipSection('Damage Reduction', defs.dr, (chip, entry) => {
            const bag = { v: Number(entry.amount) || 0 };
            chip.appendChild(dblclickEditable(bag, 'v', {
                type: 'number', min: 0,
                format: (v) => String(v ?? 0),
                parse: (s) => parseIntLoose(s, 0),
                onChange: (v) => {
                    entry.amount = Number(v) || 0;
                    quietSave();
                },
            }));
            chip.appendChild(h('span', 'def-chip-type', '/' + (entry.bypass || '—')));
        }, DR_BYPASS_TYPES, (amount, type) => {
            defs.dr.push({ amount, bypass: type });
        });

        // --- Energy resistances: chips like "Fire 10"
        chipSection('Energy Resistance', defs.resist, (chip, entry) => {
            chip.appendChild(h('span', 'def-chip-type', titleCase(entry.type || '?') + ' '));
            const bag = { v: Number(entry.amount) || 0 };
            chip.appendChild(dblclickEditable(bag, 'v', {
                type: 'number', min: 0,
                format: (v) => String(v ?? 0),
                parse: (s) => parseIntLoose(s, 0),
                onChange: (v) => {
                    entry.amount = Number(v) || 0;
                    quietSave();
                },
            }));
        }, ENERGY_TYPES, (amount, type) => {
            defs.resist.push({ type, amount });
        });

        // --- Healing & toughness: regeneration / fast healing / hardness
        body.appendChild(h('h4', 'def-h', 'Healing & Toughness'));
        const healRow = h('div', 'defense-grid def-stretch');
        const defEditBox = (label, get, set, textOpts) => {
            const box = h('div', 'feat-count-box def-box');
            box.appendChild(h('span', 'feat-count-label', label));
            const bag = { v: get() };
            box.appendChild(dblclickEditable(bag, 'v', textOpts || {
                type: 'number', min: 0,
                format: (v) => (Number(v) ? String(v) : '—'),
                parse: (s) => parseIntLoose(s, 0),
                onChange: (v) => {
                    set(Number(v) || 0);
                    quietSave();
                },
            }));
            return box;
        };
        healRow.appendChild(defEditBox('Regeneration',
            () => Number(defs.regen) || 0, (v) => { defs.regen = v; }));
        healRow.appendChild(defEditBox('Regen. bypass',
            () => defs.regenBypass || '', null, {
                format: (v) => (v && String(v).trim() ? String(v) : '—'),
                parse: (s) => String(s),
                onChange: (v) => {
                    const t = String(v || '').trim();
                    if (t) defs.regenBypass = t;
                    else delete defs.regenBypass;
                    quietSave();
                },
            }));
        healRow.appendChild(defEditBox('Fast Healing',
            () => Number(defs.fastHealing) || 0, (v) => { defs.fastHealing = v; }));
        healRow.appendChild(defEditBox('Hardness',
            () => Number(defs.hardness) || 0, (v) => { defs.hardness = v; }));
        body.appendChild(healRow);

        // --- Immunities / vulnerabilities / condition defenses (type-only chips)
        const typeChip = (chip, entry) => {
            chip.appendChild(h('span', 'def-chip-type', titleCase(entry.type || '?')));
        };
        const condOptions = PF1_CONDITIONS.map((c) => c.label.toLowerCase());
        chipSection('Damage Immunities', defs.dmgImmune, typeChip, DAMAGE_TYPES,
            (a, type) => defs.dmgImmune.push({ type }), { noAmount: true });
        chipSection('Damage Vulnerabilities', defs.dmgVuln, typeChip, DAMAGE_TYPES,
            (a, type) => defs.dmgVuln.push({ type }), { noAmount: true });
        chipSection('Condition Resistances', defs.condResist, typeChip, condOptions,
            (a, type) => defs.condResist.push({ type }), { noAmount: true });
        chipSection('Condition Immunities', defs.condImmune, typeChip, condOptions,
            (a, type) => defs.condImmune.push({ type }), { noAmount: true });

        // --- Spell resistance: base + feat/trait/class/misc boxes + computed total
        body.appendChild(h('h4', 'def-h', 'Spell Resistance'));
        if (st.sr == null && data.spell_resistance != null) {
            st.sr = Number(data.spell_resistance) || 0;
        }
        st.srBonus ??= {};
        const srRow = h('div', 'defense-grid def-sr-row def-stretch');
        const srBox = (label, get, set) => {
            const box = h('div', 'feat-count-box def-box');
            box.appendChild(h('span', 'feat-count-label', label));
            const bag = { v: get() };
            box.appendChild(dblclickEditable(bag, 'v', {
                type: 'number', min: 0,
                format: (v) => String(Number(v) || 0),
                parse: (s) => parseIntLoose(s, 0),
                onChange: (v) => {
                    set(Number(v) || 0);
                    rerender();
                },
            }));
            return box;
        };
        srRow.appendChild(srBox('Base', () => Number(st.sr) || 0, (v) => { st.sr = v; }));
        for (const [key, label] of [['feat', 'Feat'], ['trait', 'Trait'], ['class', 'Class'], ['misc', 'Misc']]) {
            srRow.appendChild(srBox(label,
                () => Number(st.srBonus[key]) || 0,
                (v) => {
                    if (v) st.srBonus[key] = v;
                    else delete st.srBonus[key];
                }));
        }
        const totBox = h('div', 'feat-count-box def-box def-sr-total');
        totBox.appendChild(h('span', 'feat-count-label', 'SR Total'));
        totBox.appendChild(h('span', 'feat-count-value', String(srTotal(data))));
        srRow.appendChild(totBox);
        body.appendChild(srRow);
    }


    function tabCombat(data) {
        const d = computeDerived(data);
        const { sec, body } = section('Combat', 'combat');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Attack hub: bonus strip on top, weapon fields, and the attack roller. AC / saves / DR live on Defenses; HP and speeds on Summary.'));

        // Top strip: BAB iteratives + core attack bonuses (rollable where useful)
        const strip = h('div', 'summary-combat-strip combat-top-strip');
        const box = (label, value, opts = {}) => {
            const b = h('div', 'summary-stat-box');
            const head = h('div', 'summary-stat-head');
            head.appendChild(document.createTextNode(label + ' '));
            if (opts.rollTotal != null) {
                head.appendChild(rollBtn(opts.rollLabel || label, opts.rollTotal));
            }
            b.appendChild(head);
            b.appendChild(h('div', 'summary-stat-val', value));
            attachStatHint(b, label);
            if (opts.title) b.title = opts.title;
            strip.appendChild(b);
            return b;
        };
        box('BAB', babIterativesStr(d.bab), { title: 'Iterative attacks (up to 4 shown)' });
        box('CMB', fmt(d.blocks.cmb.total), { rollTotal: d.blocks.cmb.total, rollLabel: 'CMB' });
        const meleeBox = box('Melee', fmt(d.blocks.melee.total),
            { rollTotal: d.blocks.melee.total, rollLabel: 'Melee attack' });
        attachNotesHover(meleeBox, data, ['attack', 'mattack']);
        const rangedBox = box('Ranged', fmt(d.blocks.ranged.total),
            { rollTotal: d.blocks.ranged.total, rollLabel: 'Ranged attack' });
        attachNotesHover(rangedBox, data, ['attack', 'rattack']);
        box('Init', fmt(d.blocks.init.total),
            { rollTotal: d.blocks.init.total, rollLabel: 'Initiative' });
        body.appendChild(strip);

        // Weapons — the same rows as Inventory (name / ⚙ opens the full item sheet)
        body.appendChild(h('h3', null, 'Weapons'));
        migrateCoreGear(data);
        const invList = ensureInventoryObjects(data);
        const weaponRows = [];
        invList.forEach((item, i) => {
            if (inventoryCategory(item) === 'weapons') weaponRows.push({ item, index: i });
        });
        if (weaponRows.length) {
            const pack = h('div', 'inv-list combat-weapons');
            for (const { item, index } of weaponRows) {
                pack.appendChild(renderInventoryItemCard(data, item, index));
            }
            body.appendChild(pack);
        } else {
            body.appendChild(h('p', 'dim no-print',
                'No weapons in inventory — add one on the Inventory tab (Browse items → Weapons).'));
        }

        body.appendChild(h('h3', null, 'Attack'));
        const attackHost = h('div', null);
        attackHost.id = 'combat-attack-panel';
        body.appendChild(attackHost);
        window.SheetRoll?.renderAttackCard?.(attackHost, {
            showConditionals: true,
            showGeneric: true,
        });

        return sec;
    }

    function tabDefenses(data) {
        const d = computeDerived(data);
        const { sec, body } = section('Defenses', 'defenses-tab');
        renderDefenses(body, data, d);
        // Armor & shield — same inventory-style rows as the weapons on Combat
        // (name / ⚙ open the item sheet, incl. the Enhancements block)
        body.appendChild(h('h4', 'def-h', 'Armor & Shield'));
        migrateCoreGear(data);
        const invList = ensureInventoryObjects(data);
        const armorRows = [];
        invList.forEach((item, i) => {
            if (inventoryCategory(item) === 'armor') armorRows.push({ item, index: i });
        });
        if (armorRows.length) {
            const pack = h('div', 'inv-list defense-armor');
            for (const { item, index } of armorRows) {
                pack.appendChild(renderInventoryItemCard(data, item, index));
            }
            body.appendChild(pack);
        } else {
            body.appendChild(h('p', 'dim no-print',
                'No armor in inventory — add it on the Inventory tab (Browse items).'));
        }
        // The generator's armor numbers (armor_ac & co.) still feed the AC math —
        // they show in the AC "sources" expander; no separate input rows here.
        return sec;
    }


    function tabSettings() {
        const { sec, body } = section('Settings');

        body.appendChild(h('h3', null, 'Appearance'));
        const themeHint = h('p', 'dim', 'Built-in themes use semantic color tokens (ink, paper, accent) with WCAG AA contrast targets; custom colors are used exactly as picked. System follows your OS light/dark preference.');
        body.appendChild(themeHint);
        const themeGrid = h('div', 'settings-theme-grid');
        themeGrid.setAttribute('role', 'radiogroup');
        themeGrid.setAttribute('aria-label', 'Color theme');
        const pref = themePreference();
        renderThemeCards(themeGrid, 'settings');
        body.appendChild(themeGrid);
        const customPanel = buildCustomThemeControls();
        customPanel.classList.toggle('hidden', pref !== 'custom');
        body.appendChild(customPanel);

        // Beginner helpers — same state the rail toggles, reachable from a settled place.
        body.appendChild(h('h3', null, 'Beginner helpers'));
        body.appendChild(h('p', 'dim', 'Pick who is holding the sheet and everything below follows. Fine-tune any of it afterwards — your choice sticks. Explain and the view switch are also on the action rail and in the top bar.'));

        // The parent switch: picking one sets everything below it in one move. The rows that
        // follow stay editable, so a mostly-expert player can keep any single helper on.
        const audienceRow = h('div', 'settings-row');
        audienceRow.appendChild(h('span', 'settings-row-label', "Who's using this sheet?"));
        const audienceGroup = h('div', 'view-segmented');
        audienceGroup.setAttribute('role', 'group');
        audienceGroup.setAttribute('aria-label', 'Beginner or experienced player');
        for (const [value, label, hint] of [
            ['beginner', 'New to this', 'Plain-English notes, the one-page sheet, and the big action buttons'],
            ['expert', 'I know Pathfinder', 'Hides the beginner helpers and starts on the detailed tabbed sheet'],
        ]) {
            const on = audience() === value;
            const segBtn = h('button', 'view-seg' + (on ? ' is-on' : ''));
            segBtn.type = 'button';
            segBtn.title = hint;
            segBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
            segBtn.appendChild(h('span', 'view-seg-dot', on ? '●' : ''));
            segBtn.appendChild(h('span', 'view-seg-label', label));
            segBtn.addEventListener('click', () => {
                if (audience() === value) return;
                setAudience(value);
            });
            audienceGroup.appendChild(segBtn);
        }
        audienceRow.appendChild(audienceGroup);
        body.appendChild(audienceRow);

        const explainRow = h('div', 'settings-row');
        const explainLabel = h('label', 'settings-check');
        const explainBox = h('input');
        explainBox.type = 'checkbox';
        explainBox.checked = explainMode();
        explainBox.addEventListener('change', () => setExplainMode(explainBox.checked));
        explainLabel.append(explainBox, h('span', null, 'Explain mode — plain-English notes under the numbers'));
        explainRow.appendChild(explainLabel);
        body.appendChild(explainRow);

        const viewRow = h('div', 'settings-row');
        viewRow.appendChild(h('span', 'settings-row-label', 'Start on'));
        const viewSel = h('select');
        viewSel.className = 'settings-row-select';
        for (const [value, label] of [['simple', 'Simple sheet'], ['full', 'Complex sheet']]) {
            const opt = h('option', null, label);
            opt.value = value;
            viewSel.appendChild(opt);
        }
        viewSel.value = viewMode();
        viewSel.addEventListener('change', () => {
            setViewMode(viewSel.value);
            renderSheet(currentData);
        });
        viewRow.appendChild(viewSel);
        body.appendChild(viewRow);

        // Power-user display density for the complex/tabbed sheet.
        const densityRow = h('div', 'settings-row');
        const densityLabel = h('label', 'settings-check');
        const densityBox = h('input');
        densityBox.type = 'checkbox';
        densityBox.checked = densityCompact();
        densityBox.addEventListener('change', () => setDensityCompact(densityBox.checked));
        densityLabel.append(densityBox, h('span', null, 'Compact density — tighter tables and type on the detailed sheet'));
        densityRow.appendChild(densityLabel);
        body.appendChild(densityRow);

        const guideRow = h('div', 'settings-row');
        for (const [label, run] of [['Start here', openStartHere], ['Full instructions', openInstructions]]) {
            const btn = h('button', null, label);
            btn.type = 'button';
            btn.addEventListener('click', run);
            guideRow.appendChild(btn);
        }
        body.appendChild(guideRow);

        body.appendChild(h('h3', null, 'Generation Backend'));
        const urlRow = h('div', 'settings-row');
        const urlInput = h('input');
        urlInput.type = 'text';
        urlInput.value = backendUrl();
        urlInput.className = 'settings-input';
        const setBtn = h('button', null, 'Set');
        setBtn.addEventListener('click', () => {
            const v = urlInput.value.trim().replace(/\/+$/, '');
            if (v) localStorage.setItem(BACKEND_KEY, v);
            urlInput.value = backendUrl();
        });
        const resetBtn = h('button', null, 'Reset to hosted');
        resetBtn.addEventListener('click', () => {
            localStorage.removeItem(BACKEND_KEY);
            urlInput.value = backendUrl();
        });
        urlRow.append(urlInput, setBtn, resetBtn);
        body.appendChild(urlRow);

        body.appendChild(h('h3', null, 'Character Folder'));
        const folderStatus = h('p', 'dim');
        const folderRow = h('div', 'settings-row');
        const refreshFolderUi = () => {
            const st = window.SheetLibrary?.status() || { state: 'unsupported' };
            folderStatus.textContent = {
                unsupported: 'This browser cannot write disk folders (File System Access API — use Chrome/Edge). Characters are stored in the browser.',
                none: 'No folder connected — characters are stored in the browser only.',
                'need-permission': `Folder "${st.folderName}" remembered — click Reconnect to re-grant access.`,
                connected: `Connected to "${st.folderName}" — every save writes a .json file there.`,
            }[st.state];
            connectBtn.textContent = st.state === 'connected' ? 'Change folder' : 'Connect folder';
            reconnectBtn.classList.toggle('hidden', st.state !== 'need-permission');
            disconnectBtn.classList.toggle('hidden', st.state !== 'connected' && st.state !== 'need-permission');
            connectBtn.disabled = st.state === 'unsupported';
        };
        const connectBtn = h('button', null, 'Connect folder');
        connectBtn.addEventListener('click', async () => {
            try { await window.SheetLibrary.connectFolder(); } catch { /* picker cancelled */ }
            refreshFolderUi(); refreshRoster();
        });
        const reconnectBtn = h('button', null, 'Reconnect');
        reconnectBtn.addEventListener('click', async () => {
            await window.SheetLibrary.reconnectFolder();
            refreshFolderUi(); refreshRoster();
        });
        const disconnectBtn = h('button', null, 'Disconnect');
        disconnectBtn.addEventListener('click', async () => {
            await window.SheetLibrary.disconnectFolder();
            refreshFolderUi(); refreshRoster();
        });
        folderRow.append(connectBtn, reconnectBtn, disconnectBtn);
        body.append(folderStatus, folderRow);
        refreshFolderUi();

        body.appendChild(h('h3', null, 'Library'));
        const libRow = h('div', 'settings-row');
        const exportBtn = h('button', null, 'Export all');
        exportBtn.addEventListener('click', async () => {
            const all = await window.SheetLibrary.exportAll();
            const blob = new Blob([JSON.stringify(all, null, 1)], { type: 'application/json' });
            const aEl = h('a');
            aEl.href = URL.createObjectURL(blob);
            aEl.download = 'characters-export.json';
            aEl.click();
            URL.revokeObjectURL(aEl.href);
        });
        const importInput = h('input');
        importInput.type = 'file';
        importInput.accept = '.json,application/json';
        importInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const parsed = JSON.parse(await file.text());
                const items = Array.isArray(parsed) ? parsed : [parsed];
                for (const item of items) await window.SheetLibrary.save(item);
                refreshRoster();
            } catch (err) { alert('Import failed: ' + err.message); }
            e.target.value = '';
        });
        libRow.append(exportBtn, importInput);
        body.appendChild(libRow);

        return sec;
    }

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

    function renderSimpleSheet(data) {
        const d = computeDerived(data);
        const st = sheetState(data);
        const SD = window.SheetDetails;
        const wrap = h('div', 'simple-sheet');

        // Edit helpers: every commit quiet-saves via editableField; opts.rerender repaints
        // the sheet when the edited value feeds computeDerived / skill math.
        const rerender = () => renderSheet(currentData || data);
        const edit = (obj, key, opts = {}) => dblclickEditable(obj, key, {
            ...opts,
            onChange: (v, o) => {
                opts.onChange?.(v, o);
                if (opts.rerender) rerender();
            },
        });
        const editNum = (obj, key, opts = {}) => edit(obj, key, {
            type: 'number',
            parse: (s) => parseIntLoose(s, 0),
            ...opts,
        });
        // Editing a computed total stores the delta as a "Manual adjustment" that
        // computeDerived folds into both views' math.
        const adjustable = (key, block, opts = {}) => {
            const bag = { total: block.total };
            return dblclickEditable(bag, 'total', {
                type: 'number',
                format: () => (opts.plain ? String(block.total) : fmt(block.total)),
                parse: (s) => parseIntLoose(s, block.total),
                onChange: () => {
                    const delta = (Number(bag.total) || 0) - block.total;
                    if (delta) {
                        st.manualAdjust ??= {};
                        st.manualAdjust[key] = (Number(st.manualAdjust[key]) || 0) + delta;
                    }
                    rerender();
                },
            });
        };
        const titled = (v) => (v ? titleCase(String(v)) : '');

        // ---- page 1: identity, abilities, combat, skills ----
        const p1 = h('section', 'simple-page');
        p1.appendChild(h('p', 'simple-hint no-print',
            'Double-click a value to edit. Editing a total (AC, saves, Initiative, …) stores a manual adjustment that also shows on the full sheet. '
            + 'Double-click a blank line under Feats, Gear, etc. to add an entry; clear a name to remove it.'));

        const nameRow = h('div', 'simple-name-row');
        nameRow.appendChild(spCell('Character Name', edit(data, 'character_full_name'), 'simple-name-cell'));
        nameRow.appendChild(spCell('Player', edit(st, 'player')));

        const clsWrap = h('span', 'simple-inline-edits');
        clsWrap.appendChild(edit(data, 'c_class', { format: titled, rerender: true }));
        if (Array.isArray(data.classes) && data.classes.length > 1) {
            // multiclass payload: "Fighter 6 / Wizard 4 / ..." — the editable level is the
            // primary class's level ("level" keeps that meaning in multiclass payloads)
            clsWrap.appendChild(document.createTextNode(' '));
            clsWrap.appendChild(editNum(data, 'level', { min: 1, max: 40, rerender: true }));
            clsWrap.appendChild(h('span', null, ' / '
                + data.classes.slice(1).map((c) => `${titleCase(c.display || c.name)} ${c.level}`).join(' / ')));
        } else {
            if (data.c_class_2) clsWrap.appendChild(h('span', null, ' / ' + titleCase(data.c_class_2)));
            clsWrap.appendChild(document.createTextNode(' '));
            clsWrap.appendChild(editNum(data, 'level', { min: 1, max: 40, rerender: true }));
        }
        const id = h('div', 'simple-id-grid');
        id.appendChild(spCell('Alignment', edit(data, 'alignment', {
            format: (v) => {
                const s = String(v || '');
                return s.length <= 2 ? s.toUpperCase() : titleCase(s);
            },
        })));
        id.appendChild(spCell('Class & Level', clsWrap));
        id.appendChild(spCell('Race', edit(data, 'chosen_race', { format: titled })));
        id.appendChild(spCell('Deity', edit(data, 'deity_name', {
            format: (v) => Array.isArray(v) ? v.join(', ') : (v == null ? '' : String(v)),
            parse: (s) => {
                const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
                return parts.length <= 1 ? (parts[0] || '') : parts;
            },
        })));
        id.appendChild(spCell('Homeland', edit(data, 'region')));
        id.appendChild(spCell('Size', edit(data, 'size')));
        id.appendChild(spCell('Gender', edit(data, 'gender', { format: titled })));
        id.appendChild(spCell('Age', editNum(data, 'age_number', { min: 0 })));
        id.appendChild(spCell('Height', edit(data, 'height_number')));
        id.appendChild(spCell('Weight', editNum(data, 'weight_number', { min: 0 })));

        // Identity block (name + id grid); a stored portrait sits beside it when present.
        const idBlock = h('div', 'simple-id-block');
        idBlock.appendChild(nameRow);
        idBlock.appendChild(id);
        const portraitUrl = data?._sheet?.portrait;
        if (portraitUrl) {
            const row = h('div', 'simple-id-withportrait');
            const pImg = h('img', 'simple-portrait');
            pImg.src = portraitUrl;
            pImg.alt = 'Character portrait';
            row.appendChild(pImg);
            row.appendChild(idBlock);
            p1.appendChild(row);
        } else {
            p1.appendChild(idBlock);
        }

        const cols = h('div', 'simple-cols');
        const left = h('div', 'simple-col');
        const right = h('div', 'simple-col');
        cols.append(left, right);
        p1.appendChild(cols);

        // Abilities
        left.appendChild(spHeading('Ability Scores'));
        left.appendChild(spTable(
            ['Ability', { text: 'Score', cls: 'num' }, { text: 'Mod', cls: 'num' }],
            ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((ab) => [
                ab.toUpperCase(),
                { node: editNum(data, ab, { min: 1, max: 99, rerender: true }), cls: 'num' },
                { text: data[ab] != null ? fmt(abModOf(data, ab)) : '', cls: 'num strong' },
            ])));

        // HP / init / speed
        left.appendChild(spHeading('Hit Points & Initiative'));
        const vit = h('div', 'simple-stat-grid');
        const maxHp = d.blocks.hp.total || 0;
        if (st.hpCurrent == null || st.hpCurrent === '') st.hpCurrent = maxHp;
        if (st.hpNonlethal == null || st.hpNonlethal === '') st.hpNonlethal = 0;
        const hpBag = { max: maxHp };
        vit.appendChild(spBoxBig('Max HP', dblclickEditable(hpBag, 'max', {
            type: 'number',
            min: 0,
            format: () => String(maxHp),
            parse: (s) => parseIntLoose(s, maxHp),
            onChange: () => {
                // Shift the rolled-dice component so the computed total matches (kvHp-style).
                const delta = (Number(hpBag.max) || 0) - maxHp;
                if (delta) {
                    const rolled = toInt(data.total_rolled_hp)
                        ?? (d.blocks.hp.parts.find((p) => p.kind === 'base' && !p.unresolved)?.value ?? 0);
                    data.total_rolled_hp = rolled + delta;
                    if (Number(st.hpCurrent) === maxHp) st.hpCurrent = maxHp + delta;
                }
                rerender();
            },
        })));
        vit.appendChild(spBoxBig('Current HP', editNum(st, 'hpCurrent', { min: 0 })));
        vit.appendChild(spBoxBig('Nonlethal', editNum(st, 'hpNonlethal', { min: 0 })));
        vit.appendChild(spBoxBig('Initiative', adjustable('init', d.blocks.init)));
        st.speeds ??= {};
        if (st.speeds.land == null || st.speeds.land === '') {
            st.speeds.land = Number(data.land_speed) || 30;
        }
        const extraSpeeds = ['climb', 'swim', 'fly', 'burrow']
            .map((k) => [k, Number(st.speeds[k]) || 0])
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${titleCase(k)} ${v}`)
            .join(', ');
        vit.appendChild(spBoxBig('Speed', editNum(st.speeds, 'land', {
            min: 0,
            suffix: ' ft',
            onChange: () => { data.land_speed = st.speeds.land; },
        })));
        vit.appendChild(spBoxBig('Other Speeds', extraSpeeds || '—'));
        left.appendChild(vit);

        // Defense
        left.appendChild(spHeading('Defense'));
        const defGrid = h('div', 'simple-stat-grid');
        defGrid.appendChild(spBoxBig('AC', adjustable('ac', d.blocks.ac, { plain: true })));
        defGrid.appendChild(spBoxBig('Touch', adjustable('touch', d.blocks.touch, { plain: true })));
        defGrid.appendChild(spBoxBig('Flat-Footed', adjustable('flat', d.blocks.flat, { plain: true })));
        left.appendChild(defGrid);
        const acMisc = d.ac - 10 - d.armorAc - d.shieldAc - d.effDex;
        left.appendChild(h('p', 'simple-formula',
            `AC = 10 + armor ${d.armorAc} + shield ${d.shieldAc} + Dex ${fmt(d.effDex)}`
            + (acMisc ? ` + misc ${fmt(acMisc)}` : '')));

        // Saves
        const saveRow = (label, key, block, abLabel, abMod) => {
            const base = block.parts.find((p) => p.kind === 'base' && !p.unresolved)?.value ?? 0;
            const misc = block.total - base - abMod;
            return [
                label,
                { node: adjustable(key, block), cls: 'num strong' },
                { text: String(base), cls: 'num' },
                { text: `${fmt(abMod)} ${abLabel}`, cls: 'num' },
                { text: misc ? fmt(misc) : '—', cls: 'num' },
            ];
        };
        left.appendChild(spHeading('Saving Throws'));
        left.appendChild(spTable(
            ['Save', { text: 'Total', cls: 'num' }, { text: 'Base', cls: 'num' },
                { text: 'Ability', cls: 'num' }, { text: 'Misc', cls: 'num' }],
            [
                saveRow('Fortitude', 'fort', d.blocks.fort, 'Con', d.conM),
                saveRow('Reflex', 'ref', d.blocks.ref, 'Dex', d.dexM),
                saveRow('Will', 'will', d.blocks.will, 'Wis', d.wisM),
            ]));

        // Offense
        left.appendChild(spHeading('Offense'));
        const offGrid = h('div', 'simple-stat-grid');
        offGrid.appendChild(spBoxBig('BAB', editNum(data, 'bab_total', {
            min: 0,
            rerender: true,
            format: (v) => fmt(Number(v) || 0),
        })));
        offGrid.appendChild(spBoxBig('Melee', adjustable('melee', d.blocks.melee)));
        offGrid.appendChild(spBoxBig('Ranged', adjustable('ranged', d.blocks.ranged)));
        offGrid.appendChild(spBoxBig('CMB', adjustable('cmb', d.blocks.cmb)));
        offGrid.appendChild(spBoxBig('CMD', adjustable('cmd', d.blocks.cmd, { plain: true })));
        if (st.sr == null || st.sr === '') st.sr = Number(data.spell_resistance) || 0;
        offGrid.appendChild(spBoxBig('SR', editNum(st, 'sr', {
            min: 0,
            format: () => (srTotal(data) ? String(srTotal(data)) : '—'),
        })));
        left.appendChild(offGrid);

        // Weapons
        const isRangedType = (w) => !!w && ['rwak', 'rsak', 'twak'].includes(w.actionType);
        const critStr = (w) => w
            ? (w.critRange && w.critRange < 20 ? w.critRange + '–20' : '20') + '/×' + (w.critMult || 2)
            : '';
        const dmgTypeStr = (w) => (w?.parts?.[0]?.types || [])
            .map((t) => String(t).charAt(0).toUpperCase()).join('/');
        const weaponRows = [];
        const mainName = (data.weapon_name || '').trim();
        if (mainName) {
            const w = SD?.lookupWeapon?.(mainName);
            const atk = isRangedType(w) ? d.blocks.ranged.total : d.blocks.melee.total;
            weaponRows.push([
                gearLine(mainName, data.weapon_enhancement_chosen_list) || mainName,
                { text: fmt(atk), cls: 'num strong' },
                { text: critStr(w), cls: 'num' },
                { text: d.blocks.damage?.total || w?.dice || '', cls: 'num' },
                dmgTypeStr(w),
            ]);
        }
        for (const item of ensureInventoryObjects(data)) {
            if (!item?.name || item.name.toLowerCase() === mainName.toLowerCase()) continue;
            const w = SD?.lookupWeapon?.(item.name);
            if (!w) continue;
            const atk = isRangedType(w) ? d.blocks.ranged.total : d.blocks.melee.total;
            const abKey = String(w.damageAbility || 'str').toLowerCase();
            const abMod = ({ str: d.strM, dex: d.dexM, con: d.conM, int: d.intM, wis: d.wisM, cha: d.chaM })[abKey] ?? 0;
            weaponRows.push([
                item.name,
                { text: fmt(atk), cls: 'num' },
                { text: critStr(w), cls: 'num' },
                { text: (w.dice || '') + (abMod ? (abMod > 0 ? '+' : '') + abMod : ''), cls: 'num' },
                dmgTypeStr(w),
            ]);
        }
        const weaponBlanks = Math.max(4 - weaponRows.length, 2);
        for (let i = 0; i < weaponBlanks; i++) {
            weaponRows.push({
                cls: 'simple-blank-row' + (i > 0 ? ' simple-blank-extra' : ''),
                cells: ['', '', '', '', ''],
            });
        }
        left.appendChild(spHeading('Weapons'));
        left.appendChild(spTable(
            ['Weapon', { text: 'Attack', cls: 'num' }, { text: 'Crit', cls: 'num' },
                { text: 'Damage', cls: 'num' }, 'Type'],
            weaponRows));
        const wornBits = [
            gearLine(data.armor_name, data.armor_enhancement_chosen_list),
            gearLine(data.shield_name, data.shield_enhancement_chosen_list),
        ].filter(Boolean);
        if (wornBits.length) {
            left.appendChild(h('p', 'simple-formula', 'Worn: ' + wornBits.join(' · ')));
        }

        // Gear — editable name / qty / per-unit weight; blank rows add items
        // (addInventoryItem fills weight & price from the compendium when the name matches).
        left.appendChild(spHeading('Gear'));
        const eqList = data.equipment_list ??= [];
        const gearRows = [];
        let totalWt = 0;
        for (const item of eqList) {
            if (!item || typeof item !== 'object') continue;
            const qty = Math.max(1, Number(item.quantity) || 1);
            const wt = item.weight != null && Number.isFinite(Number(item.weight))
                ? Number(item.weight) * qty : null;
            if (wt) totalWt += wt;
            gearRows.push([
                { node: edit(item, 'name', {
                    onChange: () => {
                        if (!String(item.name || '').trim()) {
                            const ix = eqList.indexOf(item);
                            if (ix >= 0) eqList.splice(ix, 1);
                        }
                        rerender();
                    },
                }) },
                { node: editNum(item, 'quantity', {
                    min: 1,
                    rerender: true,
                    parse: (s) => Math.max(1, parseIntLoose(s, 1)),
                }), cls: 'num' },
                { node: editNum(item, 'weight', {
                    min: 0,
                    rerender: true,
                    format: (v) => (v == null || v === '' ? '—' : String(v)),
                    parse: (s) => {
                        const n = parseFloat(s);
                        return Number.isFinite(n) ? n : null;
                    },
                }), cls: 'num' },
            ]);
        }
        const gearBlanks = Math.max(8 - gearRows.length, 2);
        for (let i = 0; i < gearBlanks; i++) {
            const bag = { name: '' };
            gearRows.push({
                cls: 'simple-blank-row' + (i > 0 ? ' simple-blank-extra' : ''),
                cells: [
                    { node: dblclickEditable(bag, 'name', {
                        format: (v) => (v && String(v).trim() ? String(v) : ' '),
                        onChange: () => {
                            const nm = String(bag.name || '').trim();
                            if (nm) {
                                addInventoryItem(data, nm);
                                rerender();
                            }
                        },
                    }) },
                    '', '',
                ],
            });
        }
        left.appendChild(spTable(
            ['Item', { text: 'Qty', cls: 'num' }, { text: 'Wt.', cls: 'num' }],
            gearRows));
        const load = loadCategory(totalWt, data.str);
        left.appendChild(h('p', 'simple-formula',
            `Total ${fmtWeight(totalWt)} — ${load.label} load`
            + ` (light ${load.lim.light} / medium ${load.lim.medium} / heavy ${load.lim.heavy} lbs)`));

        // Languages
        left.appendChild(spHeading('Languages'));
        const langsP = h('p', 'simple-langs');
        langsP.appendChild(edit(data, 'language_text', { asArray: true }));
        left.appendChild(langsP);

        // Skills (same math and rank storage as the Skills tab)
        right.appendChild(spHeading('Skills'));
        const rankMap = ensureSkillRanksObject(data);
        const craftLabel = data.craft_type ? `Craft (${data.craft_type})` : 'Craft';
        const skillRows = [];
        for (const skill of ALL_SKILLS) {
            const displayName = skill.name === 'Craft' ? craftLabel
                : skill.name === 'Profession' && nonEmpty(data.profession_ranks) ? null
                    : skill.name;
            if (displayName === null) continue;
            const rKey = skillRankKey(
                skill.name === 'Craft' && data.craft_type ? craftLabel : skill.name,
            );
            const ranks = ranksForSkill(rankMap, skill.name)
                || ranksForSkill(rankMap, displayName)
                || (skill.name === 'Craft' && data.craft_type ? ranksForSkill(rankMap, 'craft') : 0);
            const ab = getSkillAbility(data, skill);
            const abMod = abModOf(data, ab);
            const misc = skillMiscBonus(data, { ...skill, ab });
            // Fold user bonuses (racial/feat/trait/misc/class-skill) into Misc here
            const user = skillUserBonus(data, skillAbilityKey(skill), ranks);
            const extra = misc.total + user.total;
            skillRows.push([
                displayName,
                ab.toUpperCase(),
                { text: fmt(ranks + abMod + extra), cls: 'num strong' },
                { text: fmt(abMod), cls: 'num' },
                { node: ranksEditor(data, rKey, ranks), cls: 'num' },
                { text: extra ? fmt(extra) : '—', cls: 'num' },
            ]);
        }
        for (const p of data.profession_ranks || []) {
            const label = p.skill_label || p.name || 'Profession';
            const ranks = Number(p.ranks) || 0;
            const abMod = abModOf(data, 'wis');
            const misc = skillMiscBonus(data, { ab: 'wis', id: 'pro', acp: false });
            const user = skillUserBonus(data, 'pro:' + label, ranks);
            const extra = misc.total + user.total;
            skillRows.push([
                label, 'WIS',
                { text: fmt(ranks + abMod + extra), cls: 'num strong' },
                { text: fmt(abMod), cls: 'num' },
                { node: editNum(p, 'ranks', { min: 0, max: 40, rerender: true }), cls: 'num' },
                { text: extra ? fmt(extra) : '—', cls: 'num' },
            ]);
        }
        right.appendChild(spTable(
            ['Skill', 'Abl', { text: 'Total', cls: 'num' }, { text: 'Mod', cls: 'num' },
                { text: 'Ranks', cls: 'num' }, { text: 'Misc', cls: 'num' }],
            skillRows, 'simple-skills'));

        wrap.appendChild(p1);

        // ---- page 2: feats, traits, abilities, money, spells ----
        const p2 = h('section', 'simple-page');

        // Editable name lists: dblclick a line to rename (clear it to remove);
        // dblclick a blank line to add a new entry.
        const editableNameList = (rows, onAdd, minLines = 3) => {
            const ul = h('ul', 'simple-name-list');
            for (const r of rows) {
                const li = h('li');
                li.appendChild(dblclickEditable(r.obj, r.key, {
                    format: r.format,
                    parse: r.parse,
                    onChange: () => {
                        const v = r.obj[r.key];
                        if (v == null || String(v).trim() === '') r.remove();
                        rerender();
                    },
                }));
                ul.appendChild(li);
            }
            // Pad with blanks to at least minLines, then round up to fill the 3-wide grid row
            let blanks = Math.max(minLines - rows.length, 1);
            blanks += (3 - ((rows.length + blanks) % 3)) % 3;
            for (let b = 0; b < blanks; b++) {
                const li = h('li', 'simple-blank' + (b > 0 ? ' simple-blank-extra' : ''));
                const bag = { name: '' };
                li.appendChild(dblclickEditable(bag, 'name', {
                    format: (v) => (v && String(v).trim() ? String(v) : ' '),
                    onChange: () => {
                        const nm = String(bag.name || '').trim();
                        if (nm) {
                            onAdd(nm);
                            rerender();
                        }
                    },
                }));
                ul.appendChild(li);
            }
            return ul;
        };
        const arrayRows = (arr, opts = {}) => (arr || []).map((_, i) => ({
            obj: arr,
            key: i,
            format: opts.format,
            parse: opts.parse,
            remove: () => arr.splice(i, 1),
        }));

        const featRows = [];
        for (const g of FEAT_GROUPS) featRows.push(...arrayRows(data[g.listKey]));
        p2.appendChild(spHeading('Feats'));
        p2.appendChild(editableNameList(featRows, (nm) => {
            (data.feats ??= []).push(nm);
        }));

        const traitRows = [
            ...arrayRows(data.selected_traits),
            ...arrayRows(data.background_traits),
            ...arrayRows(data.sphere_traits),
            ...arrayRows(data.flaw, {
                format: (v) => (v ? v + ' (flaw)' : ''),
                parse: (s) => s.replace(/\s*\(flaw\)\s*$/i, '').trim(),
            }),
        ];
        p2.appendChild(spHeading('Traits & Flaws'));
        p2.appendChild(editableNameList(traitRows, (nm) => {
            (data.selected_traits ??= []).push(nm);
        }));

        // class_ability entries look like "arcane bond_wizard" — edit the name, keep the class suffix
        const abilityRows = (data.class_ability || []).map((entry, i) => {
            const s = String(entry ?? '');
            const cut = s.lastIndexOf('_');
            const suffix = cut > 0 ? s.slice(cut) : '';
            return {
                obj: data.class_ability,
                key: i,
                format: (v) => {
                    const str = String(v ?? '');
                    const c = str.lastIndexOf('_');
                    return titleCase(c > 0 ? str.slice(0, c) : str);
                },
                parse: (txt) => {
                    const nm = txt.trim();
                    return nm ? nm.toLowerCase() + suffix : '';
                },
                remove: () => data.class_ability.splice(i, 1),
            };
        });
        for (const pa of data.profession_ability_items || []) {
            abilityRows.push({
                obj: pa,
                key: 'name',
                remove: () => {
                    const ix = data.profession_ability_items.indexOf(pa);
                    if (ix >= 0) data.profession_ability_items.splice(ix, 1);
                },
            });
        }
        p2.appendChild(spHeading('Special Abilities'));
        p2.appendChild(editableNameList(abilityRows, (nm) => {
            (data.class_ability ??= []).push(nm); // plain name, like the Features tab's custom add
        }));

        // Money | Experience side by side (gear lives on page 1 under Weapons)
        const cols2 = h('div', 'simple-cols');
        const l2 = h('div', 'simple-col');
        const r2 = h('div', 'simple-col');
        cols2.append(l2, r2);
        p2.appendChild(cols2);

        if (data.platinum == null && data.platnium != null) data.platinum = data.platnium;
        l2.appendChild(spHeading('Money'));
        const moneyGrid = h('div', 'simple-stat-grid simple-money');
        for (const [label, key] of [['PP', 'platinum'], ['GP', 'gold'], ['SP', 'silver'], ['CP', 'copper']]) {
            if (data[key] == null || data[key] === '') data[key] = 0;
            moneyGrid.appendChild(spBoxBig(label, editNum(data, key, {
                min: 0,
                format: (raw) => (raw == null || raw === '' ? '0' : String(raw)),
                onChange: () => {
                    if (key === 'platinum') data.platnium = data.platinum; // keep legacy in sync
                },
            })));
        }
        l2.appendChild(moneyGrid);

        r2.appendChild(spHeading('Experience'));
        const xpBox = h('div', 'simple-writein-box');
        xpBox.appendChild(edit(st, 'xp'));
        r2.appendChild(xpBox);

        // Spells — fixed levels 0–9 like the paper sheet; blank but editable for non-casters.
        if (!Array.isArray(data.day_list)) data.day_list = [];
        if (!Array.isArray(data.known_list)) data.known_list = [];
        if (!Array.isArray(data.spell_list_choose_from)) data.spell_list_choose_from = [];
        const perDay = data.day_list;
        const known = data.known_list;
        const lists = data.spell_list_choose_from;
        const isCaster = perDay.some((n) => Number(n) > 0)
            || known.some((n) => Number(n) > 0)
            || lists.some((l) => nonEmpty(l))
            || Number(data.caster_level) > 0;
        let castAb = '';
        let castMod = 0;
        if (isCaster) {
            castAb = ensureCastingAbility(data);
            castMod = castingAbilityMod(data);
        }
        const sp = h('div', 'simple-spells');
        sp.appendChild(spHeading('Spells'));
        const spLine = h('p', 'simple-formula');
        spLine.appendChild(document.createTextNode('Caster level '));
        spLine.appendChild(editNum(data, 'caster_level', { min: 0, max: 40, rerender: true }));
        spLine.appendChild(document.createTextNode(isCaster
            ? ` · ${String(castAb).toUpperCase()} ${fmt(castMod)}`
                + ` · Concentration ${fmt(concentrationBonus(data))} · Save DC = 10 + spell level ${fmt(castMod)}`
            : ' · Save DC = 10 + spell level + casting ability mod'));
        sp.appendChild(spLine);
        const spellNumCell = (arr, lv) => ({
            node: editNum(arr, lv, {
                min: 0,
                format: (raw) => (raw == null || raw === '' ? '—' : String(raw)),
            }),
            cls: 'num',
        });
        // Editable list plus a print-only "(N)" so the printed 2-line clamp shows the true count
        const spellListCell = (lv) => {
            const cellWrap = h('span', 'simple-spell-wrap');
            cellWrap.appendChild(edit(lists, lv, { asArray: true }));
            const n = (lists[lv] || []).length;
            if (n > 2) cellWrap.appendChild(h('span', 'simple-spell-count print-only', `(${n} total)`));
            return cellWrap;
        };
        const spellRows = [];
        for (let lv = 0; lv <= 9; lv++) {
            spellRows.push([
                { text: String(lv), cls: 'num' },
                spellNumCell(perDay, lv),
                spellNumCell(known, lv),
                { text: isCaster ? String(10 + lv + castMod) : '', cls: 'num' },
                { node: spellListCell(lv), cls: 'simple-spell-cell' },
            ]);
        }
        sp.appendChild(spTable(
            [{ text: 'Lvl', cls: 'num' }, { text: 'Per Day', cls: 'num' },
                { text: 'Known', cls: 'num' }, { text: 'DC', cls: 'num' }, 'Spell List'],
            spellRows));
        p2.appendChild(sp);

        // Biography & Notes — a full-width band at the very bottom (below spells) so the structured
        // background (from the generator's formatted_bio) lays out horizontally and flows across
        // the two printed pages instead of claiming a page of its own. The notes-prose-notes id
        // lets renderSheet's flush keep un-debounced edits.
        const bioProse = ensureProse(data);
        const bioBand = h('div', 'simple-bio-band');
        bioBand.appendChild(spHeading('Biography & Notes'));
        const facts = renderBioFacts(data, { compact: true });
        if (facts) bioBand.appendChild(facts);

        const notesBlock = h('div', 'simple-bio-block simple-bio-notes');
        notesBlock.appendChild(h('div', 'simple-bio-label', 'Notes & background'));
        const notesTa = h('textarea', 'notes-text simple-bio-text simple-bio-main');
        notesTa.id = 'notes-prose-notes';
        notesTa.placeholder = 'Backstory, family, relationships, session notes…';
        notesTa.value = bioProse.notes || '';
        notesTa.rows = 4;
        bindProseTextarea(notesTa, data, 'notes');
        notesBlock.appendChild(notesTa);
        bioBand.appendChild(notesBlock);
        p2.appendChild(bioBand);

        wrap.appendChild(p2);
        return wrap;
    }

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
