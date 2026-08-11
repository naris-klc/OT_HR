import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * A HOLIDAY ADDED THROUGH THE SCREEN WAS NEVER A HOLIDAY.
 *
 * Found by running the real thing against the real database, which is the only
 * way it could have been found: every unit test passed, every screen looked
 * right, and the day was still paid at วันปกติ rates.
 *
 * THE MECHANISM, because it will be reached for again. `Holiday.year` is a
 * denormalised copy of the first four characters of `date`, derived by a
 * `pre('validate')` hook. All four write paths — manual add and CSV import, on
 * both servers — use `findOneAndUpdate(..., { upsert: true })`. That is QUERY
 * middleware territory: document hooks do not run, and `runValidators: true`
 * only validates paths that appear in the update, so `year: { required: true }`
 * raised nothing about a field nobody had mentioned. Every holiday ever created
 * through the app went in without one.
 *
 * `loadHolidaySet` then filtered on `year`. So:
 *
 *   · HR adds วันหยุดบริษัท and sees it listed on the calendar;
 *   · the engine cannot see it, and every ใบ OT on that date is computed as an
 *     ordinary working day — ×1.5 วันปกติ instead of ×1.5/×3 วันหยุด;
 *   · the recompute fired on save reported `updated: 1` and `changed: 0`,
 *     which reads like success;
 *   · nothing anywhere disagreed with anything else.
 *
 * Fixed on both sides: the writes set `year`, and the engine stopped reading it.
 * The second is the one that matters — it makes a future missed write cosmetic
 * (a row missing from a year-filtered list) instead of a payroll error.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const WRITERS = [
  'app/api/holidays/route.js',
  'app/api/holidays/import/route.js',
  'src/routes/holidays.js',
];

test('nothing that decides a rate reads the derived year', () => {
  // The half that makes the bug impossible rather than merely fixed. `date` is
  // 'YYYY-MM-DD', so a string range is a chronological range and the unique
  // index on it serves the query.
  const service = read('src/services/otService.js');
  const loader = service.slice(
    service.indexOf('export async function loadHolidaySet'),
    service.indexOf('export async function currentPolicyVersion'),
  );

  assert.ok(loader.length > 0, 'loadHolidaySet moved — check what the engine reads now');
  assert.doesNotMatch(
    loader,
    /year:/,
    'loadHolidaySet ใช้ฟิลด์ year อีกแล้ว — วันหยุดที่เพิ่มผ่านหน้าจอจะหายไปจากการคำนวณเงียบ ๆ',
  );
  assert.match(loader, /date: \{ \$gte: `\$\{Number\(y\)\}-01-01`, \$lte: `\$\{Number\(y\)\}-12-31` \}/);
});

test('every upsert sets year itself, because the model hook cannot', () => {
  // Not redundant with the test above: `year` is still what the calendar screen
  // filters and what the schema requires, so leaving it unset writes a document
  // the model would refuse if it were ever validated.
  for (const file of WRITERS) {
    const code = read(file);
    const upserts = [...code.matchAll(/findOneAndUpdate\([\s\S]*?\n\s*\);/g)].map((m) => m[0]);
    assert.ok(upserts.length > 0, `${file} no longer upserts — re-check this test`);
    for (const call of upserts) {
      assert.match(call, /year: yearOf\(date\)/, `${file}: an upsert that does not set year`);
    }
  }
});

test('the year is derived in exactly one place', () => {
  // Four call sites each doing `Number(date.slice(0, 4))` is four chances to
  // write `slice(0, 3)` in one of them.
  const model = read('src/models/Holiday.js');
  assert.match(model, /export const yearOf = \(date\) => Number\(String\(date\)\.slice\(0, 4\)\)/);
  assert.match(model, /this\.year = yearOf\(this\.date\)/, 'the document hook stopped using the helper');

  for (const file of WRITERS) {
    const code = read(file);
    assert.match(code, /yearOf/, `${file} does not import the shared derivation`);
    // Scoped to the field: these files slice a date for other reasons —
    // `previousDay` in the legacy router builds a UTC timestamp out of one.
    assert.doesNotMatch(code, /year: Number\(/, `${file} derives the year itself`);
  }
});

test('the calendar list is filtered by date too, so old rows are still listed', () => {
  // Rows written before the fix have no `year` at all. A screen that went on
  // filtering by it would show the day as absent while the engine — now reading
  // `date` — treated it as a holiday, which is the same disagreement the other
  // way round.
  for (const file of ['app/api/holidays/route.js', 'src/routes/holidays.js']) {
    const code = read(file);
    assert.doesNotMatch(code, /\{ year: Number\(/, `${file} still filters the calendar by year`);
    assert.match(code, /-01-01`, \$lte: `\$\{/, file);
  }
});
