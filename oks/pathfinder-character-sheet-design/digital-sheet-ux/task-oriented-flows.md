---
type: Sheet Design Practice
title: Task-Oriented Flows
description: Design digital sheet interactions around play tasks (roll initiative, full attack, ready a maneuver) validated with real user paths.
resource: https://blog.roll20.net/posts/redesigning-the-pathfinder-2e-character-sheet/
tags:
  - pathfinder
  - character-sheet
  - ux
  - lean-ux
timestamp: 2026-07-10T00:00:00Z
---

# Task-Oriented Flows

A character sheet is not a database form; it is a **control surface for play**.
Roll20’s PF2e work used Lean UX: define hypotheses, sketch lo-fi flows (e.g.
“where do you roll initiative?”), measure misclicks and time-on-task, then
promote winners into hi-fi layout and chrome.

## Core Pathfinder tasks to design explicitly

| Task | Success look |
| --- | --- |
| Start of combat | Initiative path obvious; conditions visible |
| Standard / full attack | Weapon actions + conditionals + damage in one region |
| Defend / take a hit | AC, saves, HP update without leaving combat context |
| Cast / activate | Spells/spheres/maneuvers reachable; DC and cost clear |
| Skill check | Skill bonus + linked ability; optional roll control |
| Between scenes | Inventory, notes, leveling fields without cluttering combat |

## Method notes

- **Assume less, learn more** — watch where users click when asked to perform a
  task; high misclick rates mean hierarchy failure.
- **Start simple** — ship the task path before visual polish.
- **Keep parallel affordances honest** — if Attack exists in both Combat and
  Tools, both must apply the same conditionals ledger.

# Related

- [frequency-based layout](/oks/pathfinder-character-sheet-design/information-architecture/frequency-based-layout.md)
- [progressive disclosure](/oks/pathfinder-character-sheet-design/information-architecture/progressive-disclosure.md)
- [automation and calculations](/oks/pathfinder-character-sheet-design/digital-sheet-ux/automation-and-calculations.md)

# Sources

- https://blog.roll20.net/posts/redesigning-the-pathfinder-2e-character-sheet/
