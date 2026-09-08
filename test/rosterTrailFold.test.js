import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ประวัติการแก้ทะเบียน — every record folded down to its heading line.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG WITH THE FLAT LIST
 *
 * The section on ตั้งค่าระบบ shows EVERYBODY's roster changes at once, newest
 * first, up to the endpoint's cap — and a record that moved four fields printed
 * four `ค่าเดิม → ค่าใหม่` lines under its head. So "who touched the roster on
 * Tuesday", which is the question this section exists to answer, was answered
 * with two screens of arrows, most of them about fields nobody had asked after.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAME COMPONENT DRAWS THE POP-UP, AND THE POP-UP IS NOT FOLDED
 *
 * `TrailList` is one function with two callers: this section, and the
 * ประวัติการแก้ทะเบียน pop-up opened from one person's row. The pop-up holds
 * ONE person's trail and was opened by somebody who has already said whose
 * history they want — the diff is the whole of what they came for, and folding
 * it would put a press between a question and its answer.
 *
 * So the fold is a PROP, and it is its own prop rather than being inferred from
 * `withWho`. The two happen to agree today; they are not the same fact, and
 * tying them together would make the pop-up fold itself the day somebody
 * decided it should name the person on each line.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SLIDE IS NOT NEW CODE, AND THAT IS THE POINT
 *
 * The body is a `.disclosure-slide` holding a `.disclosure-body`, the two
 * classes `Disclosure` already uses for ซ่อนทั้งหมด. That brings the
 * `0fr → 1fr` grid row (the only way to animate to a height nobody measured),
 * the visibility handoff that keeps folded content off the tab order, the
 * `prefers-reduced-motion` rule, and the @media print block that unfolds
 * everything for paper — none of which had to be written again, and all of
 * which would have drifted if it had been.
 *
 * What is NOT reused is the control. `Disclosure` draws its own อ่านต่อ link
 * and cannot be handed another; here the whole heading is the handle.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const admin = read('components/AdminView.jsx');
const css = read('app/styles.css');

/** The same file with every comment taken out — see the note in logPanelRows. */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = strip(admin);

/** `TrailList` alone, so an assertion cannot be satisfied by another component. */
const trailList = code.slice(
  code.indexOf('function TrailList('),
  code.indexOf('\nfunction ', code.indexOf('function TrailList(') + 10),
);

// ── the fold is a prop, and only one of the two callers passes it ────────────

test('the fold is asked for at the call site, not inferred from withWho', () => {
  assert.match(code, /function TrailList\(\{\s*records, depts, empty, withWho = false, foldable = false, openByDefault = false,\s*\}\)/);
  // The pop-up passes neither, so RosterTrail keeps the flat list it had.
  const popup = code.slice(code.indexOf('function RosterTrail('), code.indexOf('function TrailList('));
  assert.match(popup, /<TrailList/);
  assert.ok(!popup.includes('foldable'), 'ป๊อปอัปประวัติของคนเดียวถูกพับไปด้วย');
  // …and the section passes it.
  const section = code.slice(code.indexOf('function RosterAudit('));
  assert.match(section, /<TrailList[\s\S]*?foldable[\s\S]*?\/>/);
});

test('a filter about a FIELD arrives open, because the answer is in the diff', () => {
  /**
   * กรองตามสิ่งที่ถูกแก้ is the one filter of the four whose answer does not
   * appear on the heading line. Somebody who has just asked for only the
   * records that changed วันเกิด is asking about the diff; answering with a
   * column of headings hides the thing they filtered for.
   *
   * The other three narrow WHO and WHAT KIND, both already on the heading, and
   * they arrive folded like every other list.
   */
  const section = code.slice(code.indexOf('function RosterAudit('));
  assert.match(section, /openByDefault=\{Boolean\(filters\.field\)\}/);
  assert.ok(!/openByDefault=\{Boolean\(filters\.(employee|action|by)\)/.test(section));
});

test('a new list lands in the state that list asked for', () => {
  /**
   * `records` is a fresh array on every fetch, so this effect runs when a filter
   * changes. Without it the ids in the old open-set keep matching whichever
   * records happen to carry them, and a list nobody has touched arrives with
   * three rows already unfolded.
   */
  assert.match(trailList, /useEffect\(\(\) => \{\s*setOpen\(openByDefault && records/);
  assert.match(trailList, /\}, \[records, openByDefault\]\);/);
});

// ── what may fold, and what may not ─────────────────────────────────────────

test('a record with nothing under its heading gets no chevron', () => {
  /**
   * A fold over nothing is a control that lies about there being more. A
   * ตั้งรหัสผ่านใหม่ changes no field, so `changes` is empty — but the sentence
   * saying the password itself was never written down IS its body, and that is
   * worth a fold. The three cases are counted together, once, so the chevron
   * and the body can never disagree about whether there is anything there.
   */
  assert.match(
    code,
    /const hasTrailDetail = \(r\) => r\.changes\.length > 0 \|\| Boolean\(r\.reason\) \|\| Boolean\(r\.passwordReset\);/,
  );
  assert.match(trailList, /const detail = foldable && hasTrailDetail\(r\);/);
  // The plain heading is still a heading — a div, not a dead button.
  assert.match(trailList, /<div className="head">\{summary\}<\/div>/);
});

test('the heading itself is the button, and it is a real one', () => {
  /**
   * The heading is what a reader is already pointing at, and a 9px glyph is a
   * target nobody hits with a thumb. A `<button>` rather than a div with an
   * onClick, so it answers to Enter and Space and announces its own state.
   */
  assert.match(trailList, /<button\s+type="button"\s+className="head trail-head"\s+aria-expanded=\{shown\}\s+aria-controls=\{`trail-\$\{r\.id\}`\}/);
  // …and what aria-controls points at exists, with the same id.
  assert.match(trailList, /id=\{`trail-\$\{r\.id\}`\}/);
});

test('the summary and the body are each written once', () => {
  /**
   * Both shapes draw the same words: a folded record and a flat one differ in
   * where the body goes, not in what it says. Written twice, the copy in the
   * branch nobody opened would be the one still printing a field after its
   * label changed — which is the reason `TrailList` is one component for two
   * screens in the first place.
   */
  assert.equal((trailList.match(/const summary = \(/g) || []).length, 1);
  assert.equal((trailList.match(/const body = \(/g) || []).length, 1);
  assert.equal((trailList.match(/className="entry-diff"/g) || []).length, 1);
  // The flat branch renders the very same body, unwrapped.
  assert.match(trailList, /\) : body\}/);
});

// ── the slide is Disclosure's, class for class ──────────────────────────────

test('the fold reuses the disclosure slide rather than growing a second one', () => {
  /**
   * A `max-height` big enough for the longest fold makes every shorter one
   * close at the wrong speed, and a measured height is JavaScript deciding the
   * geometry again. `.disclosure-slide` already solved that with a
   * `0fr → 1fr` grid row; a second answer here would be a second thing to keep
   * in step with `prefers-reduced-motion` and with @media print.
   */
  assert.match(trailList, /<div className=\{`disclosure-slide\$\{shown \? ' open' : ''\}`\}>/);
  // The body sits INSIDE the slide and carries the class the visibility handoff
  // reads — folded content stays out of the tab order and off the reading order.
  assert.match(trailList, /className=\{`disclosure-body trail-detail\$\{shown \? '' : ' clamp-whole'\}`\}/);
  // Both halves of that handoff are still in the stylesheet, unchanged.
  assert.match(css, /\.disclosure-slide \{\r?\n\s*display: grid; grid-template-rows: 0fr;/);
  assert.match(css, /\.disclosure-slide\.open > \.disclosure-body \{ visibility: visible;/);
});

test('nothing here reaches the ใบ OT history that shares .entry-history', () => {
  /**
   * `.entry-history` is drawn by `EntryHistory` in common.jsx as well — the
   * trail on a single ใบ OT — and that list is not folded. Every rule added for
   * this one hangs off a class the component writes ONLY when it folds, so the
   * shared bones are untouched.
   */
  for (const rule of [
    '.entry-history > li.foldable { gap: 0; }',
    '.entry-history .trail-head:hover { background: var(--neutral-wash); }',
  ]) {
    assert.ok(css.includes(rule), `หา ${rule} ไม่เจอ`);
  }
  // The base rules the ใบ OT history depends on are still exactly as they were.
  assert.match(css, /\.entry-history \{ list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; \}/);
  assert.match(css, /\.entry-history \.head \{ display: flex; flex-wrap: wrap; align-items: center; gap: 8px; \}/);
  // …and common.jsx has grown no fold of its own.
  assert.ok(!read('components/common.jsx').includes('trail-head'));
});

// ── the chevron ─────────────────────────────────────────────────────────────

test('one glyph turned over, read off aria-expanded', () => {
  /**
   * Rotating it is the movement the fold itself makes, at the same 180ms;
   * swapping ▼ for ▲ is two pictures with a jump between them.
   *
   * The rotation reads `aria-expanded` rather than a class of its own: the
   * attribute has to be there anyway, because a control that folds must say so
   * out loud, and a second flag beside it is a second thing that can disagree
   * with the fold.
   */
  assert.match(trailList, /<span className="fold" aria-hidden="true">▼<\/span>/);
  assert.ok(!trailList.includes('▲'), 'ยังสลับสัญลักษณ์อยู่ แทนที่จะหมุนอันเดียว');
  assert.match(css, /\.entry-history \.trail-head \.fold \{[^}]*transition: transform 180ms ease;/);
  assert.match(css, /\.entry-history \.trail-head\[aria-expanded='true'\] \.fold \{ transform: rotate\(180deg\); \}/);
  // Movement is the optional half; the fold, the hover and the glyph are not.
  const reduced = css.slice(css.indexOf('.trail-detail {'));
  assert.match(
    reduced,
    /@media \(prefers-reduced-motion: reduce\) \{\r?\n\s*\.entry-history \.trail-head,\r?\n\s*\.entry-history \.trail-head \.fold \{ transition: none; \}/,
  );
});

test('the button is reset to the line it replaces, and takes no width', () => {
  /**
   * A `<button>` brings its own font, colour, border and centred text, and
   * every one of those would redraw a row that is meant to look exactly as it
   * did. `.head` still lays it out; this only undoes the chrome.
   *
   * NO `width`. The `li` is a flex column, so a stretched child is already the
   * full width — a declared `100%` alongside the negative margins would come
   * out 16px short on the right, which is the sort of thing that looks like a
   * rounding error and is a misread of how stretch works.
   */
  const rule = css.slice(css.indexOf('.entry-history .trail-head {'));
  const head = rule.slice(0, rule.indexOf('}') + 1);
  assert.match(head, /margin: -5px -8px; padding: 5px 8px;/);
  assert.match(head, /border: 0;/);
  assert.match(head, /background: none; color: inherit; font: inherit; text-align: start;/);
  assert.match(head, /cursor: pointer;/);
  assert.ok(!/width:/.test(head), 'ปุ่มหัวข้อประกาศความกว้างเอง ทั้งที่ยืดเต็มอยู่แล้ว');
});

// ── ขยายทั้งหมด / หุบทั้งหมด ────────────────────────────────────────────────

test('one button, two words, and absent when it would do nothing', () => {
  /**
   * A list whose every record is a bare heading — a run of password resets, say
   * — has nothing to expand, and a control that presses to no visible effect is
   * worse than no control at all.
   */
  assert.match(trailList, /\{foldables\.length > 0 && \(/);
  assert.match(trailList, /\{allOpen \? 'หุบทั้งหมด' : 'ขยายทั้งหมด'\}/);
  // It reads its own label off the folds rather than keeping a flag beside
  // them, so unfolding the last folded record by hand relabels it unprompted.
  assert.match(trailList, /const allOpen = foldables\.length > 0 && foldables\.every\(\(r\) => open\.has\(r\.id\)\);/);
  // It acts on the foldable records only — a `new Set` of every record would
  // hold ids for rows with no body, and `allOpen` would then never be true.
  assert.match(trailList, /new Set\(foldables\.map\(\(r\) => r\.id\)\)/);
  // Right of the list it acts on, so it does not read as another filter beside
  // ล้างตัวกรองทั้งหมด, which sits left in its own row a few lines above.
  assert.match(css, /\.trail-tools \{ justify-content: flex-end; margin: 0 0 8px; \}/);
});

test('the phantom gap under a folded heading is gone', () => {
  /**
   * `li` spaces its children 5px apart, and a folded record's second child is a
   * grid row of zero height — which still takes the gap. 5px of nothing under
   * every heading in a list of thirty is a list that looks loosely set for no
   * reason anybody could point at. The spacing moves inside the fold, where it
   * is only paid for when there is something to space.
   */
  assert.match(css, /\.entry-history > li\.foldable \{ gap: 0; \}/);
  assert.match(css, /\.trail-detail \{ display: flex; flex-direction: column; gap: 5px; \}/);
  /**
   * AND THE SPACING IS A MARGIN ON THE FIRST CHILD, NOT PADDING ON THE BODY.
   * It shipped as `padding-top: 5px` for one build and the fold never closed:
   * measured on the built app, folded, `grid-template-rows` computed to **5px**
   * instead of 0. `min-height: 0` is what lets a `0fr` track resolve to nothing
   * and it is about the CONTENT box — padding sits outside it, so five pixels
   * of padding are five pixels the track cannot give up. The rule meant to
   * remove the phantom gap had put it straight back.
   */
  assert.match(css, /\.trail-detail > :first-child \{ margin-top: 5px; \}/);
  assert.ok(
    !/\.trail-detail \{[^}]*padding/.test(css),
    'padding บนตัว .trail-detail เองทำให้แถว 0fr ยุบไม่ลง',
  );
  assert.match(trailList, /`\$\{TONE\[r\.action\] \|\| 'off'\}\$\{detail \? ' foldable' : ''\}`/);
});
