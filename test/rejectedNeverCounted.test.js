import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REPORTABLE_STATUSES, reportStatuses } from '../lib/reports.js';
import { CAP_STATUSES } from '../lib/caps.js';

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

/**
 * Files that turn entries into hours, and the screens that choose for them.
 *
 * Several of them no longer spell a list out: the report and export routes now
 * ask `reportStatuses` (lib/reports.js) and the cap windows ask `CAP_STATUSES`
 * (lib/caps.js), which is a better arrangement than four copies of the same
 * literal and does not weaken this check — the two lists themselves are pinned
 * below, and a file that delegates is verified to delegate.
 *
 * `delegatesTo` names the guarded list a file is allowed to defer to. A file
 * with neither a literal nor a delegation fails, because the most likely reason
 * for one to lose both is that its filter was dropped altogether.
 */
const COUNTING = [
  { file: 'app/api/reports/monthly/[period]/route.js', delegatesTo: 'reportStatuses' },
  { file: 'app/api/reports/form/[period]/route.js', delegatesTo: 'reportStatuses' },
  { file: 'app/api/exports/entries.csv/route.js', delegatesTo: 'reportStatuses' },
  { file: 'app/api/exports/monthly.csv/route.js', delegatesTo: 'reportStatuses' },
  { file: 'lib/accounting.js' },
  { file: 'src/services/otService.js', delegatesTo: 'CAP_STATUSES' },
  { file: 'components/HrView.jsx' },
];

/**
 * Both closed statuses, not only `rejected`.
 *
 * A withdrawn request is the same fact as a refused one from a total's point of
 * view — hours nobody is asking to be paid for — and it reached this check
 * later only because `cancelled` came later. Counting one and not the other
 * would put an employee's own second thoughts onto the sheet that goes to
 * payroll.
 */
const CLOSED = ['rejected', 'cancelled'];

for (const { file, delegatesTo } of COUNTING) {
  test(`${file} counts no refused or withdrawn request`, () => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    const lists = statusListsIn(src);

    assert.ok(
      lists.length > 0 || (delegatesTo && src.includes(delegatesTo)),
      `no status list and no ${delegatesTo || 'delegation'} in ${file} — has the filter gone?`,
    );

    for (const list of lists) {
      for (const closed of CLOSED) {
        assert.ok(
          !list.includes(closed),
          `${file} totals a list containing '${closed}': ${list.join(',')}`,
        );
      }
    }
  });
}

/**
 * The two lists everything above now defers to.
 *
 * Pinned by import rather than by text: these are real exports, so the check
 * can ask what they actually contain instead of what the file appears to say.
 */
test('the reportable list admits neither refused nor withdrawn requests', () => {
  for (const closed of CLOSED) {
    assert.ok(!REPORTABLE_STATUSES.includes(closed), `REPORTABLE_STATUSES contains '${closed}'`);
  }
});

test('the cap list admits neither refused nor withdrawn requests', () => {
  for (const closed of CLOSED) {
    assert.ok(!CAP_STATUSES.includes(closed), `CAP_STATUSES contains '${closed}'`);
  }
});

/**
 * And the filter is not merely a default that a URL can talk its way past.
 *
 * `?status=cancelled` used to reach the database unchecked, which put withdrawn
 * requests on ตรวจสอบรายเดือน and into the CSV exports — reachable by editing
 * an address bar. The guard drops what it may not print rather than trusting
 * the caller's list.
 */
test('a report cannot be talked into printing closed requests by its query string', () => {
  assert.deepEqual(reportStatuses('cancelled'), []);
  assert.deepEqual(reportStatuses('rejected'), []);
  assert.deepEqual(reportStatuses('approved,cancelled'), ['approved']);
  assert.deepEqual(reportStatuses('approved,rejected,pending_hr'), ['approved', 'pending_hr']);
});

test('an ordinary request is answered in full, and an empty one falls back', () => {
  assert.deepEqual(reportStatuses(''), ['approved', 'pending_hr', 'pending_mgr']);
  assert.deepEqual(reportStatuses(undefined, 'approved'), ['approved']);
  assert.deepEqual(reportStatuses('pending_mgr'), ['pending_mgr']);
  // Whitespace around a value is a URL detail, not a different status.
  assert.deepEqual(reportStatuses('approved, pending_hr'), ['approved', 'pending_hr']);
});

/** สรุป OT ส่งบัญชี takes no status selector at all — it is approved hours only. */
test('the accounting sheet counts approved hours and nothing else', () => {
  const src = readFileSync(join(ROOT, 'lib/accounting.js'), 'utf8');
  assert.match(src, /ACCOUNTING_STATUSES = Object\.freeze\(\['approved'\]\)/);
});
