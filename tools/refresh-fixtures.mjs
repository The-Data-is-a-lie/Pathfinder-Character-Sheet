// Re-pull the acceptance-test fixtures from the REAL generator backend (Render).
//   npm run fixtures:refresh            all fixtures
//   npm run fixtures:refresh -- psion   just the named one(s)
//
// Drives the actual page (SheetGenerate.generateCustom) so the request payload is always
// whatever buildPayload sends today, and saves the RAW response body — the same JSON a user's
// Generate would receive — before the sheet adds any _sheet state to it.
// The free backend can take ~30-60 s to wake; each call gets a generous timeout.
import { copyFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));
const PORT = 8972;

// name -> generate overrides (merged over the form's defaults).
const RECIPES = {
    'mythic-fighter': { class: 'fighter', highestLevel: '8', lowestLevel: '8', mythic: 3 },
    'luck-buyer': { class: 'rogue', highestLevel: '6', lowestLevel: '6', luck_direction: 'buy' },
    'summoner': { class: 'summoner', highestLevel: '8', lowestLevel: '8' },
    'psion': { class: 'psion', highestLevel: '5', lowestLevel: '5' },
    'druid': { class: 'druid', highestLevel: '6', lowestLevel: '6' },
    'wizard': { class: 'wizard', highestLevel: '7', lowestLevel: '7' },
};

const only = process.argv.slice(2);
const names = only.length ? only : Object.keys(RECIPES);

copyFileSync(`${ROOT}/data/demo-character.json`, `${OUT}/demo-cleric.json`);
console.log('demo-cleric.json  <- data/demo-character.json');

const server = spawn(process.execPath, [`${ROOT}/tools/serve.mjs`, String(PORT)], { stdio: 'ignore' });
const browser = await chromium.launch();
try {
    await new Promise((r) => setTimeout(r, 500));
    const page = await browser.newPage({ serviceWorkers: 'block' });
    await page.addInitScript(() => {
        localStorage.setItem('sheet.audience', 'expert');
        localStorage.setItem('sheet.seenStartHere', '1');
        localStorage.setItem('sheet.themePromptSkip', '1');
    });
    await page.goto(`http://127.0.0.1:${PORT}/index.html`);
    await page.waitForFunction(() => window.SheetGenerate && window.SheetApp);
    for (const name of names) {
        const overrides = RECIPES[name];
        if (!overrides) { console.error(`unknown fixture: ${name}`); process.exitCode = 1; continue; }
        const respP = page.waitForResponse((r) => r.url().includes('/update_character_data'), { timeout: 180_000 });
        const run = page.evaluate((o) => window.SheetGenerate.generateCustom(o).then(() => 'ok', (e) => String(e)), overrides);
        const resp = await respP;
        const body = await resp.json();
        const outcome = await run;
        if (!resp.ok() || outcome !== 'ok') {
            console.error(`${name}: HTTP ${resp.status()} ${outcome}`);
            process.exitCode = 1;
            continue;
        }
        writeFileSync(`${OUT}/${name}.json`, JSON.stringify(body, null, 1) + '\n');
        console.log(`${name}.json  <- ${JSON.stringify(overrides)}  (${body.character_full_name})`);
    }
} finally {
    await browser.close();
    server.kill();
}
