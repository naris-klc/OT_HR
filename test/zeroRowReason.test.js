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

/** Source with its comments taken out — a name that is only EXPLAINED there is
 *  not a caller, and this file now asserts the absence of one. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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
  // THREE SINCE 2026-09-08, not two. The third is the department populated
  // inside the employee populate — สังกัดหลัก, which is what every row is now
  // grouped by. A populate that fetched it without otMode would make every
  // department read as ordinary, which is the same failure one selector along.
  assert.equal([...accounting.matchAll(/'code name nameTh otMode'/g)].length, 3);
});

test('the screen says it; neither the CSV nor the printed sheet does', () => {
  assert.match(read('components/AccountingView.jsx'), /zeroRowReason\(row\.department\)/);

  // ── IT READ "screen and CSV say it" UNTIL 2026-09-09 ──────────────────────
  //
  // On that day HR asked for the file's หมายเหตุ column to carry the word
  // วันเกิด and nothing else, which took ไม่มี OT — and the department mode
  // behind it — out of the CSV with the rest of the prose. What the file says
  // instead is what the paper sheet has always said about such a person: every
  // hour column on their row is blank.
  //
  // The mode is still on the screen this file is exported from, which is where
  // "why has ผลิต 2 got nothing at all this month" is asked and answered — and
  // the route's own comments say so, which is why this reads the CODE.
  assert.doesNotMatch(strip(read('app/api/exports/accounting.csv/route.js')), /zeroRowReason/);

  // The paper's หมายเหตุ strip carries only remarks about figures it asserts —
  // it already keeps ไม่มี OT off for that reason, and a department mode is an
  // explanation for the ABSENCE of a figure.
  assert.doesNotMatch(read('components/AccountingPrint.jsx'), /zeroRowReason/);
});

test('it is said only on a row that has no hours', () => {
  // On a row with hours the mode explains nothing, and a mark on every row of a
  // เหมารายวัน department is a mark nobody reads. One caller left — see above.
  assert.match(read('components/AccountingView.jsx'), /row\.entryCount === 0 && zeroRowReason/);
});

test('the department column itself is left alone', () => {
  // "ผลิต (เหมารายวัน)" would split one department into two in every pivot
  // table accounting builds on that column.
  const csv = read('app/api/exports/accounting.csv/route.js');
  assert.match(csv, /row\.department\?\.name \|\| ''/);
});
