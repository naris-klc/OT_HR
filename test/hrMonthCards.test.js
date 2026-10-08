import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ตรวจสอบรายเดือน บนมือถือ — หนึ่งคน หนึ่งการ์ด พร้อมปุ่มทั้งสอง.
 *
 * This screen was the last table in the app still laid out as a table on a
 * phone. That was a deliberate decision and it is written down beside the two
 * that still are: สรุป OT ส่งบัญชี and สรุป OT แยกแผนก are read DOWN their
 * columns, thirty values of 1.50 reconciled against the paper, and a card per
 * person destroys that. ตรวจสอบรายเดือน looked like the same kind of screen and
 * is not: it is where an employee's month is OPENED and where their F-HR-027 is
 * PRINTED, and those two buttons were the last column of eleven — off the
 * right edge, reached by pushing the whole month sideways past the figures.
 * (Eleven until กฎที่ใช้ came off on 2026-09-04; ten since, and the buttons are
 * still the last of them.)
 *
 * So it is a card list below 860px, and the desktop table is untouched. What is
 * pinned here is the part a later edit can quietly undo:
 *
 *   - ONE markup, two layouts. The desktop table must still be a table — same
 *     ten columns, same order, same cells — or "Desktop Preserved" stopped
 *     being true the moment somebody edited the JSX instead of the stylesheet.
 *   - both buttons on every card, side by side, at a 44px target.
 *   - the card keeps name, code and สะสม / เพดาน, and nothing has to be
 *     scrolled sideways to reach.
 *   - the two accounting tables did NOT come along. They are the reason the
 *     scrolling rules exist at all.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const css = read('app/styles.css');
const hrView = read('components/HrView.jsx');

/**
 * The screen with its commentary stripped — for asking what it SAYS rather than
 * what the file explains about what it says.
 *
 * Four assertions in this file have caught their own comment instead of the
 * code: a note reading "there is no matchMedia here", another reading "NOT
 * sessionStorage", one quoting the very Thai sentence it was checking had not
 * been copied, and — 2026-08-26 — one asserting `.pager-where` was gone,
 * against a file whose note beside that markup explains the wrapper it no
 * longer has. Each looked like a real failure for a minute.
 */
const hrCode = hrView.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * NOTHING IN THIS COMPONENT ASKS HOW WIDE THE SCREEN IS.
 *
 * The card list, the pager, the sticky search bar and every one of the eight
 * columns a phone drops are the stylesheet's, decided at 860px in one place. A
 * component that measured the viewport would be a second answer to a question
 * already answered, and the two would disagree on the day one of them moved.
 *
 * ONE `matchMedia` IS EXEMPT AND THE GUARD NAMES IT RATHER THAN WIDENING.
 * Since 2026-08-26 the suggestion dropdown takes the page to the row it was
 * asked for, and it asks `prefers-reduced-motion` before deciding whether that
 * scroll is smooth — สรุป OT ส่งบัญชี asks the same question in the same words
 * for the same reason. It is a question about MOTION, which has no CSS
 * equivalent for an imperative scroll; it is not a question about layout. So
 * this counts the calls and pins the only one allowed, which is stricter than
 * the flat ban it replaced: a second `matchMedia` of any kind fails here.
 *
 * Asserted from four tests rather than one, because each of them is about a
 * different part of the one markup this file exists to protect.
 */
function layoutIsTheStylesheets() {
  assert.ok(!/innerWidth|isMobile|dvh/.test(hrCode), 'the layout is the stylesheet’s to decide');
  assert.equal(
    (hrCode.match(/matchMedia/g) || []).length, 1,
    'a second matchMedia landed in the component',
  );
  assert.match(hrCode, /window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
}

/** The phone block only — everything above it is the desktop design. */
const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
const desktop = css.slice(0, css.indexOf('@media screen and (max-width: 860px)'));

// ── one markup, two layouts ──────────────────────────────────────────────────

test('the desktop table is still a table, cell for cell', () => {
  // The card is made in the stylesheet. The moment a second markup appears —
  // a phone branch in the JSX — the two layouts can disagree about a month.
  const head = hrView.slice(hrView.indexOf('<table className="hr-table">'), hrView.indexOf('<tbody>'));
  for (const col of ['who-col', 'rate-col', 'total-col', 'count-col',
    'edits-col', 'cap-col', 'act-col']) {
    assert.ok(head.includes(col), `the desktop head lost ${col}`);
  }
  // `rule-col` was among these until 2026-09-04. It is asserted ABSENT now, and
  // from the whole component: กฎที่ใช้ was taken off this screen deliberately,
  // and a column that comes back by accident is the same bug in reverse.
  assert.ok(!hrView.includes('rule-col'), 'กฎที่ใช้ is back on ตรวจสอบรายเดือน');
  layoutIsTheStylesheets();
});

test('the phone layout turns that same table into cards', () => {
  assert.match(phone, /\.hr-table \{ display: block; width: 100%; min-width: 0; \}/);
  assert.match(phone, /\.hr-table thead \{ display: none; \}/);
  assert.match(phone, /\.hr-table tbody \{\s*display: flex; flex-direction: column;/);
  assert.match(phone, /\.hr-table tbody tr \{[\s\S]*?border: 1px solid var\(--line\); border-radius: var\(--radius\);/);
});

// ── what the card carries ────────────────────────────────────────────────────

test('name, code and สะสม / เพดาน — and the seven columns that do not fit are named', () => {
  // The code sits under the name in the same cell, on both layouts — and the
  // name takes the app's own stand-in when the roster has none, so a card is
  // never headed by a blank line with a code under it.
  assert.match(hrView, /<WhoName name=\{row\.employee\.name \|\| '—'\} \/>[\s\S]{0,300}\{row\.employee\.code\}[\s\S]{0,120}\{row\.department\?\.nameTh/);
  assert.match(phone, /\.hr-table tbody td\.who-col \{/);
  assert.match(phone, /\.hr-table tbody td\.cap-col \{/);
  assert.match(phone, /content: 'สะสม \/ เพดาน'/);

  // Hidden by name rather than by a blanket rule with exceptions, so an
  // eleventh column shows up on a phone instead of silently disappearing.
  const hidden = phone.slice(phone.indexOf('.hr-table tbody td.rate-col,'));
  for (const col of ['rate-col', 'count-col', 'edits-col', 'pad-col']) {
    assert.ok(hidden.slice(0, 300).includes(`.hr-table tbody td.${col}`), `${col} is not accounted for`);
  }
});

test('รวม ชม. is dropped because สะสม is the same figure, not because it does not matter', () => {
  // capFigure(usedHours, capHours) — and usedHours is what รวม ชม. prints.
  assert.match(phone, /\.hr-table tbody tr:not\(\.total-row\) td\.total-col \{ display: none; \}/);
  // รวมทั้งหมด has no ceiling cell, so its total comes back in that slot.
  assert.match(phone, /\.hr-table tbody tr\.total-row td\.total-col \{[\s\S]*?grid-area: cap;/);
});

// ── the row is the control, and the one button that is not the row ──────────

test('the whole row opens the person, and it is the same press คิวรออนุมัติ uses', () => {
  // ── ASKED FOR BY NAME, 2026-09-10 ──────────────────────────────────────────
  //
  //   *"ตัดปุ่มแก้ไขออก โดยให้กดที่รายชื่อนั้นเพื่อเข้าไปดูรายละเอียดและแก้ไขแทน"*
  //
  // It read "both buttons are on every card, side by side, at a thumb-sized
  // target" and "the two buttons are not two equal offers" until that day. Both
  // were about ดู / แก้ไขรายการ, which is not a button any more: the pencil at
  // the end of every row (an `.icon-btn.act-open` above 860px, a worded
  // `.btn.outline` on the card below it) is gone, and the `<tr>` carries the
  // press.
  //
  // WHAT THE OLD PAIR ARGUED IS SETTLED RATHER THAN REVERSED. "Two ghosts side
  // by side are two equal offers and these are not equal" was right, and the
  // way it is answered now is that there is one of them.
  assert.ok(!hrView.includes('act-open'), 'the pencil button is back on ตรวจสอบประจำเดือน');
  assert.ok(!hrView.includes("'pencil'"), 'the pencil glyph is back on the row');
  assert.ok(!/\.btn\.act-open\s*[,{:]/.test(css), 'the accent outlived the button it was for');

  // The row says what it opens, and `openRowLabel` still decides the wording:
  // four บทบาท read this screen and only ฝ่ายบุคคล/ผู้ดูแลระบบ may correct a
  // row, so the other two are promised "ดูรายการ" rather than an offer the
  // route answers 403 to. The label moved from a button's face to the row's
  // `title`; it did not change.
  assert.match(hrView, /const openRowLabel = \(mayCorrect\) => \(mayCorrect \? 'ดู \/ แก้ไขรายการ' : 'ดูรายการ'\);/);
  assert.match(hrView, /title=\{openRowLabel\(mayCorrect\)\}/);

  // A tab stop, Enter and Space — a row-shaped control is still a control, and
  // `preventDefault` because Space scrolls the page when nothing claims it.
  assert.match(hrView, /tabIndex=\{0\}/);
  assert.match(hrView, /if \(ev\.key !== 'Enter' && ev\.key !== ' '\) return;/);
  assert.match(hrView, /if \(ev\.target !== ev\.currentTarget\) return;/);

  // ⚠ THE GUARD IS THE POINT OF THE HANDLER, and it is copied from
  // components/ApprovalQueue.jsx to the character. `closest` asks the element
  // actually pressed, so a press on the <svg> inside พิมพ์ is caught — which a
  // check on `ev.target.tagName` is not. Without it, every button inside the
  // row would open this person's list on its way to doing its own job.
  assert.match(
    hrView,
    /if \(ev\.target\.closest\?\.\('button, input, a, label, select, textarea'\)\) return;/,
  );
  const queue = read('components/ApprovalQueue.jsx');
  assert.ok(
    queue.includes("closest?.('button, input, a, label, select, textarea')"),
    'the two screens no longer guard a pressable row the same way',
  );

  // The pointer and the focus ring, matching the queue's own two declarations.
  assert.match(css, /\.hr-table tbody tr\.row-open \{ cursor: pointer; \}/);
  assert.match(css, /\.hr-table tbody tr\.row-open:focus-visible \{ outline-offset: -2px; \}/);
  // รวมทั้งหมด is not a person and opens nothing — and it needs no rule to say
  // so, because the class is written per row and that row never carries it.
  const totalRow = hrView.slice(hrView.indexOf('<tr className="total-row">'));
  assert.ok(!totalRow.slice(0, totalRow.indexOf('</tr>')).includes('row-open'));
});

test('the action column was resized when it lost a button, and แผนก got the room', () => {
  /**
   * ── ⚠ A MEASUREMENT THAT OUTLIVED WHAT IT MEASURED ────────────────────────
   *
   * `th.act-col { width: 258px }` was cut against TWO WORDED BUTTONS. On
   * 2026-09-10 the first of them stopped being a button — the row itself opens
   * the person now — and the width stayed behind for a commit. Reported as
   * *"ตารางไม่สวยเลย ความกว้างของแต่ละคอลัมน์ไม่สมดุล"*.
   *
   * ON `table-layout: auto` A RESERVED WIDTH IS NOT EMPTY SPACE. It is taken
   * from the columns that have to wrap — so this table spent a quarter of
   * itself on one 32px icon while แผนก, which has no width of its own and holds
   * Thai (no spaces, broken by the browser's dictionary), came out as
   * `แผนก / บัญชี / และ / การ / เงิน`, five lines deep, beside 200px of nothing.
   *
   * The lesson is not the number. It is that a width and the thing it was
   * measured against have to move together, so this pins the pair.
   */
  // The shared 258 stays for whoever still holds worded buttons.
  assert.match(css, /th\.act-col \{ width: 258px; \}/);

  /* ⚠ 104 SINCE 2026-09-11, AND IT WAS 64. The cell holds TWO squares now —
     *"เพิ่ม icon อนุมัติ ในตารางด้วย"* — and this is the pair the test exists to hold together: two 34px
     buttons + the 6px gap + the cell's two 12px gutters is 98, rounded to 104 so
     the focus ring is not clipped by the card's edge. */
  assert.match(css, /\.hr-table th\.act-col \{ width: 104px; \}/);
  const cell = hrView.slice(hrView.indexOf('<td className="act-col">'), hrView.indexOf('</tr>', hrView.indexOf('<td className="act-col">')));
  // RowAction squares since 2026-10-08 — 32px each, so the 104 still holds.
  assert.equal((cell.match(/<RowAction\b/g) || []).length, 2, 'act-col holds a different number of buttons than 104px was cut for');

  // Where the room went. `dept-col` had NO width on this screen before — it was
  // whatever `auto` left over, and what `auto` left over was nothing.
  /* ⚠ 168 SINCE 2026-09-11 รอบสอง, AND IT WAS "196" — which is the same lesson
     this test was written for, read the other way round. The 196 was not a
     measurement either: it was what was LEFT of the 194 `act-col` gave back,
     spent because it was there. When `count-col`'s labels gained `รอ` and the
     column needed 40px, this was the one place on the row carrying width
     nothing had been measured against. `นางสาวสสุคนธ์ ข่าค่ำ` is 128.6px
     at 14px/400 off the font file, so 152.6 with the gutters — 168 still draws
     it on one line. See test/monthCountStatus.test.js for the whole budget. */
  /* 264 since 2026-10-08 — the 40px `count-col` gave back when its second
     line moved into a tooltip (136 → 96). */
  assert.match(css, /\.hr-table th\.who-col \{ width: 264px; \}/);
  /* 160 since 2026-09-11, and it was 132 — *"ปรับขนาดคอลัมน์ของตารางให้สมดุล"*. 132 was measured to hold
     แผนกบัญชีและการเงิน and did not get it, because a declared width under
     `table-layout: auto` is only honoured once the table fits; `th.cap-col`'s
     shared 224 was taking the room back out of the one column that wraps. */
  assert.doesNotMatch(css, /\.hr-table th\.dept-col/, 'แผนก is a line of พนักงาน now, not a column');
  // 140 since 2026-09-11 รอบสอง, and it was "152" — the other twelve of that
  // 40px. `รวมรออนุมัติ 45 / 40` measures 107.2px, wanting 131.2 with the
  // gutters, so 140 still keeps 9px over the longest line it holds.
  assert.match(css, /\.hr-table th\.cap-col \{ width: 140px; \}/);
  // Thai wraps by dictionary, so the cell needs `normal` or the shared `th`
  // nowrap holds the heading while the cell still breaks — a column sized by
  // neither of the two things in it.
  assert.match(css, /\.hr-table td\.who-col \.who-name,\s*\.hr-table td\.who-col \.cell-sub \{ white-space: normal; \}/);
  // All four scoped: the queue's own crowd of columns is measured against the
  // shared rules and is not touched.
  assert.match(css, /th\.who-col \{ width: 168px; \}/);
  assert.match(css, /^th\.cap-col \{ width: 224px; \}/m);
});

test('พิมพ์ F-HR-027 stayed, because it is the one act that is not "open this person"', () => {
  const cell = hrView.slice(hrView.indexOf('<td className="act-col">'), hrView.indexOf('</tr>', hrView.indexOf('<td className="act-col">')));
  // It is not a duplicate of the row press: it prints one employee's sheet
  // without leaving the month, and there is nowhere else on this screen to
  // print one from. Folding it into the row would mean opening a person and
  // coming back out to get the paper.
  assert.match(cell, /พิมพ์ F-HR-027/);
  assert.match(cell, /icon="printer"/);
  assert.ok(!cell.includes('act-open'));

  // ⚠ HIDDEN, NOT REMOVED, above 860px. `display: none` would take the label
  // out of the accessibility tree and leave `aria-label` as the only name.
  // App-wide since 2026-10-08: every RowAction hides its word the same way.
  assert.match(css, /\.btn\.act-icon \.btn-word \{[\s\S]*?clip-path: inset\(50%\);/);
  // …and the phone card puts the words back, because down there this cell is
  // the foot of a person's card rather than a column of a table.
  assert.match(phone, /\.hr-table tbody td\.act-col \.row-actions \.btn \.btn-word \{/);

  // `.row-actions` around ONE button looks like over-fitting until you read the
  // phone block: it is what gives that button its full card width and its 44px.
  assert.match(phone, /\.hr-table tbody td\.act-col \{[\s\S]*?grid-area: act;/);
  assert.match(phone, /\.hr-table tbody td\.act-col \.row-actions \{ flex-wrap: nowrap; gap: 8px; \}/);
  assert.match(phone, /\.hr-table tbody td\.act-col \.row-actions \.btn \{\s*flex: 1 1 0;[\s\S]*?min-height: 44px;/);
});

test('the card spacing and the sub-line take the values the queue card already uses', () => {
  assert.match(phone, /\.hr-table tbody \{\s*display: flex; flex-direction: column; gap: 12px;/);
  // …and 12px of white between two white cards is 12px of the same white. The
  // ground has to go back a step or the gap is not a gap, it is a hairline.
  assert.match(hrView, /className="table-wrap card-list"/);
  // `--bg`, the page's own colour, and not `--neutral-wash`: the wash is a 3%
  // step off a white card, which is a table's header strip and not ground.
  assert.match(phone, /\.table-wrap\.card-list \{ background: var\(--bg\); \}/);
  // "เพดานนับ 38.5 / 40 · รวมใบที่รออนุมัติ" — the same two values คิวรออนุมัติ
  // gives this same sentence on its own card.
  assert.match(phone, /\.hr-table tbody td\.cap-col \.cap-sub \{[\s\S]*?font-size: 11px; color: var\(--muted-2\);/);
  assert.match(phone, /\.queue-table td\.cap-col \.cap-sub \{ font-size: 11px; color: var\(--muted-2\); \}/);
});

/**
 * ── ONE CARD IS THE SAME SIZE AS THE NEXT ONE ────────────────────────────────
 *
 * Reported on 2026-08-26 with a screenshot: four people in one month, four
 * cards, four different heights — 139px, 161px, 139px and 183px at 360px. Two
 * things made them, and both were the ceiling cell rather than anything about
 * the people:
 *
 *   THE TRACK. `auto` let that column size itself from its widest child, which
 *   is the sentence under the figure — so a card with something pending gave it
 *   175px of the 250 available and left 61px for the name, which then wrapped
 *   down three lines. The card under it with nothing pending gave it 67px and
 *   kept the name on one.
 *
 *   THE SENTENCE. `pendingCapNote` returns null on a settled month, so the line
 *   was on some cards and not others, and the ones without it came out shorter.
 *
 * Both are pinned here because both are invisible in a screenshot of a month
 * where everybody happens to have something pending.
 */
test('every card is the same height — the ceiling column is a fixed track with a reserved line', () => {
  // A TRACK, not `auto`: the sentence no longer decides how much of the card
  // the name gets. 108px clears the `สะสม / เพดาน` heading and the figure —
  // the two things that must not wrap — and is deliberately too narrow for the
  // sentence, which is what makes the sentence two lines on EVERY card.
  const cardRule = phone.slice(phone.indexOf('.hr-table tbody tr {'));
  // ⚠ A THIRD TRACK LEADS IT SINCE 2026-09-10 — `auto`, for the tick-box, and
  // `auto` precisely so it can COLLAPSE: `showPickCol` takes the column off a
  // reader who does not sign at this step, and a fixed first track would indent
  // every name on the card past a box that is not drawn. The 108px it is
  // measured against is untouched, which is the claim this test is really
  // making.
  //
  // (That read "takes the column off a month with NOTHING TO CONFIRM" until
  // 2026-09-11. The column stopped hiding on such a month — it is drawn
  // disabled instead — so the track collapses on fewer readings than it did,
  // and on none that this test measures. `auto` is still what it must be:
  // `mayCorrect` is false for การเงิน and the three signers, who read this
  // table and never tick anything on it.)
  assert.match(cardRule, /^\.hr-table tbody tr \{\s*display: grid;[\s\S]{0,600}?grid-template-columns: auto minmax\(0, 1fr\) 108px;/);
  // Scoped to this rule: `.bmonth-table` next door is a card with an `auto`
  // second track and has every right to be.
  assert.doesNotMatch(cardRule.slice(0, 400), /grid-template-columns: minmax\(0, 1fr\) auto;/);

  // Two lines held open whether or not there is anything to say in them.
  assert.match(phone, /\.hr-table tbody td\.cap-col \.cap-sub \{[\s\S]*?min-height: 2\.9em;/);

  // …and the element is drawn unconditionally, or there would be nothing for
  // the reserve to apply to. This is the half of the fix that lives in the
  // component, and it is the half a later edit is most likely to "tidy" back
  // into a `&&`.
  // `cap-sub` is still the class; `over` rides on top of it on a breach and
  // changes only the colour and the weight, so the reserved height holds either
  // way. What must not come back is the `&&` — that is what made cards two
  // different heights in the first place.
  assert.match(hrCode, /<div className=\{over \? 'cap-sub over' : 'cap-sub'\}>\{note\}<\/div>/);
  assert.doesNotMatch(hrCode, /\{note && <div className=/);
});

/**
 * BOTH HALVES OF A COLUMN THAT PROMISES TWO.
 *
 * `td.cap-col::before` redraws the heading "สะสม / เพดาน" over every card, and
 * a department with no ceiling used to answer it with one number. `capPair`
 * is the shared helper that prints "3 / —" instead — shared with คิวรออนุมัติ,
 * whose column carries the same heading, so the two screens cannot come to
 * quote one person's month in two shapes.
 */
test('a card with no ceiling still answers สะสม / เพดาน with two figures', () => {
  assert.match(hrCode, /capPair\(cap\.usedHours, cap\.capHours\)/);
  // The sentences on this screen keep the other form on purpose: "รวมทั้งหมด 9
  // · รวมใบที่รออนุมัติ" and the dropdown's "แผนก | 3 ชม." both read worse with
  // a dash in them, and `pendingCapNote` already says the ceiling is not there.
  assert.match(hrCode, /capFigure\(row\.cap\.usedHours, row\.cap\.capHours\)/);
});

// ── หน้าละ 5 คน ──────────────────────────────────────────────────────────────

/**
 * ONE PAGER AT BOTH WIDTHS — 2026-10-08.
 *
 * Until then this file pinned "five to a page, and the page is the whole of the
 * mechanism" (`CARD_PAGE = 5`, a phone-only `.pager-row` inside the `<tbody>`)
 * and "the fold under the third card exists only where the pager does not"
 * (`CARD_FOLD = 3`), with the desktop drawing all ~77 people of a month. The
 * user replaced both with the shared `TablePager` at both widths, 50 to a page,
 * and no band at all on a month of 50 or fewer. What those tests protected is
 * kept below in the new shape: ONE mechanism over one list, a page that is a
 * CLASS rather than a slice, and nothing a hidden band can leave hidden.
 */
test('the month pages through the shared band, at both widths', () => {
  assert.ok(!/CARD_PAGE|CARD_FOLD|showAllCards|cards-more-row|pager-row/.test(hrCode),
    'the phone’s own pager or the fold came back — two mechanisms over one list');
  assert.equal(hrCode.match(/<TablePager\b/g)?.length, 1, 'one table, one band');
  assert.match(hrCode, /const \[pageSize, setPageSize\] = useState\(PAGE_SIZE\);/);
  assert.match(hrCode, /const win = pageWindow\(page, pageSize, shown\.length\);/);
  assert.match(hrCode, /className="flush-pager no-print"/);
  assert.match(hrCode, /total=\{shown\.length\}/);
  assert.match(hrCode, /page=\{win\.at\}/);
  // The band is a block under the table, never a row inside it.
  assert.ok(hrView.indexOf('<TablePager') > hrView.indexOf('</table>'),
    'the band went back inside the table body');
  layoutIsTheStylesheets();
});

test('the page is a class on a row, never a slice — the month prints whole', () => {
  // `win.from`/`win.to` are every row on a month of 50 or fewer, so a hidden
  // band can never leave a row hidden.
  assert.match(hrView, /`row-open\$\{i < win\.from \|\| i >= win\.to \? ' off-page' : ''\}/);
  assert.ok(!/shown\.slice\(/.test(hrCode), 'the page sliced the month — Ctrl+P would print one page of it');
  assert.match(hrCode, /\{shown\.map\(\(row, i\) => \(/);
  // Hidden on screen at every width, put back on paper.
  assert.match(desktop, /\.hr-table tbody tr\.off-page \{ display: none; \}/);
  assert.match(read('app/print.css'), /\.hr-table tbody tr\.off-page \{ display: table-row !important; \}/);
  // Still no bare `.off-page` selector, which would reach every table there is.
  assert.ok(!/(^|[\s,])\.off-page\s*\{/m.test(css),
    'an unqualified .off-page rule — it reaches every table in the app');
});

test('a page that no longer exists is clamped, not drawn empty', () => {
  // `load()` can shorten the list without the month, the filter or the search
  // changing — HR withdraws the last live entry of the only person on the last
  // page. `pageWindow` clamps at render, so the empty page never exists for a
  // frame, and `page` is left alone.
  assert.ok(
    !/setPage\(Math\.min/.test(hrCode) && !/useEffect[^)]*pageCount/.test(hrCode),
    'the clamp became an effect, which draws the empty page for one frame first',
  );
});

test('a new page starts at the top of the list, and only when a button asks', () => {
  // The pager sits under the FIFTH card, so ถัดไป is pressed with five cards'
  // worth of list above the thumb. Without this the next five people are drawn
  // up there, out of the viewport, and a button whose label did not change
  // appears to have done nothing. Found by walking it on 2026-08-25.
  assert.match(hrView, /const listRef = useRef\(null\);/);
  // On the WRAP, not the tbody: the wrap is the top of the list and it is what
  // carries the `scroll-margin-top` that clears the app bar.
  assert.match(hrView, /<div className="table-wrap card-list" ref=\{listRef\}>/);
  assert.match(
    hrCode,
    /function goPage\(next\) \{\s*setPage\(next\);\s*listRef\.current\?\.scrollIntoView\(\{ block: 'start' \}\);\s*\}/,
  );
  // The band calls it for every press — ‹, ›, and each page number.
  assert.match(hrCode, /onPage=\{goPage\}/);
  // IN THE HANDLER AND NOT ON AN EFFECT. `scrollTop = 0` was the same act as
  // resetting the box, because the box was the thing scrolled; the page is now,
  // and an effect over `[current, find, period, …]` would fire on mount and on
  // every keystroke in the search box — the screen jumping down to the list
  // while somebody is still typing above it.
  assert.ok(!/scrollTop = 0/.test(hrCode), 'the box’s scroll reset outlived the box');
  assert.ok(!/useEffect[^;]*scrollIntoView/.test(hrCode), 'the scroll went back onto an effect');
  // And how far down to stop is the stylesheet's, because the bar it clears is.
  //
  // NOT 156. It was 156 while `.month-find` was stuck under the app bar as
  // well — 62 of `.appbar` plus 69 of the box plus the line the search adds —
  // and the box stopped being sticky on 2026-08-26 (see
  // test/monthSearch.test.js). Walked and measured, not derived: the first card
  // landed at 86 in the viewport with the app bar's bottom edge at 62.
  //
  // AND 86 AND NOT 74, since the card round the list came off later on
  // 2026-08-27. The figure says the same sentence it always did — the app bar's
  // 62 plus 24 of air over the first card — and what moved underneath it is who
  // owns those 24. While `.hr-table tbody` padded by 12 the wrap's top edge
  // stood 12px above the first card and 74 was enough; that padding is 0 now,
  // so the wrap's edge IS the card's and the whole 24 has to be stated here. A
  // number measured THROUGH another rule's padding goes stale when that padding
  // does, silently, which is why both halves of it are written down.
  assert.match(phone, /\.table-wrap\.card-list \{ overflow: visible; scroll-margin-top: 86px; \}/);
  layoutIsTheStylesheets();
});

test('nothing on this screen is a scrollport any more', () => {
  const box = phone.slice(phone.indexOf('.hr-table tbody {'));
  const rule = box.slice(0, box.indexOf('}'));
  // The list is five cards long, which is a length the PAGE scrolls. The four
  // declarations that made it a box — "max-height: 42dvh", "min-height: 260px",
  // `overflow-y: auto` and `overscroll-behavior: contain` — went together, and
  // `overscroll-behavior` went because there is no nested scroll left to
  // contain, not because it stopped being the right pairing for one.
  for (const gone of ['max-height', 'min-height', 'overflow', 'overscroll-behavior']) {
    assert.ok(!rule.includes(gone), `the list is still a box: ${gone}`);
  }
  // `0` since 2026-08-27, and it has been three values in one day: "12px" while
  // the card round this list padded by another 12, "12px 24px" for the hours
  // the wrap was pulled full-bleed through that padding, and nothing at all now
  // the card is gone and the page's own 12px is what bounds the list. The test
  // headed "there is no card round the list, so there is nothing to pull out
  // through" owns that history. What this one is about is that the shorthand is
  // still a PADDING and not a box.
  assert.match(rule, /display: flex; flex-direction: column; gap: 12px; padding: 0;/);
  // …and the wrap must not become one by inheritance: `.table-wrap` is
  // `overflow-x: auto` at every other width, which computes `overflow-y` to
  // `auto` as well and would be the inner scrollbar all over again.
  assert.match(phone, /\.table-wrap\.card-list \{ overflow: visible;/);
  // Above 860px there was never a box.
  assert.ok(!/\.hr-table tbody \{[^}]*max-height/.test(desktop), 'the box reached the desktop table');
});

test('the total closes the list, and the band sits under the table', () => {
  // It read "the pager sits under the fifth card, above the total, and disables
  // its ends" until 2026-10-08. The phone's `.pager-row` is gone; the shared
  // band's ends, names and disabled voice are pinned in test/tablePager.test.js.
  assert.ok(!hrView.includes('<BirthdayMonth'), 'วันเกิดของเดือนนี้ came back');
  assert.ok(
    hrView.indexOf('<tr className="total-row">') < hrView.indexOf('<TablePager'),
    'the band ended up inside the list, above รวมทั้งหมด',
  );
  // รวมทั้งหมด states its own gap over the last card, twice the cards' pitch.
  assert.match(phone, /\.hr-table tbody \{\s*display: flex; flex-direction: column; gap: 12px;/,
    'the list stopped being a flex column — margin and gap no longer add up');
  assert.match(phone, /\.hr-table tbody tr\.total-row \{[^}]*margin-top: 12px;/);
  // The app-wide disabled rule is untouched.
  assert.match(css, /\.btn:disabled,[\s\S]{0,200}background: var\(--neutral-wash\);/);
  assert.ok(!/pager-step:disabled \{[^}]*opacity/.test(css),
    'a disabled chevron went back to being faded');
});

test('รวมทั้งหมด is the last card, not a bar over the page', () => {
  const total = phone.slice(phone.indexOf('.hr-table tbody tr.total-row {'));
  const rule = total.slice(0, total.indexOf('}'));
  // THE THIRD POSITION THIS ROW HAS HELD, and the first that floats over
  // nothing: it was pinned to the VIEWPORT eight pixels above the nav bar
  // ("bottom: calc(82px + env(safe-area-inset-bottom))"), then to the foot of
  // the list's own scrollport ("bottom: 0"). Five cards is a short scroll, and
  // a total left floating would lie over วันเกิดของเดือนนี้ — the one section
  // on this screen that is work — for the whole of the page below the list.
  for (const gone of ['position:', 'bottom:', 'z-index', 'box-shadow', 'safe-area-inset-bottom']) {
    assert.ok(!rule.includes(gone), `the total is floating again: ${gone}`);
  }
  // The fill stays: it is what says this row is the month's rather than another
  // person's, which it did before it was ever sticky.
  assert.match(rule, /background: var\(--neutral-wash\);/);
  assert.ok(!desktop.includes('.hr-table tbody tr.total-row'), 'the phone rule reached the desktop table');
});

test('neither the box nor the page is a filter', () => {
  // รวมทั้งหมด is the month's, from the server's own grandTotal.
  assert.match(hrView, /hours\(data\.grandTotal\.otHours\)/);
  // พิมพ์รวม prints every person the SEARCH matched, on this page or not.
  assert.match(hrView, /setPrinting\(\{ employees: shown\.map\(\(r\) => r\.employee\) \}\)/);
  // And the page goes back to 1 whenever the list underneath it changes.
  // `query` and not `find` since the debounce landed: the list is rebuilt when
  // the APPLIED search changes, and resetting on the keystroke would put the
  // pager back to 1 three hundred milliseconds before the list under it moved.
  // The fold under the third card resets with it and for the same reason —
  // neither is a state the reader carried into the new list.
  //
  // `dept` IS THE FOURTH, SINCE 2026-09-10. It is the one of the four that
  // refetches, so it is the one that can replace the list wholesale — page 8 of
  // ทุกแผนก left where it was, and then ผลิต2 loaded with four people in it.
  //
  // `onlyFlagged` IS THE FIFTH, the same day and one round later: the summary
  // card's ดูเฉพาะคนที่ต้องตรวจ takes a month of sixty down to eleven, which is
  // a shorter list than page 8 has any claim on. It is a screen filter like
  // `query` and belongs in this list for `query`'s reason, not `dept`'s.
  //
  // `pageSize` IS THE SIXTH, SINCE 2026-10-08, when the page-size box arrived
  // with the shared band; the fold's own reset (`setShowAllCards(false)`) went
  // with the fold.
  assert.match(
    hrView,
    /setPage\(1\);\s*\}, \[period, statusFilter, dept, query, onlyFlagged, pageSize\]\);/,
  );
  // Picking somebody from the dropdown moves the page too, and that is NOT this
  // reset: it is the page that HOLDS them, so the card exists to be scrolled to
  // at all below 860px. Pinned in test/monthSearch.test.js beside `goToRow`.
  assert.match(hrView, /if \(i >= 0\) setPage\(Math\.floor\(i \/ pageSize\) \+ 1\);/);
});

test('รวมทั้งหมด is a card too, and has no buttons to offer', () => {
  // A total is not a person: nothing to open and nothing to print.
  const total = hrView.slice(hrView.indexOf('<tr className="total-row">'));
  assert.ok(!total.slice(0, total.indexOf('</tr>')).includes('act-col'));
  assert.match(phone, /\.hr-table tbody tr\.total-row \{\s*grid-template-areas: 'who cap';/);
});

// ── and what is said UNDER it ────────────────────────────────────────────────

test('the raw-hours summary is not the total card said twice', () => {
  // `hrSummary()` under `hrSummaryBasis: 'raw'` returns the two ×1.5 buckets
  // added up, the ×3 bucket, and their sum — the three figures รวมทั้งหมด has
  // just printed. On a phone that card IS the foot of the list, so the
  // sentence landed directly under the numbers it repeated.
  assert.ok(
    !hrView.includes('ชั่วโมงดิบ ยังไม่คูณอัตรา'),
    'the raw basis is printing its own summary again',
  );
  // 'multiplied' is the case it is kept for: the hours come out multiplied by
  // their rates, so they are NOT the table's figures and this line is the only
  // place on the screen they appear.
  assert.match(hrView, /data\.hrSection\.basis === 'multiplied' && \(/);
  assert.match(hrView, /สรุปสำหรับฝ่ายบุคคล \(คูณอัตราแล้ว\)/);
});

const STRIP = '<MonthAlerts';

/* ── แจ้งเตือนของเดือน เป็นแถวในกล่องเดียวของหน้า — 2026-10-08 ──────────────
   สามเทสต์ตรงนี้เคยยึด `MonthAlerts` ทรงเก่า: `<Alert>` กล่องเดียวที่มีหัว
   "แจ้งเตือนของ {เดือน}", รายการ `.alerts-list`, ปุ่ม `.fold-pill` และ ✕ ที่จำไว้
   จนกว่าจะรีเฟรช · วันนั้นแจ้งเตือนทั้งแอปเป็นระบบเดียว (`NoticeStack` /
   `NoticeRow` ใน components/common.jsx) และ MonthAlerts เหลือแค่ "มีเรื่องอะไร"
   — กล่อง การพับ และการซ่อน เป็นของระบบกลาง

   ที่ยังยึดไว้คือเหตุผลเดิม: ไม่มีกล่องที่สอง · ทุกคำของแจ้งเตือนกฎมาจากโมดูลของ
   มันเอง · และหน้านี้ไม่ส่งทางกลับมาหน้าตัวเอง */
const monthAlerts = () => hrView.slice(hrView.indexOf('function MonthAlerts('), hrView.indexOf('function CapCell('));

test('แจ้งเตือนของเดือนเป็นแถวในกล่องของหน้า ไม่ใช่กล่องที่สอง', () => {
  const strip = monthAlerts();
  assert.ok(!strip.includes('<Alert'), 'MonthAlerts วาดกล่องของตัวเองอีกแล้ว');
  assert.match(strip, /<PolicyVersionBanner spread=\{policy\} \/>/);
  assert.match(strip, /<NoticeRow\s+tone="info"\s+title=\{`HR อนุมัติชั้นเดียว \$\{hrVerifiedCount\} รายการ`\}/);
  assert.ok(!hrView.includes('HrVerifiedNotice'), 'the blue panel is still a component on this screen');
  // ตรวจสอบใบของพนักงาน ส่งทางกลับไปหน้าที่ประโยคที่สี่เอ่ยชื่อ
  assert.match(
    read('components/HrEntries.jsx'),
    /<PolicyVersionBanner spread=\{spread\} onGoMonthly=\{onClose\} \/>/,
  );
});

test('an item is a heading, its figures, and the one sentence that says what to do', () => {
  const pv = read('components/PolicyVersion.jsx');
  // หัวเรื่อง = สิ่งที่ผิด · รายละเอียด = ไปดูที่ไหน · รายชื่อเวอร์ชัน (หลักฐาน) หลัง ▾
  assert.match(pv, /<NoticeRow tone=\{notice\.kind\} title=\{notice\.heading\} detail=\{notice\.say\} more=\{notice\.figures\} \/>/);
  // ตรวจก่อนเซ็นรับรอง is the whole reason the policy notice exists — carried
  // from the notice's own module rather than retyped on the screen.
  assert.match(pv, /ตรวจยอดก่อนเซ็นรับรอง/);
  assert.match(pv, /figures: named\.join\(' · '\),/);
  assert.match(pv, /say,/);
  assert.ok(!hrCode.includes('ตรวจยอดก่อนเซ็นรับรอง'), 'the policy wording was copied into the screen');
  for (const only of ['ตัวเลขเทียบกันได้ตามปกติ', 'npm run migrate:policy-version', 'ไม่ได้โหลดกฎมาเทียบ']) {
    assert.ok(pv.includes(only), `the ${only} case went missing`);
  }
});

test('ไม่มี ✕ ไม่มีปุ่มพับของตัวเอง และไม่ส่งทางกลับมาหน้าตัวเอง', () => {
  const strip = monthAlerts();
  for (const gone of ['fold-pill', 'onClose=', '<details', 'alerts-list', 'setShut']) {
    assert.ok(!strip.includes(gone), `${gone} กลับมาใน MonthAlerts`);
  }
  // ไม่มี `onGoMonthly` — หน้านี้คือ ตรวจสอบรายเดือน ลิงก์กลับมาที่เดิมแย่กว่าไม่มี
  assert.ok(!strip.includes('onGoMonthly'), 'ส่งทางกลับมาหน้าตัวเอง');
  assert.match(
    read('components/PolicyVersion.jsx'),
    /export function policyVersionNotice\(spread, \{ onGoMonthly \} = \{\}\) \{/,
  );
});

test('the panel is above the marks it explains, which one of them once only claimed', () => {
  // The marks are the per-row `HR อนุมัติชั้นเดียว n` under รายการ and the chip
  // on the rows themselves. That sentence spent its life below the month's
  // total — on a phone, below วันเกิดของเดือนนี้ as well — where a reader who
  // has finished the rows has finished asking.
  const strip = hrView.indexOf(STRIP);
  assert.ok(strip > 0, 'the panel was not found');
  /* ⚠ IT READ "FIRST OF EVERYTHING" UNTIL 2026-09-11 — above the card, above
     the export button, above every control on the screen. What is load-bearing
     in that sentence is the SECOND half of it: the person it warns is the one
     about to sign the figures, and a warning read after พิมพ์ has been pressed
     is a warning that arrived late. Everything above `.queue-tools` satisfies
     it; being first did not add anything the reader could use.

     WHAT MOVED IT was the round that took the four floating blocks into the
     card (*"อยากให้กลมกลืนเป็นส่วนเดียวกันเหมือนส่วนหัวของหน้า รออนุมัติ ot"*).
     Inside `.month-notices` the three notices had to be put in SOME order, and
     งวด…ยังเปิดอยู่ and ผลเทียบสแกน answer *may this month be signed at all*
     while this one is a digest of things to know while signing it. It is also
     THE ONLY ONE A READER CAN CLOSE — dismissing the first of three leaves a
     hole between two that stay.

     So what is measured here now is the property, not the position: above the
     bar, above the month box, above the table. */
  // ⚠ `.month-notices` จนถึง 2026-10-08 — ตอนนี้คือ `NoticeStack` ของหน้า
  assert.ok(
    strip > hrView.indexOf('<NoticeStack id="month">'),
    'the panel left the notices band',
  );
  assert.ok(strip < hrView.indexOf('<PickMonth'), 'the panel is under the period box');
  assert.ok(
    strip < hrView.indexOf('<div className="queue-tools">'),
    'the panel is under the filter bar',
  );
  assert.ok(strip < hrView.indexOf('<table className="hr-table">'), 'the panel is still under the table');
  // AND IT IS INSIDE THE CARD, which is the whole point of the move — the four
  // notices are a section of the panel now, not four blocks stacked on top of
  // it. `.month-head` is still the phone block's handle on the padding; see the
  // ledger over `.month-head` in app/styles.css.
  /* ⚠ "INSIDE THE CARD" UNTIL 2026-10-08 — that day every page's notices moved
     to the top of the page, above the card (*"ย้ายแบนเนอร์การแจ้งเตือนทั้ง App
     เอาไว้ส่วนบนสุด"*). The property that matters — read before the table —
     holds either way. */
  assert.ok(
    strip < hrView.indexOf('<div className="card flush month-panel">'),
    'the notices went back inside the card',
  );
  // ⚠ AND `<ExportMenu` IS NOW ABOVE IT, which this asserted the reverse of.
  // The head is a title and the card's verbs; the band under it is what a reader
  // checks before pressing one. Reading order down the card is unchanged.
  // …and it can only be up there because it names the month itself; the assert
  // for that is in the first test in this group.
  assert.match(hrView, /\{data && \(\s*<MonthAlerts/);
  // And อนุมัติชั้นเดียว is out of the footnote wrapper it used to live in.
  const open = hrView.indexOf('<div className="month-notes">');
  assert.ok(!hrView.slice(open, hrView.indexOf('</>', open)).includes('hrVerifiedCount'), 'the notice is still a footnote');
  // Which can now leave that wrapper with no children at all.
  assert.match(phone, /\.month-card > \.month-notes:empty \{ display: none; \}/);
  // The notes that stayed: footnotes to figures already read, not warnings to
  // read before starting.
  const notes = hrView.slice(open, hrView.indexOf('</>', open));
  assert.ok(notes.includes('supersededCount') && notes.includes('birthDates'), 'the footnotes were pulled up too');
  layoutIsTheStylesheets();
});

test('แจ้งเตือนของเดือนไม่อยู่เกินเดือนของมัน และการซ่อนเป็นของกล่องกลาง', () => {
  // Remounted by key: every count it draws is the server's over ONE month at ONE
  // สถานะที่นับ in ONE แผนก, so none of them may outlive what they describe.
  assert.match(hrView, /key=\{`\$\{period\}\|\$\{statusFilter\}\|\$\{dept\}`\}/);
  /* ⚠ ✕ ที่จำไว้จนรีเฟรช (`alertsDismissed`) และลิงก์ แสดงแจ้งเตือนของ… ถูกถอด
     2026-10-08 — ปุ่ม ซ่อน/แสดง ที่หัว `NoticeStack` ทำแทน และอยู่ใน common.jsx
     ที่เดียว หน้านี้จึงไม่แตะที่เก็บข้อมูลของเบราว์เซอร์เอง */
  assert.ok(!hrView.includes('alertsDismissed ='), 'the old dismissal came back');
  assert.ok(!/(session|local)Storage\s*[.[]/.test(hrView), 'this screen keeps its own storage');
});

test('.fold-pill is a class', () => {
  // Worn by a `<button>`, so it resets what a button brings with it — a UA
  // background, border and font — none of which a `<summary>` has.
  assert.match(css, /\.fold-pill \{[\s\S]*?background: none; color: inherit; cursor: pointer;/);
  // A MINI PILL, not a button. Smaller AND lighter — 12.5px at weight 500
  // rather than 12px at 600, which is the only combination that drops the
  // visual weight without making the label harder to read — on a line at 28% of
  // the panel's own ink rather than 35%.
  assert.match(css, /\.fold-pill \{[\s\S]*?padding: 3px 10px;/);
  assert.match(css, /\.fold-pill \{[\s\S]*?font: 500 12\.5px\/1\.4 var\(--sans\);/);
  assert.match(css, /\.fold-pill \{[\s\S]*?currentColor 28%, transparent\);/);
  // 34px on a phone: this app's OTHER touch floor, the one `.queue-mobile-bar`'s
  // undo has had since the batch bar, for controls that sit beside a decision
  // without being one. `test/batchBarSticky.test.js` says so in as many words.
  assert.match(phone, /\.fold-pill \{ min-height: 34px; padding: 4px 12px; \}/);
  // 44px is for the decisions, and the two on every employee card still keep it
  // on this same screen.
  assert.match(phone, /\.hr-table tbody td\.act-col \.row-actions \.btn \{[\s\S]*?min-height: 44px;/);
  /* ── AND `.export-row` IS GONE ENTIRELY — 2026-09-10 ──────────────────
   *
   * It held three buttons, then one, then none: พิมพ์ / ส่งออก is in the card
   * head now, which is where every other card in this app puts its action. Both
   * of its rules went with it — the 12px desktop gap and the 8px phone one —
   * and so did the two-column grid, the `align-items: stretch` that undid
   * `.row`'s `flex-end` for it, and the 44px touch floor on its children.
   *
   * WHAT THE STRETCH WAS FOR, kept as a note because the trap is still real
   * wherever a `.row` becomes a grid: a grid inherits `align-items` from the
   * class beside it, so the two CSVs hung from the bottom of their row instead
   * of filling it — 67.5px beside 53px at 320–360px, the short one floating
   * with a 14px gap over it, invisible until one label took a second line.
   *
   * THE 44px FLOOR IS NOT LOST WITH IT. `.btn` states it at this width, and
   * `.card-head .btn.sm` restates it for the head the button now sits in — with
   * `.card-head:has(> .row .btn)` making that button full width, which is what
   * the grid was doing by hand. */
  assert.ok(!css.includes('.export-row {'), '.export-row came back — the button left the card head');
  assert.match(phone, /\.card-head:has\(> \.row \.btn\) \{ flex-direction: column; align-items: stretch; gap: 10px; \}/);
  assert.match(phone, /\.card-head \.btn\.sm,[\s\S]{0,400}?min-height: 44px;/);
  // The two-label mechanism went with the fold it belonged to. Dead rules for a
  // markup nothing writes any more are rules a reader has to account for.
  assert.ok(!css.includes('fold-shut') && !css.includes('fold-open'), 'the two-label rules outlived their markup');
});

test('the footnotes close the card, and their gap is stated once', () => {
  // `className="card month-card"` until 2026-09-10, when the controls and the
  // table became two sections of ONE card — `.month-panel` — so that the filter
  // row and the rows it filters stop being separated by a gap and two unrelated
  // cards. The section is still the stylesheet's handle on the order of what is
  // inside it; what it stopped being is a card of its own.
  // `card flush month-panel` since the round of 2026-09-10 that made the four
  // report screens one shape: the panel is `.card.flush` — the queue's own card
  // — and `.month-panel` is what is left for the 860px block to hold on to.
  assert.match(hrView, /<div className="card flush month-panel">/);
  assert.match(hrView, /className="month-card"/);
  assert.match(hrView, /<div className="month-notes">/);
  /**
   * IT WAS AN `order` SWAP UNTIL 2026-09-03. วันเกิดของเดือนนี้ sat under these
   * footnotes in the markup, and the phone gave `.month-notes` `order: 1` to put
   * the birthdays — the only rows on the screen that were work — straight under
   * the total instead of behind a paragraph of grey.
   *
   * That table is gone, so the swap has nothing to swap with and the `order` is
   * dropped rather than left pointing at nothing. What must NOT go with it is
   * the flex parent: flex items do not collapse margins, which is what lets the
   * gap above the block be stated once instead of being whatever the first
   * surviving note happened to carry.
   */
  assert.match(phone, /\.month-card \{ display: flex; flex-direction: column; \}/);
  assert.match(phone, /\.month-card > \.month-notes \{ margin-top: 12px; \}/);
  assert.ok(
    !/\.month-notes \{[^}]*order:/.test(phone),
    'the order came back with nothing to order against',
  );
  // Flex items do not collapse margins, so the gap above the block is stated
  // once here instead of being whatever the first surviving note carried.
  assert.match(phone, /\.month-card > \.month-notes > :first-child \{ margin-top: 0; \}/);
  // …which an inline style would beat. The block runs from its own opening tag
  // to the fragment that closes the "this month has entries" branch.
  const open = hrView.indexOf('<div className="month-notes">');
  const notes = hrView.slice(open, hrView.indexOf('</>', open));
  assert.ok(notes.includes('supersededCount'), 'the notes block was not found whole');
  assert.ok(!/marginTop: 6/.test(notes), 'a note is setting its own top margin again');
  // Nothing else is given a number: a section added to this card later lands
  // where its markup says.
  //
  // RULES ONLY. This read the raw slice until 2026-08-27, when the desktop
  // `.month-find` block grew a paragraph explaining that the row had just come
  // OUT of `.month-card` — and the test failed on its own explanation, the
  // fourth assertion in this codebase to catch a comment instead of the code it
  // describes. Half this stylesheet is prose about which rule sits where; a
  // paragraph that names a selector is not a rule that carries one.
  //
  // ⚠ IT BANNED THE NAME UNTIL 2026-09-10 — `!desktop.includes('.month-card')`
  // — and that was the same shape of mistake one level down. What must not leak
  // is the phone's READING ORDER: `display: flex`, `flex-direction` and the
  // `order` that lifts วันเกิดของเดือนนี้ above the footnotes, none of which
  // means anything to a table drawn as a table. The NAME became legitimate up
  // here the day `.month-card` stopped being a card and became the lower
  // section of `.month-panel`, which owes it a padding and nothing else.
  const deskRules = desktop.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [prop, why] of [
    ['display:\s*flex', 'the card list’s flex column'],
    ['flex-direction', 'the card list’s stacking direction'],
    ['order:', 'the phone’s reading order'],
  ]) {
    const leak = new RegExp(`\.month-card[^{]*\{[^}]*${prop}`);
    assert.ok(!leak.test(deskRules), `${why} leaked onto the desktop`);
  }
  // And what it IS allowed to say up here is the section's own padding, which
  // is what makes the controls and the table one card rather than two.
  assert.match(deskRules, /\.month-panel > \.month-card \{ padding: [^}]*\}/);
});

/**
 * THERE IS NO CARD ROUND THE LIST, SO THERE IS NOTHING TO PULL OUT THROUGH.
 *
 * THE DEFECT THIS REPLACES, because it is the reason the rules it pins were
 * ever written: the wrap paints `--bg` and `.hr-table tbody` inset the cards
 * inside it, which is the ground the list is read against — and the card the
 * wrap sat in padded 12px of `--card` around that. Every card in the list was
 * framed twice, in two colours, and the difference told a reader nothing. It
 * was answered on the morning of 2026-08-27 by pulling the wrap out through the
 * card's padding: negative side margins of `calc(var(--month-pad) * -1)`, and a
 * negative top margin as well while the wrap was the card's `:first-child`.
 *
 * THE AFTERNOON'S ANSWER IS THE SAME FIX ONE LEVEL UP. "ถอด Background Card
 * ที่ครอบกลุ่มรายชื่อพนักงานออก ปล่อยให้การ์ดพนักงานแต่ละคนวางลงบน Background
 * หลักโดยตรง" — the card is off below 860px, so there is no second ground, no
 * arithmetic tying two rules to one token, and no `:first-child` question about
 * whether the CSV note is above the wrap. The list, the pager and รวมทั้งหมด
 * stand on the page's own edges, which are the edges `.month-head` and
 * งวด…ยังเปิดอยู่ stand on.
 *
 * ABOVE 860px THE CARD IS STILL A CARD, and the element still wears the class:
 * up there the list is a table of ten columns read down its own header row,
 * and a table needs a ground to be read against. One markup, two layouts — the
 * rule `.hr-table` itself has followed since the card list was written.
 */
test('there is no card round the list, so there is nothing to pull out through', () => {
  // THE FOUR DECLARATIONS THE CARD WAS. Anything less than all four leaves a
  // container that still reads as a box — a border with no fill is still a
  // frame, and padding with neither is still an indent nothing else on the
  // screen has.
  const at = phone.search(/\.month-card \{\s*background: none;/);
  assert.ok(at > 0, 'the flatten rule was not found');
  const rule = phone.slice(at, phone.indexOf('\n  }', at));
  for (const gone of ['background: none', 'border: none', 'border-radius: 0', 'padding: 0']) {
    assert.ok(rule.includes(gone), 'the card is coming back: ' + gone);
  }
  // And the 16px a card leaves under itself, which here is 16px under the last
  // thing on the screen.
  assert.ok(rule.includes('margin-bottom: 0'), 'the card’s bottom margin outlived the card');

  // THE FULL-BLEED PAIR IS GONE WITH WHAT IT NEGATED. Rules only — the
  // paragraph that replaced them in the stylesheet names both selectors, and
  // matching prose instead of code is the failure this file has caught five
  // times.
  const rules = phone.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!rules.includes('.month-card > .table-wrap.card-list'),
    'the list is being pulled out through a padding that is not there');
  assert.ok(!rules.includes('--month-pad'),
    'the token came back with one consumer');

  // …and the ground the cards are read against is now the page's own, which
  // this declaration paints over the scroll-hint gradients `.table-wrap` puts
  // on every wrap at this width.
  assert.match(phone, /\.table-wrap\.card-list \{ background: var\(--bg\); \}/);

  // NO RING AT ALL. The sides are the page's 12px and nothing else, so an
  // employee card runs to the same edges the controls card above it does. The
  // 12px BETWEEN two cards is `gap` and is untouched — ground went, rhythm
  // stayed.
  assert.match(phone, /\.hr-table tbody \{\s*display: flex; flex-direction: column; gap: 12px; padding: 0;/);

  // AND วันเกิดของเดือนนี้ COMES OUT TO THE SAME EDGE, in two rules because two
  // paddings were between it and the page. `.box` insets prose by 15px, which
  // was right on a card and is 15px of nothing on the page; its transparent
  // border goes too, or the section stands one pixel inside the cards above it.
  // The ends keep their 13px: that is this section's gap from the total.
  assert.match(phone, /\.month-card > \.box \{ padding-left: 0; padding-right: 0; border: none; \}/);
  // And the birthday cards' own ring, which lined up with the employee cards
  // only because 12 + 13 + 12 and 12 + 12 both came to 37 while everything was
  // inside one card. One of those sums changed and the other did not, so the
  // sides are stated as nothing here the same way `.hr-table tbody` states them.
  //
  // THE ENDS READ "12px 0" UNTIL THE FOURTH COMPACTION of 2026-08-27 and are 10
  // now. The `gap` did NOT move and that is the half worth asserting: 12 is what
  // the employee list keeps between its own cards, and two columns of cards read
  // down one screen whose rhythms differ by two pixels is a difference that says
  // nothing to anybody. The ends are boundaries, not beats — the gap under the
  // summary lines and the gap over the footnotes — and they came down with the
  // card's own padding.
  assert.match(phone, /\.bmonth-table tbody \{ display: flex; flex-direction: column; gap: 12px; padding: 10px 0; \}/);
  assert.match(phone, /\.hr-table tbody \{\s*display: flex; flex-direction: column; gap: 12px;/,
    'the employee list’s gap moved — the two columns no longer share a rhythm');

  // ABOVE 860px NONE OF IT APPLIES: the desktop still gets a card whole — it is
  // `.month-panel` since 2026-09-10, one container out, holding the controls and
  // the table as two sections of it. The phone block hands that card back to
  // `.month-head` alone and leaves the panel transparent, so what ships down
  // here is the shape that shipped before the merge.
  // THE FILL, THE BORDER AND THE RADIUS ARE `.card.flush`'S NOW — the panel
  // declared its own three until 2026-09-10, beside a queue that took the same
  // three from the shared class. What the panel still declares is only what
  // differs: it must not clip, because ค้นหาพนักงาน's suggestion list is an
  // absolutely-positioned `.pick-menu` and not a portal.
  assert.match(css, /\.card\.flush \{ padding: 0; overflow: hidden; \}/);
  assert.match(css, /\.card\.flush\.month-panel \{ overflow: visible; \}/);
  const deskOnly = css.slice(0, css.indexOf('@media screen and (max-width: 860px)')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.month-panel \{\s*background:/.test(deskOnly),
    'the panel is drawing its own card again instead of taking .card.flush');
  assert.match(phone, /\.month-panel \{\s*background: none; border: none;/);
  assert.match(phone, /\.month-panel > \.month-head \{\s*background: var\(--card\);/);
  layoutIsTheStylesheets();
});

// ── what did not move ────────────────────────────────────────────────────────

test('the two accounting tables still scroll — they are read down their columns', () => {
  /*
   * AND THE FOLD WAS BUILT, DEPLOYED AND TAKEN BACK OFF, so this line is now a
   * decision rather than an assumption. On 2026-08-26 ส่งบัญชี was rebuilt to
   * fit a 360px screen with no sideways scroll — the four numeric columns held
   * as a grid, แผนก and หมายเหตุ folded under the name, three arrangements of
   * the summary block, rows tightened from 91px to 55. It went to prod, was
   * looked at, and the answer was that the plain table is better looking. It
   * was reverted whole, docs and all.
   *
   * WHAT THAT COSTS, so nobody rediscovers it: on a 360px phone the card is
   * 304px and this table is 560px, so รวม ชม. and the whole หมายเหตุ column —
   * including "ค้างอนุมัติ n รายการ · ไม่นับรวม" — are off the right edge until
   * somebody pushes the table sideways. That is a known, accepted trade, not an
   * oversight. See README §"The screen and the paper are two different
   * documents" for the measurements and the four states.
   */
  assert.match(phone, /\.acct-table, \.allco-table \{\s*table-layout: auto; width: max-content;/);
  // And their frozen name column is still frozen.
  assert.match(phone, /\.acct-table th\.who-col, \.acct-table td\.who-col,\s*\.allco-table th\.who-col/);
  // ตรวจสอบรายเดือน is out of all of it: a sticky cell inside a card is a cell
  // pinned to the edge of a card, which is not a column at all.
  // RULES ONLY, and the reason is this screen's own history: the block between
  // these two selectors is where the card list is declared, and its comments
  // explain — in as many words — that `.hr-table` is a table above 860px and
  // cards below it. This assertion read the raw slice until 2026-08-27 and
  // failed on that paragraph, the sixth time in this codebase a test has caught
  // a comment instead of the code it describes.
  const scrollers = phone
    .slice(phone.indexOf('.acct-table, .allco-table {'), phone.indexOf('.hr-table {'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!scrollers.includes('.hr-table'), 'the card layout is still carrying scrolling-table rules');
});

test('nothing is left of the row-tap sheet the card replaced', () => {
  // It existed to reach a column the phone hid. There is no hidden column now,
  // and a hook with no caller is a mechanism a reader has to account for.
  for (const f of ['components/common.jsx', 'components/HrView.jsx', 'app/styles.css']) {
    const src = read(f);
    for (const gone of ['useRowActions', 'RowActionSheet', 'tap-row', 'tap-hint', 'row-sheet']) {
      assert.ok(!src.includes(gone), `${f} still mentions ${gone}`);
    }
  }
});

test('the desktop rules for this table were not touched', () => {
  // Everything the card does is inside the phone block. Above it, ตรวจสอบรายเดือน
  // is whatever it was — including the action column's own width.
  assert.match(desktop, /th\.act-col \{ width: 258px; \}/);
  assert.ok(!desktop.includes('.hr-table tbody tr {'), 'a card rule leaked out of the phone block');
});

test('the panel says the instruction in the same voice everywhere', () => {
  // ONE CLASS, NO INLINE SIZE. The banner carried an inline font size until
  // 2026-08-26, and an inline style is the one thing a media query cannot reach.
  // ⚠ ตั้งแต่ 2026-10-08 ประโยคนี้คือ `detail` ของ `NoticeRow` — ขนาดและสีเป็นของ
  // `.notice-detail` ที่เดียว ทั้งสองหน้าที่วาดมัน
  const pv = read('components/PolicyVersion.jsx');
  assert.match(pv, /detail=\{notice\.say\}/);
  assert.ok(!/style=\{\{ fontSize: 12\.5/.test(pv), 'the banner went back to writing its own type size');
  assert.match(css, /^\.notice-detail \{ color: var\(--muted\); \}/m);
});

test('the shortened instruction still says why and where', () => {
  const pv = read('components/PolicyVersion.jsx');
  // "หน้านี้ไม่ได้โหลดกฎเบื้องหลังมาด้วย — ดูที่หน้า ตรวจสอบรายเดือน ซึ่งเทียบให้แล้ว"
  // until 2026-08-26. Thai has no spaces, so 76 characters of it is one
  // unbreakable run three lines deep in an amber box.
  // Each half written once, so the plain string and the linked version cannot
  // drift apart.
  assert.match(pv, /const lead = 'หน้านี้ไม่ได้โหลดกฎมาเทียบ — ดูที่หน้า ';/);
  assert.match(pv, /const where = 'ตรวจสอบประจำเดือน';/);
  assert.match(pv, /: lead \+ where;/);
  assert.ok(!pv.includes('กฎเบื้องหลังมาด้วย'), 'the long form came back');
});

test('the sentence that names a screen offers to open it', () => {
  const pv = read('components/PolicyVersion.jsx');
  // The one case whose whole content is "the answer is somewhere else":
  // `arithmeticMixed` is null because THIS screen holds version numbers and not
  // the snapshots behind them, and ตรวจสอบรายเดือน holds both. Naming the
  // screen and then leaving the reader to find it is the sentence doing half
  // its job — กลับไปสรุปรายเดือน is at the top of the card, and nothing joined
  // the two up.
  assert.match(pv, /<button type="button" className="link" onClick=\{onGoMonthly\}>\{where\}<\/button>/);
  assert.match(pv, /export function PolicyVersionBanner\(\{ spread, onGoMonthly \}\) \{/);
  assert.match(pv, /policyVersionNotice\(spread, \{ onGoMonthly \}\)/);
  // Optional, and the plain sentence is what MonthAlerts gets.
  assert.match(pv, /say = onGoMonthly\s*\n\s*\?/);

  // A LINK INSIDE A NOTICE IS THE NOTICE'S COLOUR. `.link` is `--green-text` at
  // 13px/1 — green is what this app uses for "go" and for "approved", so inside
  // an amber box it reads as a second, unrelated signal, and 13px on a
  // line-height of 1 dropped into a 12.5px line set at 1.6 sits off the
  // baseline of the words either side of it.
  assert.match(css, /\.alert \.link \{ font: inherit; font-weight: 500; text-decoration: underline;/);
  // Each palette takes its own `-ink`: the tuned member of the trio, not the
  // display colour. `--amber-ink` on `--amber-bg` is 5.46:1 in ธีมสว่าง against
  // `--amber`'s 3.46, and in ธีมมืด it is the brighter of the two. A control is
  // the one thing in a notice that has to be legible.
  assert.match(css, /\.alert\.warn \.link \{ color: var\(--amber-ink\); \}/);
  assert.match(css, /\.alert\.error \.link \{ color: var\(--danger-ink\); \}/);
  assert.match(css, /\.alert\.ok \.link \{ color: var\(--alert-ok-ink\); \}/);
  assert.match(css, /\.alert\.info \.link \{ color: var\(--info\); \}/);
});

test('the row below the notice stands 16px off it, not 12', () => {
  // Adjacent margins collapse, so `.alert`'s 12 and this bar's 12 came to 12 —
  // two bordered boxes 12px apart, reading as one stack of two panels. Set on
  // the bar rather than as a `margin-bottom` on `.alert`, which would move
  // every notice in the app to space one bar on one screen.
  assert.match(css.slice(css.indexOf('.scan-row {')), /^\.scan-row \{[^}]*margin: 16px 0 0;/);
  assert.match(css, /\.alert \{[\s\S]{0,200}margin: 12px 0;/);
});

test('who set a rule set is quieter than which rule set it is', () => {
  const pv = read('components/PolicyVersion.jsx');
  // An inline `fontSize: 11.5` on `--muted` until 2026-08-26 — the same grey as
  // the figure above it and 2.5px smaller, so the pair read as one two-line
  // value rather than as a figure with a note about it. `--muted-2` is 3.41:1
  // on `--card` in ธีมสว่าง: under AA, and deliberately, for four words that
  // name a shared account rather than a person and are never the answer to a
  // question this column is being asked. The version number keeps `--ink`.
  assert.match(pv, /<div className="pv-by">ตั้งโดย \{version\.createdByName\}<\/div>/);
  // Scoped to this one component. The other two 11.5s in the file —
  // เปลี่ยนกฎการคำนวณ and ปนกัน — are notes under a value that INHERITS amber
  // from the span it is in, and greying them would take the warning off them.
  const cell = pv.slice(pv.indexOf('export function PolicyVersionCell'), pv.indexOf('export function PolicyVersionChange'));
  assert.ok(!/fontSize:/.test(cell), 'the inline type size came back');
  assert.ok(!/color: 'var\(--muted\)'/.test(cell.slice(cell.indexOf('createdByName'))), 'the sub-line kept the darker grey');
  assert.match(css, /\.pv-by \{ font: 400 11\.5px\/1\.45 var\(--sans\); color: var\(--muted-2\); \}/);
});

/**
 * แก้ไข — one pill, two lines, centred in its column.
 *
 * Asked for on 2026-09-07: *ให้กะทัดรัด ความสูงเหมาะสม ไม่ใหญ่เทอะทะ · บรรทัด
 * แรก "1 ครั้ง" ตัวหนา บรรทัดสอง "ฝ่ายบุคคล 1" ตัวเล็ก · จัดกลางคอลัมน์ ·
 * อย่าให้ตัวหนังสือชิดขอบกล่อง*.
 *
 * WHAT IS PINNED IS THE PART THAT CAN QUIETLY COME BACK. It was a
 * `.btn.ghost.sm` — a control built for a row of actions — with the second line
 * living OUTSIDE it as a bare `<div>` carrying two inline styles, both cells
 * right-aligned by `num` under a one-word heading. The count and the qualifier
 * are one fact: `hrCount` is counted among the same snapshots as `count`
 * (`editTally` in lib/reports.js), so it can never be drawn without it, and the
 * markup now says so by nesting it.
 *
 * The geometry is the stylesheet's, like everything else on this screen.
 */
test('the แก้ไข cell is one pill with the count over its qualifier', () => {
  const cell = hrCode.slice(hrCode.indexOf('<td className="edits-col">'));
  const body = cell.slice(0, cell.indexOf('</td>'));

  // ONE object, and it is still the button that opens ประวัติการแก้ไข — a badge
  // that only looked like this would be a figure with no way to ask what it
  // counts.
  assert.match(body, /<button\s+type="button"\s+className="edits-pill"/);
  assert.match(body, /onClick=\{\(\) => setAuditing\(row\.employee\)\}/);
  assert.match(body, /<span className="n">\{row\.edits\.count\} ครั้ง<\/span>/);
  assert.match(body, /<span className="sub">ฝ่ายบุคคล \{row\.edits\.hrCount\}<\/span>/);
  // …and the qualifier is INSIDE it, not a sibling under the button.
  assert.ok(
    body.indexOf('className="sub"') < body.indexOf('</button>'),
    'ฝ่ายบุคคล N is back outside the pill',
  );
  // The control class is gone with it: `.btn.ghost.sm` is 13px in 9px of
  // padding and is why the cell was too tall for what it holds.
  assert.ok(!/btn ghost sm/.test(body), 'the action-row button came back');
  // No inline geometry — this screen's layout is the stylesheet's.
  assert.ok(!/fontSize:|style=\{\{/.test(body), 'an inline style came back into the cell');

  // Centred, heading and cell together, which is why neither carries `num`:
  // `td.num, th.num` right-aligns, and this cell holds one object rather than a
  // figure read down a column.
  assert.ok(!/<th className="num edits-col">/.test(hrCode), 'the heading is right-aligned again');
  assert.match(desktop, /\.hr-table th\.edits-col, \.hr-table td\.edits-col \{ text-align: center; \}/);

  // Compact, and padded off its own border — the two halves of the request.
  const pill = desktop.slice(desktop.indexOf('.hr-table td.edits-col .edits-pill {'));
  const rule = pill.slice(0, pill.indexOf('}'));
  assert.match(rule, /display: inline-flex; flex-direction: column;/);
  assert.match(rule, /align-items: center; justify-content: center;/);
  assert.match(rule, /padding: 4px 10px;/);
  assert.match(rule, /border: 1px solid color-mix\(in srgb, var\(--green\) 50%, transparent\);/);
  assert.match(rule, /background: var\(--green-bg\); color: var\(--green-dark\);/);

  // The second line is quieted from the pill's own ink. `--muted-2` is the grey
  // every other sub-line takes, and it is tuned against `--card`: on
  // `--green-bg` it measures about 3.2:1 in ธีมสว่าง, under AA at 11px.
  const sub = desktop.slice(desktop.indexOf('.hr-table td.edits-col .edits-pill .sub {'));
  assert.match(sub.slice(0, sub.indexOf('}')), /color: color-mix\(in srgb, var\(--green-dark\) 85%, transparent\);/);

  // And the rules are above the phone block, where this column does not exist
  // at all — it is one of the five the card hides by name.
  assert.ok(!phone.includes('.edits-pill'), 'a desktop-only pill leaked into the card block');
  layoutIsTheStylesheets();
});

/**
 * …and neither line of that pill is set in a face that cannot draw it.
 *
 * `1 ครั้ง` is a digit and a Thai word in one short line. `--mono` was the
 * obvious pick for a figure and is wrong here for the reason `.cell-sub.th`
 * spells out at the top of the tables section: IBM Plex Mono carries no Thai,
 * so the numeral would take the mono face and ครั้ง would drop past it to
 * whatever the system has. Two faces, one line, and it reads as broken rather
 * than as quiet. `tabular-nums` survives the move, which is the half of `--mono`
 * this column actually wanted.
 */
test('the pill is set in the Thai face, with the figures still tabular', () => {
  const n = desktop.slice(desktop.indexOf('.hr-table td.edits-col .edits-pill .n {'));
  const rule = n.slice(0, n.indexOf('}'));
  assert.match(rule, /font: 600 12\.5px\/1\.35 var\(--sans\);/);
  assert.match(rule, /font-variant-numeric: tabular-nums;/);
  assert.ok(!/--mono/.test(rule), 'ครั้ง is back in a face that cannot draw it');
});

test('ไอคอนอนุมัติในแถว เปิดกล่องยืนยันของคนนั้น และปิดตัวเองเมื่ออนุมัติไม่ได้', () => {
  /* *"เพิ่ม icon อนุมัติ ในตารางด้วย หากรายการไหนอนุมัติไม่ได้ให้ disable ปุ่มไว้"* · ตกลงกับผู้ใช้ก่อนลงมือว่าให้ "เปิดกล่องยืนยันเฉพาะคนนั้น"
     §5.1 บอกว่าจอนี้ไม่มีทางลัดสำหรับคนเดียว — หนึ่งคนที่นี่คือทั้งเดือนของเขา
     หกลายเซ็น และชั่วโมงที่ไปถึงบัญชีเงินเดือน · ปุ่มนี้จึงทำสิ่งเดียวกับการติ๊ก
     หนึ่งช่องแล้วกดแถบ ไม่ใช่เส้นทางเซ็นเส้นใหม่ */
  const cell = hrView.slice(hrView.indexOf('<td className="act-col">'), hrView.indexOf('</tr>', hrView.indexOf('<td className="act-col">')));

  // กลีฟเดียวกับปุ่ม อนุมัติ ของคิวรออนุมัติ ไม่ใช่กลีฟที่เลือกใหม่ให้จอนี้
  // ผ่าน `RowAction` ทั้งสองจอตั้งแต่ 2026-10-08 — หนึ่งความหมาย หนึ่งไอคอน
  assert.match(cell, /icon="tick"/);
  assert.match(read('components/ApprovalQueue.jsx'), /icon="tick"/);

  /* วาดพร้อมคอลัมน์ติ๊ก — และตั้งแต่ 2026-09-11 นั่นแปลว่า "ทุกเดือนที่ผู้อ่าน
     เซ็นได้" เพราะ `showPickCol` เป็น `mayCorrect` เฉย ๆ แล้ว · ⚠ บรรทัดนี้เคยมี
     คำอธิบายว่า *แถวของไอคอนที่ปิดตายถาวรคือข้อเสนอที่ไม่มีอะไรอยู่ข้างหลัง* ซึ่ง
     เป็นเหตุผลของกฎเก่าที่ถูกถอนไปแล้ว — ถูกแจ้งจากหน้าจอว่า
     *"ทำไมตารางไม่มีปุ่มให้อนุมัติตามที่คุยกัน"* · ดู monthBatchApprove */
  assert.match(cell, /\{showPickCol && \(/);
  // ปิดด้วยกฎเดียวกับช่องติ๊ก ไม่ใช่กฎที่เขียนใหม่ตรงนี้
  assert.match(cell, /why=\{pickable\(row\) \? '' : whyNotPickable\(row\)\}/);

  /* ⚠ เหตุผลอยู่บน "ตัวครอบ" ไม่ใช่บนปุ่ม — ปุ่มที่ถูก disable ไม่เปิด title ของ
     ตัวเอง เหตุผลที่เขียนบนปุ่มจึงเป็นเหตุผลที่ไม่มีใครได้อ่าน ซึ่งเป็นความล้มเหลว
     ที่ title ของ §5.2 มีไว้กันพอดี · `.act-watch` บนคิวรออนุมัติเรียนเรื่องนี้มาแล้ว */
  // ตัวครอบคือ `.act-tip` ของ RowAction ตั้งแต่ 2026-10-08 (เดิมคือ `.act-sign`
  // ของจอนี้เอง) — `why` ตั้งค่าแล้วปุ่มถูก disable และเหตุผลไปอยู่บนตัวครอบ
  const common = read('components/common.jsx');
  assert.match(common, /className="act-tip"\s+data-tip=\{label\}\s+data-tip-why=\{why \|\| hint \|\| undefined\}/);
  assert.match(common, /disabled=\{!!why \|\| disabled\}/);
  assert.match(css, /\.act-tip \.btn:disabled \{ pointer-events: none; \}/);

  // กดแล้วเลือกคนเดียว แล้วเปิดกล่องเดิม — ไม่ได้เพิ่มเข้ากองที่ติ๊กไว้
  assert.match(cell, /setPicked\(new Set\(\[String\(row\.employee\._id\)\]\)\);\s*\r?\n\s*setConfirming\(true\);/);

  // และไม่มีเส้นทางเซ็นเส้นใหม่: กล่องกับฟังก์ชันเซ็นยังเป็นตัวเดิมตัวเดียว
  assert.match(hrView, /<MonthConfirm\s+people=\{chosen\}/);
  assert.match(hrView, /onConfirm=\{signPicked\}/);
  assert.equal((hrView.match(/setSigning\(true\)/g) || []).length, 1, 'มีทางเซ็นมากกว่าหนึ่งทาง');
});
