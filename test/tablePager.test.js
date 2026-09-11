import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * แถบเปลี่ยนหน้าใต้ตาราง — the foot of a table that pages.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACED, AND WHY A BUTTON WAS NOT ENOUGH
 *
 * บันทึกประวัติระบบ read its traffic log through a window that only grew.
 * `limit` began at 100, ดูย้อนหลังเพิ่ม added 200 at a time to a ceiling of 500,
 * and at the ceiling an amber panel said `แสดงได้สูงสุด 500 รายการต่อครั้ง` and
 * offered the CSV. Three things were wrong with it and only one is the number:
 *
 *   IT COULD NOT SAY HOW MUCH MORE THERE WAS. `hasMore` is a boolean; a reader
 *   pressing ดูย้อนหลังเพิ่ม was pressing into the dark, and nothing on the
 *   screen distinguished "eleven more rows" from "eleven thousand".
 *   IT COULD NOT GO BACK. The window only grew, so the way to un-see five
 *   hundred rows was to change a filter.
 *   AND PAST ROW 500 THE ANSWER WAS EXCEL. On the one screen in this app whose
 *   entire job is being read, "what did this account open on Tuesday" was
 *   answered by downloading a file.
 *
 * การใช้สิทธิ์พิเศษ had the opposite problem and the same reader: uncapped, one
 * `<tr>` per exception, and a busy quarter arriving as a table with no end.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE COMPONENT FOR BOTH, AND WHAT IT IS NOT
 *
 * `TablePager` is drawn under SIX tables, and this file reads all of them:
 * the two on บันทึกประวัติระบบ (§1–8), ประวัติเวอร์ชันนโยบาย (§9),
 * คิวรออนุมัติ (§11), ทะเบียนพนักงาน (§12) and สรุป OT ส่งบัญชี (§13). It read
 * "both tables" until 2026-09-11, when the queue took one — the sentence had
 * already outlived ประวัติเวอร์ชันนโยบาย — then "FOUR" and "FIVE" as the
 * roster and the accounting sheet followed it the same afternoon.
 *
 * `HrView`'s `.pager-row` is the one pager deliberately NOT folded into it:
 * that one is a `<td>` inside a `<tbody>`, `display: none` above 860px, laid
 * out as a two-row grid for a 280px card. What all of them share is the VOICE —
 * `‹`, `หน้า A / B`, `แสดง n–m จาก T รายการ`, a 38px square — and they share it
 * by naming the same classes, not by one component drawing every case.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Line endings normalised before anything below reads a character of this.
    The machine this is developed on checks the repo out CRLF (see the note in
    `.gitattributes`); the Linux box that serves it checks the same commit out
    LF. An assertion written with `\n` misses every multi-line match on the
    first, one written with `\r\n` misses them on the second, and in both
    cases the file under test is correct to the character. Normalising is what
    makes the assertion about the CSS instead of about the checkout — the same
    thing test/adminApproval.test.js and test/modalScrollFrame.test.js do. */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const common = read('components/common.jsx');
const logs = read('components/LogSystem.jsx');
const css = read('app/styles.css');
const route = read('app/api/logs/route.js');

/** The same file with every comment taken out — see the note in logPanelRows. */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const logsCode = strip(logs);
const commonCode = strip(common);

/** `.table-pager`'s own rules, without the phone block that follows them. */
const band = css.slice(
  css.indexOf('.table-pager {'),
  css.indexOf('/* ── the list itself ─'),
);

// ── 1. the band, and the rule that separates it from the table ──────────────

test('the pager is one component, and both tables on the screen draw it', () => {
  assert.equal(commonCode.match(/^export function TablePager\(/gm)?.length, 1,
    'there is a second TablePager — two pagers on one screen will stop agreeing');
  // Both tabs: the traffic list under การเข้าใช้งาน / การแก้ไขข้อมูล / ทั้งหมด,
  // and การใช้สิทธิ์พิเศษ under the fifth.
  assert.equal(logsCode.match(/<TablePager\b/g)?.length, 2,
    'one of the two tables on บันทึกประวัติระบบ has no pager under it');
  for (const label of ['บันทึกระบบ', 'การใช้สิทธิ์พิเศษ']) {
    assert.match(logsCode, new RegExp(`label="${label}"`),
      `the pager on ${label} has no name — a screen with two of them names each`);
  }
});

test('a hairline closes the table above it, with air on both sides of the rule', () => {
  // Without it the last data row and the first control are one list, and a
  // reader scrolling to the bottom of the table meets a dropdown.
  assert.match(band, /border-top: 1px solid var\(--line\)/,
    'the band floats under the table with nothing saying the table ended');
  assert.match(band, /padding-top: 12px/);
  assert.match(band, /margin-top: 8px/);
  // A token, never a fixed grey: `border-slate-200` would be a light-theme
  // hairline drawn on ธีมมืด, which is the one place it cannot be seen.
  assert.ok(!/border-top:[^;]*#[0-9a-f]{3,6}/i.test(band),
    'the rule is a literal colour — it will not answer to the theme');
});

test('the two halves are laid out as two halves', () => {
  assert.match(band, /\.table-pager \{[^}]*justify-content: space-between/);
  // `margin-left: auto` and not space-between alone: once the row wraps, the
  // arrows would otherwise jump to the LEFT edge of their own line.
  assert.match(band, /\.table-pager \.pager-controls \{[^}]*margin-left: auto/);
});

// ── 2. จำนวนรายการต่อหน้า ────────────────────────────────────────────────────

test('the four sizes are 10 · 20 · 50 · 100, and บันทึกประวัติระบบ opens on ten', () => {
  assert.match(commonCode, /export const PAGE_SIZES = \[10, 20, 50, 100\];/);
  // Both tables HERE open on the first of them. A log opened on 100 would be
  // the un-paged table it replaced on the first paint.
  //
  // WHICH SIZE A TABLE OPENS ON IS THE SCREEN'S CHOICE, not the kit's: the list
  // offered is the same four everywhere. คิวรออนุมัติ opens on 20 because it is
  // read to be emptied rather than searched (§11), and ทะเบียนพนักงาน on the
  // same 20 because the way a register is read is by searching it (§12).
  assert.equal(logsCode.match(/useState\(10\)/g)?.length, 2,
    'a table opens on some other page size than the one the selector lists first');
  assert.equal(logsCode.match(/const \[pageSize, setPageSize\] = useState\(10\);/g)?.length, 2);
});

test('it is a PickOne and never a <select>', () => {
  /**
   * The round of 2026-09-04 took the last of the operating system's own menus
   * off this app, and every filter on this screen is a `PickOne`. A `<select>`
   * in the footer of the table those filters narrow would be the OS menu back
   * on one control — drawn by the browser, absent from the document, and on
   * ธีมมืด a white sheet with the system's blue bar over it.
   */
  const pager = commonCode.slice(
    commonCode.indexOf('export function TablePager('),
    commonCode.indexOf('export function usePageReset('),
  );
  assert.match(pager, /<PickOne/);
  assert.ok(!/<select/.test(pager), 'the operating system draws this list again');
  // The words are outside the box, so the label PickOne needs for
  // `aria-labelledby` is clipped out of the picture and kept in the document.
  assert.match(pager, /hideLabel/);
  assert.match(pager, /จำนวน\$\{unit\}ต่อหน้า/);
  assert.match(pager, /แสดง<\/span>/);
  // `{unit}ต่อหน้า`, not the literal `รายการต่อหน้า` it read until 2026-09-08:
  // ประวัติเวอร์ชันนโยบาย counts เวอร์ชัน, and a row there is a rule set
  // somebody can name rather than an item in a list. See `unit`.
  assert.match(pager, /\{unit\}ต่อหน้า<\/span>/);
});

test('the unit is a word the caller supplies, and รายการ is only the default', () => {
  assert.match(commonCode, /unit = 'รายการ',/);
  // The three callers, and what each one calls a row. Scoped to the pager's own
  // tags: `Tile` on ภาพรวม has carried a `unit` prop ("ครั้ง") since long before
  // this component existed, and a bare /unit=/ over the file finds four of them.
  const tags = [...logsCode.matchAll(/<TablePager\b[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(tags.length, 2);
  for (const tag of tags) {
    assert.ok(!/unit=/.test(tag),
      'บันทึกประวัติระบบ started naming its unit — its rows are รายการ, which is the default');
  }
  const admin = strip(read('components/AdminView.jsx'));
  assert.match(admin, /unit="เวอร์ชัน"/);
  // Sizes too: 50 and 100 on a list that gains a row per rule change are two
  // choices that both mean "all of it". See `SHORT_PAGE_SIZES`.
  assert.match(commonCode, /export const SHORT_PAGE_SIZES = \[5, 10, 20\];/);
  assert.match(admin, /sizes=\{SHORT_PAGE_SIZES\}/);
});

test('the box is sized for a figure, not for a Thai department name', () => {
  // `.field` is `flex: 1; min-width: 150px`, which here would be a 150px box
  // holding the string "10"; `--field-h` is 46px, which beside two 38px
  // squares makes the footer read as a form to fill in.
  assert.match(band, /\.table-pager \.pager-size-pick \{[^}]*flex: none/);
  assert.match(band, /\.table-pager \.pager-size-pick \.pick-one \{[^}]*min-height: 38px/);
  // Mono and tabular, because 10 · 20 · 50 · 100 is a column of figures —
  // `.pick-one .val` is SANS by default because it usually holds Thai.
  assert.match(band, /\.table-pager \.pager-size-pick \.pick-one \.val \{[^}]*var\(--mono\)/);
});

// ── 3. where the reader is, and the two presses that move them ──────────────

test('both sentences are drawn — where in the list, and which page', () => {
  assert.match(common, /แสดง <strong>\{from\}–\{to\}<\/strong> จากทั้งหมด <strong>\{total\.toLocaleString\('th-TH'\)\}<\/strong> \{unit\}/);
  assert.match(common, /หน้า <strong>\{at\}<\/strong> \/ <strong>\{pageCount\}<\/strong>/);
  // Announced when they change, because pressing › moves the reader and what a
  // screen reader has to say afterwards is where they now are.
  assert.match(common, /<div className="pager-say" aria-live="polite">/);
});

test('the range counts from 1, is inclusive, and says 0 on an empty list', () => {
  assert.match(commonCode, /const pageCount = Math\.max\(1, Math\.ceil\(total \/ pageSize\)\);/);
  assert.match(commonCode, /const at = Math\.min\(Math\.max\(page, 1\), pageCount\);/);
  // `แสดง 1–0` is what a bare `(at - 1) * pageSize + 1` prints on an empty
  // list, and it is the sentence a reader takes as a bug in the count.
  assert.match(commonCode, /const from = total === 0 \? 0 : \(at - 1\) \* pageSize \+ 1;/);
  assert.match(commonCode, /const to = Math\.min\(at \* pageSize, total\);/);
});

test('the ends are disabled, not hidden, and they do not fade', () => {
  /**
   * A control that vanishes at an end moves the one beside it: on page 1 ถัดไป
   * would sit where ก่อนหน้า was, and the second press of a thumb already
   * travelling lands on the button that goes back.
   *
   * AND `disabled:opacity-40` IS NOT WHAT THIS APP DOES. It was asked for by
   * name when this band was specified. `.btn:disabled` already declares
   * `opacity: 1`, deliberately — a ghost button faded to .4 is illegible on
   * ธีมมืด, which this app found out on its own deployed page. The disabled
   * state is the VOICE: a transparent ground, the hairline it already had, and
   * the glyph one step quieter.
   */
  assert.match(commonCode, /disabled=\{at <= 1\}/);
  assert.match(commonCode, /disabled=\{at >= pageCount\}/);
  assert.match(band, /\.table-pager \.btn\.pager-step:disabled \{\s*background: none; border-color: var\(--line\); color: var\(--muted-2\);\s*\}/);
  assert.ok(!/\.table-pager \.btn\.pager-step:disabled \{[^}]*opacity/.test(band),
    'the disabled chevron is faded — on ธีมมืด that is a control nobody can see');
  // Three classes, so it beats `.btn.sm` and `.btn:disabled` on specificity
  // rather than on where it happens to sit in the sheet — the defeat
  // `.dept-menu` took four times over and `.log-more` took once.
  assert.match(band, /\.table-pager \.btn\.pager-step \{[^}]*width: 38px/);
});

test('a chevron carries its word, and the word names which table', () => {
  // "‹" read aloud is nothing, and this screen has two pagers on it.
  assert.match(common, /aria-label=\{`ก่อนหน้า — \$\{label\}`\}/);
  assert.match(common, /aria-label=\{`ถัดไป — \$\{label\}`\}/);
  assert.match(common, /title="ก่อนหน้า"/);
  assert.match(common, /title="ถัดไป"/);
});

// ── 4. the rows on screen are the rows the page asked for ───────────────────

test('การใช้สิทธิ์พิเศษ cuts its page in the browser, because the route is whole', () => {
  /**
   * The opposite of the traffic list next door, and it belongs to this
   * endpoint: `/logs/compliance` reads four collections through one loader
   * shared with the CSV, so the screen and the file can never report different
   * quarters. Teaching that loader to skip would be the second way of reading
   * one period.
   */
  assert.match(logsCode, /const all = data\?\.rows \|\| \[\];/);
  assert.match(logsCode, /const shown = all\.slice\(\(page - 1\) \* pageSize, page \* pageSize\);/);
  assert.match(logsCode, /\{shown\.map\(\(r, i\) => \(/);
  assert.ok(!/\{data\.rows\.map\(/.test(logsCode),
    'the compliance table is drawing every row again — the pager under it counts pages nobody sees');
  assert.ok(!/limit\(/.test(read('app/api/logs/compliance/route.js')),
    'the compliance route grew a cap — the pager is a reading aid, not a truncation');
});

test('the traffic list asks the server for one page', () => {
  assert.match(logsCode, /p\.set\('limit', String\(pageSize\)\);/);
  assert.match(logsCode, /if \(page > 1\) p\.set\('skip', String\(\(page - 1\) \* pageSize\)\);/);
  // Never sliced in the browser: the endpoint answers with a page of the rows
  // that MATCH, so narrowing one here would search ten records and report
  // "never happened" for anything older.
  assert.ok(!/data\.records\.slice\(/.test(logsCode),
    'a page of the log is being cut again in the browser — it is already one page');
});

test('page 1 is the request this screen always made', () => {
  // `skip=0` says nothing, and this screen's own record of itself is in the log
  // it is reading. Omitted rather than sent.
  assert.match(logs, /Omitted on page 1 rather than sent as `skip=0`/);
});

// ── 5. the endpoint ─────────────────────────────────────────────────────────

test('the route pages, counts, and orders totally', () => {
  assert.match(route, /const skip = Math\.max\(0, Math\.trunc\(Number\(q\.skip\) \|\| 0\)\);/,
    'a junk or negative skip reaches Mongo, which throws on one and mis-pages on the other');
  assert.match(route, /AccessLog\.countDocuments\(filter\)/,
    'without a total the pager can say there is more and never how much');
  assert.match(route, /\.skip\(skip\)/);
  /**
   * `_id` IS THE TIEBREAKER AND SKIP-BASED PAGING IS WHY.
   *
   * `createdAt` is written per request and this app serves several inside one
   * millisecond. On one unbounded read a tie is drawn in whatever order the
   * index hands back and nobody can tell. Across two reads that skip different
   * numbers of rows, an unstable tie is a record that appears on page 2 and
   * again on page 3 while another appears on neither — which on an audit log
   * is a row that was never shown to the person auditing.
   */
  assert.match(route, /\.sort\(\{ createdAt: -1, _id: -1 \}\)/,
    'the order is not total — a tie in createdAt can hide a row between two pages');
  // `\r?\n` AND NOT `\n`. `core.autocrlf` is true here, so a file this suite
  // reads off disk is CRLF wherever git has checked it out and LF only where
  // one has been written by a tool that did not put the carriage return back.
  // This route is LF in the working copy it was written against and CRLF in a
  // fresh clone; a bare `\n` between two lines therefore passes on one machine
  // and fails on the next, which is what it did.
  assert.match(route, /\r?\n {4}total,\r?\n/, 'the response no longer carries the count the pager reads');
});

test('the 500-row ceiling caps a page now, not a visit', () => {
  // MAX_LIMIT stays as the guard it always was. What changed is that the
  // largest page this screen asks for is 100, and the end of the collection is
  // reachable by pressing › rather than by narrowing the dates.
  assert.match(route, /const MAX_LIMIT = 500;/);
  assert.match(route, /Math\.min\(Number\(q\.limit\) \|\| DEFAULT_LIMIT, MAX_LIMIT\)/);
});

// ── 6. what was removed, by name ────────────────────────────────────────────

test('ดูย้อนหลังเพิ่ม and its ceiling panel are gone from the component', () => {
  // Read off the stripped source, or the paragraph explaining the removal
  // would fail the test that checks it.
  assert.ok(!/ดูย้อนหลังเพิ่ม/.test(logsCode),
    'the grow-the-window button is back — two mechanisms on one list is the failure HrView filed');
  assert.ok(!/แสดงได้สูงสุด/.test(logsCode));
  assert.ok(!/setLimit/.test(logsCode), 'the growing window survived the pager that replaced it');
});

test('a filter change puts the reader back on page 1', () => {
  /**
   * The bug this exists to prevent: a reader on page 9 types into the search
   * box, the filter now matches four rows, page 9 of four rows is nothing, and
   * the screen reports ไม่มีรายการ about a search that found four.
   *
   * AND IT IS THE FILTERS AND NOT THE DATA. Resetting when the rows change
   * would reset on the fetch that ARRIVES for page 9 — › would go to page 2
   * and come straight back.
   */
  assert.match(commonCode, /export function usePageReset\(setPage, deps\)/);
  assert.match(logsCode, /usePageReset\(setPage, \[tab, filters, pageSize\]\);/);
  assert.match(logsCode, /usePageReset\(setPage, \[params, pageSize\]\);/);
  assert.ok(!/usePageReset\(setPage, \[data/.test(logsCode),
    'the page resets on the data — every press of › will bounce back');
});

// ── 7. the phone ────────────────────────────────────────────────────────────

test('below 560px the halves stack and the arrows grow to 44px', () => {
  const phone = css.slice(css.indexOf('@media (max-width: 560px) {\n  .table-pager {'));
  const block = phone.slice(0, phone.indexOf('\n}'));
  assert.match(block, /\.table-pager \{[^}]*flex-direction: column/);
  // The arrows stay at the right edge: they are pressed repeatedly and belong
  // nearest the thumb, while the size is chosen once on arrival.
  assert.match(block, /\.table-pager \.pager-controls \{[^}]*justify-content: flex-end/);
  assert.match(block, /\.table-pager \.btn\.pager-step \{[^}]*width: 44px/);
  // And the box goes with them — a 38px control beside two 44px squares is the
  // one shape that reads as a mistake rather than as a choice.
  assert.match(block, /\.table-pager \.pager-size-pick \.pick-one \{[^}]*min-height: 44px/);
});

// ── 8. pressing › does not move the page ────────────────────────────────────

/**
 * REPORTED 2026-09-08 AS "หน้าจอเด้งขึ้นด้านบนเวลากดปุ่มเปลี่ยนหน้า", AND THE
 * OBVIOUS CAUSE WAS ABSENT.
 *
 * There was no `window.scrollTo` and no `scrollIntoView` on this screen or in
 * the pager — there never had been. What moved the page was the loader clearing
 * its own data first: `setData(null)` replaced the table, the pager and the
 * button that had just been pressed with the single line `กำลังโหลด…`, the
 * document collapsed from 1318px to a viewport, and the browser clamped
 * `scrollY` to 0. Clamping is lossy. The rows came back a moment later, the
 * page was 1337px tall again, and the reader was at the top of it with nothing
 * holding the position they had lost.
 *
 * Measured on the built app against a clone: `scrollY` 418 before the press, 0
 * at 120ms after, 0 at every sample after that, and `document.activeElement`
 * `BODY` rather than the chevron.
 *
 * SO THE REPAIR IS THE ABSENCE OF A COLLAPSE, NOT THE PRESENCE OF A RESTORE.
 * These cases pin both halves: nothing scrolls the page, and nothing empties it.
 */

test('nothing on this screen scrolls the page, and nothing may start', () => {
  assert.ok(!/scrollTo|scrollIntoView|scrollTop\s*=/.test(logsCode),
    'a scroll call is back on บันทึกประวัติระบบ — the jump this fixed was never caused by one, '
    + 'and a scroll that "restores" the position is a frame of the page moving either way');
  const pager = commonCode.slice(
    commonCode.indexOf('export function TablePager('),
    commonCode.indexOf('export function usePageReset('),
  );
  assert.ok(!/scrollTo|scrollIntoView|scrollTop/.test(pager),
    'the pager scrolls the page — HrView\'s does, deliberately, and this one must not');
});

test('neither loader empties its screen before fetching', () => {
  // The whole of the bug, in one call. Both tables read through the same hook
  // now, so there is no second place for it to come back.
  assert.ok(!/setData\(null\)/.test(logsCode),
    'a loader clears its data before the request again — that is the collapse that clamps scrollY');
  assert.equal(logsCode.match(/useKeptFetch\(/g)?.length, 2,
    'one of the two tables is loading its own way');
  assert.match(logsCode, /useKeptFetch\(\(\) => api\.get\(`\/logs\?\$\{params\}`\), \[params\]\)/);
  assert.match(logsCode, /useKeptFetch\(\(\) => api\.get\(`\/logs\/compliance\?\$\{params\}`\), \[params\]\)/);
});

test('the loading line is for the first load only', () => {
  // `!data`, never `busy` — a refetch that printed กำลังโหลด… in place of the
  // table would be the same collapse spelled a different way.
  assert.match(logsCode, /\{!data && !error && <Empty>กำลังโหลด…<\/Empty>\}/);
  assert.ok(!/busy && <Empty/.test(logsCode),
    'the loading line is drawn on a refetch — that empties the page again');
});

test('the button that was pressed is still there to press again', () => {
  /**
   * `document.activeElement` was `BODY` after a press, because `.pager-next`
   * sat inside the subtree that got replaced. A reader pressing › three times
   * had to find the button with the pointer each time and a keyboard reader
   * lost their place entirely. An element that is never unmounted keeps focus
   * without anybody restoring it, so there is no focus() call here either.
   */
  assert.ok(!/\.focus\(\)/.test(logsCode),
    'focus is being put back by hand — the button should never have lost it');
  // The fade and the click-guard are on the table only. The pager is outside
  // the wrap, so both chevrons stay live while the next page is in flight.
  assert.match(css, /\.table-wrap\.is-paged\[data-busy='1'\] tbody \{ pointer-events: none; \}/);
  assert.ok(!/\.table-pager[^\n]*pointer-events: none/.test(css),
    'the pager goes dead while it loads — pressing twice in a row is what this round was about');
});

test('a page in flight is said out loud and drawn quietly', () => {
  // Between the press and the answer the rows are the PREVIOUS page's, under a
  // pager that already reads หน้า 3 / 11.
  assert.equal(logsCode.match(/aria-busy=\{busy\}/g)?.length, 2);
  assert.equal(logsCode.match(/data-busy=\{busy \? '1' : undefined\}/g)?.length, 2);
  assert.match(css, /\.table-wrap\.is-paged\[data-busy='1'\] \{ opacity: \.62; transition: none; \}/);
  // Reduced motion drops the fade-out, like every other transition in the app.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.table-wrap\.is-paged \{ transition: none; \}/);
});

test('only the newest request may write', () => {
  /**
   * Two presses of › a few hundred milliseconds apart are two requests in
   * flight and nothing orders the answers: page 2's reply landing after page
   * 3's leaves the table showing page 2 under a pager reading หน้า 3. The old
   * code had the same race and could not exhibit it, because clearing the data
   * took the button off the screen — keeping the button is what makes the guard
   * necessary.
   */
  const hook = commonCode.slice(commonCode.indexOf('export function useKeptFetch('));
  assert.match(hook, /const seq = React\.useRef\(0\);/);
  assert.match(hook, /const mine = seq\.current \+ 1;/);
  // Both arms, or a stale failure still writes an error over a good page.
  assert.equal(hook.match(/if \(seq\.current !== mine\) return;/g)?.length, 2,
    'a stale answer can still write — check both the then and the catch');
});

// ── 9. ประวัติเวอร์ชันนโยบาย ────────────────────────────────────────────────

const admin = read('components/AdminView.jsx');
const adminCode = strip(admin);

test('ประวัติเวอร์ชันนโยบาย pages, and pages in the browser', () => {
  /**
   * THE DIFF COLUMN IS WHY THE CUT IS HERE AND NOT AT THE ENDPOINT.
   *
   * The route computes each version's `changes` against `versions[i + 1]` — the
   * one before it — which is why the oldest row on the list prints
   * `ไม่ได้โหลดเวอร์ชันก่อนหน้ามาเทียบ` rather than `—`. Asking the endpoint for
   * ten rows starting at row twenty would break สิ่งที่เปลี่ยน on the FIRST ROW
   * OF EVERY PAGE: each page's oldest version would have no predecessor inside
   * its own result, and would say so on nine rows out of ten that have one
   * sitting a page away.
   */
  assert.match(adminCode, /const shown = versions\.slice\(\(at - 1\) \* pageSize, at \* pageSize\);/);
  assert.match(adminCode, /\{shown\.map\(\(v\) => \(/);
  assert.ok(!/\{versions\.map\(\(v\) => \(/.test(adminCode),
    'the table draws every version again — the pager under it counts pages nobody sees');
  // And the route still hands over the whole chain rather than a page of it.
  const route = read('app/api/settings/policy-versions/route.js');
  assert.ok(!/\.skip\(/.test(route),
    'the endpoint learnt to skip — that breaks the diff on the first row of every page');
});

test('the page is clamped before the slice, not only in the sentence', () => {
  // `TablePager` clamps what it PRINTS. An unclamped slice under it is an empty
  // table beneath a pager reading หน้า 4 / 2.
  assert.match(adminCode, /const pageCount = Math\.max\(1, Math\.ceil\(versions\.length \/ pageSize\)\);/);
  assert.match(adminCode, /const at = Math\.min\(Math\.max\(page, 1\), pageCount\);/);
  assert.match(adminCode, /page=\{at\}/);
});

test('the band closes the section, with the wider gap that asks for', () => {
  assert.match(adminCode, /className="roomy"/);
  assert.match(css, /\.table-pager\.roomy \{ margin-top: 16px; \}/);
  // The base rule is untouched — the two log tables sit in a card whose padding
  // is already under them and keep their 8.
  assert.match(css, /\.table-pager \{[^}]*margin-top: 8px;/);
});

test('a page change here scrolls nothing either', () => {
  /**
   * THE BAN IS ประวัติเวอร์ชันนโยบาย'S, NOT THE FILE'S — and it read the whole
   * file until 2026-09-11, when ทะเบียนพนักงาน took a band that deliberately
   * DOES scroll (§12). A ban stated over 7600 lines was only ever a ban on this
   * one component; now it says so, sliced the way §12 slices the roster.
   *
   * Here a scroll would be the bug บันทึกประวัติระบบ was repaired for: this
   * table is ten rows under a heading with the whole of ตั้งค่าระบบ above it,
   * and the pager is already on screen when it is pressed.
   */
  const policy = adminCode.slice(
    adminCode.indexOf('function PolicyHistory({'),
    adminCode.indexOf('function PolicyChanges('),
  );
  assert.ok(policy.length > 1000, 'the slice for PolicyHistory came out empty — the anchors moved');
  const scrolls = policy.match(/scrollIntoView|window\.scrollTo|scrollTop\s*=/g) || [];
  assert.deepEqual(scrolls, [],
    'a scroll call was added to ประวัติเวอร์ชันนโยบาย — a pager under a short table must not move the page');
  // The file's other two are accounted for: the roving highlight inside an open
  // dropdown — `block: 'nearest'` on a list row, not the page — and the
  // roster's own landing, which §12 pins to the handler.
  assert.equal(adminCode.match(/scrollIntoView/g)?.length, 2);
  assert.match(adminCode, /listRef\.current\?\.querySelector\('\[data-active="1"\]'\)\?\.scrollIntoView\(\{ block: 'nearest' \}\)/);
  // Nothing empties the table on a page press: the slice is synchronous and
  // `load()` is not in the path at all.
  assert.ok(!/onPage=\{[^}]*load/.test(adminCode),
    'changing page refetches — that is the collapse บันทึกประวัติระบบ was repaired for');
});

test('a list this short is offered 5 · 10 · 20, and opens at 10', () => {
  // ทะเบียนพนักงาน opens on 20 out of the same file — see §12. Two tables in
  // one component may differ; what they may not do is offer different SIZES for
  // the same kind of list.
  assert.match(adminCode, /const \[pageSize, setPageSize\] = useState\(10\);/);
  assert.match(adminCode, /usePageReset\(setPage, \[pageSize\]\);/);
  // NOT on `versions`: recordLive() reloads the list after adding a version,
  // and a reader who was on page 3 should still be on page 3.
  assert.ok(!/usePageReset\(setPage, \[versions/.test(adminCode),
    'adding a version throws the reader back to page 1');
});

test('the band is drawn on one page and withheld on none', () => {
  // One page: both chevrons dead under `แสดง 1–7 จากทั้งหมด 7 เวอร์ชัน`, which
  // is a statement about the list. No versions at all: the `Empty` above has
  // already said so and a pager would be chrome around a sentence.
  assert.match(adminCode, /\{versions\.length > 0 && \(\s*<TablePager/);
});

test('the end of the pages says whether it is the end of the versions', () => {
  /**
   * The route stops at fifty and nothing said so until the pager went in: the
   * table simply ended, and its oldest row printed `ไม่ได้โหลดเวอร์ชันก่อนหน้า
   * มาเทียบ`, which reads as one row that could not be compared rather than as
   * a list that was cut. `หน้า 5 / 5` is a claim about a whole list.
   */
  assert.match(read('app/api/settings/policy-versions/route.js'), /total: await PolicyVersion\.countDocuments\(\),/);
  assert.match(adminCode, /const capped = typeof total === 'number' && total > versions\.length;/);
  assert.match(adminCode, /\{capped && \(/);
  assert.match(admin, /เวอร์ชันที่เก่ากว่านี้ยังไม่ได้โหลดมา/);
  // The pager's own total is what is ON the table, never the collection's —
  // `หน้า 5 / 5` must not be counted from rows the browser does not hold.
  assert.match(adminCode, /total=\{versions\.length\}/);
});

// ── 10. the sentence under การใช้สิทธิ์พิเศษ ────────────────────────────────

test('ไม่มีการตัดท้าย still stands, because it was never about the layout', () => {
  /**
   * `test/complianceExport.test.js` reads this file for that phrase and the
   * route's own header promises it. It is a claim about the REPORT — the loader
   * is uncapped and no row is dropped for being late in the period — and the
   * half that was about the screen ("หน้านี้แสดงครบทุกรายการ") is the half that
   * stopped being true when the table began paging. A pager moves rows between
   * pages; it removes none, and every row is on one of them.
   */
  assert.match(logs, /ไม่มีการตัดท้าย/);
  assert.match(logs, /ทุกรายการในช่วงที่เลือกอยู่ในหน้าใดหน้าหนึ่ง/);
  assert.ok(!/หน้านี้แสดงครบทุกรายการในช่วงที่เลือก/.test(logsCode),
    'the screen still claims to show every row at once, which the pager made false');
});

// ── 11. คิวรออนุมัติ ─────────────────────────────────────────────────────────

/**
 * THE FOURTH TABLE, AND THE FIRST ONE WHERE PAGING MEETS A SELECTION.
 *
 * รออนุมัติ OT · รออนุมัติ · รออนุมัติแทน · ใบที่ยังไม่มีใครเซ็น are one
 * component, so the band arrives on all four at once. What is particular about
 * it is the batch: this screen carries ticks, a bar that counts them and a
 * เลือกทั้งหมด, and every one of those is counted against the FILTERED PILE and
 * not against the page — **A PAGE IS NOT A FILTER**. The cases below are mostly
 * that one rule, asserted from four directions, because it is the rule a later
 * change would break without any of it looking wrong.
 */

const queue = read('components/ApprovalQueue.jsx');
const queueCode = strip(queue);

test('the queue draws the shared band, once, from the shared kit', () => {
  assert.equal(queueCode.match(/<TablePager\b/g)?.length, 1,
    'คิวรออนุมัติ draws more than one band — one table has one foot');
  assert.match(queueCode, /^\s*StatusChip, TablePager, TeamMark, editsOf, shownWarnings, usePageReset,$/m,
    'the pager is not imported from ./common.jsx — a second copy is how two bands begin to disagree');
  // No `sizes` prop: this table is offered the same four as every other one.
  assert.ok(!/<TablePager[\s\S]*?sizes=/.test(queueCode),
    'the queue narrowed its own size list — 10 · 20 · 50 · 100 is the app\'s answer');
  assert.match(queueCode, /const \[pageSize, setPageSize\] = useState\(20\);/);
});

test('the page decides the rows and nothing else — A PAGE IS NOT A FILTER', () => {
  /**
   * `pageRows` EXISTS TWICE IN THIS FILE: where it is cut, and where the
   * `<tbody>` maps it. A third mention is this rule being broken — a count, an
   * empty state or a selection built out of the page a reader happens to be on.
   */
  assert.equal(queueCode.match(/pageRows/g)?.length, 2,
    'something other than the table reads pageRows — a count, a tick or an empty state now means "on this page"');
  assert.match(queueCode, /\{pageRows\.map\(\(e\) => \(/);
  // The four things the batch is built from, every one of them on the pile.
  assert.match(queueCode, /const actionable = useMemo\(\s*\(\) => shown\.filter\(/);
  assert.match(queueCode, /const picked = shown\.filter\(\(e\) => selected\.has\(e\._id\)\);/);
  assert.match(queueCode, /total=\{shown\.length\}/);
  assert.match(queueCode, /\{shown\.length === 0 && \(/);
});

test('a tick survives a page turn, and does not survive a filter', () => {
  // The pruning effect keys on `shown` — the pile after the FILTERS. Keyed on
  // `pageRows` it would empty the batch bar on every press of ›, which is the
  // one way this screen could quietly drop a row somebody had chosen.
  assert.match(queueCode, /const live = new Set\(shown\.map\(\(e\) => e\._id\)\);/);
  assert.ok(!/const live = new Set\(pageRows/.test(queueCode),
    'the selection is pruned to the page — pressing › now unticks everything above it');
});

test('the reset is the filters, never the queue itself', () => {
  assert.match(queueCode, /usePageReset\(setPage, \[q, dept, per, st, applicant, pageSize\]\);/);
  // `load()` runs after every signature. Keyed on the rows, the press that
  // approves row 41 would put the reader back on page 1.
  assert.ok(!/usePageReset\(setPage, \[(entries|shown)/.test(queueCode),
    'approving a row throws the reader back to page 1');
});

test('the page is clamped before the slice here too', () => {
  // Approving the last row of the last page is the ordinary end of this screen,
  // and an unclamped slice draws an empty table under หน้า 4 / 3 for it.
  assert.match(queueCode, /const pageCount = Math\.max\(1, Math\.ceil\(shown\.length \/ pageSize\)\);/);
  assert.match(queueCode, /const at = Math\.min\(Math\.max\(page, 1\), pageCount\);/);
  assert.match(queueCode, /const pageRows = shown\.slice\(\(at - 1\) \* pageSize, at \* pageSize\);/);
  assert.match(queueCode, /page=\{at\}/);
});

test('the band is drawn on one page, and withheld on none and on not-yet', () => {
  assert.match(queueCode, /\{shown\.length > 0 && \(\s*<TablePager/);
  // Inside the `entries` branch, so nothing is drawn under กำลังโหลด…
  const loading = queueCode.indexOf('<Empty>กำลังโหลด…</Empty>');
  assert.ok(loading > 0 && loading < queueCode.indexOf('<TablePager'),
    'the band is drawn beside the loading line — an empty table claiming to be page 1 of 1');
});

test('nothing is refetched by pressing ›, and the screen is not emptied', () => {
  // The queue is already in hand — one reply, capped at MAX_LIST_LIMIT — so the
  // slice is synchronous. A refetch here is the collapse §8 was repaired for.
  assert.ok(!/useKeptFetch/.test(queueCode),
    'the queue reads through the server-paged hook — its rows are already in the browser');
  assert.ok(!/onPage=\{[^}]*load/.test(queueCode));
  assert.match(queueCode, /onPage=\{goPage\}/);
});

test('ถัดไป lands the reader at the top of the new page, from the handler', () => {
  /**
   * THE ONE PLACE THIS APP SCROLLS ON A PAGE PRESS BESIDES `HrView`, and §8 is
   * why that needs saying out loud: on บันทึกประวัติระบบ a scroll would be the
   * bug back. A queue is different — it is read top to bottom and signed row by
   * row, and page 4 arriving at page 3's scroll depth begins in the middle.
   */
  assert.match(queueCode, /function goPage\(next\) \{\s*setPage\(next\);\s*listRef\.current\?\.scrollIntoView\(\{ block: 'start' \}\);\s*\}/);
  assert.equal(queueCode.match(/scrollIntoView/g)?.length, 1,
    'a second scroll call is on คิวรออนุมัติ — this screen moves the page in exactly one place');
  // FROM THE HANDLER. An effect on `page` would fire on the reset above too,
  // dragging the table into view on every letter typed into ค้นหา.
  assert.ok(!/useEffect\([^)]*\)[\s\S]{0,200}?scrollIntoView/.test(queueCode),
    'the scroll moved into an effect — typing in ค้นหา now jerks the page');
  assert.match(queueCode, /<div className="table-wrap queue-list" ref=\{listRef\}>/);
});

test('the landing clears whatever is stuck over the list at that moment', () => {
  // Desktop: the app bar, and `.batch-bar` under it while a batch is being
  // built. Phone: the app bar and `.queue-mobile-bar`, which is taller while
  // picking. Sized per state rather than for the worst one — a margin holding
  // 58px for a bar that is not drawn is most of a row of empty ground.
  assert.match(css, /\.table-wrap\.queue-list \{ scroll-margin-top: calc\(62px \+ 14px\); \}/);
  assert.match(css, /\.card:has\(> \.batch-bar\) \.table-wrap\.queue-list \{ scroll-margin-top: calc\(62px \+ 58px \+ 14px\); \}/);
  assert.match(css, /\.card:has\(> \.queue-mobile-bar\) \.table-wrap\.queue-list \{ scroll-margin-top: calc\(62px \+ 49px \+ 12px\); \}/);
  assert.match(css, /\.card:has\(> \.queue-mobile-bar\.picking\) \.table-wrap\.queue-list \{ scroll-margin-top: calc\(62px \+ 59px \+ 12px\); \}/);
  // The number lives in the stylesheet that owns the bars, never in the JSX.
  assert.ok(!/scroll-margin|62px/.test(queueCode),
    'a sticky bar\'s height is being measured in the component');
});

test('the band brings its own inset, because .card.flush has none', () => {
  /**
   * `flush-pager` IS NAMED FOR THE CARD AND NOT FOR THE SCREEN, and it was
   * `queue-pager` for the few hours between this band and สรุป OT ส่งบัญชี's
   * (§13). Both cards are `.card.flush`, which is `padding: 0`; a second class
   * repeating these three numbers is the copy that stops agreeing.
   */
  assert.match(queueCode, /className="flush-pager queue-pager no-print"/,
    'the band prints — a dropdown asking for more rows, on paper that already has them all');
  assert.match(band, /\.table-pager\.flush-pager \{ padding: 12px 18px 16px; \}/);
  assert.match(band, /\.table-pager\.flush-pager \{ padding: 12px 12px 16px; \}/);
  // AND ONE DECLARATION IS STILL THE QUEUE'S ALONE: its rows are cards at phone
  // width and `.queue-table tbody` already leaves 12px under the last of them,
  // so the band gives its own margin back. `.acct-table` is still a table down
  // there and keeps the base 8.
  assert.match(band, /\.table-pager\.queue-pager \{ margin-top: 0; \}/);
  assert.ok(!/\.table-pager\.queue-pager \{ padding/.test(band),
    'the queue took its padding back — two .card.flush screens, one inset');
  // The base rule is untouched — the log tables keep their 8 and their edges.
  assert.match(css, /\.table-pager \{[^}]*margin-top: 8px;/);
});

test('the pager names the queue it is under, and the queue is named once', () => {
  // `label` reaches three aria-labels: the size box and both chevrons. A name
  // the heading does not use is a name the reader cannot match to anything.
  assert.match(queueCode, /const queueName = delegatedOnly \? 'รออนุมัติ · ทีมที่รับช่วง'/);
  assert.match(queueCode, /<span className="t-name">\{queueName\}<\/span>/);
  assert.match(queueCode, /label=\{queueName\}/);
});

// ── 12. ทะเบียนพนักงาน ──────────────────────────────────────────────────────

/**
 * THE FIFTH TABLE, AND THE FIRST WITH A SENTENCE OF ITS OWN ABOVE IT.
 *
 * This screen already counted, and it counted a different thing: `แสดง 9 จาก
 * 214 คน` on the filter bar is what ค้นหาพนักงาน is HIDING, and it is read off
 * the register. The band says which slice of those 9 is drawn. Both were asked
 * for on 2026-09-11 — *"เก็บทั้งสองบรรทัด"* — and the cases below pin the two
 * apart, because the obvious later "simplification" is to point the bar's
 * figure at the page and lose the only sentence saying the short list is a
 * filter.
 */

/**
 * `Employees` — from its own `function` line to the next top-level one.
 * `adminCode` is §9's binding: AdminView is read once and sliced twice, because
 * the two bands in it are 4000 lines apart and every assertion below would
 * otherwise be able to pass on ประวัติเวอร์ชันนโยบาย's code by accident.
 */
const roster = adminCode.slice(
  adminCode.indexOf('function Employees({ user })'),
  adminCode.indexOf('function AddEmployee('),
);

test('the roster draws the shared band, once, and asks for no sizes of its own', () => {
  assert.ok(roster.length > 1000, 'the slice for Employees came out empty — the anchors moved');
  assert.equal(roster.match(/<TablePager\b/g)?.length, 1,
    'ทะเบียนพนักงาน draws more than one band — one table has one foot');
  assert.match(adminCode, /^\s*ClearButton, SHORT_PAGE_SIZES, ShowMore, TablePager, usePageReset,$/m,
    'the pager is not imported from ./common.jsx — a second copy is how two bands begin to disagree');
  assert.ok(!/<TablePager[\s\S]*?sizes=/.test(roster),
    'the roster narrowed its own size list — 10 · 20 · 50 · 100 is the app\'s answer');
  assert.match(roster, /const \[pageSize, setPageSize\] = useState\(20\);/);
  // คน, not รายการ: a row is a person, and the bar above it counts in คน.
  assert.match(roster, /unit="คน"/);
  assert.match(roster, /label="ทะเบียนพนักงาน"/);
});

test('the page is cut out of the search result, and the bar still counts the register', () => {
  /**
   * `pageRows` EXISTS TWICE IN THIS COMPONENT: where it is cut, and where the
   * `<tbody>` maps it. A third mention is A PAGE IS NOT A FILTER being broken.
   */
  assert.equal(roster.match(/pageRows/g)?.length, 2,
    'something other than the table reads pageRows — a count or an empty state now means "on this page"');
  assert.match(roster, /const pageRows = shown\.slice\(\(at - 1\) \* pageSize, at \* pageSize\);/);
  assert.match(roster, /\{pageRows\.map\(\(p\) => \(/);
  // THE TWO SENTENCES, AND THEY ARE NOT THE SAME SENTENCE. The bar's is
  // filtered-of-register; the band's is page-of-filtered.
  assert.match(roster, /แสดง <strong>\{shown\.length\}<\/strong> จาก <strong>\{rows\.length\}<\/strong> คน/);
  assert.match(roster, /total=\{shown\.length\}/);
  assert.ok(!/total=\{(rows|pageRows)\.length\}/.test(roster),
    'the band counts the register or the page — it is the search result that is being paged');
});

test('the reset is the search, never the register', () => {
  assert.match(roster, /usePageReset\(setPage, \[find, pageSize\]\);/);
  // `load()` runs after แก้ไข, รีเซ็ตรหัสผ่าน and every CSV import.
  assert.ok(!/usePageReset\(setPage, \[(rows|shown)/.test(roster),
    'editing one row throws the reader back to page 1');
});

test('the page is clamped before the slice here too', () => {
  assert.match(roster, /const pageCount = Math\.max\(1, Math\.ceil\(shown\.length \/ pageSize\)\);/);
  assert.match(roster, /const at = Math\.min\(Math\.max\(page, 1\), pageCount\);/);
  assert.match(roster, /page=\{at\}/);
});

test('the band is withheld on a search that matched nobody', () => {
  // `Empty` and a band claiming หน้า 1 / 1 are two answers to one question.
  assert.match(roster, /\{shown\.length > 0 && \(\s*<TablePager/);
  const empty = roster.indexOf('ไม่พบพนักงานที่ตรงกับ');
  assert.ok(empty > 0 && empty < roster.indexOf('<TablePager'),
    'the band is drawn beside the ไม่พบพนักงาน line');
});

test('ถัดไป lands the reader at the top, from the handler, on one number', () => {
  assert.match(roster, /function goPage\(next\) \{\s*setPage\(next\);\s*listRef\.current\?\.scrollIntoView\(\{ block: 'start' \}\);\s*\}/);
  assert.match(roster, /onPage=\{goPage\}/);
  assert.match(roster, /<div className="table-wrap roster-list" ref=\{listRef\}>/);
  // FROM THE HANDLER. An effect on `page` would fire on the reset above too,
  // dragging the table into view on every letter typed into ค้นหาพนักงาน.
  assert.ok(!/useEffect\([^)]*\)[\s\S]{0,200}?scrollIntoView/.test(roster),
    'the scroll moved into an effect — typing in ค้นหาพนักงาน now jerks the page');
  /**
   * ONE `scroll-margin-top` WHERE คิวรออนุมัติ NEEDS FOUR, and that is a fact
   * about the screen rather than a shortcut: nothing on ทะเบียนพนักงาน is
   * `position: sticky` except `.appbar`, at either width. A second rule here
   * would be a bar somebody has added — and then it needs measuring, not
   * copying.
   */
  assert.match(css, /\.table-wrap\.roster-list \{ scroll-margin-top: calc\(62px \+ 14px\); \}/);
  assert.equal(css.match(/\.table-wrap\.roster-list/g)?.length, 1);
  assert.ok(!/scroll-margin|62px/.test(roster),
    'a sticky bar\'s height is being measured in the component');
});

test('the band takes the card\'s own padding, and adds no rule to the sheet', () => {
  // `.card`, not `.card.flush`: 18px is already under the band, which is what
  // คิวรออนุมัติ had to put back by hand. So no class, and no CSS.
  assert.ok(!/<TablePager[\s\S]*?className=/.test(roster),
    'the roster band took a class — its card already has the padding one would add back');
  assert.ok(!/\.table-pager\.roster/.test(css),
    'a rule was written for a band that needed none');
});

// ── 13. สรุป OT ส่งบัญชี ─────────────────────────────────────────────────────

/**
 * THE SIXTH TABLE, AND THE ONLY ONE WHOSE PAGE IS NOT A SLICE.
 *
 * ⚠ `Ctrl+P` ON THIS SCREEN PRINTS THIS TABLE. `app/print.css` reshapes
 * `.acct-table` into a multi-page document — 8pt, `table-layout: auto`, the
 * `thead` repeated at the top of every sheet, `tfoot` forced back to a normal
 * row group so the grand total prints once — and that is a route accounting
 * uses. A page cut with `.slice()` would hand them whichever fifty rows the
 * screen happened to be left on, with nothing on the paper saying so: a payroll
 * sheet that is silently short. Asked on 2026-09-11 and answered
 * *"ครบทุกแถวเหมือนเดิม"*.
 *
 * So the rows off the page are DRAWN AND HIDDEN, with `.off-page` — the class
 * ตรวจสอบรายเดือน already uses for the same idea — and `@media print` puts them
 * back. The cases below are mostly that one fact, from both files, because the
 * obvious later "tidy-up" is to replace the class with a slice and the screen
 * looks identical afterwards.
 */

const acct = read('components/AccountingView.jsx');
const acctCode = strip(acct);
const printCss = read('app/print.css');

test('the sheet draws the shared band, once, per company', () => {
  assert.equal(acctCode.match(/<TablePager\b/g)?.length, 1,
    'more than one band in this file — each company sheet draws the one inside itself');
  assert.match(acctCode, /^\s*RateHead, TablePager, UnaccountedHours, usePageReset,$/m,
    'the pager is not imported from ./common.jsx');
  assert.ok(!/<TablePager[\s\S]*?sizes=/.test(acctCode),
    'the sheet narrowed its own size list — 10 · 20 · 50 · 100 is the app\'s answer');
  // 50: a month is usually one page, so the band mostly reports the length of
  // the list rather than cutting it.
  assert.match(acctCode, /const \[pageSize, setPageSize\] = useState\(50\);/);
  assert.match(acctCode, /unit="คน"/);
  // The label names the company, because บริษัท · ทั้งหมด draws two of these.
  assert.match(acctCode, /label=\{`สรุป OT ส่งบัญชี · \$\{company\.shortTh\}`\}/);
});

test('⚠ the page is a class on a row, never a slice — the sheet prints whole', () => {
  assert.ok(!/\.slice\(/.test(acctCode),
    'a slice appeared in สรุป OT ส่งบัญชี — Ctrl+P would print one page of the month');
  assert.match(acctCode, /\{company\.rows\.map\(\(row, i\) => \(/);
  assert.match(acctCode, /className=\{i >= from && i < from \+ pageSize \? undefined : 'off-page'\}/);
  // Screen hides it; paper does not.
  assert.match(css, /\.acct-table tbody tr\.off-page \{ display: none; \}/);
  assert.match(printCss, /\.acct-table tbody tr\.off-page \{ display: table-row !important; \}/);
  // And the band itself must not reach the paper at all.
  assert.match(acctCode, /className="flush-pager no-print"/);
});

test('the summary in the foot is the company\'s, on every page', () => {
  /**
   * A PAGE IS NOT A FILTER, and on this screen it is free: รวมแผนก and
   * รวมทั้งหมด are built from `company.departments` and `company.totals`, which
   * the route computed over the whole month — they were never counted from the
   * rows, so no page can move them. Same for the two chips in the head.
   */
  assert.match(acctCode, /\{company\.departments\.map\(\(d\) => \(/);
  assert.match(acctCode, /total=\{company\.rows\.length\}/);
  assert.ok(!/\{t\.headcount\}[\s\S]{0,40}pageSize/.test(acctCode));
});

test('the reset is keyed on the data here, and that is the right answer on this screen', () => {
  /**
   * THE OPPOSITE OF §11's ANSWER, and the difference is that nothing on this
   * screen edits a row. The rows change when the month changes, when งวดสอง
   * เดือน is turned on, or when แสดงพนักงานที่ไม่มี OT is ticked — all three
   * mean a different list, and page 3 of it is not where the reader was.
   */
  assert.match(acctCode, /usePageReset\(setPage, \[periods\.join\(','\), company\.rows\.length, pageSize\]\);/);
  assert.match(acctCode, /const pageCount = Math\.max\(1, Math\.ceil\(company\.rows\.length \/ pageSize\)\);/);
  assert.match(acctCode, /const at = Math\.min\(Math\.max\(page, 1\), pageCount\);/);
  assert.match(acctCode, /page=\{at\}/);
});

test('ถัดไป lands on the sheet that was pressed, not on the report', () => {
  assert.match(acctCode, /function goPage\(next\) \{\s*setPage\(next\);\s*listRef\.current\?\.scrollIntoView\(\{ block: 'start' \}\);\s*\}/);
  assert.match(acctCode, /<div className="table-wrap acct-list" ref=\{listRef\}>/);
  assert.equal(acctCode.match(/scrollIntoView/g)?.length, 1);
  assert.ok(!/useEffect\([^)]*\)[\s\S]{0,200}?scrollIntoView/.test(acctCode),
    'the scroll moved into an effect — it would fire on every month change too');
  assert.match(css, /\.table-wrap\.acct-list \{ scroll-margin-top: calc\(62px \+ 14px\); \}/);
});

test('บริษัทที่ N is gone from the head, and the prop with it', () => {
  // *"เอาคำว่า บริษัทที่ ออกจากหัวตาราง"*, 2026-09-11. The ordinal meant
  // something only against a list, and a single-company tab has none.
  // `acctCode`, not `acct`: the account of WHY it went is written into a
  // comment beside the map, and a ban that could not survive being explained
  // would be a ban on the explanation.
  // The shape, not the word: `บริษัทที่เลือกไว้` on the export menu is the same
  // eight characters meaning something else entirely.
  assert.ok(!/บริษัทที่\s*\{/.test(acctCode), 'the ordinal came back to สรุป OT ส่งบัญชี');
  assert.match(acctCode, /function CompanySheet\(\{ company, periods \}\)/);
  assert.match(acctCode, /<CompanySheet key=\{c\.key\} company=\{c\} periods=\{periods\} \/>/);
  assert.ok(!/findIndex/.test(acctCode), 'the index is still being computed for nobody');
});
