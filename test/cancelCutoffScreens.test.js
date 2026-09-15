/**
 * งวดปิดเอง — WHAT THE FOUR SCREENS DO ABOUT IT.
 *
 * Source text, not a render: there is no JSX transform under `node --test`, so
 * every component test in this project reads the file. That is exactly why the
 * rule itself lives in lib/entries.js — test/cancelCutoff.test.js runs it. What
 * is checkable here is the SHAPE of the call: which question each screen asks,
 * and that none of them works out a date for itself.
 *
 * Designed in docs/plan-cancel-cutoff-day.md §8.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
/** The same file with its block comments gone — for "nothing DOES this" checks. */
const bare = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const EMPLOYEE = 'components/EmployeeView.jsx';
const QUEUE = 'components/WithdrawalRequests.jsx';
const FORM = 'components/OtForm.jsx';
const SCREENS = [EMPLOYEE, QUEUE, FORM];

// ── no screen does the arithmetic ───────────────────────────────────────────

/**
 * THE ONE RULE THAT HOLDS ACROSS ALL THREE. `cancelDeadline` and the comparison
 * against `today()` exist once, in lib/entries.js, and the four routes enforce
 * with them. The day a component works out a deadline for itself is the day
 * there are two date rules that can disagree — and the one that disagrees
 * silently is the screen, because the server is the one that gets tested
 * against a database.
 */
test('no screen computes a cutoff date of its own', () => {
  for (const f of SCREENS) {
    const src = bare(f);
    assert.ok(!/cancelCutoffDay/.test(src), `${f} reads the raw policy key instead of asking the rule`);
    assert.ok(!/cancelDeadline\s*\(/.test(src), `${f} builds the deadline itself`);
    assert.ok(!/getDate\(\)|new Date\(\)\.get/.test(src), `${f} asks the browser for the date`);
  }
});

/** And they read the policy from the one context, not from a prop each. */
test('each screen takes the policy from usePolicy, not from a prop', () => {
  for (const f of SCREENS) {
    assert.match(read(f), /usePolicy\(\)/, `${f} does not read the shared policy`);
  }
});

// ── รายการของฉัน: the buttons go, a sentence stays ─────────────────────────

const emp = read(EMPLOYEE);

/**
 * THE COUNTERFACTUAL IS THE WHOLE OF THIS TEST.
 *
 * `past(e)` alone would put หมดเวลาแก้ไข on every row of a closed งวด —
 * including a ไม่อนุมัติ request, which has no แก้ไข button for a completely
 * different reason. A sentence standing where a button is absent is read as the
 * explanation for THAT absence, and it would be lying. components/HrEntries.jsx
 * carries the same warning, written after the same mistake.
 */
test('the sentence is gated by BOTH the wall and the counterfactual', () => {
  assert.match(emp, /const past = \(e\) => !!cancelCutoffRefusal\(user, e, policy\);/);
  assert.match(
    emp,
    /const wouldOffer = \(e\) => awaitingFirstSignature\(e\) \|\| withdrawEligibility\(user, e\)\.ok;/,
  );
  assert.match(emp, /\{past\(e\) && wouldOffer\(e\) && \(/);
});

/**
 * `withdrawEligibility(user, e)` WITHOUT a policy is the pre-cutoff answer by
 * construction — the trailing options object defaults to no cutoff. Passing one
 * here would make the counterfactual ask the same question as `past`, both
 * would be true together, and the sentence would never be drawn at all.
 */
test('the counterfactual call deliberately passes no policy', () => {
  assert.ok(
    !/withdrawEligibility\(user, e, \{/.test(bare(EMPLOYEE)),
    'the counterfactual was handed the policy, which collapses it into the wall',
  );
});

test('all three buttons are withheld past the cutoff, not merely disabled', () => {
  assert.match(emp, /\{!past\(e\) && awaitingFirstSignature\(e\) && \(/);
  assert.match(emp, /\{!past\(e\) && withdrawEligibility\(user, e\)\.ok && \(/);
  // Nothing on this screen greys a button instead: a disabled pair is the shape
  // of a decision somebody else will still make, and nobody presses ยกเลิก on
  // an employee's behalf.
  assert.ok(!/disabled=\{past/.test(bare(EMPLOYEE)));
});

/**
 * NO NEW CSS, and the class pair is the reason. `.own-note` is already "the
 * sentence that stands where a row has no buttons" and
 * `.row-actions:has(> .own-note)` already knows to wrap the cell for it. The
 * rule that hides it above 861px is scoped to `.queue-table`; this table is
 * `.stack-table`, so it reads at every width.
 */
test('the sentence reuses .cell-sub .own-note and adds no class', () => {
  assert.match(emp, /className="cell-sub own-note"/);
  const css = read('app/styles.css');
  assert.match(css, /\.own-note \{ max-width: 190px; \}/);
  assert.match(css, /\.row-actions:has\(> \.own-note\)/);
  assert.match(css, /\.queue-table td\.act-col \.own-note \{ display: none; \}/);
  assert.match(emp, /<table className="stack-table">/);
});

/** Four words in the cell, the whole sentence on the tooltip — one source. */
test('the short form is drawn and the long one is the title', () => {
  assert.match(emp, /title=\{cancelCutoffRefusal\(user, e, policy\)\.error\}/);
  assert.match(emp, /\{cancelCutoffRefusal\(user, e, policy\)\.short\}/);
  // Neither string is typed into the screen — both come off the rule.
  assert.ok(!/หมดเวลาแก้ไข/.test(bare(EMPLOYEE)), 'the sentence is spelled a second time here');
});

/**
 * `5c2a0e2` is on the record for the failure this avoids: the pop-up went on
 * offering a button the row had just stopped offering, and pressing it found a
 * 409 behind the modal. The foot asks the same two questions the row does.
 */
test('the EntryDetail foot answers exactly what the row answered', () => {
  const foot = emp.slice(emp.indexOf('function EntryDetail'));
  assert.match(foot, /const mayEdit = !past && awaitingFirstSignature\(e\);/);
  assert.match(foot, /const mayAsk = !past && withdrawEligibility\(user, e\)\.ok;/);
  assert.match(foot, /\{past && wouldOffer && \(/);
  assert.match(foot, /className="cell-sub own-note"/);
});

// ── คิวคำขอถอน: a grey pair, and a line everybody reads ────────────────────

const queue = read(QUEUE);

/**
 * A GREY PAIR AND NOT A SENTENCE, which is the opposite of the employee screen
 * and follows from the same three-tier rule: a disabled button is the shape of
 * a decision that STILL EXISTS and is not this reader's. ฝ่ายบุคคล presses
 * exactly these two. Nobody presses an employee's ยกเลิก.
 */
test('the two buttons are drawn and dead, never removed', () => {
  assert.match(queue, /const locked = \(e\) => past\(e\) && !mayPass;/);
  assert.match(queue, /disabled=\{busy \|\| locked\(e\)\}/);
  // Both of them, not one.
  assert.equal((queue.match(/disabled=\{busy \|\| locked\(e\)\}/g) || []).length, 2);
  // The row is still fetched and still drawn — somebody who asked must not
  // disappear from their หัวหน้า's screen without a word. Nothing filters the
  // card list; `batch` narrows only what the BATCH button acts on.
  assert.match(queue, /\{rows\.map\(\(e, i\) =>/);
  assert.ok(!/rows\.filter[\s\S]{0,40}\.map\(\(e, i\)/.test(bare(QUEUE)));
});

/**
 * DRAWN FOR EVERY READER, not only for the one whose buttons are grey. On a
 * หัวหน้า's screen it explains the grey pair; on ฝ่ายบุคคล's, whose buttons
 * work, it IS the warning strip §8.6 asked for — one sentence doing both jobs
 * rather than the same fact written in two places.
 */
test('the reason line is gated on past(e), not on locked(e)', () => {
  assert.match(queue, /\{past\(e\) && \(\n\s+<div className="hint">/);
  assert.match(queue, /cancelCutoffQueueNote\(e, policy\)/);
});

/** It asks the rule and the app's one spelling of who is exempt. */
test('the queue asks mayCorrectEntries rather than listing roles', () => {
  assert.match(queue, /const mayPass = mayCorrectEntries\(user\);/);
  assert.ok(!/'hr', 'admin'|"hr", "admin"/.test(bare(QUEUE)), 'a second role list appeared');
});

/**
 * อนุมัติให้ถอนทั้งหมด PROMISES WHAT IT CAN DELIVER. Counted off `batch` —
 * the open requests this reader can actually decide — because a button headed
 * ทั้งหมด that clears part of the list lies twice: in its name, and again in
 * the failure list the server hands back for the rest.
 */
test('the batch button, its dialog and its loop all use batch', () => {
  assert.match(queue, /const batch = rows\.filter\(\(e\) => !locked\(e\)\);/);
  assert.match(queue, /\{batch\.length > 1 && \(/);
  assert.match(queue, /for \(const e of batch\) \{/);
  assert.match(queue, /\{batch\.map\(\(e, i\) =>/);
  assert.match(queue, /const totalHours = batch\.reduce\(/);
});

/**
 * PAST THE CUTOFF ฝ่ายบุคคล MUST SAY WHY — and inside an open งวด the dialog is
 * exactly what it was before any of this existed. A gate that appears where it
 * has nothing to guard is a gate people learn to click through.
 */
test('the reason field appears only past the cutoff, on both HR paths', () => {
  assert.match(queue, /\{past\(granting\) && \(/);
  assert.match(queue, /disabled=\{busy \|\| \(past\(granting\) && !grantNote\.trim\(\)\)\}/);
  assert.match(queue, /\{closed\.length > 0 && \(/);
  assert.match(queue, /disabled=\{busy \|\| \(closed\.length > 0 && !batchNote\.trim\(\)\)\}/);
  assert.match(queue, /เหตุผลที่ตัดสินหลังงวดปิด \*/);
});

/** The note rides only on the rows that need one. */
test('the batch sends its reason to the closed rows and to nothing else', () => {
  assert.match(queue, /note: past\(e\) \? batchNote\.trim\(\) \|\| undefined : undefined/);
});

/**
 * THE REFUSAL DIALOG GAINS NO SECOND FIELD. It has required a reason since
 * before this existed, for its own reason — the employee reads it — and one box
 * asking for two reasons is a box nobody finishes.
 */
test('ไม่อนุมัติการถอน keeps its one reason field', () => {
  const refuse = queue.slice(queue.indexOf('{refusing && ('), queue.indexOf('{/* ── THE BATCH'));
  assert.match(refuse, /past\(refusing\) && <Alert kind="warn">/);
  assert.equal((refuse.match(/<label>/g) || []).length, 1);
});

// ── ฟอร์มแก้ไขของ HR: a strip and a dialog ─────────────────────────────────

const form = read(FORM);

/**
 * `isPastCancelCutoff` AND NOT `cancelCutoffRefusal`. The refusal returns null
 * for ฝ่ายบุคคล on its first line — the right answer to "may they", the wrong
 * one to "should they be told". If this screen ever asks the refusal, the
 * warning silently never appears again.
 */
test('the form asks the fact, not the refusal', () => {
  assert.match(form, /const pastCutoff = hrEdit && !!entry && isPastCancelCutoff\(entry, policy\);/);
  assert.ok(!/cancelCutoffRefusal/.test(bare(FORM)), 'the HR form asks the rule that always says null to HR');
});

/** Measured on the STORED entry, so a half-typed date does not move the strip. */
test('the cutoff is measured on entry, never on form.workDate', () => {
  assert.ok(!/isPastCancelCutoff\(\s*\{[\s\S]{0,40}form\.workDate/.test(form));
  assert.ok(!/isPastCancelCutoff\(form/.test(form));
});

/**
 * BOTH, BECAUSE THE USER ASKED FOR BOTH on 2026-09-14, knowing this dialog will
 * appear often — correcting last month is what lib/periodStatus.js records as
 * the thing HR does most. If it wears out, the thing to take away is the
 * dialog, not the strip and never the rule.
 */
test('there is a strip on the way in and a dialog before the write', () => {
  assert.match(form, /\{pastCutoff && <Alert kind="warn">\{cancelCutoffHrNote\(entry, policy\)\}<\/Alert>\}/);
  assert.match(form, /if \(pastCutoff && !confirmed\) \{\n\s+setConfirming\(true\);\n\s+return;\n\s+\}/);
  assert.match(form, /<ConfirmDialog\n\s+title="แก้ใบของงวดที่ปิดแล้ว"/);
});

/**
 * NO ⚠️ IN THE BODY. `Alert` draws its own mark from `mark`, which defaults to
 * true, so a symbol typed into the text is the second one on the strip. (The
 * `warn` strings on the นโยบาย rows DO carry their own — a different mechanism,
 * and not a precedent for this.)
 */
test('no Alert body on these screens repeats the mark Alert draws', () => {
  for (const f of [QUEUE, FORM, EMPLOYEE]) {
    for (const m of read(f).matchAll(/<Alert[^>]*>([\s\S]*?)<\/Alert>/g)) {
      assert.ok(!m[1].includes('⚠'), `${f} types ⚠️ inside an Alert body`);
    }
  }
  // …and the sentences themselves, which are built in lib/entries.js.
  assert.ok(!/⚠/.test(read('lib/entries.js').slice(read('lib/entries.js').indexOf('export function cancelCutoffLead'))));
});

/**
 * ย้อนกลับ AND NOT ยกเลิก, which is `ConfirmDialog`'s own default: in this app
 * ยกเลิก means cancelling an OT entry, and the form behind this box has a
 * button carrying that word. The same reason EntryDetail's foot says
 * ปิดหน้าต่าง rather than ปิด.
 *
 * And the confirm repeats the words of the button just pressed, so the box
 * answers the question that button asked rather than opening a new one.
 */
test('the dialog names its two answers instead of taking the defaults', () => {
  assert.match(form, /cancelLabel="ย้อนกลับ"/);
  assert.match(form, /confirmLabel="บันทึกการแก้ไข"/);
  const dialog = form.slice(form.indexOf('<ConfirmDialog'));
  assert.ok(!/danger/.test(dialog.slice(0, dialog.indexOf('</ConfirmDialog>'))),
    'red is this app\'s mark for a press that destroys; this one saves a correction');
});
