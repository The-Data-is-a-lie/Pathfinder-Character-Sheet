---
type: Design Practice
title: Color Roles and Tokens
description: Assign color by semantic role (surface, text, accent, danger) and implement with design tokens so themes can swap without hunting hard-coded hexes.
resource: https://m3.material.io/styles/color/system/overview
tags:
  - color-theory
  - design-tokens
  - css
  - ui
timestamp: 2026-07-10T00:00:00Z
---

# Color Roles and Tokens

Do not name colors by appearance alone (`--maroon`, `--beige`). Name them by
**role** so light and dark themes can remap values without rewriting components.

## Core roles for a character sheet (and most apps)

| Role | Purpose | Example light | Example dark |
| --- | --- | --- | --- |
| `surface` / `paper` | Page background | warm off-white | dark gray `#121212` family |
| `surface-elevated` / `panel` | Cards, drawers | lighter panel | lighter-than-base gray |
| `ink` / `on-surface` | Primary text | near-black warm | soft off-white |
| `dim` / `on-surface-variant` | Labels, secondary | mid brown-gray | mid gray |
| `rule` / `outline` | Borders, dividers | tan rule | low-contrast outline |
| `accent` | Primary actions, key chrome | deep red/maroon | desaturated red |
| `accent-contrast` | Text on accent buttons | near-white | near-white |
| `danger` / `success` / `warning` | Status (HP low, buffs, errors) | distinct hues | same hues, lower saturation |
| `focus` | Keyboard focus ring | high-contrast outline | high-contrast outline |

## Implementation sketch

```css
:root {
  --ink: #2b2115;
  --paper: #f3ead7;
  --panel: #fbf6ea;
  --accent: #7a1f1f;
  --rule: #b9a77f;
  --dim: #7d7160;
}

[data-theme="dark"] {
  --ink: #e8e2d6;
  --paper: #121212;
  --panel: #1e1e1e;
  --accent: #c45c5c; /* desaturated vs light maroon */
  --rule: #3a3a3a;
  --dim: #a39888;
}
```

Bind components only to tokens (`color: var(--ink)`), never to raw hex in
selectors scattered across the stylesheet.

# Related

- [contrast and WCAG](/oks/pathfinder-character-sheet-design/color-theory/contrast-and-wcag.md)
- [dual-theme strategy](/oks/pathfinder-character-sheet-design/themes/dual-theme-strategy.md)
- [accent and theme identity](/oks/pathfinder-character-sheet-design/visual-hierarchy/accent-and-theme-identity.md)

# Sources

- https://m3.material.io/styles/color/system/overview
- https://atmos.style/blog/dark-mode-ui-best-practices
