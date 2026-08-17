import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasOpenWithdrawal,
  withdrawDecisionPermission,
  withdrawRequestPermission,
  withdrawalDecision,
  withdrawalRequest,
} from '../lib/withdrawal.js';
import { cancelPermission } from '../lib/entries.js';

/**
 * ขอถอนใบที่อนุมัติแล้ว.
 *
 * The rules are pure, so these run without mongoose and without a connection —
 * the same split lib/delegation.js and lib/delegationQuery.js make.
 *
 * Run with: npm test
 */

// `company` on both: withdrawDecisionPermission resolves which payroll a row
// belongs to before deciding whose row it is, and refuses to guess.
const EMP = { _id: 'e1', name: 'สมชาย', role: 'employee', department: 'd1', company: 'primus' };
const OTHER = { _id: 'e2', name: 'สมหญิง', role: 'employee', department: 'd1', company: 'primus' };
const MGR = { _id: 'm1', name: 'หัวหน้าเอ', role: 'manager', department: 'd1' };
const MGR_OTHER = { _id: 'm2', name: 'หัวหน้าบี', role: 'manager', department: 'd2' };
const HR = { _id: 'h1', name: 'ฝ่ายบุคคล', role: 'hr' };

/** An entry the manager has signed — the first case that needs asking. */
const approvedEntry = (over = {}) => ({
  _id: 'x1',
  // The document, not a bare id — see the company note on EMP above.
  employee: EMP,
  department: 'd1',
  status: 'approved',
  managerDecision: { by: 'm1', at: new Date('2026-08-06T02:00:00Z') },
  ...over,
});

// ── asking ──────────────────────────────────────────────────────────────────

test('เจ้าของใบที่อนุมัติแล้วขอถอนได้ พร้อมเหตุผล', () => {
  const may = withdrawRequestPermission(EMP, approvedEntry(), '  งานถูกยกเลิก  ');
  assert.equal(may.ok, true);
  assert.equal(may.reason, 'งานถูกยกเลิก', 'เหตุผลต้องถูกตัดช่องว่างหัวท้าย');
});

test('คนอื่นขอถอนใบของคนอื่นไม่ได้', () => {
  const may = withdrawRequestPermission(OTHER, approvedEntry(), 'อยากถอน');
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
});

test('เหตุผลเป็นสิ่งบังคับ — ต่างจากการยกเลิกเอง', () => {
  /**
   * `cancelPermission` deliberately asks for no reason: removing a request
   * nobody has looked at establishes nothing. This asks somebody to take back
   * something they signed, and the person deciding cannot decide without
   * knowing why — the same line `editPermission` draws for HR corrections.
   *
   * The contrast is asserted rather than described, because the day somebody
   * "tidies" the two into one rule, one of these two tests fails.
   */
  const pending = { ...approvedEntry(), status: 'pending_mgr', managerDecision: undefined };
  assert.equal(cancelPermission(EMP, pending).ok, true, 'ยกเลิกเองไม่ต้องมีเหตุผล');

  for (const empty of [undefined, '', '   ']) {
    const may = withdrawRequestPermission(EMP, approvedEntry(), empty);
    assert.equal(may.ok, false);
    assert.equal(may.status, 400);
    assert.match(may.error, /เหตุผล/);
  }
});

test('เหตุผลยาวเกิน 200 ตัวอักษรถูกปฏิเสธ', () => {
  const may = withdrawRequestPermission(EMP, approvedEntry(), 'ก'.repeat(201));
  assert.equal(may.ok, false);
  assert.equal(may.status, 400);
  assert.equal(withdrawRequestPermission(EMP, approvedEntry(), 'ก'.repeat(200)).ok, true);
});

test('ใบที่ยังไม่มีใครเซ็น ไม่ต้องขอ — ชี้ไปที่ปุ่มยกเลิก', () => {
  /**
   * The two rules are complementary and this is the seam. Refusing with a bare
   * "ไม่มีสิทธิ์" would be true and useless: the person wants an outcome that
   * is one button away on the same screen, and the message has to say so.
   */
  const pending = { ...approvedEntry(), status: 'pending_mgr', managerDecision: undefined };
  const may = withdrawRequestPermission(EMP, pending, 'งานถูกยกเลิก');
  assert.equal(may.ok, false);
  assert.equal(may.status, 409);
  assert.match(may.error, /ยกเลิก/);
});

test('ใบที่หัวหน้าบันทึกแทนและยังไม่มีใครเซ็น ก็ยกเลิกเองได้ ไม่ใช่ต้องขอ', () => {
  /**
   * A proxy-filed request is created at `pending_hr` having been approved by
   * nobody. The line is `awaitingFirstSignature`, not a status list, precisely
   * so this case falls to `cancelPermission` — reading it as "pending_hr means
   * signed" would make the employee ask permission to withdraw a request that
   * nobody has looked at.
   */
  const proxy = { ...approvedEntry(), status: 'pending_hr', managerDecision: undefined, filedBy: 'm1' };
  assert.equal(cancelPermission(EMP, proxy).ok, true, 'ยังเป็นของพนักงานอยู่');

  const may = withdrawRequestPermission(EMP, proxy, 'งานถูกยกเลิก');
  assert.equal(may.ok, false);
  assert.match(may.error, /ยกเลิก/);
});

test('ใบที่รอ HR โดยหัวหน้าเซ็นแล้ว ต้องขอถอน', () => {
  const signed = { ...approvedEntry(), status: 'pending_hr' };
  assert.equal(cancelPermission(EMP, signed).ok, false, 'ยกเลิกเองไม่ได้แล้ว');
  assert.equal(withdrawRequestPermission(EMP, signed, 'งานถูกยกเลิก').ok, true);
});

test('ใบที่ปิดแล้วขอถอนไม่ได้', () => {
  for (const status of ['rejected', 'cancelled']) {
    const may = withdrawRequestPermission(EMP, approvedEntry({ status }), 'งานถูกยกเลิก');
    assert.equal(may.ok, false);
    assert.equal(may.status, 409);
    assert.match(may.error, /ปิดแล้ว/);
  }
});

test('ขอซ้ำขณะที่ยังมีคำขอค้างอยู่ไม่ได้', () => {
  const entry = approvedEntry({ withdrawal: { state: 'requested', requestedBy: 'e1' } });
  const may = withdrawRequestPermission(EMP, entry, 'งานถูกยกเลิก');
  assert.equal(may.ok, false);
  assert.equal(may.status, 409);
});

test('ถูกปฏิเสธแล้วขอใหม่ได้', () => {
  /**
   * A refusal is not the once-only door `resubmittedTo` guards. Circumstances
   * change, and the record of every ask and every answer is the check on
   * somebody asking repeatedly — not a lock that leaves them with a phone call
   * as the only way through, which is what this feature exists to remove.
   */
  const entry = approvedEntry({ withdrawal: { state: 'refused', requestedBy: 'e1' } });
  assert.equal(withdrawRequestPermission(EMP, entry, 'ยืนยันว่าไม่ได้ทำจริง').ok, true);
});

test('hasOpenWithdrawal นับเฉพาะที่ยังไม่ถูกตอบ', () => {
  assert.equal(hasOpenWithdrawal(approvedEntry()), false, 'ไม่เคยขอ');
  assert.equal(hasOpenWithdrawal(approvedEntry({ withdrawal: { state: 'requested' } })), true);
  assert.equal(hasOpenWithdrawal(approvedEntry({ withdrawal: { state: 'granted' } })), false);
  assert.equal(hasOpenWithdrawal(approvedEntry({ withdrawal: { state: 'refused' } })), false);
});

// ── deciding ────────────────────────────────────────────────────────────────

const asked = (over = {}) => approvedEntry({
  withdrawal: { state: 'requested', requestedBy: 'e1', requestedByName: 'สมชาย', reason: 'งานถูกยกเลิก' },
  ...over,
});

test('หัวหน้าของแผนกตอบได้', () => {
  const may = withdrawDecisionPermission({ user: MGR, entry: asked(), today: '2026-08-14' });
  assert.equal(may.ok, true);
  assert.equal(may.onBehalfOf, null, 'หัวหน้าตัวจริงไม่ได้ใช้สิทธิ์ของใคร');
  assert.equal(may.delegationId, null);
});

test('ฝ่ายบุคคลตอบได้เสมอ', () => {
  assert.equal(withdrawDecisionPermission({ user: HR, entry: asked(), today: '2026-08-14' }).ok, true);
  const admin = { _id: 'a1', name: 'แอดมิน', role: 'admin' };
  assert.equal(withdrawDecisionPermission({ user: admin, entry: asked(), today: '2026-08-14' }).ok, true);
});

test('หัวหน้าแผนกอื่นตอบไม่ได้', () => {
  const may = withdrawDecisionPermission({ user: MGR_OTHER, entry: asked(), today: '2026-08-14' });
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
  assert.match(may.error, /แผนกของตน/);
});

test('ผู้รับช่วงตอบแทนได้ และบันทึกว่าใช้สิทธิ์ของใคร', () => {
  /**
   * The same `departmentClaim` the approval queue uses, so a stand-in reaches
   * exactly the teams they cover — and `onBehalfOf` comes back populated, which
   * is what stops the trail saying หัวหน้าบี released a หัวหน้าเอ entry on
   * nobody's authority.
   */
  const delegations = [{
    _id: 'del1', to: MGR_OTHER, from: MGR, fromDate: '2026-08-10', toDate: '2026-08-20',
  }];
  const may = withdrawDecisionPermission({
    user: MGR_OTHER, entry: asked(), delegations, today: '2026-08-14',
  });

  assert.equal(may.ok, true);
  assert.equal(may.onBehalfOf, MGR);
  assert.equal(may.delegationId, 'del1');
});

test('ผู้รับช่วงที่หมดช่วงแล้วตอบไม่ได้', () => {
  const delegations = [{
    _id: 'del1', to: MGR_OTHER, from: MGR, fromDate: '2026-08-01', toDate: '2026-08-05',
  }];
  const may = withdrawDecisionPermission({
    user: MGR_OTHER, entry: asked(), delegations, today: '2026-08-14',
  });
  assert.equal(may.ok, false);
});

test('ผู้ขอถอนอนุมัติคำขอของตนเองไม่ได้', () => {
  /**
   * Guarded here rather than left to the fact that a หัวหน้า cannot file OT for
   * themselves. That is a different rule in a different file behind a role
   * flag, and a rule that leans on another rule breaks silently the day
   * somebody edits the other one — the reasoning `approvalPermission` gives for
   * checking `isOwnFiling` first.
   */
  const selfManager = { ...MGR, _id: 'e1' };
  const may = withdrawDecisionPermission({ user: selfManager, entry: asked(), today: '2026-08-14' });
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
});

test('ไม่มีคำขอค้างอยู่ ก็ไม่มีอะไรให้ตอบ', () => {
  for (const withdrawal of [undefined, { state: 'granted' }, { state: 'refused' }]) {
    const may = withdrawDecisionPermission({
      user: HR, entry: approvedEntry({ withdrawal }), today: '2026-08-14',
    });
    assert.equal(may.ok, false);
    assert.equal(may.status, 409);
  }
});

test('คำถามว่า “มีคำขอค้างไหม” ถูกถามก่อนคำถามเรื่องสิทธิ์', () => {
  // A manager from another department asking about an entry with no open
  // request should be told there is nothing to answer, not that it is not their
  // team — the second is a fact about them, the first about the row.
  const may = withdrawDecisionPermission({
    user: MGR_OTHER, entry: approvedEntry(), today: '2026-08-14',
  });
  assert.equal(may.status, 409);
});

// ── what gets written ───────────────────────────────────────────────────────

test('คำขอเก็บชื่อผู้ขอไว้ด้วย ไม่ใช่แค่ตัวชี้', () => {
  const at = new Date('2026-08-14T03:00:00Z');
  const req = withdrawalRequest(EMP, 'งานถูกยกเลิก', { at });

  assert.deepEqual(req, {
    state: 'requested',
    requestedBy: 'e1',
    requestedByName: 'สมชาย',
    requestedAt: at,
    reason: 'งานถูกยกเลิก',
  });
});

test('การตัดสินไม่ลบเหตุผลที่ขอมา', () => {
  /**
   * The line a disputed month is settled by. A record that kept only
   * "ฝ่ายบุคคลอนุมัติการถอน" would have lost why it was asked for, and there is
   * nothing else on the entry that remembers.
   */
  const req = withdrawalRequest(EMP, 'งานถูกยกเลิก', { at: new Date('2026-08-14T03:00:00Z') });
  const decided = withdrawalDecision(req, HR, {
    granted: true,
    note: 'ตรวจกับหัวหน้าแล้ว',
    at: new Date('2026-08-16T04:00:00Z'),
  });

  assert.equal(decided.state, 'granted');
  assert.equal(decided.reason, 'งานถูกยกเลิก', 'เหตุผลเดิมต้องอยู่');
  assert.equal(decided.requestedByName, 'สมชาย', 'ชื่อผู้ขอต้องอยู่');
  assert.equal(decided.decidedByName, 'ฝ่ายบุคคล');
  assert.equal(decided.decisionNote, 'ตรวจกับหัวหน้าแล้ว');
});

test('ปฏิเสธก็บันทึกเหมือนกัน ต่างกันที่ state', () => {
  const req = withdrawalRequest(EMP, 'งานถูกยกเลิก');
  const refused = withdrawalDecision(req, MGR, { granted: false, note: 'ทำจริงตามบันทึกเวลา' });

  assert.equal(refused.state, 'refused');
  assert.equal(refused.decidedByName, 'หัวหน้าเอ');
  assert.equal(refused.decisionNote, 'ทำจริงตามบันทึกเวลา');
});

test('ผู้กดปุ่มคือผู้กดปุ่ม — ไม่ถูกกลบด้วยชื่อคนที่มอบสิทธิ์', () => {
  const req = withdrawalRequest(EMP, 'งานถูกยกเลิก');
  const decided = withdrawalDecision(req, MGR_OTHER, {
    granted: true,
    resolved: { onBehalfOf: MGR, delegationId: 'del1' },
  });

  assert.equal(decided.decidedBy, 'm2', 'by ต้องเป็นคนที่กดจริง');
  assert.equal(decided.decidedByName, 'หัวหน้าบี');
  assert.equal(decided.onBehalfOf, 'm1');
  assert.equal(decided.onBehalfOfName, 'หัวหน้าเอ');
  assert.equal(decided.delegationId, 'del1');
});

test('การตัดสินธรรมดาไม่ทิ้งฟิลด์ว่างไว้', () => {
  // `undefined` rather than null, matching `log()`: mongoose stores an explicit
  // null and a reader cannot tell that from a real value.
  const decided = withdrawalDecision(withdrawalRequest(EMP, 'x'), HR, { granted: true });
  assert.equal(decided.onBehalfOf, undefined);
  assert.equal(decided.delegationId, undefined);
  assert.equal(decided.decisionNote, undefined);
});

test('ฟิลด์ว่างที่ mongoose สร้างไว้ ต้องอ่านว่า “ไม่เคยขอ”', () => {
  /**
   * Mongoose materialises a nested path as an object whether or not anything
   * was written into it, so `entry.withdrawal` is `{}` on every entry that has
   * never been asked about. Every rule here keys off `state` for that reason —
   * a truthiness check on the block itself would read "there is a withdrawal"
   * on all 800 existing entries.
   */
  assert.equal(hasOpenWithdrawal({ withdrawal: {} }), false);
  assert.equal(withdrawRequestPermission(EMP, approvedEntry({ withdrawal: {} }), 'x').ok, true);
  assert.equal(
    withdrawDecisionPermission({ user: HR, entry: approvedEntry({ withdrawal: {} }), today: '2026-08-14' }).status,
    409,
  );
});
