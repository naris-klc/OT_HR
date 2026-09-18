/**
 * งวดปิดเอง — WHAT THE SCREENS DO ABOUT IT.
 *
 * ⚠ IT WAS FOUR SCREENS UNTIL 2026-09-18 and is two. คิวคำขอถอน
 * (`components/WithdrawalRequests.jsx`) was the third, and the section below
 * that tested it is kept as a note rather than deleted, because the argument it
 * recorded — a grey pair of buttons rather than no buttons, and a line every
 * reader gets — is the one this project keeps having.
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
const FORM = 'components/OtForm.jsx';
const SCREENS = [EMPLOYEE, FORM];

// ── no screen does the arithmetic ───────────────────────────────────────────

/**
 * THE ONE RULE THAT HOLDS ACROSS BOTH. `cancelDeadline` and the comparison
 * against `today()` exist once, in lib/entries.js, and the routes enforce with
 * them. The day a component works out a deadline for itself is the day
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
 * ⚠ IT WAS `.cell-sub own-note` — QUIET GREY TEXT — UNTIL 2026-09-18, on the
 * reasoning that a sentence is not a control and should not look like one. The
 * user asked for a chip in those words: *ข้อความ หมดเวลาแก้ไข ให้ใช้เป็นป้าย
 * สีเทา เหมือนป้ายสถานะยกเลิก* — standing in a row of pill-shaped buttons, loose
 * text read as a rendering fault rather than as the row's answer.
 *
 * `own-note` IS STILL IN THE LIST and that is the half this test guards: it is
 * the 190px cap and the thing `.row-actions:has(> .own-note)` knows to wrap the
 * cell for. The rule hiding it above 861px is scoped to `.queue-table`; this
 * table is `.stack-table`, so it reads at every width.
 *
 * `.chip.locked` AND NOT `.chip.st-cancelled`, whose two declarations it
 * copies. The row is `approved`; an `st-` class means the status of the ใบ, and
 * a chip wearing a class named after something else follows that something else
 * the day it is restyled — the reason `.chip.scan-off` is not `.chip.edited`.
 */
test('the chip keeps .own-note and takes a class that is not a status', () => {
  const css = read('app/styles.css');
  assert.match(emp, /className="chip locked own-note"/);
  assert.ok(!/className="cell-sub own-note"/.test(emp), 'the grey text came back');
  assert.match(css, /\.chip\.locked \{ background: var\(--line-softer\); color: var\(--muted-2\); \}/);
  assert.match(css, /\.chip\.st-cancelled \{ background: var\(--line-softer\); color: var\(--muted-2\); \}/);
  assert.ok(!/chip st-cancelled/.test(bare(EMPLOYEE)), 'a status class on a row that is not cancelled');

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
  // The same chip as the row, out of the same two classes — a reader who met it
  // on the row must meet the same thing when they open the row.
  assert.match(foot, /className="chip locked own-note"/);
});

// ── ⚠ คิวคำขอถอน: a grey pair, and a line everybody reads — GONE 2026-09-18 ─
//
// Nine tests stood here against `components/WithdrawalRequests.jsx`, and the
// argument they pinned is worth keeping even though the screen is not:
//
//   A GREY PAIR RATHER THAN NO BUTTONS. Past the cutoff that screen DISABLED
//   อนุมัติให้ถอน and ไม่อนุมัติ instead of withholding them, which is the
//   opposite of what รายการของฉัน does one section up — and deliberately. A
//   disabled control is the shape of a decision that still exists but is not
//   this reader's, and ฝ่ายบุคคล really would still press those. Nobody presses
//   ยกเลิก on an employee's behalf, so there the buttons simply go.
//
//   AND A LINE EVERY READER GETS, not only the ones who are refused: a หัวหน้า
//   who cannot act needs to know why, and HR who can needs to know the period
//   is closed before they do.
//
// The screen went with the ตัดสิน press it existed for — ถอนใบ is one act by
// the owner of the entry now (lib/withdrawal.js). The employee's side of the
// wall, above, is unchanged and is what the two remaining screens are tested on.

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
  for (const f of [FORM, EMPLOYEE]) {
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
