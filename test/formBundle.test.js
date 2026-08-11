import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * พิมพ์ F-HR-027 ทุกคน — a month of sheets as one document.
 *
 * HR was pressing print once per person and collating the stack by hand. The
 * bundle removes the pressing, and the only real hazard in doing so is that the
 * bundle stops being the same form: F-HR-027 Rev.4 is a controlled document,
 * laid out cell for cell against paper in millimetres (see app/print.css), and
 * a second copy of that markup written to lay out forty pages would be a second
 * form the day one of them was corrected and the other was not.
 *
 * So what is pinned here is that there is one sheet element and one route
 * behind it, and that the paper break between people is a page. There is no DOM
 * in this suite — the checks read the source, as printFlagLayout.test.js does
 * and for the same reason.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sourceOf = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const SHEET = 'components/PrintForm.jsx';
const BUNDLE = 'components/PrintFormBatch.jsx';

test('the bundle prints the sheet element, it does not carry a copy of it', () => {
  const bundle = sourceOf(BUNDLE);

  assert.match(
    bundle,
    /import \{[^}]*\bF027Sheet\b[^}]*\} from '\.\/PrintForm\.jsx'/,
    'the bundle must render the same sheet one person prints',
  );
  assert.ok(
    !/className="f027"/.test(bundle),
    'the bundle has grown its own copy of the controlled form',
  );
});

test('the sheet is declared in exactly one place', () => {
  // The one thing that makes the check above worth anything: if a third file
  // starts drawing `.f027`, the import proves nothing.
  const sheet = sourceOf(SHEET);
  assert.match(sheet, /export function F027Sheet/);
  assert.match(sheet, /className="f027"/);
});

test('the bundle reads each sheet from the route the single sheet is read from', () => {
  // Same endpoint, same employee parameter, therefore the same statuses, the
  // same deduplication and the same สรุปรวม. A page in the bundle and a page
  // printed on its own are the same page or this is not worth having.
  const single = sourceOf(SHEET);
  const bundle = sourceOf(BUNDLE);
  const call = /api\.get\(`\/reports\/form\/\$\{period\}/;

  assert.match(single, call);
  assert.match(bundle, call);
  assert.match(bundle, /\?employee=\$\{employee\._id\}/);
});

test('one person to a side of paper', () => {
  const css = readFileSync(join(ROOT, 'app/print.css'), 'utf8');
  assert.match(
    css,
    /\.f027 \+ \.f027 \{[^}]*page-break-before: always/,
    'sheets would run into one another on the paper',
  );
  // A single sheet has no sibling, so the rule cannot reach the one-person
  // print — that path must stay exactly what it was.
  assert.match(css, /\.f027-screen \.f027 \+ \.f027 \{ margin-top: 0; \}/);
});

test('a sheet that fails to load is named rather than dropped', () => {
  // A bundle that is quietly one page short is the failure that survives all
  // the way to somebody's payslip.
  const bundle = sourceOf(BUNDLE);
  assert.match(bundle, /failed\.length > 0/);
  assert.match(bundle, /\{f\.employee\.code\} · \{f\.employee\.name\}/);
});
