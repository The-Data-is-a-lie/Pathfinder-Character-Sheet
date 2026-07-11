---
type: Design Practice
title: Focus, Keyboard, and Print
description: Keep interactive sheet controls keyboard-reachable with visible focus, and provide print styles that linearize tabs into a readable paper sheet.
resource: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
tags:
  - accessibility
  - keyboard
  - print
  - focus
timestamp: 2026-07-10T00:00:00Z
---

# Focus, Keyboard, and Print

## Keyboard and focus

- All tabs, drawers, buttons, and toggles must be reachable via Tab/Shift+Tab.
- Visible **focus rings** in both themes (never `outline: none` without a
  replacement). Dark mode rings need extra care on dark chrome.
- Mirror expander state in ARIA (`aria-expanded`, `aria-controls`,
  `aria-selected` on tabs).
- Tools drawers should trap or manage focus sensibly when open and restore it
  on close.

## Print

- Provide `@media print` rules that:
  - Hide pure chrome (generate forms, tools drawer) with `.no-print`
  - Reveal all tabs’ content sequentially (this project already prints tabs
    sequentially)
  - Force light ink-on-paper colors for legibility and toner
  - Avoid breaking a weapon/attack block mid-row when possible
- Character name on each printed page when multi-page.

## Motion

Respect `prefers-reduced-motion` for drawer animations and celebratory roll
effects.

# Related

- [progressive disclosure](/oks/pathfinder-character-sheet-design/information-architecture/progressive-disclosure.md)
- [system preference sync](/oks/pathfinder-character-sheet-design/themes/system-preference-sync.md)
- [contrast and WCAG](/oks/pathfinder-character-sheet-design/color-theory/contrast-and-wcag.md)

# Sources

- https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
- https://www.nngroup.com/articles/dark-mode-users-issues/
- https://atmos.style/blog/dark-mode-ui-best-practices
