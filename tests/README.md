# Acceptance harness

This harness answers one question: does the sheet still have every feature on the list?

```
npm install            # once (also: npx playwright install chromium)
npm test               # run every browser test, then check the ledger
npm run features       # print the report: counts, untested debt, gap list
npm run fixtures:refresh [name…]   # re-pull fixtures from the live backend
```

## The ledger: `features.json`

The ledger has one row per feature: `id`, `area`, `title`, `source`, `status`, `ticket?` and `gap?`.

| status | meaning | checker |
|---|---|---|
| `have` | shipped and proven | needs at least one passing test tagged with its id, or `npm test` **fails** |
| `untested` | shipped, not yet proven | reported as debt; never fails the run |
| `partial` | partly built | needs a `gap` note; its tagged tests must pass |
| `missing` | wanted, not built | listed in the gap report |
| `out` | ruled out of scope | kept for the record |

`source` is one of three values:
- `foundry`: parity with the FoundryVTT pf1 sheet.
- `surpass`: better than Foundry.
- `user`: asked for directly.

The checker also fails in two cases: a test tags an id that is not in the ledger, and an id appears twice.

## Writing a test

```js
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

test('what the user sees', feature('area.some-feature'), async ({ page }) => {
    await openSheet(page, { fixture: 'wizard' });   // lands in the library like Load JSON
    await gotoTab(page, 'spells');
    // …assert what a user would see
});
```

What the helpers take care of:
- **Backend stub.** The generator backend is always stubbed; tests never reach Render.
- **Generate.** Generate answers with the `generate:` fixture (default `demo-cleric`).
- **Starting view.** The sheet opens in the expert, tabbed view, with Start here and the theme picker already dismissed.
- **Other options.** `openSheet` takes `audience` and `view` for the beginner or simple sheet.

## Fixtures (`fixtures/`)

These are raw `/update_character_data` responses from the live backend (re-pulled 2026-09-29):

| fixture | why it's here |
|---|---|
| `demo-cleric` | copy of `data/demo-character.json`: level-20 cleric plus Path of War |
| `wizard` | prepared arcane caster, spells |
| `psion` | psionics, manifester |
| `summoner` | eidolon (`bonded_creatures`) |
| `druid` | animal companion |
| `mythic-fighter` | `mythic` block |
| `luck-buyer` | `luck` block, buy direction |

## Rule for every PR

A PR that changes behaviour does three things:
- adds a row or flips its status;
- ships at least one tagged browser test;
- if it fixes a bug, adds a regression test on the row it fixes.

CI (`.github/workflows/test.yml`) runs on every PR and on `main`.
