import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SYSTEM_LOG_ACTIONS, isSystemLog, humanHistory } from '../lib/entries.js';

/**
 * ประวัติรายการ ในป๊อปอัปของผู้ตรวจ — แถวที่คนทำ กับแถวที่ระบบทำ.
 *
 * Asked for on 2026-09-07: the reviewer's pop-up on รออนุมัติ OT should list
 * the actions PEOPLE took — ยื่นคำขอ · อนุมัติ · ไม่อนุมัติ · แก้ไข — and stop
 * listing ระบบคำนวณใหม่ตามนโยบาย, which is a run that walked the month rather
 * than anything the reviewer is being asked about. After a policy change or a
 * holiday-calendar edit every request in the queue carries one, and on a phone
 * they push the rows that matter below the fold.
 *
 * TWO HALVES ARE PINNED HERE, and the second is the one that could rot quietly.
 *
 * ONE — the filter and its edges: it hides only generated rows, it is OFF by
 * default, and an entry whose whole history is replays draws no heading at all
 * rather than a heading over an empty list.
 *
 * TWO — WHERE IT IS NOT ON. The rows stay in the database and stay on every
 * screen whose question is "what has happened to this entry": ประวัติ OT
 * ของฉัน has to be able to show its owner that the hours moved with nobody
 * touching the request, and ฝ่ายบุคคล's month table is where a replay gets
 * checked. A later "tidy up the history" that switched those on too would take
 * the only sight of a replay away from the two people entitled to it.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const common = read('components/common.jsx');
const queue = read('components/ApprovalQueue.jsx');
const employee = read('components/EmployeeView.jsx');
const hrEntries = read('components/HrEntries.jsx');

/** The pop-up only — the queue table above it draws no history. */
const modal = queue.slice(queue.indexOf('function DetailModal'));
/* The notes quote the shapes they replaced, which is the point of them. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const ev = (action) => ({ action, at: new Date('2026-09-07T10:00:00Z') });

// ── the list itself ─────────────────────────────────────────────────────────

test('ระบบคำนวณใหม่ตามนโยบาย is a system row, and today it is the only one', () => {
  assert.deepEqual([...SYSTEM_LOG_ACTIONS], ['recompute']);
  assert.equal(isSystemLog(ev('recompute')), true);
});

test('nothing a person did counts as a system row', () => {
  const human = [
    'submit', 'submit_proxy', 'resubmit', 'edit', 'hr_edit',
    'approve_mgr', 'reject_mgr', 'approve_hr', 'reject_hr',
    'cancel', 'void', 'withdraw_request', 'withdraw_grant', 'withdraw_refuse',
  ];
  for (const action of human) assert.equal(isSystemLog(ev(action)), false, action);
  /*
   * The two that LOOK generated and are not. 'submit_birthday' IS a row the
   * system wrote, but it is the filing — hiding it would leave a reader
   * looking for the request that put this entry in the queue and finding
   * nothing at all. 'submit_hr_verified' is ฝ่ายบุคคล reading a scan record
   * and putting their name to two times, which is a person's act throughout.
   */
  assert.equal(isSystemLog(ev('submit_birthday')), false);
  assert.equal(isSystemLog(ev('submit_hr_verified')), false);
});

test('humanHistory keeps the order and drops only the generated rows', () => {
  const entry = { history: [ev('submit'), ev('recompute'), ev('hr_edit'), ev('approve_mgr')] };
  assert.deepEqual(humanHistory(entry).map((h) => h.action), ['submit', 'hr_edit', 'approve_mgr']);
});

test('an entry that is nothing but replays has nothing left to draw', () => {
  assert.equal(humanHistory({ history: [ev('recompute'), ev('recompute')] }).length, 0);
});

test('no history, or no entry at all, does not throw', () => {
  assert.equal(humanHistory({}).length, 0);
  assert.equal(humanHistory(null).length, 0);
  assert.equal(isSystemLog(null), false);
  assert.equal(isSystemLog({}), false);
});

// ── the switch, and where it is thrown ──────────────────────────────────────

test('EntryHistory takes the switch, and it is off unless asked for', () => {
  assert.ok(common.includes('export function EntryHistory({ entry, hideSystem = false })'));
  assert.ok(common.includes('if (hideSystem && isSystemLog(h)) return null;'));
});

test('a list left with nothing visible draws no list for the heading to sit over', () => {
  assert.ok(common.includes('if (hideSystem && !items.some((h) => !isSystemLog(h))) return null;'));
});

test('the walk that pairs each snapshot with its result still reads the FULL history', () => {
  /*
   * The regression this guards. editsOf() finds what an edit produced by
   * reading the row below it, so it has to see every row — a replay that moved
   * the hours is what the edit under it was made against. Filtering the list
   * it walks would hand that edit the wrong "before" and print a change
   * nobody made.
   */
  assert.ok(common.includes('const afters = new Map(editsOf(entry).map((e) => [e.index, e.after]));'));
  assert.ok(!common.includes('editsOf(humanHistory'));
});

test('the chain view hands the switch down rather than deciding for itself', () => {
  assert.ok(common.includes('export function RequestTrail({ requests, liveStatus, hideSystem = false })'));
  assert.ok(common.includes('<EntryHistory entry={r} hideSystem={hideSystem} />'));
});

test('the reviewer pop-up throws it, on one request and on a whole chain', () => {
  const code = strip(modal);
  assert.ok(code.includes('<EntryHistory entry={e} hideSystem />'));
  assert.ok(code.includes('<RequestTrail requests={trail.requests} liveStatus={e.status} hideSystem />'));
});

test('and the heading is drawn on what will be shown, not on what is stored', () => {
  const code = strip(modal);
  assert.ok(code.includes('humanHistory(e).length > 0'));
  assert.ok(!code.includes('(e.history || []).length > 0'));
});

// ── and where it is deliberately not thrown ─────────────────────────────────

test('the employee’s own ประวัติรายการ still shows the replays', () => {
  assert.ok(!employee.includes('hideSystem'));
});

test('ฝ่ายบุคคล’s month table still shows them too', () => {
  assert.ok(!hrEntries.includes('hideSystem'));
});
