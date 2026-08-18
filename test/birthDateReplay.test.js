import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { BIRTHDATE_REPLAY_NOTE } from '../lib/rosterAudit.js';
import { authorizeReplay, planRecompute, summariseReplay } from '../lib/policyVersion.js';

/**
 * แก้วันเกิดหลังอนุมัติแล้ว — HR's rule, 2026-08-18.
 *
 * A birth date corrected after a request was signed off used to leave that
 * request computed under the old calendar: the day was a holiday for that
 * person and is not any more, or the reverse, and F-HR-027 prints the stale
 * split. The correction now reaches approved entries too — but only while the
 * month is open. ปิดงวด is the line, not the signature.
 *
 * The arithmetic is `planRecompute`'s and is already covered by
 * test/replayPeriodLock.test.js. What is pinned here is the DECISION: which
 * statuses the roster route asks for, that it says why, and that a closed month
 * still refuses — including the reasoning, so that a future reader who thinks
 * the admin-only rule was simply forgotten finds the argument instead.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const ROUTE = 'app/api/employees/[id]/route.js';

// ── what the roster route asks for ──────────────────────────────────────────

test('a moved วันเกิด replays the approved entries as well as the pending ones', () => {
  const route = read(ROUTE);
  assert.match(route, /status: \{ \$in: \[\.\.\.PENDING_STATUSES, 'approved'\] \}/);
  assert.match(route, /includeApproved: true/);
});

test('and it says why, because the escape hatch requires a reason', () => {
  // Not a literal in the route: the sentence is shown beside the changed figure
  // in ประวัติรายการ, and two copies of it would drift.
  assert.match(read(ROUTE), /note: BIRTHDATE_REPLAY_NOTE/);
  assert.match(BIRTHDATE_REPLAY_NOTE, /วันเกิด/);
  assert.match(BIRTHDATE_REPLAY_NOTE, /ยังไม่ปิดงวด/);
  // recomputeEntries throws without one — the note is load-bearing, not a label.
  assert.ok(BIRTHDATE_REPLAY_NOTE.trim().length > 0);
});

test('rejected and cancelled rows stay out of it', () => {
  const route = read(ROUTE);
  assert.doesNotMatch(route, /'rejected'/);
  assert.doesNotMatch(route, /'cancelled'/);
});

// ── the guard that replaced the signature ───────────────────────────────────

test('a closed month is left on the old birth date, whatever is asked for', () => {
  const entries = [
    { _id: 'open-approved', status: 'approved', period: '2026-08' },
    { _id: 'closed-approved', status: 'approved', period: '2026-07' },
    { _id: 'closed-pending', status: 'pending_hr', period: '2026-07' },
  ];
  const { replay, skipped } = planRecompute(entries, {
    includeApproved: true,
    closedPeriods: ['2026-07'],
  });

  assert.deepEqual(replay.map((e) => e._id), ['open-approved']);
  assert.equal(skipped.length, 2);
  for (const s of skipped) assert.equal(s.reason, 'period_closed');

  // And the months come back named, so the screen can say which ones somebody
  // has to reopen rather than reporting a count nobody can act on.
  const summary = summariseReplay({ scanned: entries, replay, skipped });
  assert.deepEqual(summary.closedPeriods, ['2026-07']);
  assert.equal(summary.approvedReplayed, 1);
});

test('the admin-only clause still guards every OTHER way into an approved row', () => {
  // The roster route does not consult `authorizeReplay`, on the argument in its
  // comment: a birth date is a fact recorded wrong, not a policy re-read. That
  // argument must not become a hole in the rule it steps around, so the rule
  // itself is asserted here unchanged.
  assert.equal(authorizeReplay({ includeApproved: false }).ok, true);
  assert.equal(authorizeReplay({ actor: { role: 'hr' }, includeApproved: true, note: 'x' }).status, 403);
  assert.equal(authorizeReplay({ actor: { role: 'admin' }, includeApproved: true, note: '' }).status, 400);
  assert.equal(authorizeReplay({ actor: { role: 'admin' }, includeApproved: true, note: 'x' }).ok, true);
});

test('the reasoning is written down where the next reader will be', () => {
  // This one exists because the change looks like a bug on sight: a route that
  // sets includeApproved without asking authorizeReplay. If somebody deletes the
  // argument, they should have to delete a failing test with it.
  const route = read(ROUTE);
  assert.match(route, /APPROVED ENTRIES MOVE TOO, WHILE THE MONTH IS OPEN/);
  assert.match(route, /A birth date is not a reading/);
});

// ── what the screen tells whoever pressed save ──────────────────────────────

test('the roster screen reports the approved half and names the closed months', () => {
  const view = read('components/AdminView.jsx');
  assert.match(view, /saved\.recomputed\.approvedReplayed/);
  assert.match(view, /saved\.recomputed\.closedPeriods/);
  // The old promise must be gone: it said approved entries were never touched.
  assert.doesNotMatch(view, /ใบที่อนุมัติแล้วไม่ถูกแตะต้อง/);
});
