// scripts/shell-ui.js -- the app-chrome layer (window.SheetShellUI): audience/view/explain/
// density state + setters, the top-bar/rail primary actions, and the Start-here / Instructions
// onboarding. Extracted from sheet.js (Part C); the three sub-clusters are mutually coupled so
// they live together. Loads after theme.js (uses openThemeModal); currentData reads route through
// SheetApp.current, renderSheet late-binds. SheetGuide / SheetEdgePanel / SheetOverlay are globals.
// theme.js loads before this and keeps late-binding audience/setAudience/openStartHere via SheetApp
// (the theme <-> chrome circularity); the shell re-points those delegates to the names below.
window.SheetShellUI = (function () {
    'use strict';
    const { h } = window.SheetUI;
    const { openThemeModal } = window.SheetTheme;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);

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
        renderSheet(window.SheetApp.current);
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
                renderSheet(window.SheetApp.current);
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

    return {
        audience, audienceDefault, setAudience, viewMode, setViewMode, explainMode,
        applyExplainMode, setExplainMode, densityCompact, applyDensity, setDensityCompact,
        renderPrimaryActions, syncPrimaryActions, initRail, togglePanel,
        openStartHere, openInstructions, shouldAutoOpenStartHere,
    };
})();
