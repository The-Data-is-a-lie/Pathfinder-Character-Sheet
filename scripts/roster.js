// scripts/roster.js -- the character library ops: dropdown, save/load/delete, auto-adopt
// (window.SheetRoster). Extracted from sheet.js (Part B split); bodies moved verbatim except
// currentData / CURRENT_KEY reads (routed through SheetApp) and the currentData=null write
// (SheetApp.setCurrent). The demo-banner trio stays in the shell (renderSheet reads demoData).
// Loads after header.js, before generate.js. window.SheetLibrary is read at call time.
window.SheetRoster = (function () {
    'use strict';
    const { h, titleCase } = window.SheetUI;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const ensureProse = (d) => window.SheetApp.ensureProse(d);

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
        const want = selectedId ?? window.SheetApp.current?._sheet?.id ?? localStorage.getItem(window.SheetApp.CURRENT_KEY);
        if (want && records.some((r) => r.id === want)) sel.value = want;
    }
    async function saveCurrent({ quiet } = {}) {
        if (!window.SheetApp.current || window.SheetApp.current.error) return;
        if (window.SheetApp.current) {
            const prose = ensureProse(window.SheetApp.current);
            for (const key of ['description', 'personality', 'notes']) {
                const el = document.getElementById('notes-prose-' + key);
                if (el) prose[key] = el.value;
            }
            const legacy = document.getElementById('notes-text');
            if (legacy && !document.getElementById('notes-prose-notes')) {
                prose.notes = legacy.value;
            }
            (window.SheetApp.current._sheet ??= {}).notes = prose.notes || '';
        }
        const record = await window.SheetLibrary.save(window.SheetApp.current);
        localStorage.setItem(window.SheetApp.CURRENT_KEY, record.id);
        if (!quiet) await refreshRoster(record.id);
        return record;
    }
    async function loadCharacter(id) {
        const record = await window.SheetLibrary.get(id);
        if (!record) return;
        localStorage.setItem(window.SheetApp.CURRENT_KEY, record.id);
        renderSheet(record.data);
        await refreshRoster(record.id);
    }
    async function deleteCurrent() {
        const id = window.SheetApp.current?._sheet?.id || rosterSelect()?.value;
        if (!id) return;
        const name = window.SheetApp.current?.character_full_name || 'this character';
        if (!confirm(`Delete ${name} from the library${window.SheetLibrary.status().state === 'connected' ? ' and its file in the connected folder' : ''}?`)) return;
        await window.SheetLibrary.remove(id);
        localStorage.removeItem(window.SheetApp.CURRENT_KEY);
        window.SheetApp.setCurrent(null);
        const records = await window.SheetLibrary.list().catch(() => []);
        if (records.length) await loadCharacter(records[0].id);
        else {
            renderSheet(null);
            await refreshRoster();
        }
    }
    async function adoptCharacter(data) {
        renderSheet(data);
        await saveCurrent(); // auto-save: every generated/loaded character lands in the library
    }

    return { rosterSelect, refreshRoster, saveCurrent, loadCharacter, deleteCurrent, adoptCharacter };
})();
