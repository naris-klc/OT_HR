import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * สลิปรหัสผ่าน — เรขาคณิตอยู่ใน CSS จำนวนต่อแผ่นอยู่ใน JSX.
 *
 * The two have to agree and nothing makes them. `PER_PAGE` decides how many
 * slips React puts in a `.slips` block; the grid in print.css decides how many
 * fit on the paper. Raise one without the other and the overflow does not error
 * anywhere — it prints, with the eleventh slip pushed off the bottom of the
 * sheet or a page break through the middle of somebody's password. Nobody finds
 * out until sixty of them are already on the printer.
 *
 * So the arithmetic is done here, from both files, in millimetres.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/print.css'), 'utf8');
const jsx = readFileSync(join(ROOT, 'components/PasswordSlips.jsx'), 'utf8');

/** The `.slips` block only — `.slip` rules must not be read as the sheet's. */
const sheet = css.slice(css.indexOf('.slips {'), css.indexOf('.slip {'));
const mm = (re, src = sheet) => {
  const m = src.match(re);
  assert.ok(m, `หาไม่เจอ: ${re}`);
  return Number(m[1]);
};

test('จำนวนสลิปต่อแผ่นใน JSX ตรงกับตารางใน CSS', () => {
  const perPage = Number(jsx.match(/const PER_PAGE = (\d+)/)[1]);
  const cols = Number(sheet.match(/grid-template-columns: repeat\((\d+),/)[1]);

  /**
   * Rows are not declared as a count — `grid-auto-rows` sets their height and
   * the sheet is CONTENT-BOX, so `min-height` IS the grid area and the padding
   * sits outside it. Subtracting the padding here — which the first version of
   * this test did — reports one row fewer than the paper actually holds, and
   * would have been "fixed" by dropping PER_PAGE to 8 and wasting a fifth of
   * every sheet.
   */
  const rowH = mm(/grid-auto-rows: ([\d.]+)mm/);
  const rows = Math.floor(mm(/min-height: ([\d.]+)mm/) / rowH);

  assert.equal(perPage, cols * rows, `PER_PAGE=${perPage} แต่กระดาษรับได้ ${cols}×${rows}`);
});

/**
 * A4 is 210×297mm and `@page` is zero-margin for F-HR-027's sake, so this
 * sheet's own padding is the only margin there is. The 2mm of headroom is the
 * same slack `.f027` keeps and for the same reason: a sheet measuring 297.1mm
 * spills a blank side into the middle of the stack.
 */
test('แผ่นสลิปพอดี A4 พร้อมเผื่อ 2 มม.', () => {
  const width = mm(/width: ([\d.]+)mm/);
  const height = mm(/min-height: ([\d.]+)mm/);
  const pad = mm(/padding: ([\d.]+)mm/);
  const cols = Number(sheet.match(/grid-template-columns: repeat\(\d+, ([\d.]+)mm\)/)[1]);
  const colCount = Number(sheet.match(/grid-template-columns: repeat\((\d+),/)[1]);

  assert.equal(colCount * cols, width, 'คอลัมน์รวมกันต้องเท่ากับความกว้างเนื้อที่');
  assert.ok(width + pad * 2 <= 210, `กว้างเกิน A4: ${width + pad * 2}mm`);
  assert.ok(height + pad * 2 <= 295, `สูงเกินที่เผื่อไว้: ${height + pad * 2}mm`);
});

test('สลิปห้ามถูกตัดกลางใบ และแต่ละแผ่นขึ้นหน้าใหม่', () => {
  const print = css.slice(css.lastIndexOf('@media print'));
  assert.match(print, /\.slip \{ break-inside: avoid; page-break-inside: avoid; \}/);
  assert.match(print, /\.slips \+ \.slips \{ break-before: page; page-break-before: always; \}/);
});

/**
 * The address is read off the browser at print time. A hard-coded one would be
 * wrong the day this moves to the company server — printed on paper, in
 * somebody's hand, saying the wrong thing.
 */
test('ที่อยู่เข้าระบบบนสลิปอ่านจากเบราว์เซอร์ ไม่ใช่ค่าที่เขียนตายไว้', () => {
  assert.match(jsx, /window\.location\.origin/);
  assert.doesNotMatch(jsx, /https?:\/\/(?!\s)/, 'มี URL เขียนตายอยู่ในไฟล์');
});

/**
 * Every other list in this app that a person reads down is sorted. This one is
 * not, and it would be a reasonable thing to "fix" without noticing why: the
 * stack of slips has to come off the printer in the order of the file HR
 * uploaded, because that is the list they are ticking names off.
 */
test('ไม่เรียงลำดับใหม่ — ต้องออกมาตามลำดับในไฟล์ที่นำเข้า', () => {
  assert.doesNotMatch(jsx, /\.sort\(/, 'เรียงใหม่จะไม่ตรงกับไฟล์ที่ HR ถืออยู่');
});
