import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * บันทึกระบบ บนมือถือ — the row as a card.
 *
 * Under 860px every table in this app becomes a column of cards, and a cell
 * becomes a label and a value on one line. The mechanism is a float: the label
 * is a `::before` floated left, and the value's line boxes shorten around it.
 *
 * That mechanism has one hole, and this log is the screen that falls into it.
 * `.log-act` — the badge and the name of what was done — is a flex container,
 * and a flex container placed beside a float takes a BOX beside it rather than
 * shortened lines. So การกระทำ laid itself out in a half-width column with its
 * chips wrapping over three lines, while ผลลัพธ์ and ที่มา under it ran the
 * full width of the card. One card, two layouts.
 *
 * What is pinned here is the way out: for the cells that print a label, the
 * label stops floating and the row becomes flex — label, then one value box.
 * The value box is why `.log-v` exists in the markup, and the three assertions
 * about it are the ones that matter, because deleting the wrapper does nothing
 * visible on a laptop and takes the phone layout apart.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
const jsx = readFileSync(join(ROOT, 'components/LogSystem.jsx'), 'utf8');

/** The log's own phone block — the last `@media (max-width: 860px)` in the file. */
function phoneBlock() {
  const start = css.lastIndexOf('@media (max-width: 860px) {');
  assert.ok(start > 0, 'บันทึกระบบ lost its phone block');
  const end = css.indexOf('\r\n}\r\n', start);
  assert.ok(end > start, 'the phone block no longer closes at column 0');
  const text = css.slice(start, end);
  assert.ok(text.includes('.stack-table.log-table'), 'this is not the log table\'s phone block');
  return text;
}

// ── the value is one box, in the markup ─────────────────────────────────────

test('การกระทำ, ผลลัพธ์ and ที่มา each wrap their value in one box', () => {
  // A cell holding two spans — a value and the note under it — is two flex
  // items unless something holds them together, and two flex items in a
  // label/value row land side by side across the card. `.log-v` is that box.
  for (const label of ['การกระทำ', 'ผลลัพธ์', 'ที่มา']) {
    const cell = jsx.slice(jsx.indexOf(`<td data-label="${label}">`));
    const end = cell.indexOf('</td>');
    assert.ok(end > 0, `${label} — no cell found`);
    assert.match(cell.slice(0, end), /<span className="log-v">/,
      `${label} lost its .log-v wrapper — the phone card lays this cell out beside a label`);
  }
});

test('the wrapper is inert on a wide screen', () => {
  // It is in the markup for the phone only. If it ever grows a width, a float
  // or a margin outside the phone block, it is changing a layout it was not
  // written to touch.
  assert.match(css, /\.log-v \{ display: block; \}/);
});

// ── the label stops floating, and the row becomes flex ──────────────────────

test('a labelled cell is a flex row, and its label is not a float', () => {
  const block = phoneBlock();
  const cells = block.slice(block.indexOf('.stack-table.log-table tbody td:not(.log-when)'));
  assert.match(cells, /display: flex;[^}]*justify-content: space-between/,
    'the label/value row is no longer flex — .log-act will go back to a box beside the float');
  assert.match(cells, /::before \{\r?\n\s*float: none;/,
    'the label floats again, which is the layout this block exists to replace');
});

test('the value box can shrink, so a long address cannot push the card off screen', () => {
  // A flex item will not go below its min-content width unless told to, and a
  // user-agent string has nothing in it to break at. `min-width: 0` is the
  // whole guard — `overflow-wrap: anywhere` on the cell does the rest.
  assert.match(phoneBlock(), /\.log-v \{ flex: 1; min-width: 0; text-align: right; \}/);
  assert.match(css, /\.stack-table tbody td \{[^}]*overflow-wrap: anywhere/s);
});

// ── the two the user asked for by eye ───────────────────────────────────────

test('the badge sits clear of the words next to it', () => {
  // 8px on both sides of the breakpoint. The phone rule that used to be here
  // said the same thing twice; what it says now is in the one-line test at the
  // foot of this file, which is where the gap is actually load-bearing.
  assert.match(css, /\.log-act \{ display: flex;[^}]*gap: 8px/);
});

test('the card has room at its edges and between its rows', () => {
  // 16px across is what keeps a right-aligned value off the border; the 10px
  // is the space between one label/value pair and the next.
  assert.match(phoneBlock(), /\.stack-table\.log-table tbody tr \{ gap: 10px; padding: 14px 16px; \}/);
});

test('the two cells that lead the card print no label and read from the left', () => {
  const block = phoneBlock();
  assert.match(block, /td\.log-when::before,\r?\n\s*\.stack-table\.log-table tbody td\[data-label="บัญชีผู้ใช้งาน"\]::before \{ content: none; \}/);
  assert.match(block, /td\.log-when,\r?\n\s*\.stack-table\.log-table tbody td\[data-label="บัญชีผู้ใช้งาน"\] \{ text-align: left; \}/);
  // And they are the two the flex rule skips: a flex row with a label that
  // prints nothing is one item, which right-aligns the heading against nothing.
  assert.ok(block.includes(':not(.log-when):not([data-label="บัญชีผู้ใช้งาน"])'));
});

// ── the screen around the card ──────────────────────────────────────────────

test('the two buttons stack, full width, and stand off the list below', () => {
  const block = phoneBlock();
  // Side by side at `.sm` they were two 13px labels sharing 340px, and one of
  // them is ดาวน์โหลด CSV ตามตัวกรอง.
  assert.match(block, /\.log-actions \{ flex-direction: column; align-items: stretch; gap: 10px; margin-bottom: 20px; \}/);
  assert.match(block, /\.log-actions \.btn \{ width: 100%; min-height: 44px; \}/);
  // The gap under them is bigger than the gap between them, or the second
  // button reads as the first row of the log.
  const gap = Number(block.match(/\.log-actions \{[^}]*gap: (\d+)px/)[1]);
  const below = Number(block.match(/\.log-actions \{[^}]*margin-bottom: (\d+)px/)[1]);
  assert.ok(below > gap, `${below} under, ${gap} between — the pair no longer reads as a pair`);
});

test('the export is the one button on the screen that does something', () => {
  // Two ghosts side by side say neither; the filled green says "this is what
  // the screen is for", which a log is not. `.btn.outline` is the step between,
  // and it exists in the stylesheet for exactly this row.
  assert.match(jsx, /className="btn outline sm" onClick=\{download\}/);
  assert.match(css, /\.btn\.outline \{/);
});

test('the cards share a left edge with the filters above them', () => {
  // `.stack-table tbody` insets its cards by 12px, which is right when a table
  // is the whole card. This one shares a card with the filter form, so that
  // inset put two left edges in one box.
  assert.match(phoneBlock(), /\.stack-table\.log-table tbody \{ padding: 12px 0; \}/);
});

test('a path is cut at the end rather than broken across lines', () => {
  // The cell wraps anywhere — it has to, or a Thai action name runs off the
  // card — and a path has no spaces, so an id broke wherever the line ended
  // and left `d171` alone underneath reading as a separate fact.
  const block = phoneBlock();
  const rule = block.slice(block.indexOf('.stack-table.log-table tbody .log-sub.mono'));
  assert.match(rule.slice(0, rule.indexOf('}')), /white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/);
  // The device line under an IP is prose and must keep wrapping — clipping it
  // would hide the half that names the browser.
  assert.ok(!/\.log-sub \{[^}]*text-overflow/.test(css), 'every .log-sub is being clipped, not just the path');
});

test('a value and the line under it read as one group', () => {
  assert.match(phoneBlock(), /\.log-v > \* \+ \* \{ margin-top: 3px; \}/);
});

test('การกระทำ is one line: the badge, then what was done', () => {
  // Beside its label this cell has about 250px of a 360px screen, and the
  // moment a badge and a Thai verb came to more than that the badge went to
  // one line and the words to the next — one fact drawn as two. Nothing wraps
  // now: the badge keeps its size and the words are what give.
  const block = phoneBlock();
  assert.match(block, /\.log-v \.log-act \{ flex-wrap: nowrap; align-items: center; justify-content: flex-end; gap: 8px; \}/);
  assert.match(block, /\.log-act \.chip \{ flex: none; \}/);
  // `min-width: 0` first, or the item never shrinks to where the ellipsis is
  // and the group pushes out of the card instead.
  assert.match(block, /\.log-what \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/);
  // And the words are an element, so they can be the part that is cut.
  assert.match(jsx, /<span className="log-what">\{r\.action\}<\/span>/);
});

test('the label sits against the middle of the two lines it labels', () => {
  // การกระทำ is a line and the route under it. A label pinned to the top of
  // that left a gap beneath itself that read as a row with nothing in it.
  const block = phoneBlock();
  assert.match(block, /td\[data-label="การกระทำ"\] \{ align-items: center; \}/);
  // Every other cell is one line, where top and middle are the same place, and
  // they keep the `flex-start` of the rule they all share.
  assert.match(block, /td:not\(\.log-when\)[^{]*\{\s*display: flex; align-items: flex-start/);
});
