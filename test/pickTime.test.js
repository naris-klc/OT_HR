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
 * IT WAS TWO SCROLLING COLUMNS FOR THREE ROUNDS AND IS TWO GRIDS SINCE
 * 2026-09-01. The wheel was reported as laying out wrong and being hard to use,
 * and the shape was what was wrong with it: a 208px column shows six of its
 * rows, so the number somebody wants is usually off screen when the panel
 * opens. The cases below that used to pin a column now pin a grid, and the ones
 * that pinned "every press applies immediately" pin the opposite — the panel
 * holds a draft and ตกลง is what writes it.
 *
 * The panel it opens is the shared one — test/popover.test.js.
 */

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = strip(src);
/* The stylesheet's own comments name the rules that were REMOVED — that is what
   §"A commit that changes behaviour" asks a document to do — so the bans below
   have to read declarations rather than text. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
const components = readdirSync(join(ROOT, 'components'))
  .filter((f) => f.endsWith('.jsx'))
  .map((f) => [f, strip(read(`components/${f}`))]);

test('the stripper actually strips — the bans below prove nothing otherwise', () => {
  assert.ok(src.includes('`<input type="time">`'), 'the paragraph this guards against is gone');
  assert.ok(!code.includes('<input type="time">'), 'the stripper left a comment behind');
  assert.ok(code.includes('export function PickTime('), 'the stripper ate the code as well');
  // The same for the stylesheet's: `.time-opt` is named in the note about what
  // came out, and a ban that could not tell that from a rule would pass forever.
  assert.ok(css.includes('`.time-opt`'), 'the paragraph naming what was removed is gone');
  assert.ok(!rules.includes('.time-opt'), 'the CSS stripper left a comment behind');
  assert.ok(rules.includes('.time-cell'), 'the CSS stripper ate the rules as well');
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
  // The hours run 00–23, which is the other half of saying 24-hour — and since
  // 2026-09-01 all twenty-four are ON THE SCREEN AT ONCE rather than in a
  // column that scrolls. Six popular ones was the other option offered and it
  // was refused for a reason the value contract makes: this same control is
  // เวลาสิ้นสุด, where a shift ending 00:30 is ordinary, and OT on a holiday
  // starts at 08:00. Neither is between 17 and 22.
  assert.match(code, /const HOURS = Array\.from\(\{ length: 24 \}, \(_, i\) => i\);/);
  assert.match(code, /const pad = \(n\) => String\(n\)\.padStart\(2, '0'\);/);
  assert.match(code, /const text = `\$\{pad\(draft\.h\)\}:\$\{pad\(draft\.m\)\}`;/);
});

test('parseTime รับเฉพาะเวลาที่เป็นเวลาจริง', () => {
  assert.deepEqual(parseTime('17:00'), { h: 17, m: 0 });
  assert.deepEqual(parseTime('00:00'), { h: 0, m: 0 });
  assert.deepEqual(parseTime('23:59'), { h: 23, m: 59 });
  // A single-digit hour is what some records carry; the grid still opens on it.
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

// ── the grids ───────────────────────────────────────────────────────────────

/**
 * นาทีเดินทีละห้า และเซลล์ของค่าปัจจุบันไม่เคยหาย.
 *
 * IT WAS ALL SIXTY, and that paragraph was right about one case and made every
 * other case pay for it: วันเกิดที่ยังไม่มีใบ is filled in from the pair of
 * times off the fingerprint scanner — `เวลาเข้า (สแกนนิ้ว)` is what its label
 * says — and a scanner does not round.
 *
 * SO THE CASE KEEPS ITS PRECISION AND NOTHING ELSE PAYS. `minuteStep` is 1 on
 * the birthday form and 5 everywhere else.
 *
 * FOUR CELLS — 00, 15, 30, 45 — WAS ASKED FOR AND WITHDRAWN in the same
 * exchange on 2026-09-01. Four is the shape a picker takes when the times it
 * files are quarters of an hour, and these are not: 17:10 and 17:20 are typed
 * on this form and 17:03 comes off a scanner. The engine's 30-minute rounding
 * is a different question — it PRICES the session, it does not decide what
 * somebody was recorded as working.
 *
 * AND THE HELD VALUE IS ALWAYS IN THE GRID, which is what makes a step safe
 * rather than lossy. Without it an entry filed at 17:03 opens in a box whose
 * step is 5 with NOTHING selected: no home for the roving tabindex, false on
 * every `aria-selected`, and the first arrow press silently moving the value to
 * a multiple of five.
 */
test('นาทีเดินทีละห้า แต่ค่าที่ไม่ลงตัวไม่เคยหลุดจากตาราง', () => {
  assert.match(code, /function minuteValues\(step, held\) \{/);
  assert.match(code, /for \(let m = 0; m < 60; m \+= step\) out\.push\(m\);/);
  assert.match(code, /if \(!out\.includes\(held\) && held >= 0 && held < 60\) \{/);
  assert.match(code, /minuteStep = 5,/);
  assert.match(code, /values=\{minutes\}/);
  // Rebuilt when the held minute moves, since the odd cell it may carry is that
  // value — a memo keyed only on the step would strand it.
  assert.match(code, /React\.useMemo\(\(\) => minuteValues\(minuteStep, draft\.m\), \[minuteStep, draft\.m\]\)/);

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
  assert.equal(values(5, 0).length, 12, 'ตารางนาทีปกติต้องมี 12 ช่อง — สองแถวเต็ม');
  assert.deepEqual(values(5, 30).slice(0, 3), [0, 5, 10]);
  assert.equal(values(1, 3).length, 60, 'ฟอร์มวันเกิดต้องยังมีครบหกสิบ');
  // 17:03 off a scanner, opened in a box whose step is 5.
  assert.ok(values(5, 3).includes(3), 'นาทีที่ไม่ลงตัวหายไปจากตาราง');
  assert.deepEqual(values(5, 3).slice(0, 4), [0, 3, 5, 10], 'ช่องที่แทรกเข้ามาไม่ได้อยู่ตำแหน่งของมัน');
  assert.equal(values(5, 3).length, 13, 'แทรกแล้วต้องเพิ่มมาช่องเดียว');
});

test('เป็น grid ไม่ใช่ listbox — หกช่องต่อแถว และลูกศรซ้ายขวาวนรอบ', () => {
  /**
   * A REVERSAL OF THIS CONTROL'S OWN NOTE, which read: a month is
   * two-dimensional and a column of hours is not, so ↑/↓ are the only arrows
   * that mean anything. True of a column and false of this — 24 hours laid out
   * six to a row ARE two-dimensional, and there is no second column left for
   * ←/→ to move between.
   */
  assert.match(code, /role="grid"/);
  assert.match(code, /role="gridcell"/);
  assert.match(code, /aria-selected=\{v === value\}/);
  assert.ok(!/role="listbox"|role="option"/.test(code), 'ยังมีคอลัมน์แบบ listbox เหลืออยู่');
  // Six, once, for both grids — 24 and 12 both divide by it, so no row is
  // ragged. `.cal-grid` takes its count from a class because a calendar has
  // three views; a number that never varies would be a second place to look.
  assert.match(code, /const COLS = 6;/);
  assert.match(rules, /\.time-grid \{ display: grid; grid-template-columns: repeat\(6, 1fr\); gap: 2px; \}/);
  assert.match(code, /\{ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS \}/);
  // ←/→ WRAP AND ↑/↓ DO NOT. 23 → → → 00 is one press, because a session that
  // ends after midnight is ordinary here — `endsNextDayFor` exists for it. A ↑
  // off the top row would land six cells away with nothing to say why.
  assert.match(code, /if \(n >= 0 && n < values\.length\) onPick\(values\[n\]\);/);
  assert.match(
    code,
    /else if \(step === -1 \|\| step === 1\) onPick\(values\[\(n \+ values\.length\) % values\.length\]\);/,
  );
});

test('roving tabindex และไม่มีอะไรต้องเลื่อนเข้ามาให้เห็นอีกแล้ว', () => {
  // Tab leaves the panel for ยกเลิก / ตกลง rather than walking sixty minutes;
  // the chosen cell is what the arrows move, and focusing it is also what puts
  // focus INTO the panel when it opens.
  assert.match(code, /tabIndex=\{v === value \? 0 : -1\}/);
  assert.match(code, /\?\.focus\(\{ preventScroll: true \}\)/);
  // `scrollIntoView` was the wheel's whole reason for existing: a column opened
  // on its own value because six of twenty-four rows were visible. A grid shows
  // all of them, so a call that scrolls anything here is a column coming back.
  assert.ok(!/scrollIntoView/.test(code), 'มีการเลื่อนแถวเข้ามาให้เห็น — ลูกล้อกลับมาแล้ว');
});

test('เคอร์เซอร์เริ่มที่ตารางชั่วโมง และมีตารางเดียวที่ถือมันไว้', () => {
  /**
   * THE DEFECT THE WALKTHROUGH FOUND, and it outlives the wheel. Both columns
   * focused their own selected option on mount, so the one that mounted second
   * won and the panel opened with the cursor on the MINUTES — measured on the
   * built app at 1280px, `document.activeElement` was the minute `00`, and one
   * press of ↓ turned 17:00 into 17:01. The hour is what somebody opens this
   * control to change.
   *
   * `own` IS WHY A เวลาด่วน CHIP CANNOT SNATCH THE CURSOR BACK. A chip sets
   * both halves, so both grids re-run their focus effect; the hours may only
   * act on it when the cursor is already theirs.
   */
  assert.match(code, /const own = React\.useRef\(autoFocus\);/);
  assert.match(code, /if \(!own\.current\) return;/);
  assert.match(code, /onFocus=\{\(\) => \{ own\.current = true; \}\}/);
  // `relatedTarget` is where the focus WENT: moving between two cells of one
  // grid is not the cursor leaving it.
  assert.match(
    code,
    /onBlur=\{\(e\) => \{ if \(!ref\.current\?\.contains\(e\.relatedTarget\)\) own\.current = false; \}\}/,
  );
  // The hours open with it and the minutes do not.
  const hours = code.slice(code.indexOf('values={HOURS}'), code.indexOf('values={minutes}'));
  assert.match(hours, /autoFocus/);
  assert.ok(!/autoFocus/.test(code.slice(code.indexOf('values={minutes}'))), 'ตารางนาทีแย่งเคอร์เซอร์ตอนเปิด');
});

/**
 * ตกลง / ยกเลิก — AND THIS IS A REVERSAL, ASKED FOR ON 2026-09-01.
 *
 * "Nothing is pending" was this control's own rule: every press wrote through
 * to the box behind, so a panel dismissed any way at all kept what had been
 * chosen, and the panel closed on the minute because that is when the answer is
 * complete.
 *
 * A footer with ตกลง in it that applied nothing would be a button that does what
 * the last press already did, and a ยกเลิก that could not take anything back
 * would be a lie in a control that files somebody's hours. So the draft is real:
 * the box behind does not move until ตกลง, and every other way out — ยกเลิก,
 * Escape, a press on the page — leaves the field as it was found.
 *
 * WHAT IT COSTS is named here rather than hidden: a panel walked away from
 * mid-choice now keeps nothing.
 */
test('ไม่มีอะไรถูกเขียนจนกว่าจะกดตกลง และยกเลิกคืนค่าเดิม', () => {
  assert.match(code, /const \[draft, setDraft\] = React\.useState\(\(\) => parseTime\(value\) \|\| \{ h: 17, m: 0 \}\);/);
  // The two grids move the draft and nothing else.
  assert.match(code, /onPick=\{\(h\) => setDraft\(\(d\) => \(\{ \.\.\.d, h \}\)\)\}/);
  assert.match(code, /onPick=\{\(m\) => setDraft\(\(d\) => \(\{ \.\.\.d, m \}\)\)\}/);
  // `onDone` is `usePicker`'s `pick`: it writes AND closes, and it is reached
  // from exactly one press.
  assert.equal((code.match(/onDone\(/g) || []).length, 1, 'มีทางเขียนค่ามากกว่าปุ่มตกลงทางเดียว');
  assert.match(code, /onClick=\{\(\) => onDone\(text\)\}/);
  assert.match(code, /onDone=\{p\.pick\}/);
  // ยกเลิก is `close`, which is the same thing Escape and a press outside do —
  // and the panel never called `onChange` on the way, so there is nothing to
  // put back.
  assert.match(code, /onClick=\{onClose\}/);
  assert.match(code, /onClose=\{p\.close\}/);
  assert.ok(!/onChange=\{onChange\}/.test(code), 'แผงยังรับ onChange ไปเขียนค่าระหว่างทาง');
});

test('ปุ่ม ตกลง และ ยกเลิก อยู่ในเท้าแผงทั้งสองความกว้าง', () => {
  /**
   * NOT `PopFoot`, which draws its ปิด on a sheet only — a floating panel is
   * dismissed by pressing the page behind it, and that argument ends the moment
   * a panel holds a draft. ยกเลิก has to be reachable at 1280px too, since what
   * it now does is put the field back.
   *
   * `.pop-foot` is still the class, so the divider, the gap and the sheet's
   * 44px buttons are the shared ones.
   */
  assert.match(code, /<div className="pop-foot time-foot">/);
  assert.match(code, /className="btn ghost sm" onClick=\{onClose\}>ยกเลิก<\/button>/);
  assert.match(code, /className="btn sm" onClick=\{\(\) => onDone\(text\)\}>ตกลง<\/button>/);
  assert.ok(!/PopFoot/.test(code), 'กลับไปใช้เท้าแผงที่มีปุ่มเฉพาะบนมือถือ');
  const phone = css.slice(css.indexOf('@media (max-width: 860px)'));
  assert.match(phone, /\.pop\.sheet \.pop-foot \.btn \{ min-height: 44px; \}/);
});

test('ปุ่มเวลาด่วนตั้งทั้งชั่วโมงและนาทีในร่าง และไม่ปิดแผง', () => {
  // The one thing two grids cannot do in a single press. A chip is a place to
  // START from — press 17:00, nudge the minute to 30 — and it is no longer a
  // question whether it should close the panel, because ตกลง is what closes it.
  assert.match(code, /const QUICK = \['17:00', '18:00', '20:00', '22:00'\];/);
  assert.match(code, /onClick=\{\(\) => setDraft\(parseTime\(t\)\)\}/);
  // The chip that is already the answer says so to a screen reader too — and it
  // reads the DRAFT, not the field, or it would go dark the moment a grid moved.
  assert.match(code, /aria-pressed=\{t === text\}/);
  assert.match(rules, /\.time-chip \{/);
  assert.match(
    rules,
    /\.time-chip\.on \{ background: var\(--green-bg\); border-color: var\(--ok-line\); color: var\(--green-dark\); \}/,
  );
});

/**
 * ลูกล้อหายไปจริง ๆ — 2026-09-01, and this case is the one that would notice it
 * coming back.
 *
 * Five rules went with it: `.time-cols` (a flex pair), `.time-col`,
 * `.time-col-head`, `.time-list` (208px with `overflow-y: auto`) and
 * `.time-opt`, along with the two declarations that hid the column's scrollbar
 * — a 10px pill on a `--bg` ground, which in a 196px panel read as a rule down
 * the middle between two columns that were not separated by one.
 *
 * THE SCOPING GUARD STAYS AND IS THE REASON THIS CASE IS NOT JUST A BAN. A bare
 * `::-webkit-scrollbar { display: none }` would take the bar off every scrolling
 * box in the app, so every selector that touches one has to name its own box —
 * `.pop.time-pop` is now one of them, for the cap under the birthday form's ten
 * rows of minutes.
 */
test('คอลัมน์ที่เลื่อนได้ไม่เหลืออยู่แล้ว — และไม่มีกฎแถบเลื่อนตัวไหนเอื้อมออกนอกกล่องตัวเอง', () => {
  for (const gone of ['.time-cols', '.time-col ', '.time-col-head', '.time-list', '.time-opt']) {
    assert.ok(!rules.includes(gone), `${gone} ยังอยู่ในสไตล์ชีต`);
  }
  for (const gone of ['time-cols', 'time-col-head', 'time-list', 'time-opt']) {
    assert.ok(!code.includes(gone), `${gone} ยังอยู่ในคอมโพเนนต์`);
  }
  for (const m of rules.matchAll(/^([^\n{}]*::-webkit-scrollbar[^\n{}]*)\{/gm)) {
    const sel = m[1].trim();
    assert.ok(
      sel.startsWith('::-webkit-scrollbar') || sel.includes('.pick-list')
        || sel.includes('.time-pop') || sel.includes('.section-tabs'),
      `กฎ ${sel} เอื้อมไปไกลกว่ากล่องของตัวเอง`,
    );
  }
});

// ── the theme, which is the other half of what was asked ────────────────────

test('ช่องที่เลือกเป็นเขียวเข้มตัวหนังสือขาว ไม่ใช่แถบน้ำเงินของระบบ', () => {
  // The declaration two rounds of this control were about: what stands where
  // the OS put its blue bar. `--green` is #2E7747 on ธีมมืด and #0F8A46 on the
  // light theme; `--on-fill` is the token for text on a saturated fill and is
  // white in both, so this reads on ธีมมืด without a second rule.
  assert.match(rules, /\.time-cell\.on \{ background: var\(--green\); color: var\(--on-fill\); font-weight: 600; \}/);
  assert.match(rules, /\.time-cell:hover \{ background: var\(--neutral-wash\); \}/);
  assert.match(rules, /\.time-cell\.on:hover \{ background: var\(--green-lift\); \}/);
  // The panel's own dark ground is `.pop`'s — see test/popover.test.js.
  assert.match(css, /\.pop \{[\s\S]*?background: var\(--card-lift\);/);
});

test('ตัวเลขเป็น mono และ tabular — ตัวเลขที่อ่านเทียบกันต้องตรงกัน', () => {
  // Unlike the calendar's cells, which are Thai month names. Two-digit figures
  // read across a row and compared is the case this stylesheet reserves mono
  // for, and nothing in these grids is Thai.
  assert.match(rules, /\.time-cell \{[\s\S]*?font: 400 13\.5px\/1\.3 var\(--mono\); font-variant-numeric: tabular-nums;/);
  // The read-out over them is the same figures, larger — it is the only place
  // the whole answer exists while the panel is open.
  assert.match(rules, /\.time-now \{[\s\S]*?font: 600 21px\/1\.2 var\(--mono\); font-variant-numeric: tabular-nums;/);
  assert.match(code, /<div className="time-now" aria-live="polite">\{text\}<\/div>/);
});

test('วงแหวน focus ไม่ประกาศสีซ้ำกับกฎพื้นฐาน', () => {
  // `test/pressChrome.test.js` refuses a copy of the base ring's colour, and it
  // caught the calendar's cells doing exactly this a round earlier.
  assert.match(rules, /\.time-cell:focus-visible \{ outline-offset: -2px; \}/);
  assert.ok(!/\.time-cell:focus-visible \{[^}]*outline: 2px solid/.test(rules));
});

test('บนมือถือช่องสูง 44px — หกคอลัมน์เป็นตารางเดียวในแอปที่ทำได้', () => {
  const phone = rules.slice(rules.indexOf('@media (max-width: 860px)'));
  assert.match(phone, /\.pop\.sheet \.time-cell \{ min-height: 44px; font-size: 16px; \}/);
  assert.match(phone, /\.pop\.sheet \.time-grid \{ max-width: 340px; margin: 0 auto; \}/);
  // The calendar knowingly stays at 36 because seven 44px columns do not fit a
  // 360px screen. Six do: 6 × 44 plus five 2px gaps is 274.
  assert.match(phone, /\.pop\.sheet \.cal-cell \{ min-height: 44px;/);
});

test('แผงกว้างเท่าหกช่อง และมีเพดานกันไม่ให้ล้นจอเตี้ย', () => {
  /**
   * 272px IS ARITHMETIC: six `1fr` cells, 2px gaps, 10px of `.pop` padding a
   * side — 40.3px a cell. It read 196px while this was two columns of two
   * digits.
   *
   * THE CAP IS FOR ONE FORM. `minuteStep` is 1 on วันเกิดที่ยังไม่มีใบ, so its
   * minute grid is ten rows, and on a short viewport the foot with ตกลง in it
   * would sit below the bottom edge with no way to reach it. `Popover` measures
   * `offsetHeight` after the cap, so the panel is still placed correctly.
   */
  assert.match(rules, /\.pop\.time-pop \{\s*\n\s*width: 272px;\s*\n\s*max-height: calc\(100vh - 16px\); overflow-y: auto;/);
  const phone = rules.slice(rules.indexOf('@media (max-width: 860px)'));
  // A sheet is pinned to the BOTTOM, so a panel taller than the screen loses
  // its top — the hours — rather than its foot.
  assert.match(phone, /\.pop\.sheet\.time-pop \{ max-height: 90vh; \}/);
});
