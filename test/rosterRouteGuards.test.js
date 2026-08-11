import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { AUDITED_FIELDS } from '../lib/rosterAudit.js';

/**
 * EVERY LIMIT ON ทะเบียนพนักงาน IS ENFORCED WHERE THE WRITE HAPPENS, NOT WHERE
 * THE BUTTON IS DRAWN.
 *
 * The edit dialog greys out what the person in front of it may not change —
 * รหัสพนักงาน for ฝ่ายบุคคล, บทบาท “ผู้ดูแลระบบ” for anybody who is not one,
 * every field on the Admin row. That is a courtesy: it stops somebody typing
 * something that is going to be refused, and it gives the refusal a sentence
 * instead of a 403. It is not the rule. A disabled input is one `fetch` away
 * from being sent anyway, and the roster is written by six handlers across two
 * servers.
 *
 * test/rosterPermission.test.js and test/rosterAudit.test.js pin the RULES —
 * `rosterPermission` and `codeChangePermission` as pure functions. This file
 * pins that every handler actually calls them, and calls them at the point where
 * calling them still means something. Both halves are needed: a perfect rule
 * nobody invokes refuses nothing.
 *
 * Read as source text because these modules resolve `@/…` through the Next alias
 * and cannot be imported by `node --test` — the same approach
 * test/accountingReconciliation.test.js takes.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const PATCH = 'app/api/employees/[id]/route.js';
const CREATE = 'app/api/employees/route.js';
const IMPORT = 'app/api/employees/import/route.js';
const TRAIL = 'app/api/employees/[id]/audit/route.js';
const TRAIL_ALL = 'app/api/employees/audit/route.js';
const IMPACT = 'app/api/employees/[id]/impact/route.js';
const LEGACY = 'src/routes/employees.js';

// ── every roster route asks the permission ──────────────────────────────────

test('every handler that writes the roster calls rosterPermission', () => {
  for (const file of [PATCH, CREATE, IMPORT, LEGACY]) {
    assert.match(read(file), /rosterPermission\(/, `${file} writes the roster without asking`);
  }
});

test('every handler that reads a roster trail calls it too', () => {
  // A trail names who changed somebody's แผนก and บทบาท and can carry a วันเกิด
  // as a from/to value. It is not a wider audience than the screen it is drawn
  // on — see maySeePersonalDetails in lib/employees.js, which is strictly wider than
  // this and still excludes managers.
  for (const file of [TRAIL, TRAIL_ALL, IMPACT]) {
    assert.match(read(file), /rosterPermission\(/, `${file} answers without asking`);
  }
});

test('the edit route asks before it assigns, not after', () => {
  // The check reads the row AS IT STANDS and the role being asked for. Run after
  // the first `employee.x = …` it would be reading a half-mutated document and
  // could not answer "may this person touch the Admin row" at all, because the
  // row it is looking at would already have been changed.
  const code = read(PATCH);
  const asked = code.indexOf('rosterPermission(');
  const firstWrite = code.search(/employee\.\w+ = /);

  assert.ok(asked > 0 && firstWrite > 0);
  assert.ok(asked < firstWrite, 'rosterPermission ถูกเรียกหลังจากเริ่มเขียนค่าลงเอกสารแล้ว');
  // And the target is the stored row, with the role being requested named
  // separately — the two halves of the escalation this closes.
  assert.match(code, /rosterPermission\(actor,\s*\{\s*target:\s*employee,\s*role:\s*role\s*\?\?\s*null\s*\}\)/);
});

// ── รหัสพนักงาน: the field the dialog greys out for ฝ่ายบุคคล ───────────────

test('both servers refuse a รหัสพนักงาน change on their own, not by omitting the field', () => {
  // The App Router applies it and assigns the code; the Express router applies
  // it and then refuses outright, because it has never supported the change.
  // "Safe because the field is missing from a destructure" lasts exactly until
  // somebody adds the field.
  for (const file of [PATCH, LEGACY]) {
    assert.match(read(file), /codeChangePermission\(/, `${file} does not check the code change`);
  }
  assert.match(read(LEGACY), /codeChange\.changed/);
});

test('the code check is separate from the row check, so HR getting one does not grant the other', () => {
  const code = read(PATCH);
  const row = code.indexOf('rosterPermission(');
  const identity = code.indexOf('codeChangePermission(');
  assert.ok(row > 0 && identity > row, 'the code check must sit on top of the row check');
});

// ── บทบาท “ผู้ดูแลระบบ”: greyed in the select, refused on the wire ──────────

test('the requested role reaches the permission on every path that can set one', () => {
  // The dialog disables the option; these are what happen when it is sent
  // anyway. The CSV import matters most here — it sets roles a row at a time
  // from a file nobody reviewed field by field.
  assert.match(read(PATCH), /role:\s*role\s*\?\?\s*null/);
  assert.match(read(CREATE), /rosterPermission\(actor,\s*\{\s*role:\s*role\s*\|\|\s*'employee'\s*\}\)/);
  // Per ROW, with the row it is about to overwrite as the target — not once for
  // the upload. A file that names an existing Admin, or asks for the admin role
  // on line 40, is refused on line 40 rather than by whoever checked line 1.
  assert.match(read(IMPORT), /rosterPermission\(actor,\s*\{\s*target:\s*existing,\s*role\s*\}\)/);
  assert.match(read(LEGACY), /rosterPermission\(req\.user,\s*\{\s*target:\s*existing,\s*role\s*\}\)/);
});

// ── the Admin row, in a LIST as well as one at a time ───────────────────────

test('the everybody trail leaves out the rows HR may not open one at a time', () => {
  // Otherwise the list endpoint is the way around the per-row check: HR cannot
  // open the Admin's trail from the table, so a list that included it would
  // hand over exactly what that refusal is for.
  const code = read(TRAIL_ALL);
  assert.match(code, /actor\.role !== 'admin'/);
  assert.match(code, /\$nin/);
  assert.match(code, /role:\s*'admin'/);
  // And ?employee=<admin id> is refused rather than filtered to nothing — an
  // empty list would read as "this account has never been edited".
  assert.match(code, /rosterPermission\(actor,\s*\{\s*target\s*\}\)/);
});

// ── the password: never in the trail, whatever any route does ───────────────

test('no roster route hands a password to the audit trail', () => {
  // The structural guarantee is the allowlist in lib/rosterAudit.js, pinned by
  // test/rosterAudit.test.js. This is the second half: that no handler tries,
  // and that a reset reaches the record as a boolean with no value beside it.
  for (const file of [PATCH, CREATE, IMPORT, LEGACY]) {
    const code = read(file);
    const calls = [...code.matchAll(/recordRosterChange\(\{[\s\S]*?\n\s*\}\)/g)].map((m) => m[0]);
    assert.ok(calls.length > 0, `${file} files no audit record at all`);
    for (const call of calls) {
      assert.doesNotMatch(call, /password:/, `${file} passes a password into the trail`);
      assert.doesNotMatch(call, /passwordHash/, `${file} passes a hash into the trail`);
      // The one thing it may say about a password is that one was set —
      // `issued` is the value the server just generated, and `Boolean()` is
      // what keeps this a flag rather than a slot the value could slide into.
      if (/passwordReset/.test(call)) {
        assert.match(call, /passwordReset:\s*Boolean\(issued\)|passwordReset:\s*(true|false)/, file);
      }
    }
  }
});

test('the record itself has no field a password could be put in later', () => {
  const model = read('src/models/EmployeeAudit.js');
  // `passwordReset` is the boolean and `'password_reset'` is the action name;
  // anything else password-shaped is a value slot somebody could fill in.
  assert.doesNotMatch(
    model,
    /password(?!(Reset|_reset))/i,
    'EmployeeAudit gained a password-shaped field',
  );
  // `changes.field` is an enum over the allowlist, so an off-list field cannot
  // be stored even by a handler that tried.
  assert.match(model, /enum:\s*\[\.\.\.AUDITED_FIELDS\]/);
  for (const field of AUDITED_FIELDS) assert.equal(/pass/i.test(field), false, field);
});

// ── manager and employee never reach the screen at all ──────────────────────

test('the ตั้งค่าระบบ tab is built for ฝ่ายบุคคล and ผู้ดูแลระบบ only', () => {
  const app = read('components/App.jsx');
  assert.match(
    app,
    /if \(\['hr', 'admin'\]\.includes\(user\.role\)\) tabs\.push\(\{ key: 'admin'/,
    'the roster tab is offered to somebody outside hr/admin',
  );
  // And the deep link into it is guarded on the role rather than trusted to the
  // caller — the birthday screens that use it are read by หัวหน้า too.
  assert.match(app, /const mayOpenRoster = \['hr', 'admin'\]\.includes\(user\.role\)/);
});

// ── the table behind the dialog edits nothing ──────────────────────────────

test('the roster table is read-only — every edit goes through the one dialog', () => {
  // Two ways in meant two shapes of audit record for the same kind of change,
  // and no room in a table cell for the sentence explaining a greyed field.
  const screen = read('components/AdminView.jsx');
  // The ทะเบียนพนักงาน table specifically — แผนกและเพดาน above it is a different
  // screen with two numeric fields that legitimately still save on blur.
  const start = screen.indexOf('<th>รหัส</th><th>ชื่อ-สกุล</th><th>ตำแหน่ง</th>');
  assert.ok(start > 0, 'could not find the employee table — its header row changed');
  const table = screen.slice(start, screen.indexOf('</table>', start));

  assert.doesNotMatch(table, /onBlur=/, 'the roster table saves on blur again');
  assert.doesNotMatch(table, /update\(p\._id/, 'the roster table writes directly again');
  assert.match(table, /setEditing\(p\)/);

  // And the dialog warns before closing on unsaved work, which is only possible
  // because the save is deliberate rather than incidental.
  assert.match(screen, /dirty=\{changes\.length > 0 && !busy\}/);
});

test('every way out of the edit dialog asks about unsaved work, ยกเลิก included', () => {
  // The ×, Escape and the backdrop all go through Modal's `requestClose`. A
  // footer button wired straight to `onClose` would be the one exit that throws
  // the work away without asking — and it is the one people reach for.
  const screen = read('components/AdminView.jsx');
  const modal = read('components/common.jsx');

  assert.match(modal, /typeof footer === 'function' \? footer\(requestClose\) : footer/);
  assert.match(screen, /footer=\{\(requestClose\) =>/);
  assert.match(screen, /onClick=\{requestClose\} disabled=\{busy\}>ยกเลิก/);
});

test('what the dialog shows before saving is what the server will record', () => {
  // The same pure diff on both sides — not a second implementation that agrees
  // with the first today.
  const screen = read('components/AdminView.jsx');
  assert.match(screen, /import \{[^}]*rosterChanges[^}]*\} from '@\/lib\/rosterAudit\.js'/);
  assert.match(screen, /const changes = rosterChanges\(before, form\)/);
  assert.match(read(PATCH), /const changes = rosterChanges\(before, \{/);
});
