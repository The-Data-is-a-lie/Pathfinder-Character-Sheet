---
type: Design Practice
title: Dark Mode Surfaces
description: Design dark themes with dark-gray bases, lighter elevated surfaces, desaturated accents, and careful text opacity — not pure black/white inversion.
resource: https://atmos.style/blog/dark-mode-ui-best-practices
tags:
  - dark-mode
  - themes
  - surfaces
  - material-design
timestamp: 2026-07-10T00:00:00Z
---

# Dark Mode Surfaces

## Do

- Use **dark gray** bases (Material long recommended `#121212`) rather than pure
  `#000000` for general app UI — enables visible shadows and softer contrast.
- Express **elevation by lightening** surfaces as they rise (drawers, modals,
  popovers lighter than the page).
- Use **desaturated** accent and status colors.
- Soften primary text off pure white; use opacity steps of one light ink for
  secondary/tertiary text.
- Keep **focus indicators** obvious on dark chrome.

## Don’t

- Don’t merely invert the light palette.
- Don’t rely on drop shadows alone for layering dark-on-dark.
- Don’t ship thin light fonts on dark panels.
- Don’t forget dividers, floating toolbars, and modals — common dark-mode
  failure points in NN/g testing.

## Character-sheet specifics

- Tools drawers and sticky topbars are elevated surfaces — lighten them vs. page.
- Roll logs and monospaced output need verified contrast; green-on-black terminal
  aesthetics often fail AA.
- Print stylesheets should force a **light** ink-on-paper result regardless of
  interactive theme.

# Related

- [light mode surfaces](/oks/pathfinder-character-sheet-design/themes/light-mode-surfaces.md)
- [saturation and harmony](/oks/pathfinder-character-sheet-design/color-theory/saturation-and-harmony.md)
- [dual-theme strategy](/oks/pathfinder-character-sheet-design/themes/dual-theme-strategy.md)

# Sources

- https://atmos.style/blog/dark-mode-ui-best-practices
- https://www.nngroup.com/articles/dark-mode-users-issues/
- https://m3.material.io/styles/color/system/overview
