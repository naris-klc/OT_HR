/**
 * The five worked examples from requirements §4 are the acceptance criteria:
 * "If the system gets all five right, the calculation engine is correct."
 *
 * Run with: npm test
 *
 * Note on dates: the doc labels 5 Aug as a Tuesday, but it also labels 7 Aug
 * Friday, 8 Aug Saturday and 9 Aug Sunday — which makes 5 Aug a Wednesday.
 * August 2026 matches every label except that one, and the prototype's sample
 * data is August 2026, so these tests use 2026. Either way 5 Aug is a weekday,
 * so example A's expected result is unaffected.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUCKETS,
  computeSession,
  makeIsHoliday,
  resolveDayTypes,
  sessionDates,
  summariseEntries,
  hrSummary,
  capUsage,
  OtValidationError,
} from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';

/** Primus keeps its own calendar; 12 Aug 2026 (Mother's Day) stands in here. */
const HOLIDAYS = ['2026-08-12'];
const isHoliday = makeIsHoliday(HOLIDAYS);

/**
 * The engine takes day types resolved by its caller, so the tests resolve them
 * the same way `otService.contextFor` does. No birthDate here on purpose: these
 * are the §4 worked examples, and they are the same for everybody. The birthday
 * rule has its own file, test/otBirthday.test.js.
 */
const run = (session, policy) => computeSession(session, {
  policy,
  dayTypes: resolveDayTypes(sessionDates(session), { isHoliday, policy }),
});

// ── §4 worked examples ──────────────────────────────────────────────────────

test('A — Wed 5 Aug, 17:30–21:00 → 3.5 h @ ×1.5 weekday', () => {
  const r = run({ workDate: '2026-08-05', startTime: '17:30', endTime: '21:00' });
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 3.5);
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 0);
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 0);
  assert.equal(r.totals.otHours, 3.5);
  assert.equal(r.breakMinutes, 0, 'does not cross 12:00–13:00, so no deduction');
});

test('B — Sat 8 Aug, 08:00–17:00, break taken → 8 h @ ×1.5 holiday', () => {
  const r = run({ workDate: '2026-08-08', startTime: '08:00', endTime: '17:00' });
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 8);
  assert.equal(r.totals.otHours, 8);
  assert.equal(r.breakMinutes, 60);
});

test('C — Sat 8 Aug, 08:00–17:00, ไม่พักเที่ยง ticked → 9 h @ ×1.5 holiday', () => {
  const r = run({ workDate: '2026-08-08', startTime: '08:00', endTime: '17:00', noBreakTaken: true });
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 9);
  assert.equal(r.totals.otHours, 9);
  assert.equal(r.breakMinutes, 0);
});

test('D — Fri 7 Aug 17:00 → Sat 8 Aug 07:00 → 7 h ×1.5 + 7 h ×3', () => {
  const r = run({
    workDate: '2026-08-07', startTime: '17:00', endTime: '07:00', endsNextDay: true,
  });
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 7, 'Fri 17:00–24:00');
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 7, 'Sat 00:00–07:00');
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 0);
  assert.equal(r.totals.otHours, 14);
  assert.equal(r.breakMinutes, 0, 'overnight session crosses no lunch window — settles [OPEN 2]');
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[0].date, '2026-08-07');
  assert.equal(r.segments[1].date, '2026-08-08');
});

test('E — Sun 9 Aug, 06:00–10:00 → 2 h ×3 + 2 h ×1.5', () => {
  const r = run({ workDate: '2026-08-09', startTime: '06:00', endTime: '10:00' });
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 2, '06:00–08:00 outside core hours');
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 2, '08:00–10:00 inside core hours');
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 0);
  assert.equal(r.totals.otHours, 4);
});

// ── day types ───────────────────────────────────────────────────────────────

test('a public holiday on a weekday uses the holiday buckets', () => {
  // 12 Aug 2026 is a Wednesday and on the company calendar.
  const r = run({ workDate: '2026-08-12', startTime: '08:00', endTime: '17:00', noBreakTaken: true });
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 9);
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 0);
  assert.equal(r.segments[0].dayType, 'holiday');
});

test('weekday core hours are not OT at all', () => {
  const r = run({ workDate: '2026-08-05', startTime: '09:00', endTime: '17:00', noBreakTaken: true });
  assert.equal(r.totals.otHours, 0);
  assert.equal(r.warnings[0].code, 'NORMAL_HOURS_IGNORED');
});

test('early weekday start before 08:00 counts as OT (§5)', () => {
  const r = run({ workDate: '2026-08-05', startTime: '05:30', endTime: '08:00' });
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 2.5);
});

test('a weekday session that straddles core hours splits correctly', () => {
  // 06:00–19:00 on a Wednesday: 2 h before, 9 h normal (ignored), 2 h after.
  const r = run({ workDate: '2026-08-05', startTime: '06:00', endTime: '19:00', noBreakTaken: true });
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 4);
  assert.equal(r.segments.length, 2);
  assert.equal(r.warnings[0].minutes, 9 * 60);
});

test('Sunday 22:00 → Monday 06:00 splits ×3 holiday / ×1.5 weekday', () => {
  const r = run({
    workDate: '2026-08-09', startTime: '22:00', endTime: '06:00', endsNextDay: true,
  });
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 2, 'Sun 22:00–24:00');
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 6, 'Mon 00:00–06:00');
});

// ── [OPEN 5] the 17:00 vs 17:01 boundary ────────────────────────────────────

test('[OPEN 5] 17:00–20:00 counts a clean 3 hours', () => {
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '20:00' });
  assert.equal(r.totals.otHours, 3);
});

// ── [OPEN 3] rounding ───────────────────────────────────────────────────────

test('[OPEN 3] floor (default): 17:00–20:20 → 3.0 h', () => {
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '20:20' });
  assert.equal(r.totals.otHours, 3);
});

test('[OPEN 3] ceil: 17:00–20:20 → 3.5 h', () => {
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '20:20' }, { roundingMode: 'ceil' });
  assert.equal(r.totals.otHours, 3.5);
});

test('[OPEN 3] nearest: 17:00–20:20 → 3.5 h, 17:00–20:10 → 3.0 h', () => {
  const p = { roundingMode: 'nearest' };
  assert.equal(run({ workDate: '2026-08-05', startTime: '17:00', endTime: '20:20' }, p).totals.otHours, 3.5);
  assert.equal(run({ workDate: '2026-08-05', startTime: '17:00', endTime: '20:10' }, p).totals.otHours, 3);
});

test('[OPEN 3] bucket scope keeps the three columns summing to the total', () => {
  const r = run({ workDate: '2026-08-09', startTime: '06:20', endTime: '10:40' });
  const sum = r.buckets[BUCKETS.OT15_WEEKDAY] + r.buckets[BUCKETS.OT15_HOLIDAY] + r.buckets[BUCKETS.OT3_HOLIDAY];
  assert.equal(sum, r.totals.otHours);
});

// ── [OPEN 4] the 1-hour minimum ─────────────────────────────────────────────

test('[OPEN 4] raise (default): a 20-minute session becomes 1 h', () => {
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '17:20' });
  assert.equal(r.totals.otHours, 1);
  assert.ok(r.warnings.some((w) => w.code === 'RAISED_TO_MINIMUM'));
});

test('[OPEN 4] reject: a 20-minute session is refused', () => {
  assert.throws(
    () => run({ workDate: '2026-08-05', startTime: '17:00', endTime: '17:20' }, { belowMinimum: 'reject' }),
    (e) => e instanceof OtValidationError && e.code === 'BELOW_MINIMUM',
  );
});

// ── [OPEN 1 / 2] break modes ────────────────────────────────────────────────

test('[OPEN 1] threshold mode would wrongly deduct from example D', () => {
  const r = run(
    { workDate: '2026-08-07', startTime: '17:00', endTime: '07:00', endsNextDay: true },
    { breakMode: 'threshold', breakThresholdHours: 5 },
  );
  assert.equal(r.totals.otHours, 13, 'this is why lunchWindow is the default — the doc says D is 14');
});

test('[OPEN 1] always mode deducts a flat hour even from a short session', () => {
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '19:00' }, { breakMode: 'always' });
  assert.equal(r.totals.otHours, 1);
});

test('[OPEN 1] none mode never deducts', () => {
  const r = run({ workDate: '2026-08-08', startTime: '08:00', endTime: '17:00' }, { breakMode: 'none' });
  assert.equal(r.totals.otHours, 9);
});

// Crossing two lunch windows takes a session of nearly 24 hours, which is the
// engine's ceiling — Sat 12:30 → Sun 12:30 is exactly 24 h and clips 30 min off
// each day's 12:00–13:00.
test('[OPEN 2] a session spanning two lunch windows deducts from both by default', () => {
  const r = run({ workDate: '2026-08-08', startTime: '12:30', endTime: '12:30', endsNextDay: true });
  assert.equal(r.breakMinutes, 60, '30 min on Saturday + 30 min on Sunday');
  assert.equal(r.totals.otHours, 23, '24 clock hours − 1 h of break');
});

test('[OPEN 2] breakPerCalendarDay=false caps it at one deduction', () => {
  const r = run(
    { workDate: '2026-08-08', startTime: '12:30', endTime: '12:30', endsNextDay: true },
    { breakPerCalendarDay: false },
  );
  assert.equal(r.breakMinutes, 30, 'only Saturday’s window');
  assert.equal(r.totals.otHours, 23.5);
});

test('the break lands in the bucket that actually contains 12:00–13:00', () => {
  // Sun 11:00–14:00: all holiday core hours, so the whole deduction is ×1.5.
  const r = run({ workDate: '2026-08-09', startTime: '11:00', endTime: '14:00' });
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 2);
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 0);
  assert.equal(r.segments.length, 2, 'split around the lunch hole');
});

// ── validation ──────────────────────────────────────────────────────────────

test('end before start without endsNextDay is refused', () => {
  assert.throws(
    () => run({ workDate: '2026-08-05', startTime: '20:00', endTime: '17:00' }),
    (e) => e.code === 'END_BEFORE_START',
  );
});

test('§5 — there is no evening ceiling', () => {
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '23:30' });
  assert.equal(r.totals.otHours, 6.5);
  assert.equal(r.warnings.length, 0);
});

test('a session longer than 24 hours is refused', () => {
  // 06:00 → 07:00 next day is 25 hours.
  assert.throws(
    () => run({ workDate: '2026-08-08', startTime: '06:00', endTime: '07:00', endsNextDay: true }),
    (e) => e.code === 'TOO_LONG',
  );
});

// ── monthly rollup, HR summary, caps ────────────────────────────────────────

test('monthly rollup totals each column separately', () => {
  const entries = [
    run({ workDate: '2026-08-05', startTime: '17:30', endTime: '21:00' }),           // 3.5 ×1.5 wd
    run({ workDate: '2026-08-08', startTime: '08:00', endTime: '17:00' }),           // 8   ×1.5 hd
    run({ workDate: '2026-08-09', startTime: '06:00', endTime: '10:00' }),           // 2 ×3 + 2 ×1.5 hd
  ];
  const s = summariseEntries(entries);
  assert.equal(s.buckets[BUCKETS.OT15_WEEKDAY], 3.5);
  assert.equal(s.buckets[BUCKETS.OT15_HOLIDAY], 10);
  assert.equal(s.buckets[BUCKETS.OT3_HOLIDAY], 2);
  assert.equal(s.ot15Hours, 13.5);
  assert.equal(s.ot3Hours, 2);
  assert.equal(s.otHours, 15.5);
  assert.equal(s.weightedHours, 26.25);
});

test('[OPEN 12] HR summary boxes: raw vs multiplied', () => {
  const s = summariseEntries([run({ workDate: '2026-08-09', startTime: '06:00', endTime: '10:00' })]);
  // Sunday 06:00–10:00: 06:00–08:00 is ×3, 08:00–10:00 is ×1.5 holiday — so the
  // ×1.5 box's วันปกติ half is empty and its วันหยุด half carries the two hours.
  assert.deepEqual(
    hrSummary(s, DEFAULT_POLICY),
    { ot15Weekday: 0, ot15Holiday: 2, ot15: 2, ot3: 2, total: 4, basis: 'raw' },
  );
  assert.deepEqual(
    hrSummary(s, { ...DEFAULT_POLICY, hrSummaryBasis: 'multiplied' }),
    { ot15Weekday: 0, ot15Holiday: 3, ot15: 3, ot3: 6, total: 9, basis: 'multiplied' },
  );
});

test('[OPEN 9] cap basis: example D counts 14 clock hours or 31.5 weighted', () => {
  const s = summariseEntries([
    run({ workDate: '2026-08-07', startTime: '17:00', endTime: '07:00', endsNextDay: true }),
  ]);
  assert.equal(capUsage(s, DEFAULT_POLICY), 14);
  assert.equal(capUsage(s, { ...DEFAULT_POLICY, capBasis: 'weighted' }), 31.5);
});
