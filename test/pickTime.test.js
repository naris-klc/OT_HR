import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* FROM `lib/` AND NOT FROM THE COMPONENT — `npm test` is plain `node --test`
   with no JSX transform, so a `.jsx` import fails at load with
   ERR_UNKNOWN_FILE_EXTENSION and takes the whole file down with it. That is
   also why every UI assertion in this suite reads source as TEXT. The helper
   lives beside `endsNextDayFor`, the other function here that reads an HH:mm
   pair — and both rest on the same fact: these strings are zero-padded and
   24-hour, so they compare as strings and the engine never parses them. */
import { parseTime } from '../lib/entries.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const src = read('components/PickTime.jsx');
const css = read('app/styles.css');

/**
 * เวลาเริ่ม / เวลาสิ้นสุด — `PickTime`.
 *
 * THE THIRD POPUP TAKEN OFF THE BROWSER, and the only one of the three that was
 * not merely a styling complaint. The other two looked wrong; this one READ
 * wrong: an `<input type="time">` renders in the VIEWER's locale, so on an
 * English-locale Windows the stored `17:00` was drawn as `05:00 PM` — in a form
 * about overtime between 17:00 and 20:00 น., on a screen where the queue's rows,
 * the preview under the form and ใบ F-HR-027 all print 24-hour. No attribute on
 * that tag settles it: the format is the browser's business and not the page's,
 * which is the same wall as the popup itself.
 *
 * The panel it opens is the shared one — test/popover.test.js.
 */

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = strip(src);
const components = readdirSync(join(ROOT, 'components'))
  .filter((f) => f.endsWith('.jsx'))
  .map((f) => [f, strip(read(`components/${f}`))]);

test('the stripper actually strips — the bans below prove nothing otherwise', () => {
  assert.ok(src.includes('`<input type="time">`'), 'the paragraph this guards against is gone');
  assert.ok(!code.includes('<input type="time">'), 'the stripper left a comment behind');
  assert.ok(code.includes('export function PickTime('), 'the stripper ate the code as well');
});

test('ไม่มี <input type="time"> เหลืออยู่ในแอปแล้ว', () => {
  const left = components.filter(([, b]) => /type="time"/.test(b)).map(([f]) => f);
  assert.deepEqual(left, [], `ยังมีตัวเลือกเวลาของเบราว์เซอร์เหลืออยู่: ${left.join(', ')}`);
});

test('ทั้งสี่ช่องใช้ PickTime และไม่มีช่องไหนอ่าน e.target', () => {
  // Two on บันทึก OT, two on the queue's quick edit. The count is here so a
  // fifth added with an `<input>` fails rather than becoming the one time box
  // in the app that draws itself in the viewer's locale.
  const uses = components.reduce((n, [, b]) => n + (b.match(/<PickTime\b/g) || []).length, 0);
  assert.equal(uses, 4, `มี ${uses} ช่อง — คาดว่า 4`);
  for (const [f, body] of components) {
    if (f === 'PickTime.jsx') continue;
    for (const [tag] of body.matchAll(/<PickTime\b[^>]*?\/>/g)) {
      assert.ok(!/e\.target|ev\.target/.test(tag), `${f} ยังอ่าน e.target จากตัวเลือกเวลา`);
    }
    if (/<PickTime\b/.test(body)) {
      assert.match(body, /import \{ PickTime \} from '\.\/PickTime\.jsx'/, `${f} ไม่ได้ import PickTime`);
    }
  }
});

// ── the format, which is half of what was asked ─────────────────────────────

test('24 ชั่วโมงเสมอ และไม่ได้ถามเบราว์เซอร์ว่าจะเขียนยังไง', () => {
  /**
   * `value` is already `HH:mm`, so the box hands it straight through — there is
   * nothing to format, which IS the fix. The native box put this same string
   * through the viewer's locale and drew `05:00 PM`.
   */
  assert.match(code, /display=\{value\}/);
  // Nothing anywhere near this control asks a locale a question.
  assert.ok(!/toLocaleTimeString|hour12|Intl\./.test(code), 'มีการจัดรูปแบบเวลาตาม locale');
  // The hours run 00–23, which is the other half of saying 24-hour.
  assert.match(code, /const HOURS = Array\.from\(\{ length: 24 \}, \(_, i\) => i\);/);
  assert.match(code, /const pad = \(n\) => String\(n\)\.padStart\(2, '0'\);/);
  assert.match(code, /set = \(h, m\) => onChange\(`\$\{pad\(h\)\}:\$\{pad\(m\)\}`\)/);
});

test('parseTime รับเฉพาะเวลาที่เป็นเวลาจริง', () => {
  assert.deepEqual(parseTime('17:00'), { h: 17, m: 0 });
  assert.deepEqual(parseTime('00:00'), { h: 0, m: 0 });
  assert.deepEqual(parseTime('23:59'), { h: 23, m: 59 });
  // A single-digit hour is what some records carry; the columns still open on it.
  assert.deepEqual(parseTime('9:05'), { h: 9, m: 5 });
  // And the ones that are not times at all — `endsNextDayFor`'s own note says an
  // empty value sorts before every real time, so guessing at one is the bug.
  for (const bad of ['', null, undefined, '24:00', '17:60', '17', 'abc', '17:0']) {
    assert.equal(parseTime(bad), null, `parseTime(${JSON.stringify(bad)}) ต้องเป็น null`);
  }
});

test('ค่าที่ส่งออกยังเป็น HH:mm — engine เปรียบเทียบสตริงนี้ตรง ๆ', () => {
  // `src/lib/otEngine.js` and `endsNextDayFor` compare these as strings, so anything
  // else would be a change to the engine's input rather than to a control.
  const forms = ['components/OtForm.jsx', 'components/ApprovalQueue.jsx'].map((f) => strip(read(f)));
  for (const body of forms) {
    // `\s` and not a space: บันทึก OT's two boxes went multi-line on 2026-09-01
    // when they gained `minuteStep`, and the queue's are still one line each.
    assert.match(body, /<PickTime\s+label="เวลาเริ่ม"/);
    assert.match(body, /<PickTime\s+label="เวลาสิ้นสุด"/);
  }
});

// ── the columns ─────────────────────────────────────────────────────────────

/**
 * นาทีเดินทีละห้า และแถวที่เป็นของค่าปัจจุบันไม่เคยหาย — 2026-09-01.
 *
 * IT WAS ALL SIXTY UNTIL THEN, and that paragraph was right about one case and
 * made every other case pay for it: วันเกิดที่ยังไม่มีใบ is filled in from the
 * pair of times off the fingerprint scanner — `เวลาเข้า (สแกนนิ้ว)` is what its
 * label says — and a scanner does not round. Sixty rows is also a column
 * somebody scrolls past four screens of to reach 17:30 on the ordinary evening
 * shift, which is what was reported.
 *
 * SO THE CASE KEEPS ITS PRECISION AND NOTHING ELSE PAYS. `minuteStep` is 1 on
 * the birthday form and 5 everywhere else.
 *
 * FIVE AND NOT FIFTEEN, which was the other option offered: fifteen is four
 * rows and would put 17:10 and 17:20 out of reach on the ordinary form. The
 * engine's 30-minute rounding is a different question — it PRICES the session,
 * it does not decide what somebody was recorded as working.
 *
 * AND THE HELD VALUE IS ALWAYS IN THE LIST, which is what makes a step safe
 * rather than lossy. Without it an entry filed at 17:03 opens in a box whose
 * step is 5 with NOTHING selected: no home for the roving tabindex, false on
 * every `aria-selected`, and the first arrow press silently moving the value to
 * a multiple of five.
 */
test('นาทีเดินทีละห้า แต่ค่าที่ไม่ลงตัวไม่เคยหลุดจากคอลัมน์', () => {
  assert.match(code, /function minuteValues\(step, held\) \{/);
  assert.match(code, /for \(let m = 0; m < 60; m \+= step\) out\.push\(m\);/);
  assert.match(code, /if \(!out\.includes\(held\) && held >= 0 && held < 60\) \{/);
  assert.match(code, /minuteStep = 5,/);
  assert.match(code, /values=\{minutes\}/);
  // Rebuilt when the held minute moves, since the odd row it may carry is that
  // value — a memo keyed only on the step would strand it.
  assert.match(code, /React\.useMemo\(\(\) => minuteValues\(minuteStep, held\.m\), \[minuteStep, held\.m\]\)/);

  // The scanner's own form keeps every minute, and it is the ONLY caller that
  // asks for one — a second `minuteStep={1}` somewhere else would mean the
  // reason above had quietly become a default.
  const form = strip(read('components/OtForm.jsx'));
  assert.equal((form.match(/minuteStep=\{fromBirthday \? 1 : 5\}/g) || []).length, 2);
  assert.match(src, /เวลาเข้า \(สแกนนิ้ว\)|fingerprint scanner/);

  // Run the helper as it is written, on the two cases that matter.
  const values = (step, held) => {
    const out = [];
    for (let m = 0; m < 60; m += step) out.push(m);
    if (!out.includes(held) && held >= 0 && held < 60) { out.push(held); out.sort((a, b) => a - b); }
    return out;
  };
  assert.equal(values(5, 0).length, 12, 'คอลัมน์นาทีปกติต้องมี 12 แถว');
  assert.deepEqual(values(5, 30).slice(0, 3), [0, 5, 10]);
  assert.equal(values(1, 3).length, 60, 'ฟอร์มวันเกิดต้องยังมีครบหกสิบ');
  // 17:03 off a scanner, opened in a box whose step is 5.
  assert.ok(values(5, 3).includes(3), 'นาทีที่ไม่ลงตัวหายไปจากคอลัมน์');
  assert.deepEqual(values(5, 3).slice(0, 4), [0, 3, 5, 10], 'แถวที่แทรกเข้ามาไม่ได้อยู่ตำแหน่งของมัน');
  assert.equal(values(5, 3).length, 13, 'แทรกแล้วต้องเพิ่มมาแถวเดียว');
});

test('คอลัมน์เป็น listbox ไม่ใช่ grid — และลูกศรวนรอบ', () => {
  // A month is two-dimensional and a column of hours is not, so ↑/↓ are the
  // only arrows that mean anything here. Sharing the calendar's `Grid` would
  // have meant a one-column grid answering the same question twice.
  assert.match(code, /role="listbox"/);
  assert.match(code, /role="option"/);
  assert.match(code, /aria-selected=\{v === value\}/);
  // WRAPS: 23:00 → ↓ → 00:00 in one press. A session that ends after midnight is
  // ordinary here — `endsNextDayFor` exists for it — and a column stopping at 23
  // would make the commonest late shift the slowest thing to enter.
  assert.match(code, /const n = \(at \+ step \+ values\.length \* 5\) % values\.length;/);
  assert.match(code, /\{ ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 \}/);
});

test('roving tabindex และค่าที่เลือกถูกเลื่อนเข้ามาให้เห็น', () => {
  // Tab leaves the panel rather than walking sixty minutes; the focused option
  // is what the arrows move, and focusing it is also what puts focus INTO the
  // panel when it opens.
  assert.match(code, /tabIndex=\{v === value \? 0 : -1\}/);
  assert.match(code, /el\.focus\(\{ preventScroll: true \}\)/);
  // `nearest`, so a column already showing the value does not jump.
  assert.match(code, /el\.scrollIntoView\(\{ block: 'nearest' \}\)/);
});

test('เคอร์เซอร์เริ่มที่ชั่วโมง และมีคอลัมน์เดียวที่รับโฟกัส', () => {
  /**
   * THE DEFECT THE WALKTHROUGH FOUND. Both columns focused their own selected
   * option on mount, so the one that mounted second won and the panel opened
   * with the cursor on the MINUTES — measured on the built app at 1280px,
   * `document.activeElement` was the minute `00`, and one press of ↓ turned
   * 17:00 into 17:01. The hour is what somebody opens this to change.
   */
  assert.match(code, /const \[col, setCol\] = React\.useState\('h'\);/);
  assert.match(code, /active=\{col === 'h'\}/);
  assert.match(code, /active=\{col === 'm'\}/);
  /**
   * THE GUARD IS ON THE FOCUS AND NOT ON THE EFFECT, since 2026-09-01.
   *
   * It read `if (!active) return` at the top, which also stopped the INACTIVE
   * column scrolling to its own value. Invisible while the only thing that
   * moved a column was a press inside it, and wrong the moment a เวลาด่วน chip
   * started setting both: pressing 22:00 turned the hour wheel and left the
   * minute wheel wherever it had been scrolled, so the panel disagreed with the
   * box above it.
   *
   * Every column scrolls its chosen row into view; only the active one takes
   * the cursor. That is the whole of what `active` decides now.
   */
  assert.match(code, /if \(active\) el\.focus\(\{ preventScroll: true \}\);\s*\n\s*el\.scrollIntoView\(\{ block: 'nearest' \}\);/);
  assert.ok(
    !/React\.useEffect\(\(\) => \{\s*\n\s*if \(!active\) return;/.test(code),
    'คอลัมน์ที่ไม่ได้ active กลับไปไม่เลื่อนตามค่าของตัวเองอีกแล้ว',
  );
  // ← / → move between them, and a press into a column makes it the live one —
  // otherwise the cursor is in one column and the keys are in the other.
  assert.match(code, /if \(e\.key === 'ArrowLeft' \|\| e\.key === 'ArrowRight'\)/);
  assert.match(code, /onFocus=\{onEnter\}/);
});

test('ทุกการกดมีผลทันที และแผงปิดตอนเลือกนาที', () => {
  /**
   * NOTHING IS PENDING. The box behind updates on every press, so what the
   * field says is what will be saved even if the panel is dismissed rather than
   * completed — a picker that holds a draft is one that can be closed in a way
   * that throws the choice away, which is the outcome nobody expects.
   *
   * The minute is the last thing anybody chooses, so closing there is closing
   * when the answer is complete; closing on the hour would shut the panel
   * halfway through.
   */
  assert.match(code, /onPick=\{\(h\) => set\(h, held\.m\)\}/);
  assert.match(code, /onPick=\{\(m\) => \{ set\(held\.h, m\); onDone\(`\$\{pad\(held\.h\)\}:\$\{pad\(m\)\}`\); \}\}/);
});

test('ปุ่มลัดสี่เวลาอยู่ในเท้าแผง และไม่ได้แทนที่คอลัมน์', () => {
  assert.match(code, /\['17:00', '18:00', '20:00', '22:00'\]/);
  assert.match(css, /\.time-chip \{/);
  assert.match(css, /\.time-chip\.on \{ background: var\(--green-bg\); border-color: var\(--ok-line\); color: var\(--green-dark\); \}/);
});

/**
 * ปุ่มเวลาด่วนหมุนลูกล้อ แทนที่จะปิดแผงไปเลย — asked for on 2026-09-01.
 *
 * IT CALLED `onDone`, which applies the value AND closes, so the columns were
 * correct for the one frame nobody saw: press 20:00 and the panel is simply
 * gone. What was asked for is the wheels turning to follow the chip.
 *
 * THE TRADE IS NAMED RATHER THAN HIDDEN. The common case — 17:00 exactly — now
 * costs one more act, a press outside or Escape. What it buys is that a chip is
 * a place to START from: press 17:00, nudge the minute to 30, and the two
 * presses are the whole interaction rather than a chip followed by reopening
 * the panel.
 *
 * NOTHING IS LOST BY LEAVING IT OPEN, and that is this control's own rule
 * rather than a new one: `onChange` has already written the value, so the box
 * behind says 20:00 the moment the chip is pressed and dismissing the panel any
 * way at all keeps it. A picker that held a draft would be one that can be
 * closed in a way that throws the choice away.
 */
test('ปุ่มเวลาด่วนหมุนลูกล้อทั้งสองคอลัมน์ และไม่ปิดแผง', () => {
  assert.match(code, /onClick=\{\(\) => onChange\(t\)\}/);
  assert.ok(!/onClick=\{\(\) => onDone\(t\)\}/.test(code), 'ปุ่มลัดกลับไปปิดแผงทันทีอีกแล้ว');
  // `onDone` still exists and still belongs to the minute — the panel closes
  // when the answer is complete, and a chip is not that moment.
  assert.match(code, /onPick=\{\(m\) => \{ set\(held\.h, m\); onDone\(`\$\{pad\(held\.h\)\}:\$\{pad\(m\)\}`\); \}\}/);
  // The chip that is already the answer says so to a screen reader too.
  assert.match(code, /aria-pressed=\{t === value\}/);
});

/**
 * แถบเลื่อนของคอลัมน์ไม่ถูกวาด — reported 2026-09-01 as a line down the middle
 * of the panel, and that is exactly where it was.
 *
 * The hour column's scrollbar sits at ITS right edge, which in a two-column
 * panel is the gap between ชั่วโมง and นาที. The app's global thumb is a 10px
 * pill on a `--bg` ground, so in a 196px popup it read as a divider rather than
 * as a control — a rule nobody drew, between two columns that are not separated
 * by one.
 *
 * WHAT SAYS THERE IS MORE INSTEAD: the chosen row is a green fill and is
 * scrolled into view whenever the value moves, so a column opens showing where
 * it is rather than at the top; and the rows are cut mid-height by the 208px
 * cap. `.section-tabs` makes the same trade in the phone block.
 */
test('คอลัมน์เวลาไม่วาดแถบเลื่อน — เส้นกลางแผงหายไป', () => {
  assert.match(css, /\.time-list \{ scrollbar-width: none; \}/);
  assert.match(css, /\.time-list::-webkit-scrollbar \{ display: none; \}/);
  // Both properties: Firefox draws none of the `::-webkit-` rules and would
  // otherwise keep its own bar.
  // The list still scrolls — hiding the bar may not turn into clipping.
  assert.match(css, /\.time-list \{\s*\n\s*max-height: 208px; overflow-y: auto; overscroll-behavior: contain;/);
  // And the cue that replaces it is the one already in the component.
  assert.match(code, /el\.scrollIntoView\(\{ block: 'nearest' \}\);/);
  assert.match(css, /\.time-opt\.on \{ background: var\(--green\)/);
  // Both selectors name `.time-list`: a bare `::-webkit-scrollbar { display:
  // none }` would take the bar off every scrolling box in the app.
  for (const m of css.matchAll(/^([^\n{}]*::-webkit-scrollbar[^\n{}]*)\{/gm)) {
    const sel = m[1].trim();
    assert.ok(
      sel.startsWith('::-webkit-scrollbar') || sel.includes('.time-list') || sel.includes('.pick-list')
        || sel.includes('.section-tabs'),
      `กฎ ${sel} เอื้อมไปไกลกว่ากล่องของตัวเอง`,
    );
  }
});

// ── the theme, which is the other half of what was asked ────────────────────

test('รายการที่เลือกเป็นสีเขียวของธีม ไม่ใช่แถบน้ำเงินของระบบ', () => {
  // The declaration the request was about: what stands where the OS put its
  // blue bar. `--on-fill` is the token for text on a saturated fill and is the
  // same in both themes, so it reads on ธีมมืด without a second rule.
  assert.match(css, /\.time-opt\.on \{ background: var\(--green\); color: var\(--on-fill\); font-weight: 600; \}/);
  assert.match(css, /\.time-opt:hover \{ background: var\(--neutral-wash\); \}/);
  // The panel's own dark ground is `.pop`'s — see test/popover.test.js.
  assert.match(css, /\.pop \{[\s\S]*?background: var\(--card-lift\);/);
});

test('ตัวเลขเป็น mono และ tabular — คอลัมน์ที่อ่านลงมาต้องตรงกัน', () => {
  // Unlike the calendar's cells, which are Thai month names. Two-digit figures
  // read down a column and compared is the case this stylesheet reserves mono
  // for, and nothing in these columns is Thai.
  assert.match(css, /\.time-opt \{[\s\S]*?font: 400 14px\/1\.3 var\(--mono\); font-variant-numeric: tabular-nums;/);
});

test('วงแหวน focus ไม่ประกาศสีซ้ำกับกฎพื้นฐาน', () => {
  // `test/pressChrome.test.js` refuses a copy of the base ring's colour, and it
  // caught the calendar's cells doing exactly this a round earlier.
  assert.match(css, /\.time-opt:focus-visible \{ outline-offset: -2px; \}/);
  assert.ok(!/\.time-opt:focus-visible \{[^}]*outline: 2px solid/.test(css));
});

test('บนมือถือแถวสูง 44px และลิสต์ไม่กินทั้งจอ', () => {
  const phone = css.slice(css.indexOf('@media (max-width: 860px)'));
  assert.match(phone, /\.pop\.sheet \.time-opt \{ min-height: 44px; font-size: 16px; \}/);
  assert.match(phone, /\.pop\.sheet \.time-list \{ max-height: min\(46vh, 300px\); \}/);
});

test('ลิสต์หกสิบแถวเลื่อนในตัวเอง และไม่ลากหน้าที่อยู่ข้างหลังไปด้วย', () => {
  // The same containment `.pick-menu` and `.modal-body` both keep: a flick that
  // reaches 59 must not carry on into the form behind.
  assert.match(css, /\.time-list \{\s*\n\s*max-height: 208px; overflow-y: auto; overscroll-behavior: contain;/);
});
