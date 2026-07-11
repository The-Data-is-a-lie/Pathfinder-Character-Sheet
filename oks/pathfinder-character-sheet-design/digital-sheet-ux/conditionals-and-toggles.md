---
type: Sheet Design Practice
title: Conditionals and Toggles
description: Model situational Pathfinder bonuses as explicit toggles next to the rolls they affect, with sensible defaults and clear sources.
resource: https://blog.roll20.net/posts/redesigning-the-pathfinder-2e-character-sheet/
tags:
  - pathfinder
  - character-sheet
  - conditionals
  - ux
timestamp: 2026-07-10T00:00:00Z
---

# Conditionals and Toggles

Much of Pathfinder’s complexity is **situational**: Power Attack, fighting
defensively, stance riders, spell buffs, feat conditionals. Encode those as
checkboxes (or chips) that modify the *next* roll, not as tribal knowledge in a
sidebar.

## Design rules

- **Only list known items** for this character — never dump the entire maneuver
  or talent table onto every sheet.
- Place toggles **adjacent to attack/roll UI** (Combat tab and Tools drawer), not
  only under a remote Buffs tab.
- Show **source labels** (feat name, spell, stance) so players know why a +2 exists.
- Prefer **safe defaults** (e.g. stance damage on) with one-click off.
- Persist toggle state with the character when it is campaign-long; reset
  per-encounter toggles when that matches table practice.
- Expand `[[dice]]`-style riders in the roll log so outcomes are auditable.

## Conditions as first-class state

Roll20 treated improved conditions as a core MVP outcome: bonuses from default
conditions should propagate sheet-wide. Mirror that ideal — a “fatigued”
condition should not require hand-editing three fields.

# Related

- [automation and calculations](/oks/pathfinder-character-sheet-design/digital-sheet-ux/automation-and-calculations.md)
- [session vs. identity data](/oks/pathfinder-character-sheet-design/information-architecture/session-vs-identity-data.md)
- [grouping related stats](/oks/pathfinder-character-sheet-design/information-architecture/grouping-related-stats.md)

# Sources

- https://blog.roll20.net/posts/redesigning-the-pathfinder-2e-character-sheet/
