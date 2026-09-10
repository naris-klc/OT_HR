import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { highlightParts, personMatches } from '../lib/personSearch.js';

/**
 * ค้นหาพนักงานบนตรวจสอบรายเดือน.
 *
 * A screen filter and nothing more: it narrows what was already fetched, costs
 * no request, and cannot change a figure. Two things about it are worth holding
 * down, and neither is the typing.
 *
 * ONE SCREEN, AND IT WAS TWO. สรุป OT ส่งบัญชี carried the same box from
 * 2026-08-26 and gave it up on 2026-08-27 — asked for, to get the card above
 * the figures down from 488px to 393 on a phone. Everything this file pins is
 * ตรวจสอบรายเดือน's again. What went with it is in README and in
 * docs/features.md; the shared pieces it used — `personMatches`, `Highlight`,
 * `.pick-menu.find-menu`, `.hit` — all still have callers and are still
 * pinned below.
 *
 * THE RULE IS THE ROSTER'S RULE. `personMatches` is what ทะเบียนพนักงาน and
 * กรองตามพนักงาน already ask, so a code typed either way round finds the same
 * person on all three screens — this roster has PM-0412 and PM00511 both live
 * (src/lib/employeeCode.js). A second search written inline here would be a
 * second answer to that, and the day they disagreed the disagreement would be
 * between two screens showing the same month.
 *
 * WHAT MAY AND MAY NOT FOLLOW THE FILTER. The print bundle MUST — its own note
 * says it is "exactly the rows of ตรวจสอบรายเดือน as they stand", and a search
 * that narrowed the screen and not the document would send forty sheets to the
 * printer when three were asked for. รวมทั้งหมด and the two CSVs MUST NOT: the
 * total is the month's, computed by the server over every row it sent, and it
 * is read against the CSV and against the paper. A total that changes as
 * somebody types is not the month's any more.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const hrView = read('components/HrView.jsx');
const css = read('app/styles.css');

// ── the rule ─────────────────────────────────────────────────────────────────

test('the screen asks the roster’s own search, not one of its own', () => {
  assert.match(hrView, /import \{ personMatches \} from '@\/lib\/personSearch\.js'/);
  // `query` and not `find` since the debounce landed — the string the screen was
  // filtered BY, which is also what the count, the empty state, the highlight
  // and the suggestion list read. See the live-search section at the foot.
  assert.match(
    hrView,
    /\(data\?\.employees \|\| \[\]\)\.filter\(\(row\) => personMatches\(row\.employee, query\)\)/,
  );
  // No second rule written by hand beside it.
  assert.ok(!/toLowerCase\(\)\.includes/.test(hrView), 'a hand-rolled match crept in beside personMatches');
});

test('both spellings of a code find the person, and word order does not matter', () => {
  // The behaviour the shared rule buys — pinned here because this screen is a
  // caller of it, and a caller that stopped calling it would still pass above.
  const somchai = { code: 'PM-0412', name: 'สมชาย ใจดี' };
  const thawon = { code: 'PM00511', name: 'ถาวร มั่นคง' };

  assert.ok(personMatches(somchai, 'PM0412'));
  assert.ok(personMatches(somchai, 'pm-0412'));
  assert.ok(personMatches(thawon, 'PM-00511'));
  assert.ok(personMatches(somchai, 'ใจดี สมชาย'));
  assert.ok(personMatches(somchai, 'สมชายใจดี'));
  assert.ok(!personMatches(somchai, 'ถาวร'));

  // An empty box is not a filter — every row matches, so there is no branch on
  // the screen for "not searching".
  assert.ok(personMatches(somchai, ''));
  assert.ok(personMatches(thawon, '   '));
});

// ── what follows the filter, and what must not ───────────────────────────────

test('the printed bundle is the rows on screen, however few', () => {
  assert.match(hrView, /onClick=\{\(\) => setPrinting\(\{ employees: shown\.map\(\(r\) => r\.employee\) \}\)\}/);
  assert.match(hrView, /disabled=\{!shown\.length\}/);
  // `shown`, and not `data.employees`. The second argument is the row's place
  // in the list, which is what the phone's page window compares against — see
  // `CARD_PAGE` and `test/hrMonthCards.test.js`. Whatever else this grows, the
  // list it maps over is the search's, or the bundle and the screen have
  // stopped agreeing.
  assert.match(hrView, /\{shown\.map\(\(row, i\) => \(/, 'the table still draws the unfiltered list');
});

test('รวมทั้งหมด stays the month’s figure, and says which total it is', () => {
  // Recomputing it over the visible rows was the other option and is the wrong
  // one: this line is read against the CSV and against the paper.
  assert.match(hrView, /hours\(data\.grandTotal\.otHours\)/);
  assert.ok(
    !/shown[\s\S]{0,120}reduce/.test(hrView),
    'the total is being recomputed from the filtered rows',
  );
  assert.match(hrView, /\{find \? 'รวมทั้งเดือน' : 'รวมทั้งหมด'\}/);
  assert.match(hrView, /ไม่ใช่ยอดของผลการค้นหา/);
});

test('and the exports say they did not follow it', () => {
  // They are built by the server from the month, สถานะที่นับ and — since
  // 2026-09-10 — แผนก. A file longer than the screen is a surprise somebody
  // finds after opening it.
  assert.match(hrView, /ไฟล์ CSV และยอด “รวมทั้งหมด” ยังเป็นของ/);
  assert.match(hrView, /ไม่ใช่เฉพาะผลการค้นหา/);
  // "ทั้งเดือน" ON ITS OWN IS ONLY TRUE AT ทุกแผนก, which is the one thing the
  // department filter changed about this sentence: with ผลิต1 chosen the file
  // holds ผลิต1's month, and a reader told "ทั้งเดือน" over a table of four
  // people has been promised twenty-four. Both readings are written out.
  assert.match(hrView, /dept \? `ทั้งเดือนเฉพาะแผนก “\$\{deptName\}”` : 'ทั้งเดือน'/);
});

// ── the box itself ───────────────────────────────────────────────────────────

test('a magnifier at one end, a ✕ at the other, and neither is invented here', () => {
  assert.match(hrView, /<Icon name="search" className="searchbox-icon" \/>/);
  // The ✕ shuts the suggestion list as well as emptying the box: an empty query
  // matches everybody, so a list left open would be the whole month hanging over
  // the table it was just asked to stop narrowing.
  assert.match(hrView, /\{find && <ClearButton onClear=\{\(\) => \{ setFind\(''\); setOpen\(false\); \}\} \/>\}/);
  assert.match(hrView, /placeholder="ค้นหาชื่อ หรือ รหัสพนักงาน…"/);
  // Both ends are opt-in by class, so กรองตามพนักงาน's box is unchanged.
  assert.match(hrView, /className=\{`has-icon\$\{find \? ' has-clear' : ''\}`\}/);
  assert.match(css, /\.searchbox input\.has-icon \{ padding-left: 40px; \}/);
  // The glass is a picture: a press anywhere in the field, the icon included,
  // puts the caret in the box.
  assert.match(css, /\.searchbox \.searchbox-icon \{[\s\S]*?pointer-events: none;/);
  assert.match(read('components/icons.jsx'), /search: \(/);
});

test('the box is the same box as every other field on the screen', () => {
  // ทะเบียนพนักงาน's search shipped bare once and drew at the browser's default
  // width, with the browser's border and no fill. `.field` is the fix and the
  // stylesheet must not be re-stating any of it.
  const row = hrView.slice(hrView.indexOf('className="row month-find"'), hrView.indexOf('className="found"'));
  assert.match(row, /<div className="field">\s*<div className="searchbox">/);
  const rule = css.slice(css.indexOf('.month-find {'), css.indexOf('.month-find {') + 900);
  assert.ok(!/\.month-find .*input \{/.test(rule), 'the stylesheet is restyling the input');
});

test('no result is an answer, with a way out of it', () => {
  assert.match(hrView, /ไม่พบข้อมูลพนักงานที่ค้นหา/);
  const empty = hrView.slice(hrView.indexOf('ไม่พบข้อมูลพนักงานที่ค้นหา'));
  assert.match(empty.slice(0, 400), /ล้างการค้นหา/);
  // And it replaces the table rather than sitting under an empty one. Matched
  // without the closing bracket: the wrap carries the pager's `ref` now.
  assert.ok(
    hrView.indexOf('shown.length === 0 ? (') < hrView.indexOf('<div className="table-wrap card-list"'),
  );
});

test('a month with no rows at all still says that, not “not found”', () => {
  // The two empty states are different facts and the older one comes first.
  assert.ok(
    hrView.indexOf('ไม่มีรายการในเดือนนี้') < hrView.indexOf('ไม่พบข้อมูลพนักงานที่ค้นหา'),
  );
});

// ── ประจำเดือน sits in this row too ──────────────────────────────────────────

/**
 * Added 2026-08-27, and it is a MOVE rather than a new control — twice in one
 * day, which is the part worth writing down.
 *
 * THE FIRST MOVE. The picker was in the card at the top of the screen, beside
 * สถานะที่นับ. It was reported that day as this screen not saying which month it
 * was showing — true as a symptom and wrong as a cause: measured at 360px the
 * picker was 465px above the search box, with the export row and งวด…ยังเปิดอยู่
 * between them, so by the time anybody was reading the list it was two screens
 * back. It went into the row directly above the list, beside ค้นหา.
 *
 * THE SECOND took that row back into the controls card, one row under the
 * heading and สถานะที่นับ and ABOVE the export buttons, and it was asked for as
 * setting the งวด before the buttons that print it. So the card reads: what the
 * month is, then which of it to look at, then what to do with it — and the two
 * controls that decide which figures exist are on adjacent lines again rather
 * than 465px and a lock bar apart.
 *
 * WHAT IS GIVEN UP, said plainly because the test that pinned it is gone: ค้นหา
 * is no longer the last thing before the first card. `.export-row` and
 * งวด…ยังเปิดอยู่ are between them now. The count beside the box says how far
 * the list was narrowed without anybody scrolling to it, and the suggestion list
 * still jumps straight to a row, which is the path that never travels the
 * distance at all.
 *
 * WHAT NEITHER MOVE DID IS SAVE HEIGHT, and that was measured rather than
 * assumed: on the first, the header card went 385px → 308 and the new row went
 * 69 → 146, and the first employee card did not move by a pixel (842 both times,
 * on the built app at 360px). Controls cost what they cost wherever they are
 * put. The 44px this screen did give back came from deleting the UTF-8 BOM line
 * under the export buttons, which is the last test in this block; the card round
 * the list going away is worth more than either move, and is pinned in
 * test/hrMonthCards.test.js.
 */

test('ประจำเดือน and ค้นหา are one row, above the buttons that act on them', () => {
  const row = hrView.slice(hrView.indexOf('className="row month-find"'), hrView.indexOf('</ul>'));
  // `PickMonth` since 2026-09-01 — the app's own calendar, in place of the
  // `<input type="month">` whose popup was the browser's and could not be
  // reached by anything in this repo. Same value, same state, same row.
  assert.match(row, /<PickMonth label="ประจำเดือน" value=\{period\} onChange=\{setPeriod\} \/>/,
    'the month picker is not in the row that filters the list');
  // Once, and in one place: two pickers bound to the same state is two controls
  // a reader has to notice agree.
  assert.equal((hrView.match(/<PickMonth/g) || []).length, 1,
    'there is more than one month picker on this screen');
  // สถานะที่นับ stays on the heading line, one row up. It is the third thing
  // that decides which figures exist, and all three are above the buttons.
  //
  // `PickOne` SINCE 2026-09-01, so the label is a prop and not a `<label>` in
  // this file — the component renders its own, with an `id` for
  // `aria-labelledby` to point at, which the bare `<label>` this replaced never
  // had anything to point with. The assertion follows the label rather than the
  // tag: what it is here to hold down is that the words are on this screen and
  // on the heading row, not which element carries them.
  assert.match(hrView, /<PickOne\s+label="สถานะที่นับ"/);
  // THE ROW IS IN THE CARD, AND ABOVE THE BUTTONS. Both halves: inside
  // `.month-head` says the controls are together, before `.export-row` says the
  // งวด is settled before anything offers to print it.
  const head = hrView.indexOf('<div className="card month-head">');
  const find = hrView.indexOf('<div className="row month-find">');
  const exports = hrView.indexOf('className="row export-row"');
  const status = hrView.indexOf('<PeriodStatus');
  assert.ok(head > 0 && find > head, 'the search row left the controls card');
  assert.ok(find < exports, 'the export buttons are back above the month and the search box');
  // สรุปสถานะงวด sits UNDER the buttons that print and export, because it is
  // the check somebody makes on the way to pressing them. It was PeriodLockBar
  // and the ordering argument was the same one; see lib/periodStatus.js.
  assert.ok(exports < status, 'สรุปสถานะงวด moved into the controls card');
});

test('the month comes first in the row, because it decides what the search searches', () => {
  const row = hrView.slice(hrView.indexOf('className="row month-find"'));
  assert.ok(
    row.indexOf('<label>ประจำเดือน</label>') < row.indexOf('className="searchbox"'),
    'the search box moved above the month it is searching',
  );
});

test('the month box has a width of its own, or it takes half the line', () => {
  // `.field` is `flex: 1`, which is `flex: 1 1 0%` — a basis of nothing. Two
  // fields both grasping at nothing split the row in half, and half a row is too
  // much for a month and too little for a name.
  assert.match(css, /\.month-find \.month-pick \{ flex: 0 0 170px; \}/);
});

test('the UTF-8 BOM line is gone from under the export buttons', () => {
  // สรุป OT ส่งบัญชี dropped this same sentence for the same reason — an
  // encoding detail reassures once and is noise every month after — and this
  // screen kept it until 2026-08-27. It was 43 of the 150px that row cost on a
  // 360px phone. The files still carry the BOM; see `src/lib/csv.js`.
  // The Thai sentence and not the words "UTF-8 BOM": the comment left in its
  // place says those, which is a test failing on its own explanation.
  assert.ok(
    !/เปิดใน Excel ภาษาไทยได้ทันที/.test(hrView),
    'the encoding note is back above the list',
  );
});

// ── the box, on the layout that scrolls ──────────────────────────────────────

/**
 * ── THE BOX SCROLLS AWAY WITH THE LIST, AND THAT IS THE POINT ───────────────
 *
 * This test asserted the opposite until 2026-08-26. `.month-find` was
 * `position: sticky; top: 62px; z-index: 30` with a forced opaque fill, parked
 * under the app bar so a forty-person list could be re-filtered without
 * scrolling back — and the assertions here pinned the fill and the layer
 * because a transparent bar over moving cards is unreadable.
 *
 * WHAT TOOK IT OUT was a report of the first card's employee name having
 * disappeared. Nothing was clipping it: in flow the first card sits 12px under
 * this box, one card-gap, like every other card. The bar was ON it — measured
 * at 360px, the two stuck bars owned 0–131 and the name sat at 15–54 — and the
 * first card is only special in being where a thumb stops.
 *
 * AND THE REASON HAD ALREADY GONE. The bar was written for a list nine screens
 * long; the pager made it five cards.
 *
 * ── AND ON 2026-08-27 THE STRIP WENT WITH THE CARD IT WAS A STRIP OF ────────
 *
 * What was left after the sticky came out was four declarations — negative side
 * margins, padding, a `--bg` fill and a hairline — and every one of them existed
 * to make a row that was INSIDE `.month-card` stop looking like part of it. The
 * row left that card, and by the end of the day it was in `.month-head` with the
 * heading and the export buttons: an ordinary row of an ordinary card, bounded
 * by the same padding both of those are bounded by. So the margins have nothing
 * to negate, the padding gives back nothing, the fill would paint a card its own
 * colour and the hairline would draw a boundary between two rows of one card.
 *
 * WHAT THIS PINS is that none of them comes back — and neither does the sticky,
 * the layer or the `!important` under it.
 */
test('the box is a row of the controls card, not a strip stuck over the list', () => {
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  const at = phone.indexOf('.month-find {');
  const rule = phone.slice(at, phone.indexOf('\n  }', at)).replace(/\/\*[\s\S]*?\*\//g, '');

  assert.ok(!/position:\s*sticky/.test(rule), 'the search box went back to being stuck over the cards');
  assert.ok(!/z-index/.test(rule), 'the search box is stacking against something again');
  assert.ok(!/!important/.test(rule), 'the forced fill came back without the sticky that needed it');

  // The four that were the card's, and are nobody's now.
  assert.ok(!/margin-left|margin-right/.test(rule), 'the full-bleed margins came back without the card that needed them');
  assert.ok(!/padding/.test(rule), 'the row is giving back padding it is not being charged');
  assert.ok(!/background/.test(rule), 'the row is painting the page its own colour');
  assert.ok(!/border/.test(rule), 'the hairline came back over a gap that is already a gap');

  // AND THE MARKUP IS THE OTHER HALF OF IT. A stylesheet cannot say which
  // element is somebody's parent, so the rules above are only true while this
  // is: the row is inside `.month-head` and nowhere near the list.
  const head = hrView.indexOf('<div className="card month-head">');
  const find = hrView.indexOf('<div className="row month-find">');
  const list = hrView.indexOf('<div className="card month-card">');
  assert.ok(head < find && find < list, 'the search row is back inside the month card');

  // คิวรออนุมัติ's bar IS still stuck, at the same 62 this one used to take —
  // that screen is a queue worked through top to bottom, not a five-card page.
  assert.match(css, /\.queue-mobile-bar \{[\s\S]*?position: sticky; top: 62px; z-index: 20;/);

  // Desktop never had any of it.
  const desktop = css.slice(0, css.indexOf('@media screen and (max-width: 860px)'));
  assert.ok(!/\.month-find \{[^}]*sticky/.test(desktop), 'the box went sticky on the desktop too');
});

/**
 * THE MONTH PICKER CANNOT BE INSIDE THE THING IT CHOOSES.
 *
 * This is the defect the move above fixed on the way past, and it is the one
 * worth a test of its own: while the row was the first child of `.month-card`
 * it was also inside the `data.employees.length === 0` branch, so a month with
 * no entries drew ไม่มีรายการในเดือนนี้ and no picker at all. The one control
 * that takes a reader OUT of an empty month was the control the empty month
 * took away, and the only way back was the browser's reload.
 */
test('the month picker is drawn on a month with no entries in it', () => {
  // ELEMENTS AND A BRANCH, NOT THE THAI AND NOT THE CONDITION. Both of those
  // are also in the comment over the row explaining this very defect, and
  // matching them found the explanation — the fifth assertion in this codebase
  // to catch a comment instead of the code it describes, and it took two
  // minutes rather than eleven days because it was written and run here.
  const row = hrView.indexOf('<div className="row month-find">');
  const empty = hrView.indexOf('<Empty>ไม่มีรายการในเดือนนี้</Empty>');
  assert.ok(row > 0 && empty > 0, 'the row or the empty state was not found');
  assert.ok(row < empty, 'the search row is drawn after the empty-month branch decides');
  // …and the branch that decides it opens after the row, so the row is outside.
  assert.ok(
    row < hrView.indexOf(') : data.employees.length === 0 ? ('),
    'the picker is back inside the “this month has entries” branch',
  );
});

/**
 * NOTHING NEW MAY LAND BETWEEN THE PHONE'S BARS AND THE DIALOGS.
 *
 * This lived inside the test above, where it was checking the layer
 * `.month-find` used to take. The box carries no z-index any more; the sweep
 * does, because what it guards is the whole 40–79 band and not that one rule.
 */
test('nothing new is stacked between the phone bars and the dialogs', () => {
  /*
   * THE ONE EXEMPTION IS `.dept-menu`, and it is cut out rather than the range
   * widened. It carries 50, and it cannot be the thing this guards against: it
   * lives inside `.modal-body`, which scrolls and therefore clips its own
   * children on both axes, so nothing it paints reaches the page at all.
   *
   * Rules only. Half this stylesheet is prose about which layer sits over
   * which, and a paragraph that names a number is not an element that carries
   * one — matching the comments is how this reads its own explanation as the
   * defect it warns about.
   */
  const own = css.indexOf('.pick-menu.dept-menu {');
  const outside = (css.slice(0, own) + css.slice(css.indexOf('}', own)))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/z-index: (4[0-9]|[5-7][0-9])\b/.test(outside), 'something new landed between this bar and the dialogs');
  assert.match(css.slice(own, css.indexOf('}', own)), /z-index: 50;/, 'the exemption above is stale');
});

test('the space over the box is the space between two rows of one card', () => {
  // A TOP MARGIN, AND IT IS `.export-row`'S OWN NUMBER — 12px, the gap this
  // card puts between the heading row and this one and between this one and the
  // buttons. It was `margin-bottom: 12px` for the few hours the row stood on the
  // page ground between two cards, where 12 was the gap two cards keep.
  //
  // WHY THE SIDE IT IS ON MATTERS. `.export-row` declares its own 12px top
  // margin, so a bottom margin here would be two adjacent margins asking for the
  // same gap; they collapse to the larger, and the number a reader gets is not
  // the number either rule states.
  //
  // The selector carried `.acct-find` beside this one from 2026-08-26 until
  // 2026-08-27, when ส่งบัญชี's box was taken out. One caller again.
  assert.match(css, /\.month-find \{ align-items: flex-end; gap: 10px 14px; margin-top: 12px; \}/);
  // …AND ON A PHONE IT IS 8, which is what `.export-row` takes at that width for
  // the reason stated there: at 12 the gap reads as a section break between
  // controls that belong to each other.
  //
  // IT IS ALSO THE ONLY THING THE PHONE RULE SAYS. The padding it used to carry
  // — `8px var(--month-pad) 10px` — was the other half of the full-bleed
  // margins, and both went out with the card; the test above pins that none of
  // them comes back.
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.month-find \{[\s\S]*?margin-top: 8px;/);
  assert.match(phone, /\.export-row \{\s*margin-top: 8px;/);
});

test('the two boxes in that row end on the same line', () => {
  // WHAT WAS REPORTED, on 2026-08-28: on a desktop the search box sat high
  // beside ประจำเดือน — its bottom edge level with nothing, its top edge level
  // with that field's LABEL — so it read as belonging to the label rather than
  // standing beside the box under it.
  //
  // THE CAUSE WAS ONE WORD. `.row` is `align-items: flex-end` precisely so that
  // fields of different total height end on one line; `.month-find` overrode it
  // with `center`. ประจำเดือน is a `.field` WITH a label — 12px of type, a 7px
  // gap, a 46px box, 65 in all — and ค้นหา is a `.field` with none, so centring
  // the two in the taller one's line hung the shorter one nine pixels up.
  //
  // Pinned as the base rule's own value and not as a literal: if `.row` ever
  // ends its children differently, this row is not the place that should be
  // the one disagreeing with it.
  const base = css.slice(css.indexOf('.row { display: flex;'));
  assert.match(base.slice(0, base.indexOf('}')), /align-items: flex-end/, 'the base row rule moved');
  assert.ok(!/\.month-find \{[^}]*align-items: center/.test(css), 'the row is centring its fields again');

  // AND THE COUNT KEEPS `center`, WHICH IS THE WHOLE OF WHAT THE ROW-WIDE
  // `center` WAS EVER WANTED FOR. แสดง n จาก n คน is one line of type beside two
  // 46px boxes: stood on the row's floor its descenders would hang below
  // theirs, so it is centred on its own.
  assert.match(css, /\.month-find \.found \{ align-self: center;/);
});

test('the heading and สถานะที่นับ start on the same line, and it is a class that says so', () => {
  // THE ROW ABOVE `.month-find`, AND THE OPPOSITE ANSWER — deliberately.
  // Reported on 2026-08-28, the same round as the search box below it: สถานะที่นับ
  // floated above ตรวจสอบรายเดือน. Measured on the running app at 1280px, the
  // right column started 23.75px above the left (y=202.5 against y=226.25),
  // because the heading block is 42.25px tall (19.5 + 4 + 18.75) and the
  // labelled field is 66 (12 + 7 + 47), and the row was ending them level.
  //
  // `.month-find` KEEPS `flex-end` AND THIS ROW DOES NOT, which is the pair
  // worth holding down together: two boxes end level because a reader compares
  // their bottom edges, and a heading against a caption is compared by the line
  // its writing sits on. A rule that made both rows agree would be wrong on one
  // of them.
  //
  // AND IT IS `baseline`, WHICH THIS ASSERTION READ AS `flex-start` FOR THREE
  // ROUNDS. `flex-start` was shipped to all three cards and each round signed
  // off on it by measuring the two columns' top EDGES at 0.00px apart — and the
  // same report came back in the same words each time, because the top edge is
  // not where anybody looks. At 15px on a 19.5px line against 12px on a 12px
  // line, boxes flush leaves the two lines of writing 4px apart: rulers drawn
  // across the running app at 1440px on 2026-08-28 put the heading's baseline
  // at y=123 and บริษัท's at y=119, with the label's line running through the
  // middle of the heading's letters. `baseline` spends that 4px the other way —
  // the field drops, the card grows 4px, the texts share one line.
  //
  // A `margin-top: 4px` on the fields measures the same today. It is not what
  // is here because it is a number copied out of two font sizes, and stale the
  // moment either moves; `baseline` re-derives it. Do not put the top-edge
  // measurement back on the strength of devtools — the eye reads the ink.
  assert.match(css, /\.head-split \{ align-items: baseline; \}/);
  assert.ok(hrView.includes('<div className="row head-split">'), 'the heading row lost its class');

  // AND IT IS `.head-split`, NOT `.month-head-top`, WHICH IT WAS FOR ONE
  // COMMIT. ส่งบัญชี was reported with the identical row and the identical
  // 23.75px the same day; a rule named after the first card that needed it is
  // how the second card ends up with a copy of the declaration rather than a
  // reference to it. All three callers are pinned so none can quietly drop out
  // and leave a shared rule with one user and a misleading name.
  const acct = readFileSync(join(ROOT, 'components/AccountingView.jsx'), 'utf8');
  assert.ok(acct.includes('<div className="row head-split">'), 'ส่งบัญชี stopped sharing the rule');

  // THE THIRD IS สรุป OT แยกแผนก, reported on 2026-08-28 in the same words as
  // the other two and answered by adding the class and nothing else — no line
  // of CSS was written for it, which is what a shared rule is FOR. Its number
  // was 5.5px and not 23.75 (heading block y=114.5, fields y=109, measured on
  // the running app at 1280px): that card's hint runs to two lines, so the left
  // side is 61px against the field's 66.5 rather than 42.25 against 66. Ending
  // them level simply had less to give away. Which edge lines up is the
  // question this rule answers, and the answer does not depend on the gap.
  const dept = readFileSync(join(ROOT, 'components/DepartmentView.jsx'), 'utf8');
  assert.ok(dept.includes('<div className="row head-split">'), 'แยกแผนก stopped sharing the rule');

  // AND IT IS A CLASS, NOT THE INLINE `alignItems` IT REPLACED. Same reason
  // `.export-row` and `.deleg-head-text` are classes: the 860px block cannot
  // reach an inline style, so a rule that needs to would have to rewrite the
  // JSX first. Nothing needs to today — `.field` is `min-width: 100%` down
  // there and the two sides stack — which is exactly when it is cheap to move.
  assert.ok(!/alignItems/.test(hrView), 'a layout decision went back inline');
});

/**
 * The containers this screen stacks before the list, and what is left of them.
 *
 * Trimmed on 2026-08-27, asked for as "reduce the padding". It was worth 21px
 * above the first employee card, measured on the built app at 360px — 798 → 777
 * — and that was the whole of what padding had left to give while there were
 * three of them. The round before it had already established that MOVING
 * controls gives nothing.
 *
 * THERE ARE TWO NOW, not three: `.month-card` stopped being a card later the
 * same day, so what stacks above the list is the controls card and
 * งวด…ยังเปิดอยู่, and the 12px this pins is one container's, not two. That was
 * worth more than the trim was — the card's padding, its border and the 16px it
 * left under itself, all of it above and below a list that was already drawn as
 * cards. See test/hrMonthCards.test.js for the rule and the reasoning.
 */
test('the one card above the list is 12px, and the list itself is nobody’s card', () => {
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.month-head \{ padding: 12px; \}/,
    'the controls card stopped stating its own padding');
  // A LITERAL AGAIN, AND THAT IS THE POINT OF THE PAIR. It was `--month-pad`
  // while two rules had to agree — this padding, and the negative margins that
  // pulled the list back out through it. The list is not inside anything now, so
  // there is one consumer, and a token with one consumer is a name standing in
  // front of a number.
  assert.ok(!phone.replace(/\/\*[\s\S]*?\*\//g, '').includes('--month-pad'),
    'the token came back');
  // The gap a card leaves under itself: 16 everywhere else, and 18 for the two
  // things that stack above this list.
  //
  // IT READ 13 FROM THE MORNING OF 2026-08-27 UNTIL THAT AFTERNOON, when the
  // ask was "เพิ่ม Margin-bottom ให้การ์ด งวด…ยังเปิดอยู่ เล็กน้อย เพื่อแยก
  // สัดส่วนระหว่าง Action Panel ด้านบน กับ Status Card ให้ชัดเจนยิ่งขึ้น" — a
  // property on one side of the status card, a reason on the other, and one
  // number answers both because both gaps are this rule. Three blocks at an
  // identical 13 was a column with no joints in it; the list under them keeps
  // its own 12px `gap`, so the column now reads 18 · 18 · 12 · 12 · 12 and the
  // joint is where a reader was already trying to put one.
  //
  // The 5px it costs against the trim this test is named for is paid back many
  // times over the same afternoon — the pager band and the birthday card gave
  // about 350px on this screen. Height was never the reason for the 13.
  //
  // THE SELECTOR IS `.period-status` SINCE 2026-08-31, AND THE 18 IS UNCHANGED.
  // The card was renamed when ปิดงวด was withdrawn and it stopped being a lock
  // bar (lib/periodStatus.js). The number is what was signed off that afternoon
  // and it did not move; only the class the rule reaches it by did.
  assert.match(phone, /\.month-head, \.card\.period-status \{ margin-bottom: 18px; \}/);
  // ONLY THIS SCREEN. `.card` is worn by every screen in the app.
  assert.match(css, /\.card \{ padding: 15px; border-radius: var\(--radius\); \}/,
    'the phone padding of every card in the app moved');
});

test('the placeholder is a prompt, not an answer', () => {
  // A step off `--ink`, so the prompt and a real query are never the same
  // weight of text in the same box.
  assert.match(css, /\.searchbox input::placeholder \{ color: var\(--muted-2\); opacity: 1; \}/);
  // Scoped to the boxes that are typed INTO. Everywhere else a placeholder is a
  // sample value and reads as one at the browser's own grey.
  assert.ok(
    !/\.field input::placeholder/.test(css),
    'every field in the app just had its placeholder restyled',
  );
});

// ── live filtering: the debounce, and where the match is drawn ────────────────

/**
 * Added 2026-08-26, asked for as "Instant Live Search เหมือน Google".
 *
 * Two of the three things asked for were already true — the box filtered on
 * change with no Enter, and the count and the empty state followed it. What was
 * new is a 300ms debounce and a highlight, and the highlight is the part with a
 * trap in it: the filter's rule is fuzzy in two places, so a mark computed by
 * `indexOf` on the displayed string would mark NOTHING on exactly the rows the
 * fuzzy half brought in.
 */

test('the highlight is computed by the same rule that chose the row', () => {
  // A code typed without its hyphen marks the code WITH it. `indexOf('PM0412')`
  // on 'PM-0412' is -1, and this row is in the list.
  assert.deepEqual(
    highlightParts('PM-0412', 'PM0412', 'code'),
    [{ text: 'PM-0412', hit: true }],
  );
  // A Thai name typed without its space marks the name WITH it.
  assert.deepEqual(
    highlightParts('สมชาย ใจดี', 'สมชายใจดี', 'name'),
    [{ text: 'สมชาย ใจดี', hit: true }],
  );
  // A term carrying Thai never reaches the code test, so it marks nothing there
  // — the same guard `personMatches` uses, for the same reason.
  assert.deepEqual(
    highlightParts('PM-0412', 'ใจดี', 'code'),
    [{ text: 'PM-0412', hit: false }],
  );
  // An empty box marks nothing at all: one unmarked piece, which is what lets
  // the component render the plain string it rendered before this existed.
  assert.deepEqual(
    highlightParts('สมชาย ใจดี', '', 'name'),
    [{ text: 'สมชาย ใจดี', hit: false }],
  );
});

test('a mark never lands between a Thai letter and the vowel written on it', () => {
  // "ส" matches the BASE letter of สุจินดา and the raw range is one code unit —
  // so the mark's own background was drawn between ส and the vowel that sits on
  // it, splitting one syllable in two. Thai sets no space between words, so
  // that gap reads as a word break in the middle of a name.
  assert.deepEqual(
    highlightParts('สุจินดา แรงกสิวิทย์', 'ส', 'name'),
    [
      { text: 'สุ', hit: true },
      { text: 'จินดา แรงก', hit: false },
      { text: 'สิ', hit: true },
      { text: 'วิทย์', hit: false },
    ],
  );
  // A tone mark counts too — แป้ is one cluster.
  assert.deepEqual(
    highlightParts('ถาวร แป้นวงษ์', 'แป', 'name'),
    [
      { text: 'ถาวร ', hit: false },
      { text: 'แป้', hit: true },
      { text: 'นวงษ์', hit: false },
    ],
  );
  // And a letter with nothing on it is still just the letter.
  assert.deepEqual(
    highlightParts('สมชาย ใจดี', 'ส', 'name'),
    [{ text: 'ส', hit: true }, { text: 'มชาย ใจดี', hit: false }],
  );
});

test('the pieces put the name back together exactly, or the screen loses characters', () => {
  // The renderer maps over these. Anything that does not rejoin to the source is
  // a name with a letter missing on a payroll sheet.
  const cases = [
    ['สุจินดา แรงกสิวิทย์', 'ส', 'name'],
    ['สมชาย ใจดี', 'สมชายใจดี', 'name'],
    ['ถาวร แป้นวงษ์', 'แป้น วงษ์', 'name'],
    ['PM-0412', 'pm 0412', 'code'],
    ['THT0074', 'THT-0074', 'code'],
    ['วิชัย ศรีสุข', '', 'name'],
    ['', 'ส', 'name'],
  ];
  for (const [text, query, kind] of cases) {
    assert.equal(
      highlightParts(text, query, kind).map((p) => p.text).join(''),
      text,
      `${kind} "${text}" × "${query}" did not rejoin`,
    );
  }
});

test('the mark is the app’s green, not the browser’s highlighter', () => {
  // `<mark>` is the element that means "here because you searched" — but the UA
  // sheet paints it in absolute colours, so left alone it is a yellow felt-tip
  // across a charcoal card on the dark theme. Both are replaced.
  assert.match(read('components/common.jsx'), /<mark className="hit" key=\{i\}>/);
  assert.match(
    css,
    /\.hit \{\s*background: var\(--green-tint\); color: var\(--green-accent\); font-weight: 700;/,
  );
  // No side padding: two pixels inside "สุจินดา" read as a word break in a
  // script that has no spaces between words.
  assert.match(css, /\.hit \{[\s\S]*?border-radius: 2px; padding: 0;/);
  // A wrapped mark is two marks, not one box with a hole in it.
  assert.match(css, /\.hit \{[\s\S]*?box-decoration-break: clone;/);
});

/**
 * The one thing about a suggestion row that was asked for by hand, and so is
 * pinned by shape rather than by its pieces: THE CODE LEADS, IN BRACKETS.
 *
 * Asked for on 2026-08-26. It read "วิชัย ศรีสุข (PM-0100)" until then, and the
 * order is the point: every row of a list forty long starts with a Thai name of
 * its own length and the eye scanning down them has nothing to line up on. A
 * code is fixed-width, mono, and at the left edge it makes a column.
 *
 * It was two screens' rows and is one; the regex stayed as it was.
 */
const ROW_LEADS_WITH_THE_CODE = new RegExp(
  '<span className="s-code">\\s*'
  + '\\[<Highlight text=\\{row\\.employee\\.code\\} query=\\{query\\} kind="code" />\\]\\s*'
  + '</span>\\s*\\{\' \'\\}\\s*'
  + '<Highlight text=\\{row\\.employee\\.name\\} query=\\{query\\} kind="name" />',
);

/**
 * The third caller, added 2026-08-26 — and the first where picking a suggestion
 * does something other than move the page.
 *
 * ตรวจสอบรายเดือน is where a month is CHECKED and where a wrong figure is
 * CORRECTED, and correcting it means opening ดู / แก้ไขรายการ for one person.
 * So a pick here opens that screen, rather than scrolling to a row and stopping
 * as it does on ส่งบัญชี where the row IS the answer. What is pinned below is
 * the part of that flow which is easy to break and invisible when broken: the
 * scroll and the flash are DEFERRED to the moment the list is on screen again,
 * because at the moment of the pick there is no row to scroll to at all.
 */

test('ตรวจสอบรายเดือน’s box is the same combobox, not a third grammar', () => {
  assert.match(hrView, /className="pick-menu find-menu"/);
  assert.match(hrView, /role="listbox"/);
  assert.match(hrView, /role="combobox"/);
  assert.match(hrView, /aria-expanded=\{menuOpen\}/);
  assert.match(hrView, /aria-autocomplete="list"/);
  assert.match(hrView, /aria-activedescendant=\{menuOpen && suggestions\[at\] \? `\$\{listId\}-\$\{at\}` : undefined\}/);
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab']) {
    assert.ok(hrView.includes(`'${key}'`), `the box does not answer ${key}`);
  }
  assert.match(hrView, /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
  assert.match(hrView, /onMouseMove=\{\(\) => setActive\(i\)\}/);
  // THE PANEL IS NOT NAMED AFTER A SCREEN. It was `.acct-menu` while ส่งบัญชี
  // was its only caller, and was renamed when this screen became the second.
  // ส่งบัญชี has since given its box up altogether and this is the only caller
  // again — the name still must not go back, because the roster's own picker
  // shares the panel underneath it.
  // Rules only. The stylesheet keeps the old name in the paragraph that explains
  // the rename, and a test that read its own explanation as the defect it warns
  // about is a trap this file has fallen into before.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/acct-menu/.test(rules), 'the panel is named after one screen again');
});

test('a suggestion says who, which code, which department and how far into the ceiling', () => {
  const item = hrView.slice(hrView.indexOf('<span className="s-who">'), hrView.indexOf('</ul>'));
  assert.match(item, /<Highlight text=\{row\.employee\.name\} query=\{query\} kind="name" \/>/);
  assert.match(item, /<Highlight text=\{row\.employee\.code\} query=\{query\} kind="code" \/>/);
  assert.match(item, /\{row\.department\?\.nameTh \|\| row\.department\?\.name \|\| '—'\}/);
  // `capFigure` — the same helper the สะสม / เพดาน column prints, from the same
  // `row.cap`, so the suggestion and the row it opens cannot quote a person's
  // month differently. ส่งบัญชี's second line is `hours()` because that sheet
  // has no ceiling column to agree with.
  assert.match(item, /\{capFigure\(row\.cap\.usedHours, row\.cap\.capHours\)\} ชม\./);
  // The list IS the filtered rows, not a second list built beside them, so it
  // can never offer somebody the table is not showing.
  assert.match(hrView, /const suggestions = shown;/);
  // The same expression ส่งบัญชี is held to. Two tabs of one document putting
  // the code and the name in different orders is the difference this prevents.
  assert.match(item, ROW_LEADS_WITH_THE_CODE);
});

test('picking somebody opens their month — and leaves the filter alone', () => {
  const fn = hrView.slice(hrView.indexOf('function goToRow('), hrView.indexOf('function onFindKeyDown('));
  assert.match(fn, /setOpen\(false\);/);
  // The whole point of the pick on this screen: HR lands in the entries they
  // came to correct, without a second hunt down the list for the row.
  assert.match(fn, /setOpened\(row\.employee\);/);
  // NOT `setFind('')`. Clearing here would throw away the narrowing somebody
  // just did, and make the row they asked for one of sixty again the moment
  // they came back from it.
  assert.ok(!/setFind/.test(fn), 'picking a suggestion clears the search box');
  assert.ok(!/setQuery/.test(fn), 'picking a suggestion rewrites the applied query');
  // THE PAGE IS NOT LEFT ALONE, and that is a different thing. Below 860px the
  // list is five cards and everybody else is `display: none` — a person on page
  // 7 has no element on the screen to scroll to at all.
  assert.match(fn, /const i = shown\.findIndex\(\(r\) => r\.employee\._id === id\);/);
  assert.match(fn, /if \(i >= 0\) setPage\(Math\.floor\(i \/ CARD_PAGE\) \+ 1\);/);
  assert.match(hrView, /const rowDomId = \(employeeId\) => `hr-row-\$\{employeeId\}`;/);
  assert.match(hrView, /id=\{rowDomId\(row\.employee\._id\)\}/);
  assert.match(hrView, /flash === row\.employee\._id \? ' row-flash' : ''/);
});

test('the scroll and the flash wait for the list to exist', () => {
  // THE BUG THIS IS: `setOpened` replaces this whole screen by an early return,
  // so a scroll fired in the same breath as the pick measures a document with no
  // list in it, and 1800ms of flash burns down while HR is inside HrEntries.
  // `jump` is the request, `flash` is what is lit, and they are two states
  // because they are two moments.
  assert.match(hrView, /const \[jump, setJump\] = useState\(null\);/);
  assert.match(hrView, /const \[flash, setFlash\] = useState\(null\);/);
  const eff = hrView.slice(hrView.indexOf('    if (!jump || !data'), hrView.indexOf('}, [jump, data, printing, auditing, opened]);'));
  // Every screen that replaces the list is named, and so is the reload that
  // closing HrEntries triggers (`onChanged={load}` empties `data` first).
  assert.match(hrView, /if \(!jump \|\| !data \|\| printing \|\| auditing \|\| opened\) return undefined;/);
  assert.match(hrView, /\}, \[jump, data, printing, auditing, opened\]\);/);
  assert.match(eff, /window\.requestAnimationFrame\(\(\) => \{/);
  // `center`, because the app bar is sticky at the top of every screen and the
  // search box is sticky under it below 860px — a row sent to `start` lands
  // behind both.
  assert.match(eff, /block: 'center',/);
  assert.match(eff, /behavior: still \? 'auto' : 'smooth',/);
  assert.match(hrView, /const FLASH_MS = 1800;/);
  assert.match(hrView, /setTimeout\(\(\) => setFlash\(null\), FLASH_MS\)/);
});

test('the flash is on ตรวจสอบรายเดือน’s row, and the phone card fades to a card', () => {
  // ON THE ROW AND NOT ON ITS CELLS. This table has no sticky column, and below
  // 860px the `<tr>` IS the card: it carries the fill, the border and 15px of
  // padding, and the cells inside it are bare blocks. Lit cell by cell it would
  // come up green in stripes with its padding left plain. (ส่งบัญชี needed the
  // opposite answer for the opposite reason and had one until 2026-08-27; the
  // stylesheet keeps the shape of it beside `@keyframes rowFlash`.)
  assert.match(css, /\.hr-table tbody tr\.row-flash \{ animation: rowFlash 1800ms ease-out; \}/);
  // And that card is the one row in the app whose real background this file CAN
  // name — so it must, or the fade finishes by showing the page's ground through
  // the card for a frame.
  assert.match(css, /@keyframes rowFlashCard \{[\s\S]*?100% \{ background-color: var\(--card\); \}/);
  assert.match(
    css,
    /@media \(max-width: 860px\) \{\s*\.hr-table tbody tr\.row-flash \{ animation-name: rowFlashCard; \}\s*\}/,
  );
});

test('the clock, and the hooks that must stay above the early returns', () => {
  // 300ms. It read the same on ส่งบัญชี until that screen's box was removed on
  // 2026-08-27, and this was the assertion that kept the two equal; one screen
  // now, so what is left is the value itself.
  assert.match(hrView, /const FIND_DEBOUNCE_MS = 300;/);
  assert.match(
    hrView,
    /if \(find === ''\) \{ setQuery\(''\); return undefined; \}\s*const timer = setTimeout\(\(\) => setQuery\(find\), FIND_DEBOUNCE_MS\);/,
  );
  // Everything a reader compares reads the same string on this screen too.
  assert.match(hrView, /const searching = query\.trim\(\) !== '';/);
  assert.match(hrView, /ไม่พบข้อมูลพนักงานที่ค้นหา “\{query\}”/);
  // AND THE HOOKS ARE ABOVE THE EARLY RETURNS — four of them on this screen, one
  // per sub-view. A hook written below `if (opened)` is called on some renders
  // and not others, which is the one thing React cannot survive.
  assert.ok(
    hrView.indexOf('const [query, setQuery]') < hrView.indexOf('if (printing?.employees) {'),
    'the search hooks moved below the print early-return',
  );
  assert.ok(
    hrView.indexOf('const [flash, setFlash]') < hrView.indexOf('if (printing?.employees) {'),
    'the flash hooks moved below the print early-return',
  );
});
