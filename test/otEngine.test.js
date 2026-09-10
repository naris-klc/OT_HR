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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

/**
 * EXAMPLE D WAS THE OVERNIGHT ONE — Fri 7 Aug 17:00 → Sat 8 Aug 07:00, seven
 * hours ×1.5 on the Friday and seven ×3 on the Saturday, fourteen in total. It
 * cannot be filed at all since 2026-09-10, and this is what is left of it: the
 * refusal, on the exact pair of times the example used.
 *
 * The session that replaced it in the tests below is `D2` — Sat 8 Aug
 * 06:00–17:00 — which is the same SHAPE inside one date: it starts outside core
 * hours, crosses 08:00, and therefore lands in two rate columns.
 */
test('D — the overnight example is refused, on its own two times', () => {
  assert.throws(
    () => run({ workDate: '2026-08-07', startTime: '17:00', endTime: '07:00' }),
    (e) => e.code === 'END_BEFORE_START',
  );
});

test('D2 — Sat 8 Aug 06:00–17:00 → 2 h ×3 + 8 h ×1.5, one lunch hour out', () => {
  const r = run({ workDate: '2026-08-08', startTime: '06:00', endTime: '17:00' });
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 2, 'Sat 06:00–08:00, outside core hours');
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 8, 'Sat 08:00–17:00 less the lunch hour');
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 0);
  assert.equal(r.totals.otHours, 10);
  assert.equal(r.breakMinutes, 60, 'it crosses 12:00–13:00, which the overnight D never did');
  assert.equal(r.segments.every((s) => s.date === '2026-08-08'), true, 'one date, always');
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

/**
 * IT SPLIT ×3 HOLIDAY / ×1.5 WEEKDAY ACROSS A MIDNIGHT — Sun 22:00 → Mon 06:00,
 * two hours on the Sunday and six on the Monday. That was the clearest case for
 * the day type changing under a running session, and it is exactly what stopped
 * being possible on 2026-09-10.
 *
 * Somebody who works it now files two requests, and this is what the two of them
 * come to: the same eight hours, in the same two columns, on the two dates that
 * absorbed them.
 */
test('Sunday night into Monday is two requests, and they land in the same two columns', () => {
  const sunday = run({ workDate: '2026-08-09', startTime: '22:00', endTime: '23:59' });
  const monday = run({ workDate: '2026-08-10', startTime: '00:01', endTime: '06:00' });
  assert.equal(sunday.buckets[BUCKETS.OT3_HOLIDAY], 1.5, 'Sun 22:00–23:59, floored to 30 min');
  assert.equal(monday.buckets[BUCKETS.OT15_WEEKDAY], 5.5, 'Mon 00:01–06:00, floored to 30 min');
});

test('the one request that spans them is refused', () => {
  assert.throws(
    () => run({ workDate: '2026-08-09', startTime: '22:00', endTime: '06:00' }),
    (e) => e.code === 'END_BEFORE_START',
  );
});

// ── [OPEN 5] the 17:00 vs 17:01 boundary ────────────────────────────────────

test('[OPEN 5] 17:00–20:00 counts a clean 3 hours', () => {
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '20:00' });
  assert.equal(r.totals.otHours, 3);
});

/**
 * The other answer, which the engine ignored until 2026-08-13: the flag was on
 * the settings screen and in ARITHMETIC_KEYS, so choosing 17:01 minted a policy
 * version and replayed the month — and every figure came back identical, since
 * `bucketFor` read `coreEndMinute` directly and never learned the boundary had
 * moved. A replay that moves nothing is worse than none: it tells HR the answer
 * took effect.
 *
 * Rounding is switched off in these (`roundingIncrementMinutes: 0`) so the
 * assertions are about the boundary and not about [OPEN 3] — at the shipped
 * 30-minute floor the missing minute costs a whole half hour, which is true and
 * is the reason 17:00 is the default, but it hides what is being tested.
 */
const EXACT = { otStartsAtCoreEnd: false, roundingIncrementMinutes: 0 };

test('[OPEN 5] otStartsAtCoreEnd=false: 17:00–20:00 counts 2 h 59 m', () => {
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '20:00' }, EXACT);
  assert.equal(r.totals.otHours, 2.98, '179 minutes');
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 2.98);
  assert.equal(r.segments[0].start, '17:01', 'the OT row starts where OT starts');
  assert.equal(r.warnings[0].code, 'NORMAL_HOURS_IGNORED', 'the odd minute is normal time');
  assert.equal(r.warnings[0].minutes, 1);
  assert.match(r.warnings[0].message, /08:00–17:01/, 'the warning names the boundary in force');
});

test('[OPEN 5] otStartsAtCoreEnd=true is unchanged by the same setup', () => {
  const r = run(
    { workDate: '2026-08-05', startTime: '17:00', endTime: '20:00' },
    { ...EXACT, otStartsAtCoreEnd: true },
  );
  assert.equal(r.totals.otHours, 3);
  assert.equal(r.warnings.length, 0);
});

test('[OPEN 5] the ×3 holiday boundary moves with it — one question, one answer', () => {
  // Sat 8 Aug. There are no normal working hours on a holiday, so the minute
  // does not vanish: it stays in the ×1.5 column the form heads "8.00–17.00".
  const r = run({ workDate: '2026-08-08', startTime: '17:00', endTime: '20:00' }, EXACT);
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 0.02, '17:00–17:01');
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 2.98, '17:01–20:00');
  assert.equal(r.totals.otHours, 3, 'nothing is lost on a holiday — only re-columned');
  assert.equal(r.warnings.length, 0);
});

test('[OPEN 5] does not move the morning boundary', () => {
  // "OT starts at 17:01" is an answer about the evening. OT worked before the
  // shift still runs up to 08:00 exactly, under either answer.
  const r = run({ workDate: '2026-08-05', startTime: '05:30', endTime: '08:00' }, EXACT);
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 2.5);
  assert.equal(r.warnings.length, 0, 'nothing fell into normal hours');
});

test('[OPEN 5] a session ending at the boundary is all normal hours', () => {
  // 16:00–17:01 on a Wednesday: OT starts at 17:01, so nothing here is OT.
  const r = run({ workDate: '2026-08-05', startTime: '16:00', endTime: '17:01', noBreakTaken: true }, EXACT);
  assert.equal(r.totals.otHours, 0);
  assert.equal(r.warnings[0].minutes, 61);
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

test('[OPEN 3] the block is configurable: 17:00–20:20 under 5 / 15 / 60 minutes', () => {
  const at = (roundingIncrementMinutes) => run(
    { workDate: '2026-08-05', startTime: '17:00', endTime: '20:20' },
    { roundingIncrementMinutes },
  ).totals.otHours;

  assert.equal(at(5), 3.33, '200 minutes floors to 200');
  assert.equal(at(15), 3.25, '…to 195');
  assert.equal(at(60), 3, '…to 180');
});

/**
 * ผ่อนปรนการปัดขึ้น — the block stays 30, but the last few minutes of it round
 * up instead of down. Asked for on 2026-09-02 in the words "บวกลบ 5 หรือ 10 และ
 * 15 นาที", with these two as the worked examples.
 */
test('[OPEN 3] ผ่อนปรน 5: 29 นาที → 0.5 ชม. และ 55 นาที → 1 ชม.', () => {
  const p = { roundingGraceMinutes: 5, belowMinimum: 'accept' };
  const at = (endTime) => run({ workDate: '2026-08-05', startTime: '17:00', endTime }, p).totals.otHours;

  assert.equal(at('17:29'), 0.5, '29 minutes is within 5 of the block, so it gets the block');
  assert.equal(at('17:55'), 1, '55 → 60');
  assert.equal(at('17:25'), 0.5, 'the window opens at 25');
  assert.equal(at('17:24'), 0, 'and not a minute before it — 24 still rounds away');
  assert.equal(at('17:49'), 0.5, 'nothing is forgiven in the middle of a block');
});

test('[OPEN 3] the three levels are three different answers to one session', () => {
  // 20 minutes: refused outright today, half an hour under ผ่อนปรน 10 or 15.
  const at = (roundingGraceMinutes) => run(
    { workDate: '2026-08-05', startTime: '17:00', endTime: '17:20' },
    { roundingGraceMinutes, belowMinimum: 'accept' },
  ).totals.otHours;

  assert.equal(at(0), 0, 'the shipped default is the plain floor, unchanged');
  assert.equal(at(5), 0, '20 is still 10 short of the window');
  assert.equal(at(10), 0.5);
  assert.equal(at(15), 0.5);
});

test('[OPEN 3] a grace of half a block IS nearest, minute for minute', () => {
  // Two ways to reach one rule, and the settings page says so. If this ever
  // stops holding, one of the two has been changed without the other.
  for (let m = 1; m <= 180; m += 1) {
    const end = `${String(17 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const entry = { workDate: '2026-08-05', startTime: '17:00', endTime: end, noBreakTaken: true };
    assert.equal(
      run(entry, { roundingGraceMinutes: 15, belowMinimum: 'accept' }).totals.otHours,
      run(entry, { roundingMode: 'nearest', belowMinimum: 'accept' }).totals.otHours,
      `${m} minutes: floor/30 grace 15 and nearest/30 disagree`,
    );
  }
});

test('[OPEN 3] ผ่อนปรน is read under floor alone, and never at the size of the block', () => {
  const at = (overrides) => run(
    { workDate: '2026-08-05', startTime: '17:00', endTime: '20:20' },
    { belowMinimum: 'accept', ...overrides },
  ).totals.otHours;

  // 200 minutes. Under floor/30 the grace of 15 lifts it to 210 (3.5 h).
  assert.equal(at({ roundingGraceMinutes: 15 }), 3.5);
  // Under the other three the key is not read, so each is exactly what it was.
  assert.equal(at({ roundingMode: 'ceil', roundingGraceMinutes: 15 }), 3.5, 'ceil was already 3.5');
  assert.equal(at({ roundingMode: 'nearest', roundingGraceMinutes: 15 }), 3.5);
  assert.equal(at({ roundingMode: 'exact', roundingGraceMinutes: 15 }), 3.33, 'exact rounds nothing');

  /**
   * A grace that is not smaller than the block is ignored rather than clamped
   * — clamping would run a rule off a dropdown nobody set it to. Under a
   * 15-minute block a 15-minute grace would hand a whole block to a session of
   * nought, so it falls back to the plain floor: 200 → 195.
   */
  assert.equal(at({ roundingIncrementMinutes: 15, roundingGraceMinutes: 15 }), 3.25);
  assert.equal(
    at({ roundingIncrementMinutes: 5, roundingGraceMinutes: 15 }), 3.33,
    'a grace three blocks wide does not hand out three blocks',
  );
  assert.equal(
    run({ workDate: '2026-08-05', startTime: '17:00', endTime: '17:01' },
      { roundingIncrementMinutes: 15, roundingGraceMinutes: 15 }).totals.otHours,
    0,
    'and a session of one minute is never given a whole block',
  );
});

test('[OPEN 3] ผ่อนปรน rounds each rate column, and the columns still sum', () => {
  // Sat 8 Aug 06:20–08:25 splits across the two holiday columns at the 08:00
  // boundary; `roundingScope: 'bucket'` rounds each one, so the grace is applied
  // per column and the three must still add up to the printed total. It read a
  // Fri 22:20 → Sat 02:25 shift until 2026-09-10, splitting at a midnight
  // instead — the boundary moved, what is being checked did not.
  const r = run(
    { workDate: '2026-08-08', startTime: '06:20', endTime: '08:25' },
    { roundingGraceMinutes: 10, belowMinimum: 'accept' },
  );
  const sum = Object.values(r.buckets).reduce((a, b) => a + b, 0);
  assert.equal(sum, r.totals.otHours, 'the columns must sum to the total, grace or no grace');
});

/**
 * The fourth answer to [OPEN 3]: no block at all.
 *
 * Distinct from `roundingIncrementMinutes: 0`, which the tests above this one
 * use to switch rounding off as a side effect. That was a behaviour; this is a
 * stated rule, and the difference shows in what it does to the increment —
 * nothing. HR's chosen block stays stored and is simply not read, so switching
 * back restores it rather than an absent value.
 */
test('[OPEN 3] exact: 17:00–20:20 keeps all 200 minutes, whatever the block says', () => {
  const r = run(
    { workDate: '2026-08-05', startTime: '17:00', endTime: '20:20' },
    { roundingMode: 'exact', roundingIncrementMinutes: 60 },
  );
  assert.equal(r.totals.otHours, 3.33, '200 minutes, unrounded');
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 3.33);
});

test('[OPEN 3] exact does not pretend a 20-minute session is a whole block', () => {
  // Under the shipped floor/30 the same session rounds away to nothing — see
  // the [OPEN 4] test that pins that. Exact is the answer that keeps it.
  const r = run(
    { workDate: '2026-08-05', startTime: '17:00', endTime: '17:20' },
    { roundingMode: 'exact' },
  );
  assert.equal(r.totals.otHours, 0.33);
  assert.equal(r.belowMinimumFlagged, true, 'still short of the 1-hour minimum, and still said so');
});

// ── เวลาขั้นต่ำในการเริ่มนับ OT — the buffer ───────────────────────────────────

test('the buffer ships off, so no stored figure moves on deploy', () => {
  assert.equal(DEFAULT_POLICY.minimumBufferMinutes, 0);
});

test('buffer: 25 minutes under a 30-minute buffer is not OT at all', () => {
  const r = run(
    { workDate: '2026-08-05', startTime: '17:00', endTime: '17:25' },
    { minimumBufferMinutes: 30 },
  );
  assert.equal(r.totals.otHours, 0);
  assert.equal(r.segments.length, 0);
  assert.equal(r.belowBufferZeroed, true);

  const cut = r.warnings.find((w) => w.code === 'BELOW_BUFFER_ZEROED');
  assert.ok(cut, 'the write paths print which rule emptied it');
  assert.equal(cut.minutes, 25, 'as worked, not as rounded');
  assert.equal(cut.bufferMinutes, 30);
});

test('buffer: 35 minutes clears it and goes on to rounding like any other session', () => {
  // HR's own example. Floor/30 is what makes it 0.5 — the buffer decides only
  // whether the session reaches the block, never what the block does with it.
  const r = run(
    { workDate: '2026-08-05', startTime: '17:00', endTime: '17:35' },
    { minimumBufferMinutes: 30 },
  );
  assert.equal(r.totals.otHours, 0.5);
  assert.equal(r.belowBufferZeroed, false);
  assert.equal(r.warnings.some((w) => w.code === 'BELOW_BUFFER_ZEROED'), false);
});

/**
 * Measured BEFORE rounding, which is the whole reason the two are ordered.
 *
 * Read after the block instead, `ceil`/30 would hand the buffer a 5-minute
 * callout as a full half hour and it would pass a 30-minute buffer — the block
 * answering the buffer's question.
 */
test('buffer: reads the minutes as worked, not what ceil would have made of them', () => {
  const r = run(
    { workDate: '2026-08-05', startTime: '17:00', endTime: '17:05' },
    { minimumBufferMinutes: 30, roundingMode: 'ceil' },
  );
  assert.equal(r.totals.otHours, 0, 'five minutes is five minutes');
  assert.equal(r.belowBufferZeroed, true);
});

/**
 * The buffer wins over the minimum, and this is the case that would otherwise
 * invert both answers at once: `raise` padding a buffered session back up to a
 * full hour.
 */
test('buffer: a zeroed session is never raised to the 1-hour minimum', () => {
  const r = run(
    { workDate: '2026-08-05', startTime: '17:00', endTime: '17:25' },
    { minimumBufferMinutes: 30, belowMinimum: 'raise' },
  );
  assert.equal(r.totals.otHours, 0);
  assert.equal(r.warnings.some((w) => w.code === 'RAISED_TO_MINIMUM'), false);
  assert.equal(r.belowMinimumFlagged, false, 'it is not short OT — it is not OT');
});

test('buffer: a zeroed session is not refused by belowMinimum reject either', () => {
  // 'reject' throws, and a session the buffer has already answered must never
  // reach it: the two rules would be refusing the same work for two reasons.
  const r = run(
    { workDate: '2026-08-05', startTime: '17:00', endTime: '17:25' },
    { minimumBufferMinutes: 30, belowMinimum: 'reject' },
  );
  assert.equal(r.totals.otHours, 0);
  assert.equal(r.belowBufferZeroed, true);
});

test('buffer: measured on the whole entry, not per rate column', () => {
  // Sat 8 Aug, 16:45–17:15 — 15 minutes either side of the ×1.5/×3 boundary.
  // Under a 20-minute buffer the entry clears it; measured per column neither
  // half would, and a Friday night running into Saturday is not two attendances.
  const r = run(
    { workDate: '2026-08-08', startTime: '16:45', endTime: '17:15' },
    { minimumBufferMinutes: 20, roundingMode: 'exact', minimumHoursScope: 'bucket' },
  );
  assert.equal(r.belowBufferZeroed, false);
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 0.25);
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 0.25);
});

test('buffer: a session that produced no OT minutes is not blamed on the buffer', () => {
  // Wednesday 09:00–10:00 is entirely inside normal hours. It never went near
  // the buffer, and the refusal has to name the boundary it did run into.
  const r = run(
    { workDate: '2026-08-05', startTime: '09:00', endTime: '10:00' },
    { minimumBufferMinutes: 30 },
  );
  assert.equal(r.totals.otHours, 0);
  assert.equal(r.belowBufferZeroed, false);
  assert.ok(r.warnings.some((w) => w.code === 'NORMAL_HOURS_IGNORED'));
});

// ── [OPEN 4] the 1-hour minimum ─────────────────────────────────────────────

// Neither `raise` nor `reject` is the shipped default — see the [OPEN 4]
// comment in src/config/policy.js — so the mode under test is stated rather
// than assumed. What each one is expected to produce has not moved.
test('[OPEN 4] raise: a 20-minute session becomes 1 h', () => {
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '17:20' }, { belowMinimum: 'raise' });
  assert.equal(r.totals.otHours, 1);
  assert.ok(r.warnings.some((w) => w.code === 'RAISED_TO_MINIMUM'));
  assert.equal(r.belowMinimumFlagged, false, 'padded up to the minimum — there is nothing short left to flag');
});

test('[OPEN 4] reject: a 20-minute session is refused', () => {
  assert.throws(
    () => run({ workDate: '2026-08-05', startTime: '17:00', endTime: '17:20' }, { belowMinimum: 'reject' }),
    (e) => e instanceof OtValidationError && e.code === 'BELOW_MINIMUM',
  );
});

test('[OPEN 4] accept is what the system ships on', () => {
  assert.equal(DEFAULT_POLICY.belowMinimum, 'accept');
});

test('[OPEN 4] accept: a 40-minute session keeps its 0.5 h and is flagged, not refused', () => {
  // The whole point of the mode: hours somebody worked are recorded rather than
  // turned away at the form while HR decides what they are worth.
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '17:40' });

  assert.equal(r.totals.otHours, 0.5, 'the hours rounding produced — not padded to 1, not zeroed');
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 0.5);
  assert.equal(r.belowMinimumFlagged, true);

  const flag = r.warnings.find((w) => w.code === 'BELOW_MINIMUM_ACCEPTED');
  assert.ok(flag, 'HR reads the warnings on the row; the boolean is what a list screen filters on');
  assert.equal(flag.minutes, 30);
  assert.equal(r.warnings.some((w) => w.code === 'RAISED_TO_MINIMUM'), false, 'accept must not pad');
});

test('[OPEN 4] accept flags nothing on an entry that clears the minimum', () => {
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '21:00' });
  assert.equal(r.totals.otHours, 4);
  assert.equal(r.belowMinimumFlagged, false);
  assert.equal(r.warnings.some((w) => w.code === 'BELOW_MINIMUM_ACCEPTED'), false);
});

/**
 * The 0-hour rule is a different rule and this change does not touch it.
 *
 * A session inside 08:00–17:00 on a working day produced no OT at all — there
 * are no hours to keep, and every write path refuses it in `noOtHoursMessage`'s
 * words. `belowMinimumFlagged` says "short", not "empty", and saying it here
 * would put the flag on entries that are not about the minimum.
 */
test('[OPEN 4] accept does not flag a session that produced no OT minutes at all', () => {
  const r = run({ workDate: '2026-08-05', startTime: '09:00', endTime: '10:00' });
  assert.equal(r.totals.otHours, 0);
  assert.equal(r.belowMinimumFlagged, false);
  assert.equal(r.warnings.some((w) => w.code === 'BELOW_MINIMUM_ACCEPTED'), false);
  assert.ok(r.warnings.some((w) => w.code === 'NORMAL_HOURS_IGNORED'));
});

/**
 * Where `accept` stops, stated rather than left to be discovered.
 *
 * [OPEN 3] floors to 30-minute increments, so a session under half an hour
 * rounds to nothing before the minimum is consulted at all. `accept` keeps what
 * rounding produced and what rounding produced is nought, so such a session is
 * still unfilable — refused downstream by the 0-hour rule rather than by
 * [OPEN 4]. Changing that means answering [OPEN 3], which is a separate
 * unconfirmed question and not this flag's to settle.
 */
test('[OPEN 4] accept: a 20-minute session still rounds away to nothing under floor/30', () => {
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '17:20' });
  assert.equal(r.totals.otHours, 0);
  assert.equal(r.belowMinimumFlagged, true, 'it is short, and the engine says so');
  assert.equal(
    r.warnings.some((w) => w.code === 'RAISED_TO_MINIMUM'), false,
    'nothing was padded — the write paths refuse this as a 0-hour entry',
  );
});

// ── [OPEN 4] ต่อใบ or ต่อช่อง — what the minimum is measured against ──────────

/**
 * One session, two rate columns, one of them short. Every test below runs this
 * same Sunday-night-into-Monday shift, because the two scopes are the same rule
 * asked of a different number of piles and nothing else — the only honest way
 * to show the difference is to change the flag and hold everything else still.
 *
 *   Sun 23:40–24:00   20 min  ot3_holiday    ← under the 1-hour minimum
 *   Mon 00:00–02:00  120 min  ot15_weekday   ← well over it
 *
 * Note the rounding: [OPEN 3] floors each column to 30 minutes independently, so
 * the 20-minute column is already nought before the minimum is consulted. That
 * is not a complication invented for the test — it is the ordinary shape of a
 * short column, and it is why the piles carry the hours twice (as worked, and as
 * rounding left them).
 */
/**
 * IT WAS Sun 23:40 → Mon 02:00 until 2026-09-10 — twenty minutes of Sunday in
 * the ×3 column and two hours of Monday in the ×1.5 weekday one. The shape is
 * what these tests are about, not the midnight: ONE SHORT COLUMN beside one
 * that clears the minimum comfortably.
 *
 * Sun 07:40–10:00 is that shape inside one date. Twenty minutes before 08:00
 * are ×3, two hours after it are ×1.5 — holiday now rather than weekday, which
 * is the one assertion below that had to move with it.
 */
const SPLIT_SHIFT = {
  workDate: '2026-08-09', startTime: '07:40', endTime: '10:00',
};

test('[OPEN 4] sheet is what the system ships on', () => {
  assert.equal(DEFAULT_POLICY.minimumHoursScope, 'sheet');
});

test('[OPEN 4] sheet: the columns are added up first, so the short one is carried', () => {
  const r = run(SPLIT_SHIFT);
  assert.equal(r.totals.otHours, 2);
  assert.equal(r.belowMinimumFlagged, false, 'the entry as a whole is nowhere near short');
  assert.equal(r.warnings.some((w) => w.code === 'BELOW_MINIMUM_ACCEPTED'), false);
});

test('[OPEN 4] bucket + accept: the same hours, and the short column is named', () => {
  const r = run(SPLIT_SHIFT, { minimumHoursScope: 'bucket' });

  assert.equal(r.totals.otHours, 2, 'accept moves no hour under either scope');
  assert.equal(r.belowMinimumFlagged, true);

  const flags = r.warnings.filter((w) => w.code === 'BELOW_MINIMUM_ACCEPTED');
  assert.equal(flags.length, 1, 'one warning per short column — not one per column');
  assert.equal(flags[0].bucket, BUCKETS.OT3_HOLIDAY);
  assert.match(flags[0].message, /OT วันหยุด \(17\.01–07\.59\)/, 'named by the column on the form');
});

test('[OPEN 4] bucket: a column the session never touched is absent, not short', () => {
  // Otherwise every ordinary weekday evening would be short in the two holiday
  // columns it was never going to have hours in.
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '21:00' }, { minimumHoursScope: 'bucket' });
  assert.equal(r.belowMinimumFlagged, false);
  assert.equal(r.warnings.length, 0);
});

test('[OPEN 4] bucket + reject: refused for the column, and the message says which', () => {
  assert.throws(
    () => run(SPLIT_SHIFT, { minimumHoursScope: 'bucket', belowMinimum: 'reject' }),
    (e) => e instanceof OtValidationError
      && e.code === 'BELOW_MINIMUM'
      && /OT วันหยุด \(17\.01–07\.59\)/.test(e.message),
  );
  // …and the same session is filed without complaint when the scope is ต่อใบ.
  assert.equal(run(SPLIT_SHIFT, { belowMinimum: 'reject' }).totals.otHours, 2);
});

test('[OPEN 4] bucket + raise: pads the short column only, and keeps the rows in clock order', () => {
  const r = run(SPLIT_SHIFT, { minimumHoursScope: 'bucket', belowMinimum: 'raise' });

  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 1, 'padded up from nought');
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 2, 'left exactly where rounding put it');
  assert.equal(r.totals.otHours, 3);

  // The padded column had rounded away entirely, so its row is rebuilt from the
  // stretch that was worked. Clock times stay as worked while the counted
  // minutes are the padded ones — the same split a flat break deduction makes.
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[0].date, '2026-08-09', 'the early stretch first, though it was padded last');
  assert.equal(r.segments[0].start, '07:40');
  assert.equal(r.segments[0].hours, 1);
  assert.equal(r.segments[1].date, '2026-08-09');

  const raised = r.warnings.filter((w) => w.code === 'RAISED_TO_MINIMUM');
  assert.equal(raised.length, 1);
  assert.equal(raised[0].bucket, BUCKETS.OT3_HOLIDAY);
});

test('[OPEN 4] sheet + raise pads once, whatever the columns underneath it', () => {
  // Same shift, same action, one pile: 2 h clears the minimum and nothing is
  // padded at all. The contrast with the test above is the whole flag.
  const r = run(SPLIT_SHIFT, { belowMinimum: 'raise' });
  assert.equal(r.totals.otHours, 2);
  assert.equal(r.warnings.some((w) => w.code === 'RAISED_TO_MINIMUM'), false);
});

test('[OPEN 4] a scope nobody recognises counts ต่อใบ rather than inventing a third rule', () => {
  const r = run(SPLIT_SHIFT, { minimumHoursScope: 'ต่อคน', belowMinimum: 'raise' });
  assert.equal(r.totals.otHours, 2);
  assert.equal(r.warnings.some((w) => w.code === 'RAISED_TO_MINIMUM'), false);
});

/**
 * A code stopped being unique per entry the day the scope flag arrived, and the
 * screens were all keying React lists on it.
 *
 * Two BELOW_MINIMUM_ACCEPTED warnings on one entry — one per short column —
 * render under one key, which React resolves by dropping the second. HR would
 * be shown one short column out of two, on the screen whose whole job is to
 * show them what to look at, with nothing anywhere reporting a problem.
 */
test('[OPEN 4] no screen keys a warnings list on the code alone', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  /**
   * Two more paths stood here — `web/src/components/OtForm.jsx` and its
   * ApprovalQueue — from when the Vite prototype was a second live copy of
   * these screens. That copy was deleted rather than kept in step; the rule is
   * unchanged and now has one place to hold rather than two.
   */
  for (const file of [
    'components/OtForm.jsx',
    'components/ApprovalQueue.jsx',
  ]) {
    const src = readFileSync(join(root, file), 'utf8');
    assert.ok(!/key=\{w\.code\}/.test(src), `${file} — สองคำเตือนที่รหัสเดียวกันจะหายไปหนึ่งอัน`);
  }
});

/**
 * "8 ชม. ของรายการนี้อยู่ในเวลาทำงานปกติ จึงไม่นับเป็น OT" is not shown — asked
 * for on 2026-09-10 off the เหตุผล column of รออนุมัติ OT. The engine still writes
 * it (the tests above read it), so the rule lives at the screen: no warnings list
 * is drawn except through `shownWarnings`, and that one leaves this code out.
 */
test('NORMAL_HOURS_IGNORED is stored but drawn on no screen', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const common = readFileSync(join(root, 'components/common.jsx'), 'utf8');
  assert.match(common, /HIDDEN_WARNINGS = new Set\(\['NORMAL_HOURS_IGNORED'\]\)/);
  for (const file of ['components/OtForm.jsx', 'components/ApprovalQueue.jsx']) {
    const src = readFileSync(join(root, file), 'utf8');
    assert.ok(!/warnings\?\.map\(/.test(src), `${file} — วาดคำเตือนโดยไม่ผ่าน shownWarnings`);
    assert.ok(src.includes('shownWarnings('), file);
  }
});

test('[OPEN 4] the two scopes agree on every session that lands in one column', () => {
  // Which is most of them. The flag can only ever change an entry that spans a
  // rate boundary — worth pinning, because a scope that quietly re-measured a
  // one-column session would move figures nobody could explain.
  for (const session of [
    { workDate: '2026-08-05', startTime: '17:00', endTime: '17:40' },   // short, weekday
    { workDate: '2026-08-08', startTime: '08:00', endTime: '17:00' },   // long, holiday
    { workDate: '2026-08-05', startTime: '05:30', endTime: '08:00' },   // early start
  ]) {
    for (const belowMinimum of ['accept', 'raise']) {
      const sheet = run(session, { belowMinimum });
      const bucket = run(session, { belowMinimum, minimumHoursScope: 'bucket' });
      assert.deepEqual(bucket.buckets, sheet.buckets, JSON.stringify(session));
      assert.equal(bucket.totals.otHours, sheet.totals.otHours);
      assert.equal(bucket.belowMinimumFlagged, sheet.belowMinimumFlagged);
    }
  }
});

// ── [OPEN 1 / 2] break modes ────────────────────────────────────────────────

test('[OPEN 1] threshold mode deducts an hour nobody took', () => {
  // Fri 17:00–23:00 crosses no 12:00–13:00 window, so lunchWindow deducts
  // nothing and threshold deducts a flat hour anyway. It was example D — the
  // overnight one — that made this point until 2026-09-10; an evening that
  // never goes near noon makes it just as well and can still be filed.
  const session = { workDate: '2026-08-07', startTime: '17:00', endTime: '23:00' };
  assert.equal(run(session).totals.otHours, 6, 'lunchWindow: nothing to deduct');
  const r = run(session, { breakMode: 'threshold', breakThresholdHours: 5 });
  assert.equal(r.totals.otHours, 5, 'this is why lunchWindow is the default');
});

test('[OPEN 1] always mode deducts a flat hour even from a short session', () => {
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '19:00' }, { breakMode: 'always' });
  assert.equal(r.totals.otHours, 1);
});

test('[OPEN 1] none mode never deducts', () => {
  const r = run({ workDate: '2026-08-08', startTime: '08:00', endTime: '17:00' }, { breakMode: 'none' });
  assert.equal(r.totals.otHours, 9);
});

/**
 * [OPEN 2] HAD TWO TESTS HERE AND HAS NONE — 2026-09-10.
 *
 * The question was whether a session crossing two 12:00–13:00 windows was
 * deducted twice or once, and `breakPerCalendarDay` was the answer. Crossing
 * two windows took a session of nearly 24 hours — Sat 12:30 → Sun 12:30 was the
 * fixture — so the question died with ทำงานข้ามคืน and the setting went out of
 * `DEFAULT_POLICY` with it. One date crosses one lunch hour at most, which is
 * what `lunchWindows` now says in one line.
 */
test('[OPEN 2] one date can only cross one lunch window', () => {
  const r = run({ workDate: '2026-08-08', startTime: '08:00', endTime: '17:00' });
  assert.equal(r.breakMinutes, 60, 'the one hour, once');
  assert.equal(DEFAULT_POLICY.breakPerCalendarDay, undefined, 'the setting is gone from the policy');
});

test('the break lands in the bucket that actually contains 12:00–13:00', () => {
  // Sun 11:00–14:00: all holiday core hours, so the whole deduction is ×1.5.
  const r = run({ workDate: '2026-08-09', startTime: '11:00', endTime: '14:00' });
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 2);
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 0);
  assert.equal(r.segments.length, 2, 'split around the lunch hole');
});

// ── validation ──────────────────────────────────────────────────────────────

test('end before start is refused, and the sentence says what to do instead', () => {
  assert.throws(
    () => run({ workDate: '2026-08-05', startTime: '20:00', endTime: '17:00' }),
    (e) => e.code === 'END_BEFORE_START' && /แยกยื่นเป็นสองใบ ใบละวัน/.test(e.message),
  );
});

test('end EQUAL to start is refused too — it was a 24-hour session with the flag', () => {
  assert.throws(
    () => run({ workDate: '2026-08-05', startTime: '21:00', endTime: '21:00' }),
    (e) => e.code === 'END_BEFORE_START',
  );
});

test('a session is never handed a second date to resolve', () => {
  // `sessionDates` is what the caller resolves day types over, and a caller that
  // resolved only `workDate` used to hand the engine a map with a hole in it.
  assert.deepEqual(
    sessionDates({ workDate: '2026-08-07', startTime: '17:00', endTime: '23:00' }),
    ['2026-08-07'],
  );
});

test('§5 — there is no evening ceiling', () => {
  const r = run({ workDate: '2026-08-05', startTime: '17:00', endTime: '23:30' });
  assert.equal(r.totals.otHours, 6.5);
  assert.equal(r.warnings.length, 0);
});

/**
 * `TOO_LONG` STOOD HERE AND IS GONE — 2026-09-10. It caught a session of more
 * than 24 hours, which took `endsNextDay` set on two times that did not wrap:
 * 06:00 → 07:00 the next day was twenty-five. Inside one date the longest a
 * session can be is 23 h 59 m, so nothing can reach the comparison and the code
 * was removed rather than left as a branch no input satisfies.
 */
test('the longest session there is, is a day less a minute', () => {
  const r = run({ workDate: '2026-08-08', startTime: '00:00', endTime: '23:59' });
  assert.equal(r.totals.clockHours, 23.98);
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

test('[OPEN 9] cap basis: D2 counts 10 clock hours or 18 weighted', () => {
  // It read the overnight example D — 14 clock hours, 31.5 weighted — until
  // 2026-09-10. D2 is the same two columns inside one Saturday: 2 h ×3 and
  // 8 h ×1.5, so 10 on the clock and 6 + 12 weighted.
  const s = summariseEntries([
    run({ workDate: '2026-08-08', startTime: '06:00', endTime: '17:00' }),
  ]);
  assert.equal(capUsage(s, DEFAULT_POLICY), 10);
  assert.equal(capUsage(s, { ...DEFAULT_POLICY, capBasis: 'weighted' }), 18);
});
