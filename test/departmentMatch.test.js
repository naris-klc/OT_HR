/**
 * The แผนก column of a roster CSV — matched to a department by any of its names.
 *
 * WHAT THIS FILE IS THE REPAIR FOR. `POST /api/employees/import` keyed one map
 * on `code.toUpperCase()` and looked the cell up in it. The roster this system
 * exists to hold — 163 people, PM & THT together — writes the Thai name in that
 * column, so every row of it failed `ไม่พบแผนกรหัส "..."` and the import loaded
 * nobody. Seven more rows write the department's name without the word แผนก in
 * front of it, which is a habit rather than a different department.
 *
 * So the cases below come in two halves. The first is that the names HR
 * actually types all arrive: รหัส, ชื่อไทย, ชื่ออังกฤษ, with or without the
 * unit word, spaced or not. The second is the half that keeps the first
 * honest — an exact name always beats a stripped one, and a key two
 * departments would answer to answers for NEITHER. A matcher that is generous
 * and also guesses is how somebody's OT ends up under another team's ceiling
 * with nothing on any screen saying a choice was made.
 *
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  normalizeDeptKey, stripUnitWord, buildDepartmentIndex, matchDepartment, departmentMatchError,
} from '../src/lib/departmentMatch.js';
import { roleFromLabel } from '../lib/roles.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The real roster's departments, as `npm run import:departments` writes them.
 * Trimmed to the rows the cases below actually name, and NOT invented: every
 * code/name/nameTh triple here is one that exists.
 */
const DEPARTMENTS = [
  { _id: '1', code: 'PROD1', name: 'Production 1', nameTh: 'แผนกผลิต1' },
  { _id: '2', code: 'PROD2', name: 'Production 2', nameTh: 'แผนกผลิต2' },
  { _id: '3', code: 'SALES', name: 'Sales', nameTh: 'ฝ่ายขาย' },
  { _id: '4', code: 'SALESCO', name: 'Sales Coordination', nameTh: 'แผนกประสานงานขาย' },
  { _id: '5', code: 'IT', name: 'Information Technology', nameTh: 'แผนกIT' },
  { _id: '6', code: 'BR-CBI', name: 'Chonburi Branch', nameTh: 'สาขาชลบุรี' },
  { _id: '7', code: 'HRD', name: 'Human Resources', nameTh: 'แผนกทรัพยากรมนุษย์' },
];

const index = buildDepartmentIndex(DEPARTMENTS);
const hit = (cell) => matchDepartment(index, cell);

test('รหัสแผนก matches, in either case', () => {
  assert.equal(hit('PROD1').department.code, 'PROD1');
  assert.equal(hit('prod1').department.code, 'PROD1');
  assert.equal(hit('BR-CBI').department.code, 'BR-CBI');
});

test('ชื่อไทย matches — the spelling the real roster uses', () => {
  assert.equal(hit('แผนกผลิต1').department.code, 'PROD1');
  assert.equal(hit('แผนกประสานงานขาย').department.code, 'SALESCO');
  assert.equal(hit('สาขาชลบุรี').department.code, 'BR-CBI');
  assert.equal(hit('ฝ่ายขาย').department.code, 'SALES');
});

test('ชื่ออังกฤษ matches, and its spacing does not matter', () => {
  assert.equal(hit('Sales Coordination').department.code, 'SALESCO');
  assert.equal(hit('salescoordination').department.code, 'SALESCO');
  assert.equal(hit('  Production 1  ').department.code, 'PROD1');
});

test('the unit word may be left off — the seven rows that said ประสานงานขาย', () => {
  assert.equal(hit('ประสานงานขาย').department.code, 'SALESCO');
  assert.equal(hit('ผลิต1').department.code, 'PROD1');
  assert.equal(hit('ชลบุรี').department.code, 'BR-CBI');
  assert.equal(hit('ขาย').department.code, 'SALES');
});

test('แผนก IT and แผนกIT are the same department', () => {
  assert.equal(hit('แผนกIT').department.code, 'IT');
  assert.equal(hit('แผนก IT').department.code, 'IT');
  assert.equal(hit('IT').department.code, 'IT');
});

test('a paste out of Excel brings zero-width characters and still matches', () => {
  assert.equal(hit('﻿แผนกผลิต1').department.code, 'PROD1');
  assert.equal(hit('แผนก​ผลิต1').department.code, 'PROD1');
});

/**
 * The guard the generosity above is only safe because of. A department whose
 * real name is the stripped form of another's keeps its own name: `ขาย` belongs
 * to whoever is CALLED that, and only reaches ฝ่ายขาย when nobody is.
 */
test('an exact name beats a stripped one', () => {
  const withRealSales = buildDepartmentIndex([
    ...DEPARTMENTS,
    { _id: '8', code: 'KHAI', name: 'Khai', nameTh: 'ขาย' },
  ]);
  assert.equal(matchDepartment(withRealSales, 'ขาย').department.code, 'KHAI');
  assert.equal(matchDepartment(withRealSales, 'ฝ่ายขาย').department.code, 'SALES');
});

test('a key two departments would answer to answers for neither', () => {
  const clashing = buildDepartmentIndex([
    { _id: '1', code: 'A', name: 'A', nameTh: 'แผนกซ่อมบำรุง' },
    { _id: '2', code: 'B', name: 'B', nameTh: 'ฝ่ายซ่อมบำรุง' },
  ]);
  const result = matchDepartment(clashing, 'ซ่อมบำรุง');
  assert.equal(result.department, null);
  assert.equal(result.reason, 'ambiguous');
  // …while each full name still reaches its own row.
  assert.equal(matchDepartment(clashing, 'แผนกซ่อมบำรุง').department.code, 'A');
  assert.equal(matchDepartment(clashing, 'ฝ่ายซ่อมบำรุง').department.code, 'B');
});

test('two departments sharing a real name are ambiguous under that name too', () => {
  const clashing = buildDepartmentIndex([
    { _id: '1', code: 'A', name: 'Service', nameTh: 'แผนกบริการ' },
    { _id: '2', code: 'B', name: 'Service', nameTh: 'แผนกบริการลูกค้า' },
  ]);
  assert.equal(matchDepartment(clashing, 'Service').reason, 'ambiguous');
  assert.equal(matchDepartment(clashing, 'แผนกบริการลูกค้า').department.code, 'B');
});

test('blank and unknown are different answers', () => {
  assert.equal(hit('').reason, 'empty');
  assert.equal(hit('   ').reason, 'empty');
  assert.equal(hit(null).reason, 'empty');
  assert.equal(hit('แผนกที่ไม่มีจริง').reason, 'unknown');
  assert.equal(hit('แผนกIT +  ผลิต2').reason, 'unknown');
});

/**
 * A cell naming two departments is not a department. The roster has two of
 * them — a ผู้จัดการแผนก over IT and ผลิต2, another over ผลิต1 and ผลิต3 — and
 * an employee row holds ONE แผนก, so the second is ticked at
 * `approvesDepartments` afterwards rather than guessed at here.
 */
test('a cell naming two departments fails its own row rather than picking one', () => {
  assert.equal(hit('แผนกผลิต1+ผลิต3').department, null);
  assert.equal(hit('แผนกIT + ผลิต2').department, null);
});

test('every refusal tells HR what to do next', () => {
  assert.match(departmentMatchError('empty', ''), /ต้องระบุแผนก/);
  assert.match(departmentMatchError('ambiguous', 'ซ่อมบำรุง'), /รหัสแผนก/);
  assert.match(departmentMatchError('unknown', 'อะไรสักอย่าง'), /ชื่อไทย/);
  // The cell is quoted back, so the row can be found in a file of 163.
  assert.match(departmentMatchError('unknown', 'อะไรสักอย่าง'), /อะไรสักอย่าง/);
});

test('the pieces are exported for anybody who has to reproduce the rule', () => {
  assert.equal(normalizeDeptKey('  แผนก IT '), 'แผนกit');
  assert.equal(stripUnitWord('แผนกผลิต1'), 'ผลิต1');
  assert.equal(stripUnitWord('สาขาชลบุรี'), 'ชลบุรี');
  // A name that is nothing BUT the unit word keeps it — stripping would leave
  // an empty key that every blank cell would then match.
  assert.equal(stripUnitWord('แผนก'), 'แผนก');
});

/**
 * The other half of the same failure, pinned at the source because the route it
 * lives in needs a database to run. `roleFromLabel` had existed with full tests
 * since the Thai labels did; nothing called it, and the import tested the cell
 * against `ROLES` directly — so 162 of the roster's 163 rows failed on บทบาท as
 * well as on แผนก.
 */
test('the import reads บทบาท through roleFromLabel, not ROLES', () => {
  const source = readFileSync(join(ROOT, 'app/api/employees/import/route.js'), 'utf8');
  assert.match(source, /roleFromLabel\(/, 'the import must translate the Thai label');
  assert.doesNotMatch(
    source,
    /ROLES\.includes\(/,
    'a direct ROLES.includes on the cell is what refused the whole roster',
  );
  assert.match(source, /matchDepartment\(/, 'the import must match แผนก by name as well as code');
});

test('every บทบาท the real roster spells reaches a role', () => {
  for (const [label, role] of [
    ['พนักงาน', 'employee'],
    ['หัวหน้างาน', 'supervisor'],
    ['ผู้จัดการแผนก', 'dept_manager'],
    ['ผู้จัดการฝ่าย', 'division_manager'],
    ['การเงิน', 'finance'],
    ['HR', 'hr'],
  ]) {
    assert.equal(roleFromLabel(label), role, `${label} must import as ${role}`);
  }
});

/**
 * The template is the file HR fills in, so its own rows have to survive the
 * importer. They did not: it demonstrated `ENG` and `PROD`, and neither is a
 * department on this roster.
 */
test('the download template names departments that exist', () => {
  const source = readFileSync(join(ROOT, 'app/api/employees/import/template/route.js'), 'utf8');
  const sampleRows = source.match(/\['(?:PM|THT)[^\]]*\]/g) ?? [];
  assert.equal(sampleRows.length, 2, 'the template still demonstrates two rows');
  for (const row of sampleRows) {
    assert.doesNotMatch(row, /'ENG'|'PROD'/, 'ENG and PROD are not departments on this roster');
  }
});
