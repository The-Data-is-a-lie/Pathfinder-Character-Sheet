---
type: Design Practice
title: Dual-Theme Strategy
description: Decide when dual light/dark themes are worth building, and structure tokens so both modes stay maintainable and accessible.
resource: https://www.nngroup.com/articles/dark-mode-users-issues/
tags:
  - dark-mode
  - light-mode
  - themes
  - product-strategy
timestamp: 2026-07-10T00:00:00Z
---

# Dual-Theme Strategy

NN/g research finds dark mode is **popular but not always critical**: many users
set it OS-wide and barely notice apps that ignore it. Still, long sessions,
frequent use, low-light contexts, and low media density strengthen the case —
all true of digital character sheets at the table.

## Invest when most of these apply

- Long continuous viewing (full sessions)
- Frequent use (every game night)
- Low-light rooms common
- UI is mostly text/controls, not full-bleed art

## Engineering approach

1. Define **semantic tokens** first ([color roles](/oks/pathfinder-character-sheet-design/color-theory/color-roles-and-tokens.md)).
2. Author a complete light palette; verify WCAG.
3. Author a **separate** dark palette (not inverted); re-verify WCAG.
4. Theme via `data-theme` / class / `color-scheme`, not per-component forks.
5. Test graphics with transparency; recolor hard-coded canvas/SVG fills.
6. Keep print CSS on a forced light sheet.

## Product trade-offs

| Choice | Upside | Cost |
| --- | --- | --- |
| Light only (strong paper identity) | Faster ship; genre authenticity | Night play glare |
| Dual theme | Comfort + accessibility | 2× visual QA |
| Dark only | Moody VTT aesthetic | Reading/halation issues; print awkward |

For this Pathfinder sheet, dual theme is a natural evolution of existing CSS
variables already used for ink/paper/accent.

# Related

- [system preference sync](/oks/pathfinder-character-sheet-design/themes/system-preference-sync.md)
- [dark mode surfaces](/oks/pathfinder-character-sheet-design/themes/dark-mode-surfaces.md)
- [contrast and WCAG](/oks/pathfinder-character-sheet-design/color-theory/contrast-and-wcag.md)

# Sources

- https://www.nngroup.com/articles/dark-mode-users-issues/
- https://atmos.style/blog/dark-mode-ui-best-practices
