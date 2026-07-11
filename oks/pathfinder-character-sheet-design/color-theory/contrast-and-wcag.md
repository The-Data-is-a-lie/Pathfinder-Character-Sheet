---
type: Design Practice
title: Contrast and WCAG
description: Meet luminance contrast minimums for text and UI so Pathfinder sheets remain readable for low vision and aging eyes.
resource: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
tags:
  - color-theory
  - accessibility
  - wcag
  - contrast
timestamp: 2026-07-10T00:00:00Z
---

# Contrast and WCAG

WCAG 2.1 Success Criterion **1.4.3 Contrast (Minimum)** (Level AA) requires:

- **4.5:1** contrast ratio for normal text
- **3:1** for large-scale text (roughly 18pt / 24px regular, or 14pt / 18.5px bold)

Contrast is computed from **relative luminance**, not from hue. Color-blind users
still need light–dark difference; pretty pairings that fail luminance still fail
accessibility.

## Formula (conceptual)

```
contrast = (L1 + 0.05) / (L2 + 0.05)
```

where L1 is the lighter color’s relative luminance and L2 the darker.

## Sheet-specific watchouts

- Dim labels on parchment often **look** fine to young eyes and fail 4.5:1 —
  measure them.
- Accent-colored text (`--accent` on `--paper`) may fail while white text on the
  accent button passes — test both directions.
- Disabled controls are exempt from some requirements, but do not rely on
  “disabled styling” for important read-only stats.
- Non-text UI (icons, focus rings, selected tabs) is covered by related criteria
  (e.g. 1.4.11); keep interactive hits ≥ ~3:1 against adjacent colors.

## Enhanced target

Level AAA uses **7:1** for normal text. Dense reference text (feat descriptions)
benefits from aiming above the AA floor even if you only claim AA.

# Related

- [color roles and tokens](/oks/pathfinder-character-sheet-design/color-theory/color-roles-and-tokens.md)
- [saturation and harmony](/oks/pathfinder-character-sheet-design/color-theory/saturation-and-harmony.md)
- [color not only signal](/oks/pathfinder-character-sheet-design/accessibility/color-not-only-signal.md)

# Sources

- https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
- https://www.w3.org/WAI/WCAG21/Techniques/general/G18
