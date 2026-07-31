// scripts/tabs/inventory.js -- the Inventory tab: currency bar, category groups, item rows,
// weight/load footer + the core-gear migration and gearLine helper (window.SheetTabInventory).
// Extracted from sheet.js (Part B split); bodies verbatim except currentData reads (via
// SheetApp.current). Its helpers (inventoryCategory / invRerender / renderInventoryItemCard /
// migrateCoreGear / addInventoryItem / gearLine) are consumed by combat/defenses/simple and
// modals via SheetApp -- the shell destructure re-points those delegates here.
window.SheetTabInventory = (function () {
    'use strict';
    const {
        h, section, dblclickEditable, parseIntLoose, fmtWeight, fmtPrice, cloneChanges,
        dndHandle, bindDragReorder, reorderArray, nonEmpty, fmt,
    } = window.SheetUI;
    const { loadCategory, carryLimits, abilityInfo } = window.SheetDerive;
    // Carrying capacity keys off the *effective* Strength (belt of giant strength included),
    // not the raw base score.
    const effStr = (data) => abilityInfo(data, 'str').total ?? data.str;
    const { quietSave, ensureInventoryObjects } = window.SheetState;
    const {
        openItemSheet, addBlankInventoryItem, formatChangeLine, sectionCatalogToolbar,
        openCatalogPicker,
    } = window.SheetModals;
    const {
        inventoryCategory, invSlotLabel, addInventoryItem, migrateCoreGear, gearLine,
        normalizeCurrency, INV_CATEGORY_ORDER, INV_CAT_ITEMTYPE,
    } = window.SheetInventoryModel;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);

    function invRerender(data) {
        // renderSheet restores the active tab itself — don't force a jump to Inventory
        // (inventory-style weapon rows also live on the Combat tab).
        renderSheet(data);
    }
    /** Checkbox cell for the identified / carried / equipped columns. */
    function invCheckCell(checked, title, onChange) {
        const wrap = h('span', 'inv-check');
        const cb = h('input');
        cb.type = 'checkbox';
        cb.checked = checked;
        cb.title = title;
        cb.setAttribute('aria-label', title);
        cb.addEventListener('change', () => onChange(cb.checked));
        wrap.appendChild(cb);
        return wrap;
    }
    function renderInventoryItemCard(data, item, index) {
        const SD = window.SheetDetails;
        const card = h('div', 'inv-item dnd-item'
            + (item.equipped ? ' is-equipped' : ' is-unequipped')
            + (item.carried === false ? ' is-stowed' : '')
            + (item.identified === false ? ' is-unidentified' : ''));
        card.dataset.invId = item.id || String(index);
        card.dataset.dndId = item.id || String(index);

        // Table row: handle · qty(−/+) · name · slot · weight · value · ✓id · ✓carried · ✓equipped · actions
        const row = h('div', 'inv-row');
        row.appendChild(dndHandle());

        const qtyCell = h('span', 'inv-qty');
        if (item.quantity == null) item.quantity = 1;
        const stepQty = (d) => {
            // Floor 0, not 1: quantity 0 is real for ammo (quiver shot dry).
            item.quantity = Math.max(0, (Number(item.quantity) || 0) + d);
            quietSave();
            invRerender(data);
        };
        const minusBtn = h('button', 'inv-step no-print', '−');
        minusBtn.type = 'button';
        minusBtn.title = 'Decrease quantity';
        minusBtn.addEventListener('click', () => stepQty(-1));
        const plusBtn = h('button', 'inv-step no-print', '+');
        plusBtn.type = 'button';
        plusBtn.title = 'Increase quantity';
        plusBtn.addEventListener('click', () => stepQty(1));
        qtyCell.appendChild(minusBtn);
        qtyCell.appendChild(dblclickEditable(item, 'quantity', {
            type: 'number', min: 0, max: 999,
            format: (v) => String(v == null || v === '' ? 1 : v),
            parse: (s) => Math.max(0, parseIntLoose(s, 1)),
            onChange: () => quietSave(),
        }));
        qtyCell.appendChild(plusBtn);
        row.appendChild(qtyCell);

        const nameEl = h('span', 'inv-item-name');
        // Foundry behavior: clicking the name opens the item sheet (rename lives there).
        const nameBtn = h('button', 'inv-item-open',
            item.identified === false ? (item.unidName || 'Unidentified item') : (item.name || '—'));
        nameBtn.type = 'button';
        nameBtn.title = 'Open item sheet';
        nameBtn.addEventListener('click', () => openItemSheet(data, item));
        nameEl.appendChild(nameBtn);
        const buffBits = (item.changes || []).map((c) => formatChangeLine(c, SD));
        if (buffBits.length) {
            const buffMark = h('span', 'inv-buff-mark', '✦');
            buffMark.title = 'Buffs while equipped: ' + buffBits.join('; ');
            nameEl.appendChild(buffMark);
        }
        row.appendChild(nameEl);

        row.appendChild(h('span', 'inv-slot', invSlotLabel(item)));

        row.appendChild(h('span', 'inv-weight', fmtWeight(
            (Number(item.weight) || 0) * (Number(item.quantity) || 1))));

        const priceCell = h('span', 'inv-price');
        priceCell.appendChild(dblclickEditable(item, 'price', {
            type: 'number', min: 0,
            format: (v) => fmtPrice(v),
            parse: (s) => {
                const n = parseFloat(String(s).replace(/[^\d.-]/g, ''));
                return Number.isFinite(n) ? n : null;
            },
            onChange: () => quietSave(),
        }));
        row.appendChild(priceCell);

        row.appendChild(invCheckCell(item.identified !== false,
            'Identified (known vs mystery item)', (on) => {
                item.identified = on;
                quietSave();
                invRerender(data);
            }));
        row.appendChild(invCheckCell(item.carried !== false,
            'Carried (stowed items do not count for encumbrance)', (on) => {
                item.carried = on;
                quietSave();
                invRerender(data);
            }));
        row.appendChild(invCheckCell(!!item.equipped,
            'Equipped (applies the item buffs)', (on) => {
                item.equipped = on;
                quietSave();
                invRerender(data);
            }));

        const btns = h('div', 'inv-item-actions no-print');
        const buffsBtn = h('button', 'inv-icon-btn', '⚙');
        buffsBtn.type = 'button';
        buffsBtn.title = 'Open item sheet';
        buffsBtn.addEventListener('click', () => openItemSheet(data, item));
        const removeBtn = h('button', 'inv-icon-btn inv-btn-danger', '×');
        removeBtn.type = 'button';
        removeBtn.title = 'Remove from inventory';
        removeBtn.addEventListener('click', () => {
            if (!confirm(`Remove “${item.name}” from inventory?`)) return;
            const list = data.equipment_list || [];
            const idx = list.indexOf(item);
            if (idx >= 0) list.splice(idx, 1);
            else if (index >= 0 && index < list.length) list.splice(index, 1);
            quietSave();
            invRerender(data);
        });
        btns.append(buffsBtn, removeBtn);
        row.appendChild(btns);

        // The full description lives in the item sheet (open via the ⚙ button); the
        // inline row expander was removed. Unidentified items still get a hint here.
        if (item.identified === false) {
            row.appendChild(h('span', 'dim inv-unid-hint', '(unidentified)'));
        }
        card.appendChild(row);
        return card;
    }
    /** Currency bar pinned at the top of the Inventory tab: PP · GP · SP · CP inputs. */
    function invCurrencyBar(data) {
        normalizeCurrency(data);
        const bar = h('div', 'inv-currency-bar');
        bar.appendChild(h('span', 'inv-currency-title', 'Currency'));
        for (const [label, key] of [
            ['PP', 'platinum'],
            ['GP', 'gold'],
            ['SP', 'silver'],
            ['CP', 'copper'],
        ]) {
            if (data[key] == null || data[key] === '') data[key] = 0;
            const box = h('label', 'inv-currency-box');
            box.appendChild(h('span', 'inv-currency-label', label));
            const input = h('input', 'inv-currency-input');
            input.type = 'number';
            input.min = '0';
            input.value = String(Number(data[key]) || 0);
            input.addEventListener('change', () => {
                data[key] = Math.max(0, parseIntLoose(input.value, 0));
                input.value = String(data[key]);
                if (key === 'platinum') data.platnium = data.platinum; // keep legacy in sync
                quietSave();
            });
            box.appendChild(input);
            bar.appendChild(box);
        }
        return bar;
    }
    function renderGear(data) {
        const { sec, body } = section('Inventory', 'inventory-tab');

        body.appendChild(invCurrencyBar(data));

        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Add items with Browse or a category +. Drag ⋮⋮ to reorder. Checkboxes: identified · carried · equipped (equip applies buffs).'));

        const filterIn = h('input', 'edit-field inv-filter');
        filterIn.type = 'search';
        filterIn.placeholder = 'Search filter…';
        filterIn.addEventListener('input', () => {
            const q = filterIn.value.toLowerCase().trim();
            body.querySelectorAll('.inv-item').forEach((el) => {
                const n = (el.querySelector('.inv-item-name')?.textContent
                    || el.textContent || '').toLowerCase();
                el.style.display = !q || n.includes(q) ? '' : 'none';
            });
        });

        // Category jump links (scroll to the section header)
        const catNav = h('div', 'inv-cat-nav no-print');
        for (const [cat, label] of INV_CATEGORY_ORDER) {
            const btn = h('button', 'inv-cat-link', label);
            btn.type = 'button';
            btn.dataset.invNav = cat;
            btn.addEventListener('click', () => {
                body.querySelector(`[data-inv-cat="${cat}"]`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            catNav.appendChild(btn);
        }
        const toolbarExtra = h('div', 'inv-toolbar-extra');
        toolbarExtra.append(filterIn, catNav);

        body.appendChild(sectionCatalogToolbar({
            browseLabel: 'Browse items',
            browseTitle: 'Search weapons & equipment',
            extra: toolbarExtra,
            picker: {
                title: 'Add inventory item',
                kinds: ['items', 'weapons'],
                allowCustom: true,
                customPlaceholder: 'Custom item name',
                onPick: (hit) => {
                    addInventoryItem(data, hit.name);
                    invRerender(data);
                },
                onCustom: (name) => {
                    addInventoryItem(data, name);
                    invRerender(data);
                },
                onBlank: () => {
                    const it = addBlankInventoryItem(data);
                    invRerender(data);
                    openItemSheet(data, it);
                },
            },
        }));

        // Generated weapon / armor / shield live in the list as regular items
        // (migrated once) — no separate core-slots block.
        migrateCoreGear(data);

        const list = ensureInventoryObjects(data);
        if (!list.length) {
            body.appendChild(h('p', 'dim no-print', 'No items yet — use Browse or a category + below.'));
        }

        // Group by category (display only; list order preserved within groups
        // via original indices for reorder — reorder stays within each section list).
        const groups = new Map();
        list.forEach((item, i) => {
            const cat = inventoryCategory(item);
            if (!groups.has(cat)) groups.set(cat, []);
            groups.get(cat).push({ item, index: i });
        });

        let totalWeight = 0;
        for (const [cat, label] of INV_CATEGORY_ORDER) {
            const entries = groups.get(cat) || [];
            const secWrap = h('div', 'inv-category');
            secWrap.dataset.invCat = cat;

            // Category header row: title + column captions + per-category add button.
            const head = h('div', 'inv-row inv-cat-head');
            head.appendChild(h('span'));           // handle col
            head.appendChild(h('span', 'inv-col-cap', 'Qty'));
            head.appendChild(h('span', 'inv-cat-title',
                label + (entries.length ? ' (' + entries.length + ')' : '')));
            head.appendChild(h('span', 'inv-col-cap', 'Slot'));
            head.appendChild(h('span', 'inv-col-cap inv-col-cap-right', 'Weight'));
            head.appendChild(h('span', 'inv-col-cap inv-col-cap-right', 'Value'));
            head.appendChild(h('span', 'inv-col-cap inv-col-cap-mid', 'ID'));
            head.appendChild(h('span', 'inv-col-cap inv-col-cap-mid', 'Car'));
            head.appendChild(h('span', 'inv-col-cap inv-col-cap-mid', 'Eq'));
            const addWrap = h('span', 'inv-cat-add no-print');
            const addBtn = h('button', 'inv-icon-btn inv-add-btn', '+');
            addBtn.type = 'button';
            addBtn.title = 'Add to ' + label.toLowerCase();
            addBtn.addEventListener('click', () => openCatalogPicker({
                title: 'Add — ' + label.toLowerCase(),
                kinds: cat === 'weapons' ? ['weapons', 'items'] : ['items', 'weapons'],
                allowCustom: true,
                customPlaceholder: 'Custom item name',
                onPick: (hit) => {
                    const it = addInventoryItem(data, hit.name);
                    // Known items keep their natural category; unknowns land here.
                    if (it && inventoryCategory(it) !== cat && INV_CAT_ITEMTYPE[cat]) {
                        it.itemType = INV_CAT_ITEMTYPE[cat];
                        quietSave();
                    }
                    invRerender(data);
                },
                onCustom: (name) => {
                    const it = addInventoryItem(data, name);
                    if (it && INV_CAT_ITEMTYPE[cat]) {
                        it.itemType = INV_CAT_ITEMTYPE[cat];
                        quietSave();
                    }
                    invRerender(data);
                },
                onBlank: () => {
                    const it = addBlankInventoryItem(data, INV_CAT_ITEMTYPE[cat]);
                    invRerender(data);
                    openItemSheet(data, it);
                },
            }));
            addWrap.appendChild(addBtn);
            head.appendChild(addWrap);
            secWrap.appendChild(head);

            const pack = h('div', 'inv-list dnd-list');
            const IM = window.SheetInventoryModel;
            const addWeight = (item) => {
                if (!IM.effectiveCarried(list, item)) return;
                if (!IM.weightCounts(list, item)) return;
                if (item.weight != null && Number.isFinite(Number(item.weight))) {
                    totalWeight += Number(item.weight) * (Number(item.quantity) || 1);
                }
            };
            // #10: items inside a container render indented under it (whatever their own
            // category), so top-level rows only here; drag-reorder stays top-level too.
            const contents = (containerItem) => list
                .map((it, i) => ({ item: it, index: i }))
                .filter((e) => e.item && typeof e.item === 'object'
                    && e.item.containerId === containerItem.id);
            const renderContents = (containerItem, host, depth) => {
                const inside = contents(containerItem);
                if (!inside.length || depth > 4) return;
                const sub = h('div', 'inv-contained-list');
                for (const e of inside) {
                    sub.appendChild(renderInventoryItemCard(data, e.item, e.index));
                    addWeight(e.item);
                    renderContents(e.item, sub, depth + 1);
                }
                host.appendChild(sub);
            };
            const topEntries = entries.filter((e) => !IM.containerOf(list, e.item));
            for (const { item, index } of topEntries) {
                const card = renderInventoryItemCard(data, item, index);
                const inside = contents(item);
                if (inside.length) {
                    const w = inside.reduce((a, e) => a
                        + (Number(e.item.weight) || 0) * (Number(e.item.quantity) || 1), 0);
                    card.title = `Contains ${inside.length} item${inside.length === 1 ? '' : 's'}`
                        + ` · ${w} lb inside`
                        + (IM.containerWeightless(item) ? ' (contents don’t count)' : '');
                }
                pack.appendChild(card);
                addWeight(item);
                renderContents(item, pack, 0);
            }
            // Reorder within category maps to equipment_list indices (top-level rows only —
            // contained rows live in nested .inv-contained-list wrappers this misses).
            bindDragReorder(pack, ':scope > .inv-item', (from, to) => {
                const fromId = topEntries[from]?.item?.id;
                const toId = topEntries[to]?.item?.id;
                const listNow = data.equipment_list || [];
                const fromIdx = listNow.findIndex((it) => it.id === fromId);
                const toIdx = listNow.findIndex((it) => it.id === toId);
                if (fromIdx < 0 || toIdx < 0) return;
                reorderArray(listNow, fromIdx, toIdx);
                quietSave();
                invRerender(data);
            });
            secWrap.appendChild(pack);
            body.appendChild(secWrap);
        }

        // #10: coins weigh 50/lb (all denominations) unless the Settings toggle is off.
        const coinLbs = Number(window.SheetInventoryModel.coinWeightLbs(data)) || 0;
        totalWeight += coinLbs;

        const load = loadCategory(totalWeight, effStr(data));
        const eqCount = list.filter((it) => it.equipped).length;
        const carried = list.filter((it) => it.carried !== false).length;
        const valueSum = list.reduce((sum, it) => {
            const p = Number(it.price);
            if (!Number.isFinite(p)) return sum;
            return sum + p * (Number(it.quantity) || 1);
        }, 0);

        const foot = h('div', 'inv-footer');

        const statLine = h('div', 'inv-foot-stats');
        statLine.appendChild(h('span', load.cls, `Carrying ${fmtWeight(totalWeight)}`));
        statLine.appendChild(h('span', 'dim',
            `${eqCount} equipped · ${carried} carried · ${list.length} total`
            + (coinLbs ? ` · Coins: ${fmtWeight(coinLbs)} (50/lb)` : '')
            + (valueSum ? ` · Total item value: ${fmtPrice(valueSum)}` : '')));
        foot.appendChild(statLine);

        // Encumbrance consequences are applied automatically (derive.js encumbrance) —
        // say so here where the load bar lives, so the numbers don't feel haunted.
        const encNow = window.SheetDerive.encumbrance(data);
        if (encNow.maxDex != null) {
            foot.appendChild(h('p', 'dim inv-load-consequences',
                `${encNow.label} load: max Dex +${encNow.maxDex} to AC, −${encNow.acp} check `
                + 'penalty, reduced speed — applied to the sheet automatically.'));
        }

        // Load bar: Light / Medium / Heavy segments; the current band is highlighted.
        const bar = h('div', 'inv-load-bar');
        for (const [segLabel, limit, cls] of [
            ['Light Load', load.lim.light, 'load-light'],
            ['Medium Load', load.lim.medium, 'load-medium'],
            ['Heavy Load', load.lim.heavy, 'load-heavy'],
        ]) {
            const seg = h('span', 'inv-load-seg ' + cls
                + (load.label.startsWith(segLabel.split(' ')[0]) ? ' is-active' : '')
                + (load.label === 'Over capacity' ? ' is-over' : ''),
                `${segLabel} (${limit})`);
            seg.title = `${segLabel}: up to ${limit} lbs`;
            bar.appendChild(seg);
        }
        foot.appendChild(bar);

        // Lift & drag capacities (PF1: above head = heavy; off ground = ×2; drag & push = ×5)
        const caps = h('div', 'inv-capacity-row');
        for (const [capLabel, val] of [
            ['Above Head', load.lim.heavy],
            ['Off Ground', load.lim.heavy * 2],
            ['Drag & Push', load.lim.heavy * 5],
        ]) {
            const box = h('div', 'inv-capacity-box');
            box.appendChild(h('span', 'inv-capacity-label', capLabel));
            box.appendChild(h('span', 'inv-capacity-value', String(val)));
            caps.appendChild(box);
        }
        foot.appendChild(caps);

        body.appendChild(foot);

        return sec;
    }

    return { renderGear, renderInventoryItemCard, invRerender };
})();
