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
  assert.ok(!/matchMedia|innerWidth|isMobile/.test(hrCode), 'the layout is the stylesheet’s to decide');
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

// ── กล่องรายชื่อสูงคงที่ ─────────────────────────────────────────────────────

test('the list is a box of its own, and the component no longer counts rows', () => {
  // Every row the search matched goes into the markup, on both layouts. No
  // second argument to the map, because there is no index to compare against.
  assert.match(hrView, /\{shown\.map\(\(row\) => \(/);
  // The four numbers that used to live in this file are gone with the controls
  // that moved them. If one comes back, so does a screen whose length depends
  // on how many times somebody pressed something.
  for (const gone of ['CARD_FOLD =', 'CARD_PAGE =', 'CARD_STEP =', 'setPage(', 'setLimit(', 'setShowAll(']) {
    assert.ok(!hrCode.includes(gone), `${gone} came back into the component`);
  }
  assert.ok(!/off-page|over-fold|pager-row|fold-row/.test(hrCode), 'a row-hiding class came back');
  assert.ok(!/matchMedia|innerWidth|isMobile/.test(hrCode), 'the layout is the stylesheet’s to decide');
});

test('the box is bounded, scrolls itself, and does not hand the scroll on', () => {
  const box = phone.slice(phone.indexOf('.hr-table tbody {'));
  const rule = box.slice(0, box.indexOf('}'));
  // Viewport-relative, not a count of cards: "three cards" is 474px on a card
  // with one line of name and 550 on a card with two.
  assert.match(rule, /max-height: 58dvh;/);
  // A 480px-tall phone in landscape would otherwise get a 211px slit.
  assert.match(rule, /min-height: 260px;/);
  assert.match(rule, /overflow-y: auto;/);
  // The part that makes nested scroll safe: without it, flicking to the end of
  // the list carries straight on into the page behind it. The app already asks
  // for this on .pick-menu.
  assert.match(rule, /overscroll-behavior: contain;/);
  assert.match(css, /\.pick-menu \{[\s\S]*?overscroll-behavior: contain;/);
  // Above 860px there is no box at all — the desktop table is a table, and it
  // is not opting out of a rule, the rule simply never applies to it.
  assert.ok(!/\.hr-table tbody \{[^}]*max-height/.test(desktop), 'the box reached the desktop table');
});

test('รวมทั้งหมด is the floor of the box, not a bar over the page', () => {
  const total = phone.slice(phone.indexOf('.hr-table tbody tr.total-row {'));
  const rule = total.slice(0, total.indexOf('}'));
  assert.match(rule, /position: sticky;/);
  // ZERO, and the number is the whole of what changed: the row used to be
  // pinned to the VIEWPORT eight pixels above the nav bar, which is what
  // `calc(82px + env(safe-area-inset-bottom))` was. It sticks to the bottom of
  // the list's own scrollport now, and that box already sits above the nav.
  assert.match(rule, /bottom: 0;/);
  assert.ok(!rule.includes('safe-area-inset-bottom'), 'the row is still doing nav-bar arithmetic');
  // Under the sticky ค้นหา bar and the nav, both at 30.
  assert.match(rule, /z-index: 5;/);
  // Opaque, or the cards travel through it. The shadow points UP now — it is a
  // floor with rows above it, not a bar floating over rows below.
  assert.match(rule, /background: var\(--neutral-wash\);/);
  assert.match(rule, /box-shadow: 0 -6px 20px var\(--shadow-soft\);/);
  // A sticky child scrolls against its nearest scrollport, which is now the
  // tbody. `.table-wrap` must not be a second one wrapped around it.
  assert.match(phone, /\.table-wrap\.card-list \{ overflow: visible; \}/);
  assert.ok(!desktop.includes('.hr-table tbody tr.total-row'), 'the sticky reached the desktop table');
});

test('the box is not a filter — nothing that is counted or printed reads it', () => {
  // รวมทั้งหมด is the month's, from the server's own grandTotal.
  assert.match(hrView, /hours\(data\.grandTotal\.otHours\)/);
  // พิมพ์รวม prints every person the SEARCH matched, scrolled to or not.
  assert.match(hrView, /setPrinting\(\{ employees: shown\.map\(\(r\) => r\.employee\) \}\)/);
  // And there is no longer any per-list state to reset when the month, the
  // filter or the search changes — which is one whole class of "a number that
  // outlived the list it described" that cannot happen any more.
  assert.ok(
    !/useEffect\(\(\) => \{ set(Page|Limit|ShowAll)\(/.test(hrCode),
    'a reset effect came back, which means a row-count came back with it',
  );
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
  assert.match(read('components/HrEntries.jsx'), /<PolicyVersionBanner spread=\{spread\} \/>/);
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
  for (const only of ['ตัวเลขเทียบกันได้ตามปกติ', 'npm run migrate:policy-version', 'ซึ่งเทียบให้แล้ว']) {
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
  assert.match(strip, /const pv = policyVersionNotice\(policy\);/);
  assert.match(read('components/PolicyVersion.jsx'), /export function policyVersionNotice\(spread\) \{/);
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
  assert.ok(!/matchMedia|innerWidth|isMobile/.test(hrCode), 'the layout is the stylesheet’s to decide');
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
