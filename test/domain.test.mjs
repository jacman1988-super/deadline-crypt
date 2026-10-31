/**
 * test/domain.test.mjs — Deadline Crypt domain tests
 * Uses Node built-in test runner (node:test). No npm installs required.
 * Run with: node --test test/domain.test.mjs
 *
 * Written by Kiro on 2026-10-31.
 * Revised by Kiro on 2026-10-31 following Codex review findings:
 *   - Fixed deadline-change reset fixture (was 70h, now >72h → within7days)
 *   - Added regressions for: exact-timestamp calendar validation, validateImportPayload
 *     type guards and done:boolean enforcement, normaliseUrl hash/param preservation,
 *     ackKey epoch-based identity, date-only classification invariant, MAX_RECORDS
 *     post-merge cap.
 * Codex added incoming-batch deduplication, backup acknowledgement/schema
 * regressions and clock-relative English fictional fixture checks.
 *
 * Tests not yet executed by Kiro (no shell). Codex will run and report results.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDeadline,
  classifyDeadline,
  isDateOnlyPast,
  formatDeadline,
  formatCountdown,
  getMissingCount,
  getNextAction,
  shouldShowReminder,
  acknowledgeReminder,
  ackKey,
  validateUrl,
  normaliseUrl,
  validateImportPayload,
  deduplicateRecords,
  sanitiseText,
  createSeedRecords,
  MAX_TITLE_LEN,
  MAX_NOTES_LEN,
  MAX_RECORDS
} from '../domain.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal record with overrides. */
function rec(overrides = {}) {
  return {
    id: 'test-id',
    title: 'Test Opportunity',
    sourceUrl: '',
    cashAmount: null,
    currency: '',
    creditsDescription: '',
    feeStatus: 'unknown',
    deadlineRaw: null,
    deadline: null,
    stage: 'interested',
    checklist: [],
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

/** Parse and attach .deadline to a record given a raw string. */
function withDeadline(r, raw) {
  const parsed = parseDeadline(raw);
  if ('error' in parsed) throw new Error(`Test setup: bad deadline "${raw}": ${parsed.error}`);
  return { ...r, deadlineRaw: raw, deadline: parsed };
}

// ---------------------------------------------------------------------------
// parseDeadline — basic acceptance
// ---------------------------------------------------------------------------

describe('parseDeadline — acceptance', () => {
  it('accepts ISO 8601 with +01:00 offset', () => {
    const result = parseDeadline('2026-11-01T14:00:00+01:00');
    assert.ok(!('error' in result));
    assert.equal(result.dateOnly, false);
    assert.ok(result.date instanceof Date);
    assert.ok(!isNaN(result.date.getTime()));
  });

  it('accepts ISO 8601 with Z suffix', () => {
    const result = parseDeadline('2026-11-01T13:00:00Z');
    assert.ok(!('error' in result));
    assert.equal(result.dateOnly, false);
  });

  it('accepts ISO 8601 with negative offset', () => {
    const result = parseDeadline('2026-11-01T08:00:00-05:00');
    assert.ok(!('error' in result));
    assert.equal(result.dateOnly, false);
  });

  it('accepts date-only YYYY-MM-DD', () => {
    const result = parseDeadline('2026-11-15');
    assert.ok(!('error' in result));
    assert.equal(result.dateOnly, true);
  });

  it('accepts 2026-02-28 (valid Feb)', () => {
    const result = parseDeadline('2026-02-28');
    assert.ok(!('error' in result));
  });

  it('accepts 2024-02-29 (leap year Feb 29)', () => {
    const result = parseDeadline('2024-02-29T12:00:00Z');
    assert.ok(!('error' in result), `Unexpected error: ${'error' in result ? result.error : ''}`);
  });

  it('accepts DST-boundary timestamp 2026-03-29T02:30:00+02:00', () => {
    // Europe/Warsaw spring-forward DST boundary
    const result = parseDeadline('2026-03-29T02:30:00+02:00');
    assert.ok(!('error' in result), `Unexpected error: ${'error' in result ? result.error : ''}`);
  });
});

// ---------------------------------------------------------------------------
// parseDeadline — rejection
// ---------------------------------------------------------------------------

describe('parseDeadline — rejection', () => {
  it('rejects bare local timestamp without offset', () => {
    const result = parseDeadline('2026-11-01T14:00:00');
    assert.ok('error' in result);
    assert.ok(result.error.includes('UTC offset'));
  });

  it('rejects bare local with fractional seconds', () => {
    const result = parseDeadline('2026-11-01T14:00:00.000');
    assert.ok('error' in result);
  });

  it('rejects timestamp with no time or date', () => {
    const result = parseDeadline('not-a-date');
    assert.ok('error' in result);
  });

  it('rejects empty string', () => {
    const result = parseDeadline('');
    assert.ok('error' in result);
  });

  it('rejects null', () => {
    const result = parseDeadline(null);
    assert.ok('error' in result);
  });

  it('rejects invalid month 13', () => {
    const result = parseDeadline('2026-13-01');
    assert.ok('error' in result);
  });

  it('rejects invalid month 00', () => {
    const result = parseDeadline('2026-00-01');
    assert.ok('error' in result);
  });

  it('rejects ambiguous partial ISO', () => {
    const result = parseDeadline('2026-11');
    assert.ok('error' in result);
  });

  // ── Regression #3: exact-timestamp calendar validation ──────────────────

  it('rejects 2026-11-31T12:00:00+01:00 (November has only 30 days)', () => {
    // Previously JS Date would silently roll Nov 31 → Dec 1.
    const result = parseDeadline('2026-11-31T12:00:00+01:00');
    assert.ok('error' in result, 'Expected error for non-existent Nov 31');
  });

  it('rejects 2026-04-31T00:00:00Z (April has only 30 days)', () => {
    const result = parseDeadline('2026-04-31T00:00:00Z');
    assert.ok('error' in result, 'Expected error for non-existent Apr 31');
  });

  it('rejects 2026-02-29T00:00:00Z (2026 is not a leap year)', () => {
    const result = parseDeadline('2026-02-29T00:00:00Z');
    assert.ok('error' in result, 'Expected error for Feb 29 on non-leap year 2026');
  });

  it('rejects date-only 2026-02-29 (2026 not a leap year)', () => {
    const result = parseDeadline('2026-02-29');
    assert.ok('error' in result, 'Expected error for Feb 29 date-only on non-leap year');
  });

  it('rejects date-only 2026-11-31', () => {
    const result = parseDeadline('2026-11-31');
    assert.ok('error' in result, 'Expected error for non-existent Nov 31 date-only');
  });

  it('rejects hour > 23', () => {
    const result = parseDeadline('2026-11-01T24:00:00Z');
    assert.ok('error' in result);
  });

  it('rejects minute > 59', () => {
    const result = parseDeadline('2026-11-01T12:60:00Z');
    assert.ok('error' in result);
  });
});

// ---------------------------------------------------------------------------
// classifyDeadline — exact timestamps
// ---------------------------------------------------------------------------

describe('classifyDeadline — exact timestamps', () => {
  const base = new Date('2026-11-01T12:00:00Z');

  it('classifies as expired when deadline is in the past', () => {
    const dl = parseDeadline('2026-11-01T11:59:59Z');
    assert.equal(classifyDeadline(dl, base), 'expired');
  });

  it('classifies as within24h at exactly 24h boundary', () => {
    const future = new Date(base.getTime() + 24 * 3_600_000);
    const iso = future.toISOString().replace(/\.\d+Z$/, 'Z');
    const dl = parseDeadline(iso);
    assert.equal(classifyDeadline(dl, base), 'within24h');
  });

  it('classifies as within72h between 24h+1ms and 72h', () => {
    const future = new Date(base.getTime() + 24 * 3_600_000 + 1);
    const dl2 = { date: future, dateOnly: false };
    assert.equal(classifyDeadline(dl2, base), 'within72h');
  });

  it('classifies as within7days between 72h+1ms and 7d', () => {
    const future = new Date(base.getTime() + 72 * 3_600_000 + 1);
    const dl = { date: future, dateOnly: false };
    assert.equal(classifyDeadline(dl, base), 'within7days');
  });

  it('classifies as later beyond 7 days', () => {
    const future = new Date(base.getTime() + 7 * 24 * 3_600_000 + 1);
    const dl = { date: future, dateOnly: false };
    assert.equal(classifyDeadline(dl, base), 'later');
  });

  it('classifies as expired at now', () => {
    const dl = { date: base, dateOnly: false };
    assert.equal(classifyDeadline(dl, base), 'expired');
  });
});

// ---------------------------------------------------------------------------
// classifyDeadline — date-only  (Regression #7)
// ---------------------------------------------------------------------------

describe('classifyDeadline — date-only', () => {
  it('returns dateOnly for future date-only deadline', () => {
    const dl = parseDeadline('2099-01-01');
    assert.equal(classifyDeadline(dl, new Date()), 'dateOnly');
  });

  // Regression #7: date-only must NEVER return 'expired', even when the
  // calendar date is in the past. The closing hour was unknown; we must not
  // invent a midnight instant and declare the contest over.
  it('returns dateOnly even for a past calendar date (never expired)', () => {
    const dl = parseDeadline('2020-01-01');
    assert.equal(
      classifyDeadline(dl, new Date()),
      'dateOnly',
      'date-only classification must remain dateOnly regardless of calendar date'
    );
  });

  it('returns dateOnly for today (same calendar date UTC)', () => {
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    const dl = parseDeadline(iso);
    assert.equal(classifyDeadline(dl, today), 'dateOnly');
  });

  it('returns dateOnly for yesterday (still dateOnly, not expired)', () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const iso = yesterday.toISOString().slice(0, 10);
    const dl = parseDeadline(iso);
    assert.equal(classifyDeadline(dl, new Date()), 'dateOnly');
  });
});

// ---------------------------------------------------------------------------
// isDateOnlyPast
// ---------------------------------------------------------------------------

describe('isDateOnlyPast', () => {
  it('returns true for a past calendar date', () => {
    const dl = parseDeadline('2020-06-15');
    assert.equal(isDateOnlyPast(dl, new Date()), true);
  });

  it('returns false for a future calendar date', () => {
    const dl = parseDeadline('2099-06-15');
    assert.equal(isDateOnlyPast(dl, new Date()), false);
  });

  it('returns false for an exact deadline (not date-only)', () => {
    const dl = parseDeadline('2020-06-15T00:00:00Z');
    assert.equal(isDateOnlyPast(dl, new Date()), false);
  });
});

// ---------------------------------------------------------------------------
// getMissingCount  — boolean strictness (Regression #4)
// ---------------------------------------------------------------------------

describe('getMissingCount', () => {
  it('returns 0 for empty checklist', () => {
    assert.equal(getMissingCount(rec()), 0);
  });

  it('counts only undone items', () => {
    const r = rec({ checklist: [
      { id: '1', label: 'A', done: true },
      { id: '2', label: 'B', done: false },
      { id: '3', label: 'C', done: false }
    ]});
    assert.equal(getMissingCount(r), 2);
  });

  it('returns 0 when all done', () => {
    const r = rec({ checklist: [{ id: '1', label: 'A', done: true }] });
    assert.equal(getMissingCount(r), 0);
  });

  // Regression #4: done:'false' (string) must count as missing, not done.
  // This is enforced at import validation, but the counting function itself
  // must also be strict: only boolean true is "done".
  it('treats done:"false" (string) as missing — only boolean true is done', () => {
    const r = rec({ checklist: [
      { id: '1', label: 'A', done: 'false' },   // string — not done
      { id: '2', label: 'B', done: 1 },          // number 1 — not boolean true
      { id: '3', label: 'C', done: true }         // boolean true — done
    ]});
    assert.equal(getMissingCount(r), 2);
  });
});

// ---------------------------------------------------------------------------
// getNextAction
// ---------------------------------------------------------------------------

describe('getNextAction', () => {
  it('interested with no URL → find URL', () => {
    assert.ok(getNextAction(rec({ stage: 'interested', sourceUrl: '' })).includes('source URL'));
  });

  it('interested with URL → decide to register', () => {
    assert.ok(getNextAction(rec({ stage: 'interested', sourceUrl: 'https://example.com' })).includes('register'));
  });

  it('registered with missing items', () => {
    const r = rec({ stage: 'registered', checklist: [{ id: '1', label: 'x', done: false }] });
    assert.ok(getNextAction(r).includes('1 outstanding'));
  });

  it('preparing with no missing items → submit manually', () => {
    const r = rec({ stage: 'preparing', checklist: [{ id: '1', label: 'x', done: true }] });
    assert.ok(getNextAction(r).includes('mark as submitted'));
  });

  it('submitted → awaiting result', () => {
    assert.ok(getNextAction(rec({ stage: 'submitted' })).toLowerCase().includes('awaiting'));
  });

  it('withdrawn → no further action', () => {
    assert.ok(getNextAction(rec({ stage: 'withdrawn' })).toLowerCase().includes('withdrawn'));
  });
});

// ---------------------------------------------------------------------------
// shouldShowReminder — submitted/withdrawn suppression
// ---------------------------------------------------------------------------

describe('shouldShowReminder — suppression', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const rawSoon = '2026-11-01T20:00:00Z'; // 8h from now → within24h

  it('suppresses reminder for submitted record', () => {
    const r = withDeadline(rec({ stage: 'submitted' }), rawSoon);
    assert.equal(shouldShowReminder(r, {}, now), null);
  });

  it('suppresses reminder for withdrawn record', () => {
    const r = withDeadline(rec({ stage: 'withdrawn' }), rawSoon);
    assert.equal(shouldShowReminder(r, {}, now), null);
  });

  it('suppresses reminder for date-only deadline', () => {
    const r = withDeadline(rec({ stage: 'preparing' }), '2026-11-02');
    assert.equal(shouldShowReminder(r, {}, now), null);
  });

  it('suppresses when expired', () => {
    const r = withDeadline(rec({ stage: 'preparing' }), '2026-11-01T11:00:00Z');
    assert.equal(shouldShowReminder(r, {}, now), null);
  });
});

// ---------------------------------------------------------------------------
// shouldShowReminder — threshold logic
// ---------------------------------------------------------------------------

describe('shouldShowReminder — threshold priority', () => {
  const now = new Date('2026-11-01T12:00:00Z');

  it('shows 24h reminder when deadline is within 24h and unacked', () => {
    const r = withDeadline(rec({ stage: 'preparing', id: 'r1' }), '2026-11-01T20:00:00Z');
    const result = shouldShowReminder(r, {}, now);
    assert.ok(result !== null);
    assert.equal(result.threshold, '24h');
  });

  it('shows 72h reminder when within72h and unacked', () => {
    // 48h from now
    const deadline = new Date(now.getTime() + 48 * 3_600_000);
    const r = { ...rec({ stage: 'preparing', id: 'r2', deadlineRaw: deadline.toISOString() }),
      deadline: { date: deadline, dateOnly: false } };
    const result = shouldShowReminder(r, {}, now);
    assert.ok(result !== null);
    assert.equal(result.threshold, '72h');
  });

  it('shows 7d reminder when within7days and unacked', () => {
    const deadline = new Date(now.getTime() + 5 * 24 * 3_600_000);
    const r = { ...rec({ stage: 'preparing', id: 'r3', deadlineRaw: deadline.toISOString() }),
      deadline: { date: deadline, dateOnly: false } };
    const result = shouldShowReminder(r, {}, now);
    assert.ok(result !== null);
    assert.equal(result.threshold, '7d');
  });

  it('no reminder after acknowledging 24h (covers all)', () => {
    const r = withDeadline(rec({ stage: 'preparing', id: 'r4' }), '2026-11-01T20:00:00Z');
    const key = ackKey(r);
    const acks = acknowledgeReminder({}, key, '24h');
    assert.equal(shouldShowReminder(r, acks, now), null);
  });

  it('24h ack also suppresses 72h reminder', () => {
    const deadline = new Date(now.getTime() + 48 * 3_600_000);
    const r = { ...rec({ stage: 'preparing', id: 'r5', deadlineRaw: deadline.toISOString() }),
      deadline: { date: deadline, dateOnly: false } };
    const key = ackKey(r);
    const acks = acknowledgeReminder({}, key, '24h');
    assert.equal(shouldShowReminder(r, acks, now), null);
  });

  it('72h ack suppresses 7d but not 24h (if falls within24h later)', () => {
    const deadline72 = new Date(now.getTime() + 48 * 3_600_000);
    const r72 = { ...rec({ stage: 'preparing', id: 'r6', deadlineRaw: deadline72.toISOString() }),
      deadline: { date: deadline72, dateOnly: false } };
    const key = ackKey(r72);
    const acks = acknowledgeReminder({}, key, '72h');
    // At 72h: suppressed
    assert.equal(shouldShowReminder(r72, acks, now), null);
    // Simulate time passing: now deadline is within24h
    const laterNow = new Date(now.getTime() + 25 * 3_600_000);
    const reminder = shouldShowReminder(r72, acks, laterNow);
    assert.ok(reminder !== null);
    assert.equal(reminder.threshold, '24h');
  });
});

// ---------------------------------------------------------------------------
// acknowledgeReminder — deadline change resets acks  (Regression #2 fixed fixture)
// ---------------------------------------------------------------------------

describe('acknowledgeReminder — deadline change resets', () => {
  // FIX for review item #2: the original fixture used 2026-11-04T10:00Z which is
  // only 70h from 2026-11-01T12:00Z → within72h, not within7days.
  // The new deadline 2026-11-05T10:00:00Z is 94h away → within7days. ✓
  it('changing deadlineRaw changes ackKey, rendering old acks ineffective', () => {
    const r1 = withDeadline(rec({ id: 'rx', stage: 'preparing' }), '2026-11-03T10:00:00Z');
    const key1 = ackKey(r1);
    const acks = acknowledgeReminder({}, key1, '72h');
    // New deadline — 2026-11-05T10:00:00Z is 94h after 2026-11-01T12:00Z → within7days
    const r2 = withDeadline(rec({ id: 'rx', stage: 'preparing' }), '2026-11-05T10:00:00Z');
    const key2 = ackKey(r2);
    assert.notEqual(key1, key2);
    const now = new Date('2026-11-01T12:00:00Z');
    // Verify the classification is indeed within7days (validates the fixture)
    assert.equal(classifyDeadline(r2.deadline, now), 'within7days');
    // acks[key2] is undefined → reminder shows again
    const reminder = shouldShowReminder(r2, acks, now);
    assert.ok(reminder !== null, 'Expected reminder after deadline change');
    assert.equal(reminder.threshold, '7d');
  });
});

// ---------------------------------------------------------------------------
// ackKey — epoch-based identity  (Regression #6)
// ---------------------------------------------------------------------------

describe('ackKey — canonical epoch identity', () => {
  // Two deadline strings that represent the same UTC instant must produce
  // the same ackKey so an acknowledged reminder is not re-shown merely
  // because the raw string representation was edited.
  it('same instant in Z and +01:00 produce the same key', () => {
    const r1 = withDeadline(rec({ id: 'eq', stage: 'preparing' }), '2026-11-03T10:00:00Z');
    const r2 = withDeadline(rec({ id: 'eq', stage: 'preparing' }), '2026-11-03T11:00:00+01:00');
    assert.equal(ackKey(r1), ackKey(r2),
      'Equivalent instants (Z vs +01:00) must share ackKey to avoid re-showing acked reminder'
    );
  });

  it('different instants produce different keys', () => {
    const r1 = withDeadline(rec({ id: 'ne', stage: 'preparing' }), '2026-11-03T10:00:00Z');
    const r2 = withDeadline(rec({ id: 'ne', stage: 'preparing' }), '2026-11-03T10:00:01Z');
    assert.notEqual(ackKey(r1), ackKey(r2));
  });

  it('acknowledged reminder not re-shown after equivalent deadline rewrite', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    // Deadline is 48h away — within72h
    const r1 = withDeadline(rec({ id: 'aeq', stage: 'preparing' }), '2026-11-03T12:00:00Z');
    const key1 = ackKey(r1);
    const acks = acknowledgeReminder({}, key1, '72h');
    // Same instant, different raw string (+01:00)
    const r2 = withDeadline(rec({ id: 'aeq', stage: 'preparing' }), '2026-11-03T13:00:00+01:00');
    // ackKey must match key1
    assert.equal(ackKey(r2), key1);
    // No reminder — already acked
    assert.equal(shouldShowReminder(r2, acks, now), null);
  });

  it('date-only deadline uses raw string (no epoch available)', () => {
    const r = { ...rec({ id: 'do', deadlineRaw: '2026-11-15' }), deadline: { date: new Date('2026-11-15T00:00:00Z'), dateOnly: true } };
    const key = ackKey(r);
    assert.ok(key.includes('2026-11-15'), `Expected raw date in key, got: ${key}`);
  });
});

// ---------------------------------------------------------------------------
// validateUrl
// ---------------------------------------------------------------------------

describe('validateUrl', () => {
  it('accepts https URL', () => {
    const r = validateUrl('https://example.com/path');
    assert.equal(r.ok, true);
  });

  it('accepts http URL', () => {
    const r = validateUrl('http://example.com');
    assert.equal(r.ok, true);
  });

  it('accepts empty string (optional field)', () => {
    assert.equal(validateUrl('').ok, true);
    assert.equal(validateUrl(null).ok, true);
  });

  it('rejects javascript: scheme', () => {
    assert.equal(validateUrl('javascript:alert(1)').ok, false);
  });

  it('rejects data: scheme', () => {
    assert.equal(validateUrl('data:text/html,<h1>x</h1>').ok, false);
  });

  it('rejects file: scheme', () => {
    assert.equal(validateUrl('file:///etc/passwd').ok, false);
  });

  it('rejects unparseable string', () => {
    assert.equal(validateUrl('not a url').ok, false);
  });
});

// ---------------------------------------------------------------------------
// normaliseUrl  (Regression #5 — preserve hash and non-tracking params)
// ---------------------------------------------------------------------------

describe('normaliseUrl', () => {
  // Regression #5: hash fragments must be PRESERVED, not stripped.
  // /#/contests/alpha and /#/contests/beta are distinct SPA routes.
  it('preserves hash fragments (SPA routes differ by hash)', () => {
    const n1 = normaliseUrl('https://example.com/#/contests/alpha');
    const n2 = normaliseUrl('https://example.com/#/contests/beta');
    assert.ok(n1.includes('#/contests/alpha'), `Expected hash in: ${n1}`);
    assert.notEqual(n1, n2, 'Different hash fragments must not normalise to the same URL');
  });

  it('strips utm_source', () => {
    const n = normaliseUrl('https://example.com/?utm_source=newsletter&page=1');
    assert.ok(!n.includes('utm_source'));
    assert.ok(n.includes('page=1'));
  });

  it('strips utm_medium, utm_campaign, utm_term, utm_content', () => {
    const n = normaliseUrl('https://example.com/?utm_medium=cpc&utm_campaign=fall&utm_term=art&utm_content=banner');
    assert.ok(!n.includes('utm_'), `Unexpected utm_ param in: ${n}`);
  });

  it('strips fbclid', () => {
    const n = normaliseUrl('https://example.com/?fbclid=abc123');
    assert.ok(!n.includes('fbclid'));
  });

  it('strips gclid', () => {
    const n = normaliseUrl('https://example.com/?gclid=xyz');
    assert.ok(!n.includes('gclid'));
  });

  it('strips msclkid', () => {
    const n = normaliseUrl('https://example.com/?msclkid=m123');
    assert.ok(!n.includes('msclkid'));
  });

  // Regression #5: 'ref', 'source', 'affiliate' are NOT stripped — they may
  // distinguish different contest editions.
  it('preserves ref, source, affiliate params (not considered tracking)', () => {
    const n = normaliseUrl('https://example.com/contest?ref=open-call&source=blog&affiliate=partner');
    assert.ok(n.includes('ref=open-call'),   `Expected ref in: ${n}`);
    assert.ok(n.includes('source=blog'),     `Expected source in: ${n}`);
    assert.ok(n.includes('affiliate=partner'), `Expected affiliate in: ${n}`);
  });

  it('preserves meaningful query params', () => {
    const n = normaliseUrl('https://example.com/?category=illustration&year=2026');
    assert.ok(n.includes('category=illustration'));
    assert.ok(n.includes('year=2026'));
  });

  it('lowercases hostname', () => {
    const n = normaliseUrl('https://EXAMPLE.COM/path');
    assert.ok(n.includes('example.com'));
  });

  it('handles empty string', () => {
    assert.equal(normaliseUrl(''), '');
  });

  it('different hash paths are not deduplicated as the same URL', () => {
    // Two contest pages on the same host differing only by hash route
    const existing = [{ id: 'e1', title: 'Contest A', sourceUrl: 'https://platform.test/#/contest/alpha' }];
    const incoming = [{ id: 'n1', title: 'Contest B', sourceUrl: 'https://platform.test/#/contest/beta' }];
    const result = deduplicateRecords(existing, incoming);
    assert.ok(result.ok, 'Expected ok:true');
    assert.equal(result.added, 1, 'Different hash fragments must not be treated as duplicate');
    assert.equal(result.skipped, 0);
  });
});

// ---------------------------------------------------------------------------
// validateImportPayload  (Regression #4)
// ---------------------------------------------------------------------------

describe('validateImportPayload', () => {
  const goodRecord = {
    id: 'abc-001',
    title: 'Test Record',
    sourceUrl: 'https://example.com',
    cashAmount: 100,
    currency: 'PLN',
    creditsDescription: '',
    feeStatus: 'free',
    deadlineRaw: '2026-12-01T12:00:00+01:00',
    stage: 'interested',
    checklist: [{ id: 'c1', label: 'Do thing', done: false }],
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  it('accepts a valid payload', () => {
    const result = validateImportPayload({ records: [goodRecord] });
    assert.equal(result.ok, true);
    assert.equal(result.records.length, 1);
  });

  it('rejects non-object payload — array', () => {
    const r = validateImportPayload([]);
    assert.equal(r.ok, false);
  });

  it('rejects non-object payload — string', () => {
    assert.equal(validateImportPayload('string').ok, false);
  });

  it('rejects null payload', () => {
    assert.equal(validateImportPayload(null).ok, false);
  });

  it('rejects missing records array', () => {
    assert.equal(validateImportPayload({}).ok, false);
  });

  it('rejects over MAX_RECORDS', () => {
    const many = Array.from({ length: MAX_RECORDS + 1 }, (_, i) => ({
      ...goodRecord, id: `id-${i}`, title: `Record ${i}`
    }));
    const result = validateImportPayload({ records: many });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('maximum')));
  });

  it('rejects record with missing id', () => {
    const r = { ...goodRecord, id: '' };
    const result = validateImportPayload({ records: [r] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('missing id')));
  });

  it('rejects title over max length', () => {
    const r = { ...goodRecord, title: 'x'.repeat(MAX_TITLE_LEN + 1) };
    const result = validateImportPayload({ records: [r] });
    assert.equal(result.ok, false);
  });

  it('rejects notes over max length', () => {
    const r = { ...goodRecord, notes: 'n'.repeat(MAX_NOTES_LEN + 1) };
    const result = validateImportPayload({ records: [r] });
    assert.equal(result.ok, false);
  });

  it('rejects invalid sourceUrl scheme', () => {
    const r = { ...goodRecord, sourceUrl: 'javascript:void(0)' };
    const result = validateImportPayload({ records: [r] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('sourceUrl')));
  });

  it('rejects bare local deadline', () => {
    const r = { ...goodRecord, deadlineRaw: '2026-11-01T12:00:00' };
    const result = validateImportPayload({ records: [r] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('deadline')));
  });

  it('rejects invalid stage', () => {
    const r = { ...goodRecord, stage: 'winner' };
    const result = validateImportPayload({ records: [r] });
    assert.equal(result.ok, false);
  });

  it('rejects negative cashAmount', () => {
    const r = { ...goodRecord, cashAmount: -10 };
    const result = validateImportPayload({ records: [r] });
    assert.equal(result.ok, false);
  });

  it('accepts null cashAmount', () => {
    const r = { ...goodRecord, cashAmount: null };
    const result = validateImportPayload({ records: [r] });
    assert.equal(result.ok, true);
  });

  // Regression #4: sourceUrl:7 (number) must not throw TypeError
  it('does not throw for sourceUrl:7 (number instead of string)', () => {
    const r = { ...goodRecord, sourceUrl: 7 };
    let result;
    assert.doesNotThrow(() => { result = validateImportPayload({ records: [r] }); });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('sourceUrl')));
  });

  // Regression #4: sourceUrl:{} (object) must not throw
  it('does not throw for sourceUrl:{} (object instead of string)', () => {
    const r = { ...goodRecord, sourceUrl: {} };
    let result;
    assert.doesNotThrow(() => { result = validateImportPayload({ records: [r] }); });
    assert.equal(result.ok, false);
  });

  // Regression #4: sourceUrl:true (boolean) must not throw
  it('does not throw for sourceUrl:true (boolean instead of string)', () => {
    const r = { ...goodRecord, sourceUrl: true };
    let result;
    assert.doesNotThrow(() => { result = validateImportPayload({ records: [r] }); });
    assert.equal(result.ok, false);
  });

  // Regression #4: done:'false' (string) must be rejected — checklist counting would be wrong
  it('rejects checklist item where done is string "false"', () => {
    const r = { ...goodRecord, checklist: [{ id: 'c1', label: 'Do thing', done: 'false' }] };
    const result = validateImportPayload({ records: [r] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.toLowerCase().includes('done')));
  });

  // Regression #4: done:0 (number) must be rejected
  it('rejects checklist item where done is number 0', () => {
    const r = { ...goodRecord, checklist: [{ id: 'c1', label: 'Do thing', done: 0 }] };
    const result = validateImportPayload({ records: [r] });
    assert.equal(result.ok, false);
  });

  // Regression #4: done:1 (number) must be rejected even though truthy
  it('rejects checklist item where done is number 1 (must be boolean)', () => {
    const r = { ...goodRecord, checklist: [{ id: 'c1', label: 'Task', done: 1 }] };
    const result = validateImportPayload({ records: [r] });
    assert.equal(result.ok, false);
  });

  it('accepts checklist item where done is boolean true', () => {
    const r = { ...goodRecord, checklist: [{ id: 'c1', label: 'Do thing', done: true }] };
    const result = validateImportPayload({ records: [r] });
    assert.equal(result.ok, true);
  });

  it('accepts checklist item where done is boolean false', () => {
    const r = { ...goodRecord, checklist: [{ id: 'c1', label: 'Do thing', done: false }] };
    const result = validateImportPayload({ records: [r] });
    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// deduplicateRecords  (Regression #8 — MAX_RECORDS cap after merge)
// ---------------------------------------------------------------------------

describe('deduplicateRecords', () => {
  const existing = [
    { id: 'e1', title: 'Existing 1', sourceUrl: 'https://example.com/contest' },
    { id: 'e2', title: 'Existing 2', sourceUrl: '' }
  ];

  it('adds new record with different id and URL', () => {
    const incoming = [{ id: 'n1', title: 'New', sourceUrl: 'https://other.com' }];
    const result = deduplicateRecords(existing, incoming);
    assert.ok(result.ok);
    assert.equal(result.added, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.conflicts.length, 0);
  });

  it('skips record with duplicate id', () => {
    const incoming = [{ id: 'e1', title: 'Duplicate ID', sourceUrl: '' }];
    const result = deduplicateRecords(existing, incoming);
    assert.ok(result.ok);
    assert.equal(result.skipped, 1);
    assert.ok(result.conflicts[0].includes('e1'));
  });

  it('skips record with duplicate normalised URL', () => {
    // URL normalisation now preserves hash; the dedup logic uses the normalised form.
    // This URL has no hash and strips only tracking params — same base URL, same key.
    const incoming = [{ id: 'new-id', title: 'Same URL', sourceUrl: 'https://example.com/contest?utm_source=test' }];
    const result = deduplicateRecords(existing, incoming);
    assert.ok(result.ok);
    assert.equal(result.skipped, 1);
    assert.ok(result.conflicts[0].toLowerCase().includes('url'));
  });

  it('deduplicates URL after stripping tracking params', () => {
    const incoming = [{
      id: 'new-id2',
      title: 'Tracking URL',
      sourceUrl: 'https://example.com/contest?utm_source=newsletter'
    }];
    const result = deduplicateRecords(existing, incoming);
    assert.ok(result.ok);
    assert.equal(result.skipped, 1);
  });

  // Regression #8: existing 200 + incoming 1 = 201 must be rejected atomically.
  it('rejects merge that would exceed MAX_RECORDS — returns ok:false, does not mutate', () => {
    const fullExisting = Array.from({ length: MAX_RECORDS }, (_, i) => ({
      id: `full-${i}`, title: `Record ${i}`, sourceUrl: ''
    }));
    const incoming = [{ id: 'overflow', title: 'One Too Many', sourceUrl: '' }];
    const result = deduplicateRecords(fullExisting, incoming);
    assert.equal(result.ok, false, 'Expected ok:false when merge exceeds MAX_RECORDS');
    assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
    assert.ok(result.errors[0].includes(String(MAX_RECORDS)), `Expected MAX_RECORDS (${MAX_RECORDS}) in error: ${result.errors[0]}`);
    // Ensure existing data is not touched — no .merged on failure
    assert.ok(!('merged' in result), 'merged must not be present on failure');
  });

  it('rejects large incoming that would push existing 100 over the limit', () => {
    const halfExisting = Array.from({ length: 100 }, (_, i) => ({
      id: `h-${i}`, title: `Half ${i}`, sourceUrl: ''
    }));
    // 101 new records with distinct ids and no URLs → 100 + 101 = 201
    const incoming = Array.from({ length: 101 }, (_, i) => ({
      id: `new-${i}`, title: `New ${i}`, sourceUrl: ''
    }));
    const result = deduplicateRecords(halfExisting, incoming);
    assert.equal(result.ok, false);
    assert.ok(result.errors[0].includes('201'));
  });

  it('accepts merge that lands exactly on MAX_RECORDS', () => {
    const almostFull = Array.from({ length: MAX_RECORDS - 1 }, (_, i) => ({
      id: `af-${i}`, title: `AF ${i}`, sourceUrl: ''
    }));
    const incoming = [{ id: 'last', title: 'Last', sourceUrl: '' }];
    const result = deduplicateRecords(almostFull, incoming);
    assert.ok(result.ok, `Expected ok:true at exactly MAX_RECORDS: ${result.errors}`);
    assert.equal(result.merged.length, MAX_RECORDS);
    assert.equal(result.added, 1);
  });
});

// ---------------------------------------------------------------------------
// sanitiseText
// ---------------------------------------------------------------------------

describe('sanitiseText', () => {
  it('clamps text to maxLen', () => {
    const result = sanitiseText('hello world', 5);
    assert.equal(result, 'hello');
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(sanitiseText(null, 100), '');
    assert.equal(sanitiseText(undefined, 100), '');
  });

  it('does not add HTML escaping (XSS handled by textContent at render)', () => {
    const xss = '<script>alert("xss")</script>';
    const result = sanitiseText(xss, 1000);
    assert.equal(result, xss);
  });
});

// ---------------------------------------------------------------------------
// formatDeadline
// ---------------------------------------------------------------------------

describe('formatDeadline', () => {
  it('appends UNKNOWN HOUR for date-only', () => {
    const dl = parseDeadline('2026-11-15');
    const str = formatDeadline(dl);
    assert.ok(str.includes('UNKNOWN HOUR'));
    assert.ok(str.includes('2026-11-15'));
  });

  it('formats exact timestamp as a string (no UNKNOWN HOUR)', () => {
    const dl = parseDeadline('2026-11-15T12:00:00+01:00');
    const str = formatDeadline(dl);
    assert.ok(!str.includes('UNKNOWN HOUR'));
    assert.ok(str.length > 0);
  });

  it('appends UNKNOWN HOUR for a past date-only deadline (not expired message)', () => {
    // Regression #7: even a past date-only deadline shows UNKNOWN HOUR,
    // never a spurious "expired" or invented closing time.
    const dl = parseDeadline('2020-01-01');
    const str = formatDeadline(dl);
    assert.ok(str.includes('UNKNOWN HOUR'), `Expected UNKNOWN HOUR in: ${str}`);
    assert.ok(!str.toLowerCase().includes('expired'), `Must not say expired: ${str}`);
  });
});

// ---------------------------------------------------------------------------
// formatCountdown
// ---------------------------------------------------------------------------

describe('formatCountdown', () => {
  it('returns null for date-only', () => {
    const dl = parseDeadline('2026-12-01');
    assert.equal(formatCountdown(dl, new Date()), null);
  });

  it('returns null for expired', () => {
    const dl = { date: new Date('2020-01-01T00:00:00Z'), dateOnly: false };
    assert.equal(formatCountdown(dl, new Date()), null);
  });

  it('returns hours+minutes format for < 24h', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    const dl = { date: new Date('2026-11-01T14:30:00Z'), dateOnly: false };
    const result = formatCountdown(dl, now);
    assert.ok(result !== null);
    assert.ok(result.includes('h'));
    assert.ok(result.includes('m'));
  });

  it('returns days+hours format for > 24h', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    const dl = { date: new Date('2026-11-03T12:00:00Z'), dateOnly: false };
    const result = formatCountdown(dl, now);
    assert.ok(result !== null);
    assert.ok(result.includes('d'));
  });
});

// ---------------------------------------------------------------------------
// createSeedRecords
// ---------------------------------------------------------------------------

describe('createSeedRecords', () => {
  it('returns exactly 3 records', () => {
    const seeds = createSeedRecords(new Date());
    assert.equal(seeds.length, 3);
  });

  it('preserves the three stable unique fixture ids', () => {
    const seeds = createSeedRecords(new Date());
    const ids = seeds.map(r => r.id);
    assert.equal(new Set(ids).size, 3);
    assert.deepEqual(ids, ['seed-001', 'seed-002', 'seed-003']);
  });

  it('seed-003 is submitted', () => {
    const seeds = createSeedRecords(new Date());
    const submitted = seeds.find(r => r.id === 'seed-003');
    assert.equal(submitted.stage, 'submitted');
  });

  it('all titles and notes explicitly mark the English examples FICTIONAL', () => {
    const seeds = createSeedRecords(new Date());
    for (const s of seeds) {
      assert.ok(s.notes.includes('FICTIONAL'), `seed ${s.id} missing fictional marker`);
      assert.ok(s.title.includes('FICTIONAL'), `seed ${s.id} title missing fictional marker`);
      assert.ok(new URL(s.sourceUrl).hostname.endsWith('.test'));
    }
  });

  it('all deadlines parse without error', () => {
    const seeds = createSeedRecords(new Date());
    for (const s of seeds) {
      const p = parseDeadline(s.deadlineRaw);
      assert.ok(!('error' in p), `seed ${s.id} bad deadline: ${'error' in p ? p.error : ''}`);
    }
  });

  it('creates fresh exact deadlines relative to January and summer judging clocks', () => {
    for (const instant of ['2027-01-31T23:55:00Z', '2027-06-30T23:55:00Z']) {
      const now = new Date(instant);
      const before = now.toISOString();
      const [preparing, dateOnly, submitted] = createSeedRecords(now);
      assert.equal(parseDeadline(preparing.deadlineRaw).date.getTime() - now.getTime(), 20 * 3600000);
      assert.equal(parseDeadline(submitted.deadlineRaw).date.getTime() - now.getTime(), 72 * 3600000);
      assert.equal(dateOnly.deadlineRaw, new Date(now.getTime() + 8 * 86400000).toISOString().slice(0, 10));
      assert.equal(parseDeadline(dateOnly.deadlineRaw).dateOnly, true);
      assert.equal(now.toISOString(), before, 'must not mutate the supplied clock');
      assert.equal(shouldShowReminder(withDeadline(submitted, submitted.deadlineRaw), {}, now), null);
    }
  });

  it('keeps cash and non-cash credits separate in contrasting stages', () => {
    const [cashAndCredits, creditsOnly, alreadySubmitted] = createSeedRecords(new Date('2027-01-01T12:00:00Z'));
    assert.equal(cashAndCredits.stage, 'preparing');
    assert.ok(cashAndCredits.cashAmount > 0);
    assert.ok(cashAndCredits.creditsDescription.includes('non-cash'));
    assert.equal(creditsOnly.stage, 'registered');
    assert.equal(creditsOnly.cashAmount, null);
    assert.ok(creditsOnly.creditsDescription.includes('No cash'));
    assert.equal(alreadySubmitted.stage, 'submitted');
    assert.ok(alreadySubmitted.cashAmount > 0);
  });

  it('all checklist done fields are real booleans', () => {
    const seeds = createSeedRecords(new Date());
    for (const s of seeds) {
      for (const item of s.checklist) {
        assert.equal(typeof item.done, 'boolean', `seed ${s.id} checklist item "${item.label}" has non-boolean done`);
      }
    }
  });
});

describe('deduplicateRecords — duplicates within one incoming file', () => {
  it('retains the first same-ID entry and reports the second instead of overwriting', () => {
    const result = deduplicateRecords([], [rec({title:'First'}), rec({title:'Second'})]);
    assert.equal(result.ok, true);
    assert.equal(result.added, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.merged[0].title, 'First');
  });

  it('deduplicates same-URL entries within the file after tracking normalization', () => {
    const result = deduplicateRecords([], [
      rec({id:'first',sourceUrl:'https://example.test/contest?utm_source=a'}),
      rec({id:'second',sourceUrl:'https://example.test/contest?utm_source=b'})
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.added, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.merged[0].id, 'first');
  });

  it('counts unique incoming records before applying the merged cap', () => {
    const existing = Array.from({length:MAX_RECORDS-1},(_,i)=>rec({id:`existing-${i}`}));
    const result = deduplicateRecords(existing, [rec({id:'last',title:'First'}), rec({id:'last',title:'Second'})]);
    assert.equal(result.ok, true);
    assert.equal(result.merged.length, MAX_RECORDS);
    assert.equal(result.added, 1);
    assert.equal(result.skipped, 1);
    assert.equal(existing.length, MAX_RECORDS-1, 'input array remains unchanged');
    assert.equal(result.merged.at(-1).title, 'First');
  });
});

describe('validateImportPayload — versioned backup and field schema', () => {
  const raw = '2027-01-02T12:00:00+01:00';
  const exact = () => withDeadline(rec(), raw);
  const backup = acknowledgements => ({version:1,records:[rec({deadlineRaw:raw})],acknowledgements});

  it('accepts absent version or numeric version 1 and rejects other versions', () => {
    assert.equal(validateImportPayload({records:[rec()]}).ok, true);
    assert.equal(validateImportPayload({version:1,records:[rec()]}).ok, true);
    for (const version of [0,2,'1',null]) assert.equal(validateImportPayload({version,records:[rec()]}).ok, false);
  });

  it('returns a validated optional acknowledgement map that still suppresses its threshold', () => {
    const key = ackKey(exact());
    const result = validateImportPayload(backup({[key]:{ack72:true,ack7d:true}}));
    assert.equal(result.ok, true);
    assert.equal(result.acknowledgements[key].ack72, true);
    assert.equal(shouldShowReminder(exact(), result.acknowledgements, new Date('2027-01-01T10:00:00Z')), null);
    assert.equal('acknowledgements' in validateImportPayload({records:[rec()]}), false);
  });

  it('rejects malformed top-level acknowledgement maps', () => {
    for (const value of [null,[],true,'false',7]) assert.equal(validateImportPayload(backup(value)).ok, false);
  });

  it('rejects non-boolean or unknown acknowledgement flags', () => {
    const key = ackKey(exact());
    for (const flags of [{ack24:'false'},{ack72:1},{ack7d:null},{unknown:true},[]]) {
      assert.equal(validateImportPayload(backup({[key]:flags})).ok, false);
    }
  });

  it('rejects orphaned or changed-deadline acknowledgement keys', () => {
    for (const key of ['other:123',`${exact().id}:0`,`${exact().id}:${raw}`]) {
      assert.equal(validateImportPayload(backup({[key]:{ack24:true}})).ok, false);
    }
  });

  it('accepts canonical acknowledgement identity for an equivalent offset spelling', () => {
    const key = ackKey(exact());
    const result = validateImportPayload({records:[rec({deadlineRaw:'2027-01-02T11:00:00Z'})],acknowledgements:{[key]:{ack24:true}}});
    assert.equal(result.ok, true);
  });

  it('rejects oversized IDs and currencies, and wrong known-field types', () => {
    for (const overrides of [{id:'i'.repeat(129)},{currency:'C'.repeat(11)},{currency:7},{createdAt:{}},{updatedAt:[]}]) {
      assert.equal(validateImportPayload({records:[rec(overrides)]}).ok, false);
    }
    assert.equal(validateImportPayload({records:[rec({id:'i'.repeat(128),currency:'USD'})]}).ok, true);
    assert.equal(validateImportPayload({records:[rec({currency:null,notes:null,creditsDescription:null,sourceUrl:null})]}).ok, true);
  });

  it('rejects an invalid supplied checklist ID without requiring one in old exports', () => {
    assert.equal(validateImportPayload({records:[rec({checklist:[{label:'Film',done:false,id:{}}]})]}).ok, false);
    assert.equal(validateImportPayload({records:[rec({checklist:[{label:'Film',done:false}]})]}).ok, true);
  });
});
