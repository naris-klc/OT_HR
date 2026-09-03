import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * THE WAYS OUT OF A DIALOG, AND THE THREE THINGS THAT TOOK THEM.
 *
 * "ปุ่มกากบาทไม่ทำงาน" was reported three times over 2026-08-20 and it was never
 * the handler: `requestClose` has always been wired to ✕, Escape, the backdrop
 * and the swipe. Three separate things were eating the press, each of them
 * intermittent, which is why it read as one flaky button.
 *
 *   1 · THE GESTURE TOOK IT. Below 860px a `Modal` is a sheet dragged by its
 *       header, and ✕ sits in that header. A thumb that travelled more than
 *       five pixels while tapping handed the pointer sequence to the header via
 *       `setPointerCapture`, so the tap never reached the button — and the drag
 *       measured six pixels, which dismisses nothing. Both readings discarded.
 *       Fixed by asking what the finger came down ON, not how far it moved.
 *
 *   2 · THE TOAST TOOK IT. `.toast-host` outranked the backdrop and its box is
 *       `pointer-events: auto`, so for the seconds a toast was up it took the
 *       presses aimed at whatever lay under it — the sheet's header on a phone,
 *       the foot's buttons on a desktop. Fixed by letting the dialog outrank
 *       every other layer.
 *
 *   3 · NOTHING TOOK IT, AND IT STILL DID NOTHING. With the unsaved-typing
 *       question already up, ✕ set `closeAsked` to true a second time. React
 *       re-rendered nothing. Fixed by making that press back out of the
 *       question, which is what ✕ means.
 *
 * The two answers in the band — กลับไปแก้ต่อ and ปิดโดยไม่บันทึก — were correct
 * throughout and are pinned here anyway, because they are what somebody reaches
 * for first when told the dialog will not close.
 *
 * The gesture ITSELF — how far the sheet may travel, which way, and what is
 * painted under it — is test/modalSheetDrag.test.js. This file is only about
 * the presses that must reach the thing they were aimed at.
 *
 * Read as source text, like the other UI tests here: there is no DOM in this
 * suite.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');

/**
 * THE ASSERTIONS RUN AGAINST CODE, NOT AGAINST THE NOTES.
 *
 * Every line below is quoted in a comment somewhere in that file — the whole
 * defect is written out over `dragStart` — so a test matching the raw file
 * would pass on the prose alone and go on passing after somebody deleted the
 * line the prose describes.
 */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the stripper actually strips — the tests below prove nothing otherwise', () => {
  const quoted = 'A PRESS THAT LANDS ON A CONTROL IS NOT A DRAG';
  assert.ok(src.includes(quoted), 'คอมเมนต์ที่อธิบายบั๊กหายไป');
  assert.ok(!code.includes(quoted), 'ตัวตัดคอมเมนต์ไม่ทำงาน');
});

// ── the gesture lets go of the button ────────────────────────────────────────

test('a press that lands on a control never arms the drag', () => {
  const start = code.indexOf('function dragStart(');
  assert.ok(start > 0, 'dragStart ถูกเปลี่ยนชื่อ');
  const fn = code.slice(start, code.indexOf('\n  }', start));

  assert.match(fn, /if \(e\.target\?\.closest\?\.\(CONTROLS\)\) return;/);

  // BEFORE the drag is armed. After it the press is already a gesture, and the
  // capture in dragMove is one thumb-twitch away.
  assert.ok(
    fn.indexOf('CONTROLS') < fn.indexOf('dragRef.current ='),
    'ยามด่านนี้ต้องอยู่ก่อนบรรทัดที่ติดอาวุธให้การลาก',
  );

  // And sheet-or-not is still asked of the stylesheet rather than of a second
  // copy of the breakpoint kept in here.
  assert.match(fn, /grabRef\.current\?\.offsetParent/);
});

test('and ✕ is one of the things that list covers', () => {
  const list = code.match(/const CONTROLS = '([^']+)';/);
  assert.ok(list, 'CONTROLS หายไปหรือย้ายที่');
  const parts = list[1].split(',').map((s) => s.trim());
  for (const tag of ['button', 'a', 'input', 'select', 'textarea']) {
    assert.ok(parts.includes(tag), `CONTROLS ไม่ครอบคลุม <${tag}> — การกดบนนั้นจะกลายเป็นการลากแผ่น`);
  }

  // Not FOCUSABLE: that list answers "where can the keyboard go", so it drops
  // disabled controls — and a disabled button is still something somebody aimed
  // at rather than somewhere to grab the sheet by.
  assert.ok(!/const CONTROLS = FOCUSABLE/.test(code));
});

test('✕ really does sit inside the surface that carries the drag', () => {
  // If it ever moves out of the header, this is the thing that should notice:
  // the guard above would then be protecting nothing.
  const head = code.slice(
    code.indexOf('className={scrolled ?'),
    code.indexOf('className="modal-body"'),
  );
  assert.match(head, /onPointerDown=\{dragStart\}/);
  assert.match(head, /className="modal-x" onClick=\{requestClose\}/);
});

// ── nothing on screen and enabled may do nothing ─────────────────────────────

/**
 * Every way out of a dialog arrives at `requestClose`, so it is one slice —
 * read inside each test rather than at load, so a change to it fails the tests
 * that are about it instead of taking the whole file down with an import error.
 */
function closeFn() {
  const start = code.indexOf('const requestClose = React.useCallback');
  const end = code.indexOf('}, [closeAsked, dirty, dirtyBlocksClose, onClose]);', start);
  assert.ok(start > 0 && end > start, 'requestClose หายไป หรือรายการ dependency เปลี่ยน');
  return code.slice(start, end);
}

/**
 * ONE ACTION, WHICHEVER WAY OUT IT WAS. The third shape this took in a day: a
 * question in front of every exit, then ✕ alone let through, then this — asked
 * for as "ดึงลงปิดไม่ได้เหรอ กดข้างนอกก็ปิดไม่ได้", which is the right question
 * to ask of a dialog whose four exits behaved three different ways.
 */
test('every way out closes in one action', () => {
  const close = closeFn();
  // FIRST LINE, and it has to be first: everything below it is the one dialog
  // that opts back in. A branch above it is the guard coming back for all.
  const first = close.slice(0, close.indexOf('if (closeAsked)'));
  assert.match(first, /if \(!dirtyBlocksClose\) \{ setCloseAsked\(false\); onClose\?\.\(\); return; \}/);
  assert.ok(!/if \(dirty\)/.test(first), 'มีเงื่อนไข dirty มาก่อน — จะกลับไปถามก่อนปิดอีก');
});

test('and there is one door, so all four reach the same answer', () => {
  // ✕, Escape, the backdrop and the swipe. A second callback beside this one is
  // how the exits drifted apart the last two times.
  assert.match(code, /className="modal-x" onClick=\{requestClose\}/);
  assert.match(code, /e\.key === 'Escape' && !e\.defaultPrevented\) requestClose\(\);/);
  assert.match(code, /className="modal-backdrop" onClick=\{requestClose\}/);
  assert.match(code, /offsetHeight \* 0\.25\)\) requestClose\(\);/);
  assert.ok(!/confirmClose/.test(code), 'มีประตูที่สองกลับมาแล้ว — ทางออกจะทำงานไม่เหมือนกันอีก');
});

/**
 * AND NOW NOTHING OPTS BACK IN.
 *
 * ตั้งรหัสผ่านใหม่ used to, and was the only one: it borrowed `dirty` to mean
 * "you have not written this password down", because the value was random and
 * stored only as a hash, so one reflexive ✕ lost it for good and the repair was
 * another reset. It read `dirty={!written}` with `dirtyBlocksClose` beside it,
 * and this test asserted exactly one caller in the app.
 *
 * On 2026-09-02 the first password became the employee's own รหัสพนักงาน
 * (lib/employees.js), and with it the thing being guarded stopped being
 * unrecoverable — closing that dialog early now costs a glance at the roster.
 * The guard came off, and what this test pins is that it stays off: every way
 * out of every dialog in this app is one action.
 *
 * The prop still exists on Modal and is still honoured. Keeping it is what
 * makes the next genuinely unrecoverable dialog a one-line opt-in rather than a
 * re-derivation — and this test is what makes adding one a deliberate act.
 */
test('nothing in the app holds a dialog shut any more', () => {
  // components/birthdayActions.jsx was on this list and was deleted on
  // 2026-09-03 with ฝ่ายบุคคล's birthday work.
  const screens = ['components/AdminView.jsx', 'components/OtForm.jsx',
    'components/ApprovalQueue.jsx',
    'components/EmployeeView.jsx', 'components/Delegation.jsx'];
  for (const file of screens) {
    // Comments stripped: the note in AdminView explains why the guard came off
    // and names the prop doing it, and prose is not a caller.
    const src = readFileSync(join(ROOT, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!src.includes('dirtyBlocksClose'),
      `${file} เปิดยามกลับมาแล้ว — ทางออกจะกลายเป็นสองจังหวะอีก`);
  }

  // And the reset dialog specifically: no tick, nothing gating เสร็จสิ้น.
  const admin = readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const start = admin.indexOf('function ResetPassword(');
  const dialog = admin.slice(start, admin.indexOf('function Holidays(', start));
  assert.ok(!/written/.test(dialog), 'จดรหัสผ่านไว้แล้ว กลับมาแล้ว — ปุ่มปิดจะถูกล็อกอีก');
});

test('“ปิดโดยไม่บันทึก” takes the dialog down, with nothing standing in its way', () => {
  const start = code.indexOf('className="modal-foot asking"');
  const band = code.slice(start, code.indexOf(') : footer &&', start));

  // Puts the question away AND closes, in that order and unconditionally.
  assert.match(band, /onClick=\{\(\) => \{ setCloseAsked\(false\); onClose\?\.\(\); \}\}/);
  // The other answer only puts the question away.
  assert.match(band, /onClick=\{\(\) => setCloseAsked\(false\)\}/);

  // Neither is a submit button in disguise, and neither swallows its own event
  // on the way out. This band is a SIBLING of the <form> in the body, and on a
  // birthday filing that form is submitted from the foot by id — so a button
  // here without a type would submit it rather than answer the question.
  assert.ok(!/preventDefault/.test(band), 'มี preventDefault ขวางอยู่ในแถบยืนยัน');
  assert.equal((band.match(/type="button"/g) || []).length, 2);
});

/**
 * AND NEITHER OF THEM CAN EVER SUBMIT THE FORM, for two independent reasons.
 *
 * It is worth pinning both, because on this dialog the save button DOES reach a
 * form it is not inside — `form={formId}` in OtForm's foot, which is the whole
 * trick that lets a pinned foot submit a scrolling body. Somebody tidying that
 * pattern could reasonably think the band wants the same treatment. It does not:
 * the band's two buttons answer a question about the dialog, not about the OT.
 */
test('the band is outside the <form>, and is not a submit in disguise', () => {
  // 1 · Modal renders no <form> of its own, so nothing inside it — band
  //     included — can be a descendant of one by construction. The form on a
  //     birthday filing arrives as `children`, which land in `.modal-body`, and
  //     the band is a SIBLING of that body (test/modalScrollFrame.test.js pins
  //     the ordering).
  const modal = code.slice(code.indexOf('export function Modal({'), code.indexOf('export function Section('));
  assert.ok(!/<form/.test(modal), 'Modal มี <form> ของตัวเองแล้ว — แถบยืนยันอาจกลายเป็นลูกของฟอร์ม');
  assert.ok(modal.indexOf('className="modal-body"') < modal.indexOf('className="modal-foot asking"'));

  // 2 · and the buttons say so themselves. `type="button"` is checked above;
  //     what is checked here is that neither carries the escape hatch the save
  //     button uses to reach a form it is not inside.
  const band = code.slice(
    code.indexOf('className="modal-foot asking"'),
    code.indexOf(') : footer &&', code.indexOf('className="modal-foot asking"')),
  );
  assert.ok(!/\bform=/.test(band), 'ปุ่มในแถบยืนยันถูกผูกเข้ากับฟอร์มด้วย form={…}');

  // The save button really does use it, so the assertion above is about a live
  // pattern in this codebase rather than a hypothetical one.
  const otForm = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');
  assert.match(otForm, /form=\{formId\}/);
});

// ── and nothing is allowed to lie on top of it ───────────────────────────────

/**
 * A dialog whose buttons are covered is a dialog whose buttons do not work, and
 * the layer that covered them was the toast: `pointer-events: auto` on its own
 * box, at a z-index above the backdrop's. On a phone it sits at the top, across
 * the sheet's header, which is where ✕ is; on a desktop it is bottom-right,
 * which is where the foot puts ยกเลิก and กลับไปแก้ต่อ. Neither was a number
 * somebody got wrong — they are two things that were never meant to share a
 * screen, and the dialog is the one being used.
 */
test('the dialog outranks every other layer, the toast included', () => {
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  const rule = (sel) => {
    const at = css.indexOf(`${sel} {`);
    assert.ok(at > 0, `${sel} ถูกเปลี่ยนชื่อ`);
    return css.slice(at, css.indexOf('}', at));
  };
  const layerOf = (sel) => Number(rule(sel).match(/z-index: (\d+)/)[1]);

  const backdrop = layerOf('.modal-backdrop');
  assert.ok(backdrop > layerOf('.toast-host'),
    'toast ยังอยู่เหนือกล่องโต้ตอบ — มันกินการกดที่เล็งไปที่ปุ่มข้างล่าง');

  /**
   * Nothing at all above it — WITH ONE EXCEPTION, AND THE EXCEPTION CAME HERE
   * AND DECIDED, which is what the sentence that stood here asked the next
   * person to do.
   *
   * `.pop` is the panel all three of the app's own pickers open — the
   * calendar, the month grid and the two time columns — and `.pop-scrim` is the
   * dark ground under it on a phone. Six of those boxes are INSIDE a dialog — วันเกิด
   * on ตั้งค่าระบบ › พนักงาน, the two on ผู้รับช่วง, วันที่เริ่ม on บันทึก OT —
   * and the panel is rendered into `document.body` to escape `.modal`'s
   * `overflow: hidden`. Out there it is a sibling of the backdrop, so at any
   * number below this one it is behind the dialog it belongs to and cannot be
   * seen at all. There is no arrangement of these two that works with the
   * calendar underneath.
   *
   * WHY IT IS NOT THE DEFECT THIS TEST WAS WRITTEN FOR. The toast was a layer
   * that is THERE ANYWAY, arriving over a dialog somebody was already using and
   * eating presses aimed at buttons underneath it. This one exists only while
   * it is open, is the thing being used while it is, and closes on Escape, on a
   * press outside it and on any scroll. A press it takes is a press meant for
   * it.
   *
   * The pair is named rather than a ceiling being raised: a THIRD layer over a
   * dialog still has to come here and make this argument.
   */
  const ABOVE_THE_DIALOG = ['.pop', '.pop-scrim'];
  for (const sel of ABOVE_THE_DIALOG) {
    assert.ok(layerOf(sel) > backdrop, `${sel} อยู่ใต้กล่องโต้ตอบ — จะเปิดในกล่องแล้วมองไม่เห็น`);
  }
  const excused = new Set(ABOVE_THE_DIALOG.map((sel) => layerOf(sel)));
  const every = [...css.matchAll(/z-index: (\d+)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => !excused.has(n));
  assert.equal(Math.max(...every), backdrop, 'มีชั้นที่อยู่สูงกว่ากล่องโต้ตอบ — ปุ่มจะถูกทับ');
  // The scrim is UNDER the panel it darkens for, or the sheet is behind its own
  // background.
  assert.ok(layerOf('.pop') > layerOf('.pop-scrim'), 'ฉากหลังของชีตทับตัวชีตเอง');

  // The host itself never takes a press; only a toast that is really there.
  assert.match(rule('.toast-host'), /pointer-events: none;/);
});
