import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  HR_ASSIGNABLE_ROLES, SELF_LOCKED_FIELDS, dropsAnAdmin, lastAdminPermission, selfEditPermission,
} from '../lib/employees.js';
import { viewerId } from '../lib/entries.js';

/**
 * NOBODY EDITS THEMSELVES OUT, AND THE SYSTEM ALWAYS KEEPS ONE WAY BACK IN.
 *
 * ฝ่ายบุคคล and ผู้ดูแลระบบ are on the roster like everybody else and can open
 * their own row on ทะเบียนพนักงาน — correcting one's own surname is ordinary.
 * Two fields on that row are not: บทบาท decides which screens exist for the
 * account and สถานะการใช้งาน decides whether it can log in. Saving either
 * against oneself removes the screen you would undo it from.
 *
 * The second rule is the same outcome reached without editing oneself. Demote or
 * deactivate the only active ผู้ดูแลระบบ and there is nobody who can hand the
 * role back out — ฝ่ายบุคคล may not (`HR_ASSIGNABLE_ROLES`), which is a rule
 * this one depends on and therefore asserts.
 *
 * Both are refused rather than warned about: a confirmation dialog is the wrong
 * instrument for an action whose recovery is a database console.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const HR = { _id: 'hr-1', role: 'hr', active: true };
const ADMIN = { _id: 'adm-1', role: 'admin', active: true };
const OTHER = { _id: 'emp-1', role: 'employee', active: true };

// ── your own row ────────────────────────────────────────────────────────────

test('ฝ่ายบุคคล may not change their own บทบาท', () => {
  const may = selfEditPermission(HR, { target: HR, role: 'employee' });
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
  assert.match(may.error, /บทบาทของบัญชีตัวเอง/);
});

test('nor may ผู้ดูแลระบบ — being allowed to do everything includes this', () => {
  // The Admin is the likeliest person to do it by accident, because they are
  // the one who can select every role in the list.
  assert.equal(selfEditPermission(ADMIN, { target: ADMIN, role: 'hr' }).ok, false);
  assert.equal(selfEditPermission(ADMIN, { target: ADMIN, role: 'employee' }).ok, false);
});

test('nobody deactivates their own account', () => {
  for (const actor of [HR, ADMIN]) {
    const may = selfEditPermission(actor, { target: actor, active: false });
    assert.equal(may.ok, false, actor.role);
    assert.equal(may.status, 403, actor.role);
    assert.match(may.error, /ตัวเอง/);
  }
});

test('the other fields on one’s own row are ordinary', () => {
  // A corrected surname, a job title, a birth date. The rule is about two
  // fields, not about the row.
  assert.deepEqual(selfEditPermission(HR, { target: HR }), { ok: true });
  assert.deepEqual(SELF_LOCKED_FIELDS, ['role', 'active']);
});

test('a payload repeating what the row already says is not a change', () => {
  // The CSV import and the Express router both send whole rows. If echoing the
  // stored values counted, re-importing an unchanged roster would start failing
  // on the importer's own line — and the fix somebody would reach for is a
  // narrower payload, which is a rule enforced by what a client omits.
  assert.deepEqual(selfEditPermission(HR, { target: HR, role: 'hr' }), { ok: true });
  assert.deepEqual(selfEditPermission(HR, { target: HR, active: true }), { ok: true });
  assert.deepEqual(
    selfEditPermission(ADMIN, { target: ADMIN, role: 'admin', active: true }),
    { ok: true },
  );
});

test('somebody else’s row is somebody else’s row', () => {
  assert.deepEqual(selfEditPermission(ADMIN, { target: OTHER, role: 'manager' }), { ok: true });
  assert.deepEqual(selfEditPermission(ADMIN, { target: OTHER, active: false }), { ok: true });
  // Ids compared as strings: one side is an ObjectId and the other is whatever
  // the session put there, and `===` on those two is false for the same person.
  const sameById = { _id: { toString: () => 'adm-1' }, role: 'admin', active: true };
  assert.equal(selfEditPermission(ADMIN, { target: sameById, role: 'hr' }).ok, false);
});

// ── the last ผู้ดูแลระบบ ────────────────────────────────────────────────────

test('the last active ผู้ดูแลระบบ cannot be demoted or deactivated', () => {
  for (const change of [{ role: 'hr' }, { role: 'employee' }, { active: false }]) {
    const may = lastAdminPermission(ADMIN, { ...change, otherActiveAdmins: 0 });
    assert.equal(may.ok, false, JSON.stringify(change));
    assert.equal(may.status, 409, 'the actor has the right; the system’s state is what refuses');
    assert.match(may.error, /คนสุดท้าย/);
  }
});

test('an ผู้ดูแลระบบ who is not the last one can be either', () => {
  for (const change of [{ role: 'employee' }, { active: false }]) {
    assert.deepEqual(
      lastAdminPermission(ADMIN, { ...change, otherActiveAdmins: 1 }),
      { ok: true },
      JSON.stringify(change),
    );
  }
});

test('the rule counts ACTIVE admins — a deactivated one is not a way back in', () => {
  // `otherActiveAdmins` is the caller's query and it filters on active: true.
  // An Admin who cannot log in cannot hand the role to anybody.
  assert.equal(lastAdminPermission(ADMIN, { active: false, otherActiveAdmins: 0 }).ok, false);
  assert.equal(lastAdminPermission(ADMIN, { active: false, otherActiveAdmins: 2 }).ok, true);
});

test('editing a row that is not an active admin can never trip it', () => {
  // Cheap and pure, so the routes ask this before spending a count query.
  assert.equal(dropsAnAdmin(OTHER, { role: 'manager' }), false);
  assert.equal(dropsAnAdmin(HR, { active: false }), false);
  assert.equal(dropsAnAdmin({ role: 'admin', active: false }, { role: 'employee' }), false,
    'an already-deactivated admin is not counted, so removing them lowers nothing');
  assert.equal(dropsAnAdmin(ADMIN, { role: 'admin' }), false, 'keeping the role drops nobody');
  assert.equal(dropsAnAdmin(ADMIN, { active: true }), false);
  assert.equal(dropsAnAdmin(ADMIN, {}), false, 'an edit that touches neither field');

  assert.equal(dropsAnAdmin(ADMIN, { role: 'hr' }), true);
  assert.equal(dropsAnAdmin(ADMIN, { active: false }), true);
});

test('and the rule is a no-op for everybody else, so no query is wasted', () => {
  assert.deepEqual(lastAdminPermission(OTHER, { active: false, otherActiveAdmins: 0 }), { ok: true });
  assert.deepEqual(lastAdminPermission(HR, { role: 'employee', otherActiveAdmins: 0 }), { ok: true });
});

test('why the floor is one ADMIN and not one HR', () => {
  // ฝ่ายบุคคล may hand out employee and หัวหน้างาน and nothing else, so a system
  // with HR but no Admin cannot mint an Admin. If this list ever gained 'admin'
  // the last-admin rule would be redundant — and this assertion is how that
  // change gets noticed rather than silently making the rule pointless.
  assert.deepEqual(HR_ASSIGNABLE_ROLES, ['employee', 'manager']);
  assert.equal(HR_ASSIGNABLE_ROLES.includes('admin'), false);
});

// ── both rules are applied where the write happens ─────────────────────────

const read = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('every handler that can change บทบาท or สถานะ applies both floors', () => {
  // The dialog greys the two fields out. That is a courtesy — a disabled select
  // is one fetch away from being sent anyway, and the roster is written by four
  // handlers across two servers.
  for (const file of [
    'app/api/employees/[id]/route.js',
    'app/api/employees/import/route.js',
    'src/routes/employees.js',
  ]) {
    const code = read(file);
    assert.match(code, /selfEditPermission\(/, `${file} lets somebody edit their own role`);
    assert.match(code, /dropsAnAdmin\(/, `${file} does not check the admin floor`);
    assert.match(code, /lastAdminPermission\(/, file);
    // Counted excluding the row being edited — "is there another one", not
    // "how many are there".
    assert.match(code, /role: 'admin', active: true, _id: \{ \$ne: /, file);
  }
});

test('the floors are read before the document is mutated', () => {
  // `selfEditPermission` compares the incoming values against the stored ones to
  // decide whether anything is being changed at all. Run after the first
  // assignment it would be comparing a value against itself and would allow
  // everything.
  const code = read('app/api/employees/[id]/route.js');
  const checked = code.indexOf('selfEditPermission(');
  const firstWrite = code.search(/employee\.\w+ = /);
  assert.ok(checked > 0 && firstWrite > 0);
  assert.ok(checked < firstWrite, 'selfEditPermission ถูกเรียกหลังเริ่มเขียนค่าลงเอกสารแล้ว');
});

test('the dialog knows which row is the viewer’s own', () => {
  /**
   * THE PLUMBING WAS RIGHT AND THE WATER NEVER ARRIVED.
   *
   * The test below has always pinned that the dialog greys what the server
   * refuses — `selfLocked('active')`, `disabled={disabled(activeLocked)}`, the
   * reason underneath. All of it was wired correctly and none of it ever fired,
   * because `isSelf` compared `user._id` against the row while the logged-in
   * user arrives from `publicUser` carrying `id`. Always false, so ฝ่ายบุคคล
   * could pick ปิดใช้งาน on their own account and press save; only the server's
   * 403 stopped it.
   *
   * So the identity comparison is pinned on its own, one level below the wiring:
   * it must go through `viewerId`, which reads both shapes and is what the
   * approval rules compare viewers with.
   */
  const screen = read('components/AdminView.jsx');
  assert.match(screen, /const isSelf = viewerId\(user\) === viewerId\(employee\)/);
  assert.doesNotMatch(
    screen,
    /user\??\._id/,
    'the client user has no _id — comparing it silently disables every self-lock',
  );

  // And the shape the client is actually handed, so the two cannot drift apart
  // without one of these two lines failing.
  assert.match(read('lib/session.js'), /export function publicUser[\s\S]{0,120}id: String\(user\._id\)/);
  assert.equal(viewerId({ id: 'x' }), 'x', 'viewerId must read the client shape');
  assert.equal(viewerId({ _id: 'x' }), 'x', 'and the mongoose one');
});

test('the dialog greys exactly the fields the server refuses', () => {
  const screen = read('components/AdminView.jsx');
  // Driven off the shared list rather than spelled out again, so a field added
  // to SELF_LOCKED_FIELDS is locked here without this file being touched.
  assert.match(screen, /SELF_LOCKED_FIELDS\.includes\(field\)/);
  assert.match(screen, /const roleLocked = selfLocked\('role'\) \|\| isLastAdmin/);
  assert.match(screen, /const activeLocked = selfLocked\('active'\) \|\| isLastAdmin/);
  assert.match(screen, /disabled=\{disabled\(roleLocked\)\}/);
  assert.match(screen, /disabled=\{disabled\(activeLocked\)\}/);
  // And says why underneath, per case — grey alone reads as "broken".
  for (const note of ['selfRole', 'selfActive', 'lastAdmin']) {
    assert.match(screen, new RegExp(`LOCK_NOTE\\.${note}`), `no reason shown for ${note}`);
  }
  // The last-admin test uses the same predicate the server does.
  assert.match(screen, /dropsAnAdmin\(employee, \{ role: 'employee', active: false \}\)/);
});
