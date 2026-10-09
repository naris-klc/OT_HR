import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REPORTABLE_STATUSES, reportStatuses } from '../lib/reports.js';

/**
 * แท็บสถานะ บน ตรวจสอบประจำเดือน — ทั้งหมด · รอ HR · รอหัวหน้า · อนุมัติแล้ว.
 *
 * 2026-10-09 แทนดรอปดาวน์ สถานะที่นับ (สี่แถวตั้งแต่ 2026-10-08 ห้าแถวก่อนนั้น)
 * ผู้ใช้ถาม *"ทำไมกรองอนุมัติแล้ว แต่ยังมีรายการรอhr"* แล้วนิยามว่าแท็บกรอง **คน**:
 *   · ทั้งหมด — ทุกคน · จอเปิดมาที่นี่
 *   · รอ HR — คนที่มีใบรอ HR · ชั่วโมงนับ อนุมัติแล้ว + รอ HR
 *   · รอหัวหน้า — คนที่มีใบรอหัวหน้า · ชั่วโมงนับเฉพาะใบรอหัวหน้า
 *   · อนุมัติแล้ว — เฉพาะคนที่ไม่มีใบค้างเลย
 *
 * ── THE MISTAKE IT PREVENTS ─────────────────────────────────────────────────
 *
 * **A tab whose value the route silently throws away.** `reportStatuses` keeps
 * what it recognises and DROPS the rest, so a tab reading `pending-hr` returns
 * an empty month under a label that says otherwise. Every value is
 * round-tripped through the real function here — and every `keep` is run
 * against the four shapes of a month a person can be in.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const view = readFileSync(join(ROOT, 'components/HrView.jsx'), 'utf8');

/** The array as the screen declares it, with `ALL_LIVE_STATUSES` resolved. */
const allLive = /const ALL_LIVE_STATUSES = '([^']+)';/.exec(view);
assert.ok(allLive, 'ALL_LIVE_STATUSES หายไปจาก components/HrView.jsx');

const at = view.indexOf('const MONTH_TABS = [');
assert.ok(at > 0, 'MONTH_TABS หายไปจาก components/HrView.jsx');
const block = view.slice(at, view.indexOf('\n];', at));
const ROWS = [...block.matchAll(/value: (.+?), label: '([^']+)', count: '([^']+)'/g)]
  .map(([, raw, label, count]) => ({
    value: raw.trim() === 'ALL_LIVE_STATUSES' ? allLive[1] : raw.trim().replace(/^'|'$/g, ''),
    label,
    count,
  }));
/** Each tab's `keep`, evaluated from the source — the predicate the screen runs. */
const KEEP = [...block.matchAll(/keep: (\([^)]*\) => .+?)(?:, empty:| \},)/g)]
  // eslint-disable-next-line no-new-func
  .map(([, fn]) => new Function(`return ${fn}`)());

test('สี่แท็บ เรียง ทั้งหมด · รอ HR · รอหัวหน้า · อนุมัติแล้ว', () => {
  assert.deepEqual(ROWS, [
    { value: 'approved,pending_hr,pending_mgr', label: 'ทั้งหมด', count: 'all' },
    { value: 'approved,pending_hr', label: 'รอ HR', count: 'pendingHr' },
    { value: 'pending_mgr', label: 'รอหัวหน้า', count: 'pendingMgr' },
    { value: 'approved', label: 'อนุมัติแล้ว', count: 'approved' },
  ]);
});

test('ทุกค่าบนแท็บ รอดจาก reportStatuses ครบถ้วนและเรียงเท่าเดิม', () => {
  for (const { value, label } of ROWS) {
    assert.equal(
      reportStatuses(value).join(','),
      value,
      `แท็บ "${label}" ส่งค่า ${value} ซึ่งเราต์ทิ้งบางส่วน — เดือนจะว่างโดยไม่มีใครบอก`,
    );
  }
});

test('ทั้งหมด คือทุกสถานะที่ยังเดินเรื่องอยู่', () => {
  assert.deepEqual(ROWS[0].value.split(',').sort(), [...REPORTABLE_STATUSES].sort());
});

test('แท็บกรองคนตามใบที่ยังค้างทั้งเดือน', () => {
  assert.equal(KEEP.length, 4, 'keep ของแท็บอ่านไม่ครบสี่ตัว');
  const [all, hr, mgr, ok] = KEEP;
  const cleared = { approved: 5, pendingHr: 0, pendingMgr: 0 };
  const atHr = { approved: 2, pendingHr: 11, pendingMgr: 0 }; // คุณเกษร ในภาพของผู้ใช้
  const atMgr = { approved: 0, pendingHr: 0, pendingMgr: 2 };
  const both = { approved: 3, pendingHr: 1, pendingMgr: 1 };
  for (const m of [cleared, atHr, atMgr, both]) assert.ok(all(m));
  assert.deepEqual([cleared, atHr, atMgr, both].map(hr), [false, true, false, true]);
  assert.deepEqual([cleared, atHr, atMgr, both].map(mgr), [false, false, true, true]);
  // *"เฉพาะคนที่เคลียร์หมดแล้ว"* — ใบอนุมัติแล้ว 2 ใบไม่พอให้ขึ้นแท็บนี้
  assert.deepEqual([cleared, atHr, atMgr, both].map(ok), [true, false, false, false]);
});

test('เลขบนแท็บมาจาก tabCounts ของเราต์ ช่องตรงกับ count ของแต่ละแท็บ', () => {
  const route = readFileSync(join(ROOT, 'app/api/reports/monthly/[period]/route.js'), 'utf8');
  assert.match(route, /const tabCounts = \{ all: 0, pendingHr: 0, pendingMgr: 0, approved: 0 \};/);
  assert.match(route, /\n    tabCounts,\n/);
  assert.match(view, /data\.tabCounts\[t\.count\]/);
  // ป้าย `N คน` ข้างปุ่มไฟล์สแกนออกไปแล้ว — ผู้ใช้อ่านมันเป็นจำนวนที่นำเข้าไฟล์สแกน
  assert.ok(!view.includes('<span className="chip muted">{data.employees.length} คน</span>'));
});

test('เลขบนแท็บสีตามสถานะ เท่ากับป้ายสถานะ · ทั้งหมด และ 0 เป็นเทา', () => {
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  assert.match(view, /label: 'รอ HR', count: 'pendingHr', tone: 'pending_hr'/);
  assert.match(view, /label: 'รอหัวหน้า', count: 'pendingMgr', tone: 'pending_mgr'/);
  assert.match(view, /label: 'อนุมัติแล้ว', count: 'approved', tone: 'approved'/);
  // ไม่มี tone หรือเลขเป็น 0 → ไม่มีคลาสสี
  assert.match(view, /t\.tone && data\.tabCounts\[t\.count\] \? ` st-\$\{t\.tone\}` : ''/);
  for (const [st, pair] of [
    ['pending_hr', 'background: var(--info-bg); color: var(--info);'],
    ['pending_mgr', 'background: var(--amber-bg); color: var(--amber);'],
    ['approved', 'background: var(--green-bg); color: var(--green-dark);'],
  ]) {
    assert.ok(css.includes(`.chip.st-${st} { ${pair} }`), `ป้าย ${st}`);
    // `button` ทำให้ชนะ `.month-tabs button.active .count` ที่อยู่ก่อน
    const rule = `.month-tabs button .count.st-${st} { ${pair} }`;
    assert.ok(css.indexOf(rule) > css.indexOf('.month-tabs button.active .count {'), `แท็บ ${st}`);
  }
});

test('จอเปิดมาที่ ทั้งหมด — แท็บแรก', () => {
  assert.match(view, /const DEFAULT_STATUS = ALL_LIVE_STATUSES;/);
  assert.match(view, /useState\(DEFAULT_STATUS\)/);
});

test('ไม่มีแท็บไหนถือค่าว่าง — จอนี้ไม่มีสถานะ "ไม่ต้องกรอง"', () => {
  for (const r of ROWS) assert.notEqual(r.value, '');
});
