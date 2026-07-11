// Read-only pf1-style character sheet, rendered client-side from the generator's JSON.
// Standalone static build: character generation happens on the Flask backend (Render); this
// page only POSTs to it. Item details (descriptions, prerequisites, numeric changes) come
// from the slim Foundry-data extracts loaded by scripts/details.js; saved characters live in
// the SheetLibrary (scripts/library.js — IndexedDB + optional connected disk folder).
//
// Layout: a persistent header (name / class line / ability boxes) over a fixed FoundryVTT-style
// tab bar — Summary/Attributes/Combat/Inventory/Features/Skills/Path of War/Spells/Buffs/
// Biography/Notes/Settings/Spheres. Every character gets the identical 13 tabs (empty ones show
// a placeholder); ALL panes are rendered up front and toggled by CSS class, so switching tabs is
// instant and printing shows the whole sheet.

(function () {
    'use strict';

    const LEGACY_CHAR_KEY = 'sheet.characterData'; // pre-library single slot (migrated once)
    const FORM_KEY = 'sheet.formData';
    const BACKEND_KEY = 'sheet.backendUrl';
    const TAB_KEY = 'sheet.activeTab';
    const CURRENT_KEY = 'sheet.currentId';
    const THEME_KEY = 'sheet.theme';
    const THEME_SKIP_PROMPT_KEY = 'sheet.themePromptSkip'; // '1' = don't auto-open modal on load
    const DEFAULT_BACKEND = 'https://pathfinder-char-creator-web-public-use.onrender.com';

    // Themes map to html[data-theme] tokens in styles/sheet.css (OKF color-theory roles).
    // "system" resolves to parchment (light) or dusk (dark) from prefers-color-scheme.
    const THEMES = [
        { id: 'system', label: 'System', desc: 'Follow OS light/dark (parchment or dusk)', swatches: null },
        { id: 'parchment', label: 'Parchment', desc: 'Classic PF maroon on warm paper', swatches: ['#f3ead7', '#7a1f1f', '#2b2115'] },
        { id: 'foundry-classic', label: 'Foundry Classic', desc: 'PF1 VTT rust/beige look', swatches: ['#c9c7b8', '#782e22', '#191813'] },
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
    ];
    const THEME_IDS = new Set(THEMES.map((t) => t.id));

    // Generation backend base URL: default the hosted server, overridable via the Settings tab
    // or ?backend=http://127.0.0.1:5001 (persisted) — ?backend=default clears the override.
    function backendUrl() {
        return localStorage.getItem(BACKEND_KEY) || DEFAULT_BACKEND;
    }

    function themePreference() {
        const v = localStorage.getItem(THEME_KEY) || 'system';
        return THEME_IDS.has(v) ? v : 'system';
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

    function syncThemeControls(pref) {
        const choice = THEME_IDS.has(pref) ? pref : 'system';
        document.querySelectorAll('input[name="sheet-theme"]').forEach((r) => {
            r.checked = r.value === choice;
        });
        document.querySelectorAll('.theme-modal-pick').forEach((btn) => {
            const on = btn.dataset.themeId === choice;
            btn.classList.toggle('is-selected', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    }

    function applyTheme(pref) {
        const choice = THEME_IDS.has(pref) ? pref : 'system';
        const resolved = resolveTheme(choice);
        document.documentElement.setAttribute('data-theme', resolved);
        document.documentElement.dataset.themePref = choice;
        try { localStorage.setItem(THEME_KEY, choice); } catch { /* private mode */ }
        syncThemeControls(choice);
        return resolved;
    }

    function buildThemeModalGrid() {
        const grid = document.getElementById('theme-modal-grid');
        if (!grid || grid.dataset.built === '1') return;
        grid.dataset.built = '1';
        const pref = themePreference();
        for (const theme of THEMES) {
            const btn = h('button', 'theme-modal-pick' + (theme.id === pref ? ' is-selected' : ''));
            btn.type = 'button';
            btn.dataset.themeId = theme.id;
            btn.setAttribute('role', 'option');
            btn.setAttribute('aria-selected', theme.id === pref ? 'true' : 'false');
            if (theme.swatches) {
                const sw = h('div', 'theme-modal-swatches');
                sw.setAttribute('aria-hidden', 'true');
                for (const hex of theme.swatches) {
                    const chip = h('span');
                    chip.style.background = hex;
                    sw.appendChild(chip);
                }
                btn.appendChild(sw);
            } else {
                const sw = h('div', 'theme-modal-swatches');
                sw.setAttribute('aria-hidden', 'true');
                for (const hex of ['#eef0f3', '#3d4f66', '#121212']) {
                    const chip = h('span');
                    chip.style.background = hex;
                    sw.appendChild(chip);
                }
                btn.appendChild(sw);
            }
            btn.appendChild(h('span', 'theme-modal-pick-label', theme.label));
            btn.appendChild(h('span', 'theme-modal-pick-desc', theme.desc));
            btn.addEventListener('click', () => applyTheme(theme.id));
            grid.appendChild(btn);
        }
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

    function isBuffSourceActive(data, source, sourceKind) {
        return !disabledBuffSet(data).has(buffSourceKey(source, sourceKind));
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

    /** Full ledger with inactive sources' changes stripped (notes/conditionals kept for UI). */
    function effectiveLedger(data) {
        const SD = window.SheetDetails;
        const full = SD ? SD.collectChanges(data) : (window.sheetChangesFull || window.sheetChanges
            || { changes: [], notes: [], conditionals: [] });
        const disabled = disabledBuffSet(data);
        if (!disabled.size) return full;
        return {
            changes: (full.changes || []).filter((c) =>
                !disabled.has(buffSourceKey(c.source, c.sourceKind))),
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
                    kind: 'ledger', type: c.type || '', info: !!opts.infoOnly,
                }));
            } else {
                parts.push(part(label, 0, {
                    kind: 'ledger', type: c.type || '', unresolved: true,
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

        const level = Number(data.level) || 0;
        const bab = Number(data.bab_total) || 0;
        const strM = mod(data.str), dexM = mod(data.dex), conM = mod(data.con);
        const wisM = mod(data.wis), intM = mod(data.int), chaM = mod(data.cha);
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

        const touchParts = [part('Base', 10)];
        touchParts.push(part(
            dexCapped ? `Dex (capped by armor max ${maxDex})` : 'Dex',
            effDex, { kind: 'ability' }));
        appendLedgerParts(touchParts, data, ledger, ['ac', 'tac', 'nac'], { touchOnly: true });

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
            return { total: sumParts(parts), parts };
        }
        const fort = saveBlock('fort', 'Constitution', conM);
        const ref = saveBlock('ref', 'Dexterity', dexM);
        const will = saveBlock('will', 'Wisdom', wisM);

        // ---- Init / attacks / CMB / CMD ----
        const initParts = [part('Dexterity', dexM, { kind: 'ability' })];
        appendLedgerParts(initParts, data, ledger, ['init']);

        const meleeParts = [
            part('BAB', bab, { kind: 'base' }),
            part('Strength', strM, { kind: 'ability' }),
        ];
        appendLedgerParts(meleeParts, data, ledger, ['attack', 'mattack']);

        const rangedParts = [
            part('BAB', bab, { kind: 'base' }),
            part('Dexterity', dexM, { kind: 'ability' }),
        ];
        appendLedgerParts(rangedParts, data, ledger, ['attack', 'rattack']);

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

        const cmdParts = [
            part('Base', 10),
            part('BAB', bab, { kind: 'base' }),
            part('Strength', strM, { kind: 'ability' }),
            part('Dexterity', dexM, { kind: 'ability' }),
        ];
        appendLedgerParts(cmdParts, data, ledger, ['cmd']);

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

        const ac = { total: sumParts(acParts), parts: acParts };
        const touch = { total: sumParts(touchParts), parts: touchParts };
        const flat = { total: sumParts(flatParts), parts: flatParts };
        const init = { total: sumParts(initParts), parts: initParts };
        const melee = { total: sumParts(meleeParts), parts: meleeParts };
        const ranged = { total: sumParts(rangedParts), parts: rangedParts };
        const cmb = { total: sumParts(cmbParts), parts: cmbParts };
        const cmd = { total: sumParts(cmdParts), parts: cmdParts };

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
            blocks: { ac, touch, flat, fort, ref, will, init, melee, ranged, damage, cmb, cmd, hp },
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
        return mod(data[key]);
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

    function addSessionBuffFromEntry(data, name, entry) {
        const st = sheetState(data);
        st.tempBuffs ??= [];
        const changes = cloneChanges(entry?.changes);
        if (!changes.length) {
            changes.push({ formula: '1', target: 'ac', type: 'untyped', operator: 'add', priority: 0 });
        }
        st.tempBuffs.push({
            id: 'temp-' + Date.now(),
            name: name || entry?.name || 'Buff',
            active: true,
            changes,
        });
        quietSave();
    }

    function renderTempBuffsEditor(body, data) {
        const st = sheetState(data);
        st.tempBuffs ??= [];
        body.appendChild(h('h3', null, 'Session buffs'));
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Browse feats/items with mechanical changes, or add a custom formula buff.'));
        body.appendChild(sectionCatalogToolbar({
            browseLabel: 'Browse buff sources',
            picker: {
                title: 'Add buff from catalog',
                kinds: ['feats', 'items'],
                allowCustom: true,
                customPlaceholder: 'Custom buff name (then set formula below)',
                onPick: (hit) => {
                    addSessionBuffFromEntry(data, hit.name, hit.entry);
                    renderSheet(data);
                    setActiveTab('buffs');
                },
                onCustom: (name) => {
                    addSessionBuffFromEntry(data, name, null);
                    renderSheet(data);
                    setActiveTab('buffs');
                },
            },
        }));
        const list = h('div', 'temp-buff-list dnd-list');
        st.tempBuffs.forEach((b, idx) => {
            const row = h('div', 'buff-toggle-row dnd-item' + (b.active === false ? ' buff-off' : ''));
            row.dataset.dndId = b.id || String(idx);
            row.prepend(dndHandle());
            const lab = h('label', 'buff-toggle-label');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = b.active !== false;
            cb.addEventListener('change', () => {
                b.active = cb.checked;
                quietSave();
                renderSheet(data);
                setActiveTab('buffs');
            });
            lab.append(cb, h('span', 'buff-source-name', b.name || 'Buff'));
            row.appendChild(lab);
            const bits = (b.changes || []).map((c) => formatChangeLine(c, window.SheetDetails)).join('; ');
            row.appendChild(h('div', 'buff-source-effects', bits || '—'));
            const rm = h('button', 'inv-btn inv-btn-danger', '×');
            rm.type = 'button';
            rm.addEventListener('click', () => {
                const i = st.tempBuffs.indexOf(b);
                if (i >= 0) st.tempBuffs.splice(i, 1);
                quietSave();
                renderSheet(data);
                setActiveTab('buffs');
            });
            row.appendChild(rm);
            list.appendChild(row);
        });
        body.appendChild(list);
        bindDragReorder(list, '.buff-toggle-row', (from, to) => {
            reorderArray(st.tempBuffs, from, to);
            quietSave();
            renderSheet(data);
            setActiveTab('buffs');
        });
        const form = h('div', 'temp-buff-add no-print');
        const nameIn = h('input', 'edit-field');
        nameIn.placeholder = 'Buff name';
        const formulaIn = h('input', 'edit-field');
        formulaIn.placeholder = 'Formula (e.g. 2)';
        const targetSel = h('select', 'edit-field');
        for (const t of INV_TARGET_OPTIONS) {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = window.SheetDetails?.targetLabel?.(t) || t;
            targetSel.appendChild(opt);
        }
        targetSel.value = 'ac';
        const addBtn = h('button', 'inv-btn inv-btn-primary', 'Add session buff');
        addBtn.type = 'button';
        addBtn.addEventListener('click', () => {
            const name = String(nameIn.value || '').trim() || 'Session buff';
            let formula = String(formulaIn.value || '').trim();
            if (!formula) { formulaIn.focus(); return; }
            if (/^\+\d+$/.test(formula)) formula = formula.slice(1);
            st.tempBuffs.push({
                id: 'temp-' + Date.now(),
                name,
                active: true,
                changes: [{
                    formula, target: targetSel.value, type: 'untyped',
                    operator: 'add', priority: 0,
                }],
            });
            quietSave();
            renderSheet(data);
            setActiveTab('buffs');
        });
        form.append(nameIn, formulaIn, targetSel, addBtn);
        body.appendChild(form);
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
            const modEl = h('div', 'ab-mod', data[ab] != null ? fmt(mod(data[ab])) : '—');
            const scoreInput = editableField(data, ab, {
                type: 'number',
                min: 1,
                max: 99,
                live: (v) => {
                    modEl.textContent = v != null && Number.isFinite(Number(v)) ? fmt(mod(v)) : '—';
                },
                onChange: () => {
                    modEl.textContent = data[ab] != null ? fmt(mod(data[ab])) : '—';
                },
            });
            scoreInput.className = 'edit-field ab-score-input';
            box.appendChild(scoreInput);
            box.appendChild(modEl);
            wrap.appendChild(box);
        }
        return wrap;
    }

    // Aggregated pf1 changes/notes/conditionals ledger — the data layer future dice rolling
    // will consume. Also exposed as window.sheetChanges.
    function renderModifiers(data) {
        const SD = window.SheetDetails;
        const { sec, body } = section('Buffs & modifiers', 'modifiers');
        // Conditions always available (session trackers)
        renderConditionsTray(body, data);
        renderTempBuffsEditor(body, data);

        if (!SD) {
            body.appendChild(h('p', 'tools-empty', 'Item details not loaded yet.'));
            return sec;
        }
        const ledger = SD.collectChanges(data);
        window.sheetChangesFull = ledger;
        window.sheetChanges = effectiveLedger(data);
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Toggle each buff on/off. Off buffs are ignored in AC, saves, HP, skills, and attack math. Combat conditionals stay separate.'));

        if (!ledger.changes.length && !ledger.notes.length && !ledger.conditionals.length) {
            body.appendChild(h('p', 'tools-empty', 'No always-on or per-roll modifiers on this character.'));
            return sec;
        }

        if (ledger.changes.length) {
            body.appendChild(h('h3', null, 'Always-on sources (toggle each)'));
            const list = h('div', 'buff-toggle-list no-print');
            const groups = groupChangesBySource(ledger.changes);
            for (const g of groups) {
                const active = isBuffSourceActive(data, g.source, g.sourceKind);
                const row = h('div', 'buff-toggle-row' + (active ? '' : ' buff-off'));
                const lab = h('label', 'buff-toggle-label');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'buff-source-check';
                cb.checked = active;
                cb.title = active ? 'Applied to sheet math' : 'Not applied';
                cb.addEventListener('change', () => {
                    setBuffSourceActive(data, g.source, g.sourceKind, cb.checked);
                });
                const kind = g.sourceKind ? ` [${g.sourceKind}]` : '';
                lab.append(cb, h('span', 'buff-source-name', (g.source || '?') + kind));
                row.appendChild(lab);
                const bits = g.lines.map((c) => {
                    const t = SD.typeLabel(c.type);
                    const num = /^-?\d+$/.test(String(c.formula).trim())
                        ? fmt(Number(c.formula)) : String(c.formula);
                    return `${num}${t ? ' ' + t : ''} → ${SD.targetLabel(c.target)}`;
                }).join('; ');
                row.appendChild(h('div', 'buff-source-effects', bits));
                list.appendChild(row);
            }
            body.appendChild(list);

            // Print-friendly by-target summary (active only)
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
        }
        if (ledger.notes.length) {
            body.appendChild(h('h3', null, 'Situational'));
            for (const n of ledger.notes) {
                const line = h('div', 'mod-note');
                line.innerHTML = highlightInlineRolls(n.text) + ' — ' + escapeHtml(n.source);
                body.appendChild(line);
            }
        }
        if (ledger.conditionals.length) {
            body.appendChild(h('h3', null, 'Per-Roll Toggles & Riders'));
            body.appendChild(h('p', 'dbl-edit-hint',
                'These are toggled on the Combat attack panel, not here.'));
            const ul = h('ul', 'plain-list');
            for (const c of ledger.conditionals) {
                const modTxt = (c.modifiers || []).map((m) =>
                    `${m.formula} ${m.type && m.type !== 'untyped' ? m.type + ' ' : ''}${m.subTarget || m.target || ''}`.trim()).join('; ');
                const bodyHtml = [
                    c.name ? `<p>${highlightInlineRolls(c.name)}</p>` : '',
                    modTxt ? `<p><strong>Modifiers:</strong> ${escapeHtml(modTxt)}</p>` : '',
                    c.rider ? `<p><strong>Rider:</strong> ${highlightInlineRolls(c.rider)}</p>` : '',
                ].join('');
                ul.appendChild(h('li', null, null)).appendChild(
                    bodyHtml ? details(c.source, bodyHtml, 'cond-rider') : h('span', null, c.source));
            }
            body.appendChild(ul);
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
            return obj;
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
            slot: foundry?.slot || '',
            itemType: foundry?.itemType || '',
            containerId: null,
        };
        data.equipment_list.push(item);
        if (item.description) (data.equip_descrip ??= {})[item.name] = item.description;
        quietSave();
        return item;
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
            'Search the local Foundry extracts. Pick a result, or add a custom name if it is not in the database.');
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

    function openItemBuffsEditor(data, item, host) {
        // Toggle: if editor already open under this card, close it
        const existing = host.querySelector('.inv-buffs-editor');
        if (existing) {
            existing.remove();
            return;
        }

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
        resetBtn.title = 'Restore Foundry/compendium changes for this item';
        resetBtn.addEventListener('click', () => {
            const foundry = SD?.lookupItem?.(item.name);
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
        const closeBtn = h('button', 'inv-btn', 'Close');
        closeBtn.type = 'button';
        closeBtn.addEventListener('click', () => panel.remove());
        actions.append(resetBtn, closeBtn);
        panel.appendChild(actions);

        host.appendChild(panel);
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
        ['armor', 'Armor & shields'],
        ['equipment', 'Equipment'],
        ['consumables', 'Consumables'],
        ['containers', 'Containers'],
        ['other', 'Other'],
    ];

    function renderInventoryItemCard(data, item, index) {
        const SD = window.SheetDetails;
        const card = h('div', 'inv-item dnd-item'
            + (item.equipped ? ' is-equipped' : ' is-unequipped')
            + (item.carried === false ? ' is-stowed' : '')
            + (item.identified === false ? ' is-unidentified' : ''));
        card.dataset.invId = item.id || String(index);
        card.dataset.dndId = item.id || String(index);

        // Foundry-ish: handle · qty · name · weight · value · ID · carried · eq · buffs · actions
        const row = h('div', 'inv-item-row inv-item-row-ext');
        row.appendChild(dndHandle());

        const qtyCell = h('span', 'inv-qty');
        if (item.quantity == null) item.quantity = 1;
        qtyCell.appendChild(dblclickEditable(item, 'quantity', {
            type: 'number', min: 1, max: 999,
            format: (v) => '×' + (v == null || v === '' ? 1 : v),
            parse: (s) => Math.max(1, parseIntLoose(s, 1)),
            onChange: () => quietSave(),
        }));
        row.appendChild(qtyCell);

        const nameCell = h('div', 'inv-item-name-cell');
        const descHtml = item.description || data.equip_descrip?.[item.name] || '';
        const nameEl = h('span', 'inv-item-name');
        nameEl.appendChild(dblclickEditable(item, 'name', {
            format: () => (item.identified === false ? 'Unidentified item' : (item.name || '—')),
            parse: (s) => s.trim() || item.name,
            onChange: (v) => {
                if (descHtml && data.equip_descrip) {
                    data.equip_descrip[v] = descHtml;
                }
                quietSave();
            },
        }));
        nameCell.appendChild(nameEl);
        if (item.identified !== false && descHtml) {
            nameCell.appendChild(details('Description', descHtml, 'inv-item-details'));
        } else if (item.identified === false) {
            nameCell.appendChild(h('span', 'dim inv-unid-hint', ' (unidentified)'));
        }
        row.appendChild(nameCell);

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

        const idBtn = h('button', 'inv-btn' + (item.identified !== false ? '' : ' inv-btn-primary'),
            item.identified !== false ? 'ID' : 'UnID');
        idBtn.type = 'button';
        idBtn.title = 'Toggle identified (Foundry: known vs mystery item)';
        idBtn.addEventListener('click', () => {
            item.identified = item.identified === false;
            quietSave();
            renderSheet(data);
            setActiveTab('inventory');
        });
        row.appendChild(idBtn);

        const carryBtn = h('button', 'inv-btn' + (item.carried !== false ? '' : ' inv-btn-primary'),
            item.carried !== false ? 'Carried' : 'Stowed');
        carryBtn.type = 'button';
        carryBtn.title = 'Toggle carried (stowed items do not count for encumbrance)';
        carryBtn.addEventListener('click', () => {
            item.carried = item.carried === false;
            quietSave();
            renderSheet(data);
            setActiveTab('inventory');
        });
        row.appendChild(carryBtn);

        row.appendChild(h('span',
            'inv-equip-badge' + (item.equipped ? ' on' : ''),
            item.equipped ? 'Eq' : 'Off'));

        const buffBits = (item.changes || []).map((c) => formatChangeLine(c, SD));
        const buffPrev = h('span', 'inv-item-buffs-preview',
            buffBits.length ? buffBits.join('; ') : '');
        buffPrev.title = buffBits.join('; ') || 'No mechanical buffs';
        row.appendChild(buffPrev);

        const btns = h('div', 'inv-item-actions no-print');
        const equipBtn = h('button', 'inv-btn' + (item.equipped ? '' : ' inv-btn-primary'),
            item.equipped ? 'Unequip' : 'Equip');
        equipBtn.type = 'button';
        equipBtn.addEventListener('click', () => {
            item.equipped = !item.equipped;
            quietSave();
            renderSheet(data);
            setActiveTab('inventory');
        });
        const buffsBtn = h('button', 'inv-btn', 'Buffs');
        buffsBtn.type = 'button';
        buffsBtn.addEventListener('click', () => openItemBuffsEditor(data, item, card));
        const removeBtn = h('button', 'inv-btn inv-btn-danger', '×');
        removeBtn.type = 'button';
        removeBtn.addEventListener('click', () => {
            if (!confirm(`Remove “${item.name}” from inventory?`)) return;
            const list = data.equipment_list || [];
            const idx = list.indexOf(item);
            if (idx >= 0) list.splice(idx, 1);
            else if (index >= 0 && index < list.length) list.splice(index, 1);
            quietSave();
            renderSheet(data);
            setActiveTab('inventory');
        });
        btns.append(equipBtn, buffsBtn, removeBtn);
        row.appendChild(btns);
        card.appendChild(row);
        return card;
    }

    function renderGear(data) {
        const { sec, body } = section('Gear & Wealth', 'inventory-tab');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Add items (bottom of list). Drag ⋮⋮ to reorder. Set qty, carried vs equipped. Equip applies buffs.'));

        const filterIn = h('input', 'edit-field inv-filter');
        filterIn.type = 'search';
        filterIn.placeholder = 'Filter owned items…';
        filterIn.addEventListener('input', () => {
            const q = filterIn.value.toLowerCase().trim();
            body.querySelectorAll('.inv-item').forEach((el) => {
                const n = (el.querySelector('.inv-item-name .dbl-edit-display')?.textContent
                    || el.textContent || '').toLowerCase();
                el.style.display = !q || n.includes(q) ? '' : 'none';
            });
        });
        body.appendChild(sectionCatalogToolbar({
            browseLabel: 'Browse items',
            browseTitle: 'Search weapons & equipment',
            extra: filterIn,
            picker: {
                title: 'Add inventory item',
                kinds: ['items', 'weapons'],
                allowCustom: true,
                customPlaceholder: 'Custom item name',
                onPick: (hit) => {
                    addInventoryItem(data, hit.name);
                    renderSheet(data);
                    setActiveTab('inventory');
                },
                onCustom: (name) => {
                    addInventoryItem(data, name);
                    renderSheet(data);
                    setActiveTab('inventory');
                },
            },
        }));

        // Core slots (weapon / armor / shield) — display + weight when known
        const slots = h('div', 'inv-slots');
        const SD = window.SheetDetails;
        const w = gearLine(data.weapon_name, data.weapon_enhancement_chosen_list);
        if (w) {
            const wItem = SD?.lookupItem?.(data.weapon_name) || SD?.lookupWeapon?.(data.weapon_name);
            const row = h('div', 'inv-slot-row');
            row.appendChild(h('span', 'inv-slot-label', 'Weapon'));
            row.appendChild(h('span', 'inv-slot-value', w));
            if (wItem?.weight != null) {
                row.appendChild(h('span', 'inv-weight', fmtWeight(wItem.weight)));
            }
            slots.appendChild(row);
            if (wItem?.description) {
                slots.appendChild(details('Weapon description', wItem.description, 'inv-slot-desc'));
            }
        }
        const a = gearLine(data.armor_name, data.armor_enhancement_chosen_list);
        if (a) {
            const aItem = SD?.lookupItem?.(data.armor_name);
            const bits = [
                data.armor_ac ? `+${data.armor_ac} AC` : null,
                data.armor_max_dex_bonus?.trim?.() ? `max Dex ${data.armor_max_dex_bonus}` : null,
                data.armor_armor_check_penalty?.trim?.() ? `ACP ${data.armor_armor_check_penalty}` : null,
                data.armor_spell_failure ? `ASF ${data.armor_spell_failure}%` : null,
            ].filter(Boolean).join(', ');
            const row = h('div', 'inv-slot-row');
            row.appendChild(h('span', 'inv-slot-label', 'Armor'));
            row.appendChild(h('span', 'inv-slot-value', bits ? `${a} (${bits})` : a));
            if (aItem?.weight != null) {
                row.appendChild(h('span', 'inv-weight', fmtWeight(aItem.weight)));
            }
            slots.appendChild(row);
            if (aItem?.description) {
                slots.appendChild(details('Armor description', aItem.description, 'inv-slot-desc'));
            }
        }
        const s = gearLine(data.shield_name, data.shield_enhancement_chosen_list);
        if (s) {
            const sItem = SD?.lookupItem?.(data.shield_name);
            const row = h('div', 'inv-slot-row');
            row.appendChild(h('span', 'inv-slot-label', 'Shield'));
            row.appendChild(h('span', 'inv-slot-value', s));
            if (sItem?.weight != null) {
                row.appendChild(h('span', 'inv-weight', fmtWeight(sItem.weight)));
            }
            slots.appendChild(row);
            if (sItem?.description) {
                slots.appendChild(details('Shield description', sItem.description, 'inv-slot-desc'));
            }
        }
        if (slots.childNodes.length) body.appendChild(slots);

        kvCurrency(body, data);

        const list = ensureInventoryObjects(data);
        body.appendChild(h('h3', null, 'Items'));
        body.appendChild(h('p', 'dim no-print',
            'Grouped like Foundry (weapons / armor / equipment / …). Qty · weight · value · ID · carried · equip.'));
        if (!list.length) {
            body.appendChild(h('p', 'tools-empty', 'No items in equipment list.'));
            return sec;
        }

        // Group by Foundry-style category (display only; list order preserved within groups
        // via original indices for reorder — reorder stays within each section list).
        const groups = new Map();
        list.forEach((item, i) => {
            const cat = inventoryCategory(item);
            if (!groups.has(cat)) groups.set(cat, []);
            groups.get(cat).push({ item, index: i });
        });

        let totalWeight = 0;
        for (const [cat, label] of INV_CATEGORY_ORDER) {
            const entries = groups.get(cat);
            if (!entries?.length) continue;
            const secWrap = h('div', 'inv-category');
            secWrap.appendChild(h('h4', 'inv-category-title', label + ' (' + entries.length + ')'));
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
                renderSheet(data);
                setActiveTab('inventory');
            });
            secWrap.appendChild(pack);
            body.appendChild(secWrap);
        }

        for (const name of [data.weapon_name, data.armor_name, data.shield_name]) {
            if (!name) continue;
            const ent = SD?.lookupItem?.(name);
            if (ent?.weight != null && Number.isFinite(Number(ent.weight))) {
                totalWeight += Number(ent.weight);
            }
        }
        const load = loadCategory(totalWeight, data.str);
        const foot = h('div', 'inv-footer');
        foot.appendChild(h('span', load.cls,
            `Load: ${fmtWeight(totalWeight)} — ${load.label} `
            + `(light ${load.lim.light} / med ${load.lim.medium} / heavy ${load.lim.heavy})`));
        const eqCount = list.filter((it) => it.equipped).length;
        const carried = list.filter((it) => it.carried !== false).length;
        const valueSum = list.reduce((sum, it) => {
            const p = Number(it.price);
            if (!Number.isFinite(p)) return sum;
            return sum + p * (Number(it.quantity) || 1);
        }, 0);
        foot.appendChild(h('span', 'dim',
            `${eqCount} equipped · ${carried} carried · ${list.length} total`
            + (valueSum ? ` · ~${fmtPrice(valueSum)}` : '')));
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

    function skillMiscBonus(data, skill) {
        const SD = window.SheetDetails;
        const ab = getSkillAbility(data, skill);
        // Use effective ledger so per-buff toggles apply
        const ledger = effectiveLedger(data);
        // ACP applies when skill is Str/Dex based (Foundry-style) or originally marked acp
        const acpApplies = skill.acp || ab === 'str' || ab === 'dex';
        if (!ledger?.changes?.length && !acpApplies) return { total: 0, bits: [] };
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
            'Double-click ranks to edit. Change ability via the Abl dropdown (Foundry-style). Roll = 1d20 + ranks + ability + misc.'));

        const unlockSkill = (data.skill_unlock?.base_skill || '').toLowerCase();
        const table = h('table', 'skills-table skills-table-full');
        const hd = h('tr');
        ['', 'Skill', 'Abl', 'Ranks', 'Mod', 'Misc', 'Total'].forEach((t) => hd.appendChild(h('th', null, t)));
        table.appendChild(hd);

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
            const abMod = mod(data[ab]);
            const skillEff = { ...skill, ab };
            const misc = skillMiscBonus(data, skillEff);
            const total = ranks + abMod + misc.total;
            const tr = h('tr', displayName.toLowerCase().includes(unlockSkill) && unlockSkill
                ? 'unlocked' : null);

            const rollTd = h('td', 'skill-roll-cell no-print');
            rollTd.appendChild(rollBtn(displayName + ' check', total, `1d20${fmt(total)}`));
            tr.appendChild(rollTd);
            tr.appendChild(h('td', null,
                displayName + (unlockSkill && displayName.toLowerCase().includes(unlockSkill) ? ' ★' : '')));

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
            tr.appendChild(h('td', 'num', misc.total ? fmt(misc.total) : '—'));
            tr.appendChild(h('td', 'num skill-total', fmt(total)));
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
            ['', 'Profession', 'Abl', 'Ranks', 'Mod', 'Misc', 'Total'].forEach((t) => phd.appendChild(h('th', null, t)));
            t2.appendChild(phd);
            data.profession_ranks.forEach((p, idx) => {
                const label = p.skill_label || p.name || 'Profession';
                const ranks = Number(p.ranks) || 0;
                const abMod = mod(data.wis);
                const misc = skillMiscBonus(data, { ab: 'wis', id: 'pro', acp: false });
                const total = ranks + abMod + misc.total;
                const tr = h('tr');
                const rollTd = h('td', 'skill-roll-cell no-print');
                rollTd.appendChild(rollBtn(label + ' check', total));
                tr.appendChild(rollTd);
                tr.appendChild(h('td', null, label));
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
                tr.appendChild(h('td', 'num', misc.total ? fmt(misc.total) : '—'));
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
     * Feat row title — Foundry-like: feat name primary; optional generator label as quiet tag.
     * (Old “(Feat 1) / (Feat 3)” step numbering was confusing when reordering.)
     */
    function foundryFeatTitle(name, index, group) {
        const disp = featDisplayName(name);
        const tax = group.taxChain || [];
        const taxSuffix = tax.length
            ? ' › ' + tax.map((t) => featDisplayName(t)).join(' › ')
            : '';
        const labels = group.labels || null;
        if (labels?.[index] != null && String(labels[index]).trim()) {
            let lab = String(labels[index]).trim().replace(/^\(|\)$/g, '');
            // Avoid "Power Attack: Power Attack"
            if (lab.toLowerCase().includes(String(name).toLowerCase().split(' (')[0])) {
                return lab + taxSuffix;
            }
            return disp + taxSuffix;
        }
        return disp + taxSuffix;
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

    function featItem(name, descSource, titleText, taxChain, data, opts = {}) {
        const html = featDescriptionHtml(name, descSource, taxChain);
        const li = h('li', 'feat-item dnd-item' + (taxChain?.length ? ' has-feat-tax' : ''));
        li.dataset.featName = String(name).toLowerCase();
        li.dataset.dndId = String(name);
        const tags = featTags(name);
        const head = h('div', 'feat-item-head');
        head.prepend(dndHandle());
        const titleEl = html
            ? details(titleText, html, 'feat-details')
            : h('span', 'feat-title', titleText);
        head.appendChild(titleEl);
        if (tags.length) {
            const chipRow = h('span', 'feat-tags');
            for (const t of tags) chipRow.appendChild(h('span', 'feat-tag', t));
            head.appendChild(chipRow);
        }
        if (data) head.appendChild(renderUsesControls(data, name));
        if (opts.onRemove) {
            const rm = h('button', 'inv-btn inv-btn-danger feat-remove no-print', '×');
            rm.type = 'button';
            rm.title = 'Remove from character';
            rm.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!confirm(`Remove “${name}”?`)) return;
                opts.onRemove(name);
            });
            head.appendChild(rm);
        }
        li.appendChild(head);
        return li;
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

    function bindFeatureSearch(body) {
        if (body.querySelector('.feature-search')) return;
        const box = h('input', 'edit-field feature-search no-print');
        box.type = 'search';
        box.placeholder = 'Search features…';
        box.addEventListener('input', () => {
            const q = box.value.toLowerCase().trim();
            body.querySelectorAll('.feat-item').forEach((el) => {
                const t = (el.dataset.featName || el.textContent || '').toLowerCase();
                el.style.display = !q || t.includes(q) ? '' : 'none';
            });
        });
        const hint = body.querySelector('.dbl-edit-hint');
        if (hint) hint.after(box);
        else body.prepend(box);
    }

    function renderFeats(data) {
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
            'Add feats to the bottom of the list. Drag ⋮⋮ to reorder (Foundry-style). Set uses with max / −.'));
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
            return sec;
        }
        // One list per source array so drag-reorder maps cleanly (like Foundry sections)
        for (const g of groups) {
            body.appendChild(h('h3', null, pluralizeFeatSection(g.title)));
            const ul = h('ul', 'plain-list feat-list dnd-list');
            body.appendChild(ul);
            const descSource = g.listKey === 'profession_feats'
                ? { ...descs, ...(data.profession_feat_desc || {}) } : descs;
            const listKey = g.listKey;
            const list = data[listKey] || [];
            list.forEach((f, i) => {
                const tax = featTaxChain(f, g.taxDict);
                const gWithTax = { ...g, taxChain: tax };
                ul.appendChild(featItem(f, descSource, foundryFeatTitle(f, i, gWithTax), tax, data, {
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
        bindFeatureSearch(body);
        return sec;
    }

    function pluralizeFeatSection(title) {
        if (title === 'Martial Training') return 'Martial Training';
        if (title.endsWith('s')) return title;
        if (title.endsWith('Feat')) return title + 's';
        return title + 's';
    }

    function renderTraits(data) {
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
        let any = false;
        for (const [title, list, fieldKey] of groups) {
            if (!nonEmpty(list)) continue;
            any = true;
            body.appendChild(h('h3', null, title));
            const ul = h('ul', 'plain-list feat-list dnd-list');
            list.forEach((t) => {
                const desc = foundry('traits', t)?.description
                    || foundry('feats', t)?.description || backendDesc[t];
                const li = h('li', 'feat-item dnd-item');
                li.dataset.featName = String(t).toLowerCase();
                li.dataset.dndId = String(t);
                const head = h('div', 'feat-item-head');
                head.appendChild(dndHandle());
                head.appendChild(desc ? details(t, desc) : h('span', null, t));
                const rm = h('button', 'inv-btn inv-btn-danger feat-remove no-print', '×');
                rm.type = 'button';
                rm.addEventListener('click', () => {
                    if (!confirm(`Remove “${t}”?`)) return;
                    removeFromArrayField(data, fieldKey, t);
                    renderSheet(data);
                    setActiveTab('features');
                });
                head.appendChild(rm);
                li.appendChild(head);
                ul.appendChild(li);
            });
            body.appendChild(ul);
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
        const list = data.class_ability;
        const classes = [data.c_class, data.c_class_2];
        const items = [];
        if (nonEmpty(list)) {
            for (const entry of list) {
                // entries look like "arcane school_wizard" -> name + owning class
                const cut = String(entry).lastIndexOf('_');
                const name = cut > 0 ? entry.slice(0, cut) : entry;
                const desc = window.SheetDetails?.lookupClassFeature(name, classes)?.description
                    || data.class_ability_desc?.[name] || data.class_features?.[name]?.description;
                items.push([titleCase(name), desc]);
            }
        }
        for (const pa of data.profession_ability_items || []) items.push([pa.name, pa.description]);
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
        const ul = h('ul', 'plain-list feature-list dnd-list');
        // Map display name back to raw class_ability entry for delete
        const rawList = data.class_ability || [];
        // Build order: class_ability first, then profession abilities as non-reorder with class list
        for (const [name, desc] of items) {
            const li = h('li', 'feat-item dnd-item');
            li.dataset.featName = String(name).toLowerCase();
            li.dataset.dndId = String(name);
            const head = h('div', 'feat-item-head');
            head.appendChild(dndHandle());
            head.appendChild(desc ? details(name, desc) : h('span', null, name));
            head.appendChild(renderUsesControls(data, name));
            const rm = h('button', 'inv-btn inv-btn-danger feat-remove no-print', '×');
            rm.type = 'button';
            rm.addEventListener('click', () => {
                if (!confirm(`Remove “${name}”?`)) return;
                const idx = rawList.findIndex((raw) => {
                    const cut = String(raw).lastIndexOf('_');
                    const n = cut > 0 ? String(raw).slice(0, cut) : String(raw);
                    return titleCase(n) === name || n.toLowerCase() === name.toLowerCase();
                });
                if (idx >= 0) {
                    rawList.splice(idx, 1);
                    quietSave();
                    renderSheet(data);
                    setActiveTab('features');
                }
            });
            head.appendChild(rm);
            li.appendChild(head);
            ul.appendChild(li);
        }
        body.appendChild(ul);
        // Reorder only class_ability entries (profession items sit at end; skip if mixed)
        if (nonEmpty(rawList) && rawList.length === items.length) {
            bindDragReorder(ul, '.feat-item', (from, to) => {
                reorderArray(data.class_ability, from, to);
                quietSave();
                renderSheet(data);
                setActiveTab('features');
            });
        }
        bindFeatureSearch(body);
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
        const desc = sd?.description || '<p class="dim">No description on file.</p>';
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
            'Browse spells to add to a level. Cast rolls attack/damage/DC (Foundry-style) and spends a slot. Minimize a level with −.'));

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
            `  mod ${fmt(mod(data[pracKey]))} (used for @INITMOD / maneuver riders)`));
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
        kvDbl(body, 'Languages (extra)', data, 'language_text', {
            asArray: true,
            format: (v) => {
                const list = Array.isArray(v) ? v : (v ? [String(v)] : []);
                return list.length ? list.join(', ') : '—';
            },
        });
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
        srBox.appendChild(h('div', 'summary-stat-head', 'SR'));
        srBox.appendChild(dblclickEditable(st, 'sr', {
            type: 'number', min: 0,
            format: (v) => String(v == null || v === '' ? 0 : v),
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
            const abMod = mod(data[ab]);
            const misc = skillMiscBonus(data, { ...skill, ab });
            rollCheck('Perception check', ranks + abMod + misc.total);
        });
        mk('Rest', () => {
            if (!confirm('Rest and restore daily resources (spell casts, feature uses, sphere SP)?')) return;
            doRest(data);
        }, 'Restore daily casts / uses / spell points');
        mk('Tools', () => window.SheetRoll?.setOpen?.(true));
        body.appendChild(bar);
    }

    function tabSummary(data) {
        const d = computeDerived(data);
        const { sec, body } = section('Overview', 'summary-overview');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Play dashboard: HP, defenses, combat strip, speeds, quick actions. Double-click values to edit.'));

        summaryQuickActions(body, data, d);
        kvHp(body, data, d);
        kvAc(body, d);
        summaryCombatStrip(body, data, d);
        kvSaves(body, d);
        summarySpeeds(body, data);

        kvDbl(body, 'Age', data, 'age_number', { type: 'number', min: 0 });
        kvDbl(body, 'Height', data, 'height_number');
        kvDbl(body, 'Weight (lbs)', data, 'weight_number', { type: 'number', min: 0 });
        kvDbl(body, 'Languages (extra)', data, 'language_text', {
            asArray: true,
            format: (v) => {
                const list = Array.isArray(v) ? v : (v ? [String(v)] : []);
                return list.length ? list.join(', ') : '—';
            },
        });
        kvDbl(body, 'Weapon', data, 'weapon_name');
        kvDbl(body, 'Armor', data, 'armor_name');
        kvCurrency(body, data);
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
        kvDbl(body, 'Speed (ft)', data, 'land_speed', { type: 'number', min: 0 });
        kvDbl(body, 'BAB', data, 'bab_total', {
            type: 'number', min: 0, max: 30,
            format: (v) => (v == null || v === '' ? '—' : fmt(Number(v) || 0)),
            parse: (s) => {
                const n = parseInt(String(s).replace(/^\+/, ''), 10);
                return Number.isFinite(n) ? n : 0;
            },
        });
        kvSaves(body, d);
        for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
            kvDbl(body, ab.toUpperCase(), data, ab, { type: 'number', min: 1, max: 99 });
        }
        return sec;
    }

    function tabCombat(data) {
        const d = computeDerived(data);
        const { sec, body } = section('Combat', 'combat');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Double-click a value to edit. Expand “sources” for breakdowns. Toggle individual buffs on the Buffs tab.'));

        kvHp(body, data, d);
        kvAc(body, d);
        kvInitiative(body, d);
        kvDbl(body, 'BAB', data, 'bab_total', {
            type: 'number', min: 0, max: 30,
            format: (v) => (v == null || v === '' ? '—' : fmt(Number(v) || 0)),
            parse: (s) => {
                const n = parseInt(String(s).replace(/^\+/, ''), 10);
                return Number.isFinite(n) ? n : 0;
            },
        });
        kvDbl(body, 'Land Speed (ft)', data, 'land_speed', { type: 'number', min: 0 });
        kvStat(body, 'Melee attack', d.blocks.melee, { formatTotal: fmt });
        kvStat(body, 'Ranged attack', d.blocks.ranged, { formatTotal: fmt });
        if (d.blocks.damage) {
            kvStat(body, 'Weapon damage', d.blocks.damage, {
                formatTotal: (v) => (v == null || v === '' ? '—' : String(v)),
            });
        }
        // CMB rollable
        {
            const block = d.blocks.cmb;
            const row = h('div', 'kv kv-stat');
            const k = h('span', 'k');
            k.append(document.createTextNode('CMB '), rollBtn('CMB', block.total));
            row.appendChild(k);
            const v = h('span', 'v');
            v.appendChild(h('span', 'stat-total', fmt(block.total)));
            row.appendChild(v);
            body.appendChild(row);
        }
        kvStat(body, 'CMD', d.blocks.cmd, { formatTotal: (n) => String(n) });
        kvSaves(body, d);

        kvDbl(body, 'Weapon', data, 'weapon_name');
        kvDbl(body, 'Weapon enhancements', data, 'weapon_enhancement_chosen_list', { asArray: true });
        kvDbl(body, 'Armor', data, 'armor_name');
        kvDbl(body, 'Armor AC bonus', data, 'armor_ac', { type: 'number', min: 0 });
        kvDbl(body, 'Armor max Dex', data, 'armor_max_dex_bonus');
        kvDbl(body, 'Armor check penalty', data, 'armor_armor_check_penalty');
        kvDbl(body, 'Spell failure %', data, 'armor_spell_failure', { type: 'number', min: 0 });
        kvDbl(body, 'Shield', data, 'shield_name');
        kvDbl(body, 'Shield AC', data, 'shield_ac', { type: 'number', min: 0 });
        kvCurrency(body, data);

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

    function tabNotes(data) {
        const prose = ensureProse(data);
        const { sec, body } = section('Notes');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Freeform identity & session text (Foundry-style biography/notes). Auto-saves with the character.'));

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
        const themeHint = h('p', 'dim', 'Themes use semantic color tokens (ink, paper, accent) with WCAG AA contrast targets. System follows your OS light/dark preference.');
        body.appendChild(themeHint);
        const themeGrid = h('div', 'settings-theme-grid');
        themeGrid.setAttribute('role', 'radiogroup');
        themeGrid.setAttribute('aria-label', 'Color theme');
        const pref = themePreference();
        for (const theme of THEMES) {
            const label = h('label', 'settings-theme-option');
            const radio = h('input');
            radio.type = 'radio';
            radio.name = 'sheet-theme';
            radio.value = theme.id;
            radio.checked = theme.id === pref;
            radio.addEventListener('change', () => {
                if (radio.checked) applyTheme(theme.id);
            });
            if (theme.swatches) {
                const sw = h('div', 'settings-theme-swatches');
                sw.setAttribute('aria-hidden', 'true');
                for (const hex of theme.swatches) {
                    const chip = h('span');
                    chip.style.background = hex;
                    sw.appendChild(chip);
                }
                label.appendChild(sw);
            } else {
                const sw = h('div', 'settings-theme-swatches');
                sw.setAttribute('aria-hidden', 'true');
                for (const hex of ['#eef0f3', '#3d4f66', '#121212']) {
                    const chip = h('span');
                    chip.style.background = hex;
                    sw.appendChild(chip);
                }
                label.appendChild(sw);
            }
            label.appendChild(h('span', 'settings-theme-label', theme.label));
            label.appendChild(h('span', 'settings-theme-desc', theme.desc));
            label.prepend(radio);
            themeGrid.appendChild(label);
        }
        body.appendChild(themeGrid);

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

    const TABS = [
        { id: 'summary', label: 'Summary', render: tabSummary },
        { id: 'attributes', label: 'Attributes', render: tabAttributes },
        { id: 'combat', label: 'Combat', render: tabCombat },
        { id: 'inventory', label: 'Inventory', render: (d) => renderGear(d) || emptyState('No gear.') },
        { id: 'features', label: 'Features', render: (d) => compose(renderFeats(d), renderTraits(d), renderClassFeatures(d)) },
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

    function setActiveTab(id) {
        const prev = localStorage.getItem(TAB_KEY);
        localStorage.setItem(TAB_KEY, id);
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
        document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.tab === id));
        // When opening a math-sensitive tab, re-hydrate inventory buffs from the compendium
        // and rebuild derived panes if items gained changes since last full render (e.g. details
        // loaded after first paint, or empty changes[] from an earlier migration).
        if (!currentData || currentData.error) return;
        const mathTabs = new Set(['combat', 'buffs', 'inventory', 'summary', 'attributes', 'skills']);
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
        // Theme: topbar + Settings + localStorage; ?theme=parchment|dusk|…|system applies (persisted).
        initTheme();
        const themeParam = new URLSearchParams(location.search).get('theme');
        if (themeParam && THEME_IDS.has(themeParam)) applyTheme(themeParam);

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

        const savedForm = JSON.parse(localStorage.getItem(FORM_KEY) || 'null');
        if (savedForm) {
            for (const [k, v] of Object.entries(savedForm)) {
                if (form.elements[k]) form.elements[k].value = v;
            }
        }

        const toggle = (id) => document.getElementById(id).classList.toggle('hidden');
        document.getElementById('toggle-gen').addEventListener('click', () => toggle('gen-panel'));
        document.getElementById('toggle-load').addEventListener('click', () => toggle('load-panel'));
        document.getElementById('print-btn').addEventListener('click', () => window.print());
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
