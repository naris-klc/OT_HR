/**
 * THE MONTH WALL — งวดปิดเอง เมื่อพ้นวันที่ D ของเดือนถัดไป.
 *
 * Pure throughout: no database, no fixtures, no server. Every function under
 * test takes plain objects and a date string, which is the whole reason the
 * rule lives in lib/entries.js rather than inside a component — a component
 * test here reads FILE TEXT, because there is no JSX transform.
 *
 * Designed in docs/plan-cancel-cutoff-day.md; §9 of that file is the list these
 * cases were written from.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cancelCutoffLead,
  cancelCutoffRefusal,
  cancelDeadline,
  cancelPermission,
  editPermission,
  isPastCancelCutoff,
} from '../lib/entries.js';
import { withdrawDecisionPermission, withdrawEligibility } from '../lib/withdrawal.js';

// `company` on the employee document, not a bare id: `withdrawDecisionPermission`
// resolves which payroll a row belongs to before deciding whose row it is, and
// `entryCompany` refuses to guess. Same fixture shape as test/withdrawal.test.js.
const EMP = { _id: 'e1', name: 'สมชาย', role: 'employee', department: 'd1', company: 'primus' };
const HR = { _id: 'h1', name: 'ฝ่ายบุคคล', role: 'hr' };
const ADMIN = { _id: 'a1', name: 'ผู้ดูแล', role: 'admin' };
const BOSS = { _id: 'm1', name: 'หัวหน้าเอ', role: 'supervisor', department: 'd1' };

const D3 = { cancelCutoffDay: 3 };

/** An entry in งวด 2026-08 that the employee could still act on but for the wall. */
const entry = (over = {}) => ({
  _id: 'x1',
  employee: EMP,
  workDate: '2026-08-20',
  status: 'pending_mgr',
  department: 'd1',
  ...over,
});

/** …and the same one after a signature, which is the ขอถอนใบ side of the line. */
const signed = (over = {}) => entry({
  status: 'approved',
  managerDecision: { by: 'm1', at: new Date('2026-08-21T02:00:00Z') },
  ...over,
});

const withOpenRequest = (over = {}) => signed({
  withdrawal: { state: 'requested', requestedBy: 'e1', requestedAt: new Date('2026-09-02') },
  ...over,
});

// ── the arithmetic ──────────────────────────────────────────────────────────

test('null means no cutoff at all — the shipped default', () => {
  assert.equal(cancelDeadline(entry(), {}), null);
  assert.equal(cancelDeadline(entry(), { cancelCutoffDay: null }), null);
  assert.equal(isPastCancelCutoff(entry(), {}, '2030-01-01'), false);
  assert.equal(cancelCutoffRefusal(EMP, entry(), {}, '2030-01-01'), null);
});

test('the deadline is day D of the month AFTER the entry period', () => {
  assert.equal(cancelDeadline(entry(), D3), '2026-09-03');
  assert.equal(cancelDeadline(entry({ workDate: '2026-09-12' }), D3), '2026-10-03');
  assert.equal(cancelDeadline(entry({ workDate: '2026-08-01' }), D3), '2026-09-03');
  assert.equal(cancelDeadline(entry({ workDate: '2026-08-31' }), D3), '2026-09-03');
});

test('December rolls into the next YEAR', () => {
  assert.equal(cancelDeadline(entry({ workDate: '2026-12-28' }), D3), '2027-01-03');
  assert.equal(cancelDeadline(entry({ workDate: '2026-12-01' }), { cancelCutoffDay: 15 }), '2027-01-15');
});

/**
 * THE OFF-BY-ONE, PINNED. The day named is open all of it and the next day is
 * not — the one boundary in this feature that cannot be seen from outside, and
 * the one the user was asked about in those words.
 */
test('day D itself is open all day; D+1 is not', () => {
  assert.equal(isPastCancelCutoff(entry(), D3, '2026-09-02'), false);
  assert.equal(isPastCancelCutoff(entry(), D3, '2026-09-03'), false);
  assert.equal(isPastCancelCutoff(entry(), D3, '2026-09-04'), true);
});

/**
 * An entry filed today for a day two months ago is over its own cutoff at the
 * moment it exists. ใบ ค in §4.3 of the plan. A minimum measured from the
 * filing date was designed, offered and REFUSED — this case is what stops it
 * being added back by somebody who assumes it was an oversight.
 */
test('a late cross-month filing is past its cutoff from the second it exists', () => {
  const late = entry({ workDate: '2026-07-20' });
  assert.equal(isPastCancelCutoff(late, D3, '2026-09-14'), true);
  assert.equal(cancelCutoffRefusal(EMP, late, D3, '2026-09-14').status, 409);
});

test('an unreadable setting means NO cutoff, never the strictest one', () => {
  for (const bad of ['3', 0, -1, 99, 29, NaN, undefined, true, 3.5, '']) {
    assert.equal(cancelDeadline(entry(), { cancelCutoffDay: bad }), null, `value ${String(bad)}`);
    assert.equal(isPastCancelCutoff(entry(), { cancelCutoffDay: bad }, '2030-01-01'), false);
  }
});

test('an entry with no usable workDate has no deadline rather than a wrong one', () => {
  assert.equal(cancelDeadline({}, D3), null);
  assert.equal(cancelDeadline({ workDate: '' }, D3), null);
  assert.equal(cancelDeadline({ workDate: '2026-13-01' }, D3), null);
});

// ── who is refused, and who never is ────────────────────────────────────────

/**
 * ฝ่ายบุคคล AND ผู้ดูแลระบบ PASS EVERYWHERE. This is the property that makes
 * this rule not ปิดงวด, which closed HR's own correction path and was withdrawn
 * on 2026-08-31 because of it (lib/periodStatus.js). If this test ever has to
 * be relaxed, the change is a policy question for HR and not a code change.
 */
test('HR and admin are never refused by the wall, at any of the four presses', () => {
  const on = '2027-06-01';
  for (const boss of [HR, ADMIN]) {
    assert.equal(cancelCutoffRefusal(boss, entry(), D3, on), null);
    assert.equal(editPermission(boss, entry(), 'แก้ตัวเลข', { policy: D3, on }).ok, true);
    assert.equal(withdrawEligibility(boss, entry({ employee: boss._id }), { policy: D3, on }).ok, false,
      'HR does not ask for a withdrawal of somebody else\'s entry — refused, but not by the wall');
  }
});

/** HR's own แก้ไข is the exact path ปิดงวด closed. It stays open, with a reason. */
test('HR may still correct an entry in a period that closed months ago', () => {
  const r = editPermission(HR, signed(), 'บัญชีทัก', { policy: D3, on: '2027-06-01' });
  assert.deepEqual(r, { ok: true, action: 'hr_edit' });
});

/** And `void` — the only way out for a row the system wrote (§7). */
test('HR may still void an untouched system filing after the cutoff', () => {
  // `isUntouchedSystemFiling` reads the HISTORY, not a flag — `submit_birthday`
  // is what the withdrawn birthday flow wrote, and `approve_hr` is allowed to
  // follow it without making the row anybody's request.
  const sys = entry({
    status: 'approved',
    history: [{ action: 'submit_birthday' }, { action: 'approve_hr' }],
  });
  const r = cancelPermission(HR, sys, { policy: D3, on: '2027-06-01' });
  assert.equal(r.ok, true);
  assert.equal(r.action, 'void');
});

/**
 * `isPastCancelCutoff` ANSWERS TRUE FOR HR; `cancelCutoffRefusal` RETURNS NULL.
 * They differ for exactly one reader, deliberately — the HR screens warn with
 * the first, and if the two ever agreed about HR the warning in §8.6 would
 * never once appear.
 */
test('the fact and the refusal disagree about HR, and that is the point', () => {
  const on = '2026-09-14';
  assert.equal(isPastCancelCutoff(entry(), D3, on), true);
  assert.equal(cancelCutoffRefusal(HR, entry(), D3, on), null);
  assert.equal(cancelCutoffRefusal(EMP, entry(), D3, on).short, 'หมดเวลาแก้ไข');
});

// ── the four presses ────────────────────────────────────────────────────────

test('ยกเลิก by the employee is refused after the cutoff and allowed before it', () => {
  assert.equal(cancelPermission(EMP, entry(), { policy: D3, on: '2026-09-03' }).ok, true);
  const no = cancelPermission(EMP, entry(), { policy: D3, on: '2026-09-04' });
  assert.equal(no.ok, false);
  assert.equal(no.status, 409);
  assert.match(no.error, /ฝ่ายบุคคล/);
});

test('แก้ไข by the employee is refused after the cutoff', () => {
  assert.equal(editPermission(EMP, entry(), '', { policy: D3, on: '2026-09-03' }).ok, true);
  const no = editPermission(EMP, entry(), '', { policy: D3, on: '2026-09-04' });
  assert.equal(no.ok, false);
  assert.equal(no.status, 409);
});

test('ขอถอนใบ is refused after the cutoff', () => {
  assert.equal(withdrawEligibility(EMP, signed(), { policy: D3, on: '2026-09-03' }).ok, true);
  const no = withdrawEligibility(EMP, signed(), { policy: D3, on: '2026-09-04' });
  assert.equal(no.ok, false);
  assert.equal(no.status, 409);
});

/**
 * MEASURED AT TODAY, NOT AT `requestedAt`. Asked in time, answered late: the
 * หัวหน้า is out and only ฝ่ายบุคคล is left. This is the "ทั้งหมด" the user
 * confirmed twice, and its cost is §13 of the plan.
 */
test('a withdrawal asked in time but decided late is closed to the หัวหน้า', () => {
  const row = withOpenRequest();
  const args = { user: BOSS, entry: row, delegations: [], policy: D3 };
  assert.equal(withdrawDecisionPermission({ ...args, today: '2026-09-03' }).ok, true);
  for (const verb of ['อนุมัติ', 'ไม่อนุมัติ']) {
    const no = withdrawDecisionPermission({ ...args, today: '2026-09-20', verb });
    assert.equal(no.ok, false);
    assert.equal(no.status, 409);
    assert.match(no.error, new RegExp(`${verb}คำขอถอนได้เฉพาะฝ่ายบุคคล`));
  }
});

test('somebody outside the department still gets 403, not the wall', () => {
  const other = { _id: 'm9', role: 'manager', department: 'บัญชี', company: 'prod1' };
  const no = withdrawDecisionPermission({
    user: other, entry: withOpenRequest(), delegations: [], today: '2026-08-25', policy: D3,
  });
  assert.equal(no.status, 403);
});

// ── HR's reason, past the cutoff only ───────────────────────────────────────

/**
 * Deciding a withdrawal is one of the presses this app never required a reason
 * for. Past the cutoff it now does, for HR, at the SERVER — the user asked for
 * it on 2026-09-14 after being shown that nothing anywhere recorded why HR had
 * answered a request the signer no longer could.
 */
test('HR deciding a closed period without a reason is 400, both verbs', () => {
  const row = withOpenRequest();
  for (const verb of ['อนุมัติ', 'ไม่อนุมัติ']) {
    for (const note of [undefined, '', '   ']) {
      const no = withdrawDecisionPermission({
        user: HR, entry: row, today: '2026-09-20', policy: D3, verb, note,
      });
      assert.equal(no.ok, false, `verb ${verb}, note ${JSON.stringify(note)}`);
      assert.equal(no.status, 400);
      assert.match(no.error, /เหตุผล/);
    }
    const yes = withdrawDecisionPermission({
      user: HR, entry: row, today: '2026-09-20', policy: D3, verb, note: 'พนักงานแจ้งย้อนหลัง',
    });
    assert.equal(yes.ok, true);
  }
});

/** An open period is decided exactly as it was before this key existed. */
test('inside the period, no reason is required of HR — no new gate', () => {
  const ok = withdrawDecisionPermission({
    user: HR, entry: withOpenRequest(), today: '2026-09-02', policy: D3,
  });
  assert.equal(ok.ok, true);
});

// ── the order inside editPermission ─────────────────────────────────────────

/**
 * THE WALL GOES LAST IN `editPermission`, AND MOVING IT UP BREAKS SILENTLY.
 *
 * A rejected entry's refusal says กด “ส่งใหม่”, which is advice the employee
 * can still follow whatever the calendar says. Answering that person with a
 * sentence about a period instead would be the screen replying to a question
 * nobody asked. §6.2 of the plan is the criterion; this is its test.
 */
test('a rejected entry past the cutoff still gets ส่งใหม่, not the period message', () => {
  const no = editPermission(EMP, entry({ status: 'rejected' }), '', {
    policy: D3, on: '2026-09-20',
  });
  assert.equal(no.ok, false);
  assert.match(no.error, /ส่งใหม่/);
  assert.doesNotMatch(no.error, /กำหนดสุดท้าย/);
});

/** The same shape on the other side of the line — `cancelPermission` goes FIRST. */
test('an approved entry past the cutoff is not sent to the ขอถอนใบ button', () => {
  const no = cancelPermission(EMP, signed(), { policy: D3, on: '2026-09-20' });
  assert.equal(no.ok, false);
  // The old refusal names the button in quotes — กด “ขอถอนใบ” — as something to
  // go and press. The wall's own sentence names it only in a list of what can
  // no longer be done, which is why the quotes are what this looks for.
  assert.doesNotMatch(no.error, /“ขอถอนใบ”/);
  assert.match(no.error, /ฝ่ายบุคคล/);
});

// ── back-compatibility ──────────────────────────────────────────────────────

/**
 * NOT PASSING A POLICY MEANS THE OLD ANSWER, EXACTLY. The screens depend on
 * this and not only the old tests: EmployeeView asks `withdrawEligibility`
 * WITHOUT a policy to learn whether a button would have existed at all, then
 * asks the wall separately to decide whether to draw the sentence in its place.
 */
test('no policy argument reproduces the pre-cutoff answer on all three', () => {
  const on = '2030-01-01';
  assert.equal(editPermission(EMP, entry(), '').ok, true);
  assert.equal(cancelPermission(EMP, entry()).ok, true);
  assert.equal(withdrawEligibility(EMP, signed()).ok, true);
  assert.equal(withdrawDecisionPermission({
    user: BOSS, entry: withOpenRequest(), delegations: [], today: on,
  }).ok, true);
  assert.equal(cancelDeadline(entry(), {}), null);
});

// ── the sentence ────────────────────────────────────────────────────────────

/**
 * ONE LEAD, THREE TAILS (§8.4). The period and the date are formatted in one
 * place; what follows the dash differs by who is reading. `5c2a0e2` is on the
 * record as the commit that had to collect one sentence back out of four files
 * after it had drifted into three wordings.
 */
test('the lead carries the งวด and the deadline, in the app date shape', () => {
  const lead = cancelCutoffLead(entry(), D3);
  assert.match(lead, /สิงหาคม 2569/);
  assert.match(lead, /03\/09\/2569/);
  assert.doesNotMatch(lead, /2026-09-03/, 'raw ISO must never reach a screen');
  assert.equal(cancelCutoffLead(entry(), {}), '');
});

test('every sentence the wall produces starts from that one lead', () => {
  const lead = cancelCutoffLead(signed(), D3);
  const employee = cancelCutoffRefusal(EMP, signed(), D3, '2026-09-20').error;
  const decide = withdrawDecisionPermission({
    user: BOSS, entry: withOpenRequest(), delegations: [], today: '2026-09-20', policy: D3,
  }).error;
  for (const line of [employee, decide]) assert.ok(line.startsWith(lead), line);
});

test('the short form is the four words the button cell has room for', () => {
  assert.equal(cancelCutoffRefusal(EMP, entry(), D3, '2026-09-20').short, 'หมดเวลาแก้ไข');
});
