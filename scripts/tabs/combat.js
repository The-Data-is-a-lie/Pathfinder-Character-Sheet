// scripts/tabs/combat.js -- the Combat tab: BAB iteratives, CMB/melee/ranged/init, weapon rows,
// attack roller (window.SheetTabCombat). Extracted from sheet.js (Part B split); body verbatim.
// Weapon rows reuse the inventory helpers (inventoryCategory / renderInventoryItemCard) via
// SheetApp, re-pointed when inventory.js lands. rollBtn / renderSheet / setActiveTab late-bind too.
window.SheetTabCombat = (function () {
    'use strict';
    const { h, fmt, section, attachStatHint } = window.SheetUI;
    const { computeDerived, babIterativesStr } = window.SheetDerive;
    const { attachNotesHover, ensureInventoryObjects } = window.SheetState;
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const setActiveTab = (id) => window.SheetApp.setActiveTab(id);
    const { rollBtn } = window.SheetStatKit;
    const { inventoryCategory, migrateCoreGear } = window.SheetInventoryModel;
    const renderInventoryItemCard = (...a) => window.SheetApp.renderInventoryItemCard(...a);

    function tabCombat(data) {
        const d = computeDerived(data);
        const { sec, body } = section('Combat', 'combat');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Attack hub: bonus strip on top, weapon fields, and the attack roller. AC / saves / DR live on Defenses; HP and speeds on Summary.'));

        // Top strip: BAB iteratives + core attack bonuses (rollable where useful)
        const strip = h('div', 'summary-combat-strip combat-top-strip');
        const box = (label, value, opts = {}) => {
            const b = h('div', 'summary-stat-box');
            const head = h('div', 'summary-stat-head');
            head.appendChild(document.createTextNode(label + ' '));
            if (opts.rollTotal != null) {
                head.appendChild(rollBtn(opts.rollLabel || label, opts.rollTotal));
            }
            b.appendChild(head);
            b.appendChild(h('div', 'summary-stat-val', value));
            attachStatHint(b, label);
            if (opts.title) b.title = opts.title;
            strip.appendChild(b);
            return b;
        };
        box('BAB', babIterativesStr(d.bab), { title: 'Iterative attacks (up to 4 shown)' });
        box('CMB', fmt(d.blocks.cmb.total), { rollTotal: d.blocks.cmb.total, rollLabel: 'CMB' });
        const meleeBox = box('Melee', fmt(d.blocks.melee.total),
            { rollTotal: d.blocks.melee.total, rollLabel: 'Melee attack' });
        attachNotesHover(meleeBox, data, ['attack', 'mattack']);
        const rangedBox = box('Ranged', fmt(d.blocks.ranged.total),
            { rollTotal: d.blocks.ranged.total, rollLabel: 'Ranged attack' });
        attachNotesHover(rangedBox, data, ['attack', 'rattack']);
        box('Init', fmt(d.blocks.init.total),
            { rollTotal: d.blocks.init.total, rollLabel: 'Initiative' });
        body.appendChild(strip);

        // Weapons — the same rows as Inventory (name / ⚙ opens the full item sheet)
        body.appendChild(h('h3', null, 'Weapons'));
        migrateCoreGear(data);
        const invList = ensureInventoryObjects(data);
        const weaponRows = [];
        invList.forEach((item, i) => {
            if (inventoryCategory(item) === 'weapons') weaponRows.push({ item, index: i });
        });
        if (weaponRows.length) {
            const pack = h('div', 'inv-list combat-weapons');
            for (const { item, index } of weaponRows) {
                pack.appendChild(renderInventoryItemCard(data, item, index));
            }
            body.appendChild(pack);
        } else {
            body.appendChild(h('p', 'dim no-print',
                'No weapons in inventory — add one on the Inventory tab (Browse items → Weapons).'));
        }

        body.appendChild(h('h3', null, 'Attack'));
        const attackHost = h('div', null);
        attackHost.id = 'combat-attack-panel';
        body.appendChild(attackHost);
        window.SheetRoll?.renderAttackCard?.(attackHost, {
            showConditionals: true,
            showGeneric: true,
        });

        return sec;
    }

    return { tabCombat };
})();
