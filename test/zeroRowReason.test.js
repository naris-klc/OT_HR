import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { zeroRowReason } from '../lib/otMode.js';

/**
 * แถวศูนย์ในสรุป OT ส่งบัญชี — "เดือนนี้ไม่มี" หรือ "ไม่มีเลย".
 *
 * The sheet lists every roster member, blanks included, because a blank line is
 * accounting's evidence that somebody was checked rather than missed. Since
 * departments can be marked ไม่มีโอที or เหมารายวัน, two different facts print
 * identically — and only one of them is worth ringing HR about.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('an ordinary department explains nothing — its nought is about the month', () => {
  assert.equal(zeroRowReason({ otMode: 'normal' }), '');
  assert.equal(zeroRowReason({}), '');
  assert.equal(zeroRowReason(null), '');
});

test('the two modes each name themselves', () => {
  assert.equal(zeroRowReason({ otMode: 'none' }), 'ไม่มีโอที');
  assert.equal(zeroRowReason({ otMode: 'daily' }), 'เหมารายวัน');
});

test('the sheet carries the field the answer is read from', () => {
  // shapeDepartment decides what every row on the sheet knows; a populate that
  // omits otMode makes every department read as ordinary and the label vanishes
  // with nothing to say it has.
  const accounting = read('lib/accounting.js');
  assert.match(accounting, /otMode: d\.otMode \|\| 'normal'/);
  assert.equal([...accounting.matchAll(/'code name nameTh otMode'/g)].length, 2);
});

test('screen and CSV say it, the printed sheet does not', () => {
  assert.match(read('components/AccountingView.jsx'), /zeroRowReason\(row\.department\)/);
  assert.match(read('app/api/exports/accounting.csv/route.js'), /zeroRowReason\(row\.department\)/);
  // The paper's หมายเหตุ strip carries only remarks about figures it asserts —
  // it already keeps ไม่มี OT off for that reason, and a department mode is an
  // explanation for the ABSENCE of a figure.
  assert.doesNotMatch(read('components/AccountingPrint.jsx'), /zeroRowReason/);
});

test('it is said only on a row that has no hours', () => {
  // On a row with hours the mode explains nothing, and a mark on every row of a
  // เหมารายวัน department is a mark nobody reads.
  assert.match(read('components/AccountingView.jsx'), /row\.entryCount === 0 && zeroRowReason/);
  assert.match(read('app/api/exports/accounting.csv/route.js'), /if \(row\.entryCount === 0\) \{/);
});

test('the department column itself is left alone', () => {
  // "ผลิต (เหมารายวัน)" would split one department into two in every pivot
  // table accounting builds on that column.
  const csv = read('app/api/exports/accounting.csv/route.js');
  assert.match(csv, /row\.department\?\.name \|\| ''/);
});
