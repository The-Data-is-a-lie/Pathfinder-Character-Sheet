// Numeric box acceptance tests (#150): the wheel nudges HP, quantity, charges and buff level
// (Ctrl ×10), and typing "+5" / "-7" adjusts rather than replaces — pf1's muscle memory.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const hpBox = (page) => page.locator('.tab-pane[data-tab="summary"] .summary-hp-pair .dbl-edit').first();
const st = (page) => page.evaluate(() => window.SheetApp.current._sheet);

async function wheelOver(page, loc, deltaY, { ctrl = false } = {}) {
    await loc.hover();
    if (ctrl) await page.keyboard.down('Control');
    await page.mouse.wheel(0, deltaY);
    if (ctrl) await page.keyboard.up('Control');
}

test('HP: the wheel nudges by one, Ctrl+wheel by ten; "-7" and "+5" adjust, "=N" sets (#150)',
    feature('inputs.wheel-relative'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'summary');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        const start = Number((await st(page)).hpCurrent);

        await wheelOver(page, hpBox(page), -100);
        await expect.poll(async () => Number((await st(page)).hpCurrent)).toBe(start + 1);
        await wheelOver(page, hpBox(page), 100, { ctrl: true });
        await expect.poll(async () => Number((await st(page)).hpCurrent)).toBe(start - 9);

        const typeInto = async (text) => {
            await hpBox(page).dblclick();
            const input = hpBox(page).locator('input');
            await input.fill(text);
            await input.press('Enter');
        };
        await typeInto('-7');
        await expect.poll(async () => Number((await st(page)).hpCurrent)).toBe(start - 16);
        await typeInto('+5');
        await expect.poll(async () => Number((await st(page)).hpCurrent)).toBe(start - 11);
        await typeInto('=-3');
        await expect.poll(async () => Number((await st(page)).hpCurrent)).toBe(-3);
        await expect(hpBox(page).locator('.dbl-edit-display')).toHaveText('-3');
    });

test('quantity, buff level and charges take the wheel and relative entry; floors hold (#150)',
    feature('inputs.wheel-relative'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d.equipment_list.push({ id: 'arrows-test', name: 'Arrows', itemType: 'consumable', quantity: 20 });
            d.equipment_list.push({
                id: 'wand-test', name: 'Wand of Magic Missile', itemType: 'consumable', subType: 'wand',
                quantity: 1, charges: { value: 10, max: 50 },
            });
            window.SheetState.ensureBuffs(d).push(window.SheetState.normalizeBuffEntry({
                name: 'Bless', subType: 'spell', active: true, level: 3, changes: [],
            }));
            window.SheetApp.renderSheet(d);
        });
        const item = (id) => page.evaluate((id) => window.SheetApp.current.equipment_list.find((x) => x?.id === id), id);

        // Quantity: the wheel nudges; "-25" floors at 0.
        await gotoTab(page, 'inventory');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        const qty = page.locator('.tab-pane[data-tab="inventory"] .inv-item', { hasText: 'Arrows' }).locator('.inv-qty .dbl-edit');
        await wheelOver(page, qty, -100);
        await expect.poll(async () => (await item('arrows-test')).quantity).toBe(21);
        await qty.dblclick();
        await qty.locator('input').fill('-25');
        await qty.locator('input').press('Enter');
        await expect.poll(async () => (await item('arrows-test')).quantity).toBe(0);

        // Buff level.
        await gotoTab(page, 'buffs');
        const lv = page.locator('.tab-pane[data-tab="buffs"] .buffs-row', { hasText: 'Bless' }).locator('.buffs-col-lv .dbl-edit');
        await wheelOver(page, lv, -100, { ctrl: true });
        const buffLv = () => page.evaluate(() => window.SheetApp.current._sheet.buffs.find((b) => b.name === 'Bless').level);
        await expect.poll(buffLv).toBe(13);
        await lv.dblclick();
        await lv.locator('input').fill('+2');
        await lv.locator('input').press('Enter');
        await expect.poll(buffLv).toBe(15);

        // Charges on the item sheet: "-1" spends one, the wheel nudges.
        await gotoTab(page, 'inventory');
        await page.locator('.tab-pane[data-tab="inventory"] .inv-item', { hasText: 'Wand of Magic Missile' })
            .locator('.inv-item-open').click();
        const ch = page.locator('.item-sheet-stat', { has: page.locator('.item-sheet-stat-label', { hasText: /^Charges$/ }) }).locator('input').first();
        await ch.fill('-1');
        await ch.press('Tab');
        await expect.poll(async () => (await item('wand-test')).charges.value).toBe(9);
        await wheelOver(page, ch, 100);
        await expect.poll(async () => (await item('wand-test')).charges.value).toBe(8);
        await expect(ch).toHaveValue('8');
    });

test('a page scroll that drifts over a box keeps scrolling the page (#150)',
    feature('inputs.wheel-relative'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'summary');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        const start = Number((await st(page)).hpCurrent);
        // Scroll elsewhere, then immediately over the HP box: the page scroll wins.
        await page.mouse.move(5, 5);
        await page.mouse.wheel(0, 10);
        const b = await hpBox(page).boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.wheel(0, -100);
        await page.waitForTimeout(100);
        expect(Number((await st(page)).hpCurrent)).toBe(start);
    });
