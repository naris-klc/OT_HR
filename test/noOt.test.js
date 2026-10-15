import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { proxyPermission, NO_OT_ERROR } from '../lib/proxyFiling.js';
import { AUDITED_FIELDS, FIELD_LABEL, rosterChanges } from '../lib/rosterAudit.js';

/**
 * ไม่มี OT — `Employee.noOt`, asked for on 2026-10-15.
 *
 * The CEO (S001) never has OT but must still log in to sign, so ปิดใช้งาน
 * cannot stand in for it. HR's answers, which these cases pin:
 *
 *   · no blank line on any report — สรุปบัญชี and แยกแผนก, screen, print, CSV;
 *   · hours already filed STILL print — the flag removes blank lines only;
 *   · the person cannot file, and nobody can file for them;
 *   · set per person by ฝ่ายบุคคล or ผู้ดูแลระบบ on the พนักงาน form, no code.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const ENG = 'dept-eng';
const MANAGER = { _id: 'mgr-1', role: 'supervisor', department: ENG };
const MEMBER = { _id: 'emp-1', role: 'employee', department: ENG, active: true };

test('nobody files for a person set to ไม่มี OT', () => {
  assert.deepEqual(proxyPermission(MANAGER, MEMBER), { ok: true });
  const may = proxyPermission(MANAGER, { ...MEMBER, noOt: true });
  assert.equal(may.ok, false);
  assert.equal(may.error, NO_OT_ERROR);
});

test('the person cannot file for themselves either — model, session and route agree', () => {
  const model = read('src/models/Employee.js');
  assert.match(model, /noOt: \{ type: Boolean, default: false \}/);
  assert.match(model, /return ROLES\.includes\(this\.role\) && !this\.noOt;/);

  // The menu reads the session's copy; it must give the route's answer.
  const session = read('lib/session.js');
  assert.match(session, /maySubmitOt: ROLES\.includes\(user\.role\) && !user\.noOt,/);

  const route = read('app/api/entries/route.js');
  assert.match(route, /user\.noOt \? NO_OT_ERROR :/);
});

test('the report roster leaves them out — the one query every report shares', () => {
  const code = read('lib/accounting.js');
  assert.ok(code.includes('noOt: { $ne: true }'), 'ไม่มี OT is back on the sheets as a blank line');
  // Blank lines only: the filter lives in the includeZero pass, after `groups`
  // is built from entries — so hours filed before the flag was set still print.
  assert.ok(
    code.indexOf('noOt: { $ne: true }') > code.indexOf('if (includeZero)'),
    'the ไม่มี OT filter moved before the entries pass and can drop hours',
  );
});

test('setting it is on the roster trail, and an untouched row records nothing', () => {
  assert.ok(AUDITED_FIELDS.includes('noOt'));
  assert.equal(FIELD_LABEL.noOt, 'การทำ OT');
  assert.deepEqual(rosterChanges({ noOt: false }, { noOt: true }), [
    { field: 'noOt', from: 'false', to: 'true' },
  ]);
  assert.deepEqual(rosterChanges({ noOt: false }, { noOt: false }), []);
});

test('both employee routes accept it; a create without it records nothing', () => {
  const create = read('app/api/employees/route.js');
  assert.match(create, /noOt: noOt === true,/);
  assert.match(create, /\.\.\.\(employee\.noOt \? \{ noOt: true \} : \{\}\)/);

  const edit = read('app/api/employees/[id]/route.js');
  assert.match(edit, /employee\.noOt = noOt;/);
  // Anything but true/false is a 400 on both, not a silent "มี OT" — found by
  // the API walk of 2026-10-15, where noOt: 'yes' cleared the flag.
  for (const route of [create, edit]) {
    assert.match(route, /noOt != null && typeof noOt !== 'boolean'/);
  }
  // Boolean() on both sides: rows from before the field have it undefined, and
  // undefined → false must not file a change on every save.
  assert.equal((edit.match(/noOt: Boolean\(employee\.noOt\),/g) || []).length, 2);
});

test('the screens: a toggle on both forms, a red chip on the roster, no proxy target', () => {
  const admin = read('components/AdminView.jsx');
  assert.equal((admin.match(/after=\{<NoOtToggle /g) || []).length, 2, 'add and edit forms');
  assert.match(admin, /p\.noOt && <span className="chip no-ot">/);

  const form = read('components/OtForm.jsx');
  assert.match(form, /e\.role === 'employee' && !e\.noOt/);

  // A พนักงาน set to ไม่มี OT has no tab left; the shell says why.
  const app = read('components/App.jsx');
  assert.match(app, /บัญชีนี้ตั้งไว้ว่าไม่มี OT/);
  assert.match(app, /tab === 'mine' && user\.maySubmitOt && \(/);
});
