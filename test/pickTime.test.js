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
 * ── THE PANEL HAS BEEN THREE SHAPES AND THIS FILE HAS FOLLOWED ALL THREE ────
 * Two scrolling columns, then two grids, and now a header of two number boxes
 * over two snapping wheels — asked for as a hybrid on 2026-09-01. The cases
 * below are written against the third and say where the first two went, because
 * a reader finding `.time-opt` or `role="grid"` in an older commit needs to know
 * that both were deliberate and both were answered rather than abandoned.
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
  // The same for the stylesheet's: the shapes that came out are named in the
  // note about them, and a ban that could not tell that from a rule would pass
  // forever.
  assert.ok(css.includes('`.time-grid`'), 'the paragraph naming what was removed is gone');
  assert.ok(!rules.includes('.time-grid'), 'the CSS stripper left a comment behind');
  assert.ok(rules.includes('.time-slot'), 'the CSS stripper ate the rules as well');
});

test('ไม่มี <input type="time"> เหลืออยู่ในแอปแล้ว', () => {
  // The header's two boxes are `type="text"` with `inputMode="numeric"` — see
  // the case about them — so this ban still means what it meant.
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
  assert.match(code, /const text = `\$\{pad\(draft\.h\)\}:\$\{pad\(draft\.m\)\}`;/);
});

test('parseTime รับเฉพาะเวลาที่เป็นเวลาจริง', () => {
  assert.deepEqual(parseTime('17:00'), { h: 17, m: 0 });
  assert.deepEqual(parseTime('00:00'), { h: 0, m: 0 });
  assert.deepEqual(parseTime('23:59'), { h: 23, m: 59 });
  // A single-digit hour is what some records carry; the wheel still opens on it.
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

// ── the header: two boxes somebody types in ─────────────────────────────────

/**
 * ตัวเลขบนหัวแผงเป็นช่องกรอก — the round's whole point.
 *
 * It was text and it is an `<input>`: tapping the hour on a phone opens a
 * keypad, and what is typed there turns the wheel below it. `type="text"` with
 * `inputMode="numeric"` and NOT `type="number"`, which brings spinners, accepts
 * `e` and `-`, and hands back a value the browser has already had opinions
 * about.
 */
test('หัวแผงเป็นช่องกรอกตัวเลข ไม่ใช่ข้อความ และเรียกแป้นตัวเลขบนมือถือ', () => {
  assert.match(code, /function NumBox\(\{ label, value, text, onText, max, bad \}\)/);
  assert.match(code, /type="text"/);
  assert.match(code, /inputMode="numeric"/);
  assert.match(code, /pattern="\[0-9\]\*"/);
  assert.match(code, /maxLength=\{2\}/);
  assert.ok(!/type="number"/.test(code), 'กลับไปใช้ช่องตัวเลขของเบราว์เซอร์ที่มีปุ่มขึ้นลง');
  // Two of them, and the `:` between is a separator rather than a third box.
  assert.equal((code.match(/<NumBox/g) || []).length, 2);
  assert.match(code, /<span className="time-colon" aria-hidden="true">:<\/span>/);
  // Focus selects, so the first digit typed REPLACES rather than appends.
  assert.match(code, /onFocus=\{\(e\) => \{ onText\(pad\(value\)\); e\.target\.select\(\); \}\}/);
  // Nothing but digits ever reaches the field, and never a third one.
  assert.match(code, /onChange=\{\(e\) => onText\(e\.target\.value\.replace\(\/\\D\/g, ''\)\.slice\(0, 2\)\)\}/);
  // Leaving the box drops the text, so it goes back to reading the draft.
  assert.match(code, /onBlur=\{\(\) => onText\(null\)\}/);
  assert.match(rules, /\.time-num \{[\s\S]*?font: 600 26px\/1 var\(--mono\); font-variant-numeric: tabular-nums;/);
});

/**
 * ชั่วโมง 00–23 · นาที 00–59 — และเลขที่เกินไม่ถูกลบเงียบ ๆ.
 *
 * `25` is two digits and it is what somebody typed; taking the `5` away would
 * leave `2` on screen and no reason. It stands, marked, and ตกลง is shut while
 * it does — because the draft still holds the last good figure and applying THAT
 * would be applying a time the screen is not showing.
 */
test('เลขนอกช่วงถูกทำเครื่องหมาย ไม่ใช่ถูกลบ — และตกลงกดไม่ได้จนกว่าจะแก้', () => {
  assert.match(code, /function reading\(text, max\) \{/);
  assert.match(code, /const badH = hText !== null && hText !== '' && reading\(hText, 23\) === null;/);
  assert.match(code, /const badM = mText !== null && mText !== '' && reading\(mText, 59\) === null;/);
  assert.match(code, /aria-invalid=\{bad \|\| undefined\}/);
  assert.match(code, /disabled=\{badH \|\| badM\}/);
  assert.match(code, /<div className="time-bad" role="alert">ชั่วโมง 00–23 · นาที 00–59<\/div>/);
  // The line is only on screen while something is wrong.
  assert.match(code, /\{\(badH \|\| badM\) && \(/);
  assert.match(rules, /\.time-num\.bad \{ border-color: var\(--danger\); color: var\(--danger-ink\); \}/);

  // Run the validator as it is written.
  const reading = (text, max) => {
    if (text === null || !/^\d{1,2}$/.test(text)) return null;
    const n = Number(text);
    return n <= max ? n : null;
  };
  assert.equal(reading('17', 23), 17);
  assert.equal(reading('0', 23), 0);
  assert.equal(reading('9', 59), 9);
  assert.equal(reading('23', 23), 23);
  assert.equal(reading('59', 59), 59);
  assert.equal(reading('24', 23), null, '24 นาฬิกาไม่มีอยู่จริง');
  assert.equal(reading('60', 59), null);
  assert.equal(reading('', 23), null, 'ช่องว่างยังไม่ใช่คำตอบ');
  assert.equal(reading(null, 23), null);
});

test('พิมพ์แล้ววงล้อหมุนตาม — ร่างเดียวเป็นความจริงของทั้งสองฝั่ง', () => {
  /**
   * TWO-WAY, AND IT IS ONE VALUE RATHER THAN TWO KEPT IN STEP. `draft` is the
   * truth; the header's texts are `null` unless somebody is typing, and while
   * they are not they are only what the box SHOWS — a half-typed `1` is a state
   * a wheel cannot be in. A valid keystroke writes the draft, which is what
   * turns the wheel; a wheel that settles writes the draft, which is what puts
   * the figure in the box.
   */
  assert.match(code, /const \[draft, setDraft\] = React\.useState\(\(\) => parseTime\(value\) \|\| \{ h: 17, m: 0 \}\);/);
  assert.match(code, /const \[hText, setHText\] = React\.useState\(null\);/);
  assert.match(code, /if \(n !== null\) setDraft\(\(d\) => \(\{ \.\.\.d, h: n \}\)\);/);
  assert.match(code, /if \(n !== null\) setDraft\(\(d\) => \(\{ \.\.\.d, m: n \}\)\);/);
  // The box shows the draft again the moment something else moves the value —
  // a wheel, a chip — or a figure typed a second ago would sit over a value
  // that has since changed.
  assert.match(code, /const set = \(next\) => \{ setHText\(null\); setMText\(null\); setDraft\(next\); \};/);
  assert.match(code, /value=\{editing \? text : pad\(value\)\}/);
});

// ── the wheels ──────────────────────────────────────────────────────────────

/**
 * นาทีครบหกสิบ ทุกฟอร์ม — 2026-09-02, and the third and last word on a
 * question this control has been through three times.
 *
 * IT WAS ALL SIXTY, THEN A STEP OF FIVE, AND IT IS ALL SIXTY AGAIN. The step
 * existed for one reason and the reason was the scrolling: while a column was
 * the only way in, sixty rows was four screens of dragging to reach 17:30 on an
 * ordinary evening shift, and that was reported. Five was the compromise, and
 * `minuteValues` had to insert the held value beside it so that 17:03 — off the
 * fingerprint scanner on วันเกิดที่ยังไม่มีใบ, where `เวลาเข้า (สแกนนิ้ว)` is
 * the label — still had a row to be selected on.
 *
 * THE HEADER PAID FOR SIXTY. A minute is typed now rather than reached, so the
 * length of the wheel is no longer what it costs to enter a time. The step, the
 * `minuteStep` prop and the insertion rule all went with it — the last of those
 * being a patch over the step rather than a feature: a list of all sixty cannot
 * fail to contain the value it holds.
 */
test('วงล้อนาทีมีครบหกสิบจุด และไม่มี step เหลืออยู่ที่ไหนอีก', () => {
  assert.match(code, /const MINUTES = Array\.from\(\{ length: 60 \}, \(_, i\) => i\);/);
  assert.match(code, /values=\{MINUTES\}/);
  // Two digits always — the same `pad` the hours and the header use, so `3`
  // is drawn `03` and the column reads as a column.
  assert.match(code, /\{pad\(v\)\}/);
  assert.match(code, /const pad = \(n\) => String\(n\)\.padStart\(2, '0'\);/);

  // Nothing anywhere still asks for a step, and the two call sites that passed
  // one pass nothing now.
  for (const gone of ['minuteStep', 'minuteValues']) {
    assert.ok(!code.includes(gone), `${gone} ยังอยู่ในคอมโพเนนต์`);
    const form = strip(read('components/OtForm.jsx'));
    assert.ok(!form.includes(gone), `${gone} ยังถูกส่งมาจาก OtForm`);
  }
  // The scanner's form keeps its precision — it just is not the exception any
  // more, because every form has it.
  assert.match(src, /เวลาเข้า \(สแกนนิ้ว\)|fingerprint scanner/);

  // Build the list as the component builds it.
  const minutes = Array.from({ length: 60 }, (_, i) => i);
  const pad = (n) => String(n).padStart(2, '0');
  assert.equal(minutes.length, 60, 'วงล้อนาทีต้องมีครบหกสิบจุด');
  assert.deepEqual(minutes.slice(0, 6).map(pad), ['00', '01', '02', '03', '04', '05']);
  assert.deepEqual(minutes.slice(-2).map(pad), ['58', '59']);
  // 17:03 needs no insertion any more — it is simply a stop, on every form.
  assert.ok(minutes.includes(3));
  assert.equal(minutes.indexOf(3), 3, 'จุดที่สี่ต้องเป็นนาทีที่ 3 — ไม่มีการแทรกอะไรอีก');
  // And the wheel arithmetic still lands on it: stop 43 centres at 43 × slot.
  assert.equal(Math.round((43 * 34) / 34), 43);
});

/**
 * ล็อกตรงบรรทัด — `scroll-snap-type: y mandatory`, asked for by name.
 *
 * THE PADDING IS THE OTHER HALF OF IT. Two stops of padding at each end are
 * what let the FIRST and LAST value reach the middle, and they are what makes
 * `scrollTop === index * slot` true for every stop — which is both directions
 * of the binding in the component: it reads that ratio to learn what a flick
 * landed on and writes it to turn a wheel to a typed figure.
 */
test('วงล้อล็อกตรงบรรทัด และเลขที่หยุดคือ scrollTop หารความสูงจุดหยุด', () => {
  // `--slot` is on its own line because test/theme.test.js reads token
  // definitions with a line-anchored pattern — see the note beside the rule.
  assert.match(rules, /\.time-wheels \{\s*\n\s*--slot: 34px;\s*\n\s*position: relative; display: flex; gap: 10px;/);
  assert.match(rules, /\.time-wheel \{[\s\S]*?height: calc\(var\(--slot\) \* 5\);/);
  assert.match(rules, /\.time-wheel \{[\s\S]*?scroll-snap-type: y mandatory;/);
  assert.match(rules, /\.time-slots \{ padding: calc\(var\(--slot\) \* 2\) 0; \}/);
  assert.match(rules, /\.time-slot \{\s*\n\s*scroll-snap-align: center;/);
  assert.match(rules, /\.time-slot \{[\s\S]*?height: var\(--slot\);/);
  // The component measures a real stop rather than carrying a copy of 34.
  assert.match(code, /const slotHeight = \(\) => ref\.current\?\.querySelector\('\.time-slot'\)\?\.offsetHeight \|\| 34;/);
  assert.match(code, /const top = i \* slotHeight\(\);/);
  assert.match(code, /Math\.round\(el\.scrollTop \/ slotHeight\(\)\)/);

  // The round trip both directions of the binding rest on.
  const slot = 34;
  for (const [i, top] of [[0, 0], [1, 34], [17, 578], [23, 782]]) {
    assert.equal(i * slot, top, `จุดที่ ${i} ต้องอยู่ที่ ${top}`);
    assert.equal(Math.round(top / slot), i, `${top} ต้องอ่านกลับเป็นจุดที่ ${i}`);
  }
  // Half a stop past 17 still reads as 17 — mandatory snapping never leaves it
  // there, and the rounding is what makes a mid-flight read harmless anyway.
  assert.equal(Math.round((17 * slot + 16) / slot), 17);
});

test('วงล้อพูดตอนหยุดแล้วเท่านั้น — ไม่ใช่ทุกเฟรมระหว่างปัด', () => {
  /**
   * `scroll` fires all the way through a flick. Committing on every frame would
   * write a dozen values nobody chose, and on a two-way binding it would also
   * make the header count up as the thumb moves.
   */
  assert.match(code, /const SETTLE = 90;/);
  assert.match(code, /clearTimeout\(timer\.current\);\s*\n\s*timer\.current = setTimeout\(\(\) => \{/);
  assert.match(code, /\}, SETTLE\);/);
  assert.match(code, /if \(values\[i\] !== value\) onPick\(values\[i\]\);/);
  // And the timer cannot outlive the panel.
  assert.match(code, /React\.useEffect\(\(\) => \(\) => clearTimeout\(timer\.current\), \[\]\);/);
});

test('พิมพ์แล้ววงล้อเลื่อนไปหยุดที่เลขนั้น — และไม่แย่งกับนิ้วที่กำลังปัด', () => {
  // The layout effect is what turns the wheel to a value that came from
  // somewhere else — typing, a chip, or the field the panel opened on.
  assert.match(code, /React\.useLayoutEffect\(\(\) => \{/);
  assert.match(code, /if \(Math\.abs\(el\.scrollTop - top\) > 1\) el\.scrollTo\(\{ top \}\);/);
  // BEFORE THE PAINT, because mandatory snapping resolves against the scroll
  // position the browser has when it lays the column out.
  assert.ok(!/React\.useEffect\(\(\) => \{\s*\n\s*const el = ref\.current;\s*\n\s*if \(!el\) return;\s*\n\s*const i = values\.indexOf/.test(code),
    'การหมุนวงล้อกลับไปทำหลัง paint แล้ว');
});

test('แถบไฮไลต์เป็นชิ้นเดียวพาดทั้งสองวงล้อ และอยู่กึ่งกลางพอดี', () => {
  /**
   * Asked for as the two columns' highlights lining up. ONE band centred on the
   * pair cannot be out of line with itself; two — one inside each scroller,
   * each riding its own scroll position — could always become so.
   */
  assert.match(code, /<div className="time-band" aria-hidden="true" \/>/);
  assert.equal((code.match(/time-band/g) || []).length, 1, 'มีแถบไฮไลต์มากกว่าหนึ่งชิ้น');
  assert.match(rules, /\.time-band \{[\s\S]*?top: 50%; transform: translateY\(-50%\);/);
  assert.match(rules, /\.time-band \{[\s\S]*?height: var\(--slot\);/);
  assert.match(rules, /\.time-band \{[\s\S]*?pointer-events: none;/);
  // It is drawn behind the stops, which carry no fill of their own.
  assert.match(rules, /\.time-wheel \{\s*\n\s*position: relative; z-index: 1;/);
  // The labels are OUTSIDE the wheels, or each column would be pushed down by
  // its own heading and the one band would be centred on the wrong box.
  assert.match(code, /<div className="time-heads" aria-hidden="true">/);
  assert.match(rules, /\.time-heads \{ display: flex; gap: 10px; \}/);
});

test('ไม่วาดแถบเลื่อนของวงล้อ — และไม่มีกฎแถบเลื่อนตัวไหนเอื้อมออกนอกกล่องตัวเอง', () => {
  /**
   * Asked for, and it was reported the first time round as a line down the
   * middle of the panel — which is where it was: the hour wheel's bar sits at
   * ITS right edge, and in a two-column panel that is the gap between ชั่วโมง
   * and นาที.
   *
   * THE SCOPING GUARD IS THE REASON THIS CASE IS NOT JUST A BAN. A bare
   * `::-webkit-scrollbar { display: none }` would take the bar off every
   * scrolling box in the app.
   */
  assert.match(rules, /\.time-wheel \{ scrollbar-width: none; \}/);
  assert.match(rules, /\.time-wheel::-webkit-scrollbar \{ display: none; \}/);
  for (const m of rules.matchAll(/^([^\n{}]*::-webkit-scrollbar[^\n{}]*)\{/gm)) {
    const sel = m[1].trim();
    assert.ok(
      sel.startsWith('::-webkit-scrollbar') || sel.includes('.pick-list')
        || sel.includes('.time-pop') || sel.includes('.time-wheel') || sel.includes('.section-tabs'),
      `กฎ ${sel} เอื้อมไปไกลกว่ากล่องของตัวเอง`,
    );
  }
});

test('วงล้อเป็น listbox — roving tabindex และลูกศรวนรอบ', () => {
  assert.match(code, /role="listbox"/);
  assert.match(code, /role="option"/);
  assert.match(code, /aria-selected=\{v === value\}/);
  // Tab leaves the wheel for the other one, the chips and the two buttons,
  // rather than walking sixty minutes.
  assert.match(code, /tabIndex=\{v === value \? 0 : -1\}/);
  // WRAPS: 23:00 → ↓ → 00:00 in one press, because a session that ends after
  // midnight is ordinary here — `endsNextDayFor` exists for it.
  assert.match(code, /const n = \(at \+ step \+ values\.length \* 5\) % values\.length;/);
  assert.match(code, /\{ ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 \}/);
  // ←/→ are NOT bound any more: the wheels are two tab stops and the header is
  // where somebody moving between hour and minute in one key is already going.
  assert.ok(!/ArrowLeft/.test(code), 'ลูกศรซ้ายขวากลับมาผูกกับคอลัมน์อีกแล้ว');
});

test('เคอร์เซอร์เริ่มที่วงล้อชั่วโมง และมีวงล้อเดียวที่ถือมันไว้', () => {
  /**
   * THE DEFECT THE FIRST WHEEL ROUND'S WALKTHROUGH FOUND, and it is available
   * to any shape with two of anything: both columns focused their own selected
   * option on mount, so the one that mounted second won and the panel opened
   * with the cursor on the MINUTES, where one press of ↓ turned 17:00 into
   * 17:01. The hour is what somebody opens this control to change.
   *
   * `own` IS ALSO WHY A TYPED HOUR CANNOT SNATCH THE CURSOR. Typing writes the
   * draft, which re-runs both wheels' effects; the hours may only act on it
   * when the cursor is already theirs.
   */
  assert.match(code, /const own = React\.useRef\(autoFocus\);/);
  assert.match(code, /if \(own\.current\) el\.querySelector\('\[data-at="1"\]'\)\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(code, /onFocus=\{\(\) => \{ own\.current = true; \}\}/);
  assert.match(
    code,
    /onBlur=\{\(e\) => \{ if \(!ref\.current\?\.contains\(e\.relatedTarget\)\) own\.current = false; \}\}/,
  );
  const hours = code.slice(code.indexOf('values={HOURS}'), code.indexOf('values={minutes}'));
  assert.match(hours, /autoFocus/);
  assert.ok(!/autoFocus/.test(code.slice(code.indexOf('values={minutes}'))), 'วงล้อนาทีแย่งเคอร์เซอร์ตอนเปิด');
});

// ── the draft, and the two buttons under it ────────────────────────────────

/**
 * ไม่มีอะไรถูกเขียนจนกว่าจะกดตกลง — arrived with the grid and outlives it.
 *
 * The header makes it load-bearing rather than merely consistent: a half-typed
 * hour must not reach the form. ยกเลิก, Escape and a press on the page all
 * leave the field exactly as it was found.
 */
test('ไม่มีอะไรถูกเขียนจนกว่าจะกดตกลง และยกเลิกคืนค่าเดิม', () => {
  // `onDone` is `usePicker`'s `pick`: it writes AND closes, and it is reached
  // from exactly one press.
  assert.equal((code.match(/onDone\(/g) || []).length, 1, 'มีทางเขียนค่ามากกว่าปุ่มตกลงทางเดียว');
  assert.match(code, /onClick=\{\(\) => onDone\(text\)\}/);
  assert.match(code, /onDone=\{p\.pick\}/);
  assert.match(code, /onClick=\{onClose\}/);
  assert.match(code, /onClose=\{p\.close\}/);
  assert.ok(!/onChange=\{onChange\}/.test(code), 'แผงยังรับ onChange ไปเขียนค่าระหว่างทาง');
});

test('ปุ่ม ตกลง และ ยกเลิก อยู่ในเท้าแผงทั้งสองความกว้าง', () => {
  assert.match(code, /<div className="pop-foot time-foot">/);
  assert.match(code, /className="btn ghost sm" onClick=\{onClose\}>ยกเลิก<\/button>/);
  assert.match(code, /className="btn sm"/);
  assert.match(code, />\s*ตกลง\s*<\/button>/);
  assert.ok(!/PopFoot/.test(code), 'กลับไปใช้เท้าแผงที่มีปุ่มเฉพาะบนมือถือ');
  const phone = css.slice(css.indexOf('@media (max-width: 860px)'));
  assert.match(phone, /\.pop\.sheet \.pop-foot \.btn \{ min-height: 44px; \}/);
});

test('ปุ่มเวลาด่วนตั้งทั้งชั่วโมงและนาทีในร่าง และไม่ปิดแผง', () => {
  // The one thing neither the wheels nor two number boxes do in a single press.
  assert.match(code, /const QUICK = \['17:00', '18:00', '20:00', '22:00'\];/);
  assert.match(code, /onClick=\{\(\) => set\(parseTime\(t\)\)\}/);
  // The chip that is already the answer says so to a screen reader too — and it
  // reads the DRAFT, not the field, or it would go dark the moment a wheel moved.
  assert.match(code, /aria-pressed=\{t === text\}/);
  assert.match(rules, /\.time-chip \{/);
  assert.match(
    rules,
    /\.time-chip\.on \{ background: var\(--green-bg\); border-color: var\(--ok-line\); color: var\(--green-dark\); \}/,
  );
});

// ── the theme, and what came out with the older shapes ─────────────────────

test('จุดที่อยู่ในแถบอ่านเป็นเขียวของธีม และตัวเลขเป็น mono ทั้งวงล้อ', () => {
  // The band is the fill, so this is the text ON it rather than a second
  // highlight: `--green-dark` is the app's readable green on `--green-bg` in
  // both themes, which is the pair `.time-chip.on` uses.
  assert.match(rules, /\.time-slot\.on \{ color: var\(--green-dark\); font-weight: 600; \}/);
  assert.match(rules, /\.time-band \{[\s\S]*?background: var\(--green-bg\);/);
  assert.match(rules, /\.time-slot \{[\s\S]*?font: 400 14px\/1\.3 var\(--mono\); font-variant-numeric: tabular-nums;/);
  // The panel's own dark ground is `.pop`'s — see test/popover.test.js.
  assert.match(css, /\.pop \{[\s\S]*?background: var\(--card-lift\);/);
});

test('วงแหวน focus ไม่ประกาศสีซ้ำกับกฎพื้นฐาน', () => {
  // `test/pressChrome.test.js` refuses a copy of the base ring's colour, and it
  // caught the calendar's cells doing exactly this a round earlier. The header's
  // boxes are the app's field ring, which IS a shared declaration.
  assert.match(rules, /\.time-slot:focus-visible \{ outline-offset: -2px; \}/);
  assert.ok(!/\.time-slot:focus-visible \{[^}]*outline: 2px solid/.test(rules));
  assert.match(rules, /\.time-num:focus \{ outline: none; border-color: var\(--green\); box-shadow: 0 0 0 3px var\(--focus-ring\); \}/);
});

test('สองรูปทรงก่อนหน้าไม่เหลืออยู่ในไฟล์ไหนเลย', () => {
  // The wheel that scrolled without a header (`.time-list` / `.time-opt` /
  // `.time-cols`) and the pair of grids that replaced it (`.time-grid` /
  // `.time-cell`). Both were answered rather than abandoned — see the note at
  // the top of this file — and neither may be half-present.
  for (const gone of ['.time-cols', '.time-col ', '.time-col-head', '.time-list', '.time-opt', '.time-grid', '.time-cell', '.time-now']) {
    assert.ok(!rules.includes(gone), `${gone} ยังอยู่ในสไตล์ชีต`);
  }
  for (const gone of ['time-cols', 'time-col-head', 'time-list', 'time-opt', 'time-grid', 'time-cell', 'time-now']) {
    assert.ok(!code.includes(gone), `${gone} ยังอยู่ในคอมโพเนนต์`);
  }
  assert.ok(!/role="grid"|role="gridcell"/.test(code), 'ตารางยังไม่ถูกถอดออกจนหมด');
});

test('บนมือถือจุดหยุดสูง 44px และหัวแผงโตขึ้น', () => {
  const phone = rules.slice(rules.indexOf('@media (max-width: 860px)'));
  // One number moves the stop, the padding under it and the band across it.
  assert.match(phone, /\.pop\.sheet \.time-wheels \{\s*\n\s*--slot: 44px;\s*\n\s*\}/);
  assert.match(phone, /\.pop\.sheet \.time-slot \{ font-size: 16px; \}/);
  assert.match(phone, /\.pop\.sheet \.time-num \{ min-height: 52px; width: 92px; font-size: 30px; \}/);
});

test('แผงกว้างเท่าหัวของมัน และมีเพดานกันไม่ให้ล้นจอเตี้ย', () => {
  /**
   * 232px COMES FROM THE HEADER, not from the wheels: two 78px boxes and the
   * `:` between them are 170, and a panel narrower than its own heading is a
   * panel with the heading wrapped. It read 272 while this was two grids and
   * 196 while it was two bare columns.
   *
   * THE CAP NO LONGER HAS A FORM'S NAME ON IT. A wheel with sixty stops is the
   * same five stops tall as one with twelve, so the panel is one height
   * everywhere; what is left is a screen shorter than that.
   */
  assert.match(rules, /\.pop\.time-pop \{\s*\n\s*width: 232px;\s*\n\s*max-height: calc\(100vh - 16px\); overflow-y: auto;/);
  const phone = rules.slice(rules.indexOf('@media (max-width: 860px)'));
  assert.match(phone, /\.pop\.sheet\.time-pop \{ max-height: 90vh; \}/);
});
