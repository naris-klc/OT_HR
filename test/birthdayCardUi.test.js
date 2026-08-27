import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * การ์ดวันเกิดบนมือถือ — the badge, the second button, and the space between.
 *
 * Two screens carry the same rows for two different reasons: วันเกิดรอตรวจ is
 * the backlog across every month, วันเกิดของเดือนนี้ is one month with all five
 * statuses on it. Both become card lists below 860px and both were drawn so
 * quietly that the one row that is WORK read like the four that are not.
 *
 * What is pinned here is the part that is easy to undo by tidying:
 *
 *   - ต้องตรวจ has its OWN chip. It borrowed แก้ไขแล้ว's for a long time, and
 *     the day somebody restyles แก้ไขแล้ว on คิวรออนุมัติ the birthday badge
 *     must not follow it.
 *   - the stronger outline belongs to a ghost STANDING BESIDE a filled button,
 *     which is the design system's own rule, and not to every ghost on the
 *     table — ดูใบ and ยกเลิกการตรวจ are lone buttons with no primary to be the
 *     second half of.
 *   - the gap between cards only reads if the ground does. This was learnt on
 *     ตรวจสอบรายเดือน: 12px between two cards the same colour as the wrap they
 *     sit on is 12px of that colour.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const css = read('app/styles.css');
const hrView = read('components/HrView.jsx');
const queue = read('components/BirthdayQueue.jsx');
const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));

// ── the badge ────────────────────────────────────────────────────────────────

test('ต้องตรวจ wears its own chip, not แก้ไขแล้ว’s', () => {
  assert.match(hrView, /return <span className="chip due">\{label\}<\/span>;/);
  // `.chip.edited` is แก้ไขแล้ว's, on คิวรออนุมัติ, and this table no longer
  // borrows it — restyling one must not move the other.
  assert.ok(!/className="chip edited"/.test(hrView));
  assert.match(css, /\.chip\.edited \{ background: var\(--amber-bg\); color: var\(--amber\); \}/);
});

test('and it is ringed rather than merely filled', () => {
  const rule = css.slice(css.indexOf('.chip.due {'), css.indexOf('.chip.due {') + 240);
  // The INK of its family on the family's own fill, ringed in the family
  // colour. Asked for as amber-400 text, which is a dark-mode value: on this
  // chip's pale light-theme fill it measures about 1.6:1 and cannot be read.
  // `--amber-ink` goes the right way on both sides — brighter than `--amber`
  // on the dark theme, darker on the light one.
  assert.match(rule, /background: var\(--amber-bg\); color: var\(--amber-ink\);/);
  assert.match(rule, /border: 1px solid var\(--amber\);/);
  // A chip a pixel taller than the grey one above it in the same column is a
  // row that does not line up: the padding comes down by the border it gains.
  assert.match(rule, /padding: 3px 9px;/);
  // `.chip` itself is 4px 10px with no border — the pair has to stay in step.
  assert.match(css, /\.chip \{\s*display: inline-block; padding: 4px 10px;/);
});

// ── the second button ────────────────────────────────────────────────────────

test('the outline goes to the ghost that has a filled button beside it', () => {
  assert.match(
    phone,
    /\.bday-table td\.act-col \.row-actions \.btn:not\(\.ghost\) \+ \.btn\.ghost,\s*\.bmonth-table td\.act-col \.row-actions \.btn:not\(\.ghost\) \+ \.btn\.ghost \{\s*border-color: var\(--muted-2\);/,
  );
  // Both screens draw the pair the same way round — filled first — or the
  // adjacent-sibling rule above quietly matches nothing.
  for (const [name, src] of [['HrView', hrView], ['BirthdayQueue', queue]]) {
    // The two labels, each on its own line — the buttons around them.
    const filled = src.search(/^\s*บันทึก OT ให้$/m);
    const ghost = src.search(/^\s*ไม่ได้มาทำงาน$/m);
    assert.ok(filled > 0 && ghost > 0, `${name} lost one of the two buttons`);
    assert.ok(filled < ghost, `${name} draws ไม่ได้มาทำงาน first — the outline rule matches nothing`);
    // And they are the filled/ghost pair, not two of a kind.
    const pair = src.slice(filled - 400, ghost);
    assert.match(pair, /className="btn sm"/);
    assert.match(pair, /className="btn ghost sm"/);
  }
});

test('and it does not turn green when touched', () => {
  // `.btn.ghost:hover` is the app's green — right everywhere else, wrong here:
  // this is the NEGATIVE answer standing beside a filled green button that is
  // the positive one, and under a finger the two swapped voices.
  assert.match(
    phone,
    /\.btn:not\(\.ghost\) \+ \.btn\.ghost:hover:not\(:disabled\),[\s\S]{0,400}background: var\(--neutral-wash\); border-color: var\(--muted\); color: var\(--ink\);/,
  );

  // :active is in the list and is not decoration — there is no hover on a
  // phone, and on several mobile browsers :hover then sticks on the last thing
  // touched. Both states have to say the same thing.
  const rule = phone.slice(
    phone.indexOf('.btn:not(.ghost) + .btn.ghost:hover:not(:disabled)'),
    phone.indexOf('background: var(--neutral-wash); border-color: var(--muted)'),
  );
  for (const t of ['bday-table', 'bmonth-table']) {
    assert.ok(rule.includes(`.${t} td.act-col .row-actions .btn:not(.ghost) + .btn.ghost:active:not(:disabled)`),
      `${t} keeps the green under a finger`);
  }

  // The app-wide green hover is untouched — every other ghost still has it.
  assert.match(
    css,
    /\.btn\.ghost:hover:not\(:disabled\) \{ background: var\(--green-tint\);/,
  );
});

test('a lone ghost keeps the quiet border it should have', () => {
  // ดูใบ and ยกเลิกการตรวจ have no primary beside them, so there is no
  // hierarchy for them to be the second half of. They match nothing above.
  assert.match(hrView, /className="btn ghost sm"[\s\S]{0,200}ดูใบ/);
  assert.match(hrView, /className="btn ghost sm"[\s\S]{0,240}ยกเลิกการตรวจ/);
  assert.ok(
    !/\.bmonth-table td\.act-col \.btn\.ghost \{[^}]*border-color/.test(phone),
    'every ghost on the month table just got the outline, lone ones included',
  );
});

// ── the space between cards ──────────────────────────────────────────────────

test('12px between cards, on a ground a step back from them', () => {
  assert.match(phone, /\.bday-table tbody \{ display: flex; flex-direction: column; gap: 12px;/);
  assert.match(phone, /\.bmonth-table tbody \{ display: flex; flex-direction: column; gap: 12px;/);

  // AND NO FRAME ROUND THE COLUMN. `table.mini` draws a hairline round a small
  // ruled table, which is what วันเกิดของเดือนนี้ is above 860px; below it the
  // same element is a column of cards on the page's own ground, and a frame
  // round the lot is the nested layer the card round the employee list was.
  // Undone here on 2026-08-27 with that card, and found the same way — a
  // birthday card stood 13..347 on the built app where an employee card stood
  // 12..348, and the pixel each side was this border. The desktop keeps it:
  // `.mini` itself is untouched.
  //
  // THE ELEMENT IS IN THE SELECTOR, AND THAT IS THE ASSERTION. `table.mini` is
  // an element and a class, so a bare `.bmonth-table` loses to it wherever in
  // the file it sits — the first attempt shipped, was correct, was overruled,
  // and the measurement did not move by a pixel. A rule being in the bundle is
  // not a rule that wins.
  assert.match(phone, /table\.bmonth-table \{ display: block; min-width: 0; table-layout: auto; border: none; \}/);
  assert.match(css, /table\.mini \{ border: 1px solid var\(--line-soft\); \}/,
    'the hairline was taken from every mini table in the app, not from this one at this width');

  // …and the wrap that says the ground goes back. Without it the gap is the
  // card's own colour and the cards read as one block — learnt on ตรวจสอบรายเดือน.
  assert.match(queue, /<div className="table-wrap card-list">/);
  assert.match(hrView, /<div className="table-wrap card-list" style=\{\{ marginTop: 10 \}\}>/);
  assert.match(phone, /\.table-wrap\.card-list \{ background: var\(--bg\); \}/);
});

test('the folded lists under the queue are not dragged along', () => {
  // ตรวจแล้ว and ตรวจไม่ได้ sit inside a <details> as plain `mini` tables and
  // are not what anybody is deciding from.
  const fold = queue.slice(queue.indexOf('<table className="mini">'));
  assert.ok(!fold.slice(0, 200).includes('bday-table'));
});

// ── the whole status column, as one set ──────────────────────────────────────

test('all five statuses are ringed chips, each in the family it belongs to', () => {
  // Ringing only the amber one left the other four looking like a different
  // kind of object beside it, in a column that carries all five at once.
  assert.match(hrView, /<span className="chip due">/);        // ต้องตรวจ — amber, asks
  assert.match(hrView, /<span className="chip upcoming">/);   // ยังไม่ถึงวัน — blue, informs
  assert.match(hrView, /<span className="chip neutral">/);    // the two that are answered
  assert.match(hrView, /<span className="chip green">/);      // มีใบแล้ว

  const upcoming = css.slice(css.indexOf('.chip.upcoming {'), css.indexOf('.chip.upcoming {') + 200);
  assert.match(upcoming, /background: var\(--info-bg\); color: var\(--info\);/);
  assert.match(upcoming, /border: 1px solid var\(--info\);/);

  const neutral = css.slice(css.indexOf('.chip.neutral {'), css.indexOf('.chip.neutral {') + 200);
  assert.match(neutral, /background: var\(--neutral-wash\); color: var\(--muted\);/);
  assert.match(neutral, /border: 1px solid var\(--muted-2\);/);

  // Every ring is the family's own colour, never the `-line` shade the fills
  // and dividers use — that was a shade too quiet to read as a ring at 1px.
  for (const rule of [upcoming, neutral]) assert.ok(!/-line\)/.test(rule));

  // Same padding as `.chip.due`, or a column of them does not line up.
  for (const rule of [upcoming, neutral]) assert.match(rule, /padding: 3px 9px;/);
});

test('ยังไม่ถึงวัน is blue because it is information, not work', () => {
  // The date has not arrived, there is no scan record to check against, and
  // there is nothing anybody can do about it today. Only ต้องตรวจ is work.
  const cell = hrView.slice(hrView.indexOf('function BirthdayStatusCell'), hrView.indexOf('function BirthdayRowActions'));
  assert.match(cell, /UPCOMING[\s\S]{0,120}chip upcoming/);
  assert.match(cell, /return <span className="chip due">/);
});

test('the flat grey chip four other screens use did not move', () => {
  // `.chip.neutral` is a new class, not a change to `.chip.muted`.
  assert.match(css, /\.chip\.muted \{ background: var\(--neutral-wash\); color: var\(--muted\); \}/);
  for (const f of ['components/ApprovalQueue.jsx', 'components/DepartmentView.jsx',
    'components/WithdrawalRequests.jsx', 'components/BirthdayQueue.jsx']) {
    assert.match(read(f), /className="chip muted"/, `${f} lost its plain chip`);
  }
  // …and no birthday status is still wearing it.
  assert.ok(!/chip muted/.test(hrView));
});

// ── the search strip the list starts under ──────────────────────────────────

/**
 * IT IS NOT A BAR ANY MORE, AND IT IS NOT FROSTED EITHER.
 *
 * This test read "the bar over the list is opaque, and is NOT blurred" and
 * pinned `position: sticky; top: 62px; z-index: 30` with a forced `--bg` fill.
 * `.month-find` stopped being sticky on 2026-08-26 — it was covering the first
 * card of the list, and the pager had already cut the list it was written for
 * from nine screens to five cards. See test/monthSearch.test.js, which owns
 * that change.
 *
 * AND IT IS NOT A FILL EITHER, SINCE 2026-08-27. The `--bg` fill this pinned
 * was there to cover the CARD the row was sitting in; the row is not in a card
 * any more — it sits on the page, which is `--bg` — so painting it is painting
 * the ground its own colour. test/monthSearch.test.js owns that move.
 *
 * WHAT SURVIVES HERE IS THE HALF THAT WAS NEVER ABOUT STICKINESS OR ABOUT A
 * CARD: no `backdrop-filter`, ever, on this element. A backdrop-filtered
 * element is composited as its own layer and a composited layer stops obeying
 * z-index — which is the bug `body.has-dialog .appbar` exists to undo, where
 * the app bar and the phone's nav painted themselves over an open sheet.
 *
 * test/modalScrollFrame.test.js counts the carriers and allows exactly two.
 * This assertion is the same fact from this end, so the reason survives next to
 * the element somebody would be tempted to frost.
 */
test('the search row carries no blur, no sticky and no fill of its own', () => {
  const at = phone.indexOf('.month-find {');
  const rule = phone.slice(at, phone.indexOf('\n  }', at))
    .replace(/\/\*[\s\S]*?\*\//g, '');

  assert.ok(!/backdrop-filter/.test(rule), 'the search strip grew a blur');
  assert.ok(!/position:\s*sticky/.test(rule), 'the search box is stuck over the cards again');
  assert.ok(!/background/.test(rule), 'the row is painting the page its own colour again');
});

// ── the badge in the corner ──────────────────────────────────────────────────

/**
 * วันเกิดของเดือนนี้ used to put the status six lines down the card, indented to
 * the value column of the labelled block as if it were one more labelled fact
 * with its label rubbed out. On a screen whose whole job is "which of these
 * people still needs answering", the amber chip was a card-length away from the
 * name it answers for. It is now on the name's line, in the corner, where
 * วันเกิดรอตรวจ has kept its ค้างมาแล้ว pill all along.
 *
 * The old objection is still in the stylesheet and still true — the status here
 * is a chip AND a sentence, and a sentence in a corner takes the width back off
 * the name. What changed is that the two are split rather than kept together at
 * the bottom: chip in the corner, sentence full width under the name. That is
 * what `display: contents` on the cell buys, and it is why the sentences have to
 * be ONE child and not two.
 */

test('the status chip sits in the card’s top-right, on the name’s line', () => {
  const tr = phone.slice(phone.indexOf('.bmonth-table tr {'), phone.indexOf('table.bmonth-table td {'));
  // THREE TRACKS SINCE THE SECOND COMPACTION on 2026-08-27, and it read
  // `minmax(0, 1fr) auto` before it. The chip keeps the LAST one, which is the
  // only thing this test is about; what changed under it is that แผนก now sizes
  // the first and บริษัท takes the middle — see the next test.
  assert.match(tr, /grid-template-columns: auto minmax\(0, 1fr\) auto;/);
  assert.match(tr, /"who\s+who\s+state"/);
  // The rows that still START at the card's left edge — the inset this card was
  // rebuilt to remove. `co` and `hrs` are not in this list: they are the two
  // cells deliberately not at the left edge, sharing แผนก's row.
  for (const area of ['note', 'date', 'dept', 'act']) {
    assert.ok(new RegExp(`"${area}\\s`).test(tr),
      `${area} no longer starts at the card's left edge`);
  }

  const chip = phone.slice(phone.indexOf('.bmonth-table td.state-col > .chip {'), phone.indexOf('.bmonth-table td.state-col > .state-note'));
  assert.match(chip, /grid-area: state; justify-self: end; align-self: start;/);
});

/**
 * The card got about a third shorter on 2026-08-27, asked for as "ปรับ Layout
 * ส่วนรายชื่อวันเกิดพนักงานให้กระชับขึ้น … เพื่อประหยัดพื้นที่ Vertical Space
 * บนมือถือ". What is pinned below is only the part a later tidy would undo
 * without noticing: which cell may share the second track, and the selector
 * that makes `padding: 0` apply at all.
 *
 * Measured on the built app at 360px, a มีใบแล้ว card: 297px → 211 → 185.
 */
test('แผนก, บริษัท and ชั่วโมง share a line, and วันเกิด is not allowed to', () => {
  const tr = phone.slice(phone.indexOf('.bmonth-table tr {'), phone.indexOf('table.bmonth-table td {'));
  // ALL THREE SHORT FACTS ON ONE ROW. It was `"co hrs"` with แผนก on a line of
  // its own for the few hours between the two compactions of 2026-08-27; the
  // three together used less than half the card's width and three of its rows.
  assert.match(tr, /"dept\s+co\s+hrs"/, 'the short facts went back to a line each');
  // AND วันเกิด KEEPS ITS OWN. It carries `white-space: nowrap` from HrView, so
  // it has no wrap to fall back on: the longest date this app draws —
  // "13 สิงหาคม 2569 วันพฤหัสบดี" — is most of a 312px card on its own, and a
  // pair that fits in August and overflows in November pushes the page sideways
  // nine months a year. The other three labelled cells wrap and are safe.
  assert.match(tr, /"date\s+date\s+date"/, 'วันเกิด was paired with something');
  assert.match(hrView, /className="date-col" style=\{\{ whiteSpace: 'nowrap' \}\}/,
    'the nowrap that makes วันเกิด the unpairable one is gone — re-check the pairing above');
  // The figure goes to the card's right edge, under the chip, with its label.
  // Matched whole rather than sliced: `td.hrs-col` appears three times in this
  // block — in the three-selector rule it shares with วันเกิด and บริษัท, in
  // that group's `::before`, and here — so an index either side of it lands on
  // the wrong one of the three.
  assert.match(phone, /\.bmonth-table td\.hrs-col \{\s*grid-area: hrs; justify-self: end;/);
});

test('`padding: 0` on the cells names the element, or table.mini keeps winning', () => {
  // THE SAME TRAP AS THE BORDER, ON THE SAME ELEMENT, FOUND BY MEASURING.
  // `table.mini th, table.mini td { padding: 7px 10px; }` is two elements and a
  // class; `.bmonth-table td` was one class and one element and lost to it, so
  // every cell on this card had been drawn with 7px above and below it and 10px
  // in from the side since the card was written — about 35px a card, and 10px of
  // indent that only the cells WITHOUT their own padding had, which is why แผนก
  // sat ten pixels right of วันเกิด under it.
  assert.match(phone, /table\.bmonth-table td \{ display: block; border: 0; padding: 0; text-align: left; \}/);
  assert.match(css, /table\.mini th, table\.mini td \{ padding: 7px 10px; font-size: 13px; \}/,
    'the rule this one has to out-specify moved — re-check the selector above');
  // `.bday-table` is not `mini` and never had this, which is why วันเกิดรอตรวจ
  // needs no such rule and must not be given one by symmetry.
  assert.ok(!/className="mini bday-table"|className="bday-table mini"/.test(queue));
  assert.match(queue, /<table className="bday-table">/);
});

test('and the sentence under it is full width, not squeezed in beside it', () => {
  assert.match(phone, /\.bmonth-table td\.state-col > \.state-note \{ grid-area: note; \}/);
  // The old placement is gone: no row of its own six lines down, and no 60px
  // indent lining the chip up with values it is not one of.
  assert.ok(!/\.bmonth-table td\.state-col \{ grid-area: state; padding-left: 60px; \}/.test(phone));
  const tr = phone.slice(phone.indexOf('.bmonth-table tr {'), phone.indexOf('.bmonth-table td {'));
  assert.ok(!/"state\s+state"/.test(tr), 'the status got its own full-width row back');
  // …and it is no longer one of the labelled facts, which is a group that draws
  // a `::before` label the status must never grow.
  const facts = phone.slice(phone.indexOf('.bmonth-table td.date-col,'), phone.indexOf('.bmonth-table td.date-col::before'));
  assert.ok(!/state-col/.test(facts), 'the status is back among the labelled facts');
});

test('the cell dissolves, so its two halves can land in two places', () => {
  assert.match(phone, /\.bmonth-table td\.state-col \{ display: contents; \}/);
  // `display: contents` promotes the cell's CHILDREN to grid items, and a grid
  // places items — two loose divs would both be handed `grid-area: note` and
  // paint over each other. So every explanation is wrapped in one div.
  const cell = hrView.slice(hrView.indexOf('function BirthdayStatusCell'), hrView.indexOf('function BirthdayRowActions'));
  for (const status of ['FILED', 'ABSENT', 'HOLIDAY', 'UPCOMING']) {
    const at = cell.indexOf(`BIRTHDAY_STATUS.${status}`);
    const branch = cell.slice(at, cell.indexOf('  if (', at + 1) === -1 ? cell.length : cell.indexOf('  if (', at + 1));
    assert.ok(/className="state-note"/.test(branch), `${status} lost its wrapper — its lines will overlap`);
  }
  // Exactly one wrapper per branch, never two loose ones.
  assert.equal((cell.match(/className="state-note"/g) || []).length, 4);
  // ต้องตรวจ has no sentence at all and must not render an empty wrapper into
  // the note row, which would open a gap under every card that is WORK.
  assert.match(cell, /return <span className="chip due">\{label\}<\/span>;/);
});

test('มีใบแล้ว renders no wrapper when it has nothing to explain', () => {
  // Both of its lines are conditional. An unconditional wrapper around two
  // absent children is an empty grid item, which is a row of gap for nothing.
  const cell = hrView.slice(hrView.indexOf('function BirthdayStatusCell'), hrView.indexOf('BIRTHDAY_STATUS.ABSENT'));
  assert.match(cell, /\{\(row\.allClosed \|\| row\.alreadyHoliday\) && \(\s*<div className="state-note">/);
});

// ── the forced palette ───────────────────────────────────────────────────────

/**
 * The three chips were asked for by hand, twice, at literal Tailwind values,
 * after the token versions above had already been explained and declined. They
 * are therefore pinned TWICE in this file and the two pins say different things:
 * the tests further up hold the SHAPE — a fill, an ink and a 1px ring, the same
 * 3px/9px on all three so a column of them lines up — and this one holds the
 * VALUES that shape is currently painted in.
 *
 * The values are tokens, not hexes in the rule. That is not a softening of the
 * request: `no rule names a colour of its own` in test/theme.test.js fails the
 * build over a raw colour in a rule, comments included, so the hexes live in
 * the token block and the rule points at them.
 */

const forced = css.slice(css.indexOf('THE THREE BIRTHDAY CHIPS, FORCED'));

test('the three chips are forced to the Tailwind palette', () => {
  for (const [chip, tok] of [['due', 'due'], ['upcoming', 'upcoming'], ['neutral', 'settled']]) {
    const rule = forced.slice(forced.indexOf(`.chip.${chip} {`), forced.indexOf('}', forced.indexOf(`.chip.${chip} {`)));
    assert.ok(rule.includes(`background: var(--bday-${tok}-bg) !important;`), `.chip.${chip} fill`);
    assert.ok(rule.includes(`color: var(--bday-${tok}-ink) !important;`), `.chip.${chip} ink`);
    // `border-color`, not `border` — the width stays decided by the rule above,
    // so a chip cannot gain a pixel of height here and fall out of the column.
    assert.ok(rule.includes(`border-color: var(--bday-${tok}-line) !important;`), `.chip.${chip} ring`);
    assert.ok(!/border: /.test(rule), `.chip.${chip} re-declares the whole border`);
  }
});

test('and the values are exactly the ones that were asked for', () => {
  const tokens = css.slice(0, css.indexOf('* { margin: 0'));
  for (const [name, value] of [
    ['--bday-due-bg', 'rgb(245 158 11 / .2)'],        // amber-500/20
    ['--bday-due-ink', '#fbbf24'],                    // amber-400
    ['--bday-due-line', 'rgb(245 158 11 / .4)'],      // amber-500/40
    ['--bday-upcoming-bg', 'rgb(59 130 246 / .2)'],   // blue-500/20
    ['--bday-upcoming-ink', '#60a5fa'],               // blue-400
    ['--bday-upcoming-line', 'rgb(59 130 246 / .4)'], // blue-500/40
    ['--bday-settled-bg', '#27272a'],                 // zinc-800
    ['--bday-settled-ink', '#a1a1aa'],                // zinc-400
    ['--bday-settled-line', '#3f3f46'],               // zinc-700
  ]) {
    // The plain fallback, for a browser that drops light-dark().
    assert.ok(tokens.includes(`${name}: ${value};`), `${name} lost its fallback`);
    // And the themed pair — the SAME value twice, which is this file's way of
    // saying a colour deliberately does not follow the theme. If somebody ever
    // gives the light half its old token back, this is the line that notices.
    assert.ok(tokens.includes(`${name}: light-dark(${value}, ${value});`), `${name} is no longer forced`);
  }
});

test('the token rules above are left standing, not deleted', () => {
  // The override is layered ON the token versions. Deleting them would take
  // the reasoning over them with it, and would leave the app with three chips
  // whose only definition is a palette borrowed from another design system.
  const before = css.slice(0, css.indexOf('THE THREE BIRTHDAY CHIPS, FORCED'));
  assert.match(before, /\.chip\.due \{[\s\S]*?background: var\(--amber-bg\); color: var\(--amber-ink\);/);
  assert.match(before, /\.chip\.upcoming \{[\s\S]*?background: var\(--info-bg\); color: var\(--info\);/);
  assert.match(before, /\.chip\.neutral \{[\s\S]*?background: var\(--neutral-wash\); color: var\(--muted\);/);
});
