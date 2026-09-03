import test from 'node:test';
import assert from 'node:assert/strict';

import { editPermission } from '../lib/entries.js';

const OWNER = { _id: 'emp-1', role: 'employee' };
const OTHER = { _id: 'emp-2', role: 'employee' };
const MANAGER = { _id: 'mgr-1', role: 'supervisor' };
const HR = { _id: 'hr-1', role: 'hr' };
const ADMIN = { _id: 'adm-1', role: 'admin' };

/**
 * As the route sees it: `employee` populated to a document.
 *
 * `pending_hr` is the one status that needs saying which kind it is. An entry
 * normally reaches it by a manager approving, and carries their decision; one a
 * หัวหน้า filed on somebody's behalf starts there with nobody having approved
 * anything at all. The employee's rights differ between the two, so the fixture
 * makes the decision explicit rather than letting a missing field decide by
 * accident.
 */
const APPROVED_BY_MGR = { by: 'mgr-1', at: new Date('2026-08-03T10:00:00Z') };
const entry = (status, over = {}) => ({
  status,
  employee: { _id: 'emp-1' },
  ...(status === 'pending_hr' || status === 'approved'
    ? { managerDecision: APPROVED_BY_MGR }
    : {}),
  ...over,
});

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

/**
 * The one case where `pending_hr` and "somebody has approved this" come apart.
 *
 * A request a หัวหน้า filed for one of their team skips the step they would
 * have signed themselves and is created at `pending_hr` — with no
 * managerDecision on it, because nobody decided anything. The rule the old
 * spelling stood for is "until the first signature", and there has not been
 * one, so the employee still owns their own request. Reading the status
 * literally would have locked them out of it from the moment it existed.
 */
test('a request filed for the employee that skipped the manager is still theirs', () => {
  const skipped = { status: 'pending_hr', employee: { _id: 'emp-1' }, filedBy: { _id: 'mgr-1' } };
  assert.deepEqual(editPermission(OWNER, skipped), { ok: true, action: 'edit' });
});

test('but once a manager has actually signed, pending_hr is closed to them again', () => {
  const signed = {
    status: 'pending_hr',
    employee: { _id: 'emp-1' },
    filedBy: { _id: 'mgr-1' },
    managerDecision: APPROVED_BY_MGR,
  };
  const may = editPermission(OWNER, signed);
  assert.equal(may.ok, false);
  assert.equal(may.status, 409);
});

/**
 * Widening this rule must not have widened it for anybody else. A colleague
 * looking at a skipped request is exactly as far out as they always were.
 */
test('the skip opens the door for the owner only', () => {
  const skipped = { status: 'pending_hr', employee: { _id: 'emp-1' }, filedBy: { _id: 'mgr-1' } };
  assert.equal(editPermission(OTHER, skipped).status, 403);
  assert.equal(editPermission(MANAGER, skipped).status, 403);
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
