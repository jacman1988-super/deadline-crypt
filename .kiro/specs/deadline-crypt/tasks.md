# Tasks — Deadline Crypt

**Implemented**: Kiro, 2026-10-31

All tasks are completed in this session. No prior Kiro work existed.

---

## Phase 1 — Spec & steering
- [x] Read build-request.txt
- [x] Inspect project directory
- [x] Write `.kiro/steering/project.md`
- [x] Write `.kiro/specs/deadline-crypt/requirements.md`
- [x] Write `.kiro/specs/deadline-crypt/design.md`
- [x] Write `.kiro/specs/deadline-crypt/tasks.md`

## Phase 2 — Domain logic (`domain.js`)
- [x] `parseDeadline(str)` — validates ISO 8601 with offset/Z; accepts date-only; rejects bare local timestamps
- [x] `classifyDeadline(deadline, now)` — returns urgency class
- [x] `getNextAction(record)` — derives human-readable next step
- [x] `getMissingCount(record)` — counts unchecked items
- [x] `shouldShowReminder(record, acks, now)` — reminder logic, threshold priority
- [x] `normaliseUrl(url)` — strip hash + tracking params
- [x] `validateImportPayload(payload)` — full validation before any mutation
- [x] `deduplicateRecords(existing, incoming)` — stable ID + URL dedup
- [x] `sanitiseText(str, maxLen)` — length clamp (XSS handled at render by textContent)
- [x] Seed data (3 fictional records)

## Phase 3 — Application shell (`index.html`, `style.css`)
- [x] Semantic HTML5 structure
- [x] SVG sprite (ghost, signal, stage icons)
- [x] Full CSS with custom properties, responsive grid
- [x] Reduced-motion media query
- [x] ARIA landmarks and live regions

## Phase 4 — App logic (`app.js`)
- [x] State initialisation from localStorage / seed
- [x] Render pipeline: toolbar → reminders → grid
- [x] CRUD modal (create / edit / delete)
- [x] Import/export handlers
- [x] Reminder acknowledge handler
- [x] Storage error handling (blocked / quota exceeded → in-memory mode)
- [x] URL validation on save

## Phase 5 — Tests (`test/domain.test.mjs`)
- [x] Deadline parsing: valid exact, valid date-only, reject bare local, reject garbage
- [x] Deadline classification: boundary conditions at 24 h, 72 h, 7 d
- [x] Date-only classification
- [x] Submitted suppression (no reminder for submitted/withdrawn)
- [x] Reminder acknowledgement priority (first 24 h covers broader thresholds)
- [x] Deadline change resets acknowledgements
- [x] Import validation: good payload, over limit, invalid URL, bad date
- [x] URL dedup normalisation
- [x] Missing count
- [x] Next action derivation
- [x] XSS: textContent safety (domain layer returns raw strings, not HTML)

## Phase 6 — Project files
- [x] `package.json`
- [x] `README.md`
- [x] `LICENSE`
- [x] `.gitignore`
