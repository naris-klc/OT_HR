import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ตั้งค่าระบบ → แผนกและเพดาน: how the screen says a department has nobody to
 * sign for it, in the three places it now says it.
 *
 * The finding itself is `unsignedStaff` and is tested in
 * test/signingCoverage.test.js. What is pinned here is that the SCREEN reads it
 * once and paints it three times — banner, chip, tab badge — because three
 * readings of one rule is three chances for the badge to say 1 over a table
 * showing none, and a warning that contradicts the screen it is on teaches
 * people to stop reading it.
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
  assert.match(code, /stranded: unsignedStaff\(roster, String\(d\._id\)\)/);

  // The banner, the chip and the badge — each asks the same function.
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

test('the roster is fetched once, above the section that draws the table', () => {
  // The badge is on the tab strip, which is painted before แผนกและเพดาน is
  // opened — and one arrival skips that tab entirely (the policy-drift link
  // lands on นโยบายการคำนวณ). Reported upwards by the section instead, the
  // badge would be a warning that arrives after the thing it warns about.
  const code = sourceOf(SETTINGS);
  assert.match(code, /function useRoster\(\)/);
  assert.match(code, /const roster = useRoster\(\)/);
  assert.match(code, /function Departments\(\{ onGo, roster \}\)/);
  assert.match(code, /const \{ rows, people, reload: load \} = roster/);

  // And the section it feeds has stopped reading either endpoint for itself.
  // (ทะเบียนพนักงาน and the import screen fetch the same two lists further down
  // this file for their own purposes; the rule here is about this one section.)
  const start = code.indexOf('function Departments({ onGo, roster })');
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
  assert.match(actions, /ตั้งค่าหัวหน้างาน/);
  assert.match(actions, /ตั้งผู้รับช่วงอนุมัติ/);
});

// ── 2 · the chip and the badge ───────────────────────────────────────────────

test('the chips filter the table and say how many of each there are', () => {
  const code = sourceOf(SETTINGS);
  assert.match(code, /const \[onlyGaps, setOnlyGaps\] = useState\(false\)/);
  assert.match(code, /const shownRows = onlyGaps \? rows\.filter\(\(d\) => gapIds\.has\(String\(d\._id\)\)\) : rows/);
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
  assert.match(common, /export function useScrollEdge\(watch\)/);
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
