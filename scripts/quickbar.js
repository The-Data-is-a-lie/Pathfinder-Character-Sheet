// scripts/quickbar.js -- the pinned Quick Actions strip on Summary (window.SheetQuickbar, #148).
// pf1's Summary is a launchpad: any item flagged `showInQuickbar` sits in a strip there. Here the
// player pins items, spells, features and rolls; click uses the pin, right-click opens its sheet,
// and a badge shows charges, uses, slots or quantity left. The fixed quick-action buttons stay.
//
// Pins live per character in `_sheet.quickbar` as an ORDERED list of refs (order = strip order):
//   { kind: 'item', id }                      an inventory object (equipment_list[].id)
//   { kind: 'spell', book, level, name }      a known spell in a spellbook (SheetTabSpells)
//   { kind: 'feature', name, listKey?, fk? }  a feat / class feature (fk = feature-sheet kind)
//   { kind: 'roll', roll }                    'init' | 'fort' | 'ref' | 'will' | 'cmb' |
//                                             'melee' | 'ranged' | 'skill:<id>'
// A pin whose target is gone (item sold, spell dropped) stays visible, dimmed, until unpinned —
// silently dropping it would make the strip rearrange itself for no visible reason.
window.SheetQuickbar = (function () {
    'use strict';
    const { h } = window.SheetUI;

    const ROLLS = [
        ['init', 'Initiative'], ['fort', 'Fortitude'], ['ref', 'Reflex'], ['will', 'Will'],
        ['cmb', 'CMB'], ['melee', 'Melee attack'], ['ranged', 'Ranged attack'],
    ];

    function pins(data) {
        const st = window.SheetState.sheetState(data);
        if (!Array.isArray(st.quickbar)) st.quickbar = [];
        return st.quickbar;
    }
    const refKey = (r) => {
        if (!r) return '';
        if (r.kind === 'item') return `item:${r.id}`;
        if (r.kind === 'spell') return `spell:${r.book}:${r.level}:${String(r.name).toLowerCase()}`;
        if (r.kind === 'feature') return `feature:${String(r.name).toLowerCase()}`;
        return `roll:${r.roll}`;
    };
    const isPinned = (data, ref) => pins(data).some((p) => refKey(p) === refKey(ref));
    function setPinned(data, ref, on) {
        const list = pins(data);
        const k = refKey(ref);
        const at = list.findIndex((p) => refKey(p) === k);
        if (on && at < 0) list.push({ ...ref });
        if (!on && at >= 0) list.splice(at, 1);
        window.SheetState.quietSave();
    }

    // ---------------------------------------------------------------- resolution
    const fmtMod = (n) => (n >= 0 ? '+' : '') + n;
    function rollTotal(data, roll) {
        if (roll.startsWith('skill:')) {
            const r = window.SheetFormula?.evaluate?.(`@skills.${roll.slice(6)}.mod`, data);
            return r?.ok ? Number(r.value) || 0 : 0;
        }
        return Number(window.SheetDerive.computeDerived(data).blocks?.[roll]?.total) || 0;
    }
    function rollLabel(roll) {
        if (roll.startsWith('skill:')) {
            const id = roll.slice(6);
            return (window.SheetData.ALL_SKILLS || []).find((s) => s.id === id)?.name || id;
        }
        return (ROLLS.find(([k]) => k === roll) || [, roll])[1];
    }
    const findItem = (data, id) => (data.equipment_list || [])
        .find((x) => x && typeof x === 'object' && x.id === id) || null;

    /** What a pin is right now: { label, icon, badge, title, use(), open(), gone }. */
    function resolve(data, ref) {
        const S = window.SheetState;
        const rerender = () => window.SheetApp.renderSheet(data);
        if (ref.kind === 'item') {
            const item = findItem(data, ref.id);
            if (!item) return { gone: true, label: ref.label || 'Item', icon: '🎒' };
            const cat = window.SheetInventoryModel.inventoryCategory(item);
            const pool = item.chargeSource
                ? S.resolveChargePool?.(data, { kind: 'item', id: item.id }) : null;
            const ch = item.charges || {};
            const hasCharges = ch.value != null || ch.max != null;
            let badge = '';
            if (pool?.linked) badge = `${pool.value}/${pool.max || '?'}`;
            else if (hasCharges) badge = `${Number(ch.value) || 0}/${Number(ch.max) || '?'}`;
            else if (cat === 'consumables' || Number(item.quantity) !== 1) badge = `×${Number(item.quantity) || 0}`;
            const open = () => window.SheetModals.openItemSheet(data, item);
            const usable = pool?.linked || hasCharges || item.spellItem;
            if (cat === 'weapons') {
                return {
                    label: item.name, icon: '⚔', badge, open,
                    title: `Attack with ${item.name} (attack + damage)`,
                    use: () => {
                        window.SheetRoll.setOpen?.(true);
                        window.SheetRoll.rollWeaponAttackFor(item.id, { withDamage: true });
                    },
                };
            }
            if (usable) {
                return {
                    label: item.name, icon: cat === 'consumables' ? '🧪' : '✧', badge, open,
                    title: `Use ${item.name} (spends one)`,
                    use: () => {
                        const toast = (msg) => window.SheetOverlay?.toast?.(`${item.name}: ${msg}`);
                        if (window.SheetModals.useInventoryItem(data, item, { fail: toast })) rerender();
                    },
                };
            }
            return { label: item.name, icon: '🎒', badge, open, use: open, title: `Open ${item.name}` };
        }
        if (ref.kind === 'spell') {
            const TS = window.SheetTabSpells;
            const left = TS.spellSlotsLeft(data, ref.book, ref.level);
            const known = TS.pinnableSpells(data)
                .some((s) => s.book === ref.book && s.level === ref.level && s.name === ref.name);
            if (left === undefined || !known) return { gone: true, label: ref.name, icon: '✦' };
            return {
                label: ref.name, icon: '✦',
                badge: left === null ? '∞' : `${left} left`,
                title: `Cast ${ref.name} (level ${ref.level})`,
                use: () => TS.quickCast(data, ref.book, ref.level, ref.name),
                open: () => TS.openSpellSheet(data, ref.book, ref.level, ref.name),
            };
        }
        if (ref.kind === 'feature') {
            const has = S.hasFeaturePool?.(data, ref.name);
            const pool = has ? S.resolveChargePool?.(data, { kind: 'feature', name: ref.name }) : null;
            const SD = window.SheetDetails;
            const desc = SD?.lookup?.('feats', ref.name)?.description
                || SD?.lookup?.('classFeatures', ref.name)?.description || '';
            return {
                label: ref.name, icon: '★',
                badge: pool ? `${pool.value}/${pool.max || '?'}` : '',
                title: `Use ${ref.name}` + (pool ? ' (posts its card with a Use button)' : ' (posts its card)'),
                use: () => {
                    window.SheetRoll.setOpen?.(true);
                    window.SheetRoll.postFeatureCard({
                        name: ref.name, title: ref.name, typeLabel: ref.fk === 'classFeat' ? 'Class feature' : 'Feat', descHtml: desc,
                    });
                },
                open: () => window.SheetFeatureSheet.openFeatureSheet(data, {
                    kind: ref.fk || 'feat', name: ref.name, listKey: ref.listKey, sourceKind: ref.fk || 'feat',
                }),
            };
        }
        // roll
        const total = rollTotal(data, ref.roll);
        const label = rollLabel(ref.roll);
        const roll = () => window.SheetStatKit.rollCheck(label + (ref.roll.startsWith('skill:') ? ' check' : ''), total);
        return {
            label, icon: '🎲', badge: fmtMod(total), title: `Roll ${label} (1d20${fmtMod(total)})`,
            use: roll,
            open: () => window.SheetApp.setActiveTab(ref.roll.startsWith('skill:') ? 'skills'
                : ['fort', 'ref', 'will'].includes(ref.roll) ? 'defenses' : 'combat'),
        };
    }

    // ---------------------------------------------------------------- the strip
    function render(host, data) {
        const bar = h('div', 'quickbar no-print');
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Pinned quick actions');
        bar.appendChild(h('span', 'quickbar-label', 'Pinned'));
        const list = pins(data);
        list.forEach((ref, idx) => {
            const r = resolve(data, ref);
            const chip = h('span', 'qb-pin' + (r.gone ? ' is-gone' : ''));
            chip.dataset.pin = refKey(ref);
            const use = h('button', 'qb-use');
            use.type = 'button';
            use.appendChild(h('span', 'qb-icon', r.icon));
            use.appendChild(h('span', 'qb-name', r.label));
            if (r.badge) use.appendChild(h('span', 'qb-badge', r.badge));
            if (r.gone) {
                use.disabled = true;
                use.title = `${r.label} is no longer on this character — × to unpin`;
            } else {
                use.title = `${r.title} · right-click to open`;
                use.addEventListener('click', () => r.use());
                use.addEventListener('contextmenu', (ev) => {
                    ev.preventDefault();
                    r.open();
                });
            }
            const rm = h('button', 'qb-unpin', '×');
            rm.type = 'button';
            rm.title = 'Unpin';
            rm.setAttribute('aria-label', `Unpin ${r.label}`);
            rm.addEventListener('click', () => {
                list.splice(idx, 1);
                window.SheetState.quietSave();
                window.SheetApp.renderSheet(data);
                window.SheetOverlay?.toast?.(`Unpinned ${r.label}`, {
                    action: {
                        label: 'Undo',
                        onClick: () => {
                            list.splice(Math.min(idx, list.length), 0, ref);
                            window.SheetState.quietSave();
                            window.SheetApp.renderSheet(data);
                        },
                    },
                });
            });
            chip.append(use, rm);
            bar.appendChild(chip);
        });
        const add = h('button', 'qb-add', list.length ? '+ Pin…' : '+ Pin an item, spell, feature or roll');
        add.type = 'button';
        add.title = 'Pin anything you use a lot here, one click away';
        add.addEventListener('click', () => openPicker(data));
        bar.appendChild(add);
        host.appendChild(bar);
    }

    // ---------------------------------------------------------------- the picker
    function candidates(data) {
        const out = [];
        for (const [roll, label] of ROLLS) out.push({ group: 'Rolls', label, ref: { kind: 'roll', roll } });
        for (const s of window.SheetData.ALL_SKILLS || []) {
            if (s.variant || s.subsystem) continue;
            out.push({ group: 'Rolls', label: s.name, sub: 'skill', ref: { kind: 'roll', roll: `skill:${s.id}` } });
        }
        for (const it of data.equipment_list || []) {
            if (!it || typeof it !== 'object' || !it.id) continue;
            const cat = window.SheetInventoryModel.inventoryCategory(it);
            out.push({ group: 'Items', label: it.name || 'Item', sub: cat, ref: { kind: 'item', id: it.id } });
        }
        for (const sp of window.SheetTabSpells?.pinnableSpells?.(data) || []) {
            out.push({
                group: 'Spells', label: sp.name, sub: `${sp.bookName} · level ${sp.level}`,
                ref: { kind: 'spell', book: sp.book, level: sp.level, name: sp.name },
            });
        }
        const seen = new Set();
        const addFeature = (name, listKey, fk, sub) => {
            const n = String(name || '').trim();
            if (!n || seen.has(n.toLowerCase())) return;
            seen.add(n.toLowerCase());
            out.push({ group: 'Features', label: n, sub, ref: { kind: 'feature', name: n, listKey, fk } });
        };
        // Pools first: Rage, Channel Energy, Ki — the features worth a one-click Use.
        for (const [name, u] of Object.entries(data._sheet?.featureUses || {})) {
            if (Number(u?.max) > 0) addFeature(name, undefined, 'classFeat', 'has uses');
        }
        for (const g of window.SheetData.FEAT_GROUPS || []) {
            for (const f of Array.isArray(data[g.listKey]) ? data[g.listKey] : []) {
                addFeature(typeof f === 'string' ? f : f?.name, g.listKey, 'feat', g.title);
            }
        }
        return out;
    }

    function openPicker(data) {
        const body = h('div', 'qb-picker');
        const search = h('input', 'edit-field qb-search');
        search.type = 'search';
        search.placeholder = 'Search items, spells, features, rolls…';
        search.setAttribute('aria-label', 'Search things to pin');
        body.appendChild(search);
        const results = h('div', 'qb-results');
        body.appendChild(results);
        const all = candidates(data);
        const paint = () => {
            const q = search.value.trim().toLowerCase();
            results.textContent = '';
            for (const group of ['Rolls', 'Items', 'Spells', 'Features']) {
                const rows = all.filter((c) => c.group === group
                    && (!q || c.label.toLowerCase().includes(q) || String(c.sub || '').toLowerCase().includes(q)));
                if (!rows.length) continue;
                results.appendChild(h('h4', 'qb-group', `${group} (${rows.length})`));
                const ul = h('ul', 'qb-list');
                for (const c of rows) {
                    const li = h('li', 'qb-row');
                    const btn = h('button', 'qb-toggle');
                    btn.type = 'button';
                    const on = isPinned(data, c.ref);
                    btn.setAttribute('aria-pressed', String(on));
                    btn.dataset.pin = refKey(c.ref);
                    btn.appendChild(h('span', 'qb-toggle-mark', on ? '📌' : '＋'));
                    btn.appendChild(h('span', 'qb-toggle-name', c.label));
                    if (c.sub) btn.appendChild(h('span', 'qb-toggle-sub dim', c.sub));
                    btn.title = on ? 'Pinned — click to unpin' : 'Click to pin to Summary';
                    btn.addEventListener('click', () => {
                        setPinned(data, c.ref, !isPinned(data, c.ref));
                        paint();
                    });
                    li.appendChild(btn);
                    ul.appendChild(li);
                }
                results.appendChild(ul);
            }
            if (!results.childNodes.length) results.appendChild(h('p', 'dim', 'Nothing matches.'));
        };
        search.addEventListener('input', paint);
        paint();
        const done = h('button', 'tools-quick', 'Done');
        done.type = 'button';
        const handle = window.SheetOverlay.open({
            title: 'Pin to Quick Actions',
            body,
            footer: [done],
            onClose: () => window.SheetApp.renderSheet(data),
        });
        done.addEventListener('click', () => handle.close());
        requestAnimationFrame(() => search.focus());
        return handle;
    }

    return { render, openPicker, pins, isPinned, setPinned, resolve, refKey };
})();
