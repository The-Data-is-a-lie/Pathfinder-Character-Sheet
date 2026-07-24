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

- **On first load the _Start here_ card auto-opens — not the theme picker.** It is built on
  the shared `SheetOverlay` shell, so the root is `.sheet-overlay` (there is no
  `#theme-modal` element any more). Inside it: `.start-go` closes it and opens `#gen-panel`,
  and `.start-link` × 2 are "Show me everything" (stacks the full instructions on top) and
  the expert opt-out. `❓ Start here` on the rail/topbar (`.pa-start`) reopens it anytime.
  Shown once — `sheet.seenStartHere` is set the moment it opens.
- **The theme picker is the EXPERT's first screen.** It auto-opens only while
  `sheet.audience === 'expert'` and `sheet.themePromptSkip` is unset — a beginner never sees
  it unprompted, so most flows need no dismissal step at all; use `#theme-btn` to open it on
  demand. Dismiss with `#theme-modal-done`, pick with `.theme-modal-pick[data-theme-id=…]`,
  and `#theme-modal-help` is the reverse path: it flips the audience back to beginner and
  stacks Start here on top.
- While an overlay is closed its content is parked in `#overlay-stash` (hidden), so ids like
  `#theme-modal-grid` and `#theme-modal-skip` still resolve — don't assert on visibility to
  decide if it's open; count `.sheet-overlay` instead. This applies to adopted **footer**
  nodes as well as the body.
- **First-time state** comes from `sheet.audience` (unset ⇒ `beginner`): SIMPLE view,
  `body.explain` on, `body.rail-open` on. `sheet.viewMode` / `sheet.explainMode` /
  `sheet.railOpen` still override per key — set those in localStorage before reloading if a
  flow needs the complex/tabbed sheet. Setting `sheet.audience = 'expert'` flips all three.
  Note the knock-on: on beginner the sheet is the simple view, which has **no `.tab-btn`
  elements** — switch to Complex before driving any tab.
- **Theme default:** a profile with no stored `sheet.theme` gets **sepia**, regardless of the
  emulated `prefers-color-scheme`. The default is mirrored in the pre-paint script in
  `index.html` and `DEFAULT_THEME` in `sheet.js` — assert `html[data-theme]`. An explicit
  `sheet.theme = 'system'` still resolves to parchment/dusk, and `?theme=…` still overrides.
- **Edge panels** (Tools drawer left, action rail right) share `scripts/edgepanel.js`. Both
  respond to a grip drag (`#tools-resize` / `#rail-resize`), a ☰ tap (`#tools-toggle` /
  `#rail-toggle`), a ☰ hold-and-drag, and arrow keys on the focused grip. Assert on the body
  classes `tools-open` / `rail-open`, and on `--tools-width` / `--rail-scale` (the rail's
  drag drives a scale factor, not a width; clamped 1.0–3.5). Under 900px the rail is a
  tap-only bottom bar and `#rail-resize` is hidden.
- **Toasts:** `SheetOverlay.toast()` renders into a single reused `#sheet-toast`; it is
  showing while it has `.is-on` and self-clears after ~2.4s. Toggling Explain fires one.
- Generate is a quick form: `#gen-roll` (submit), `#gen-surprise`, and the old 20-field grid
  behind `<details class="gen-advanced">`. Level is `select[name=quickLevel]`, which mirrors
  into `highestLevel` + `lowestLevel`.
- Load a character without the backend: `#toggle-load` → fill `#json-paste` with a minimal JSON like `{"character_full_name":"T","str":14,"equipment_list":["Longsword","Backpack"],"gold":50}` → click `#render-paste`.
- Item sheets open from `.inv-item-open` (the item-name button).
- Tabs: `.tab-btn[data-tab="inventory"|"settings"|…]`.
- Settings theme radios are covered by their swatch strip — click the `.settings-theme-option` label, not the input.
- Custom theme state lives in localStorage: `sheet.theme`, `sheet.customTheme`, `sheet.customThemeTokens`.

## Gotchas

- `page.on('pageerror')` catches sheet render errors that otherwise fail silently.
- Inventory interactions re-render the whole pane; re-query elements after every click.
- Kill the http.server when done (`netstat -ano | grep :8971`).
