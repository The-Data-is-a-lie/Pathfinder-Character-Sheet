// Skills setup acceptance tests (#155): custom skills with their own ability, per-skill ACP and
// trained-only flags, and a lock that freezes ability, flags and the custom list.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const pane = (page) => page.locator('.tab-pane[data-tab="skills"]');
const row = (page, id) => pane(page).locator(`tr[data-skill="${id}"]`);

test('add a custom skill with its own ability; it rolls, totals and can be removed with Undo (#155)',
    feature('skills.custom-flags'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'skills');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await pane(page).locator('.skill-custom-name').fill('Sailing');
        await pane(page).locator('.skill-custom-ab').selectOption('wis');
        await pane(page).locator('.skill-custom-name').press('Enter');
        const r = row(page, 'cus_sailing');
        await expect(r).toHaveCount(1);
        await expect(r.locator('.skill-ability-select')).toHaveValue('wis');
        const wis = await page.evaluate(() => window.SheetDerive.abModOf(window.SheetApp.current, 'wis'));
        await expect(r.locator('.skill-total')).toHaveText(wis >= 0 ? `+${wis}` : `${wis}`);
        // @skills.<id>.mod resolves it too.
        expect(await page.evaluate(() => window.SheetFormula.evaluate('@skills.cus_sailing.mod', window.SheetApp.current).value)).toBe(wis);

        await r.locator('.skill-custom-del').click();
        await expect(row(page, 'cus_sailing')).toHaveCount(0);
        await page.locator('#sheet-toast .sheet-toast-action').click();
        await expect(row(page, 'cus_sailing')).toHaveCount(1);
    });

test('ACP and RT flags: toggling ACP moves the armor penalty; an RT skill at 0 ranks is flagged (#155)',
    feature('skills.custom-flags'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d.armor_armor_check_penalty = -4;
            window.SheetApp.renderSheet(d);
        });
        await gotoTab(page, 'skills');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        const total = async (id) => Number((await row(page, id).locator('.skill-total').textContent()).replace('−', '-'));

        // Heal (Wis) has no ACP by default; switching it on costs 4.
        const healBefore = await total('hea');
        await expect(row(page, 'hea').locator('.skill-flag[data-flag="acp"]')).toHaveAttribute('aria-pressed', 'false');
        await row(page, 'hea').locator('.skill-flag[data-flag="acp"]').click();
        expect(await total('hea')).toBe(healBefore - 4);
        // Climb (Str) has it by default; switching it off gives the 4 back.
        const climbBefore = await total('clm');
        await row(page, 'clm').locator('.skill-flag[data-flag="acp"]').click();
        expect(await total('clm')).toBe(climbBefore + 4);
        const flags = await page.evaluate(() => window.SheetApp.current._sheet.skillFlags);
        expect(flags).toEqual({ hea: { acp: true }, clm: { acp: false } });

        // Trained only: an RT skill with no ranks is marked, warned on the roll, still rollable.
        const rtRow = await page.evaluate(() => {
            const d = window.SheetApp.current;
            const SM = window.SheetSkillMath;
            const ranks = SM.parseSkillRanks(d);
            return window.SheetData.ALL_SKILLS.find((s) => s.rt && !s.variant && !s.subsystem
                && !SM.ranksForSkill(ranks, s.name) && s.name !== 'Profession')?.id;
        });
        expect(rtRow).toBeTruthy();
        await expect(row(page, rtRow)).toHaveClass(/is-untrained/);
        await row(page, rtRow).locator('.stat-roll-btn').click();
        await expect(page.locator('#tools-log .tools-log-entry').first()).toContainText('trained only');
    });

test('the lock freezes ability, flags and the custom list; ranks stay editable (#155)',
    feature('skills.custom-flags'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'skills');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await pane(page).locator('.skills-lock-btn').click();
        await expect(pane(page).locator('.skills-lock-btn')).toHaveAttribute('aria-pressed', 'true');
        await expect(row(page, 'acr').locator('.skill-ability-select')).toBeDisabled();
        await expect(row(page, 'acr').locator('.skill-flag').first()).toBeDisabled();
        await expect(pane(page).locator('.skill-custom-add')).toHaveCount(0);
        await expect(row(page, 'acr').locator('.skill-ranks-cell .dbl-edit, .skill-ranks-cell input, .skill-ranks-cell button').first()).toBeVisible();
        expect(await page.evaluate(() => window.SheetApp.current._sheet.skillsLocked)).toBe(true);
        await pane(page).locator('.skills-lock-btn').click();
        await expect(row(page, 'acr').locator('.skill-ability-select')).toBeEnabled();
    });
