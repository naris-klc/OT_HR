import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * รายงาน OT ฝ่ายบัญชี reaches paper by two routes, and both have to work.
 *
 * The พิมพ์ button swaps the screen for `AccountingPrint` — `.acct`, a sheet
 * measured against A4 and ruled in millimetres. That one has been designed for
 * paper since it was written and `test/printFlagLayout.test.js` guards its
 * arithmetic.
 *
 * Ctrl+P is the other route, and until 2026-09-02 nothing had been said to the
 * screen table about paper at all. What came out was the report with its last
 * three columns missing — not truncated with an ellipsis, MISSING, because
 * `.table-wrap` is a scroll container and a browser prints the visible width of
 * one and drops the rest. Nothing on the sheet said so, and every figure that
 * did print was correct, which is the shape of error that gets filed.
 *
 * So this pins the rules that make the second route survivable, and it pins
 * them BY BEHAVIOUR — the scroll box stops scrolling, the frozen column stops
 * being frozen, the caps come off, the table fills the width, the rows do not
 * split and the headings repeat.
 *
 * It also pins the two rules that go against a default, because those are the
 * ones a later reader is most likely to "tidy up":
 *
 *   - the margin is padding on the card and NOT `@page`, which stays at 0 for
 *     the reason written above it in app/print.css;
 *   - `tfoot` is forced back to `table-row-group`, because these tfoots hold
 *     รวมทั้งหมด rather than a running footer.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRINT_CSS = readFileSync(join(ROOT, 'app', 'print.css'), 'utf8');

/** The stylesheet with its comments taken out — prose is not a rule. */
const CSS = PRINT_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** The one `@media print` block that talks about the screen tables. */
function screenTableBlock() {
  const at = CSS.indexOf('.table-wrap::after');
  assert.ok(at > 0, 'the screen-table print block is gone from app/print.css');
  const open = CSS.lastIndexOf('@media print', at);
  // Walk the braces so the block is read whole rather than to the first `}`.
  let depth = 0;
  let i = CSS.indexOf('{', open);
  const start = i;
  for (; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1;
    else if (CSS[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return CSS.slice(start, i + 1);
}

const BLOCK = screenTableBlock();

/** `.acct-table` `.allco-table` `.dept-table` — the three screen tables. */
const TABLES = ['.acct-table', '.allco-table', '.dept-table'];

test('the scroll container stops scrolling, and its fade is taken off', () => {
  // A page break cannot be put inside an overflow container, so this is the
  // rule the other six depend on: without it the table is one unbreakable box
  // as wide as the card and the rest of the report is simply not printed.
  assert.match(BLOCK, /\.table-wrap\s*\{[^}]*overflow:\s*visible\s*!important/);
  assert.match(BLOCK, /\.table-wrap\s*\{[^}]*display:\s*block\s*!important/);

  // The fade is a `::after` gradient with no class of its own, so `.no-print`
  // cannot reach it — left in, it is painted over live figures.
  assert.match(BLOCK, /\.table-wrap::after\s*\{[^}]*display:\s*none\s*!important/);
});

test('the margin is padding on the card, and the @page every sheet shares is left at 0', () => {
  /**
   * The single most costly edit this file can take. Giving the shared `@page` a
   * margin makes every F-HR-027 spill its last band onto a second side — forty
   * forms print eighty pages. The note above the rule says so; this makes the
   * cost of ignoring it a failing test rather than a ream of paper.
   *
   * ⚠ IT READ "`@page` is not scopable to one screen … exactly one @page" UNTIL
   * 2026-09-10, and that sentence was half true in a way that mattered. A page
   * can be NAMED (`@page manual`) and reached with `page: manual` on a box, and
   * on that day the manual needed one: it is the only document here that is
   * prose, so it has no band of its own and was printing off the edge of the
   * paper — measured, ink from 0.0mm to 210.1mm across 209.9mm. A named page is
   * exactly the tool for "this document and not the other five", and refusing
   * it wholesale had pushed the last change toward the one edit that would have
   * cost the paper: a margin on the shared rule.
   *
   * So what is pinned is the shape rather than the count. The UNNAMED `@page`
   * is still one and still `margin: 0`; a named one is allowed, and only if
   * something in this file actually stands on it — a name nothing uses is a
   * margin waiting to be given to the wrong document by whoever tidies it up.
   */
  const pages = [...CSS.matchAll(/@page([^{]*)\{([^}]*)\}/g)].map((m) => ({
    name: m[1].trim(),
    margin: (m[2].match(/margin:\s*([^;]+);/) || [, '(none)'])[1].trim(),
  }));

  const shared = pages.filter((p) => !p.name);
  assert.deepEqual(
    shared.map((p) => p.margin), ['0'],
    'app/print.css must hold exactly one unnamed @page and it must stay at margin: 0 — '
      + 'read the note above it, the cost is a second sheet of paper per F-HR-027',
  );

  for (const page of pages.filter((p) => p.name)) {
    assert.match(page.name, /^[a-z][a-z-]*$/,
      `@page ${page.name} is not a plain name — a pseudo-class here reaches pages this test cannot see`);
    assert.match(CSS, new RegExp(`page:\\s*${page.name}\\s*;`),
      `@page ${page.name} exists and nothing stands on it — an unused named page is a margin waiting for the wrong document`);
  }

  // The three forms are measured against a full-bleed page and must stay on it.
  for (const sheet of ['.f027', '.acct', '.otdept']) {
    const at = CSS.indexOf(`${sheet} {`);
    assert.ok(at > 0, `${sheet} is gone from app/print.css`);
    assert.ok(!/page:\s*[a-z]/.test(CSS.slice(at, CSS.indexOf('}', at))),
      `${sheet} was moved onto a named page — it carries its own bands and needs the whole sheet`);
  }

  // …and the margin asked for lives on the card that holds a report table.
  assert.match(BLOCK, /\.card:has\(\.acct-table\)/);
  assert.match(BLOCK, /padding:\s*10mm\s+15mm/);
});

test('every report table fills the page instead of the card', () => {
  for (const t of TABLES) {
    assert.ok(BLOCK.includes(t), `${t} is not told it is on paper`);
  }
  assert.match(BLOCK, /width:\s*100%\s*!important/);
  // Screen widths are px and the page is mm; auto is what lets the columns be
  // measured from their contents at print size.
  assert.match(BLOCK, /table-layout:\s*auto\s*!important/);
  assert.match(BLOCK, /min-width:\s*0\s*!important/);
});

test('the caps, the ellipsis and the frozen column all come off', () => {
  // A name cut short on screen is recoverable by widening the window. On paper
  // it is a person nobody can identify, on a document that goes to accounting.
  assert.match(BLOCK, /max-width:\s*none\s*!important/);
  assert.match(BLOCK, /white-space:\s*normal\s*!important/);
  assert.match(BLOCK, /text-overflow:\s*clip\s*!important/);
  assert.match(BLOCK, /overflow-wrap:\s*break-word/);

  // Freezing a column answers sideways scrolling, and there is none on paper.
  assert.match(BLOCK, /position:\s*static\s*!important/);
  assert.match(BLOCK, /box-shadow:\s*none\s*!important/);
  // The card-coloured fill under the frozen column goes with it — it exists to
  // hide rows sliding beneath, and on paper only lightens one column.
  assert.match(BLOCK, /\.acct-table tbody td\.who-col[\s\S]{0,120}background:\s*none\s*!important/);
});

test('rows are not split and the headings repeat on every page', () => {
  assert.match(BLOCK, /page-break-inside:\s*avoid/);
  assert.match(BLOCK, /break-inside:\s*avoid/, 'the modern spelling is carried too');
  assert.match(BLOCK, /thead[\s\S]{0,120}display:\s*table-header-group/);

  for (const t of TABLES) {
    assert.ok(
      new RegExp(`${t.replace('.', '\\.')} tr`).test(BLOCK),
      `${t} rows can still be cut in half by a page break`,
    );
  }
});

test('tfoot is forced back to a row group — it is a total, not a running footer', () => {
  /**
   * The one rule here that goes AGAINST a browser default rather than with it,
   * and therefore the one most likely to be "corrected" by somebody tidying up.
   *
   * `tfoot` defaults to `table-footer-group`, which repeats it at the foot of
   * every page. On these three tables tfoot is รวมแผนก and รวมทั้งหมด — so the
   * default hands accounting a three-page report in which every page carries a
   * different figure each labelled as the month's total.
   */
  assert.match(BLOCK, /tfoot[\s\S]{0,140}display:\s*table-row-group/);
  assert.doesNotMatch(
    BLOCK, /\.acct-table tfoot[\s\S]{0,60}display:\s*table-footer-group/,
    'the grand total would reprint on every page',
  );
});

test('none of it can reach the purpose-built A4 sheet', () => {
  /**
   * `.acct` is the sheet the พิมพ์ button renders, and it is ruled in
   * millimetres against A4 — 194mm of body inside 8mm bands, `table-layout:
   * fixed`, pad rows carrying the margin onto every page. A `width: 100%` or a
   * `table-layout: auto` reaching it would undo all of that at once.
   *
   * The separation is structural rather than careful: AccountingPrint.jsx uses
   * none of the three class names this block is keyed on. Checked here so it
   * stays structural — the day the sheet is refactored onto `.table-wrap` or a
   * `.card`, this fails instead of the paper changing size.
   */
  const sheet = readFileSync(join(ROOT, 'components', 'AccountingPrint.jsx'), 'utf8');
  for (const hook of ['table-wrap', 'acct-table', 'allco-table', 'dept-table', 'className="card']) {
    assert.ok(
      !sheet.includes(hook),
      `AccountingPrint.jsx now uses ${hook}, so the screen-table print rules reach the A4 sheet`,
    );
  }
});
