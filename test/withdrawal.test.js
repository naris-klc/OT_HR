import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WITHDRAWAL_STATES,
  withdrawPermission,
  withdrawalRecord,
  withdrawEligibility,
} from '../lib/withdrawal.js';
import { cancelPermission } from '../lib/entries.js';

/**
 * ถอนใบที่อนุมัติแล้ว.
 *
 * The rules are pure, so these run without mongoose and without a connection —
 * the same split lib/delegation.js and lib/delegationQuery.js make.
 *
 * ── HALF THIS FILE WAS ABOUT DECIDING, UNTIL 2026-09-18 ─────────────────────
 *
 * `withdrawDecisionPermission` and `withdrawalDecision` were the other half of
 * the feature and had eleven tests here: who may answer, a stand-in answering
 * on whose authority, the asker not answering their own, the month wall closing
 * the press to signers. All of it went with the act — ถอนใบ is one press by the
 * owner of the entry. The rules this file still covers are the ones that used
 * to guard the ASKING, unchanged; what changed is what happens after they say
 * yes, and that is the route, covered in test/permissionRouteGuards.test.js.
 *
 * Run with: npm test
 */

const EMP = { _id: 'e1', name: 'สมชาย', role: 'employee', department: 'd1', company: 'primus' };
const OTHER = { _id: 'e2', name: 'สมหญิง', role: 'employee', department: 'd1', company: 'primus' };

/** An entry the manager has signed — the first case this rule owns. */
const approvedEntry = (over = {}) => ({
  _id: 'x1',
  employee: EMP,
  department: 'd1',
  status: 'approved',
  managerDecision: { by: 'm1', at: new Date('2026-08-06T02:00:00Z') },
  ...over,
});

// ── who may withdraw ────────────────────────────────────────────────────────

test('เจ้าของใบที่อนุมัติแล้วถอนได้ พร้อมเหตุผล', () => {
  const may = withdrawPermission(EMP, approvedEntry(), '  งานถูกยกเลิก  ');
  assert.equal(may.ok, true);
  assert.equal(may.reason, 'งานถูกยกเลิก', 'เหตุผลต้องถูกตัดช่องว่างหัวท้าย');
});

test('คนอื่นถอนใบของคนอื่นไม่ได้', () => {
  const may = withdrawPermission(OTHER, approvedEntry(), 'อยากถอน');
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
});

test('เหตุผลเป็นสิ่งบังคับ — ต่างจากการยกเลิกเอง', () => {
  /**
   * `cancelPermission` deliberately asks for no reason: removing a request
   * nobody has looked at establishes nothing. This takes back something two
   * people signed, and the หัวหน้า whose name is on it will read that line and
   * nothing else — the same line `editPermission` draws for HR corrections.
   *
   * IT SURVIVED THE REMOVAL OF THE ตัดสิน STEP, and it is worth saying why: the
   * old argument was "the person deciding cannot decide without knowing why",
   * and there is no such person now. The reason is still required because the
   * record is still READ — by the signer, and by anybody asking later why a
   * month came out short.
   *
   * The contrast is asserted rather than described, because the day somebody
   * "tidies" the two into one rule, one of these two tests fails.
   */
  const pending = { ...approvedEntry(), status: 'pending_mgr', managerDecision: undefined };
  assert.equal(cancelPermission(EMP, pending).ok, true, 'ยกเลิกเองไม่ต้องมีเหตุผล');

  for (const empty of [undefined, '', '   ']) {
    const may = withdrawPermission(EMP, approvedEntry(), empty);
    assert.equal(may.ok, false);
    assert.equal(may.status, 400);
    assert.match(may.error, /เหตุผล/);
  }
});

test('เหตุผลยาวเกิน 200 ตัวอักษรถูกปฏิเสธ', () => {
  const may = withdrawPermission(EMP, approvedEntry(), 'ก'.repeat(201));
  assert.equal(may.ok, false);
  assert.equal(may.status, 400);
  assert.equal(withdrawPermission(EMP, approvedEntry(), 'ก'.repeat(200)).ok, true);
});

test('ใบที่ยังไม่มีใครเซ็น ไม่ต้องถอน — ชี้ไปที่ปุ่มยกเลิก', () => {
  /**
   * The two rules are complementary and this is the seam. Refusing with a bare
   * "ไม่มีสิทธิ์" would be true and useless: the person wants an outcome that
   * is one button away on the same screen, and the message has to say so.
   */
  const pending = { ...approvedEntry(), status: 'pending_mgr', managerDecision: undefined };
  const may = withdrawPermission(EMP, pending, 'งานถูกยกเลิก');
  assert.equal(may.ok, false);
  assert.equal(may.status, 409);
  assert.match(may.error, /ยกเลิก/);
});

test('ใบที่หัวหน้าบันทึกแทนและยังไม่มีใครเซ็น ก็ยกเลิกเองได้ ไม่ใช่ต้องถอน', () => {
  /**
   * A proxy-filed request is created at `pending_hr` having been approved by
   * nobody. The line is `awaitingFirstSignature`, not a status list, precisely
   * so this case falls to `cancelPermission` — reading it as "pending_hr means
   * signed" would send the employee to the wrong button for a request nobody
   * has looked at.
   */
  const proxy = { ...approvedEntry(), status: 'pending_hr', managerDecision: undefined, filedBy: 'm1' };
  assert.equal(cancelPermission(EMP, proxy).ok, true, 'ยังเป็นของพนักงานอยู่');

  const may = withdrawPermission(EMP, proxy, 'งานถูกยกเลิก');
  assert.equal(may.ok, false);
  assert.match(may.error, /ยกเลิก/);
});

test('ใบที่รอ HR โดยหัวหน้าเซ็นแล้ว ถอนได้', () => {
  const signed = { ...approvedEntry(), status: 'pending_hr' };
  assert.equal(cancelPermission(EMP, signed).ok, false, 'ยกเลิกเองไม่ได้แล้ว');
  assert.equal(withdrawPermission(EMP, signed, 'งานถูกยกเลิก').ok, true);
});

/**
 * THE TWO REFUSALS POINT AT EACH OTHER'S BUTTON.
 *
 * Each rule owns one side of the first signature, so the person who lands on
 * the wrong side has to be told which press does what they came to do. The
 * ยกเลิก side has said so since this feature shipped; the other side went on
 * saying ติดต่อฝ่ายบุคคล until 2026-08-31 — the exact sentence the top of
 * lib/withdrawal.js says this feature replaced, still being answered by the
 * route the screen never offers there.
 *
 * THE WORD CHANGED ON 2026-09-18 and this changed with it: the button is
 * `ถอนใบ`, not `ขอถอนใบ`, because it no longer asks anybody. A refusal naming a
 * button that is not on the screen is the failure this test exists to catch, so
 * it pins the word rather than a substring both spellings would satisfy.
 */
test('แต่ละฝั่งบอกปุ่มของอีกฝั่ง ไม่ใช่ส่งออกไปนอกระบบ', () => {
  const signed = { ...approvedEntry(), status: 'pending_hr' };
  const refusal = cancelPermission(EMP, signed).error;
  assert.match(refusal, /กด “ถอนใบ”/);
  assert.doesNotMatch(refusal, /ขอถอนใบ/, 'ปุ่มไม่ได้ชื่อนี้แล้ว');
  assert.doesNotMatch(refusal, /ติดต่อฝ่ายบุคคล/);
  assert.doesNotMatch(refusal, /พิจารณา/, 'ไม่มีใครต้องพิจารณาอีกแล้ว');

  const unsigned = { ...approvedEntry(), status: 'pending_mgr', managerDecision: undefined };
  assert.match(withdrawEligibility(EMP, unsigned).error, /ยกเลิก/);
});

test('ใบที่ปิดแล้วถอนไม่ได้', () => {
  for (const status of ['rejected', 'cancelled']) {
    const may = withdrawPermission(EMP, approvedEntry({ status }), 'งานถูกยกเลิก');
    assert.equal(may.ok, false);
    assert.equal(may.status, 409);
    assert.match(may.error, /ปิดแล้ว/);
  }
});

/**
 * ถอนซ้ำถูกกันด้วยกฎสถานะ ไม่ใช่ด้วยกฎของตัวเอง.
 *
 * `hasOpenWithdrawal` stood here and refused a second ask while one was
 * waiting. Nothing waits now — the first press leaves the row `cancelled`, and
 * the status check above is what refuses the second. Asserted because the rule
 * doing the work is no longer the rule whose name suggested it, and a reader
 * removing "an unused status check" would open the hole.
 */
test('กดถอนซ้ำบนใบที่ถอนไปแล้ว โดนกฎสถานะปิดแทน', () => {
  const done = approvedEntry({
    status: 'cancelled',
    withdrawal: { state: 'granted', requestedBy: 'e1', reason: 'งานถูกยกเลิก' },
  });
  const may = withdrawPermission(EMP, done, 'ขอถอนอีกรอบ');
  assert.equal(may.ok, false);
  assert.equal(may.status, 409);
  assert.match(may.error, /ปิดแล้ว/);
});

test('ใบเก่าที่เคยถูกปฏิเสธคำขอถอน ยังถอนได้ตามปกติ', () => {
  /**
   * `refused` is a row that exists in the database and cannot be produced any
   * more. The entry is live and still counted, which is what a refusal meant,
   * so its owner may now do for themselves what somebody once declined to do
   * for them. Nothing in the rule should be reading that field at all, and this
   * is the test that says so.
   */
  const entry = approvedEntry({
    withdrawal: { state: 'refused', requestedBy: 'e1', decidedByName: 'หัวหน้าเอ' },
  });
  assert.equal(withdrawPermission(EMP, entry, 'ยืนยันว่าไม่ได้ทำจริง').ok, true);
});

test('สถานะเก่าทั้งสองยังอยู่ในรายการที่ schema ยอมรับ', () => {
  /**
   * Only `granted` can be written now. Dropping the other two from
   * `WITHDRAWAL_STATES` would make every document carrying one fail validation
   * on its next save — which is any edit, any recompute, any cancel — and there
   * are such documents.
   */
  assert.deepEqual([...WITHDRAWAL_STATES], ['requested', 'granted', 'refused']);
});

// ── what gets written ───────────────────────────────────────────────────────

test('บันทึกการถอนเก็บชื่อผู้ถอนไว้ด้วย ไม่ใช่แค่ตัวชี้', () => {
  const at = new Date('2026-08-14T03:00:00Z');
  const rec = withdrawalRecord(EMP, 'งานถูกยกเลิก', { at });

  assert.deepEqual(rec, {
    state: 'granted',
    requestedBy: 'e1',
    requestedByName: 'สมชาย',
    requestedAt: at,
    reason: 'งานถูกยกเลิก',
  });
});

test('ไม่มีใครถูกเขียนลงช่องผู้ตัดสิน — เพราะไม่มีใครตัดสิน', () => {
  /**
   * THE ONE THING THIS RECORD MUST NOT DO. Writing the withdrawing employee's
   * name into `decidedBy` would make every screen printing those fields say a
   * person approved their own removal, and the trail would show a step that did
   * not happen. The `deepEqual` above already pins the whole shape; this says
   * out loud which absence is load-bearing, so it is not "filled in" later by
   * somebody tidying up a half-empty subdocument.
   */
  const rec = withdrawalRecord(EMP, 'งานถูกยกเลิก');
  for (const key of ['decidedBy', 'decidedByName', 'decidedAt', 'decisionNote', 'onBehalfOf']) {
    assert.equal(rec[key], undefined, `${key} ต้องว่าง`);
  }
});

test('ฟิลด์ว่างที่ mongoose สร้างไว้ ต้องอ่านว่า “ไม่เคยถอน”', () => {
  /**
   * Mongoose materialises a nested path as an object whether or not anything
   * was written into it, so `entry.withdrawal` is `{}` on every entry that has
   * never been withdrawn. Nothing here may key off the block's truthiness — it
   * would read "there is a withdrawal" on all 800 existing entries.
   */
  assert.equal(withdrawPermission(EMP, approvedEntry({ withdrawal: {} }), 'x').ok, true);
  assert.equal(withdrawEligibility(EMP, approvedEntry({ withdrawal: {} })).ok, true);
});
