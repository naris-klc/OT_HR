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
  assert.match(phone, /\.hr-table tbody \{ display: flex; flex-direction: column;/);
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
  assert.match(phone, /\.hr-table tbody \{ display: flex; flex-direction: column; gap: 12px;/);
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

// ── ห้าการ์ดก่อน แล้วค่อยที่เหลือ ────────────────────────────────────────────

test('the card list stops at five and offers the rest', () => {
  // The number lives in the component, once. Five is one 375px screen with the
  // month's own controls still above it, so the button is on screen when the
  // month loads rather than found by scrolling to what looks like the end.
  assert.match(hrView, /const CARD_FOLD = 5;/);
  // The JSX marks WHICH rows are past the fifth and says nothing about width.
  assert.match(hrView, /className=\{!showAll && i >= CARD_FOLD \? 'over-fold' : undefined\}/);
  assert.ok(!/matchMedia|innerWidth|isMobile/.test(hrCode), 'the layout is the stylesheet’s to decide');
  // …and the stylesheet is where "past the fifth" becomes "not drawn", below
  // 860px and nowhere else.
  assert.match(phone, /\.hr-table tbody tr\.over-fold \{ display: none; \}/);
  assert.match(desktop, /\.hr-table tbody tr\.fold-row \{ display: none; \}/);
  // Named in the desktop block's comment, which is where the reason lives —
  // but never given a RULE there, or a row would go missing from the table.
  assert.ok(!desktop.includes('.over-fold {'), 'the fold reached the desktop table');
});

test('the button counts what it is hiding, and goes back', () => {
  const fold = hrView.slice(hrView.indexOf('{shown.length > CARD_FOLD && ('));
  const row = fold.slice(0, fold.indexOf('</tr>'));
  // "ดูเพิ่มเติม…" asks somebody to press a button to find out how much they
  // were not shown. `shown.length`, so while the search box is narrowing the
  // fold counts the search's results and not the month's.
  assert.match(row, /แสดงทั้งหมด \(\$\{shown\.length\} รายการ\)/);
  // Sixty cards is the case this exists for, and there is otherwise no way back
  // to the top of the month but scrolling through all sixty.
  assert.match(row, /ย่อกลับ · แสดง \$\{CARD_FOLD\} รายการแรก/);
  assert.match(row, /aria-expanded=\{showAll\}/);
  // Eleven cells like every other row in this table.
  assert.match(row, /colSpan=\{11\}/);
  // ABOVE the total card, which is the foot of the list on a phone and the
  // thing วันเกิดของเดือนนี้ is ordered to come up to.
  assert.ok(
    hrView.indexOf('{shown.length > CARD_FOLD && (') < hrView.indexOf('<tr className="total-row">'),
    'the fold button ended up under รวมทั้งหมด',
  );
  // Not a card: a bordered white block around one full-width button reads as a
  // sixth person with nothing in them.
  assert.match(phone, /\.hr-table tbody tr\.fold-row \{\s*display: block; padding: 0; border: 0; background: none;/);
  assert.match(phone, /\.hr-table tbody tr\.fold-row \.btn \{\s*width: 100%; min-height: 44px;/);
});

test('a fold is not a filter — nothing that is counted or printed reads it', () => {
  // รวมทั้งหมด is the month's, from the server's own grandTotal.
  assert.match(hrView, /hours\(data\.grandTotal\.otHours\)/);
  // พิมพ์รวม prints every person the SEARCH matched, folded or not.
  assert.match(hrView, /setPrinting\(\{ employees: shown\.map\(\(r\) => r\.employee\) \}\)/);
  // And it closes again whenever the list underneath it changes, or it is a
  // claim about a list that no longer exists.
  assert.match(hrView, /useEffect\(\(\) => \{ setShowAll\(false\); \}, \[period, statusFilter, find\]\);/);
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
  assert.match(strip, /แจ้งเตือนของเดือนนี้ \$\{notices\.length\} ข้อความ/);
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
  assert.match(strip, /<strong>\{n\.label\}<\/strong>/);
  assert.match(strip, /<div className="fig">\{n\.figures\}<\/div>/);
  assert.match(strip, /<div className="say">\{n\.say\}<\/div>/);
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
  assert.match(css, /\.alerts-list > li \+ li \{\s*border-top: 1px solid color-mix/);
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
  // ABOVE the search box, not between it and the list: the box's own rule is
  // that the thing it filters starts directly underneath it, and these notices
  // are the month's, not the search's.
  assert.ok(strip < hrView.indexOf('<div className="row month-find">'), 'the panel split the search box from its list');
  assert.ok(strip < hrView.indexOf('<table className="hr-table">'), 'the panel is still under the table');
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
  assert.match(hrView, /แสดงแจ้งเตือนของเดือนนี้ \(\$\{notices\.length\}\)/);
  assert.match(hrView, /alertsDismissed = false; setShut\(false\);/);
  assert.match(css, /\.alerts-recall \{ margin: 0 0 12px; font-size: 12\.5px; \}/);
});

test('.fold-pill is a class, and the digest it shares a screen with is untouched', () => {
  // Worn by a `<button>`, so it resets what a button brings with it — a UA
  // background, border and font — none of which a `<summary>` has.
  assert.match(css, /\.fold-pill \{[\s\S]*?background: none; color: inherit; cursor: pointer;/);
  assert.match(hrView, /<button\s+type="button"\s+className="fold-pill"/);
  // 44px on a phone, like every other decision control at that width.
  assert.match(phone, /\.fold-pill \{ min-height: 44px; padding: 6px 16px; \}/);
  // The 44 is the floor, so the panel gives back its own padding instead —
  // and only this panel: `.alert.tight` is worn all over the app.
  assert.match(phone, /\.month-card > \.alert\.tight \{ padding: 8px 12px; \}/);
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
