---
type: Sheet Design Practice
title: Session vs. Identity Data
description: Separate stable character identity from mid-session mutables so volatile fields are easy to edit without endangering core stats.
resource: https://www.explorersdesign.com/turn-the-sheet-sideways/
tags:
  - pathfinder
  - character-sheet
  - information-architecture
  - ux
timestamp: 2026-07-10T00:00:00Z
---

# Session vs. Identity Data

Treat the sheet as two layers that look unified but behave differently:

| Layer | Examples | UX expectation |
| --- | --- | --- |
| **Identity** | Name, race, class, ability base scores, known feats, spell list, max HP | Edited deliberately; rarely thrash mid-fight |
| **Session** | Current HP, conditions, readied maneuvers, ammo, temporary bonuses, notes | Edited constantly; needs large hit targets and clear “current” fields |
| **Derived** | Ability modifiers, AC totals, skill bonuses after changes | Computed; prefer display over free-type unless override is intentional |

## Why the split matters

Paper sheets that force erasing max HP to track current HP are painful.
Explorer’s Design guidance is blunt: if a Post-it would track it better than a
tiny printed box, redesign that region. Digitally, session fields should:

- Auto-save without multi-step confirmations for routine updates
- Sit near the combat chrome, not only in Settings
- Visually distinguish **current** from **max** (labeling, type scale, or layout)

## Pathfinder specifics

- **Readied vs. known** maneuvers (Path of War): known list is identity; ready
  checkboxes are session state.
- **Conditionals / buff toggles**: session; defaults can be smart (e.g. stance
  damage on) but must stay reversible.
- **Notes**: session/campaign memory; travel with the character JSON when
  possible so library reloads preserve them.

# Related

- [frequency-based layout](/oks/pathfinder-character-sheet-design/information-architecture/frequency-based-layout.md)
- [editable vs. derived](/oks/pathfinder-character-sheet-design/digital-sheet-ux/editable-vs-derived.md)
- [conditionals and toggles](/oks/pathfinder-character-sheet-design/digital-sheet-ux/conditionals-and-toggles.md)

# Sources

- https://www.explorersdesign.com/turn-the-sheet-sideways/
- https://polyhedralnonsense.com/2021/06/08/the-universally-complete-and-infallibly-correct-guide-to-creating-your-own-custom-rpg-character-sheet/
