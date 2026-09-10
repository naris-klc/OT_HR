import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BUCKETS, capUsage, computeSession, makeIsHoliday, resolveDayTypes, sessionDates,
} from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import {
  OT_MODES, OT_MODE_DEFAULT, otModeFrom, otModeOf, weekdayOtAllowed, weekdayOtRefusal,
} from '../lib/otMode.js';

/**
 * แผนกที่ไม่มีโอที และแผนกเหมารายวัน.
 *
 * HR's rule, 2026-08-17: in some departments staying past 17:00 on an ordinary
 * day earns nothing — either because the department does no OT at all, or
 * because it is paid a flat daily rate. Working a company holiday still counts,
 * and so does coming in on one's own birthday.
 *
 * Everything here is pure. The rule reads a computed result, so these are the
 * engine's own buckets rather than a fixture asserting what the engine is
 * assumed to produce — which is the point of testing the result and not the
 * calendar.
 *
 * Dates match test/otBirthday.test.js: 4 Aug 2026 is a Tuesday, 11 Aug a
 * Tuesday, and 12 Aug (วันแม่) stands in for the company calendar.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const isHoliday = makeIsHoliday(['2026-08-12']);
const POLICY = { ...DEFAULT_POLICY, birthdayHolidayEnabled: true };

function run(session, { birthDate = null } = {}) {
  return computeSession(session, {
    policy: POLICY,
    dayTypes: resolveDayTypes(sessionDates(session), { isHoliday, birthDate, policy: POLICY }),
  });
}

const NONE = { otMode: 'none' };
const DAILY = { otMode: 'daily' };
const NORMAL = { otMode: 'normal' };

/** A Tuesday evening: ordinary weekday OT. */
const TUESDAY_EVENING = { workDate: '2026-08-04', startTime: '18:00', endTime: '21:00' };
/** วันแม่ — a company holiday, so the same hours are holiday OT. */
const HOLIDAY_EVENING = { workDate: '2026-08-12', startTime: '18:00', endTime: '21:00' };
/** The whole of that holiday, both rate columns at once. */
const HOLIDAY_DAY = { workDate: '2026-08-12', startTime: '08:00', endTime: '21:00' };

// ── reading the field ───────────────────────────────────────────────────────

test('a department with no mode stored is an ordinary one', () => {
  assert.equal(otModeOf({}), OT_MODE_DEFAULT);
  assert.equal(otModeOf(null), OT_MODE_DEFAULT);
  assert.equal(otModeOf(undefined), OT_MODE_DEFAULT);
  assert.equal(weekdayOtAllowed({}), true);
});

test('a mode nobody recognises is not read as an ordinary department', () => {
  // The stored side falls back, because a row already written cannot be refused
  // at read time and the screens have to draw something.
  assert.equal(otModeOf({ otMode: 'เหมา' }), OT_MODE_DEFAULT);
  // The write side does NOT: it is null, which the routes turn into a 400.
  // Answering "does this department do OT" with yes on the strength of a typo
  // is the failure this pair exists to prevent.
  assert.equal(otModeFrom('เหมา'), null);
  assert.equal(otModeFrom('daily'), 'daily');
  // Absent is the default, the way a blank ceiling is null — a create that
  // never mentions the field makes an ordinary department.
  assert.equal(otModeFrom(undefined), OT_MODE_DEFAULT);
  assert.equal(otModeFrom(''), OT_MODE_DEFAULT);
});

// ── the rule ────────────────────────────────────────────────────────────────

test('an ordinary department is refused nothing', () => {
  assert.equal(weekdayOtRefusal(NORMAL, run(TUESDAY_EVENING)), null);
  assert.equal(weekdayOtRefusal(NORMAL, run(HOLIDAY_EVENING)), null);
});

test('weekday OT is refused where the department does not have it', () => {
  for (const dept of [NONE, DAILY]) {
    const message = weekdayOtRefusal(dept, run(TUESDAY_EVENING));
    assert.ok(message, 'a Tuesday evening must be refused');
    // The refusal says which days still work, or it reads as "this department
    // may never file anything" — which is not the rule.
    assert.match(message, /วันหยุด/);
  }
});

test('the two modes are refused in their own words', () => {
  const none = weekdayOtRefusal(NONE, run(TUESDAY_EVENING));
  const daily = weekdayOtRefusal(DAILY, run(TUESDAY_EVENING));
  assert.notEqual(none, daily);
  assert.match(daily, /เหมารายวัน/);
});

test('a company holiday still counts in a department with no OT', () => {
  const result = run(HOLIDAY_EVENING);
  assert.equal(result.buckets[BUCKETS.OT15_WEEKDAY], 0);
  assert.ok(result.totals.otHours > 0);
  assert.equal(weekdayOtRefusal(NONE, result), null);
  assert.equal(weekdayOtRefusal(DAILY, result), null);
});

test('a whole holiday, both rate columns, is untouched by the rule', () => {
  const result = run(HOLIDAY_DAY);
  assert.ok(result.buckets[BUCKETS.OT15_HOLIDAY] > 0);
  assert.ok(result.buckets[BUCKETS.OT3_HOLIDAY] > 0);
  assert.equal(weekdayOtRefusal(NONE, result), null);
});

test('a birthday is a holiday for that person, so it counts here too', () => {
  // The very session refused above, filed by somebody born on that Tuesday.
  const result = run(TUESDAY_EVENING, { birthDate: '1990-08-04' });
  assert.equal(result.buckets[BUCKETS.OT15_WEEKDAY], 0);
  assert.equal(weekdayOtRefusal(NONE, result), null);
  assert.equal(weekdayOtRefusal(DAILY, result), null);
});

test('an entry with hours in both kinds of bucket is refused whole, and says so', () => {
  /**
   * THE ENGINE CANNOT PRODUCE THIS ANY MORE, AND THE RULE STILL HAS TO HANDLE IT.
   *
   * It was a midnight crossing — Tuesday 11 Aug 22:00 → วันแม่ 02:00, the
   * weekday half and the holiday half in one session — until 2026-09-10, when
   * ทำงานข้ามคืน was removed and a session stopped being able to touch two
   * dates. One date is one kind of day, so no computation reaches this branch.
   *
   * SO THE RESULT IS BUILT BY HAND, which is the honest way to test it now.
   * `weekdayOtRefusal` reads a stored `buckets` object and there are entries in
   * the database, filed before that day, that carry exactly this shape — the
   * sentence they get when somebody re-reads them has to go on being right.
   */
  const mixed = { buckets: { [BUCKETS.OT15_WEEKDAY]: 2, [BUCKETS.OT3_HOLIDAY]: 2 } };

  const message = weekdayOtRefusal(NONE, mixed);
  assert.ok(message, 'refused, because part of it is weekday OT');
  // And it says the holiday half exists and can be filed on its own, or the
  // refusal reads as "this night earns nothing".
  assert.match(message, /แยกยื่น/);
});

// ── why this is not a ceiling of 0 ──────────────────────────────────────────

test('a ceiling of 0 would refuse the days this rule allows', () => {
  // The reason the mode is its own field. Holiday and birthday hours land in
  // the same monthly total a ceiling measures — capUsage sums every bucket — so
  // "no OT" spelled as a ceiling would flag, and under capBehaviour 'block'
  // refuse, precisely the days HR says must go through.
  const holiday = run(HOLIDAY_EVENING);
  const counted = capUsage({
    otHours: holiday.totals.otHours,
    weightedHours: holiday.totals.weightedHours,
  }, POLICY);
  assert.ok(counted > 0, 'holiday hours are inside every ceiling');
  assert.equal(weekdayOtRefusal(NONE, holiday), null, 'and outside this rule');
});

// ── the rule is actually reachable ──────────────────────────────────────────

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('every write path that computes hours consults the rule', () => {
  for (const path of [
    'app/api/entries/route.js',
    'app/api/entries/[id]/route.js',
    'app/api/entries/preview/route.js',
    'legacy/routes/entries.js',
  ]) {
    assert.match(read(path), /weekdayOtRefusal/, `${path} must apply the rule`);
  }
  // THERE IS NO EXEMPT PATH ANY MORE. app/api/birthday/entries was the one
  // route that deliberately skipped this rule — ฝ่ายบุคคล filing a
  // สวัสดิการวันเกิด off the scan record, granted whatever the department was
  // paid on — and it was deleted on 2026-09-03 with the queue that opened it.
  //
  // A birthday request is one of the three above now and meets รูปแบบโอที like
  // every other request. That costs the exemption nothing: the rule reads the
  // ot15_weekday bucket, and a real birthday holiday puts every minute in the
  // two วันหยุด buckets — which is what the case above this one pins.
  assert.equal(
    existsSync(join(ROOT, 'app/api/birthday')),
    false,
    'the birthday door is gone — a new one would need this rule written into it',
  );
});

test('the department the rule reads is populated with the field', () => {
  // A select that omits it reads back as undefined, which otModeOf answers as
  // an ordinary department — the rule would be off and nothing would say so.
  for (const path of ['lib/entries.js', 'legacy/routes/entries.js']) {
    assert.match(read(path), /weeklyCapHours otMode/, `${path} must select otMode`);
  }
});

test('the modes the model accepts are the modes the code knows', () => {
  assert.match(read('src/models/Department.js'), /enum: OT_MODES/);
  assert.deepEqual(OT_MODES, ['normal', 'none', 'daily']);
});
