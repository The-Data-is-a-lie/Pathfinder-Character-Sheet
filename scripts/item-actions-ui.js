// scripts/item-actions-ui.js -- multi-action items (#152), window.SheetActionsUI.
// The action picker (asked only when a host has more than one action), the Actions editor
// used by the item sheet and the feature sheet, and the "Use" card for non-weapon actions.
// The model lives in domain/item-actions.js; weapon rolls go through SheetRoll.
window.SheetActionsUI = (function () {
    'use strict';
    const { h } = window.SheetUI;
    const A = () => window.SheetItemActions;

    /**
     * Ask which action. `choices` come from SheetItemActions.choices; onPick(action) gets the
     * chosen entry (the implicit weapon "Normal" arrives as { normal: true }).
     */
    function pick({ title, choices, weapon = false, data = null, onPick }) {
        const body = h('div', 'action-picker');
        body.appendChild(h('p', 'dim', 'This has more than one action — which one?'));
        let handle = null;
        choices.forEach((c, i) => {
            const btn = h('button', 'action-pick-btn');
            btn.type = 'button';
            btn.dataset.actionId = c.id;
            btn.appendChild(h('span', 'action-pick-name', (i < 9 ? `${i + 1}. ` : '') + c.name));
            const delta = A().deltaLabel(c, { weapon, data });
            const sum = A().summary(c, data);
            const sub = [delta, sum].filter(Boolean).join(' · ');
            if (sub) btn.appendChild(h('span', 'action-pick-sub dim', sub));
            btn.addEventListener('click', () => {
                handle?.close();
                onPick(c);
            });
            body.appendChild(btn);
        });
        // 1–9 picks by number: the picker is in the way of a roll, so make it fast.
        body.addEventListener('keydown', (e) => {
            const n = Number(e.key);
            if (n >= 1 && n <= choices.length && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                body.querySelectorAll('.action-pick-btn')[n - 1]?.click();
            }
        });
        handle = window.SheetOverlay.open({ title: title || 'Choose an action', body });
        body.querySelector('.action-pick-btn')?.focus();
        return handle;
    }

    /** Run `run(action)` directly when there is one choice, else after the picker. */
    function withPick({ title, stored, weapon = false, data, run }) {
        const choices = A().choices(stored, { weapon });
        if (!choices.length) return run(null);
        if (choices.length === 1) return run(choices[0].normal ? null : choices[0]);
        return pick({ title, choices, weapon, data, onPick: (c) => run(c.normal ? null : c) });
    }

    /** Post a standalone (non-weapon) action: optional d20 attack, optional damage, the rest as text. */
    function use(data, title, action) {
        const R = window.SheetRoll;
        if (!R?.postCard || !action) return;
        const riders = [];
        const roll = (f) => {
            const rf = A().rollable(f, data);
            if (!rf) return null;
            const r = R.roll(rf.formula);
            return r?.ok ? { ...r, unresolved: rf.unresolved } : { ok: false, formula: rf.formula };
        };
        if (action.atk) {
            const atk = A().rollable(action.atk, data);
            const r = atk ? R.roll('1d20 + (' + atk.formula + ')') : null;
            if (r?.ok) riders.push({ source: 'Attack', text: `${r.detail} = ${r.total}` });
            else riders.push({ source: 'Attack', text: `could not roll “${action.atk}”` });
        }
        if (action.dmg) {
            const r = roll(action.dmg);
            if (r?.ok) riders.push({ source: 'Damage', text: `${r.detail} = ${r.total}` });
            else riders.push({ source: 'Damage', text: `could not roll “${action.dmg}”` });
        }
        const sum = A().summary(action, data);
        if (sum) riders.push({ source: action.name, text: sum });
        R.postCard({ title: `${title} — ${action.name}`, subtitle: 'Action', riders });
        R.setOpen?.(true);
    }

    /** Use button for a feature/item row: picker when several, direct when one. */
    function useButton(data, { title, stored, cls = '' }) {
        const btn = h('button', 'inv-btn action-use-btn no-print ' + cls, '⚔');
        btn.type = 'button';
        const n = A().normalize(stored).length;
        btn.title = n > 1 ? `Use… (${n} actions)` : `Use: ${A().normalize(stored)[0]?.name || ''}`;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            withPick({ title, stored, data, run: (a) => use(data, title, a) });
        });
        return btn;
    }

    const POWER_ATTACK = {
        name: 'Power Attack',
        atk: '-(1 + floor(@attributes.bab.total / 4))',
        dmg: '2 * (1 + floor(@attributes.bab.total / 4))',
        notes: 'two-handed: ×1.5 damage — edit the formula. Don’t also tick the Power Attack combat option.',
    };

    /**
     * The Actions editor. getList() → current stored list; setList(list) stores it and returns the
     * normalized copy. Re-renders itself in place on every edit.
     */
    function editor({ getList, setList, weapon = false, data = null }) {
        const root = h('div', 'actions-editor');
        const paint = () => {
            root.replaceChildren();
            root.appendChild(h('p', 'dim', weapon
                ? 'Each action is a way to swing this weapon. “Normal” is always there; an action ADDS its attack and damage (formulas and dice work) and can swap the weapon dice. More than one action → Attack asks which.'
                : 'Each action is one way to use this. Attack (blank = no attack roll) and Damage are whole formulas. More than one → Use asks which.'));
            const list = A().normalize(getList());
            const commit = (next) => {
                setList(next);
                paint();
            };
            list.forEach((a, i) => {
                const row = h('div', 'action-edit-row');
                row.dataset.actionId = a.id;
                const field = (key, label, placeholder, width) => {
                    const lab = h('label', 'action-edit-field' + (width ? ' ' + width : ''));
                    lab.appendChild(h('span', 'action-edit-label', label));
                    const inp = h('input', 'edit-field');
                    inp.type = 'text';
                    inp.dataset.field = key;
                    inp.value = a[key] || '';
                    if (placeholder) inp.placeholder = placeholder;
                    inp.addEventListener('change', () => {
                        const next = list.map((x) => (x.id === a.id ? { ...x, [key]: inp.value } : x));
                        commit(next);
                    });
                    lab.appendChild(inp);
                    row.appendChild(lab);
                    return inp;
                };
                field('name', 'Name', 'Power Attack', 'is-wide');
                field('atk', weapon ? 'Attack ±' : 'Attack bonus', weapon ? '-2' : 'blank = none');
                field('dmg', weapon ? 'Damage ±' : 'Damage', weapon ? '+4 or 1d6' : '2d6 + 3');
                if (weapon) field('dice', 'Weapon dice', 'keep');
                const saveLab = h('label', 'action-edit-field');
                saveLab.appendChild(h('span', 'action-edit-label', 'Save'));
                const saveSel = h('select', 'edit-field');
                saveSel.dataset.field = 'save';
                for (const [v, l] of [['', '—'], ...Object.entries(A().SAVES)]) {
                    const o = document.createElement('option');
                    o.value = v;
                    o.textContent = l;
                    if ((a.save || '') === v) o.selected = true;
                    saveSel.appendChild(o);
                }
                saveSel.addEventListener('change', () => {
                    commit(list.map((x) => (x.id === a.id ? { ...x, save: saveSel.value } : x)));
                });
                saveLab.appendChild(saveSel);
                row.appendChild(saveLab);
                field('dc', 'DC', '10 + @abilities.wis.mod');
                field('range', 'Range', '30 ft');
                field('notes', 'Notes', '', 'is-wide');
                const del = h('button', 'inv-btn inv-btn-danger action-del-btn', '×');
                del.type = 'button';
                del.title = 'Remove this action';
                del.addEventListener('click', () => {
                    const removed = list[i];
                    commit(list.filter((x) => x.id !== a.id));
                    window.SheetOverlay?.toast?.(`Removed “${removed.name}”`, {
                        action: { label: 'Undo', onClick: () => commit([...A().normalize(getList()).slice(0, i), removed, ...A().normalize(getList()).slice(i)]) },
                    });
                });
                row.appendChild(del);
                root.appendChild(row);
            });
            const bar = h('div', 'actions-editor-bar');
            const add = h('button', 'inv-btn action-add-btn', '+ Add action');
            add.type = 'button';
            add.addEventListener('click', () => commit([...list, A().blank()]));
            bar.appendChild(add);
            if (weapon && !list.some((x) => /power attack/i.test(x.name))) {
                const pa = h('button', 'inv-btn action-add-pa', '+ Power Attack');
                pa.type = 'button';
                pa.title = 'An action with the PF1 Power Attack formula (one-handed numbers)';
                pa.addEventListener('click', () => commit([...list, { ...A().blank(), ...POWER_ATTACK }]));
                bar.appendChild(pa);
            }
            root.appendChild(bar);
        };
        paint();
        return root;
    }

    return { pick, withPick, use, useButton, editor };
})();
