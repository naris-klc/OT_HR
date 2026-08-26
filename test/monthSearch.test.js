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
  // They are built by the server from the month and สถานะที่นับ. A file longer
  // than the screen is a surprise somebody finds after opening it.
  assert.match(hrView, /ไฟล์ CSV และยอด “รวมทั้งหมด” ยังเป็นของทั้งเดือน ไม่ใช่เฉพาะผลการค้นหา/);
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
  // The ✕ shuts the suggestion list as well as emptying the box — it is the one
  // press that means "none of this", and leaving a panel of matches for a query
  // that no longer exists floating over the sheet is half an answer.
  assert.match(acctView, /<ClearButton onClear=\{\(\) => \{ setFind\(''\); setOpen\(false\); \}\} \/>/);
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
  assert.match(acctView, /onChange=\{\(e\) => \{\s*setFind\(e\.target\.value\);/);
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

// ── the suggestion list, and the row it takes you to ─────────────────────────

/**
 * Added 2026-08-26. A floating list under the box, a row per match, and a click
 * that takes the page to that person's row on the sheet.
 *
 * The two things worth holding down are the two that would be easy to undo. It
 * is the SAME panel and the same keys as กรองตามพนักงาน — a second combobox with
 * its own grammar is a second thing for a reader to learn and for this file to
 * keep in step. And picking a row does NOT change what is on screen: it is a way
 * TO the row, not a second filter, and the moment it starts clearing the box it
 * has become one.
 */

test('the dropdown is the app’s own listbox, not a second one', () => {
  assert.match(acctView, /className="pick-menu find-menu"/);
  assert.match(acctView, /role="listbox"/);
  assert.match(acctView, /role="combobox"/);
  assert.match(acctView, /aria-expanded=\{menuOpen\}/);
  assert.match(acctView, /aria-autocomplete="list"/);
  assert.match(acctView, /aria-activedescendant=\{menuOpen && suggestions\[at\] \? `\$\{listId\}-\$\{at\}` : undefined\}/);
  // The same keys PickPerson answers, in the same order, including the two that
  // are easy to leave out: Escape shuts it and Tab shuts it.
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab']) {
    assert.ok(acctView.includes(`'${key}'`), `the box does not answer ${key}`);
  }
  // mousedown's default action moves focus, which blurs the input and unmounts
  // the list before the click can land.
  assert.match(acctView, /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
  // The keyboard row follows the pointer, so there is one current row, not two.
  assert.match(acctView, /onMouseMove=\{\(\) => setActive\(i\)\}/);
  // Both classes on every rule, or the shared `.pick-menu` block further down
  // the stylesheet wins on position — the trap `.dept-menu` fell into.
  for (const rule of ['.pick-menu.find-menu li', '.pick-menu.find-menu li .s-code',
    '.pick-menu.find-menu li .s-meta']) {
    assert.ok(css.includes(rule), `${rule} is not scoped to both classes`);
  }
  // The panel the phone gets has to be capped against the viewport as well as
  // in pixels: two-line rows fill 264px faster than one-line rows do.
  assert.match(css, /\.pick-menu\.find-menu \{ max-height: min\(264px, 46vh\); \}/);
});

test('a suggestion says who, which code, which department and how many hours', () => {
  const item = acctView.slice(acctView.indexOf('<span className="s-who">'), acctView.indexOf('</ul>'));
  // The two strings the box was asked about are marked; แผนก and the hours are
  // context and are not.
  assert.match(item, /<Highlight text=\{row\.employee\.name\} query=\{query\} kind="name" \/>/);
  assert.match(item, /<Highlight text=\{row\.employee\.code\} query=\{query\} kind="code" \/>/);
  assert.match(item, /\{row\.department\?\.name \|\| '—'\}/);
  // `hours()`, not `cell()`: a nought here is an answer, not a blank to read
  // past. `cell()` is the table's rule and belongs to the table.
  assert.match(item, /\{hours\(row\.otHours\)\} ชม\./);
  // The list is the filtered rows in the order the sheets draw them, so ↓ walks
  // it in the same order the eye walks the page — and it is `narrowed`, which
  // means it can never list somebody the sheet is not showing.
  assert.match(acctView, /const suggestions = narrowed\.flatMap\(\(c\) => c\.rows\);/);
});

test('picking a row moves the page to it and lights it — and leaves the filter alone', () => {
  const fn = acctView.slice(acctView.indexOf('function goToRow('), acctView.indexOf('function onFindKeyDown('));
  assert.match(fn, /setOpen\(false\);/);
  assert.match(fn, /setFlash\(id\);/);
  // NOT `setFind('')`. Clearing here would throw away the narrowing somebody
  // just did and make the row they asked for one of forty again, at which point
  // the scroll does all the work and the flash none of it.
  assert.ok(!/setFind/.test(fn), 'picking a suggestion clears the search box');
  assert.ok(!/setQuery/.test(fn), 'picking a suggestion rewrites the applied query');
  // After the frame that closes the menu: measuring a layout that still has a
  // 264px panel in it puts the row in the wrong place on a short sheet.
  assert.match(fn, /window\.requestAnimationFrame\(\(\) => \{/);
  // `center`, because the app bar is sticky at the top of every screen and a
  // row scrolled to `start` lands behind it.
  assert.match(fn, /block: 'center',/);
  assert.match(fn, /behavior: still \? 'auto' : 'smooth',/);
  // The id is on the element because the tables are separate components and
  // this is a document-wide lookup by nature.
  assert.match(acctView, /const rowDomId = \(employeeId\) => `acct-row-\$\{employeeId\}`;/);
  assert.match(acctView, /id=\{rowDomId\(row\.employee\.id\)\}/);
  assert.match(acctView, /className=\{flash === row\.employee\.id \? 'row-flash' : undefined\}/);
});

test('the flash reaches the sticky cell, and survives prefers-reduced-motion', () => {
  // ON ส่งบัญชี'S CELLS. Below 860px the พนักงาน column there is sticky with an
  // opaque fill of its own, so a colour on the `<tr>` is covered on exactly the
  // cell carrying the name that was searched for.
  assert.match(css, /\.acct-table tbody tr\.row-flash > td \{ animation: rowFlash 1800ms ease-out; \}/);
  assert.match(css, /@keyframes rowFlash \{[\s\S]*?100% \{ background-color: transparent; \}/);
  // The blanket reduced-motion rule clamps every animation to .01ms, which for
  // this one would mean no highlight at all — an accessibility rule removing
  // the whole point of the feature. Stated flat there instead; the JS timer is
  // what ends it either way. Both tables are named in the one block, or the
  // screen that was added second is the one the rule quietly stops covering.
  const still = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.acct-table[\s\S]*?\n\}/);
  assert.ok(still, 'the flash lost its reduced-motion answer');
  assert.match(still[0], /\.acct-table tbody tr\.row-flash > td \{ background-color: var\(--green-bg\); \}/);
  assert.match(still[0], /\.hr-table tbody tr\.row-flash \{ background-color: var\(--green-bg\); \}/);
  assert.match(acctView, /const FLASH_MS = 1800;/);
  assert.match(acctView, /setTimeout\(\(\) => setFlash\(null\), FLASH_MS\)/);
});

// ── and ตรวจสอบรายเดือน has the same box, and one more thing to do with it ────

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
  // THE PANEL IS NOT A SECOND PANEL. It was `.acct-menu` while ส่งบัญชี was its
  // only caller; a class named after one screen worn by two is how a reader ends
  // up believing there are two of them.
  // Rules only. The stylesheet keeps the old name in the paragraph that explains
  // the rename, and a test that read its own explanation as the defect it warns
  // about is a trap this file has fallen into before.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/acct-menu/.test(rules), 'the panel is still named after one of its two callers');
  assert.ok(!/acct-menu/.test(acctView), 'ส่งบัญชี is still asking for the old class');
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
  // THE OPPOSITE ANSWER TO ส่งบัญชี'S, from the same question. This table has no
  // sticky column, and below 860px the `<tr>` IS the card: it carries the fill,
  // the border and 15px of padding, and the cells inside it are bare blocks. Lit
  // cell by cell it would come up green in stripes with its padding left plain.
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

test('the two screens keep the same clock', () => {
  // A debounce that read 300 on one screen and 150 on the other is the kind of
  // difference nobody can name and everybody feels. Written out in both files
  // rather than shared, so this is what keeps them equal.
  assert.match(hrView, /const FIND_DEBOUNCE_MS = 300;/);
  assert.match(acctView, /const FIND_DEBOUNCE_MS = 300;/);
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
