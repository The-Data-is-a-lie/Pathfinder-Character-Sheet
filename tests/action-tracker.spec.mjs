// Action tracker acceptance tests (#161): five chips (full-round / standard / move / swift /
// immediate) beside the round counter. Attacks, full attacks, casts and maneuvers mark them;
// chips toggle by hand; Next round clears them; over-spending warns and never blocks.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const strip = (page) => page.locator('.tab-pane[data-tab="buffs"] .round-strip').first();
const chip = (page, kind) => strip(page).locator(`.ae-act[data-act="${kind}"]`);
const used = (page) => page.evaluate(() => ({ ...window.SheetApp.current._sheet.actionEconomy.used }));
const lastCard = (page) => page.locator('#tools-log .roll-card').first();

test('five chips sit in the round strip; a hand click marks and clears; Next round clears all (#161)',
    feature('combat.action-tracker'), async ({ page }) => {
        await openSheet(page);
        await gotoTab(page, 'buffs');
        for (const k of ['full', 'standard', 'move', 'swift', 'immediate']) await expect(chip(page, k)).toHaveCount(1);
        await chip(page, 'move').click();
        await expect(chip(page, 'move')).toHaveClass(/ae-spent/);
        await chip(page, 'swift').click();
        expect(await used(page)).toEqual({ move: true, swift: true });
        await chip(page, 'move').click();
        await expect(chip(page, 'move')).not.toHaveClass(/ae-spent/);
        // Immediate shares the swift slot: marking it warns but still marks.
        await chip(page, 'immediate').click();
        await expect(page.locator('#sheet-toast')).toContainText('swift and immediate share one slot');
        await expect(chip(page, 'immediate')).toHaveClass(/ae-spent/);
        await strip(page).locator('button', { hasText: 'Next round' }).click();
        await gotoTab(page, 'buffs');
        expect(await used(page)).toEqual({});
        await expect(strip(page).locator('.ae-act.ae-spent')).toHaveCount(0);
    });

test('an attack marks Standard; a second one warns on the card and still rolls (#161)',
    feature('combat.action-tracker'), async ({ page }) => {
        await openSheet(page);
        await gotoTab(page, 'buffs');
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: true }));
        await expect(chip(page, 'standard')).toHaveClass(/ae-spent/);
        await expect(lastCard(page)).toContainText('Standard action used (attack)');
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: true }));
        await expect(lastCard(page)).toContainText('your standard action is already used; rolled anyway');
        await expect(page.locator('#tools-log .roll-card')).toHaveCount(2);
        await expect(page.locator('#sheet-toast')).toContainText('Over the action budget');
    });

test('a full attack marks Full-round, Standard and Move; re-roll spends nothing (#161)',
    feature('combat.action-tracker'), async ({ page }) => {
        await openSheet(page);
        await gotoTab(page, 'buffs');
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: true, withDamage: true }));
        expect(await used(page)).toEqual({ full: true, standard: true, move: true });
        await expect(lastCard(page)).toContainText('Full-round action used (full attack)');
        await page.evaluate(() => window.SheetRoll.setOpen(true));
        await lastCard(page).locator('.tools-log-reroll').click();
        await expect(page.locator('#tools-log .roll-card')).toHaveCount(2);
        await expect(lastCard(page)).not.toContainText('rolled anyway');
    });

test('casting a spell marks Standard (#161)',
    feature('combat.action-tracker'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'spells');
        const row = page.locator('.tab-pane[data-tab="spells"] .spell-level-block[data-spell-level="1"] .spell-prep-row.is-prepared').first();
        await row.locator('.spell-cast-btn').click();
        const mm = page.locator('.sheet-overlay .inv-btn-primary', { hasText: 'Cast' });
        if (await mm.count()) await mm.click();
        await expect.poll(() => used(page)).toEqual({ standard: true });
    });

test('a pre-tracker save with the swift slot spent reads as Swift (#161)',
    feature('combat.action-tracker'), async ({ page }) => {
        await openSheet(page);
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d._sheet.actionEconomy = { swiftSpent: true, aooUsed: 0 };
            window.SheetApp.renderSheet(d);
        });
        await gotoTab(page, 'buffs');
        await expect(chip(page, 'swift')).toHaveClass(/ae-spent/);
        expect(await used(page)).toEqual({ swift: true });
    });

test('the combat HUD carries the same chips (#161)',
    feature('combat.action-tracker'), async ({ page }) => {
        await openSheet(page);
        await page.evaluate(() => window.SheetCombatHud.openHud(window.SheetApp.current));
        const hudChips = page.locator('.sheet-overlay .ae-act, .combat-hud .ae-act');
        await expect(hudChips).toHaveCount(5);
    });
