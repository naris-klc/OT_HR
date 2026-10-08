import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUCKETS,
  DAY_REASONS,
  birthdayInYear,
  birthdayFirstTierMinutes,
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
 * วันเกิดพนักงานเป็นวันหยุด "เฉพาะคนนั้น" — ตั้งแต่ 2026-10-08 แบ่งช่องด้วย
 * นาฬิกา: 8 ชม. แรกในช่วง 08:00–17:00 ×1.5 นอกนั้นและส่วนที่เกิน 8 ชม. ×3
 * (2026-09-08 ถึง 2026-10-08 เคยนับ 8 ชม. แรกที่ "ทำ" ไม่ดูนาฬิกา).
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

/**
 * นาฬิกาตัดสิน — ตั้งแต่ 2026-10-08.
 *
 * 2026-09-08 ถึง 2026-10-08 เคสนี้ยืนยันตรงข้าม: กะสั้นนอกเวลางานเป็น "ชั่วโมง
 * แรกของวัน" จึงได้ ×1.5 ทั้งกะ ตอนนี้นอก 08:00–17:00 คือ ×3 เหมือนวันเสาร์
 */
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
  assert.equal(late.buckets[BUCKETS.OT15_HOLIDAY], 0);

  // Without the rule this is the ordinary weekday evening column.
  const off = run(
    { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' },
    { birthDate: '1994-08-04', policy: OFF },
  );
  assert.equal(off.buckets[BUCKETS.OT15_WEEKDAY], 3);
  assert.equal(off.buckets[BUCKETS.OT3_HOLIDAY], 0);
});

/**
 * เคสที่ขอแก้มา 2026-10-08 — 05:00–17:00 ในวันเกิด.
 *
 * กฎเก่าให้ 05:00–12:00 ×1.5 (7) · 13:00–14:00 ×1.5 (1) · 14:00–17:00 ×3 (3)
 * คือ ×3 ไปตกท้ายวัน ทั้งที่ 14:00–17:00 อยู่ในเวลางาน
 */
test('วันเกิด 05:00–17:00 — 05:00–08:00 ×3 · 08:00–17:00 ×1.5', () => {
  const r = run(
    { workDate: '2026-08-04', startTime: '05:00', endTime: '17:00' },
    { birthDate: '1994-08-04' },
  );

  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 8);
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 3);
  assert.equal(r.totals.otHours, 11);
  assert.deepEqual(
    r.segments.map((x) => [x.start, x.end, x.bucket]),
    [
      ['05:00', '08:00', BUCKETS.OT3_HOLIDAY],
      ['08:00', '12:00', BUCKETS.OT15_HOLIDAY],
      ['13:00', '17:00', BUCKETS.OT15_HOLIDAY],
    ],
  );
});

/**
 * 06:00–20:00 หักพักเที่ยงเหลือ 13 ชม. — 8 ชม. ใน 08:00–17:00 ×1.5 ส่วนหัวและ
 * ท้ายวัน 5 ชม. ×3 · ก่อน 2026-10-08 เส้นแบ่งตกที่ 15:00 (ชั่วโมงที่แปดที่ทำ)
 */
test('วันเกิด 06:00–20:00 — ใน 08:00–17:00 ×1.5 หัวและท้ายวัน ×3', () => {
  const r = run(
    { workDate: '2026-08-04', startTime: '06:00', endTime: '20:00' },
    { birthDate: '1994-08-04' },
  );

  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 8);
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 5);
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 0);
  assert.equal(r.totals.otHours, 13);

  assert.deepEqual(
    r.segments.map((x) => [x.start, x.end, x.bucket]),
    [
      ['06:00', '08:00', BUCKETS.OT3_HOLIDAY],
      ['08:00', '12:00', BUCKETS.OT15_HOLIDAY],
      ['13:00', '17:00', BUCKETS.OT15_HOLIDAY],
      ['17:00', '20:00', BUCKETS.OT3_HOLIDAY],
    ],
  );
  assert.ok(
    r.segments.every((x) => x.dayReason === DAY_REASONS.BIRTHDAY),
    'ทั้งวันยังเป็นวันเกิด แม้ครึ่งหลังจะอยู่ช่อง ×3',
  );
  assert.deepEqual(
    r.segments.map((x) => x.multiplier),
    [3, 1.5, 1.5, 3],
  );
});

/**
 * เส้นแบ่งมาจากเวลางานปกติของบริษัท ไม่ใช่เลข 480 ที่เขียนตายไว้ — บริษัทที่ย้าย
 * เวลาเข้า-ออกจึงย้ายเส้นนี้ตามไปด้วย โดยไม่ต้องมีค่าตั้งค่าตัวที่สอง
 */
test('8 ชม. แรก คือวันทำงานมาตรฐาน อ่านจาก policy ไม่ใช่เลขตายตัว', () => {
  assert.equal(birthdayFirstTierMinutes(DEFAULT_POLICY), 480);

  const sevenHourDay = { ...ON, coreEndMinute: 16 * 60 };
  assert.equal(birthdayFirstTierMinutes(sevenHourDay), 420);

  const r = run(
    { workDate: '2026-08-04', startTime: '06:00', endTime: '20:00' },
    { birthDate: '1994-08-04', policy: sevenHourDay },
  );
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 7);
});

/**
 * ไม่พักเที่ยงไม่มีในวันเกิด — 2026-10-08. ติ๊กมาก็หักพักเที่ยงตามปกติ และผลบอกว่า
 * ไม่ได้นับ (`noBreakTaken: false`) เพื่อให้ใบที่บันทึกล้างติ๊กออกด้วย · วันเสาร์
 * ธรรมดายังได้ 9 ชม.
 */
test('วันเกิด ติ๊กไม่พักเที่ยง — ระบบไม่นับ หักพักเที่ยงตามปกติ', () => {
  const session = { workDate: '2026-08-08', startTime: '08:00', endTime: '17:00', noBreakTaken: true };
  const r = run(session, { birthDate: '1994-08-08' });

  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 8);
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 0);
  assert.equal(r.breakMinutes, 60);
  assert.equal(r.noBreakTaken, false);

  const saturday = run(session, { birthDate: null });
  assert.equal(saturday.buckets[BUCKETS.OT15_HOLIDAY], 9);
  assert.equal(saturday.noBreakTaken, true);
});

/**
 * ลำดับกลับด้านเมื่อ 2026-09-08 — วันเกิดมาก่อนเสาร์-อาทิตย์และปฏิทินบริษัท.
 *
 * เคสคู่นี้เคยชื่อ "ไม่มีผลเพิ่ม เหตุผลยังเป็นวันหยุด…" และถูกต้องตราบใดที่สอง
 * กฎให้คำตอบเดียวกัน วันเกิดแบ่งช่องด้วยจำนวนชั่วโมงแล้ว วันหยุดยังแบ่งด้วย
 * นาฬิกา ตัวเลขจึงต่างกันได้ และ "ไม่มีผลเพิ่ม" กลายเป็นการตัดสินเงียบ ๆ ว่าจะ
 * จ่ายแบบไหน ฝ่ายบุคคลตอบว่า *ใช้กฎวันเกิดแทน*
 */
test('วันเกิดตรงวันเสาร์ — ใช้กฎวันเกิด เหตุผลบนแถวเป็นวันเกิด', () => {
  const session = { workDate: '2026-08-08', startTime: '08:00', endTime: '17:00' };

  const withBirthday = run(session, { birthDate: '1994-08-08' });
  const without = run(session, { birthDate: null });

  // A standard day is eight hours under either reading, so the columns agree…
  assert.deepEqual(withBirthday.buckets, without.buckets);
  assert.equal(withBirthday.buckets[BUCKETS.OT15_HOLIDAY], 8);
  // …and only the reason says which rule answered.
  assert.equal(withBirthday.segments[0].dayReason, DAY_REASONS.BIRTHDAY);
  assert.equal(without.segments[0].dayReason, DAY_REASONS.WEEKEND);
});

test('วันเกิดตรงวันเสาร์หรือวันหยุดบริษัท — กะเย็นได้ ×3 เท่าวันหยุดทั่วไป', () => {
  // 8 Aug is a Saturday, 12 Aug on the company calendar. Between 2026-09-08 and
  // 2026-10-08 a birthday made 20:00–23:00 ×1.5 here.
  for (const date of ['2026-08-08', '2026-08-12']) {
    const session = { workDate: date, startTime: '20:00', endTime: '23:00' };
    const withBirthday = run(session, { birthDate: `1994-${date.slice(5)}` });
    const without = run(session, { birthDate: null });

    assert.deepEqual(withBirthday.buckets, without.buckets, date);
    assert.equal(withBirthday.buckets[BUCKETS.OT3_HOLIDAY], 3, date);
    assert.equal(withBirthday.segments[0].dayReason, DAY_REASONS.BIRTHDAY, date);
  }
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

/**
 * A TEST STOOD HERE AND CANNOT BE WRITTEN ANY MORE — 2026-09-10.
 *
 * *วันเกิดวันศุกร์ ทำงาน 17:00 ข้ามคืนไปเสาร์ 07:00 — คนละช่อง คนละเหตุผล* was
 * the sharpest case for `applyBirthdayTiers` counting PER DATE: the Friday half
 * was the first seven hours of the filer's own birthday and went ×1.5 whole,
 * while the Saturday half belonged to nobody's birthday and was cut by the
 * clock into ×3. Two rows, identical on paper before 2026-09-08, told apart by
 * `dayReason` after it.
 *
 * No session reaches a second date now, so the two halves are two requests and
 * each is answered on its own. What the per-date accumulator still guarantees
 * is the half below: a birthday's count starts at nought and is spent by the
 * one request that date may carry (หนึ่งวัน หนึ่งใบ).
 */
test('วันเกิดวันศุกร์ ทำงาน 17:00–23:00 — นอกเวลางานทั้งใบ จึง ×3 ทั้งใบ', () => {
  const session = { workDate: '2026-08-07', startTime: '17:00', endTime: '23:00' };
  const r = run(session, { birthDate: '1994-08-07' });

  assert.deepEqual(sessionDates(session), ['2026-08-07']);
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 6, 'ก่อน 2026-10-08 ได้ ×1.5 ทั้งหกชั่วโมง');
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 0);
  assert.equal(r.segments.every((x) => x.date === '2026-08-07'), true);
  assert.equal(r.segments.every((x) => x.dayReason === 'birthday'), true);
});

test('กะที่ข้ามคืนออกไปจากวันเกิด ยื่นไม่ได้แล้ว', () => {
  assert.throws(
    () => run(
      { workDate: '2026-08-07', startTime: '17:00', endTime: '07:00' },
      { birthDate: '1994-08-07' },
    ),
    (e) => e.code === 'END_BEFORE_START',
  );
});

// ── the map is the contract ─────────────────────────────────────────────────

test('dayTypes ที่ไม่มีวันที่ที่ engine ต้องใช้ — ต้อง throw ไม่ใช่เดาว่าเป็น workday', () => {
  const session = { workDate: '2026-08-07', startTime: '17:00', endTime: '23:00' };

  /**
   * THE HOLE USED TO BE THE FAR SIDE OF A MIDNIGHT — a caller resolving only
   * `workDate` on an overnight session handed over a map missing the Saturday.
   * There is no far side since 2026-09-10, so the only map with a hole in it is
   * an empty one, and it must still throw rather than default to `workday`.
   */
  assert.throws(
    () => computeSession(session, { dayTypes: {} }),
    (err) => err instanceof OtValidationError
      && err.code === 'MISSING_DAY_TYPE'
      && err.message.includes('2026-08-07'),
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

  // ตัวเลขเท่ากันเมื่อไม่เกินเพดาน 8 ชม. — ต่างกันแค่เหตุผลบนแถว
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
  /**
   * IT USED TO RETURN TWO — `['2026-08-31', '2026-09-01']` for a 22:00 → 02:00
   * shift, *ข้ามเดือนก็ยังเป็นสองวันที่*. One is the whole answer now, and the
   * late end that once made a second date makes none.
   */
  assert.deepEqual(
    sessionDates({ workDate: '2026-08-31', startTime: '22:00', endTime: '23:59' }),
    ['2026-08-31'],
  );
  // Still parsed on the way through, so a malformed time is refused here rather
  // than being carried to a caller that trusted the answer.
  assert.throws(
    () => sessionDates({ workDate: '2026-08-07', startTime: '17:00', endTime: '25:00' }),
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

// ── ใบพิมพ์ F-HR-027: ตารางเป็นปฏิทินบริษัท ไม่ใช่ปฏิทินของคนใดคนหนึ่ง ────────

/**
 * The grid down the left of the sheet, for one employee's month.
 *
 * Only August is built: 4 Aug is the birthday Tuesday, 8 Aug a Saturday and
 * 12 Aug the company holiday, so one month covers all three reasons a date can
 * be วันหยุด and the ordinary weekdays in between.
 *
 * `formDayTypes` takes no birth date — HR took “วันเกิด” off F-HR-027 Rev.4 on
 * 2026-08-10 and the remark moved to สรุป OT ส่งบัญชี. What is checked here is
 * that the sheet's calendar is the company's for everybody, and that this made
 * no difference to a single hour. Where the remark went, and what it may be
 * computed from, is test/birthdayOnPaper.test.js.
 */
const AUGUST = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
const gridFor = (policy) => formDayTypes(AUGUST, { isHoliday, policy });

test('ตารางในใบฟอร์มเป็นปฏิทินบริษัท — วันเกิดของเจ้าตัวไม่ปรากฏ', () => {
  const grid = gridFor(ON);

  // The birthday Tuesday reads as an ordinary working day on the sheet's grid,
  // with the rule ON. Nothing on the paper renders a day type, so what this
  // removes from the page is the note and only the note.
  assert.deepEqual(grid['2026-08-04'], { type: 'workday', reason: null });

  // Named individually, because "no birthday" also passes when the grid
  // resolves nothing at all.
  assert.deepEqual(grid['2026-08-08'], { type: 'holiday', reason: DAY_REASONS.WEEKEND });
  assert.deepEqual(grid['2026-08-12'], { type: 'holiday', reason: DAY_REASONS.COMPANY_HOLIDAY });
  assert.deepEqual(grid['2026-08-05'], { type: 'workday', reason: null });
});

test('ตารางในใบฟอร์มไม่ขึ้นกับกฎวันเกิดเลย', () => {
  const on = gridFor(ON);
  const off = gridFor(OFF);
  for (const date of AUGUST) {
    assert.deepEqual(off[date], on[date], `${date} ไม่ควรเปลี่ยนตามกฎวันเกิด`);
  }
});

test('ชั่วโมงยังลงช่องวันหยุดตามกฎ ไม่ว่าใบจะพิมพ์อะไร', () => {
  // The consequence HR accepted: 4 Aug prints as an ordinary day number with
  // วันหยุด hours beside it. The figures come from the segments stored when the
  // entry was filed, and the grid above never reaches them.
  const worked = run(
    { workDate: '2026-08-04', startTime: '08:00', endTime: '17:00' },
    { birthDate: '1994-08-04', policy: ON },
  );
  assert.equal(worked.buckets[BUCKETS.OT15_HOLIDAY], 8);
  assert.equal(worked.segments[0].dayReason, DAY_REASONS.BIRTHDAY);
  assert.equal(
    gridFor(ON)['2026-08-04'].type,
    'workday',
    'ใบไม่ได้บอกว่าเป็นวันหยุด และไม่ได้บอกเหตุผล — เจตนา',
  );
});

test('การเลิกใช้ธงบนกระดาษไม่แตะการจำแนก arithmetic / cosmetic', () => {
  // The retired key must be in neither list, and the guard the other way round:
  // the rule that DOES move hours still reads as arithmetic, so the assertion
  // above is not passing for free.
  assert.ok(!ARITHMETIC_KEYS.includes('birthdayReasonOnForm'));
  assert.ok(!COSMETIC_KEYS.includes('birthdayReasonOnForm'));
  assert.equal(sameArithmetic(ON, OFF), false);
  assert.equal(sameArithmetic(ON, { ...ON }), true);
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
