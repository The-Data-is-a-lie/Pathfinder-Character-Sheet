// Shared list toolbar acceptance tests (#149): one search box + section chips + Hide empty on
// every list tab, Prepared only on Spells; the filter survives the re-render every edit causes.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const pane = (page, tab) => page.locator(`.tab-pane[data-tab="${tab}"]`);
const bar = (page, tab) => pane(page, tab).locator('.list-toolbar');
const visibleRows = (page, tab, sel) => pane(page, tab).locator(`${sel}:not(.list-filter-hidden)`);

test('every list tab has the same toolbar: search, section chips, Hide empty (#149)',
    feature('lists.search-chips'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        for (const tab of ['combat', 'buffs', 'spells', 'inventory', 'features']) {
            await gotoTab(page, tab);
            const b = bar(page, tab);
            await expect(b, tab).toHaveCount(1);
            await expect(b.locator('.list-search'), tab).toBeVisible();
            await expect(b.locator('[data-special="empty"]'), tab).toBeVisible();
            await expect(b.locator('.list-filter-pills .filter-pill').first(), tab).toBeVisible();
        }
        // Prepared only exists where "prepared" means something.
        await expect(bar(page, 'spells').locator('[data-special="prepared"]')).toHaveCount(1);
        await expect(bar(page, 'buffs').locator('[data-special="prepared"]')).toHaveCount(0);
    });

test('Spells: search, level chips, Prepared only and Hide empty compose, and survive a re-render (#149)',
    feature('lists.search-chips'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'spells');
        const rows = '.spell-prep-row';
        const total = await pane(page, 'spells').locator(rows).count();
        expect(total).toBeGreaterThan(3);
        const first = await pane(page, 'spells').locator(rows).first().getAttribute('data-dnd-id');

        await bar(page, 'spells').locator('.list-search').fill(first);
        await expect(visibleRows(page, 'spells', rows).first()).toHaveAttribute('data-dnd-id', first);
        expect(await visibleRows(page, 'spells', rows).count()).toBeLessThan(total);

        // Hide empty: every level block without a match disappears.
        await bar(page, 'spells').locator('[data-special="empty"]').click();
        const shownBlocks = pane(page, 'spells').locator('.spell-level-block:not(.list-filter-hidden)');
        await expect(shownBlocks).toHaveCount(await shownBlocks.count());
        for (const blk of await shownBlocks.all()) {
            expect(await blk.locator(`${rows}:not(.list-filter-hidden)`).count()).toBeGreaterThan(0);
        }

        // The filter survives the full re-render any edit triggers.
        await page.evaluate(() => window.SheetApp.renderSheet(window.SheetApp.current));
        await expect(bar(page, 'spells').locator('.list-search')).toHaveValue(first);
        await expect(bar(page, 'spells').locator('[data-special="empty"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(visibleRows(page, 'spells', rows).first()).toHaveAttribute('data-dnd-id', first);

        // Clear the search; a level chip narrows to that level only.
        await bar(page, 'spells').locator('.list-search').fill('');
        await bar(page, 'spells').locator('[data-special="empty"]').click();
        await bar(page, 'spells').locator('.filter-pill[data-lgroup="L1"]').click();
        await expect(pane(page, 'spells').locator('.spell-level-block:not(.list-filter-hidden)').first())
            .toHaveAttribute('data-spell-level', '1');
        for (const blk of await pane(page, 'spells').locator('.spell-level-block:not(.list-filter-hidden)').all()) {
            await expect(blk).toHaveAttribute('data-spell-level', '1');
        }
        await bar(page, 'spells').locator('.filter-pill[data-lgroup="L1"]').click();

        // Prepared only: untick one prepared spell; it drops out, the prepared ones stay.
        const prepared = pane(page, 'spells').locator(`${rows}:has(.spell-prep-check:checked)`);
        const nPrepared = await prepared.count();
        test.skip(nPrepared < 2, 'fixture has too few prepared spells');
        const victim = prepared.first();
        const victimName = await victim.getAttribute('data-dnd-id');
        await victim.locator('.spell-prep-check').uncheck();
        await bar(page, 'spells').locator('[data-special="prepared"]').click();
        await expect(pane(page, 'spells').locator(`${rows}[data-dnd-id="${victimName}"]`).first())
            .toHaveClass(/list-filter-hidden/);
        await expect(pane(page, 'spells').locator(`${rows}:has(.spell-prep-check:checked)`).first())
            .not.toHaveClass(/list-filter-hidden/);
    });

test('Buffs: Hide empty drops empty categories; a chip narrows to one (#149)',
    feature('lists.search-chips'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            window.SheetState.ensureBuffs(d).push(window.SheetState.normalizeBuffEntry({
                name: 'Mage Armor', subType: 'spell', active: true, changes: [],
            }));
            window.SheetApp.renderSheet(d);
        });
        await gotoTab(page, 'buffs');
        const sections = pane(page, 'buffs').locator('.buffs-section[data-buff-subtype]');
        const all = await sections.count();
        await bar(page, 'buffs').locator('[data-special="empty"]').click();
        const shown = pane(page, 'buffs').locator('.buffs-section[data-buff-subtype]:not(.list-filter-hidden)');
        expect(await shown.count()).toBeLessThan(all);
        await expect(pane(page, 'buffs').locator('.buffs-section[data-buff-subtype="spell"]')).not.toHaveClass(/list-filter-hidden/);

        await bar(page, 'buffs').locator('.filter-pill[data-lgroup="spell"]').click();
        await expect(shown).toHaveCount(1);
        await bar(page, 'buffs').locator('.list-search').fill('mage');
        await expect(visibleRows(page, 'buffs', '.buffs-row')).toHaveCount(1);
    });

test('Combat: the search reaches into the conditionals panel roll.js renders (#149)',
    feature('lists.search-chips'), async ({ page }) => {
        await openSheet(page, { fixture: 'demo-cleric' });
        await gotoTab(page, 'combat');
        const condRows = pane(page, 'combat').locator('.cond-row');
        const total = await condRows.count();
        test.skip(total < 2, 'fixture has too few conditionals');
        const name = (await condRows.first().textContent()).trim().split(/\s+/).slice(0, 2).join(' ');
        await bar(page, 'combat').locator('.list-search').fill(name);
        await expect.poll(() => visibleRows(page, 'combat', '.cond-row').count()).toBeLessThan(total);
        expect(await visibleRows(page, 'combat', '.cond-row').count()).toBeGreaterThan(0);
        // Chips include the Weapons section and the conditional groups.
        await expect(bar(page, 'combat').locator('.filter-pill[data-lgroup="weapons"]')).toHaveCount(1);
        expect(await bar(page, 'combat').locator('.filter-pill[data-lgroup^="cond-"]').count()).toBeGreaterThan(0);
    });
