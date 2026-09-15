import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { cancelPermission } from '../lib/entries.js';

/**
 * ฝ่ายบุคคลยกเลิกใบได้ พร้อมเหตุผล — and `void` withdrawn for good.
 *
 * ── THE HOLE THIS CLOSES ─────────────────────────────────────────────────────
 *
 * Asked on 2026-09-15: *"ที่ hr อนุมัติไปแล้ว ขอยกเลิก/แก้ไข ได้หรือไม่"*. The
 * answer read off the code was แก้ไขได้ ยกเลิกไม่ได้ — and worse than that, an
 * `approved` entry whose งวด had passed its วันตัด could be removed by NOBODY:
 *
 *   ขอถอนใบ   `withdrawEligibility` is the OWNER's press, and the cutoff had
 *             taken it. HR cannot ask on somebody's behalf; there is no path.
 *   ยกเลิก     `cancelPermission` was the owner's too. HR reached only rows the
 *             system had generated, through `void`.
 *   ไม่อนุมัติ  `approvalPermission` acts on `pending_*` and answers 409 to
 *             anything already decided.
 *   แก้ไข      lowers hours but never to nought — `noOtHoursMessage` refuses it.
 *
 * 419 of the 431 entries on the laptop's database were live and in that state.
 * ฝ่ายบุคคล may now end any live entry outright, with a reason recorded.
 *
 * ── AND NOT BY FILING A REQUEST IN HR's NAME ────────────────────────────────
 *
 * The other shape was offered and refused twice over: it would write down that
 * somebody asked to withdraw when the employee asked nothing, and
 * `withdrawDecisionPermission` refuses `ผู้ขอถอนไม่สามารถอนุมัติคำขอของตนเองได้`
 * — so HR answering their own request would need that rule weakened to admit the
 * one case it exists to refuse. ฝ่ายบุคคล are the last signature on an approved
 * entry; there is nobody for them to ask.
 *
 * The cutoff's own side of this — that HR pass the wall at every press — is
 * test/cancelCutoff.test.js's, and the employee's half of `cancelPermission` is
 * test/cancelPermission.test.js's. This file is the ฝ่ายบุคคล branch, the two
 * screens that press it, and the removal of `void`.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const rules = read('lib/entries.js');
const route = read('app/api/entries/[id]/cancel/route.js');
const hrEntries = read('components/HrEntries.jsx');
const form = read('components/OtForm.jsx');
const queue = read('components/ApprovalQueue.jsx');
const model = read('src/models/OtEntry.js');
const kit = read('components/common.jsx');

/** Commentary quotes the words it is about, so "this word is not on the screen"
    has to be asked of the code with the comments taken out. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/[^\n]*/g, '');

const HR = { _id: 'h1', role: 'hr' };
const ADMIN = { _id: 'a1', role: 'admin' };
const EMP = { _id: 'e1', role: 'employee' };
const OTHER = { _id: 'e2', role: 'employee' };

const entry = (over = {}) => ({
  _id: 'x1',
  employee: 'e1',
  workDate: '2026-08-20',
  status: 'approved',
  managerDecision: { by: 'm1', at: new Date('2026-08-21T02:00:00Z') },
  ...over,
});

// ── the rule ────────────────────────────────────────────────────────────────

/**
 * THE PRESS ITSELF, AT EVERY LIVE STATUS.
 *
 * `approved` is the one the question was asked about, and the other two are
 * here because the answer to "which statuses" was **ทุกสถานะที่ยังมีชีวิต** —
 * chosen so that this rule and `editPermission` cover the same rows. An HR who
 * may rewrite a row but not end it is a screen with one button missing on it.
 */
test('ฝ่ายบุคคล may cancel a live entry at any status, and admin with them', () => {
  for (const user of [HR, ADMIN]) {
    for (const status of ['pending_mgr', 'pending_hr', 'approved']) {
      assert.deepEqual(
        cancelPermission(user, entry({ status }), 'ลงวันที่ผิด'),
        { ok: true, action: 'hr_cancel' },
        `${user.role} · ${status}`,
      );
    }
  }
});

/**
 * THE REASON IS THE RULE's, NOT THE DIALOG's — asked for in as many words
 * (*"แต่ต้องใส่ เหตุผลกำกับ"*). A gate that lives only on a screen is a gate
 * `curl` walks past, which is the same argument `editPermission` and
 * `withdrawDecisionPermission` each make about their own 400.
 */
test('no reason, no cancellation — and whitespace is not a reason', () => {
  for (const note of [undefined, null, '', '   ', '\n\t']) {
    const r = cancelPermission(HR, entry(), note);
    assert.equal(r.ok, false, `note ${JSON.stringify(note)}`);
    assert.equal(r.status, 400);
    assert.match(r.error, /กรุณาระบุเหตุผลการยกเลิก/);
  }
});

/** Closed is closed for HR as it is for everybody: cancelling twice is not
    idempotence, it is a second history row saying something that already
    happened. Checked BEFORE the reason, so a reader is told the real objection
    rather than being asked to type one for a press that cannot happen. */
test('rejected and cancelled are refused, and refused as 409 rather than 400', () => {
  for (const status of ['rejected', 'cancelled']) {
    const r = cancelPermission(HR, entry({ status }), 'อยากลบ');
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.match(r.error, /ยกเลิกซ้ำไม่ได้/);
  }
  // …and the order: no reason AND closed answers about being closed.
  assert.equal(cancelPermission(HR, entry({ status: 'cancelled' }), '').status, 409);
});

/**
 * `hr_cancel` AND NOT `cancel`.
 *
 * The same argument the withdrawn `void` action was written on, and the reason
 * the route takes the word off the verdict rather than off the caller's role: a
 * trail that says พนักงานยกเลิกคำขอ about something a person in ฝ่ายบุคคล did
 * names the wrong actor on the one row somebody opens the history to read.
 */
test('the two branches name two different events', () => {
  assert.equal(cancelPermission(HR, entry({ status: 'pending_mgr' }), 'x').action, 'hr_cancel');
  assert.equal(cancelPermission(EMP, entry({ status: 'pending_mgr' })).action, 'cancel');
});

/** Nobody else gains anything. The branch is `mayCorrectEntries`, which is the
    same two บทบาท `editPermission` lets through, and a signer is not one. */
test('a หัวหน้า and a stranger are refused exactly as before', () => {
  for (const user of [OTHER, { _id: 'm1', role: 'supervisor', department: 'd1' }]) {
    const r = cancelPermission(user, entry({ status: 'pending_mgr' }), 'มีเหตุผล');
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    assert.match(r.error, /ยกเลิกได้เฉพาะรายการของตนเอง/);
  }
});

/** The employee's own branch is untouched — including that it asks for no
    reason. A reason is owed for changing what somebody ELSE established. */
test('the employee still cancels their own unsigned request with no reason', () => {
  const own = entry({ status: 'pending_mgr', managerDecision: undefined });
  assert.deepEqual(cancelPermission(EMP, own), { ok: true, action: 'cancel' });
});

/**
 * THE SIGNATURE MATCHES `editPermission` ARGUMENT FOR ARGUMENT.
 *
 * `(user, entry, note, { policy, on })`. The two rules are read together and
 * changed together; a `note` that is third in one and fourth in the other is a
 * call site waiting to be written wrong — and the one that gets it wrong would
 * pass an options object where a reason belongs, which reads as a reason
 * (`[object Object]`) and silently disables the cutoff.
 */
test('cancelPermission and editPermission take the same arguments in the same order', () => {
  assert.match(rules, /export function cancelPermission\(user, entry, note = '', \{ policy, on \} = \{\}\) \{/);
  assert.match(rules, /export function editPermission\(user, entry, note = '', \{ policy, on \} = \{\}\) \{/);
});

/** ABOVE THE CUTOFF, like every other ฝ่ายบุคคล path — the property that makes
    วันตัด not ปิดงวด. Pinned as ORDER here and as behaviour in
    test/cancelCutoff.test.js, because the behaviour is what the order buys. */
test('the ฝ่ายบุคคล branch is reached before the month wall', () => {
  const body = rules.slice(rules.indexOf('export function cancelPermission'));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  assert.ok(
    fn.indexOf('mayCorrectEntries(user)') < fn.indexOf('cancelCutoffRefusal('),
    'the cutoff is asked before HR are let through — that is ปิดงวด again',
  );
});

// ── the route ───────────────────────────────────────────────────────────────

/** The reason reaches the rule. Without this argument the rule's 400 could
    never fire from a browser and the requirement would live only in a dialog. */
test('/cancel hands the typed reason to the rule, and logs the action it earned', () => {
  assert.match(route, /cancelPermission\(user, entry, payload\?\.note, \{/);
  assert.match(route, /entry\.log\(user, allowed\.action, payload\?\.note, from\);/);
  // The route no longer chooses between two words by testing the other branch.
  assert.ok(!/allowed\.action === 'void'/.test(route));
});

/**
 * AN OPEN คำขอถอน IS ANSWERED BY THE SAME PRESS.
 *
 * Only ฝ่ายบุคคล can reach it — a request is open only after the first
 * signature, and past that the employee's branch refuses — so this is not a
 * second rule, it is the consequence of the first. Left alone the subdocument
 * would sit at `requested` on a `cancelled` row: `withdrawalOpen` would keep
 * counting it on the nav badge and in คำขอถอนใบ, and `periodItems` would keep
 * calling that month unfinished, for a question nobody can answer any more.
 */
test('cancelling a row with a request waiting closes that request as granted', () => {
  assert.match(route, /if \(hasOpenWithdrawal\(entry\)\) \{/);
  assert.match(route, /entry\.withdrawal = withdrawalDecision\(entry\.withdrawal\.toObject\(\), user, \{/);
  assert.match(route, /granted: true,/);
  // The same helper the decide route uses, so one record has one shape.
  assert.match(route, /from '@\/lib\/withdrawal\.js'/);
});

// ── the vocabulary ──────────────────────────────────────────────────────────

test('hr_cancel is a history action with a Thai label of its own', () => {
  assert.match(model, /'cancel', 'void', 'hr_cancel', 'edit', 'hr_edit', 'recompute',/);
  assert.match(kit, /hr_cancel: \{ label: 'ฝ่ายบุคคลยกเลิกใบ', tone: 'off' \},/);
  // …and it does not borrow the employee's.
  assert.match(kit, /cancel: \{ label: 'พนักงานยกเลิกคำขอ', tone: 'off' \},/);
});

/**
 * `void` AND `submit_birthday` STAY IN THE ENUM AND IN THE LABELS, AND THAT IS
 * DELIBERATE.
 *
 * No new row can carry either. The laptop's database holds none — 0 of 431 —
 * but it is not the only installation: docs/docker.md describes a second one on
 * a Linux box with its own `mongod`, and a backup restored from before today
 * would bring such rows with it. A value dropped from the enum fails validation
 * the next time anything touches the row that has it. They are vocabulary for
 * reading old rows; the FEATURE is the button and the rule, and those are gone.
 */
test('the two retired actions keep their enum entries and their labels', () => {
  assert.match(model, /'submit', 'submit_proxy', 'submit_birthday',/);
  assert.match(model, /'cancel', 'void', 'hr_cancel',/);
  assert.match(kit, /void: \{ label: 'ฝ่ายบุคคลถอนใบที่ระบบสร้าง', tone: 'off' \},/);
  assert.match(kit, /submit_birthday: \{ label: 'ระบบสร้างใบวันเกิด \(ฝ่ายบุคคลสั่ง\)', tone: 'file' \},/);
});

// ── void, withdrawn ─────────────────────────────────────────────────────────

/**
 * THE FEATURE IS GONE FROM THE RULES AND FROM BOTH SCREENS.
 *
 * `สร้างใบวันเกิดของเดือนนี้` wrote rows nobody had filled a form in for, and
 * `void` was their way back out — no reason required, because a row nobody ever
 * claimed establishes nothing to explain away. The generator was withdrawn, OT
 * วันเกิด is filed like any other OT and merely wears a mark
 * (`isBirthdayWelfare`), and the hole `void` was patching is closed properly by
 * the rule above. All three of its reasons are spent.
 */
test('isUntouchedSystemFiling and its rule are gone from the source', () => {
  for (const [name, src] of Object.entries({
    'lib/entries.js': rules,
    'components/HrEntries.jsx': hrEntries,
    'components/ApprovalQueue.jsx': queue,
  })) {
    assert.ok(!/isUntouchedSystemFiling\(/.test(strip(src)), `${name} still calls it`);
    assert.ok(!/UNTOUCHED_ACTIONS/.test(strip(src)), `${name} still reads the list`);
  }
  assert.ok(!/export function isUntouchedSystemFiling/.test(rules));
  assert.ok(!/action: 'void'/.test(strip(rules)));
});

test('ถอนใบวันเกิด is not a button on either screen any more', () => {
  assert.ok(!/ถอนใบวันเกิด/.test(strip(hrEntries)));
  assert.ok(!/ถอนใบวันเกิด/.test(strip(queue)));
  assert.ok(!/voidEntry/.test(strip(queue)));
  assert.ok(!/voidEntry/.test(strip(hrEntries)));
});

/** `isSystemFiled` STAYS. It is a MARK for reading an old row — "the system
    wrote this, nobody filled a form in" — and not a permission. The pair
    `isUntouchedSystemFiling(e) || isSystemFiled(e)` only ever answered what the
    second answers, since an untouched generated row is a generated row. */
test('the generated-row mark survives the rule that used to read it', () => {
  assert.match(rules, /export function isSystemFiled\(entry\)/);
  assert.match(queue, /\{isSystemFiled\(e\)\s*\n\s*\? 'รายการนี้ระบบสร้างจากกฎสวัสดิการวันเกิด/);
});

/** One sentence for every barred row, which is what was always true of all but
    one of them. A constant rather than a function, because the branch that made
    it depend on the row is the branch that went. */
test('the queue says one thing to a reviewer barred from their own filing', () => {
  assert.match(queue, /const OWN_FILING_NOTE = \{/);
  assert.ok(!/function ownFilingNote/.test(queue));
  assert.match(queue, /if \(barredAsOwnFiling\(e, user\)\) return OWN_FILING_NOTE;/);
});

// ── the two screens ─────────────────────────────────────────────────────────

/**
 * ตรวจสอบประจำเดือน — แก้ไข AND ยกเลิก IN ONE BRANCH.
 *
 * Both are `mayCorrectEntries`'s and both are refused on a closed row, so they
 * share the gate rather than each testing for itself. `ยกเลิก` and not
 * `ยกเลิกใบ`: it is the word the employee's own press carries, and this is the
 * same act done by somebody else.
 */
test('the row carries both writes, gated alike', () => {
  assert.match(hrEntries, /\{!mayEdit \? null : closed \? \(/);
  assert.match(hrEntries, /className="btn ghost sm with-icon" onClick=\{\(\) => setEditing\(e\)\}/);
  assert.match(hrEntries, /className="btn ghost danger sm with-icon"/);
  assert.match(hrEntries, /onClick=\{\(\) => \{ setCancelling\(e\); setCancelNote\(''\); \}\}/);
  assert.match(strip(hrEntries), /\n\s*ยกเลิก\n/);
});

/**
 * GHOST AND NOT FILLED. `.btn.danger` is the filled red this app keeps for the
 * press that actually destroys — which is the one inside the dialog, not the
 * one that opens it. `.btn.ghost.danger` is an existing rule in app/styles.css;
 * nothing new was drawn for this.
 */
test('the row button is danger-light and the dialog button is the filled one', () => {
  assert.match(hrEntries, /className="btn ghost danger sm with-icon"/);
  assert.match(hrEntries, /className="btn danger" disabled=\{busy \|\| !cancelNote\.trim\(\)\}/);
  assert.match(read('app/styles.css'), /\n\.btn\.ghost\.danger \{/);
});

/**
 * THE DIALOG IS `Modal` AND NOT `ConfirmDialog`, and the reason is mechanical:
 * the confirm button has to stay dead until a reason is typed, and
 * `ConfirmDialog` has no `confirmDisabled`. Adding one would be a prop with a
 * single caller; this box is the shape ไม่อนุมัติคำขอถอนใบ in
 * components/WithdrawalRequests.jsx already has for the same job.
 */
test('the dialog refuses to submit an empty reason and says the press is final', () => {
  assert.match(hrEntries, /<Modal\s+title="ยกเลิกใบนี้"/);
  assert.match(hrEntries, /dirty=\{cancelNote\.trim\(\)\.length > 0\}/);
  assert.match(hrEntries, /<Alert kind="warn">/);
  assert.match(hrEntries, /แก้กลับไม่ได้<\/strong>/);
  assert.match(hrEntries, /maxLength=\{200\}/);
  assert.match(hrEntries, /จำเป็นต้องกรอก/);
  // A question and an answer, not a question and a shrug.
  assert.match(hrEntries, /ไม่ยกเลิกแล้ว/);
  assert.match(hrEntries, /ยืนยันการยกเลิก/);
  assert.ok(!/ConfirmDialog/.test(strip(hrEntries)), 'the box that cannot disable its own confirm');
});

/** A reader who does not know the press also answers the waiting request would
    leave the dialog expecting to go and grant it afterwards. */
test('the dialog says when an open คำขอถอน is being answered too', () => {
  assert.match(hrEntries, /cancelling\.withdrawal\?\.state === 'requested' && \(/);
  assert.match(hrEntries, /จะถือว่าอนุมัติคำขอนั้นไปด้วย/);
});

/**
 * ONE DIALOG, DRAWN IN BOTH RETURNS. This component renders two different
 * things — the table, and the editor behind แก้ไข — and the press exists on
 * both. Two copies of a box with a mandatory reason is two places for the
 * requirement to drift out of step with the rule.
 */
test('the dialog is declared once and hangs over the editor as well as the table', () => {
  assert.match(hrEntries, /const cancelDialog = cancelling && \(/);
  assert.equal((hrEntries.match(/\{cancelDialog\}/g) || []).length, 2);
  assert.equal((hrEntries.match(/<Modal\b/g) || []).length, 1);
});

/** Coming back to a form over a row that no longer exists is a form whose
    บันทึกการแก้ไข would answer 409. */
test('cancelling from inside the editor shuts the editor', () => {
  const fn = hrEntries.slice(hrEntries.indexOf('async function cancelEntry'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /setEditing\(null\);/);
  assert.match(body, /await load\(\);/);
  assert.match(body, /onChanged\?\.\(\);/);
});

// ── the form's buttons ──────────────────────────────────────────────────────

/**
 * ยกเลิก HAD TO GIVE THE WORD BACK.
 *
 * It named the button that SHUT the form, on every screen this component
 * serves. In this app ยกเลิก names a real act — the employee ending their own
 * request, and now ฝ่ายบุคคล ending anybody's — and on the HR editor both
 * presses are on screen at once, one shutting a form and the other taking hours
 * off the books.
 *
 * RENAMED EVERYWHERE, not only where it collided. Filing a new request and
 * บันทึกแทน have no entry to cancel, so nothing there was ambiguous — but
 * leaving the word behind would mean ยกเลิก shuts a form on two screens and
 * destroys a row on a third, which is the same failure at one remove. Asked and
 * answered in those terms on 2026-09-15.
 */
test('the button that leaves the form says ย้อนกลับ', () => {
  assert.match(form, /<button type="button" className="btn ghost" onClick=\{cancel\}>ย้อนกลับ<\/button>/);
  assert.ok(!/onClick=\{cancel\}>ยกเลิก</.test(form), 'the exit still claims the word');
});

/**
 * AND THE REAL ONE IS DRAWN ONLY WHERE THERE IS A ROW TO END — `onCancelEntry`,
 * which components/HrEntries.jsx alone passes. The form owns none of what
 * follows the press: no dialog, no reason, no request, no reload. A child that
 * wrote its own parent's list would leave the table behind it stale.
 */
test('the form offers ยกเลิก only when the parent gives it somewhere to go', () => {
  assert.match(form, /entry, template, onSaved, onCancel, onCancelEntry,/);
  assert.match(form, /\{onCancelEntry && \(/);
  assert.match(form, /className="btn ghost danger" onClick=\{onCancelEntry\}/);
  // …and no state of its own for it.
  assert.ok(!/useState\(.*cancelling/.test(form));
  assert.match(hrEntries, /onCancelEntry=\{\(\) => setCancelling\(editing\)\}/);
});

/**
 * ยกเลิก · ย้อนกลับ · บันทึกการแก้ไข, ALL FLUSH RIGHT — asked for in that shape.
 * ย้อนกลับ sits between them so the press that destroys is not a thumb's width
 * from the press made dozens of times a month.
 */
test('the destroying button is not next to the saving one', () => {
  const acts = form.slice(form.indexOf('const actions = (cancel) => ('));
  const body = strip(acts.slice(0, acts.indexOf('\n  );')));
  const order = ['onCancelEntry', 'ย้อนกลับ', 'บันทึกการแก้ไข'].map((s) => body.indexOf(s));
  assert.ok(order.every((i) => i >= 0), 'one of the three buttons is missing');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the red button moved next to save');
  // No left-hand group: the row is `justifyContent: 'flex-end'` and stays so.
  assert.match(form, /className="row form-actions" style=\{\{ marginTop: 18, justifyContent: 'flex-end' \}\}/);
});
