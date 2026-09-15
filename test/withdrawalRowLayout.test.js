import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * คำขอถอนใบที่อนุมัติแล้ว — the reviewer's row, and why the space in it is
 * DEALT OUT rather than fought over.
 *
 * ── THE BUG THIS FILE IS THE REPAIR FOR, WHICH HAS NOT CHANGED ─────────────
 *
 * Reported 2026-09-02 as "ข้อความบีบอัดตกบรรทัดเป็นแนวตั้ง". The row was five
 * things in one `.item` flex line — the date chip, the sentence being read,
 * the hours, the status chip and two buttons — and FOUR OF THE FIVE WERE
 * `flex: none`, about 430px between them. Only the middle one could give, and
 * `min-width: 0` said it could give everything. Inside a card 294px wide on a
 * phone it was drawn at its minimum content width: Thai broke between letters,
 * one or two characters to a line, and the whole of what the reviewer is meant
 * to read ran down the left of the row as a ribbon.
 *
 * ── AND WHAT CHANGED ON 2026-09-15: IT IS A TABLE NOW ──────────────────────
 *
 * Asked that day — *"ถ้าเอาไปแสดงรวมกับตาราง รออนุมัติ ได้หรือไม่"*. The two
 * piles share one card and are switched by `.queue-tabs` (pinned separately, in
 * test/queueWithdrawChips.test.js); this list became a table like the queue it
 * now sits beside.
 *
 * THE OLD ASSERTIONS WERE ABOUT A GRID AND ARE GONE WITH IT. What is pinned
 * here is the same PROPERTY in the shape that now carries it, because the
 * property is the whole of the fix and it comes apart silently either way:
 *
 *   · `table-layout: fixed` with every one-line column pinned in px, so the
 *     prose columns take what is left. In a `fixed` table a column cannot be
 *     squeezed below the width the layout deals it — which is what
 *     `minmax(0, 1fr)` was doing in the grid, and what a plain `auto` column
 *     (sizes to content, overflows) and a plain `1fr` (refuses to go below its
 *     minimum content width) each fail to do.
 *   · The table SCROLLS rather than compressing when the pinned widths and the
 *     prose do not fit — `min-width`, matched to `.queue-table`'s own floor.
 *   · Below 860px the cells come out of the row and become a card, the way
 *     `.queue-table`'s do, and the decision becomes a full-width 44px pair.
 *
 * And the second half of the answer, which is not one answer: single facts are
 * held together, prose is not. See the last two tests in that section.
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
const jsx = readFileSync(join(ROOT, 'components/WithdrawalRequests.jsx'), 'utf8').replace(/\r\n/g, '\n');

/** Everything above the phone block, and everything inside it. */
const PHONE_AT = css.indexOf('@media screen and (max-width: 860px) {');
assert.ok(PHONE_AT > 0, 'the 860px block is not where the sheet says it is');
const wide = css.slice(0, PHONE_AT);
const phone = css.slice(PHONE_AT);

/** One rule, from its selector to the end of its declarations. */
function rule(half, selector) {
  const at = half.indexOf(selector);
  assert.ok(at > 0, `${selector} — no such rule`);
  return half.slice(at, half.indexOf('}', at));
}

/** The row itself, markup only — not the three modals below it. */
const row = jsx.slice(jsx.indexOf('{rows.map('), jsx.indexOf('{granting &&'));
/** The column headings, which are the other half of the phone's labels. */
const head = jsx.slice(jsx.indexOf('<thead>'), jsx.indexOf('</thead>'));

// ── the markup the row is laid out from ─────────────────────────────────────

test('every cell of the row names its column', () => {
  // The table places its cells by the class each one wears, and the phone
  // block re-places those same cells by the same classes. A cell added without
  // one is a cell that exists at one width and not at the other.
  for (const cls of ['who-col', 'when-col', 'why-col', 'reason-col', 'asked-col', 'act-col']) {
    assert.ok(row.includes(`className="${cls}"`), `the row lost .${cls}`);
    assert.ok(head.includes(cls), `the heading lost .${cls}`);
  }
  assert.match(jsx, /<table className="withdraw-table">/);
});

test('the six headings say what the six columns are', () => {
  // Above 860px these are what name the cells; below it they are gone and the
  // two cells that need naming carry their own word. Both halves or neither.
  for (const th of ['พนักงาน', 'วันที่ · เวลา', 'รายละเอียด', 'เหตุผลที่ขอถอน', 'ผู้ขอ']) {
    assert.ok(head.includes(th), `the heading lost ${th}`);
  }
  // The decision column has no heading and must not grow one: a word over two
  // buttons is a word on every row saying what the buttons already say.
  assert.match(head, /<th className="act-col" \/>/);
});

test('nothing in the row is laid out by an inline style', () => {
  // `.item-main` recorded the reason and it outlived the layout it was written
  // for: an inline style is the one thing the 860px block cannot take back,
  // and below 860px this row is a different shape entirely. `flex: 1,
  // minWidth: 0` on the text column was the declaration that let it be
  // squeezed to nought in the first place.
  assert.ok(!/style=\{\{[^}]*flex/.test(row), 'a flex is back in an inline style');
  assert.ok(!/style=\{\{[^}]*font/.test(row), 'a font is back in an inline style');
  assert.ok(!/minWidth/.test(row), 'minWidth: 0 is back on the text column');
});

// ── above 860px: pinned columns, and the prose takes what is left ───────────

test('the table is fixed, and it scrolls rather than compressing', () => {
  const base = rule(wide, '.withdraw-table {');
  // `fixed` is what makes the pinned widths binding. `auto` would hand the
  // widths back to the content and put the ribbon back.
  assert.match(base, /table-layout: fixed;/);
  // 1032px IS `.queue-table`'s OWN FLOOR. The two tables swap under one
  // heading; a card that changed width when a chip was pressed would read as
  // the page having reloaded.
  assert.match(base, /min-width: 1032px;/);
  assert.match(rule(wide, '.queue-table {'), /min-width: 1032px;/,
    'the two tables no longer share a floor — one of them was re-measured alone');
});

test('five columns are pinned by name and exactly one is left elastic', () => {
  // EVERY PINNED COLUMN IS WRITTEN OUT, INCLUDING THE TWO THAT HAVE BARE RULES
  // FURTHER DOWN THE SHEET. `th.why-col` (150px) and `th.act-col` (258px) are
  // the defaults a queue-shaped table inherits, so a column left undeclared
  // here takes somebody else's measurement rather than a share of what is left.
  // Measured on the built app at 1440 before they were written out:
  // รายละเอียด came out at exactly 150px — the inherited figure — and
  // เหตุผลที่ขอถอน swallowed the whole remainder at 500.
  assert.match(rule(wide, '.withdraw-table th.who-col {'), /width: 190px;/);
  assert.match(rule(wide, '.withdraw-table th.when-col {'), /width: 130px;/);
  assert.match(rule(wide, '.withdraw-table th.why-col {'), /width: 170px;/);
  assert.match(rule(wide, '.withdraw-table th.asked-col {'), /width: 130px;/);
  assert.match(rule(wide, '.withdraw-table th.act-col {'), /width: 236px;/);
  // …and เหตุผลที่ขอถอน is the one that takes what is left. It is free text an
  // employee typed and the whole of what is being decided, where รายละเอียด is
  // a job description `DESCRIPTION_MAX_CHARS` has capped at 22 characters: the
  // column that grows with the card should be the one with no ceiling on it.
  assert.ok(!/\.withdraw-table th\.reason-col \{/.test(wide), 'เหตุผลที่ขอถอน has been pinned to a width');
});

test('the prose cells may be dealt a narrow share and still not overflow', () => {
  // The table-layout half deals the width out; this is the half that stops a
  // long unbroken run inside one cell from pushing the cell wider than its
  // share. Both are needed and each reads as tidy-up without the other.
  const decl = rule(wide, '.withdraw-table td.who-col,');
  for (const col of ['why-col', 'reason-col', 'asked-col']) {
    assert.ok(decl.includes(col), `${col} is out of the min-width: 0 list`);
  }
  assert.match(decl, /min-width: 0;/);
});

test('the cells are ranged from the top, not centred in the row', () => {
  // Four of the six cells are several lines and two are one. `middle` — `td`'s
  // own default in this sheet — starts each cell at a different height and the
  // row reads as six unrelated blocks.
  assert.match(rule(wide, '.withdraw-table td {'), /vertical-align: top;/);
});

test('the decision never leaves the screen when the table scrolls', () => {
  // `.queue-table td.act-col` is pinned for this reason and this table
  // inherits it: a reviewer must not have to push a table sideways to reach
  // the press the screen exists for.
  const at = wide.indexOf('.withdraw-table td.act-col {');
  assert.ok(at > 0, '.withdraw-table td.act-col — no such rule');
  // …above 860px ONLY. Below it the table is a stack of cards, and a sticky
  // cell inside one of them is a cell that follows the reader down the page.
  const opened = wide.lastIndexOf('@media (min-width: 861px)', at);
  assert.ok(opened > 0 && opened > wide.lastIndexOf('\n}\n', at),
    'the sticky decision column has escaped its 861px block');
  const decl = wide.slice(at, wide.indexOf('}', at));
  assert.match(decl, /position: sticky; right: 0;/);
  // The background has to be opaque or the rows scroll through it, and it has
  // to answer the row's own hover.
  assert.match(decl, /background: var\(--card\)/);
  assert.match(wide, /\.withdraw-table tbody tr:hover td\.act-col \{ background: var\(--green-wash\); \}/);
});

// ── below 860px: the row becomes a card ─────────────────────────────────────

test('at phone width the table stops being a table', () => {
  const base = rule(phone, '.withdraw-table {');
  assert.match(base, /display: block;/);
  // The floor has to go with it, or a 375px screen scrolls sideways by 657px.
  assert.match(base, /min-width: 0;/);
  assert.match(base, /table-layout: auto;/);
  assert.match(rule(phone, '.withdraw-table thead {'), /display: none;/);
  assert.match(rule(phone, '.withdraw-table td {'), /display: block;/);
});

test('each card places all six cells by name, and none of them is dropped', () => {
  const tr = rule(phone, '.withdraw-table tr {');
  assert.match(tr, /display: grid;/);
  // The date rides the name's line; everything else takes the full width. A
  // cell left out of the areas lands in the next implicit row, under
  // everything — which is how a fact disappears from a phone and from nowhere
  // else.
  assert.match(tr, /"who {4}when"/);
  assert.match(tr, /"why {4}why"/);
  assert.match(tr, /"reason reason"/);
  assert.match(tr, /"asked {2}asked"/);
  assert.match(tr, /"act {4}act"/);
  for (const col of ['who', 'when', 'why', 'reason', 'asked', 'act']) {
    assert.match(phone, new RegExp(`\\.withdraw-table td\\.${col}-col \\{[^}]*grid-area: ${col};`),
      `${col}-col is not placed on the card`);
  }
});

test('at the smallest widths the date comes off the name\'s line', () => {
  // `14/09/2569` over `18:00–21:00 3 ชม.` is one unbreakable fact and about
  // 128px of it, which does not shrink. Measured on the built CSS: at 390 that
  // leaves the name 162px, and at 360 it leaves 132 — seventeen pixels over
  // `นางสาวฟ้าประทาน`, the widest single name token on the live roster at
  // 115.4px. A cell one import away from being overflowed by a name is not a
  // cell to leave measured that finely, so the card goes to one column.
  const at = phone.indexOf('@media (max-width: 389px) {\n    .withdraw-table tr {');
  assert.ok(at > 0, 'the one-column fallback at 389px is gone');
  const decl = phone.slice(at, phone.indexOf('\n  }', at));
  assert.match(decl, /grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(decl, /"who" "when" "why" "reason" "asked" "act"/);
  // Ranged right only while it shares a line with the name.
  assert.match(decl, /td\.when-col \{ text-align: left; \}/);
});

test('the two decisions are equal halves of a full-width line, 44px tall', () => {
  // The argument `.alert-actions` makes higher in the same block: two ways out
  // of one question have to look like a pair, and 44px is what a thumb needs.
  assert.match(rule(phone, '.withdraw-table .withdraw-actions .btn'), /flex: 1 1 0; min-height: 44px;/);
});

test('every cell a column heading was explaining names itself instead', () => {
  // `thead` is gone at this width and takes the explanation with it —
  // docs/design.md §6.1. The two cells that are not self-evident carry their
  // own word, IN THE DOM AT BOTH WIDTHS and hidden above 860px, so the label
  // and the heading cannot drift apart. No word was invented for either: both
  // are the card's own.
  assert.match(row, /<span className="lbl">เหตุผลที่ขอถอน: <\/span>/);
  assert.match(row, /<span className="lbl">ขอโดย <\/span>/);
  const at = wide.indexOf('.withdraw-table .lbl { display: none; }');
  assert.ok(at > 0, 'the label is no longer hidden on the desktop — it repeats its own heading');
  const opened = wide.lastIndexOf('@media (min-width: 861px)', at);
  assert.ok(opened > 0 && opened > wide.lastIndexOf('\n}\n', at),
    'the label is hidden at every width, which takes it off the phone too');
});

// ── what is held together, and what is left to wrap ─────────────────────────

test('single facts are unbreakable — code, clock, figure, both labels', () => {
  // A decision whose label wraps at whatever width its row happened to leave
  // has been read wrong.
  assert.match(rule(wide, '.withdraw-actions .btn'), /white-space: nowrap;/);
  assert.match(rule(wide, '.withdraw-table .lbl {'), /white-space: nowrap;/);
  // The day, the span of it and WHAT THAT COMES TO are one cell and one line:
  // the figure is what a grant takes off the books, and it may not be wrapped
  // away from the clock it belongs to. That is also why the hours are not a
  // numeric column of their own, however much the rest of this app would give
  // them one.
  assert.match(rule(wide, '.withdraw-table td.when-col {'), /white-space: nowrap;/);
  assert.match(row, /<span className="nb">\{e\.employee\?\.code\}<\/span>/);
  const when = row.slice(row.indexOf('<td className="when-col">'));
  assert.match(when, /thaiDate\(e\.workDate\)\}/);
  assert.match(when, /\{e\.startTime\}–\{e\.endTime\}/);
  assert.match(when, /withdraw-hrs">\{hours\(e\.totals\?\.otHours\)\} ชม\./);
  assert.ok(when.indexOf('withdraw-hrs') < when.indexOf('</td>'),
    'the figure has left the cell that holds its own clock');
});

test('and the prose is NOT — keep-all on a Thai sentence overflows the cell', () => {
  // A full name is two short runs with a space between them, so `keep-all`
  // leaves exactly one place it can come apart. เหตุผลที่ขอถอน and รายละเอียด
  // are free text somebody typed: Thai wraps by dictionary, and forbidding
  // every break inside a run pushes the sentence out through the side of the
  // cell instead of wrapping it.
  assert.match(rule(wide, '.withdraw-who .nm'), /word-break: keep-all;/);
  for (const sel of ['.withdraw-who {', '.withdraw-table td.who-col,']) {
    assert.ok(!/keep-all|nowrap/.test(rule(wide, sel)), `${sel} is refusing to wrap prose`);
  }
  // …and the two prose columns are not in the nowrap rule the clock is.
  const nb = rule(wide, '.withdraw-table td.when-col {');
  for (const col of ['why-col', 'reason-col']) {
    assert.ok(!nb.includes(col), `${col} has been given nowrap`);
  }
});

// ── the two buttons, and the pill that is not a third one ───────────────────

/**
 * THE GREEN `อนุมัติ` PILL IS GONE, and this is the test that keeps it gone.
 *
 * It was `<StatusChip>` — the entry's own status, correct and true — drawn a
 * few pixels from a button reading `อนุมัติให้ถอน`. Two green-and-orange
 * objects side by side, one of them pressable, both saying อนุมัติ. Reported
 * 2026-09-02 as a duplicate button, which is exactly how it read.
 */
test('the row offers two decisions and draws no third thing that looks like one', () => {
  // The last `>` before the closing tag, not the first — `onClick={() =>` puts
  // one inside the attributes.
  const buttons = row.split('<button').slice(1).map((b) => {
    const end = b.indexOf('</button>');
    return b.slice(b.lastIndexOf('>', end) + 1, end).trim();
  });
  assert.deepEqual(buttons, ['ไม่อนุมัติการถอน', 'อนุมัติให้ถอน']);
  // Secondary then the one that moves the figure: `.ghost` is the house's
  // quiet box, `.danger` the filled warning. Not two of the same weight.
  assert.match(row, /className="btn ghost sm"/);
  assert.match(row, /className="btn danger sm"/);
  // And no chip anywhere in the row.
  assert.ok(!/StatusChip|className="chip/.test(row), 'a status pill is back in the row');
  assert.ok(!/StatusChip/.test(jsx), 'StatusChip is imported but no longer drawn');
});

test('the two grey clauses sit under the prose, never beside the buttons', () => {
  // A sentence set next to a decision is read as a third decision — which is
  // what took the green pill off this row. `.cell-sub` for the ใบ that has one
  // signature and not two; `.cell-note` for a งวด that has closed. Both are
  // things TRUE of the row rather than decisions to be made about it.
  const act = row.slice(row.indexOf('<td className="act-col">'));
  assert.ok(!/cell-note|withdraw-unsigned/.test(act), 'a sentence has moved in beside the buttons');
  assert.match(row, /className="cell-sub withdraw-unsigned">ใบนี้ยังรอฝ่ายบุคคลยืนยัน/);
  assert.match(row, /\{past\(e\) && <div className="cell-note">\{cancelCutoffQueueNote\(e, policy\)\}/);
});

// ── MANY AT ONCE: the batch, and the ceiling that went with the panel ───────

/**
 * Asked for on 2026-09-02: several คำขอถอน landing together.
 *
 * อนุมัติให้ถอนทั้งหมด exists — reversing "It is deliberately NOT batchable",
 * which stood at the head of the component until that day — and what the old
 * argument bought is the SHAPE of it: above two or more only, amber outline,
 * and a box that prints every reason in full. The BUTTON is drawn by
 * `ApprovalQueue` since 2026-09-15, because it belongs to the card's head and
 * the head is that component's; the dialog and the writes are still here, and
 * test/queueWithdrawChips.test.js pins the press and the shape of the button.
 */

/**
 * The component with its commentary stripped, for the assertions below that
 * ask what the screen SAYS rather than what the file explains about what it
 * says. Both of the "and this is NOT here" tests caught their own comment the
 * first time they were run — the notes in this component quote the Thai they
 * are about, which is exactly what makes them worth keeping. Same guard, and
 * the same reason, as `hrCode` in test/birthdayCardUi.test.js.
 */
const code = jsx.replace(/\/\*[\s\S]*?\*\//g, '');

/** The batch dialog — everything from its guard to the end of the component. */
const batch = jsx.slice(jsx.indexOf('{grantingAll && ('));
/** The same, with the commentary out of it. */
const batchCode = code.slice(code.indexOf('{grantingAll && ('));

test('there is no batch REFUSAL, and that is not an oversight', () => {
  // A refusal carries a sentence the employee reads, and one sentence cannot
  // be written to five different people at once — `refuseNote` is required on
  // the single-row path for exactly that reason. The queue makes the same
  // argument about never batching a rejection.
  assert.ok(!/ไม่อนุมัติทั้งหมด/.test(code), 'a batch refusal appeared');
  assert.ok(!/granted: false/.test(code), 'something writes a refusal without a note');
});

test('the batch box prints every reason in full — it is a list, not a count', () => {
  // The whole of what the one-at-a-time path was protecting: a reviewer who
  // has to open something to find out why they are being asked will grant on
  // the strength of having been asked. Ten at once multiplies that argument,
  // it does not weaken it.
  assert.match(batch, /batch\.map\(\(e, i\) =>/);
  assert.match(batch, /withdraw-reason[\s\S]{0,200}e\.withdrawal\?\.reason/);
  assert.match(batch, /hours\(e\.totals\?\.otHours\)/);
  // The total, and the same irreversibility warning the single-row box gives —
  // in its own words, because these entries do not share a month.
  assert.match(batch, /<Alert kind="warn">/);
  assert.match(batch, /แก้กลับไม่ได้/);
  assert.match(batch, /hours\(totalHours\)/);
  assert.ok(!/เดือนนี้/.test(batchCode), 'the batch warning says เดือนนี้ of rows from several months');
  // `wide`, because ten Thai reasons at the ordinary modal width are a wall.
  assert.match(batch, /\r?\n\s+wide\r?\n/);
});

test('the grants are written one at a time, in order, and a failure is named', () => {
  const fn = jsx.slice(jsx.indexOf('async function grantAll'), jsx.indexOf('* Nothing at all when'));
  // Not `Promise.all`: each grant cancels an entry, and a cancel moves the
  // department's cap usage and the month's totals.
  assert.ok(!/Promise\.all/.test(fn), 'the batch fires its writes at once');
  assert.match(fn, /for \(const e of batch\) \{/);
  assert.match(fn, /await api\.post\(`\/entries\/\$\{e\._id\}\/withdraw\/decide`/);
  // What failed is said, not counted — "3 รายการไม่สำเร็จ" tells a reviewer
  // nothing they can act on, and the rows are still on the reloaded list.
  assert.match(fn, /failed\.push\(/);
  assert.match(fn, /failed\.join\(/);
  assert.match(fn, /await load\(\);/);
});

/**
 * THE 400px CEILING IS GONE, AND THIS IS THE TEST THAT KEEPS IT GONE.
 *
 * `.withdraw-list { max-height: 400px; overflow-y: auto }` was right for as
 * long as this list was a panel sitting ABOVE รออนุมัติ OT: its height was set
 * by how many people happened to ask for something, and ten open requests put
 * the first row of the queue somebody works every day a screen and a half down
 * the page. The list sits BESIDE that queue now — one card, one chip each — and
 * never above it, so the reason is spent. A scrolling box inside a scrolling
 * page, kept out of habit, is what §6.1 of docs/design.md forbids.
 */
test('the list has no ceiling of its own, and still trims nothing', () => {
  assert.ok(!/\.withdraw-list/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the 400px ceiling is back — see the note above this test');
  assert.ok(!/withdraw-list/.test(code), 'the markup is back inside a scrolling box');
  // The half of it that was never about height: every row stays in the DOM, so
  // Ctrl-F and a screen reader's list still reach all of them.
  assert.ok(!/rows\.slice\(/.test(code), 'the list is being trimmed rather than drawn');
});

test('every row says which one of the list it is', () => {
  // ลำดับที่ — the number said out loud, and the only thing that tells three
  // rows apart when the same employee has asked for all three.
  assert.match(row, /<span className="withdraw-no">\{i \+ 1\}\.<\/span>/);
  assert.match(batch, /<span className="withdraw-no">\{i \+ 1\}\.<\/span>/);
  // Mono and muted: every other figure on this row is hours, and this is not
  // a figure about the request at all.
  const no = rule(wide, '.withdraw-no {');
  assert.match(no, /var\(--mono\)/);
  assert.match(no, /font-variant-numeric: tabular-nums/);
});

test('the one thing the pill said that the heading does not is kept, as prose', () => {
  // These rows are `approved` or `pending_hr`: cancelPermission opens the ask
  // at the FIRST signature, not the last. On a `pending_hr` row a grant takes
  // back a figure ฝ่ายบุคคล never confirmed, which is news — so it is said as a
  // grey clause under รายละเอียด where nothing is pressable, and not as a chip
  // beside the buttons.
  assert.match(row, /e\.status !== 'approved'[\s\S]{0,160}withdraw-unsigned/);
  assert.match(row, /ใบนี้ยังรอฝ่ายบุคคลยืนยัน/);
  assert.ok(!/chip|background/.test(rule(wide, '.withdraw-unsigned {')), 'it has been made a chip again');
});
