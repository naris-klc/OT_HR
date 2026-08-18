import test from 'node:test';
import assert from 'node:assert/strict';
import { previousMonthOpen } from '../lib/periodLock.js';

/**
 * เตือนว่าเดือนก่อนหน้ายังไม่ได้ปิด.
 *
 * ปิดงวด has existed and worked for as long as ตรวจสอบรายเดือน has, and the
 * live database has `otPeriodLocks: 0` — not one period has ever been closed.
 * The bar was never wrong; it was never asked. HR arrives on the current month,
 * reads a bar correctly reporting an open period (you do not close the month
 * you are in), and nothing anywhere mentions the month that ended.
 */

const open = (entries, pending = 0) => ({ closed: false, pending, checks: { entries } });

test('เดือนก่อนหน้าเปิดอยู่และมีรายการ — เตือน', () => {
  assert.deepEqual(previousMonthOpen(open(12, 3)), { entries: 12, pending: 3 });
});

test('ปิดไปแล้ว — เงียบ', () => {
  assert.equal(previousMonthOpen({ closed: true, checks: { entries: 12 } }), null);
});

/**
 * The reason `closeChecks` now counts entries at all. Every month before this
 * system was installed is an unclosed month with nothing in it, and a prompt
 * that mentions them is a prompt people learn to scroll past.
 */
test('เดือนที่ไม่มีใครทำ OT — เงียบ ถึงจะยังไม่ได้ปิด', () => {
  assert.equal(previousMonthOpen(open(0)), null);
  assert.equal(previousMonthOpen({ closed: false, checks: {} }), null, 'ไม่มี entries = ไม่รู้ = ไม่เตือน');
});

test('ดึงข้อมูลเดือนก่อนไม่สำเร็จ — เงียบ ไม่ใช่พัง', () => {
  assert.equal(previousMonthOpen(null), null);
  assert.equal(previousMonthOpen(undefined), null);
});

/**
 * ค้างอนุมัติ is reported but does not silence the reminder. A month cannot be
 * closed while requests are pending — which makes it MORE worth saying, not
 * less: the reason last month is still open is sitting in somebody's queue.
 */
test('ยังมีใบค้างอนุมัติ ก็ยังเตือน และบอกจำนวนไปด้วย', () => {
  assert.deepEqual(previousMonthOpen(open(5, 2)), { entries: 5, pending: 2 });
});
