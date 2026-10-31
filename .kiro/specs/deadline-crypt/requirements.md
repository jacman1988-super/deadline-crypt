# Requirements — Deadline Crypt

**Status**: implemented 2026-10-31 by Kiro  
**Authored by**: user need → Codex brief → Kiro implementation

---

## REQ-01 Dashboard
- Search by title/source, filter by status, filter cash-only, sort by urgency.
- Visible badge: "Manual planner — fictional demo data — not automatic discovery or submission."
- Next-action queue: shows top pending concrete steps.

## REQ-02 Demo data
- Exactly 3 seed opportunities; all explicitly fictional (names, URLs, prizes).
- Loaded only when localStorage is empty on first launch.

## REQ-03 Record fields
| Field | Notes |
|---|---|
| title | required, text ≤ 200 chars |
| sourceUrl | optional, https/http only |
| cashAmount | number ≥ 0, nullable |
| currency | ISO code or label |
| creditsDescription | freetext, separate from cash |
| feeStatus | `free` \| `paid` \| `unknown` |
| deadline | ISO 8601 with offset/Z **or** date-only `YYYY-MM-DD` |
| dateOnly | boolean flag; if true, display "UNKNOWN HOUR" — no midnight assumption |
| stage | `interested` \| `registered` \| `preparing` \| `submitted` \| `withdrawn` |
| checklist | array of `{ id, label, done }` |
| notes | freetext ≤ 2000 chars |

## REQ-04 Stages
- `submitted`: entry stays visible; deadline alerts suppressed; show "Awaiting result."
- `withdrawn`: deadline alerts suppressed.
- Registration ≠ submission; must be marked submitted via explicit user action.
- No finalist/winner inference.

## REQ-05 Checklist & next actions
- Missing material count shown per record.
- Completing checklist does NOT auto-submit.
- Next concrete action derived from stage + checklist state.

## REQ-06 Deadline classification
| Class | Condition |
|---|---|
| `expired` | deadline in the past |
| `within24h` | ≤ 24 h from now |
| `within72h` | ≤ 72 h from now |
| `within7days` | ≤ 7 days from now |
| `later` | beyond 7 days |

- Date-only: show date + "UNKNOWN HOUR". No precision thresholds applied (treat as `later`/`expired` by date only, no countdown).
- Exact timestamps: require offset or Z; reject bare `2026-11-01T12:00:00`.

## REQ-07 Reminder queue
- On-page only; no push/background notifications.
- Thresholds: 24 h, 72 h, 7 days — acknowledged once per record/deadline combo.
- First discovery inside 24 h → one most-urgent reminder only (covers 72 h / 7 d acknowledgements too).
- Changing deadline resets acknowledgements for that record.
- No stale alarms for `submitted` or `withdrawn`.

## REQ-08 Export/Import
- Full JSON export of all records.
- Import validates entire payload before any mutation.
- Safe limits: ≤ 200 records, title ≤ 200 chars, notes ≤ 2000 chars.
- Dedup on stable ID + normalised source URL (strip `#hash`, strip known tracking params).
- Conflict explanation shown to user; no silent partial import.
- All user text rendered with `textContent`.
- URLs: http/https only; reject `javascript:`, `data:`, `file:` etc.
- External links: `rel="noopener noreferrer" target="_blank"`.

## REQ-09 Storage
- `localStorage`; explicit warning that browser can clear it.
- Graceful fallback to in-memory when storage blocked/full; UI reports "unsaved".
- No encryption claim; no automatic online verification.

## REQ-10 Accessibility & UX
- Semantic HTML5 landmarks, ARIA where needed.
- Keyboard navigable; visible focus ring.
- `prefers-reduced-motion`: suppress transitions/animations.
- Colour: near-black/navy base, warm off-white text, amber signal accents, moss/teal secondary.
- No external fonts; system font stack.
- Responsive ≥ 360 px.
