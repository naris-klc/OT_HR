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
