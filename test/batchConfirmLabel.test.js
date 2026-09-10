import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * “อนุมัติทั้งหมด” ของหนึ่งรายการ — และปุ่มอนุมัติสองปุ่มบนจอเดียวกัน.
 *
 * The confirm dialog opens on one entry far more often than on a batch — a
 * single tick, or the อนุมัติ button on a row, both land there — and it shipped
 * with a green button reading อนุมัติทั้งหมด over a list of one.
 *
 * The second thing pinned here is the one that can actually lose work. While
 * rows are ticked, the batch bar carries an อนุมัติ button AND every row carries
 * its own, a thumb apart on a phone. They are not two ways to do one thing: the
 * row's decides ONE entry and silently drops the other ticks.
 *
 * The third is the verb. `verb` WAS อนุมัติ for a หัวหน้า and ยืนยัน for
 * ฝ่ายบุคคล until 2026-09-11, so a label that read well for one —
 * "ยืนยันการอนุมัติ" — became "ยืนยันการยืนยัน" for the other. That is why the
 * confirm label was a table per role rather than a template string.
 *
 * ONE VERB ON BOTH QUEUES SINCE THEN, and it is อนุมัติ — asked for as *เปลี่ยน
 * wording … ในบริบท อนุมัติ ot ทั้งหมด จากคำว่า "ยืนยัน" เป็น "อนุมัติ"*. The
 * table lost its second row and `pileLabel` lost its `isHr`.
 *
 * WHAT IS STILL PINNED IS THAT IT IS NOT A TEMPLATE. `ยืนยันการ${verb}` is
 * correct today and is one word-change away from doubling a word again, so the
 * label stays written out — and that is the assertion most likely to be undone
 * by somebody tidying it into one line, which is why it is here.
 *
 * Read as source text for the reason test/passwordReveal.test.js is.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');

/** The ConfirmModal body only — RejectModal below it has its own buttons. */
const modal = src.slice(src.indexOf('function ConfirmModal'), src.indexOf('function RejectModal'));
/** The screen itself — everything above the batch modals. */
const screen = src.slice(0, src.indexOf('// ── batch modals'));

/**
 * The same, with block comments taken out.
 *
 * The notes here QUOTE the labels they replaced, which is the point of them —
 * and a test scanning for those labels as defects found the sentences
 * explaining why they are gone. Prose is not what ships to the screen.
 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const code = strip(modal);
const bar = strip(screen);

const has = (src_, text, why) => assert.ok(src_.includes(text), why || `หาไม่เจอ: ${text}`);

// ── the bar at the foot of the queue ────────────────────────────────────────

test('the batch bar counts what is ticked, on both of its buttons', () => {
  has(bar, '${verb}ทั้งหมดที่เลือก (${picked.length} รายการ)');
  has(bar, '`${verb} 1 รายการ`');
  // One counting and one not, side by side, reads as the uncounted one doing
  // something else.
  has(bar, 'ไม่อนุมัติทั้งหมดที่เลือก (${picked.length} รายการ)');
  has(bar, "'ไม่อนุมัติ 1 รายการ'");
});

test('the bar and the rows read one flag, so they cannot disagree', () => {
  has(bar, 'const many = picked.length > 1;');
});

// ── a ticked row ────────────────────────────────────────────────────────────

/**
 * The failure this prevents is not cosmetic. With five rows ticked, pressing a
 * ROW's อนุมัติ signs one of them and leaves four looking untouched — and on a
 * phone that button sits a thumb from the bar's.
 */
test('a ticked row offers no decision of its own', () => {
  has(bar, "selected.has(e._id) ? (");
  // Replaced, not merely hidden: a card that loses its buttons has to say why.
  // The wording itself is pinned in test/batchBarSticky.test.js, which is where
  // the bar it used to point at is tested.
  has(bar, 'picked-note');
});

/**
 * IT WAS "รายละเอียด IS OUTSIDE THE CONDITIONAL" UNTIL 2026-09-09.
 *
 * The button was placed after the ticked/unticked branch closed, so a ticked row
 * kept it while losing its two decisions — checking a row before confirming the
 * pile is the whole reason somebody would look at it now. The button is gone
 * from every row; the ROW opens the pop-up instead, ticked or not, and a
 * conditional cannot take that away because it is not in the cell at all.
 *
 * So the claim is asserted where it now lives — on the <tr> — and the old shape
 * is asserted absent, because a รายละเอียด button reappearing inside the ticked
 * branch is exactly the regression this test was written for.
 */
test('reading a row is still allowed while it is ticked', () => {
  const cell = bar.slice(bar.indexOf("selected.has(e._id) ? ("));
  assert.ok(!cell.includes('รายละเอียด'), 'ปุ่มรายละเอียดกลับมาอยู่ในเซลล์ปุ่มอีกแล้ว');
  // The row's handler is above the branch and outside every cell.
  const row = bar.slice(bar.indexOf('{shown.map(('), bar.indexOf("selected.has(e._id) ? ("));
  assert.ok(row.includes('setDetail(e);'), 'แถวไม่ได้เปิดรายละเอียดแล้ว — ติ๊กแล้วอ่านใบไม่ได้เลย');
});

// ── the confirm dialog ──────────────────────────────────────────────────────

test('the dialog says ทั้งหมด only when there is more than one', () => {
  // The words moved into `pileLabel`, shared with the bar that opens this
  // dialog — a button whose label changes on the way to the dialog repeating it
  // is a second thing to read.
  has(code, 'const confirmLabel = pileLabel(entries.length);');
  has(strip(src), 'ยืนยันอนุมัติทั้งหมด (${count} รายการ)');
  has(strip(src), "'ยืนยันการอนุมัติ'");
});

test('the title matches RejectModal — count when many, รายการนี้ when one', () => {
  has(code, 'title={many ? `${verb} ${entries.length} รายการ` : `${verb}รายการนี้`}');
  const reject = src.slice(src.indexOf('function RejectModal'));
  assert.ok(reject.includes("'ไม่อนุมัติรายการนี้'"), 'RejectModal เปลี่ยนรูปแบบไปแล้ว');
});

/**
 * ⚠ IT READ "the confirm label is per role" UNTIL 2026-09-11, and asserted the
 * `if (isHr)` line that made it one. ฝ่ายบุคคล saw ยืนยัน where a หัวหน้า saw
 * อนุมัติ, so any label of the form "ยืนยันการ${verb}" read as ยืนยันการยืนยัน
 * for half the people who use this screen.
 *
 * BOTH QUEUES SAY อนุมัติ NOW, so there is one label and no role to pick it by
 * — and `pileLabel` takes only a count. THE BAN IS WHAT MATTERS AND IT STAYS:
 * the moment somebody rebuilds this out of `verb`, the next verb change brings
 * the doubled word back, and the sentence explaining why would be the only
 * thing standing in the way.
 */
test('the confirm label is written out, not built from the verb', () => {
  const helper = strip(src.slice(src.indexOf('function pileLabel')));
  // One answer, and the role is gone from the signature with the second one.
  has(helper, 'function pileLabel(count) {');
  assert.ok(!helper.slice(0, helper.indexOf('}')).includes('isHr'),
    'ป้ายปุ่มกลับไปแยกตามบทบาทอีกแล้ว ทั้งที่ทั้งสองคิวใช้คำว่า อนุมัติ เหมือนกัน');
  const code_ = helper.slice(0, helper.indexOf('}'));
  assert.ok(!code_.includes('ยืนยันการ${verb}'), 'ป้ายปุ่มพังเมื่อ verb เป็น “ยืนยัน”');
  assert.ok(!code_.includes('ยืนยันยืนยัน'), 'ป้ายปุ่มของฝ่ายบุคคลพูดคำเดิมสองครั้ง');
  assert.ok(!code.includes('ยืนยันการ${verb}'), 'ป้ายปุ่มพังเมื่อ verb เป็น “ยืนยัน”');
  assert.ok(!code.includes('ยืนยันยืนยัน'), 'ป้ายปุ่มของฝ่ายบุคคลพูดคำเดิมสองครั้ง');
  // The form it replaced: `${verb}ทั้งหมด …`, which is the one that breaks. The
  // literal "ยืนยันอนุมัติทั้งหมด" on the isHr === false branch is the fix, not
  // the defect, so the pattern has to name the interpolation and not the words.
  assert.ok(!code.includes('${verb}ทั้งหมด'), 'ยังมีปุ่มที่ประกอบ “ทั้งหมด” จาก verb ตรง ๆ');
});

test('every label the หัวหน้า path builds still comes from the verb', () => {
  // The row's own button and the bar's are built from `verb`; only the confirm
  // dialog spells อนุมัติ out, and only on the branch that knows isHr is false.
  assert.ok(!/>\s*อนุมัติ\s*</.test(bar), 'มีป้ายที่เขียนคำว่า อนุมัติ ตรง ๆ ในแถวหรือแถบ');
});
