---
type: Design Practice
title: System Preference Sync
description: Default theme to the operating system dark/light setting and offer an optional in-app override for character-sheet contexts.
resource: https://www.nngroup.com/articles/dark-mode-users-issues/
tags:
  - dark-mode
  - themes
  - prefers-color-scheme
  - ux
timestamp: 2026-07-10T00:00:00Z
---

# System Preference Sync

Users conceptualize dark mode at the **OS level**. They expect apps to follow
system settings automatically. Forcing a second manual enable inside each app
creates missed affordances and annoyance.

## Recommended behavior

1. **Default:** `prefers-color-scheme: dark | light` (CSS and/or JS matchMedia).
2. **Optional override:** Light / Dark / System control in Settings; persist in
   `localStorage`.
3. **Default the override to System** for new users.
4. Reflect the effective theme on `<html data-theme="...">` for CSS hooks.
5. Set `color-scheme: light dark` appropriately so native form controls match.

## CSS sketch

```css
:root { color-scheme: light; /* tokens for light */ }

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { color-scheme: dark; /* dark tokens */ }
}

:root[data-theme="dark"] { color-scheme: dark; /* dark tokens */ }
:root[data-theme="light"] { color-scheme: light; /* light tokens */ }
```

## Character-sheet nuance

Table laptops often sit in dim rooms while GMs run bright maps on a TV — system
sync handles the common case; a one-click sheet override handles the rest.

# Related

- [dual-theme strategy](/oks/pathfinder-character-sheet-design/themes/dual-theme-strategy.md)
- [focus keyboard print](/oks/pathfinder-character-sheet-design/accessibility/focus-keyboard-print.md)

# Sources

- https://www.nngroup.com/articles/dark-mode-users-issues/
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme
