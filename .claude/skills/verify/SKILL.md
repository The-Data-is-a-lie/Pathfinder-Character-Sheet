---
name: verify
description: Build/launch/drive recipe to verify changes to the static character sheet end-to-end in a real browser.
---

# Verifying the Pathfinder character sheet

Static HTML/JS/CSS app — no build step. The surface is the browser.

## Launch

```bash
cd <repo root>
python -m http.server 8971 &   # must be HTTP, not file:// (fetches data/*.json)
```

## Drive (Playwright)

Playwright is available through the npx cache, not node_modules. Run scripts with:

```bash
NODE_PATH="C:/Users/Daniel/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules" node script.js
```

(If chromium is missing: `npx playwright install chromium`.)

## Flows worth driving

- On first load a **theme modal** auto-opens (`#theme-modal`); dismiss with `#theme-modal-done` before anything else, or interact with its `.theme-modal-pick[data-theme-id=…]` cards.
- Load a character without the backend: `#toggle-load` → fill `#json-paste` with a minimal JSON like `{"character_full_name":"T","str":14,"equipment_list":["Longsword","Backpack"],"gold":50}` → click `#render-paste`.
- Tabs: `.tab-btn[data-tab="inventory"|"settings"|…]`.
- Settings theme radios are covered by their swatch strip — click the `.settings-theme-option` label, not the input.
- Custom theme state lives in localStorage: `sheet.theme`, `sheet.customTheme`, `sheet.customThemeTokens`.

## Gotchas

- `page.on('pageerror')` catches sheet render errors that otherwise fail silently.
- Inventory interactions re-render the whole pane; re-query elements after every click.
- Kill the http.server when done (`netstat -ano | grep :8971`).
