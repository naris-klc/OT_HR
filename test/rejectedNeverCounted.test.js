import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * A refused request contributes no hours to anything. Anywhere.
 *
 * The rule is not enforced by a function anybody calls — it is enforced by
 * every totalling path listing the statuses it counts and `rejected` being in
 * none of those lists. That is the right design (a status filter the database
 * can use beats a post-filter nobody can see) and it is also exactly the kind
 * of rule that erodes: one route adds 'rejected' to a default so a screen can
 * show refused rows, and a month's hours quietly gain the requests that were
 * turned down — including, since ส่งใหม่ exists, the old version of a request
 * whose replacement is already being counted beside it. The figure would
 * double and the sheet would still balance against itself.
 *
 * So it is pinned here rather than left to reviewers. These files cannot be
 * imported — they resolve `@/…` through the Next alias, which node --test does
 * not — so the check reads them as text. Coarse, and it holds: any way of
 * writing 'rejected' into a status list writes the word into the file.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const STATUSES = ['pending_mgr', 'pending_hr', 'approved', 'rejected', 'cancelled'];

/**
 * Every comma-joined status list written as a literal in a file — the shape
 * `'approved,pending_hr'` takes in a query default, and the shape
 * `['approved']` takes in a frozen constant.
 */
function statusListsIn(source) {
  const lists = [];
  for (const [, quoted] of source.matchAll(/'([a-z_,]+)'/g)) {
    const parts = quoted.split(',');
    if (parts.some((p) => STATUSES.includes(p))) lists.push(parts);
  }
  return lists;
}

/** Files that turn entries into hours, and the screens that choose for them. */
const COUNTING = [
  'app/api/reports/monthly/[period]/route.js',
  'app/api/reports/form/[period]/route.js',
  'app/api/exports/entries.csv/route.js',
  'app/api/exports/monthly.csv/route.js',
  'lib/accounting.js',
  'src/services/otService.js',
  'components/HrView.jsx',
];

for (const file of COUNTING) {
  test(`${file} counts no refused request`, () => {
    const lists = statusListsIn(readFileSync(join(ROOT, file), 'utf8'));
    assert.ok(lists.length > 0, `no status list found in ${file} — has it moved?`);
    for (const list of lists) {
      assert.ok(
        !list.includes('rejected'),
        `${file} totals a list containing 'rejected': ${list.join(',')}`,
      );
    }
  });
}

/** สรุป OT ส่งบัญชี takes no status selector at all — it is approved hours only. */
test('the accounting sheet counts approved hours and nothing else', () => {
  const src = readFileSync(join(ROOT, 'lib/accounting.js'), 'utf8');
  assert.match(src, /ACCOUNTING_STATUSES = Object\.freeze\(\['approved'\]\)/);
});
