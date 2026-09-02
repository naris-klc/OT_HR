import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ตัวเลขชั่วโมงอยู่กลางช่อง — asked for on 2026-09-02, on the two documents
 * where a month is read: the printed ใบขออนุมัติทำงานล่วงเวลา (F-HR-027) and
 * ตรวจสอบประจำเดือน on the screen.
 *
 * WHAT WAS ASKED FOR IS NARROW, AND THAT IS THE POINT. Three wider things were
 * offered and declined the same morning: re-lettering the sheet's column
 * headings ("คือมันเป็นฟอร์มเดิม"), printing "-" or "0" in the hour cells a day
 * has no OT in ("ปล่อยว่างไม่ต้องใส่อะไรเลย"), and carrying the paper's long
 * labels onto the screen's 52px columns ("คงเดิมรูปแบบเดิม"). So the change is
 * one property in two stylesheets, and everything those three would have
 * touched is pinned here as unchanged — a heading, an empty cell and a column
 * width that stay as they are because somebody said so, not by accident.
 *
 * The alignment itself cannot be measured without a DOM, and a DOM here would
 * promise more than it could keep — `.f027` is laid out in millimetres against
 * A4. What can be pinned is that the declaration exists, that the cells it aims
 * at still carry the classes it names, and that nothing later in either file
 * takes it back except the two phone rules that are meant to.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (file) => readFileSync(join(ROOT, file), 'utf8');

/** CSS with comments stripped — the files explain themselves at length. */
const cssOf = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, '');

/** JSX with comments stripped, the same way the other layout suites read it. */
const jsxOf = (file) => read(file)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/**
 * The declaration block of the first rule whose selector list contains
 * `selector`. Returns '' when there is no such rule, so a missing rule fails as
 * a missing declaration rather than throwing.
 */
function blockFor(css, selector) {
  const at = css.indexOf(selector);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  if (open < 0) return '';
  return css.slice(open + 1, css.indexOf('}', open));
}

/**
 * The whole rule — selector list AND declarations — around `anchor`, for the
 * one rule here whose selector list runs over two lines and whose first line
 * (`th.rate-col, td.rate-col`) also opens an earlier rule ten lines above it.
 * Comments are already stripped, so the previous `}` is the rule's own start.
 */
function ruleWith(css, anchor) {
  const at = css.indexOf(anchor);
  if (at < 0) return { selectors: '', block: '' };
  const open = css.indexOf('{', at);
  return {
    selectors: css.slice(css.lastIndexOf('}', at) + 1, open),
    block: css.slice(open + 1, css.indexOf('}', open)),
  };
}

const PRINT = 'app/print.css';
const STYLES = 'app/styles.css';
const FORM = 'components/PrintForm.jsx';
const HR_VIEW = 'components/HrView.jsx';
const HR_ENTRIES = 'components/HrEntries.jsx';

// ── ใบขออนุมัติทำงานล่วงเวลา (F-HR-027) ──────────────────────────────────────

test('the three จำนวนชั่วโมง columns are centred on the sheet', () => {
  const css = cssOf(PRINT);
  assert.match(
    blockFor(css, '.f027 td.n'),
    /text-align:\s*center/,
    '.f027 td.n is not centred — the hour figures are back against the right rule',
  );
});

test('เวลาทำ OT จาก/ถึง stays centred beside them', () => {
  // Unchanged, and pinned because the two are a block: the five columns were
  // read as two if either one of them moved.
  assert.match(blockFor(cssOf(PRINT), '.f027 td.c'), /text-align:\s*center/);
});

test('the sheet is aligned once, for the screen and the paper together', () => {
  // app/print.css is imported in app/layout.js beside styles.css rather than
  // being a print-only sheet, and the alignment rules sit above every @media
  // block in it. So the `.f027-screen` preview and the page coming out of the
  // printer are the same declaration and cannot drift apart.
  assert.match(read('app/layout.js'), /^import '\.\/print\.css';$/m);

  const css = cssOf(PRINT);
  const firstMedia = css.indexOf('@media');
  assert.ok(firstMedia > 0, 'print.css has no @media block at all — check this test, not the file');
  for (const selector of ['.f027 td.n', '.f027 td.c']) {
    assert.ok(
      css.indexOf(selector) < firstMedia,
      `${selector} moved inside a media block — screen and paper can now disagree`,
    );
  }
});

test('the cells the rule aims at still carry .n and .c', () => {
  const code = jsxOf(FORM);

  // จาก and ถึง.
  assert.equal((code.match(/<td className="c">\{s\?\.(from|to) \|\| ''\}<\/td>/g) || []).length, 2);

  // The three hour columns on a row, and the same three on สรุปรวม.
  const bucketCells = code.match(/<td className="n">\{cell\([^)]*BUCKETS\.[A-Z0-9_]+\][^)]*\)\}<\/td>/g) || [];
  assert.equal(
    bucketCells.length, 6,
    'a จำนวนชั่วโมง cell no longer carries className="n" — `.f027 td.n` does not reach it',
  );
});

test('an hour cell with no OT is still printed empty', () => {
  // "-" and "0" were both offered on 2026-09-02 and both declined: a day with
  // no OT is a blank on the paper form, and HR reads it as one. `cell` is what
  // decides that, and centring a cell says nothing about what goes in it.
  assert.match(
    jsxOf(FORM),
    /const cell = \(v\) => \(v \? hours\(v\) : ''\)/,
    'the sheet prints something in an empty hour cell — that was asked against',
  );
});

test('the sheet keeps the headings the paper form has', () => {
  const code = jsxOf(FORM);
  // Copied from F-HR-027 Rev.4 character for character, dots and all — and the
  // "17.01" in them is the open question in docs/hr-briefing.md §ข้อ 0, which
  // is decided by asking HR what the old paper paid, not by re-typing a heading.
  for (const heading of [
    'เริ่ม 17.01-07.59', 'เริ่ม 8.00-17.00', 'OT วันปกติ', 'OT วันหยุด', 'จำนวนชั่วโมง',
  ]) {
    assert.ok(code.includes(heading), `the F-HR-027 heading "${heading}" is gone`);
  }
});

// ── ตรวจสอบประจำเดือน ────────────────────────────────────────────────────────

test('รวม ชม. is centred with the three rates beside it', () => {
  const { selectors, block } = ruleWith(cssOf(STYLES), 'th.total-col, td.total-col');
  assert.match(block, /text-align:\s*center/);

  // The paragraph over this rule has said "three rates and their total" since it
  // was written; until 2026-09-02 the selector said only `.rate-col`, so the
  // total centred on คิวรออนุมัติ — where the cell happens to carry both classes
  // — and stayed right-aligned everywhere else.
  for (const selector of ['th.rate-col', 'td.rate-col', 'th.total-col', 'td.total-col']) {
    assert.ok(
      new RegExp(`(^|,)\\s*${selector.replace('.', '\\.')}\\s*(,|$)`, 'm').test(selectors),
      `${selector} is not in the centring rule — that column is set two ways again`,
    );
  }
});

test('every รวม cell on the screen carries total-col', () => {
  // The month's table and its grand total, and the per-person drill-down opened
  // from it. All three are ตรวจสอบประจำเดือน as far as somebody reading it is
  // concerned, and a total centred in one and not the others is the ragged
  // strip the rule above exists to remove.
  const view = jsxOf(HR_VIEW);
  assert.ok(view.includes('<th className="num total-col">รวม ชม.</th>'));
  assert.equal((view.match(/<td className="num total-col">/g) || []).length, 2);

  const entries = jsxOf(HR_ENTRIES);
  assert.ok(entries.includes('<th className="num total-col">รวม</th>'));
  assert.ok(entries.includes('<td className="num total-col" data-label="รวม (ชม.)">'));
});

test('the screen keeps its own short headings, not the paper\'s long ones', () => {
  // Declined on 2026-09-02: the columns are 52 and 58px and the sheet's labels
  // are a phrase each. `RateHead` is what breaks the two words, and the widths
  // are measured against the lower one.
  const css = cssOf(STYLES);
  assert.match(blockFor(css, 'th.rate-col {'), /width:\s*52px/);
  assert.match(blockFor(css, 'th.rate-col.wide'), /width:\s*58px/);
  assert.match(jsxOf(HR_VIEW), /<RateHead rate="×1\.5" of="ปกติ" \/>/);
});

test('the phone cards state their own alignment, after this rule', () => {
  // Below 860px neither cell is a column: on คิวรออนุมัติ the total is a chip,
  // and on ตรวจสอบประจำเดือน it is a field on the รวมทั้งหมด card. Both say so
  // themselves, and both must stay later in the file than the rule above or
  // they lose it on source order.
  const css = cssOf(STYLES);
  const shared = css.indexOf('th.total-col, td.total-col');
  for (const selector of ['.queue-table td.total-col', '.hr-table tbody tr.total-row td.total-col']) {
    const at = css.indexOf(selector);
    assert.ok(at > shared, `${selector} is now above the centring rule and would lose to it`);
    assert.match(blockFor(css, selector), /text-align:\s*(left|right)/);
  }
});
