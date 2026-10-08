import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUCKETS, DAY_REASONS, computeSession, makeIsHoliday, resolveDayTypes, sessionDates,
} from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import { ARITHMETIC_KEYS, COSMETIC_KEYS } from '../lib/policyVersion.js';

/**
 * กฎที่แก้ได้บนหน้าตั้งค่า — 2026-10-08: *ทำให้แก้ไขได้ผ่าน ui ได้แบบยืดหยุ่น
 * ต่อไปจะได้ไม่ต้องมาแก้โค้ดอีก*. ค่าเริ่มต้นทุกค่าคือพฤติกรรมเดิม (ไฟล์อื่นยืนยัน
 * ด้วยการผ่านเหมือนเดิม) ไฟล์นี้ยืนยันว่าแต่ละค่าเปลี่ยนตัวเลขตามที่หน้าจอบอก.
 *
 * 8 Aug 2026 is a Saturday, 4 Aug a Tuesday.
 */
const isHoliday = makeIsHoliday([]);
function run(session, patch = {}, birthDate = null) {
  const policy = { ...DEFAULT_POLICY, birthdayHolidayEnabled: true, ...patch };
  return computeSession(session, {
    policy,
    dayTypes: resolveDayTypes(sessionDates(session), { isHoliday, birthDate, policy }),
  });
}
const SAT = { workDate: '2026-08-08', startTime: '05:00', endTime: '20:00' };
const b = (r) => [r.buckets[BUCKETS.OT15_HOLIDAY], r.buckets[BUCKETS.OT3_HOLIDAY]];

test('ค่าใหม่ทุกค่าจัดกลุ่มแล้ว — ข้อที่เปลี่ยนชั่วโมงอยู่ใน ARITHMETIC_KEYS', () => {
  for (const k of ['holidayCoreRate', 'holidayOuterRate', 'noBreakRate', 'birthdaySplit',
    'birthdayOnHoliday', 'birthdayNoBreak']) {
    assert.ok(ARITHMETIC_KEYS.includes(k), k);
  }
  assert.ok(COSMETIC_KEYS.includes('replayApproved'));
});

test('อัตราวันหยุด ในเวลางาน / นอกเวลางาน', () => {
  assert.deepEqual(b(run(SAT)), [8, 6]);
  assert.deepEqual(b(run(SAT, { holidayCoreRate: 3 })), [0, 14]);
  assert.deepEqual(b(run(SAT, { holidayOuterRate: 1.5 })), [14, 0]);
});

test('วันที่ติ๊กไม่พักเที่ยง — ตามอัตราวันหยุด หรือ ×1.5 ทั้งวัน', () => {
  const s = { ...SAT, noBreakTaken: true };
  assert.deepEqual(b(run(s)), [9, 6]);
  assert.deepEqual(b(run(s, { noBreakRate: 'all15' })), [15, 0]);
  // ไม่ติ๊ก — ค่านี้ไม่มีผล
  assert.deepEqual(b(run(SAT, { noBreakRate: 'all15' })), [8, 6]);
});

test('วันเกิด — ตามนาฬิกา หรือ ตามชั่วโมงที่ทำ', () => {
  const s = { workDate: '2026-08-04', startTime: '05:00', endTime: '17:00' };
  const clock = run(s, {}, '1994-08-04');
  assert.deepEqual(b(clock), [8, 3]);
  const worked = run(s, { birthdaySplit: 'worked' }, '1994-08-04');
  assert.deepEqual(b(worked), [8, 3]);
  assert.deepEqual(
    worked.segments.map((x) => [x.start, x.end, x.multiplier]),
    [['05:00', '12:00', 1.5], ['13:00', '14:00', 1.5], ['14:00', '17:00', 3]],
  );
  // ตามชั่วโมงที่ทำ: กะเย็นเป็นชั่วโมงแรกของวัน จึง ×1.5
  const evening = { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' };
  assert.deepEqual(b(run(evening, { birthdaySplit: 'worked' }, '1994-08-04')), [3, 0]);
  assert.deepEqual(b(run(evening, {}, '1994-08-04')), [0, 3]);
});

test('วันเกิดที่ตรงวันเสาร์ — ใช้กฎวันเกิด หรือ กฎวันหยุดทั่วไป', () => {
  const s = { workDate: '2026-08-08', startTime: '17:00', endTime: '20:00' };
  const asBirthday = run(s, { birthdaySplit: 'worked' }, '1994-08-08');
  assert.equal(asBirthday.segments[0].dayReason, DAY_REASONS.BIRTHDAY);
  assert.deepEqual(b(asBirthday), [3, 0]);
  const asHoliday = run(s, { birthdaySplit: 'worked', birthdayOnHoliday: 'holiday' }, '1994-08-08');
  assert.equal(asHoliday.segments[0].dayReason, DAY_REASONS.WEEKEND);
  assert.deepEqual(b(asHoliday), [0, 3]);
  // วันเกิดที่ไม่ใช่วันหยุดบริษัท ยังเป็นวันเกิด
  const tue = run({ ...s, workDate: '2026-08-04' }, { birthdayOnHoliday: 'holiday' }, '1994-08-04');
  assert.equal(tue.segments[0].dayReason, DAY_REASONS.BIRTHDAY);
});

test('ไม่พักเที่ยงในวันเกิด — ซ่อนแล้วไม่นับ หรือ นับตามปกติ', () => {
  const s = { workDate: '2026-08-08', startTime: '08:00', endTime: '17:00', noBreakTaken: true };
  const hidden = run(s, {}, '1994-08-08');
  assert.equal(hidden.noBreakTaken, false);
  assert.equal(hidden.totals.otHours, 8);
  const shown = run(s, { birthdayNoBreak: 'scope' }, '1994-08-08');
  assert.equal(shown.noBreakTaken, true);
  // เก้าชั่วโมงในเวลางาน — เพดาน ×1.5 ของวันเกิดตัดชั่วโมงที่เก้าเป็น ×3
  assert.deepEqual(b(shown), [8, 1]);
});

test('เวลาทำงานปกติและช่วงพักเที่ยงจากนโยบาย ย้ายเส้นแบ่งตาม', () => {
  const r = run(SAT, { coreStartMinute: 9 * 60, coreEndMinute: 18 * 60,
    breakWindowStartMinute: 12 * 60 + 30, breakWindowEndMinute: 13 * 60 + 30 });
  // 05–09 ×3 (4) · 09–12:30 + 13:30–18 ×1.5 (8) · 18–20 ×3 (2)
  assert.deepEqual(b(r), [8, 6]);
  assert.equal(r.segments[0].end, '09:00');
});

test('บันทึกนโยบาย — ค่าที่หน้าจอเสนอไม่ได้ ถูกปฏิเสธก่อนเขียน', async () => {
  const { policyValueRefusal } = await import('../lib/policySave.js');
  const cur = DEFAULT_POLICY;
  assert.equal(policyValueRefusal({ holidayCoreRate: 3 }, cur), null);
  assert.ok(policyValueRefusal({ holidayCoreRate: 2 }, cur));
  assert.ok(policyValueRefusal({ birthdaySplit: 'x' }, cur));
  assert.equal(policyValueRefusal({ weekendDays: [0] }, cur), null);
  assert.ok(policyValueRefusal({ weekendDays: [7] }, cur));
  assert.ok(policyValueRefusal({ weekendDays: [0, 0] }, cur));
  assert.ok(policyValueRefusal({ coreStartMinute: 17 * 60 }, cur), 'เข้างานหลังเลิกงาน');
  assert.ok(policyValueRefusal({ breakWindowStartMinute: 7 * 60 }, cur), 'พักนอกเวลางาน');
  assert.ok(policyValueRefusal({ coreEndMinute: 24 * 60 }, cur));
  assert.equal(policyValueRefusal({ coreStartMinute: 9 * 60, coreEndMinute: 18 * 60 }, cur), null);
});

test('ประโยคเวลางานและอัตราวันเกิดบนฟอร์ม มาจากนโยบาย', async () => {
  const { workHoursSay, workDaysLabel, birthdayRateSay } = await import('../lib/entries.js');
  assert.equal(workHoursSay(), 'เวลาทำงานปกติ จันทร์–ศุกร์ 08:00–17:00 น.');
  assert.equal(workHoursSay({ coreStartMinute: 540, coreEndMinute: 1080, weekendDays: [0] }),
    'เวลาทำงานปกติ จันทร์–เสาร์ 09:00–18:00 น.');
  assert.equal(workDaysLabel([0, 3]), 'จันทร์ อังคาร พฤหัสบดี ศุกร์ เสาร์');
  assert.equal(birthdayRateSay({ birthdaySplit: 'worked' }), '8 ชั่วโมงแรกที่ทำเข้าช่อง OT วันหยุด ×1.5 ส่วนที่เกินเข้าช่อง ×3');
  assert.equal(birthdayRateSay({ holidayCoreRate: 3 }), 'ทุกชั่วโมงเข้าช่อง OT วันหยุด ×3');
});

test('หน้าตั้งค่ามีแถวของทุกค่าใหม่ เลขข้อเรียง กลุ่ม.ลำดับ และ คำอธิบาย อยู่หลังชื่อ', async () => {
  const { readFileSync } = await import('node:fs');
  const admin = readFileSync(new URL('../components/AdminView.jsx', import.meta.url), 'utf8');
  for (const k of ['holidayCoreRate', 'holidayOuterRate', 'noBreakRate', 'birthdaySplit',
    'birthdayOnHoliday', 'birthdayNoBreak', 'replayApproved', 'weekendDays']) {
    assert.ok(admin.includes(`key: '${k}'`), `ไม่มีแถว ${k}`);
  }
  assert.match(admin, /key: 'coreHours', keys: \['coreStartMinute', 'coreEndMinute'\], time: true,/);
  assert.match(admin, /key: 'lunchWindow', keys: \['breakWindowStartMinute', 'breakWindowEndMinute'\], time: true,/);
  assert.match(admin, /\{ id: 2, title: 'อัตรา OT' \}/);
  assert.match(admin, /return `\$\{f\.section\}\.\$\{nth\[f\.section\]\}`;/);
  assert.match(admin, /\{`ข้อ \$\{ROW_LABEL\[i\]\}`\}/);
  assert.match(admin, /คำถามข้อ \{f\.open\} ในเอกสารข้อกำหนด/);
  assert.match(admin, /\{f\.label\}\s*\n\s*\{detail && \(\s*\n\s*<button[\s\S]*?คำอธิบาย \{explainedOpen/);
});
