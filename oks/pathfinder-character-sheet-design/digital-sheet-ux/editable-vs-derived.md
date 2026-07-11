---
type: Sheet Design Practice
title: Editable vs. Derived Fields
description: Decide which values players may type freely and which the sheet computes, with clear override rules when needed.
resource: https://polyhedralnonsense.com/2021/06/08/the-universally-complete-and-infallibly-correct-guide-to-creating-your-own-custom-rpg-character-sheet/
tags:
  - pathfinder
  - character-sheet
  - ux
  - data-model
timestamp: 2026-07-10T00:00:00Z
---

# Editable vs. Derived Fields

Every field is either **source data**, **session state**, or **derived display**.
Confusing those classes causes save bugs and player distrust.

## Classification

| Class | Examples | Interaction |
| --- | --- | --- |
| Source | Ability scores, class level, weapon choice, known feats | Editable inputs; validate ranges when helpful |
| Session | Current HP, notes, ready checkboxes, buff toggles | Editable; high save frequency |
| Derived | Ability mod, skill total, AC sum, attack line | Read-only by default; optional “override” mode for house rules |

## UX guidance

- Style derived fields differently (no faux input chrome, or locked icon) so
  players do not type into void.
- When overrides exist, mark them **overridden** and offer reset-to-calculated.
- Size inputs for **worst-case width** (largest reasonable number or name).
- Prefer bold, large type for the **play-facing number** (the modifier or total),
  with the raw score secondary.

PDF/fillable tradition used calculated fields extensively for the same reason:
reduce arithmetic errors without removing player agency over source choices.

# Related

- [session vs. identity data](/oks/pathfinder-character-sheet-design/information-architecture/session-vs-identity-data.md)
- [automation and calculations](/oks/pathfinder-character-sheet-design/digital-sheet-ux/automation-and-calculations.md)
- [typography for stats](/oks/pathfinder-character-sheet-design/visual-hierarchy/typography-for-stats.md)

# Sources

- https://polyhedralnonsense.com/2021/06/08/the-universally-complete-and-infallibly-correct-guide-to-creating-your-own-custom-rpg-character-sheet/
