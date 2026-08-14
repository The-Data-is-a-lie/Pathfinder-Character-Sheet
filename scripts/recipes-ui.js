// scripts/recipes-ui.js -- the dialogs that drive the generate recipes (window.SheetRecipesUI):
// "Generate related…" (#73) and "Generate encounter…" (#74).
//
// Both dialogs follow the same shape on purpose: pick a recipe, SEE the derived parameters,
// edit any of them, then generate. The recipe is a starting point the user can overrule, not a
// black box — which is also what makes a wrong role-bucket guess cost nothing.
//
// Generation is sequential with a live "Generating 2 of 3…" line, because the free-tier backend
// takes up to a minute to wake and parallel posts would only make that worse.
window.SheetRecipesUI = (function () {
    'use strict';
    const { h } = window.SheetUI;
    const R = () => window.SheetRecipes;

    const CLASS_OPTIONS = () => window.SheetData?.CLASSES || ['Random'];
    const REGION_OPTIONS = () => window.SheetData?.REGIONS || ['Random'];

    function select(options, value, onChange) {
        const sel = h('select', 'edit-field');
        for (const [v, label] of options) {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = label;
            sel.appendChild(opt);
        }
        sel.value = value;
        sel.addEventListener('change', () => onChange(sel.value));
        return sel;
    }
    const field = (label, control) => {
        const row = h('label', 'recipe-field');
        row.appendChild(h('span', 'recipe-field-label', label));
        row.appendChild(control);
        return row;
    };

    // ------------------------------------------------------------------ #73 related NPC
    function openRelated(data) {
        const src = data || window.SheetApp?.current;
        if (!src || src.error) return;
        const s = R().sourceParams(src);
        let typeId = 'rival';
        let params = R().relatedParams(src, typeId);

        const body = h('div', 'recipe-dialog');
        const lead = h('p', 'dim');
        const paramBox = h('div', 'recipe-params');
        const status = h('p', 'recipe-status');

        const paintParams = () => {
            paramBox.innerHTML = '';
            paramBox.appendChild(field('Class', select(
                CLASS_OPTIONS().map((c) => [c, c]),
                CLASS_OPTIONS().includes(params.className) ? params.className : 'Random',
                (v) => { params.className = v; })));
            const lvl = h('input', 'edit-field');
            lvl.type = 'number';
            lvl.min = '1';
            lvl.max = '40';
            lvl.value = String(params.level);
            lvl.addEventListener('change', () => {
                params.level = Math.min(40, Math.max(1, Number(lvl.value) || 1));
            });
            paramBox.appendChild(field('Level', lvl));
            paramBox.appendChild(field('Alignment', select(
                [['random', 'Random'], ...Object.entries(R().ALIGN_LABELS)],
                params.alignment || 'random', (v) => { params.alignment = v; })));
            paramBox.appendChild(field('Region', select(
                [['random', 'Random'], ...REGION_OPTIONS().filter((r) => r !== 'Random').map((r) => [r, r])],
                REGION_OPTIONS().includes(params.region) ? params.region : 'random',
                (v) => { params.region = v; })));
        };
        const paintLead = () => {
            const rel = R().relationshipById(typeId);
            lead.textContent = `${rel.blurb} Derived from ${s.name} `
                + `(${s.className || 'no class'} ${s.level}${s.alignment ? ', ' + R().ALIGN_LABELS[s.alignment] : ''}). `
                + 'Everything below is editable before you roll.';
        };

        const typeRow = h('div', 'recipe-types');
        for (const rel of R().RELATIONSHIPS) {
            const btn = h('button', 'inv-btn' + (rel.id === typeId ? ' inv-btn-primary' : ''), rel.label);
            btn.type = 'button';
            btn.addEventListener('click', () => {
                typeId = rel.id;
                params = R().relatedParams(src, typeId);   // re-roll the recipe for the new type
                for (const b of typeRow.children) b.classList.remove('inv-btn-primary');
                btn.classList.add('inv-btn-primary');
                paintLead();
                paintParams();
            });
            typeRow.appendChild(btn);
        }
        paintLead();
        paintParams();
        body.append(lead, typeRow, paramBox, status);

        const go = h('button', null, 'Generate');
        go.type = 'button';
        const cancel = h('button', null, 'Cancel');
        cancel.type = 'button';
        const handle = window.SheetOverlay.open({
            title: 'Generate a related character', body, footer: [go, cancel],
        });
        cancel.addEventListener('click', () => handle.close());
        go.addEventListener('click', async () => {
            go.disabled = true;
            status.textContent = 'Rolling them up… the backend can take a minute to wake.';
            try {
                // The source must be saved BEFORE the link is written: it needs an id for the
                // other side's relationship entry to point at, and generateCustom re-renders.
                await window.SheetRoster.saveCurrent({ quiet: true });
                const made = await window.SheetGenerate.generateCustom(R().toPayload(params));
                R().linkCharacters(src, made, typeId);
                // The live Notes box is the authority for prose, not `_sheet.prose`: BOTH
                // renderSheet and saveCurrent begin by copying the textareas back over it. So
                // writing the linking sentence into state alone gets it clobbered by the empty
                // box `generateCustom`'s render just painted. Push it into the box first, then
                // repaint — which is also what makes the Biography Relationships row appear
                // now rather than after a reload, since every pane is built up front.
                const notesBox = document.getElementById('notes-prose-notes');
                if (notesBox) notesBox.value = made._sheet?.prose?.notes || '';
                window.SheetApp.renderSheet(made);
                await window.SheetRoster.saveCurrent();          // the new character, with its link
                await window.SheetLibrary.save(src);             // …and the source's half
                await window.SheetRoster.refreshRoster();
                handle.close();
                window.SheetOverlay.toast(`${made.character_full_name} — `
                    + `${R().relationshipById(typeId).label.toLowerCase()} of ${s.name}`);
            } catch (err) {
                status.textContent = 'Failed: ' + err.message;
                go.disabled = false;
            }
        });
    }

    // ------------------------------------------------------------------ #74 encounter set
    function openEncounter() {
        const start = Math.max(1, Number(window.SheetApp?.current?.total_level) || 4);
        let apl = start;
        let difficulty = 'average';
        let shapeId = 'boss-minions';
        let count = 3;

        const body = h('div', 'recipe-dialog');
        body.appendChild(h('p', 'dim',
            'Sets an XP budget from the party level and difficulty, then solves the chosen shape '
            + 'against it. The result is normal, fully editable characters in your library — '
            + 'grouped together in the dropdown, not locked into anything.'));
        const controls = h('div', 'recipe-params');
        const preview = h('div', 'recipe-preview');
        const status = h('p', 'recipe-status');

        const paintPreview = () => {
            const solved = R().solveEncounter(apl, difficulty, shapeId, count);
            preview.innerHTML = '';
            preview.appendChild(h('p', 'recipe-preview-head',
                `Encounter CR ${solved.encounterCR} · ${solved.budget.toLocaleString()} XP budget`));
            const list = h('ul', 'recipe-slot-list');
            for (const slot of solved.slots) {
                list.appendChild(h('li', null,
                    `${slot.count}× ${slot.role} — CR ${slot.crLabel}, built at level ${slot.level}`
                    + ` (${slot.xpEach.toLocaleString()} XP each)`));
            }
            preview.appendChild(list);
            const plan = R().encounterPlan(solved);
            const gens = plan.reduce((a, p) => a + p.generate, 0);
            const clones = plan.reduce((a, p) => a + p.clones, 0);
            preview.appendChild(h('p', 'dim',
                `${gens} generate${gens === 1 ? '' : 's'}`
                + (clones ? ` + ${clones} clone${clones === 1 ? '' : 's'}` : '')
                + ' — duplicates are cloned, not re-rolled.'));
            return solved;
        };
        const paintControls = () => {
            controls.innerHTML = '';
            const aplIn = h('input', 'edit-field');
            aplIn.type = 'number';
            aplIn.min = '1';
            aplIn.max = '20';
            aplIn.value = String(apl);
            aplIn.addEventListener('change', () => {
                apl = Math.min(20, Math.max(1, Number(aplIn.value) || 1));
                paintPreview();
            });
            controls.appendChild(field('Party level (APL)', aplIn));
            controls.appendChild(field('Difficulty', select(
                R().DIFFICULTIES.map((d) => [d.id, `${d.label} (CR ${d.offset >= 0 ? '+' : ''}${d.offset})`]),
                difficulty, (v) => { difficulty = v; paintPreview(); })));
            controls.appendChild(field('Shape', select(
                R().SHAPES.map((s) => [s.id, s.label]), shapeId, (v) => {
                    shapeId = v;
                    const shape = R().shapeById(v);
                    if (shape.counts) count = shape.counts[Math.floor(shape.counts.length / 2)];
                    paintControls();
                    paintPreview();
                })));
            const shape = R().shapeById(shapeId);
            if (shape.counts) {
                controls.appendChild(field(shape.countLabel, select(
                    shape.counts.map((n) => [String(n), String(n)]), String(count),
                    (v) => { count = Number(v); paintPreview(); })));
            }
        };
        paintControls();
        paintPreview();
        body.append(controls, preview, status);

        const go = h('button', null, 'Generate encounter');
        go.type = 'button';
        const cancel = h('button', null, 'Cancel');
        cancel.type = 'button';
        const handle = window.SheetOverlay.open({
            title: 'Generate an encounter', body, footer: [go, cancel],
        });
        cancel.addEventListener('click', () => handle.close());
        go.addEventListener('click', async () => {
            go.disabled = true;
            const solved = R().solveEncounter(apl, difficulty, shapeId, count);
            const group = {
                id: 'enc-' + Math.random().toString(36).slice(2, 9),
                name: `${solved.shape.label} · CR ${solved.encounterCR}`,
            };
            const total = solved.slots.length;
            try {
                let i = 0;
                for (const slot of solved.slots) {
                    i += 1;
                    status.textContent = `Generating ${i} of ${total} — ${slot.role} (level ${slot.level})…`;
                    const made = await window.SheetGenerate.generateCustom({
                        highestLevel: String(slot.level),
                        lowestLevel: String(slot.level),
                    });
                    made.character_full_name = `${made.character_full_name} (${slot.role})`;
                    R().tagEncounter(made, group);
                    await window.SheetRoster.saveCurrent({ quiet: true });
                    // Duplicates are clones of the statblock we just paid for, not new rolls.
                    for (let c = 1; c < slot.count; c += 1) {
                        status.textContent = `Copying ${slot.role} ${c + 1} of ${slot.count}…`;
                        const rec = await window.SheetRoster.cloneCurrent();
                        if (rec) R().tagEncounter(window.SheetApp.current, group);
                        await window.SheetRoster.saveCurrent({ quiet: true });
                    }
                }
                await window.SheetRoster.refreshRoster();
                handle.close();
                window.SheetOverlay.toast(`Encounter ready — ${group.name}`);
            } catch (err) {
                status.textContent = 'Failed: ' + err.message
                    + ' — anything already generated is saved in your library.';
                go.disabled = false;
            }
        });
    }

    return { openRelated, openEncounter };
})();
