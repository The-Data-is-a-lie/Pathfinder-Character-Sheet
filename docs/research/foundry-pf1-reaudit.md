# Re-audit: Foundry pf1 actor-sheet affordances missing from #6 and from this sheet

Ticket: #137 (map #134). Baseline: the #6 parity checklist (not re-listed here).

**pf1 version audited:** `systems/pf1/system.json` reports **11.11** (changelog dated 2026-03-09).
There is no pf1 release after that, so nothing has been added "since mid-2026". The 11.x
changelog items that touch the actor sheet are folded in below (11.5 secondary conditions,
11.7/11.8 apply-damage dialog, 11.10 health configuration).

**Sources (primary only):** `systems/pf1/templates/actors/**` (character-sheet.hbs + `parts/*.hbs`),
`systems/pf1/pf1.js` (bundled sheet class; listener block `activateListeners`, `getQuickActions`,
`_onItemSplit`, `_onItemGive`, `_quickChangeItemQuantity`, `_mouseWheelAdd`, `_onRest`),
`systems/pf1/lang/en.json`, `systems/pf1/CHANGELOG.md`. Sheet evidence is by grep of `scripts/`.

Path prefix below: `T/` = `systems/pf1/templates/actors/`, `JS` = `systems/pf1/pf1.js`.

**Stale #6 verdicts noticed on the way (not gaps, just corrections):** full rest is now done
(`doRest` in `scripts/tabs/summary.js` refills slots, uses, HP, ability damage, opt-in item
charges, spell points), XP tracking exists (#14), skill-rank budget exists, extra spellbooks exist.

## Gap table

Status: **absent** = nothing found; **partial** = related thing exists, the pf1 behaviour does not.

| # | Feature | Where in pf1 | What it does | This sheet |
|---|---|---|---|---|
| 1 | Pinned "Quick Actions" bar | `T/parts/actor-summary.hbs` (`.quick-actions`), `JS` `getQuickActions` (items with `showInQuickbar`) | Any item can be pinned to a strip of icons on the Summary tab; click uses it, right-click opens it, badge shows charges/ammo left. | **partial.** `summaryQuickActions` (`scripts/tabs/summary.js:164`) is a fixed row of buttons (Initiative, Full attack, Rest, Level up...). The player cannot pin their own items or spells. |
| 2 | Drag a roll out as a shortcut | `JS` drag start: `data-drag="defenses|concentration|cl|abilityScore|attack|save"` | Every roll box is draggable to the hotbar as a macro. Web analogue = user-curated favourite rolls. | **absent** (no `draggable` in `scripts/tabs/`; folds into row 1). |
| 3 | Per-tab filter chips + prepared-only / hide-empty | `T/parts/actor-item-nav-filters.hbs` (search input + one chip per section + `prepared` + `empty`), used on Combat, Inventory, Features, Buffs, Spells | One search box and section chips on every list tab; two special chips for "only prepared" and "hide empty sections". | **partial.** Search exists only on Inventory (`tabs/inventory.js:201`) and Features (`tabs/features.js`); prepared-only exists on Spells (`tabs/spells.js:932`). None on Combat, Buffs, or Spells search; no hide-empty chip. |
| 4 | Wheel / Ctrl+wheel and relative typing on numeric boxes | `JS` `_mouseWheelAdd`, `.wheel-change`, `data-wheel-step`, `allow-relative` (`T/parts/actor-summary.hbs` HP boxes, item charges, buff level, spell uses) | Scroll on HP/charges/quantity to nudge; type `+5` / `-3` into HP to add or subtract. | **absent** (only "wheel" hits are comments in `shell-ui.js`). |
| 5 | Shift = x5, Ctrl = x10 on quantity +/- | `JS` `_quickChangeItemQuantity` | Held modifier multiplies the step, so 40 arrows is two clicks. | **absent** (`shiftKey`/`ctrlKey` appear only in `overlay.js` and `shortcuts.js`). |
| 6 | Split stack | `T/parts/actor-inventory.hbs` (`.item-split`), `JS` `_onItemSplit`, `PF1.Dialog.SplitItem` | Dialog splits a stack into two rows (e.g. move 20 arrows into a quiver). | **absent** (no split in `tabs/inventory.js`). |
| 7 | Duplicate item on a row | every `T/parts/*.hbs` list (`.item-duplicate`) | One click clones a weapon/feat/buff/spell. | **partial.** Only Buffs has it (`tabs/buffs.js`); none on Inventory, Features, Spells, Combat rows. |
| 8 | Give item to another actor | `T/parts/actor-inventory.hbs` (`.item-give`), `JS` `_onItemGive` | Hand an item to another character in one click. | **absent**, and mostly out of scope for a single-user sheet. Overlaps the #118 share-link decision. |
| 9 | Coin "convert" button | `T/parts/actor-inventory.hbs` (`.convert-currency`), `JS` `convertCurrency` | Rolls lower denominations up into higher ones (100 cp -> 1 gp) per coin type. | **absent** (`normalizeCurrency` in `domain/inventory-model.js` fixes the gold/platinum double count only). The weightless second purse (`altCurrency`) **is** present. |
| 10 | Carry-capacity user bonus / multiplier fields | `T/parts/actor-inventory.hbs` footer (`system.details.carryCapacity.bonus.user`, `multiplier.user`) | Two inputs beside the load bar for a Str bonus and a load multiplier (Ant Haul, pack animal, quadruped x1.5). | **partial.** `carryStr` / `carryMult` exist only as ledger targets (`scripts/details.js:1452`); no direct inputs on the Inventory footer. |
| 11 | Ability checks | `T/parts/actor-attributes.hbs` (`.ability-name.rollable`), `JS` `_onRollAbilityTest` | Click "Strength" to roll a Str check. | **absent** (Attributes tab has only an Initiative `rollBtn`, `tabs/attributes.js:17`). |
| 12 | Defenses chat card | `T/parts/actor-summary.hbs`, `actor-combat.hbs` (`.generic-defenses .rollable`), `JS` `displayDefenseCard` | One click posts AC / touch / flat-footed / CMD / SR / saves for the GM or table to see. | **absent** (no equivalent in the roll log). |
| 13 | Post any row to chat by clicking its icon | every list row (`.item-image.rollable`, `data-tooltip="PF1.DisplayInChat"`), `JS` `_onItemCard` | Feature, weapon, spell, buff or race description posts as a card. | **partial.** Post-to-log exists on Features only (`tabs/features.js`); not on Combat, Inventory, Spells, Buffs. |
| 14 | Custom skills + per-skill flags + edit lock | `T/parts/actor-skills.hbs` (`.skill-create`, `.skill-edit`, `.skill-delete`, `.skill-acp`, `.skill-rt`), `actor-skills-front.hbs` (`.skill-lock-button`) | Add arbitrary skills with their own ability; per-skill "armor check penalty" and "requires training" checkboxes; a lock that stops fat-finger edits of ability/flags. | **partial.** Per-skill ability select exists (`tabs/skills.js:227`) and Craft/Perform/Profession sub-skills exist. No arbitrary skill, no ACP/RT flags, no lock. |
| 15 | Ability-score links | `T/parts/actor-settings-ability-scores.hbs`, `actor-settings.hbs` | Settings tab picks which ability drives HP, each save, initiative, CMB, melee, ranged, AC, touch, CMD (Str and Dex halves). | **absent** (no `abilityLink` anywhere; only spellcasting ability is editable). |
| 16 | Creature traits: quadruped, stature, reach, age category | `T/parts/actor-traits.hbs` (Reach, Size, Stature, Age category, Quadruped checkbox) | Reach readout, tall/long stature, quadruped flag (feeds carry x1.5 and mounts). | **absent** (`sizeInfo` exists; no reach/stature/quadruped in `scripts/`). |
| 17 | Spellbook casting formulas + notes per book | `T/parts/actor-spellbook.hbs` config: concentration bonus formula, CL bonus formula, base DC formula, slot-ability-bonus formula, CL/concentration notes, arcane spell failure %, "no casting ability limit", "has cantrips" | Per-book overrides and free-text notes shown in the roll tooltip. | **partial.** Casting ability and CL are editable per book (`tabs/spells.js`); no DC/slot/concentration formulas, no notes, no per-book ASF (`baseDCFormula`, `arcaneSpellFailure` not found). |
| 18 | Range readout per spellbook | `T/parts/actor-spellbook.hbs` (`.ranges` close / medium / long) | Shows Close = 25 + 5 ft per 2 CL etc. beside the book header. | **absent** (`close/medium/long` appears only as an editor placeholder, `tabs/spells.js:523`). |
| 19 | Per-spell prepared count and domain flag | `T/parts/actor-spellbook.hbs` (`.spell-uses` amount/max, `.item-toggle-prepared`, `item.domain` icon and domain slot bonus badge) | A spell can be prepared N times; domain / specialist spells are marked and the level header shows the bonus slot. | **partial.** Domain / specialist slot rule is a reminder line (`tabs/spells.js:223-233`); prepared is a per-name checkbox, not a count; spells are not individually flagged domain. |
| 20 | Multi-action items + action picker | `JS` `ActionSelector` (`PF1.Application.ActionSelector`), Combat/Features/Inventory `.item-actions` column | One item holds several actions (e.g. a sword with normal and Power Attack attack, a feat with two uses), each with its own save, DC, damage, range, target, template; a picker appears when there is more than one. | **absent.** Items carry a single weapon/attack block; routines (`_sheet.attackRoutines`) cover full-attack sequences, not per-item alternate actions. |
| 21 | Unified attack list with Damage / Range / Ammo columns | `T/parts/actor-combat.hbs` | Combat tab lists weapons, natural attacks, spell/feat attacks in one table; resolved damage formula, range and ammo-left columns per row. | **partial.** Weapons render as inventory-style rows (per `CLAUDE.local.md` Combat notes); spell and feat attacks live on their own tabs. |
| 22 | Hover "data reference" tooltips | `JS` `_activateExtendedTooltip` (`data-tooltip-extended`), tour step "Data references" | Hovering any stat lists every source **and** the formula path (`@attributes.hp.max`) to reference it. | **partial.** Source breakdowns exist ("sources" expanders); the `@...` path is never shown, although `SheetFormula` resolves those tokens. |
| 23 | Apply-damage dialog extras | `PF1.Application.Damage` in `en.json`; CHANGELOG 11.7 / 11.8 | Bonus damage/healing field, "Dual Heal" (HP and nonlethal), "as Wounds", DR/magic/material penetration tags, immunities. | **partial.** Apply / half / NL buttons exist; the DR-routing gap is already #6. Bonus-amount field, dual heal and penetration tags are the new parts. |
| 24 | Secondary conditions | CHANGELOG 11.5 | Paralyzed / sleep automatically imply helpless. | **partial.** `paralyzed` says "helpless" in its note only (`scripts/data.js:108`); it does not switch on `helpless`' `loseDex`. |
| 25 | Condition tray: immune / racial-source display, compendium link | `T/parts/actor-buffs.hbs` (`.condition.immune`, `.sources`, `.compendium-entry`) | A condition the character is immune to is struck through with the reason (racial trait, item); each links to its rules entry. | **absent** (immunity list exists on Defenses; the tray does not consult it). |
| 26 | Health configuration | `PF1.Application.Settings` Health Configuration; CHANGELOG 11.10 | Choose continuous vs discrete HP progression, rounding, NPC auto-HP, maximised first HD. | **absent** (HP is rolled total + Con x level; no options). |
| 27 | Point-buy on an existing sheet | `T/parts/actor-settings.hbs`, `actor-attributes.hbs` (`.pointbuy-calculator`) | Point-buy calculator available any time from Settings. | **partial.** Exists only in the creation flow (`scripts/create.js`). |
| 28 | Bonus feat / bonus skill-rank formula inputs | `T/parts/actor-features.hbs` footer (`bonusFeatFormula`), `actor-skills-front.hbs` (`bonusSkillRankFormula`) | A formula box next to the budget for "+1 per 2 levels" style extras. | **partial.** Budgets come from the class table and ledger (`bonusSkillRanks`); no user formula box (`bonusFeatFormula` not found). |
| 29 | Metric units | `convertDistance` in `T/parts/actor-summary.hbs`; CHANGELOG 11.8 | World setting switches speeds, ranges, weights to metric. | **absent.** |
| 30 | Cybertech implantation load | `T/parts/actor-attributes.hbs` (`.implants` load / max) | Slot-load stat for implants. | **absent** (`implants` only maps to the equipment category, `inventory-model.js:109`). |
| 31 | Guided sheet tour | `systems/pf1/tours`, `PF1.Tour.ActorSheet` steps | Step-by-step spotlight of each region of the sheet. | **partial.** Start here (four steps) and Explain mode cover the beginner case; no per-region spotlight tour. |
| 32 | Right-click shortcuts | `JS` listeners: `contextmenu` on item name / quick action / race opens the item; on a condition edits its duration | Right-click = open editor without hunting for the pencil. | **partial.** Double-click on chips edits duration; no right-click item open (`contextmenu` used only for the portrait and one roll widget). |

Out of scope on purpose (single-user web sheet, no chat log / tokens / permissions): roll modes
and roll obfuscation, Party Rest with watches, XP Distributor, Vision Sharing, currency transfer
between actors, GM-only identify column and Magic Items table, limited-permission sheet.

## Ranked: most missed by a Foundry player

Ranked by how often a Foundry player touches the thing in a normal session, then by how bad
the workaround is.

1. **Pinned Quick Actions bar** (rows 1, 2). The pf1 Summary tab is a launchpad; here the strip is fixed.
2. **Search + filter chips on every list tab, incl. hide-empty and prepared-only** (row 3). Spells, Combat and Buffs have no search.
3. **Wheel / relative typing on HP and counters** (row 4). "Type -7 into HP" is muscle memory.
4. **Click a row's icon to post it** (row 13), plus the **Defenses card** (row 12).
5. **Multi-action items** (row 20). Power Attack, alternate modes and dual-use feats are one item in pf1.
6. **Ability check rolls** (row 11). Strength/Dex/Con/etc. checks are a one-click roll in pf1, absent here.
7. **Item row verbs: duplicate everywhere, split stack, x5/x10 quantity** (rows 5, 6, 7).
8. **Custom skills, per-skill ACP/RT flags, edit lock** (row 14).
9. **Per-book spell formulas, notes, range readout, ASF** (rows 17, 18) and **per-spell prepared count** (row 19).
10. **Ability-score links** (row 15) and **carry bonus / multiplier fields** (row 10). Both are how a table encodes "undead use Cha for HP" or "pack mule".

Honourable mentions just below the line: hover formula paths (22), quadruped/reach (16),
immune condition chips (25), secondary conditions (24).
