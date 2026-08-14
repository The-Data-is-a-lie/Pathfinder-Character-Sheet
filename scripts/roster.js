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
        // #74: encounter members bunch under their group's optgroup so a six-mook squad reads
        // as one entry's worth of list instead of scattering through the alphabet. Ungrouped
        // characters keep their flat position, which is every character that predates this.
        const groupNodes = new Map();
        const hostFor = (r) => {
            const g = r.data?._sheet?.encounterGroup;
            if (!g?.id) return sel;
            if (!groupNodes.has(g.id)) {
                const og = document.createElement('optgroup');
                og.label = g.name || 'Encounter';
                groupNodes.set(g.id, og);
                sel.appendChild(og);
            }
            return groupNodes.get(g.id);
        };
        for (const r of records) {
            const opt = h('option', null, `${r.name} — ${titleCase(r.klass || '?')} ${r.level}`);
            opt.value = r.id;
            hostFor(r).appendChild(opt);
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
        // #61: the first real save is the moment to ask for persistent storage — engines weigh
        // site engagement, so the same request on a cold load is the one they silently deny.
        // Self-limiting to one ask per session; never blocks the save.
        window.SheetPWA?.requestPersistence?.();
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

    // ---------------------------------------------------------------- quick clone (#84)
    /** "Goblin" → first free "Goblin (2)" / "Goblin (3)" …; cloning a clone re-numbers the stem. */
    function cloneName(base, taken) {
        const stem = String(base || 'Unnamed').replace(/\s+\(\d+\)$/, '');
        for (let n = 2; n < 100; n++) {
            const candidate = `${stem} (${n})`;
            if (!taken.has(candidate)) return candidate;
        }
        return `${stem} (${Date.now().toString(36)})`;
    }
    async function cloneCurrent() {
        const src = window.SheetApp.current;
        if (!src || src.error) return null;
        await saveCurrent({ quiet: true });    // the clone should carry any in-flight edits
        const data = JSON.parse(JSON.stringify(src));
        const sheet = (data._sheet ??= {});
        delete sheet.id;        // SheetLibrary.save() re-keys the copy…
        delete sheet.fileName;  // …and the folder mirror writes a fresh <Name>.json
        const records = await window.SheetLibrary.list().catch(() => []);
        data.character_full_name = cloneName(src.character_full_name,
            new Set(records.map((r) => r.name)));
        renderSheet(data);      // the clone becomes the character being edited
        const record = await saveCurrent();
        window.SheetOverlay?.toast?.(`Cloned — now editing ${data.character_full_name}`);
        return record;
    }

    return { rosterSelect, refreshRoster, saveCurrent, loadCharacter, deleteCurrent, adoptCharacter,
        cloneCurrent };
})();
