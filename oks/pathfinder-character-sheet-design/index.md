---
type: OKF Bundle Index
title: Pathfinder Character Sheet Design
description: Best practices for designing Pathfinder (and TTRPG) character sheets, plus generalized color theory and light/dark theme design for digital UIs.
resource: https://github.com/kwcantrell/okf-bundles
tags:
  - pathfinder
  - character-sheet
  - ux
  - color-theory
  - dark-mode
  - accessibility
  - best-practices
timestamp: 2026-07-10T00:00:00Z
---

# Pathfinder Character Sheet Design

An [Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing)
bundle covering how to design usable, scannable character sheets for Pathfinder
(and dense TTRPG systems generally), plus foundational **color theory** and
**light / dark theme** practices for digital UIs.

This bundle follows the same conventions as the upstream OKF collection at
[`github.com/kwcantrell/okf-bundles`](https://github.com/kwcantrell/okf-bundles):
YAML frontmatter, progressive-disclosure indexes, cross-linked concepts, and a
`# Sources` section on every leaf. When you need git, agent-repo structure,
Claude workflows, or agentic SDLC guidance, fetch from that repo’s raw base:

```
https://raw.githubusercontent.com/kwcantrell/okf-bundles/main
```

Start here, pick the area closest to your question, and follow its `index.md`
into individual concepts. Where multiple valid approaches exist (tabbed vs.
single-page, pure parchment vs. dual themes), these notes present trade-offs
rather than mandating one answer.

## Concept areas

- [information-architecture](/oks/pathfinder-character-sheet-design/information-architecture/index.md) — what goes where: frequency-based layout, grouping, progressive disclosure, session vs. identity data.
- [digital-sheet-ux](/oks/pathfinder-character-sheet-design/digital-sheet-ux/index.md) — automation, conditionals/toggles, task-oriented flows, editable vs. derived fields.
- [visual-hierarchy](/oks/pathfinder-character-sheet-design/visual-hierarchy/index.md) — typography for stats, accent identity, density and white space.
- [color-theory](/oks/pathfinder-character-sheet-design/color-theory/index.md) — color roles/tokens, WCAG contrast, saturation and harmony (generalized, not Pathfinder-only).
- [themes](/oks/pathfinder-character-sheet-design/themes/index.md) — light surfaces, dark surfaces, dual-theme strategy, OS preference sync.
- [accessibility](/oks/pathfinder-character-sheet-design/accessibility/index.md) — keyboard/focus/print, and not relying on color alone.

## How to read this bundle

Each concept file carries YAML frontmatter (`type`, `title`, `description`, a
primary `resource` URL, `tags`, `timestamp`), an explanatory body, a `# Related`
section of cross-links, and a `# Sources` section citing primary or high-quality
secondary documentation behind its claims.

Root-relative links such as `/oks/pathfinder-character-sheet-design/...` resolve
from the repo root of this project. Upstream OKF bundles use the same pattern
under `https://raw.githubusercontent.com/kwcantrell/okf-bundles/main`.

## Pathfinder-specific context

Pathfinder 1e (and related subsystems such as Path of War and Spheres of Power)
is a **high-density** ruleset: ability scores and modifiers, BAB, CMB/CMD, AC
components, saves, skills, feats, spells, conditions, inventory, and optional
combat-maneuver or magic-talent systems. A good sheet must:

1. Surface **combat-critical** numbers in one glance.
2. Hide or demote **rare** fields without deleting them.
3. Support **session mutables** (HP, conditions, ammo, readied maneuvers) without
   fighting the UI.
4. Keep **theme and contrast** readable under table lighting and on screens.

This project’s sheet uses a Foundry-style tab chrome (`Summary | Attributes |
Combat | …`) and a tools drawer for rolls — patterns that map cleanly onto the
concepts below.
