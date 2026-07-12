# Pathfinder Character Sheet

Static web character sheet for the [Pathfinder 1E Randomized Character Generator](https://github.com/The-Data-is-a-lie/Pathfinder_Char_Creator).
Pure HTML/JS/CSS — host it on any static host (GitHub Pages, `python -m http.server`).
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
| **Custom** | either | Your own background / accent / text colors (see below) |

**Custom theme**: pick **Custom** and a builder appears with three rows — Background,
Accent, Text — each offering a hue slider, a lightness slider, and an exact color
picker. The sheet derives the full palette (panels, hovers, borders, top bar, …) from
those 3 colors and flips light/dark automatically from the background lightness; the
picked colors are applied exactly as chosen, with no contrast adjustment. Stored as
`sheet.customTheme` (plus a derived `sheet.customThemeTokens` map applied before
first paint).

**Saved themes**: the builder's **Save as theme** button snapshots the current combo as
a permanent named theme (unnamed saves become "Custom N"). Saved themes appear as
normal picker cards just before the Custom card — Custom stays the editable scratch
slot — and each card has an **×** to delete it. Deleting the active saved theme loads
its colors back into the Custom slot so the look doesn't change. Stored as
`sheet.savedThemes`.

Override once with `?theme=ocean` (or any id above, including `system`). Print
styles always force light ink-on-paper regardless of the interactive theme.
Built-in theme contrast pairs were checked against WCAG AA (4.5:1 body text targets).

## Usage

Open `index.html` (served over HTTP, not `file://` — the page fetches its `data/*.json`):

```
python -m http.server 8080     # then http://localhost:8080/
```

- **Generate** — posts the form to the backend, renders the result, and auto-saves it to the library.
- **Load JSON** — paste/upload a saved `/update_character_data` response (also auto-saved).
- The last-viewed character re-renders on reload; switch characters with the topbar dropdown.

The sheet is a fixed tab layout — `Summary | Attributes | Combat | Defenses | Inventory |
Features | Skills | Path of War | Spells | Buffs | Biography | Notes | Settings | Spheres` —
one tab visible at a time, identical for every character (empty tabs show a placeholder).
Printing outputs all tabs sequentially.

The **Features** tab mirrors the FoundryVTT pf1 features tab: a tab-wide search box with
filter pills (one per non-empty group, with counts), columned lists per group
(Name | Type | Uses | post-to-chat | remove) under a header row, and a feat-count footer
(Feats / By level / Bonus / Total, with a Missing/Excess badge vs the odd-level budget).
Feats are labeled like the generator module: `(Feat 1) / (Feat 3)`, `(Flavor 1)`,
`(Flaw 2)`, `(Story Feat 5)`, or `Fighter 1: Weapon Focus` from backend labels; numbering
is positional, so drag-reordering renumbers the acquisition slots.

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

`data/*.json` are **slim extracts** of the `pf1e_random_char_generator` module's
compendium exports (`every_feat.json`, `every_trait.json`, `every_class_feature.json`,
`every_spell.json`, `every_weapon.json`, `every_item.json`, `every_armor.json`): per item, only
what the sheet needs (description HTML with Prerequisites / Benefits, numeric pf1 `changes`,
`contextNotes`, light metadata; for weapons: action type, crit, Medium damage dice; for
spells: action type, save, damage formulas with `@cl`, range/duration/area; for inventory gear:
weight, price, slot, item type, and always-on changes).
`*_talent_conditionals.json` are copied verbatim (sphere talents live in the `pf1spheres`
compendia, not the module exports — their descriptions arrive in the backend payload).

The **Inventory** tab is a dense table grouped by category (weapons / armor / equipment /
consumables / containers): a currency bar (PP/GP/SP/CP) on top, a search filter with
category jump links, and per-category header rows with a **+** add button. Each item row
has quantity steppers, name (with description expander), slot, weight, value (gp), and
three checkboxes — identified · carried · equipped (equipped changes feed the Buffs
ledger) — plus an item-sheet shortcut (⚙, same as clicking the name) and remove (×).
The generated weapon / armor / shield migrate into the list as regular equipped items on
first render (`_sheet.coreGearMigrated`); combat math still reads `weapon_name` & co.
The footer shows total carried weight
and item value, a Light/Medium/Heavy load bar, and Above Head / Off Ground / Drag & Push
capacities.

Clicking an item's **name** opens a Foundry-style **item sheet** modal (mirrors the pf1
item window): a sidebar with type/subtype, editable quantity · weight · price · unid.
price · HP/max · hardness, Equipped / Carried / Broken / Masterwork / Identified
checkboxes, and property chips (armor AC/Max Dex/ACP, weapon dice/crit/damage types);
plus Description / Details / Changes tabs. Description holds the unidentified
("superficial") text and the identified HTML (raw-edit toggle). Details is fully
editable — type/subtype/slot, weapon damage dice / damage ability / crit, armor
AC/Max Dex/ACP — with overrides persisted per item (`item.weapon` / `item.armor`).
Changes embeds the mechanical-buffs editor. Renaming lives in the sheet header (re-keys
the shared description map). Catalog adds hydrate the full compendium record, including
`armor {value, dex, acp}` and `equipmentSubtype`; every add dialog also offers a
**Blank item** button that creates an empty item and opens its sheet.

Regenerate after the module data changes:

```
python tools/build_details.py            # reads the module folder in place
python tools/build_details.py --module-dir <path> --out-dir <path>
```

## Tools menu & Combat attacks

A left-edge **Tools** drawer (☰ toggle) provides freeform dice, the same weapon attack controls
as the Combat tab, conditionals, and a roll log (local only).

The **Summary** tab mirrors the paper sheet's top block: full-width lines for
**Hit Points / Speed** (editable HP current/temp/nonlethal + five speeds with fly
maneuverability), **Defense** (AC / Touch / Flat-footed / CMD / **FF CMD**), **Saving
Throws** (rollable Fort/Ref/Will + SR), and **Offense** (BAB iteratives, rollable
CMB/Initiative) — every box's hover lists its parts. Below: a compact attack card, then
**Class & Archetype** rows. Clicking a class opens a popup with the class chassis (HD,
BAB, saves, skills/level from a built-in PF1 table, all editable per character via
`_sheet.classInfo`), rolled-HP field, proficiencies, FCB, and a **class-skills checkbox
grid** that drives the Skills tab CS toggles (seeded once from class defaults,
`_sheet.classSkillsSeeded`). The archetype row reads the backend's `archetype_info`
(`{ "<Name>": <description> }`, base level 0). No currency here (Inventory has it).

The **Combat** tab is a lean attack hub: a full-width top strip with **BAB iteratives**
(`+11/+6/+1`, up to 4 shown) and rollable **CMB / Melee / Ranged / Initiative**, the
character's weapons as **inventory-style rows** (name/⚙ open the full item sheet), and
the attack roller. HP and speeds live on Summary; AC, saves, and armor numbers live on
Defenses.

The **Attributes** tab also carries the misc statblock info — editable **Senses**,
**Aura**, **Languages** (moved from Biography), **Weapon/Armor proficiencies**
(`_sheet.miscInfo`), and **Negative levels** (`_sheet.negativeLevels`): per PF1 each
negative level applies −1 to attack rolls, saves, skill and ability checks and −5 max
HP automatically (attacks, saves, skills, initiative, HP all include the penalty), with
a warning note covering the non-automated parts (spell-slot loss, death at HD).

The **Attributes** tab shows FoundryVTT-style ability rows — spelled-out names with
**Total / Modifier / Damage / Drain / Misc** columns stretched full width. Total's hover
shows the formula (base + items/buffs + misc − drain); Damage applies pf1's −1 mod per
2 points; Damage/Drain/Misc persist in `_sheet.abilityAdjust`. Ability-targeted ledger
changes (e.g. a Belt of Giant Strength's `+4 str`) now flow into every derived modifier
(attacks, saves, skills, casting).

- **Attack / Full attack / Damage / Atk+Dmg** for the equipped weapon
- **Conditionals** — checkboxes for this character’s Path of War maneuvers, stance damage toggles
  (default on), feat toggles (`feat_conditionals_dict`), sphere talent riders, and spell buffs
  (`spell_changes_dict`). Only known items are listed (not the entire maneuver table). Checked
  modifiers apply to the next roll; riders with `[[dice]]` expand in the log.

Weapon dice/crit come from `data/weapon_details.json`; maneuver conditionals from
`data/maneuver_changes.json` (same tables the generator attaches to weapons).

### Defenses

The **Defenses** tab holds the defensive breakdown (vitals live on Biography, gear on
Inventory — each fact has one home):

- **AC composition grid** — per-bonus-type totals (Armor, Shield, Deflection, Dodge,
  Natural Armor, Enhancement, Insight, Luck, Profane, Sacred, Trait, Other) computed from
  gear + the active changes ledger; hover a box for its sources.
- **Save buckets** — Fort/Ref/Will as Base | Abl | Resist | Feat | Trait | Misc | Temp
  (Temp = manual adjustments + active buffs; Resist = resistance-type bonuses), each row
  with a **Roll** button — every ledger boost flows into the rolled total.
- **Armor & Shield** — armor/shield items render as inventory-style rows (name / ⚙ open
  the item sheet, like the weapons on Combat), followed by the numeric AC-formula inputs
  (AC bonus, max Dex, ACP, spell failure, shield AC).

**Enhancements**: migrated gear keeps its enhancement suffix (`Longsword [+1, flaming]`),
and the item sheet's Description tab lists each enhancement with what it does. Sources,
in priority order: the backend payload field **`enhancement_desc_dict`**
(`{ "<enhancement name, lowercase>": "<html or plain-text description>" }` — not sent
yet; add it server-side, the FoundryVTT module can consume the same field), then the
local item compendium, then generic wording for numeric `+N` bonuses (attack/damage for
weapons, AC for armor).
- **Damage Reduction** and **Energy Resistance** — user-managed chip lists (**+** to add:
  amount + type from the standard PF1 lists or a custom type; amounts dblclick-editable;
  **×** deletes). Stored under `_sheet.defenses`.
- **Healing & Toughness** — editable Regeneration (+ bypass text), Fast Healing, and
  Hardness boxes.
- **Damage Immunities / Vulnerabilities** and **Condition Resistances / Immunities** —
  type-only chip lists (energy + physical damage types; the PF1 condition list) with the
  same + / × / custom-type controls as DR.
- **Spell Resistance** — editable Base (seeded from the generator) + Feat / Trait /
  Class / Misc boxes (`_sheet.srBonus`); the SR shown on Summary and the simple sheet is
  the computed total.

### Path of War

The Path of War tab lists **all known maneuvers** (not only currently readied) with a **Ready**
checkbox per maneuver. Ready state writes back to `maneuvers_readied_names` and auto-saves.
Stances are listed separately. **Practitioner ability** (initiation stat) is changeable and
feeds `@INITMOD` in maneuver riders — there is no global “main stat.”

### Spells

**Casting ability** is editable on the Spells tab (defaults from class / legacy `main_stat`).
Spell DC is `10 + level + ability mod`; concentration is `CL + ability mod`. **Cast** spends a
slot (and respects prepared checkboxes) and posts a roll-log card: touch attacks
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

**Feat tax** chains from the generator (`*_feat_tax_dict`) display as:
`(Feat 1) Style > Follow-up > …`, with each tax child’s description under a separator in the
expandable details.

**Prepared casters** (cleric, wizard, druid, …) get Path-of-War-style **Prep** checkboxes on
each spell. Cantrips/orisons start prepared; other levels seed from
`spells_prepared_per_level` / spells per day. Toggles save on the character as
`spells_prepared_names` (per spell level). Spontaneous casters keep a plain known list.
Cast rolls use `data/spell_details.json` action data (regenerate via `build_details.py`).

**Skills** lists every core PF1 skill (not only ranked ones) with ability, ranks, an
editable bonus breakdown — **Racial / Feat / Trait / Misc** (double-click) plus a **CS**
class-skill toggle (+3 once the skill has ≥1 rank, PF1-style) — an automatic **Buffs**
column (ledger changes + armor check penalty), total, and a **Roll** button
(`1d20 + total` → Tools roll log). User bonuses persist in `_sheet.skillBonuses`; the
simple sheet folds them into its Misc column.

**Buffs tab** layout:

1. **Conditions** — click chips to toggle; double-click active chips for a duration note.
2. **Buffs by category** (Temporary / Spell / Feat / Permanent / Item / Misc) — each row has
   name, duration, level, **Active** checkbox, Edit / duplicate / delete. Create with **+**
   (seeds an example +1 AC change) or **Browse** (feats/items catalog — adds exactly the
   compendium changes, possibly none). Stored as `_sheet.buffs` (migrates legacy
   `_sheet.tempBuffs`). Only active buffs enter the changes ledger.
3. Always-on modifiers from feats/traits/items/class features render as rows **inside the
   Permanent section** (kind tag, Active checkbox → `_sheet.disabledBuffSources`, **×**
   delete → `_sheet.removedBuffSources`, with a **Restore removed sources (N)** button).
   There is no separate "passive sources" panel.
4. A pointer to per-roll conditionals (Combat / Tools). Situational context notes (e.g.
   "+3 trait bonus vs. followers of Aroden") are **not** listed here — they appear as ⓘ
   hover tooltips on the relevant skill rows (Skills tab) and attack/damage/CMB/CMD rows
   (Combat tab), deduplicated per source.

**Dice SFX** — a free procedural Web Audio dice rattle plays when you roll (Tools drawer,
skills, attacks).

## Rolling groundwork

`scripts/details.js` exposes `SheetDetails.collectChanges(data)` and the sheet publishes the
result as `window.sheetChanges` — a normalized ledger of every numeric modifier on the
character (`changes` always-on, `notes` situational, `conditionals` per-roll toggles/riders),
each entry tagged with its source item. The Tools drawer and future dice features consume this
ledger. The Buffs tab shows buff items plus passive source toggles over the same
data. `SheetDetails.lookupWeapon(name)` returns slim weapon roll stats for attacks.
