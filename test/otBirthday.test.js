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
 * วันเกิดพนักงานเป็นวันหยุด "เฉพาะคนนั้น" — และตั้งแต่ 2026-09-08 คิดอัตราตาม
 * จำนวนชั่วโมงที่ทำ ไม่ใช่ตามนาฬิกา: 8 ชม. แรก ×1.5 หลังจากนั้น ×3.
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
 * นาฬิกาไม่ได้ตัดสินอีกแล้ว — จำนวนชั่วโมงที่ทำต่างหาก.
 *
 * เคสนี้เคยชื่อ "ก่อน 08:00 และหลัง 17:00 เข้า ot3_holiday" และยืนยันตรงข้ามกับ
 * ที่ยืนยันอยู่ตอนนี้ทุกบรรทัด — เพราะจนถึง 2026-09-08 วันเกิดคือวันหยุดธรรมดา
 * ของคนคนเดียว แบ่งช่องด้วยนาฬิกาเหมือนวันเสาร์ กฎใหม่นับ 8 ชม. แรกที่ "ทำ" ไม่ใช่
 * 8 ชม. ที่ "อยู่ในช่วง 08:00–17:00" กะสั้นที่ไม่ได้เริ่มตอนเช้าจึงยังอยู่ใน ×1.5
 * ทั้งกะ
 */
test('วันเกิดตรงวันอังคาร — กะสั้นนอกเวลางาน ยังอยู่ใน 8 ชม. แรก จึงเป็น ot15_holiday', () => {
  const early = run(
    { workDate: '2026-08-04', startTime: '06:00', endTime: '08:00' },
    { birthDate: '1994-08-04' },
  );
  assert.equal(early.buckets[BUCKETS.OT15_HOLIDAY], 2);
  assert.equal(early.buckets[BUCKETS.OT3_HOLIDAY], 0);

  const late = run(
    { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' },
    { birthDate: '1994-08-04' },
  );
  assert.equal(late.buckets[BUCKETS.OT15_HOLIDAY], 3);
  assert.equal(late.buckets[BUCKETS.OT3_HOLIDAY], 0);

  // Without the rule this is the ordinary weekday evening column.
  const off = run(
    { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' },
    { birthDate: '1994-08-04', policy: OFF },
  );
  assert.equal(off.buckets[BUCKETS.OT15_WEEKDAY], 3);
  assert.equal(off.buckets[BUCKETS.OT3_HOLIDAY], 0);
});

/**
 * 8 ชม. แรก ×1.5 · หลังจากนั้น ×3 — และเส้นแบ่งตัดกลาง segment ได้.
 *
 * 06:00–20:00 หักพักเที่ยงเหลือ 13 ชม. เส้นแบ่งจึงตกที่ 15:00 น. ซึ่งไม่ใช่ขอบของ
 * ช่วงไหนเลย ถ้าเลื่อนไปหาขอบที่ใกล้ที่สุดแทนที่จะตัด คนคนนี้จะได้หรือเสียชั่วโมง
 * เพราะพักเที่ยงบังเอิญตกตรงไหน
 */
test('วันเกิด — 8 ชม. แรก ×1.5 ที่เหลือ ×3 และเส้นแบ่งตัดกลางช่วงได้', () => {
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
      ['06:00', '12:00', BUCKETS.OT15_HOLIDAY],
      ['13:00', '15:00', BUCKETS.OT15_HOLIDAY],
      ['15:00', '20:00', BUCKETS.OT3_HOLIDAY],
    ],
    'ช่วงที่ถูกตัดต้องขึ้นสองแถว และแถวข้างเคียงที่ช่องเดียวกันยังรวมกันเหมือนเดิม',
  );
  assert.ok(
    r.segments.every((x) => x.dayReason === DAY_REASONS.BIRTHDAY),
    'ทั้งวันยังเป็นวันเกิด แม้ครึ่งหลังจะอยู่ช่อง ×3',
  );
  assert.deepEqual(
    r.segments.map((x) => x.multiplier),
    [1.5, 1.5, 3],
    'ตัวคูณบนแถวต้องเดินตามช่องที่ถูกย้าย ไม่ใช่ค้างของเดิม',
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

test('วันเกิดตรงวันเสาร์ — กะเย็นได้ ×1.5 ต่างจากวันเสาร์ธรรมดาที่ได้ ×3', () => {
  const session = { workDate: '2026-08-08', startTime: '20:00', endTime: '23:00' };

  const withBirthday = run(session, { birthDate: '1994-08-08' });
  const without = run(session, { birthDate: null });

  assert.equal(withBirthday.buckets[BUCKETS.OT15_HOLIDAY], 3);
  assert.equal(withBirthday.buckets[BUCKETS.OT3_HOLIDAY], 0);
  assert.equal(without.buckets[BUCKETS.OT3_HOLIDAY], 3);
  assert.equal(without.buckets[BUCKETS.OT15_HOLIDAY], 0);
});

test('วันเกิดตรงวันหยุดบริษัท — ใช้กฎวันเกิดเช่นกัน', () => {
  // 12 Aug 2026 is a Wednesday on the company calendar.
  const session = { workDate: '2026-08-12', startTime: '20:00', endTime: '23:00' };

  const withBirthday = run(session, { birthDate: '1994-08-12' });
  const without = run(session, { birthDate: null });

  assert.equal(withBirthday.segments[0].dayReason, DAY_REASONS.BIRTHDAY);
  assert.equal(withBirthday.buckets[BUCKETS.OT15_HOLIDAY], 3);
  assert.equal(without.segments[0].dayReason, DAY_REASONS.COMPANY_HOLIDAY);
  assert.equal(without.buckets[BUCKETS.OT3_HOLIDAY], 3);
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

  assert.equal(birthdayPerson.buckets[BUCKETS.OT15_HOLIDAY], 3);
  assert.equal(colleague.buckets[BUCKETS.OT15_WEEKDAY], 3);
});

// ── overnight: two holiday segments, two different reasons ──────────────────

test('วันเกิดวันศุกร์ ทำงาน 17:00 ข้ามคืนไปเสาร์ 07:00 — คนละช่อง คนละเหตุผล', () => {
  const session = {
    workDate: '2026-08-07', startTime: '17:00', endTime: '07:00', endsNextDay: true,
  };
  const r = run(session, { birthDate: '1994-08-07' });

  assert.deepEqual(sessionDates(session), ['2026-08-07', '2026-08-08']);

  const friday = r.segments.filter((s) => s.date === '2026-08-07');
  const saturday = r.segments.filter((s) => s.date === '2026-08-08');
  assert.equal(friday.length, 1);
  assert.equal(saturday.length, 1);

  /**
   * นับใหม่ทุกวันที่ — และนี่คือที่ที่มันเห็นได้ชัดที่สุด.
   *
   * ฝั่งศุกร์คือ 7 ชม. แรกของวันเกิด จึงอยู่ ×1.5 ทั้งฝั่ง ส่วนฝั่งเสาร์ไม่ใช่
   * วันเกิดของใคร กฎนาฬิกาของวันหยุดจึงตัดสินตามเดิม เจ็ดชั่วโมงหลังเที่ยงคืนอยู่
   * นอกเวลางาน จึงเป็น ×3 — ตัวเลขรวมเท่าเดิมกับที่เคยเป็นก่อน 2026-09-08 แต่
   * มาจากคนละเหตุผลกันคนละครึ่ง
   *
   * ทั้งสองแถวเคยเป็น ot3_holiday เหมือนกันจนแยกไม่ออกบนกระดาษ ตอนนี้แยกออกได้
   * ตั้งแต่ในช่อง
   */
  assert.equal(friday[0].bucket, BUCKETS.OT15_HOLIDAY);
  assert.equal(saturday[0].bucket, BUCKETS.OT3_HOLIDAY);
  assert.equal(r.buckets[BUCKETS.OT15_HOLIDAY], 7);
  assert.equal(r.buckets[BUCKETS.OT3_HOLIDAY], 7);
  assert.equal(r.buckets[BUCKETS.OT15_WEEKDAY], 0);

  // Arrived there by different rules. Only the Friday half moves if HR turns
  // the birthday rule off again, which is why the reason is recorded.
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

  /**
   * และตั้งแต่ 2026-09-08 สองรูปแบบนี้ให้ "ตัวเลข" ต่างกันได้ ไม่ใช่แค่ป้าย.
   *
   * 'holiday' เปล่า ๆ ไม่ได้บอกว่าเพราะอะไร engine จึงคิดด้วยนาฬิกาแบบวันหยุด
   * ทั่วไป ส่วนรูปแบบที่มี reason: 'birthday' ได้กฎ 8 ชม. แรก ผู้เรียกที่ยังส่ง
   * string ล้วนมาจึงไม่ได้กฎวันเกิด ซึ่งถูกแล้ว — มันไม่ได้อ้างว่าเป็นวันเกิด
   */
  assert.equal(plain.buckets[BUCKETS.OT3_HOLIDAY], 3);
  assert.equal(rich.buckets[BUCKETS.OT15_HOLIDAY], 3);
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

  assert.equal(shifted.buckets[BUCKETS.OT15_HOLIDAY], 3);
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
