import test from 'node:test';
import assert from 'node:assert/strict';
import { unsignedStaff, signingCoveragePermission } from '../lib/employees.js';

/**
 * เซ็นให้บริษัท ตัดคนออกจากสายอนุมัติโดยไม่มีใครรู้.
 *
 * `signingScope` validates a company key and nothing else — it never sees the
 * roster, so it cannot tell "เซ็นให้ไพรมัส" applied to a หัวหน้า whose แผนก also
 * holds Themtech staff from the same words applied to one where it changes
 * nothing. Counted against the live roster on 2026-08-18: QC holds 1 Themtech
 * person and WH holds 1, and both departments have only a Primus หัวหน้า. Today
 * every `approvesCompany` is null, so both are covered; the day somebody
 * narrows either scope, those two have nobody, the save succeeds, and the first
 * anyone hears of it is an OT request that will not move off `pending_mgr`.
 */

const DEPT = 'dept-qc';
const mgr = (code, approvesCompany = null, company = 'primus') => ({
  _id: code, code, name: code, role: 'manager', department: DEPT, company, approvesCompany,
});
const staff = (code, company) => ({
  _id: code, code, name: code, role: 'employee', department: DEPT, company,
});

test('หัวหน้าที่ไม่กำหนดบริษัท เซ็นให้ได้ทุกคนในแผนก', () => {
  const roster = [mgr('PM-0102'), staff('PM-0410', 'primus'), staff('THT0056', 'themtech')];
  assert.deepEqual(unsignedStaff(roster, DEPT), []);
});

test('พอกำหนดขอบเขตเป็นไพรมัส คนเดมเทคก็ไม่เหลือใครเซ็นให้', () => {
  const roster = [mgr('PM-0102', 'primus'), staff('PM-0410', 'primus'), staff('THT0056', 'themtech')];
  assert.deepEqual(unsignedStaff(roster, DEPT).map((p) => p.code), ['THT0056']);
});

test('การกำหนดขอบเขตที่ทำให้มีคนไม่เหลือผู้เซ็น ถูกปฏิเสธ พร้อมบอกว่าใคร', () => {
  const before = [mgr('PM-0102'), staff('THT0056', 'themtech')];
  const after = [mgr('PM-0102', 'primus'), staff('THT0056', 'themtech')];
  const r = signingCoveragePermission(before, after, DEPT);
  assert.equal(r.ok, false);
  assert.match(r.error, /THT0056/, 'ข้อความต้องบอกรหัสคนที่ถูกตัดออก');
});

/**
 * The distinction the whole rule rests on. ADM has had no หัวหน้า at all for as
 * long as the roster has existed, so a rule reading "refuse any save that
 * leaves somebody unsignable" would make every ADM row uneditable — correcting
 * a surname there would fail with a message about approvals. Only a save that
 * TAKES a signer away is refused.
 */
test('รูที่มีอยู่ก่อนแล้ว ไม่บล็อกการแก้ไขเรื่องอื่น', () => {
  const before = [staff('ADM-01', 'primus')];
  const after = [{ ...staff('ADM-01', 'primus'), name: 'ชื่อใหม่' }];
  assert.deepEqual(signingCoveragePermission(before, after, DEPT), { ok: true });
});

test('ตั้งหัวหน้าเดมเทคเพิ่มก่อน แล้วค่อยกำหนดขอบเขต — ผ่าน', () => {
  const before = [mgr('PM-0102'), mgr('THT0012', null, 'themtech'), staff('THT0056', 'themtech')];
  const after = [mgr('PM-0102', 'primus'), mgr('THT0012', 'themtech', 'themtech'), staff('THT0056', 'themtech')];
  assert.deepEqual(signingCoveragePermission(before, after, DEPT), { ok: true });
});

/** The same hole from the four other directions the routes can open it. */
test('ลดตำแหน่ง ปิดบัญชี ย้ายบริษัท ย้ายแผนก — เปิดรูเดียวกันทั้งหมด', () => {
  const covered = [mgr('PM-0102'), staff('PM-0410', 'primus')];

  const demoted = [{ ...mgr('PM-0102'), role: 'employee' }, staff('PM-0410', 'primus')];
  assert.equal(signingCoveragePermission(covered, demoted, DEPT).ok, false, 'ลดตำแหน่งหัวหน้า');

  // ปิดบัญชี — the routes drop an inactive person from the roster they pass in.
  assert.equal(signingCoveragePermission(covered, [staff('PM-0410', 'primus')], DEPT).ok, false, 'ปิดบัญชีหัวหน้า');

  const moved = [mgr('PM-0102', 'primus'), { ...staff('PM-0410', 'primus'), company: 'themtech' }];
  assert.equal(signingCoveragePermission(covered, moved, DEPT).ok, false, 'ย้ายพนักงานข้ามบริษัท');

  const arrived = [mgr('PM-0102', 'primus'), staff('PM-0410', 'primus'), staff('THT0056', 'themtech')];
  assert.equal(signingCoveragePermission(covered, arrived, DEPT).ok, false, 'ย้ายคนเดมเทคเข้าแผนก');
});

test('หัวหน้าไม่ต้องมีใครเซ็นให้ — §2 ไม่ให้หัวหน้าทำ OT ปกติอยู่แล้ว', () => {
  assert.deepEqual(unsignedStaff([mgr('THT0012', 'themtech', 'themtech')], DEPT), []);
});

/**
 * ── นำเข้า CSV ────────────────────────────────────────────────────────────
 *
 * The single-row guard refuses; the import REPORTS. That is forced, not
 * chosen: the import loop writes each row as it reaches it, so by the time the
 * whole file has been applied there is nothing left to refuse — and a per-row
 * check inside the loop would refuse the correct sequence, because the หัวหน้า
 * who covers somebody can be line 40 of the file they are on line 5 of.
 *
 * These hold the shape of the answer the route computes with the same two
 * calls it makes: `unsignedStaff` over the whole roster, before and after,
 * reported as the difference.
 */

const before = (roster) => new Set(unsignedStaff(roster, DEPT).map((p) => String(p._id)));
const strandedBy = (was, now) => unsignedStaff(now, DEPT)
  .filter((p) => !before(was).has(String(p._id)))
  .map((p) => p.code);

test('นำเข้า — คนเดมเทคเข้าแผนกที่หัวหน้าเซ็นให้ไพรมัสอย่างเดียว ถูกรายงาน', () => {
  const was = [mgr('PM-0102', 'primus'), staff('PM-0410', 'primus')];
  const now = [...was, staff('THT0056', 'themtech')];
  assert.deepEqual(strandedBy(was, now), ['THT0056']);
});

test('นำเข้า — หัวหน้าอยู่บรรทัดหลังลูกน้อง ก็ยังไม่ถูกรายงาน', () => {
  // The sequence a per-row check would have refused: the covering หัวหน้า and
  // the people they cover arrive in one file, in the wrong order.
  const was = [mgr('PM-0102', 'primus')];
  const now = [mgr('PM-0102', 'primus'), staff('THT0056', 'themtech'), mgr('THT0012', 'themtech', 'themtech')];
  assert.deepEqual(strandedBy(was, now), [], 'ทั้งไฟล์ถูกใช้แล้วค่อยถาม จึงไม่มีใครถูกตัด');
});

test('นำเข้า — รูที่มีอยู่ก่อน ไม่ถูกนับเป็นผลจากไฟล์', () => {
  // ADM's staff have had nobody since before this file existed. An import that
  // does not touch them must not be reported as having broken them.
  const was = [staff('ADM-01', 'primus')];
  const now = [...was, staff('PM-0411', 'primus'), mgr('PM-0102')];
  assert.deepEqual(strandedBy(was, now), [], 'ADM-01 ถูกตัดมาก่อนแล้ว ไม่ใช่ผลจากไฟล์นี้');
});

test('นำเข้า — ลดตำแหน่งหัวหน้า ตัดคนที่ไฟล์ไม่ได้เอ่ยถึงเลย', () => {
  // The reason the route asks about the WHOLE roster rather than the
  // departments the file names: this row's line never mentions PM-0410.
  const was = [mgr('PM-0102'), staff('PM-0410', 'primus')];
  const now = [{ ...mgr('PM-0102'), role: 'employee' }, staff('PM-0410', 'primus')];
  assert.ok(strandedBy(was, now).includes('PM-0410'));
});
