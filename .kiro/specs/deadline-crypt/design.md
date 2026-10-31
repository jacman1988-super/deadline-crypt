# Design — Deadline Crypt

**Authored**: Kiro, 2026-10-31, from Codex brief

---

## Visual concept: Haunted Control Room
A dimly lit mission-control aesthetic. Amber signal lights mark urgency.  
Ghost icons (inline SVG) appear only for missing required materials — they represent gaps,  
not horror decoration. Countdowns use a monospace segment-display style.  
No background music, no jump-scares, no generic purple gradients.

## Colour palette
| Token | Value | Use |
|---|---|---|
| `--bg` | `#0d1117` | Page background |
| `--surface` | `#161b22` | Card/panel background |
| `--surface-2` | `#1f2937` | Input, secondary panel |
| `--border` | `#30363d` | Borders |
| `--text` | `#e6dcc8` | Primary text (warm off-white) |
| `--text-muted` | `#8b949e` | Secondary text |
| `--amber` | `#f0a500` | Signal lights, urgent badges |
| `--amber-dim` | `#7a5300` | Dim amber |
| `--teal` | `#3d8b85` | Accent, links, registered |
| `--moss` | `#4a7c59` | Preparing, success |
| `--red` | `#c0392b` | Expired, error |
| `--navy` | `#0a1628` | Deep background |

## Typography
- Font stack: `"Segoe UI", system-ui, -apple-system, sans-serif`
- Monospace stack: `"Cascadia Code", "Consolas", monospace` for deadlines/IDs
- Base size: 16 px; line height 1.5
- Headings scale: 1.125 ratio

## Layout
- Single-page app inside `<main>` with three logical panels:
  1. **Toolbar** — search, filters, action buttons
  2. **Reminder queue** — dismissible alert strip (hidden when empty)
  3. **Record grid** — responsive 1–3 column card layout
- Modal overlay for create/edit form
- Drawer detail panel for single-record view on mobile; side panel on wide screens

## Component inventory
- `RecordCard` — compact status, title, deadline badge, ghost count
- `DeadlineBadge` — colour-coded, "UNKNOWN HOUR" suffix for date-only
- `GhostCount` — inline SVG ghost + number for missing materials
- `StageChip` — coloured pill per stage
- `ReminderAlert` — amber strip with acknowledge button
- `RecordForm` — full CRUD form with validation feedback
- `ImportDialog` — shows conflict summary before confirming

## Accessibility notes
- All interactive elements reachable by Tab; Enter/Space activate.
- Modal traps focus; Escape closes.
- ARIA live region for reminder alerts.
- High-contrast focus ring: `2px solid var(--amber)` offset `2px`.
- `role="status"` for storage warning.

## Motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
```

## File structure
```
deadline-crypt/
├── index.html          — Shell + inline SVG sprites
├── style.css           — All styles
├── domain.js           — Pure business logic (ES module, no DOM)
├── app.js              — DOM wiring, state management, render
├── test/
│   └── domain.test.mjs — Node built-in test runner
├── package.json        — type:module, test script
├── .gitignore
├── README.md
├── LICENSE
└── .kiro/
    ├── steering/project.md
    ├── agents/deadline-crypt.json
    └── specs/deadline-crypt/
        ├── requirements.md
        ├── design.md
        └── tasks.md
```
