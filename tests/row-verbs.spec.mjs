// Row verbs acceptance tests (#154): Duplicate on Inventory, Combat, Features and Spells rows (as
// Buffs already had), an inline split-stack on inventory rows, Shift ×5 / Ctrl ×10 steppers.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const pane = (page, tab) => page.locator(`.tab-pane[data-tab="${tab}"]`);
const items = (page) => page.evaluate(() => window.SheetApp.current.equipment_list
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({ id: x.id, name: x.name, quantity: x.quantity, equipped: !!x.equipped })));

async function seedArrows(page) {
    await page.evaluate(() => {
        const d = window.SheetApp.current;
        d.equipment_list.push({ id: 'arrows-test', name: 'Arrows', itemType: 'consumable', quantity: 20, equipped: true });
        window.SheetApp.renderSheet(d);
    });
}
const arrowsRow = (page) => pane(page, 'inventory').locator('.inv-item[data-inv-id="arrows-test"]');

test('inventory: Shift ×5 / Ctrl ×10 steppers, inline split, duplicate — each with Undo (#154)',
    feature('lists.row-verbs'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await seedArrows(page);
        await gotoTab(page, 'inventory');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        const qty = async () => (await items(page)).find((x) => x.id === 'arrows-test').quantity;

        await arrowsRow(page).locator('.inv-step', { hasText: '+' }).click({ modifiers: ['Shift'] });
        expect(await qty()).toBe(25);
        await arrowsRow(page).locator('.inv-step', { hasText: '−' }).click({ modifiers: ['Control'] });
        expect(await qty()).toBe(15);
        await arrowsRow(page).locator('.inv-step', { hasText: '+' }).click();
        expect(await qty()).toBe(16);

        // Split: half into a new row right below, unequipped; no dialog.
        await arrowsRow(page).locator('.inv-split-btn').click();
        let list = await items(page);
        let i = list.findIndex((x) => x.id === 'arrows-test');
        expect(list[i].quantity).toBe(8);
        expect(list[i + 1]).toMatchObject({ name: 'Arrows', quantity: 8, equipped: false });
        await page.locator('#sheet-toast .sheet-toast-action').click();
        list = await items(page);
        expect(list.filter((x) => x.name === 'Arrows')).toHaveLength(1);
        expect(await qty()).toBe(16);

        // Shift-split peels off one.
        await arrowsRow(page).locator('.inv-split-btn').click({ modifiers: ['Shift'] });
        list = await items(page);
        i = list.findIndex((x) => x.id === 'arrows-test');
        expect([list[i].quantity, list[i + 1].quantity]).toEqual([15, 1]);

        // Duplicate: a whole copy, new id, unequipped.
        await arrowsRow(page).locator('.inv-dup-btn').click();
        list = await items(page);
        i = list.findIndex((x) => x.id === 'arrows-test');
        expect(list[i + 1]).toMatchObject({ name: 'Arrows', quantity: 15, equipped: false });
        expect(list[i + 1].id).not.toBe('arrows-test');
    });

test('combat: weapon rows carry the same Duplicate (#154)',
    feature('lists.row-verbs'), async ({ page }) => {
        await openSheet(page, { fixture: 'demo-cleric' });
        await gotoTab(page, 'combat');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        const row = pane(page, 'combat').locator('.inv-item').first();
        const id = await row.getAttribute('data-inv-id');
        const before = (await items(page)).length;
        await row.locator('.inv-dup-btn').click();
        const list = await items(page);
        expect(list).toHaveLength(before + 1);
        const i = list.findIndex((x) => x.id === id);
        expect(list[i + 1].name).toBe(list[i].name);
        expect(list[i + 1].equipped).toBe(false);
    });

test('features and spells: Duplicate adds "<name> (copy)" below, carrying sheet edits (#154)',
    feature('lists.row-verbs'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        const feat = await page.evaluate(() => {
            const d = window.SheetApp.current;
            const f = (d.feats || [])[0];
            window.SheetDetails.setFeatureOverride(d, 'feat', f, { description: '<p>House text</p>' });
            window.SheetApp.renderSheet(d);
            return f;
        });
        expect(feat).toBeTruthy();
        await gotoTab(page, 'features');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await pane(page, 'features').locator('.feat-item', { hasText: feat }).first().locator('.feat-dup-btn').click();
        const after = await page.evaluate((f) => {
            const d = window.SheetApp.current;
            const i = d.feats.indexOf(f);
            return { next: d.feats[i + 1], ov: window.SheetDetails.getFeatureOverride(d, 'feat', d.feats[i + 1]) };
        }, feat);
        expect(after.next).toBe(`${feat} (copy)`);
        expect(after.ov?.description).toBe('<p>House text</p>');
        await expect(pane(page, 'features').locator('.feat-item', { hasText: `${feat} (copy)` })).toHaveCount(1);
        await page.locator('#sheet-toast .sheet-toast-action').click();
        expect(await page.evaluate((f) => window.SheetApp.current.feats.includes(`${f} (copy)`), feat)).toBe(false);

        // Spells: same verb on a level-1 row.
        await gotoTab(page, 'spells');
        const row = pane(page, 'spells').locator('.spell-level-block[data-spell-level="1"] .spell-prep-row').first();
        const name = await row.getAttribute('data-dnd-id');
        await row.locator('.spell-dup-btn').click();
        await expect(pane(page, 'spells').locator(`.spell-prep-row[data-dnd-id="${name} (copy)"]`)).toHaveCount(1);
    });
