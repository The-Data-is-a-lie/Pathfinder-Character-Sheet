---
type: Sheet Design Practice
title: Progressive Disclosure
description: Reveal Pathfinder complexity in layers — summary first, full text and rare subsystems on demand — without hiding critical combat actions.
resource: https://blog.roll20.net/posts/redesigning-the-pathfinder-2e-character-sheet/
tags:
  - pathfinder
  - character-sheet
  - ux
  - information-architecture
timestamp: 2026-07-10T00:00:00Z
---

# Progressive Disclosure

Pathfinder cannot put every rule interaction on one screen without becoming a
wall of noise. **Progressive disclosure** keeps a stable outer shell (identity +
combat-critical numbers + primary actions) and reveals depth when the player
opts in: tabs, drawers, accordions, hover/detail panes, or “view full text.”

## Patterns that work for dense TTRPG sheets

1. **Tab chrome** — Foundry-style fixed tabs (`Summary`, `Combat`, `Skills`,
   `Spells`, `Path of War`, …) give a consistent mental map across characters.
2. **Tools drawer** — freeform dice, attack controls, and roll log stay available
   without competing with sheet reading (this project’s left-edge tools menu).
3. **Summary → detail** — list feat/maneuver **names and one-line effects** in
   combat views; full description HTML lives one click away.
4. **MVP then evolve** — Roll20’s PF2e redesign started from core play loops
   (ability scores, skills, saves, attacks, conditions, inventory), then layered
   traits, custom conditions, and deeper feat automation after validation.

## Rules of thumb

- Never bury **initiative, attack, save, or HP** behind more than one intentional
  navigation step from the default play view.
- Empty tabs for unused subsystems (e.g. no spells) should show a calm
  placeholder, not a broken layout.
- Disclosure must stay **keyboard-operable** and state-visible (`aria-expanded`,
  selected tab indication).
- Print mode may **linearize** disclosed sections so nothing important vanishes
  on paper.

## What not to do

- Do not use progressive disclosure as a place to hide **poor information
  architecture** — if players always need a field, promote it.
- Do not invent different tab orders per character class; consistency beats
  micro-optimization for rare builds.

# Related

- [frequency-based layout](/oks/pathfinder-character-sheet-design/information-architecture/frequency-based-layout.md)
- [task-oriented flows](/oks/pathfinder-character-sheet-design/digital-sheet-ux/task-oriented-flows.md)
- [focus keyboard print](/oks/pathfinder-character-sheet-design/accessibility/focus-keyboard-print.md)

# Sources

- https://blog.roll20.net/posts/redesigning-the-pathfinder-2e-character-sheet/
- https://polyhedralnonsense.com/2021/06/08/the-universally-complete-and-infallibly-correct-guide-to-creating-your-own-custom-rpg-character-sheet/
