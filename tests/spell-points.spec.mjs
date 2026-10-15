// Spell Points variant acceptance tests (#159): behind a Settings toggle, each spellbook can trade
// its slots for a point pool; a cast costs 1 + the slot level (cantrips free), Rest refills, and
// other books keep their slots.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const pane = (page) => page.locator('.tab-pane[data-tab="spells"]');
const mainBook = (page) => pane(page).locator('.spellbook-block').first();
const points = (page, id = 'main') => page.evaluate((i) => window.SheetApp.current._sheet.bookSpellPoints?.[i] || null, id);
const casts = (page) => page.evaluate(() => [...(window.SheetApp.current._sheet.spellCastsRemaining || [])]);

async function setup(page, { variant = true, bookOn = true, store = {} } = {}) {
    await page.evaluate(({ variant, bookOn, store }) => {
        const d = window.SheetApp.current;
        d._sheet.variantRules = { ...(d._sheet.variantRules || {}), spellPoints: variant };
        if (bookOn) d._sheet.bookSpellPoints = { main: { on: true, ...store } };
        window.SheetApp.renderSheet(d);
        window.SheetApp.setActiveTab('spells');
    }, { variant, bookOn, store });
}
async function castFirstPrepared(page, level) {
    await page.evaluate(() => window.SheetRoll.setOpen(false));
    const row = mainBook(page).locator(`.spell-level-block[data-spell-level="${level}"] .spell-prep-row.is-prepared`).first();
    await row.locator('.spell-cast-btn').click();
    const mm = page.locator('.sheet-overlay .inv-btn-primary', { hasText: 'Cast' });
    if (await mm.count()) await mm.click();
}

test('the per-book switch appears only with the variant on, and the pool defaults to the slots it replaces (#159)',
    feature('variants.spell-points'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await setup(page, { variant: false, bookOn: false });
        await expect(mainBook(page).locator('.spellbook-points')).toHaveCount(0);
        await setup(page, { bookOn: false });
        await mainBook(page).locator('.spellbook-points-on').check();
        // wizard per day [2, 6, 4, 3, 2]: 6×2 + 4×3 + 3×4 + 2×5 = 46
        const perDay = await page.evaluate(() => window.SheetApp.current.day_list.map(Number));
        const want = perDay.reduce((s, n, lv) => s + (lv ? n * (1 + lv) : 0), 0);
        await expect(mainBook(page).locator('.spellbook-points-pool')).toContainText(`${want} / ${want}`);
        await expect(mainBook(page).locator('.spell-level-block[data-spell-level="2"] .spell-level-meta')).toContainText('3 pts a cast');
    });

test('a cast spends 1 + level points and leaves the slot counters alone (#159)',
    feature('variants.spell-points'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await setup(page, { store: { value: 20 } });
        const before = await casts(page);
        await castFirstPrepared(page, 1);
        await expect.poll(async () => (await points(page)).value).toBe(18);
        await expect(page.locator('#tools-log .roll-card').first()).toContainText('2 spent, 18 left');
        await castFirstPrepared(page, 3);
        await expect.poll(async () => (await points(page)).value).toBe(14);
        expect(await casts(page)).toEqual(before);
        // Cantrips are free.
        await castFirstPrepared(page, 0);
        await page.waitForTimeout(100);
        expect((await points(page)).value).toBe(14);
    });

test('a short pool warns, casts anyway and stops at 0 (#159)',
    feature('variants.spell-points'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await setup(page, { store: { value: 1 } });
        const cards = await page.locator('#tools-log .roll-card').count();
        await castFirstPrepared(page, 2);
        await expect(page.locator('#tools-log .roll-card').first()).toContainText('3 spent, 0 left (had only 1 — cast anyway)');
        await expect(page.locator('#tools-log .roll-card')).toHaveCount(cards + 1);
        expect((await points(page)).value).toBe(0);
    });

test('a max formula sets the pool; Rest refills it; the quickbar counts casts the points buy (#159)',
    feature('variants.spell-points'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await setup(page, { store: { value: 3 } });
        const max = mainBook(page).locator('.spellbook-points-max');
        await max.fill('10 + @cl');
        await max.press('Enter');
        const cl = await page.evaluate(() => Number(document.querySelector('.tab-pane[data-tab="spells"] .spellbook-ranges').title.match(/At CL (\d+)/)[1]));
        await expect(mainBook(page).locator('.spellbook-points-pool')).toContainText(`3 / ${10 + cl}`);
        expect(await page.evaluate(() => window.SheetTabSpells.spellSlotsLeft(window.SheetApp.current, 'main', 1))).toBe(1);

        await gotoTab(page, 'summary');
        await page.locator('.tab-pane[data-tab="summary"] button', { hasText: /^Rest$/ }).first().click();
        await expect.poll(async () => (await points(page)).value).toBe(10 + cl);
        await expect(page.locator('#sheet-toast')).toContainText('spell points refilled');
    });

test('another spellbook keeps its slots (#159)',
    feature('variants.spell-points'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d._sheet.extraSpellbooks = [{ id: 'book-x', name: 'Cleric', castAb: 'wis', cl: 5, preparedMode: false,
                dayList: [3, 3, 2], lists: [[], ['Bless'], []], prepared: [], casts: [3, 3, 2] }];
        });
        await setup(page, { store: { value: 20 } });
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        const other = pane(page).locator('.spellbook-block[data-book-id="book-x"]');
        await expect(other.locator('.spellbook-points-on')).not.toBeChecked();
        await other.locator('.spell-level-block[data-spell-level="1"] .spell-cast-btn').first().click();
        const mm = page.locator('.sheet-overlay .inv-btn-primary', { hasText: 'Cast' });
        if (await mm.count()) await mm.click();
        await expect.poll(() => page.evaluate(() => window.SheetApp.current._sheet.extraSpellbooks[0].casts[1])).toBe(2);
        expect((await points(page)).value).toBe(20);
    });
