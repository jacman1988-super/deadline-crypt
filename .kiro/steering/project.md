# Deadline Crypt — Kiro Steering

## Authorship
- **User**: provided the original need (track competitions with earning potential, deadlines, submitted work).
- **Codex**: named the project, proposed the design brief and this build-request.
- **Kiro**: implements all source files, spec documents, and tests in this session (2026-10-31).

## Scope
Browser-only static app. No backend, no external APIs, no npm dependencies at runtime.
Node built-in test runner for domain tests only.

## Hard constraints
- All file I/O stays inside this project folder.
- No network commands, no shell, no subagent delegation, no purchases.
- No reading parent folders, credentials, tokens, or unrelated projects.
- No AI API integration inside the app itself.

## Technology decisions
- Vanilla ES modules, single-page, no framework.
- CSS custom properties, hand-crafted SVG — no external fonts or images.
- `localStorage` persistence with explicit user-facing warnings.
- `Intl.DateTimeFormat` for Europe/Warsaw display; DST-aware.
- JSON export/import with full validation before state mutation.

## Quality bar
- WCAG 2.1 AA minimum: semantic HTML, visible focus, colour contrast ≥ 4.5:1.
- `prefers-reduced-motion` respected.
- XSS: all user text via `textContent`, URL scheme whitelist (https/http only).
- Mobile-first responsive, tested down to 360 px.
