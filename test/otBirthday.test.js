import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUCKETS,
  DAY_REASONS,
  birthdayInYear,
  computeSession,
  makeIsHoliday,
  resolveDayTypes,
  sessionDates,
  OtValidationError,
} from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import { formDayTypes } from '../lib/reports.js';
import { ARITHMETIC_KEYS, COSMETIC_KEYS, sameArithmetic } from '../lib/policyVersion.js';

/**
 * วันเกิดพนักงานเป็นวันหยุด "เฉพาะคนนั้น".
 *
 * Every test here is pure — a session, a policy, a birthDate and a holiday list
 * in; buckets out. That is the whole reason day types are resolved by the
 * caller and handed to the engine as a map: the rule depends on WHO worked, and
 * a rule that reached into the employee collection to find out would be
 * testable only against a database.
 *
 * Dates are August 2026 to match test/otEngine.test.js: 4 Aug is a Tuesday,
 * 7 Aug a Friday, 8 Aug a Saturday, and 12 Aug (วันแม่) stands in for the
 * company calendar.
 */

const HOLIDAYS = ['2026-08-12'];
const isHoliday = makeIsHoliday(HOLIDAYS);

const ON = { ...DEFAULT_POLICY, birthdayHolidayEnabled: true };
const OFF = { ...DEFAULT_POLICY, birthdayHolidayEnabled: false };

/** What otService.contextFor builds, without the database half. */
function run(session, { birthDate = null, policy = ON } = {}) {
  return computeSession(session, {
    policy,
    dayTypes: resolveDayTypes(sessionDates(session), { isHoliday, birthDate, policy }),
  });
}

// ── the rule ────────────────────────────────────────────────────────────────

test('วันเกิดตรงวันอังคาร — 08:00–17:00 เข้า ot15_holiday (หักพักเที่ยง)', () => {
  const r = run(
    { workDate: '2026-08-04', startTime: '08:00', endTime: '17:00' },
    { birthDate: '1994-08-04' },
  );

  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 8, '9 ชม. หักพักเที่ยง 1 ชม.');
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 0);
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 0);
  assert.equal(r.totals.otHours, 8);
  assert.equal(r.segments[0].dayType, 'holiday');
  assert.equal(r.segments[0].dayReason, DAY_REASONS.BIRTHDAY);

  // The same Tuesday, same person, rule off: normal working hours, not OT.
  const off = run(
    { workDate: '2026-08-04', startTime: '08:00', endTime: '17:00' },
    { birthDate: '1994-08-04', policy: OFF },
  );
  assert.equal(off.totals.otHours, 0);
  assert.equal(off.warnings[0].code, 'NORMAL_HOURS_IGNORED');
});

test('วันเกิดตรงวันอังคาร — ก่อน 08:00 และหลัง 17:00 เข้า ot3_holiday', () => {
  const early = run(
    { workDate: '2026-08-04', startTime: '06:00', endTime: '08:00' },
    { birthDate: '1994-08-04' },
  );
  assert.equal(early.buckets[BUCKETS.OT3_HOLIDAY], 2);
  assert.equal(early.buckets[BUCKETS.OT15_HOLIDAY], 0);

  const late = run(
    { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' },
    { birthDate: '1994-08-04' },
  );
  assert.equal(late.buckets[BUCKETS.OT3_HOLIDAY], 3);
  // Without the rule this is the ordinary weekday evening column.
  const off = run(
    { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' },
    { birthDate: '1994-08-04', policy: OFF },
  );
  assert.equal(off.buckets[BUCKETS.OT15_WEEKDAY], 3);
  assert.equal(off.buckets[BUCKETS.OT3_HOLIDAY], 0);
});

test('วันเกิดตรงวันเสาร์ — ไม่มีผลเพิ่ม เหตุผลยังเป็นวันหยุดสุดสัปดาห์', () => {
  const session = { workDate: '2026-08-08', startTime: '08:00', endTime: '17:00' };

  const withBirthday = run(session, { birthDate: '1994-08-08' });
  const without = run(session, { birthDate: null });

  assert.deepEqual(withBirthday.buckets, without.buckets);
  assert.equal(withBirthday.buckets[BUCKETS.OT15_HOLIDAY], 8);
  assert.equal(
    withBirthday.segments[0].dayReason,
    DAY_REASONS.WEEKEND,
    'วันเสาร์เป็นวันหยุดอยู่แล้ว กฎวันเกิดไม่ได้ทำให้อะไรเปลี่ยน จึงต้องไม่อ้างเครดิต',
  );
});

test('วันเกิดตรงวันหยุดบริษัท — ไม่มีผลเพิ่ม เหตุผลยังเป็นวันหยุดบริษัท', () => {
  // 12 Aug 2026 is a Wednesday on the company calendar.
  const session = { workDate: '2026-08-12', startTime: '08:00', endTime: '17:00' };

  const withBirthday = run(session, { birthDate: '1994-08-12' });
  const without = run(session, { birthDate: null });

  assert.deepEqual(withBirthday.buckets, without.buckets);
  assert.equal(withBirthday.segments[0].dayReason, DAY_REASONS.COMPANY_HOLIDAY);
});

test('พนักงานที่ไม่มี birthDate — คำนวณปกติ ไม่ throw', () => {
  const r = run(
    { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' },
    { birthDate: null },
  );
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 3);
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 0);
  assert.equal(r.segments[0].dayReason, null);
});

test('วันเกิดของคนหนึ่งไม่ใช่วันหยุดของอีกคน', () => {
  const session = { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' };
  const birthdayPerson = run(session, { birthDate: '1994-08-04' });
  const colleague = run(session, { birthDate: '1990-11-23' });

  assert.equal(birthdayPerson.buckets[BUCKETS.OT3_HOLIDAY], 3);
  assert.equal(colleague.buckets[BUCKETS.OT15_WEEKDAY], 3);
});

// ── overnight: two holiday segments, two different reasons ──────────────────

test('วันเกิดวันศุกร์ ทำงาน 17:00 ข้ามคืนไปเสาร์ 07:00 — ot3_holiday ทั้งคู่ คนละเหตุผล', () => {
  const session = {
    workDate: '2026-08-07', startTime: '17:00', endTime: '07:00', endsNextDay: true,
  };
  const r = run(session, { birthDate: '1994-08-07' });

  assert.deepEqual(sessionDates(session), ['2026-08-07', '2026-08-08']);

  const friday = r.segments.filter((s) => s.date === '2026-08-07');
  const saturday = r.segments.filter((s) => s.date === '2026-08-08');
  assert.equal(friday.length, 1);
  assert.equal(saturday.length, 1);

  // Identical on the sheet…
  assert.equal(friday[0].bucket, BUCKETS.OT3_HOLIDAY);
  assert.equal(saturday[0].bucket, BUCKETS.OT3_HOLIDAY);
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 14);
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 0);

  // …and arrived there by different rules. Only the Friday half moves if HR
  // turns the birthday rule off again, which is why the reason is recorded.
  assert.equal(friday[0].dayReason, DAY_REASONS.BIRTHDAY);
  assert.equal(saturday[0].dayReason, DAY_REASONS.WEEKEND);

  // Example D from the requirements is this same session for somebody whose
  // birthday it is not: 7 h ×1.5 + 7 h ×3.
  const ordinary = run(session, { birthDate: null });
  assert.equal(ordinary.buckets[BUCKETS.OT15_WEEKDAY], 7);
  assert.equal(ordinary.buckets[BUCKETS.OT3_HOLIDAY], 7);
});

// ── the map is the contract ─────────────────────────────────────────────────

test('dayTypes ที่ไม่มีวันที่ที่ engine ต้องใช้ — ต้อง throw ไม่ใช่เดาว่าเป็น workday', () => {
  const session = {
    workDate: '2026-08-07', startTime: '17:00', endTime: '07:00', endsNextDay: true,
  };

  // The Saturday half is missing — exactly what a caller resolving only
  // `workDate` would hand over.
  assert.throws(
    () => computeSession(session, { dayTypes: { '2026-08-07': 'workday' } }),
    (err) => err instanceof OtValidationError
      && err.code === 'MISSING_DAY_TYPE'
      && err.message.includes('2026-08-08'),
  );

  assert.throws(
    () => computeSession(session, {}),
    (err) => err.code === 'MISSING_DAY_TYPE',
  );
});

test('ส่ง isHoliday แบบเดิมมาแทน dayTypes — ต้อง throw ไม่ใช่คำนวณเงียบ ๆ', () => {
  assert.throws(
    () => computeSession(
      { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' },
      { isHoliday },
    ),
    (err) => err.code === 'MISSING_DAY_TYPE',
  );
});

test('dayTypes รับได้ทั้ง string ล้วนและ { type, reason }', () => {
  const session = { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' };

  const plain = computeSession(session, { dayTypes: { '2026-08-04': 'holiday' } });
  const rich = computeSession(session, {
    dayTypes: { '2026-08-04': { type: 'holiday', reason: DAY_REASONS.BIRTHDAY } },
  });

  assert.equal(plain.buckets[BUCKETS.OT3_HOLIDAY], 3);
  assert.equal(rich.buckets[BUCKETS.OT3_HOLIDAY], 3);
  assert.equal(plain.segments[0].dayReason, null, 'string form records no reason');
  assert.equal(rich.segments[0].dayReason, DAY_REASONS.BIRTHDAY);
});

test('ชนิดของวันที่ไม่รู้จัก — ต้อง throw', () => {
  assert.throws(
    () => computeSession(
      { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' },
      { dayTypes: { '2026-08-04': 'birthday' } },
    ),
    (err) => err.code === 'BAD_DAY_TYPE',
  );
});

test('sessionDates ครอบคลุมทุกวันที่ที่ engine จะแตะ', () => {
  assert.deepEqual(
    sessionDates({ workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' }),
    ['2026-08-04'],
  );
  assert.deepEqual(
    sessionDates({
      workDate: '2026-08-31', startTime: '22:00', endTime: '02:00', endsNextDay: true,
    }),
    ['2026-08-31', '2026-09-01'],
    'ข้ามเดือนก็ยังเป็นสองวันที่',
  );
  // 17:00 → 24:00 ends exactly at midnight and puts no minutes into the 8th.
  assert.deepEqual(
    sessionDates({ workDate: '2026-08-07', startTime: '17:00', endTime: '24:00' }),
    ['2026-08-07'],
  );
});

// ── 29 กุมภาพันธ์ ───────────────────────────────────────────────────────────

test('29 ก.พ. ในปีอธิกสุรทิน — วันเกิดคือ 29 ก.พ. ตามปกติ', () => {
  assert.equal(birthdayInYear('2000-02-29', 2028, DEFAULT_POLICY), '2028-02-29');
});

test('29 ก.พ. ในปีที่ไม่ใช่อธิกสุรทิน — ใช้ค่าจาก config ไม่ hardcode', () => {
  const feb28 = { ...DEFAULT_POLICY, birthdayLeapFallback: 'feb28' };
  const mar01 = { ...DEFAULT_POLICY, birthdayLeapFallback: 'mar01' };
  const none = { ...DEFAULT_POLICY, birthdayLeapFallback: 'none' };

  assert.equal(birthdayInYear('2000-02-29', 2027, feb28), '2027-02-28');
  assert.equal(birthdayInYear('2000-02-29', 2027, mar01), '2027-03-01');
  assert.equal(birthdayInYear('2000-02-29', 2027, none), null);

  assert.equal(DEFAULT_POLICY.birthdayLeapFallback, 'feb28', 'default ตามที่ตกลงไว้');
});

test('29 ก.พ. — ทางเลือก config เปลี่ยนชั่วโมงจริง ไม่ใช่แค่ป้าย', () => {
  // 2027 is not a leap year. 26 Feb 2027 is a Friday, so 28 Feb is a Sunday
  // (already a holiday) and 1 Mar is a Monday.
  const session = { workDate: '2027-03-01', startTime: '17:00', endTime: '20:00' };
  const birthDate = '2000-02-29';
  const holidayCal = makeIsHoliday([]);

  const shifted = computeSession(session, {
    policy: { ...ON, birthdayLeapFallback: 'mar01' },
    dayTypes: resolveDayTypes(sessionDates(session), {
      isHoliday: holidayCal, birthDate, policy: { ...ON, birthdayLeapFallback: 'mar01' },
    }),
  });
  const notShifted = computeSession(session, {
    policy: { ...ON, birthdayLeapFallback: 'feb28' },
    dayTypes: resolveDayTypes(sessionDates(session), {
      isHoliday: holidayCal, birthDate, policy: { ...ON, birthdayLeapFallback: 'feb28' },
    }),
  });

  assert.equal(shifted.buckets[BUCKETS.OT3_HOLIDAY], 3);
  assert.equal(notShifted.buckets[BUCKETS.OT15_WEEKDAY], 3);
});

test('leap year ถูกคำนวณตามกฎ 400 ปี ไม่ใช่หาร 4 อย่างเดียว', () => {
  // 1900 was not a leap year; 2000 was. Nobody in the roster was born in 1900,
  // but the fallback branch is chosen by this test and it should be right.
  assert.equal(birthdayInYear('2000-02-29', 1900, DEFAULT_POLICY), '1900-02-28');
  assert.equal(birthdayInYear('2000-02-29', 2000, DEFAULT_POLICY), '2000-02-29');
  assert.equal(birthdayInYear('2000-02-29', 2100, DEFAULT_POLICY), '2100-02-28');
});

// ── bad data is loud, and only when it matters ──────────────────────────────

test('birthDate ที่ไม่ใช่วันที่จริง — throw เมื่อกฎเปิดอยู่เท่านั้น', () => {
  const session = { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' };

  assert.throws(
    () => resolveDayTypes(sessionDates(session), {
      isHoliday, birthDate: '1994-02-30', policy: ON,
    }),
    (err) => err.code === 'BAD_BIRTH_DATE',
  );

  // Rule off: birthDate is never read, so a roster typo cannot stop somebody
  // filing OT for a reason that has nothing to do with their session.
  assert.doesNotThrow(() => resolveDayTypes(sessionDates(session), {
    isHoliday, birthDate: '1994-02-30', policy: OFF,
  }));
});

// ── resolveDayTypes on its own ──────────────────────────────────────────────

test('resolveDayTypes ตอบทุกวันที่ที่ถูกถาม และตอบเป็น { type, reason } เสมอ', () => {
  const dates = ['2026-08-04', '2026-08-08', '2026-08-12'];
  const map = resolveDayTypes(dates, { isHoliday, birthDate: '1994-08-04', policy: ON });

  assert.deepEqual(Object.keys(map).sort(), dates);
  assert.deepEqual(map['2026-08-04'], { type: 'holiday', reason: DAY_REASONS.BIRTHDAY });
  assert.deepEqual(map['2026-08-08'], { type: 'holiday', reason: DAY_REASONS.WEEKEND });
  assert.deepEqual(map['2026-08-12'], { type: 'holiday', reason: DAY_REASONS.COMPANY_HOLIDAY });
});

// ── ใบพิมพ์ F-HR-027: ตารางปฏิทินต้องไม่ขัดกับชั่วโมงข้างๆ ────────────────────

/**
 * The grid down the left of the sheet, for one employee's month.
 *
 * Only August is built: 4 Aug is the birthday Tuesday, 8 Aug a Saturday and
 * 12 Aug the company holiday, so one month covers all three reasons a date can
 * be วันหยุด and the ordinary weekdays in between.
 */
const AUGUST = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
const gridFor = (policy, birthDate = '1994-08-04') => formDayTypes(AUGUST, {
  isHoliday, birthDate, policy,
});

const FORM_ON = { ...ON, birthdayReasonOnForm: true };
const FORM_OFF = { ...ON, birthdayReasonOnForm: false };

test('birthdayReasonOnForm เปิด — วันเกิดในตารางเป็นวันหยุด และบอกเหตุผลว่าวันเกิด', () => {
  const grid = gridFor(FORM_ON);

  assert.deepEqual(grid['2026-08-04'], { type: 'holiday', reason: DAY_REASONS.BIRTHDAY });

  // …which is the row the ot15_holiday hours are printed against. Same date,
  // same person, same policy: the sheet agrees with itself.
  const worked = run(
    { workDate: '2026-08-04', startTime: '08:00', endTime: '17:00' },
    { birthDate: '1994-08-04', policy: FORM_ON },
  );
  assert.equal(worked.buckets[BUCKETS.OT15_HOLIDAY], 8);
  assert.equal(grid['2026-08-04'].type, worked.segments[0].dayType);

  assert.equal(DEFAULT_POLICY.birthdayReasonOnForm, true, 'ค่าเริ่มต้นคือเปิด');
});

test('birthdayReasonOnForm ปิด — ตารางกลับไปใช้ปฏิทินบริษัทอย่างเดียว', () => {
  const grid = gridFor(FORM_OFF);

  assert.deepEqual(grid['2026-08-04'], { type: 'workday', reason: null });

  // The contradiction the flag exists to choose: the hours are still in the
  // holiday column, because they were computed from the entry's own day types
  // and this flag never reaches the arithmetic.
  const worked = run(
    { workDate: '2026-08-04', startTime: '08:00', endTime: '17:00' },
    { birthDate: '1994-08-04', policy: FORM_OFF },
  );
  assert.equal(worked.buckets[BUCKETS.OT15_HOLIDAY], 8);
});

test('เปิดหรือปิด birthdayReasonOnForm — ชั่วโมงทุกช่องเท่าเดิมเป๊ะ', () => {
  const sessions = [
    // The birthday Tuesday, in and out of core hours.
    { workDate: '2026-08-04', startTime: '08:00', endTime: '17:00' },
    { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' },
    { workDate: '2026-08-04', startTime: '06:00', endTime: '08:00' },
    // The birthday Tuesday running into an ordinary Wednesday.
    { workDate: '2026-08-04', startTime: '22:00', endTime: '02:00', endsNextDay: true },
    // A weekend, a company holiday and an ordinary weekday, for good measure.
    { workDate: '2026-08-08', startTime: '08:00', endTime: '17:00' },
    { workDate: '2026-08-12', startTime: '08:00', endTime: '17:00' },
    { workDate: '2026-08-05', startTime: '17:00', endTime: '21:30' },
  ];

  for (const session of sessions) {
    const on = run(session, { birthDate: '1994-08-04', policy: FORM_ON });
    const off = run(session, { birthDate: '1994-08-04', policy: FORM_OFF });
    assert.deepEqual(
      off,
      on,
      `${session.workDate} ${session.startTime}–${session.endTime}: ชั่วโมงต้องไม่ขยับตามค่าที่พิมพ์บนกระดาษ`,
    );
  }
});

test('birthdayReasonOnForm เป็น cosmetic — เปลี่ยนแล้วต้องไม่ trigger replay', () => {
  assert.ok(
    COSMETIC_KEYS.includes('birthdayReasonOnForm'),
    'อยู่ใน COSMETIC_KEYS เพราะไม่กระทบชั่วโมง',
  );
  assert.ok(
    !ARITHMETIC_KEYS.includes('birthdayReasonOnForm'),
    'ถ้าหลุดเข้า ARITHMETIC_KEYS การเปลี่ยนหมายเหตุบนกระดาษจะสั่งคำนวณใบทั้งเดือนใหม่',
  );

  // What savePolicy actually asks before it replays anything.
  assert.equal(sameArithmetic(FORM_ON, FORM_OFF), true);

  // And the guard the other way round: this is what a flag that DOES move
  // hours looks like, so the assertion above is not passing for free.
  assert.equal(sameArithmetic(ON, OFF), false);
});

test('วันอื่นในตารางไม่ขยับตาม birthdayReasonOnForm', () => {
  const on = gridFor(FORM_ON);
  const off = gridFor(FORM_OFF);

  for (const date of AUGUST) {
    if (date === '2026-08-04') continue;
    assert.deepEqual(off[date], on[date], `${date} ไม่ควรเปลี่ยนตามค่าของใบพิมพ์`);
  }

  // Named individually, because "everything else is equal" also passes when
  // the grid resolves nothing at all.
  assert.deepEqual(on['2026-08-08'], { type: 'holiday', reason: DAY_REASONS.WEEKEND });
  assert.deepEqual(on['2026-08-12'], { type: 'holiday', reason: DAY_REASONS.COMPANY_HOLIDAY });
  assert.deepEqual(on['2026-08-05'], { type: 'workday', reason: null });
});

test('กฎวันเกิดปิดอยู่ — เปิด birthdayReasonOnForm ก็ไม่ทำให้วันเกิดเป็นวันหยุดบนกระดาษ', () => {
  // The note describes a holiday the arithmetic granted. With the rule off
  // there is none, and a sheet marking หยุด beside ×1.5 weekday hours would be
  // the same contradiction pointing the other way.
  const grid = gridFor({ ...OFF, birthdayReasonOnForm: true });
  assert.deepEqual(grid['2026-08-04'], { type: 'workday', reason: null });
});

test('resolveDayTypes ไม่แตะปฏิทินวันหยุดบริษัท — วันเกิดไม่เคยกลายเป็นวันหยุดของคนอื่น', () => {
  const dates = ['2026-08-04'];
  const mine = resolveDayTypes(dates, { isHoliday, birthDate: '1994-08-04', policy: ON });
  const theirs = resolveDayTypes(dates, { isHoliday, birthDate: '1990-01-01', policy: ON });

  assert.equal(mine['2026-08-04'].type, 'holiday');
  assert.equal(theirs['2026-08-04'].type, 'workday');
  assert.equal(
    isHoliday('2026-08-04'),
    false,
    'the company calendar itself is untouched — วันเกิดไม่ถูกเขียนลงปฏิทินวันหยุด',
  );
});
