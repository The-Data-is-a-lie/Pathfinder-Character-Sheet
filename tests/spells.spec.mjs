// Spells tab acceptance tests.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const bookSpells = (page, lv) =>
    page.evaluate((l) => (window.SheetApp.current.spell_list_choose_from[l] || []).map(String), lv);

async function pickSpell(page, query, name) {
    const pane = page.locator('.tab-pane[data-tab="spells"]');
    await pane.locator('.catalog-browse-btn').first().click();
    const picker = page.locator('#catalog-picker');
    await picker.locator('.catalog-search-input').fill(query);
    const row = picker.locator('.catalog-result', { has: page.locator('.catalog-result-name', { hasText: new RegExp(`^${name}$`) }) });
    await expect(row).toBeVisible();
    return row;
}

test('a picked spell files under its level for the book\'s class, whatever the dropdown says (#139)',
    feature('spells.file-by-level'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'spells');
        expect(await bookSpells(page, 3)).not.toContain('Fireball');
        // The dropdown still says level 0; the spell's own wizard level must win.
        const row = await pickSpell(page, 'fireball', 'Fireball');
        await expect(row.locator('.catalog-result-sub')).toHaveText('Evocation · Wizard 3');
        await row.click();
        await expect.poll(() => bookSpells(page, 3)).toContain('Fireball');
        expect(await bookSpells(page, 0)).not.toContain('Fireball');
    });

test('a spell not on the book\'s class list falls back to the dropdown level and says so (#139)',
    feature('spells.file-by-level'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'spells');
        await page.locator('.tab-pane[data-tab="spells"] .section-catalog-bar select').first().selectOption('2');
        const row = await pickSpell(page, 'cure light wounds', 'Cure Light Wounds');
        await expect(row.locator('.catalog-result-sub')).toHaveText('Conjuration');
        await row.click();
        await expect.poll(() => bookSpells(page, 2)).toContain('Cure Light Wounds');
        await expect(page.locator('#sheet-toast')).toContainText('isn’t on the Wizard list');
    });

test('spellLevelFor maps book names onto learnedAt class tags (#139)',
    feature('spells.file-by-level'), async ({ page }) => {
        await openSheet(page);
        const got = await page.evaluate(() => {
            const f = window.SheetDetails.spellLevelFor;
            return {
                wizard: f('Fireball', 'Wizard')?.level,
                decorated: f('Fireball', 'Wizard — evoker')?.level,
                magus: f('Fireball', 'magus')?.level,
                cleric: f('Cure Light Wounds', 'Cleric')?.level,
                offList: f('Fireball', 'Cleric'),
                custom: f('Totally Homebrew Zap', 'Wizard'),
                psion: f('Fireball', 'Psion'),
            };
        });
        expect(got).toEqual({ wizard: 3, decorated: 3, magus: 3, cleric: 1, offList: null, custom: null, psion: null });
    });
