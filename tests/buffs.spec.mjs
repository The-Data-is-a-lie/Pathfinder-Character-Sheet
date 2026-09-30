// Buffs tab acceptance tests.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

// x-offsets of every non-name column (and each of the three control slots) on one row.
const COLS = ['.buffs-col-dur', '.buffs-col-lv', '.buffs-col-active', '.buffs-col-ctrl'];

test('every non-name buff column lines up across rows and sections (#138)',
    feature('buffs.column-align'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page, { fixture: 'demo-cleric' });
        await gotoTab(page, 'buffs');
        const pane = page.locator('.tab-pane[data-tab="buffs"]');
        // Buff rows in two categories, next to the demo cleric's Permanent passive rows.
        for (const sub of ['temp', 'spell']) {
            await pane.locator(`.buffs-section[data-buff-subtype="${sub}"] .buffs-section-controls .inv-btn-primary`).click();
        }
        await expect(pane.locator('.buffs-row:not(.buffs-row-derived)')).toHaveCount(2);
        await expect(pane.locator('.buffs-row-derived').first()).toBeVisible();

        const rows = await pane.evaluate((el, cols) => {
            const sel = '.buffs-col-legend, .buffs-row';
            return [...el.querySelectorAll(sel)].map((row) => ({
                kind: row.matches('.buffs-col-legend') ? 'legend'
                    : (row.matches('.buffs-row-derived') ? 'derived' : 'buff'),
                cols: cols.map((c) => {
                    const r = row.querySelector(':scope > ' + c)?.getBoundingClientRect();
                    return r ? [Math.round(r.left), Math.round(r.right)] : null;
                }),
                slots: [...row.querySelectorAll(':scope > .buffs-col-ctrl > *')]
                    .map((s) => Math.round(s.getBoundingClientRect().left)),
            }));
        }, COLS);

        expect(rows.map((r) => r.kind)).toEqual(expect.arrayContaining(['legend', 'derived', 'buff']));
        const [ref] = rows;
        for (const r of rows) {
            expect(r.cols, `${r.kind} row columns`).toEqual(ref.cols);
        }
        const rowsWithSlots = rows.filter((r) => r.kind !== 'legend');
        for (const r of rowsWithSlots) {
            expect(r.slots, `${r.kind} row control slots`).toHaveLength(3);
            expect(r.slots).toEqual(rowsWithSlots[0].slots);
        }
    });
