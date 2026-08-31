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
 * split. The correction reaches approved entries too.
 *
 * IT USED TO STOP AT ปิดงวด — "only while the month is open", the line being
 * the close rather than the signature. That feature was withdrawn on 2026-08-31
 * (lib/periodStatus.js: the signed paper in the filing cabinet is the record),
 * so the replay now reaches every month however old. That is the intended
 * reading of HR's rule rather than a gap left in it: a wrong birth date made
 * the paper wrong on the day it was printed, and correcting it owes visibility
 * rather than restraint.
 *
 * The arithmetic is `planRecompute`'s and is covered by
 * test/policyVersion.test.js. What is pinned here is the DECISION: which
 * statuses the roster route asks for, that it says why, and the reasoning
 * behind stepping around `authorizeReplay` — so that a future reader who thinks
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
  // recomputeEntries throws without one — the note is load-bearing, not a label.
  assert.ok(BIRTHDATE_REPLAY_NOTE.trim().length > 0);
});

test('rejected and cancelled rows stay out of it', () => {
  const route = read(ROUTE);
  assert.doesNotMatch(route, /'rejected'/);
  assert.doesNotMatch(route, /'cancelled'/);
});

// ── how far back it reaches, now that nothing stops it ──────────────────────

test('every month is replayed, however old — there is no closed one to stop at', () => {
  /**
   * THE INVERSE OF WHAT THIS TEST USED TO ASSERT, and deliberately kept in the
   * same place so the change is legible rather than silent. It read "a closed
   * month is left on the old birth date, whatever is asked for", handed
   * `planRecompute` a `closedPeriods` list and checked that both rows in that
   * month were skipped with `reason: 'period_closed'`.
   *
   * ปิดงวด was withdrawn on 2026-08-31 and the option went with it. What is
   * pinned now is that a correction reaches back as far as the entries go.
   */
  const entries = [
    { _id: 'august-approved', status: 'approved', period: '2026-08' },
    { _id: 'july-approved', status: 'approved', period: '2026-07' },
    { _id: 'july-pending', status: 'pending_hr', period: '2026-07' },
  ];
  const { replay, skipped } = planRecompute(entries, { includeApproved: true });

  assert.deepEqual(replay.map((e) => e._id), ['august-approved', 'july-approved', 'july-pending']);
  assert.deepEqual(skipped, []);

  const summary = summariseReplay({ scanned: entries, replay, skipped });
  assert.equal(summary.approvedReplayed, 2);
  // The two fields that named and counted the months ปิดงวด kept out are gone,
  // not merely always-empty: a figure that can never say anything is a figure
  // every reader has to check before learning that.
  assert.equal('closedPeriods' in summary, false);
  assert.equal('skippedClosed' in summary, false);
});

test('and the approved rule is still the one thing that does stop it', () => {
  // Without `includeApproved` a signed row is left alone, as it always was.
  // That rule was here before ปิดงวด and outlived it.
  const { replay, skipped } = planRecompute([
    { _id: 'signed', status: 'approved', period: '2026-07' },
    { _id: 'waiting', status: 'pending_hr', period: '2026-07' },
  ]);
  assert.deepEqual(replay.map((e) => e._id), ['waiting']);
  assert.deepEqual(skipped, [{ id: 'signed', reason: 'approved' }]);
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
  assert.match(route, /APPROVED ENTRIES MOVE TOO/);
  assert.match(route, /A birth date is not a reading/);
});

// ── what the screen tells whoever pressed save ──────────────────────────────

test('the roster screen reports the approved half', () => {
  const view = read('components/AdminView.jsx');
  assert.match(view, /saved\.recomputed\.approvedReplayed/);
  // The old promise must be gone: it said approved entries were never touched.
  assert.doesNotMatch(view, /ใบที่อนุมัติแล้วไม่ถูกแตะต้อง/);
  // And so must the ⚠ line that named the months ปิดงวด kept out — there are
  // none, so a notice that could never appear is a branch nobody can test.
  assert.doesNotMatch(view, /recomputed\.closedPeriods/);
});
