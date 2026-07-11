---
type: Sheet Design Practice
title: Automation and Calculations
description: Use sheet automation to remove repetitive Pathfinder math while keeping players in control when edge cases appear.
resource: https://blog.roll20.net/posts/redesigning-the-pathfinder-2e-character-sheet/
tags:
  - pathfinder
  - character-sheet
  - automation
  - ux
timestamp: 2026-07-10T00:00:00Z
---

# Automation and Calculations

Pathfinder is modifier-heavy. Digital sheets should **derive** ability modifiers,
skill totals, AC stacks, and attack lines from a single source of truth whenever
possible. Roll20’s PF2e redesign explicitly re-engineered calculation propagation
so automation “only help[s] and never get[s] in the way of playing.”

## Principles

1. **One ledger of changes** — normalize feats, items, spells, and conditions into
   tagged modifiers (always-on, situational notes, per-roll conditionals). This
   project’s `SheetDetails.collectChanges` / `window.sheetChanges` pattern is the
   right shape.
2. **Propagate completely** — if a condition grants a bonus, it should flow to
   every relevant total, not only the field nearest the checkbox.
3. **Show the math on demand** — a Buffs / Modifiers view builds trust; opaque
   totals cause players to re-calculate by hand.
4. **Fail open** — if a lookup misses (unknown weapon, missing feat data), allow
   manual dice entry rather than blocking the turn.
5. **MVP first** — automate core loops (scores → mods → skills/saves/attacks)
   before exotic trait engines.

## Anti-patterns

- Double-entry of the same bonus in two places that can drift.
- Silent clamping or “helpful” correction of player overrides mid-session.
- Auto-rolling without a clear trigger (players need intentional Attack / Full
  attack / Damage actions).

# Related

- [conditionals and toggles](/oks/pathfinder-character-sheet-design/digital-sheet-ux/conditionals-and-toggles.md)
- [editable vs. derived](/oks/pathfinder-character-sheet-design/digital-sheet-ux/editable-vs-derived.md)
- [task-oriented flows](/oks/pathfinder-character-sheet-design/digital-sheet-ux/task-oriented-flows.md)

# Sources

- https://blog.roll20.net/posts/redesigning-the-pathfinder-2e-character-sheet/
- https://polyhedralnonsense.com/2021/06/08/the-universally-complete-and-infallibly-correct-guide-to-creating-your-own-custom-rpg-character-sheet/
