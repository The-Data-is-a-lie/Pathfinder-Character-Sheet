---
type: Design Practice
title: Color Not Only Signal
description: Never convey HP state, selection, errors, or buff status by color alone — pair hue with text, icons, weight, or patterns.
resource: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
tags:
  - accessibility
  - color
  - status
  - ui
timestamp: 2026-07-10T00:00:00Z
---

# Color Not Only Signal

Hue fails for color-vision deficiency and for grayscale printouts. Status must
survive without color.

## Sheet examples

| Situation | Bad | Better |
| --- | --- | --- |
| Low HP | HP number turns red only | Red **and** “Bloodied” / icon / progress bar pattern |
| Active buff | Green dot only | Checkbox + label “Active” + optional green |
| Selected tab | Color shift only | Bold/underline + `aria-selected` + color |
| Error on generate | Red border only | Border + text message in status region |
| Conditional on | Accent fill only | Checkmark state + source name |

## Tokens still help

Use semantic `--danger` / `--success` tokens, but always **pair** them with
non-color channels (copy, shape, weight, position).

# Related

- [contrast and WCAG](/oks/pathfinder-character-sheet-design/color-theory/contrast-and-wcag.md)
- [conditionals and toggles](/oks/pathfinder-character-sheet-design/digital-sheet-ux/conditionals-and-toggles.md)
- [saturation and harmony](/oks/pathfinder-character-sheet-design/color-theory/saturation-and-harmony.md)

# Sources

- https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
