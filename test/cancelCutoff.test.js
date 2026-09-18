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
  cancelCutoffHrNote,
  cancelCutoffLead,
  cancelCutoffRefusal,
  cancelDeadline,
  cancelPermission,
  editPermission,
  isPastCancelCutoff,
} from '../lib/entries.js';
import { withdrawEligibility } from '../lib/withdrawal.js';

// `company` on the employee document, not a bare id — the same fixture shape as
// test/withdrawal.test.js. It mattered while `withdrawDecisionPermission`
// resolved which payroll a row belonged to before deciding whose row it was;
// that rule went on 2026-09-18 and the shape is kept so the two files stay
// readable side by side.
const EMP = { _id: 'e1', name: 'สมชาย', role: 'employee', department: 'd1', company: 'primus' };
const HR = { _id: 'h1', name: 'ฝ่ายบุคคล', role: 'hr' };
const ADMIN = { _id: 'a1', name: 'ผู้ดูแล', role: 'admin' };

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

/** …and the same one after a signature, which is the ถอนใบ side of the line. */
const signed = (over = {}) => entry({
  status: 'approved',
  managerDecision: { by: 'm1', at: new Date('2026-08-21T02:00:00Z') },
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

/**
 * AND SO IS HR's OWN ยกเลิก — NEW ON 2026-09-15, AND THE REASON THE CUTOFF NO
 * LONGER STRANDS ANYBODY.
 *
 * This test read 'HR may still void an untouched system filing after the
 * cutoff' until then: the only row ฝ่ายบุคคล could remove was one the withdrawn
 * birthday generator had written, and an ordinary `approved` entry in a closed
 * period could be removed by NOBODY. `void` went with that generator; this is
 * the rule that replaced it, and it reaches every live row.
 */
test('HR may still cancel a live entry in a period that closed months ago', () => {
  const r = cancelPermission(HR, signed(), 'ลงวันที่ผิด', { policy: D3, on: '2027-06-01' });
  assert.deepEqual(r, { ok: true, action: 'hr_cancel' });
});

/* The reason is the RULE's and not the dialog's — a gate that lives on a screen
   is a gate `curl` walks past. Same shape as `editPermission`'s own 400. */
test('HR cancelling without a reason is refused, cutoff or no cutoff', () => {
  for (const on of ['2026-09-03', '2027-06-01']) {
    const r = cancelPermission(HR, signed(), '   ', { policy: D3, on });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.match(r.error, /เหตุผล/);
  }
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
  assert.equal(cancelPermission(EMP, entry(), '', { policy: D3, on: '2026-09-03' }).ok, true);
  const no = cancelPermission(EMP, entry(), '', { policy: D3, on: '2026-09-04' });
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

test('ถอนใบ is refused after the cutoff', () => {
  assert.equal(withdrawEligibility(EMP, signed(), { policy: D3, on: '2026-09-03' }).ok, true);
  const no = withdrawEligibility(EMP, signed(), { policy: D3, on: '2026-09-04' });
  assert.equal(no.ok, false);
  assert.equal(no.status, 409);
});

/**
 * ── ⚠ FIVE TESTS ABOUT DECIDING A ขอถอน STOOD HERE UNTIL 2026-09-18 ─────────
 *
 * They were the most consequential ones in this file, and it is worth recording
 * what they proved, because **the behaviour they pinned is the reason this
 * whole feature was rewritten**:
 *
 *   `a withdrawal asked in time but decided late is closed to the หัวหน้า` —
 *   the wall was MEASURED AT TODAY, not at `requestedAt`. Asked in time,
 *   answered late, and the signer was out for good with only ฝ่ายบุคคล left.
 *   That is the "ทั้งหมด" the user confirmed twice, and its cost was §13 of
 *   docs/plan-cancel-cutoff-day.md: requests that piled up where nobody but HR
 *   could clear them, and a `periodItems` line that could not clear itself.
 *
 *   `HR deciding a closed period without a reason is 400, both verbs` and
 *   `inside the period, no reason is required of HR — no new gate` — the other
 *   half of the same bill, added on 2026-09-14 so that HR answering a request
 *   the signer could not reach at least recorded why.
 *
 * **The bill is not being paid any more: the wait was removed instead.** ถอนใบ
 * is one press by the owner of the entry, so there is no ตัดสิน to be late for,
 * no reason for HR to give, and no pile. The wall itself is unchanged and is
 * still tested — above, on `withdrawEligibility`, which is now the only thing
 * standing between an `approved` row and its removal.
 */

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
  const no = cancelPermission(EMP, signed(), '', { policy: D3, on: '2026-09-20' });
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
  // ⚠ IT WAS FOUR RULES, and `withdrawDecisionPermission` was the fourth —
  // 2026-09-18. The property is the same for the three that are left: the
  // trailing options object defaults to NO cutoff, which is what lets a screen
  // ask the counterfactual "would there have been a button here at all" without
  // a second copy of the rule. See `wouldOffer` in components/EmployeeView.jsx.
  assert.equal(editPermission(EMP, entry(), '').ok, true);
  assert.equal(cancelPermission(EMP, entry()).ok, true);
  assert.equal(withdrawEligibility(EMP, signed()).ok, true);
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
  // TWO TAILS SINCE 2026-09-18, and it was three: `cancelCutoffQueueNote` was
  // the หัวหน้า's, on a screen that no longer exists. What is left is the
  // employee's refusal and HR's note, and both still begin at the same lead.
  const lead = cancelCutoffLead(signed(), D3);
  const employee = cancelCutoffRefusal(EMP, signed(), D3, '2026-09-20').error;
  const hr = cancelCutoffHrNote(signed(), D3);
  for (const line of [employee, hr]) assert.ok(line.startsWith(lead), line);
});

/**
 * ── ⚠ ONE-LINE FORM, FOR THE ROW — 2026-09-16 TO 2026-09-18 ────────────────
 *
 * `cancelCutoffShortNote` said the wall's fact in one line — `งวดปิด
 * 03/09/2569 — เฉพาะฝ่ายบุคคล` — asked for with *ไม่อยากให้ความสูงเกิน 2 แถว*
 * on คำขอถอนใบ, where the whole sentence took two lines of its own in a 300px
 * cell under a reason that had already taken two. Two tests pinned it: that it
 * kept the date and whose decision it was, and that it stayed strictly less
 * than the queue's own sentence rather than forking into a second wording.
 *
 * Both it and `cancelCutoffQueueNote` went with that table. The remaining
 * short form is the one below, which is a different thing: four words for a
 * button cell, not a cut of the sentence.
 */
test('the short form is the four words the button cell has room for', () => {
  assert.equal(cancelCutoffRefusal(EMP, entry(), D3, '2026-09-20').short, 'หมดเวลาแก้ไข');
});
