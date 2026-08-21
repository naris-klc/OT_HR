import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { personMatches } from '../lib/personSearch.js';

/**
 * ค้นหาพนักงานบนตรวจสอบรายเดือน.
 *
 * A screen filter and nothing more: it narrows what was already fetched, costs
 * no request, and cannot change a figure. Two things about it are worth holding
 * down, and neither is the typing.
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
  assert.match(
    hrView,
    /\(data\?\.employees \|\| \[\]\)\.filter\(\(row\) => personMatches\(row\.employee, find\)\)/,
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
  assert.match(hrView, /\{shown\.map\(\(row\) => \(/, 'the table still draws the unfiltered list');
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
  // They are built by the server from the month and สถานะที่นับ. A file longer
  // than the screen is a surprise somebody finds after opening it.
  assert.match(hrView, /ไฟล์ CSV และยอด “รวมทั้งหมด” ยังเป็นของทั้งเดือน ไม่ใช่เฉพาะผลการค้นหา/);
});

// ── the box itself ───────────────────────────────────────────────────────────

test('a magnifier at one end, a ✕ at the other, and neither is invented here', () => {
  assert.match(hrView, /<Icon name="search" className="searchbox-icon" \/>/);
  assert.match(hrView, /\{find && <ClearButton onClear=\{\(\) => setFind\(''\)\} \/>\}/);
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
  // And it replaces the table rather than sitting under an empty one.
  assert.ok(
    hrView.indexOf('shown.length === 0 ? (') < hrView.indexOf('<div className="table-wrap card-list">'),
  );
});

test('a month with no rows at all still says that, not “not found”', () => {
  // The two empty states are different facts and the older one comes first.
  assert.ok(
    hrView.indexOf('ไม่มีรายการในเดือนนี้') < hrView.indexOf('ไม่พบข้อมูลพนักงานที่ค้นหา'),
  );
});

// ── the box, on the layout that scrolls ──────────────────────────────────────

test('the box stays on screen while a long list scrolls under it', () => {
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  const at = phone.indexOf('.month-find {');
  const rule = phone.slice(at, phone.indexOf('\n  }', at));

  // 62px is the app bar's height and the app bar is sticky at 0, so this is as
  // high as this bar can go without landing ON the title: `top: 0` plus a
  // z-index above the app bar's would bury it. The queue's bar, the app's other
  // sticky control, sits at the same 62.
  assert.match(rule, /position: sticky; top: 62px; z-index: 30;/);
  assert.match(css, /\.queue-mobile-bar \{[\s\S]*?position: sticky; top: 62px; z-index: 20;/);
  // 30 clears the cards (none) and the app bar (20), and ties with the phone's
  // nav — which is fixed to the BOTTOM of the screen and never meets it. The
  // dialogs at 80 still cover it, which is the part that must not change.
  //
  // THE ONE EXEMPTION IS `.dept-menu`, and it is cut out rather than the range
  // widened. It carries 50, and it cannot be the thing this test is guarding
  // against: it lives inside `.modal-body`, which scrolls and therefore clips
  // its own children on both axes, so nothing it paints reaches the page at
  // all — let alone the strip between this bar and a dialog. Anything else
  // landing in the range is still caught.
  // Rules only. Half this stylesheet is prose about which layer sits over
  // which, and a paragraph that names a number is not an element that carries
  // one — matching the comments is how this reads its own explanation as the
  // defect it warns about.
  const own = css.indexOf('.pick-menu.dept-menu {');
  const outside = (css.slice(0, own) + css.slice(css.indexOf('}', own)))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/z-index: (4[0-9]|[5-7][0-9])\b/.test(outside), 'something new landed between this bar and the dialogs');
  assert.match(css.slice(own, css.indexOf('}', own)), /z-index: 50;/, 'the exemption above is stale');

  // Stuck, it is painted over the cards passing under it: it needs an opaque
  // fill, out to the card's own edges or a column of list shows down each side.
  // `--bg` is the ground the card list itself is painted on, so the bar and the
  // gaps between the cards running under it are one colour.
  assert.match(rule, /background: var\(--bg\) !important/);
  assert.match(rule, /margin-left: -15px; margin-right: -15px;/);

  // Desktop keeps its table with the heading row at the top; a box floating
  // over the figures there is one more thing between a reader and them.
  const desktop = css.slice(0, css.indexOf('@media screen and (max-width: 860px)'));
  assert.ok(!/\.month-find \{[^}]*sticky/.test(desktop), 'the box went sticky on the desktop too');
});

test('the space under the box is the space between two cards', () => {
  // 12px — the same gap the cards keep from each other, so the first card is
  // not a special case of the list it is the top of.
  assert.match(css, /\.month-find \{ align-items: center; gap: 10px 14px; margin-bottom: 12px; \}/);
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(phone, /\.month-find \{[\s\S]*?padding: 10px 15px 12px;/);
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
