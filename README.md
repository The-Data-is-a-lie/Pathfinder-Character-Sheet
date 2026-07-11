# Pathfinder Character Sheet

Static web character sheet for the [Pathfinder 1E Randomized Character Generator](https://github.com/The-Data-is-a-lie/Pathfinder_Char_Creator).
Pure HTML/JS/CSS — host it on any static host (GitHub Pages, a Foundry `Data` folder, `python -m http.server`).
Character **generation** still happens on the Flask backend; this page just POSTs to it and renders the JSON.

## Design knowledge (OKF)

Sheet UX, visual hierarchy, color theory, and light/dark theme practices live in an
[Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing)
bundle:

- **Local entry point:** [`oks/pathfinder-character-sheet-design/index.md`](oks/pathfinder-character-sheet-design/index.md)

For general agent/repo/git practices (not sheet-specific), use the upstream OKF
collection and its raw base whenever those topics apply:

- https://github.com/kwcantrell/okf-bundles
- `https://raw.githubusercontent.com/kwcantrell/okf-bundles/main`

### Appearance themes

On load, a centered **Choose a theme** dialog appears unless you previously
checked **Don't show this on load** (stored as `sheet.themePromptSkip`). The
top bar **Theme** button (same style as Generate / Load JSON) reopens it
anytime; Settings → Appearance has the same options. Choice is stored as
`sheet.theme`. Tokens live in `styles/sheet.css` as semantic roles (`--ink`,
`--paper`, `--panel`, `--accent`, …).

| Theme | Mode | Color idea |
| --- | --- | --- |
| **System** | auto | OS light → Parchment; OS dark → Dusk |
| **Parchment** | light | PF1 maroon on warm paper (default brand) |
| **Foundry Classic** | light | VTT rust/beige (`#782e22` on olive-beige) |
| **Forest** | light | Analogous greens |
| **Slate** | light | Cool neutrals + blue-gray accent |
| **Arcane** | light | Violet accent on lilac paper |
| **Gold** | light | Warm amber / treasure |
| **Stone** | light | Dungeon limestone neutrals |
| **Fey** | light | Soft mint fantasy |
| **Sepia** | light | Grimoire monochrome brown |
| **Dusk** | dark | Warm elevated grays, desaturated red |
| **Ember** | dark | Warm crimson battle tones |
| **Ocean** | dark | Cool dark base, blue accent |
| **Storm** | dark | Indigo night sky |
| **Midnight** | dark | Material-style `#121212` stack, soft red |
| **High contrast** | dark | Black / white / gold for max luminance separation |

Override once with `?theme=ocean` (or any id above, including `system`). Print
styles always force light ink-on-paper regardless of the interactive theme.
Contrast pairs were checked against WCAG AA (4.5:1 body text targets).

## Usage

Open `index.html` (served over HTTP, not `file://` — the page fetches its `data/*.json`):

```
python -m http.server 8080     # then http://localhost:8080/
```

- **Generate** — posts the form to the backend, renders the result, and auto-saves it to the library.
- **Load JSON** — paste/upload a saved `/update_character_data` response (also auto-saved).
- The last-viewed character re-renders on reload; switch characters with the topbar dropdown.

The sheet is a fixed FoundryVTT-style tab layout — `Summary | Attributes | Combat | Inventory |
Features | Skills | Path of War | Spells | Buffs | Biography | Notes | Settings | Spheres` —
one tab visible at a time, identical for every character (empty tabs show a placeholder).
Printing outputs all tabs sequentially.

### Character library

Characters are stored in the browser (IndexedDB — effectively unlimited). Optionally **connect a
real disk folder** (Settings tab; Chrome/Edge via the File System Access API): every save is then
mirrored as a `<Name>.json` file in that folder, the dropdown lists the folder's contents, and
JSON files dropped into the folder by hand appear automatically. Per-character freeform text
(Notes tab: Description, Personality, Notes & background) travels in `_sheet.prose` (with
`_sheet.notes` kept in sync for the background field). Settings also offers export-all / import
for browsers without folder support.

### Backend selection

Defaults to the hosted Render backend. Override in the Settings tab or with
`?backend=http://127.0.0.1:5001` (persisted in localStorage); reset with `?backend=default`.

## Data files

`data/*.json` are **slim extracts** of the FoundryVTT `pf1e_random_char_generator` module's
compendium exports (`every_feat.json`, `every_trait.json`, `every_class_feature.json`,
`every_spell.json`, `every_weapon.json`, `every_item.json`, `every_armor.json`): per item, only
what the sheet needs (description HTML with Prerequisites / Benefits, numeric pf1 `changes`,
`contextNotes`, light metadata; for weapons: action type, crit, Medium damage dice; for
spells: action type, save, damage formulas with `@cl`, range/duration/area; for inventory gear:
weight, price, slot, item type, and always-on changes).
`*_talent_conditionals.json` are copied verbatim (sphere talents live in the `pf1spheres`
compendia, not the module exports — their descriptions arrive in the backend payload).

The **Inventory** tab groups gear Foundry-style (weapons / armor / equipment / consumables /
containers), with quantity, weight, value (gp), identified toggle, carried vs stowed,
Equip/Unequip (equipped changes feed the Buffs ledger), Remove, and a Buffs editor.

Regenerate after the module data changes:

```
python tools/build_details.py            # reads the module folder in place
python tools/build_details.py --module-dir <path> --out-dir <path>
```

## Tools menu & Combat attacks

A left-edge **Tools** drawer (☰ toggle) provides freeform dice, the same weapon attack controls
as the Combat tab, conditionals, and a roll log (local only — not Foundry chat).

The **Combat** tab is the primary attack surface (Foundry-style):

- **Attack / Full attack / Damage / Atk+Dmg** for the equipped weapon
- **Conditionals** — checkboxes for this character’s Path of War maneuvers, stance damage toggles
  (default on), feat toggles (`feat_conditionals_dict`), sphere talent riders, and spell buffs
  (`spell_changes_dict`). Only known items are listed (not the entire maneuver table). Checked
  modifiers apply to the next roll; riders with `[[dice]]` expand in the log.

Weapon dice/crit come from `data/weapon_details.json`; maneuver conditionals from
`data/maneuver_changes.json` (same tables the Foundry generator attaches to weapons).

### Path of War

The Path of War tab lists **all known maneuvers** (not only currently readied) with a **Ready**
checkbox per maneuver. Ready state writes back to `maneuvers_readied_names` and auto-saves.
Stances are listed separately. **Practitioner ability** (initiation stat) is changeable and
feeds `@INITMOD` in maneuver riders — there is no global “main stat.”

### Spells

**Casting ability** is editable on the Spells tab (defaults from class / legacy `main_stat`).
Spell DC is `10 + level + ability mod`; concentration is `CL + ability mod`. **Cast** spends a
slot (and respects prepared checkboxes) and posts a Foundry-style roll-log card: touch attacks
use BAB + ability, damage formulas expand `@cl` / `min()`, and saves show the computed DC.

### Notes & Biography

**Notes** holds freeform **Description**, **Personality**, and **Notes & background** (seeded
once from generator hair/eyes/parents/siblings/etc.). **Biography** is vitals only (age,
height, weight, languages). Craft skill subtypes still use `craft_type` on the Skills tab.

### Editable fields

Identity (name, race, class, level, alignment, …), ability scores, and core combat/gear fields
are editable inline and auto-save with the character (same as Notes). Generation form is still
used to create new NPCs; edits are for post-create tweaks.

### Calculated stats & sources

AC, saves, initiative, melee/ranged, CMB/CMD (and HP notes) show a **sources** expander:
base formula pieces (Base 10, armor, Dex, class save progression, BAB, …) plus matching
always-on modifiers from the changes ledger (feats, traits, class features, talents). Integer
and simple `@abilities.X.mod` formulas are included in the total; other formulas are listed as
unresolved so you can still see the source.

**HP** is computed live as **hit dice rolled** (`total_rolled_hp`) **+ Constitution × level**
**+** ledger HP feats (e.g. Toughness `max(3, HD)`). Expand **sources** for the line items;
double-click the dice line to edit rolls. `Total_HP` is kept in sync with that sum.

**Feat tax** chains from the generator (`*_feat_tax_dict`) display Foundry-style:
`(Feat 1) Style > Follow-up > …`, with each tax child’s description under a separator in the
expandable details.

**Prepared casters** (cleric, wizard, druid, …) get Path-of-War-style **Prep** checkboxes on
each spell. Cantrips/orisons start prepared; other levels seed from
`spells_prepared_per_level` / spells per day. Toggles save on the character as
`spells_prepared_names` (per spell level). Spontaneous casters keep a plain known list.
Cast rolls use `data/spell_details.json` action data (regenerate via `build_details.py`).

**Skills** lists every core PF1 skill (not only ranked ones) with ability, ranks, misc, total,
and a **Roll** button (`1d20 + total` → Tools roll log).

**Per-buff toggles** on the Buffs tab turn individual always-on sources on/off (saved as
`_sheet.disabledBuffSources`). Off sources are ignored in AC, saves, HP feats, skills, and
attack math. Per-roll conditionals on Combat stay independent.

**Dice SFX** — a free procedural Web Audio dice rattle plays when you roll (Tools drawer,
skills, attacks).

## Rolling groundwork

`scripts/details.js` exposes `SheetDetails.collectChanges(data)` and the sheet publishes the
result as `window.sheetChanges` — a normalized ledger of every numeric modifier on the
character (`changes` always-on, `notes` situational, `conditionals` per-roll toggles/riders),
each entry tagged with its source item. The Tools drawer and future dice features consume this
ledger. The "Buffs" tab’s Modifiers section is a human-readable view of the same data.
`SheetDetails.lookupWeapon(name)` returns slim weapon roll stats for attacks.
