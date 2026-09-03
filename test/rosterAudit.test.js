import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDITED_FIELDS, ACCOUNTING_SENSITIVE, auditValue, rosterChanges,
  touchesAccounting, worthRecording,
} from '../lib/rosterAudit.js';
import { codeChangePermission, rosterPermission, HR_ASSIGNABLE_ROLES } from '../lib/employees.js';

const HR = { _id: 'hr-1', name: 'สมหญิง', role: 'hr' };
const ADMIN = { _id: 'adm-1', name: 'ผู้ดูแล', role: 'admin' };
const MANAGER = { _id: 'mgr-1', role: 'supervisor' };
const EMPLOYEE = { _id: 'emp-1', role: 'employee' };

const ROW = {
  code: 'PM-0412',
  name: 'สมชาย ใจดี',
  email: 'somchai@primus.co.th',
  position: 'ช่างเทคนิค',
  birthDate: '1998-03-05',
  department: 'dept-eng',
  role: 'employee',
  company: 'primus',
  active: true,
};

// ── what the trail records ──────────────────────────────────────────────────

test('a field that moved produces one row, as strings on both sides', () => {
  const changes = rosterChanges(ROW, { ...ROW, position: 'หัวหน้าช่าง' });
  assert.deepEqual(changes, [{ field: 'position', from: 'ช่างเทคนิค', to: 'หัวหน้าช่าง' }]);
});

test('every audited field can produce a row — none is silently unrecordable', () => {
  // The point of the allowlist is that it is complete for what the screen can
  // edit. A field added to AUDITED_FIELDS but never diffable would be a field
  // the trail claims to cover and does not.
  for (const field of AUDITED_FIELDS) {
    const changes = rosterChanges(ROW, { ...ROW, [field]: 'CHANGED' });
    assert.equal(changes.length, 1, field);
    assert.equal(changes[0].field, field);
  }
});

test('a field the request never mentioned is not a change to null', () => {
  // The PATCH route sends what it is about to write. A roster edit that only
  // touched the name must not file rows saying every other field was cleared.
  assert.deepEqual(rosterChanges(ROW, { name: 'สมชาย ใจงาม' }), [
    { field: 'name', from: 'สมชาย ใจดี', to: 'สมชาย ใจงาม' },
  ]);
});

test('saving a row unchanged records nothing at all', () => {
  assert.deepEqual(rosterChanges(ROW, { ...ROW }), []);
  assert.equal(worthRecording({ changes: [] }), false);
});

test('a password reset with no field changes is still worth a record', () => {
  assert.equal(worthRecording({ changes: [], passwordReset: true }), true);
});

test('an id and a populated document are the same value to the trail', () => {
  // `employee.department` is an id before a save and a document after a
  // populate(). A trail that read those as different would file a change of
  // department every time anything else on the row was edited.
  assert.equal(auditValue('dept-eng'), auditValue({ _id: 'dept-eng', name: 'Engineering' }));
  assert.deepEqual(
    rosterChanges({ department: 'dept-eng' }, { department: { _id: 'dept-eng' } }),
    [],
  );
});

test('clearing a value records null, not the empty string', () => {
  assert.deepEqual(rosterChanges(ROW, { ...ROW, birthDate: '' }), [
    { field: 'birthDate', from: '1998-03-05', to: null },
  ]);
});

test('active is recorded as a value, so switching it off is a readable row', () => {
  assert.deepEqual(rosterChanges(ROW, { ...ROW, active: false }), [
    { field: 'active', from: 'true', to: 'false' },
  ]);
});

// ── the password, which is the rule this file exists for ────────────────────

/**
 * The whole guarantee, stated as a test rather than as a comment.
 *
 * `AUDITED_FIELDS` is an allowlist. Anything not on it cannot reach the trail
 * however it is passed in, which is what makes "the password is never recorded"
 * a property of the code rather than of everybody remembering. A denylist would
 * have to be updated every time the Employee schema gained a secret.
 */
test('no password-shaped field can reach the trail, whatever it is called', () => {
  const leaky = {
    ...ROW,
    password: 'Primus@PM0412',
    passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
    newPassword: 'hunter2',
    plainPassword: 'hunter2',
    mustChangePassword: true,
  };
  const changes = rosterChanges(ROW, leaky);
  assert.deepEqual(changes, [], 'nothing outside the allowlist may produce a row');

  const serialised = JSON.stringify(rosterChanges({}, leaky));
  for (const secret of ['Primus@PM0412', 'hunter2', '$2a$10$']) {
    assert.equal(serialised.includes(secret), false, secret);
  }
});

test('the allowlist itself holds no password field', () => {
  for (const field of AUDITED_FIELDS) {
    assert.equal(/pass/i.test(field), false, field);
  }
});

// ── which changes the screen has to warn about ──────────────────────────────

test('the three accounting-facing fields are flagged and nothing else is', () => {
  assert.deepEqual([...ACCOUNTING_SENSITIVE].sort(), ['company', 'department', 'role']);
  for (const field of ACCOUNTING_SENSITIVE) {
    assert.equal(touchesAccounting(rosterChanges(ROW, { ...ROW, [field]: 'X' })), true, field);
  }
  for (const field of ['name', 'position', 'email', 'birthDate', 'code', 'active']) {
    assert.equal(touchesAccounting(rosterChanges(ROW, { ...ROW, [field]: 'X' })), false, field);
  }
});

// ── รหัสพนักงาน: admin only, and never without a reason ─────────────────────

test('ฝ่ายบุคคล may not change the รหัสพนักงาน of an existing row', () => {
  const may = codeChangePermission(HR, { from: 'PM-0412', to: 'PM-0641', reason: 'ออกรหัสผิด' });
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
});

test('neither may a หัวหน้า or a พนักงาน, whatever reason they give', () => {
  for (const actor of [MANAGER, EMPLOYEE]) {
    const may = codeChangePermission(actor, { from: 'PM-0412', to: 'PM-0641', reason: 'x' });
    assert.equal(may.ok, false, actor.role);
    assert.equal(may.status, 403, actor.role);
  }
});

test('Admin may — but not silently', () => {
  const noReason = codeChangePermission(ADMIN, { from: 'PM-0412', to: 'PM-0641' });
  assert.equal(noReason.ok, false);
  assert.equal(noReason.status, 400);
  assert.match(noReason.error, /เหตุผล/);

  const blank = codeChangePermission(ADMIN, { from: 'PM-0412', to: 'PM-0641', reason: '   ' });
  assert.equal(blank.ok, false, 'whitespace is not a reason');

  assert.deepEqual(
    codeChangePermission(ADMIN, { from: 'PM-0412', to: 'PM-0641', reason: 'ออกรหัสผิดตอนรับเข้า' }),
    { ok: true, changed: true },
  );
});

/**
 * The case that lets HR use the same edit form Admin uses.
 *
 * The roster table sends the row it is editing. If a payload merely REPEATING
 * the stored code counted as a change, every HR edit of a name or a position
 * would be refused 403 — and the fix somebody would reach for is HR sending a
 * narrower payload, which is a rule enforced by what the client happens to omit.
 */
test('a payload repeating the code it already has is not a change', () => {
  for (const actor of [HR, ADMIN, MANAGER]) {
    assert.deepEqual(
      codeChangePermission(actor, { from: 'PM-0412', to: 'PM-0412' }),
      { ok: true, changed: false },
      actor.role,
    );
  }
});

test('an omitted or blank code is not a request to clear it', () => {
  assert.deepEqual(codeChangePermission(HR, { from: 'PM-0412' }), { ok: true, changed: false });
  assert.deepEqual(codeChangePermission(HR, { from: 'PM-0412', to: '' }), { ok: true, changed: false });
  assert.deepEqual(codeChangePermission(HR, {}), { ok: true, changed: false });
});

/**
 * Punctuation is a change even though `sameCode` reads the two as one person.
 *
 * Normalisation in this codebase is compare-time only and never rewrites what is
 * stored (src/lib/employeeCode.js). PM-0620 → PM0620 changes the string somebody
 * types to log in and the string printed on payroll's sheets, so it is exactly
 * the kind of edit that needs a reason attached.
 */
test('re-punctuating a code is still a change of the code', () => {
  assert.equal(codeChangePermission(ADMIN, { from: 'PM-0620', to: 'PM0620' }).ok, false);
  assert.equal(
    codeChangePermission(ADMIN, { from: 'PM-0620', to: 'PM0620', reason: 'ให้ตรงกับบัญชี' }).changed,
    true,
  );
});

test('no session is 401 here too — there is nobody to refuse yet', () => {
  assert.equal(codeChangePermission(null, { from: 'A', to: 'B', reason: 'x' }).status, 401);
});

// ── the roster rules the new screen must not have widened ───────────────────

test('HR reaching the roster screen did not widen who may be made an Admin', () => {
  assert.equal(rosterPermission(HR, { role: 'admin' }).ok, false);
  assert.equal(rosterPermission(HR, { target: { role: 'employee' }, role: 'admin' }).ok, false);
  assert.deepEqual(HR_ASSIGNABLE_ROLES,
    ['employee', 'supervisor', 'finance', 'dept_manager', 'division_manager']);
});

test('nor did it let a หัวหน้า or a พนักงาน near the roster at all', () => {
  for (const actor of [MANAGER, EMPLOYEE]) {
    assert.equal(rosterPermission(actor, { role: 'employee' }).status, 403, actor.role);
    assert.equal(rosterPermission(actor, { target: { role: 'employee' } }).status, 403, actor.role);
  }
});

test('HR may edit every field the screen offers on an ordinary row', () => {
  // The permission is per-row, not per-field: what HR may not do is set the
  // admin role (above) and change a รหัสพนักงาน (above that). Everything the
  // table edits goes through this one check.
  for (const role of ['employee', 'supervisor']) {
    assert.deepEqual(rosterPermission(HR, { target: { role } }), { ok: true }, role);
  }
});
