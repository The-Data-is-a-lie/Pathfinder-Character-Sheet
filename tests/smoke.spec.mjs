// Pipeline smoke tests: prove the harness end to end (boot, stubbed generate, a roll).
import { test, expect, openSheet, gotoTab, waitForCharacter, fixture, feature } from './helpers.mjs';

test('sheet boots and renders a loaded character with its tabs',
    feature('shell.boot-with-character'), async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await openSheet(page, { fixture: 'wizard' });
        await expect(page.locator('.tab-btn')).not.toHaveCount(0);
        for (const id of ['summary', 'combat', 'spells', 'buffs', 'inventory']) {
            await expect(page.locator(`.tab-btn[data-tab="${id}"]`)).toBeVisible();
        }
        await gotoTab(page, 'spells');
        expect(errors).toEqual([]);
    });

test('Generate posts to the backend and renders the returned character',
    feature('generate.backend-roundtrip'), async ({ page }) => {
        const { calls } = await openSheet(page, { generate: 'psion' });
        await page.locator('#toggle-gen').click();
        await expect(page.locator('#gen-panel')).toBeVisible();
        await page.locator('#gen-roll').click();
        await waitForCharacter(page, fixture('psion').character_full_name);
        await expect(page.locator('#gen-panel')).toBeHidden();
        const post = calls.find((c) => c.url.includes('/update_character_data'));
        expect(post?.method).toBe('POST');
        expect(post.body).toMatchObject({ input: 'Y' });
    });

test('a weapon Attack button posts an attack card to the roll log',
    feature('combat.weapon-attack-card'), async ({ page }) => {
        await openSheet(page, { fixture: 'mythic-fighter' });
        await gotoTab(page, 'combat');
        const before = await page.locator('#tools-log .roll-card').count();
        await page.locator('.tab-pane[data-tab="combat"] .inv-atk-row .inv-atk-btn').first().click();
        await expect(page.locator('#tools-log .roll-card')).toHaveCount(before + 1);
        await expect(page.locator('#tools-log .roll-card').last().locator('.roll-card-attack .roll-card-result'))
            .toHaveText(/^-?\d+$/);
    });
