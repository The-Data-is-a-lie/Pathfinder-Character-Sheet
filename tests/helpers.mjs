// Shared setup for acceptance tests. Encodes the gotchas the one-off verify scripts kept
// rediscovering (see .claude/skills/verify/SKILL.md):
//   - localStorage prefs are RAW strings, not JSON ('expert', 'full', '1').
//   - an empty library auto-renders data/demo-character.json, so "a character rendered" proves
//     nothing: wait for SheetApp.current to be the one you loaded.
//   - the Tools drawer can sit over tab content; close it before clicking into a tab.
//   - tests never reach the Render backend: every backend call is answered from a fixture.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

const FIXTURES = new URL('./fixtures/', import.meta.url);

/** Parsed copy of tests/fixtures/<name>.json (fresh object every call). */
export function fixture(name) {
    return JSON.parse(readFileSync(fileURLToPath(new URL(`${name}.json`, FIXTURES)), 'utf8'));
}

/** Tag a test with the ledger ids (tests/features.json) it proves. */
export function feature(...ids) {
    return { annotation: ids.map((id) => ({ type: 'feature', description: id })) };
}

// Any request to a backend host (the default Render URL or a ?backend= override) is stubbed.
const BACKEND_RE = /\/(update_character_data|generate_loot)(\?|$)/;

/**
 * Route backend calls. `generate` is the fixture name (or object) answered to
 * /update_character_data; requests are recorded on the returned array.
 */
export async function stubBackend(page, { generate = 'demo-cleric' } = {}) {
    const calls = [];
    await page.route(BACKEND_RE, async (route) => {
        const req = route.request();
        calls.push({ url: req.url(), method: req.method(), body: req.postDataJSON?.() ?? null });
        if (req.url().includes('generate_loot')) {
            if (req.method() === 'GET') return route.fulfill({ status: 200, json: { ok: true } });
            return route.fulfill({ status: 200, json: { items: [] } });
        }
        const data = typeof generate === 'string' ? fixture(generate) : generate;
        return route.fulfill({ status: 200, json: data });
    });
    return calls;
}

/**
 * Open the sheet in a known state. `fixture` (name or object) is loaded through the same
 * path as Load JSON, so it lands in the library like a real character.
 */
export async function openSheet(page, { fixture: fx = null, audience = 'expert', view = 'full', generate } = {}) {
    await page.addInitScript(({ audience, view }) => {
        try {
            if (!sessionStorage.getItem('__harness_seeded')) {
                localStorage.setItem('sheet.audience', audience);
                localStorage.setItem('sheet.viewMode', view);
                localStorage.setItem('sheet.seenStartHere', '1');
                localStorage.setItem('sheet.themePromptSkip', '1');
                sessionStorage.setItem('__harness_seeded', '1');
            }
        } catch { /* storage blocked: the sheet still renders with defaults */ }
    }, { audience, view });
    const calls = await stubBackend(page, { generate });
    await page.goto('index.html');
    await page.waitForFunction(() => window.SheetApp && window.SheetGenerate && window.SheetApp.current);
    if (fx) {
        const data = typeof fx === 'string' ? fixture(fx) : fx;
        await page.evaluate((json) => window.SheetGenerate.loadJsonText(json), JSON.stringify(data));
        await waitForCharacter(page, data.character_full_name);
    }
    return { calls };
}

/** Wait until the rendered character is `name` (by data, not page text). */
export async function waitForCharacter(page, name) {
    await page.waitForFunction((n) => window.SheetApp?.current?.character_full_name === n, name);
}

/** Switch to a tab by id ('combat', 'buffs', 'spells', …) with the Tools drawer closed. */
export async function gotoTab(page, id) {
    await page.evaluate(() => window.SheetRoll?.setOpen?.(false));
    await page.locator(`.tab-btn[data-tab="${id}"]`).click();
    await expect(page.locator(`.tab-pane[data-tab="${id}"]`)).toBeVisible();
}

export const test = base;
export { expect };
