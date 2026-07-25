// scripts/header.js -- the identity header: portrait tile, id grid, ability rows
// (window.SheetHeader). Extracted from sheet.js (Part B split); bodies moved verbatim.
// Loads after modals.js (uses openPortraitLightbox / processPortraitFile), before the tabs.
window.SheetHeader = (function () {
    'use strict';
    const { h, editableField, fmt, mod } = window.SheetUI;
    const { abModOf, abilityInfo } = window.SheetDerive;
    const { sheetState, quietSave } = window.SheetState;
    const { openPortraitLightbox, processPortraitFile } = window.SheetModals;

    /**
     * Portrait tile for the header. With an image: single click enlarges it, double-click /
     * right-click changes it, and Change / Remove buttons sit underneath. When empty it's an
     * "Add portrait" dropzone (click to add). Drag-drop and paste set the image in either state.
     * Refreshes in place (no full re-render) so the active tab and scroll position are kept.
     */
    function renderPortrait(data) {
        const wrap = h('div', 'sheet-portrait');
        const tile = h('div', 'portrait-tile');
        tile.tabIndex = 0;
        const actions = h('div', 'portrait-actions no-print');
        const fileInput = h('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';

        const pick = () => fileInput.click();
        const store = (url) => {
            const st = sheetState(data);
            if (url) st.portrait = url; else delete st.portrait;
            quietSave();
            refresh();
        };
        const take = (file) => processPortraitFile(file, (url) => { if (url) store(url); });

        function refresh() {
            tile.innerHTML = '';
            actions.innerHTML = '';
            const url = sheetState(data).portrait;
            wrap.classList.toggle('has-img', !!url);
            if (url) {
                const img = h('img', 'portrait-img');
                img.src = url;
                img.alt = 'Character portrait';
                img.title = 'Click to enlarge · double-click or right-click to change';
                tile.appendChild(img);
                const change = h('button', 'inv-btn portrait-btn', 'Change image');
                change.type = 'button';
                change.addEventListener('click', pick);
                const rm = h('button', 'inv-btn inv-btn-danger portrait-btn', 'Remove');
                rm.type = 'button';
                rm.addEventListener('click', () => store(''));
                actions.append(change, rm);
            } else {
                const empty = h('div', 'portrait-empty');
                empty.appendChild(h('div', 'portrait-empty-icon', '👤'));
                empty.appendChild(h('div', 'portrait-empty-text', 'Add portrait'));
                tile.appendChild(empty);
            }
        }

        // Single click = enlarge (or add when empty); delayed so a double-click doesn't also
        // fire the single-click action. Double-click / right-click = change.
        let clickTimer = null;
        tile.addEventListener('click', () => {
            if (clickTimer) return;
            clickTimer = setTimeout(() => {
                clickTimer = null;
                const url = sheetState(data).portrait;
                if (url) openPortraitLightbox(url); else pick();
            }, 230);
        });
        const changeNow = (e) => {
            e.preventDefault();
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
            pick();
        };
        tile.addEventListener('dblclick', changeNow);
        tile.addEventListener('contextmenu', changeNow);

        fileInput.addEventListener('change', () => {
            take(fileInput.files && fileInput.files[0]);
            fileInput.value = '';
        });
        tile.addEventListener('dragover', (e) => { e.preventDefault(); tile.classList.add('drag-over'); });
        tile.addEventListener('dragleave', () => tile.classList.remove('drag-over'));
        tile.addEventListener('drop', (e) => {
            e.preventDefault();
            tile.classList.remove('drag-over');
            take(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
        });
        tile.addEventListener('paste', (e) => {
            const items = (e.clipboardData && e.clipboardData.items) || [];
            for (const it of items) {
                if (it.type && it.type.indexOf('image/') === 0) {
                    take(it.getAsFile());
                    e.preventDefault();
                    break;
                }
            }
        });

        wrap.append(tile, actions, fileInput);
        refresh();
        return wrap;
    }
    function renderHeader(data) {
        const head = h('div', 'sheet-header');

        const top = h('div', 'sheet-header-top');
        top.appendChild(renderPortrait(data));
        const idCol = h('div', 'sheet-header-idcol');

        const nameInput = editableField(data, 'character_full_name', {
            onChange: () => { /* roster name updates on save */ },
        });
        nameInput.className = 'edit-field char-name-input';
        nameInput.placeholder = 'Character name';
        idCol.appendChild(nameInput);

        // 10 fields → a clean 5×2 grid that lines up beside the portrait. Row 1 groups the
        // four class slots + level; row 2 is the rest of the identity. Class 3/4 are plain
        // label fields (multiclass that drives the sheet is managed on the Summary tab).
        const idGrid = h('div', 'id-edit-grid no-print');
        const idFields = [
            ['Class', 'c_class'],
            ['Class 2', 'c_class_2'],
            ['Class 3', 'c_class_3'],
            ['Class 4', 'c_class_4'],
            ['Level', 'level', { type: 'number', min: 1, max: 30 }],
            ['Race', 'chosen_race'],
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
        idCol.appendChild(idGrid);

        top.appendChild(idCol);
        head.appendChild(top);

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

    return { renderHeader, renderPortrait, renderAbilities };
})();
