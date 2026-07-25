// scripts/theme.js -- the appearance/theme colour engine (window.SheetTheme). Extracted from
// sheet.js (Part B split); bodies moved verbatim. Loads after state.js, before sheet.js.
// Pure colour math + the theme picker/modal + Settings theme controls. Onboarding
// (Start here / Instructions / audience) stays in the shell and is late-bound via SheetApp.
// NOTE: DEFAULT_THEME ('sepia') is ALSO hard-coded in the index.html pre-paint script --
// change both together or the page flashes the wrong palette on load.
window.SheetTheme = (function () {
    'use strict';
    const { h } = window.SheetUI;
    // Shell-owned onboarding/audience hooks, late-bound (read at call time).
    const audience = () => window.SheetApp.audience();
    const audienceDefault = (f) => window.SheetApp.audienceDefault(f);
    const setAudience = (l) => window.SheetApp.setAudience(l);
    const openStartHere = () => window.SheetApp.openStartHere();
    const openInstructions = () => window.SheetApp.openInstructions();
    const shouldAutoOpenStartHere = () => window.SheetApp.shouldAutoOpenStartHere();

    const THEME_KEY = 'sheet.theme';
    const THEME_SKIP_PROMPT_KEY = 'sheet.themePromptSkip'; // '1' = don't auto-open modal on load
    const CUSTOM_THEME_KEY = 'sheet.customTheme'; // {paper, accent, ink} hex
    const CUSTOM_THEME_TOKENS_KEY = 'sheet.customThemeTokens'; // derived token map for pre-paint boot
    const SAVED_THEMES_KEY = 'sheet.savedThemes'; // [{id: 'saved-…', label, colors: {paper, accent, ink}}]
    // What a profile that has never picked a theme gets. Sepia rather than 'system': it is
    // the dullest light theme in the set (paper 15% down from white, warm monochrome, no
    // saturated field anywhere), so a newcomer lands on something restful without being
    // asked, and two machines side by side look identical regardless of their OS dark-mode
    // setting. MIRRORED in the pre-paint script in index.html — change both together.
    const DEFAULT_THEME = 'sepia';
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
    function themePreference() {
        let v = localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
        if (v === 'foundry-classic') v = 'parchment'; // retired theme
        return isThemeChoice(v) ? v : DEFAULT_THEME;
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
    // The full set of CSS custom-property names buildCustomTokens derives (used to apply/clear
    // the Custom theme). Computed once from the default combo — the KEYS are combo-independent.
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
        const choice = isThemeChoice(pref) ? pref : DEFAULT_THEME;
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
        const choice = isThemeChoice(pref) ? pref : DEFAULT_THEME;
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
    let themeOverlay = null;
    function closeThemeModal() {
        themeOverlay?.close();
    }
    function openThemeModal() {
        if (themeOverlay) return;
        const body = document.getElementById('theme-modal-body');
        if (!body || !window.SheetOverlay) return;
        buildThemeModalGrid();
        syncThemeControls(themePreference());
        const skip = document.getElementById('theme-modal-skip');
        if (skip) skip.checked = skipThemePrompt();
        themeOverlay = window.SheetOverlay.open({
            title: 'Choose a theme',
            body,
            cls: 'theme-overlay',
            footer: [
                document.getElementById('theme-modal-skip-row'),
                document.getElementById('theme-modal-help'),
                document.getElementById('theme-modal-done'),
            ],
            onClose() {
                const box = document.getElementById('theme-modal-skip');
                if (box) setSkipThemePrompt(!!box.checked);
                themeOverlay = null;
            },
        });
        // Prefer the currently-selected swatch over the first tabbable control.
        themeOverlay.card.querySelector('.theme-modal-pick.is-selected')?.focus();
    }
    function shouldAutoOpenThemeModal() {
        // Experienced players only. A newcomer gets a known-good default look (DEFAULT_THEME)
        // and Start here instead — being asked to choose between sixteen colour schemes
        // before you've been told what the page is helps nobody. The Theme button in the top
        // bar still opens it for anyone, anytime.
        return audience() === 'expert' && !skipThemePrompt();
    }
    function initTheme() {
        applyTheme(themePreference());
        const themeBtn = document.getElementById('theme-btn');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => openThemeModal());
        }
        document.getElementById('theme-modal-done')?.addEventListener('click', closeThemeModal);
        // The way back. Only an expert ever sees this picker, so "New here?" means they said
        // they'd played before and hadn't — undo it, then stack the on-ramp on top rather
        // than dismissing the picker underneath.
        document.getElementById('theme-modal-help')?.addEventListener('click', () => {
            setAudience('beginner');
            openStartHere();
        });
        try {
            const mq = window.matchMedia('(prefers-color-scheme: dark)');
            const onChange = () => {
                if (themePreference() === 'system') applyTheme('system');
            };
            if (mq.addEventListener) mq.addEventListener('change', onChange);
            else if (mq.addListener) mq.addListener(onChange);
        } catch { /* ignore */ }

        // After first paint so the sheet is under the overlay. Start here comes first: a
        // newcomer needs to know what the page IS before being asked what colour it should
        // be. The picker is what an expert gets instead, never both at once.
        if (shouldAutoOpenStartHere()) {
            requestAnimationFrame(() => openStartHere());
        } else if (shouldAutoOpenThemeModal()) {
            requestAnimationFrame(() => openThemeModal());
        }
    }

    return {
        themePreference, resolveTheme, normHex, hexToRgb, rgbToHex, hexToHsl, hslToHex, mixHex,
        withAlpha, relLuminance, contrastRatio, customThemeColors, saveCustomThemeColors,
        savedThemes, saveSavedThemes, savedThemeById, addSavedTheme, deleteSavedTheme,
        isThemeChoice, themeList, buildCustomTokens, applyCustomTokens, clearCustomTokens,
        customSwatches, buildCustomThemeControls, syncThemeControls, applyTheme,
        buildThemeDeleteBtn, renderThemeCards, refreshThemeGrids, buildThemeModalGrid,
        closeThemeModal, openThemeModal, shouldAutoOpenThemeModal, initTheme,
        DEFAULT_THEME, THEMES,
    };
})();
