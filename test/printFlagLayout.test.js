import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The "ไม่ถูกนับ" warning reaches the paper without moving anything on it.
 *
 * It has to be on the paper: the screen banner is seen by whoever pressed
 * print, and the person who signs the sheet is usually not that person. A sheet
 * that is short with nothing on it saying so gets signed as correct, because
 * every figure on the page still agrees with every other one.
 *
 * And it has to cost nothing. สรุป OT ส่งบัญชี fills its last page to exactly
 * ROWS_PER_PAGE with blank rows, and that constant is not derived — it is 37
 * measured against a page with a two-row heading and 10mm and 12mm margin
 * bands. Anything that adds a row, or grows one of those bands, silently
 * invalidates it: the filler stops landing on a page boundary and every sheet
 * after the first ends in the wrong place. That has happened once already, when
 * a company heading was added above the grid — the heading has since been taken
 * off the sheet at accounting's request, and the lesson it left is why this
 * warning sits in the margin band rather than in a row of its own.
 *
 * So what is checked here is the arithmetic and the placement, from the source.
 * There is no DOM in this suite and adding one to measure millimetres would be
 * a heavier promise than the layout can keep anyway; what can be pinned is that
 * ROWS_PER_PAGE is still counted from the roster alone, and that the flag is
 * not a row.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sourceOf = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const ACCOUNTING = 'components/AccountingPrint.jsx';
const DEPARTMENT = 'components/DepartmentPrint.jsx';

// ── สรุป OT ส่งบัญชี: the flag must not be a row ────────────────────────────

test('the accounting flag renders inside the margin band, not as a table row', () => {
  const code = sourceOf(ACCOUNTING);

  // In the thead pad row — the 10mm band ROWS_PER_PAGE was counted against.
  assert.match(
    code,
    /<tr className="pad">[\s\S]{0,200}<PaperFlag unaccounted=\{unaccounted\} \/>/,
    'PaperFlag is no longer inside the thead pad row — it will cost every page a row',
  );

  // A <span>, so it shares the company's line. A block element would give the
  // band a second line and grow it past 10mm.
  const body = code.slice(code.indexOf('function PaperFlag'), code.indexOf('export default'));
  assert.match(body, /<span className="flag">/);
  assert.doesNotMatch(
    body,
    /<(tr|div|p)\b/,
    'PaperFlag renders a block element — the margin band would grow',
  );
});

test('the row arithmetic still counts the roster and nothing else', () => {
  // If the flag ever became a row, this is the expression that would have to
  // change with it — so the fact that it has not is the check.
  const code = sourceOf(ACCOUNTING);

  assert.match(code, /const ROWS_PER_PAGE = 37;/);
  assert.match(code, /const short = company\.rows\.length % ROWS_PER_PAGE;/);
  assert.match(
    code,
    /company\.rows\.length === 0\s*\?\s*ROWS_PER_PAGE\s*:\s*\(short === 0 \? 0 : ROWS_PER_PAGE - short\)/,
    'the filler is computed from something other than company.rows.length',
  );

  // The filler loop renders exactly `filler` rows and knows nothing about the
  // flag. A flag that reduced or added to it would show up here.
  assert.match(code, /Array\.from\(\{ length: filler \}/);
  assert.doesNotMatch(code, /length: filler [-+]/, 'the filler is being adjusted for the flag');
});

test('with no missing hours the accounting sheet renders nothing extra at all', () => {
  // `count` falsy → null, before any element exists. Not an empty span, not a
  // zero-height row: nothing.
  const code = sourceOf(ACCOUNTING);
  assert.match(
    code,
    /function PaperFlag\(\{ unaccounted \}\) \{\s*if \(!unaccounted\?\.count\) return null;/,
  );
});

// ── สรุป OT แยกแผนก: one line under the total ───────────────────────────────

test('the department flag is one row under รวมชั่วโมงทำOT, and conditional', () => {
  const code = sourceOf(DEPARTMENT);

  const total = code.indexOf('รวมชั่วโมงทำOT');
  const flag = code.indexOf('unaccounted?.count > 0');
  assert.ok(total > 0 && flag > total, 'the flag is not below the total row');

  assert.match(code, /\{unaccounted\?\.count > 0 && \(\s*<tr className="flagrow">/);
  // Spans the grid and leaves the yellow-total column as open paper, like
  // every other row on the sheet.
  assert.match(code, /<tr className="flagrow">\s*<td colSpan=\{4\}>/);
  assert.match(code, /<tr className="flagrow">[\s\S]*?<td className="gap" \/>/);
});

test('the department flag prints on the closing sheet only', () => {
  // An unaccounted entry belongs to no department — that is what makes it
  // unaccounted — so printing it under one department's total would assert
  // something untrue about that department. รวมทุกแผนก is always printed and
  // is the total the bundle is signed against.
  const code = sourceOf(DEPARTMENT);

  /** The `<Sheet …>` element whose props contain `marker`. */
  const sheetWith = (marker) => {
    const at = code.indexOf(marker);
    assert.ok(at > 0, `no <Sheet> found for ${marker}`);
    const open = code.lastIndexOf('<Sheet', at);
    return code.slice(open, code.indexOf('/>', at) + 2);
  };

  assert.match(
    sheetWith('title="รวมทุกแผนก"'),
    /unaccounted=\{data\.unaccounted\}/,
    'the closing sheet is not told about the missing hours',
  );
  assert.doesNotMatch(
    sheetWith('spare={SPARE_ROWS}'),
    /unaccounted=/,
    'a per-department sheet is being told about hours that belong to no department',
  );
});

test('the department sheet defaults to no flag, so every other caller is unchanged', () => {
  const code = sourceOf(DEPARTMENT);
  assert.match(code, /function Sheet\(\{[^}]*unaccounted = null[^}]*\}\)/);
});

// ── both sheets ─────────────────────────────────────────────────────────────

test('the flags are styled, and print their colour', () => {
  // Backgrounds and colours are dropped by browsers when printing unless a
  // sheet asks for them, and this is the one mark on the page saying the total
  // above it is wrong.
  const css = readFileSync(join(ROOT, 'app/print.css'), 'utf8');

  assert.match(css, /\.acct thead tr\.pad td\.co \.flag \{[\s\S]*?print-color-adjust: exact;/);
  assert.match(css, /\.otdept tr\.flagrow td \{[\s\S]*?print-color-adjust: exact;/);

  // The accounting flag must not be able to wrap the 10mm band onto a second
  // line, so it inherits the band's nowrap and adds no display change.
  const band = css.slice(css.indexOf('.acct thead tr.pad td.co {'));
  assert.match(band.slice(0, 400), /white-space: nowrap;/);
});

test('neither flag is marked no-print', () => {
  // The whole point. The screen banner (UnaccountedHours) is no-print; these
  // two are not, and a `no-print` reaching them would silently undo this.
  for (const file of [ACCOUNTING, DEPARTMENT]) {
    const code = sourceOf(file);
    const flag = file === ACCOUNTING
      ? code.slice(code.indexOf('function PaperFlag'), code.indexOf('export default'))
      : code.slice(code.indexOf('className="flagrow"'), code.indexOf('</tbody>', code.indexOf('className="flagrow"')));
    assert.doesNotMatch(flag, /no-print/, `${file}: the paper flag is hidden from the paper`);
  }
});

test('the screen banner stays off the paper', () => {
  // The counterpart: the long banner with the id table is for the screen. On
  // the sheet it would take a third of a page and tell accounting nothing they
  // can act on.
  const common = sourceOf('components/common.jsx');
  const banner = common.slice(common.indexOf('export function UnaccountedHours'));
  assert.match(banner.slice(0, 400), /className="box error no-print"/);
});
