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

    const LEGACY_CHAR_KEY = 'sheet.characterData'; // pre-library single slot (migrated once)
    const FORM_KEY = 'sheet.formData';
    const BACKEND_KEY = 'sheet.backendUrl';
    const TAB_KEY = 'sheet.activeTab';
    const VIEW_KEY = 'sheet.viewMode'; // 'full' (tabbed) | 'simple' (classic printable sheet)
    const CURRENT_KEY = 'sheet.currentId';
    const THEME_KEY = 'sheet.theme';
    const THEME_SKIP_PROMPT_KEY = 'sheet.themePromptSkip'; // '1' = don't auto-open modal on load
    const CUSTOM_THEME_KEY = 'sheet.customTheme'; // {paper, accent, ink} hex
    const CUSTOM_THEME_TOKENS_KEY = 'sheet.customThemeTokens'; // derived token map for pre-paint boot
    const SAVED_THEMES_KEY = 'sheet.savedThemes'; // [{id: 'saved-…', label, colors: {paper, accent, ink}}]
    const DEFAULT_BACKEND = 'https://pathfinder-char-creator-web-public-use.onrender.com';

    // Themes map to html[data-theme] tokens in styles/sheet.css (OKF color-theory roles).
    // "system" resolves to parchment (light) or dusk (dark) from prefers-color-scheme.
    const THEMES = [
        { id: 'system', label: 'System', desc: 'Follow OS light/dark (parchment or dusk)', swatches: null },
        { id: 'parchment', label: 'Parchment', desc: 'Classic PF maroon on warm paper', swatches: ['#f3ead7', '#7a1f1f', '#2b2115'] },
        { id: 'forest', label: 'Forest', desc: 'Analogous greens — nature / druid feel', swatches: ['#e8efe4', '#2d5a3d', '#1a2418'] },
        { id: 'slate', label: 'Slate', desc: 'Cool neutrals + blue-gray accent', swatches: ['#eef0f3', '#3d4f66', '#1c1f24'] },
        { id: 'arcane', label: 'Arcane', desc: 'Violet accent on cool lilac paper', swatches: ['#efeaf8', '#5b3d8c', '#1e1830'] },
        { id: 'gold', label: 'Gold', desc: 'Warm amber treasure tones', swatches: ['#f5ecd4', '#9a6b1a', '#2a2210'] },
        { id: 'stone', label: 'Stone', desc: 'Dungeon limestone neutrals', swatches: ['#ebe8e2', '#6a655c', '#1e1c18'] },
        { id: 'fey', label: 'Fey', desc: 'Soft mint / rose fantasy', swatches: ['#eef6f2', '#3d7a6a', '#1a2824'] },
        { id: 'sepia', label: 'Sepia', desc: 'Grimoire monochrome brown', swatches: ['#e8dcc8', '#5c4030', '#2a2010'] },
        { id: 'dusk', label: 'Dusk', desc: 'Warm dark mode — desaturated red', swatches: ['#17140f', '#d08080', '#ebe4d6'] },
        { id: 'ember', label: 'Ember', desc: 'Dark warm crimson — battle', swatches: ['#140c0c', '#e07060', '#f0e0d8'] },
        { id: 'ocean', label: 'Ocean', desc: 'Cool dark mode — blue accents', swatches: ['#0e1318', '#7eb3d4', '#e4eef6'] },
        { id: 'storm', label: 'Storm', desc: 'Dark indigo night sky', swatches: ['#0c0e18', '#8a8ad4', '#e4e4f6'] },
        { id: 'midnight', label: 'Midnight', desc: 'Neutral #121212 stack + soft red', swatches: ['#121212', '#cf7a7a', '#ececec'] },
        { id: 'high-contrast', label: 'High contrast', desc: 'Max AA dark: black, white, gold', swatches: ['#000000', '#ffe566', '#ffffff'] },
        { id: 'custom', label: 'Custom', desc: 'Pick your own background, accent & text colors', swatches: null },
    ];
    const THEME_IDS = new Set(THEMES.map((t) => t.id));

    // Generation backend base URL: default the hosted server, overridable via the Settings tab
    // or ?backend=http://127.0.0.1:5001 (persisted) — ?backend=default clears the override.
    function backendUrl() {
        return localStorage.getItem(BACKEND_KEY) || DEFAULT_BACKEND;
    }

    function themePreference() {
        let v = localStorage.getItem(THEME_KEY) || 'system';
        if (v === 'foundry-classic') v = 'parchment'; // retired theme
        return isThemeChoice(v) ? v : 'system';
    }

    function skipThemePrompt() {
        try { return localStorage.getItem(THEME_SKIP_PROMPT_KEY) === '1'; } catch { return false; }
    }

    function setSkipThemePrompt(skip) {
        try {
            if (skip) localStorage.setItem(THEME_SKIP_PROMPT_KEY, '1');
            else localStorage.removeItem(THEME_SKIP_PROMPT_KEY);
        } catch { /* private mode */ }
    }

    function resolveTheme(pref) {
        if (pref && pref !== 'system') return pref;
        try {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dusk' : 'parchment';
        } catch {
            return 'parchment';
        }
    }

    // ------------------------------------------------------------ custom theme (3 colors → palette)
    // A theme is really 3 base colors (paper/background, accent, ink/text); every other
    // token in styles/sheet.css is a derived shade. buildCustomTokens() does that derivation
    // with plain HSL math; the 3 picked colors are applied exactly, never adjusted.
    const CUSTOM_THEME_DEFAULT = { paper: '#f3ead7', accent: '#7a1f1f', ink: '#2b2115' };

    function normHex(v, fallback) {
        let s = String(v || '').trim().toLowerCase();
        if (/^#[0-9a-f]{3}$/.test(s)) {
            s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
        }
        return /^#[0-9a-f]{6}$/.test(s) ? s : fallback;
    }

    function hexToRgb(hex) {
        const n = parseInt(hex.slice(1), 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    function rgbToHex(r, g, b) {
        const c = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
        return '#' + c(r) + c(g) + c(b);
    }

    /** h 0–360, s/l 0–100 */
    function hexToHsl(hex) {
        let { r, g, b } = hexToRgb(hex);
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        let h = 0, s = 0;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
        }
        return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
    }

    function hslToHex(h, s, l) {
        h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = l - c / 2;
        let r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
        return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
    }

    /** Mix hex a toward hex b by t (0–1). */
    function mixHex(a, b, t) {
        const ca = hexToRgb(a), cb = hexToRgb(b);
        return rgbToHex(ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t, ca.b + (cb.b - ca.b) * t);
    }

    function withAlpha(hex, a) {
        const { r, g, b } = hexToRgb(hex);
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    function relLuminance(hex) {
        const { r, g, b } = hexToRgb(hex);
        const f = (v) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }

    function contrastRatio(a, b) {
        const la = relLuminance(a), lb = relLuminance(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }

    function customThemeColors() {
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem(CUSTOM_THEME_KEY)); } catch { /* bad JSON */ }
        return {
            paper: normHex(stored?.paper, CUSTOM_THEME_DEFAULT.paper),
            accent: normHex(stored?.accent, CUSTOM_THEME_DEFAULT.accent),
            ink: normHex(stored?.ink, CUSTOM_THEME_DEFAULT.ink),
        };
    }

    function saveCustomThemeColors(colors) {
        try { localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(colors)); } catch { /* private mode */ }
    }

    // ---------------- saved custom themes (permanent named combos, deletable)
    // The Custom builder is a scratch slot; "Save as theme" snapshots it into this list.
    // Saved themes render as normal picker cards just before the Custom card.
    function savedThemes() {
        let list = null;
        try { list = JSON.parse(localStorage.getItem(SAVED_THEMES_KEY)); } catch { /* bad JSON */ }
        if (!Array.isArray(list)) return [];
        return list
            .filter((t) => t && typeof t.id === 'string' && t.id.startsWith('saved-'))
            .map((t) => ({
                id: t.id,
                label: String(t.label || 'Custom'),
                colors: {
                    paper: normHex(t.colors?.paper, CUSTOM_THEME_DEFAULT.paper),
                    accent: normHex(t.colors?.accent, CUSTOM_THEME_DEFAULT.accent),
                    ink: normHex(t.colors?.ink, CUSTOM_THEME_DEFAULT.ink),
                },
            }));
    }

    function saveSavedThemes(list) {
        try { localStorage.setItem(SAVED_THEMES_KEY, JSON.stringify(list)); } catch { /* private mode */ }
    }

    function savedThemeById(id) {
        if (typeof id !== 'string' || !id.startsWith('saved-')) return null;
        return savedThemes().find((t) => t.id === id) || null;
    }

    function addSavedTheme(label, colors) {
        const list = savedThemes();
        const entry = {
            id: 'saved-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 46656).toString(36),
            label: label || ('Custom ' + (list.length + 1)),
            colors: { ...colors },
        };
        list.push(entry);
        saveSavedThemes(list);
        return entry;
    }

    function deleteSavedTheme(id) {
        saveSavedThemes(savedThemes().filter((t) => t.id !== id));
    }

    /** Valid theme choice = built-in id or a saved custom theme id. */
    function isThemeChoice(v) {
        return THEME_IDS.has(v) || !!savedThemeById(v);
    }

    /** Built-in themes with saved custom themes spliced in just before the Custom card. */
    function themeList() {
        const list = THEMES.slice();
        const customIdx = list.findIndex((t) => t.id === 'custom');
        const saved = savedThemes().map((t) => ({
            id: t.id,
            label: t.label,
            desc: 'Saved custom theme',
            swatches: [t.colors.paper, t.colors.accent, t.colors.ink],
            saved: true,
        }));
        list.splice(customIdx, 0, ...saved);
        return list;
    }

    /**
     * Derive the full token set from 3 base colors, used exactly as picked. Dark mode
     * flips automatically from paper luminance. Returns { tokens, dark }.
     */
    function buildCustomTokens(colors) {
        const paper = normHex(colors.paper, CUSTOM_THEME_DEFAULT.paper);
        const accent = normHex(colors.accent, CUSTOM_THEME_DEFAULT.accent);
        const ink = normHex(colors.ink, CUSTOM_THEME_DEFAULT.ink);
        const dark = relLuminance(paper) < 0.35;
        const W = '#ffffff', K = '#000000';

        const dim = mixHex(ink, paper, 0.28);

        const onAccentLight = mixHex(W, paper, 0.12);
        const onAccentDark = mixHex(K, ink, 0.12);
        const onAccent = contrastRatio(onAccentLight, accent) >= contrastRatio(onAccentDark, accent)
            ? onAccentLight : onAccentDark;

        const inputBg = dark ? mixHex(paper, W, 0.10) : mixHex(paper, W, 0.65);
        const rowBorder = mixHex(paper, ink, dark ? 0.24 : 0.16);
        const topbarFrom = dark ? mixHex(paper, W, 0.08) : mixHex(mixHex(ink, accent, 0.25), K, 0.1);
        const quickBg = dark ? mixHex(paper, ink, 0.22) : mixHex(mixHex(ink, accent, 0.35), K, 0.05);

        const tokens = {
            'color-scheme': dark ? 'dark' : 'light',
            '--ink': ink,
            '--paper': paper,
            '--panel': dark ? mixHex(paper, W, 0.06) : mixHex(paper, W, 0.45),
            '--input-bg': inputBg,
            '--input-bg-solid': dark ? inputBg : W,
            '--row-bg': inputBg,
            '--row-border': rowBorder,
            '--row-hover': dark ? mixHex(paper, W, 0.13) : mixHex(paper, ink, 0.04),
            '--chip-bg': dark ? mixHex(paper, W, 0.16) : mixHex(paper, ink, 0.09),
            '--table-rule': rowBorder,
            '--accent': accent,
            '--accent-dark': accent,
            '--accent-hover': mixHex(accent, W, 0.13),
            '--on-accent': onAccent,
            '--rule': mixHex(paper, ink, dark ? 0.32 : 0.38),
            '--dim': dim,
            '--topbar-from': topbarFrom,
            '--topbar-to': dark ? mixHex(paper, W, 0.02) : mixHex(topbarFrom, K, 0.35),
            '--topbar-fg': dark ? ink : mixHex(paper, W, 0.4),
            '--chrome-muted': mixHex(paper, ink, 0.5),
            '--select-bg': dark ? mixHex(paper, W, 0.16) : mixHex(paper, W, 0.7),
            '--select-border': mixHex(paper, ink, dark ? 0.5 : 0.55),
            '--menu-bg': dark ? mixHex(paper, W, 0.13) : mixHex(paper, W, 0.7),
            '--menu-border': mixHex(paper, ink, dark ? 0.38 : 0.3),
            '--menu-divider': mixHex(paper, ink, dark ? 0.24 : 0.16),
            '--menu-summary-bg': mixHex(paper, ink, 0.12),
            '--menu-summary-hover': mixHex(paper, ink, 0.18),
            '--reconnect-bg': dark ? '#a88a3a' : '#8a6d1f',
            '--reconnect-border': dark ? '#7a6428' : '#5e4a13',
            '--quick-bg': quickBg,
            '--quick-border': mixHex(quickBg, K, 0.3),
            '--quick-hover': mixHex(quickBg, W, 0.12),
            '--edit-hover-bg': withAlpha(accent, dark ? 0.12 : 0.08),
            '--edit-focus-ring': withAlpha(accent, dark ? 0.28 : 0.22),
            '--shadow': dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(0, 0, 0, 0.22)',
            '--focus-ring': accent,
            '--success': dark ? '#7dcea0' : '#2a6a32',
            '--danger': dark ? '#e08080' : '#a02828',
            '--warning': dark ? '#d0b060' : '#8a6a12',
            '--status-bloodied-bg': dark ? 'rgba(224, 128, 128, 0.15)' : 'rgba(160, 40, 40, 0.12)',
        };
        return { tokens, dark };
    }

    const CUSTOM_TOKEN_NAMES = Object.keys(buildCustomTokens(CUSTOM_THEME_DEFAULT).tokens);

    function applyCustomTokens(tokens) {
        const st = document.documentElement.style;
        for (const name of CUSTOM_TOKEN_NAMES) {
            if (name === 'color-scheme') st.colorScheme = tokens[name] || '';
            else if (tokens[name] != null) st.setProperty(name, tokens[name]);
        }
    }

    function clearCustomTokens() {
        const st = document.documentElement.style;
        for (const name of CUSTOM_TOKEN_NAMES) {
            if (name === 'color-scheme') st.colorScheme = '';
            else st.removeProperty(name);
        }
    }

    function customSwatches() {
        const c = customThemeColors();
        return [c.paper, c.accent, c.ink];
    }

    /**
     * Builder panel: per base color a hue slider, a lightness slider, and an exact
     * color picker (kept in sync; saturation rides along from the current color).
     * Rendered in Settings → Appearance and the theme modal; visible when Custom is active.
     */
    function buildCustomThemeControls() {
        const panel = h('div', 'custom-theme-panel hidden no-print');
        const note = h('p', 'custom-theme-note dim', '');
        const rows = [
            ['paper', 'Background'],
            ['accent', 'Accent'],
            ['ink', 'Text'],
        ];
        const controls = {}; // key → {color, hue, light}

        const commit = (key, hex) => {
            const colors = customThemeColors();
            colors[key] = hex;
            saveCustomThemeColors(colors);
            applyTheme('custom'); // re-derives tokens, persists them, refreshes all controls
        };

        for (const [key, label] of rows) {
            const row = h('div', 'custom-color-row');
            row.appendChild(h('span', 'custom-color-label', label));

            const colorIn = h('input', 'custom-color-picker');
            colorIn.type = 'color';
            colorIn.title = label + ' — exact color';

            const hueWrap = h('label', 'custom-color-slider');
            hueWrap.appendChild(h('span', null, 'Hue'));
            const hueIn = h('input');
            hueIn.type = 'range';
            hueIn.min = '0'; hueIn.max = '360'; hueIn.step = '1';
            hueWrap.appendChild(hueIn);

            const lightWrap = h('label', 'custom-color-slider');
            lightWrap.appendChild(h('span', null, 'Light'));
            const lightIn = h('input');
            lightIn.type = 'range';
            lightIn.min = '0'; lightIn.max = '100'; lightIn.step = '1';
            lightWrap.appendChild(lightIn);

            colorIn.addEventListener('input', () => commit(key, colorIn.value));
            hueIn.addEventListener('input', () => {
                const { s, l } = hexToHsl(customThemeColors()[key]);
                commit(key, hslToHex(Number(hueIn.value), Math.max(s, 8), l));
            });
            lightIn.addEventListener('input', () => {
                const { h: hh, s } = hexToHsl(customThemeColors()[key]);
                commit(key, hslToHex(hh, s, Number(lightIn.value)));
            });

            row.append(colorIn, hueWrap, lightWrap);
            panel.appendChild(row);
            controls[key] = { color: colorIn, hue: hueIn, light: lightIn };
        }

        // Snapshot the current combo as a permanent named theme (card appears before Custom).
        const saveRow = h('div', 'custom-theme-save');
        const nameIn = h('input', 'custom-theme-name');
        nameIn.type = 'text';
        nameIn.placeholder = 'Theme name';
        nameIn.maxLength = 40;
        const saveBtn = h('button', null, 'Save as theme');
        saveBtn.type = 'button';
        const commitSave = () => {
            const entry = addSavedTheme(nameIn.value.trim(), customThemeColors());
            nameIn.value = '';
            applyTheme(entry.id);
            refreshThemeGrids();
        };
        saveBtn.addEventListener('click', commitSave);
        nameIn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitSave(); }
        });
        saveRow.append(nameIn, saveBtn);
        panel.appendChild(saveRow);
        panel.appendChild(note);

        panel._refreshCustom = () => {
            const colors = customThemeColors();
            for (const [key] of rows) {
                const { color, hue, light } = controls[key];
                const hsl = hexToHsl(colors[key]);
                if (document.activeElement !== color) color.value = colors[key];
                if (document.activeElement !== hue) hue.value = String(hsl.h);
                if (document.activeElement !== light) light.value = String(hsl.l);
            }
            const built = buildCustomTokens(colors);
            note.textContent = built.dark
                ? 'Dark theme (from background lightness).'
                : 'Light theme (from background lightness).';
        };
        panel._refreshCustom();
        return panel;
    }

    function syncThemeControls(pref) {
        const choice = isThemeChoice(pref) ? pref : 'system';
        document.querySelectorAll('input[name="sheet-theme"]').forEach((r) => {
            r.checked = r.value === choice;
        });
        document.querySelectorAll('.theme-modal-pick').forEach((btn) => {
            const on = btn.dataset.themeId === choice;
            btn.classList.toggle('is-selected', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        // Custom theme: show/refresh builder panels + live swatches on the Custom cards
        document.querySelectorAll('.custom-theme-panel').forEach((p) => {
            p.classList.toggle('hidden', choice !== 'custom');
            if (choice === 'custom') p._refreshCustom?.();
        });
        const sw = customSwatches();
        document.querySelectorAll('.custom-theme-swatches-live').forEach((box) => {
            box.querySelectorAll('span').forEach((chip, i) => {
                if (sw[i]) chip.style.background = sw[i];
            });
        });
    }

    function applyTheme(pref) {
        const choice = isThemeChoice(pref) ? pref : 'system';
        const saved = savedThemeById(choice);
        const resolved = saved ? 'custom' : resolveTheme(choice);
        if (resolved === 'custom') {
            const built = buildCustomTokens(saved ? saved.colors : customThemeColors());
            applyCustomTokens(built.tokens);
            // Persist derived tokens so index.html can re-apply them before first paint.
            try { localStorage.setItem(CUSTOM_THEME_TOKENS_KEY, JSON.stringify(built.tokens)); } catch { /* private mode */ }
        } else {
            clearCustomTokens();
        }
        document.documentElement.setAttribute('data-theme', resolved);
        document.documentElement.dataset.themePref = choice;
        try { localStorage.setItem(THEME_KEY, choice); } catch { /* private mode */ }
        syncThemeControls(choice);
        return resolved;
    }

    /** × control on saved-theme cards. A span (not a button) so it can live inside the card. */
    function buildThemeDeleteBtn(theme) {
        const del = h('span', 'theme-delete-btn', '×');
        del.setAttribute('role', 'button');
        del.tabIndex = 0;
        del.title = 'Delete "' + theme.label + '"';
        del.setAttribute('aria-label', 'Delete theme ' + theme.label);
        const onDelete = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const wasActive = themePreference() === theme.id;
            const entry = savedThemeById(theme.id);
            deleteSavedTheme(theme.id);
            if (wasActive && entry) {
                // Keep the same look: load the deleted combo into the editable Custom slot.
                saveCustomThemeColors(entry.colors);
                applyTheme('custom');
            }
            refreshThemeGrids();
        };
        del.addEventListener('click', onDelete);
        del.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') onDelete(e);
        });
        return del;
    }

    /**
     * Fill a theme chooser with one card per themeList() entry.
     * kind 'modal' → buttons (theme modal); 'settings' → radio labels (Settings tab).
     */
    function renderThemeCards(container, kind) {
        container.textContent = '';
        const pref = themePreference();
        const modal = kind === 'modal';
        for (const theme of themeList()) {
            const card = modal
                ? h('button', 'theme-modal-pick' + (theme.id === pref ? ' is-selected' : ''))
                : h('label', 'settings-theme-option');
            if (modal) {
                card.type = 'button';
                card.dataset.themeId = theme.id;
                card.setAttribute('role', 'option');
                card.setAttribute('aria-selected', theme.id === pref ? 'true' : 'false');
                card.addEventListener('click', () => applyTheme(theme.id));
            } else {
                const radio = h('input');
                radio.type = 'radio';
                radio.name = 'sheet-theme';
                radio.value = theme.id;
                radio.checked = theme.id === pref;
                radio.addEventListener('change', () => {
                    if (radio.checked) applyTheme(theme.id);
                });
                card.appendChild(radio);
            }
            const swatches = theme.id === 'custom' ? customSwatches()
                : (theme.swatches || ['#eef0f3', '#3d4f66', '#121212']);
            const sw = h('div', (modal ? 'theme-modal-swatches' : 'settings-theme-swatches')
                + (theme.id === 'custom' ? ' custom-theme-swatches-live' : ''));
            sw.setAttribute('aria-hidden', 'true');
            for (const hex of swatches) {
                const chip = h('span');
                chip.style.background = hex;
                sw.appendChild(chip);
            }
            card.appendChild(sw);
            card.appendChild(h('span', modal ? 'theme-modal-pick-label' : 'settings-theme-label', theme.label));
            card.appendChild(h('span', modal ? 'theme-modal-pick-desc' : 'settings-theme-desc', theme.desc));
            if (theme.saved) card.appendChild(buildThemeDeleteBtn(theme));
            container.appendChild(card);
        }
    }

    /** Re-render every theme chooser (modal grid + Settings tab) after a save/delete. */
    function refreshThemeGrids() {
        const grid = document.getElementById('theme-modal-grid');
        if (grid && grid.dataset.built === '1') renderThemeCards(grid, 'modal');
        document.querySelectorAll('.settings-theme-grid').forEach((g) => renderThemeCards(g, 'settings'));
        syncThemeControls(themePreference());
    }

    function buildThemeModalGrid() {
        const grid = document.getElementById('theme-modal-grid');
        if (!grid) return;
        if (grid.dataset.built !== '1') {
            grid.dataset.built = '1';
            // Builder for the Custom theme (hidden unless Custom is the active choice)
            grid.insertAdjacentElement('afterend', buildCustomThemeControls());
        }
        renderThemeCards(grid, 'modal');
        syncThemeControls(themePreference());
    }

    function closeThemeModal() {
        const modal = document.getElementById('theme-modal');
        if (!modal) return;
        const skip = document.getElementById('theme-modal-skip');
        if (skip) setSkipThemePrompt(!!skip.checked);
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('theme-modal-open');
        document.getElementById('theme-btn')?.focus();
    }

    function openThemeModal(opts) {
        const modal = document.getElementById('theme-modal');
        if (!modal) return;
        buildThemeModalGrid();
        syncThemeControls(themePreference());
        const skip = document.getElementById('theme-modal-skip');
        if (skip) skip.checked = skipThemePrompt();
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('theme-modal-open');
        // Focus first selected pick or Continue.
        const selected = modal.querySelector('.theme-modal-pick.is-selected');
        (selected || document.getElementById('theme-modal-done'))?.focus();
        if (opts?.force) { /* opened from topbar — no extra flags */ }
    }

    function shouldAutoOpenThemeModal() {
        // First-time and every load until the user checks "Don't show this on load".
        return !skipThemePrompt();
    }

    function initTheme() {
        applyTheme(themePreference());
        const themeBtn = document.getElementById('theme-btn');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => openThemeModal({ force: true }));
        }
        document.getElementById('theme-modal-done')?.addEventListener('click', closeThemeModal);
        document.querySelectorAll('[data-theme-modal-dismiss]').forEach((el) => {
            el.addEventListener('click', closeThemeModal);
        });
        document.addEventListener('keydown', (e) => {
            const modal = document.getElementById('theme-modal');
            if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
                e.preventDefault();
                closeThemeModal();
            }
        });
        try {
            const mq = window.matchMedia('(prefers-color-scheme: dark)');
            const onChange = () => {
                if (themePreference() === 'system') applyTheme('system');
            };
            if (mq.addEventListener) mq.addEventListener('change', onChange);
            else if (mq.addListener) mq.addListener(onChange);
        } catch { /* ignore */ }

        if (shouldAutoOpenThemeModal()) {
            // After first paint so the sheet is under the overlay.
            requestAnimationFrame(() => openThemeModal());
        }
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
    const DEITIES = ['random', 'Abadar', 'Achaekek', 'Ahriman', 'Alazhra', 'Alseta', 'Apsu',
        'Arazni', 'Asmodeus', 'Besmara', 'Calistria', 'Cayden Cailean', 'Desna', 'Easivra',
        'Erastil', 'Erecura', 'Gorum', 'Gozreh', 'Groetus', 'Hanspur', 'Iomedae', 'Irori',
        'Kurgess', 'Lamashtu', 'Lissala', 'Nethys', 'Norgorber', 'Pharasma', 'Rovagug',
        'Sarenrae', 'Shelyn', 'Torag', 'Urgathoa', 'Zon-Kuthon', 'Zyphus'];

    // Good-save progressions per class, extracted from the pf1e_random_char_generator module's
    // every_class.json (pf1 + pf1-pow compendium export). Stalker/Zealot are absent from that
    // compendium; their entries follow the d20pfsrd Path of War class tables.
    const GOOD_SAVES = {
        'alchemist': ['fort', 'ref'], 'antipaladin': ['fort', 'will'], 'arcanist': ['will'],
        'barbarian': ['fort'], 'barbarian (unchained)': ['fort'], 'bard': ['ref', 'will'],
        'bloodrager': ['fort'], 'brawler': ['fort', 'ref'], 'cavalier': ['fort'],
        'cleric': ['fort', 'will'], 'druid': ['fort', 'will'], 'fighter': ['fort'],
        'gunslinger': ['fort', 'ref'], 'harbinger': ['fort', 'will'], 'hunter': ['fort', 'ref'],
        'inquisitor': ['fort', 'will'], 'investigator': ['ref', 'will'],
        'kineticist': ['fort', 'ref'], 'magus': ['fort', 'will'], 'medic': ['fort', 'will'],
        'medium': ['will'], 'mesmerist': ['ref', 'will'], 'monk': ['fort', 'ref', 'will'],
        'monk (unchained)': ['fort', 'ref'], 'mystic': ['will'], 'ninja': ['ref'],
        'occultist': ['fort', 'will'], 'oracle': ['will'], 'paladin': ['fort', 'will'],
        'psychic': ['will'], 'ranger': ['fort', 'ref'], 'rogue': ['ref'],
        'rogue (unchained)': ['ref'], 'samurai': ['fort'], 'shaman': ['will'],
        'shifter': ['fort', 'ref'], 'skald': ['fort', 'will'], 'slayer': ['fort', 'ref'],
        'sorcerer': ['will'], 'spiritualist': ['fort', 'will'], 'stalker': ['will'],
        'summoner': ['will'], 'summoner (unchained)': ['will'], 'swashbuckler': ['ref'],
        'vigilante': ['ref', 'will'], 'warder': ['fort', 'will'], 'warlord': ['fort'],
        'warpriest': ['fort', 'will'], 'witch': ['will'], 'wizard': ['will'],
        'zealot': ['fort', 'will'],
    };

    // ---------------------------------------------------------------- tiny DOM helpers
    function h(tag, cls, content) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (content !== undefined && content !== null) {
            if (content instanceof Node) el.appendChild(content);
            else el.textContent = String(content);
        }
        return el;
    }

    // Descriptions come from our own backend / game data, so rendering them as HTML is fine.
    function htmlBlock(cls, html) {
        const el = h('div', cls);
        el.innerHTML = html;
        return el;
    }

    function details(summaryText, bodyHtml, cls) {
        const d = h('details', cls);
        d.appendChild(h('summary', null, summaryText));
        if (bodyHtml) d.appendChild(htmlBlock('desc', bodyHtml));
        return d;
    }

    function section(title, cls) {
        const sec = h('section', 'sheet-section' + (cls ? ' ' + cls : ''));
        sec.appendChild(h('h2', null, title));
        const body = h('div', 'section-body');
        sec.appendChild(body);
        return { sec, body };
    }

    function kv(body, label, value) {
        const row = h('div', 'kv');
        row.appendChild(h('span', 'k', label));
        const v = h('span', 'v');
        if (value instanceof Node) v.appendChild(value);
        else v.textContent = value == null ? '' : String(value);
        row.appendChild(v);
        body.appendChild(row);
        return row;
    }

    const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
    const mod = (score) => Math.floor((Number(score) - 10) / 2);

    /**
     * Effective ability score & modifier, pf1-style: base + typed manual bonuses
     * (racial + enhancement + inherent + misc) + ledger changes (belts, buffs) − Drain;
     * ability Damage penalizes the MOD (−1 per 2 points).
     * User boxes persist on _sheet.abilityAdjust[ab] =
     * { racial, enhancement, inherent, misc, damage, drain }.
     */
    function abilityInfo(data, ab) {
        const base = Number(data?.[ab]);
        const adj = data?._sheet?.abilityAdjust?.[ab] || {};
        const racial = Number(adj.racial) || 0;
        const enhancement = Number(adj.enhancement) || 0;
        const inherent = Number(adj.inherent) || 0;
        const misc = Number(adj.misc) || 0;
        const damage = Number(adj.damage) || 0;
        const drain = Number(adj.drain) || 0;
        const bits = [];
        let ledgerSum = 0;
        const SD = window.SheetDetails;
        if (SD && data) {
            for (const c of (effectiveLedger(data).changes || [])) {
                if (c.target !== ab) continue;
                const ev = SD.evalSimpleFormula(c.formula, data);
                if (ev?.ok && ev.value) {
                    ledgerSum += ev.value;
                    bits.push(`${c.source} ${fmt(ev.value)}`);
                }
            }
        }
        const parts = { base, racial, enhancement, inherent, misc, damage, drain };
        if (!Number.isFinite(base)) {
            return { ...parts, base: null, total: null, mod: 0, formula: 'no score' };
        }
        const manual = racial + enhancement + inherent + misc;
        const total = base + ledgerSum + manual - drain;
        const damagePen = Math.floor(damage / 2);
        const formula = [
            'base ' + base,
            racial ? 'racial ' + fmt(racial) : null,
            ...bits,
            enhancement ? 'enhancement ' + fmt(enhancement) : null,
            inherent ? 'inherent ' + fmt(inherent) : null,
            misc ? 'misc ' + fmt(misc) : null,
            drain ? 'drain ' + drain : null,
        ].filter(Boolean).join(' + ').replace(/\+ drain/g, '− drain')
            + ' = ' + total
            + (damagePen ? ` · mod −${damagePen} (${damage} ability damage)` : '');
        return { ...parts, base, total, mod: mod(total) - damagePen, formula };
    }

    /** Effective ability modifier (ledger + damage/drain/misc aware). */
    function abModOf(data, ab) {
        return abilityInfo(data, ab).mod;
    }
    const fmt = (n) => (n >= 0 ? '+' + n : String(n));
    const toInt = (v) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : null;
    };
    // true only for non-empty arrays/objects (strings like 'N/A' don't count)
    const nonEmpty = (v) => Array.isArray(v) ? v.length > 0
        : Boolean(v && typeof v === 'object' && Object.keys(v).length > 0);
    const escapeHtml = (s) => String(s).replace(/[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    // Foundry inline-roll markup ("[[1d4]]") → accent chips (see .inline-roll).
    /** Escape HTML and wrap [[formula]] as .inline-roll chips (delegates to SheetRoll when ready). */
    function highlightInlineRolls(text) {
        if (window.SheetRoll?.highlightInlineRolls) {
            return window.SheetRoll.highlightInlineRolls(text);
        }
        // Fallback before tools init: same chip markup (+ expanded [[total¦formula]])
        const s = String(text || '');
        let out = '';
        let last = 0;
        const re = /\[\[([^\]]+)\]\]/g;
        let m;
        while ((m = re.exec(s)) !== null) {
            out += escapeHtml(s.slice(last, m.index));
            const inner = String(m[1] || '').trim();
            const sep = inner.indexOf('\u00a6');
            const display = sep >= 0 ? inner.slice(0, sep).trim() : inner;
            const formula = sep >= 0 ? inner.slice(sep + 1).trim() : inner;
            const title = formula && formula !== display
                ? `Rolled ${display} from ${formula}`
                : `Inline roll: ${display}`;
            out += `<span class="inline-roll" title="${escapeHtml(title)}">`
                + escapeHtml(display) + '</span>';
            last = re.lastIndex;
        }
        out += escapeHtml(s.slice(last));
        return out;
    }
    const foundry = (kind, name) => window.SheetDetails?.lookup(kind, name) ?? null;

    // Debounced quiet save for inline edits (notes / fields / ready toggles).
    let quietSaveTimer = null;
    function quietSave() {
        clearTimeout(quietSaveTimer);
        quietSaveTimer = setTimeout(() => {
            if (currentData && !currentData.error) saveCurrent({ quiet: true });
        }, 800);
    }
    /** Per-source always-on buff keys stored as disabled set on data._sheet.disabledBuffSources */
    function disabledBuffSet(data) {
        const d = data || currentData;
        const arr = d?._sheet?.disabledBuffSources;
        return new Set(Array.isArray(arr) ? arr : []);
    }

    function buffSourceKey(source, sourceKind) {
        return String(sourceKind || 'buff') + '::' + String(source || '?');
    }

    /** Deleted passive sources: hidden from the panel AND stripped from math. */
    function removedBuffSet(data) {
        const d = data || currentData;
        const arr = d?._sheet?.removedBuffSources;
        return new Set(Array.isArray(arr) ? arr : []);
    }

    function isBuffSourceActive(data, source, sourceKind) {
        const key = buffSourceKey(source, sourceKind);
        return !disabledBuffSet(data).has(key) && !removedBuffSet(data).has(key);
    }

    function isBuffSourceRemoved(data, source, sourceKind) {
        return removedBuffSet(data).has(buffSourceKey(source, sourceKind));
    }

    function setBuffSourceActive(data, source, sourceKind, on) {
        if (!data) return;
        const key = buffSourceKey(source, sourceKind);
        const set = disabledBuffSet(data);
        if (on) set.delete(key);
        else set.add(key);
        (data._sheet ??= {}).disabledBuffSources = [...set];
        quietSave();
        renderSheet(data);
    }

    function removeBuffSource(data, source, sourceKind) {
        if (!data) return;
        const set = removedBuffSet(data);
        set.add(buffSourceKey(source, sourceKind));
        (data._sheet ??= {}).removedBuffSources = [...set];
        quietSave();
        renderSheet(data);
    }

    function restoreRemovedBuffSources(data) {
        if (!data) return;
        (data._sheet ??= {}).removedBuffSources = [];
        quietSave();
        renderSheet(data);
    }

    /**
     * Situational contextNotes for a set of change targets, deduped and plain-text —
     * shown as hover tooltips on the relevant skill / attack rows (not a panel).
     */
    function notesForTargets(data, targets) {
        const ledger = window.sheetChangesFull
            || window.SheetDetails?.collectChanges?.(data)
            || { notes: [] };
        const want = targets instanceof Set ? targets : new Set(targets || []);
        const seen = new Set();
        const out = [];
        for (const n of ledger.notes || []) {
            if (!want.has(n.target)) continue;
            if (!isBuffSourceActive(data, n.source, n.sourceKind)) continue;
            const text = String(n.text || '').replace(/<[^>]*>/g, '').trim();
            if (!text) continue;
            const key = n.source + '|' + n.target + '|' + text;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(text + ' — ' + n.source);
        }
        return out;
    }

    /** Add an ⓘ hover marker (and row tooltip) when targets have situational notes. */
    function attachNotesHover(el, data, targets, markHost) {
        const notes = notesForTargets(data, targets);
        if (!notes.length || !el) return;
        el.title = notes.join('\n');
        const mark = h('span', 'note-hover-mark no-print', 'ⓘ');
        mark.title = notes.join('\n');
        mark.setAttribute('aria-label', 'Situational notes: ' + notes.join('; '));
        (markHost || el).appendChild(mark);
    }

    /** Full ledger with inactive sources' changes stripped (notes/conditionals kept for UI). */
    function effectiveLedger(data) {
        const SD = window.SheetDetails;
        const full = SD ? SD.collectChanges(data) : (window.sheetChangesFull || window.sheetChanges
            || { changes: [], notes: [], conditionals: [] });
        const disabled = disabledBuffSet(data);
        const removed = removedBuffSet(data);
        if (!disabled.size && !removed.size) return full;
        return {
            changes: (full.changes || []).filter((c) => {
                const key = buffSourceKey(c.source, c.sourceKind);
                return !disabled.has(key) && !removed.has(key);
            }),
            notes: full.notes || [],
            conditionals: full.conditionals || [],
        };
    }

    function refreshDerived() {
        if (currentData && !currentData.error) {
            window.sheetChanges = effectiveLedger(currentData);
            window.SheetRoll?.setCharacter(currentData);
        }
    }

    /** Group always-on changes by source for per-buff toggles. */
    function groupChangesBySource(changes) {
        const map = new Map();
        for (const c of changes || []) {
            const key = buffSourceKey(c.source, c.sourceKind);
            if (!map.has(key)) {
                map.set(key, {
                    key,
                    source: c.source,
                    sourceKind: c.sourceKind || 'buff',
                    lines: [],
                });
            }
            map.get(key).lines.push(c);
        }
        return [...map.values()].sort((a, b) =>
            String(a.source).localeCompare(String(b.source)));
    }

    /**
     * Editable value control bound to data[key].
     * @param {object} data
     * @param {string} key
     * @param {{ type?: string, parse?: function, format?: function, asArray?: boolean, onChange?: function }} opts
     */
    function editableField(data, key, opts = {}) {
        const type = opts.type || 'text';
        const input = h('input', 'edit-field');
        input.type = type === 'number' ? 'number' : 'text';
        if (type === 'number') {
            if (opts.min != null) input.min = opts.min;
            if (opts.max != null) input.max = opts.max;
            if (opts.step != null) input.step = opts.step;
        }
        const raw = data[key];
        if (opts.asArray) {
            input.value = Array.isArray(raw) ? raw.join(', ') : (raw == null ? '' : String(raw));
        } else if (opts.format) {
            input.value = opts.format(raw);
        } else {
            input.value = raw == null ? '' : String(raw);
        }
        input.addEventListener('change', () => {
            let v = input.value;
            if (opts.asArray) {
                data[key] = v.split(',').map((s) => s.trim()).filter(Boolean);
            } else if (opts.parse) {
                data[key] = opts.parse(v);
            } else if (type === 'number') {
                const n = v === '' ? null : Number(v);
                data[key] = Number.isFinite(n) ? n : v;
            } else {
                data[key] = v;
            }
            opts.onChange?.(data[key], data);
            quietSave();
            refreshDerived();
        });
        // Live ability-mod updates without waiting for change blur
        if (opts.live) {
            input.addEventListener('input', () => {
                if (type === 'number') {
                    const n = input.value === '' ? null : Number(input.value);
                    if (Number.isFinite(n)) data[key] = n;
                }
                opts.live(data[key], data, input);
            });
        }
        return input;
    }

    function kvEdit(body, label, data, key, opts) {
        return kv(body, label, editableField(data, key, opts));
    }

    /**
     * Display value that becomes an input on double-click (Foundry-ish sheet feel).
     * Visual: plain text + hover hint; editing: outlined field. Commits on blur/Enter.
     */
    function dblclickEditable(data, key, opts = {}) {
        const wrap = h('span', 'dbl-edit');
        wrap.title = 'Double-click to edit';
        const display = h('span', 'dbl-edit-display');
        const input = editableField(data, key, {
            ...opts,
            onChange: (v, d) => {
                opts.onChange?.(v, d);
                exitEdit();
            },
        });
        input.classList.add('dbl-edit-input', 'edit-field');
        input.classList.add('hidden');

        function formatDisplay() {
            const raw = data[key];
            if (opts.format) {
                display.textContent = opts.format(raw) || '—';
            } else if (opts.asArray) {
                display.textContent = Array.isArray(raw) && raw.length
                    ? raw.join(', ')
                    : (raw == null || raw === '' ? '—' : String(raw));
            } else if (raw == null || raw === '') {
                display.textContent = '—';
            } else {
                display.textContent = String(raw);
            }
            if (opts.suffix && display.textContent !== '—') {
                display.textContent += opts.suffix;
            }
        }

        function enterEdit(e) {
            e?.preventDefault?.();
            if (wrap.classList.contains('is-editing')) return;
            wrap.classList.add('is-editing');
            display.classList.add('hidden');
            input.classList.remove('hidden');
            // Sync input from current data (may have changed)
            if (opts.asArray) {
                input.value = Array.isArray(data[key]) ? data[key].join(', ') : '';
            } else if (opts.format) {
                input.value = opts.format(data[key]) ?? '';
            } else {
                input.value = data[key] == null ? '' : String(data[key]);
            }
            input.focus();
            input.select?.();
        }

        function exitEdit() {
            wrap.classList.remove('is-editing');
            input.classList.add('hidden');
            display.classList.remove('hidden');
            formatDisplay();
        }

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                // revert input without writing
                formatDisplay();
                if (opts.asArray) {
                    input.value = Array.isArray(data[key]) ? data[key].join(', ') : '';
                } else {
                    input.value = data[key] == null ? '' : String(data[key]);
                }
                exitEdit();
            }
            if (e.key === 'Enter' && input.type !== 'textarea') {
                e.preventDefault();
                input.blur(); // triggers change via editableField if value changed
                // If unchanged, still leave edit mode
                setTimeout(() => { if (wrap.classList.contains('is-editing')) exitEdit(); }, 0);
            }
        });
        input.addEventListener('blur', () => {
            // change event fires before blur when value changed; always leave edit UI
            setTimeout(() => { if (wrap.classList.contains('is-editing')) exitEdit(); }, 0);
        });

        wrap.addEventListener('dblclick', enterEdit);
        display.addEventListener('dblclick', enterEdit);

        formatDisplay();
        wrap.append(display, input);
        return wrap;
    }

    function kvDbl(body, label, data, key, opts) {
        return kv(body, label, dblclickEditable(data, key, opts));
    }

    // ---------------------------------------------------------------- derived stats + sources
    function part(label, value, opts = {}) {
        return {
            label,
            value: value == null ? 0 : value,
            kind: opts.kind || 'base',
            type: opts.type || '',
            sourceKind: opts.sourceKind || '', // feat/trait/item/buff… for defense buckets
            unresolved: !!opts.unresolved,
            formula: opts.formula || '',
            info: !!opts.info, // listed but not added to total (e.g. HP ledger)
        };
    }

    function sumParts(parts) {
        let total = 0;
        for (const p of parts) {
            if (p.unresolved || p.info) continue;
            total += Number(p.value) || 0;
        }
        return total;
    }

    function appendLedgerParts(parts, data, ledger, targets, opts = {}) {
        const SD = window.SheetDetails;
        if (!SD || !ledger) return;
        const list = SD.changesForTargets(ledger, targets);
        const skipDodge = !!opts.skipDodge;
        const skipArmorShield = !!opts.skipArmorShield; // for touch: drop aac/sac targets
        for (const c of list) {
            if (skipDodge && (c.type === 'dodge')) continue;
            if (skipArmorShield && (c.target === 'aac' || c.target === 'sac')) continue;
            // On touch AC, only keep dodge/deflect/insight/luck/etc. and tac — still include
            // generic `ac` non-armor types; skip enhancement armor-ish is hard without more data.
            if (opts.touchOnly) {
                if (c.target === 'aac' || c.target === 'sac') continue;
                if (c.type === 'armor' || c.type === 'shield') continue;
            }
            const typeStr = SD.typeLabel(c.type);
            const label = (typeStr ? typeStr + ' ' : '') + `(${c.source})`;
            const ev = SD.evalSimpleFormula(c.formula, data);
            if (ev.ok) {
                parts.push(part(label, ev.value, {
                    kind: 'ledger', type: c.type || '', sourceKind: c.sourceKind || '',
                    info: !!opts.infoOnly,
                }));
            } else {
                parts.push(part(label, 0, {
                    kind: 'ledger', type: c.type || '', sourceKind: c.sourceKind || '',
                    unresolved: true,
                    formula: ev.formula || c.formula, info: !!opts.infoOnly,
                }));
            }
        }
    }

    /**
     * Full derived combat numbers with source parts (base + gear + ability + change ledger).
     */
    function computeDerived(data) {
        const SD = window.SheetDetails;
        // Full ledger for Buffs tab; effective (maybe empty changes) for math
        const fullLedger = SD ? SD.collectChanges(data) : (window.sheetChangesFull || { changes: [] });
        window.sheetChangesFull = fullLedger;
        const ledger = effectiveLedger(data);
        window.sheetChanges = ledger;

        // Simple-sheet total edits land here as flat deltas (visible in every sources list).
        const manual = sheetState(data).manualAdjust || {};
        const manualPart = (parts, key) => {
            const v = Number(manual[key]) || 0;
            if (v) parts.push(part('Manual adjustment', v, { kind: 'manual' }));
        };

        // PF1 negative levels: −1 per level on attack rolls, saves, skill and ability
        // checks; −5 HP each. (CL / spell-slot loss is flagged on Attributes, not automated.)
        const negLv = Number(sheetState(data).negativeLevels) || 0;
        const negPart = (parts) => {
            if (negLv) {
                parts.push(part('Negative levels', -negLv, { kind: 'ledger', type: 'penalty' }));
            }
        };

        const level = Number(data.level) || 0;
        const bab = Number(data.bab_total) || 0;
        const strM = abModOf(data, 'str'), dexM = abModOf(data, 'dex'), conM = abModOf(data, 'con');
        const wisM = abModOf(data, 'wis'), intM = abModOf(data, 'int'), chaM = abModOf(data, 'cha');
        const armorAc = toInt(data.armor_ac) ?? 0;
        const shieldAc = toInt(data.shield_ac) ?? 0;
        const maxDex = toInt(data.armor_max_dex_bonus);
        const dexCapped = maxDex !== null && dexM > maxDex;
        const effDex = dexCapped ? maxDex : dexM;
        const armorName = (data.armor_name || '').trim() || 'Armor';
        const shieldName = (data.shield_name || '').trim() || 'Shield';
        const className = String(data.c_class || '').toLowerCase();
        const goods = GOOD_SAVES[className];
        const multiclassSaves = Boolean(data.c_class_2);
        const classBase = (save) => {
            if (!goods || !level) return null;
            return goods.includes(save) ? 2 + Math.floor(level / 2) : Math.floor(level / 3);
        };

        // ---- AC ----
        const acParts = [part('Base', 10)];
        if (armorAc || data.armor_name) {
            acParts.push(part(`Armor (${armorName})`, armorAc, { kind: 'gear' }));
        }
        if (shieldAc || data.shield_name) {
            acParts.push(part(`Shield (${shieldName})`, shieldAc, { kind: 'gear' }));
        }
        acParts.push(part(
            dexCapped ? `Dex (capped by armor max ${maxDex})` : 'Dex',
            effDex, { kind: 'ability' }));
        appendLedgerParts(acParts, data, ledger, ['ac', 'aac', 'sac', 'nac']);
        manualPart(acParts, 'ac');

        const touchParts = [part('Base', 10)];
        touchParts.push(part(
            dexCapped ? `Dex (capped by armor max ${maxDex})` : 'Dex',
            effDex, { kind: 'ability' }));
        appendLedgerParts(touchParts, data, ledger, ['ac', 'tac', 'nac'], { touchOnly: true });
        manualPart(touchParts, 'touch');

        const flatParts = [part('Base', 10)];
        if (armorAc || data.armor_name) {
            flatParts.push(part(`Armor (${armorName})`, armorAc, { kind: 'gear' }));
        }
        if (shieldAc || data.shield_name) {
            flatParts.push(part(`Shield (${shieldName})`, shieldAc, { kind: 'gear' }));
        }
        appendLedgerParts(flatParts, data, ledger, ['ac', 'ffac', 'aac', 'sac', 'nac'], {
            skipDodge: true,
        });
        manualPart(flatParts, 'flat');

        // ---- Saves ----
        function saveBlock(save, abLabel, abMod) {
            const parts = [];
            const base = classBase(save);
            if (base == null) {
                parts.push(part('Class base (unknown class progression)', 0, {
                    kind: 'base', unresolved: true, formula: '?',
                }));
            } else {
                const good = !!(goods && goods.includes(save));
                parts.push(part(
                    `Class base (${good ? 'good' : 'poor'}${className ? ', ' + titleCase(className) : ''})`,
                    base, { kind: 'base' }));
            }
            parts.push(part(abLabel, abMod, { kind: 'ability' }));
            appendLedgerParts(parts, data, ledger, [save, 'allSavingThrows']);
            manualPart(parts, save);
            negPart(parts);
            return { total: sumParts(parts), parts };
        }
        const fort = saveBlock('fort', 'Constitution', conM);
        const ref = saveBlock('ref', 'Dexterity', dexM);
        const will = saveBlock('will', 'Wisdom', wisM);

        // ---- Init / attacks / CMB / CMD ----
        const initParts = [part('Dexterity', dexM, { kind: 'ability' })];
        appendLedgerParts(initParts, data, ledger, ['init']);
        manualPart(initParts, 'init');
        negPart(initParts);

        const meleeParts = [
            part('BAB', bab, { kind: 'base' }),
            part('Strength', strM, { kind: 'ability' }),
        ];
        appendLedgerParts(meleeParts, data, ledger, ['attack', 'mattack']);
        manualPart(meleeParts, 'melee');
        negPart(meleeParts);

        const rangedParts = [
            part('BAB', bab, { kind: 'base' }),
            part('Dexterity', dexM, { kind: 'ability' }),
        ];
        appendLedgerParts(rangedParts, data, ledger, ['attack', 'rattack']);
        manualPart(rangedParts, 'ranged');
        negPart(rangedParts);

        // ---- Weapon damage (dice + ability + enh + ledger) — same breakdown style as attacks ----
        const wName = (data.weapon_name || '').trim();
        const wStats = wName && SD ? SD.lookupWeapon(wName) : null;
        let weaponEnh = 0;
        if (Array.isArray(data.weapon_enhancement_chosen_list)) {
            for (const raw of data.weapon_enhancement_chosen_list) {
                const m = String(raw).match(/^\s*\+(\d+)\b/);
                if (m) weaponEnh = Math.max(weaponEnh, parseInt(m[1], 10));
            }
        }
        const dmgAbKey = (wStats?.damageAbility || 'str').toLowerCase();
        const dmgAbMod = ({ str: strM, dex: dexM, con: conM, int: intM, wis: wisM, cha: chaM })[dmgAbKey] ?? 0;
        const damageParts = [];
        if (wStats?.dice) {
            // Dice is not a flat number — list as info so sources show it without double-counting
            damageParts.push(part('Weapon dice', 0, {
                kind: 'base', info: true, formula: wStats.dice,
            }));
        } else if (wName) {
            damageParts.push(part('Weapon dice', 0, {
                kind: 'base', unresolved: true, formula: 'no weapon stats',
            }));
        }
        if (wStats || wName) {
            damageParts.push(part(dmgAbKey.toUpperCase(), dmgAbMod, { kind: 'ability' }));
        }
        if (weaponEnh) {
            damageParts.push(part('Enhancement', weaponEnh, { kind: 'gear' }));
        }
        const dmgTargets = wStats && (wStats.actionType === 'rwak' || wStats.actionType === 'rsak' || wStats.actionType === 'twak')
            ? ['damage', 'rdamage', 'wdamage']
            : ['damage', 'mdamage', 'wdamage'];
        appendLedgerParts(damageParts, data, ledger, dmgTargets);
        const damageFlat = sumParts(damageParts);
        const damageDice = wStats?.dice || '';
        let damageTotal;
        if (damageDice && damageFlat) {
            damageTotal = damageDice + (damageFlat >= 0 ? '+' : '') + damageFlat;
        } else if (damageDice) {
            damageTotal = damageDice;
        } else if (damageParts.length) {
            damageTotal = (damageFlat >= 0 ? '+' : '') + damageFlat;
        } else {
            damageTotal = '';
        }
        const damage = damageParts.length
            ? { total: damageTotal, parts: damageParts }
            : null;

        const cmbParts = [
            part('BAB', bab, { kind: 'base' }),
            part('Strength', strM, { kind: 'ability' }),
        ];
        appendLedgerParts(cmbParts, data, ledger, ['cmb']);
        manualPart(cmbParts, 'cmb');
        negPart(cmbParts);

        const cmdParts = [
            part('Base', 10),
            part('BAB', bab, { kind: 'base' }),
            part('Strength', strM, { kind: 'ability' }),
            part('Dexterity', dexM, { kind: 'ability' }),
        ];
        appendLedgerParts(cmdParts, data, ledger, ['cmd']);
        manualPart(cmdParts, 'cmd');

        // Flat-footed CMD (PF1): CMD without Dexterity and dodge bonuses
        const cmdFFParts = cmdParts.filter((p) =>
            !(p.kind === 'ability' && p.label === 'Dexterity') && p.type !== 'dodge');

        // ---- HP: rolled dice + CON×level, then mhp feats (Toughness, …) on top ----
        // Mirrors Foundry: total_rolled_hp → hp.base; Con is ability contribution; Toughness → mhp.
        const hpParts = [];
        let rolled = toInt(data.total_rolled_hp);
        const hadRolledField = data.total_rolled_hp != null && data.total_rolled_hp !== '';
        const genTotal = toInt(data.Total_HP);
        const conHp = level > 0 ? conM * level : 0;

        // Pre-sum mhp ledger so we can reverse-estimate dice from Total_HP if needed
        let mhpBonus = 0;
        if (SD && ledger) {
            for (const c of SD.changesForTargets(ledger, ['mhp', 'hp'])) {
                const ev = SD.evalSimpleFormula(c.formula, data);
                if (ev.ok) mhpBonus += ev.value;
            }
        }
        if (rolled == null && genTotal != null) {
            rolled = genTotal - conHp - mhpBonus;
        }

        if (rolled != null) {
            hpParts.push(part(
                hadRolledField ? 'Hit dice (rolled)' : 'Hit dice (estimated from total − Con − feats)',
                rolled, { kind: 'base' }));
        } else {
            hpParts.push(part('Hit dice (rolled)', 0, {
                kind: 'base', unresolved: true, formula: 'missing total_rolled_hp',
            }));
        }
        if (level > 0) {
            hpParts.push(part(
                `Constitution (${fmt(conM)} × ${level} HD)`,
                conHp, { kind: 'ability' }));
        } else {
            hpParts.push(part('Constitution (no level/HD)', 0, { kind: 'ability' }));
        }
        // Feats/traits/talents that grant mhp/hp (Toughness: max(3, HD), etc.) — additive
        appendLedgerParts(hpParts, data, ledger, ['mhp', 'hp'], { infoOnly: false });
        if (negLv) {
            hpParts.push(part('Negative levels (−5 each)', -5 * negLv, {
                kind: 'ledger', type: 'penalty',
            }));
        }

        const ac = { total: sumParts(acParts), parts: acParts };
        const touch = { total: sumParts(touchParts), parts: touchParts };
        const flat = { total: sumParts(flatParts), parts: flatParts };
        const init = { total: sumParts(initParts), parts: initParts };
        const melee = { total: sumParts(meleeParts), parts: meleeParts };
        const ranged = { total: sumParts(rangedParts), parts: rangedParts };
        const cmb = { total: sumParts(cmbParts), parts: cmbParts };
        const cmd = { total: sumParts(cmdParts), parts: cmdParts };
        const cmdFF = { total: sumParts(cmdFFParts), parts: cmdFFParts };

        const computedHp = sumParts(hpParts);
        let hpNote = null;
        if (rolled == null && genTotal == null) {
            hpNote = 'Set hit-dice rolls (total_rolled_hp) and Con/level to compute HP.';
        } else if (!hadRolledField) {
            hpNote = 'Hit-dice rolls estimated — double-click “dice” to set total_rolled_hp.';
        }
        if (hadRolledField || rolled != null) data.Total_HP = computedHp;
        const hp = {
            total: computedHp,
            parts: hpParts,
            note: hpNote,
        };

        // Legacy-compatible flat fields for older call sites
        return {
            level, bab, strM, dexM, conM, wisM, intM, chaM,
            armorAc, shieldAc, maxDex, effDex,
            ac: ac.total, touch: touch.total, flat: flat.total,
            cmb: cmb.total, cmd: cmd.total,
            blocks: { ac, touch, flat, fort, ref, will, init, melee, ranged, damage, cmb, cmd, cmdFF, hp },
            multiclassSaves,
            savesText: goods && level
                ? `Fort ${fmt(fort.total)}, Ref ${fmt(ref.total)}, Will ${fmt(will.total)}`
                    + (multiclassSaves ? ' (class base: first class only)' : '')
                : null,
        };
    }

    /** @deprecated use computeDerived — kept name as alias for readability at call sites */
    function combatStats(data) {
        return computeDerived(data);
    }

    /** kv row with total + collapsible source list */
    function kvStat(body, label, block, opts = {}) {
        const row = h('div', 'kv kv-stat');
        row.appendChild(h('span', 'k', label));
        const v = h('span', 'v');
        const totalEl = h('span', 'stat-total',
            opts.formatTotal ? opts.formatTotal(block.total) : String(block.total));
        v.appendChild(totalEl);

        if (block.parts?.length) {
            const det = h('details', 'stat-sources');
            const sum = h('summary', null, 'sources');
            det.appendChild(sum);
            const list = h('ul', 'stat-source-list');
            for (const p of block.parts) {
                const li = h('li', 'stat-source-line'
                    + (p.unresolved ? ' unresolved' : '')
                    + (p.info ? ' info' : ''));
                const left = h('span', 'stat-source-label', p.label);
                let right;
                if (p.unresolved) {
                    right = h('span', 'stat-source-value', p.formula || '?');
                } else if (p.info) {
                    // Prefer explicit formula (e.g. weapon dice "1d8"); else numeric note
                    right = h('span', 'stat-source-value',
                        p.formula
                            || ((Number(p.value) >= 0 ? '+' : '') + p.value + ' (ledger)'));
                } else {
                    right = h('span', 'stat-source-value', fmt(Number(p.value) || 0));
                }
                li.append(left, right);
                list.appendChild(li);
            }
            if (block.note) {
                list.appendChild(h('li', 'stat-source-note', block.note));
            }
            det.appendChild(list);
            v.appendChild(det);
        }
        if (opts.footnote) {
            v.appendChild(h('div', 'stat-footnote', opts.footnote));
        }
        row.appendChild(v);
        body.appendChild(row);
        return row;
    }

    /** Session state bag on each character (HP trackers, conditions, …). */
    function sheetState(data) {
        return (data._sheet ??= {});
    }

    /**
     * User-authored buffs attached to a feature (feat/trait/class feature), keyed by its
     * display name. Stored on _sheet.featureChanges[name] = { sourceKind, changes: [...] }
     * and folded into the ledger by SheetDetails.collectChanges.
     */
    // Non-mutating read: the stored change array for a feature, or [] if none.
    function featureCustomList(data, name) {
        const arr = data?._sheet?.featureChanges?.[name]?.changes;
        return Array.isArray(arr) ? arr : [];
    }
    // Get-or-create the entry (only call when about to write).
    function featureCustomEntry(data, name, sourceKind = 'feat') {
        const st = sheetState(data);
        st.featureChanges ??= {};
        const entry = st.featureChanges[name] ??= { sourceKind, changes: [] };
        if (!Array.isArray(entry.changes)) entry.changes = [];
        entry.sourceKind = sourceKind; // keep in sync with the row's kind
        return entry;
    }
    // Drop an emptied entry so saved data doesn't accumulate blanks.
    function pruneFeatureCustom(data, name) {
        const map = data?._sheet?.featureChanges;
        if (map && map[name] && !map[name].changes?.length) delete map[name];
    }

    function parseIntLoose(s, fallback = 0) {
        const n = parseInt(String(s).replace(/[^\d-]/g, ''), 10);
        return Number.isFinite(n) ? n : fallback;
    }

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

    function activeConditions(data) {
        const arr = sheetState(data).conditions;
        return new Set(Array.isArray(arr) ? arr : []);
    }

    function setConditionActive(data, id, on) {
        const st = sheetState(data);
        const set = activeConditions(data);
        if (on) set.add(id);
        else set.delete(id);
        st.conditions = [...set];
        quietSave();
    }

    /** PF1 heavy-load lbs (medium creature); light = ⌊H/3⌋, medium = ⌊2H/3⌋. */
    function carryLimits(strScore) {
        const s = Math.max(1, Math.min(40, Number(strScore) || 10));
        const table = {
            1: 10, 2: 20, 3: 30, 4: 40, 5: 50, 6: 60, 7: 70, 8: 80, 9: 90, 10: 100,
            11: 115, 12: 130, 13: 150, 14: 175, 15: 200, 16: 230, 17: 260, 18: 300,
            19: 350, 20: 400, 21: 460, 22: 520, 23: 600, 24: 700, 25: 800, 26: 920,
            27: 1040, 28: 1200, 29: 1400, 30: 1600,
        };
        let heavy = table[s];
        if (heavy == null) {
            heavy = Math.round(1600 * Math.pow(1.2, s - 30));
        }
        return {
            light: Math.floor(heavy / 3),
            medium: Math.floor((2 * heavy) / 3),
            heavy,
        };
    }

    function loadCategory(totalLbs, strScore) {
        const lim = carryLimits(strScore);
        if (totalLbs <= lim.light) return { label: 'Light', lim, cls: 'load-light' };
        if (totalLbs <= lim.medium) return { label: 'Medium', lim, cls: 'load-medium' };
        if (totalLbs <= lim.heavy) return { label: 'Heavy', lim, cls: 'load-heavy' };
        return { label: 'Over capacity', lim, cls: 'load-over' };
    }

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

    function ensureSpellCasts(data) {
        const st = sheetState(data);
        const perDay = Array.isArray(data.day_list) ? data.day_list : [];
        if (!Array.isArray(st.spellCastsRemaining)
            || st.spellCastsRemaining.length < perDay.length) {
            const prev = Array.isArray(st.spellCastsRemaining) ? st.spellCastsRemaining : [];
            st.spellCastsRemaining = perDay.map((n, i) =>
                (prev[i] != null ? Number(prev[i]) : Number(n)) || 0);
        }
        return st.spellCastsRemaining;
    }

    function spendSpellSlot(data, level) {
        const casts = ensureSpellCasts(data);
        while (casts.length <= level) casts.push(0);
        if ((casts[level] || 0) <= 0) return false;
        casts[level] -= 1;
        quietSave();
        return true;
    }

    /** Seed casting ability from main_stat or class (Foundry spellbook.ability). */
    function ensureCastingAbility(data) {
        if (!data) return 'int';
        const cur = String(data.casting_stat || '').toLowerCase();
        if (['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(cur)) return cur;
        const ms = String(data.main_stat || '').toLowerCase();
        if (['int', 'wis', 'cha'].includes(ms)) {
            data.casting_stat = ms;
            return ms;
        }
        const cls = String(data.c_class || '').toLowerCase();
        let ab = 'cha'; // sorcerer, bard, oracle, bloodrager, skald, …
        if (/wizard|magus|alchemist|investigator|witch|arcanist/.test(cls)) ab = 'int';
        else if (/cleric|druid|ranger|paladin|shaman|warpriest|inquisitor/.test(cls)) ab = 'wis';
        data.casting_stat = ab;
        return ab;
    }

    function castingAbilityMod(data) {
        const key = ensureCastingAbility(data);
        return abModOf(data, key);
    }

    function casterLevelValue(data) {
        const n = Number(data.caster_level);
        if (Number.isFinite(n) && n > 0) return n;
        const lv = Number(data.level) || 1;
        return lv;
    }

    function spellSaveDC(data, level) {
        const sl = Math.max(0, Number(level) || 0);
        return 10 + sl + castingAbilityMod(data);
    }

    function concentrationBonus(data) {
        return casterLevelValue(data) + castingAbilityMod(data);
    }

    function ensureInitiationStat(data) {
        if (!data) return 'int';
        const cur = String(data.initiation_stat || '').toLowerCase();
        if (['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(cur)) return cur;
        const ms = String(data.main_stat || '').toLowerCase();
        if (['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(ms)) {
            data.initiation_stat = ms;
            return ms;
        }
        data.initiation_stat = 'int';
        return 'int';
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

    // Foundry PF1 buff subtypes (systems/pf1 buffTypes)
    const BUFF_SUBTYPES = [
        { id: 'temp', label: 'Temporary' },
        { id: 'spell', label: 'Spell' },
        { id: 'feat', label: 'Feat' },
        { id: 'perm', label: 'Permanent' },
        { id: 'item', label: 'Item' },
        { id: 'misc', label: 'Misc' },
    ];
    const BUFF_DURATION_UNITS = [
        { id: '', label: 'Infinite' },
        { id: 'turn', label: 'Turn(s)' },
        { id: 'round', label: 'Round(s)' },
        { id: 'minute', label: 'Minute(s)' },
        { id: 'hour', label: 'Hour(s)' },
    ];

    /**
     * Foundry-shaped buff list on _sheet.buffs (migrates legacy tempBuffs once).
     * { id, name, subType, active, level, duration:{value,units}, changes[], notes }
     */
    function ensureBuffs(data) {
        const st = sheetState(data);
        if (Array.isArray(st.buffs) && st.buffs.length) {
            // Preserve object identity (rendered rows hold references; fresh objects
            // here would orphan them and break delete/edit) — same rule as
            // ensureInventoryObjects.
            st.buffs = st.buffs.map((b) => (b && typeof b === 'object')
                ? Object.assign(b, normalizeBuffEntry(b))
                : normalizeBuffEntry(b));
            return st.buffs;
        }
        // Migrate session tempBuffs → Foundry-style buffs
        const legacy = Array.isArray(st.tempBuffs) ? st.tempBuffs : [];
        st.buffs = legacy.map((b) => normalizeBuffEntry({
            ...b,
            subType: b.subType || 'temp',
        }));
        if (legacy.length) {
            // Keep legacy array empty so we don't double-apply if something still reads it
            st.tempBuffs = [];
        } else if (!Array.isArray(st.buffs)) {
            st.buffs = [];
        }
        return st.buffs;
    }

    function normalizeBuffEntry(raw) {
        const b = raw && typeof raw === 'object' ? raw : {};
        const sub = String(b.subType || 'temp').toLowerCase();
        const okSub = BUFF_SUBTYPES.some((s) => s.id === sub) ? sub : 'temp';
        const dur = b.duration && typeof b.duration === 'object' ? b.duration : {};
        return {
            id: b.id || ('buff-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
            name: String(b.name || 'Buff').trim() || 'Buff',
            subType: okSub,
            active: b.active !== false,
            level: Number.isFinite(Number(b.level)) ? Number(b.level) : 0,
            duration: {
                value: dur.value != null ? String(dur.value) : '',
                units: ['turn', 'round', 'minute', 'hour'].includes(String(dur.units || ''))
                    ? String(dur.units) : '',
            },
            changes: Array.isArray(b.changes) ? cloneChanges(b.changes) : [],
            notes: b.notes != null ? String(b.notes) : '',
        };
    }

    function formatBuffDuration(buff) {
        const v = String(buff?.duration?.value || '').trim();
        const u = String(buff?.duration?.units || '').trim();
        if (!v && !u) return '—';
        if (v && u) {
            const unitLab = ({
                turn: 'turn', round: 'round', minute: 'min', hour: 'hour',
            })[u] || u;
            const plural = v !== '1' ? 's' : '';
            return v + ' ' + unitLab + (unitLab === 'min' ? '' : plural);
        }
        if (v) return v;
        return u || '—';
    }

    function createBuff(data, opts = {}) {
        const list = ensureBuffs(data);
        const changes = cloneChanges(opts.changes);
        if (!changes.length && opts.seedDefault !== false) {
            changes.push({
                formula: '1', target: 'ac', type: 'untyped',
                operator: 'add', priority: 0,
            });
        }
        const buff = normalizeBuffEntry({
            id: 'buff-' + Date.now(),
            name: opts.name || 'New buff',
            subType: opts.subType || 'temp',
            active: opts.active !== false,
            level: opts.level != null ? opts.level : 0,
            duration: opts.duration || { value: '', units: '' },
            changes,
            notes: opts.notes || '',
        });
        list.push(buff);
        quietSave();
        return buff;
    }

    function addBuffFromCatalog(data, name, entry, subType) {
        // Exactly the compendium changes — possibly none. No "+1 → AC" placeholder;
        // the buff editor is one click away for adding real modifiers.
        return createBuff(data, {
            name: name || entry?.name || 'Buff',
            subType: subType || 'temp',
            changes: cloneChanges(entry?.changes),
            seedDefault: false,
        });
    }

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

    // ---------------------------------------------------------------- section renderers
    function renderHeader(data) {
        const head = h('div', 'sheet-header');
        const nameInput = editableField(data, 'character_full_name', {
            onChange: () => { /* roster name updates on save */ },
        });
        nameInput.className = 'edit-field char-name-input';
        nameInput.placeholder = 'Character name';
        head.appendChild(nameInput);

        const idGrid = h('div', 'id-edit-grid no-print');
        const idFields = [
            ['Race', 'chosen_race'],
            ['Class', 'c_class'],
            ['Class 2', 'c_class_2'],
            ['Level', 'level', { type: 'number', min: 1, max: 30 }],
            ['Alignment', 'alignment'],
            ['Gender', 'gender'],
            ['Region', 'region'],
            ['Deity', 'deity_name', {
                format: (v) => Array.isArray(v) ? v.join(', ') : (v == null ? '' : String(v)),
                parse: (s) => {
                    const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
                    return parts.length <= 1 ? (parts[0] || '') : parts;
                },
            }],
        ];
        for (const [label, key, opts] of idFields) {
            const cell = h('label', 'id-edit-cell');
            cell.appendChild(h('span', null, label));
            cell.appendChild(editableField(data, key, opts || {}));
            idGrid.appendChild(cell);
        }
        head.appendChild(idGrid);

        head.appendChild(renderAbilities(data));
        return head;
    }

    function renderAbilities(data) {
        const wrap = h('div', 'ability-row');
        for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
            // No global "main stat" highlight — casting / practitioner abilities live on Spells / PoW.
            const box = h('div', 'ability-box');
            box.appendChild(h('div', 'ab-name', ab.toUpperCase()));
            const modEl = h('div', 'ab-mod', data[ab] != null ? fmt(abModOf(data, ab)) : '—');
            modEl.title = abilityInfo(data, ab).formula;
            const scoreInput = editableField(data, ab, {
                type: 'number',
                min: 1,
                max: 99,
                live: (v) => {
                    modEl.textContent = v != null && Number.isFinite(Number(v)) ? fmt(mod(v)) : '—';
                },
                onChange: () => {
                    modEl.textContent = data[ab] != null ? fmt(abModOf(data, ab)) : '—';
                },
            });
            scoreInput.className = 'edit-field ab-score-input';
            box.appendChild(scoreInput);
            box.appendChild(modEl);
            wrap.appendChild(box);
        }
        return wrap;
    }

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

    function fmtWeight(lbs) {
        if (lbs == null || !Number.isFinite(Number(lbs))) return '—';
        const n = Number(lbs);
        if (n === 0) return '0 lb';
        const s = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
        return s + (Math.abs(n) === 1 ? ' lb' : ' lbs');
    }

    function cloneChanges(list) {
        return (list || []).map((c) => ({
            formula: c.formula,
            target: c.target,
            type: c.type || 'untyped',
            operator: c.operator || 'add',
            priority: c.priority || 0,
        }));
    }

    /**
     * Ensure equipment_list is an array of editable inventory objects.
     * Migrates plain name strings in place (persisted on next save).
     */
    function ensureInventoryObjects(data) {
        if (!data) return [];
        if (!Array.isArray(data.equipment_list)) data.equipment_list = [];
        const SD = window.SheetDetails;
        data.equipment_list = data.equipment_list.map((raw, i) => {
            const norm = SD?.normalizeInventoryEntry?.(raw, data);
            if (!norm) {
                return typeof raw === 'object' && raw
                    ? raw
                    : { id: 'eq-empty-' + i, name: String(raw || ''), equipped: true, changes: [] };
            }
            // Persist as object so equip/buffs/remove stick
            const rawObj = (raw && typeof raw === 'object') ? raw : {};
            const obj = {
                id: norm.id || ('eq-' + i),
                name: norm.name,
                equipped: norm.equipped !== false,
                carried: norm.carried !== false,
                identified: norm.identified !== false,
                quantity: Math.max(1, Number(norm.quantity) || 1),
                weight: norm.weight,
                price: norm.price,
                description: norm.description || '',
                changes: cloneChanges(norm.changes),
                contextNotes: (norm.contextNotes || []).map((n) => ({ ...n })),
                changesCustomized: !!norm.changesCustomized,
            };
            if (rawObj.value != null && obj.price == null) obj.price = Number(rawObj.value);
            if (norm.subType) obj.subType = norm.subType;
            if (norm.slot) obj.slot = norm.slot;
            if (norm.itemType) obj.itemType = norm.itemType;
            if (norm.containerId) obj.containerId = norm.containerId;
            // Keep equip_descrip in sync for other consumers
            if (obj.description) {
                (data.equip_descrip ??= {})[obj.name] = obj.description;
            }
            // Preserve object identity: setActiveTab re-hydrates the list after panes render,
            // and rendered rows (checkboxes, editors) hold references to these objects — a new
            // object here would orphan them, so their edits would silently stop persisting.
            return (raw && typeof raw === 'object') ? Object.assign(raw, obj) : obj;
        });
        return data.equipment_list;
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
            if (q.length < 1) {
                results.appendChild(h('p', 'catalog-empty dim', 'Start typing to search the catalog.'));
                return;
            }
            const hits = window.SheetDetails?.searchCatalog?.(activeKind, q, { limit: 50 }) || [];
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
                    + enhancementDescHtml(data, enh, enhKind)));
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

    function fmtPrice(gp) {
        if (gp == null || !Number.isFinite(Number(gp))) return '—';
        const n = Number(gp);
        if (n === 0) return '0 gp';
        const s = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
        return s + ' gp';
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
    function bindDragReorder(container, itemSelector, onReorder) {
        if (!container || container.dataset.dragBound === '1') return;
        container.dataset.dragBound = '1';
        let dragEl = null;

        container.querySelectorAll(itemSelector).forEach((el) => {
            el.classList.add('dnd-item');
            const handle = el.querySelector('.dnd-handle') || el;
            handle.setAttribute('draggable', 'true');

            const start = (e) => {
                dragEl = el;
                el.classList.add('is-dragging');
                try {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', el.dataset.dndId || 'x');
                } catch { /* */ }
            };
            const end = () => {
                el.classList.remove('is-dragging');
                container.querySelectorAll('.dnd-over').forEach((n) => n.classList.remove('dnd-over'));
                dragEl = null;
            };
            // Listen on handle (the draggable node) and on the row as fallback
            handle.addEventListener('dragstart', start);
            handle.addEventListener('dragend', end);
            el.addEventListener('dragstart', (e) => {
                if (e.target === handle || handle.contains(e.target)) start(e);
            });
            el.addEventListener('dragend', end);

            el.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (!dragEl || dragEl === el) return;
                el.classList.add('dnd-over');
                try { e.dataTransfer.dropEffect = 'move'; } catch { /* */ }
            });
            el.addEventListener('dragleave', (e) => {
                if (!el.contains(e.relatedTarget)) el.classList.remove('dnd-over');
            });
            el.addEventListener('drop', (e) => {
                e.preventDefault();
                el.classList.remove('dnd-over');
                if (!dragEl || dragEl === el) return;
                const items = [...container.querySelectorAll(itemSelector)];
                const from = items.indexOf(dragEl);
                const to = items.indexOf(el);
                if (from < 0 || to < 0 || from === to) return;
                onReorder(from, to);
            });
        });
    }

    function reorderArray(arr, from, to) {
        if (!Array.isArray(arr) || from === to) return arr;
        if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
        return arr;
    }

    function dndHandle() {
        const el = h('span', 'dnd-handle no-print', '⋮⋮');
        el.title = 'Drag to reorder';
        el.setAttribute('draggable', 'true');
        return el;
    }

    /** Ensure skill_ranks is a mutable object; return map used for display. */
    function ensureSkillRanksObject(data) {
        let ranks = data.skill_ranks;
        if (typeof ranks === 'string') {
            try { ranks = JSON.parse(ranks); } catch { ranks = {}; }
        }
        if (!ranks || typeof ranks !== 'object') ranks = {};
        // Normalize once so writes stick
        const map = {};
        for (const [k, v] of Object.entries(ranks)) {
            map[String(k).toLowerCase().trim()] = Number(v) || 0;
        }
        data.skill_ranks = map;
        return map;
    }

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
        { title: 'Martial Training', listKey: 'mt_feats', prefix: 'Martial Training', start: 1, step: 1 },
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
        const byLevel = Math.ceil((Number(data.level) || 0) / 2); // PF1 feats at 1, 3, 5, …
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
        if (title === 'Martial Training') return 'Martial Training';
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

    function renderClassFeatures(data) {
        refreshFeatureLedger(data);
        const list = data.class_ability;
        const classes = [data.c_class, data.c_class_2];
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
        if (!items.length) {
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
        if (PREPARED_CASTERS.has(strip(data.c_class))) return true;
        if (PREPARED_CASTERS.has(strip(data.c_class_2))) return true;
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


    function knownManeuverNames(data) {
        const stanceSet = new Set(data.stances_chosen || []);
        const descs = data.maneuvers_desc_dict || {};
        const fromChoose = (data.maneuvers_choose_from || []).flat().filter(Boolean);
        const fromReadied = (data.maneuvers_readied_names || []).flat().filter(Boolean);
        let known = [...new Set([...fromChoose, ...fromReadied])];
        if (!known.length && descs) {
            known = Object.keys(descs).filter((name) => {
                if (stanceSet.has(name)) return false;
                return String(descs[name]?.type || '').toLowerCase() !== 'stance';
            });
        }
        // Never list stances in the ready-able maneuver list
        return known.filter((n) => !stanceSet.has(n)
            && String(descs[n]?.type || '').toLowerCase() !== 'stance');
    }

    function readiedManeuverSet(data) {
        return new Set((data.maneuvers_readied_names || []).flat().filter(Boolean));
    }

    /** Rebuild level-bucketed maneuvers_readied_names from a Set of readied names. */
    function writeReadiedManeuvers(data, readiedSet) {
        const descs = data.maneuvers_desc_dict || {};
        const byLevel = {};
        let maxLv = 0;
        for (const name of readiedSet) {
            const lv = Math.max(1, Number(descs[name]?.level) || 1);
            maxLv = Math.max(maxLv, lv);
            (byLevel[lv] ??= []).push(name);
        }
        // Preserve prior array length if larger (empty buckets)
        const prevLen = Array.isArray(data.maneuvers_readied_names)
            ? data.maneuvers_readied_names.length : 0;
        const len = Math.max(maxLv, prevLen, 1);
        const buckets = [];
        for (let i = 1; i <= len; i++) buckets.push(byLevel[i] || []);
        data.maneuvers_readied_names = buckets;
    }

    function maneuverDetailHtml(d) {
        if (!d) return '';
        if (typeof d === 'string') return d;
        const meta = ['action', 'range', 'duration']
            .filter((k) => d[k])
            .map((k) => `<p><em>${k[0].toUpperCase() + k.slice(1)}:</em> ${escapeHtml(String(d[k]))}</p>`)
            .join('');
        const desc = d.description ? `<div>${d.description}</div>` : '';
        return meta + desc;
    }

    function renderPathOfWar(data) {
        const known = knownManeuverNames(data);
        const hasPoW = Number(data.initiator_level) > 0
            || nonEmpty(data.martial_disciplines)
            || known.length
            || nonEmpty(data.stances_chosen)
            || nonEmpty(data.maneuvers_desc_dict);
        if (!hasPoW) return null;

        const { sec, body } = section('Path of War');
        ensureInitiationStat(data);
        kvEdit(body, 'Initiator Level', data, 'initiator_level', { type: 'number', min: 0, max: 30 });
        // Practitioner ability (Foundry/PoW initiation stat) — not a global "main stat"
        const pracKey = ensureInitiationStat(data);
        const pracRow = h('div', 'kv kv-stat');
        pracRow.appendChild(h('span', 'k', 'Practitioner ability'));
        const pracV = h('span', 'v');
        const pracSel = h('select', 'edit-field');
        for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
            const opt = document.createElement('option');
            opt.value = a;
            opt.textContent = a.toUpperCase();
            if (a === pracKey) opt.selected = true;
            pracSel.appendChild(opt);
        }
        pracSel.addEventListener('change', () => {
            data.initiation_stat = pracSel.value;
            quietSave();
            renderSheet(data);
            setActiveTab('path-of-war');
        });
        pracV.appendChild(pracSel);
        pracV.appendChild(h('span', 'dim',
            `  mod ${fmt(abModOf(data, pracKey))} (used for @INITMOD / maneuver riders)`));
        pracRow.appendChild(pracV);
        body.appendChild(pracRow);
        if (nonEmpty(data.martial_disciplines)) {
            kvEdit(body, 'Disciplines', data, 'martial_disciplines', { asArray: true });
        }

        const descs = data.maneuvers_desc_dict || {};
        const readied = readiedManeuverSet(data);
        const readiedCountEl = h('span', 'pow-ready-count', '');
        const updateReadyCount = () => {
            const r = readiedManeuverSet(data).size;
            readiedCountEl.textContent = `${known.length} known · ${r} readied`;
        };
        updateReadyCount();
        kv(body, 'Maneuvers', readiedCountEl);

        if (known.length) {
            body.appendChild(h('h3', null, 'Maneuvers (check = readied · drag to reorder)'));
            const list = h('div', 'pow-maneuver-list dnd-list');
            const st = sheetState(data);
            // Prefer saved order; fall back to level/name
            let sorted;
            if (Array.isArray(st.maneuverOrder) && st.maneuverOrder.length) {
                const set = new Set(known);
                sorted = st.maneuverOrder.filter((n) => set.has(n));
                for (const n of known) if (!sorted.includes(n)) sorted.push(n);
            } else {
                sorted = [...known].sort((a, b) => {
                    const la = Number(descs[a]?.level) || 99;
                    const lb = Number(descs[b]?.level) || 99;
                    return la - lb || String(a).localeCompare(String(b));
                });
            }
            for (const name of sorted) {
                const d = descs[name] || {};
                const row = h('div', 'pow-maneuver-row dnd-item');
                row.dataset.dndId = name;
                row.appendChild(dndHandle());
                const lab = h('label', 'pow-ready-label');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'pow-ready-check';
                cb.checked = readied.has(name);
                cb.title = 'Readied';
                cb.addEventListener('change', () => {
                    const set = readiedManeuverSet(data);
                    if (cb.checked) set.add(name);
                    else set.delete(name);
                    writeReadiedManeuvers(data, set);
                    updateReadyCount();
                    quietSave();
                });
                lab.appendChild(cb);
                lab.appendChild(h('span', 'pow-ready-tag', 'Ready'));
                row.appendChild(lab);

                const lv = d.level != null ? `L${d.level}` : '';
                const bits = [lv, d.discipline, d.type, name].filter(Boolean);
                const bodyHtml = maneuverDetailHtml(d);
                if (bodyHtml) {
                    const det = details(bits.join(' · '), bodyHtml, 'pow-maneuver-details');
                    row.appendChild(det);
                } else {
                    row.appendChild(h('span', 'pow-maneuver-name', bits.join(' · ')));
                }
                list.appendChild(row);
            }
            body.appendChild(list);
            bindDragReorder(list, '.pow-maneuver-row', (from, to) => {
                const order = [...sorted];
                reorderArray(order, from, to);
                sheetState(data).maneuverOrder = order;
                quietSave();
                renderSheet(data);
                setActiveTab('path-of-war');
            });
        }

        if (nonEmpty(data.stances_chosen)) {
            body.appendChild(h('h3', null, 'Stances'));
            const ul = h('ul', 'plain-list');
            for (const s of data.stances_chosen) {
                const d = descs[s] || {};
                const summary = [d.discipline, d.type || 'stance', s].filter(Boolean).join(' · ');
                const bodyHtml = maneuverDetailHtml(d);
                ul.appendChild(h('li', null, null))
                    .appendChild(bodyHtml ? details(summary, bodyHtml) : h('span', null, summary));
            }
            body.appendChild(ul);
        }
        return sec;
    }

    function renderSpheres(data) {
        const talents = [...(data.magic_talent_items || []), ...(data.combat_talent_items || [])];
        const { sec, body } = section('Spheres');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Browse sphere talents from the conditionals database, or add a custom talent name.'));
        body.appendChild(sectionCatalogToolbar({
            browseLabel: 'Browse talents',
            picker: {
                title: 'Add sphere talent',
                kinds: ['talents'],
                allowCustom: true,
                customPlaceholder: 'Custom talent name',
                onPick: (hit) => {
                    const sphere = hit.entry?.sphere || hit.subtitle?.split(' · ')[0] || 'Other';
                    const isCombat = /combat|might|athletics|barrage|alchemy|war/i.test(sphere);
                    const arrKey = isCombat ? 'combat_talent_items' : 'magic_talent_items';
                    if (!Array.isArray(data[arrKey])) data[arrKey] = [];
                    if (!data[arrKey].some((t) => t?.name?.toLowerCase() === hit.name.toLowerCase())) {
                        data[arrKey].push({
                            name: hit.name,
                            sphere,
                            description: '',
                            modifiers: hit.entry?.modifiers || [],
                            rider: hit.entry?.rider || '',
                        });
                        quietSave();
                    }
                    renderSheet(data);
                    setActiveTab('spheres');
                },
                onCustom: (name) => {
                    if (!Array.isArray(data.magic_talent_items)) data.magic_talent_items = [];
                    data.magic_talent_items.push({ name, sphere: 'Other', description: '' });
                    quietSave();
                    renderSheet(data);
                    setActiveTab('spheres');
                },
            },
        }));

        if (!nonEmpty(data.spheres_chosen) && !talents.length) {
            body.appendChild(h('p', 'tools-empty', 'No spheres or talents yet — browse to add.'));
            return sec;
        }

        const st = sheetState(data);
        const poolMax = Number(data.sphere_mana_pool) || 0;
        if (st.spellPointsMax == null && poolMax) st.spellPointsMax = poolMax;
        if (st.spellPointsCurrent == null) st.spellPointsCurrent = st.spellPointsMax ?? poolMax;

        const spRow = h('div', 'kv kv-stat');
        spRow.appendChild(h('span', 'k', 'Spell Points'));
        const spV = h('span', 'v');
        const spBoxes = h('div', 'hp-boxes');
        const curBox = h('div', 'hp-box');
        curBox.appendChild(h('span', 'hp-box-label', 'Current'));
        curBox.appendChild(dblclickEditable(st, 'spellPointsCurrent', {
            type: 'number', min: 0,
            format: (v) => String(v ?? 0),
            parse: (s) => parseIntLoose(s, 0),
            onChange: () => quietSave(),
        }));
        const maxBox = h('div', 'hp-box');
        maxBox.appendChild(h('span', 'hp-box-label', 'Max'));
        maxBox.appendChild(dblclickEditable(st, 'spellPointsMax', {
            type: 'number', min: 0,
            format: (v) => String(v ?? 0),
            parse: (s) => parseIntLoose(s, 0),
            onChange: () => quietSave(),
        }));
        spBoxes.append(curBox, maxBox);
        spV.appendChild(spBoxes);
        spRow.appendChild(spV);
        body.appendChild(spRow);

        const ct = data.casting_tradition || {};
        if (ct.casting_ability_modifier) kv(body, 'Casting Ability', ct.casting_ability_modifier);
        for (const [label, key] of [
            ['MSB', 'sphere_msb'], ['MSD', 'sphere_msd'], ['Sphere CL', 'sphere_cl'],
        ]) {
            if (data[key] != null && data[key] !== '') kv(body, label, data[key]);
        }
        if (nonEmpty(data.spheres_chosen)) {
            kv(body, 'Spheres', data.spheres_chosen
                .map((s) => `${s.sphere} (${s.system})`).join(', '));
        }
        const detailList = (title, names, detailArr) => {
            if (!nonEmpty(names)) return;
            body.appendChild(h('h3', null, title));
            const ul = h('ul', 'plain-list');
            const byName = {};
            (detailArr || []).forEach((d) => { if (d?.name) byName[d.name] = d.description; });
            names.forEach((n) => ul.appendChild(h('li', null, null))
                .appendChild(byName[n] ? details(n, byName[n]) : h('span', null, n)));
            body.appendChild(ul);
        };
        detailList('Tradition Drawbacks', data.sphere_drawbacks, ct.drawbacks_detail);
        detailList('Tradition Boons', data.sphere_boons, ct.boons_detail);
        if (talents.length) {
            body.appendChild(h('h3', null, 'Talents'));
            const bySphere = {};
            for (const t of talents) (bySphere[t.sphere || 'Other'] ??= []).push(t);
            for (const [sphere, ts] of Object.entries(bySphere)) {
                const wrap = h('details', 'sphere-block');
                wrap.open = true;
                wrap.appendChild(h('summary', null, `${sphere} (${ts.length})`));
                const ul = h('ul', 'plain-list dnd-list');
                // Map talent objects to their source array for reorder within sphere group
                // (reorder within the combined visual list of this sphere only)
                const sphereItems = ts;
                ts.forEach((t) => {
                    const label = t.name + (t.advanced ? ' (advanced)' : '');
                    const cond = window.SheetDetails?.conditionalForTalent(t.name);
                    const hasCond = cond && (cond.modifiers?.length || cond.rider);
                    const li = h('li', 'talent-row dnd-item');
                    li.dataset.dndId = t.name;
                    li.appendChild(dndHandle());
                    const useBtn = h('button', 'inv-btn no-print', 'Use');
                    useBtn.type = 'button';
                    useBtn.addEventListener('click', () => {
                        window.SheetRoll?.setOpen?.(true);
                        const rider = cond?.rider ? ' — ' + cond.rider : '';
                        window.SheetRoll?.rollAndLog?.('d1', 'Talent: ' + t.name + rider);
                    });
                    li.appendChild(useBtn);
                    if (!t.description && !hasCond) {
                        li.appendChild(h('span', null, label));
                    } else {
                        const d = details(label, t.description || '');
                        if (hasCond) {
                            const modTxt = (cond.modifiers || []).map((m) =>
                                `${m.formula} ${m.type && m.type !== 'untyped' ? m.type + ' ' : ''}${m.subTarget || m.target || ''}`.trim()).join('; ');
                            const parts = [
                                modTxt ? `<p><strong>Per-roll modifiers:</strong> ${escapeHtml(modTxt)}</p>` : '',
                                cond.rider ? `<p><strong>Rider:</strong> ${highlightInlineRolls(cond.rider)}</p>` : '',
                            ].join('');
                            d.appendChild(htmlBlock('desc cond-rider', parts));
                        }
                        li.appendChild(d);
                    }
                    const rm = h('button', 'inv-btn inv-btn-danger no-print', '×');
                    rm.type = 'button';
                    rm.addEventListener('click', () => {
                        if (!confirm(`Remove talent “${t.name}”?`)) return;
                        for (const key of ['magic_talent_items', 'combat_talent_items']) {
                            const arr = data[key];
                            if (!Array.isArray(arr)) continue;
                            const i = arr.findIndex((x) => x?.name === t.name);
                            if (i >= 0) { arr.splice(i, 1); quietSave(); break; }
                        }
                        renderSheet(data);
                        setActiveTab('spheres');
                    });
                    li.appendChild(rm);
                    ul.appendChild(li);
                });
                wrap.appendChild(ul);
                // Reorder within this sphere: rearrange objects in their source arrays by name order
                bindDragReorder(ul, '.talent-row', (from, to) => {
                    const ordered = [...sphereItems];
                    reorderArray(ordered, from, to);
                    // Apply new order for items that live in magic/combat arrays
                    const names = ordered.map((t) => t.name);
                    for (const key of ['magic_talent_items', 'combat_talent_items']) {
                        const arr = data[key];
                        if (!Array.isArray(arr)) continue;
                        const inSphere = arr.filter((t) => (t.sphere || 'Other') === sphere);
                        const rest = arr.filter((t) => (t.sphere || 'Other') !== sphere);
                        const reordered = names.map((n) => inSphere.find((t) => t.name === n)).filter(Boolean);
                        data[key] = [...rest, ...reordered];
                    }
                    quietSave();
                    renderSheet(data);
                    setActiveTab('spheres');
                });
                body.appendChild(wrap);
            }
        }
        return sec;
    }

    /** Join generator string/array fields into readable prose. */
    function joinProseField(v) {
        if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean).join(', ');
        if (v == null || v === '') return '';
        return String(v).trim();
    }

    /**
     * Freeform identity prose (Foundry-style biography/notes).
     * One-time seed from generator micro-fields when empty; then fully editable on Notes.
     */
    function ensureProse(data) {
        const st = sheetState(data);
        st.prose ??= {};
        const p = st.prose;
        if (p._seeded) {
            if (!p.notes && st.notes) p.notes = String(st.notes);
            return p;
        }
        const hasAny = !!(p.description || p.personality || p.notes);
        if (!hasAny) {
            const descBits = [];
            const hair = [joinProseField(data.hair_type), joinProseField(data.hair_color)]
                .filter(Boolean).join(', ');
            if (hair) descBits.push('Hair: ' + hair);
            const eyes = joinProseField(data.eye_color);
            if (eyes) descBits.push('Eyes: ' + eyes);
            const appearance = joinProseField(data.appearance);
            if (appearance) descBits.push(appearance);
            p.description = descBits.join('\n');

            const personBits = [];
            const traits = joinProseField(data.personality_traits);
            if (traits) personBits.push(traits);
            const manner = joinProseField(data.mannerisms);
            if (manner) personBits.push('Mannerisms: ' + manner);
            const profs = joinProseField(data.professions);
            if (profs) personBits.push('Professions: ' + profs);
            p.personality = personBits.join('\n');

            const noteBits = [];
            if (data.backstory) noteBits.push(String(data.backstory).trim());
            if (st.notes) noteBits.push(String(st.notes).trim());
            const parents = joinProseField(data.parents);
            if (parents) noteBits.push('Parents: ' + parents);
            const family = [
                ['Older brothers', data.older_brothers],
                ['Younger brothers', data.younger_brothers],
                ['Older sisters', data.older_sisters],
                ['Younger sisters', data.younger_sisters],
            ].map(([lab, v]) => {
                const n = v == null || v === '' ? '' : String(v).trim();
                return n && n !== '0' ? lab + ': ' + n : '';
            }).filter(Boolean);
            if (family.length) noteBits.push(family.join('\n'));
            p.notes = noteBits.filter(Boolean).join('\n\n');
        } else {
            if (!p.notes && st.notes) p.notes = String(st.notes);
            if (!p.notes && data.backstory) p.notes = String(data.backstory);
        }
        p.description = p.description || '';
        p.personality = p.personality || '';
        p.notes = p.notes || '';
        p._seeded = true;
        // Keep legacy notes field in sync for older readers
        st.notes = p.notes;
        return p;
    }

    function bindProseTextarea(ta, data, key) {
        let timer = null;
        ta.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const p = ensureProse(data);
                p[key] = ta.value;
                if (key === 'notes') (data._sheet ??= {}).notes = ta.value;
                if (data === currentData) quietSave();
            }, 800);
        });
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
    const emptyState = (text) => h('p', 'placeholder tab-empty', text);

    function compose(...sections) {
        const frag = document.createDocumentFragment();
        for (const s of sections) if (s) frag.appendChild(s);
        return frag.childNodes.length ? frag : null;
    }

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
        for (const cls of [data.c_class, data.c_class_2]) {
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
            titleCase(clsName) + ' — level ' + (Number(data.level) || 0)));
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

    /** Archetype popup — scraped description, base level 0. */
    function openArchetypeSheet(data) {
        const info = archetypeInfoOf(data);
        if (!info) return;
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

        // --- Class & Archetype
        body.appendChild(h('h3', null, 'Class & Archetype'));
        const classRow = (label, blurb, onOpen) => {
            const btn = h('button', 'class-row');
            btn.type = 'button';
            btn.appendChild(h('span', 'class-row-arrow', '▸'));
            btn.appendChild(h('span', 'class-row-name', label));
            if (blurb) btn.appendChild(h('span', 'class-row-blurb dim', blurb));
            btn.addEventListener('click', onOpen);
            body.appendChild(btn);
        };
        for (const cls of [data.c_class, data.c_class_2]) {
            if (!cls) continue;
            const info = classInfoFor(data, cls);
            classRow(
                titleCase(cls) + ' — level ' + (Number(data.level) || 0),
                info.hd ? `d${info.hd} · BAB ${info.bab} · ${info.casting}` : 'click for class details',
                () => openClassSheet(data, cls));
        }
        const arch = archetypeInfoOf(data);
        if (arch) {
            classRow('Archetype: ' + arch.name, 'base level 0 — click for description',
                () => openArchetypeSheet(data));
        }
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
        // typed bonuses (Racial / Enhance / Inherent / Misc) / Damage / Drain,
        // full width. Total hover shows the full source formula.
        const ABILITY_NAMES = {
            str: 'Strength', dex: 'Dexterity', con: 'Constitution',
            int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
        };
        const st = sheetState(data);
        const abT = h('table', 'skills-table ability-table');
        const abHd = h('tr');
        ['Ability', 'Total', 'Modifier', 'Racial', 'Enhance', 'Inherent',
            'Misc', 'Damage', 'Drain']
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

            const totTd = h('td', 'num ability-total');
            totTd.title = info.formula + ' — double-click to edit the base score';
            totTd.appendChild(dblclickEditable(data, ab, {
                type: 'number', min: 1, max: 99,
                format: () => (abilityInfo(data, ab).total ?? '—') + '',
                parse: (s) => parseIntLoose(s, 10),
                onChange: rerenderAttrs,
            }));
            tr.appendChild(totTd);

            const modTd = h('td', 'num ability-mod', fmt(info.mod));
            modTd.title = 'floor((total − 10) / 2)'
                + (info.damage ? ` − ${Math.floor(info.damage / 2)} (ability damage)` : '');
            tr.appendChild(modTd);

            const ADJ_HINTS = {
                racial: 'Racial ability modifier (e.g. +2 from race/heritage).',
                enhancement: 'Enhancement bonus (belts, bull’s strength). Highest one '
                    + 'applies — don’t add belt bonuses already tracked as buffs.',
                inherent: 'Inherent bonus (tomes/manuals, wish). Max +5, stacks with '
                    + 'enhancement.',
                misc: 'Any other untyped/situational adjustment to the score.',
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
                return td;
            };
            tr.appendChild(adjCell('racial', true));
            tr.appendChild(adjCell('enhancement', true));
            tr.appendChild(adjCell('inherent', true));
            tr.appendChild(adjCell('misc', true));
            tr.appendChild(adjCell('damage', false));
            tr.appendChild(adjCell('drain', false));
            abT.appendChild(tr);
        }
        body.appendChild(abT);
        return sec;
    }

    // ---------------------------------------------------------------- defenses block
    const DR_BYPASS_TYPES = ['—', 'adamantine', 'bludgeoning', 'chaotic', 'cold iron',
        'epic', 'evil', 'good', 'lawful', 'magic', 'piercing', 'silver', 'slashing'];
    const ENERGY_TYPES = ['acid', 'cold', 'electricity', 'fire', 'sonic', 'force',
        'negative energy', 'positive energy'];

    /** Bucket AC parts into per-bonus-type totals for the Defenses grid. */
    function acTypeTotals(parts) {
        const order = ['Armor', 'Shield', 'Deflection', 'Dodge', 'Natural Armor',
            'Enhancement', 'Insight', 'Luck', 'Profane', 'Sacred', 'Trait', 'Other'];
        const typeMap = {
            armor: 'Armor', shield: 'Shield', deflect: 'Deflection', dodge: 'Dodge',
            nac: 'Natural Armor', enh: 'Enhancement', insight: 'Insight', luck: 'Luck',
            profane: 'Profane', sacred: 'Sacred', trait: 'Trait',
        };
        const buckets = new Map(order.map((k) => [k, { total: 0, sources: [] }]));
        for (const p of parts || []) {
            if (p.info || p.unresolved) continue;
            let bucket = null;
            if (p.kind === 'gear') {
                bucket = /^Shield/.test(p.label) ? 'Shield'
                    : (/^Armor/.test(p.label) ? 'Armor' : null);
            } else if (p.kind === 'ledger' || p.kind === 'manual') {
                bucket = typeMap[p.type] || 'Other';
            }
            if (!bucket) continue; // Base 10 / Dex are not bonuses
            const b = buckets.get(bucket);
            b.total += Number(p.value) || 0;
            b.sources.push(p.label + ' ' + fmt(Number(p.value) || 0));
        }
        return order.map((label) => ({ label, ...buckets.get(label) }));
    }

    /** Bucket a save block's parts: Base / Abl / Enhance / Resist / Feat / Trait / Misc / Temp. */
    function saveBuckets(block) {
        const out = { base: 0, ability: 0, enh: 0, resist: 0,
            feat: 0, trait: 0, misc: 0, temp: 0 };
        for (const p of block?.parts || []) {
            if (p.info || p.unresolved) continue;
            const v = Number(p.value) || 0;
            if (p.kind === 'base') out.base += v;
            else if (p.kind === 'ability') out.ability += v;
            else if (p.kind === 'manual' || p.sourceKind === 'buff') out.temp += v;
            else if (p.type === 'enh') out.enh += v;
            else if (p.type === 'resist') out.resist += v;
            else if (p.sourceKind === 'feat') out.feat += v;
            else if (p.sourceKind === 'trait') out.trait += v;
            else out.misc += v;
        }
        return out;
    }

    function ensureDefenses(data) {
        const st = sheetState(data);
        st.defenses ??= {};
        for (const key of ['dr', 'resist', 'dmgImmune', 'dmgVuln', 'condResist', 'condImmune']) {
            if (!Array.isArray(st.defenses[key])) st.defenses[key] = [];
        }
        return st.defenses;
    }

    const DAMAGE_TYPES = [...ENERGY_TYPES, 'bludgeoning', 'piercing', 'slashing'];

    /** SR = editable base (seeded from the generator) + feat/trait/class/misc boxes. */
    function srTotal(data) {
        const st = sheetState(data);
        const b = st.srBonus || {};
        return (Number(st.sr) || 0) + (Number(b.feat) || 0) + (Number(b.trait) || 0)
            + (Number(b.class) || 0) + (Number(b.misc) || 0);
    }

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

    /** Iterative attack string from BAB: "+11/+6/+1" (max 4 attacks, PF1-style). */
    function babIterativesStr(bab) {
        const b = Number(bab) || 0;
        const parts = [fmt(b)];
        for (let a = b - 5; a > 0 && parts.length < 4; a -= 5) parts.push(fmt(a));
        return parts.join('/');
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

    function tabNotes(data) {
        const prose = ensureProse(data);
        const { sec, body } = section('Notes');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Freeform identity & session text (biography/notes). Auto-saves with the character.'));

        const mkBlock = (title, key, placeholder, extraClass) => {
            body.appendChild(h('h3', 'notes-prose-title', title));
            const ta = h('textarea', 'notes-text' + (extraClass ? ' ' + extraClass : ''));
            ta.id = 'notes-prose-' + key;
            ta.placeholder = placeholder;
            ta.value = prose[key] || '';
            ta.rows = key === 'notes' ? 12 : 6;
            bindProseTextarea(ta, data, key);
            body.appendChild(ta);
        };
        mkBlock('Description', 'description',
            'Appearance, hair, eyes, build, clothing, distinguishing marks…');
        mkBlock('Personality', 'personality',
            'Traits, mannerisms, voice, ideals, flaws, how they act at the table…');
        mkBlock('Notes & background', 'notes',
            'Backstory, family, relationships, session plans, secrets…',
            'notes-text-main');
        // Legacy id for re-render flush of the main notes field
        const main = body.querySelector('#notes-prose-notes');
        if (main) main.dataset.legacyNotes = '1';
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

    // ---------------------------------------------------------------- simple printable sheet
    // Classic paper-style sheet (PZO1110-like): static values, write-in blanks, two print pages.
    function viewMode() {
        return localStorage.getItem(VIEW_KEY) === 'simple' ? 'simple' : 'full';
    }

    function setViewMode(mode) {
        localStorage.setItem(VIEW_KEY, mode === 'simple' ? 'simple' : 'full');
        syncViewToggle();
    }

    function syncViewToggle() {
        const btn = document.getElementById('view-toggle');
        if (!btn) return;
        const simple = viewMode() === 'simple';
        btn.textContent = simple ? 'Full sheet' : 'Simple sheet';
        btn.title = simple
            ? 'Switch back to the full tabbed sheet'
            : 'Switch to the simple printable sheet';
    }

    /** value: string/number, or a Node (e.g. dblclickEditable) hosted inside the cell. */
    function spCell(label, value, cls) {
        const cell = h('div', 'simple-id-cell' + (cls ? ' ' + cls : ''));
        if (value instanceof Node) {
            const v = h('div', 'simple-id-v');
            v.appendChild(value);
            cell.appendChild(v);
        } else {
            const text = value == null ? '' : String(value).trim();
            cell.appendChild(h('div', 'simple-id-v', text || ' '));
        }
        cell.appendChild(h('div', 'simple-id-k', label));
        return cell;
    }

    function spHeading(text) {
        return h('h2', 'simple-h', text);
    }

    function spBoxBig(label, value) {
        const box = h('div', 'simple-stat-box');
        if (value instanceof Node) {
            const v = h('div', 'simple-stat-val');
            v.appendChild(value);
            box.appendChild(v);
            box.appendChild(h('div', 'simple-stat-lab', label));
            return box;
        }
        const text = value == null ? '' : String(value);
        box.appendChild(h('div', 'simple-stat-val', text || ' '));
        box.appendChild(h('div', 'simple-stat-lab', label));
        return box;
    }

    /** headers/cells: string or { text, cls } ('num' right-aligns, 'strong' bolds). */
    function spTable(headers, rows, cls) {
        const t = h('table', 'simple-table' + (cls ? ' ' + cls : ''));
        const hd = h('tr');
        for (const c of headers) {
            hd.appendChild(h('th', typeof c === 'object' ? c.cls : null,
                typeof c === 'object' ? c.text : c));
        }
        t.appendChild(hd);
        for (const raw of rows) {
            // Rows may be { cls, cells } so blank write-in rows can be tagged for print
            const isRowObj = raw && !Array.isArray(raw) && typeof raw === 'object' && Array.isArray(raw.cells);
            const row = isRowObj ? raw.cells : raw;
            const tr = h('tr', isRowObj ? raw.cls : null);
            for (const c of row) {
                if (c instanceof Node) {
                    tr.appendChild(h('td', null, c));
                    continue;
                }
                if (c && typeof c === 'object' && c.node instanceof Node) {
                    tr.appendChild(h('td', c.cls, c.node));
                    continue;
                }
                const text = typeof c === 'object' ? c.text : c;
                tr.appendChild(h('td', typeof c === 'object' ? c.cls : null,
                    text == null || text === '' ? ' ' : String(text)));
            }
            t.appendChild(tr);
        }
        return t;
    }

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
        p1.appendChild(nameRow);

        const clsWrap = h('span', 'simple-inline-edits');
        clsWrap.appendChild(edit(data, 'c_class', { format: titled, rerender: true }));
        if (data.c_class_2) clsWrap.appendChild(h('span', null, ' / ' + titleCase(data.c_class_2)));
        clsWrap.appendChild(document.createTextNode(' '));
        clsWrap.appendChild(editNum(data, 'level', { min: 1, max: 40, rerender: true }));
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
        p1.appendChild(id);

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

    /**
     * Wrap every <table> in a horizontal-scroll container so wide, dense tables
     * (skills, saves, abilities, spells) scroll within their column on narrow screens
     * instead of forcing the whole page to overflow sideways. Idempotent per render.
     */
    function wrapWideTables(root) {
        if (!root) return;
        for (const table of root.querySelectorAll('table')) {
            if (table.closest('.table-scroll')) continue; // already wrapped (incl. nested)
            const wrap = document.createElement('div');
            wrap.className = 'table-scroll';
            table.replaceWith(wrap);
            wrap.appendChild(table);
        }
    }

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
    };

    // ---------------------------------------------------------------- character roster
    function rosterSelect() { return document.getElementById('char-select'); }

    async function refreshRoster(selectedId) {
        const sel = rosterSelect();
        const lib = window.SheetLibrary;
        if (!sel || !lib) return;
        const records = await lib.list().catch(() => []);
        sel.innerHTML = '';
        const placeholder = h('option', null, records.length ? '— pick a character —' : '(no saved characters)');
        placeholder.value = '';
        sel.appendChild(placeholder);
        for (const r of records) {
            const opt = h('option', null, `${r.name} — ${titleCase(r.klass || '?')} ${r.level}`);
            opt.value = r.id;
            sel.appendChild(opt);
        }
        const want = selectedId ?? currentData?._sheet?.id ?? localStorage.getItem(CURRENT_KEY);
        if (want && records.some((r) => r.id === want)) sel.value = want;
    }

    async function saveCurrent({ quiet } = {}) {
        if (!currentData || currentData.error) return;
        if (currentData) {
            const prose = ensureProse(currentData);
            for (const key of ['description', 'personality', 'notes']) {
                const el = document.getElementById('notes-prose-' + key);
                if (el) prose[key] = el.value;
            }
            const legacy = document.getElementById('notes-text');
            if (legacy && !document.getElementById('notes-prose-notes')) {
                prose.notes = legacy.value;
            }
            (currentData._sheet ??= {}).notes = prose.notes || '';
        }
        const record = await window.SheetLibrary.save(currentData);
        localStorage.setItem(CURRENT_KEY, record.id);
        if (!quiet) await refreshRoster(record.id);
        return record;
    }

    async function loadCharacter(id) {
        const record = await window.SheetLibrary.get(id);
        if (!record) return;
        localStorage.setItem(CURRENT_KEY, record.id);
        renderSheet(record.data);
        await refreshRoster(record.id);
    }

    async function deleteCurrent() {
        const id = currentData?._sheet?.id || rosterSelect()?.value;
        if (!id) return;
        const name = currentData?.character_full_name || 'this character';
        if (!confirm(`Delete ${name} from the library${window.SheetLibrary.status().state === 'connected' ? ' and its file in the connected folder' : ''}?`)) return;
        await window.SheetLibrary.remove(id);
        localStorage.removeItem(CURRENT_KEY);
        currentData = null;
        const records = await window.SheetLibrary.list().catch(() => []);
        if (records.length) await loadCharacter(records[0].id);
        else {
            renderSheet(null);
            await refreshRoster();
        }
    }

    // ---------------------------------------------------------------- generate form
    function fillSelect(sel, options, valueFn) {
        for (const o of options) {
            const opt = document.createElement('option');
            opt.value = valueFn ? valueFn(o) : o;
            opt.textContent = o;
            sel.appendChild(opt);
        }
    }

    // /update_character_data unpacks the payload POSITIONALLY (spheres_of_power is popped by
    // name), so this key order must stay exactly in sync with the Foundry module's button.js,
    // with use_backstory_api + backstory_focus appended as the optional 20th/21st inputs.
    function buildPayload(form) {
        const f = (name) => form.elements[name].value;
        return {
            input: 'Y',
            region: f('region'),
            race: f('race'),
            class: f('class'),
            bab: f('bab'),
            caster_level: f('caster_level'),
            multiclass: f('multiclass'),
            alignment: f('alignment'),
            deity: f('deity'),
            gender: f('gender'),
            randomFeats: f('randomFeats'),
            inherents: f('inherents'),
            modded_char_sheet: f('modded_char_sheet'),
            homebrew_feat_amount: f('homebrew_feat_amount'),
            spheres_of_power: f('spheres_of_power'),
            diceRolls: f('diceRolls'),
            diceSides: f('diceSides'),
            highestLevel: f('highestLevel'),
            lowestLevel: f('lowestLevel'),
            goldAmount: f('goldAmount'),
            use_backstory_api: f('use_backstory_api'),
            backstory_focus: f('backstory_focus'),
        };
    }

    async function adoptCharacter(data) {
        renderSheet(data);
        await saveCurrent(); // auto-save: every generated/loaded character lands in the library
    }

    async function generate(form) {
        const status = document.getElementById('gen-status');
        const btn = document.getElementById('gen-submit');
        const payload = buildPayload(form);
        localStorage.setItem(FORM_KEY, JSON.stringify(payload));
        btn.disabled = true;
        status.textContent = 'Generating… (the backend can take up to a minute)';
        try {
            const resp = await fetch(backendUrl() + '/update_character_data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            await adoptCharacter(data);
            status.textContent = '';
            document.getElementById('gen-panel').classList.add('hidden');
        } catch (err) {
            status.textContent = 'Failed: ' + err.message;
        } finally {
            btn.disabled = false;
        }
    }

    function loadJsonText(text) {
        try {
            const data = JSON.parse(text);
            adoptCharacter(data);
            document.getElementById('load-panel').classList.add('hidden');
        } catch (err) {
            alert('Not valid JSON: ' + err.message);
        }
    }

    // ---------------------------------------------------------------- wiring
    document.addEventListener('DOMContentLoaded', async () => {
        // Core topbar buttons FIRST, before anything that can throw — a bad stored
        // theme/form value must never take Print or Generate down with it.
        const toggle = (id) => document.getElementById(id).classList.toggle('hidden');
        document.getElementById('toggle-gen').addEventListener('click', () => toggle('gen-panel'));
        document.getElementById('toggle-load').addEventListener('click', () => toggle('load-panel'));
        document.getElementById('print-btn').addEventListener('click', () => window.print());
        document.getElementById('view-toggle').addEventListener('click', () => {
            setViewMode(viewMode() === 'simple' ? 'full' : 'simple');
            renderSheet(currentData);
        });
        syncViewToggle();

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
        fillSelect(form.elements.race, RACES, (r) => r.toLowerCase().replace(/\s/g, '-'));
        fillSelect(form.elements.class, CLASSES, (c) => c.toLowerCase().replace(/\s/g, '-'));
        fillSelect(form.elements.deity, DEITIES);

        // Restore the saved generator form; a corrupt value self-heals instead of
        // killing the rest of the boot.
        try {
            const savedForm = JSON.parse(localStorage.getItem(FORM_KEY) || 'null');
            if (savedForm) {
                for (const [k, v] of Object.entries(savedForm)) {
                    if (form.elements[k]) form.elements[k].value = v;
                }
            }
        } catch (err) {
            console.error('Stored generator form was corrupt — clearing it:', err);
            localStorage.removeItem(FORM_KEY);
        }

        form.addEventListener('submit', (e) => { e.preventDefault(); generate(form); });
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
        // No character (or missing id): still render Settings so themes/backend/folder are visible.
        if (!loaded) renderSheet(null);

        // The details data usually lands after first paint — re-render once so descriptions
        // and the Buffs ledger fill in.
        window.SheetDetails?.ready.then(() => { if (currentData) renderSheet(currentData); });
    });
})();
