import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * การใช้สิทธิ์พิเศษ บนมือถือ — the row as a card.
 *
 * Six columns, and two of them are prose: รายละเอียด is a clause and เหตุผล is
 * free text somebody typed into a box. At 360px the table did what a table
 * does with prose in a 264px card — every column squeezed to its minimum and
 * the wrap scrolled sideways, so a row was read three syllables at a time down
 * six ribbons with the two that say what happened off the right edge.
 *
 * Below 860px the same six cells are a card:
 *
 *     วันเวลา                          [ ประเภท ]
 *     ผู้กระทำ → เป้าหมาย
 *     รายละเอียด, whole
 *     เหตุผล “…”
 *
 * WHAT IS PINNED HERE IS THE LINE BREAKING, because that is what took three
 * measured attempts to get right and what comes apart silently if one
 * declaration moves. A flex container decides its lines on the items' BASE
 * sizes, before any of them is allowed to shrink:
 *
 *   · `.cmp-when` at `flex: 1 1 auto` asks for the whole datetime — 151px at
 *     360, measured — and the widest badge is 161. The two do not fit in 264,
 *     so the badge was dropped onto line 2, where it landed to the LEFT of
 *     ผู้กระทำ and read as something said about the actor.
 *   · `.cmp-when` at a basis of nought fixes that and invites ผู้กระทำ up onto
 *     line 1 in its place: 0 + a badge + a name still fits, and the datetime
 *     was crushed to one character a line down the left edge.
 *   · The empty full-width item is what ends line 1 for good. It cannot share
 *     a line with anything, so the break falls where it is put.
 *
 * The three are one mechanism. Any one of them alone is a card that has been
 * seen laying itself out wrong.
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
  assert.ok(text.includes('.cmp-table'), 'this is not the block the card is written in');
  return text;
}

/** One rule, from its selector to the end of its declarations. */
function rule(selector) {
  const block = phoneBlock();
  const at = block.indexOf(selector);
  assert.ok(at > 0, `${selector} — no such rule in the phone block`);
  return block.slice(at, block.indexOf('}', at));
}

// ── the markup the card is laid out from ────────────────────────────────────

test('every cell of the report names itself', () => {
  // The card places six cells by name. A seventh column added without a class
  // lands wherever the flex order leaves it, which is at the end of the top
  // line beside the badge.
  const table = jsx.slice(jsx.indexOf('<table className="log-table cmp-table">'));
  const rows = table.slice(0, table.indexOf('</tbody>'));
  for (const [label, cls] of [
    ['วันเวลา', 'cmp-when'], ['ประเภท', 'cmp-kind'], ['ผู้กระทำ', 'cmp-actor'],
    ['เป้าหมาย', 'cmp-target'], ['รายละเอียด', 'cmp-detail'], ['เหตุผล', 'cmp-reason'],
  ]) {
    assert.ok(
      new RegExp(`data-label="${label}"[^>]*className="[^"]*${cls}`).test(rows),
      `${label} lost its .${cls} — the phone card places this cell by that class`,
    );
  }
});

test('the wrap says what it holds at phone width', () => {
  // `.table-wrap` paints a scroll hint and the card's own ground; `card-list`
  // is what takes the hint off — there is no more table to the right — and
  // puts the cards on the page colour, so 12px between two of them reads as
  // 12px of something else rather than 12px of the same white.
  //
  // IT PINNED THE WHOLE TAG UNTIL 2026-09-08 — `<div className="table-wrap
  // card-list">` and nothing after it — which failed the day the wrap gained
  // `is-paged` and `aria-busy`, neither of which this file has an opinion
  // about. What it is here to hold is that BOTH classes are on the wrap, in
  // that order; anything else the element carries is somebody else's subject.
  assert.match(jsx, /<div className="table-wrap card-list\b/);
});

test('the arrow between ผู้กระทำ and เป้าหมาย is drawn, not printed', () => {
  // On a wide screen these are two columns under two headings, where an arrow
  // would be a stray character in the เป้าหมาย column.
  assert.match(rule('.cmp-table tbody td.cmp-target::before'), /content: '→'/);
  assert.ok(!jsx.includes('→{r.target}'), 'the arrow is being printed in the markup');
});

// ── line 1: the datetime and the badge, and nothing else ────────────────────

test('the datetime asks for no width of its own', () => {
  // At `auto` its base size is the whole string and the badge is pushed off
  // the line. At nought it takes what the badge leaves and wraps at its own
  // space — "11 ส.ค. 2569" over "09:52:06" against the widest badge, one line
  // against every other.
  assert.match(rule('.cmp-table tbody td.cmp-when'), /flex: 1 1 0; min-width: 0;/);
  // And the nowrap it carries over from the desktop column is undone, or there
  // is nowhere for it to wrap to.
  assert.match(rule('.cmp-table tbody td.cmp-when'), /white-space: normal;/);
});

test('the badge is pushed to the right edge by its own margin', () => {
  // Not `justify-content: space-between` on the row: the row holds six items
  // across four lines, and space-between would throw ผู้กระทำ and เป้าหมาย to
  // opposite edges of line 2.
  assert.match(rule('.cmp-table tbody td.cmp-kind'), /flex: 0 0 auto; margin-left: auto; text-align: right;/);
  assert.ok(!/tbody tr \{[^}]*justify-content: space-between/s.test(phoneBlock()));
});

test('an empty full-width item ends the top line', () => {
  // Without it ผู้กระทำ joins the datetime and the badge on line 1 — see the
  // note at the head of this file. It costs the card nothing: no height, and
  // its own two row gaps pulled back in.
  assert.match(
    rule('.cmp-table tbody tr::after'),
    /content: ''; order: 3; flex: 1 0 100%; height: 0; margin: -4px 0;/,
  );
});

test('the six cells are ordered around that break', () => {
  // The break is order 3: two cells before it, four after. The arrow only
  // reads as an arrow if เป้าหมาย follows ผู้กระทำ.
  const orders = ['when', 'kind', 'actor', 'target', 'detail', 'reason']
    .map((name) => Number(rule(`.cmp-table tbody td.cmp-${name}`).match(/order: (\d+)/)[1]));
  assert.deepEqual(orders, [1, 2, 4, 5, 6, 7],
    'the card no longer reads when · what · who · to whom · why');
});

// ── lines 3 and 4: the two that carry sentences ─────────────────────────────

test('รายละเอียด and เหตุผล each take a line of their own', () => {
  // A basis of the full card, so neither can be drawn up beside the name above
  // it however short it happens to be.
  assert.match(rule('.cmp-table tbody td.cmp-detail'), /flex: 1 0 100%/);
  assert.match(rule('.cmp-table tbody td.cmp-reason'), /flex: 1 0 100%/);
});

test('a Thai sentence is not broken inside a word', () => {
  // Thai is written without spaces, so a browser breaks it on a dictionary and
  // every boundary inside a compound is a legal one: wrapped greedily, the
  // detail ended a line on "…บันทึกตัวรหัส" and left "ผ่าน" alone underneath.
  assert.match(rule('.cmp-table tbody td.cmp-detail'), /text-wrap: balance/);
  // `break-word` and NOT `anywhere`: `anywhere` also counts the break when the
  // browser measures min-content, so a cell holding a sentence would report a
  // min-content width of one character and the line above it would be free to
  // take the whole card.
  assert.match(rule('.cmp-table tbody td {'), /overflow-wrap: break-word/);
});

test('a row with no reason keeps its line, and keeps it in Thai', () => {
  // "— ไม่ได้ระบุ" is the finding the amber panel above the list counts. A
  // card that simply ends early hides it.
  assert.match(jsx, /<span className="cell-sub">— ไม่ได้ระบุ<\/span>/);
  // `.cell-sub` is mono, for codes and figures read down a column, and IBM
  // Plex Mono carries no Thai at all — the digits take the mono and the
  // letters drop to whatever the system has.
  assert.match(rule('.cmp-table tbody td.cmp-reason .cell-sub'), /font: 400 12px\/1\.5 var\(--sans\)/);
});

// ── the card itself ─────────────────────────────────────────────────────────

test('the card has room at its edges, and the list none at its own', () => {
  // 15px inside, the padding `.card` takes at this width. The list's own is
  // vertical only: it shares a card with the three filter boxes above it, and
  // a side inset would put two left edges in one box.
  assert.match(rule('.cmp-table tbody tr'), /padding: 15px;/);
  assert.match(rule('.cmp-table tbody {'), /padding: 12px 0;/);
});

test('nothing about the card is declared outside the phone block', () => {
  // The report is audited from the desktop table. Every `.cmp-` rule in the
  // file belongs inside the last phone block or it is changing that table.
  const start = css.lastIndexOf('@media (max-width: 860px) {');
  assert.ok(!css.slice(0, start).includes('.cmp-'), 'a .cmp- rule is loose in the stylesheet');
});
