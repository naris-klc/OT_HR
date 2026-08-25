import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { planRecompute, summariseReplay } from '../lib/policyVersion.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * A CLOSED MONTH IS NOT RESTATED BY A FLAG CHANGE EITHER.
 *
 * ปิดงวด put seven write paths behind a lock (test/periodLockRoutes.test.js) and
 * a policy replay was the eighth way in — and the quietest of them. Nobody
 * presses an edit button: ฝ่ายบุคคล answer an [OPEN] item, every entry still in
 * flight is recomputed, and a month that had been signed off, exported and paid
 * moves underneath everybody.
 *
 * The user's rule, given 2026-08-14 about corrections and applied here: a
 * closed month changes only after an administrator has opened it. This does not
 * take an authority away — an administrator could already replay approved
 * entries with `includeApproved` — it makes doing it to a closed month a
 * deliberate act that leaves a reason and a record, which a flag change never
 * would.
 *
 * Run with: npm test
 */

const entry = (id, period, status = 'pending_hr') => ({ _id: id, period, status });

test('an open month replays as it always did', () => {
  const { replay, skipped } = planRecompute(
    [entry('a', '2026-08'), entry('b', '2026-08')],
    { closedPeriods: [] },
  );
  assert.equal(replay.length, 2);
  assert.equal(skipped.length, 0);
});

test('no closed periods at all is the old behaviour exactly', () => {
  // Every caller that has never heard of a lock — the seed, the holiday import,
  // the retired Express routes — passes nothing and must be unaffected.
  const { replay, skipped } = planRecompute([entry('a', '2026-08'), entry('b', '2026-07', 'approved')]);
  assert.equal(replay.length, 1);
  assert.deepEqual(skipped, [{ id: 'b', reason: 'approved' }]);
});

test('a closed month is skipped, and the row says which month', () => {
  const { replay, skipped } = planRecompute(
    [entry('a', '2026-07'), entry('b', '2026-08')],
    { closedPeriods: ['2026-07'] },
  );
  assert.deepEqual(replay.map((e) => e._id), ['b']);
  assert.deepEqual(skipped, [{ id: 'a', reason: 'period_closed', period: '2026-07' }]);
});

test('a PENDING entry in a closed month is skipped too', () => {
  /**
   * The half the approved rule does not cover, and the reason the closed check
   * runs first. A period cannot normally be closed while anything in it is
   * pending, so such a row means the month was reopened, something was filed,
   * and it was closed again — and that row is no more replayable than the
   * approved ones beside it.
   */
  const { replay, skipped } = planRecompute(
    [entry('a', '2026-07', 'pending_mgr')],
    { closedPeriods: ['2026-07'] },
  );
  assert.equal(replay.length, 0);
  assert.equal(skipped[0].reason, 'period_closed');
});

test('includeApproved does not open a closed month', () => {
  // The escape hatch is for restating a month HR has decided to restate. It is
  // not a way past the lock — reopening the period is.
  const { replay, skipped } = planRecompute(
    [entry('a', '2026-07', 'approved')],
    { includeApproved: true, closedPeriods: ['2026-07'] },
  );
  assert.equal(replay.length, 0);
  assert.equal(skipped[0].reason, 'period_closed', 'includeApproved walked through a closed month');
});

test('closed beats approved when a row is both', () => {
  // One reason per row, and it should be the one that tells the reader what to
  // do — reopen the period, not press the escape hatch.
  const { skipped } = planRecompute(
    [entry('a', '2026-07', 'approved')],
    { closedPeriods: ['2026-07'] },
  );
  assert.equal(skipped[0].reason, 'period_closed');
});

test('the run names the months it left alone, rather than burying them in a count', () => {
  /**
   * "42 scanned, 30 replayed, 12 skipped" over a closed month reads as an
   * ordinary run with some approved rows in it. The months are the part
   * somebody has to act on: if those figures were meant to move, an
   * administrator has to reopen them and run it again.
   */
  const skipped = [
    { id: 'a', reason: 'period_closed', period: '2026-07' },
    { id: 'b', reason: 'period_closed', period: '2026-06' },
    { id: 'c', reason: 'period_closed', period: '2026-07' },
    { id: 'd', reason: 'approved' },
  ];
  const summary = summariseReplay({ scanned: [1, 2, 3, 4], replay: [], skipped });

  assert.equal(summary.skipped, 4);
  assert.equal(summary.skippedClosed, 3);
  assert.deepEqual(summary.closedPeriods, ['2026-06', '2026-07'], 'deduplicated and in order');
});

test('a run that touched no closed month says so with an empty list, not a missing field', () => {
  // The screen reads this to decide whether to print the notice at all; absent
  // and empty must not be two different states it has to handle.
  const summary = summariseReplay({ scanned: [1], replay: [1], skipped: [] });
  assert.equal(summary.skippedClosed, 0);
  assert.deepEqual(summary.closedPeriods, []);
});

// ── the wiring, which the seven tests above cannot see ──────────────────────

/**
 * `planRecompute` IS ONLY THE RULE. Everything above hands it a
 * `closedPeriods` list and checks what it decides — and every one of them would
 * still pass if `recomputeEntries` stopped reading the locks and passed `[]`.
 *
 * That is not a hypothetical shape of mistake: it is the shape this feature
 * started as. Between 2026-08-14 08:13 and 08:38 the rule existed and nothing
 * called it with a real list, and the README went on saying a replay could
 * restate a closed month for eleven days afterwards because nothing anywhere
 * disagreed with it.
 *
 * A source-reading test, for the reason test/periodLockRoutes.test.js is one:
 * the read needs a database, the suite has none, and the alternative to
 * asserting the line is there is finding out from a closed month that moved.
 * Walked against a live database 2026-08-25 — a closed month came back
 * `updated: 0` with the entry's `updatedAt` and `__v` untouched.
 *
 * Run with: npm test
 */

const service = read('src/services/otService.js');

test('recomputeEntries reads the locks itself, rather than trusting its callers', () => {
  assert.match(
    service,
    /PeriodLock\.find\(\{\s*period: \{ \$in: periods \}, state: 'closed' \}/,
    'recomputeEntries no longer asks which of the months it is about to touch are closed',
  );
  assert.match(
    service,
    /planRecompute\(found, \{ includeApproved, closedPeriods \}\)/,
    'the closed months are read and then not handed to the rule that uses them',
  );
});

test('the lock is asked about the months in hand, not about every lock ever written', () => {
  // A replay over one holiday date asks about one month. Loading the whole
  // collection would work and would get slower every month the system runs.
  assert.match(service, /const periods = \[\.\.\.new Set\(found\.map\(\(e\) => e\.period\)/);
});

test('the manual route replays through the service, so the lock is not optional', () => {
  /**
   * `settings/recompute` is deliberately absent from the GUARDED list in
   * test/periodLockRoutes.test.js: it holds no `refusePeriodLock` call of its
   * own, because a replay is not one month's write — it is a filter that can
   * span any number of them, and the answer belongs per entry rather than per
   * request. What must stay true is that it goes through the service that does
   * the asking, and never writes entries itself.
   */
  const route = read('app/api/settings/recompute/route.js');
  assert.match(route, /recomputeEntries\(/, 'the manual replay no longer goes through the service');
  assert.doesNotMatch(
    route,
    /OtEntry|applyComputation|\.save\(\)/,
    'the manual replay writes entries itself, which is the eighth way into a closed month',
  );
});
