/**
 * วันทำงานปกติ ระบุเวลาในช่วง 08:00–16:59 ไม่ได้ — HR, 2026-09-16.
 *
 * OT วันปกติเกิดขึ้นนอกเวลาทำงานเท่านั้น จึงปฏิเสธ "ทั้งใบ" เมื่อมีนาทีใดก็ตาม
 * ตกอยู่ในช่วงนั้น · วันหยุด วันเกิด และใบเหมารายวัน ไม่ถูกแตะ
 *
 * ── WHAT THE RULE CHANGED, AND WHAT IT DID NOT ──────────────────────────────
 *
 * A ใบ lying INSIDE 08:00–17:00 end to end was refused before this existed: it
 * computes to nought OT, and every write path refuses a nought. What was
 * accepted, silently, was the OVERLAP — a Wednesday 15:00–19:00 kept two of its
 * four hours and said nothing about the other two. That is the case these tests
 * are mostly about.
 *
 * Everything here is pure: a session and a policy in, a sentence or null out.
 * The refusal reads `NORMAL_HOURS_IGNORED` off the engine rather than comparing
 * times of its own, which is what keeps 16:59 tied to `bucketFor`'s window — so
 * the boundary tests below run the real engine and never a stub.
 *
 * Dates are August 2026, as in test/otEngine.test.js: 5 Aug Wednesday,
 * 8 Aug Saturday, 12 Aug a company holiday.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  computeSession, makeIsHoliday, resolveDayTypes, sessionDates,
} from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import { coreHoursRefusal, noOtHoursMessage } from '../lib/entries.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const isHoliday = makeIsHoliday(['2026-08-12']);
const ON = { ...DEFAULT_POLICY, birthdayHolidayEnabled: true };

function run(session, { birthDate = null, policy = ON } = {}) {
  return computeSession(session, {
    policy,
    dayTypes: resolveDayTypes(sessionDates(session), { isHoliday, birthDate, policy }),
  });
}

const refusalFor = (session, opts = {}) => coreHoursRefusal(
  run(session, opts),
  opts.policy || ON,
);

// ── วันทำงานปกติ ────────────────────────────────────────────────────────────

test('พุธ 15:00–19:00 — คาบเกี่ยวเวลาทำงาน ปฏิเสธทั้งใบ', () => {
  const msg = refusalFor({ workDate: '2026-08-05', startTime: '15:00', endTime: '19:00' });
  assert.ok(msg, 'ใบที่คาบเกี่ยวต้องถูกปฏิเสธ ไม่ใช่ตัดชั่วโมงทิ้งเงียบ ๆ');
  assert.match(msg, /08:00–16:59/);
  assert.match(msg, /120 นาที/, 'บอกจำนวนนาทีที่ตกอยู่ในเวลาทำงาน');
});

test('พุธ 06:00–10:00 — คาบเกี่ยวทางเช้า ปฏิเสธเหมือนกัน', () => {
  assert.ok(refusalFor({ workDate: '2026-08-05', startTime: '06:00', endTime: '10:00' }));
});

test('พุธ 09:00–16:00 — อยู่ในเวลาทำงานทั้งใบ', () => {
  assert.ok(refusalFor({ workDate: '2026-08-05', startTime: '09:00', endTime: '16:00' }));
});

/**
 * 16:59 ไม่ใช่ 17:00 — the edge HR named on the day, and the reason this reads
 * the engine's window instead of a pair of times written here.
 */
test('พุธ 17:00–20:00 — 17:00 ตรงเป็น OT ยื่นได้', () => {
  assert.equal(refusalFor({ workDate: '2026-08-05', startTime: '17:00', endTime: '20:00' }), null);
});

test('พุธ 05:00–08:00 — สิ้นสุดที่ 08:00 ตรง ยื่นได้', () => {
  assert.equal(refusalFor({ workDate: '2026-08-05', startTime: '05:00', endTime: '08:00' }), null);
});

test('16:59–20:00 ถูกปฏิเสธ — หนึ่งนาทีก็นับ', () => {
  const msg = refusalFor({ workDate: '2026-08-05', startTime: '16:59', endTime: '20:00' });
  assert.ok(msg);
  assert.match(msg, /1 นาที/);
});

/**
 * [OPEN 5] moves the boundary, and the sentence moves with it: on a policy
 * where OT begins at 17:01, 17:00–17:01 is the minute that is still work.
 */
test('ขอบเขตอ่านจากนโยบาย ไม่ใช่ 16:59 ที่เขียนตายไว้', () => {
  const policy = { ...ON, otStartsAtCoreEnd: false };
  const msg = refusalFor(
    { workDate: '2026-08-05', startTime: '17:00', endTime: '20:00' },
    { policy },
  );
  assert.ok(msg, 'เมื่อ OT เริ่ม 17:01 ใบที่เริ่ม 17:00 มีหนึ่งนาทีอยู่ในเวลาทำงาน');
  assert.match(msg, /08:00–17:00/);
  assert.match(msg, /17:01/);
});

// ── สิ่งที่กฎนี้ไม่แตะ ──────────────────────────────────────────────────────

test('เสาร์ 08:00–17:00 — วันหยุดระบุเวลาได้อิสระ', () => {
  assert.equal(refusalFor({ workDate: '2026-08-08', startTime: '08:00', endTime: '17:00' }), null);
});

test('วันหยุดบริษัทกลางสัปดาห์ 08:00–17:00 — ไม่ถูกปฏิเสธ', () => {
  assert.equal(refusalFor({ workDate: '2026-08-12', startTime: '08:00', endTime: '17:00' }), null);
});

test('วันเกิดตรงวันอังคาร 08:00–17:00 — ไม่ถูกปฏิเสธ', () => {
  assert.equal(refusalFor(
    { workDate: '2026-08-04', startTime: '08:00', endTime: '17:00' },
    { birthDate: '1994-08-04' },
  ), null);
});

/**
 * THE EXCEPTIONS ARE NOT CONDITIONS IN `coreHoursRefusal`, and this is the test
 * that says so: the same date, the same times, refused or not according to a
 * `birthDate` the function is never given.
 */
test('วันเดียวกัน คนละคน — กฎขยับตามชนิดของวัน ไม่ใช่ตามเงื่อนไขที่เขียนไว้', () => {
  const session = { workDate: '2026-08-04', startTime: '08:00', endTime: '17:00' };
  assert.equal(refusalFor(session, { birthDate: '1994-08-04' }), null);
  assert.ok(refusalFor(session, { birthDate: '1994-11-20' }));
});

test('ใบเหมารายวัน — ไม่ถูกปฏิเสธ แม้เป็นวันทำงานปกติ', () => {
  const msg = refusalFor({
    workDate: '2026-08-05', startTime: '08:00', endTime: '17:00', flatDaily: true,
  });
  assert.equal(msg, null, 'เหมารายวันไม่ผ่านการแบ่ง bucket จึงไม่มีนาที "นอก OT"');
});

// ── ข้อความเมื่อไม่เหลือชั่วโมง ─────────────────────────────────────────────

/**
 * With the core-hours rule refusing first, a working-day nought reaching
 * `noOtHoursMessage` no longer has core minutes in it — so the 08:00–17:00
 * sentence would name a boundary those times never crossed.
 */
test('ใบวันปกติที่ถูกปัดเศษจนหมด ไม่ถูกอธิบายด้วยเรื่องเวลาทำงาน', () => {
  const policy = {
    ...ON, minimumBufferMinutes: 0, roundingIncrementMinutes: 30, roundingMode: 'floor',
  };
  const session = { workDate: '2026-08-05', startTime: '17:00', endTime: '17:20' };
  const result = run(session, { policy });

  assert.equal(coreHoursRefusal(result, policy), null, 'ไม่มีนาทีใดอยู่ในเวลาทำงาน');
  const msg = noOtHoursMessage(session, policy, null, result);
  assert.match(msg, /ปัดเศษ/);
  assert.doesNotMatch(msg, /08:00/);
});

// ── ทุกทางเขียนถามคำถามเดียวกัน ─────────────────────────────────────────────

/**
 * Source text, the way test/noNativeSelect.test.js and its neighbours check a
 * rule that has to hold in more than one file: a write path that forgets to ask
 * is a screen that refuses and a server that accepts.
 */
test('POST, PATCH และ preview เรียก coreHoursRefusal ทั้งหมด', () => {
  for (const file of [
    'app/api/entries/route.js',
    'app/api/entries/[id]/route.js',
    'app/api/entries/preview/route.js',
  ]) {
    assert.match(read(file), /coreHoursRefusal\(result, ctx\.policy\)/, file);
  }
});

test('ฟอร์มยื่นและกล่องแก้ไขชั่วโมงอ่านคำตอบจาก preview และปิดปุ่มบันทึก', () => {
  const form = read('components/OtForm.jsx');
  assert.match(form, /setCoreHoursRefusal\(res\.coreHoursRefusal \|\| null\)/);
  assert.match(form, /\|\| Boolean\(coreHoursRefusal\)/);

  const queue = read('components/ApprovalQueue.jsx');
  assert.match(queue, /const coreHoursRefusal = preview\?\.coreHoursRefusal \|\| null;/);
  assert.match(queue, /Boolean\(weekdayRefusal\) \|\| Boolean\(coreHoursRefusal\)/);
});
