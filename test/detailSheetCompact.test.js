import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * รายละเอียดใบ OT บนจอมือถือ — กล่องเดียวจอเดียว.
 *
 * The sheet layout itself starts at 860px and is pinned by
 * test/modalScrollFrame.test.js: a bottom sheet, three rows, and only the
 * middle one scrolling. What is pinned HERE is the second step down — the
 * refinements that only apply under 640px, where the sheet stops being a dialog
 * on a tablet held upright and becomes the whole screen.
 *
 * The two decisions are not in this file, and that is the point of the last
 * test: their band is settled once, above, and a compaction is not allowed to
 * reach it.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');

/** Where the file's one phone block opens. Everything here is relative to it. */
function sheetBlock() {
  const outer = css.indexOf('@media screen and (max-width: 860px)');
  assert.ok(outer > 0, 'the file lost its one phone block');
  /* It closes at column 0, which is the only brace in the file that can end it
     — every rule inside is indented by at least two. */
  const end = css.indexOf('\r\n}\r\n', outer);
  assert.ok(end > outer, 'the phone block no longer closes at column 0');
  return { outer, end, text: css.slice(outer, end) };
}

/** The nested block, and only it — from its own `@media` to its closing brace. */
function phoneProper() {
  const { outer } = sheetBlock();
  const start = css.indexOf('@media (max-width: 640px) {', outer);
  assert.ok(start > outer, 'the sub-640 block was renamed or moved out of the sheet layout');
  /* Two levels of indent open it, so two levels of indent close it — the rules
     inside are at four spaces and cannot match. */
  return css.slice(start, css.indexOf('\n  }', start));
}

/**
 * INSIDE THE SHEET LAYOUT, NOT BESIDE IT.
 *
 * Every rule in the nested block is about a dialog that is already pinned to
 * the bottom edge of the screen. Opened as a top-level `@media` of its own it
 * would still apply — 640 is under 860 — and it would READ as a set of rules
 * about narrow screens in general, which is what makes somebody later move it,
 * widen it, or write a second one. Nesting says the dependency in the only
 * place a stylesheet can.
 *
 * `screen and` is the outer block's business and deliberately not repeated: a
 * print media query is evaluated against the page box, and A4 at 96dpi is 794
 * CSS pixels — under 860. The outer block already excludes paper before this is
 * ever read. See the long note over it.
 */
test('the sub-640 rules live inside the 860 sheet block', () => {
  const { outer, text } = sheetBlock();
  const inner = css.indexOf('@media (max-width: 640px) {', outer);
  assert.ok(inner > outer, 'the sub-640 block is not inside the sheet block');
  // Nested, so it is indented — a top-level block would start at column 0.
  assert.match(css.slice(inner - 3, inner), /\n {2}$/, 'the sub-640 block was un-nested');
  // Counted inside the phone block only: the file has other 640px blocks — the
  // form grid and its neighbours — that have nothing to do with the sheet.
  assert.equal(
    (text.match(/@media \(max-width: 640px\) \{/g) || []).length,
    1,
    'a second sub-640 block was opened in the sheet layout — one place, or they drift apart',
  );
});

/**
 * THE PADDING COMES IN, THE TOUCH TARGETS DO NOT.
 *
 * 12px on the head and the body, the bottom of the range asked for. Four pixels
 * off each side is eight pixels of width handed back to every block inside, and
 * at 360px that is the difference between a คำขอ answer fitting its cell and
 * breaking across two lines.
 */
test('the sheet is padded at 12 under 640', () => {
  const block = phoneProper();
  assert.match(block, /\.modal-body \{ padding: 12px 12px 14px; \}/);
  assert.match(block, /\.modal-head \{ padding: 12px; \}/);
});

/**
 * คำขอ IS TWO COLUMNS BECAUSE IT SAYS SO.
 *
 * `flex: 1 1 150px` reaches two cells to a row at 375px by arithmetic, and the
 * arithmetic has two ways to fail: a 320px screen, where two 150px cells plus
 * the hairline no longer fit and the four facts stack into four rows; and
 * `min-width: auto`, which lets เกินเพดานแผนก — every breach it found, in Thai,
 * with no spaces to break at — claim a row of its own and drag the sheet's
 * width with it.
 *
 * A 50% basis is the same intent stated rather than arrived at. It stays FLEX:
 * an odd last cell grows into its row, where a grid track would sit empty and
 * `.fact-grid`'s own background would paint that emptiness as one more cell.
 */
test('the request facts are two columns at every phone width', () => {
  const block = phoneProper();
  assert.match(block, /\.fact-grid > div \{ flex: 1 1 calc\(50% - 1px\); min-width: 0; \}/);
  // Shrinking a cell below its longest run of letters only helps if they break.
  assert.match(block, /\.fact-grid dd \{ overflow-wrap: anywhere; \}/);
  // Still flex — a grid here is the empty-track defect the base rule is written
  // against. See the note over `.fact-grid` in app/styles.css.
  assert.ok(!/\.fact-grid[^{]*\{[^}]*display: grid/.test(css));
});

/**
 * AND THE COMPACTION STOPS AT THE FOOT.
 *
 * ไม่อนุมัติ and อนุมัติ are the two most consequential presses in the app. Their
 * band's padding — the 46px targets, the 16px that keeps the pair off the edge,
 * and the safe-area insets under a home indicator and beside a notch — is
 * settled in ONE shorthand further up the phone block, and a second `padding`
 * on `.modal-foot` anywhere below silently resets all four sides.
 * test/detailModalFooter.test.js pins that from the other end; this says it
 * where the temptation is, because a block whose whole job is removing padding
 * is exactly where the foot's would go next.
 */
test('the foot keeps its own insets — no second padding under 640', () => {
  const block = phoneProper();
  assert.ok(
    !/\.modal-foot[^{]*\{[^}]*padding/.test(block),
    'the sub-640 block sets the foot padding — the safe-area insets above are wiped',
  );
});
