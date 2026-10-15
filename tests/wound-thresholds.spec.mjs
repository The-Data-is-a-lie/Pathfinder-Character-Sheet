// Wound Thresholds variant acceptance tests (#160): a Settings toggle; at 75 / 50 / 25% HP the
// grazed / wounded / critical band applies −1 / −2 / −3 (gritty: ×2) as ledger changes on attacks,
// CL, saves, AC, skills and checks, and the HP box shows the band.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

/** Set variant rules + HP as a fraction of max, re-render, return the derived numbers. */
async function at(page, frac, { on = true, mode = 'normal', temp = 0, vigor = false } = {}) {
    return page.evaluate(({ frac, on, mode, temp, vigor }) => {
        const d = window.SheetApp.current;
        d._sheet.variantRules = { ...(d._sheet.variantRules || {}), woundThresholds: on, woundThresholdsMode: mode, woundsVigor: vigor };
        const max = Number(d.Total_HP);
        d._sheet.hpCurrent = Math.floor(max * frac);
        d._sheet.hpTemp = temp;
        window.SheetApp.renderSheet(d);
        window.SheetApp.setActiveTab('summary');
        const D = window.SheetDerive.computeDerived(d);
        return {
            wt: window.SheetState.woundThreshold(d),
            ac: D.blocks.ac.total, fort: D.blocks.fort.total, cmb: D.blocks.cmb.total,
            atk: window.SheetRoll.attackContext().weaponBonus,
            max,
        };
    }, { frac, on, mode, temp, vigor });
}
const band = (page) => page.locator('.tab-pane[data-tab="summary"] .wound-band');

test('off by default; on, each band applies its penalty to AC, saves, CMB and attacks (#160)',
    feature('variants.wound-thresholds'), async ({ page }) => {
        await openSheet(page);
        const healthy = await at(page, 1, { on: false });
        const offLow = await at(page, 0.3, { on: false });
        expect(offLow.wt.on).toBe(false);
        expect(offLow.ac).toBe(healthy.ac);
        await expect(band(page)).toHaveCount(0);

        const grazed = await at(page, 0.7);
        expect(grazed.wt).toMatchObject({ level: 1, label: 'Grazed', penalty: 1 });
        expect([grazed.ac, grazed.fort, grazed.cmb, grazed.atk])
            .toEqual([healthy.ac - 1, healthy.fort - 1, healthy.cmb - 1, healthy.atk - 1]);
        await expect(band(page)).toHaveText('Grazed -1');

        const wounded = await at(page, 0.5);
        expect(wounded.wt.label).toBe('Wounded');
        expect(wounded.ac).toBe(healthy.ac - 2);

        const critical = await at(page, 0.2);
        expect(critical.wt.label).toBe('Critical');
        expect(critical.fort).toBe(healthy.fort - 3);
        await expect(band(page)).toHaveText('Critical -3');

        const full = await at(page, 0.9);
        expect(full.wt.level).toBe(0);
        await expect(band(page)).toHaveCount(0);
    });

test('gritty doubles the penalty; temp HP counts; wounds & vigor switches it off (#160)',
    feature('variants.wound-thresholds'), async ({ page }) => {
        await openSheet(page);
        const healthy = await at(page, 1, { on: false });
        const gritty = await at(page, 0.2, { mode: 'gritty' });
        expect(gritty.wt.penalty).toBe(6);
        expect(gritty.ac).toBe(healthy.ac - 6);
        // 50% HP plus temp HP worth 30% of max: back above 75%, healthy.
        const withTemp = await at(page, 0.5, { temp: Math.ceil(healthy.max * 0.3) });
        expect(withTemp.wt.level).toBe(0);
        const vigor = await at(page, 0.2, { vigor: true });
        expect(vigor.wt.on).toBe(false);
    });

test('the Settings toggle and mode picker drive it; the band never lands in Buffs Permanent (#160)',
    feature('variants.wound-thresholds'), async ({ page }) => {
        await openSheet(page);
        await gotoTab(page, 'settings');
        const settings = page.locator('.tab-pane[data-tab="settings"]');
        await settings.locator('.settings-check', { hasText: 'Wound thresholds' }).locator('input').check();
        await expect.poll(() => page.evaluate(() => window.SheetApp.current._sheet.variantRules.woundThresholds)).toBe(true);
        await gotoTab(page, 'settings');
        await settings.locator('select[data-variant="woundThresholdsMode"]').selectOption('gritty');
        await expect.poll(() => page.evaluate(() => window.SheetApp.current._sheet.variantRules.woundThresholdsMode)).toBe('gritty');

        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d._sheet.hpCurrent = Math.floor(Number(d.Total_HP) * 0.4);
            window.SheetApp.renderSheet(d);
        });
        await gotoTab(page, 'buffs');
        await expect(page.locator('.tab-pane[data-tab="buffs"] .buffs-row-derived').first()).toBeVisible();
        await expect(page.locator('.tab-pane[data-tab="buffs"] .buffs-row-derived', { hasText: 'Wound threshold' })).toHaveCount(0);
        const ledger = await page.evaluate(() => window.SheetDetails.collectChanges(window.SheetApp.current).changes
            .filter((c) => c.sourceKind === 'wound').map((c) => c.target));
        expect(ledger.sort()).toEqual(['ac', 'allChecks', 'allSavingThrows', 'attack', 'cmb', 'skills']);
    });

test('editing HP on Summary repaints the band live (#160)',
    feature('variants.wound-thresholds'), async ({ page }) => {
        await openSheet(page);
        const { max } = await at(page, 1);
        const hpBox = page.locator('.tab-pane[data-tab="summary"] .summary-stat-box', { hasText: 'HP' }).first();
        await hpBox.locator('.summary-hp-pair .dbl-edit, .summary-hp-pair [data-dbl], .summary-hp-pair span').first().dblclick();
        const input = hpBox.locator('input').first();
        await input.fill(String(Math.floor(max * 0.45)));
        await input.press('Enter');
        await expect(band(page)).toHaveText('Wounded -2');
    });

test('the penalty lowers caster level (never below 1) and concentration with it (#160)',
    feature('variants.wound-thresholds'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        const book = () => page.evaluate(() => {
            const b = document.querySelector('.tab-pane[data-tab="spells"] .spellbook-ranges');
            return Number(b.title.match(/At CL (\d+)/)[1]);
        });
        await at(page, 1);
        await gotoTab(page, 'spells');
        const cl0 = await book();
        await at(page, 0.2);
        await gotoTab(page, 'spells');
        expect(await book()).toBe(Math.max(1, cl0 - 3));
    });
