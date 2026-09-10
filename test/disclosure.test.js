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
 *   was the single named exception until 2026-09-10, when `PolicyVersionBanner`
 *   joined it on the same terms, and the shape of it is the rule: the count,
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
  /*
   * ย่อ alone is what a card closing a LIST of rows says; this one closes a
   * paragraph and says so, because the two controls can be a thumb's width
   * apart on ประวัติการแก้ทะเบียน.
   *
   * ONLY THIS COMPONENT'S OWN WORD IS ASSERTED. It read the ย่อ off
   * `components/LogSystem.jsx` as evidence of the pair until 2026-09-08, and
   * went red the afternoon somebody reworked that card — a case that fails
   * because a screen it does not own was edited is a case that costs more than
   * it proves. The distinction it exists for is in the prose above.
   */
  assert.match(common, /more = 'อ่านต่อ', less = 'ย่อข้อความ'/);
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
  // It read its value off an HR_UNCONFIRMED item until 2026-09-08 and so
  // appeared on the six rows that list covered; it reads the live policy now
  // and appears on every row that has a dropdown. `shown` and not the stored
  // value, so a change waiting in its dialog says what it is about to be.
  assert.match(admin, /<PolicyReading field=\{f\} value=\{shown\} \/>/);
  assert.match(admin, /ค่าที่ใช้อยู่: <strong>\{said\}<\/strong>/);
  // ONE fold in the row, and the three things behind it
  assert.equal((row.match(/<Disclosure\b/g) || []).length, 1, 'แถวหนึ่งต้องมีรอยพับเดียว');
  const fold = row.slice(row.indexOf('<Disclosure'), row.indexOf('</Disclosure>'));
  assert.match(fold, /\{f\.hint && <div className="hint policy-help">\{f\.hint\}<\/div>\}/);
  assert.match(fold, /\{f\.optionHints && \(/);
  // and a row with nothing behind its answer draws no control at all
  assert.match(admin, /const detail = Boolean\(f\.hint \|\| f\.optionHints\);/);
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
   * IT WAS TWO SITES UNTIL 2026-09-07 AND IS ONE AGAIN. ที่มาของค่าที่ใช้อยู่
   * was the other — 891 characters of evidence under a ยืนยัน button. It lost
   * its own control on 2026-09-07 when นโยบายการคำนวณ started cutting by
   * content, and on 2026-09-08 it went altogether with the sign-off it was
   * evidence for. Nothing on that page is signed any more, so nothing on it
   * needs four lines.
   */
  assert.match(common, /<Disclosure className="reason-text" lines=\{4\}/);
  assert.match(read('src/models/OtEntry.js'), /description: \{[^}]*maxlength: 500/);
  assert.ok(!admin.includes('policy-open-note'), 'ที่มาของค่าที่ใช้อยู่ ยังอยู่บนหน้าจอ');
  assert.ok(!admin.includes('PolicySource'), 'PolicySource ยังไม่ถูกถอนออก');
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
  // The cut is still the stylesheet's, for the same reason the clamp is: 0fr is
  // the state the class ships in, so the first paint is folded.
  assert.match(css, /\.disclosure-slide \{\r?\n\s*display: grid; grid-template-rows: 0fr;/);
  assert.match(css, /\.disclosure-slide\.open \{ grid-template-rows: 1fr; \}/);
  // A whole fold carries `clamp-whole` and NOT `clamp`. It carried both while
  // this was `display: none` and nothing was drawn either way; with the slide
  // the text is on screen for the 180ms it takes to close, and a line clamp
  // under it would truncate the paragraph on the way down.
  assert.match(common, /disclosure-body\$\{open \? '' : \(whole \? ' clamp-whole' : ' clamp'\)\}/);
});

test('the slide is a wrapper, so a folded list is still a list', () => {
  /*
   * `grid-template-rows: 0fr → 1fr` animates to a height nothing measured,
   * which is the whole difficulty — a `max-height` big enough for the longest
   * fold closes every shorter one at the wrong speed, and a measured one is
   * JavaScript deciding the geometry again. But the grid has to be an element
   * the body SITS IN: two of the three whole folds are a `<ul>`, and a list
   * told to be a grid loses its markers the way `-webkit-box` takes them.
   */
  assert.match(common, /\? <div className=\{`disclosure-slide\$\{open \? ' open' : ''\}`\}>\{body\}<\/div>/);
  assert.match(css, /\.disclosure-slide > \* \{ min-height: 0; overflow: hidden; \}/);
  /*
   * AND THE CLIP IS NOT THE WHOLE JOB. `overflow: hidden` is what makes 0fr
   * hide anything; `visibility` is what keeps folded content off the tab order
   * and out of the accessibility tree, which is what `display: none` did here
   * on its own. It leaves at the END of the closing — a 0s transition carrying
   * the slide's own delay — so nothing blinks out from under a reader mid-slide.
   */
  assert.match(css, /\.disclosure-body\.clamp-whole \{ visibility: hidden; transition: visibility 0s 180ms; \}/);
  assert.match(css, /\.disclosure-slide\.open > \.disclosure-body \{ visibility: visible; transition: visibility 0s; \}/);
  // Movement is the optional part; the fold, the button and the words are not.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\r?\n\s*\.disclosure-slide \{ transition: none; \}/);
});

// ── and the two kinds of text that are never folded ─────────────────────────

test("a card's subtitle is drawn in full, on every screen in the app", () => {
  /*
   * FOLDED FOR AN HOUR ON 2026-09-07, ACROSS NINE COMPONENTS, AND WITHDRAWN.
   * The grey line under a heading is two or three lines and folds nothing worth
   * a press; what it bought was a screen that opened on a heading and the word
   * อ่านต่อ. The list is by NAME rather than a count, so a subtitle that grows
   * a fold again fails here saying which screen did it.
   *
   * ProfileView.jsx IS THE ONE SUBTITLE THAT FOLDS, asked for on 2026-09-10:
   * เปลี่ยนรหัสผ่าน's is five lines on a phone for somebody on the issued
   * password, not two or three, and its one fact that matters to that reader
   * is repeated in the amber Alert under it. Adding a name here is a decision,
   * the same as `ALERTS_THAT_MAY_FOLD`.
   *
   * HrEntries.jsx AND PolicyVersion.jsx JOINED ON 2026-09-10, and neither is a
   * subtitle: one is the three scan-matching rules over the month's table, the
   * other the version list inside an alert (see `ALERTS_THAT_MAY_FOLD`). Each
   * is pinned to exactly one fold below.
   */
  const users = components.filter((n) => /<Disclosure\b/.test(sourceOf(`components/${n}`))).sort();
  assert.deepEqual(users, [
    'AdminView.jsx', 'HrEntries.jsx', 'PolicyVersion.jsx', 'ProfileView.jsx', 'ScanImport.jsx', 'common.jsx',
  ]);
  for (const f of ['HrEntries.jsx', 'PolicyVersion.jsx']) {
    assert.equal((sourceOf(`components/${f}`).match(/<Disclosure\b/g) || []).length, 1, `${f} พับได้ที่เดียว`);
  }
  const profile = sourceOf('components/ProfileView.jsx');
  assert.equal((profile.match(/<Disclosure\b/g) || []).length, 1, 'ข้อมูลส่วนตัวพับได้ที่เดียว คือคำอธิบายของ เปลี่ยนรหัสผ่าน');
  assert.match(profile, /<h2>เปลี่ยนรหัสผ่าน<\/h2>[^]*?<Disclosure as="div" className="hint"/);
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
 * `PolicyVersionBanner` IS THE SECOND, asked for on 2026-09-10 and on the same
 * terms. Its heading (the month mixes rule sets) and its instruction (where to
 * check or recompute) stand; what folds to one line is the list of versions
 * and their counts, which on a phone ran to three lines of ไม่ทราบเวอร์ชัน.
 *
 * A name added to this list is a decision, not a fix for a failing case.
 */
const ALERTS_THAT_MAY_FOLD = ['LivePolicy', 'PolicyVersionBanner'];

test('nothing inside a ConfirmDialog is folded, and only the named Alerts are', () => {
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
        // `export function` too — PolicyVersionBanner is exported.
        const owner = [...src.slice(0, open).matchAll(/\n(?:export )?function (\w+)\(/g)].pop()?.[1];
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
  assert.match(live, /more="ดูรายละเอียด"\r?\n\s*less="ซ่อนรายละเอียด"/);
  // the warning next door has a button in it and is not folded at all
  const unrecorded = admin.slice(admin.indexOf('function UnrecordedPolicy(')).split(/\r?\nfunction /)[0];
  assert.match(unrecorded, /บันทึกกฎปัจจุบันเป็นเวอร์ชันใหม่/);
  assert.ok(!unrecorded.includes('<Disclosure'), 'คำเตือนที่มีปุ่มอยู่ในนั้น ไม่ควรถูกพับ');

  // The second named alert, on the same terms: heading above the fold, the
  // instruction below it, and only the version list inside — cut to one line.
  const pv = sourceOf('components/PolicyVersion.jsx');
  const banner = pv.slice(pv.indexOf('export function PolicyVersionBanner('));
  const pvFold = banner.indexOf('<Disclosure');
  const pvEnd = banner.indexOf('</Disclosure>');
  assert.ok(banner.indexOf('{notice.heading}') < pvFold, 'หัวข้อของคำเตือนเวอร์ชันถูกพับลงไปด้วย');
  assert.ok(banner.indexOf('{notice.say}') > pvEnd, 'บรรทัดที่บอกให้ทำอะไรถูกพับลงไปด้วย');
  assert.match(banner.slice(pvFold, pvEnd), /<Disclosure as="div" lines=\{1\}[^>]*>\s*\{notice\.figures\}\s*$/);
});

/*
 * แสดงเพิ่ม — A LONG LIST IN A NOTICE, 2026-09-10.
 *
 * Not a fold, which is why it is allowed where `Disclosure` is not: the
 * headline and the first names always stand, and what waits for a press is
 * only the tail of a list whose length the headline has already said. Asked
 * for app-wide after พรีวิวชุด F-HR-027 opened twenty-one people into several
 * screens of amber.
 */
test('a long list in a notice shows five, then ten more a press, and can be put back', () => {
  const fn = common.slice(common.indexOf('export function useShowMore('), common.indexOf('export function ShowMore('));
  assert.match(common, /export const SHOW_MORE_FIRST = 5;/);
  assert.match(common, /export const SHOW_MORE_STEP = 10;/);
  assert.match(fn, /list\.slice\(0, shown\)/);
  assert.match(fn, /แสดงเพิ่มอีก \{Math\.min\(step, left\)\} \{unit\} \(เหลือ \{left\} \{unit\}\)/);
  assert.match(fn, /แสดงทั้งหมด/);
  assert.match(fn, /ย่อกลับ/);
  // How far it is open is state, so it goes back to the first few when the
  // list is replaced — never a count describing a list that is gone.
  assert.match(fn, /React\.useEffect\(\(\) => \{ setShown\(first\); \}, \[reset, first\]\)/);
  assert.match(css, /\.show-more > button \{/);
  assert.ok(!css.includes('.notice-more'), 'the digest-only rule outlived the shared one');
});

test('every unbounded list in a notice goes through ShowMore', () => {
  const uses = {
    'components/ApprovalQueue.jsx': ['items={capped}', 'items={failed}'],
    'components/HrView.jsx': ['items={data.birthDates.missingFor}'],
    'components/PrintForm.jsx': [
      'items={form.pending}', 'items={form.notPrinted}', 'items={form.acting}', 'items={form.hidden}',
    ],
    'components/PrintFormBatch.jsx': ['items={failed}', 'items={sheets}'],
    'components/ScanImport.jsx': [
      'items={pending.parsed.errors}', 'items={result.unknownCodes}', 'items={compare.people}',
    ],
    'components/AdminView.jsx': [
      'items={importError.lines}', 'items={pending.dates.rowErrors}', 'items={result.unsignable}',
      'items={result.errors}', 'items={result.warnings}',
    ],
  };
  for (const [file, lists] of Object.entries(uses)) {
    const src = sourceOf(file);
    for (const l of lists) assert.ok(src.includes(l), `${file}: ${l} ไม่ได้ผ่าน ShowMore`);
  }
  // The two approval dialogs both list what is over the ceiling.
  assert.equal((sourceOf('components/ApprovalQueue.jsx').match(/items=\{capped\}/g) || []).length, 2);
  // The table of hours with no owner uses the hook, above its early return.
  const unacc = common.slice(common.indexOf('export function UnaccountedHours('));
  assert.ok(
    unacc.indexOf('useShowMore(unaccounted?.entries)') < unacc.indexOf('return null'),
    'a hook after an early return is a hook on some renders and not others',
  );
  assert.match(unacc, /more\.visible\.map\(/);
  // The hard caps that dropped the rest with no way to them are gone.
  const scan = sourceOf('components/ScanImport.jsx');
  assert.ok(!/\.slice\(0, (5|12)\)/.test(scan), 'ScanImport still cuts a list with no way to the rest');
  assert.ok(!scan.includes('และอีก'), 'a "…และอีก N" nobody can open is back');
});

test('a ▲/▼ notice opens from anywhere in its frame, and folds from its heading', () => {
  // 2026-09-10, asked twice: "press the notice, not the triangle", then "press
  // anywhere inside the frame". Folded, the whole box opens it; open, only the
  // heading folds it, so the body can be read and its own buttons pressed.
  const fn = common.slice(common.indexOf('export const foldClick'));
  assert.match(fn, /^export const foldClick = \(folded, toggle, head = '\.alert-fold-row'\) => \(e\) => \{/);
  assert.match(fn, /window\.getSelection\?\.\(\)\.toString\(\)\) return;/, 'selecting text folds the notice');
  assert.match(fn, /if \(!folded && !e\.target\.closest\?\.\(head\)\) return;/, 'a tap on an open body folds it');
  assert.match(common, /onClose = null, onClick, children,/);

  for (const [file, box, button, state, fn2] of [
    ['components/PrintForm.jsx', '<Alert kind={kind} onClick=', 'className="alert-fold"', 'folded', 'toggle'],
    ['components/Delegation.jsx', '<Alert kind="info" onClick=', 'className="alert-fold"', 'noteFolded', 'toggleNote'],
    ['components/ProfileView.jsx', '<Alert kind="warn" onClick=', 'className="alert-fold"', 'warnFolded', 'toggleWarn'],
    ['components/HolidayBanner.jsx', 'onClick=', 'className="announce-fold"', 'collapsed', 'toggleFold'],
  ]) {
    const src = sourceOf(file);
    assert.ok(src.includes(`${box}{foldClick(${state}, ${fn2}`), `${file}: กดในกรอบแล้วไม่กาง`);
    // Enter on the button is a click that bubbles to the box; a handler on the
    // button too would toggle twice and appear to do nothing.
    const at = src.indexOf(button);
    assert.ok(!src.slice(at, src.indexOf('</button>', at)).includes('onClick'), `${file}: ปุ่ม ▲/▼ มี onClick ของตัวเอง`);
  }
  // The banner's heading line is `.announce-top`, not the alerts' row.
  assert.match(sourceOf('components/HolidayBanner.jsx'), /foldClick\(collapsed, toggleFold, '\.announce-top'\)/);
  assert.ok(!common.includes('foldRowClick'), 'the row-only helper outlived the box one');
});

test('the new-password table is deliberately NOT shortened', () => {
  // Every row there is a password to hand over; a row behind a press is one
  // somebody does not get.
  const issued = admin.slice(admin.indexOf('function IssuedPasswords(')).split(/\r?\nfunction /)[0];
  assert.ok(issued.length > 0);
  assert.ok(!issued.includes('ShowMore') && !issued.includes('useShowMore'));
});

test('an override is a chip, and the ones that move hours say so in words', () => {
  /*
   * ONE COLOUR ABOVE THE FOLD, AND IT IS AMBER. The chip's colour carried the
   * arithmetic flag until 2026-09-08 — amber for the values that move hours,
   * grey for the ones that do not — which put a grey chip in the banner's top
   * half that could not be told from the grey chips of ตรึงไว้เท่ากับค่าตั้งต้น
   * in its folded half: two meanings in one shade. Every chip up here is a
   * value this installation CHANGED, which is the banner's whole subject.
   *
   * Whether it moves hours is said in WORDS, which is where it had to be said
   * anyway: colour alone is not a thing a reader by ear or without it can act
   * on. The quiet ones carry nothing — the half that is marked is the half that
   * matters.
   */
  const live = admin.slice(admin.indexOf('function LivePolicy(')).split(/\r?\nfunction /)[0];
  assert.match(live, /className="chip edited"/);
  assert.doesNotMatch(live, /d\.arithmetic \? 'edited' : 'muted'/);
  assert.match(live, /\{d\.arithmetic && ' · มีผลต่อชั่วโมง'\}/);
  // …and grey is left meaning one thing: a value stored at the figure the
  // program ships today, which is what the fold holds.
  assert.match(live, /<span key=\{k\} className="chip muted">/);
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
  // The scan note folds its three RULES (2026-09-10) and not the month's count
  // under them: `เดือนนี้:` comes after the fold closes.
  const entries = sourceOf('components/HrEntries.jsx');
  const scanFold = entries.indexOf('<Disclosure as="div" of="วิธีเทียบเวลากับไฟล์สแกนนิ้ว">');
  assert.ok(scanFold > 0, 'กฎการเทียบสแกนไม่ได้พับแล้ว');
  const scanEnd = entries.indexOf('</Disclosure>', scanFold);
  assert.match(entries.slice(scanFold, scanEnd), /ตัวเลขชั่วโมงไม่ได้ถูกแก้จากไฟล์สแกน/);
  assert.ok(entries.indexOf('เดือนนี้:', scanFold) > scanEnd, 'ตัวเลขประจำเดือนถูกพับไปกับกฎ');
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
