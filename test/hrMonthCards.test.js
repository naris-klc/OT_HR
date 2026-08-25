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
  assert.ok(!/matchMedia|innerWidth|isMobile/.test(hrView), 'the layout is the stylesheet’s to decide');
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
  assert.ok(!/matchMedia|innerWidth|isMobile/.test(hrView), 'the layout is the stylesheet’s to decide');
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

test('the one-signature notice is one line, with the rest one tap away', () => {
  const note = hrView.slice(
    hrView.indexOf('{data.hrVerifiedCount > 0 && ('),
    hrView.indexOf('{data.supersededCount > 0 && ('),
  );
  // INFO and not amber: nothing here is wrong. What it is, is the one figure a
  // หัวหน้า could not otherwise account for.
  assert.match(note, /<Alert kind="info" tight>/);
  // The count and the chip's own name — that is the whole of the line.
  assert.match(note, /อนุมัติชั้นเดียว/);
  assert.match(note, /HR ตรวจสแกนนิ้ว/);
  // The three sentences that used to sit in front of the birthday table.
  // `<details>` and not state: the month reloads underneath this whenever the
  // period or สถานะที่นับ changes.
  assert.match(note, /<details className="notice-fold">/);
  const fold = note.slice(note.indexOf('<details'));
  assert.match(fold, /ไม่ได้ผ่านการอนุมัติของหัวหน้างาน/);
  assert.match(fold, /ดู \/ แก้ไขรายการ/);
  assert.ok(!/matchMedia|innerWidth|isMobile/.test(hrView), 'the layout is the stylesheet’s to decide');
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
