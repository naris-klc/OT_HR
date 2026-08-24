import test from 'node:test';
import assert from 'node:assert/strict';

import { DEPARTMENT_ROLES, departmentPermission } from '../lib/departments.js';

/**
 * WHO MAY WRITE แผนก — the rule, held still.
 *
 * The counterpart to test/rosterPermission.test.js and split from
 * test/permissionRouteGuards.test.js for the same reason that file states: this
 * pins what the rule SAYS, that one pins that the handlers actually ask it.
 * Both halves are needed — a perfect rule nobody invokes refuses nothing, and a
 * handler that faithfully calls a wrong rule is worse than one that calls none.
 *
 * The interesting case is not "may HR press this button". It is `active`, which
 * is the only removal this system has and is the one field on the row that is
 * not ฝ่ายบุคคล's — in EITHER direction, and without breaking the ordinary edit
 * that happens to carry the field at its current value.
 *
 * Run with: npm test
 */

const hr = { _id: 'a', role: 'hr' };
const admin = { _id: 'b', role: 'admin' };
const manager = { _id: 'c', role: 'manager' };
const employee = { _id: 'd', role: 'employee' };

// ── who is on this screen at all ────────────────────────────────────────────

test('ฝ่ายบุคคล and ผู้ดูแลระบบ, and nobody else', () => {
  assert.deepEqual(DEPARTMENT_ROLES, ['hr', 'admin']);
});

test('an unauthenticated caller is 401, not 403', () => {
  const r = departmentPermission(null);
  assert.equal(r.ok, false);
  // The distinction the whole app draws: 401 is "log in", 403 is "you did and
  // it is still not yours". A 403 here would send somebody looking for a
  // permission they were never missing.
  assert.equal(r.status, 401);
});

test('a หัวหน้า and an ordinary employee are refused outright', () => {
  for (const actor of [manager, employee]) {
    const r = departmentPermission(actor);
    assert.equal(r.ok, false, `${actor.role} may write a department`);
    assert.equal(r.status, 403);
  }
});

test('a role nobody has heard of is refused rather than defaulted', () => {
  const r = departmentPermission({ _id: 'e', role: 'accountant' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

// ── creating: ฝ่ายบุคคล may, which is the change ────────────────────────────

test('ฝ่ายบุคคล may create a department', () => {
  // The whole of §2a. `POST` does not accept `active`, so a create asks this
  // with nothing but the actor — and the answer has to be yes.
  assert.equal(departmentPermission(hr).ok, true);
});

test('ผู้ดูแลระบบ may create one too — this widened, it did not move', () => {
  assert.equal(departmentPermission(admin).ok, true);
});

// ── editing the ordinary fields ─────────────────────────────────────────────

test('ฝ่ายบุคคล may edit a row that does not mention active', () => {
  // ชื่อ, รหัส, เพดาน, หัวหน้า, รูปแบบโอที — a PATCH carrying any of them and
  // not `active` never reaches the one rule this file is about.
  assert.equal(departmentPermission(hr, { current: true }).ok, true);
  assert.equal(departmentPermission(hr, { active: undefined, current: true }).ok, true);
  assert.equal(departmentPermission(hr, { active: null, current: true }).ok, true);
});

test('a payload repeating the value it already has is not a change', () => {
  /**
   * THE ONE THAT WOULD HAVE BROKEN EVERY EDIT. The dialog and the row's cap
   * boxes send fields back; anything sending the whole row would carry `active`
   * at its current value, and a rule reading "the field is present" rather than
   * "the value is moving" would refuse ฝ่ายบุคคล every save on every
   * department.
   *
   * Same courtesy `selfEditPermission` and `codeChangePermission` extend, and
   * checked here for the same reason it is checked there.
   */
  assert.equal(departmentPermission(hr, { active: true, current: true }).ok, true);
  assert.equal(departmentPermission(hr, { active: false, current: false }).ok, true);
});

test('a stored row with no active field at all reads as active', () => {
  // `active` has a schema default of true, and a row written before the field
  // existed carries nothing. Asking to set it true must be "no change", not a
  // refusal aimed at ฝ่ายบุคคล for a value they are not moving.
  assert.equal(departmentPermission(hr, { active: true, current: undefined }).ok, true);
  assert.equal(departmentPermission(hr, { active: true, current: null }).ok, true);
});

test('truthiness is normalised on both sides, so 1 and true are one answer', () => {
  assert.equal(departmentPermission(hr, { active: 1, current: true }).ok, true);
  assert.equal(departmentPermission(hr, { active: 0, current: false }).ok, true);
});

// ── the field that is not HR's, in both directions ──────────────────────────

test('ฝ่ายบุคคล may not close a department', () => {
  const r = departmentPermission(hr, { active: false, current: true });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  // The message has to name the consequence, not only the role: somebody
  // reaching for this switch is reaching for "delete this department".
  assert.match(r.error, /ผู้ดูแลระบบ/);
  assert.match(r.error, /ยื่น OT ไม่ได้/);
});

test('…and may not reopen one either — the trap this closes', () => {
  /**
   * A one-way control is not a safeguard. If ฝ่ายบุคคล could switch a
   * department off and not back on, the refusal would arrive one step too late
   * to help anybody: the department would already be closed and the repair
   * would need an administrator who may be at lunch.
   */
  const r = departmentPermission(hr, { active: true, current: false });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.match(r.error, /ผู้ดูแลระบบ/);
});

test('the two refusals do not read alike', () => {
  // Closing and reopening fail for the same reason and are not the same event.
  // A reader who pressed one should not be shown the sentence about the other.
  const closing = departmentPermission(hr, { active: false, current: true }).error;
  const opening = departmentPermission(hr, { active: true, current: false }).error;
  assert.notEqual(closing, opening);
});

test('ผู้ดูแลระบบ may do both', () => {
  assert.equal(departmentPermission(admin, { active: false, current: true }).ok, true);
  assert.equal(departmentPermission(admin, { active: true, current: false }).ok, true);
});

test('a หัวหน้า is refused before the active question is ever reached', () => {
  // The role check comes first, so the refusal names the role rather than
  // explaining what closing a department does to somebody who cannot edit one
  // at all.
  const r = departmentPermission(manager, { active: false, current: true });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'ไม่มีสิทธิ์ใช้งานส่วนนี้');
});

// ── the shape the routes rely on ────────────────────────────────────────────

test('every refusal carries a status and a message the route can return', () => {
  const refusals = [
    departmentPermission(null),
    departmentPermission(employee),
    departmentPermission(hr, { active: false, current: true }),
    departmentPermission(hr, { active: true, current: false }),
  ];
  for (const r of refusals) {
    assert.equal(r.ok, false);
    assert.equal(typeof r.status, 'number');
    assert.ok(r.error && r.error.length > 0, 'a refusal with nothing to show the caller');
  }
});

test('an allowance carries nothing else — nothing may read a value off it', () => {
  // Same shape `rosterPermission` returns. A caller that started reading a
  // field off the success case would be a second rule in a second place.
  assert.deepEqual(departmentPermission(admin), { ok: true });
  assert.deepEqual(departmentPermission(hr), { ok: true });
});
