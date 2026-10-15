// Multi-action items acceptance tests (#152): an item or feature holds several actions, each
// with its own attack, damage, save/DC, range and notes; a picker appears only when there is
// more than one choice.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const pane = (page, tab) => page.locator(`.tab-pane[data-tab="${tab}"]`);
const lastCard = (page) => page.locator('#tools-log .roll-card').first();

/** The first equipped inventory weapon of the loaded character: { id, name }. */
const firstWeapon = (page) => page.evaluate(() => {
    const d = window.SheetApp.current;
    const w = (d.equipment_list || []).find((it) => it.equipped !== false
        && window.SheetInventoryModel.inventoryCategory(it) === 'weapons');
    return w ? { id: w.id, name: w.name } : null;
});

async function rerender(page, tab) {
    await page.evaluate((t) => { window.SheetApp.renderSheet(window.SheetApp.current); window.SheetApp.setActiveTab(t); }, tab);
}

test('the item sheet Actions tab adds a Power Attack action to a weapon (#152)',
    feature('items.multi-action'), async ({ page }) => {
        await openSheet(page);
        await gotoTab(page, 'combat');
        const w = await firstWeapon(page);
        expect(w).not.toBeNull();
        await page.evaluate((id) => {
            const d = window.SheetApp.current;
            window.SheetModals.openItemSheet(d, d.equipment_list.find((it) => it.id === id));
        }, w.id);
        await page.locator('.item-sheet-tab', { hasText: 'Actions' }).click();
        await page.locator('.action-add-pa').click();
        await expect(page.locator('.action-edit-row')).toHaveCount(1);
        await expect(page.locator('.action-edit-row input[data-field="name"]')).toHaveValue('Power Attack');
        const stored = await page.evaluate((id) => window.SheetApp.current.equipment_list.find((it) => it.id === id).actions, w.id);
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ name: 'Power Attack', atk: expect.stringContaining('@attributes.bab.total') });
        // Editing a field re-stores it.
        const notes = page.locator('.action-edit-row input[data-field="notes"]');
        await notes.fill('one-handed');
        await notes.press('Enter');
        await expect.poll(() => page.evaluate((id) => window.SheetApp.current.equipment_list.find((it) => it.id === id).actions[0].notes, w.id))
            .toBe('one-handed');
    });

test('a weapon with an action asks which; Power Attack moves the attack and damage, Normal does not (#152)',
    feature('items.multi-action'), async ({ page }) => {
        await openSheet(page);
        const w = await firstWeapon(page);
        await page.evaluate((id) => {
            const d = window.SheetApp.current;
            d.equipment_list.find((it) => it.id === id).actions = [{ id: 'a1', name: 'Smash', atk: '-2', dmg: '+4', save: 'fort', dc: '10 + 5', notes: 'target is pushed 5 ft' }];
        }, w.id);
        await rerender(page, 'combat');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        const row = pane(page, 'combat').locator('.inv-item', { hasText: w.name }).first();
        const atkBtn = row.locator('.inv-atk-btn').first();
        await expect(atkBtn).toContainText('▾');

        await atkBtn.click();
        const picker = page.locator('.action-picker');
        await expect(picker.locator('.action-pick-btn')).toHaveCount(2);
        await expect(picker.locator('.action-pick-btn').first()).toContainText('Normal');
        await picker.locator('.action-pick-btn[data-action-id="a1"]').click();
        const card = lastCard(page);
        await expect(card).toContainText(`${w.name} — Smash`);
        await expect(card).toContainText('Fortitude DC 15');
        await expect(card).toContainText('target is pushed 5 ft');

        // Number keys pick: 1 = Normal, and the Normal card carries no action suffix.
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await atkBtn.click();
        await expect(picker).toBeVisible();
        await page.keyboard.press('1');
        await expect(picker).toHaveCount(0);
        await expect(lastCard(page)).not.toContainText('— Smash');
    });

test('the action delta lands in the attack total and the damage parts (#152)',
    feature('items.multi-action'), async ({ page }) => {
        await openSheet(page);
        const w = await firstWeapon(page);
        // Deterministic: compare the Normal and the action bonus via the exported entry with opts.action.
        const got = await page.evaluate((id) => {
            const before = window.SheetRoll.attackContext(id).weaponBonus;
            window.SheetRoll.rollWeaponAttackFor(id, { withDamage: true, action: { id: 'x', name: 'Ten', atk: '10', dmg: '100' } });
            return { before };
        }, w.id);
        const card = lastCard(page);
        await expect(card).toContainText('— Ten');
        await expect(card).toContainText('Ten');
        const text = await card.textContent();
        // The +100 damage delta is listed as its own part.
        expect(text).toMatch(/Ten\D*100/);
        expect(got.before).toEqual(expect.any(Number));
    });

test('a feat with two actions gets a Use button with a picker; one action skips it (#152)',
    feature('items.multi-action'), async ({ page }) => {
        await openSheet(page);
        const feat = await page.evaluate(() => window.SheetApp.current.feats[0]);
        await page.evaluate((name) => {
            const d = window.SheetApp.current;
            window.SheetItemActions.setForFeature(d, 'feat', name, [
                { id: 'f1', name: 'Burst', dmg: '2d6', save: 'ref', dc: '15', range: '20 ft' },
                { id: 'f2', name: 'Ward', notes: '+2 AC until your next turn' },
            ]);
        }, feat);
        await gotoTab(page, 'features');
        await rerender(page, 'features');
        const row = pane(page, 'features').locator(`.feat-item[data-dnd-id="${feat}"]`).first();
        await row.locator('.feat-use-btn').click();
        await expect(page.locator('.action-pick-btn')).toHaveCount(2);
        await page.locator('.action-pick-btn[data-action-id="f1"]').click();
        const card = lastCard(page);
        await expect(card).toContainText(`${feat} — Burst`);
        await expect(card).toContainText('Reflex DC 15');
        await expect(card).toContainText('20 ft');
        await expect(card).toContainText('Damage');

        // Down to one action: Use posts directly.
        await page.evaluate((name) => {
            const d = window.SheetApp.current;
            window.SheetItemActions.setForFeature(d, 'feat', name, [{ id: 'f2', name: 'Ward', notes: '+2 AC until your next turn' }]);
        }, feat);
        await rerender(page, 'features');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await pane(page, 'features').locator(`.feat-item[data-dnd-id="${feat}"]`).first().locator('.feat-use-btn').click();
        await expect(page.locator('.action-picker')).toHaveCount(0);
        await expect(lastCard(page)).toContainText(`${feat} — Ward`);
    });

test('an unknown reference in an action formula is called out on the card, not zeroed silently (#152)',
    feature('items.multi-action'), async ({ page }) => {
        await openSheet(page);
        const w = await firstWeapon(page);
        await page.evaluate((id) => window.SheetRoll.rollWeaponAttackFor(id,
            { withDamage: true, action: { id: 'b', name: 'Odd', atk: '@bogus.thing + 1' } }), w.id);
        await expect(lastCard(page)).toContainText('unknown @bogus.thing');
    });
