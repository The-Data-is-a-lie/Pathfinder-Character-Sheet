// scripts/tabs/settings.js -- the Settings tab (window.SheetTabSettings). Extracted from
// sheet.js (Part B split); body moved verbatim except BACKEND_KEY (read from SheetApp). Theme
// controls come from SheetTheme, refreshRoster from SheetRoster; the shell view-state getters/
// setters (audience/viewMode/explainMode/density) + backendUrl late-bind via SheetApp.
window.SheetTabSettings = (function () {
    'use strict';
    const { h, section } = window.SheetUI;
    const { buildCustomThemeControls, renderThemeCards, themePreference } = window.SheetTheme;
    const { refreshRoster } = window.SheetRoster;
    const {
        audience, setAudience, viewMode, setViewMode, explainMode, setExplainMode,
        densityCompact, setDensityCompact, openStartHere, openInstructions,
    } = window.SheetShellUI;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const backendUrl = () => window.SheetApp.backendUrl();

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
        libRow.append(exportBtn, importInput);
        body.appendChild(libRow);

        return sec;
    }

    return { tabSettings };
})();
