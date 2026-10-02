// Companions acceptance tests: the #141 mini-sheet over the derived model.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const comp = (page, i = 0) => page.evaluate((n) => {
    const c = window.SheetApp.current._sheet.companions[n];
    return JSON.parse(JSON.stringify(c));
}, i);

async function openMini(page, fixture = 'druid') {
    await page.setViewportSize({ width: 1440, height: 950 });
    await openSheet(page, { fixture });
    await gotoTab(page, 'companions');
    await page.evaluate(() => window.SheetRoll?.setOpen?.(false));
    await page.locator('.companion-block .companion-open').first().click();
    const sheet = page.locator('.companion-sheet');
    await expect(sheet).toBeVisible();
    return sheet;
}
const stat = (sheet, field) => sheet.locator(`.companion-sheet-derived[data-field="${field}"] .companion-sheet-value`);
const tab = (sheet, id) => sheet.locator(`.companion-sheet-tabs [data-tab="${id}"]`).click();

test('migration keeps every visible number the stored stat block had (#141)',
    feature('companions.mini-sheet'), async ({ page }) => {
        await openSheet(page, { fixture: 'druid' });
        const c = await comp(page);
        // Skullcrush, the druid fixture's cave salamander: the payload's own totals.
        expect({ ac: c.ac, touch: c.touch, ff: c.ff, cmb: c.cmb, cmd: c.cmd, saves: c.saves, hp: c.hp.max })
            .toEqual({ ac: 18, touch: 12, ff: 16, cmb: 7, cmd: 19, saves: { fort: 7, ref: 7, will: 3 }, hp: 60 });
        expect(c.attacks[0]).toMatchObject({ atk: 7, dmg: '1d6+4' });
        expect(c.model).toBe(2);
        // ...and they are DERIVED, not kept as overrides: the derivation reproduces them.
        expect(Object.keys(c.overrides)).toEqual([]);
        expect(c.base).toMatchObject({ bab: 4, natArmor: 6, hd: 6, saveBases: { fort: 5, ref: 5, will: 2 } });
    });

test('the mini-sheet opens full-screen with four tabs (#141)',
    feature('companions.mini-sheet'), async ({ page }) => {
        const sheet = await openMini(page);
        await expect(page.locator('.sheet-overlay.overlay-fullscreen')).toBeVisible();
        await expect(sheet.locator('.companion-sheet-tabs [data-tab]')).toHaveText(['Vitals', 'Buffs', 'Skills', 'Features']);
        await expect(stat(sheet, 'ac')).toHaveText('18');
        await tab(sheet, 'skills');
        await expect(sheet.locator('tr[data-skill="Perception"]')).toBeVisible();
        await tab(sheet, 'features');
        await expect(sheet.locator('.companion-attack-row')).toHaveCount(1);
    });

test('its own +4 Str buff raises CMB and the bite by +2, and unticking undoes it (#141)',
    feature('companions.mini-sheet'), async ({ page }) => {
        const sheet = await openMini(page);
        await tab(sheet, 'buffs');
        await sheet.locator('.companion-buff-add').click();
        const row = sheet.locator('.companion-buff-row').first();
        await row.locator('.companion-change-formula').fill('4');
        await row.locator('.companion-change-formula').press('Tab');
        await row.locator('.companion-change-target').selectOption('str');
        await tab(sheet, 'vitals');
        await expect(stat(sheet, 'cmb')).toHaveText('+9');
        await tab(sheet, 'features');
        await expect(stat(sheet, 'atk:0')).toHaveText('+9');
        await expect(stat(sheet, 'dmg:0')).toHaveText('1d6+7');
        await tab(sheet, 'buffs');
        await sheet.locator('.companion-buff-row input[type=checkbox]').first().uncheck();
        await tab(sheet, 'vitals');
        await expect(stat(sheet, 'cmb')).toHaveText('+7');
        // The master's own sheet is untouched by the companion's buff.
        expect(await page.evaluate(() => (window.SheetApp.current._sheet.buffs || []).length)).toBe(0);
    });

test('a condition on the companion denies its Dex to AC (#141)',
    feature('companions.mini-sheet'), async ({ page }) => {
        const sheet = await openMini(page);
        await tab(sheet, 'buffs');
        await sheet.locator('.condition-chip[data-condition="flat-footed"]').click();
        await tab(sheet, 'vitals');
        await expect(stat(sheet, 'ac')).toHaveText('16');
        expect(await page.evaluate(() => window.SheetApp.current._sheet.conditions || [])).toEqual([]);
    });

test('Damage then Heal lands on the companion and never on the master (#141)',
    feature('companions.mini-sheet'), async ({ page }) => {
        const sheet = await openMini(page);
        const masterBefore = await page.evaluate(() => window.SheetApp.current._sheet.hpCurrent ?? null);
        const amt = sheet.locator('.companion-hp-amount');
        await amt.fill('10');
        await sheet.locator('[data-hp-action="Damage"]').click();
        await expect(sheet.locator('.companion-hp-current')).toHaveText('50');
        await amt.fill('5');
        await sheet.locator('[data-hp-action="Heal"]').click();
        await expect(sheet.locator('.companion-hp-current')).toHaveText('55');
        expect((await comp(page)).hp.current).toBe(55);
        expect(await page.evaluate(() => window.SheetApp.current._sheet.hpCurrent ?? null)).toBe(masterBefore);
    });

test('a skill rank raises the total by one (#141)',
    feature('companions.mini-sheet'), async ({ page }) => {
        const sheet = await openMini(page);
        await tab(sheet, 'skills');
        const row = sheet.locator('tr[data-skill="Perception"]');
        await expect(row.locator('.companion-sheet-value')).toHaveText('+5');
        await row.locator('.companion-skill-ranks').fill('2');
        await row.locator('.companion-skill-ranks').press('Tab');
        await expect(sheet.locator('tr[data-skill="Perception"] .companion-sheet-value')).toHaveText('+6');
    });

test('a hand override survives a save round-trip, is marked, and resets to derived (#141)',
    feature('companions.mini-sheet'), async ({ page }) => {
        let sheet = await openMini(page);
        await stat(sheet, 'ac').dblclick();
        const inp = sheet.locator('.companion-sheet-derived[data-field="ac"] input');
        await inp.fill('21');
        await inp.press('Enter');
        await expect(sheet.locator('.companion-sheet-derived[data-field="ac"].is-edited')).toBeVisible();
        await expect(stat(sheet, 'ac')).toHaveText('21');
        // Round-trip the whole character through JSON, the way export/import does.
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.SheetGenerate.loadJsonText(JSON.stringify(window.SheetApp.current)));
        await expect.poll(async () => (await comp(page)).ac).toBe(21);
        await gotoTab(page, 'companions');
        await page.locator('.companion-block .companion-open').first().click();
        sheet = page.locator('.companion-sheet');
        await expect(sheet.locator('.companion-edited-mark')).toBeVisible();
        await sheet.locator('.companion-sheet-derived[data-field="ac"] .companion-sheet-reset').click();
        await expect(stat(sheet, 'ac')).toHaveText('18');
    });

test('deriving a companion leaves the master\'s ledger globals alone (#141)',
    feature('companions.mini-sheet'), async ({ page }) => {
        await openSheet(page, { fixture: 'druid' });
        const same = await page.evaluate(() => {
            const before = window.sheetChanges;
            const beforeFull = window.sheetChangesFull;
            const c = window.SheetApp.current._sheet.companions[0];
            window.SheetCompanionAdapter.derive(c);
            return window.sheetChanges === before && window.sheetChangesFull === beforeFull;
        });
        expect(same).toBe(true);
    });

test('a hand-edited base field survives a backend refresh; untouched ones follow the payload (#141)',
    feature('companions.mini-sheet'), async ({ page }) => {
        await openSheet(page, { fixture: 'druid' });
        const got = await page.evaluate(() => {
            const AD = window.SheetCompanionAdapter;
            const data = window.SheetApp.current;
            const c = data._sheet.companions[0];
            AD.setBase(c, 'abilities.str', 20);
            c.base.bab = 99;                       // untouched by hand: the payload wins it back
            AD.refreshFromBackend(c, data.bonded_creatures.find((e) => e.stats));
            return { str: c.base.abilities.str, bab: c.base.bab };
        });
        expect(got).toEqual({ str: 20, bab: 4 });
    });

test('the summoner\'s eidolon opens with its evolutions and keeps its numbers (#141)',
    feature('companions.mini-sheet'), async ({ page }) => {
        const sheet = await openMini(page, 'summoner');
        await expect(stat(sheet, 'ac')).toHaveText('23');
        await expect(stat(sheet, 'cmd')).toHaveText('21');
        await expect(sheet.locator('.companion-evolutions')).toBeVisible();
        await tab(sheet, 'skills');
        // 1 rank + Dex 4 + class skill 3 + Tail's +2 racial
        await expect(sheet.locator('tr[data-skill="Acrobatics"] .companion-sheet-value')).toHaveText('+10');
    });
