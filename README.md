# Deadline Crypt

A local browser planner for competitions with monetary prizes, built for the **Costume Contest** category of Kiroween 2026.

Keep cash separate from credits, see missing materials, and distinguish registration from submitted work. The haunted desk makes approaching deadlines visible while keeping the records readable.

**Status:** the local build has passed the checks described below. Public hosting, a demonstration video and contest submission are separate steps; this README is not proof of entry or a prize result.

## Try it locally

The app uses browser ES modules. Serve this directory over HTTP rather than opening `index.html` directly.

With Python 3 installed, run from the project directory:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

On Windows, use `py -m http.server 8080 --bind 127.0.0.1` if Python is available through the Python launcher. Open **http://127.0.0.1:8080**. There is no build step or application dependency installation.

The desk starts empty. Click **Load examples** to add three clearly fictional records with relative deadlines. Your other records are kept. Reloading the examples asks before resetting edits to those sample cards.

A short walkthrough:

1. Load examples and compare the cash prize with the separate credits description.
2. Use the cash filter: two of the three examples have positive cash amounts.
3. Edit an opportunity and complete every required material. Its stage stays unchanged.
4. Explicitly set **Submitted**: entry-deadline reminders stop for that record.
5. Acknowledge a reminder, then export a JSON backup. Importing an older backup does not erase a newer acknowledgement for the same deadline.

## What it does

- Create, edit and delete manually maintained opportunity records.
- Search, filter by stage or positive cash amount, sort and inspect next actions.
- Track **Interested, Registered, Preparing, Submitted and Withdrawn** as distinct stages. Checklist completion never changes a record to Submitted automatically.
- Show cash amounts/currencies separately from credits and other non-cash benefits.
- Display exact deadline instants in **Europe/Warsaw**. Exact input requires an explicit UTC offset or `Z`; an impossible calendar date is rejected.
- Keep date-only entries marked **UNKNOWN HOUR**. A past date can receive a calendar hint, but the app does not invent a closing hour or precise expiry alarm.
- Show the current on-page **7-day, 72-hour or 24-hour** reminder. Acknowledging it suppresses repeats; later thresholds can still appear. Submitted and Withdrawn records suppress entry reminders.
- Treat equivalent timestamp offsets as the same instant. A genuinely changed deadline receives a new reminder identity.
- Export versioned JSON containing records and valid reminder acknowledgements. Import validates the whole file, previews its merge, skips duplicates and preserves existing acknowledgement history. The desk supports up to **200 records**; imports are limited to **1 MB**.

This is a manual planner. It does not verify eligibility, discover contests, read email, submit applications, accept rules, handle payments or guarantee earnings. Reminders refresh while the page is open; they are not background or push notifications. A stage is the user's record, not an independently checked organizer receipt.

**All example contests, organizers, URLs, amounts and deadlines are fictional.** They are not recommendations or verified real opportunities.

## How it was made

The entrant explicitly requested contest tracking with reminders for deadlines and missing materials, cash/credits separation and registration/submission distinctions.

| Contributor | Actual role |
|---|---|
| Entrant | Supplied and confirmed the application purpose and priority feature. |
| Kiro CLI 2.37 | In two native build sessions, generated the initial application source, steering/specs/tasks and domain tests, then applied the first targeted bug-fix revision from review findings. |
| Codex | Prepared the brief and scoped Kiro setup; ran the tests and browser review; materially refined the CSS, storage recovery, explicit example loading, backup/history merge, import validation and deduplication, demo fixtures, form labels, focus handling and confirmation dialogs. |

The final code is a collaboration; the current source and tests are not solely Kiro-authored. Kiro's build profile allowed project-scoped file reading/writing. Shell, network and MCP tools were not enabled in those sessions, so **Kiro wrote tests; Codex executed them**. Genuine project artifacts are retained in `.kiro`.

The application itself is static HTML, CSS and JavaScript. Its code does not call a remote opportunity service or paid inference API, and it has no application backend, external fonts or tracking scripts. A static host still receives normal page/asset requests; that is different from uploading entered records.

## Checks and their limits

The current automated run passed **136 tests in 21 suites**. Use Node 18 or newer:

```sh
npm test
```

No `npm install` is required. The tests exercise calendar/offset validation, deadline boundaries, stage/reminder suppression, canonical reminder identities, acknowledgement preservation, import schema and limits, deduplication and fictional fixtures.

Real desktop Chrome and an in-app browser were also checked. Observed flows included cash filtering, invalid-date inline errors, checklist/stage separation, submission reminder suppression, deadline changes, equivalent offsets, old-backup acknowledgement preservation, atomic invalid-import rejection and keyboard focus with Tab, Shift+Tab and Escape. The layout was checked at an emulated **320 px** width without horizontal page overflow.

These checks are not real-phone, Safari, screen-reader certification or a complete offline/network audit. Retest the relevant behavior after changing code.

## Storage and backups

Records and reminder history use this browser profile's **unencrypted `localStorage`**. Another person using the same profile can access them; clearing site data can remove them. **Export a backup regularly.**

If storage is unavailable or full, the desk explains that changes are in memory only. If saved records are unreadable, it retains the original stored data and avoids overwriting it while the current session works in memory. Export preserves the current working records; it is not cloud sync or an automatic repair of an unreadable older archive.

## License

[MIT](LICENSE). The demo fixtures are original fictional examples. Follow the licenses of any material you add.
