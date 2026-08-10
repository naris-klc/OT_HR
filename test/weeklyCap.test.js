import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAP_STATUSES,
  capBreaches,
  capHoursFrom,
  countsTowardCap,
  describeBreaches,
  usageByWeek,
  weekEndOf,
  weekLabel,
  weekStartOf,
  weeksOfEntry,
} from '../lib/caps.js';
import { ARITHMETIC_KEYS, COSMETIC_KEYS } from '../lib/policyVersion.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';

/**
 * The weekly department ceiling, as arithmetic over data.
 *
 * Every case below is one the requirements named, and every one of them is a
 * question about which pile an hour lands in — not about mongoose. The service
 * layer supplies each window's numbers; what those numbers mean is here.
 */

// ── the week boundary ───────────────────────────────────────────────────────

/**
 * 2026-08-03 is a Monday. The week it opens runs to Sunday the 9th, and the
 * 10th starts a new one — the boundary tested from both sides, because an
 * off-by-one here silently merges two weeks or splits one.
 */
test('a Monday–Sunday week opens on Monday and closes on Sunday', () => {
  assert.equal(weekStartOf('2026-08-03', 1), '2026-08-03'); // Mon — itself
  assert.equal(weekStartOf('2026-08-06', 1), '2026-08-03'); // Thu
  assert.equal(weekStartOf('2026-08-09', 1), '2026-08-03'); // Sun — still in
  assert.equal(weekStartOf('2026-08-10', 1), '2026-08-10'); // Mon — next week
  assert.equal(weekEndOf('2026-08-06', 1), '2026-08-09');
});

test('the boundary moves with the policy — it is not a constant', () => {
  // The same Sunday: the last day of its week under Monday-start, the first
  // day of a new one under Sunday-start.
  assert.equal(weekStartOf('2026-08-09', 1), '2026-08-03');
  assert.equal(weekStartOf('2026-08-09', 0), '2026-08-09');
  assert.equal(weekStartOf('2026-08-09', 6), '2026-08-08'); // Saturday-start
});

test('every day of a week resolves to the same week start', () => {
  const starts = new Set();
  for (let d = 3; d <= 9; d++) {
    starts.add(weekStartOf(`2026-08-0${d}`, 1));
  }
  assert.deepEqual([...starts], ['2026-08-03']);
});

test('a week may straddle a month, and the month does not cut it', () => {
  // Mon 30 Nov 2026 → Sun 6 Dec 2026. Two periods, one week.
  assert.equal(weekStartOf('2026-11-30', 1), '2026-11-30');
  assert.equal(weekStartOf('2026-12-03', 1), '2026-11-30');
  assert.equal(weekEndOf('2026-11-30', 1), '2026-12-06');
});

test('a nonsense week start falls back to Monday rather than to no week at all', () => {
  for (const bad of [null, undefined, 7, -1, 'monday', NaN]) {
    assert.equal(weekStartOf('2026-08-06', bad), '2026-08-03', String(bad));
  }
});

// ── a session crossing Sunday into Monday ───────────────────────────────────

/**
 * THE case the whole segment-based approach exists for.
 *
 * A shift filed against Sunday 9 August, running 22:00 → 02:00. The engine has
 * already cut it at midnight: two hours dated the 9th, two dated the 10th.
 * Under a Monday–Sunday week those two dates are in DIFFERENT weeks, and the
 * hours have to follow their own dates.
 */
const overnightAcrossWeeks = {
  workDate: '2026-08-09',
  totals: { otHours: 4, weightedHours: 8 },
  segments: [
    { date: '2026-08-09', hours: 2, minutes: 120, bucket: 'ot3_holiday', multiplier: 3 },
    { date: '2026-08-10', hours: 2, minutes: 120, bucket: 'ot15_weekday', multiplier: 1.5 },
  ],
};

test('a session crossing Sunday into Monday is split between the two weeks', () => {
  const weeks = weeksOfEntry(overnightAcrossWeeks, { weekStartsOn: 1 });

  assert.deepEqual([...weeks.entries()].sort(), [
    ['2026-08-03', 2],   // the Sunday half — the week that is closing
    ['2026-08-10', 2],   // the Monday half — the week that just opened
  ]);
});

test('the whole entry is NOT thrown into the week its workDate falls in', () => {
  const weeks = weeksOfEntry(overnightAcrossWeeks, { weekStartsOn: 1 });
  assert.notEqual(weeks.get('2026-08-03'), 4, 'the closing week absorbed the whole shift');
  assert.equal(weeks.size, 2);
});

test('the same shift is one week when the boundary moves to Sunday', () => {
  // Sunday-start: the 9th and the 10th are both in the week opening on the 9th.
  const weeks = weeksOfEntry(overnightAcrossWeeks, { weekStartsOn: 0 });
  assert.deepEqual([...weeks.entries()], [['2026-08-09', 4]]);
});

test('an ordinary same-day session lands wholly in one week', () => {
  const weeks = weeksOfEntry({
    workDate: '2026-08-06',
    totals: { otHours: 3 },
    segments: [{ date: '2026-08-06', hours: 3, minutes: 180, bucket: 'ot15_weekday', multiplier: 1.5 }],
  }, { weekStartsOn: 1 });
  assert.deepEqual([...weeks.entries()], [['2026-08-03', 3]]);
});

// ── clock hours, not weighted ───────────────────────────────────────────────

test('the weekly count is clock hours — the multiplier does not inflate it', () => {
  // 2 h at ×3 and 2 h at ×1.5 is 4 clock hours against the ceiling, not 9.
  const clock = weeksOfEntry(overnightAcrossWeeks, { weekStartsOn: 0, basis: 'clock' });
  assert.equal(clock.get('2026-08-09'), 4);
});

test('weighted basis is available and counts the same hours at their rate', () => {
  // The ceiling follows policy.capBasis exactly as the monthly one does, so the
  // two windows can never be counting different things. Default is 'clock'.
  assert.equal(DEFAULT_POLICY.capBasis, 'clock');
  const weighted = weeksOfEntry(overnightAcrossWeeks, { weekStartsOn: 0, basis: 'weighted' });
  assert.equal(weighted.get('2026-08-09'), 2 * 3 + 2 * 1.5);
});

// ── accumulating a week ─────────────────────────────────────────────────────

const entry = (date, hours, over = {}) => ({
  workDate: date,
  status: 'approved',
  totals: { otHours: hours, weightedHours: hours * 1.5 },
  segments: [{ date, hours, minutes: hours * 60, bucket: 'ot15_weekday', multiplier: 1.5 }],
  ...over,
});

test('a week adds up the entries that fall in it and ignores the ones that do not', () => {
  const used = usageByWeek([
    entry('2026-08-03', 3),   // Mon — week of the 3rd
    entry('2026-08-07', 4),   // Fri — week of the 3rd
    entry('2026-08-11', 5),   // Tue — week of the 10th
  ], { weekStartsOn: 1 });

  assert.equal(used.get('2026-08-03'), 7);
  assert.equal(used.get('2026-08-10'), 5);
});

test('an entry with no segments still lands somewhere rather than vanishing', () => {
  // Written before segments were stored, or read without selecting them. Its
  // total goes to the week of its workDate — wrong only for an overnight
  // session, and wrong in the direction that keeps the hours on the books.
  const used = usageByWeek([
    { workDate: '2026-08-06', status: 'approved', totals: { otHours: 6 } },
  ], { weekStartsOn: 1 });
  assert.equal(used.get('2026-08-03'), 6);
});

// ── blank means unlimited, and 0 does not ───────────────────────────────────

test('a blank ceiling is no ceiling — not a ceiling of zero', () => {
  const breaches = capBreaches([
    { scope: 'week', capHours: null, usedHoursBefore: 40, adding: 20 },
    { scope: 'month', capHours: null, usedHoursBefore: 900, adding: 100 },
  ]);
  assert.deepEqual(breaches, []);
});

test('a ceiling of zero is a real ceiling and every hour breaches it', () => {
  // The distinction that `if (!capHours)` would destroy, turning the strictest
  // setting in the system into the loosest.
  const breaches = capBreaches([{ scope: 'week', capHours: 0, usedHoursBefore: 0, adding: 0.5 }]);
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].overBy, 0.5);
});

test('blank input becomes null, and typed zero stays zero', () => {
  assert.equal(capHoursFrom(''), null);
  assert.equal(capHoursFrom(null), null);
  assert.equal(capHoursFrom(undefined), null);
  assert.equal(capHoursFrom(0), 0);
  assert.equal(capHoursFrom('0'), 0);
  assert.equal(capHoursFrom('12.5'), 12.5);
});

test('an unparseable ceiling is no ceiling, never NaN', () => {
  // NaN compares false against everything: a cap of NaN would read as "set" on
  // the settings screen and silently stop capping anybody.
  assert.equal(capHoursFrom('abc'), null);
  assert.equal(capHoursFrom(-5), null);
});

test('sitting exactly on the ceiling is not over it', () => {
  assert.deepEqual(capBreaches([{ scope: 'week', capHours: 12, usedHoursBefore: 9, adding: 3 }]), []);
  assert.equal(capBreaches([{ scope: 'week', capHours: 12, usedHoursBefore: 9, adding: 3.5 }]).length, 1);
});

// ── both ceilings at once ───────────────────────────────────────────────────

test('hitting the weekly and the monthly ceiling reports BOTH, not the first', () => {
  const breaches = capBreaches([
    { scope: 'month', label: '2026-08', capHours: 40, usedHoursBefore: 38, adding: 6 },
    { scope: 'week', label: '2026-08-03 – 2026-08-09', capHours: 12, usedHoursBefore: 10, adding: 6 },
  ]);

  assert.equal(breaches.length, 2);
  assert.deepEqual(breaches.map((b) => b.scope), ['month', 'week']);
  assert.equal(breaches.find((b) => b.scope === 'month').overBy, 4);
  assert.equal(breaches.find((b) => b.scope === 'week').overBy, 4);
});

test('over the week but inside the month reports the week alone', () => {
  const breaches = capBreaches([
    { scope: 'month', capHours: 40, usedHoursBefore: 5, adding: 6 },
    { scope: 'week', capHours: 8, usedHoursBefore: 5, adding: 6 },
  ]);
  assert.deepEqual(breaches.map((b) => b.scope), ['week']);
});

test('over the month but inside the week reports the month alone', () => {
  const breaches = capBreaches([
    { scope: 'month', capHours: 40, usedHoursBefore: 39, adding: 6 },
    { scope: 'week', capHours: 20, usedHoursBefore: 5, adding: 6 },
  ]);
  assert.deepEqual(breaches.map((b) => b.scope), ['month']);
});

/**
 * A shift crossing the week boundary is measured against BOTH weeks it touches,
 * each against that week's own accumulated hours — so it can be clear in the
 * week it started and over the ceiling in the week it finished.
 */
test('an overnight shift can breach only the week it ends in', () => {
  const perWeek = weeksOfEntry(overnightAcrossWeeks, { weekStartsOn: 1 });
  const breaches = capBreaches([
    { scope: 'week', label: weekLabel('2026-08-03', 1), capHours: 12, usedHoursBefore: 2, adding: perWeek.get('2026-08-03') },
    { scope: 'week', label: weekLabel('2026-08-10', 1), capHours: 12, usedHoursBefore: 11, adding: perWeek.get('2026-08-10') },
  ]);

  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].label, '2026-08-10 – 2026-08-16');
  assert.equal(breaches[0].overBy, 1);
});

// ── the screens say both, too ───────────────────────────────────────────────

test('a flagged entry describes every ceiling it passed', () => {
  const lines = describeBreaches({
    capExceeded: true,
    capSnapshot: {
      capHours: 40,
      breaches: [
        { scope: 'month', label: '2026-08', capHours: 40, usedHoursBefore: 38, overBy: 4 },
        { scope: 'week', label: '2026-08-03 – 2026-08-09', capHours: 12, usedHoursBefore: 10, overBy: 4 },
      ],
    },
  });

  assert.equal(lines.length, 2);
  assert.match(lines[0].text, /รายเดือน/);
  assert.match(lines[1].text, /รายสัปดาห์/);
  assert.match(lines[1].text, /2026-08-03 – 2026-08-09/);
});

test('a row written before the weekly cap existed still reads as a monthly breach', () => {
  // No `breaches` array. Absent is "not recorded", and for these rows the
  // monthly snapshot IS the whole story — the weekly ceiling did not exist.
  const lines = describeBreaches({
    capExceeded: true,
    capSnapshot: { capHours: 40, usedHoursBefore: 38, basis: 'clock' },
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].scope, 'month');
  assert.match(lines[0].text, /40/);
});

test('an entry inside every ceiling describes nothing', () => {
  assert.deepEqual(describeBreaches({ capExceeded: false, capSnapshot: { capHours: 40 } }), []);
  assert.deepEqual(describeBreaches(null), []);
});

// ── cancelled eats no quota, in either window ───────────────────────────────

test('a cancelled request counts against neither ceiling', () => {
  assert.equal(countsTowardCap({ status: 'cancelled' }), false);
  assert.ok(!CAP_STATUSES.includes('cancelled'));
});

test('a rejected request counts against neither ceiling either', () => {
  assert.equal(countsTowardCap({ status: 'rejected' }), false);
  assert.ok(!CAP_STATUSES.includes('rejected'));
});

test('every live status counts', () => {
  for (const status of ['pending_mgr', 'pending_hr', 'approved']) {
    assert.equal(countsTowardCap({ status }), true, status);
  }
});

/**
 * The rule stated as the query states it: withdrawing a request gives the hours
 * back, in the week and in the month alike.
 *
 * Written over `usageByWeek` rather than over the status list alone because the
 * list is only half the guarantee — a window that summed its entries before
 * filtering them would pass the test above and still charge the cancelled hours.
 */
test('withdrawing a request returns its hours to both windows', () => {
  const all = [
    entry('2026-08-03', 4),
    entry('2026-08-04', 4, { status: 'cancelled' }),
    entry('2026-08-05', 4),
  ];
  const live = all.filter(countsTowardCap);

  const used = usageByWeek(live, { weekStartsOn: 1 });
  assert.equal(used.get('2026-08-03'), 8, 'the cancelled request still ate into the week');

  // And the same set under a 10-hour weekly ceiling: clear with the
  // cancellation honoured, breached without it.
  assert.deepEqual(
    capBreaches([{ scope: 'week', capHours: 10, usedHoursBefore: used.get('2026-08-03'), adding: 0 }]),
    [],
  );
  const ignoringCancellation = usageByWeek(all, { weekStartsOn: 1 });
  assert.equal(
    capBreaches([{ scope: 'week', capHours: 10, usedHoursBefore: ignoringCancellation.get('2026-08-03'), adding: 0 }]).length,
    1,
  );
});

test('a cancelled request holds no place in the month either', () => {
  // The monthly window filters on the same list, which is why it is named once.
  const live = [entry('2026-08-03', 20), entry('2026-08-10', 20, { status: 'cancelled' })]
    .filter(countsTowardCap);
  const total = live.reduce((n, e) => n + e.totals.otHours, 0);
  assert.equal(total, 20);
  assert.deepEqual(capBreaches([{ scope: 'month', capHours: 40, usedHoursBefore: total, adding: 10 }]), []);
});

// ── the policy key is classified, and classified as cosmetic ────────────────

test('weekStartsOn is a recorded policy answer, not a loose constant', () => {
  assert.equal(DEFAULT_POLICY.weekStartsOn, 1, 'Monday–Sunday is the default');
});

/**
 * COSMETIC, and this is the test that says why in a way that survives someone
 * disagreeing with the comment: the classification is consulted for exactly one
 * decision — whether a save replays stored figures — and moving the week
 * boundary moves no stored figure. Nothing in `weeksOfEntry` writes; it groups
 * segments that were computed before it ran.
 */
test('the week boundary is cosmetic: it regroups hours, it does not recompute them', () => {
  assert.ok(COSMETIC_KEYS.includes('weekStartsOn'));
  assert.ok(!ARITHMETIC_KEYS.includes('weekStartsOn'));

  // The proof of the claim, not just the label: the same entry under two
  // different boundaries yields the same hours, only filed under other keys.
  const monday = weeksOfEntry(overnightAcrossWeeks, { weekStartsOn: 1 });
  const sunday = weeksOfEntry(overnightAcrossWeeks, { weekStartsOn: 0 });

  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  assert.equal(sum(monday), sum(sunday));
  assert.equal(sum(monday), overnightAcrossWeeks.totals.otHours);
  assert.notDeepEqual([...monday.keys()], [...sunday.keys()]);
});

test('weekendDays stays arithmetic — the two week flags are not the same kind', () => {
  // weekendDays decides which days are วันหยุด and therefore which bucket an
  // hour is paid at. weekStartsOn decides nothing about any day's type.
  assert.ok(ARITHMETIC_KEYS.includes('weekendDays'));
  assert.ok(!COSMETIC_KEYS.includes('weekendDays'));
});
