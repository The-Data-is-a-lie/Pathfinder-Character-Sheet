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
     * The coin purse, normalized once per character. The backend reports the *same* money
     * twice — `gold` as the gp total and the legacy-misspelled `platnium` as gold / 10 — so
     * rendering both boxes doubled the purse. Gold is the single source of truth: when the
     * two agree to within a coin, the derived platinum is dropped. Guarded by a _sheet flag
     * so a PP amount the user enters later is never clobbered.
     */
    function normalizeCurrency(data) {
        if (data.platinum == null && data.platnium != null) data.platinum = data.platnium;
        const st = (data._sheet ??= {});
        if (!st.currencyNormalized) {
            st.currencyNormalized = true;
            const gp = Number(data.gold) || 0;
            const pp = Number(data.platinum) || 0;
            if (gp > 0 && pp > 0 && Math.abs(pp * 10 - gp) <= 0.5) {
                data.platinum = 0;
                data.platnium = 0;
            }
        }
        for (const key of ['platinum', 'gold', 'silver', 'copper']) {
            if (data[key] == null || data[key] === '') data[key] = 0;
        }
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
    // ------------------------------------------- container nesting & coin weight (#10)
    const WEIGHTLESS_CONTAINERS = /bag of holding|handy haversack|efficient quiver|portable hole/i;
    /** "Contents don't count" — explicit flag wins; known magical containers default on. */
    function containerWeightless(item) {
        if (typeof item?.contentsWeightless === 'boolean') return item.contentsWeightless;
        return WEIGHTLESS_CONTAINERS.test(String(item?.name || ''));
    }
    function containerOf(list, item) {
        if (!item?.containerId) return null;
        return (list || []).find((it) => it && typeof it === 'object'
            && it.id === item.containerId) || null;
    }
    /** Contents inherit the container's carried state (drop the bag, drop the lot). */
    function effectiveCarried(list, item, depth = 0) {
        const c = depth < 6 ? containerOf(list, item) : null;
        if (c) return effectiveCarried(list, c, depth + 1);
        return item?.carried !== false;
    }
    /** Whether this item's weight counts (false inside a weightless container). */
    function weightCounts(list, item, depth = 0) {
        const c = depth < 6 ? containerOf(list, item) : null;
        if (!c) return true;
        if (containerWeightless(c)) return false;
        return weightCounts(list, c, depth + 1);
    }
    /** PF1: 50 coins = 1 lb, all denominations. On by default; Settings toggle. */
    function coinWeightEnabled() {
        try { return localStorage.getItem('sheet.coinWeight') !== 'off'; } catch { return true; }
    }
    function coinWeightLbs(data) {
        if (!coinWeightEnabled()) return 0;
        const coins = ['platinum', 'gold', 'silver', 'copper']
            .reduce((a, k) => a + (Number(data?.[k]) || 0), 0);
        return coins / 50;
    }

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
        normalizeCurrency,
        containerWeightless, containerOf, effectiveCarried, weightCounts,
        coinWeightEnabled, coinWeightLbs,
        INV_CATEGORY_ORDER, INV_CAT_ITEMTYPE,
    };
})();
