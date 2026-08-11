import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { groupEntriesByEmployee } from '../lib/accountingRows.js';
import { companyOf } from '../src/config/companies.js';

/**
 * แผนก IS SNAPSHOTTED ONTO THE ENTRY · บริษัท IS READ FROM THE ROSTER AT REPORT
 * TIME — and this file exists so that stops being an accident.
 *
 * The two are the same KIND of thing everywhere else: dimensions the monthly
 * reports are split by, adjacent dropdowns on ทะเบียนพนักงาน, both changed by HR
 * with one gesture. They behave oppositely.
 *
 *   แผนก   OtEntry.department is required and indexed and is written when the
 *          request is filed. Every report groups by the entry's copy. Editing
 *          the roster moves nothing that already exists.
 *   บริษัท The entry records nothing. สรุป OT ส่งบัญชี asks
 *          `companyOf(entry.employee)` while it is building the sheet, so
 *          today's roster value decides which payroll file EVERY month that
 *          person has ever filed belongs to — closed months included.
 *
 * That asymmetry is load-bearing for the warning ทะเบียนพนักงาน shows before a
 * save (only บริษัท gets a count of what it would restate — see
 * lib/rosterImpact.js) and it is written up in the README under "แผนก is
 * snapshotted onto the entry · บริษัท is not".
 *
 * IF YOU CAME HERE BECAUSE THIS FILE WENT RED: most likely somebody copied
 * `company` onto OtEntry so that history stops moving. That may well be the
 * right change. It is a change to what a closed month MEANS, so it is one to
 * make on purpose — decide what the existing entries get backfilled with (the
 * only value available is today's roster value, which reproduces exactly the
 * restatement the change is meant to stop), update the README section and the
 * dialog copy in components/AdminView.jsx, and then update this file to pin the
 * new behaviour. What must not happen is the behaviour changing quietly and
 * three screens' worth of warnings going on saying the old thing.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ENGINEERING = { _id: 'd-eng', code: 'ENG', nameTh: 'วิศวกรรม' };
const PRODUCTION = { _id: 'd-prod', code: 'PRD', nameTh: 'ผลิต 1' };

/** An approved entry as `accountingReport` has it: employee and department populated. */
const entry = (employee, department, otHours) => ({
  _id: `e-${employee._id}-${otHours}`,
  employee,
  department,
  totals: { otHours },
});

// ── แผนก: what was filed stays where it was worked ──────────────────────────

test('a department moved on the roster does not move hours that were already filed', () => {
  // The person worked these hours in วิศวกรรม and the entries say so. HR moves
  // them to ผลิต 1 today. Last month's sheet must still count them under
  // วิศวกรรม — the manager who signed them owns them, and the department's
  // ceiling was measured against them.
  const worked = { _id: 'e1', code: 'PM-0412', name: 'สมชาย ใจดี', department: PRODUCTION };
  const entries = [entry(worked, ENGINEERING, 8), entry(worked, ENGINEERING, 3.5)];

  const { groups } = groupEntriesByEmployee(entries);
  const [group] = [...groups.values()];

  assert.equal(
    group.department,
    ENGINEERING,
    'the report grouped by the roster’s department instead of the entry’s — '
    + 'ทุกเดือนที่ปิดไปแล้วจะย้ายแผนกตามการแก้ทะเบียน ซึ่งเป็นพฤติกรรมของ “บริษัท” ไม่ใช่ของ “แผนก”',
  );
  assert.equal(group.department.nameTh, 'วิศวกรรม');
});

test('the entry carries its own department, and the model requires it', () => {
  // The property above is only true because the field exists on the entry and
  // cannot be left off. A department that were optional would leave old rows
  // with nothing to group by, and the natural repair is to read the roster —
  // which is how แผนก would quietly become บริษัท.
  const src = readFileSync(join(ROOT, 'src/models/OtEntry.js'), 'utf8');
  const code = strip(src);

  assert.match(
    code,
    /department:\s*\{[^}]*ref:\s*'Department'[^}]*required:\s*true/,
    'OtEntry.department is no longer a required field on the entry',
  );
});

// ── บริษัท: read from the roster, every time the sheet is built ─────────────

test('a company moved on the roster moves every month ever filed', () => {
  // The same two entries, unchanged. Only the roster row differs — and the
  // company the sheet files them under follows it.
  const before = { _id: 'e1', code: 'PM-0412', name: 'สมชาย ใจดี', company: 'primus' };
  const after = { ...before, company: 'themtech' };

  const filed = (person) => [entry(person, ENGINEERING, 8), entry(person, ENGINEERING, 3.5)];

  const was = [...groupEntriesByEmployee(filed(before), { companyOf }).groups.values()][0];
  const now = [...groupEntriesByEmployee(filed(after), { companyOf }).groups.values()][0];

  assert.equal(was.company, 'primus');
  assert.equal(
    now.company,
    'themtech',
    'the sheet stopped following today’s roster value for บริษัท',
  );
  // Which is the whole point: nothing about the entries changed.
  assert.deepEqual(was.entries.map((e) => e._id), now.entries.map((e) => e._id));
});

test('an unset company follows the code prefix, so it moves too', () => {
  // Rows written before `npm run migrate:company` have no stored company at
  // all. They are not exempt: `companyOf` falls through to the prefix, which
  // is still resolved at report time.
  const noField = { _id: 'e2', code: 'THT0056', name: 'มาลี' };
  const [group] = [...groupEntriesByEmployee([entry(noField, ENGINEERING, 4)], { companyOf }).groups.values()];
  assert.equal(group.company, 'themtech');
});

test('nothing on the entry records a company — there is no snapshot to read', () => {
  // The structural half of the test above. If this ever fails, the behavioural
  // one probably still passes (the sheet would keep asking the roster) while
  // the data underneath has quietly gained a second, disagreeing answer.
  const code = strip(readFileSync(join(ROOT, 'src/models/OtEntry.js'), 'utf8'));
  assert.doesNotMatch(
    code,
    /\bcompany\s*:/,
    'OtEntry now stores a company — see the README section on this asymmetry '
    + 'before deciding which of the two answers the reports should believe',
  );
});

test('the sheet resolves the company through companyOf, not off the entry', () => {
  // lib/accounting.js resolves `@/…` through the Next alias and cannot be
  // imported by node --test, so this reads it as text — the same approach
  // test/accountingReconciliation.test.js takes, for the same reason.
  const code = strip(readFileSync(join(ROOT, 'lib/accounting.js'), 'utf8'));

  assert.match(code, /groupEntriesByEmployee\(entries,\s*\{\s*companyOf\s*\}\)/);
  assert.doesNotMatch(code, /entry\.company/, 'the sheet started reading a company off the entry');

  // And the grouping helper asks it of the EMPLOYEE the entry points at, which
  // is the step that makes it a live read rather than a stored one.
  const rows = strip(readFileSync(join(ROOT, 'lib/accountingRows.js'), 'utf8'));
  assert.match(rows, /company:\s*companyOf\(entry\.employee\)/);
  assert.match(rows, /department:\s*entry\.department/);
});

// ── the two warnings that depend on all of the above ────────────────────────

test('the roster screen warns about both, and counts only the one with something to count', () => {
  // A count for แผนก would be a warning that is not true, and a warning that is
  // not true is the one people learn to click past — which would take the
  // บริษัท warning beside it down as well.
  const impact = strip(readFileSync(join(ROOT, 'lib/rosterImpact.js'), 'utf8'));
  assert.match(impact, /RETROACTIVE_FIELDS\s*=\s*Object\.freeze\(\['company'\]\)/);

  const screen = strip(readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8'));
  // Both are explained before the save; only one of the two paragraphs is fed a
  // count from the server.
  assert.match(screen, /department:\s*\(\{\s*depts,\s*from,\s*to\s*\}\)/);
  assert.match(screen, /company:\s*\(\{\s*from,\s*to,\s*impact\s*\}\)/);
  assert.match(screen, /retroLine\(wasOn,\s*to,\s*impact\)/);
});

/** Comments say what the code should do; these tests are about what it does. */
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
