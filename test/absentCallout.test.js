import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * กล่องแจ้งเตือนใน “บันทึกว่าไม่ได้มาทำงาน” — สามบรรทัด และหนึ่งในนั้นเป็นคำสัญญา.
 *
 * The notice is read in a bottom sheet, directly above the one field and the two
 * buttons it exists to explain, so its length comes out of them. It used to be
 * five clauses and a second paragraph; it is now a line that says what the
 * record is and two that say what happens next.
 *
 * WHAT IS PINNED, and why each line is worth a test:
 *
 *   · THE PROMISE. "ยกเลิกการตรวจ … ได้ตลอดเวลา" is the only sentence here that
 *     something else in the system could quietly make FALSE. It holds because
 *     POST /api/birthday/checks carries no period lock and the row it writes has
 *     no period on it — so closing a month cannot take the undo away. Add the
 *     lock to that route one day and this dialog starts lying to ฝ่ายบุคคล about
 *     a decision they are making. This test is what fails first.
 *   · THE SIZE IS OPT-IN. `tight` is for a notice inside a dialog. Make it the
 *     default and every notice in the app quietly shrinks by a step, including
 *     the ones that carry a refusal somebody has to read.
 *   · THE CUT LINES. What was removed is still true and still readable
 *     elsewhere; the test names where, so a later reader can see the facts were
 *     moved rather than dropped.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const actions = read('components/birthdayActions.jsx');
const common = read('components/common.jsx');
const css = read('app/styles.css');
const checksRoute = read('app/api/birthday/checks/route.js');
const model = read('src/models/BirthdayCheck.js');

/** The notes explain what the copy replaced — prose is not copy. */
const code = actions.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

// ── what it says ─────────────────────────────────────────────────────────────

test('one line says what the record is, and two say what happens', () => {
  assert.match(code, /<strong>รายการนี้จะไม่ถูกนับเป็น OT<\/strong>/);
  assert.match(code, /ไม่มีการคำนวณชั่วโมง และไม่มีผลกับเพดานแผนก/);
  assert.match(code, /<li>สถานะจะเปลี่ยนเป็น “ตรวจแล้ว” และย้ายออกจากคิว<\/li>/);
  assert.match(code, /<li>กด “ยกเลิกการตรวจ” เพื่อนำกลับมาแก้ไขได้ตลอดเวลา<\/li>/);
  // Two things that happen, as two items. Run together with a · between them
  // the second was read as part of the first and missed.
  assert.match(code, /<ul className="alert-list">/);
  assert.match(css, /\.alert-list \{ margin: 5px 0 0; padding-left: 17px; list-style: disc; \}/);
});

test('the long version is gone, and every fact it carried is still somewhere', () => {
  for (const cut of [
    'ไม่มีสถานะอนุมัติ',
    'ไม่เข้ารายงานใด ๆ',
    'ระบบเก็บไว้ว่า',
    'เขียนแถวใหม่ทับความหมายเดิม',
  ]) {
    assert.ok(!code.includes(cut), `กล่องแจ้งเตือนยังยาวเท่าเดิม: ${cut}`);
  }
  // ผู้บันทึก and the timestamp are printed in the ตรวจแล้ว table, a moment
  // later, rather than promised in a dialog.
  const queue = read('components/BirthdayQueue.jsx');
  assert.match(queue, /<th>ผู้บันทึก<\/th>/);
  assert.match(queue, /\{r\.checkedByName \|\| '—'\}/);
  // …and how the undo is implemented is written on the button that does it.
  assert.match(queue, /title="เขียนแถวใหม่ทับความหมายเดิม ไม่ลบของเดิม[^"]*"/);
});

// ── the promise ──────────────────────────────────────────────────────────────

test('“ได้ตลอดเวลา” is true — nothing closes the undo at the end of a month', () => {
  // The route that writes both the check and its retraction. If a period lock
  // is ever added here, the dialog above has to stop saying ตลอดเวลา.
  assert.ok(
    !/refusePeriodLock/.test(checksRoute),
    'POST /api/birthday/checks ล็อกงวดแล้ว — กล่องแจ้งเตือนยังสัญญาว่ายกเลิกได้ตลอดเวลา',
  );
  // And the row itself has no period to be locked by. See the model's own note.
  assert.ok(
    !/^\s*period:/m.test(model),
    'BirthdayCheck มีฟิลด์ period แล้ว — งวดที่ปิดจะเริ่มมีความหมายกับแถวนี้',
  );
  // The retraction goes through the same door as the check, so one lock could
  // never take away only half of the pair.
  assert.match(actions, /outcome: OUTCOME\.CANCELLED/);
  assert.match(actions, /api\.post\('\/birthday\/checks'/);
});

// ── the size ─────────────────────────────────────────────────────────────────

/**
 * NO LONGER "ONLY THIS DIALOG" — the birthday form asks for it too, for the
 * same reason and in the same shape: a notice inside a bottom sheet, where
 * every line it takes is a line of the form that has to be scrolled past. What
 * the name was guarding is not the count but the DEFAULT — off unless a call
 * site asks — so the assertions are unchanged and the name says what they check.
 */
test('the smaller notice is opt-in, and the base size is untouched', () => {
  // The signature is read for the DEFAULT, not for its shape: `tight` off unless
  // a call site asks. It grew an `onClose` beside it — opt-in in exactly the
  // same way, for the same reason — and pinning the whole line character for
  // character made adding one a failing test about the wrong thing.
  assert.match(common, /export function Alert\(\{[\s\S]{0,120}?tight = false,/);
  // Matched as a PREFIX: the template grew a third segment (`no-mark`, see
  // `mark` on Alert) and pinning the closing backtick made appending one a
  // failing test about the wrong thing. What this checks is that `tight`
  // still reaches the class list, which is the assertion it was written for.
  assert.match(common, /className=\{`alert \$\{kind\}\$\{tight \? ' tight' : ''\}/);
  assert.match(css, /\.alert\.tight \{ padding: 10px 12px; font-size: 12\.5px; \}/);
  // The base stays a step LOOSER than tight on both axes, which is what this
  // assertion is for: the sheet's notice is smaller than a card's and the two
  // may not drift into each other. It read "12px 14px" until 2026-08-26, when
  // the horizontal went to 16 — an alert's words start 26px in past its mark
  // and their right edge was 14px from the border, so a three-line notice sat
  // visibly off-centre in its own box.
  //
  // AND THE LEADING READ 1.6 UNTIL 2026-09-01, when it went to 1.75 for the
  // blue notice on บันทึกแทน — the longest alert in the app, five lines of Thai
  // in one colour with no inter-word spaces to give the paragraph any texture.
  // It was on `.alert` and not on `.alert.info` on purpose: that screen showed a
  // warn box and an info box one under the other, and two boxes with the same
  // padding, size and face at two different leadings is worse than either.
  //
  // THAT NOTICE WENT BEHIND AN ⓘ LATER THE SAME DAY and the value stays, which
  // is the case for having written the reasoning down rather than the example:
  // 1.75 was never about that paragraph, it was about a solid block of Thai at
  // 13.5px, and the next alert to run five lines gets it without anybody having
  // to rediscover why. The longest one on screen now is the blue สิทธิ์ notice
  // on บันทึก OT ของฉัน.
  assert.match(css, /\.alert \{[\s\S]{0,200}padding: 12px 16px;[\s\S]{0,120}font: 400 13\.5px\/1\.75 var\(--sans\);/);
  // `.box` is the same four palettes and does NOT follow: `.box.total` is the
  // รวม tile at the end of a rate split, in a row of figures whose height it
  // sets. An alert is always a sentence; a box is sometimes a number.
  assert.match(css, /\.box \{[\s\S]{0,160}font: 400 13\.5px\/1\.6 var\(--sans\);/);
  // The error slot in this same dialog stays full size: a refusal from the
  // server is the one thing here somebody has to read.
  assert.match(code, /\{error && <Alert kind="error">\{error\}<\/Alert>\}/);
});
