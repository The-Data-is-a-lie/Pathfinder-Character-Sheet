// Pinned Quick Actions acceptance tests (#148): pin items, spells, features and rolls to a strip
// on Summary; click uses, right-click opens, a badge shows what is left, the fixed buttons stay.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const strip = (page) => page.locator('.tab-pane[data-tab="summary"] .quickbar');
const chip = (page, name) => strip(page).locator('.qb-pin', {
    has: page.locator('.qb-name', { hasText: new RegExp(`^${name}$`) }),
});

async function pinViaPicker(page, query, name) {
    const picker = page.locator('.qb-picker');
    await picker.locator('.qb-search').fill(query);
    const row = picker.locator('.qb-toggle', {
        has: page.locator('.qb-toggle-name', { hasText: new RegExp(`^${name}$`) }),
    }).first();
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
}

test('pin a roll and a spell from the picker; click uses them without leaving Summary (#148)',
    feature('summary.quick-actions'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'summary');
        // The fixed buttons are still there.
        await expect(page.locator('.tab-pane[data-tab="summary"] .quick-actions .quick-action-btn', { hasText: 'Level up' })).toBeVisible();

        const spell = await page.evaluate(() => window.SheetTabSpells.pinnableSpells(window.SheetApp.current)
            .find((s) => s.level === 1));
        expect(spell).toBeTruthy();
        await strip(page).locator('.qb-add').click();
        await pinViaPicker(page, 'initiative', 'Initiative');
        await pinViaPicker(page, spell.name, spell.name);
        await page.locator('.sheet-overlay button', { hasText: 'Done' }).click();

        await expect(strip(page).locator('.qb-pin')).toHaveCount(2);
        const init = chip(page, 'Initiative');
        await expect(init.locator('.qb-badge')).toHaveText(/^[+-]\d+$/);
        await init.locator('.qb-use').click();
        await expect(page.locator('#tools-log .tools-log-entry').first()).toContainText('Initiative');

        const spellChip = chip(page, spell.name);
        const before = await spellChip.locator('.qb-badge').textContent();
        const leftBefore = Number(before.match(/\d+/)?.[0]);
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await spellChip.locator('.qb-use').click();
        // A metamagic picker may appear for casters who know metamagic; cast plain.
        const plain = page.locator('.sheet-overlay button', { hasText: /^Cast/ });
        if (await plain.count()) await plain.first().click();
        await expect(chip(page, spell.name).locator('.qb-badge')).toHaveText(`${leftBefore - 1} left`);
        // Still on Summary.
        await expect(page.locator('.tab-pane[data-tab="summary"]')).toBeVisible();
        // Pins persist on the character, in strip order.
        const saved = await page.evaluate(() => window.SheetApp.current._sheet.quickbar.map((p) => p.kind));
        expect(saved).toEqual(['roll', 'spell']);
    });

test('a charged item spends from its badge; right-click opens its sheet, whose pin box is ticked (#148)',
    feature('summary.quick-actions'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d.equipment_list.push({
                id: 'wand-test', name: 'Wand of Magic Missile', itemType: 'consumable', subType: 'wand',
                quantity: 1, charges: { value: 3, max: 50 },
            });
            window.SheetQuickbar.setPinned(d, { kind: 'item', id: 'wand-test' }, true);
            window.SheetApp.renderSheet(d);
        });
        await gotoTab(page, 'summary');
        const wand = chip(page, 'Wand of Magic Missile');
        await expect(wand.locator('.qb-badge')).toHaveText('3/50');
        await wand.locator('.qb-use').click();
        await expect(chip(page, 'Wand of Magic Missile').locator('.qb-badge')).toHaveText('2/50');
        await expect(page.locator('#sheet-toast')).toContainText('2 charges left');

        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await chip(page, 'Wand of Magic Missile').locator('.qb-use').click({ button: 'right' });
        const pinBox = page.locator('.item-sheet-pin input[type="checkbox"]');
        await expect(pinBox).toBeChecked();
    });

test('unpin with Undo; a pin whose item is gone stays, dimmed, until unpinned (#148)',
    feature('summary.quick-actions'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d.equipment_list.push({ id: 'rope-test', name: 'Silk rope', itemType: 'equipment', quantity: 1 });
            window.SheetQuickbar.setPinned(d, { kind: 'roll', roll: 'will' }, true);
            window.SheetQuickbar.setPinned(d, { kind: 'item', id: 'rope-test' }, true);
            window.SheetApp.renderSheet(d);
        });
        await gotoTab(page, 'summary');
        await chip(page, 'Will').locator('.qb-unpin').click();
        await expect(chip(page, 'Will')).toHaveCount(0);
        await page.locator('#sheet-toast .sheet-toast-action').click();
        await expect(chip(page, 'Will')).toHaveCount(1);

        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d.equipment_list = d.equipment_list.filter((x) => x?.id !== 'rope-test');
            window.SheetApp.renderSheet(d);
        });
        const gone = strip(page).locator('.qb-pin.is-gone');
        await expect(gone).toHaveCount(1);
        await expect(gone.locator('.qb-use')).toBeDisabled();
        await gone.locator('.qb-unpin').click();
        await expect(strip(page).locator('.qb-pin.is-gone')).toHaveCount(0);
    });
