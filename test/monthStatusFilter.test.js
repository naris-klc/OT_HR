import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REPORTABLE_STATUSES, reportStatuses } from '../lib/reports.js';

/**
 * สถานะที่นับ บน ตรวจสอบประจำเดือน — สี่แถว เรียงตามทางที่ใบเดินผ่าน.
 *
 * 2026-10-08 ผู้ใช้บอกว่าห้าแถวเดิมซ้ำซ้อน แล้วเลือกจาก mockup: รอหัวหน้า ·
 * รอ HR · อนุมัติแล้ว · ทั้งหมด โดยนิยามไว้เองว่า
 *   · รอ HR รวมใบอนุมัติแล้ว — *"ก่อนจะรอ HR ต้องหัวหน้าอนุมัติมาก่อนอยู่แล้ว"*
 *   · อนุมัติแล้ว = *"ต้องไม่มีสถานะรอใครแล้วเท่านั้น"* คือ `approved` อย่างเดียว
 *   · จอเปิดมาที่ ทั้งหมด
 *
 * ── THE MISTAKE IT PREVENTS ─────────────────────────────────────────────────
 *
 * **A row whose value the route silently throws away.** `reportStatuses` keeps
 * what it recognises and DROPS the rest, so a row reading `pending-hr` returns
 * an empty month under a label that says otherwise. Every value is
 * round-tripped through the real function here.
 *
 * (Five rows from 2026-09-11 to 2026-10-08, three before that — see git.)
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

test('สถานะที่นับ มีสี่แถว เรียงตามทางที่ใบเดินผ่าน แล้วปิดด้วยทั้งหมด', () => {
  assert.deepEqual(ROWS, [
    { value: 'pending_mgr', label: 'รอหัวหน้า' },
    { value: 'approved,pending_hr', label: 'รอ HR' },
    { value: 'approved', label: 'อนุมัติแล้ว' },
    { value: 'approved,pending_hr,pending_mgr', label: 'ทั้งหมด' },
  ]);
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

test('ทุกสถานะที่ยังเดินเรื่องอยู่ถูกนับได้ในอย่างน้อยหนึ่งแถว และทั้งหมดคือครบทุกตัว', () => {
  const covered = new Set(ROWS.flatMap((r) => r.value.split(',')));
  assert.deepEqual([...covered].sort(), [...REPORTABLE_STATUSES].sort());
  assert.deepEqual(ROWS.at(-1).value.split(',').sort(), [...REPORTABLE_STATUSES].sort());
});

test('จอเปิดมาที่ ทั้งหมด — แถวสุดท้ายของลิสต์', () => {
  // ผู้ใช้สั่ง *"ให้เริ่มที่ทั้งหมด"* 2026-10-08 · ตรงกับนโยบายการพิมพ์ที่ส่งมา
  // (`draft`) ซึ่งพิมพ์ทุกใบที่ยังไม่ถูกปฏิเสธ
  assert.match(view, /const DEFAULT_STATUS = ALL_LIVE_STATUSES;/);
  assert.match(view, /useState\(DEFAULT_STATUS\)/);
});

test('ไม่มีแถวไหนถือค่าว่าง — จอนี้ไม่มีสถานะ "ไม่ต้องกรอง"', () => {
  // The same claim test/queueDropdown.test.js makes about `allLabel`, made
  // here about the values instead: the widest setting is a real list of three
  // statuses, not the absence of a filter.
  for (const r of ROWS) assert.notEqual(r.value, '');
});
