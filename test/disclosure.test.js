import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * อ่านต่อ — ข้อความยาว ๆ ที่พับเก็บไว้ได้.
 *
 * ── THE STANDARD, SETTLED 2026-09-07 AFTER THREE SHAPES IN ONE DAY ──────────
 *
 * Text that explains a screen is not all one kind of text, and the rule that
 * matters is which kind gets a control at all. It took three rounds in a day to
 * find, and the two that were withdrawn are written here because each of them
 * looked right at the time.
 *
 *   A CARD'S SUBTITLE is drawn in full. The grey line under นโยบายการคำนวณ or
 *   วันหยุดบริษัท is two or three lines and folds nothing worth a press. It was
 *   folded for an hour that afternoon, across nine components, and the result
 *   was a screen that opened on a heading and the word อ่านต่อ.
 *
 *   AN ALERT'S ALARM IS NEVER FOLDED. It is read at the moment it is drawn or
 *   it is not read, so nothing a press is about — and nothing that says
 *   something is wrong now — goes behind one. `LivePolicy` on นโยบายการคำนวณ
 *   is the single named exception and the shape of it is the rule: the count,
 *   the sentence and a chip per changed value all stand; what folds is the
 *   half that is NOT a warning, the values stored at the figure the program
 *   ships today. `ALERTS_THAT_MAY_FOLD` is that list, and adding to it is a
 *   decision rather than a fix for a failing case.
 *
 *   THE TEXT UNDER ONE SETTING is what the control is for. นโยบายการคำนวณ asks
 *   nineteen questions and explains twelve of them under the question. The
 *   longest runs to 671 characters — a dozen lines on a 360px phone — and the
 *   twelve together were most of the page's height, on a screen somebody opens
 *   to change ONE dropdown. Two lines stay; the qualification folds.
 *
 * ── AND THE THREE WAYS A FOLD GOES WRONG ────────────────────────────────────
 *
 *   THE CLAMP IS CSS. If the cut is made in JavaScript, the first paint draws
 *   the paragraph in full and the page jumps under the thumb a frame later.
 *
 *   THE BUTTON IS EARNED. A control that reveals nothing is a press that
 *   appears to do nothing, and it would sit under half the rows on that page —
 *   so it is drawn from a MEASUREMENT of what the clamp hid, never from the
 *   length of the string or from a breakpoint. "Fewer than two lines" and
 *   "under about 150 characters" are the same rule; only the first survives a
 *   360px screen, so only the first is asked.
 *
 *   ย่อข้อความ CANNOT VANISH. Open, the clamp is off and the two heights are
 *   equal. A component that kept measuring there would answer "nothing is
 *   hidden" and take the way back from the reader mid-use.
 *
 * ── AND WHAT IT IS NOT ──────────────────────────────────────────────────────
 *
 * A LIST that is too long is a different question with two answers already —
 * `Panel` on บันทึกระบบ opens its rows inside the height the card had, and
 * `EntryPeek` folds the rows a batch decision is about. Both count rows, which
 * prose has no equivalent of. What `lines={0}` adds is a third case neither
 * covers: a card whose whole explanation IS bullets, where a `-webkit-box` cut
 * would take the markers with it and two bullets of six preview nothing.
 *
 * The ban at the foot of this file is on a FOURTH clamp growing somewhere else.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
/* Comments in this repo quote the markup they explain, so an assertion about
   what a screen DRAWS has to read the code with the prose taken out. */
const sourceOf = (f) => read(f)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const common = read('components/common.jsx');
const admin = sourceOf('components/AdminView.jsx');
const css = read('app/styles.css');
const components = readdirSync(join(ROOT, 'components')).filter((n) => n.endsWith('.jsx'));

// ── the clamp is in the stylesheet ──────────────────────────────────────────

test('the cut is made in CSS, so a folded paragraph is folded in the first paint', () => {
  const rule = css.match(/\.disclosure-body\.clamp \{[^}]*\}/)?.[0];
  assert.ok(rule, '.disclosure-body.clamp หายไปจาก styles.css');
  // The three declarations are one mechanism: the box, its orientation and the
  // count. Any one of them missing and the clamp silently does nothing.
  assert.match(rule, /display: -webkit-box/);
  assert.match(rule, /-webkit-box-orient: vertical/);
  assert.match(rule, /-webkit-line-clamp: var\(--disclosure-lines/);
  assert.match(rule, /overflow: hidden/);
});

test('the line box is tall enough to be cut at', () => {
  /*
   * Measured on the built app at 360px: `.hint` gives 12.5px text an 18.75px
   * line box, and a line of Thai in it is 21px of ink — the two-level vowels
   * and tone marks stand about a pixel outside the box on each side. Clamped at
   * two lines, the tops of the third line showed under the ellipsis as a faint
   * dotted row, which reads as a rendering fault rather than as a fold.
   *
   * So the leading is part of the cut, and it is set for BOTH states: on
   * `.clamp` alone it would re-space the paragraph under the thumb that just
   * pressed อ่านต่อ. Two classes deep because `.reason-text`'s `font:`
   * shorthand carries a line-height and is later in the file.
   */
  assert.match(css, /\.disclosure \.disclosure-body \{[^}]*line-height: 1\.7;/);
  assert.doesNotMatch(css, /\.disclosure-body\.clamp \{[^}]*line-height/);
});

test('two lines is what a caller gets by saying nothing', () => {
  // The default is in the signature, so a setting's explanation is clamped
  // without its caller arguing for it — and 0 has to be ASKED for.
  assert.match(common, /lines = 2, className = '', as: Tag = 'p'/);
  // Not a fallback inside `var()` alone: the token is declared on the class, so
  // a paragraph rendered before any inline style lands has a number to use.
  assert.match(css, /\.disclosure-body \{\r?\n\s*--disclosure-lines: 2;/);
  // And the caller's number arrives as that same custom property rather than as
  // a class per length — two on a policy hint, four on a description.
  assert.match(common, /style=\{open \|\| whole \? undefined : \{ '--disclosure-lines': lines \}\}/);
});

// ── the button is drawn from a measurement ──────────────────────────────────

test('the button appears only when the clamp actually hid something', () => {
  // scrollHeight is the whole paragraph; clientHeight is what the clamp left
  // standing. The question is one subtraction and needs no line arithmetic —
  // and no character count either, which is the same rule stated in the units
  // a reader's screen does not use.
  assert.match(common, /setOver\(el\.scrollHeight - el\.clientHeight > 2\)/);
  // Not `> 0`: a fractional line height leaves a pixel behind at most zoom
  // levels, and it would put an อ่านต่อ under a paragraph with nothing behind
  // it. Same reading as `useScrollEdge`.
  assert.doesNotMatch(common, /el\.scrollHeight - el\.clientHeight > 0/);
  // And the control is gated on that answer rather than on the text's length.
  assert.match(common, /\{\(over \|\| open\) && \(/);
  // …so a hint that fits draws NOTHING — no button, and no wrapper class that
  // would place one.
  assert.match(common, /const tail = over && !open && !whole;/);
});

test('the measurement is re-taken when the column rewraps', () => {
  // The paragraph sits in the left column of a `.policy-row`, which is a
  // fraction of the window: two lines hold a third as much on a phone as on a
  // laptop, so a window resize can hide text that was fully visible.
  assert.match(common, /const ro = new ResizeObserver\(read\);/);
  assert.match(common, /ro\.observe\(el\);/);
  assert.match(common, /return \(\) => ro\.disconnect\(\);/);
});

test('nothing is measured while it is open, so ย่อข้อความ cannot vanish', () => {
  assert.match(common, /if \(whole \|\| !el \|\| open\) return undefined;/);
  // `open` is in the dependency list so closing it measures again — a paragraph
  // whose text changed while it was open must not keep a stale answer.
  assert.match(common, /\}, \[children, open, lines, whole\]\);/);
});

// ── where the control sits, and what it is made of ──────────────────────────

test('…อ่านต่อ rides the end of the last line, and ย่อข้อความ sits under the block', () => {
  /*
   * It was a link on a line of its own until 2026-09-07, which put it adrift
   * above the text on the round where nothing was shown at all. Closed, it now
   * covers the ellipsis the clamp draws, so the cut and the way past it are one
   * gesture; open, it goes back into the flow at the foot of the block, which
   * is where the eye is when the reading finishes.
   */
  assert.match(css, /\.disclosure\.at-tail \{ position: relative; \}/);
  const tail = css.match(/\.disclosure\.at-tail \.disclosure-more \{[^}]*\}/)?.[0];
  assert.ok(tail, '.disclosure.at-tail .disclosure-more หายไป');
  assert.match(tail, /position: absolute; right: 0; bottom: 0;/);
  // The fade is `--card` at zero alpha and not `transparent`, which fades
  // through grey in some engines. Everything folded sits on `--card`.
  assert.match(tail, /linear-gradient\(to right, var\(--card-fade\), var\(--card\)/);
  assert.match(css, /\.disclosure\.at-tail \.disclosure-more::before \{ content: '… ';/);
  // and the class is only on the clamped-and-closed state
  assert.match(common, /className=\{`disclosure\$\{tail \? ' at-tail' : ''\}`\}/);
});

test('the control is the brand green, a size under the text it opens', () => {
  const more = css.match(/\.link\.disclosure-more \{[^}]*\}/)?.[0];
  assert.ok(more, '.link.disclosure-more หายไป');
  // 12px medium — `.link` gives it `var(--green-text)` and this narrows the
  // size and the leading. 1.7 is the paragraph's own, so the button sits on the
  // same rhythm as the line it rides.
  assert.match(more, /font: 500 12px\/1\.7 var\(--sans\);/);
  assert.match(css, /\.link \{[^}]*color: var\(--green-text\);/);
});

// ── it says what it is, to a reader who cannot see it ───────────────────────

test('the control is a disclosure and names the paragraph it opens', () => {
  assert.match(common, /aria-expanded=\{open\}/);
  assert.match(common, /aria-controls=\{id\}/);
  // The id is the body's own, minted per instance: a dozen of these can be on
  // one page.
  assert.match(common, /const id = React\.useId\(\);/);
  // `Tag`, not `<p>`: two cards explain themselves in bullets, and a `<ul>`
  // inside a `<p>` is markup the browser takes apart.
  assert.match(common, /<Tag\r?\n\s*id=\{id\}/);
  assert.match(common, /as: Tag = 'p'/);
});

test('a dozen buttons reading อ่านต่อ are not a dozen identical buttons', () => {
  // `of` is the question the paragraph belongs to. The word on screen stays
  // อ่านต่อ — beside the paragraph it explains itself — and the accessible name
  // carries the half a reader by ear cannot get from position.
  assert.match(common, /aria-label=\{of \? `\$\{open \? less : more\} — \$\{of\}` : undefined\}/);
});

test('the two words say which direction they go', () => {
  // ย่อ alone is what บันทึกระบบ's four cards say when they close a LIST of
  // rows; this one closes a paragraph and says so, because the two controls can
  // be a thumb's width apart on ประวัติการแก้ทะเบียน.
  assert.match(common, /more = 'อ่านต่อ', less = 'ย่อข้อความ'/);
  assert.match(read('components/LogSystem.jsx'), /\{all \? 'ย่อ'/);
});

// ── paper has no button to press ────────────────────────────────────────────

test('printing unfolds every paragraph and drops the control', () => {
  const print = css.slice(css.indexOf('@media print {'));
  assert.match(
    print,
    /\.disclosure-body\.clamp, \.disclosure-body\.clamp-whole \{ display: block; -webkit-line-clamp: none;/,
  );
  assert.match(print, /\.disclosure-more \{ display: none !important; \}/);
});

// ── where it is used, and why only there ────────────────────────────────────

test('a policy row is cut by CONTENT: the answer stands, everything else folds', () => {
  /*
   * THE THIRD RULE THIS PAGE HAD IN A DAY, and the one that is about WHERE the
   * cut falls rather than how many lines are left standing. A row shows its
   * question and ค่าที่ใช้อยู่ — what the rule is set to, in the dropdown's own
   * words — and nothing else. What the question means, what each option is for,
   * and where the value came from are one fold under that line.
   *
   * It had TWO folds before, one either side of that sentence, so a reader met
   * two อ่านต่อ per row before reaching the line most visits are for.
   */
  const row = admin.slice(admin.indexOf('<div className="policy-row-q">'), admin.indexOf('<div className="policy-row-a">'));
  // the answer line first, and outside the fold
  assert.ok(
    row.indexOf('<PolicyReading') < row.indexOf('<Disclosure'),
    'ค่าที่ใช้อยู่ ต้องอยู่เหนือรอยพับ ไม่ใช่ในนั้น',
  );
  assert.match(admin, /ค่าที่ใช้อยู่: <strong>\{item\.reading\}<\/strong>/);
  // ONE fold in the row, and the three things behind it
  assert.equal((row.match(/<Disclosure\b/g) || []).length, 1, 'แถวหนึ่งต้องมีรอยพับเดียว');
  const fold = row.slice(row.indexOf('<Disclosure'), row.indexOf('</Disclosure>'));
  assert.match(fold, /\{f\.hint && <div className="hint policy-help">\{f\.hint\}<\/div>\}/);
  assert.match(fold, /\{f\.optionHints && \(/);
  assert.match(fold, /<PolicySource key=\{u\.id\} item=\{u\} \/>/);
  // and a row with nothing behind its answer draws no control at all
  assert.match(admin, /const detail = Boolean\(\r?\n\s*f\.hint \|\| f\.optionHints/);
  assert.match(row, /\{detail && \(\r?\n\s*<Disclosure as="div" lines=\{0\}/);
});

test('the fold on that page is answering a real length', () => {
  /*
   * The evidence for the change, kept where it can go stale loudly. If every
   * hint on นโยบายการคำนวณ is ever short enough to fit two lines, the fold has
   * stopped earning its place and this is the line that says so.
   */
  const fields = admin.slice(admin.indexOf('const POLICY_FIELDS = ['));
  const hints = [...fields.matchAll(/hint: ((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+),/g)]
    .map((m) => m[1].match(/'(?:[^'\\]|\\.)*'/g).join('').replace(/'\s*'/g, '').length);
  assert.ok(hints.length >= 8, `มีคำอธิบายใต้ข้อ ${hints.length} ข้อ`);
  assert.ok(
    Math.max(...hints) > 400,
    `คำอธิบายที่ยาวที่สุดเหลือ ${Math.max(...hints)} ตัวอักษร — สั้นพอจะไม่ต้องพับแล้ว`,
  );
});

test('what somebody is DECIDING on keeps four lines, not two', () => {
  /*
   * Two lines is for text that explains a control; four is for text a reader is
   * about to act on, where a fold at two would be a press on a sentence they
   * had not finished. รายละเอียดงานที่ขอ OT is what อนุมัติ is being pressed
   * about — 500 characters of it, see `description` on the model.
   *
   * IT WAS TWO SITES UNTIL 2026-09-07. ที่มาของค่าที่ใช้อยู่ was the other, and
   * it went into the policy row's single fold when that page started cutting by
   * content: the note is still never summarised and still sits under the value
   * it explains, and the value being signed for is still on the line above,
   * outside the fold. What it stopped having is a second control of its own.
   */
  assert.match(common, /<Disclosure className="reason-text" lines=\{4\}/);
  assert.match(read('src/models/OtEntry.js'), /description: \{[^}]*maxlength: 500/);
  assert.doesNotMatch(admin, /<Disclosure[^>]*policy-open-note/, 'ที่มาของค่าที่ใช้อยู่ ยังมีปุ่มของตัวเอง');
  assert.match(admin, /<div className="hint policy-open-note">/);
  assert.match(admin, /function PolicySource\(\{ item \}\)/);
});

test('ซ่อนทั้งหมด is for the two cards that explain themselves in bullets', () => {
  /*
   * A `-webkit-box` cut through a `<ul>` takes the markers with it, and two
   * bullets of six preview nothing. Both of these are a manual for a FILE
   * prepared somewhere else — a roster in Excel, a .txt off the scanner — read
   * once by whoever prepares it and furniture on every visit after.
   */
  const zeros = components
    .flatMap((n) => [...sourceOf(`components/${n}`).matchAll(/<Disclosure([^>]*)lines=\{0\}([^>]*)>/g)]
      .map((m) => `${n}${m[1]}${m[2]}`.replace(/\s+/g, ' ')));
  assert.equal(zeros.length, 4, `มี lines={0} อยู่ ${zeros.length} ที่`);
  const lists = zeros.filter((z) => /as="ul"/.test(z));
  assert.equal(lists.length, 2, 'ลิสต์บุลเล็ตที่พับทั้งก้อนต้องมีสองที่');
  /*
   * The other two are both on นโยบายการคำนวณ and both hide something a preview
   * cannot preview. One is a policy ROW, which shows its question and
   * ค่าที่ใช้อยู่ and folds everything it is not answering. The other is the
   * banner's ตรึงไว้เท่ากับค่าตั้งต้น list, which is a row of chips — two lines
   * of chips is not a summary of five, it is four of them and a cut edge.
   */
  assert.deepEqual(
    zeros.filter((z) => !/as="ul"/.test(z)).map((z) => z.split(' ')[0]),
    ['AdminView.jsx', 'AdminView.jsx'],
  );
});

test('with nothing showing, the control is unconditional', () => {
  /*
   * A `display: none` box reports scrollHeight and clientHeight of 0, so the
   * subtraction would answer "nothing is hidden" — and the one press that
   * reaches the text would never be drawn. So the measurement is skipped and
   * the answer is seeded true.
   */
  assert.match(common, /const whole = !\(lines > 0\);/);
  assert.match(common, /const \[over, setOver\] = React\.useState\(whole\);/);
  // The cut is still the stylesheet's, for the same reason the clamp is.
  assert.match(css, /\.disclosure-body\.clamp-whole \{ display: none; \}/);
  assert.match(common, /clamp\$\{whole \? ' clamp-whole' : ''\}/);
});

// ── and the two kinds of text that are never folded ─────────────────────────

test("a card's subtitle is drawn in full, on every screen in the app", () => {
  /*
   * FOLDED FOR AN HOUR ON 2026-09-07, ACROSS NINE COMPONENTS, AND WITHDRAWN.
   * The grey line under a heading is two or three lines and folds nothing worth
   * a press; what it bought was a screen that opened on a heading and the word
   * อ่านต่อ. The list is by NAME rather than a count, so a subtitle that grows
   * a fold again fails here saying which screen did it.
   */
  const users = components.filter((n) => /<Disclosure\b/.test(sourceOf(`components/${n}`))).sort();
  assert.deepEqual(users, ['AdminView.jsx', 'ScanImport.jsx', 'common.jsx']);
});

/*
 * THE ONE ALERT ALLOWED TO FOLD, BY NAME.
 *
 * The rule is not "alerts are special", it is what an alert usually SAYS: what
 * a press is about to do, or what one just did. A reader who has to open that
 * first is a reader who signs without it, and `UnrecordedPolicy` is the shape
 * that shows why — a warning with a button in it, whose folded paragraph would
 * be the reason the button exists.
 *
 * `LivePolicy` says nothing about a press. Its alarm — the heading, the line
 * under it, and a chip per value this installation runs that the program does
 * not ship — is never folded; what is, is the OTHER half, the values stored at
 * the same figure the program ships today. Nothing is wrong about those, and
 * they matter on the day a release moves a default and this installation does
 * not follow it.
 *
 * A name added to this list is a decision, not a fix for a failing case.
 */
const ALERTS_THAT_MAY_FOLD = ['LivePolicy'];

test('nothing inside a ConfirmDialog is folded, and only one Alert is', () => {
  /*
   * The scan is crude on purpose: any `<Disclosure` between an opening tag and
   * its closing one counts, whatever the nesting in between.
   */
  for (const f of components) {
    const src = sourceOf(`components/${f}`);
    for (const tag of ['ConfirmDialog', 'Alert']) {
      let at = 0;
      for (;;) {
        const open = src.indexOf(`<${tag}`, at);
        if (open < 0) break;
        const close = src.indexOf(`</${tag}>`, open);
        at = open + 1;
        if (close < 0 || !src.slice(open, close).includes('<Disclosure')) continue;
        const owner = [...src.slice(0, open).matchAll(/\nfunction (\w+)\(/g)].pop()?.[1];
        assert.ok(
          tag === 'Alert' && ALERTS_THAT_MAY_FOLD.includes(owner),
          `components/${f}: ${owner} พับข้อความที่อยู่ใน <${tag}> ไว้หลัง อ่านต่อ`,
        );
      }
    }
  }
});

test('the alert that folds keeps its alarm outside the fold', () => {
  const live = admin.slice(admin.indexOf('function LivePolicy(')).split(/\r?\nfunction /)[0];
  const foldAt = live.indexOf('<Disclosure');
  assert.ok(foldAt > 0, 'LivePolicy ไม่มีรอยพับแล้ว');
  // the count, the one-line summary and every chip stand above it …
  assert.ok(live.indexOf('มีการปรับแต่งค่าจากโปรแกรมเดิม') < foldAt, 'หัวข้อถูกพับลงไปด้วย');
  assert.ok(live.indexOf('ระบบกำลังใช้งานค่าที่ถูกแก้') < foldAt, 'บรรทัดสรุปถูกพับลงไปด้วย');
  assert.ok(live.indexOf('{moved.map((d) => (') < foldAt, 'ชิปของค่าที่ต่างถูกพับลงไปด้วย');
  // … and what is behind it is the half that is not a warning
  assert.match(live.slice(foldAt), /ตรึงไว้เท่ากับค่าตั้งต้นวันนี้/);
  assert.match(live, /more="ดูรายละเอียดเพิ่มเติม"\r?\n\s*less="ซ่อนรายละเอียด"/);
  // the warning next door has a button in it and is not folded at all
  const unrecorded = admin.slice(admin.indexOf('function UnrecordedPolicy(')).split(/\r?\nfunction /)[0];
  assert.match(unrecorded, /บันทึกกฎปัจจุบันเป็นเวอร์ชันใหม่/);
  assert.ok(!unrecorded.includes('<Disclosure'), 'คำเตือนที่มีปุ่มอยู่ในนั้น ไม่ควรถูกพับ');
});

test('an override is a chip, and the ones that move hours say so in words', () => {
  /*
   * Colour is not a thing a reader by ear or without it can act on, so the
   * amber chips carry the sentence too. The quiet ones carry nothing: the half
   * that is marked is the half that matters.
   */
  const live = admin.slice(admin.indexOf('function LivePolicy(')).split(/\r?\nfunction /)[0];
  assert.match(live, /className=\{`chip \${d\.arithmetic \? 'edited' : 'muted'}`\}/);
  assert.match(live, /\{d\.arithmetic && ' · มีผลต่อชั่วโมง'\}/);
  // The chip's label is the rule's own, so it cannot drift from the row it is
  // about; the values stay raw because the option labels here are sentences.
  assert.match(live, /\{CHANGE_LABEL\[d\.key\] \|\| d\.key\}: \{JSON\.stringify\(d\.from\)\}/);
  // and a chip holding a 46-character rule name has to wrap inside itself
  assert.match(css, /\.policy-diffs \{ display: flex; flex-wrap: wrap;/);
  assert.match(css, /\.policy-diffs \.chip \{ white-space: normal; \}/);
});

test('a live figure is not an explanation, and is left on the screen', () => {
  /*
   * The lines that report what the screen FOUND — how many files of the four
   * arrived, how many rows were not counted — say nothing about how the screen
   * works and everything about this month. Folding one hides the answer behind
   * the question.
   */
  assert.match(sourceOf('components/ScanImport.jsx'), /<div className="hint" style=\{\{ margin: '2px 0 0' \}\}>/);
  assert.match(sourceOf('components/HrView.jsx'), /<div className="hint">\r?\n\s*ไม่นับ \{data\.supersededCount\}/);
  assert.match(
    sourceOf('components/HrEntries.jsx'),
    /<div className="hint" style=\{\{ marginTop: 6 \}\}>\r?\n\s*ซ่อน \{replacedCount\}/,
  );
});

// ── one clamp, in one place ─────────────────────────────────────────────────

test('no screen grows a clamp of its own', () => {
  // A second line-clamp is a second answer to "how much of this is shown", and
  // the one on `.disclosure-body` is the one with a button under it. A clamp
  // without one hides text with no way to reach it.
  // Two: the rule that clamps, and the one in @media print that undoes it.
  const rules = [...css.matchAll(/(-webkit-)?line-clamp:/g)];
  assert.equal(rules.length, 2, 'มี line-clamp มากกว่าที่ .disclosure-body.clamp กับบล็อกพิมพ์ใช้');
  for (const f of components) {
    assert.doesNotMatch(
      read(`components/${f}`),
      /WebkitLineClamp|lineClamp/,
      `components/${f} หนีบบรรทัดเองด้วย inline style`,
    );
  }
});
