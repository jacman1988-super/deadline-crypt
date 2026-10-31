/**
 * domain.js — Deadline Crypt business logic
 * Pure ES module; no DOM, no I/O. Safe to import in Node tests.
 *
 * Authorship: Kiro implemented this file on 2026-10-31.
 * Kiro revised on 2026-10-31 following Codex review findings.
 * Codex then fixed incoming-batch deduplication, reviewed import schema and
 * acknowledgement validation, and refined the fictional demo fixtures.
 * User supplied the planning need; Codex wrote the brief.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STAGES = /** @type {const} */ ([
  'interested', 'registered', 'preparing', 'submitted', 'withdrawn'
]);

export const URGENCY = /** @type {const} */ ([
  'expired', 'within24h', 'within72h', 'within7days', 'later', 'dateOnly'
]);

export const FEE_STATUS = /** @type {const} */ (['free', 'paid', 'unknown']);

export const MAX_RECORDS      = 200;
export const MAX_TITLE_LEN    = 200;
export const MAX_NOTES_LEN    = 2000;
export const MAX_CREDITS_LEN  = 500;
export const MAX_CHECKLIST    = 30;
export const MAX_LABEL_LEN    = 200;
export const MAX_ID_LEN       = 128;
export const MAX_CURRENCY_LEN = 10;

const MS_HOUR = 3_600_000;
const MS_24H  = 24  * MS_HOUR;
const MS_72H  = 72  * MS_HOUR;
const MS_7D   = 7   * 24 * MS_HOUR;

// Only well-known tracking query params are stripped on URL normalisation.
// Generic keys like 'ref', 'source', 'affiliate' are preserved because they
// can distinguish distinct contest editions or meaningful routes.
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'msclkid'
]);

// Days in each month (non-leap). February is index 2.
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// ---------------------------------------------------------------------------
// ID generation (crypto-quality where available, fallback for Node <19 test)
// ---------------------------------------------------------------------------

export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: sufficient for tests
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if year is a leap year.
 * @param {number} y
 * @returns {boolean}
 */
function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Returns the maximum valid day for month `mo` in year `y`.
 * @param {number} y
 * @param {number} mo  1-based month
 * @returns {number}
 */
function daysInMonth(y, mo) {
  if (mo === 2) return isLeapYear(y) ? 29 : 28;
  return DAYS_IN_MONTH[mo];
}

/**
 * Validate a YYYY-MM-DD calendar date. Returns error string or null.
 * @param {number} y
 * @param {number} mo  1-based
 * @param {number} dy
 * @returns {string | null}
 */
function validateCalendarDate(y, mo, dy) {
  if (mo < 1 || mo > 12) return `Invalid month ${mo}.`;
  const maxDay = daysInMonth(y, mo);
  if (dy < 1 || dy > maxDay) return `Invalid day ${dy} for ${y}-${String(mo).padStart(2,'0')} (max ${maxDay}).`;
  return null;
}

// ---------------------------------------------------------------------------
// Deadline parsing & classification
// ---------------------------------------------------------------------------

/**
 * Parse a deadline string.
 * Accepts:
 *   - ISO 8601 with UTC offset or Z:  "2026-11-01T12:00:00+01:00", "2026-11-01T11:00:00Z"
 *   - Date-only:                      "2026-11-01"
 * Rejects:
 *   - Bare local timestamps without offset: "2026-11-01T12:00:00"
 *   - Calendar dates that don't exist (e.g. 2026-11-31, 2026-02-29 on non-leap year)
 *   - Any other format
 *
 * For exact timestamps the local date (Y/M/D) encoded in the string is validated
 * against the Gregorian calendar BEFORE constructing a Date, preventing silent
 * JavaScript date arithmetic rollover (e.g. Nov 31 → Dec 1).
 *
 * @param {string} str
 * @returns {{ date: Date, dateOnly: boolean } | { error: string }}
 */
export function parseDeadline(str) {
  if (typeof str !== 'string' || !str.trim()) {
    return { error: 'Deadline is required.' };
  }
  const s = str.trim();

  // ── Date-only: YYYY-MM-DD ────────────────────────────────────────────────
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, mo, dy] = s.split('-').map(Number);
    const calErr = validateCalendarDate(y, mo, dy);
    if (calErr) return { error: `"${s}" is not a valid date: ${calErr}` };
    // Construct as UTC midnight; no rollover possible after the calendar check.
    const d = new Date(s + 'T00:00:00Z');
    if (isNaN(d.getTime())) return { error: `Invalid date: "${s}".` };
    return { date: d, dateOnly: true };
  }

  // ── Bare local timestamp without offset — explicitly rejected ─────────────
  // Check this BEFORE the exact-timestamp branch to give the helpful message.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(s)) {
    return {
      error: 'Exact timestamps must include a UTC offset (e.g. +01:00 or Z). ' +
             'Bare local times are rejected to avoid silent timezone errors.'
    };
  }

  // ── Exact timestamp: must end with Z or ±HH:MM or ±HHMM ─────────────────
  const exactRe = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
  const m = exactRe.exec(s);
  if (m) {
    const [, yS, moS, dyS, hhS, mmS, ssS, offset] = m;
    const y  = Number(yS), mo = Number(moS), dy = Number(dyS);
    const hh = Number(hhS), mm = Number(mmS), ss = Number(ssS ?? 0);

    // Validate calendar date (prevents Nov 31 silently rolling to Dec 1)
    const calErr = validateCalendarDate(y, mo, dy);
    if (calErr) return { error: `"${s}" has an invalid date component: ${calErr}` };

    // Validate time components
    if (hh > 23) return { error: `"${s}" has invalid hour ${hh}.` };
    if (mm > 59) return { error: `"${s}" has invalid minute ${mm}.` };
    if (ss > 59) return { error: `"${s}" has invalid second ${ss}.` };

    // Validate offset bounds (±18:00 is the widest real-world timezone)
    if (offset !== 'Z') {
      const offNum = parseInt(offset.replace(':', ''), 10);
      const offAbs = Math.abs(offNum);
      if (offAbs > 1800) return { error: `"${s}" has an out-of-range UTC offset.` };
    }

    const d = new Date(s);
    if (isNaN(d.getTime())) return { error: `Invalid timestamp: "${s}".` };
    return { date: d, dateOnly: false };
  }

  return {
    error: `Unrecognised deadline format: "${s}". Use YYYY-MM-DD or YYYY-MM-DDThh:mm:ss±HH:MM.`
  };
}

/**
 * Classify a deadline relative to `now`.
 *
 * Date-only deadlines: always return 'dateOnly', regardless of whether the
 * calendar date is in the past. The hour is unknown, so we cannot reliably
 * declare a date-only deadline expired — use the display layer to hint that
 * the calendar date has passed. This avoids silently inventing a closing
 * instant (e.g. midnight) and triggering spurious threshold alarms.
 *
 * Exact timestamps: compare ms precisely.
 *
 * @param {{ date: Date, dateOnly: boolean }} deadline
 * @param {Date} now
 * @returns {typeof URGENCY[number]}
 */
export function classifyDeadline(deadline, now) {
  const { date, dateOnly } = deadline;

  if (dateOnly) {
    // Always return 'dateOnly' — we do not know the closing hour.
    // The display layer may add a "calendar date has passed" hint.
    return 'dateOnly';
  }

  const diff = date.getTime() - now.getTime();
  if (diff <= 0)      return 'expired';
  if (diff <= MS_24H) return 'within24h';
  if (diff <= MS_72H) return 'within72h';
  if (diff <= MS_7D)  return 'within7days';
  return 'later';
}

/**
 * Returns true if a date-only deadline's calendar date is in the past
 * (by UTC calendar date comparison). Used only as a display hint — never
 * to invent an expiry instant.
 *
 * @param {{ date: Date, dateOnly: boolean }} deadline
 * @param {Date} now
 * @returns {boolean}
 */
export function isDateOnlyPast(deadline, now) {
  if (!deadline.dateOnly) return false;
  return deadline.date.toISOString().slice(0, 10) < now.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Format a deadline for display in Europe/Warsaw timezone.
 * Uses Intl; properly handles DST (no constant UTC offset assumed).
 *
 * @param {{ date: Date, dateOnly: boolean }} deadline
 * @returns {string}
 */
export function formatDeadline(deadline) {
  const { date, dateOnly } = deadline;
  if (dateOnly) {
    // Show the stored YYYY-MM-DD (which we stored as UTC midnight)
    const iso = date.toISOString().slice(0, 10);
    return `${iso} — UNKNOWN HOUR`;
  }
  try {
    const fmt = new Intl.DateTimeFormat('pl-PL', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false
    });
    return fmt.format(date);
  } catch {
    return date.toISOString();
  }
}

/**
 * Format a countdown string for exact deadlines (not date-only).
 * @param {{ date: Date, dateOnly: boolean }} deadline
 * @param {Date} now
 * @returns {string | null} null for date-only or expired
 */
export function formatCountdown(deadline, now) {
  if (deadline.dateOnly) return null;
  const diff = deadline.date.getTime() - now.getTime();
  if (diff <= 0) return null;
  const h = Math.floor(diff / MS_HOUR);
  const m = Math.floor((diff % MS_HOUR) / 60_000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `${d}d ${rh}h`;
  }
  return `${h}h ${m}m`;
}

// ---------------------------------------------------------------------------
// Missing materials & next action
// ---------------------------------------------------------------------------

/**
 * Count unchecked checklist items.
 * @param {{ checklist: Array<{ done: boolean }> }} record
 * @returns {number}
 */
export function getMissingCount(record) {
  if (!Array.isArray(record.checklist)) return 0;
  return record.checklist.filter(i => i.done !== true).length;
}

/**
 * Derive the next concrete action for a record.
 * @param {object} record
 * @returns {string}
 */
export function getNextAction(record) {
  const missing = getMissingCount(record);
  switch (record.stage) {
    case 'interested':
      return record.sourceUrl
        ? 'Review the official brief and decide to register.'
        : 'Find and save the official source URL.';
    case 'registered':
      return missing > 0
        ? `Complete ${missing} outstanding material${missing > 1 ? 's' : ''}.`
        : 'All materials ready — start preparing your entry.';
    case 'preparing':
      return missing > 0
        ? `Finish ${missing} remaining item${missing > 1 ? 's' : ''}, then mark as submitted.`
        : 'Materials complete — mark as submitted when entry is sent.';
    case 'submitted':
      return 'Awaiting result. Monitor the official source for announcements.';
    case 'withdrawn':
      return 'Entry withdrawn. No further action required.';
    default:
      return 'Review record and update stage.';
  }
}

// ---------------------------------------------------------------------------
// Reminder logic
// ---------------------------------------------------------------------------

/**
 * Acknowledgement key for a record/deadline combination.
 *
 * Uses the canonical UTC epoch milliseconds of the deadline instant so that
 * two deadline strings that represent the same point in time (e.g.
 * "2026-11-03T10:00:00Z" and "2026-11-03T11:00:00+01:00") produce the
 * SAME key and therefore share their acknowledgement state.
 *
 * A genuinely different instant — even if just one second apart — produces
 * a different key, resetting acknowledgements automatically.
 *
 * Date-only deadlines have no known instant; they use the raw date string.
 *
 * @param {object} record  — must have .id, .deadline (parsed), .deadlineRaw
 * @returns {string}
 */
export function ackKey(record) {
  if (record.deadline && !record.deadline.dateOnly) {
    // Use canonical epoch ms for exact timestamps
    return `${record.id}:${record.deadline.date.getTime()}`;
  }
  // Date-only or no deadline: fall back to raw string (no epoch to compare)
  return `${record.id}:${record.deadlineRaw ?? ''}`;
}

/**
 * Determine which reminder (if any) should be shown for a record.
 *
 * Rules:
 * - Never for submitted or withdrawn.
 * - Date-only: no threshold-based reminders (time unknown).
 * - At most ONE reminder per record, the most urgent threshold breached.
 * - Threshold 24 h: check 'ack24'; acknowledging it also marks 72 h + 7d covered.
 * - Threshold 72 h: check 'ack72'.
 * - Threshold 7 d:  check 'ack7d'.
 * - If first discovery is already inside 24 h, show that single reminder only.
 *
 * @param {object} record  — must have .stage, .deadlineRaw, .deadline
 * @param {object} acks    — map of ackKey → { ack24, ack72, ack7d }
 * @param {Date}   now
 * @returns {{ threshold: '24h'|'72h'|'7d', urgency: string } | null}
 */
export function shouldShowReminder(record, acks, now) {
  if (record.stage === 'submitted' || record.stage === 'withdrawn') return null;
  if (!record.deadline) return null;

  const { dateOnly } = record.deadline;
  if (dateOnly) return null;

  const urgency = classifyDeadline(record.deadline, now);
  if (urgency === 'expired' || urgency === 'later' || urgency === 'dateOnly') return null;

  const key = ackKey(record);
  const rec = acks[key] ?? {};

  // Most urgent first
  if (urgency === 'within24h') {
    if (!rec.ack24) return { threshold: '24h', urgency };
    return null; // already acked at 24h level (covers all)
  }
  if (urgency === 'within72h') {
    if (rec.ack24) return null; // 24h ack covers this
    if (!rec.ack72) return { threshold: '72h', urgency };
    return null;
  }
  if (urgency === 'within7days') {
    if (rec.ack24 || rec.ack72) return null; // tighter ack covers this
    if (!rec.ack7d) return { threshold: '7d', urgency };
    return null;
  }
  return null;
}

/**
 * Produce updated acks object after user acknowledges a reminder.
 * Acknowledging 24h covers all wider thresholds for that key.
 *
 * @param {object} acks
 * @param {string} key   — ackKey(record)
 * @param {'24h'|'72h'|'7d'} threshold
 * @returns {object} new acks (immutable update)
 */
export function acknowledgeReminder(acks, key, threshold) {
  const prev = acks[key] ?? {};
  const next = { ...prev };
  if (threshold === '24h') { next.ack24 = true; next.ack72 = true; next.ack7d = true; }
  else if (threshold === '72h') { next.ack72 = true; next.ack7d = true; }
  else if (threshold === '7d')  { next.ack7d = true; }
  return { ...acks, [key]: next };
}

// ---------------------------------------------------------------------------
// URL validation & normalisation
// ---------------------------------------------------------------------------

/**
 * Validate a URL: must be http or https, parseable.
 * @param {string} url
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
export function validateUrl(url) {
  if (!url || !url.trim()) return { ok: true, url: '' }; // optional field
  const s = url.trim();
  let parsed;
  try { parsed = new URL(s); } catch {
    return { ok: false, error: 'URL is not valid.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// and https:// URLs are allowed.' };
  }
  return { ok: true, url: s };
}

/**
 * Normalise a URL for deduplication:
 *   - lowercase host
 *   - remove only known tracking query params (utm_*, fbclid, gclid, msclkid)
 *   - preserve hash fragments (SPA routes like /#/contests/alpha differ from /#/contests/beta)
 *   - preserve all other query params (meaningful contest identifiers)
 *   - sort remaining query params for stable comparison
 *
 * Preserving hashes and unknown query params avoids silently merging distinct
 * contest editions that share a base URL but differ by fragment or parameter.
 *
 * @param {string} url
 * @returns {string} normalised URL string, or original if unparseable
 */
export function normaliseUrl(url) {
  if (!url) return '';
  let parsed;
  try { parsed = new URL(url); } catch { return url.toLowerCase().trim(); }

  parsed.hostname = parsed.hostname.toLowerCase();
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key)) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  let s = parsed.toString();
  // Remove trailing ? if no params remain
  if (s.endsWith('?')) s = s.slice(0, -1);
  return s;
}

// ---------------------------------------------------------------------------
// Text sanitisation (length clamp; XSS prevention is at render via textContent)
// ---------------------------------------------------------------------------

/**
 * Clamp text to maxLen. Returns string (never null).
 * @param {unknown} value
 * @param {number} maxLen
 * @returns {string}
 */
export function sanitiseText(value, maxLen) {
  const s = typeof value === 'string' ? value : String(value ?? '');
  return s.slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// Import validation
// ---------------------------------------------------------------------------

/**
 * Validate an import payload before any state mutation.
 * Never throws — always returns { ok, errors } or { ok, records }.
 * All field types are checked before any string/array operations to avoid
 * TypeError crashes on non-string sourceUrl, non-boolean done, etc.
 *
 * @param {unknown} payload
 * @returns {{ ok: true, records: object[], acknowledgements?: object } | { ok: false, errors: string[] }}
 */
export function validateImportPayload(payload) {
  try {
    return _validateImportPayload(payload);
  } catch (err) {
    // Belt-and-braces: should not reach here, but never let unexpected
    // TypeError etc. propagate to the caller.
    return { ok: false, errors: [`Internal validation error: ${err && err.message}`] };
  }
}

function _validateImportPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['Import must be a JSON object.'] };
  }
  if (payload.version !== undefined && payload.version !== 1) {
    errors.push('Import version must be the number 1.');
  }

  const { records } = /** @type {any} */ (payload);

  if (!Array.isArray(records)) {
    return { ok: false, errors: ['Import must contain a "records" array.'] };
  }
  if (records.length > MAX_RECORDS) {
    errors.push(`Import contains ${records.length} records; maximum is ${MAX_RECORDS}.`);
  }

  const validRecords = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const prefix = `Record [${i}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      errors.push(`${prefix}: not an object.`);
      continue;
    }

    // ── id ────────────────────────────────────────────────────────────────
    if (typeof r.id !== 'string' || !r.id.trim()) errors.push(`${prefix}: missing id.`);
    else if (r.id.length > MAX_ID_LEN) errors.push(`${prefix}: id too long (max ${MAX_ID_LEN}).`);

    // ── title ─────────────────────────────────────────────────────────────
    if (typeof r.title !== 'string' || !r.title.trim()) {
      errors.push(`${prefix}: missing title.`);
    } else if (r.title.length > MAX_TITLE_LEN) {
      errors.push(`${prefix}: title too long (max ${MAX_TITLE_LEN}).`);
    }

    // ── notes ─────────────────────────────────────────────────────────────
    if (r.notes !== undefined && r.notes !== null) {
      if (typeof r.notes !== 'string') {
        errors.push(`${prefix}: notes must be a string.`);
      } else if (r.notes.length > MAX_NOTES_LEN) {
        errors.push(`${prefix}: notes too long (max ${MAX_NOTES_LEN}).`);
      }
    }

    // ── creditsDescription ────────────────────────────────────────────────
    if (r.creditsDescription !== undefined && r.creditsDescription !== null) {
      if (typeof r.creditsDescription !== 'string') {
        errors.push(`${prefix}: creditsDescription must be a string.`);
      } else if (r.creditsDescription.length > MAX_CREDITS_LEN) {
        errors.push(`${prefix}: creditsDescription too long.`);
      }
    }

    // Optional text fields remain nullable for older exports.
    if (r.currency !== undefined && r.currency !== null) {
      if (typeof r.currency !== 'string') errors.push(`${prefix}: currency must be a string.`);
      else if (r.currency.length > MAX_CURRENCY_LEN) errors.push(`${prefix}: currency too long (max ${MAX_CURRENCY_LEN}).`);
    }
    for (const field of ['createdAt', 'updatedAt']) {
      if (r[field] !== undefined && r[field] !== null && typeof r[field] !== 'string') {
        errors.push(`${prefix}: ${field} must be a string.`);
      }
    }

    // ── stage ─────────────────────────────────────────────────────────────
    if (r.stage !== undefined && !STAGES.includes(r.stage)) {
      errors.push(`${prefix}: invalid stage "${r.stage}".`);
    }

    // ── feeStatus ─────────────────────────────────────────────────────────
    if (r.feeStatus !== undefined && !FEE_STATUS.includes(r.feeStatus)) {
      errors.push(`${prefix}: invalid feeStatus "${r.feeStatus}".`);
    }

    // ── sourceUrl — type-check BEFORE calling validateUrl ─────────────────
    if (r.sourceUrl !== undefined && r.sourceUrl !== null && r.sourceUrl !== '') {
      if (typeof r.sourceUrl !== 'string') {
        errors.push(`${prefix}: sourceUrl must be a string (got ${typeof r.sourceUrl}).`);
      } else {
        const v = validateUrl(r.sourceUrl);
        if (!v.ok) errors.push(`${prefix}: sourceUrl — ${v.error}`);
      }
    }

    // ── deadlineRaw ───────────────────────────────────────────────────────
    if (r.deadlineRaw !== undefined && r.deadlineRaw !== null) {
      if (typeof r.deadlineRaw !== 'string') {
        errors.push(`${prefix}: deadlineRaw must be a string.`);
      } else {
        const p = parseDeadline(r.deadlineRaw);
        if ('error' in p) errors.push(`${prefix}: deadline — ${p.error}`);
      }
    }

    // ── checklist ─────────────────────────────────────────────────────────
    if (r.checklist !== undefined) {
      if (!Array.isArray(r.checklist)) {
        errors.push(`${prefix}: checklist must be an array.`);
      } else if (r.checklist.length > MAX_CHECKLIST) {
        errors.push(`${prefix}: checklist too long (max ${MAX_CHECKLIST}).`);
      } else {
        for (let j = 0; j < r.checklist.length; j++) {
          const item = r.checklist[j];
          const iprefix = `${prefix} checklist[${j}]`;
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            errors.push(`${iprefix}: not an object.`);
          } else if (typeof item.label !== 'string' || !item.label.trim()) {
            errors.push(`${iprefix}: missing label.`);
          } else if (item.label.length > MAX_LABEL_LEN) {
            errors.push(`${iprefix}: label too long.`);
          } else if (typeof item.done !== 'boolean') {
            // Reject string 'false', number 0, undefined, etc. — must be a real boolean.
            errors.push(`${iprefix}: done must be a boolean (got ${typeof item.done} "${item.done}").`);
          }
          if (item && typeof item === 'object' && item.id !== undefined &&
              (typeof item.id !== 'string' || !item.id.trim() || item.id.length > MAX_ID_LEN)) {
            errors.push(`${iprefix}: id must be a non-empty string of at most ${MAX_ID_LEN} characters.`);
          }
        }
      }
    }

    // ── cashAmount ────────────────────────────────────────────────────────
    if (r.cashAmount !== undefined && r.cashAmount !== null) {
      if (typeof r.cashAmount !== 'number' || r.cashAmount < 0 || !isFinite(r.cashAmount)) {
        errors.push(`${prefix}: cashAmount must be a non-negative finite number or null.`);
      }
    }

    validRecords.push(r);
  }

  // Acknowledgements are a top-level export field, not part of each record.
  // Only current exact-deadline keys are meaningful; stale or orphaned keys
  // must not silently suppress reminders for an unrelated imported record.
  let acknowledgements;
  if (payload.acknowledgements !== undefined) {
    const importedAcks = payload.acknowledgements;
    if (!importedAcks || typeof importedAcks !== 'object' || Array.isArray(importedAcks)) {
      errors.push('Import acknowledgements must be an object.');
    } else {
      const entries = Object.entries(importedAcks);
      if (entries.length > MAX_RECORDS) errors.push(`Too many acknowledgement keys (max ${MAX_RECORDS}).`);
      const expectedKeys = new Set();
      for (const r of validRecords) {
        if (typeof r.id !== 'string' || typeof r.deadlineRaw !== 'string') continue;
        const parsed = parseDeadline(r.deadlineRaw);
        if (!('error' in parsed) && !parsed.dateOnly) {
          expectedKeys.add(ackKey({ ...r, deadline: parsed }));
        }
      }
      acknowledgements = Object.create(null);
      for (const [key, value] of entries) {
        if (key.length > MAX_ID_LEN + 32 || !expectedKeys.has(key)) {
          errors.push('Acknowledgement key does not match a current exact record deadline.');
          continue;
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          errors.push(`Acknowledgement "${key}" must be an object.`);
          continue;
        }
        const flags = {};
        for (const [flag, enabled] of Object.entries(value)) {
          if (!['ack24', 'ack72', 'ack7d'].includes(flag) || typeof enabled !== 'boolean') {
            errors.push(`Acknowledgement "${key}" must contain only boolean ack24, ack72 and ack7d flags.`);
          } else {
            flags[flag] = enabled;
          }
        }
        acknowledgements[key] = flags;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, records: validRecords,
    ...(acknowledgements !== undefined ? { acknowledgements } : {}) };
}

/**
 * Merge incoming records into existing records, deduplicating by id then by
 * normalised URL.  Enforces the MAX_RECORDS cap on the merged result — if
 * the merge would exceed 200 records the entire import is rejected atomically
 * with a descriptive error, leaving existing data unchanged.
 *
 * Returns:
 *   { ok: true,  merged, added, skipped, conflicts }
 *   { ok: false, errors }
 *
 * @param {object[]} existing
 * @param {object[]} incoming
 * @returns {{ ok: true, merged: object[], added: number, skipped: number, conflicts: string[] }
 *          |{ ok: false, errors: string[] }}
 */
export function deduplicateRecords(existing, incoming) {
  const byId  = new Map(existing.map(r => [r.id, r]));
  const byUrl = new Map(
    existing
      .filter(r => r.sourceUrl)
      .map(r => [normaliseUrl(r.sourceUrl), r])
  );

  const conflicts = [];
  let added = 0, skipped = 0;

  const toAdd = [];

  for (const rec of incoming) {
    if (byId.has(rec.id)) {
      conflicts.push(`"${rec.title}" (id ${rec.id}) already exists — skipped.`);
      skipped++;
      continue;
    }
    if (rec.sourceUrl) {
      const norm = normaliseUrl(rec.sourceUrl);
      if (byUrl.has(norm)) {
        const ex = byUrl.get(norm);
        conflicts.push(`"${rec.title}" has the same source URL as existing "${ex.title}" — skipped.`);
        skipped++;
        continue;
      }
    }
    toAdd.push(rec);
    // Index staged additions immediately so later entries in the SAME file
    // are compared against them. These maps are local, so rejecting the batch
    // below still leaves the existing records unchanged.
    byId.set(rec.id, rec);
    if (rec.sourceUrl) byUrl.set(normaliseUrl(rec.sourceUrl), rec);
  }

  // Enforce MAX_RECORDS cap on the merged result
  const projectedTotal = existing.length + toAdd.length;
  if (projectedTotal > MAX_RECORDS) {
    const allowable = MAX_RECORDS - existing.length;
    return {
      ok: false,
      errors: [
        `Importing ${toAdd.length} new record${toAdd.length !== 1 ? 's' : ''} would bring ` +
        `the total to ${projectedTotal}, exceeding the ${MAX_RECORDS}-record limit. ` +
        `You can add at most ${Math.max(0, allowable)} more record${allowable !== 1 ? 's' : ''}. ` +
        `Export and remove existing records first, then re-import.`
      ]
    };
  }

  added = toAdd.length;

  return { ok: true, merged: [...byId.values()], added, skipped, conflicts };
}

// ---------------------------------------------------------------------------
// Seed data (explicitly fictional)
// ---------------------------------------------------------------------------

/**
 * Three fictional demo opportunities for first launch.
 * Names, URLs, prizes and deadlines are invented. No real contest data.
 */
export function createSeedRecords(now = new Date()) {
  const afterHours = hours => new Date(now.getTime() + hours * MS_HOUR).toISOString();
  const dateAfterDays = days => new Date(now.getTime() + days * MS_24H).toISOString().slice(0, 10);

  return [
    {
      id: 'seed-001',
      title: 'FICTIONAL — Midnight Illustration Prize',
      sourceUrl: 'https://fictional-gallery.test/open-call',
      cashAmount: 2000,
      currency: 'PLN',
      creditsDescription: 'Separate non-cash prize: 100 fictional rendering credits.',
      feeStatus: 'free',
      deadlineRaw: afterHours(20),
      stage: 'preparing',
      notes: 'FICTIONAL DEMO. This contest does not exist. The cash and rendering credits are separate invented prizes.',
      checklist: [
        { id: 'c1a', label: 'Prepare three original illustrations', done: true },
        { id: 'c1b', label: 'Write a short artist statement', done: false },
        { id: 'c1c', label: 'Prepare the final upload package', done: false }
      ],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    },
    {
      id: 'seed-002',
      title: 'FICTIONAL — Spectral Film Open Call',
      sourceUrl: 'https://fictional-film.test/submissions',
      cashAmount: null,
      currency: '',
      creditsDescription: 'Non-cash only: 250 fictional editing credits. No cash prize.',
      feeStatus: 'free',
      deadlineRaw: dateAfterDays(8),
      stage: 'registered',
      notes: 'FICTIONAL DEMO. This festival does not exist. Only a calendar date is known; confirm the closing hour before relying on it.',
      checklist: [
        { id: 'c2a', label: 'Export the short film', done: false },
        { id: 'c2b', label: 'Add English subtitles', done: false },
        { id: 'c2c', label: 'Prepare a film poster', done: false }
      ],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    },
    {
      id: 'seed-003',
      title: 'FICTIONAL — Haunted Interface Sprint',
      sourceUrl: 'https://fictional-design.test/sprint',
      cashAmount: 500,
      currency: 'EUR',
      creditsDescription: '',
      feeStatus: 'free',
      deadlineRaw: afterHours(72),
      stage: 'submitted',
      notes: 'FICTIONAL DEMO. This challenge does not exist. The example entry is already submitted, so deadline reminders are suppressed.',
      checklist: [
        { id: 'c3a', label: 'Finish the interface case study', done: true },
        { id: 'c3b', label: 'Send the presentation', done: true }
      ],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    }
  ];
}
