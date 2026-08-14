import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * EVERY PATH THAT WRITES TO A MONTH ASKS WHETHER THE MONTH IS CLOSED.
 *
 * The lock is the one rule in this system that needs a database read to answer,
 * so it could not go inside `editPermission` and its two siblings without
 * making three pure, heavily tested rules asynchronous and giving them a Mongo
 * dependency they have never had. It is a helper called at the top of each
 * route instead — which buys the purity back and costs exactly this: a route
 * that forgets the call is a route with no lock, and nothing would say so.
 *
 * This is what says so. It reads the route files and asserts the call is in
 * them. A source-reading test is a poor substitute for a type, and it is what
 * there is; the alternative is finding out from a closed month that changed.
 *
 * IF YOU ADD A WRITE PATH, add it here. A new route that moves hours, or moves
 * a request between statuses, belongs in this list — and if it deliberately
 * does not need the lock, say why in the list rather than leaving it out.
 *
 * Run with: npm test
 */

const GUARDED = [
  ['app/api/entries/route.js', 'บันทึกรายการย้อนหลัง', 'filing a new request'],
  ['app/api/entries/[id]/route.js', 'แก้ไข', "an employee's own edit and HR's correction"],
  ['app/api/entries/[id]/cancel/route.js', 'ยกเลิก', 'withdrawing a request'],
  ['app/api/entries/[id]/approve/route.js', 'อนุมัติ', 'a manager or HR signing'],
  ['app/api/entries/[id]/reject/route.js', 'ไม่อนุมัติ', 'refusing a request'],
  ['app/api/entries/[id]/cap-override/route.js', 'บันทึกการอนุมัติเกินเพดาน', 'recording an over-cap approval'],
  ['app/api/birthday/entries/route.js', 'บันทึกใบวันเกิดย้อนหลัง', 'filing a birthday holiday'],
];

for (const [file, verb, what] of GUARDED) {
  test(`${file} refuses to write into a closed month`, () => {
    const src = read(file);
    assert.match(src, /refusePeriodLock\(/, `${what} — no lock check at all`);
    /**
     * `[\s\S]{0,80}?` and not `[^)]*`: the period argument is itself a call —
     * `refusePeriodLock(periodOf(session.workDate), 'บันทึก…')` — so a class
     * that stops at the first bracket never reaches the verb. The first
     * version of this test did exactly that and failed the two routes that
     * were written correctly.
     */
    assert.match(
      src,
      new RegExp(`refusePeriodLock\\([\\s\\S]{0,80}?'${verb}'`),
      `${what} — the refusal does not name what was refused`,
    );
    // The refusal must be returned, not computed and dropped.
    assert.match(src, /if \((?:locked|closed)\) return fail\((?:locked|closed)\.error, (?:locked|closed)\.status\)/, `${what} — the refusal is never returned`);
  });
}

test('the lock is read through the query module, never inline in a route', () => {
  /**
   * One place loads the document and one place decides. A route reaching for
   * the model directly would be a second answer to "is this month closed".
   *
   * Matched on the IMPORT rather than on the word: `refusePeriodLock` contains
   * "PeriodLock", so a bare /PeriodLock/ fails every route that does this
   * correctly — which is what it did on the first run of this file.
   */
  for (const [file] of GUARDED) {
    assert.doesNotMatch(
      read(file),
      /from '@\/src\/models\/PeriodLock/,
      `${file} loads the lock model itself instead of asking periodLockQuery`,
    );
  }
});

test('the rules module stays pure — it never touches the database', () => {
  const rules = read('lib/periodLock.js');
  assert.doesNotMatch(rules, /mongoose|findOne|countDocuments|models\//);
  // And the query module is the only thing that does.
  assert.match(read('lib/periodLockQuery.js'), /PeriodLock\.findOne/);
});

test('reads are not guarded — a closed month is still readable', () => {
  /**
   * Deliberate, and worth pinning: closing a month stops it changing, not
   * being looked at. The reports, the exports and the printed form all read
   * closed months by definition — that is what closing one is FOR — and a lock
   * check on a GET would make a settled month invisible instead of settled.
   */
  for (const file of [
    'app/api/reports/monthly/[period]/route.js',
    'app/api/exports/entries.csv/route.js',
    'app/api/reports/form/[period]/route.js',
  ]) {
    assert.doesNotMatch(read(file), /refusePeriodLock/, `${file} refuses to READ a closed month`);
  }
});
