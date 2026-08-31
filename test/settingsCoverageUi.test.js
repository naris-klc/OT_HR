import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ตั้งค่าระบบ → แผนกและเพดาน: how the screen says a department has nobody to
 * sign for it, in the four places it now says it — and how the two ceiling
 * boxes say that blank and 0 are different answers.
 *
 * The finding itself is `unsignedStaff` and is tested in
 * test/signingCoverage.test.js. What is pinned here is that the SCREEN reads it
 * once and paints it four times — banner, chip, tab badge, row badge — because
 * four readings of one rule is four chances for the badge to say 1 over a table
 * showing none, and a warning that contradicts the screen it is on teaches
 * people to stop reading it.
 *
 * The row badge is the newest of the four and the one that matters most for
 * this: it sits in the same cell as the names it contradicts.
 *
 * These files cannot be imported (they resolve `@/…` through the Next alias,
 * which node --test does not) so the checks read them as text, as
 * test/formBundle.test.js and test/printFlagLayout.test.js do.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceOf = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const SETTINGS = 'components/AdminView.jsx';
const COMMON = 'components/common.jsx';

/**
 * The stylesheets with line endings normalised — the repo is checked out CRLF
 * on this machine, and a `\n` in an assertion below would otherwise miss every
 * multi-line rule while the file is perfectly correct.
 */
const styles = () => readFileSync(join(ROOT, 'app/styles.css'), 'utf8').replace(/\r\n/g, '\n');
const printCss = () => readFileSync(join(ROOT, 'app/print.css'), 'utf8').replace(/\r\n/g, '\n');

// ── one reading of the finding ───────────────────────────────────────────────

test('the gap is computed once, by a function all three places call', () => {
  const code = sourceOf(SETTINGS);
  assert.match(code, /function signingGaps\(departments, people\)/);
  // Every หัวหน้า on the roster is offered to every department, because one
  // ticked into another แผนก is on neither its roster nor its headcount.
  assert.match(code, /const signers = active\.filter\(\(p\) => p\.role === 'manager'\)/);
  assert.match(code, /const stranded = unsignedStaff\(roster, String\(d\._id\), signers\)/);

  // The banner, the chip and the tab badge — each asks the same function.
  assert.match(code, /const gaps = signingGaps\(departments, people\)/, 'the banner');
  assert.match(code, /const gaps = signingGaps\(rows, people\)/, 'the chip');
  assert.match(code, /const gapCount = signingGaps\(roster\.rows, roster\.people\)\.length/, 'the badge');

  // And nobody keeps a private copy of the rule.
  assert.equal(
    (code.match(/unsignedStaff\(/g) || []).length,
    1,
    'unsignedStaff is called from more than one place on this screen again',
  );
});

test('the row badge reads the same finding, it does not recompute it', () => {
  // The fourth reader. The หัวหน้างาน cell used to work out for itself which
  // payrolls had nobody to sign for them — its own loop over `approvesCompany`,
  // in the one place on the screen where disagreeing with the tab badge would
  // be most visible. It is handed `signingGaps`' answer now.
  const code = sourceOf(SETTINGS);

  // The payrolls are the stranded people read the other way round, computed
  // once beside them.
  assert.match(code, /payrolls: \[\.\.\.new Set\(stranded\.map\(companyOf\)\)\]/);

  // Keyed by department so the row can be given the finding itself, not merely
  // told that there is one.
  assert.match(code, /const gapOf = new Map\(gaps\.map\(\(g\) => \[String\(g\.dept\._id\), g\]\)\)/);
  assert.match(code, /gap=\{gapOf\.get\(String\(d\._id\)\)\}/);

  // And the cell takes it rather than deriving it.
  assert.match(code, /function Heads\(\{ department, people, depts, gap, onGo \}\)/);
  assert.match(code, /const stranded = gap\?\.payrolls \|\| \[\]/);
  const start = code.indexOf('function Heads({ department, people, depts, gap, onGo })');
  const body = code.slice(start, code.indexOf('const HEAD_GAP_TIP', start));
  assert.ok(start > 0, 'Heads changed shape');
  assert.ok(
    !/approvesCompany === |const covered = /.test(body),
    'the หัวหน้างาน cell is deciding coverage for itself again',
  );
});

test('the roster is fetched once, above the section that draws the table', () => {
  // The badge is on the tab strip, which is painted before แผนกและเพดาน is
  // opened — and one arrival skips that tab entirely (the policy-drift link
  // lands on นโยบายการคำนวณ). Reported upwards by the section instead, the
  // badge would be a warning that arrives after the thing it warns about.
  const code = sourceOf(SETTINGS);
  assert.match(code, /function useRoster\(\)/);
  assert.match(code, /const roster = useRoster\(\)/);
  // `user` joined the signature when ปิด/เปิดใช้งานแผนก became ผู้ดูแลระบบ's —
  // see `mayClose` and lib/departments.js. The rule pinned here is unchanged:
  // the roster still arrives as a prop rather than being fetched again inside
  // the section.
  assert.match(code, /function Departments\(\{ user, onGo, roster \}\)/);
  assert.match(code, /const \{ rows, people, reload: load \} = roster/);

  // And the section it feeds has stopped reading either endpoint for itself.
  // (ทะเบียนพนักงาน and the import screen fetch the same two lists further down
  // this file for their own purposes; the rule here is about this one section.)
  const start = code.indexOf('function Departments({ user, onGo, roster })');
  const body = code.slice(start, code.indexOf('const BLANK_DEPT', start));
  assert.ok(start > 0, 'Departments changed shape');
  assert.ok(
    !/api\.get\(/.test(body),
    'Departments is reading the roster for itself again — two answers to one question',
  );
});

// ── 1 · the two ways out are not equals ──────────────────────────────────────

test('the repair that closes the warning is the filled button; the stand-in is not', () => {
  // ผู้รับช่วงอนุมัติ clears the queue and leaves the department exactly as
  // uncovered — the banner is still there tomorrow. Two identical ghosts made
  // that a fork with no default.
  const code = sourceOf(SETTINGS);
  const block = code.slice(code.indexOf('<div className="alert-actions">'));
  const actions = block.slice(0, block.indexOf('</div>'));

  assert.match(actions, /className="btn sm" onClick=\{\(\) => onGo\('employees'\)\}/);
  assert.match(actions, /className="btn ghost sm" onClick=\{\(\) => onGo\('delegation'\)\}/);
  // Both still reachable in one press — a hierarchy, not a removal.
  assert.match(actions, /ไปที่หน้าพนักงานเพื่อตั้งค่าสิทธิ์ ↗/);
  assert.match(actions, /ตั้งผู้รับช่วงอนุมัติ/);

  // The label carries the destination now, so the sentence that used to sit
  // above the two buttons repeating them is gone.
  assert.ok(
    !/แก้ได้สองทาง/.test(code),
    'the banner grew a line explaining the two buttons under it again',
  );
});

test('the banner says "some department", once, and lets the table say which', () => {
  // It used to print a bullet per department with the หัวหน้า, their scopes and
  // the codes of everybody stranded — at the top of a screen, growing downwards
  // into the table that answers the same question by being read.
  const code = sourceOf(SETTINGS);
  assert.match(code, /<strong>บางแผนกยังไม่มีหัวหน้าเซ็นอนุมัติครอบคลุมทุกบริษัท<\/strong>/);

  const start = code.indexOf('function SigningCoverage(');
  const body = code.slice(start, code.indexOf('function Departments(', start));
  assert.ok(start > 0, 'SigningCoverage changed shape');
  assert.ok(!/<ul/.test(body), 'the banner is listing the departments again');
  assert.ok(
    !/g\.stranded\.length|stranded\.map/.test(body),
    'the banner is naming the stranded people again — that is the row\'s job now',
  );

  // The consequence stays. Without it the line names a state and not a cost,
  // and the cost is the only reason anybody presses either button.
  assert.match(body, /ค้างที่ “รอหัวหน้า”/);

  // And no ⚠ in the text: `.alert.error` draws its own mark to the left of it.
  assert.ok(!/⚠/.test(body), 'the banner has a second warning mark in its text');
});

// ── the row: one pill per fact ───────────────────────────────────────────────

test('every หัวหน้า is a badge, and the scope is always inside it', () => {
  // Including "(ทุกบริษัท)". Printed only when set, an unmarked badge leaves
  // the reader to remember whether it means everybody or means nobody has said.
  const code = sourceOf(SETTINGS);
  assert.match(code, /<div className="head-badges">/);
  assert.match(code, /<span key=\{h\._id\} className=\{`head-badge\$\{visiting\(h\) \? ' visiting' : ''\}`\}>/);
  assert.match(
    code,
    /\(\{h\.approvesCompany \? companyShort\(h\.approvesCompany\) : 'ทุกบริษัท'\}\)/,
  );
  // The stack it replaced is gone from the cell.
  assert.ok(
    !/className="dept-head"/.test(code),
    'the หัวหน้างาน cell went back to a stack of lines',
  );
});

test('a gap is a badge per uncovered payroll, with the way out beside it', () => {
  const code = sourceOf(SETTINGS);
  // One badge naming the payroll…
  assert.match(code, /className="head-badge gap" title=\{HEAD_GAP_TIP\}>\s*\n?\s*⚠ ยังไม่มีหัวหน้า\{companyShort\(key\)\}/);
  // …unless nobody heads the department at all, which is one hole and not two.
  assert.match(code, /const nobody = heads\.length === 0/);
  assert.match(code, /⚠ ยังไม่มีหัวหน้า\s*\n/);
  // And the button that goes where the fix is.
  assert.match(code, /className="link head-fix"\s*\n\s*onClick=\{\(\) => onGo\('employees'\)\}/);
  assert.match(code, /แก้ไขสิทธิ์พนักงาน ↗/);
});

test('the gap badge is amber and ringed; the plain one is not', () => {
  // Red in this app is a refusal that already happened. A row nobody has got to
  // yet is amber, like every other "needs somebody" mark on these screens.
  const css = styles();
  const plain = css.slice(css.indexOf('.head-badge {'));
  assert.match(plain.slice(0, plain.indexOf('}')), /background: var\(--neutral-wash\)/);

  const gap = css.slice(css.indexOf('.head-badge.gap {'));
  const rule = gap.slice(0, gap.indexOf('}'));
  assert.match(rule, /background: var\(--amber-bg\); color: var\(--amber-ink\);/);
  assert.match(rule, /border: 1px solid var\(--amber\);/);
  // Padding down by the border it gains, so a row with a gap is no taller.
  assert.match(rule, /padding: 3px 9px;/);

  // They wrap rather than stacking — the column stops growing with the roster.
  assert.match(css, /\.head-badges \{ display: flex; flex-wrap: wrap;/);
});

// ── the two ceiling boxes: blank is not 0 ────────────────────────────────────

test('an empty ceiling box says what it does, not that nobody decided', () => {
  const code = sourceOf(SETTINGS);
  assert.equal(
    (code.match(/placeholder="ไม่จำกัด"/g) || []).length,
    4,
    'both boxes in the row and both in เพิ่มแผนก say the same word',
  );
  assert.ok(
    !/placeholder="ไม่กำหนด"/.test(code),
    'ไม่กำหนด invites somebody to come and decide it — which is the 0',
  );
});

test('the ceiling note is under the table, and tells the truth about 0', () => {
  // "กรอก 0 = ไม่อนุญาตให้ยื่น OT" is false while capBehaviour is 'warn', which
  // is what it ships as and what prod runs: the entry is filed, goes through,
  // and arrives flagged. Printing the refusal would have HR set a 0 to stop a
  // department filing and watch the requests keep coming.
  const code = sourceOf(SETTINGS);
  assert.match(code, /function capNote\(policy\)/);
  assert.match(code, /policy\?\.capBehaviour === 'block'/);
  assert.match(code, /กรอก 0 = ไม่อนุญาตให้ยื่น OT ระบบจะปฏิเสธทุกใบ/);
  assert.match(code, /กรอก 0 = ทุกใบจะติดธง “เกินเพดาน”/);
  assert.match(code, /หมายเหตุ: เว้นว่าง = ไม่จำกัดเพดาน/);

  // Read once, printed as the legend and as the `title` on both boxes.
  assert.match(code, /const capTip = capNote\(usePolicy\(\)\)/);
  assert.match(code, /<div className="hint cap-note">\{capTip\}<\/div>/);
  assert.equal(
    (code.match(/title=\{capTip\}/g) || []).length,
    2,
    'both ceiling boxes carry the same sentence',
  );

  // Under the table, not above it — a legend read before the thing it explains.
  const table = code.indexOf('<table className="deptset-table">');
  assert.ok(code.indexOf('className="hint cap-note"') > table, 'the note went back above the table');
});

test('the ceilings still save on blur, from the row', () => {
  // The whole reason the two boxes are in the table and not in the dialog.
  const code = sourceOf(SETTINGS);
  assert.match(code, /onBlur=\{\(e\) => update\(d\._id, \{ monthlyCapHours: e\.target\.value \}\)\}/);
  assert.match(code, /onBlur=\{\(e\) => update\(d\._id, \{ weeklyCapHours: e\.target\.value \}\)\}/);
});

test('แก้ไขแผนก has no หัวหน้างาน control, and no ceiling boxes either', () => {
  // A dropdown writing `Department.manager` that nothing read was the reason
  // this cell was rebuilt; the ceilings are in the row, one field one door.
  const code = sourceOf(SETTINGS);
  const start = code.indexOf('function DepartmentForm(');
  // `const ROLE_OPTIONS` and not the `// ── employees` rule above it:
  // `sourceOf` strips line comments, so that marker is not in what is searched.
  const body = code.slice(start, code.indexOf('const ROLE_OPTIONS', start));
  assert.ok(start > 0, 'DepartmentForm changed shape');
  assert.ok(!/manager/i.test(body), 'แก้ไขแผนก grew a หัวหน้างาน field again');
  assert.match(body, /เพดานชั่วโมงแก้ที่ช่องในตาราง · สถานะแก้ที่ปุ่มในตาราง/);
});

// ── 2 · the chip and the badge ───────────────────────────────────────────────

test('the chips filter the table and say how many of each there are', () => {
  const code = sourceOf(SETTINGS);
  assert.match(code, /const \[onlyGaps, setOnlyGaps\] = useState\(false\)/);
  assert.match(code, /const shownRows = onlyGaps \? rows\.filter\(\(d\) => gapOf\.has\(String\(d\._id\)\)\) : rows/);
  // The table draws the filtered list, not the whole one.
  assert.match(code, /\{shownRows\.map\(\(d\) => \(/);
  assert.ok(
    !/\{rows\.map\(\(d\) => \(/.test(code),
    'the department table went back to rendering every row',
  );
  assert.match(code, /แสดงทั้งหมด/);
  assert.match(code, /ไม่มีหัวหน้างาน\s*\n?\s*<span className="n">\{gaps\.length\}<\/span>/);
});

test('a healthy roster draws no chips at all', () => {
  // A pair reading “ไม่มีหัวหน้างาน (0)” is a control that can only ever be
  // pressed to show nothing, sitting where the warning would be.
  const code = sourceOf(SETTINGS);
  assert.match(code, /\{gaps\.length > 0 && \(\s*<div className="filter-chips"/);
});

test('the tab carries the count, and only while there is something to count', () => {
  const code = sourceOf(SETTINGS);
  assert.match(
    code,
    /\{s\.key === 'departments' && gapCount > 0 && \(/,
    'a permanent 0 would leave the one state that matters looking like the rest',
  );
  assert.match(code, /<span className="tab-badge"/);
  // Readable without seeing the colour.
  assert.match(code, /aria-label=\{`\$\{gapCount\} แผนกที่ยังไม่มีหัวหน้างาน`\}/);
});

test('the badge is a circle at one digit, not a square and not a pill', () => {
  // `min-width` equal to `height` is what rounds the common case: 999px only
  // rounds what it is given, and an 18px box with 6px of padding is a 30px
  // lozenge holding a "1". The padding is what a second digit grows into.
  const css = styles();
  const rule = css.slice(css.indexOf('.tab-badge {'));
  const body = rule.slice(0, rule.indexOf('}'));
  assert.match(body, /min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;/);
  assert.match(body, /font: 700 11px\/1 var\(--sans\)/);
  // Centred as a flex item against a Thai label, and never stretched by one.
  assert.match(body, /display: inline-flex; align-items: center; justify-content: center;/);
  assert.match(body, /align-self: center/);
  assert.match(body, /flex: 0 0 auto/);
});

test('both chips say which one is pressed, in markup and not only in colour', () => {
  const code = sourceOf(SETTINGS);
  const chips = code.slice(code.indexOf('className="filter-chips"'), code.indexOf('table-wrap'));
  assert.match(chips, /aria-pressed=\{!onlyGaps\}/);
  assert.match(chips, /aria-pressed=\{onlyGaps\}/);
});

// ── 3 · the tab strip on a phone ─────────────────────────────────────────────

test('one reading of "is there more this way", shared by the sheet and the tabs', () => {
  // A second copy would be two definitions drifting apart over the sub-pixel
  // rule below — the clause that is easy to leave out and impossible to notice
  // missing on the machine it was written on.
  const common = sourceOf(COMMON);
  // It read `useScrollEdge(watch)` until the opened list on ภาพรวม of บันทึกระบบ
  // asked the same question downwards. The axis is a PARAMETER and not a second
  // hook — the same rule one axis further along — and it defaults to 'x', so
  // the two horizontal callers still pass nothing.
  assert.match(common, /export function useScrollEdge\(watch, axis = 'x'\)/);
  assert.ok(!/function useScrollEdgeY|useVerticalScrollEdge/.test(common),
    'a vertical copy of the hook exists — that is the drift this test is about');
  assert.match(common, /if \(slack <= 2\) \{ setEdge\('none'\); return; \}/);
  assert.match(common, /export function SheetScroll\(/);
  assert.match(common, /const \[ref, edge\] = useScrollEdge\(children\)/);

  const settings = sourceOf(SETTINGS);
  assert.match(settings, /const \[tabsRef, tabsEdge\] = useScrollEdge\(null\)/);
  assert.match(settings, /<div className="tabs-view" data-edge=\{tabsEdge\}>/);
  assert.match(settings, /<div className="row section-tabs" ref=\{tabsRef\}>/);
});

test('the fade hangs on the wrapper, never inside the scroller', () => {
  // Anything painted inside a scroll container is content and scrolls away with
  // it — a fade that slides off the edge it marks says the tabs have run out at
  // the moment they have not.
  const css = styles();
  assert.match(css, /\.tabs-view \{ position: relative; \}/);
  assert.match(css, /\.tabs-view::before, \.tabs-view::after \{/);
  assert.match(css, /\.tabs-view\[data-edge="start"\]::after,\s*\n\s*\.tabs-view\[data-edge="middle"\]::after \{ opacity: 1; \}/);
  assert.match(css, /\.tabs-view\[data-edge="middle"\]::before,\s*\n\s*\.tabs-view\[data-edge="end"\]::before \{ opacity: 1; \}/);
});

test('the bleed moved to the wrapper, so the fade sits on the card edge', () => {
  // While the wrapper stayed inside the card's padding the two edges were 15px
  // apart — a gradient floating in the middle of the card with a tab sliding
  // out from under it.
  const css = styles();
  assert.match(css, /\.tabs-view \{ margin: -15px; \}/);
  const strip = css.slice(css.indexOf('.section-tabs {\n    flex-wrap: nowrap;'));
  const rule = strip.slice(0, strip.indexOf('}'));
  assert.match(rule, /overflow-x: auto;/);
  assert.match(rule, /scroll-snap-type: x proximity;/);
  // Left matches the card's own inset so the first tab lines up with the
  // heading; right is larger because it is not an inset but the end of the
  // scroll — what the last tab comes to rest against instead of the edge.
  assert.match(rule, /padding: 15px 20px 15px 15px;/);
  assert.ok(!/margin: -15px/.test(rule), 'the scroller kept the bleed as well as the wrapper');

  // The clip that keeps a scrolled tab inside the card's rounded corner has to
  // reach through the new wrapper.
  assert.match(css, /\.card:has\(\.section-tabs\) \{ overflow: hidden; \}/);
});

test('the fade fades to the card, and the print one still fades to a shadow', () => {
  // Same state contract, deliberately different paint: these tabs sit on a
  // white panel and the next button should dissolve into it. A shadow there
  // reads as a dropped edge.
  const css = styles();
  assert.match(css, /\.tabs-view::after \{\s*\n\s*right: 0;\s*\n\s*background: linear-gradient\(to left, var\(--card\), transparent\);/);

  assert.match(printCss(), /\.sheet-view\[data-edge="start"\]::after/, 'the printed sheet kept its own fade');
});
