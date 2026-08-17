import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PERSONAL_FIELDS, maySeePersonalDetails, publicEmployee } from '../lib/employees.js';

/**
 * A ROSTER ROW CARRIES TWO KINDS OF FIELD, AND ONLY ONE OF THEM IS COLLEAGUES'
 * BUSINESS.
 *
 * รหัส, ชื่อ, ตำแหน่ง, แผนก, บทบาท, บริษัท, สถานะ describe the JOB: a หัวหน้า
 * needs every one of them to run an approval queue. วันเกิด and อีเมล describe
 * the PERSON, and nothing in the OT process needs either from somebody else's
 * row — the birthday rule is decided on the server, and there is no feature that
 * mails anybody.
 *
 * Both reached the roster response the same way and it is worth saying how,
 * because the next personal field will arrive by the identical route: the field
 * is added to the Employee schema, `.lean()` returns whole documents, and no
 * screen ever renders it. Nothing looks different. `birthDate` was found and
 * fixed; `email` was then added to the edit dialog months later and went out to
 * every หัวหน้า with their team's rows until this test was written.
 *
 * Which is why the rule is a LIST plus one predicate rather than a destructure
 * per route — see lib/employees.js.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ROW = {
  _id: 'emp-1',
  code: 'PM-0412',
  name: 'สมชาย ใจดี',
  position: 'ช่างเทคนิค',
  role: 'employee',
  company: 'primus',
  active: true,
  birthDate: '1989-05-12',
  email: 'somchai@primus.co.th',
};

const HR = { _id: 'hr-1', role: 'hr' };
const ADMIN = { _id: 'adm-1', role: 'admin' };
const MANAGER = { _id: 'mgr-1', role: 'manager' };
const COLLEAGUE = { _id: 'emp-2', role: 'employee' };
const SELF = { _id: 'emp-1', role: 'employee' };

test('อีเมล and วันเกิด are both personal — one rule, not one rule each', () => {
  assert.deepEqual([...PERSONAL_FIELDS].sort(), ['birthDate', 'email']);
});

test('a หัวหน้า gets their team’s job fields and neither personal one', () => {
  // The leak this file exists for. A manager lists their own department and the
  // rows used to arrive complete — including everybody's private email address,
  // on a screen that has never displayed one.
  const seen = publicEmployee(ROW, MANAGER);
  assert.equal(seen.email, undefined, 'a manager received a team member’s email');
  assert.equal(seen.birthDate, undefined);
  // And nothing else was taken away — this is not a narrowing of the roster.
  assert.equal(seen.code, 'PM-0412');
  assert.equal(seen.name, 'สมชาย ใจดี');
  assert.equal(seen.position, 'ช่างเทคนิค');
  assert.equal(seen.role, 'employee');
  assert.equal(seen.company, 'primus');
  assert.equal(seen.active, true);
});

test('nor does a colleague, whatever their role', () => {
  for (const viewer of [MANAGER, COLLEAGUE]) {
    const seen = publicEmployee(ROW, viewer);
    for (const field of PERSONAL_FIELDS) {
      assert.equal(seen[field], undefined, `${viewer.role} received ${field}`);
    }
  }
});

test('the person themselves sees their own', () => {
  const seen = publicEmployee(ROW, SELF);
  assert.equal(seen.email, 'somchai@primus.co.th');
  assert.equal(seen.birthDate, '1989-05-12');
});

test('ฝ่ายบุคคล and ผู้ดูแลระบบ see them — they are the ones who maintain them', () => {
  for (const viewer of [HR, ADMIN]) {
    const seen = publicEmployee(ROW, viewer);
    assert.equal(seen.email, 'somchai@primus.co.th', viewer.role);
    assert.equal(seen.birthDate, '1989-05-12', viewer.role);
  }
});

test('no session sees nothing personal', () => {
  assert.equal(maySeePersonalDetails(null, ROW), false);
  assert.equal(publicEmployee(ROW, null).email, undefined);
});

test('the caller’s own object is not mutated on the way through', () => {
  // `.lean()` documents are handed straight in and are sometimes the same object
  // the caller still holds — a filter that deleted in place would empty the row
  // it was asked to copy, and the second read would be short.
  const row = { ...ROW };
  publicEmployee(row, MANAGER);
  assert.equal(row.email, 'somchai@primus.co.th', 'publicEmployee mutated its input');
  assert.equal(row.birthDate, '1989-05-12');
});

test('a row with no personal fields set comes back unbroken', () => {
  const bare = { _id: 'x', code: 'PM-0001', name: 'ก' };
  assert.deepEqual(publicEmployee(bare, MANAGER), bare);
  assert.deepEqual(publicEmployee(bare, HR), bare);
  assert.equal(publicEmployee(null, HR), null);
});

test('a field added to the list is withheld without any route being touched', () => {
  // The whole reason this is a list. Simulated rather than asserted on today's
  // two, because the property being pinned is about the NEXT field.
  const withPhone = { ...ROW, phone: '081-234-5678' };
  const filtered = publicEmployee(withPhone, MANAGER);
  assert.equal(filtered.phone, '081-234-5678',
    'a new schema field is visible until somebody puts it on PERSONAL_FIELDS — '
    + 'ตรงนี้คือจุดที่ต้องแก้ ไม่ใช่ที่ route');
});

// ── every roster read goes through it ───────────────────────────────────────

test('both servers filter the roster list through publicEmployee', () => {
  // Two endpoints on two servers. A projection remembered in one of them is a
  // projection that is right in one of them.
  for (const file of ['app/api/employees/route.js', 'src/routes/employees.js']) {
    const code = readFileSync(join(ROOT, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.match(code, /publicEmployee\(/, `${file} returns roster rows unfiltered`);
  }
});

test('the endpoints that hand a roster to non-HR select no personal field at all', () => {
  // Belt and braces on the one list a หัวหน้า reaches that is not the roster:
  // the delegation picker. It narrows with `.select()` before publicEmployee
  // ever sees the row, so a change to either alone still cannot leak.
  const code = readFileSync(join(ROOT, 'app/api/delegations/candidates/route.js'), 'utf8');
  // The exact projection, field for field. `approvesCompany` is on it because the
  // form has to say which payroll a queue covers before somebody hands it over;
  // it is a fact about an approver's authority, not about a person's private life.
  assert.match(code, /\.select\('code name role department approvesCompany'\)/);
  for (const field of PERSONAL_FIELDS) {
    assert.doesNotMatch(code, new RegExp(`select\\([^)]*${field}`), `candidates selects ${field}`);
  }
});
