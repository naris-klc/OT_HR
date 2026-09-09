import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * คำขอถอนใบที่อนุมัติแล้ว — the reviewer's row, and why it is a grid.
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
 * What is pinned here is the ALLOCATION, because that is the whole of the fix
 * and it comes apart silently if one declaration moves:
 *
 *   · `minmax(0, 1fr)` on the text column, which an `auto` column is not (it
 *     sizes to its content and overflows) and a plain `1fr` is not either (it
 *     refuses to go below its minimum content width).
 *   · The figure and the buttons STACKED in a column of their own rather than
 *     ranged along the same line — half the fixed width the sentence pays for.
 *   · Below 860px they come out of the line entirely and become rows.
 *   · The two-class selector, so `display: grid` cannot be settled against
 *     `.item`'s `display: flex` by which rule happens to come later.
 *
 * And the second half of the answer, which is not one answer: single facts are
 * held together, prose is not. See the last two tests.
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

/** The row itself, markup only — not the two modals below it. */
const row = jsx.slice(jsx.indexOf('{rows.map('), jsx.indexOf('{granting &&'));

// ── the markup the row is laid out from ─────────────────────────────────────

test('every cell of the row names itself', () => {
  // The grid places its cells by name. A cell added without a class lands in
  // the next implicit row, under everything, at the full width of the grid.
  for (const cls of ['withdraw-who', 'withdraw-rest', 'withdraw-hrs',
    'withdraw-actions', 'withdraw-reason']) {
    assert.ok(row.includes(cls), `the row lost .${cls}`);
  }
  assert.match(row, /className="item withdraw-item"/);
});

test('nothing in the row is laid out by an inline style any more', () => {
  // `.item-main` records the reason: an inline style is the one thing the
  // 860px block cannot take back, and below 860px this row is a different
  // shape entirely. `flex: 1, minWidth: 0` on the text column was the
  // declaration that let it be squeezed to nought in the first place.
  assert.ok(!/style=\{\{[^}]*flex/.test(row), 'a flex is back in an inline style');
  assert.ok(!/style=\{\{[^}]*font/.test(row), 'a font is back in an inline style');
  assert.ok(!/minWidth/.test(row), 'minWidth: 0 is back on the text column');
});

// ── above 860px: three columns, and only one of them may grow ───────────────

test('the row is a grid, and it wins that against .item by specificity', () => {
  // `.item` is one class and sets `display: flex`. At one class each these
  // would tie and be settled by file order, which is not a thing to leave to
  // an edit two years from now.
  assert.match(rule(wide, '.item.withdraw-item {'), /display: grid;/);
  assert.ok(!/^\.withdraw-item \{/m.test(wide), 'a single-class rule is back and can lose the tie');
});

test('the text column takes what is left and may not be pushed below nought', () => {
  const base = rule(wide, '.item.withdraw-item {');
  assert.match(base, /grid-template-columns: auto minmax\(0, 1fr\) auto;/);
  // Two rows: the name band beside the date chip, the rest of the text under
  // it, and the buttons spanning both down the right.
  assert.match(base, /"date who {2}actions"/);
  assert.match(base, /"\. {4}rest actions"/);
  assert.match(rule(wide, '.withdraw-actions {'), /grid-area: actions;/);
  assert.match(rule(wide, '.withdraw-rest {'), /min-width: 0;/);
});

test('the date chip is centred on the NAME, not on the four-line block', () => {
  // Both cells sit in row 1 and both are centred in it, so they share the
  // row's centre line — an alignment that survives the name wrapping, which a
  // measured `margin-top` on the chip would not.
  assert.match(rule(wide, '.item.withdraw-item > .date'), /align-self: center;/);
  assert.match(rule(wide, '.withdraw-who {'), /align-self: center;/);
  // Row 2's first cell is empty, so the prose keeps the chip's indent.
  assert.match(rule(wide, '.item.withdraw-item {'), /"\. {4}rest/);
});

test('the buttons sit at the bottom of the row, under what they answer', () => {
  assert.match(rule(wide, '.withdraw-actions {'), /justify-self: end; align-self: end;/);
});

test('the row does not offer a finger it has nothing to do with', () => {
  // Every other `.item` is a link. Nothing here opens anything — the two
  // buttons are the only way in — so the pointer and the hover wash come off.
  assert.match(rule(wide, '.item.withdraw-item {'), /cursor: default;/);
  assert.match(rule(wide, '.item.withdraw-item:hover'), /background: var\(--card\);/);
});

// ── below 860px: the side column becomes rows ───────────────────────────────

test('at phone width the buttons come out of the line', () => {
  const small = rule(phone, '.item.withdraw-item {');
  assert.match(small, /grid-template-columns: auto minmax\(0, 1fr\);/);
  // The name band keeps its place beside the chip; only the decision moves.
  assert.match(small, /"date {4}who"/);
  assert.match(small, /"\. {7}rest"/);
  assert.match(small, /"actions actions"/);
});

test('the two decisions are equal halves of a full-width line, 44px tall', () => {
  // The argument `.alert-actions` makes higher in the same block: two ways out
  // of one question have to look like a pair, and 44px is what a thumb needs.
  assert.match(rule(phone, '.item.withdraw-item > .withdraw-actions'), /justify-self: stretch;/);
  assert.match(rule(phone, '.item.withdraw-item .withdraw-actions .btn'), /flex: 1 1 0; min-height: 44px;/);
});

// ── what is held together, and what is left to wrap ─────────────────────────

test('single facts are unbreakable — code, clock, figure, both labels', () => {
  // A decision whose label wraps at whatever width its row happened to leave
  // has been read wrong.
  assert.match(rule(wide, '.withdraw-actions .btn'), /white-space: nowrap;/);
  assert.match(rule(wide, '.withdraw-reason .lbl'), /white-space: nowrap;/);
  // `.nb` in the markup: the employee code is one token, and the day, the
  // clock span and WHAT IT COMES TO are one fact — the figure is what a grant
  // takes off the books, and it may not be wrapped away from its own clock.
  assert.match(row, /<span className="nb">\{e\.employee\?\.code\}<\/span>/);
  const clock = row.slice(row.indexOf('<span className="nb">\n'));
  assert.match(clock, /thaiDate\(e\.workDate\)\} · \{e\.startTime\}–\{e\.endTime\}/);
  assert.match(clock.slice(0, clock.indexOf('</span>\n')), /withdraw-hrs">\{hours\(e\.totals\?\.otHours\)\} ชม\./);
});

test('and the prose is NOT — keep-all on a Thai sentence overflows the card', () => {
  // A full name is two short runs with a space between them, so `keep-all`
  // leaves exactly one place it can come apart. เหตุผลที่ขอถอน and รายละเอียด
  // are free text somebody typed: Thai wraps by dictionary, and forbidding
  // every break inside a run pushes the sentence out through the side of the
  // card instead of wrapping it.
  assert.match(rule(wide, '.withdraw-who .nm'), /word-break: keep-all;/);
  for (const sel of ['.withdraw-reason {', '.withdraw-rest {', '.withdraw-who {']) {
    assert.ok(!/keep-all|nowrap/.test(rule(wide, sel)), `${sel} is refusing to wrap prose`);
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
  // And no chip anywhere in the row — the card's own count chip lives in the
  // heading, which is outside this slice.
  assert.ok(!/StatusChip|className="chip/.test(row), 'a status pill is back in the row');
  assert.ok(!/StatusChip/.test(jsx), 'StatusChip is imported but no longer drawn');
});

// ── MANY AT ONCE: the heading, the ceiling, and the batch ───────────────────

/**
 * Asked for on 2026-09-02: several คำขอถอน landing together.
 *
 * Three things came in with it and each is pinned below, because each one is
 * the kind that gets tidied away by somebody who does not know what it cost:
 *
 *   · the count moved INTO the heading and the chip that carried it went, so
 *     one line does not print the same figure twice;
 *   · the stack has a 400px ceiling, because this card sits above the queue
 *     somebody works every day and its height is set by how many people asked
 *     for something;
 *   · อนุมัติให้ถอนทั้งหมด exists — reversing "It is deliberately NOT
 *     batchable", which stood at the head of the component until that day —
 *     and what the old argument bought is the SHAPE of it: above two or more
 *     only, amber outline, and a box that prints every reason in full.
 */

/**
 * The component with its commentary stripped, for the three assertions below
 * that ask what the screen SAYS rather than what the file explains about what
 * it says. Both of the "and this is NOT here" tests caught their own comment
 * the first time they were run — the notes in this component quote the Thai
 * they are about, which is exactly what makes them worth keeping. Same guard,
 * and the same reason, as `hrCode` in test/birthdayCardUi.test.js.
 */
const code = jsx.replace(/\/\*[\s\S]*?\*\//g, '');

/** The card's head, from its opening tag to the first row. */
const head = jsx.slice(jsx.indexOf('<div className="card-head">'), jsx.indexOf('{rows.map('));
/** The batch dialog — everything from its guard to the end of the component. */
const batch = jsx.slice(jsx.indexOf('{grantingAll && ('));
/** The same, with the commentary out of it. */
const batchCode = code.slice(code.indexOf('{grantingAll && ('));

test('the count is in the heading, and it is printed there once', () => {
  assert.match(head, /คำขอถอนใบที่อนุมัติแล้ว \(\{rows\.length\} รายการ\)/);
  // `{n} คำขอ` in a `.chip.muted` on the right of the same line until
  // 2026-09-02. The right of the line is a button now, and a count beside a
  // count reads as two figures about different things. See the note in
  // test/birthdayCardUi.test.js, which used this file as a witness that
  // `.chip.muted` had not moved and now names three screens instead of four.
  assert.ok(!/className="chip/.test(head), 'the count chip is back beside the heading count');
});

test('อนุมัติให้ถอนทั้งหมด is drawn above two or more, and never above one', () => {
  // On a single request it would do exactly what the button on the card below
  // it does, phrased as though it did more.
  assert.match(head, /\{rows\.length > 1 && \(/);
  assert.match(head, /อนุมัติให้ถอนทั้งหมด/);
  // Amber OUTLINE. It commits nothing — it opens a list to read — and the card
  // below it holds a filled red on every row: a second filled thing in the
  // head would read as the same press said twice.
  assert.match(head, /className="btn ghost warn sm withdraw-batch"/);
  const warn = rule(wide, '.btn.ghost.warn {');
  assert.match(warn, /background: var\(--card\)/);
  assert.match(warn, /border-color: var\(--amber-line\)/);
});

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
  assert.match(batch, /rows\.map\(\(e, i\) =>/);
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
  assert.match(fn, /for \(const e of rows\) \{/);
  assert.match(fn, /await api\.post\(`\/entries\/\$\{e\._id\}\/withdraw\/decide`/);
  // What failed is said, not counted — "3 รายการไม่สำเร็จ" tells a reviewer
  // nothing they can act on, and the rows are still on the reloaded list.
  assert.match(fn, /failed\.push\(/);
  assert.match(fn, /failed\.join\(/);
  assert.match(fn, /await load\(\);/);
});

test('the stack has a 400px ceiling and scrolls inside it', () => {
  // รออนุมัติ OT is directly below this card and is worked every day. Ten open
  // requests put its first row a screen and a half down the page.
  assert.match(jsx, /<div className="withdraw-list">/);
  const list = rule(wide, '.withdraw-list {');
  assert.match(list, /max-height: 400px/);
  assert.match(list, /overflow-y: auto/);
  // A ceiling and not a "แสดงเพิ่ม": every row stays in the DOM, so Ctrl-F and
  // a screen reader's list still reach all of them.
  assert.ok(!/rows\.slice\(/.test(code), 'the list is being trimmed rather than scrolled');
});

test('the cards are tighter than an ordinary row, at both widths', () => {
  // Four pixels a row is four more rows above the scroll. Not tighter than
  // 11px: the rule between two four-line cards has to read as a gap between
  // cards rather than as an underline.
  assert.match(rule(wide, '.item.withdraw-item {'), /padding: 11px 18px;/);
  assert.match(rule(phone, '.item.withdraw-item {'), /padding: 11px 12px;/);
  // `.item`'s own 15px is untouched — every other row in the app kept it.
  assert.match(wide, /\.item \{[\s\S]{0,200}padding: 15px 18px;/);
  // And the batch button takes the whole line on a phone, at 44px.
  assert.match(rule(phone, '.withdraw-batch {'), /flex: 1 1 100%; min-height: 44px;/);
});

test('every card says which one of the list it is', () => {
  // ลำดับที่ — the number said out loud, and the only thing that tells three
  // cards apart when the same employee has asked for all three.
  assert.match(row, /<span className="withdraw-no">\{i \+ 1\}\.<\/span>/);
  assert.match(batch, /<span className="withdraw-no">\{i \+ 1\}\.<\/span>/);
  // Mono and muted: every other figure on this card is hours, and this is not
  // a figure about the request at all.
  const no = rule(wide, '.withdraw-no {');
  assert.match(no, /var\(--mono\)/);
  assert.match(no, /font-variant-numeric: tabular-nums/);
});

test('the one thing the pill said that the heading does not is kept, as prose', () => {
  // These rows are `approved` or `pending_hr`: cancelPermission opens the ask
  // at the FIRST signature, not the last. On a `pending_hr` row a grant takes
  // back a figure ฝ่ายบุคคล never confirmed, which is news — so it is said, in
  // the provenance line at the foot of the text where nothing is pressable,
  // and not as a chip beside the buttons.
  assert.match(row, /e\.status !== 'approved'[\s\S]{0,160}withdraw-unsigned/);
  assert.match(row, /ใบนี้ยังรอฝ่ายบุคคลยืนยัน/);
  assert.ok(!/chip|background/.test(rule(wide, '.withdraw-unsigned {')), 'it has been made a chip again');
});
