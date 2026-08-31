import test from 'node:test';
import assert from 'node:assert/strict';
import { previousMonthOutstanding } from '../lib/periodStatus.js';

/**
 * เตือนว่าเดือนก่อนหน้ายังมีของค้าง.
 *
 * ฝ่ายบุคคล arrive on ตรวจสอบรายเดือน on the current month. The month that
 * ENDED is the one they are about to print, and nothing else on that screen
 * mentions it.
 *
 * THIS REMINDER CHANGED SHAPE ON 2026-08-31 RATHER THAN BEING DELETED, and the
 * change is the whole subject of this file. It used to speak whenever last month
 * was not CLOSED. `otPeriodLocks` was empty on the live database every time it
 * was counted — not one period was ever closed — so it would have spoken on
 * every visit to every month, about quiet finished months with nothing wrong
 * with them. A line that is always there is a line nobody reads.
 *
 * ปิดงวด was withdrawn (see lib/periodStatus.js: the printed and signed
 * F-HR-027 in the filing cabinet is the record). There is no "closed" to be
 * missing now, so the only thing worth saying about last month is the thing that
 * was worth saying all along: somebody still has to answer something in it.
 *
 * Run with: npm test
 */

/** The /periods/<prev> reply, as the card receives it. */
const prev = (entries, extra = {}) => ({ entries, checks: { entries, ...extra } });

test('เดือนก่อนหน้ายังมีใบค้างอนุมัติ — เตือน และบอกว่าค้างอะไร', () => {
  const last = previousMonthOutstanding(prev(12, { pending: 3 }));
  assert.equal(last.entries, 12);
  assert.deepEqual(last.outstanding.map((i) => i.kind), ['pending']);
  assert.match(last.outstanding[0].short, /3 ใบ/);
});

test('คำขอถอนใบค้างพิจารณาในเดือนก่อน ก็เตือนเหมือนกัน', () => {
  // The entry is `approved`, so it is invisible to the pending count — and the
  // row on last month's sheet may still be about to come off it.
  const last = previousMonthOutstanding(prev(9, { openWithdrawals: 1 }));
  assert.deepEqual(last.outstanding.map((i) => i.kind), ['openWithdrawals']);
});

test('เดือนก่อนหน้าเคลียร์หมดแล้ว — เงียบ', () => {
  // THE CHANGE, AND THE WHOLE OF IT. This month would have nagged under the old
  // rule — it is not closed and never will be — and there is nothing to do
  // about it, which is exactly when a reminder should say nothing.
  assert.equal(previousMonthOutstanding(prev(12)), null);
});

test('ควรตรวจ ไม่ใช่ของค้าง — ไม่เตือนข้ามเดือน', () => {
  /**
   * An over-cap or below-minimum entry is approved and final. It is worth a
   * glance on the month being printed, which is where the card shows it; it is
   * not worth a line on NEXT month's screen, because nobody has to answer it
   * and it will never clear.
   */
  assert.equal(previousMonthOutstanding(prev(12, { capExceeded: 4, belowMinimum: 2 })), null);
});

/**
 * The reason the counts include `entries` at all. Every month before this system
 * was installed has nothing in it, and a prompt that mentions them is a prompt
 * people learn to scroll past.
 */
test('เดือนที่ไม่มีใครทำ OT — เงียบ', () => {
  assert.equal(previousMonthOutstanding(prev(0, { pending: 2 })), null);
  assert.equal(previousMonthOutstanding({ checks: {} }), null, 'ไม่มี entries = ไม่รู้ = ไม่เตือน');
});

test('ดึงข้อมูลเดือนก่อนไม่สำเร็จ — เงียบ ไม่ใช่พัง', () => {
  // The card fetches last month separately and swallows the failure: a reminder
  // that cannot be loaded is not a reason to break the month being looked at.
  assert.equal(previousMonthOutstanding(null), null);
  assert.equal(previousMonthOutstanding(undefined), null);
});
