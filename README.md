# Pathfinder Character Sheet

Static web character sheet for the [Pathfinder 1E Randomized Character Generator](https://github.com/The-Data-is-a-lie/Pathfinder_Char_Creator).
Pure HTML/JS/CSS — host it on any static host (GitHub Pages, a Foundry `Data` folder, `python -m http.server`).
Character **generation** still happens on the Flask backend; this page just POSTs to it and renders the JSON.

## Usage

Open `index.html` (served over HTTP, not `file://` — the page fetches its `data/*.json`):

```
python -m http.server 8080     # then http://localhost:8080/
```

- **Generate** — posts the form to the backend and renders the result.
- **Load JSON** — paste/upload a saved `/update_character_data` response.
- The last character re-renders from `localStorage` on reload.

### Backend selection

Defaults to the hosted Render backend. Override for local dev with
`?backend=http://127.0.0.1:5001` (persisted in localStorage); reset with `?backend=default`.

## Data files

`data/*.json` are **slim extracts** of the FoundryVTT `pf1e_random_char_generator` module's
compendium exports (`every_feat.json`, `every_trait.json`, `every_class_feature.json`,
`every_spell.json`): per item, only the description HTML (which embeds Prerequisites /
Benefits), the numeric pf1 `changes` array, `contextNotes`, and light metadata.
`*_talent_conditionals.json` are copied verbatim (sphere talents live in the `pf1spheres`
compendia, not the module exports — their descriptions arrive in the backend payload).

Regenerate after the module data changes:

```
python tools/build_details.py            # reads the module folder in place
python tools/build_details.py --module-dir <path> --out-dir <path>
```

## Rolling groundwork

`scripts/details.js` exposes `SheetDetails.collectChanges(data)` and the sheet publishes the
result as `window.sheetChanges` — a normalized ledger of every numeric modifier on the
character (`changes` always-on, `notes` situational, `conditionals` per-roll toggles/riders),
each entry tagged with its source item. Dice-rolling features should consume this ledger.
The "Modifiers" sheet section is a human-readable view of the same data.
