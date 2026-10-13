// Post-to-log acceptance tests (#151): Inventory / Combat, Spells and Buffs rows post their card to
// the roll log as Features rows do, and one click posts a Defenses card.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const pane = (page, tab) => page.locator(`.tab-pane[data-tab="${tab}"]`);
const lastCard = (page) => page.locator('#tools-log .tools-log-entry').first();
const closeTools = (page) => page.evaluate(() => window.SheetRoll.setOpen(false));

test('Defenses: one click posts AC / touch / flat-footed / CMD / saves (+ SR, DR) (#151)',
    feature('log.post-rows-defenses'), async ({ page }) => {
        await openSheet(page, { fixture: 'demo-cleric' });
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d._sheet.defenses = { ...(d._sheet.defenses || {}), dr: [{ amount: 5, bypass: 'cold iron' }] };
            window.SheetApp.renderSheet(d);
        });
        const want = await page.evaluate(() => {
            const b = window.SheetDerive.computeDerived(window.SheetApp.current).blocks;
            return { ac: b.ac.total, touch: b.touch.total, flat: b.flat.total, cmd: b.cmd.total };
        });
        await gotoTab(page, 'defenses');
        await closeTools(page);
        await pane(page, 'defenses').locator('.defenses-post-btn').click();
        const card = lastCard(page);
        await expect(card).toContainText('Defenses');
        await expect(card).toContainText(`${want.ac} · touch ${want.touch} · flat-footed ${want.flat}`);
        await expect(card).toContainText(`${want.cmd} · flat-footed`);
        await expect(card).toContainText(/Fort [+-]\d+ · Ref [+-]\d+ · Will [+-]\d+/);
        await expect(card).toContainText('5/cold iron');
    });

test('Inventory, Combat, Spells and Buffs rows post their card (#151)',
    feature('log.post-rows-defenses'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d.equipment_list.push({
                id: 'wand-test', name: 'Wand of Magic Missile', itemType: 'consumable', subType: 'wand',
                quantity: 1, charges: { value: 7, max: 50 }, description: '<p>A slender wand.</p>',
            });
            window.SheetState.ensureBuffs(d).push(window.SheetState.normalizeBuffEntry({
                name: 'Shield of Faith', subType: 'spell', active: true,
                changes: [{ formula: '2', target: 'ac', type: 'deflection' }], notes: 'Touch, 1 min/level',
            }));
            window.SheetApp.renderSheet(d);
        });

        await gotoTab(page, 'inventory');
        await closeTools(page);
        await pane(page, 'inventory').locator('.inv-item[data-inv-id="wand-test"] .inv-post-btn').click();
        await expect(lastCard(page)).toContainText('Wand of Magic Missile');
        await expect(lastCard(page)).toContainText('7 / 50');

        await gotoTab(page, 'combat');
        await closeTools(page);
        const weapon = pane(page, 'combat').locator('.inv-item').first();
        const wName = (await weapon.locator('.inv-item-open').textContent()).trim();
        await weapon.locator('.inv-post-btn').click();
        await expect(lastCard(page)).toContainText(wName);

        await gotoTab(page, 'spells');
        await closeTools(page);
        const spellRow = pane(page, 'spells').locator('.spell-level-block[data-spell-level="1"] .spell-prep-row').first();
        const sName = await spellRow.getAttribute('data-dnd-id');
        await spellRow.locator('.spell-post-btn').click();
        await expect(lastCard(page)).toContainText(sName);
        await expect(lastCard(page)).toContainText('Level 1 spell');

        await gotoTab(page, 'buffs');
        await closeTools(page);
        await pane(page, 'buffs').locator('.buffs-row', { hasText: 'Shield of Faith' }).locator('.buff-post-btn').click();
        await expect(lastCard(page)).toContainText('Shield of Faith');
        await expect(lastCard(page)).toContainText(/deflection/i);
    });
