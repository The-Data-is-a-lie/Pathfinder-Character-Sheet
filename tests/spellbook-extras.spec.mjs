// Spellbook extras acceptance tests (#156): per-book DC / CL / concentration bonus formulas,
// roll notes, the close/medium/long range readout, arcane spell failure %, a per-spell
// prepared count and the domain / specialist flag.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const pane = (page) => page.locator('.tab-pane[data-tab="spells"]');
const book = (page) => pane(page).locator('.spellbook-block').first();

async function setExtra(page, key, value) {
    const det = book(page).locator('details.spellbook-extras');
    if (!(await det.evaluate((d) => d.open))) await det.locator('summary').click();
    const inp = book(page).locator(`.spellbook-extras input[data-extra="${key}"]`);
    await inp.fill(value);
    await inp.press('Enter');
}

const rangesFor = (cl) => `Close ${25 + 5 * Math.floor(cl / 2)} ft · Medium ${100 + 10 * cl} ft · Long ${400 + 40 * cl} ft`;
const mainBook = (page) => page.evaluate(() => {
    const d = window.SheetApp.current;
    return { extras: d._sheet?.spellBookExtras?.main || null, prepared: d.spells_prepared_names };
});

test('a CL formula moves CL, concentration and the range readout; a DC formula moves the level DC (#156)',
    feature('spells.book-extras'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'spells');
        const cl0 = Number((await book(page).locator('.spellbook-ranges').getAttribute('title')).match(/At CL (\d+)/)[1]);
        await expect(book(page).locator('.spellbook-ranges .v')).toHaveText(rangesFor(cl0));
        const dc0 = Number((await book(page).locator('.spell-level-block[data-spell-level="1"] .spell-level-dc').textContent()).match(/\d+/)[0]);

        await setExtra(page, 'cl', '1 + 1');
        await expect(book(page).locator('.spellbook-ranges .v')).toHaveText(rangesFor(cl0 + 2));
        await expect(book(page).locator('.kv', { hasText: 'CL check vs SR' })).toContainText(`1d20 +${cl0 + 2}`);
        expect((await mainBook(page)).extras).toEqual({ cl: '1 + 1' });

        await setExtra(page, 'dc', 'floor(@cl / 4)');
        const want = dc0 + Math.floor((cl0 + 2) / 4);
        await expect(book(page).locator('.spell-level-block[data-spell-level="1"] .spell-level-dc')).toHaveText(`Save DC ${want}`);

        // An unknown reference counts 0 and says why instead of zeroing silently.
        await setExtra(page, 'conc', '@bogus.ref + 2');
        await expect(book(page).locator('.spellbook-extra-err')).toContainText('counts 0');
    });

test('roll notes land in the concentration and CL-check tooltips (#156)',
    feature('spells.book-extras'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'spells');
        await setExtra(page, 'concNotes', '+4 to cast defensively');
        await setExtra(page, 'clNotes', '+2 vs elves');
        const conc = book(page).locator('.kv', { hasText: 'Concentration' }).locator('button').first();
        await expect(conc).toHaveAttribute('title', /\+4 to cast defensively/);
        const clChk = book(page).locator('.kv', { hasText: 'CL check vs SR' }).locator('button').first();
        await expect(clChk).toHaveAttribute('title', /\+2 vs elves/);
    });

test('a prepared count of 2 is stored as two copies and the level totals follow (#156)',
    feature('spells.book-extras'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'spells');
        const row = book(page).locator('.spell-level-block[data-spell-level="1"] .spell-prep-row').first();
        const name = await row.getAttribute('data-dnd-id');
        const before = (await mainBook(page)).prepared?.[1]?.length || 0;
        const had = ((await mainBook(page)).prepared?.[1] || []).filter((n) => n === name).length;
        await row.locator('.spell-prep-n').fill('2');
        await row.locator('.spell-prep-n').press('Enter');
        await expect.poll(async () => ((await mainBook(page)).prepared[1] || []).filter((n) => n === name).length).toBe(2);
        const total = before - had + 2;
        await expect(book(page).locator('.spell-prep-count[data-spell-level="1"]')).toHaveText(String(total));
        // Survives a re-render.
        await page.evaluate(() => { window.SheetApp.renderSheet(window.SheetApp.current); window.SheetApp.setActiveTab('spells'); });
        await expect(book(page).locator(`.spell-level-block[data-spell-level="1"] .spell-prep-row[data-dnd-id="${name}"] .spell-prep-n`)).toHaveValue('2');
    });

test('spell failure 100% posts a fail card on cast, and the cast still happens (#156)',
    feature('spells.book-extras'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'spells');
        await setExtra(page, 'asf', '100');
        await expect(book(page).locator('.kv', { hasText: 'Spell failure' })).toContainText('100%');
        const row = book(page).locator('.spell-level-block[data-spell-level="1"] .spell-prep-row.is-prepared').first();
        const name = await row.getAttribute('data-dnd-id');
        const left = await page.evaluate(() => window.SheetApp.current._sheet.spellCastsRemaining?.[1]);
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await row.locator('.spell-cast-btn').click();
        const mmCast = page.locator('.sheet-overlay .inv-btn-primary', { hasText: 'Cast' });
        if (await mmCast.count()) await mmCast.click();
        const card = page.locator('#tools-log .roll-card', { hasText: 'Spell failure' }).first();
        await expect(card).toContainText(`Spell failure — ${name}`);
        await expect(card).toContainText('vs 100%');
        await expect(card).toContainText('fails');
        if (typeof left === 'number') {
            await expect.poll(() => page.evaluate(() => window.SheetApp.current._sheet.spellCastsRemaining[1])).toBe(left - 1);
        }
    });

test('domain flag: only on restricted books, stored per level, warns on a second flag (#156)',
    feature('spells.book-extras'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'spells');
        await expect(book(page).locator('.spell-restricted-flag')).toHaveCount(0);
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d._sheet.spellBookRules = { main: { restricted: 'domain', label: 'Fire' } };
            window.SheetApp.renderSheet(d);
            window.SheetApp.setActiveTab('spells');
        });
        const rows = book(page).locator('.spell-level-block[data-spell-level="1"] .spell-prep-row');
        const [a, b] = [await rows.nth(0).getAttribute('data-dnd-id'), await rows.nth(1).getAttribute('data-dnd-id')];
        await expect(book(page).locator('.spell-level-block[data-spell-level="0"] .spell-restricted-flag')).toHaveCount(0);
        await rows.nth(0).locator('.spell-restricted-flag').click();
        await expect(book(page).locator(`.spell-prep-row[data-dnd-id="${a}"] .spell-restricted-flag`)).toHaveClass(/is-on/);
        expect((await mainBook(page)).extras.restricted).toEqual({ [`1:${a}`]: true });
        await book(page).locator(`.spell-level-block[data-spell-level="1"] .spell-prep-row[data-dnd-id="${b}"] .spell-restricted-flag`).click();
        await expect(page.locator('#sheet-toast')).toContainText('2 level-1 spells are flagged domain');
    });
