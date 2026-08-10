import test from 'node:test';
import assert from 'node:assert/strict';

import { rosterPermission, HR_ASSIGNABLE_ROLES } from '../lib/employees.js';

const EMPLOYEE = { _id: 'emp-1', role: 'employee' };
const MANAGER = { _id: 'mgr-1', role: 'manager' };
const HR = { _id: 'hr-1', role: 'hr' };
const ADMIN = { _id: 'adm-1', role: 'admin' };

test('ฝ่ายบุคคล may create the roster rows they are there to create', () => {
  for (const role of HR_ASSIGNABLE_ROLES) {
    assert.deepEqual(rosterPermission(HR, { role }), { ok: true }, role);
  }
});

test('ฝ่ายบุคคล may not mint an account that administers the system', () => {
  const may = rosterPermission(HR, { role: 'admin' });
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
  assert.match(may.error, /ผู้ดูแลระบบ/);
});

test('nor another ฝ่ายบุคคล — a second HR account is Admin’s to hand out', () => {
  assert.equal(rosterPermission(HR, { role: 'hr' }).ok, false);
});

test('ฝ่ายบุคคล may not touch the Admin row at all, with no role change asked for', () => {
  // The escalation this closes: editing a row includes setting its password, so
  // HR editing the Admin account is HR being able to log in as Admin.
  const may = rosterPermission(HR, { target: { role: 'admin' } });
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
});

test('ฝ่ายบุคคล may reset an ordinary account’s password', () => {
  assert.deepEqual(rosterPermission(HR, { target: { role: 'employee' } }), { ok: true });
  assert.deepEqual(rosterPermission(HR, { target: { role: 'manager' } }), { ok: true });
});

test('ฝ่ายบุคคล may not promote an existing employee to Admin either', () => {
  assert.equal(rosterPermission(HR, { target: { role: 'employee' }, role: 'admin' }).ok, false);
});

test('Admin is held to none of it — the roster is theirs as it always was', () => {
  assert.deepEqual(rosterPermission(ADMIN, { role: 'admin' }), { ok: true });
  assert.deepEqual(rosterPermission(ADMIN, { target: { role: 'admin' }, role: 'employee' }), { ok: true });
});

test('nobody else writes the roster, whatever they are asking for', () => {
  for (const actor of [EMPLOYEE, MANAGER]) {
    const may = rosterPermission(actor, { role: 'employee' });
    assert.equal(may.ok, false, actor.role);
    assert.equal(may.status, 403);
  }
});

test('no session is 401, not 403 — there is nobody to refuse yet', () => {
  assert.equal(rosterPermission(null).status, 401);
});

test('an omitted role is not a role of null — creating without one is allowed', () => {
  // The CSV import calls this with whatever the file said; the create form
  // defaults to employee. Neither should be read as "asking for a role".
  assert.deepEqual(rosterPermission(HR), { ok: true });
  assert.deepEqual(rosterPermission(HR, { target: null, role: null }), { ok: true });
});
