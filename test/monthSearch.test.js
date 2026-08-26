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
  // The selector gained `.acct-find` on 2026-08-26 — ส่งบัญชี's box, which is
  // this row minus the phone rule below. See the accounting section at the
  // foot of this file.
  assert.match(css, /\.month-find, \.acct-find \{ align-items: center; gap: 10px 14px; margin-bottom: 12px; \}/);
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

// ── สรุป OT ส่งบัญชี has the same box, and one more thing to protect ─────────

/**
 * The second caller, added 2026-08-26.
 *
 * Everything above applies unchanged — same rule, same chrome, same "a screen
 * filter and nothing more". What is different is the stake. ตรวจสอบรายเดือน is
 * where a month is CHECKED; ส่งบัญชี is where it is CLOSED and the figures go to
 * payroll. So the invariant that รวมทั้งหมด does not follow the box is not a
 * nicety here, it is the whole reason the box can exist at all: a subtotal that
 * quietly narrowed as somebody typed would be signed for.
 */
const acctView = read('components/AccountingView.jsx');

test('ส่งบัญชี asks the same rule, and narrows rows and nothing else', () => {
  assert.match(acctView, /import \{ personMatches \} from '@\/lib\/personSearch\.js'/);
  // The spread is the mechanism: a copy of the company with ONE field replaced,
  // so `totals`, `departments` and `accountingCode` are carried through by not
  // being mentioned. Rewritten as a hand-built object it would be one forgotten
  // key away from a summary that agreed with the search.
  // `query` and not `find` since the debounce landed — the string the screen
  // was filtered BY, which is also what the count, the empty state and the
  // highlight read. See the live-search section at the foot of this file.
  assert.match(
    acctView,
    /const narrowed = shown\.map\(\(c\) => \(\{\s*\.\.\.c,\s*rows: c\.rows\.filter\(\(row\) => personMatches\(row\.employee, query\)\),\s*\}\)\);/,
  );
  assert.ok(!/toLowerCase\(\)\.includes/.test(acctView), 'a hand-rolled match crept in beside personMatches');
  // Nothing else in the file may take `find` as an argument — the totals, the
  // CSV href and the print sheet are all built without it.
  assert.ok(!/totals[\s\S]{0,60}find/.test(acctView), 'a total started reading the search box');
  assert.ok(!/accounting\.csv\?[^`]*find/.test(acctView), 'the CSV started carrying the search');
  assert.ok(
    !/<AccountingPrint[\s\S]{0,200}find=/.test(acctView),
    'the printed sheet started following the search',
  );
});

test('and it says so on screen, in the words that name the figures', () => {
  // Not a general "this is a filter" line: the three totals BY NAME, because
  // those are the three a reader is about to act on.
  assert.match(acctView, /ยอด “รวมแผนก” “รวมทั้งหมด” และ “รวมทุกบริษัท” ยังเป็นของทั้งเดือน/);
  assert.match(acctView, /ไฟล์ CSV และแบบฟอร์มที่พิมพ์ก็เช่นกัน/);
  // And only while it is narrowing something — a notice about a search nobody
  // is running is a notice that stops being read.
  assert.match(acctView, /\{searching && rowsFound > 0 && \(/);
  // No result is an answer, with a way out, the same as ตรวจสอบรายเดือน's.
  assert.match(acctView, /ไม่พบพนักงานที่ค้นหา “\{query\}”/);
  assert.match(acctView, /ล้างการค้นหา/);
});

test('รวมทุกบริษัท is the first card, and the search box does not reach it', () => {
  // total → per company → per person. At the foot of two sheets the covering
  // note's own figure was the last thing on the screen.
  const body = acctView.slice(acctView.indexOf('{!data ? ('), acctView.indexOf('function CompanySheet'));
  assert.ok(
    body.indexOf('<AllCompanies data={data} />') < body.indexOf('<CompanySheet'),
    'the sheets went back above รวมทุกบริษัท',
  );
  // `data`, not `narrowed` — the month's two companies and their total, whole.
  assert.match(acctView, /<AllCompanies data=\{data\} \/>/);
  assert.ok(!/<AllCompanies[^>]*(narrowed|visible|find)/.test(acctView), 'รวมทุกบริษัท started following the search');
});

test('its box is `.acct-find` — the same row without the sticky phone rule', () => {
  assert.match(acctView, /className="row acct-find"/);
  // The magnifier and the ✕ are the shared components, not a second pair.
  assert.match(acctView, /<Icon name="search" className="searchbox-icon" \/>/);
  assert.match(acctView, /<ClearButton onClear=\{\(\) => setFind\(''\)\} \/>/);
  // `.month-find`'s phone rule pins it under the app bar for a list nine
  // screens long. This box sits in a card four rows tall, where sticky would
  // unstick the moment the card scrolled past.
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.ok(!/\.acct-find/.test(phone), 'ส่งบัญชี’s box picked up a phone rule of its own');
  assert.match(css, /\.acct-find \{ margin-bottom: 0; \}/);

  /*
   * A REAL FLEX-BASIS, AND IT IS NOT DECORATION. `.field` is `flex: 1` —
   * `flex: 1 1 0%`, a basis of nothing — which in a wrapping row is the one
   * value that guarantees no wrap ever happens: the row's minimum is the
   * field's 150px plus a nowrap "แสดง 3 จาก 4 คน" of about 90, and 254 fits
   * inside a 304px card. So the box gave its width to the count and drew at
   * 200px on a 360px phone, with the ✕ against the caret. Reported, and fixed
   * by giving the field a basis wide enough to push the count onto its own
   * line. Measured after: 304/304 at 360px and 264/264 at 320px with the count
   * below, 831 of 938 at 1280px with the count beside it.
   */
  assert.match(css, /\.acct-find \.field \{ flex: 1 1 260px; \}/);
  const box = acctView.slice(
    acctView.indexOf('className="row acct-find"'),
    acctView.indexOf('className="found"'),
  );
  assert.ok(!/style=\{\{[^}]*flex/.test(box), 'an inline flex came back onto the search field');
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

test('typing filters with no Enter, 300ms behind the box, and clearing does not wait', () => {
  // `find` is the box and follows every keystroke; `query` is what the screen
  // was filtered BY. A field that lagged behind the finger is the one thing a
  // debounce must never do.
  assert.match(acctView, /const FIND_DEBOUNCE_MS = 300;/);
  assert.match(acctView, /const \[find, setFind\] = useState\(''\);/);
  assert.match(acctView, /const \[query, setQuery\] = useState\(''\);/);
  assert.match(acctView, /onChange=\{\(e\) => setFind\(e\.target\.value\)\}/);
  assert.match(acctView, /value=\{find\}/);
  // Clearing is a decision, not a keystroke — the early return is what makes
  // the ✕ and ล้างการค้นหา act at once instead of 300ms later.
  assert.match(
    acctView,
    /if \(find === ''\) \{ setQuery\(''\); return undefined; \}\s*const timer = setTimeout\(\(\) => setQuery\(find\), FIND_DEBOUNCE_MS\);/,
  );
  assert.match(acctView, /return \(\) => clearTimeout\(timer\);/);
  // Everything the reader compares reads the SAME string, or the screen shows
  // one query's rows under another query's count.
  assert.match(acctView, /personMatches\(row\.employee, query\)/);
  assert.match(acctView, /const searching = query\.trim\(\) !== '';/);
  assert.match(acctView, /ไม่พบพนักงานที่ค้นหา “\{query\}”/);
  assert.match(acctView, /<Highlight text=\{row\.employee\.name\} query=\{query\} kind="name" \/>/);
  assert.match(acctView, /<Highlight text=\{row\.employee\.code\} query=\{query\} kind="code" \/>/);
  // AND THE HOOKS ARE ABOVE THE EARLY RETURN. `if (printing)` returns before the
  // rest of the function runs, so a hook written after it is called on some
  // renders and not others — React threw "rendered fewer hooks than expected"
  // the moment พิมพ์แบบฟอร์ม was pressed.
  assert.ok(
    acctView.indexOf('const [query, setQuery]') < acctView.indexOf('if (printing) {'),
    'the search hooks moved below the print early-return',
  );
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
