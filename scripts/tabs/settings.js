// scripts/tabs/settings.js -- the Settings tab (window.SheetTabSettings). Extracted from
// sheet.js (Part B split); body moved verbatim except BACKEND_KEY (read from SheetApp). Theme
// controls come from SheetTheme, refreshRoster from SheetRoster; the shell view-state getters/
// setters (audience/viewMode/explainMode/density) + backendUrl late-bind via SheetApp.
window.SheetTabSettings = (function () {
    'use strict';
    const { h, section, titleCase } = window.SheetUI;
    const { buildCustomThemeControls, renderThemeCards, themePreference } = window.SheetTheme;
    const { refreshRoster } = window.SheetRoster;
    const {
        audience, setAudience, viewMode, setViewMode, explainMode, setExplainMode,
        densityCompact, setDensityCompact, openStartHere, openInstructions,
    } = window.SheetShellUI;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const backendUrl = () => window.SheetApp.backendUrl();

    // #21: per-CHARACTER opt-in variant rules — stored on _sheet.variantRules so the house
    // rules travel with the character's one-JSON export, unlike the per-browser rows above.
    const VARIANT_RULES = [
        ['fractionalBases', 'Fractional base bonuses',
            'Multiclass BAB and saves accumulate fractionally from the class chassis instead of stacking floored integers.'],
        ['backgroundSkills', 'Background skills',
            'Adds a separate 2 ranks/level budget for background skills (Craft, Profession, Lore, …) plus the Artistry and Lore skills.'],
        ['woundsVigor', 'Wounds & vigor',
            'Replaces HP with vigor (hit dice) and wounds (2 × Con score); damage drains vigor first.'],
        ['abp', 'Automatic bonus progression',
            'Grants the Unchained attunement bonuses by level as always-on modifiers; per ABP, remove enhancement bonuses from gear.'],
    ];
    const ABP_PICKS = [
        ['mental1', 'Mental prowess', ['int', 'wis', 'cha'], 6],
        ['physical1', 'Physical prowess', ['str', 'dex', 'con'], 7],
        ['mental2', '2nd mental', ['int', 'wis', 'cha'], 13],
        ['physical2', '2nd physical', ['str', 'dex', 'con'], 13],
        ['mental3', '3rd mental', ['int', 'wis', 'cha'], 17],
        ['physical3', '3rd physical', ['str', 'dex', 'con'], 17],
    ];

    function renderVariantRules(body) {
        const data = window.SheetApp.current;
        if (!data) return;
        const vr = window.SheetState.ensureVariantRules(data);
        body.appendChild(h('h3', null, 'Variant rules'));
        body.appendChild(h('p', 'dim',
            'Optional PF1 subsystems, stored with this character (they travel in the JSON '
            + 'export). All off by default — toggling one recomputes the sheet, never blocks it.'));
        for (const [key, label, hint] of VARIANT_RULES) {
            const row = h('div', 'settings-row');
            const lab = h('label', 'settings-check');
            const boxEl = h('input');
            boxEl.type = 'checkbox';
            boxEl.checked = Boolean(vr[key]);
            boxEl.addEventListener('change', () => {
                vr[key] = boxEl.checked;
                window.SheetApp.quietSave();
                renderSheet(data);
            });
            lab.append(boxEl, h('span', null, label + ' — ' + hint));
            row.appendChild(lab);
            body.appendChild(row);
        }
        if (vr.abp) {
            const lvl = Number(data.level) || 0;
            const picks = h('div', 'settings-row variant-abp-picks');
            picks.appendChild(h('span', 'settings-row-label', 'ABP ability picks'));
            for (const [key, label, opts, minLvl] of ABP_PICKS) {
                if (lvl < minLvl) continue;
                const wrap = h('label', 'variant-abp-pick');
                wrap.appendChild(h('span', 'dim', label + ' '));
                const sel = h('select');
                for (const ab of opts) {
                    const opt = h('option', null, ab.toUpperCase());
                    opt.value = ab;
                    if ((vr.abpChoices[key] || opts[0]) === ab) opt.selected = true;
                    sel.appendChild(opt);
                }
                sel.addEventListener('change', () => {
                    vr.abpChoices[key] = sel.value;
                    window.SheetApp.quietSave();
                    renderSheet(data);
                });
                wrap.appendChild(sel);
                picks.appendChild(wrap);
            }
            body.appendChild(picks);
        }
    }

    // #80: per-character snapshot history. Checkpoints are automatic (library.js takes at
    // most one per 5-minute burst of saves, newest 20 kept); this section lists them with
    // Preview (read-only) / Restore / delete. Restore is always undoable: it snapshots the
    // current state first — so no confirm dialog (house rule: warn, never block).
    function renderHistory(body) {
        const data = window.SheetApp.current;
        if (!data || data.error || !window.SheetLibrary?.listSnapshots) return;
        body.appendChild(h('h3', null, 'History'));
        body.appendChild(h('p', 'dim',
            'Automatic snapshots of this character — one per burst of edits, newest 20 kept. '
            + 'Preview is read-only; Restore keeps a “before restore” snapshot so it can '
            + 'always be undone.'));
        const list = h('div', 'settings-history');
        body.appendChild(list);
        const fmtTime = (ts) => new Date(ts).toLocaleString();
        const snapClone = async (key) => {
            const rec = await window.SheetLibrary.getSnapshot(key);
            return rec ? JSON.parse(JSON.stringify(rec.data)) : null;
        };
        const restoreSnap = async (s) => {
            const snap = await snapClone(s.key);
            if (!snap) return;
            await window.SheetLibrary.takeSnapshot(window.SheetApp.current, 'before restore');
            const sheet = (snap._sheet ??= {});
            sheet.id = data._sheet.id;               // same character, replaced in place…
            sheet.fileName = data._sheet?.fileName;  // …and the same disk-mirror file
            renderSheet(snap);
            await window.SheetApp.saveCurrent();
            window.SheetOverlay?.toast?.(`Restored the ${fmtTime(s.ts)} snapshot`);
        };
        const repaint = async () => {
            list.innerHTML = '';
            const id = data._sheet?.id;
            const snaps = id ? await window.SheetLibrary.listSnapshots(id).catch(() => []) : [];
            if (!snaps.length) {
                list.appendChild(h('p', 'dim', 'No snapshots yet — they appear as you edit.'));
                return;
            }
            for (const s of snaps) {
                const row = h('div', 'settings-row settings-history-row');
                row.appendChild(h('span', null, fmtTime(s.ts)));
                row.appendChild(h('span', 'dim',
                    `${s.name} — ${titleCase(String(s.klass || '?'))} ${s.level}`
                    + (s.reason ? ` · ${s.reason}` : '')));
                const prevBtn = h('button', null, 'Preview');
                prevBtn.type = 'button';
                prevBtn.addEventListener('click', async () => {
                    const snap = await snapClone(s.key);
                    if (!snap || !window.SheetSimple || !window.SheetOverlay) return;
                    const wrap = h('div', 'snapshot-preview');
                    wrap.appendChild(window.SheetSimple.renderSimpleSheet(snap));
                    wrap.style.pointerEvents = 'none';   // a preview must not edit or roll
                    const restoreBtn = h('button', null, 'Restore this snapshot');
                    restoreBtn.type = 'button';
                    const handle = window.SheetOverlay.open({
                        title: `Snapshot — ${fmtTime(s.ts)}`,
                        body: wrap,
                        footer: [restoreBtn],
                    });
                    restoreBtn.addEventListener('click', async () => {
                        handle.close();
                        await restoreSnap(s);
                    });
                });
                const restBtn = h('button', null, 'Restore');
                restBtn.type = 'button';
                restBtn.addEventListener('click', () => restoreSnap(s));
                const delBtn = h('button', null, '×');
                delBtn.type = 'button';
                delBtn.title = 'Delete this snapshot';
                delBtn.addEventListener('click', async () => {
                    await window.SheetLibrary.removeSnapshot(s.key);
                    repaint();
                });
                row.append(prevBtn, restBtn, delBtn);
                list.appendChild(row);
            }
        };
        repaint();
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
            // Same Part B miss as notes.js had: `currentData` is the shell IIFE's own binding and
            // is not in scope here, so switching view from Settings threw instead of re-rendering.
            renderSheet(window.SheetApp.current);
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

        // #10: coin weight (PF1: 50 coins = 1 lb) — on by default, per-browser toggle.
        const coinRow = h('div', 'settings-row');
        const coinLabel = h('label', 'settings-check');
        const coinBox = h('input');
        coinBox.type = 'checkbox';
        coinBox.checked = window.SheetInventoryModel.coinWeightEnabled();
        coinBox.addEventListener('change', () => {
            try {
                if (coinBox.checked) localStorage.removeItem('sheet.coinWeight');
                else localStorage.setItem('sheet.coinWeight', 'off');
            } catch { /* private mode */ }
            const cur = window.SheetApp.current;
            if (cur) window.SheetApp.renderSheet(cur);
        });
        coinLabel.append(coinBox,
            h('span', null, 'Coins weigh (50 coins = 1 lb) — counts toward encumbrance'));
        coinRow.appendChild(coinLabel);
        body.appendChild(coinRow);

        const guideRow = h('div', 'settings-row');
        for (const [label, run] of [['Start here', openStartHere], ['Full instructions', openInstructions]]) {
            const btn = h('button', null, label);
            btn.type = 'button';
            btn.addEventListener('click', run);
            guideRow.appendChild(btn);
        }
        body.appendChild(guideRow);

        renderVariantRules(body);
        renderHistory(body);

        body.appendChild(h('h3', null, 'Generation Backend'));
        const urlRow = h('div', 'settings-row');
        const urlInput = h('input');
        urlInput.type = 'text';
        urlInput.value = backendUrl();
        urlInput.className = 'settings-input';
        const setBtn = h('button', null, 'Set');
        setBtn.addEventListener('click', () => {
            const v = urlInput.value.trim().replace(/\/+$/, '');
            if (v) localStorage.setItem(window.SheetApp.BACKEND_KEY, v);
            urlInput.value = backendUrl();
        });
        const resetBtn = h('button', null, 'Reset to hosted');
        resetBtn.addEventListener('click', () => {
            localStorage.removeItem(window.SheetApp.BACKEND_KEY);
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
        // #82: Paizo-style plain-text stat block of the CURRENT character → clipboard.
        const statblockBtn = h('button', null, 'Copy stat block');
        statblockBtn.title = 'Copy the current character as Paizo-style stat-block text (for prep docs and forum posts)';
        statblockBtn.addEventListener('click', () => window.SheetStatblock?.copyStatBlock?.());
        // #86: side-by-side comparison of two library characters (or #80 snapshots).
        const diffBtn = h('button', null, 'Compare…');
        diffBtn.title = 'Compare two saved characters side by side, deltas highlighted';
        diffBtn.addEventListener('click', () => window.SheetCharDiff?.open?.());
        libRow.append(exportBtn, importInput, statblockBtn, diffBtn);
        body.appendChild(libRow);

        // Generator provenance (#68): which backend build produced this character, plus
        // the OGL licence pointer the backend ships (license_url is backend-relative).
        const data = window.SheetApp?.current;
        if (data?.generator_version || data?.license_url) {
            const foot = h('p', 'dim no-print');
            if (data.generator_version) {
                foot.appendChild(document.createTextNode(
                    'Generated by backend build ' + data.generator_version));
            }
            if (data.license_url) {
                if (foot.childNodes.length) foot.appendChild(document.createTextNode(' · '));
                const a = h('a', null, 'OGL license');
                a.href = String(data.license_url).startsWith('http')
                    ? data.license_url
                    : backendUrl().replace(/\/+$/, '') + data.license_url;
                a.target = '_blank';
                a.rel = 'noopener';
                foot.appendChild(a);
            }
            body.appendChild(foot);
        }

        return sec;
    }

    return { tabSettings };
})();
