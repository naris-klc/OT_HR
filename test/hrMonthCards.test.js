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
 * PRINTED, and those two buttons were the eleventh column of eleven — off the
 * right edge, reached by pushing the whole month sideways past the figures.
 *
 * So it is a card list below 860px, and the desktop table is untouched. What is
 * pinned here is the part a later edit can quietly undo:
 *
 *   - ONE markup, two layouts. The desktop table must still be a table — same
 *     eleven columns, same order, same cells — or "Desktop Preserved" stopped
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
 * Three assertions in this file have caught their own comment instead of the
 * code: a note reading "there is no matchMedia here", another reading "NOT
 * sessionStorage", and one quoting the very Thai sentence it was checking had
 * not been copied. Each looked like a real failure for a minute.
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
  for (const col of ['who-col', 'dept-col', 'rate-col', 'total-col', 'count-col',
    'edits-col', 'rule-col', 'cap-col', 'act-col']) {
    assert.ok(head.includes(col), `the desktop head lost ${col}`);
  }
  layoutIsTheStylesheets();
});

test('the phone layout turns that same table into cards', () => {
  assert.match(phone, /\.hr-table \{ display: block; width: 100%; min-width: 0; \}/);
  assert.match(phone, /\.hr-table thead \{ display: none; \}/);
  assert.match(phone, /\.hr-table tbody \{\s*display: flex; flex-direction: column;/);
  assert.match(phone, /\.hr-table tbody tr \{[\s\S]*?border: 1px solid var\(--line\); border-radius: var\(--radius\);/);
});

// ── what the card carries ────────────────────────────────────────────────────

test('name, code and สะสม / เพดาน — and the eight columns that do not fit are named', () => {
  // The code sits under the name in the same cell, on both layouts.
  assert.match(hrView, /\{row\.employee\.name\}[\s\S]{0,200}\{row\.employee\.code\}/);
  assert.match(phone, /\.hr-table tbody td\.who-col \{/);
  assert.match(phone, /\.hr-table tbody td\.cap-col \{/);
  assert.match(phone, /content: 'สะสม \/ เพดาน'/);

  // Hidden by name rather than by a blanket rule with exceptions, so a twelfth
  // column shows up on a phone instead of silently disappearing.
  const hidden = phone.slice(phone.indexOf('.hr-table tbody td.dept-col,'));
  for (const col of ['dept-col', 'rate-col', 'count-col', 'edits-col', 'rule-col', 'pad-col']) {
    assert.ok(hidden.slice(0, 300).includes(`.hr-table tbody td.${col}`), `${col} is not accounted for`);
  }
});

test('รวม ชม. is dropped because สะสม is the same figure, not because it does not matter', () => {
  // capFigure(usedHours, capHours) — and usedHours is what รวม ชม. prints.
  assert.match(phone, /\.hr-table tbody tr:not\(\.total-row\) td\.total-col \{ display: none; \}/);
  // รวมทั้งหมด has no ceiling cell, so its total comes back in that slot.
  assert.match(phone, /\.hr-table tbody tr\.total-row td\.total-col \{[\s\S]*?grid-area: cap;/);
});

// ── the buttons, which are why this screen moved ─────────────────────────────

test('both buttons are on every card, side by side, at a thumb-sized target', () => {
  const cell = hrView.slice(hrView.indexOf('<td className="act-col">'), hrView.indexOf('</tr>', hrView.indexOf('<td className="act-col">')));
  assert.match(cell, /ดู \/ แก้ไขรายการ/);
  assert.match(cell, /พิมพ์ F-HR-027/);

  assert.match(phone, /\.hr-table tbody td\.act-col \{[\s\S]*?grid-area: act;/);
  // `flex: 1 1 0` and nowrap: a basis of 50% plus the gap is wider than the
  // card, and the second button drops onto its own line on a narrow phone.
  assert.match(phone, /\.hr-table tbody td\.act-col \.row-actions \{ flex-wrap: nowrap; gap: 8px; \}/);
  assert.match(phone, /\.hr-table tbody td\.act-col \.row-actions \.btn \{\s*flex: 1 1 0;[\s\S]*?min-height: 44px;/);
});

test('the two buttons are not two equal offers', () => {
  // ดู / แก้ไขรายการ is what somebody opened the month to do; พิมพ์ is what
  // they do afterwards, sometimes. Two ghosts side by side say neither.
  assert.match(hrView, /className="btn ghost sm act-open"/);
  assert.match(
    phone,
    /\.btn\.act-open \{\s*background: var\(--green-tint\); color: var\(--green-accent\);\s*border-color: var\(--green\)/,
  );
  // A token, not a hex. `--green-accent` is the one green that stays saturated
  // in the dark theme — the button has no fill and no icon, so its colour is
  // the whole of what makes it the first of the two — and it is written down as
  // an exception in the token block rather than inlined here, where
  // test/theme.test.js would refuse it and a reader would find no reason.
  assert.match(css, /--green-accent: light-dark\(#0F8A46, #34D399\);/);
  // The accent belongs to the card, not to the button: on a desktop these two
  // sit in a 258px column among nine of figures, and one of them in green
  // would be the only coloured thing on the screen.
  assert.ok(!desktop.includes('act-open'), 'the accent leaked out of the phone block');
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

// ── หน้าละ 5 คน ──────────────────────────────────────────────────────────────

test('five to a page, and the page is the whole of the mechanism', () => {
  // Five to a page — the number lives in the component, once.
  assert.match(hrView, /const CARD_PAGE = 5;/);
  // A WINDOW, not a fold: page 3 hides the ten rows above the five it draws as
  // well as everything below them.
  assert.match(hrView, /const from = \(current - 1\) \* CARD_PAGE;/);
  assert.match(hrView, /const to = from \+ CARD_PAGE;/);
  // The class the phone reads. It shares the attribute with `row-flash` since
  // the dropdown landed — two independent facts about one row, and the page
  // window is the half asserted here.
  assert.match(hrView, /\$\{i < from \|\| i >= to \? 'off-page' : ''\}/);
  // A CLASS AND NOT `shown.slice`, which is the shorter way to draw five cards
  // and draws five ROWS with it. The desktop has no pager — `.pager-row` is
  // `display: none` above 860px — so a sliced list is a month with fifty-five
  // people missing and no control anywhere on screen to reach them.
  assert.ok(!/shown\.slice\(/.test(hrCode), 'the phone’s page window sliced the desktop’s month away');
  assert.match(hrCode, /\{shown\.map\(\(row, i\) => \(/);
  // …and no `dvh`: the list is no longer a box, and it was never the
  // component's business how tall one was.
  layoutIsTheStylesheets();
});

test('a page that no longer exists is clamped, not drawn empty', () => {
  // `load()` can shorten the list without the month, the filter or the search
  // changing — HR withdraws the last live entry of the only person on page 12.
  assert.match(hrView, /const pageCount = Math\.max\(1, Math\.ceil\(shown\.length \/ CARD_PAGE\)\);/);
  assert.match(hrView, /const current = Math\.min\(page, pageCount\);/);
  // Clamped at render, so the empty page never exists for a frame — and `page`
  // is left alone, so a list that grows back returns the reader where they were.
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
  // carries the `scroll-margin-top` that clears the two sticky bars.
  assert.match(hrView, /<div className="table-wrap card-list" ref=\{listRef\}>/);
  assert.match(
    hrCode,
    /function goPage\(next\) \{\s*setPage\(next\);\s*listRef\.current\?\.scrollIntoView\(\{ block: 'start' \}\);\s*\}/,
  );
  assert.match(hrView, /onClick=\{\(\) => goPage\(current - 1\)\}/);
  assert.match(hrView, /onClick=\{\(\) => goPage\(current \+ 1\)\}/);
  // IN THE HANDLER AND NOT ON AN EFFECT. `scrollTop = 0` was the same act as
  // resetting the box, because the box was the thing scrolled; the page is now,
  // and an effect over `[current, find, period, …]` would fire on mount and on
  // every keystroke in the search box — the screen jumping down to the list
  // while somebody is still typing above it.
  assert.ok(!/scrollTop = 0/.test(hrCode), 'the box’s scroll reset outlived the box');
  assert.ok(!/useEffect[^;]*scrollIntoView/.test(hrCode), 'the scroll went back onto an effect');
  // And how far down to stop is the stylesheet's, because the bars it clears are.
  assert.match(phone, /\.table-wrap\.card-list \{ overflow: visible; scroll-margin-top: 156px; \}/);
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
  assert.match(rule, /display: flex; flex-direction: column; gap: 12px; padding: 12px;/);
  // …and the wrap must not become one by inheritance: `.table-wrap` is
  // `overflow-x: auto` at every other width, which computes `overflow-y` to
  // `auto` as well and would be the inner scrollbar all over again.
  assert.match(phone, /\.table-wrap\.card-list \{ overflow: visible;/);
  // Above 860px there was never a box.
  assert.ok(!/\.hr-table tbody \{[^}]*max-height/.test(desktop), 'the box reached the desktop table');
});

test('the pager sits under the fifth card, above the total, and disables its ends', () => {
  const block = hrView.slice(hrView.indexOf('<tr className="pager-row">'));
  const row = block.slice(0, block.indexOf('</tr>'));
  assert.match(row, /แสดง <strong>\{from \+ 1\}–\{Math\.min\(to, shown\.length\)\}<\/strong> จาก/);
  assert.match(row, /<strong>\{shown\.length\}<\/strong> รายการ/);
  // From the clamped value, never from raw `page`, or the label and the rows
  // drawn could disagree on exactly the month that shortened.
  assert.match(row, /หน้า <strong>\{current\}<\/strong> \/ <strong>\{pageCount\}<\/strong>/);
  assert.match(row, /onClick=\{\(\) => goPage\(current - 1\)\}/);
  assert.match(row, /disabled=\{current <= 1\}/);
  assert.match(row, /onClick=\{\(\) => goPage\(current \+ 1\)\}/);
  assert.match(row, /disabled=\{current >= pageCount\}/);
  // `disabled` rather than gone: a control that disappears at the ends moves the
  // two beside it, and the second press of a travelling thumb lands on the
  // button that goes back.
  assert.ok(!/\{current > 1 && \(\s*<button/.test(row), 'ก่อนหน้า is hidden at page 1 instead of disabled');
  assert.match(row, /<div className="pager-say" aria-live="polite">/);
  assert.match(row, /colSpan=\{11\}/);

  // THE ORDER OF THE WHOLE SCREEN: five cards, the pager directly under the
  // fifth of them, รวมทั้งหมด under that, then วันเกิดของเดือนนี้. The pager
  // belongs to the cards — "แสดง 6–10 จาก 57 รายการ" is a sentence about the
  // five immediately above it — and a month's total read in between breaks that
  // sentence in half.
  assert.ok(
    hrView.indexOf('<tr className="pager-row">') < hrView.indexOf('<tr className="total-row">'),
    'the pager ended up under รวมทั้งหมด',
  );
  assert.ok(
    hrView.indexOf('<tr className="total-row">') < hrView.indexOf('<BirthdayMonth'),
    'วันเกิดของเดือนนี้ came up above the month’s own total',
  );
  // Not a card, and one line that has to stay one line.
  assert.match(phone, /\.hr-table tbody tr\.pager-row \{\s*display: block; padding: 0; border: 0; background: none;/);
  assert.match(phone, /\.pager-controls \{\s*display: grid; grid-template-columns: 1fr auto 1fr;/);
  assert.match(phone, /\.pager-controls \.btn \{\s*width: 100%; min-height: 44px;/);
  // The disabled ends wear what every other disabled button in this app wears.
  assert.ok(!/pager-controls \.btn:disabled/.test(phone), 'the pager opted out of the app’s disabled treatment');

  // And the desktop hides the whole row while leaving `.off-page` unstyled —
  // one `display: none` written there by mistake takes fifty-five people out of
  // the desktop month.
  assert.match(desktop, /\.hr-table tbody tr\.pager-row \{ display: none; \}/);
  assert.ok(!desktop.includes('.off-page {'), 'the paging reached the desktop table');
});

test('the pager is drawn on every month, including the ones that fit', () => {
  // It used to be `{shown.length > CARD_PAGE && …}`, and the four-person August
  // had no pager at all: the foot of the list was a different shape depending on
  // how many people filed OT, and "แสดง 1–4 จาก 4 รายการ" — the one line that
  // says how long the list is — was missing from exactly the months short enough
  // to doubt. Asked for by name on 2026-08-26.
  assert.ok(!/shown\.length > CARD_PAGE/.test(hrCode), 'the pager went back behind a condition');
  // The ends carry it instead: one page means `current <= 1` and
  // `current >= pageCount` are both true, so both buttons come up disabled and
  // the count line still states the month.
  const row = hrView.slice(hrView.indexOf('<tr className="pager-row">'));
  assert.match(row.slice(0, row.indexOf('</tr>')), /disabled=\{current <= 1\}[\s\S]*disabled=\{current >= pageCount\}/);
  // `pageCount` has a floor of 1, so a short month says "หน้า 1 / 1" and never
  // "หน้า 1 / 0".
  assert.match(hrView, /const pageCount = Math\.max\(1, Math\.ceil\(shown\.length \/ CARD_PAGE\)\);/);
  // The one row that IS conditional is the search's own empty state, and it
  // replaces the whole table — pager and total included — rather than sitting
  // under an empty one.
  assert.ok(
    hrView.indexOf('shown.length === 0 ? (') < hrView.indexOf('<div className="table-wrap card-list"'),
    'the empty state stopped replacing the table',
  );
});

test('รวมทั้งหมด is the row after the pager, not a bar over the page', () => {
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
  assert.match(hrView, /useEffect\(\(\) => \{ setPage\(1\); \}, \[period, statusFilter, query\]\);/);
  // Picking somebody from the dropdown moves the page too, and that is NOT this
  // reset: it is the page that HOLDS them, so the card exists to be scrolled to
  // at all below 860px. Pinned in test/monthSearch.test.js beside `goToRow`.
  assert.match(hrView, /if \(i >= 0\) setPage\(Math\.floor\(i \/ CARD_PAGE\) \+ 1\);/);
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

test('two panels became one panel — a list, not a second stack', () => {
  // The first attempt counted them on a strip and then rendered the two
  // ORIGINAL panels under it: three boxes where there had been two, and the
  // strip naming what the first box then said again.
  const strip = hrView.slice(hrView.indexOf('function MonthAlerts('), hrView.indexOf('function CapCell('));
  // THE MONTH BY NAME. This panel now sits ABOVE the box that sets the period,
  // so "เดือนนี้" is a question rather than an answer.
  assert.match(strip, /แจ้งเตือนของ \$\{periodName\} · \$\{notices\.length\} ข้อความ/);
  assert.match(hrView, /periodName=\{periodLabel\(period\)\}/);
  // ONE `<Alert>` in the whole component, and the list is INSIDE it.
  assert.equal(strip.match(/<Alert /g).length, 1, 'a second panel came back');
  assert.match(strip, /<ul className="alerts-list">[\s\S]*?<\/ul>[\s\S]*?<\/Alert>/);
  assert.ok(!strip.includes('<PolicyVersionBanner'), 'the brown panel is still being rendered here');
  assert.ok(!hrView.includes('HrVerifiedNotice'), 'the blue panel is still a component on this screen');
  // …and the banner is not even imported any more. It is still a component
  // because ตรวจสอบใบของพนักงาน opens it.
  assert.ok(!/import \{[^}]*PolicyVersionBanner/.test(hrView), 'the banner is still imported here');
  // …and it hands the banner the way back, which is the screen the banner's
  // fourth sentence names. See 'the sentence that names a screen offers to
  // open it' at the foot of this file for why the callback comes from here.
  assert.match(
    read('components/HrEntries.jsx'),
    /<PolicyVersionBanner spread=\{spread\} onGoMonthly=\{onClose\} \/>/,
  );
});

test('an item is a heading, its figures, and the one sentence that says what to do', () => {
  const strip = hrView.slice(hrView.indexOf('function MonthAlerts('), hrView.indexOf('function CapCell('));
  // TWO LINES, not three. The heading and its figures are one statement and run
  // together on the first; two blocks made a three-line item out of a two-line
  // one wherever the pair happened to fit.
  assert.match(strip, /<div><strong>\{n\.label\}<\/strong>: \{n\.figures\}<\/div>/);
  // The brackets mark the second line as guidance ABOUT the first rather than
  // more of it — which is what the block margin used to do and need not.
  assert.match(strip, /<div className="say">\(\{n\.say\}\)<\/div>/);
  // A bullet and a gap, not a hairline: an item is two lines now, and the disc
  // is what says where the next one starts when the one above it did not end at
  // the right-hand margin. Drawn, not `list-style`, so it cannot hang into the
  // panel's own padding.
  assert.match(css, /\.alerts-list > li::before \{\s*content: '•';/);
  assert.ok(!css.includes('.alerts-list > li + li'), 'the hairline and the bullet are both in');
  // ตรวจก่อนเซ็นรับรอง is the whole reason the policy notice exists. A list
  // that dropped it would be a tidier screen that had stopped saying the thing
  // it is for — so `say` is carried, and it is carried from the notice's own
  // module rather than retyped here.
  const pv = read('components/PolicyVersion.jsx');
  assert.match(pv, /ตรวจก่อนเซ็นรับรอง/);
  assert.match(pv, /figures: named\.join\(' · '\),/);
  assert.match(pv, /say,/);
  assert.ok(!hrCode.includes('ตรวจก่อนเซ็นรับรอง'), 'the policy wording was copied into the screen');
  // All four cases still answered in that one place — OPEN 7 mints a version
  // and moves no number, so a banner that cries wolf on it trains HR to dismiss
  // the one that fires when the rounding rule changed mid-month.
  // The fourth is matched on 'ไม่ได้โหลดกฎมาเทียบ'. It read 'ซึ่งเทียบให้แล้ว'
  // until 2026-08-26, when the sentence was shortened from
  // "หน้านี้ไม่ได้โหลดกฎเบื้องหลังมาด้วย — ดูที่หน้า ตรวจสอบรายเดือน ซึ่งเทียบให้แล้ว"
  // to "หน้านี้ไม่ได้โหลดกฎมาเทียบ — ดูที่หน้า ตรวจสอบรายเดือน". Both halves that
  // matter survive: why this screen cannot answer, and which one can.
  for (const only of ['ตัวเลขเทียบกันได้ตามปกติ', 'npm run migrate:policy-version', 'ไม่ได้โหลดกฎมาเทียบ']) {
    assert.ok(pv.includes(only), `the ${only} case went missing`);
  }
  assert.match(css, /\.alerts-list \{\s*list-style: none;/);
});

test('one control for the whole thing, and no second ดูรายละเอียด inside it', () => {
  const strip = hrView.slice(hrView.indexOf('function MonthAlerts('), hrView.indexOf('function CapCell('));
  assert.match(strip, /\{open \? 'ซ่อน ▲' : 'ดูรายละเอียด ▼'\}/);
  assert.match(strip, /aria-expanded=\{open\}/);
  // A second `ดูรายละเอียด` two levels down is a reader asking which of them
  // they just pressed. Nothing inside the list folds again.
  assert.ok(!strip.includes('<details'), 'a fold came back inside the list');
  assert.equal(strip.match(/fold-pill/g).length, 1, 'a second toggle appeared');
  assert.equal(strip.match(/onClose=/g).length, 1, 'a second dismiss appeared');
  // The labels line is drawn SHUT only — open, the list headings are those same
  // words, and saying them twice fourteen pixels apart is a difference a reader
  // has to check for and will not find.
  assert.match(strip, /\{!open && <span>\{notices\.map\(\(n\) => n\.label\)\.join\(' · '\)\}<\/span>\}/);
  // …and the button is in that SAME flow, not on a block of its own: a 44px
  // touch target stacked under two wrapped lines of Thai is a whole row of the
  // panel spent on one control.
  assert.match(strip, /<div className="alerts-say">\s*\{!open && <span>[\s\S]*?<button/);
  assert.match(css, /\.alerts-say > \.fold-pill \{ margin: 0 0 0 8px; vertical-align: middle; \}/);
  assert.match(css, /\.alerts-say \{ margin-top: 2px; font-size: 12px; \}/);
  // THE COLOUR IS THE WORST OF THEM, or the fold has quietly downgraded a
  // warning by folding it.
  assert.match(strip, /\['warn', 'info', 'ok'\]\.find\(/);
  // Whether there is a policy notice at all, and how loud, is the notice's own
  // module to answer — asking `spread.mixed` again here is how two rules that
  // disagree start.
  // MonthAlerts passes NO second argument, and that is the assertion: the
  // notice's fourth sentence names ตรวจสอบรายเดือน, and this screen IS
  // ตรวจสอบรายเดือน — a link back to where you already are is worse than none.
  assert.match(strip, /const pv = policyVersionNotice\(policy\);/);
  assert.match(
    read('components/PolicyVersion.jsx'),
    /export function policyVersionNotice\(spread, \{ onGoMonthly \} = \{\}\) \{/,
  );
  assert.match(read('components/PolicyVersion.jsx'), /<Alert kind=\{notice\.kind\}>/);
});

test('the panel is above the marks it explains, which one of them once only claimed', () => {
  // The marks are the per-row `HR อนุมัติชั้นเดียว n` under รายการ and the chip
  // on the rows themselves. That sentence spent its life below the month's
  // total — on a phone, below วันเกิดของเดือนนี้ as well — where a reader who
  // has finished the rows has finished asking.
  const strip = hrView.indexOf(STRIP);
  assert.ok(strip > 0, 'the panel was not found');
  // FIRST OF EVERYTHING now — above the period box, above the export buttons,
  // above the search box and the list. The person it warns is the one about to
  // sign the figures, and a warning read after พิมพ์ has been pressed is a
  // warning that arrived late.
  assert.ok(strip < hrView.indexOf('<div className="card">'), 'the panel is under the controls card');
  assert.ok(strip < hrView.indexOf('<input type="month"'), 'the panel is under the period box');
  assert.ok(strip < hrView.indexOf('className="row export-row"'), 'the panel is under the export buttons');
  assert.ok(strip < hrView.indexOf('<div className="row month-find">'), 'the panel split the search box from its list');
  assert.ok(strip < hrView.indexOf('<table className="hr-table">'), 'the panel is still under the table');
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

test('an open list cannot outlive its month, and the ✕ lasts until a reload', () => {
  // Remounted by key: both the open flag and the list under it describe the
  // notices of ONE month at ONE สถานะที่นับ.
  assert.match(hrView, /key=\{`\$\{period\}\|\$\{statusFilter\}`\}/);
  // …which is exactly why the dismissal is NOT in that component's state — the
  // same remount would clear it, and the ✕ would last until the next press of
  // the period box. Module scope outlives the remount and dies with the
  // document: "จนกว่าจะ Refresh หน้าใหม่".
  assert.match(hrView, /^let alertsDismissed = false;$/m);
  assert.match(hrView, /onClose=\{\(\) => \{ alertsDismissed = true; setShut\(true\); \}\}/);
  // NOT sessionStorage, which survives the reload — a dismissal made in August
  // would still be in force the next morning with a different month on screen.
  // Named in the comment, which is where the reason lives — never CALLED.
  assert.ok(!/(session|local)Storage\s*[.[]/.test(hrView), 'the dismissal outlived the document');
  // Dismissing closes the panel; it does not make the notices unreachable. The
  // count is recomputed from the month on screen, so a different month's
  // different warning is a different number with nothing reappearing.
  assert.match(hrView, /แสดงแจ้งเตือนของ \$\{periodName\} \(\$\{notices\.length\}\)/);
  assert.match(hrView, /alertsDismissed = false; setShut\(false\);/);
  assert.match(css, /\.alerts-recall \{ margin: 0 0 12px; font-size: 12\.5px; \}/);
});

test('.fold-pill is a class, and the digest it shares a screen with is untouched', () => {
  // Worn by a `<button>`, so it resets what a button brings with it — a UA
  // background, border and font — none of which a `<summary>` has.
  assert.match(css, /\.fold-pill \{[\s\S]*?background: none; color: inherit; cursor: pointer;/);
  assert.match(hrView, /<button\s+type="button"\s+className="fold-pill"/);
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
  // The panel gives back its own padding too — and only this panel:
  // `.alert.tight` is worn all over the app.
  assert.match(phone, /\.month-card > \.alert\.tight \{ padding: 8px 12px; \}/);
  // And the export buttons come up to the selects they act on: 8px at this
  // width, the same as the gap between the buttons themselves, which is what
  // makes them one block rather than a section break. Stated in the stylesheet
  // — an inline `marginTop` is the one thing the 860px block cannot reach.
  assert.match(css, /\.export-row \{ margin-top: 12px; \}/);
  assert.match(phone, /\.export-row \{\s*margin-top: 8px;/);
  assert.ok(!/export-row" style=/.test(hrView), 'the export row went back to an inline margin');
  // PrintFormBatch's digest is the other `.notice-fold` in the app: plain-text
  // summary, no pill, and no rule here reaches it.
  const digest = read('components/PrintFormBatch.jsx');
  assert.match(digest, /<details className="notice-fold">\s*<summary>ดูรายละเอียด<\/summary>/);
  assert.ok(!digest.includes('fold-pill'), 'the pill leaked to the digest');
  // The two-label mechanism went with the fold it belonged to. Dead rules for a
  // markup nothing writes any more are rules a reader has to account for.
  assert.ok(!css.includes('fold-shut') && !css.includes('fold-open'), 'the two-label rules outlived their markup');
});

test('the phone puts วันเกิดของเดือนนี้ under the total and the footnotes after it', () => {
  // One markup, two orders — the same rule the card list itself follows.
  assert.match(hrView, /className="card month-card"/);
  assert.match(hrView, /<div className="month-notes">/);
  // In the MARKUP the notes still come first, which is the desktop reading:
  // a table, its footnotes, then the birthdays.
  assert.ok(
    hrView.indexOf('<div className="month-notes">') < hrView.indexOf('<BirthdayMonth'),
    'the document order stopped being the desktop order',
  );
  assert.match(phone, /\.month-card \{ display: flex; flex-direction: column; \}/);
  assert.match(phone, /\.month-card > \.month-notes \{ order: 1; margin-top: 12px; \}/);
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
  assert.ok(!desktop.includes('.month-card'), 'the phone order leaked onto the desktop');
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
  const scrollers = phone.slice(phone.indexOf('.acct-table, .allco-table {'), phone.indexOf('.hr-table {'));
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

test('the panel says the instruction in the same voice the list does', () => {
  // ONE CLASS, TWO RENDERERS. The banner carried an inline
  // `style={{ fontSize: 12.5, marginTop: 6 }}` on this line until 2026-08-26
  // while ตรวจสอบรายเดือน drew the same sentence through `.say` — one notice,
  // two decisions about how loud its instruction is, and an inline style is
  // the one thing a media query cannot reach.
  const pv = read('components/PolicyVersion.jsx');
  assert.match(pv, /<div className="say">\{notice\.say\}<\/div>/);
  assert.ok(
    !/style=\{\{ fontSize: 12\.5/.test(pv),
    'the banner went back to writing its own type size',
  );

  // GREY, NOT A PALER AMBER — asked for as a lighter orange on 2026-08-26 and
  // answered with the neutral, because it is the only option here that does
  // not cost readability. `--amber` on `--amber-bg` is 3.46:1 in ธีมสว่าง (a
  // recorded debt of this palette) and 85% opacity would take it to 2.80;
  // `--muted` on that same ground is 5.04 and passes AA. Neutral also because
  // `policyVersionNotice` returns `ok` as well as `warn`, and one rule has to
  // sit correctly on green too — 4.99 there.
  assert.match(css, /\.alert \.say \{ margin-top: 6px; font-size: 12\.5px; color: var\(--muted\); \}/);
  // The list keeps its own, further down the file, and wins on order. Matched
  // on the rule's opening brace, not on the selector: both names also appear in
  // the prose above the rules, which is where an indexOf finds them first.
  const listSay = css.indexOf('.alerts-list .say {');
  assert.ok(listSay > css.indexOf('.alert .say {'), 'the list rule no longer wins on order');
  assert.match(css.slice(listSay, listSay + 120), /opacity: \.85;/);
});

test('the shortened instruction still says why and where', () => {
  const pv = read('components/PolicyVersion.jsx');
  // "หน้านี้ไม่ได้โหลดกฎเบื้องหลังมาด้วย — ดูที่หน้า ตรวจสอบรายเดือน ซึ่งเทียบให้แล้ว"
  // until 2026-08-26. Thai has no spaces, so 76 characters of it is one
  // unbreakable run three lines deep in an amber box.
  // Each half written once, so the plain string and the linked version cannot
  // drift apart.
  assert.match(pv, /const lead = 'หน้านี้ไม่ได้โหลดกฎมาเทียบ — ดูที่หน้า ';/);
  assert.match(pv, /const where = 'ตรวจสอบรายเดือน';/);
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

test('the bar below the notice stands 16px off it, not 12', () => {
  // Adjacent margins collapse, so `.alert`'s 12 and this bar's 12 came to 12 —
  // two bordered boxes 12px apart, reading as one stack of two panels. Set on
  // the bar rather than as a `margin-bottom` on `.alert`, which would move
  // every notice in the app to space one bar on one screen.
  assert.match(css.slice(css.indexOf('.audit-bar {')), /^\.audit-bar \{[\s\S]{0,200}margin: 16px 0 0;/);
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
