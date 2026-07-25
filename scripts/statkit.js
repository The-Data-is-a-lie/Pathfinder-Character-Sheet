// scripts/statkit.js -- shared roll/stat-row UI (window.SheetStatKit): the Roll buttons and the
// HP stat block used across attributes/skills/summary/defenses/combat and the simple sheet.
// Extracted from sheet.js (Part C); rollAllBar's toast now calls SheetOverlay.toast directly.
// Loads after state.js (kvHp uses computeDerived/sheetState); window.SheetRoll is read at call time.
window.SheetStatKit = (function () {
    'use strict';
    const { h, fmt, kv, details, dblclickEditable, parseIntLoose } = window.SheetUI;
    const { computeDerived } = window.SheetDerive;
    const { sheetState, quietSave } = window.SheetState;

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
    /**
     * A "Roll all" bar that fires every per-row Roll button inside `scopeTable` — the buttons
     * already own the totals and log formatting, so bulk rolling stays DRY. Returns the bar.
     */
    function rollAllBar(label, title, scopeTable) {
        const bar = h('div', 'roll-all-bar no-print');
        const btn = h('button', 'roll-all-btn', label);
        btn.type = 'button';
        btn.title = title;
        btn.addEventListener('click', () => {
            const rolls = scopeTable.querySelectorAll('.skill-roll-cell .stat-roll-btn');
            rolls.forEach((b) => b.click());
            window.SheetOverlay?.toast?.(`Rolled ${rolls.length} into the Tools log`);
        });
        bar.appendChild(btn);
        return bar;
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

    return { rollCheck, rollBtn, rollAllBar, kvHp };
})();
