import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DECIDE_POPULATE, POPULATE, isDepartmentManager, maySignFirstStep, maySignRoleOf,
  signsPersonallyFor, hasPersonalApprovers, withPersonal,
} from '../lib/entries.js';
import { approvalPermission, nobodyCanSign } from '../lib/delegation.js';
import { initialStatus, proxyPermission } from '../lib/proxyFiling.js';
import { personalScope, unsignedStaff, HR_ASSIGNABLE_ROLES } from '../lib/employees.js';
import {
  ROLE_LABEL_TH, filesStraightToHr, mayApproveRole, readsOwnTeamOnly, roleFromLabel,
} from '../lib/roles.js';
import { AUDITED_FIELDS, FIELD_LABEL } from '../lib/rosterAudit.js';

/**
 * ผู้อนุมัติรายคน — `Employee.personalApprovers`, asked for on 2026-10-09.
 *
 * The CEO (กรรมการผู้จัดการ, a บทบาท of its own from the same day) holds HR
 * and จัดซื้อ as แผนก, and is named one by one for seven ผู้จัดการ in other
 * แผนก and both companies. HR's answers, which these cases pin:
 *
 *   · a name REPLACES the แผนก for that person — the แผนก's signers no longer
 *     see or sign the request (answer 6: ตามแนะนำ);
 *   · it puts a first step back on a request that had none — ผู้จัดการฝ่าย and
 *     การเงิน file straight to ฝ่ายบุคคล by บทบาท;
 *   · the CEO reads only what they sign (answer 3), and files nothing (4).
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (file) => readFileSync(join(ROOT, file), 'utf8');

const EXEC = '0000000000000000000000e1';
const HR_DEPT = '0000000000000000000000e2';
const SALES = '0000000000000000000000e3';

const CEO = {
  _id: 'ceo', code: 'S001', role: 'managing_director', department: EXEC,
  approvesDepartments: [HR_DEPT], approvesCompany: null, company: 'primus', active: true,
};
const SALES_DIV = {
  _id: 'div', code: 'THT0054', role: 'division_manager', department: SALES,
  company: 'themtech', personalApprovers: ['ceo'], active: true,
};
const SALES_HEAD = {
  _id: 'head', code: 'THT0099', role: 'dept_manager', department: SALES,
  company: 'themtech', active: true,
};
const SALES_STAFF = {
  _id: 'staff', code: 'THT0100', role: 'employee', department: SALES,
  company: 'themtech', personalApprovers: ['ceo'], active: true,
};
const SALES_SUP = {
  _id: 'sup', code: 'THT0101', role: 'supervisor', department: SALES,
  company: 'themtech', active: true,
};

const pending = (employee) => ({
  _id: `e-${employee._id}`,
  employee,
  department: { _id: employee.department },
  status: 'pending_mgr',
  totals: { otHours: 2 },
});

// ── the บทบาท ────────────────────────────────────────────────────────────────

test('กรรมการผู้จัดการ signs below ผู้จัดการฝ่าย by บทบาท, and files straight to HR', () => {
  assert.equal(ROLE_LABEL_TH.managing_director, 'กรรมการผู้จัดการ');
  assert.equal(roleFromLabel('กรรมการผู้จัดการ'), 'managing_director');
  for (const r of ['employee', 'supervisor', 'dept_manager']) {
    assert.equal(mayApproveRole('managing_director', r), true, r);
  }
  // ผู้จัดการฝ่าย and การเงิน keep their straight-to-HR row; only a name moves them.
  assert.equal(mayApproveRole('managing_director', 'division_manager'), false);
  assert.equal(mayApproveRole('managing_director', 'finance'), false);
  assert.equal(filesStraightToHr('managing_director'), true);
  // เห็นเฉพาะที่เซ็นให้ — a team reader, not a company one.
  assert.equal(readsOwnTeamOnly('managing_director'), true);
  assert.ok(HR_ASSIGNABLE_ROLES.includes('managing_director'));
});

// ── who may sign ─────────────────────────────────────────────────────────────

test('a name replaces the แผนก: the named signer may, the แผนก signer may not', () => {
  assert.equal(isDepartmentManager(CEO, SALES, 'themtech', SALES_STAFF), true);
  assert.equal(isDepartmentManager(SALES_HEAD, SALES, 'themtech', SALES_STAFF), false);
  // Nobody named → the ordinary แผนก answer, CEO included.
  assert.equal(isDepartmentManager(SALES_HEAD, SALES, 'themtech', SALES_SUP), true);
  assert.equal(isDepartmentManager(CEO, SALES, 'themtech', SALES_SUP), false);
  // Asked about the แผนก as a whole, the answer is still the แผนก's.
  assert.equal(isDepartmentManager(SALES_HEAD, SALES, 'themtech'), true);
});

test('the name skips the ladder — the CEO signs a ผู้จัดการฝ่าย although no บทบาท does', () => {
  assert.equal(maySignRoleOf(CEO, SALES_DIV), true);
  assert.equal(maySignFirstStep(CEO, pending(SALES_DIV)), true);
  const ok = approvalPermission({ user: CEO, entry: pending(SALES_DIV), delegations: [], today: '2026-10-09' });
  assert.equal(ok.ok, true);
  assert.equal(ok.stage, 'mgr');
  const refused = approvalPermission({
    user: SALES_HEAD, entry: pending(SALES_STAFF), delegations: [], today: '2026-10-09',
  });
  assert.equal(refused.ok, false);
});

test('only a signer can be named, and never for themselves', () => {
  assert.equal(signsPersonallyFor({ ...CEO, role: 'employee' }, SALES_DIV), false);
  assert.equal(signsPersonallyFor(CEO, { ...CEO, personalApprovers: ['ceo'] }), false);
  assert.equal(hasPersonalApprovers({ personalApprovers: [] }), false);
  // A row populated without the field reads as the ordinary rule.
  assert.equal(hasPersonalApprovers({ role: 'employee' }), false);
});

test('a stand-in for the named signer signs in their name', () => {
  const STAND_IN = { _id: 'si', role: 'dept_manager', department: EXEC, active: true };
  const delegation = {
    _id: 'd1', from: CEO, to: STAND_IN, fromDate: '2026-10-01', toDate: '2026-10-31', revokedAt: null,
  };
  const may = approvalPermission({
    user: STAND_IN, entry: pending(SALES_DIV), delegations: [delegation], today: '2026-10-09',
  });
  assert.equal(may.ok, true);
  assert.equal(may.onBehalfOf, CEO);
});

test('nobodyCanSign reads the name too', () => {
  assert.equal(nobodyCanSign(pending(SALES_STAFF), [SALES_HEAD], 'themtech'), true);
  assert.equal(nobodyCanSign(pending(SALES_STAFF), [SALES_HEAD, CEO], 'themtech'), false);
});

// ── where a new request starts ───────────────────────────────────────────────

test('a name puts a first step back on a request that had none', () => {
  const dept = { _id: SALES };
  assert.equal(initialStatus({ filer: SALES_DIV, employee: SALES_DIV, department: dept, signers: [CEO] }).status,
    'pending_mgr');
  // Without the name, ผู้จัดการฝ่าย go straight to ฝ่ายบุคคล as always.
  const plain = { ...SALES_DIV, personalApprovers: [] };
  assert.equal(initialStatus({ filer: plain, employee: plain, department: dept, signers: [CEO] }).status,
    'pending_hr');
  // A แผนก ฝ่ายบุคคล heads still has a first step for a named person.
  const hrHeaded = { _id: SALES, signedByHr: true };
  assert.equal(initialStatus({
    filer: SALES_STAFF, employee: SALES_STAFF, department: hrHeaded, signers: [CEO],
  }).status, 'pending_mgr');
  // Named, but the named signer is not on the roster today → ฝ่ายบุคคล.
  assert.equal(initialStatus({
    filer: SALES_STAFF, employee: SALES_STAFF, department: dept, signers: [SALES_HEAD],
  }).status, 'pending_hr');
});

test('filing on somebody’s behalf follows the same name', () => {
  assert.equal(proxyPermission(CEO, SALES_STAFF).ok, true);
  assert.equal(proxyPermission(SALES_HEAD, SALES_STAFF).ok, false);
});

test('a named พนักงาน with their signer gone is stranded, as one without a แผนก signer is', () => {
  const roster = [SALES_STAFF, SALES_HEAD];
  assert.equal(unsignedStaff(roster, SALES, [SALES_HEAD, CEO]).length, 0);
  assert.deepEqual(unsignedStaff(roster, SALES, [SALES_HEAD]).map((p) => p._id), ['staff']);
});

// ── the queue ────────────────────────────────────────────────────────────────

test('withPersonal: the แผนก filter loses other people’s named, and gains the reader’s', () => {
  const dept = { department: SALES };
  assert.equal(withPersonal(dept, [], []), dept);
  assert.deepEqual(withPersonal(dept, ['staff'], []),
    { $and: [dept, { employee: { $nin: ['staff'] } }] });
  assert.deepEqual(withPersonal(dept, ['staff'], ['staff']),
    { $or: [dept, { employee: { $in: ['staff'] } }] });
  assert.deepEqual(withPersonal(null, ['staff'], ['staff']), { employee: { $in: ['staff'] } });
  assert.equal(withPersonal(null, ['staff'], []), null);
});

test('every populate that feeds a permission carries the field', () => {
  const sel = (list) => list.find((p) => p?.path === 'employee')?.select || '';
  assert.match(sel(DECIDE_POPULATE), /\bpersonalApprovers\b/);
  assert.match(sel(POPULATE), /\bpersonalApprovers\b/);
});

test('the scope, the badge and the reading clause all apply it', () => {
  const q = src('lib/delegationQuery.js');
  assert.match(q, /withPersonal\(filter, reach\.named, mine\)/);
  assert.match(q, /\.\.\.mine, user\._id\]/);
  const badge = src('app/api/entries/queue-summary/route.js');
  assert.match(badge, /personal\.named/);
  assert.match(badge, /personal\.own/);
});

// ── the roster ───────────────────────────────────────────────────────────────

test('personalScope refuses what has no first step to hold', () => {
  const found = [
    { _id: 'div', code: 'THT0054', name: 'ก', role: 'division_manager', active: true },
    { _id: 'hr1', code: 'HR01', name: 'ข', role: 'hr', active: true },
    { _id: 'gone', code: 'X1', name: 'ค', role: 'employee', active: false },
  ];
  assert.deepEqual(personalScope(['div', 'div'], { approver: CEO, found }), { ok: true, value: ['div'] });
  assert.equal(personalScope(['hr1'], { approver: CEO, found }).ok, false);
  assert.equal(personalScope(['gone'], { approver: CEO, found }).ok, false);
  assert.equal(personalScope(['nobody'], { approver: CEO, found }).ok, false);
  assert.equal(personalScope(['ceo'], { approver: CEO, found: [{ ...CEO }] }).ok, false);
  // Somebody who is not (or no longer) a signer holds no list.
  assert.equal(personalScope(['div'], { approver: { ...CEO, role: 'employee' }, found }).ok, false);
  assert.equal(personalScope(['div'], { approver: { ...CEO, active: false }, found }).ok, false);
  // Clearing the list is always allowed.
  assert.deepEqual(personalScope([], { approver: { ...CEO, active: false }, found }), { ok: true, value: [] });
  assert.deepEqual(personalScope(undefined, { approver: CEO }), { ok: true, value: undefined });
});

test('the list is audited as a field of the signer’s row', () => {
  assert.ok(AUDITED_FIELDS.includes('approvesEmployees'));
  assert.equal(FIELD_LABEL.approvesEmployees, 'อนุมัติรายคน');
  const route = src('app/api/employees/[id]/route.js');
  // A signer who stops being one is taken off every list.
  assert.match(route, /if \(!stillSigns\) named = \[\];/);
  assert.match(route, /\$pull: \{ personalApprovers: employee\._id \}/);
  assert.match(route, /\$addToSet: \{ personalApprovers: employee\._id \}/);
  const imp = src('app/api/employees/import/route.js');
  assert.match(imp, /if \(!isSigner\(existing\.role\)\) \{/);
});
