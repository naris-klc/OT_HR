import test from 'node:test';
import assert from 'node:assert/strict';

import { editPermission } from '../lib/entries.js';

const OWNER = { _id: 'emp-1', role: 'employee' };
const OTHER = { _id: 'emp-2', role: 'employee' };
const MANAGER = { _id: 'mgr-1', role: 'manager' };
const HR = { _id: 'hr-1', role: 'hr' };
const ADMIN = { _id: 'adm-1', role: 'admin' };

/** As the route sees it: `employee` populated to a document. */
const entry = (status) => ({ status, employee: { _id: 'emp-1' } });

test('the employee may correct their own request while it waits for the manager', () => {
  const may = editPermission(OWNER, entry('pending_mgr'));
  assert.deepEqual(may, { ok: true, action: 'edit' });
});

test('no reason is asked of the employee — there is no decision to explain yet', () => {
  assert.equal(editPermission(OWNER, entry('pending_mgr'), '').ok, true);
});

test('the first approval ends it: the employee is out from pending_hr onwards', () => {
  for (const status of ['pending_hr', 'approved']) {
    const may = editPermission(OWNER, entry(status));
    assert.equal(may.ok, false, status);
    assert.equal(may.status, 409);
    assert.match(may.error, /ฝ่ายบุคคล/);
  }
});

test('rejected and cancelled are closed to the employee, who re-files instead', () => {
  for (const status of ['rejected', 'cancelled']) {
    const may = editPermission(OWNER, entry(status));
    assert.equal(may.ok, false, status);
    assert.equal(may.status, 409);
    assert.match(may.error, /ส่งใหม่/);
  }
});

test('someone else’s pending request is not editable', () => {
  const may = editPermission(OTHER, entry('pending_mgr'));
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
});

test('a manager decides, and does not rewrite', () => {
  assert.equal(editPermission(MANAGER, entry('pending_mgr')).status, 403);
});

test('HR and Admin may correct any live entry, with a reason', () => {
  for (const actor of [HR, ADMIN]) {
    for (const status of ['pending_mgr', 'pending_hr', 'approved']) {
      assert.deepEqual(
        editPermission(actor, entry(status), 'เวลาเลิกงานผิด'),
        { ok: true, action: 'hr_edit' },
        `${actor.role}/${status}`,
      );
    }
  }
});

test('HR without a reason is refused, and blank space is not a reason', () => {
  assert.equal(editPermission(HR, entry('approved')).status, 400);
  assert.equal(editPermission(HR, entry('approved'), '   ').status, 400);
});

test('rejected and cancelled are closed to HR too', () => {
  for (const status of ['rejected', 'cancelled']) {
    const may = editPermission(HR, entry(status), 'เหตุผล');
    assert.equal(may.ok, false, status);
    assert.equal(may.status, 409);
  }
});

test('an unpopulated employee id resolves the same as a populated document', () => {
  assert.equal(editPermission(OWNER, { status: 'pending_mgr', employee: 'emp-1' }).ok, true);
  assert.equal(editPermission(OWNER, { status: 'pending_mgr', employee: 'emp-9' }).ok, false);
});
