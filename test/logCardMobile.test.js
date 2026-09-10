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
/** Line endings normalised before anything below reads a character of this.
    The machine this is developed on checks the repo out CRLF (see the note in
    `.gitattributes`); the Linux box that serves it checks the same commit out
    LF. An assertion written with `\n` misses every multi-line match on the
    first, one written with `\r\n` misses them on the second, and in both
    cases the file under test is correct to the character. Normalising is what
    makes the assertion about the CSS instead of about the checkout — the same
    thing test/adminApproval.test.js and test/modalScrollFrame.test.js do. */
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8').replace(/\r\n/g, '\n');
const jsx = readFileSync(join(ROOT, 'components/LogSystem.jsx'), 'utf8').replace(/\r\n/g, '\n');

/** The log's own phone block — the last `@media (max-width: 860px)` in the file. */
function phoneBlock() {
  const start = css.lastIndexOf('@media (max-width: 860px) {');
  assert.ok(start > 0, 'บันทึกระบบ lost its phone block');
  const end = css.indexOf('\n}\n', start);
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

test('the two buttons are on the filter bar, and take a thumb-sized line', () => {
  /* ⚠ `.log-actions` IS DELETED — 2026-09-10.

     It was a `.row` UNDER the filters, and at this width it stacked its two
     buttons full width with 10px between them and 20 under, so the pair did not
     read as the first row of the log. All of that was right while the filters
     were a `.form-grid`.

     The filters are `.queue-tools` now — the app's one filter bar, asked for as
     *"ปรับให้เป็นรูปแบบเดียวกันทั้ง app"* — and the pair is INSIDE it wearing
     `.compliance-actions`, which is what การใช้สิทธิ์พิเศษ (the fifth tab of
     this same screen) had been using for the same two buttons all along. Two
     tabs of one screen answering one question two ways is what that round was
     reported over.

     SO WHAT IS PINNED IS THE SAME PROPERTY THROUGH THE SHARED CLASS: the pair
     takes the width and a 44px target, and it is not a row of its own hanging
     over the table. The gap under them is the bar's own bottom padding now —
     what separates every filter bar in this app from what it filters. */
  /* READ WITH THE PROSE TAKEN OUT. The stylesheet still SAYS `.log-actions` —
     the deleted rule left a note where it stood, which is how this repo records
     a removal — and a bare `includes` here would match that note and fail on
     the very sentence explaining why the rule is gone. AGENTS.md names this
     exact trap; it has caught assertions in this suite three times. */
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.log-actions\s*[,{]/.test(rules), '.log-actions กลับมาแล้ว — ปุ่มหลุดออกจากแถบตัวกรอง');
  const narrow = css.slice(css.indexOf('@media (max-width: 560px) {', css.indexOf('.queue-tools .compliance-actions {')));
  const block560 = narrow.slice(0, narrow.indexOf('\n}\n'));
  assert.match(block560, /\.queue-tools \.compliance-actions \{[^}]*width: 100%/);
  assert.match(block560, /\.queue-tools \.compliance-actions \.btn \{[^}]*min-height: 44px/);
  const bar = jsx.slice(jsx.indexOf('<div className="queue-tools" style={{ marginBottom: 12 }}>'));
  const upToTable = bar.slice(0, bar.indexOf('{error &&'));
  assert.ok(upToTable.includes('ดาวน์โหลด CSV ตามตัวกรอง'), 'ปุ่มดาวน์โหลดไม่ได้อยู่ในแถบตัวกรอง');
  assert.ok(upToTable.includes('ล้างตัวกรองทั้งหมด'), 'ปุ่มล้างตัวกรองไม่ได้อยู่ในแถบตัวกรอง');
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

test('การกระทำ stacks, and mostly has one thing to stack', () => {
  // A badge and the words beside it never read as two things here: both are
  // Thai, Thai puts no space between words, and the pair is almost always the
  // same phrase twice. Measured three times at 8px apart and reported as
  // overlapping every time — it was never a distance.
  const block = phoneBlock();
  assert.match(block, /\.log-v \.log-act \{\s*flex-direction: column; align-items: flex-end; gap: 4px;/);
  assert.match(block, /\.log-act \.chip \{ flex: none; \}/);
  // The words are not printed at all where an event badge already says them —
  // EVENT_LABEL is a superset of the action on all three of login, logout and
  // login_failed, and it adds whether it worked.
  assert.match(jsx, /\{r\.event === 'request' && <span className="log-what">\{r\.action\}<\/span>\}/);
  // And the amber write badge is off the tab where every row is a write.
  assert.match(jsx, /r\.write && tab !== 'edits'/);
  // What is left can still be cut rather than wrapped.
  assert.match(block, /\.log-what \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/);
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
