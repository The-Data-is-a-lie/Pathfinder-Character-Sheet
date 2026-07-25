// scripts/domain/inventory-model.js -- the inventory data model (window.SheetInventoryModel):
// item categorization + slot labels, the category order/type tables, the enhancement-suffix
// gearLine, and adding / core-gear-migrating items. Part D.1: modals-free (the DOM item rows and
// the openItemSheet coupling stay in the inventory tab), loaded before modals so the Inventory
// tab, Combat, Defenses, the simple sheet and modals import the model directly. Item lookups use
// window.SheetDetails at call time.
window.SheetInventoryModel = (function () {
    'use strict';
    const { cloneChanges, nonEmpty } = window.SheetUI;
    const { quietSave, ensureInventoryObjects } = window.SheetState;

    const gearLine = (name, enhList) => name && name.trim()
        ? name + (nonEmpty(enhList) ? ' [' + enhList.join(', ') + ']' : '') : null;
    function addInventoryItem(data, name) {
        const nm = String(name || '').trim();
        if (!nm) return null;
        ensureInventoryObjects(data);
        const foundry = window.SheetDetails?.lookupItem?.(nm);
        const item = {
            id: 'eq:' + nm.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(),
            name: foundry?.name || nm,
            equipped: true,
            carried: true,
            identified: true,
            quantity: 1,
            weight: foundry?.weight != null ? Number(foundry.weight) : null,
            price: foundry?.price != null ? Number(foundry.price) : null,
            description: foundry?.description || '',
            changes: cloneChanges(foundry?.changes),
            contextNotes: (foundry?.contextNotes || []).map((n) => ({ ...n })),
            changesCustomized: false,
            subType: foundry?.subType || '',
            equipmentSubtype: foundry?.equipmentSubtype || '',
            armor: foundry?.armor ? { ...foundry.armor } : null,
            slot: foundry?.slot || '',
            itemType: foundry?.itemType || '',
            containerId: null,
        };
        data.equipment_list.push(item);
        if (item.description) (data.equip_descrip ??= {})[item.name] = item.description;
        quietSave();
        return item;
    }
    /**
     * One-time migration: the generated weapon / armor / shield (weapon_name & co.)
     * become regular equipment_list items with full item sheets. Combat math keeps
     * reading data.weapon_name — only the inventory display moves into the list.
     */
    function migrateCoreGear(data) {
        const st = (data._sheet ??= {});
        if (st.coreGearMigrated) return;
        st.coreGearMigrated = true;
        const list = ensureInventoryObjects(data);
        let touched = false;
        const seed = (name, enhList, slot) => {
            const nm = String(name || '').trim();
            if (!nm || /^(none|n\/a|-)$/i.test(nm)) return;
            const display = gearLine(nm, enhList) || nm;
            const has = (v) => list.some((it) =>
                String(it.name).toLowerCase() === String(v).toLowerCase());
            if (has(display) || has(nm)) return;
            const it = addInventoryItem(data, nm); // hydrates from the compendium
            if (!it) return;
            if (display !== nm) it.name = display; // keep the enhancement suffix visible
            if (!it.slot) it.slot = slot;
            if (!it.itemType) it.itemType = slot === 'weapon' ? 'weapon' : 'equipment';
            it.equipped = true;
            touched = true;
        };
        seed(data.weapon_name, data.weapon_enhancement_chosen_list, 'weapon');
        seed(data.armor_name, data.armor_enhancement_chosen_list, 'armor');
        seed(data.shield_name, data.shield_enhancement_chosen_list, 'shield');
        if (touched) quietSave();
    }
    /** Foundry-style inventory category for grouping. */
    function inventoryCategory(item) {
        const t = String(item.itemType || '').toLowerCase();
        const slot = String(item.slot || '').toLowerCase();
        const sub = String(item.subType || '').toLowerCase();
        if (t === 'weapon' || slot === 'weapon' || sub === 'weapon') return 'weapons';
        if (t === 'armor' || slot === 'armor' || slot === 'shield'
            || sub === 'armor' || sub === 'shield') return 'armor';
        if (t === 'container' || sub === 'container') return 'containers';
        if (t === 'consumable' || sub === 'potion' || sub === 'scroll' || sub === 'wand'
            || sub === 'consumable') return 'consumables';
        if (t === 'equipment' || t === 'loot' || t === 'implants') return 'equipment';
        const SD = window.SheetDetails;
        if (SD?.lookupWeapon?.(item.name)) return 'weapons';
        const fi = SD?.lookupItem?.(item.name);
        if (fi?.itemType === 'weapon') return 'weapons';
        if (fi?.itemType === 'armor' || fi?.slot === 'armor' || fi?.slot === 'shield') return 'armor';
        if (fi?.itemType === 'container') return 'containers';
        if (fi?.itemType === 'consumable') return 'consumables';
        return 'equipment';
    }
    const INV_CATEGORY_ORDER = [
        ['weapons', 'Weapons'],
        ['armor', 'Armor & Shields'],
        ['equipment', 'Equipment'],
        ['consumables', 'Consumables'],
        ['containers', 'Containers'],
    ];
    /** Slot / type column label (Belt, Ring, Armor, …). */
    function invSlotLabel(item) {
        let s = String(item.slot || item.subType || '').replace(/[_-]+/g, ' ').trim();
        if (!s || s === 'none' || s === 'slotless') return '';
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
    // Category → itemType preset for the per-category "+" add buttons.
    const INV_CAT_ITEMTYPE = {
        weapons: 'weapon', armor: 'armor', equipment: 'equipment',
        consumables: 'consumable', containers: 'container',
    };

    return {
        inventoryCategory, invSlotLabel, addInventoryItem, migrateCoreGear, gearLine,
        INV_CATEGORY_ORDER, INV_CAT_ITEMTYPE,
    };
})();
