import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REPORTABLE_STATUSES, reportStatuses } from '../lib/reports.js';

/**
 * สถานะที่นับ บน ตรวจสอบประจำเดือน — WHAT THE FIVE ROWS ARE, AND WHY FIVE.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * The control had three rows from 2026-09-01 to 2026-09-11 and every one of
 * them answered the same question — *how much of this month counts* — so the
 * list only ever WIDENED: อนุมัติแล้วเท่านั้น, then + รอ HR, then everything
 * still alive. Asked for by name on 2026-09-11: *เพิ่มตัวกรองสถานะ "รอ HR"*,
 * with รอหัวหน้าเท่านั้น agreed in the same answer.
 *
 * A single-status row asks a DIFFERENT question — *which step is this month
 * waiting on* — and on this database that is the question with an answer worth
 * having: สิงหาคม 2569 was 225 รอ HR and 73 รอหัวหน้า with no `approved` at
 * all, so the two combined rows and ทั้งหมด all drew very nearly one table and
 * none of them said which of the 298 were HR's to act on.
 *
 * ── THE MISTAKE IT PREVENTS ─────────────────────────────────────────────────
 *
 * **A row whose value the route silently throws away.** `?status=` is not
 * validated back to the caller: `reportStatuses` keeps what it recognises and
 * DROPS the rest, so a row reading `pending-hr`, `pendingHr` or `hr_pending`
 * does not fail — it returns a month with nothing in it, under a filter whose
 * label says the opposite. The screen has no way to tell that from a month that
 * genuinely has no such rows. So every value on the control is round-tripped
 * through the real function here, and it is the reason this is a test rather
 * than a comment.
 *
 * The ORDER is pinned too, and deliberately is not narrow-to-wide any more: the
 * three single statuses first, in the order a ใบ passes through them, then the
 * two combinations. Sorted by width, รอ HR เท่านั้น would sit between two rows
 * that both include `approved` and read as a third size of one question rather
 * than a different one.
 *
 * Not pinned here: that the control is a `PickOne` with no "ทั้งหมด" row —
 * test/queueDropdown.test.js, which owns that component — nor the two constants
 * the ceiling tests compare against, which are test/queueCapUsage.test.js's.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const view = readFileSync(join(ROOT, 'components/HrView.jsx'), 'utf8');

/** The array as the screen declares it, with `ALL_LIVE_STATUSES` resolved. */
const allLive = /const ALL_LIVE_STATUSES = '([^']+)';/.exec(view);
assert.ok(allLive, 'ALL_LIVE_STATUSES หายไปจาก components/HrView.jsx');

const at = view.indexOf('const STATUS_FILTERS = [');
assert.ok(at > 0, 'STATUS_FILTERS หายไปจาก components/HrView.jsx');
const block = view.slice(at, view.indexOf('];', at));
const ROWS = [...block.matchAll(/\{ value: (.+?), label: '([^']+)' \}/g)]
  .map(([, raw, label]) => ({
    value: raw.trim() === 'ALL_LIVE_STATUSES' ? allLive[1] : raw.trim().replace(/^'|'$/g, ''),
    label,
  }));

test('สถานะที่นับ มีห้าแถว เรียงสถานะเดี่ยวสามแถวก่อน แล้วค่อยเป็นชุดรวมสองแถว', () => {
  assert.deepEqual(ROWS, [
    { value: 'approved', label: 'อนุมัติแล้วเท่านั้น' },
    { value: 'pending_hr', label: 'รอ HR เท่านั้น' },
    { value: 'pending_mgr', label: 'รอหัวหน้าเท่านั้น' },
    { value: 'approved,pending_hr', label: 'อนุมัติแล้ว + รอ HR' },
    { value: 'approved,pending_hr,pending_mgr', label: 'ทั้งหมดที่ยังไม่ถูกปฏิเสธ' },
  ]);

  // The shape of that list said as a rule, so a sixth row has to pick a side
  // rather than land wherever it was typed.
  const single = ROWS.filter((r) => !r.value.includes(','));
  const combined = ROWS.filter((r) => r.value.includes(','));
  assert.equal(single.length, 3);
  assert.deepEqual(ROWS.slice(0, 3), single, 'แถวสถานะเดี่ยวต้องอยู่ก่อนแถวชุดรวม');
  assert.deepEqual(ROWS.slice(3), combined);
});

test('ทุกค่าบน สถานะที่นับ รอดจาก reportStatuses ครบถ้วนและเรียงเท่าเดิม', () => {
  for (const { value, label } of ROWS) {
    assert.equal(
      reportStatuses(value).join(','),
      value,
      `แถว "${label}" ส่งค่า ${value} ซึ่งเราต์ทิ้งบางส่วน — เดือนจะว่างโดยไม่มีใครบอก`,
    );
  }
});

test('สถานะที่ยังเดินเรื่องอยู่ทุกตัวมีแถวของตัวเองหนึ่งแถว', () => {
  // THE REASON รอหัวหน้าเท่านั้น WAS ADDED with the row that was asked for: two
  // of the three steps having a row of their own, and the third not, is a gap a
  // reader meets rather than a decision anybody made. A fourth reportable
  // status arriving without a row would be the same gap again.
  const single = new Set(ROWS.filter((r) => !r.value.includes(',')).map((r) => r.value));
  assert.deepEqual([...single].sort(), [...REPORTABLE_STATUSES].sort());
});

test('ค่าเริ่มต้นของ สถานะที่นับ เป็นแถวหนึ่งในลิสต์จริง', () => {
  // `DEFAULT_STATUS` is a bare string beside the array, so nothing but this
  // stops the two from drifting into a screen that opens on a setting its own
  // control cannot show as chosen.
  const def = /const DEFAULT_STATUS = '([^']+)';/.exec(view);
  assert.ok(def, 'DEFAULT_STATUS หายไปจาก components/HrView.jsx');
  assert.ok(
    ROWS.some((r) => r.value === def[1]),
    `ค่าเริ่มต้น ${def[1]} ไม่ตรงกับแถวไหนบน สถานะที่นับ`,
  );
});

test('ไม่มีแถวไหนถือค่าว่าง — จอนี้ไม่มีสถานะ "ไม่ต้องกรอง"', () => {
  // The same claim test/queueDropdown.test.js makes about `allLabel`, made
  // here about the values instead: the widest setting is a real list of three
  // statuses, not the absence of a filter.
  for (const r of ROWS) assert.notEqual(r.value, '');
});
