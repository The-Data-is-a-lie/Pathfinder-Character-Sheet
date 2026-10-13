// Ability check acceptance tests (#153): clicking an ability name rolls 1d20 + mod to the log,
// with ledger ability-check changes and negative levels applied — on Attributes and the simple sheet.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const lastLog = (page) => page.locator('#tools-log .tools-log-entry').first();
// The log prints "d20:<die> <bonus>= <total>".
const bonusRe = (n) => new RegExp(`d20:\\d+ ${n >= 0 ? '\\+' : '-'}${Math.abs(n)}=`);

test('Attributes: the ability name rolls 1d20 + mod with check bonuses and negative levels (#153)',
    feature('attributes.ability-checks'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        // A +2 competence bonus to all checks, +1 more to Strength checks, and one negative level.
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            window.SheetState.ensureBuffs(d).push(window.SheetState.normalizeBuffEntry({
                name: 'Check test', subType: 'temp', active: true,
                changes: [
                    { formula: '2', target: 'allChecks', type: 'competence' },
                    { formula: '1', target: 'strChecks', type: 'morale' },
                ],
            }));
            window.SheetState.sheetState(d).negativeLevels = 1;
            window.SheetApp.renderSheet(d);
        });
        const expected = await page.evaluate(() => {
            const d = window.SheetApp.current;
            return { str: window.SheetDerive.abModOf(d, 'str') + 2 + 1 - 1, int: window.SheetDerive.abModOf(d, 'int') + 2 - 1 };
        });
        await gotoTab(page, 'attributes');
        await page.evaluate(() => window.SheetRoll.setOpen(false));

        await page.locator('.tab-pane[data-tab="attributes"] .ability-check-btn[data-ability="str"]').click();
        await expect(lastLog(page)).toContainText('Strength check');
        await expect(lastLog(page)).toHaveText(bonusRe(expected.str));

        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await page.locator('.tab-pane[data-tab="attributes"] .ability-check-btn[data-ability="int"]').click();
        await expect(lastLog(page)).toContainText('Intelligence check');
        await expect(lastLog(page)).toHaveText(bonusRe(expected.int));
    });

test('simple sheet: the ability label rolls the same check (#153)',
    feature('attributes.ability-checks'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard', view: 'simple' });
        const btn = page.locator('.ability-check-btn[data-ability="dex"]').first();
        await expect(btn).toHaveText('DEX');
        const mod = await page.evaluate(() => window.SheetDerive.abModOf(window.SheetApp.current, 'dex'));
        await btn.click();
        await expect(lastLog(page)).toContainText('Dexterity check');
        await expect(lastLog(page)).toHaveText(bonusRe(mod));
    });
