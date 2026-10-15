// Hero Points variant acceptance tests (#158): a Spend menu beside the pool lists the APG uses;
// each takes its cost from the pool, auto-applies where the sheet can, and logs a card.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const summary = (page) => page.locator('.tab-pane[data-tab="summary"]');
const heroBox = (page) => summary(page).locator('.hero-box');
const lastCard = (page) => page.locator('#tools-log .roll-card').first();
const pool = (page) => page.evaluate(() => window.SheetApp.current.hero_points);

async function withHeroPoints(page, n, { variant = true } = {}) {
    await page.evaluate(({ n, variant }) => {
        const d = window.SheetApp.current;
        d.hero_points = n;
        d._sheet.variantRules = { ...(d._sheet.variantRules || {}), heroPoints: variant };
        window.SheetApp.renderSheet(d);
        window.SheetApp.setActiveTab('summary');
    }, { n, variant });
}
async function spend(page, use) {
    await page.evaluate(() => window.SheetRoll.setOpen(false));
    await heroBox(page).locator('.hero-spend-btn').click();
    await page.locator(`.hero-use-btn[data-use="${use}"]`).click();
}

test('the pool shows beside HP only when the variant is on or the character has points (#158)',
    feature('variants.hero-points'), async ({ page }) => {
        await openSheet(page);
        await withHeroPoints(page, 0, { variant: false });
        await expect(heroBox(page)).toHaveCount(0);
        await withHeroPoints(page, 0, { variant: true });
        await expect(heroBox(page)).toContainText('0 / 3');
        await withHeroPoints(page, 2, { variant: false });
        await expect(heroBox(page)).toContainText('2 / 3');
        // The Settings toggle exists.
        await gotoTab(page, 'settings');
        await expect(page.locator('.tab-pane[data-tab="settings"] .settings-check', { hasText: 'Hero points' })).toHaveCount(1);
    });

test('+8 before a roll arms the next d20 roll, spends a point and logs a card (#158)',
    feature('variants.hero-points'), async ({ page }) => {
        await openSheet(page);
        await withHeroPoints(page, 2);
        await spend(page, 'bonus8');
        await expect.poll(() => pool(page)).toBe(1);
        await expect(lastCard(page)).toContainText('Hero point — +8 before a roll');
        await expect(lastCard(page)).toContainText('1 left');
        await expect(summary(page).locator('.hero-armed')).toBeVisible();
        // The next check carries +8 once; the one after does not.
        await page.evaluate(() => window.SheetRoll.rollAndLog('1d20+3', 'Will save'));
        await expect(page.locator('#tools-log .tools-log-entry').first()).toContainText('Will save (+8 Hero point)');
        expect(await page.evaluate(() => window.SheetRoll.nextD20Bonus())).toBeNull();
        await page.evaluate(() => window.SheetRoll.rollAndLog('1d20+3', 'Fort save'));
        await expect(page.locator('#tools-log .tools-log-entry').first()).not.toContainText('Hero point');
    });

test('+8 lands on an attack roll as its own bonus line (#158)',
    feature('variants.hero-points'), async ({ page }) => {
        await openSheet(page);
        await withHeroPoints(page, 1);
        await spend(page, 'bonus8');
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: false }));
        await expect(lastCard(page)).toContainText('Hero point');
    });

test('+4 after a roll adds to the newest roll; reroll re-runs it (#158)',
    feature('variants.hero-points'), async ({ page }) => {
        await openSheet(page);
        await withHeroPoints(page, 3);
        const total = await page.evaluate(() => window.SheetRoll.rollAndLog('1d20+5', 'Perception').total);
        await spend(page, 'bonus4');
        await expect(lastCard(page)).toContainText(`${total} + 4 = ${total + 4}`);
        const before = await page.locator('#tools-log .tools-log-entry').count();
        await spend(page, 'reroll');
        // The re-rolled check and the hero card both land in the log.
        await expect(page.locator('#tools-log .tools-log-entry')).toHaveCount(before + 2);
        await expect.poll(() => pool(page)).toBe(1);
    });

test('extra action gives back the Standard chip; cheat death costs 2 and leaves you at -1 (#158)',
    feature('variants.hero-points'), async ({ page }) => {
        await openSheet(page);
        await withHeroPoints(page, 3);
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: true }));
        expect(await page.evaluate(() => window.SheetApp.current._sheet.actionEconomy.used.standard)).toBe(true);
        await spend(page, 'action');
        expect(await page.evaluate(() => !!window.SheetApp.current._sheet.actionEconomy.used.standard)).toBe(false);

        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d._sheet.hpCurrent = -40;
            window.SheetApp.renderSheet(d);
            window.SheetApp.setActiveTab('summary');
        });
        await spend(page, 'cheat');
        await expect.poll(() => page.evaluate(() => window.SheetApp.current._sheet.hpCurrent)).toBe(-1);
        await expect(lastCard(page)).toContainText('alive and stable');
        expect(await pool(page)).toBe(0);
    });

test('spending without enough points warns and still applies, never below 0 (#158)',
    feature('variants.hero-points'), async ({ page }) => {
        await openSheet(page);
        await withHeroPoints(page, 1);
        await spend(page, 'cheat');
        await expect(lastCard(page)).toContainText('you had 1 hero point and this costs 2');
        expect(await pool(page)).toBe(0);
        await expect(page.locator('#sheet-toast')).toContainText('only 1 point');
    });
