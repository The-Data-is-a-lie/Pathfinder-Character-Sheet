// scripts/tabs/psionics.js -- the Psionics tab (window.SheetTabPsionics).
//
// Shaped after path-of-war.js: the section returns null for a non-manifester and the TABS entry
// supplies the empty state, because manifesting is optional the way initiating is. The powers
// themselves borrow the spells tab's per-level block markup (.spell-level-block and friends) on
// purpose -- powers ARE levelled and the collapse behaviour is the same, so reusing the classes
// keeps the two tabs looking like one sheet and costs no CSS.
//
// "Manifester" is three shapes and all three arrive in the payload (see the backend's
// utils/class_func/psionics.py): full manifesters carry power points AND powers, the aegis carries
// points and no powers (it spends them on astral suit customizations), and the soulknife carries
// neither. The last of those is filtered out here -- an entry with no key ability has nothing to
// show -- but the aegis is NOT: dropping it would lose a real resource off the sheet.
window.SheetTabPsionics = (function () {
    'use strict';
    const { h, section, details, kv, nonEmpty, escapeHtml, fmt } = window.SheetUI;
    const { abModOf } = window.SheetDerive;
    const { sheetState, quietSave } = window.SheetState;

    const POWER_LEVEL_COLLAPSED_KEY = 'sheet.powerLevelCollapsed';

    function loadPowerLevelCollapsed() {
        try {
            const raw = localStorage.getItem(POWER_LEVEL_COLLAPSED_KEY);
            if (!raw) return {};
            const obj = JSON.parse(raw);
            return obj && typeof obj === 'object' ? obj : {};
        } catch {
            return {};
        }
    }
    function savePowerLevelCollapsed(map) {
        try {
            localStorage.setItem(POWER_LEVEL_COLLAPSED_KEY, JSON.stringify(map));
        } catch { /* private mode / quota -- collapse state is a convenience, not data */ }
    }

    /** The subsystem picks a book points at, as [name, description, level] rows. */
    function subsystemPicks(data, book) {
        const bucket = book && book.subsystem_bucket;
        if (!bucket) return [];
        const picks = (data.class_features || {})[bucket];
        if (!picks || typeof picks !== 'object') return [];
        const levels = (data.class_feature_levels || {})[bucket] || {};
        return Object.keys(picks)
            .sort((a, b) => (levels[a] ?? 99) - (levels[b] ?? 99))
            .map((name) => [name, picks[name], levels[name]]);
    }

    /** Every psionic class entry worth a block -- which is every one that has ANYTHING to show.
     *
     * Deliberately wider than "manifests power points". The soulknife has no key ability and no
     * points, so a manifesting-only filter dropped it entirely and the class generated no psionics
     * block at all; the aegis passed the filter but showed a bare points line, because its 87
     * astral-suit customizations live in the class-features dict and nothing pointed at them. Both
     * were generated correctly and rendered nowhere a player would look, so the filter -- not the
     * generator -- was the bug. `subsystem_bucket` and `mind_blade` are the payload's pointers to
     * the rest of a class's psionics; a book carrying either has something to say.
     */
    function manifestingBooks(data) {
        return (data.manifesters || []).filter((m) => m && (
            (m.manifesting_stat && (Number(m.pp_per_day) > 0 || nonEmpty(m.powers_chosen)))
            || (m.mind_blade && m.mind_blade.name)
            || nonEmpty(subsystemPicks(data, m))));
    }

    /** "blade_skills" -> "Blade Skills"; matches the features tab's fallback prettifier. */
    function bucketLabel(bucket) {
        return String(bucket).replace(/_/g, ' ').replace(/(^|\s)\w/g, (c) => c.toUpperCase());
    }

    /** Current power points per class, persisted the way the sheet persists its other trackers. */
    function powerPointState(data) {
        const st = sheetState(data);
        st.powerPoints ??= {};
        return st.powerPoints;
    }
    function currentPP(data, book) {
        const pool = powerPointState(data);
        const key = String(book.name);
        // Unset means "rested": a freshly generated manifester arrives with a full pool.
        if (pool[key] == null) pool[key] = Number(book.pp_per_day) || 0;
        return Number(pool[key]) || 0;
    }

    function powerDetailHtml(d) {
        if (!d) return '';
        if (typeof d === 'string') return d;
        const meta = [
            ['manifesting time', 'Manifesting time'], ['range', 'Range'],
            ['duration', 'Duration'], ['saving throw', 'Saving throw'],
            ['power resistance', 'Power resistance'], ['power points', 'Power points'],
            ['display', 'Display'],
        ]
            .filter(([k]) => d[k])
            .map(([k, label]) => `<p><em>${label}:</em> ${escapeHtml(String(d[k]))}</p>`)
            .join('');
        const text = d.text
            ? String(d.text).split(/\n{2,}/).map((p) => `<p>${escapeHtml(p)}</p>`).join('')
            : '';
        const augment = d.augment
            ? `<hr><p><em>Augment:</em> ${escapeHtml(String(d.augment))}</p>`
            : '';
        return meta + (text ? `<hr>${text}` : '') + augment;
    }

    /** One collapsible "Level N" block of powers, mirroring the spells tab's level blocks. */
    function powerLevelBlock(data, book, level, names, descs, collapsedMap) {
        const levelWrap = h('div', 'spell-level-block');
        levelWrap.dataset.spellLevel = String(level);
        const levelLabel = level === 0 ? 'Level 0 (talents)' : 'Level ' + level;

        const head = h('div', 'spell-level-head');
        const headMain = h('div', 'spell-level-head-main');
        headMain.appendChild(h('h3', 'spell-level-title', levelLabel));
        headMain.appendChild(h('span', 'spell-level-meta dim', `${names.length} known`));
        head.appendChild(headMain);

        const minBtn = h('button', 'spell-level-min no-print', '−');
        minBtn.type = 'button';
        minBtn.setAttribute('aria-expanded', 'true');
        minBtn.title = 'Minimize ' + levelLabel;
        minBtn.setAttribute('aria-label', minBtn.title);
        head.appendChild(minBtn);
        levelWrap.appendChild(head);

        const bodyBox = h('div', 'spell-level-body');
        const list = h('div', 'pow-maneuver-list');
        for (const name of names) {
            const d = descs[name] || {};
            const row = h('div', 'pow-maneuver-row');
            const bits = [d.discipline, name].filter(Boolean);
            const detailHtml = powerDetailHtml(d);
            if (detailHtml) {
                row.appendChild(details(bits.join(' · '), detailHtml, 'pow-maneuver-details'));
            } else {
                row.appendChild(h('span', 'pow-maneuver-name', bits.join(' · ')));
            }
            list.appendChild(row);
        }
        bodyBox.appendChild(list);
        levelWrap.appendChild(bodyBox);

        const key = `${book.name}:${level}`;
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
            const map = loadPowerLevelCollapsed();
            if (next) map[key] = true;
            else delete map[key];
            savePowerLevelCollapsed(map);
        });
        head.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            minBtn.click();
        });
        setCollapsed(!!collapsedMap[key]);
        return levelWrap;
    }

    /** A class's own subsystem picks -- blade skills, customizations, insights, terrors, decrees,
     *  strategies, the vitalist's method, the psychic warrior's path, the marksman's style.
     *
     *  These also appear on the Features tab, because they ARE class features. They are repeated
     *  here because a player reading a manifester's page should not have to know that the aegis's
     *  astral suit is filed under "class features" to find out what it does -- and for the aegis
     *  and the soulknife this is the only psionic content there is.
     */
    function appendSubsystem(data, body, book) {
        const rows = subsystemPicks(data, book);
        if (!rows.length) return;
        body.appendChild(h('h4', null, bucketLabel(book.subsystem_bucket)));
        const list = h('div', 'pow-maneuver-list');
        for (const [name, desc, level] of rows) {
            const row = h('div', 'pow-maneuver-row');
            const label = Number.isFinite(level) ? `${name} · level ${level}` : name;
            const text = typeof desc === 'string' ? desc : '';
            if (text) {
                const html = text.split(/\n{2,}/)
                    .map((p) => `<p>${escapeHtml(p)}</p>`).join('');
                row.appendChild(details(label, html, 'pow-maneuver-details'));
            } else {
                row.appendChild(h('span', 'pow-maneuver-name', label));
            }
            list.appendChild(row);
        }
        body.appendChild(list);
    }

    function renderPsionics(data) {
        const books = manifestingBooks(data);
        if (!books.length) return null;

        const { sec, body } = section('Psionics');
        const descs = data.powers_desc_dict || {};
        const collapsedMap = loadPowerLevelCollapsed();

        for (const book of books) {
            const display = book.display || book.name;
            body.appendChild(h('h3', null, display));

            const ab = String(book.manifesting_stat || '').toLowerCase();
            const manifests = !!ab && Number(book.pp_per_day) > 0;
            kv(body, 'Class level', h('span', null, String(book.level ?? book.manifester_level ?? 0)));

            // The soulknife: no key ability, no points, no powers. Its mind blade is the whole of
            // its psionics, so it gets that and its blade skills and nothing else.
            if (book.mind_blade && book.mind_blade.name) {
                const blade = book.mind_blade;
                kv(body, 'Mind blade', h('span', null, blade.name));
                if (blade.shape) kv(body, 'Shape', h('span', null, blade.shape));
                if (Number(blade.enhancement_bonus) > 0) {
                    const bonusEl = h('span', null, fmt(Number(blade.enhancement_bonus)));
                    bonusEl.appendChild(h('span', 'dim',
                        `  up to ${fmt(Number(blade.max_enhancement_bonus) || 0)} as a pure bonus,`
                        + ' the rest spent on special abilities'));
                    kv(body, 'Enhancement', bonusEl);
                }
            }

            if (!manifests) {
                appendSubsystem(data, body, book);
                continue;
            }

            kv(body, 'Manifester level', h('span', null, String(book.manifester_level ?? 0)));
            const abEl = h('span', null, ab.toUpperCase());
            abEl.appendChild(h('span', 'dim', `  mod ${fmt(abModOf(data, ab))}`));
            kv(body, 'Manifesting ability', abEl);
            if (Number(book.max_power_level) > 0 || nonEmpty(book.powers_chosen)) {
                kv(body, 'Max power level', h('span', null, String(book.max_power_level ?? 0)));
            }
            if (book.discipline) kv(body, 'Discipline', h('span', null, book.discipline));

            // Power points: an editable current pool against the backend's per-day total. The
            // aegis reaches this and stops here -- points are its whole psionic subsystem.
            const ppRow = h('div', 'kv kv-stat');
            ppRow.appendChild(h('span', 'k', 'Power points'));
            const ppV = h('span', 'v');
            const ppInput = document.createElement('input');
            ppInput.type = 'number';
            ppInput.className = 'edit-field';
            ppInput.min = '0';
            ppInput.max = String(Number(book.pp_per_day) || 0);
            ppInput.value = String(currentPP(data, book));
            ppInput.addEventListener('change', () => {
                const max = Number(book.pp_per_day) || 0;
                const next = Math.max(0, Math.min(max, Number(ppInput.value) || 0));
                ppInput.value = String(next);
                powerPointState(data)[String(book.name)] = next;
                quietSave();
            });
            ppV.appendChild(ppInput);
            ppV.appendChild(h('span', 'dim', `  / ${Number(book.pp_per_day) || 0} per day`));
            const rest = h('button', 'inv-btn no-print', 'Rest');
            rest.type = 'button';
            rest.title = 'Restore the pool to full';
            rest.addEventListener('click', () => {
                const max = Number(book.pp_per_day) || 0;
                powerPointState(data)[String(book.name)] = max;
                ppInput.value = String(max);
                quietSave();
            });
            ppV.appendChild(rest);
            ppRow.appendChild(ppV);
            body.appendChild(ppRow);

            const buckets = book.powers_by_level || [];
            if (!nonEmpty(book.powers_chosen)) {
                body.appendChild(h('p', 'dim',
                    'Knows no powers — its power points fuel class features instead.'));
                appendSubsystem(data, body, book);
                continue;
            }
            // Talents are granted free by class feature and do NOT count against powers known, so
            // the two are counted separately -- a single total would misreport the class table.
            const talents = Number(book.talents_known) || 0;
            const knownEl = h('span', null, String(book.powers_chosen.length - talents));
            if (talents) knownEl.appendChild(h('span', 'dim', `  + ${talents} free talents`));
            kv(body, 'Powers known', knownEl);
            const wrap = h('div');
            buckets.forEach((names, level) => {
                if (!nonEmpty(names)) return;
                wrap.appendChild(powerLevelBlock(data, book, level, names, descs, collapsedMap));
            });
            body.appendChild(wrap);
            appendSubsystem(data, body, book);
        }
        return sec;
    }

    return { renderPsionics };
})();
