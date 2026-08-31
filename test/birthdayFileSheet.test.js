import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * บันทึก OT ให้ — the second answer to a birthday row, and now the same KIND of
 * thing as the first.
 *
 * A row of วันเกิดรอตรวจ asks one question and offers two buttons. ไม่ได้มาทำงาน
 * has always come up as a pop-up — a centred dialog on a desktop, a sheet from
 * the bottom edge on a phone — with the name and the date pinned in a header
 * that cannot scroll and its two buttons pinned at the foot. บันทึก OT ให้ took
 * the other shape entirely: it REPLACED the queue with a full-screen form, so
 * the row being answered vanished, the facts it was about survived only as a
 * box the form drew for itself and then scrolled away, and the save button sat
 * at the end of a long form a phone-screen or two below the times just typed.
 *
 * Two answers to one question arriving as two different sorts of object is the
 * screen telling somebody they are doing two different sorts of act. They are
 * not. So they are one component now — `Modal` in components/common.jsx, which
 * brings the scrim, Escape, the backdrop tap, the swipe-down, the focus trap
 * and the question in front of throwing away half-typed times.
 *
 * WHAT IS EASY TO UNDO BY TIDYING, and is therefore pinned here:
 *
 *   · the form is still a CARD everywhere else. The employee's own filing, a
 *     หัวหน้า's proxy batch and ฝ่ายบุคคล's correction are not dialogs, and the
 *     two shapes share every field between them.
 *   · the save button lives in the dialog's foot, which is OUTSIDE the <form>
 *     element in the body — `form={formId}` is the only thing joining them, and
 *     without it the button submits nothing at all.
 *   · neither list replaces itself with the form any more.
 *
 * Read as source text, like the other UI tests here: there is no DOM in this
 * suite, and the shape of a screen is still worth holding still.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const form = read('components/OtForm.jsx');
const queue = read('components/BirthdayQueue.jsx');
const hrView = read('components/HrView.jsx');
const actions = read('components/birthdayActions.jsx');
const css = read('app/styles.css');

/** The notes quote the shapes they replaced — prose is not code. */
const code = form.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── the pop-up ───────────────────────────────────────────────────────────────

test('a birthday filing comes up in the same Modal ไม่ได้มาทำงาน uses', () => {
  // `Modal`, out of the shared file, in whatever company it keeps — the list
  // was pinned verbatim until 2026-08-31 and `StatusChip` joining it (the
  // เวลาทับซ้อน rows) failed this for naming a component this test is not
  // about. What is worth holding still is WHICH Modal, not how many names sit
  // beside it on one line.
  assert.match(form, /import \{[^}]*\bModal\b[^}]*\} from '\.\/common\.jsx';/);
  // The SAME component, named the same way, in both answers to the row — a
  // second dialog of its own would drift from this one on the first restyle.
  assert.match(actions, /import \{ Alert, Modal \} from '\.\/common\.jsx';/);
  assert.match(code, /if \(fromBirthday\) \{\s*return \(\s*<Modal/);
});

test('the header carries who and when, and the body no longer repeats them', () => {
  // The same three facts, in the same order and separators, as AbsentModal's —
  // two dialogs about one row must not label it two ways.
  assert.match(
    code,
    /subtitle=\{`\$\{birthday\?\.name\} · \$\{birthday\?\.code\} · \$\{thaiDate\(birthday\?\.date\)\} \(วัน\$\{dayName\(birthday\?\.date\)\}\)`\}/,
  );
  assert.match(
    actions,
    /subtitle=\{`\$\{row\.name\} · \$\{row\.code\} · \$\{thaiDate\(row\.date\)\} \(วัน\$\{dayName\(row\.date\)\}\)`\}/,
  );
  // …and the `.box` that used to print the pair inside the scrolling body is
  // gone. A header that cannot scroll says it better, and twice is worse than
  // once: the copy in the body is the one that leaves the screen.
  assert.ok(
    !/สวัสดิการวันเกิด · \{thaiDate\(birthday\?\.date\)\}/.test(code),
    'the body prints the date the header already carries',
  );
  // What is left there is the instruction, which no header can say.
  assert.match(code, /กรอกเฉพาะเวลาเข้า-ออกที่อ่านจากบันทึกสแกนนิ้ว/);
});

test('closing asks about half-typed times, and ยกเลิก goes out the same door', () => {
  // "Not blank" would be wrong on this form: the two times start EMPTY and
  // รายละเอียด starts filled in. It is measured against what the form opened
  // with instead.
  assert.match(code, /const openedWith = useRef\(form\);/);
  assert.match(code, /const dirty = Object\.keys\(form\)\.some\(\(k\) => form\[k\] !== openedWith\.current\[k\]\);/);
  assert.match(code, /dirty=\{dirty\}/);
  // `Modal` hands a function footer its own `requestClose`, so ยกเลิก asks the
  // same question ✕, Escape, the backdrop and a swipe down ask.
  assert.match(code, /footer=\{actions\}/);
  assert.match(code, /const actions = \(cancel\) => \(/);
  assert.match(code, /onClick=\{cancel\}>ยกเลิก<\/button>/);
});

// ── the button in the foot, and the form in the body ─────────────────────────

test('the save button is joined to the form it is not inside', () => {
  // The dialog's foot is a SIBLING of its body — see `.modal-foot` in
  // app/styles.css, which is what pins it. Without `form={formId}` the button
  // belongs to no form and pressing it does nothing at all.
  assert.match(code, /const formId = React\.useId\(\);/);
  assert.match(code, /<form id=\{formId\} className="modal-form" onSubmit=\{submit\}>/);
  assert.match(code, /<button\s+className="btn"\s+form=\{formId\}/);
  // And it still says which of the two things this press does — filed and
  // signed in one act, or filed into the ordinary queue. The server answers
  // that (`birthdayRouting`), never this file.
  assert.match(code, /birthdayRouting\?\.direct \? 'บันทึกและอนุมัติ' : 'บันทึกและส่งเข้าคิว'/);
});

test('every other filing is still a card, and both shapes share one set of fields', () => {
  assert.match(code, /<form id=\{formId\} className="card" onSubmit=\{submit\}>/);
  assert.match(code, /<h2>\{heading\}<\/h2>/);
  // One list of fields and one pair of buttons, hung two ways. Two copies would
  // be two forms to keep in step with the engine.
  assert.equal((code.match(/\{fields\}/g) || []).length, 2);
  assert.match(code, /\{actions\(onCancel\)\}/);
  // The title is written once for the <h2> and the dialog header alike.
  assert.match(code, /fromBirthday \? 'บันทึก OT ให้ — สวัสดิการวันเกิด'/);
  assert.match(code, /title=\{heading\}/);
});

test('the card’s own spacing is restated for the form that has no card', () => {
  // `.card .hint` is what puts 14px under the line explaining the form. Inside
  // a dialog there is no card, so it is said again — and the form stays a
  // block, because every row in it already carries its own margin.
  assert.match(css, /\.modal-form \{ display: block; \}/);
  assert.match(css, /\.modal-form \.hint \{ margin-bottom: 14px; \}/);
  assert.match(css, /\.card \.hint \{ font: 400 12\.5px\/1\.5 var\(--sans\); color: var\(--muted-2\); margin-bottom: 14px; \}/);
});

// ── the two lists underneath ─────────────────────────────────────────────────

test('neither list replaces itself with the form any more', () => {
  for (const [name, src] of [['BirthdayQueue', queue], ['HrView', hrView]]) {
    assert.ok(
      !/if \(filing\) \{/.test(src),
      `${name} still swaps the list out for the form — the row being answered disappears`,
    );
    // Both answers to the row are rendered the same way, at the foot of the
    // list, and both portal themselves out to <body>.
    assert.match(src, /\{filing && \(\s*<BirthdayFileForm/, `${name} does not render the form as a pop-up`);
    assert.match(src, /\{marking && \(\s*<AbsentModal/, `${name} lost the other answer`);
  }
});

test('and a dialog is not on the back stack — its own ways out ask first', () => {
  // `marking` never registered one, for the reason this one no longer does: a
  // back arrow closes a dialog without the question about unsaved typing that
  // ✕, Escape, the backdrop and a swipe down all go through.
  for (const [name, src] of [['BirthdayQueue', queue], ['HrView', hrView]]) {
    assert.ok(
      !/useBackHandler\(Boolean\(filing\)/.test(src),
      `${name} still puts the filing dialog on the back stack`,
    );
  }
  // The hook itself is untouched — HR's real sub-views still use it.
  assert.match(hrView, /useBackHandler\(Boolean\(printing\), \(\) => setPrinting\(null\)\);/);
});
