// Catalog picker acceptance tests: browse-all A–Z and the Inventory multi-add box (#140).
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const names = (picker) => picker.locator('.catalog-result-name').allTextContents();

test('an add menu lists the whole catalog A–Z before typing, with a letter jump (#140)',
    feature('catalog.browse-all'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'spells');
        await page.locator('.tab-pane[data-tab="spells"] .catalog-browse-btn').first().click();
        const picker = page.locator('#catalog-picker');
        await expect(picker.locator('.catalog-search-input')).toHaveValue('');

        // Nothing typed: a first chunk of rows, alphabetical, with more rendering on scroll.
        const first = await names(picker);
        expect(first.length).toBeGreaterThanOrEqual(60);
        const sorted = [...first].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        expect(first).toEqual(sorted);
        await picker.locator('.catalog-results').evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await expect.poll(async () => (await names(picker)).length).toBeGreaterThan(first.length);

        // The letter strip jumps the list to that letter.
        await picker.locator('.catalog-letter[data-letter="M"]').click();
        const top = await picker.locator('.catalog-results').evaluate((el) => {
            const box = el.getBoundingClientRect();
            const row = [...el.querySelectorAll('.catalog-result-name')]
                .find((n) => n.getBoundingClientRect().bottom > box.top + 2);
            return row?.textContent;
        });
        expect(top?.charAt(0)).toBe('M');

        // Typing still searches.
        await picker.locator('.catalog-search-input').fill('fireball');
        await expect(picker.locator('.catalog-result-name').first()).toHaveText('Fireball');
        await expect(picker.locator('.catalog-letters')).toBeHidden();
    });

test('the Inventory box adds several items across categories at once, with quantities (#140)',
    feature('inventory.multi-add'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page, { fixture: 'mythic-fighter' });
        await gotoTab(page, 'inventory');
        const before = await page.evaluate(() => window.SheetApp.current.equipment_list.length);
        await page.locator('.tab-pane[data-tab="inventory"] .catalog-browse-btn').first().click();
        const picker = page.locator('#catalog-picker');

        // Two category chips at once: only weapons and consumables are listed.
        await picker.locator('.catalog-cat-chip[data-cat="weapons"]').click();
        await picker.locator('.catalog-cat-chip[data-cat="consumables"]').click();
        const cats = await page.evaluate(() => {
            const IM = window.SheetInventoryModel;
            return [...document.querySelectorAll('#catalog-picker .catalog-result-name')].slice(0, 60)
                .map((n) => n.textContent)
                .map((name) => (window.SheetDetails.lookupWeapon(name) ? 'weapons'
                    : IM.inventoryCategory({ name, ...(window.SheetDetails.lookupItem(name) || {}) })));
        });
        expect(new Set(cats)).toEqual(new Set(['weapons', 'consumables']));

        // Tick a weapon (×3) and a consumable; ticks survive a new search.
        const row = (name) => picker.locator('.catalog-result-wrap', {
            has: page.locator('.catalog-result-name', { hasText: new RegExp(`^${name}$`) }) });
        await picker.locator('.catalog-search-input').fill('longsword');
        await row('Longsword').locator('.catalog-tick').check();
        await row('Longsword').locator('.catalog-qty-btn', { hasText: '+' }).click();
        await row('Longsword').locator('.catalog-qty-btn', { hasText: '+' }).click();
        await picker.locator('.catalog-search-input').fill('acid neutralizer');
        await row('Acid neutralizer').locator('.catalog-tick').check();
        await expect(picker.locator('.catalog-multi-count')).toHaveText('2 selected (4 total)');
        await picker.locator('.catalog-multi-add').click();

        await expect(page.locator('.sheet-overlay #catalog-picker')).toHaveCount(0);
        const added = await page.evaluate((n) => window.SheetApp.current.equipment_list.slice(n)
            .map((it) => [it.name, it.quantity]), before);
        expect(added).toEqual([['Longsword', 3], ['Acid neutralizer', 1]]);
        const ids = await page.evaluate(() => window.SheetApp.current.equipment_list.map((it) => it.id));
        expect(new Set(ids).size).toBe(ids.length);
    });
