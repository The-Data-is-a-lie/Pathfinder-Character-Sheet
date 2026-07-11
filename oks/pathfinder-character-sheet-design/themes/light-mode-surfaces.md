---
type: Design Practice
title: Light Mode Surfaces
description: Build light themes with readable positive polarity, soft paper tones, and shadow-based elevation suitable for parchment-style sheets.
resource: https://www.nngroup.com/articles/dark-mode-users-issues/
tags:
  - light-mode
  - themes
  - surfaces
  - ui
timestamp: 2026-07-10T00:00:00Z
---

# Light Mode Surfaces

**Positive polarity** (dark text on light background) remains the default for
reading comprehension in many studies. For character sheets, light mode is often
the primary identity (paper at the table).

## Surface stack

1. **Page** — soft off-white or warm paper (`#f3ead7` class), not pure `#FFFFFF`
   if you want reduced glare and genre feel.
2. **Panels / cards** — slightly lighter or cooler than page, or same page with
   border; shadows express elevation.
3. **Inputs** — near-white fields with visible borders against the panel.
4. **Chrome** (top bars) — can go dark for contrast framing without making the
   whole UI dark mode.

## Elevation in light mode

Use **shadows and borders** more than background lightening. Keep shadow opacity
subtle so dense stat grids do not look muddy.

## When light mode is mandatory to offer

NN/g notes that some users (including people with astigmatism) find light text on
dark backgrounds harder due to **halation**. Content-heavy sheets should never be
dark-only without an escape hatch.

# Related

- [dark mode surfaces](/oks/pathfinder-character-sheet-design/themes/dark-mode-surfaces.md)
- [color roles and tokens](/oks/pathfinder-character-sheet-design/color-theory/color-roles-and-tokens.md)
- [accent and theme identity](/oks/pathfinder-character-sheet-design/visual-hierarchy/accent-and-theme-identity.md)

# Sources

- https://www.nngroup.com/articles/dark-mode-users-issues/
- https://atmos.style/blog/dark-mode-ui-best-practices
