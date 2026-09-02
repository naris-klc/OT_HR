import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const src = read('components/PickDate.jsx');
const css = read('app/styles.css');

/**
 * ปฏิทินของแอปเอง — `PickDate` / `PickMonth`.
 *
 * THE PREMISE, because every assertion below rests on it: an `<input
 * type="date">` is an element in this document and every rule in
 * `app/styles.css` reached its BOX; the calendar it dropped down was drawn by
 * the browser and the operating system, was not in the DOM, and no selector
 * anywhere in this app could enter one. Two paragraphs already said so and both
 * settled for it, because all that was being asked of that calendar was to grey
 * out the days outside `min`/`max` — which every browser does.
 *
 * What was asked on 2026-09-01 was that the popup not be clipped, that it carry
 * a `z-index`, that it move when it meets the bottom of the screen, and that it
 * be a sheet on a phone in ธีมมืด. NONE of those are reachable on an element
 * nobody renders: a `z-index` needs a box, a portal needs a subtree, `overflow`
 * clips descendants. So the calendar had to become ours — the same conclusion
 * the queue's two `<select>`s reached a round earlier, one step further along.
 */

/** The source with its comments out — a ban proves nothing without it. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = strip(src);

const components = readdirSync(join(ROOT, 'components'))
  .filter((f) => f.endsWith('.jsx'))
  .map((f) => [f, strip(read(`components/${f}`))]);

// ── nothing asks the browser to draw a calendar any more ────────────────────

test('the stripper actually strips — the bans below prove nothing otherwise', () => {
  assert.ok(src.includes('`<input type="date">`'), 'the paragraph this guards against is gone');
  assert.ok(!code.includes('<input type="date">'), 'the stripper left a comment behind');
  assert.ok(code.includes('export function PickDate('), 'the stripper ate the code as well');
});

test('ไม่มี <input type="date"> หรือ type="month" เหลืออยู่ในแอปแล้ว', () => {
  const left = components
    .filter(([, body]) => /type="(date|month)"/.test(body))
    .map(([f]) => f);
  assert.deepEqual(left, [], `ยังมีตัวเลือกวันที่ของเบราว์เซอร์เหลืออยู่: ${left.join(', ')}`);
});

test('ทั้งสิบแปดกล่องใช้คอมโพเนนต์เดียวกัน', () => {
  /**
   * ELEVEN DAYS AND SEVEN MONTHS, and the count is here so that a nineteenth
   * box added with an `<input>` is a failing test rather than the one control
   * in the app whose popup nobody can style.
   */
  const uses = components.reduce((n, [, body]) => (
    n + (body.match(/<Pick(Date|Month)\b/g) || []).length
  ), 0);
  assert.equal(uses, 18, `มี ${uses} กล่อง — คาดว่า 18`);
  // Every file that draws one imports it from the one place.
  for (const [f, body] of components) {
    if (!/<Pick(Date|Month)\b/.test(body) || f === 'PickDate.jsx') continue;
    assert.match(body, /import \{ Pick(Date|Month)(, Pick(Date|Month))? \} from '\.\/PickDate\.jsx'/,
      `${f} วาดปฏิทินโดยไม่ได้ import จาก PickDate.jsx`);
  }
});

test('ค่าที่รับและส่งยังเป็นสตริงเดิมของ input — ไม่มี call site ไหนต้องแก้ state', () => {
  /**
   * `YYYY-MM-DD` and `YYYY-MM`, which is what the inputs wrote. That is what
   * lets eighteen call sites keep their state, their request bodies and their
   * server contract while the popup changes hands — and it is why the pickers
   * take `onChange(value)` rather than an event: the only thing that moved is
   * who draws the calendar.
   */
  assert.match(code, /const isoOf = \(y, m, d\) => `\$\{y\}-\$\{pad\(m\)\}-\$\{pad\(d\)\}`/);
  assert.match(code, /const monthOf = \(y, m\) => `\$\{y\}-\$\{pad\(m\)\}`/);
  /* No caller unwraps an event any more — a picker hands over the value.
     BOUNDED BY THE ELEMENT'S OWN TAG (`[^>]*?/>`) and not by a character count,
     which is what it read on the first run: a `<PickDate>` with an ordinary
     `<input>` a few lines below it matched, and the test reported วันหยุดบริษัท
     reading `e.target` from a calendar it does not touch. */
  const callers = components.filter(([f]) => f !== 'PickDate.jsx');
  for (const [f, body] of callers) {
    for (const [tag] of body.matchAll(/<Pick(?:Date|Month)\b[^>]*?\/>/g)) {
      assert.ok(!/e\.target/.test(tag), `${f} ยังอ่าน e.target จากปฏิทิน: ${tag.slice(0, 80)}`);
      assert.match(tag, /onChange=\{/, `${f} มีปฏิทินที่ไม่มี onChange`);
    }
  }
});

test('เลขวันคำนวณด้วย UTC ทั้งหมด — ไม่งั้นได้วันก่อนหน้า', () => {
  // `new Date('2026-08-15')` is midnight UTC and `getDate()` reads it locally,
  // which west of Greenwich is the 14th. Every date in this app is a calendar
  // day with no time and no zone — `thaiDate`'s own note says so.
  assert.match(code, /Date\.UTC\(/);
  assert.ok(!/get(FullYear|Month|Date)\(\)/.test(code.replace(/function todayISO\(\)[\s\S]*?\n\}/, '')),
    'มีการอ่านวันที่แบบ local นอก todayISO');
  // `todayISO` is the exception and is deliberately local: it is the OFFICE's
  // day, which is the rule `today()` in OtForm.jsx already follows.
  assert.match(code, /function todayISO\(\) \{[\s\S]*?n\.getFullYear\(\), n\.getMonth\(\) \+ 1, n\.getDate\(\)/);
});

// ── the clipping, which is what the report was about ────────────────────────

// ── the ways out ────────────────────────────────────────────────────────────

// ── the grid ────────────────────────────────────────────────────────────────

test('เซลล์ที่เลือกไม่ได้ใช้ aria-disabled ไม่ใช่ disabled', () => {
  /**
   * A disabled button cannot take focus — so a calendar opened on a day outside
   * `min`/`max` (the log's range, whose `max` is today, opened on a value from
   * last week) would have nowhere to put it and the arrows would be dead before
   * the first press. The refusal goes on the press instead, which is what APG
   * asks of a grid.
   */
  assert.match(code, /aria-disabled=\{c\.off \|\| undefined\}/);
  assert.match(code, /onClick=\{\(\) => \{ if \(!c\.off\) onPick\(c\); \}\}/);
  assert.ok(!/disabled=\{c\.off\}/.test(code), 'เซลล์กลับไปใช้ disabled — คีย์บอร์ดจะเข้าไม่ถึง');
  assert.match(css, /\.cal-cell\[aria-disabled='true'\] \{ color: var\(--muted-4\); cursor: not-allowed; \}/);
});

test('roving tabindex — Tab ออกจากปฏิทิน ลูกศรเดินในนั้น', () => {
  assert.match(code, /tabIndex=\{i === at \? 0 : -1\}/);
  assert.match(code, /ref\.current\?\.querySelector\('\[data-at="1"\]'\)\?\.focus\(\{ preventScroll: true \}\)/);
});

test('ลูกศรเดินเป็นวัน ไม่ใช่เป็นช่อง', () => {
  // ↓ on the 28th is the 4th of next month and the view follows it there; an
  // index walk would stop at the end of the grid and leave the last week
  // unreachable.
  assert.match(code, /const next = shiftDay\(cursor, by\);/);
  assert.match(code, /setYm\(\{ y: p\.y, m: p\.m \}\);/);
  // PageUp/PageDown keeps the day of the month where it can: from 31 January it
  // lands on 28 February, not on 3 March.
  assert.match(code, /const d = Math\.min\(parseDay\(cursor\)\.d, daysIn\(jump\.y, jump\.m\)\);/);
  // Home/End are the ends of the WEEK — on a calendar `Home` means Sunday.
  assert.match(code, /onMove\(e\.key === 'Home' \? -\(at % cols\) : \(cols - 1 - \(at % cols\)\)\);/);
});

test('ช่องว่างก่อนวันที่ 1 เป็นเซลล์ด้วย มิฉะนั้นคอลัมน์จะเลื่อนไปหนึ่งวัน', () => {
  // Rendered as empty <div>s they would leave the grid's index arithmetic, and
  // ↓ from the first row would land a column off.
  assert.match(code, /for \(let i = 0; i < lead; i\+\+\) cells\.push\(\{ key: `b\$\{i\}`, label: '', off: true, dim: true \}\);/);
  assert.match(css, /\.cal-cell\.blank \{ visibility: hidden; \}/);
});

test('สามระดับ — วัน เดือน ปี — และวันเกิดคือเหตุผล', () => {
  /**
   * `birthDate` on ตั้งค่าระบบ › พนักงาน is one of these boxes. A colleague born
   * in 1985 is four hundred and ninety-two presses of `‹` away from a calendar
   * that can only step a month at a time, so the title is a control and not a
   * caption.
   */
  assert.match(code, /const \[view, setView\] = React\.useState\(mode === 'day' \? 'day' : 'month'\);/);
  /**
   * It read `onUp={() => setView('month')}` until 2026-09-02, when `typeable`
   * arrived and the way up became the moment the reader chooses the grid over
   * the typing box: the day view they come back DOWN to has to take the focus
   * the ordinary way, and `typing` is what says so. The step up is still one
   * press and still lands on the months — that is what this line is here for.
   */
  assert.match(code, /onUp=\{\(\) => \{ setTyping\(false\); setView\('month'\); \}\}/);
  assert.match(code, /onUp=\{\(\) => setView\('year'\)\}/);
  // A month picked in a DAY picker comes back down; in a month picker it IS the
  // answer, because a งวด is a month.
  assert.match(code, /if \(mode === 'month'\) \{ onPick\(c\.ym\); return; \}/);
  assert.match(code, /setView\('day'\);/);
  assert.match(css, /\.cal-title \{/);
});

test('ขอบเขต min/max เทียบเป็นสตริง และครอบทั้งวัน เดือน ปี', () => {
  // `'2026-08-15' < '2026-09-01'` is true for the reason `YYYY-MM-DD` was
  // chosen: lexical order and calendar order are the same. So a bound given for
  // a DAY is tested against a MONTH by cutting it to seven characters, and no
  // date object is built to answer "is this day allowed".
  assert.match(code, /const dayBlocked = \(iso, min, max\) => \(!!min && iso < min\) \|\| \(!!max && iso > max\);/);
  assert.match(code, /ym < String\(min\)\.slice\(0, 7\)/);
  assert.match(code, /y < Number\(String\(min\)\.slice\(0, 4\)\)/);
});

test('กล่องยังบอกได้ว่าถือค่าที่นอกช่วง — ย้ายจาก input:out-of-range มาที่คลาส', () => {
  /**
   * `.field input:out-of-range` needs an `<input>` and every date box is a
   * button now. The state is rarer than it was — nothing can be typed in and no
   * day outside the range can be pressed — but a value can arrive from a record
   * or a bound can move under one already held, and dropping the mark silently
   * is how an app stops saying something it used to say.
   */
  assert.match(code, /const out = Boolean\(value\) && dayBlocked\(value, min, max\);/);
  assert.match(css, /\.pick-box\.out \{ border-color: var\(--amber-line\); background: var\(--amber-bg\); \}/);
  // The original rule stays: it is written for any ranged input, not for this.
  assert.match(css, /\.field input:out-of-range \{/);
});

// ── the box, and the sheet ──────────────────────────────────────────────────

test('แถวในปฏิทินเป็น sans ตัวเลขเป็น tabular — ไม่ใช่ mono ที่ไม่มีอักษรไทย', () => {
  // The month grid's cells are Thai words. `.cell-sub.th` and
  // `.pick-menu.find-menu li` are the other two rules in that file to say so.
  assert.match(css, /\.cal-cell \{[\s\S]*?font: 400 13px\/1\.3 var\(--sans\); font-variant-numeric: tabular-nums;/);
  // And the day names above them are a label row, outside `role="grid"`.
  assert.match(code, /<div className="cal-dow" aria-hidden="true">/);
  assert.match(code, /const DOW_SHORT = \['อา\.', 'จ\.', 'อ\.', 'พ\.', 'พฤ\.', 'ศ\.', 'ส\.'\];/);
});

test('ปีพุทธศักราชทุกที่ที่ปฏิทินพูดถึงปี', () => {
  // The app writes 2569, never 2026 — `thaiDate` and `periodLabel` already do
  // it for the box, and the panel has to agree with the box above it.
  assert.match(code, /`\$\{THAI_MONTHS\[ym\.m - 1\]\} \$\{ym\.y \+ 543\}`/);
  assert.match(code, /title=\{`\$\{ym\.y \+ 543\}`\}/);
  assert.match(code, /title=\{`\$\{base \+ 543\} – \$\{base \+ 11 \+ 543\}`\}/);
  assert.match(code, /label: String\(y \+ 543\)/);
});

test('หน้าจออ่านออก — grid, gridcell และป้ายของทุกปุ่มเดินเรื่อง', () => {
  // The panel's own `role="dialog"` and the box's `aria-haspopup` belong to the
  // shared popover and are pinned in test/popover.test.js. What is this file's
  // is the grid inside it.
  assert.match(code, /role="grid"/);
  assert.match(code, /role="gridcell"/);
  assert.match(code, /aria-selected=\{c\.on \|\| undefined\}/);
  // ‹ and › read aloud are nothing; each says which way and by how much.
  for (const l of ['เดือนก่อนหน้า', 'เดือนถัดไป', 'ปีก่อนหน้า', 'ปีถัดไป', 'เลือกเดือนและปี', 'เลือกปี']) {
    assert.ok(src.includes(l), `ปุ่มเดินเรื่องขาดป้าย: ${l}`);
  }
});

