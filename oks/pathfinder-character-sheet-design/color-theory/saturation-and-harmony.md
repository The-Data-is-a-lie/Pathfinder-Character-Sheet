---
type: Design Practice
title: Saturation and Harmony
description: Control saturation and palette relationships so accents guide attention without vibrating against light or dark surfaces.
resource: https://atmos.style/blog/dark-mode-ui-best-practices
tags:
  - color-theory
  - saturation
  - dark-mode
  - ui
timestamp: 2026-07-10T00:00:00Z
---

# Saturation and Harmony

## Light surfaces

- Warm neutrals (parchment/ink) read as “paper sheet” and reduce glare versus pure
  white.
- A single saturated accent (deep red, forest green, royal blue) can carry
  hierarchy; additional hues should stay quieter.
- Large fields of highly saturated color tire the eye and fight body text.

## Dark surfaces

- **Desaturate** brand/accent colors. Highly saturated hues on dark backgrounds
  create optical vibration and often fail comfortable contrast even when they
  skim WCAG numbers.
- A practical rule of thumb from dark-theme practice: roughly **~20 points lower
  saturation** in dark mode than the light-mode counterpart (adjust in HSL/LCH,
  then re-check contrast).
- Prefer soft off-white text over pure `#FFFFFF` to reduce glow/halation.

## Harmony models (quick map)

| Approach | Use when |
| --- | --- |
| Monochrome + accent | Character sheets, tools UIs — highest clarity |
| Analogous neutrals | Fantasy paper themes (browns, creams, wine) |
| Complementary accents | Sparse alerts only (danger vs. calm surfaces) |
| Triadic / rainbow | Avoid for stats chrome; confuses hierarchy |

Status colors (HP critical, buff active, error) need **distinct luminance and
shape/text**, not only hue — see accessibility notes on color-only signals.

# Related

- [contrast and WCAG](/oks/pathfinder-character-sheet-design/color-theory/contrast-and-wcag.md)
- [dark mode surfaces](/oks/pathfinder-character-sheet-design/themes/dark-mode-surfaces.md)
- [color roles and tokens](/oks/pathfinder-character-sheet-design/color-theory/color-roles-and-tokens.md)

# Sources

- https://atmos.style/blog/dark-mode-ui-best-practices
- https://www.nngroup.com/articles/dark-mode-users-issues/
