// Ledger acceptance tests: inventory (item sheet, charges, flags, currency, encumbrance,
// enhancements) and the companion-adjacent features (shared buffs, mounted, eidolon evolutions).
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const pane = (page, tab) => page.locator(`.tab-pane[data-tab="${tab}"]`);

/** Push an inventory item and repaint; returns nothing, the item is found by id afterwards. */
async function addItem(page, item) {
    await page.evaluate((it) => {
        const d = window.SheetApp.current;
        d.equipment_list.push({ quantity: 1, equipped: true, carried: true, identified: true, ...it });
        window.SheetApp.renderSheet(d);
    }, item);
}
const getItem = (page, id) => page.evaluate((i) => {
    const it = window.SheetApp.current.equipment_list.find((x) => x && x.id === i);
    return it ? JSON.parse(JSON.stringify(it)) : null;
}, id);
const openItem = (page, id) => page.evaluate((i) => {
    const d = window.SheetApp.current;
    window.SheetModals.openItemSheet(d, d.equipment_list.find((x) => x && x.id === i));
}, id);
const acTotal = (page) => page.evaluate(() => window.SheetDerive.computeDerived(window.SheetApp.current).blocks.ac.total);
const closeDrawer = (page) => page.evaluate(() => window.SheetRoll?.setOpen?.(false));

test('item sheet: tabs, and a Details edit persists and changes what the weapon rolls',
    feature('inventory.item-sheet'), async ({ page }) => {
        await openSheet(page, { fixture: 'mythic-fighter' });
        await addItem(page, { id: 'sheet-sword', name: 'Longsword', itemType: 'weapon', weight: 4 });
        await openItem(page, 'sheet-sword');
        const card = page.locator('#item-sheet-modal');
        await expect(card).toBeVisible();
        await expect(card.locator('.item-sheet-tab')).toHaveText(['Description', 'Details', 'Changes', 'Actions']);

        const before = await page.evaluate(() => window.SheetRoll.attackContext('sheet-sword').damageDice);
        expect(before).toBe('1d8');

        await card.locator('.item-sheet-tab', { hasText: 'Details' }).click();
        const dice = card.locator('label.item-sheet-stat', { hasText: 'Damage dice' }).locator('input');
        await expect(dice).toBeVisible();
        await dice.fill('3d6');
        await dice.blur();
        expect((await getItem(page, 'sheet-sword')).weapon.dice).toBe('3d6');
        // What the roller uses follows the override.
        expect(await page.evaluate(() => window.SheetRoll.attackContext('sheet-sword').damageDice)).toBe('3d6');

        // Weight (sidebar) persists on the item and moves the carried total.
        const w0 = await page.evaluate(() => window.SheetDerive.encumbrance(window.SheetApp.current).weight);
        const weight = card.locator('label.item-sheet-stat', { hasText: /^Weight/ }).locator('input');
        await weight.fill('14');
        await weight.blur();
        expect((await getItem(page, 'sheet-sword')).weight).toBe(14);
        expect(await page.evaluate(() => window.SheetDerive.encumbrance(window.SheetApp.current).weight)).toBe(w0 + 10);
    });

test('item charges: Use spends one; a "Wand of <spell>" posts a spell card',
    feature('inventory.charges'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await addItem(page, { id: 'wand-mm', name: 'Wand of Magic Missile', itemType: 'equipment',
            charges: { value: 3, max: 50 } });
        await openItem(page, 'wand-mm');
        const card = page.locator('#item-sheet-modal');
        const cardsBefore = await page.locator('#tools-log .roll-card').count();
        const use = card.locator('.item-use-btn');
        await expect(use).toBeVisible();
        await use.click();
        expect((await getItem(page, 'wand-mm')).charges.value).toBe(2);
        await expect(card.locator('.item-sheet-stat', { hasText: 'Charges' }).locator('input').first()).toHaveValue('2');
        // The spell card is posted to the roll log, titled with the wand and charges left.
        await expect(page.locator('#tools-log .roll-card')).toHaveCount(cardsBefore + 1);
        await expect(page.locator('#tools-log .roll-card').first()).toContainText('Wand of Magic Missile');
        await expect(page.locator('#tools-log .roll-card').first()).toContainText('2 charges left');
        await expect(page.locator('#tools-log .roll-card').first()).toContainText('Magic Missile');

        // Spending down to zero refuses, leaving the count where it was.
        const alerts = [];
        page.on('dialog', (dlg) => { alerts.push(dlg.message()); dlg.dismiss(); });
        await use.click();
        await use.click();
        await use.click();
        expect((await getItem(page, 'wand-mm')).charges.value).toBe(0);
        expect(alerts.length).toBeGreaterThan(0);
        expect(alerts[0]).toContain('No charges left');
    });

test('equipped flag: unticking an armor-class item removes its bonus from derived AC',
    feature('inventory.flags'), async ({ page }) => {
        await openSheet(page, { fixture: 'summoner' });
        const base = await acTotal(page);
        expect(base).toBe(14);
        await gotoTab(page, 'inventory');
        await closeDrawer(page);
        const row = pane(page, 'inventory').locator('.inv-item', { hasText: 'Amulet of Natural Armor +1' }).first();
        const equipped = row.locator('input[type=checkbox][title^="Equipped"]').first();
        await expect(equipped).toBeChecked();
        await equipped.uncheck();
        expect(await page.evaluate(() => window.SheetApp.current.equipment_list
            .find((x) => x.name === 'Amulet of Natural Armor +1').equipped)).toBe(false);
        expect(await acTotal(page)).toBe(base - 1);
        await pane(page, 'inventory').locator('.inv-item', { hasText: 'Amulet of Natural Armor +1' }).first()
            .locator('input[type=checkbox][title^="Equipped"]').first().check();
        expect(await acTotal(page)).toBe(base);
    });

test('currency: gold and platnium that agree are shown once, and a typed PP survives a re-render',
    feature('inventory.currency'), async ({ page }) => {
        await openSheet(page, { fixture: 'mythic-fighter' });
        // The backend's double count: platnium is gold / 10. Reset the once-per-character flag
        // so the load-time normalisation runs on this purse.
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d.gold = 1000;
            d.platnium = 100;
            delete d.platinum;
            delete d._sheet.currencyNormalized;
            window.SheetApp.renderSheet(d);
        });
        await gotoTab(page, 'inventory');
        await closeDrawer(page);
        const box = (label) => pane(page, 'inventory').locator('.inv-currency-box', { hasText: label }).locator('input');
        await expect(box('GP')).toHaveValue('1000');
        await expect(box('PP')).toHaveValue('0');
        expect(await page.evaluate(() => ({ p: window.SheetApp.current.platinum, l: window.SheetApp.current.platnium })))
            .toEqual({ p: 0, l: 0 });

        // A PP amount typed later must not be zeroed again by a re-render.
        await box('PP').fill('7');
        await box('PP').blur();
        expect(await page.evaluate(() => window.SheetApp.current.platinum)).toBe(7);
        await page.evaluate(() => {
            window.SheetApp.renderSheet(window.SheetApp.current);
            window.SheetApp.setActiveTab('inventory');
        });
        await expect(box('PP')).toHaveValue('7');
        await expect(box('GP')).toHaveValue('1000');
    });

test('encumbrance: heavy carry moves the load band, caps Dex to AC, and the footer says so',
    feature('inventory.encumbrance'), async ({ page }) => {
        await openSheet(page, { fixture: 'druid' });
        const start = await page.evaluate(() => {
            const e = window.SheetDerive.encumbrance(window.SheetApp.current);
            return { label: e.label, weight: e.weight, lim: e.lim, maxDex: e.maxDex };
        });
        expect(start.label).toBe('Light');
        expect(start.maxDex).toBeNull();
        const light = await acTotal(page);     // Dex +4 under hide armor (max Dex +4)

        // Medium load: Dex bonus to AC capped at +3.
        await addItem(page, { id: 'anvil', name: 'Anvil', itemType: 'loot', weight: start.lim.light - start.weight + 5 });
        const med = await page.evaluate(() => {
            const e = window.SheetDerive.encumbrance(window.SheetApp.current);
            return { label: e.label, maxDex: e.maxDex, acp: e.acp };
        });
        expect(med).toEqual({ label: 'Medium', maxDex: 3, acp: 3 });
        expect(await acTotal(page)).toBe(light - 1);

        await gotoTab(page, 'inventory');
        await closeDrawer(page);
        const foot = pane(page, 'inventory').locator('.inv-load-consequences');
        await expect(foot).toContainText('Medium load: max Dex +3 to AC, −3 check penalty');
        await expect(pane(page, 'inventory').locator('.inv-load-seg.is-active')).toContainText('Medium');

        // Heavy load: capped at +1.
        await page.evaluate((w) => {
            const d = window.SheetApp.current;
            d.equipment_list.find((x) => x.id === 'anvil').weight = w;
            window.SheetApp.renderSheet(d);
            window.SheetApp.setActiveTab('inventory');
        }, start.lim.medium - start.weight + 5);
        expect(await acTotal(page)).toBe(light - 3);
        await expect(pane(page, 'inventory').locator('.inv-load-consequences')).toContainText('Heavy load: max Dex +1');

        // Stowing the anvil (not carried) takes the load back off.
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d.equipment_list.find((x) => x.id === 'anvil').carried = false;
            window.SheetApp.renderSheet(d);
        });
        expect(await acTotal(page)).toBe(light);
    });

test('enhancements: "Longsword [+1, flaming]" lists flaming with a description on its item sheet',
    feature('inventory.enhancements'), async ({ page }) => {
        await openSheet(page, { fixture: 'mythic-fighter' });
        // The prose comes from the payload's enhancement_desc_dict (the fixtures do not carry
        // it yet), the effect line from enhancement_effects_dict.
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d.enhancement_desc_dict = { flaming: '<p>Upon command, a flaming weapon is sheathed in fire.</p>' };
            d.enhancement_effects_dict = { weapon: { Flaming: {
                conditionals: [{ name: 'Flaming: +[[1d6]] fire damage', default: false, modifiers: [] }],
                description: 'x' } } };
        });
        await addItem(page, { id: 'flame-sword', name: 'Longsword [+1, flaming]', itemType: 'weapon', weight: 4 });
        await openItem(page, 'flame-sword');
        const card = page.locator('#item-sheet-modal');
        await expect(card.locator('.item-sheet-tab.is-active')).toHaveText('Description');
        const enh = card.locator('.item-sheet-enh');
        await expect(enh).toHaveCount(2);                      // +1 and flaming
        const flaming = enh.filter({ hasText: 'Flaming' });
        await expect(flaming).toHaveCount(1);
        await expect(flaming).toContainText('sheathed in fire');
        await expect(flaming.locator('.item-sheet-enh-fx')).toContainText('+1d6 fire damage');
        // A numeric +N needs no payload: it explains itself.
        await expect(enh.first()).toContainText('+1 enhancement bonus on attack and damage rolls');
    });

test('enhancements: the generated Shortspear [Fury-Born, Spellstealing] explains both qualities',
    feature('inventory.enhancements'), async ({ page }) => {
        await openSheet(page);       // demo character
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            window.SheetModals.openItemSheet(d, d.equipment_list.find((x) => /^Shortspear/.test(x.name)));
        });
        const enh = page.locator('#item-sheet-modal .item-sheet-enh');
        await expect(enh).toHaveCount(2);
        await expect(enh.filter({ hasText: 'Fury-Born' }).locator('.item-sheet-enh-fx')).toContainText('enhancement bonus rises by +1');
        await expect(enh.filter({ hasText: 'Spellstealing' }).locator('.item-sheet-enh-fx')).toContainText('steal one');
    });

test('shared buff: an active shared AC buff adds a +N badge on the companion; unsharing removes it',
    feature('companions.share-buffs'), async ({ page }) => {
        await openSheet(page, { fixture: 'druid' });
        const setBuff = (shared) => page.evaluate((sh) => {
            const d = window.SheetApp.current;
            d._sheet.buffs = [{
                id: 'shield-of-faith', name: 'Shield of Faith', active: true, activation: 'always',
                category: 'spell', level: 5, shareWithCompanions: sh,
                changes: [{ formula: '2', target: 'ac', type: 'deflection' }],
            }];
            window.SheetApp.renderSheet(d);
            window.SheetApp.setActiveTab('companions');
        }, shared);
        await setBuff(true);
        await closeDrawer(page);
        const badges = pane(page, 'companions').locator('.companion-block .companion-shared');
        // Deflection AC lands on AC, touch and flat-footed.
        await expect(badges).toHaveCount(3);
        await expect(badges.first()).toHaveText('+2');
        await expect(badges.first()).toHaveAttribute('title', /Shield of Faith/);
        // The stored block is the creature's own and stays untouched.
        expect(await page.evaluate(() => window.SheetApp.current._sheet.companions[0].ac)).toBe(18);

        await setBuff(false);
        await expect(pane(page, 'companions').locator('.companion-shared')).toHaveCount(0);

        // Sharing again, then deactivating the buff, also removes it.
        await setBuff(true);
        await expect(badges).toHaveCount(3);
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d._sheet.buffs[0].active = false;
            window.SheetApp.renderSheet(d);
            window.SheetApp.setActiveTab('companions');
        });
        await expect(pane(page, 'companions').locator('.companion-shared')).toHaveCount(0);
    });

test('mounted: the Buffs chip mounts a companion, Summary shows its speed, Mounted charge appears',
    feature('combat.mounted'), async ({ page }) => {
        await openSheet(page, { fixture: 'druid' });
        const charge = () => page.evaluate(() => window.SheetDetails.collectRollConditionals(window.SheetApp.current)
            .some((e) => e.id === 'combat:mounted-charge'));
        expect(await charge()).toBe(false);

        await gotoTab(page, 'buffs');
        await closeDrawer(page);
        const chip = pane(page, 'buffs').locator('.mounted-chip');
        await chip.click();
        expect(await page.evaluate(() => window.SheetApp.current._sheet.mounted)).toBe('gen-druid-0');
        await expect(pane(page, 'buffs').locator('.mounted-chip')).toContainText('Mounted on Skullcrush');

        // Summary: the mount's speed (40 ft.) sits beside the rider's own.
        await gotoTab(page, 'summary');
        await expect(pane(page, 'summary').locator('.speed-mount-note')).toContainText('40 ft');

        // Combat options now list Mounted charge, ticking it applies -2 AC.
        expect(await charge()).toBe(true);
        await gotoTab(page, 'combat');
        const toggle = pane(page, 'combat').locator('.cond-check[data-cond-id="combat:mounted-charge"]');
        await expect(toggle).toHaveCount(1);
        const ac0 = await acTotal(page);
        await toggle.check({ force: true });
        expect(await acTotal(page)).toBe(ac0 - 2);

        // The companion card is tagged as ridden.
        await gotoTab(page, 'companions');
        await expect(pane(page, 'companions').locator('.companion-ridden')).toBeVisible();

        // Dismounting hides the toggle again and returns the -2 AC.
        await gotoTab(page, 'buffs');
        await pane(page, 'buffs').locator('.mounted-chip').click();
        expect(await charge()).toBe(false);
        expect(await acTotal(page)).toBe(ac0);
        await gotoTab(page, 'summary');
        await expect(pane(page, 'summary').locator('.speed-mount-note')).toHaveCount(0);
    });

test('eidolon: the summoner eidolon card lists its evolutions with EP costs',
    feature('companions.eidolon-evolutions'), async ({ page }) => {
        await openSheet(page, { fixture: 'summoner' });
        await gotoTab(page, 'companions');
        await closeDrawer(page);
        const evo = pane(page, 'companions').locator('.companion-block .companion-evolutions');
        await expect(evo).toBeVisible();
        await expect(evo.locator('.companion-evolutions-head')).toContainText('EP');
        const items = evo.locator('.companion-evolution');
        expect(await items.count()).toBeGreaterThan(0);
        await expect(items.first().locator('.companion-evolution-cost')).toContainText('EP');
        // Every listed evolution is one the payload actually carries.
        const names = await page.evaluate(() => (window.SheetApp.current.bonded_creatures
            .find((e) => e.evolutions)?.evolutions || [])
            .map((e) => String(e.name || e).toLowerCase()));
        expect(names.length).toBeGreaterThan(0);
        const shown = (await items.allInnerTexts()).join(' | ').toLowerCase();
        for (const n of names) expect(shown).toContain(n.split(' (')[0]);
    });
