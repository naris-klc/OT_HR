import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { groupEntriesByEmployee } from '../lib/accountingRows.js';
import { companyOf } from '../src/config/companies.js';

/**
 * แผนก AND บริษัท ARE BOTH READ FROM THE ROSTER AT REPORT TIME — and this file
 * exists so that stops being an accident.
 *
 * The two are the same KIND of thing everywhere else: dimensions the monthly
 * reports are split by, adjacent dropdowns on ทะเบียนพนักงาน, both changed by HR
 * with one gesture. They now behave the same way as well.
 *
 *   แผนก   OtEntry.department is still required and indexed and is still written
 *          when the request is filed — but no report reads it any more.
 *          `groupEntriesByEmployee` lists everybody under their สังกัดหลัก, the
 *          department on the roster, so today's value decides which department
 *          every month ever filed is counted under.
 *   บริษัท The entry records nothing. สรุป OT ส่งบัญชี asks
 *          `companyOf(entry.employee)` while it is building the sheet, so
 *          today's roster value decides which payroll file EVERY month that
 *          person has ever filed belongs to — closed months included.
 *
 * ⚠ THEY WERE OPPOSITE UNTIL 2026-09-08, and the reversal is what this file is
 * mostly for. It read: "แผนก IS SNAPSHOTTED ONTO THE ENTRY · บริษัท IS READ FROM
 * THE ROSTER AT REPORT TIME", and every warning on ทะเบียนพนักงาน was written
 * around that — แผนก was the reassuring paragraph, บริษัท the red one with the
 * count. HR asked for one person to appear under one department, their สังกัดหลัก
 * (see components/DepartmentPrint.jsx and lib/accountingRows.js), and the price
 * of that is this: **a department move now restates closed months**, which
 * nothing in the app refuses since ปิดงวด was withdrawn. Measured on the live
 * database the day it changed, 0 of 2 entries were filed under a department
 * other than their owner's, so no figure moved on the way in.
 *
 * IF YOU CAME HERE BECAUSE THIS FILE WENT RED: the likely change is somebody
 * putting one of the two back on the entry so that history stops moving. That
 * may well be the right change. It is a change to what a closed month MEANS, so
 * it is one to make on purpose — decide what the existing entries get backfilled
 * with, update the README section, the dialog copy in components/AdminView.jsx
 * and `RETROACTIVE_FIELDS` in lib/rosterImpact.js, and then update this file to
 * pin the new behaviour. What must not happen is the behaviour changing quietly
 * and three screens' worth of warnings going on saying the old thing.
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

// ── แผนก: the roster decides, every time the sheet is built ─────────────────

test('a department moved on the roster moves hours that were already filed', () => {
  // The entries were filed under วิศวกรรม and still say so. The person sits in
  // ผลิต 1 on the roster today — and that is where the month counts them, in
  // every month, because HR asked for one person under one department.
  const worked = { _id: 'e1', code: 'PM-0412', name: 'สมชาย ใจดี', department: PRODUCTION };
  const entries = [entry(worked, ENGINEERING, 8), entry(worked, ENGINEERING, 3.5)];

  const { groups } = groupEntriesByEmployee(entries);
  const [group] = [...groups.values()];

  assert.equal(
    group.department,
    PRODUCTION,
    'the report went back to grouping by the entry’s department — '
    + 'คนหนึ่งคนจะโผล่ในแผนกที่ไม่ใช่สังกัดหลักของตัวเอง ซึ่งเป็นสิ่งที่ HR ขอให้เลิกทำเมื่อ 2026-09-08',
  );
  assert.equal(group.department.nameTh, 'ผลิต 1');
});

test('the entry department is the fallback, not the rule', () => {
  // It is reached only when the roster row has no department to resolve — a
  // hard-deleted แผนก, a half-finished restore. Dropping the row into
  // ไม่ระบุแผนก when the entry still remembers one would lose a name off a
  // department's sheet to fix a problem that is not that department's.
  const orphan = { _id: 'e2', code: 'PM-0100', name: 'ไม่มีสังกัด' };
  const [group] = [...groupEntriesByEmployee([entry(orphan, ENGINEERING, 4)]).groups.values()];
  assert.equal(group.department, ENGINEERING);
});

test('the entry still carries its own department, and the model still requires it', () => {
  // Nothing reads it for a report any more, and it is not therefore dead: it is
  // what the ไม่ถูกนับ list names an orphaned entry's department by (there is no
  // employee left to ask), it is the fallback above, and it is the only record
  // of where an hour was actually worked. Making it optional would throw that
  // away as a side effect of a report change.
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

test('the sheet resolves both dimensions off the employee, not off the entry', () => {
  // lib/accounting.js resolves `@/…` through the Next alias and cannot be
  // imported by node --test, so this reads it as text — the same approach
  // test/accountingReconciliation.test.js takes, for the same reason.
  const code = strip(readFileSync(join(ROOT, 'lib/accounting.js'), 'utf8'));

  assert.match(code, /groupEntriesByEmployee\(entries,\s*\{\s*companyOf\s*\}\)/);
  assert.doesNotMatch(code, /entry\.company/, 'the sheet started reading a company off the entry');
  // The employee's own department has to be fetched for the grouping to be able
  // to prefer it — an entry populate that dropped it would send every row
  // through the fallback and quietly restore the old behaviour.
  assert.match(code, /populate:\s*\{\s*path:\s*'department'/);

  // And the grouping helper asks both of the EMPLOYEE the entry points at,
  // which is the step that makes them live reads rather than stored ones.
  const rows = strip(readFileSync(join(ROOT, 'lib/accountingRows.js'), 'utf8'));
  assert.match(rows, /company:\s*companyOf\(entry\.employee\)/);
  assert.match(rows, /department:\s*entry\.employee\?\.department \|\| entry\.department/);
});

// ── the two warnings that depend on all of the above ────────────────────────

test('the roster screen warns about both, and counts both', () => {
  // Both restate months that have already been sent, so both get a number.
  // บทบาท still gets none: a count that is always zero is a warning people
  // learn to click past, and these two are the ones that must not be.
  const impact = strip(readFileSync(join(ROOT, 'lib/rosterImpact.js'), 'utf8'));
  assert.match(impact, /RETROACTIVE_FIELDS\s*=\s*Object\.freeze\(\['company', 'department'\]\)/);

  const screen = strip(readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8'));
  // Both paragraphs are fed a count from the server, and both are red.
  assert.match(screen, /department:\s*\(\{\s*depts,\s*from,\s*to,\s*impact\s*\}\)/);
  assert.match(screen, /company:\s*\(\{\s*from,\s*to,\s*impact\s*\}\)/);
  assert.equal([...screen.matchAll(/retroLine\(/g)].length, 3, 'one call each, plus the definition');

  // And the endpoint answers for both out of one read of the entries.
  const route = strip(readFileSync(join(ROOT, 'app/api/employees/[id]/impact/route.js'), 'utf8'));
  assert.match(route, /company:\s*\{\s*from,\s*to,\s*moved,/);
  assert.match(route, /department:\s*\{/);
});

/** Comments say what the code should do; these tests are about what it does. */
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}