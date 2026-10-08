import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * รายการ OT รายบุคคล — the last cell of a row, and the footnote under the table.
 *
 * This screen (components/HrEntries.jsx) is what sits behind a total that looks
 * wrong: one card per date, and on each of them exactly one thing HR can DO —
 * แก้ไข. What is pinned here is the difference between a control and a
 * statement, because for most of this file's life the screen drew both as
 * buttons and the statement won.
 *
 * THE DEFECT, WRITTEN DOWN BECAUSE IT SHIPPED. ไม่มีประวัติการแก้ไข was a
 * `disabled` button beside แก้ไข. `.btn:disabled` fills with `--neutral-wash`,
 * and on the dark theme that token is LIGHTER than the `--card` a ghost button
 * is drawn on — so the dead control came out brighter than the live one, and at
 * 134px against 57 it was also more than twice the width. Two buttons, and the
 * eye went to the one that does nothing.
 *
 * The fix is not a colour. It is that a sentence about the row is drawn as a
 * sentence — `.cell-sub.th`, which is what the same cell has always used for
 * แก้ไขไม่ได้ — and the one control on the card carries an icon so it is found
 * at a glance among eight lines of grey.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const jsx = read('components/HrEntries.jsx');
const css = read('app/styles.css');
const icons = read('components/icons.jsx');

/**
 * The screen with its commentary stripped.
 *
 * Two assertions in this file caught their own comment on the way in: one
 * looking for the ✏️ this file explains it does NOT use, and one for the inline
 * style it explains it replaced. The same trap test/hrMonthCards.test.js keeps a
 * note about, and the reason both files strip before asking.
 */
const code = jsx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** One rule's body, by its exact selector. */
function rule(selector) {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `ไม่พบกฎ ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

// ── one control, one statement ───────────────────────────────────────────────

test('every control in the cell is a RowAction, and a dead one is disabled with its reason', () => {
  // แก้ไข — a control.
  assert.match(jsx, /<RowAction icon="pencil" label="แก้ไข" onClick=\{\(\) => setEditing\(e\)\} \/>/);
  // ไม่มีประวัติการแก้ไข and แก้ไขไม่ได้ WERE SENTENCES from 2026-08-26 until
  // 2026-10-08, chosen over a disabled button because `--neutral-wash` drew the
  // dead control brighter than the live one in ธีมมืด. When the row's controls
  // became 32px icon squares the sentences became the widest thing in the cell,
  // and the app's rule since 2026-09-11 is DISABLE, DON'T REMOVE, with the
  // reason on the tooltip (docs/design.md §5). The edge that keeps the live
  // square heavier is pinned in the cancelled-row test below.
  assert.match(jsx, /why=\{hasAuditTrail\(e\) \? '' : 'ไม่มีประวัติการแก้ไข'\}/);
  assert.match(jsx, /<RowAction icon="pencil" label="แก้ไข" why="แก้ไขไม่ได้ — /);
  assert.ok(!/<span className="cell-sub th">ไม่มีประวัติการแก้ไข<\/span>/.test(jsx),
    'the sentence came back — it is the reason on a disabled icon now');
});

test('nothing in a row writes its own type size any more', () => {
  // The four that were here — the day under the date, ข้ามคืน, who last edited
  // the row, and the ceiling warning — are `.cell-sub.th` and `.cell-note` now,
  // which is what คิวรออนุมัติ prints the same strings from. Two screens
  // quoting one fact in two sizes is what those classes exist to prevent.
  //
  // ข้ามคืน WAS ONE OF THE FOUR AND IS NOT DRAWN ANY MORE — 2026-09-10, when
  // the feature went. `.cell-note` still exists and still carries the ceiling
  // warning, which is what keeps this assertion about a class and not about a
  // string that happened to use it.
  assert.ok(
    !/style=\{\{ fontSize:/.test(code),
    'an inline font size came back into a row',
  );
  assert.match(jsx, /className="cell-note"/);
  // The same class, on the screen that shares these rows.
  assert.match(read('components/ApprovalQueue.jsx'), /className="cell-note"/);
});

test('the date reads "จ.05/10/2569", the form คิวรออนุมัติ prints, and does not wrap', () => {
  // ASKED FOR 2026-10-08 — *ปรับการแสดงวันที่ให้เป็นรูปแบบเดียวกับหน้า รออนุมัติ*.
  // It was "05/10/2569 วันจันทร์", and on a narrow table จันทร์ fell onto a
  // line of its own. The same span on both screens, character for character.
  const day = '<span className="cell-sub th when-day">{dayAbbr(e.workDate)}</span>';
  const cell = /<td className="stack-name">([\s\S]*?)<\/td>/.exec(code);
  assert.ok(cell, 'ไม่พบเซลล์วันที่ของรายการ OT');
  // The date STARTS the cell; since 2026-10-08 the day's own marks
  // (เหมารายวัน / วันเกิด) may follow it, under it.
  assert.ok(
    cell[1].replace(/\s+/g, '').startsWith(`${day}{thaiDate(e.workDate)}`.replace(/\s+/g, '')),
    'วันที่ไม่ได้อยู่ต้นเซลล์',
  );
  const queue = /<td className="when-col">([\s\S]*?)<\/td>/.exec(read('components/ApprovalQueue.jsx'));
  assert.ok(queue && queue[1].replace(/\s+/g, '').includes(`${day}{thaiDate(e.workDate)}`.replace(/\s+/g, '')),
    'คิวรออนุมัติเปลี่ยนรูปแบบวันที่ไปแล้ว — สองจอต้องเหมือนกัน');
  assert.doesNotMatch(code, /dayName/, 'ชื่อวันเต็มกลับมาในแถว');
  // ONE RULE FOR BOTH SCREENS, not a copy scoped to each.
  assert.match(rule('.cell-sub.when-day'), /display: inline; margin: 0 2px 0 0;/);
  assert.ok(!css.includes('td.when-col .when-day {'), 'กฎของคิวกลับมาแยกอีกชุด');
  assert.ok(!css.includes('td.stack-name .cell-sub {'), 'กฎ inline เดิมที่ใส่ margin ซ้าย 6px กลับมา');
  assert.match(rule('.entry-table.stack-table tbody td.stack-name'), /white-space: nowrap;/);
});

test('the two of them share one row, and the sentence is not on the buttons’ baseline', () => {
  assert.match(jsx, /<span className="entry-actions">/);
  assert.match(rule('.entry-actions'), /display: inline-flex; align-items: center; gap: 6px;/);
  // `gap` REPLACED FOUR `marginLeft: 6`s. One of them cannot be forgotten on the
  // next thing added to this cell, and a margin cannot centre 12px text against
  // a 44px control.
  assert.ok(
    !/style=\{\{ marginLeft: 6 \}\}/.test(jsx),
    'a hand-written margin came back beside the gap',
  );
  assert.match(rule('.entry-actions .cell-sub'), /margin-top: 0;/);
});

test('the wrap belongs to the card layout and not to the table', () => {
  // On the desktop this is the eleventh column of a table whose cell already
  // says `white-space: nowrap` — a flex container ignores that, and `wrap` left
  // on the base rule stacked แก้ไข and ดูข้อมูลเดิม onto two lines in every row
  // of a long month.
  assert.match(rule('.entry-actions'), /flex-wrap: nowrap;/);
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.stack-table tbody td \.entry-actions \{ flex-wrap: wrap; \}/);
});

// ── the icon ─────────────────────────────────────────────────────────────────

test('the pencil is drawn, not typed, and it is sized by a class', () => {
  // Drawn: an emoji is whatever the font on the device decides, and this app
  // runs on Windows, iPhones and Android — the rule the whole icon file exists
  // for. ✏️ beside a form numbered F-HR-027 is also the wrong register.
  assert.match(icons, /^\s*pencil: \(/m);
  assert.ok(!/✏/.test(code), 'the pencil went back to being an emoji');
  // Through `RowAction` since 2026-10-08 — the one icon button every table's
  // จัดการ column draws, so the glyph is chosen by meaning in one place.
  assert.match(jsx, /<RowAction icon="pencil"/);
  assert.match(read('components/common.jsx'), /<Icon name=\{icon\} className="btn-icon" \/>/);

  // OPT-IN BY CLASS. `display: inline-flex` on `.btn` itself would relayout
  // every button in the app to fix the one that has a picture in it.
  assert.match(rule('.btn.act-icon'), /display: inline-flex; align-items: center;/);
  assert.match(rule('.btn.act-icon .btn-icon'), /width: 16px; height: 16px; flex: none;/);
});

// ── the three states of the button ───────────────────────────────────────────

test('a ghost button now has a press, and the three states are a ladder', () => {
  // `.btn:active` moves every button down one pixel, which is enough on a
  // FILLED button and nothing at all on a ghost: the ghost is the card's own
  // background with a hairline round it, so under a thumb — which covers the
  // button — a press showed no change of any kind.
  assert.match(rule('.btn.ghost:hover:not(:disabled)'), /background: var\(--green-tint\)/);
  assert.match(rule('.btn.ghost:active:not(:disabled)'), /background: var\(--green-bg\)/);
  // Deeper on press than on hover, or the two states are the same picture.
  assert.ok(
    css.indexOf('.btn.ghost:hover') < css.indexOf('.btn.ghost:active'),
    'the press state is written above the hover state and loses to it on order',
  );
  // Tokens, both halves of the theme, and no colour named here — the rule
  // test/theme.test.js holds the whole stylesheet to.
  assert.ok(
    !/#[0-9a-fA-F]{3,6}/.test(rule('.btn.ghost:active:not(:disabled)')),
    'the press state named a colour of its own',
  );
});

// ── the card, and the footnote under it ──────────────────────────────────────

test('a field is 10px from the next one, the same step the cards keep', () => {
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  // Each field is a label and a value on ONE line — floated label, value flowing
  // to the right of it — so this gap is the only vertical space between one fact
  // and the next. It read 8px until 2026-08-26.
  assert.match(phone, /\.stack-table tbody tr \{[\s\S]*?display: flex; flex-direction: column; gap: 10px;/);
  // …and it is the same figure the cards themselves are spaced by, so a card's
  // insides and the space around it are one rhythm rather than two.
  assert.match(phone, /\.stack-table tbody \{ display: flex; flex-direction: column; gap: 10px;/);
});

test('the chip under a description is a statement, not the line above wrapping', () => {
  assert.match(jsx, /<div className="entry-mark"><ProxyMark entry=\{e\} \/><\/div>/);
  assert.match(rule('.entry-mark'), /margin-top: 6px;/);
  // `.chip` is nowrap everywhere else and that is right for อนุมัติ and
  // ต้องตรวจ. This one holds a sentence 242px long on a 304px card.
  assert.match(rule('.entry-mark .chip'), /white-space: normal;/);
  assert.ok(
    !/style=\{\{ marginTop: 4 \}\}><ProxyMark/.test(jsx),
    'the mark went back to an inline margin',
  );
});

test('the footnote is a boxed note, and it is not made unreadable to say so', () => {
  assert.match(jsx, /<div className="hint entry-foot">/);
  // The inline margin is gone: it is the one thing a media query cannot reach.
  assert.ok(!/className="hint" style=\{\{ marginTop: 12 \}\}/.test(jsx));
  const foot = rule('.hint.entry-foot');
  // A BOX AND NOT A RULE. It read `border-top: 1px solid var(--line-softer)`
  // with `padding-top: 12px` until 2026-08-26. A hairline says where the note
  // starts and says nothing about where it stops, so under a long month it
  // still trailed off into the page; a bordered wash closes both ends of it.
  assert.match(foot, /background: var\(--neutral-wash\);/);
  /*
   * THE EDGE, AND IT READ `--line-soft` UNTIL 2026-09-07. That token is #29312c
   * in ธีมมืด against this box's own #262e2a — three units apart, which is a
   * border nobody can see, so the box was a wash with no edge and the round
   * that asked for "a callout with a thin border" was asking for the border it
   * already had on paper. `--line` is #303934 there and #e2e7e3 in ธีมสว่าง:
   * visible in both, and still the quietest edge this app draws. What is
   * pinned is that it stays a NEUTRAL edge — an amber or accent border would
   * make a warning out of two standing rules about what an edit does.
   */
  assert.match(foot, /border: 1px solid var\(--line\);/);
  assert.match(foot, /border-radius: var\(--radius\);/);
  // 14/16, up from 10/14 on 2026-09-07 — measured 64px tall → 73px. p-4 (16 all
  // round) was what was asked for; 16px over a 12px two-line note reads as a
  // gap rather than as padding, and 14/16 is the step the audit drawer beside
  // it already takes. It read "10px down, not 12 … the 14 across is unchanged"
  // from 2026-08-26 until then.
  assert.match(foot, /padding: 14px 16px;/);
  assert.match(foot, /font-size: 12px;/);
  // Last thing in the card, so `.card .hint`'s 14 left 32px under it against 18
  // at every other edge.
  assert.match(foot, /margin-top: 14px; margin-bottom: 0;/);
  // `.stack-table`'s cells are right-aligned on a phone and this box sits under
  // them; a list that inherited that would have its bullets floating off the
  // ends of two ragged lines.
  assert.match(foot, /text-align: left;/);

  // AND IT KEEPS `.hint`'s COLOUR. Asked for as a lighter grey a second time on
  // 2026-08-26 and declined a second time: `--muted-3` on `--neutral-wash`
  // measures 2.79:1 in ธีมสว่าง, against 3.20 for the `--muted-2` this inherits
  // — and this is the instruction that says what an edit does to a signed
  // month. The box, the smaller face and the space carry the hierarchy instead.
  assert.ok(!/color:/.test(foot), 'the footnote took a colour of its own');
  assert.match(css, /\.hint \{ font: 400 12\.5px\/1\.55 var\(--sans\); color: var\(--muted-2\); \}/);
});

test('the footnote is two rules, one per line, not one sentence and a middot', () => {
  // Thai has no spaces, so the two joined by a · were a single unbreakable
  // string as far as the layout was concerned: it broke wherever the box ended,
  // which put the tail of the first rule and the head of the second on one line.
  assert.match(jsx, /<ul className="foot-notes">/);
  const items = jsx.match(/<li>[^<]*<\/li>/g) || [];
  assert.equal(items.length, 2, 'the footnote is meant to hold exactly two rules');
  assert.match(items[0], /คำนวณชั่วโมงใหม่ทันที/);
  assert.match(items[0], /คงสถานะอนุมัติเดิม/);
  assert.match(items[1], /ยกเลิกหรือไม่อนุมัติ/);
  assert.match(items[1], /ยื่นส่งรายการเข้ามาใหม่/);
  assert.ok(
    !/คงสถานะการอนุมัติเดิมไว้ ·/.test(code),
    'the two rules went back to being one sentence',
  );

  // Drawn, not `list-style` — a disc sits outside the content box and would
  // hang into the panel's padding. Same reasoning as `.alerts-list`, and
  // `padding-left` is on the item so a rule that wraps aligns under its own
  // first line rather than under its bullet.
  assert.match(rule('.entry-foot .foot-notes'), /list-style: none;/);
  assert.match(rule('.entry-foot .foot-notes > li'), /padding-left: 14px;/);
  assert.match(rule('.entry-foot .foot-notes > li::before'), /content: '•';/);
  /*
   * AND THE DOT IS A COLOUR, NOT AN OPACITY — 2026-09-07. `opacity: .6` on a
   * `--muted` glyph lands between `--muted-2` and `--muted-3`, and lands
   * somewhere else again the day either token moves: an opacity is a number
   * about pixels, and what the dot means is "one step quieter than the
   * sentence". The palette has words for that.
   */
  assert.match(rule('.entry-foot .foot-notes > li::before'), /color: var\(--muted-3\);/);
  assert.ok(
    !/opacity: \.6;/.test(rule('.entry-foot .foot-notes > li::before')),
    'the bullet went back to being an opacity',
  );
  // space-y-1.5 in the words this stylesheet uses. 6px until 2026-09-07, when
  // the box's padding grew and 6 read as tight inside it.
  assert.match(rule('.entry-foot .foot-notes'), /gap: 7px;/);
});

/**
 * จาก–ถึง IS TWO LINES SINCE 2026-10-08 — the times, then the punches ending in
 * the scan mark (แบบ C, chosen from three mockups: *"กระชับเป็น 2 แถว"*).
 *
 * It read "จาก–ถึง HOLDS FOUR THINGS" until that day: times, badge, the
 * badge's explanation and the punches, stacked, with 8px and 6px between them
 * so they did not read as one paragraph of grey (reported 2026-09-07). The
 * badge now sits at the end of the punches line, which separates the two by
 * position instead of by margin. What is still pinned is the explanation's
 * hierarchy: it carries the minutes, so it may not go below `--muted-2`.
 */
test('จาก–ถึง is two lines: the times, then the punches ending in the mark', () => {
  // A class, not the Thai `data-label` — see the note over the cell. The label
  // stays because the phone card prints it as the cell's heading.
  assert.match(jsx, /<td className="when-cell" data-label="จาก–ถึง">/);

  // แบบ C, 2026-10-08 — *"กระชับเป็น 2 แถว"*: the mark ends the punches line,
  // because it is a verdict on those punches.
  assert.match(
    jsx,
    /<div className="when-scan">\s*<ScanDayPunches entry=\{e\} \/>\s*<div className="entry-mark"><ScanMismatchMark entry=\{e\} \/><\/div>/,
  );
  assert.match(rule('.stack-table td.when-cell .when-scan > .cell-sub.th'), /display: inline;/);
  assert.match(
    rule('.entry-table.stack-table tbody td.when-cell .when-scan .entry-mark'),
    /display: inline-block;/,
  );

  // The explanation under the chip (phone only — the desktop row clips it)
  // keeps its hierarchy: quieter than the punches, never below `--muted-2`,
  // because it carries the minutes and `--muted-3` at 11.5px is 2.79:1.
  const detail = rule('.stack-table td.when-cell .entry-mark .cell-sub.th');
  assert.match(detail, /font-size: 11\.5px;/);
  assert.match(detail, /color: var\(--muted-2\);/);
  assert.ok(!/--muted-3/.test(detail), 'the line carrying the minutes went a step too quiet');

  // Inline, so the line follows the cell's text-align at both widths — and
  // nothing about this cell is written inside the phone block.
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.ok(!/td\.when-cell/.test(phone), 'the cell was styled where the card block cannot reach');
});

test('เหมารายวัน and วันเกิด sit under the date, not in จาก–ถึง', () => {
  // *"สถานะ เหมารายวัน / วันเกิด ไปอยู่ใต้วันที่"* (2026-10-08). They say what
  // the DAY is; จาก–ถึง keeps only what the scanner saw.
  const dateCell = jsx.slice(jsx.indexOf('<td className="stack-name">'), jsx.indexOf('<td className="when-cell"'));
  assert.match(dateCell, /<div className="entry-mark day-mark">/);
  assert.match(dateCell, /<FlatDailyMark entry=\{e\} \/>/);
  assert.match(dateCell, /<BirthdayWelfareMark entry=\{e\} \/>/);
  const whenCell = jsx.slice(jsx.indexOf('<td className="when-cell"'), jsx.indexOf('<td className="num rate-col">'));
  assert.ok(!whenCell.includes('<FlatDailyMark'), 'เหมารายวัน is back beside the times');

  // A block under the date, spaced by a flex gap — two chips there cannot
  // touch or indent, which is what the withdrawn two-badge rules fixed by hand.
  const day = rule('.entry-table.stack-table tbody td.stack-name .day-mark');
  assert.match(day, /display: flex;/);
  assert.match(day, /gap: 4px;/);
  assert.ok(!/\.when-cell \.entry-mark \.chip:not\(:last-of-type\)/.test(css), 'the two-badge rules came back');
});

test('the footnote lines up with the cards above it on a phone', () => {
  // `.stack-table tbody` insets the cards by 12px; the note is a sibling of the
  // whole table and ran the full width of the `.card`, so it was 12px wider on
  // each side than everything it is about.
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.hint\.entry-foot \{ margin-left: 12px; margin-right: 12px; \}/);
  assert.match(phone, /\.stack-table tbody \{ display: flex; flex-direction: column; gap: 10px; padding: 12px;/);
});

test('on a cancelled row the live control outweighs the dead sentence', () => {
  // แก้ไขไม่ได้ and ดูข้อมูลเดิม sit side by side in one cell: a thing that
  // cannot be done and a thing that can. Both were `--muted` at nearly one
  // size, and the live one was a white button with a `--line` hairline on a
  // white card — two labels, and which was which came only from the words.
  //
  // Since 2026-10-08 the dead half is a disabled icon square rather than a
  // sentence (see the first test in this file), and the edge is what still
  // tells the two apart.
  assert.match(rule('.entry-actions .btn.ghost'), /border-color: var\(--line-lift\);/);

  // NOT A FILL. `--neutral-wash` behind a ghost button is what `.btn:disabled`
  // looks like, and on ธีมมืด that token is LIGHTER than the `--card` a ghost
  // sits on — dressing the live control in the dead one's clothes is the exact
  // defect this cell was repaired for earlier the same day.
  assert.ok(
    !/\.entry-actions \.btn\.ghost \{[^}]*background:/.test(css),
    'the row button took a fill — see .btn:disabled',
  );
  // Scoped, so `.cell-sub.th` elsewhere — a note about a value rather than a
  // missing control — is untouched. Matched at the line start, because
  // `rule()` looks for a selector as a substring and the scoped rule above
  // ends with these same characters.
  assert.match(css, /^\.cell-sub\.th \{\r?\n  font: 400 12px\/1\.45 var\(--sans\);/m);
});

test('the one value that wraps gets a line-height, and only that one', () => {
  // รายละเอียดงานที่ทำ is the only cell on the card whose value runs to two
  // lines. At the table's 1.5 the pair closed up into a block whose last line
  // then sat 10px above กฎที่ใช้ — a LABEL, starting at the opposite edge. Two
  // lines and a heading sharing one gap that was measured for neither.
  assert.match(jsx, /<td className="entry-desc" data-label="รายละเอียดงานที่ทำ">/);
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  // TWO NUMBERS, because one could only do half the job: a line-height adds
  // half its growth under the last line — 1.75 puts 1.75px into the gap below
  // and no more — and what sits under this cell is a LABEL, not another value.
  // The 4px takes the card's 10px flex gap to 14 under this one field. Last
  // glyph to the label's first, measured on the built app: 16.75px before any
  // of it, 18.15 at 1.7 alone, 22.5 now.
  assert.match(phone, /\.stack-table tbody td\.entry-desc \{ line-height: 1\.75; padding-bottom: 4px; \}/);
  // The table's own rule is left alone: on the desktop this cell is a column
  // beside ten others, and a line-height set for a wrapped card value would
  // loosen every row of every table in the app.
  assert.match(css, /^td \{ padding: 7px 12px;[^}]*font: 400 14px\/1\.4 var\(--sans\);/m);
});

test('on a phone card the description\'s chips start at the left, like สถานะ', () => {
  // The cell right-aligns its value, and `บันทึกแทน · ชื่อ` went to the right
  // edge with it while `รอ HR` one field down sat at the left. Asked 2026-09-10.
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.stack-table tbody td\.entry-desc \.entry-mark \{ clear: left; text-align: left; \}/);
  // The description itself stays right-aligned with the card's other values.
  assert.ok(!/td\.entry-desc \{[^}]*text-align/.test(phone), 'the whole cell went left, not only its chips');
});

test('the notice is at the top of the page, and takes no room when there is none', () => {
  /* ⚠ IT WAS A SLOT UNDER THE EMPLOYEE'S NAME (`.entry-notice`, 16px above) until
     2026-10-08 — kept at one height so the rows below did not move between one
     employee and the next. That day every page's notices moved to the top of the
     page, above the card (*"ย้ายแบนเนอร์การแจ้งเตือนทั้ง App เอาไว้ส่วนบนสุด"*),
     which answers the same worry from the other side: nothing inside the card
     moves at all, and an empty stack draws nothing. */
  const stack = jsx.indexOf('<NoticeStack id="entries">');
  assert.ok(stack > 0, 'the page has no notice stack');
  const ret = jsx.lastIndexOf('return (', stack);
  assert.ok(!jsx.slice(ret, stack).includes('<div className="card">'), 'the notices are inside the card again');
  assert.ok(jsx.indexOf('<div className="card">', stack) > stack, 'the card does not follow the notices');
  assert.match(jsx, /<NoticeStack id="entries">\s*\n\s*<PolicyVersionBanner spread=\{spread\} onGoMonthly=\{onClose\} \/>\s*\n\s*<\/NoticeStack>/);
  assert.match(css, /^\.notice-stack\.is-empty \{ display: none; \}/m);
  assert.ok(!/^\.notice-stack\.entry-notice/m.test(css), 'the slot under the name came back');
});

test('every card footer is the same two slots, and they line up down the month', () => {
  // Left: what can be DONE to this row — แก้ไข, or แก้ไขไม่ได้ where the row is
  // ยกเลิก or ไม่อนุมัติ. Right: what can be READ about it — ดูข้อมูลเดิม, or
  // ไม่มีประวัติการแก้ไข. True in the markup and invisible on the screen: an
  // inline run with a 6px gap starts its second item wherever the first ended,
  // so down a month of six cards the right-hand control sat at four different
  // x-positions — and a column of controls that does not line up reads as a
  // column of different controls.
  // BOTH LAYOUTS, from the base rule. On the desktop the cell is the eleventh
  // column, sized by its widest row, so the same raggedness was there: 1192px
  // against 1221 for the five rows whose left slot is the pencil button.
  assert.match(rule('.entry-actions'), /width: 100%;/);
  assert.match(rule('.entry-actions > :last-child'), /margin-left: auto;/);
  // The phone still wraps and the desktop still does not — that difference is
  // about a 44px button beside a sentence on a 274px card, not about the slots.
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.stack-table tbody td \.entry-actions \{ flex-wrap: wrap; \}/);
  assert.match(rule('.entry-actions'), /flex-wrap: nowrap;/);

  // THE LAST CHILD, not `justify-content: space-between`. Three things land
  // here on an untouched วันเกิด filing — แก้ไข, ถอนใบวันเกิด, ดูข้อมูลเดิม —
  // and space-between would push ถอนใบวันเกิด to the centre of the card, away
  // from the แก้ไข it belongs with.
  assert.ok(
    !/\.entry-actions[^{]*\{[^}]*space-between/.test(css),
    'the run went to space-between — see ถอนใบวันเกิด, which makes it three',
  );
  assert.match(jsx, /ถอนใบวันเกิด/);
  assert.match(rule('.entry-actions'), /display: inline-flex;/);
});

test('the drawer’s green edge sits on the card’s border, not inside it', () => {
  // On a phone the drawer's <tr> is a card like the row above it — 15px of
  // padding, a border, a radius — so `.audit-drawer` sat 16px in from the card's
  // own edge with its 3px accent running down a white margin beside nothing, and
  // its words started 35px in (16 + 3 + 16) against the 15px every field on the
  // row above starts at. The card holds nothing but the drawer, so the padding
  // moves to the drawer: the stripe lands on the card's border, parallel with
  // it, and 12px of padding past a 3px stripe puts the text at the row's 15.
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.stack-table tbody tr\.audit-row \{[^}]*padding: 0;/);
  // The td carries `--neutral-wash` and now runs to the corners; a square wash
  // inside a 14px radius is worse than the inset it replaces.
  assert.match(phone, /\.stack-table tbody tr\.audit-row \{[^}]*overflow: hidden;/);
  assert.match(
    phone,
    /\.stack-table tbody tr\.audit-row \.audit-drawer \{ padding: 14px 15px 15px 12px; \}/,
  );
  // Two classes and two elements against the card rule's one class and two
  // elements — this wins on specificity, not on source order.
  assert.match(rule('.stack-table tbody tr'), /padding: 15px;/);
  // The accent itself is unchanged and stays on the shared rule: the desktop
  // draws it against the left wall of a colSpan cell and always did.
  assert.match(rule('.audit-drawer'), /border-left: 3px solid var\(--green\);/);
});

test('the drawer’s caption is smaller than the timestamps under it', () => {
  // It explains what the two halves of the drawer are and is read once; the
  // timestamps below are read every time. At `.hint`'s 12.5px it was within half
  // a pixel of `.entry-history .who` and a whole one ABOVE `.entry-history
  // .when` (11.5), so three lines of grey type came out the same size.
  assert.match(rule('.audit-drawer > .hint'), /font-size: 12px;/);
  // `--muted-2` AND NOT `--muted-3`, settled for the third time: on the drawer's
  // own `--neutral-wash` that token is 2.79:1 in ธีมสว่าง against 3.20, and this
  // line is already below AA. The size carries the step down on its own.
  assert.ok(
    !/\.audit-drawer > \.hint \{[^}]*muted-3/.test(css),
    'the caption bought its hierarchy with contrast it cannot spare',
  );
  // Stated in CSS rather than on the element. The margin is there for one
  // reason — `.card .hint`'s `margin-bottom: 14px` reaching in from four hundred
  // lines away — and the shorthand states all four sides so it cannot come back.
  assert.match(rule('.audit-drawer > .hint'), /margin: 2px 0 0;/);
  assert.match(code, /<div className="hint">\s*\n\s*ด้านล่าง = ข้อมูลเดิมก่อนแก้/);
});

// ── กฎที่ใช้ came off the table on 2026-09-04 ────────────────────────────────

/**
 * WHAT WAS ASKED FOR, and it is two things rather than one.
 *
 * "ลบคอลัมน์ กฎที่ใช้ ออกจากทั้ง Header และ Body" is the visible half. The half
 * that decides whether it was done properly is the second sentence — "ขยาย
 * พื้นที่ของคอลัมน์ รายละเอียดงานที่ทำ และ สถานะ ให้กว้างขึ้น" — because taking
 * a column out of an `auto` table returns its room to the ALGORITHM, not to any
 * column in particular. On a month of short descriptions most of it goes to the
 * date and the times, and the screen ends up with the same cramped sentence and
 * one fewer fact on it.
 */
test('กฎที่ใช้ is not a column on this table, in either half of it', () => {
  assert.ok(!code.includes('<th>กฎที่ใช้</th>'), 'the header still has it');
  assert.ok(!code.includes('data-label="กฎที่ใช้"'), 'the body still has it');
  // และไม่กลับมาในชื่ออื่น — เซลล์นั้นเป็นตัวเดียวที่วาด PolicyVersionCell ในตาราง
  const head = jsx.slice(jsx.indexOf('<thead>'), jsx.indexOf('</thead>'));
  assert.ok(!/PolicyVersion/.test(head), 'a version cell is back in the header');
});

test('the two columns that hold prose are the two that were widened', () => {
  assert.match(code, /<th className="desc-col">รายละเอียดงานที่ทำ<\/th>/);
  assert.match(code, /<th className="status-col">สถานะ<\/th>/);
  assert.match(code, /<td className="status-col">\s*<StatusChip/);

  // A class with no rule behind it is the failure this pair exists to prevent:
  // the column comes off, the markup says it was compensated for, and nothing
  // on screen moved.
  assert.match(css, /\.stack-table th\.desc-col \{ width: \d+%; \}/);
  assert.match(css, /\.stack-table th\.status-col \{ width: \d+%; \}/);

  /*
   * AND รายละเอียดงานที่ทำ IS THE COLUMN THAT PAYS. It was 40% until
   * 2026-09-07, when จาก–ถึง was widened and this was the only flexible column
   * left to take the room from — every other one on the row sits at its own
   * min-content. 32% keeps it above the 232px its longest row measured at
   * 1440, which is what a 55-character description (the longest in the
   * database) needs to stay inside two lines.
   *
   * The second assertion bans the shortcut that was offered instead of the
   * wrap: a truncation. This sentence is what ฝ่ายบุคคล reconcile a month
   * against a signed sheet by, and an ellipsis hides the half that settles the
   * argument.
   */
  const descRule = /\.stack-table th\.desc-col \{ width: (\d+)%; \}/.exec(css);
  // 29 since 2026-10-08, when จาก–ถึง took three points for its two-line
  // cell; re-measured in Chromium against this stylesheet, 29% is 232px at 1440.
  assert.ok(Number(descRule[1]) >= 29, `รายละเอียดงานที่ทำ fell to ${descRule[1]}%`);
  const entryDesc = css.indexOf('.entry-desc {');
  assert.ok(
    !/text-overflow:\s*ellipsis/.test(css.slice(entryDesc, entryDesc + 400)),
    'the description is being truncated',
  );

  // และต้องอยู่นอกบล็อกมือถือ — ที่นั่น thead เป็น display:none ความกว้างจึงไม่ถึงใคร
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.ok(!/th\.desc-col/.test(phone), 'the width was written where thead is hidden');
});

/**
 * จาก–ถึง IS THE THIRD COLUMN THAT HOLDS MORE THAN A FIGURE, and it was the one
 * left out when the other two were widened.
 *
 * It was written when the cell held `17:00–19:30` and nothing else, so it never
 * got a width. It now carries the times, up to two chips, the day's scan line
 * and the mismatch detail. MEASURED on the built app at 1440px against a clone
 * of the real July scan file, with `desc-col` and `status-col` already in
 * place: the column came out **79px**, the then-`ไม่ได้สแกนเข้า OT` pill
 * (withdrawn 2026-09-09) rendered **55×60** — three lines inside one pill — `สแกน 07:34 , 19:30`
 * wrapped to three lines, and a row whose description is ONE line stood 187px
 * tall. With the rule as it then was: 172px, the pill 104×25, the scan line one
 * line, the row 97px.
 *
 * THE FLOOR IS IN PIXELS AND THAT IS THE POINT. A time string, a pill and a
 * day's scan line do not get shorter on a narrower screen, so a percentage
 * alone lets a 1280 laptop squeeze them back into the shape the rule exists to
 * undo. A `%`-only rule here would pass a test that only looked for a width.
 *
 * ── THE FLOOR MOVED ON 2026-09-07, AND THE CELL IS WHY ──────────────────────
 *
 * 172px was measured when a day's scan line read `สแกน 07:34 , 19:30` and
 * fitted on one. The months since carry days with three, six and seven punches,
 * so the SAME rule now wraps `สแกน 07:26, 00:59 (+1), 07:23 (+1)` to three
 * lines and stands the row at 188px — the shape 172px exists to undo, arrived
 * at from the other side. Re-measured the same way (built app, clone of the
 * real database, July, THT0107's twenty-one rows, at 1440 and 1280), sweeping
 * the floor in 12px steps:
 *
 *     172   scan line 3 lines · tallest row 188px
 *     184   scan line 2 lines · tallest row 188px
 *     204   scan line 2 lines · tallest row 170px
 *     214   nothing further moves
 *
 * The assertion below is 204 and not 168 for that reason: 184 buys half the
 * fix, 204 buys the rest, and past it the column is taking room from the
 * sentence for nothing. THE NUMBER IS A MEASUREMENT, so a later round that has
 * re-measured is free to move it — what it may not do is drop the floor to a
 * bare percentage, which is the shape this assertion pins.
 */
test('จาก–ถึง has a width, and its floor is a pixel one', () => {
  assert.match(code, /<th className="when-col">จาก–ถึง<\/th>/);

  const rule = /\.stack-table th\.when-col \{ width: \d+%; min-width: (\d+)px; \}/.exec(css);
  assert.ok(rule, 'จาก–ถึง has no width rule behind its class');
  // 180px of content is what a three-punch scan line needs to stop at two
  // lines and let the row close to 170px; the cell's own padding is 12px each
  // side. Below this the tallest row goes back to 188.
  // 290 since 2026-10-08: the punches line ends in the scan mark now, and a
  // two-punch line plus the longest mark measured needs it (see the CSS note).
  assert.ok(
    Number(rule[1]) >= 290,
    `the floor fell to ${rule[1]}px — under 204 the tallest row goes back to 188`,
  );

  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.ok(!/th\.when-col/.test(phone), 'the width was written where thead is hidden');
});

/**
 * A colSpan that outlives the column it counted.
 *
 * The drawer is one cell spanning the whole row. Leave it at ten after taking a
 * column out and the browser draws a phantom eleventh — an empty cell at the
 * end of every open drawer, which no assertion about markup would notice and
 * every reader would see. Counted from the header rather than written down, so
 * the next column to arrive or leave fails this rather than being remembered.
 */
test('the drawer spans exactly the columns the header declares', () => {
  const head = jsx.slice(jsx.indexOf('<thead>'), jsx.indexOf('</thead>'));
  const columns = (head.match(/<th[\s>/]/g) || []).length;
  // Nine since 2026-09-04, ten when the tick column is drawn (2026-10-08 —
  // only for a reader who can approve, so the drawer's span follows it).
  assert.equal(columns, 10, 'nine columns + the optional tick column');
  const span = /<td colSpan=\{approvable\.length > 0 \? (\d+) : (\d+)\}>/.exec(code);
  assert.ok(span, 'the drawer must span the row');
  assert.equal(Number(span[1]), columns, 'colSpan with the tick column and the header disagree');
  assert.equal(Number(span[2]), columns - 1, 'colSpan without it and the header disagree');
});

/**
 * The audit fact has to land somewhere, and "somewhere" is checkable.
 *
 * Asked for as "ย้ายไปแสดงใน Modal ดูข้อมูลเดิม หรือ ประวัติการแก้ไข" — so the
 * version being absent from the table is only half of what was requested, and
 * the half that is easy to leave undone.
 */
test('the rule set moved into the drawer, above the trail rather than inside it', () => {
  const drawer = code.slice(code.indexOf('audit-drawer'), code.indexOf('</tbody>'));
  assert.match(drawer, /<PolicyVersionCell version=\{e\.policyVersionId\} \/>/, 'the version is nowhere');
  assert.match(drawer, /className="audit-policy"/);

  // เหนือร่องรอย ไม่ใช่ปนอยู่ในนั้น: อันหนึ่งคือข้อเท็จจริงคงที่ อีกอันคือลำดับเหตุการณ์
  assert.ok(
    drawer.indexOf('audit-policy') < drawer.indexOf('<RequestTrail'),
    'the standing fact is filed among the events',
  );
  assert.match(css, /\.audit-policy \{/, 'the line has no style of its own');
});

/**
 * ไม่พักเที่ยง เป็นไฮไลท์สีแดง — 2026-09-08, asked for in those words while
 * reading รออนุมัติ OT.
 *
 * WHY IT IS LOUDER THAN A `.cell-note` LINE, and why that is the assertion
 * worth having: ไม่พักเที่ยง is the one flag in that cell that ADDS AN HOUR to
 * the total two columns along — the lunch hour is deducted from every other row
 * and not from this one. It was ข้ามคืน that this was measured against, a line
 * that described the shift and moved no figure by itself; that line went on
 * 2026-09-10 and the contrast is now with the ceiling warning, which is amber
 * for the same reason.
 *
 * AND ONE MARK ACROSS BOTH SCREENS. The employee reading their own month and
 * the reviewer reading it beside them are looking at the same square of the
 * same table about the same request; two marks for one fact is the failure the
 * `.cell-sub` / `.cell-note` classes exist to prevent.
 */
test('ไม่พักเที่ยง ขึ้นเป็นไฮไลท์สีแดง และเป็นมาร์กเดียวกันทั้งสองจอ', () => {
  const queue = read('components/ApprovalQueue.jsx');
  const mine = read('components/EmployeeView.jsx');

  // The queue — the screen it was asked on.
  assert.match(queue, /<div className="cell-flag">\u0e44\u0e21\u0e48\u0e1e\u0e31\u0e01\u0e40\u0e17\u0e35\u0e48\u0e22\u0e07<\/div>/);
  // …and the employee’s own month table, the same cell of the same table.
  assert.match(mine, /<div className="cell-flag">\u0e44\u0e21\u0e48\u0e1e\u0e31\u0e01\u0e40\u0e17\u0e35\u0e48\u0e22\u0e07<\/div>/);
  // The grey voice it left is gone from both, or the change is half-applied.
  assert.ok(!queue.includes('className="cell-sub th">ไม่พักเที่ยง'), 'คิวยังวาดเป็นบรรทัดเทาอยู่');
  assert.ok(!mine.includes('className="hint">ไม่พักเที่ยง'), 'หน้าของพนักงานยังวาดเป็นบรรทัดเทาอยู่');

  // A MARK ON THE WORDS, not a wash across a cell of unknown width.
  const flag = rule('.cell-flag');
  assert.ok(flag.includes('display: block; width: fit-content;'), 'ไฮไลท์กินความกว้างทั้งช่อง');
  assert.ok(flag.includes('background: var(--danger-bg); color: var(--danger-ink);'));
  // AND IT DOES NOT WRAP. Plain text that breaks mid-phrase reads as a sentence
  // continuing; the same break inside a fill reads as a broken box — which is
  // what it did in ประวัติการขอ OT, where the เวลา column is under 100px.
  assert.ok(flag.includes('white-space: nowrap;'), 'ไฮไลท์ตัดคำได้ จะกลายเป็นสองก้อน');
  // TOKENS AND NOT A RED WRITTEN OUT HERE — both are `light-dark()` pairs, so
  // the highlight follows ธีมมืด without a second rule.
  assert.ok(css.includes('--danger-bg: light-dark('));
  assert.ok(css.includes('--danger-ink: light-dark('));

  // `.cell-note` KEEPS THE QUIET AMBER in the same cell — the voice for a line
  // that tells the reader something without moving the figure beside it. It
  // carried ข้ามคืน until 2026-09-10 and carries the ceiling warning now.
  assert.ok(rule('.cell-note').includes('color: var(--amber);'));
  assert.ok(!queue.includes('ข้ามคืน</div>'), 'บรรทัดข้ามคืนกลับมาบนแถวแล้ว');

  // NOT A CHIP. Every pill on that row is a STATUS (รอหัวหน้า · รอ HR ·
  // เหมารายวัน); a fourth one that is not a status is how a reader learns the
  // shape means nothing.
  assert.ok(!/className="chip[^"]*">ไม่พักเที่ยง/.test(queue));
  // AND NOT ON PAPER. The printed form has no theme and no colour here.
  const print = read('components/PrintForm.jsx');
  assert.ok(print.includes('[ไม่พักเที่ยง]'));
  assert.ok(!print.includes('cell-flag'));
  assert.ok(!read('app/print.css').includes('cell-flag'));
});

// ── อนุมัติหลายรายการ (2026-10-08) ──────────────────────────────────────────

test('batch approve: two doors, one sheet, and the ceiling words come from lib/caps.js', () => {
  // A — tick-boxes and a green band; C — a button on the heading.
  assert.match(code, /<th className="check">/);
  assert.match(code, /<td className="check">/);
  assert.match(code, /setBatch\(\{ list: chosenRows, choosable: false \}\)/);
  assert.match(code, /setBatch\(\{ list: approvable, choosable: true \}\)/);
  // Only what the server says is approvable can be ticked, and only for mayEdit.
  assert.match(code, /const approvable = mayEdit \? \(entries \|\| \[\]\)\.filter\(\(e\) => e\.decide\?\.ok\) : \[\];/);
  // One request per ใบ, the same answer คิวรออนุมัติ gives.
  assert.match(code, /await api\.post\(`\/entries\/\$\{e\._id\}\/approve`, note \? \{ note \} : undefined\);/);
  // ไม่ได้สแกน warns and does not block: it never feeds `ready`.
  const modal = code.slice(code.indexOf('function BatchApproveModal'), code.indexOf('export default function HrEntries'));
  assert.match(modal, /SCAN_MATCH\.NO_SCAN/);
  assert.match(modal, /const ready = sel\.length > 0 && \(capped\.length === 0 \|\| why\.trim\(\)\.length > 0\);/);
  assert.match(modal, /overCeilingApproveHead\(capped\.length\)/);
  assert.equal((modal.match(/<textarea/g) || []).length, 1);
  // The bar is drawn on a phone too: `.batch-bar` is display:none there.
  assert.match(css, /\.batch-bar\.entry-bar \{ display: flex;/);
});

test('the history toggle is a chip on the scan row, and the bar it replaced is gone', () => {
  // Mockup B, chosen 2026-10-08: the bordered `.audit-bar` went and its toggle
  // became the end of the scan paragraph's own row — about 50px given back.
  assert.ok(!code.includes('audit-bar') && !css.includes('.audit-bar {'), 'the bar came back');
  assert.match(code, /<div className="scan-row">/);
  assert.match(code, /ประวัติการแก้ไขทั้งหมด <b>\{auditable\.length\}<\/b>/);
  // Disabled, not hidden, with the reason on the tooltip.
  assert.match(code, /disabled=\{!auditable\.length\}/);
  assert.match(jsx, /'เดือนนี้ยังไม่มีรายการใดถูกแก้ไขหรือคำนวณใหม่'/);
  // Same press as before: one toggle for every row's history.
  assert.match(code, /onClick=\{toggleAll\}/);
  // The text may be long and must not push the chip off the card; 44px on a phone.
  assert.match(rule('.scan-row > .hint'), /min-width: 0;/);
  assert.match(css, /\.chip-toggle \{ min-height: 44px;/);
});
