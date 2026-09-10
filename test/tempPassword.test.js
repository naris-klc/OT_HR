import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { AMBIGUOUS_GLYPHS, generateTempPassword } from '../lib/tempPassword.js';
import {
  PASSWORD_ALLOWED, PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH,
  chosenPasswordPermission, defaultPassword, passwordShapePermission,
} from '../lib/employees.js';
// Safe to import: the script runs nothing and opens no connection unless it is
// the process entry point — the property test/seedEntryPoint.test.js pins.
import { repairRefusal } from '../src/migrate-first-password.js';

/** Any valid ObjectId — the Employee documents below are never saved. */
const OID = '6a97c79abe61c297a2e7d9a4';

/**
 * THE FIRST-LOGIN PASSWORD IS THE EMPLOYEE CODE, AND THAT IS A DECISION WITH A
 * HISTORY. Read it before loosening anything here.
 *
 * This file read "THE FIRST-LOGIN PASSWORD IS NOT DERIVED FROM ANYTHING" until
 * 2026-09-02. It was `Primus@` + the employee code once, that was removed
 * because the roster is printed on every ใบ F-HR-027 and every file sent to
 * accounting — so the password of every account nobody had logged into yet was
 * a public fact — and it was replaced by a random `generateTempPassword()`.
 *
 * HR asked for the code back on 2026-09-02, and it was given back: a random
 * password has to be read down a phone, gets mistyped, and on a roster where
 * most people have no email on file it is lost outright when a dialog is closed
 * a moment early. What the tests below pin is that the cost of that choice is
 * paid in exactly one place and no others:
 *
 *   · `mustChangePassword` on every issue, from every path, so the guessable
 *     value works until the first login and not one screen further;
 *   · the SERVER decides the value, always, from the code it has stored — the
 *     browser may compute it to put in a sentence and may never send one;
 *   · no other password may be built out of the employee code — the exemption
 *     in `chosenPasswordPermission` is the single exact default and nothing
 *     around it;
 *   · `npm run reset-admin` keeps the random generator, because the account
 *     that recovers every other account cannot have a password on the roster.
 *
 * `lib/tempPassword.js` therefore still exists and is still tested in full. It
 * has exactly one caller now (src/reset-admin-password.js) and the tests for
 * its shape are worth keeping regardless: that value is typed at a login screen
 * by somebody reading it off a console, which is what all of it is for.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── the default: the employee's own รหัสพนักงาน ─────────────────────────────

test('the default password is the employee code, spelled as the roster spells it', () => {
  // Punctuation KEPT. Both shapes are real on this roster (see normalizeCode),
  // and the person typing this at the login screen is copying what is printed
  // on their card — a value that quietly dropped the hyphen would be one they
  // could not type from the thing they were handed.
  assert.equal(defaultPassword('PM-0620'), 'PM-0620');
  assert.equal(defaultPassword('PM00511'), 'PM00511');
  assert.equal(defaultPassword('THT0012'), 'THT0012');

  // This is NOT normalizeCode, deliberately: that exists to make two spellings
  // compare equal, and a password has to be one spelling.
  const normalize = readFileSync(join(ROOT, 'lib/employees.js'), 'utf8');
  assert.doesNotMatch(
    normalize.slice(normalize.indexOf('export function defaultPassword')),
    /^export function defaultPassword[\s\S]{0,200}?normalizeCode/,
    'the default password went through normalizeCode — hyphens would vanish',
  );
});

test('it matches what mongoose will have stored, not what was typed', () => {
  // Employee.code carries `trim: true, uppercase: true`, so the row created
  // from `pm-0620 ` holds `PM-0620` and that is the password it accepts. The
  // browser computes this from a form field mongoose has not touched, so
  // without the same two the note under เพิ่มพนักงาน would name a password the
  // account does not have.
  assert.equal(defaultPassword(' pm-0620 '), 'PM-0620');
  assert.equal(defaultPassword('tht0012'), 'THT0012');

  const model = readFileSync(join(ROOT, 'src/models/Employee.js'), 'utf8');
  assert.match(model, /code: \{[^}]*trim: true[^}]*uppercase: true/,
    'Employee.code no longer trims and upper-cases — defaultPassword now disagrees with the row');
});

test('nothing about it can throw on a row that has no code yet', () => {
  // The เพิ่มพนักงาน form calls this on every keystroke, starting from ''.
  for (const value of [undefined, null, '', '   ']) assert.equal(defaultPassword(value), '');
});

// ── the exemption, and its exact edges ──────────────────────────────────────

/**
 * WHAT THE CHECK IS FOR, AND WHAT IT IS NOT FOR.
 *
 * เพิ่มพนักงาน may send a password: HR asked to be able to say a first password
 * to somebody standing in front of them. That reopens exactly one door — the
 * old scheme was `Primus@` + the employee code, and a box to type a password
 * into is somewhere to type that same scheme back in by hand.
 *
 * So these tests pin the one refusal that matters and, just as deliberately, do
 * NOT pin a character-class policy. This credential is replaced at first login,
 * and a rule that makes HR fight the box is a rule answered with one password
 * for the whole roster.
 */
test('the default itself passes — it is what leaving the box alone would set', () => {
  // Added 2026-09-02 with the default. A rule that refused this would refuse
  // the value the very next screen hands out, which reads as a bug and gets
  // answered with `PM-0620x`.
  assert.equal(chosenPasswordPermission('PM-0620', { code: 'PM-0620' }).ok, true);
  assert.equal(chosenPasswordPermission('PM00511', { code: 'PM00511' }).ok, true);

  // Including one shorter than the minimum: a short code is short in both
  // places or neither, and the box is not where payroll's numbering is refused.
  assert.equal(chosenPasswordPermission('HR-01', { code: 'HR-01' }).ok, true);

  // The mongoose spellings agree, so HR typing what the roster shows passes on
  // a row that was created from lowercase.
  assert.equal(chosenPasswordPermission('PM-0620', { code: ' pm-0620 ' }).ok, true);
});

test('a chosen password may not carry the employee code, however else it is spelled', () => {
  // Every one of these is the old value or a hand-typed cousin of it, and the
  // roster they can be computed from is printed on every ใบ and every accounting
  // file the company sends out. None of them is the default, so none is exempt.
  for (const password of ['pm0620', 'Primus@PM-0620', 'xxPM0620xx', 'PM.0620!', 'PM-0620x']) {
    const may = chosenPasswordPermission(password, { code: 'PM-0620' });
    assert.equal(may.ok, false, `${password} was accepted`);
    assert.equal(may.status, 400);
  }
  // Both shapes the roster actually holds — see normalizeCode. A rule that knew
  // only one of them would pass whichever spelling the row happened not to use.
  assert.equal(chosenPasswordPermission('helloPM00511', { code: 'PM00511' }).ok, false);
  assert.equal(chosenPasswordPermission('helloPM-00511', { code: 'PM00511' }).ok, false);
});

test('a chosen password is refused for being short, and not for its make-up', () => {
  assert.equal(chosenPasswordPermission('abc', { code: 'PM-0620' }).ok, false);
  assert.equal(chosenPasswordPermission('a'.repeat(PASSWORD_MIN_LENGTH - 1), { code: 'X' }).ok, false);

  // Long enough, allowed characters, and not the code: accepted, whatever it is
  // made OF. No uppercase rule, no digit rule, no must-mix rule — on purpose.
  // The character set added on 2026-09-02 says which characters can be stored,
  // which is a different question from whether a password is any good.
  for (const password of ['ดอกไม้สวย', 'welcome-monday', 'aaaaaaaa', 'สมชาย1234', 'ก่อ1']) {
    assert.equal(chosenPasswordPermission(password, { code: 'PM-0620' }).ok, true, password);
  }
});

test('a code too short to recognise does not refuse half the alphabet', () => {
  // Stripped to two characters there is nothing left to match on: a rule that
  // still tried would refuse every password with 'pm' anywhere inside it.
  assert.equal(chosenPasswordPermission('important-pm-stuff', { code: 'PM' }).ok, true);
  assert.equal(chosenPasswordPermission('welcome-monday', { code: '' }).ok, true);
  // And an empty code cannot make the exemption fire on an empty password.
  assert.equal(chosenPasswordPermission('', { code: '' }).ok, false);
});

// ── ภาษาไทยในรหัสผ่าน — the character set, added 2026-09-02 ─────────────────

/**
 * WHAT THIS RULE IS AND IS NOT.
 *
 * It says which characters this system can STORE faithfully. It is checked only
 * where a password is SET — `chosenPasswordPermission` and both servers'
 * me/password — and NEVER where one is verified, so no password already in the
 * database can stop working because the list changed. That property is the
 * reason the list can be widened later without a migration, and it is asserted
 * further down rather than left as a claim.
 */
test('Thai is a password now — consonants, สระ and วรรณยุกต์ alike', () => {
  for (const password of ['ดอกไม้', 'สวัสดี', 'ก่อน', 'ผ่านได้', 'รหัส123', 'ไทย!@#']) {
    assert.equal(passwordShapePermission(password).ok, true, password);
  }
  // The whole \u0E00-\u0E7F block, not a hand-picked subset: Thai digits and ฿
  // are in it and nothing anywhere should have to know that.
  assert.equal(passwordShapePermission('๑๒๓๔').ok, true);
  assert.equal(passwordShapePermission('฿฿฿฿').ok, true);
});

test('the length floor is four, counted the way the regex counts', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 4);
  assert.equal(passwordShapePermission('abc').ok, false);
  assert.equal(passwordShapePermission('abcd').ok, true);

  /**
   * AND FOR THAI THAT IS NOT WHAT A PERSON SEES. `ก่อ` is two visible letters
   * and three code units, because the tone mark is a unit of its own sitting on
   * top of the ก — so it passes a check somebody reading the screen would
   * expect to fail, and `ก่` (one visible letter, two units) fails one they
   * might expect to pass. Pinned rather than fixed: the number has to be the
   * same number the client, both servers and PASSWORD_ALLOWED all use.
   */
  assert.equal('ก่อ'.length, 3);
  assert.equal(passwordShapePermission('ก่อ').ok, false);
  assert.equal(passwordShapePermission('ก่อน').ok, true);
});

test('the exported regex and the running rule agree', () => {
  // PASSWORD_ALLOWED is the rule in the shape it was specified in; FORBIDDEN is
  // the negation that actually runs, because only a negation can name the
  // offending character. Two expressions of one rule, so they are compared.
  const cases = [
    'ดอกไม้', 'PM-0620', 'abcd', 'ab12', 'ผ่าน123', 'สวัสดี!', '๑๒๓๔',
    'abc', 'ดอก ไม้', 'ab~cd', '`abcd', 'héllo', 'abc😀', '',
  ];
  for (const value of cases) {
    assert.equal(
      PASSWORD_ALLOWED.test(value),
      passwordShapePermission(value).ok,
      `${JSON.stringify(value)}: the regex and the function disagree`,
    );
  }
  // The floor inside the regex is the constant, not a second 4 to drift.
  assert.equal(PASSWORD_ALLOWED.test('a'.repeat(PASSWORD_MIN_LENGTH)), true);
  assert.equal(PASSWORD_ALLOWED.test('a'.repeat(PASSWORD_MIN_LENGTH - 1)), false);
});

test('what the set leaves out, and the refusal names it', () => {
  /**
   * The spec's prose said "อักขระพิเศษทุกประเภท" and its regex is narrower.
   * The regex was implemented; these are the four things that costs, listed so
   * that widening the class later is a decision somebody makes rather than a
   * test they delete.
   */
  const space = passwordShapePermission('ดอก ไม้');
  assert.equal(space.ok, false);
  assert.equal(space.status, 400);
  // A space renders as nothing inside quotes, so it is named and its codepoint
  // given — otherwise the message is a riddle about an invisible character.
  assert.match(space.error, /ช่องว่าง \(U\+0020\)/);

  assert.equal(passwordShapePermission('ab~cd').ok, false);   // tilde
  assert.equal(passwordShapePermission('`abcd').ok, false);   // backtick
  assert.equal(passwordShapePermission('héllo').ok, false);   // Latin-1
  assert.equal(passwordShapePermission('abc😀').ok, false);   // astral

  // The character itself goes in the message, with its codepoint beside it.
  assert.match(passwordShapePermission('ab~cd').error, /“~” \(U\+007E\)/);
  // And a whole code point, not half of one. Without the `u` flag on FORBIDDEN
  // this named U+D83D — a lone surrogate, a number belonging to no character
  // anybody typed. Found by walking it on 2026-09-02, not by reading the code.
  assert.match(passwordShapePermission('abc😀').error, /😀” \(U\+1F600\)/);

  // Every symbol the spec DID list is accepted, checked one at a time so a
  // mis-escaped bracket in the class cannot hide behind its neighbours.
  for (const ch of '!@#$%^&*()_+-=[]{};\':"\\|,.<>/?') {
    assert.equal(passwordShapePermission(`ab1${ch}`).ok, true, `${ch} was refused`);
  }
});

// ── bcrypt reads 72 bytes, and Thai is three bytes a letter ────────────────

/**
 * THE SILENT ONE.
 *
 * bcrypt hashes at most 72 bytes and ignores the rest without saying so. Latin
 * is one byte a character so the ceiling reads as "72 characters" and nobody
 * meets it; Thai is THREE, so it is about 24 letters — well inside what
 * somebody would type as a passphrase.
 *
 * What that costs, if it is not refused: two different passwords open one
 * account and no screen, log or trail records anything unusual.
 */
test('a password bcrypt would quietly cut in half is refused instead', async () => {
  const bcrypt = (await import('bcryptjs')).default;

  // The failure, demonstrated on the real library rather than asserted about
  // it — this is why the ceiling exists and it must fail if bcryptjs changes.
  const stem = 'ก'.repeat(24);            // 72 bytes exactly
  assert.equal(new TextEncoder().encode(stem).length, PASSWORD_MAX_BYTES);
  const hash = await bcrypt.hash(`${stem}A`, 4);
  assert.equal(await bcrypt.compare(`${stem}B`, hash), true,
    'bcryptjs stopped truncating — the ceiling below may be able to go');

  // So the rule refuses anything past the ceiling, and says why in bytes.
  assert.equal(passwordShapePermission(stem).ok, true, '24 Thai letters must still be allowed');
  const over = passwordShapePermission(`${stem}ก`);
  assert.equal(over.ok, false);
  assert.match(over.error, /75 ไบต์/);
  assert.match(over.error, /3 ไบต์/);

  // Latin is unaffected up to a full 72.
  assert.equal(passwordShapePermission('a'.repeat(72)).ok, true);
  assert.equal(passwordShapePermission('a'.repeat(73)).ok, false);
});

// ── UTF-8 all the way to the hash ───────────────────────────────────────────

test('Thai survives hashing, and a moved วรรณยุกต์ does not become a wrong password', async () => {
  const bcrypt = (await import('bcryptjs')).default;
  const { default: Employee } = await import('../src/models/Employee.js');

  // A Thai password round-trips, and a changed tone mark is a different
  // password. Both halves matter: the first says nothing is mangled, the second
  // says nothing is being over-normalised into a collision.
  const doc = new Employee({ code: 'PM-9999', name: 'ทดสอบ', department: OID, passwordHash: 'x' });
  await doc.setPassword('ดอกไม้สวย');
  assert.equal(await doc.verifyPassword('ดอกไม้สวย'), true);
  assert.equal(await doc.verifyPassword('ดอกไม่สวย'), false, 'a different tone mark now matches');

  /**
   * THE ONE THAT LOOKS LIKE A BUG AND IS NOT ONE.
   *
   * ก + ุ + ่ and ก + ่ + ุ are the same word, render identically, and are
   * different byte sequences — the marks carry different combining classes, so
   * Unicode says they are one text and NFC picks an order. Typed on two
   * keyboards, they used to be two passwords. `setPassword` normalises, so
   * whichever order was typed reaches bcrypt the same way.
   */
  const typed = '\u0E01\u0E38\u0E48\u0E01';
  const swapped = '\u0E01\u0E48\u0E38\u0E01';
  assert.notEqual(typed, swapped, 'the two orders are the same string — the test proves nothing');
  assert.equal(typed.normalize('NFC'), swapped.normalize('NFC'));
  await doc.setPassword(typed);
  assert.equal(await doc.verifyPassword(swapped), true, 'a reordered วรรณยุกต์ is refused');

  /**
   * AND NORMALISING CANNOT LOCK ANYBODY OUT. Every hash written before
   * 2026-09-02 was made from un-normalised bytes; `verifyPassword` tries the
   * raw string FIRST, so a stored password in a non-canonical order still opens
   * with the exact keystrokes that made it.
   */
  doc.passwordHash = await bcrypt.hash(swapped, 4);   // as an old hash would be
  assert.equal(await doc.verifyPassword(swapped), true, 'an old non-NFC password stopped working');
});

test('the character set is checked where a password is SET and nowhere else', () => {
  // The property that makes this rule safe to change: verification never
  // consults it, so widening or narrowing the class cannot lock anybody out.
  const model = strip(readFileSync(join(ROOT, 'src/models/Employee.js'), 'utf8'));
  const verify = model.slice(model.indexOf('methods.verifyPassword'));
  assert.doesNotMatch(verify, /passwordShapePermission|PASSWORD_ALLOWED|PASSWORD_MIN_LENGTH/,
    'verifying a password now applies the character set — a stored one could stop working');

  const login = strip(readFileSync(join(ROOT, 'app/api/auth/login/route.js'), 'utf8'));
  assert.doesNotMatch(login, /passwordShapePermission|PASSWORD_ALLOWED/,
    'the login screen refuses passwords it once issued');

  // And it IS applied at all three doors that write one.
  for (const file of [
    'app/api/employees/me/password/route.js',
    'legacy/routes/employees.js',
  ]) {
    assert.match(strip(readFileSync(join(ROOT, file), 'utf8')), /passwordShapePermission\(next\)/, file);
  }
  // The create route reaches it through chosenPasswordPermission, which is
  // where the employee-code rule lives as well.
  const shared = strip(readFileSync(join(ROOT, 'lib/employees.js'), 'utf8'));
  const chosen = shared.slice(shared.indexOf('export function chosenPasswordPermission'));
  assert.match(chosen, /passwordShapePermission\(value\)/,
    'the HR box no longer shares the rule with the employee box');
});

test('the form and the server run the same rule, not two copies of it', () => {
  // A length and a character set written twice is a pair that agrees until one
  // of them is edited — and the half that gets edited is never the one on the
  // screen somebody is looking at.
  for (const file of ['components/ProfileView.jsx', 'components/AdminView.jsx']) {
    const code = readFileSync(join(ROOT, file), 'utf8');
    assert.match(code, /from '@\/lib\/employees\.js'/, file);
    assert.doesNotMatch(strip(code), /\\u0E00-\\u0E7F/,
      `${file} spells the character class out for itself`);
  }
  assert.match(
    strip(readFileSync(join(ROOT, 'components/ProfileView.jsx'), 'utf8')),
    /passwordShapePermission\(next\)/,
  );
});

test('the helper text under the box says the rule the server applies', () => {
  const code = readFileSync(join(ROOT, 'components/ProfileView.jsx'), 'utf8');
  // The sentence asked for on 2026-09-02, built from the constant rather than
  // typed as a 4 that can drift away from PASSWORD_MIN_LENGTH.
  assert.match(code, /รหัสผ่านต้องมีความยาวอย่างน้อย \$\{MIN_LENGTH\} ตัวอักษร/);
  assert.match(code, /สามารถใช้ตัวอักษรไทย ตัวอักษรอังกฤษ ตัวเลข หรืออักขระพิเศษได้/);
  // It was said twice until 2026-09-04 — here and on the first-login screen,
  // which is where most people met this form once. That screen is gone, so
  // this form is the only place the rule is written, and the second assertion
  // is now that nowhere ELSE writes it: a copy on another screen is a sentence
  // that drifts away from PASSWORD_HELP without anything failing.
  assert.doesNotMatch(
    readFileSync(join(ROOT, 'components/App.jsx'), 'utf8'),
    /ตัวอักษรไทย ตัวอักษรอังกฤษ ตัวเลข/,
  );
});

test('the JSON the browser sends names its encoding', () => {
  // Belt and braces: fetch encodes UTF-8 regardless and JSON is UTF-8 by
  // definition, so this changes nothing today. It is here because what travels
  // through that call is now a password that can be Thai, and a mis-guessed
  // encoding does not produce an error — it produces an account nobody can
  // open.
  assert.match(
    readFileSync(join(ROOT, 'lib/api.js'), 'utf8'),
    /'Content-Type'\] = 'application\/json; charset=utf-8'/,
  );
});

// ── the routes: the server decides, from the row it stored ──────────────────

test('every route that issues one reads the stored code, and none reads a request field', () => {
  const routes = [
    'app/api/employees/route.js',
    'app/api/employees/[id]/route.js',
    'app/api/employees/import/route.js',
    'legacy/routes/employees.js',
  ];
  for (const file of routes) {
    const code = strip(readFileSync(join(ROOT, file), 'utf8'));

    // `employee.code` — the document, after mongoose has trimmed and
    // upper-cased it — and never the `code` off the body or a CSV cell. A first
    // password that differs from the printed code by one character is
    // indistinguishable from a wrong password to everybody involved.
    assert.match(code, /defaultPassword\(employee\.code\)/, `${file} issues a password some other way`);
    assert.doesNotMatch(code, /defaultPassword\(code\)/, `${file} builds the password from the request body`);

    // The old shapes: a password taken from the body, or from a CSV column.
    assert.doesNotMatch(code, /setPassword\(password\)/, `${file} still sets a caller's password`);
    assert.doesNotMatch(code, /pick\(row, 'password'\) \|\|/, `${file} still honours a CSV password column`);

    // And no second formula anywhere. `generateTempPassword` has exactly one
    // caller left in the tree and it is not a route — see reset-admin below.
    assert.doesNotMatch(code, /generateTempPassword|Primus@/, `${file} grew a second password scheme`);
  }

  // Changing an EXISTING row still refuses a supplied password outright. The
  // value being guessable again does not make it the caller's to send: this is
  // the browser-computes-and-PATCHes bug, which is a different bug from the
  // value being on the roster, and it stays closed.
  for (const file of ['app/api/employees/[id]/route.js', 'legacy/routes/employees.js']) {
    assert.match(
      strip(readFileSync(join(ROOT, file), 'utf8')),
      /password !== undefined/,
      `${file} silently ignores a supplied password`,
    );
  }

  // A CSV cannot be refused the same way — one stray column would reject a file
  // of two hundred good rows — so the column is ignored and the row is flagged,
  // which is the same information arriving as a warning instead of an error.
  const importCode = readFileSync(join(ROOT, 'app/api/employees/import/route.js'), 'utf8');
  assert.match(importCode, /if \(pick\(row, 'password'\)\) \{/);
  assert.match(importCode, /ระบบไม่ใช้ค่านั้น/);
});

test('both servers check a chosen password with the same rule', () => {
  // A rule enforced by one of two servers is not a rule, and the failure mode
  // here is silent: the account is created either way.
  for (const file of ['app/api/employees/route.js', 'legacy/routes/employees.js']) {
    const code = strip(readFileSync(join(ROOT, file), 'utf8'));
    assert.match(code, /chosenPasswordPermission\(/, `${file} accepts a chosen password unchecked`);
    // And a chosen one is never echoed back — HR already has it, and the
    // response is one more place it would exist for no reason.
    assert.match(code, /password: chosen \? undefined : issued/, `${file} echoes a chosen password`);
    assert.match(code, /passwordChosen/, `${file} does not tell the screen which kind it made`);
  }
});

test('a reset is asked for by a flag, and the value it set comes back', () => {
  // `resetPassword: true` replaced `password: '…'`. The response carries the
  // value the SERVER decided rather than leaving the screen to work it out — a
  // screen guessing along beside the server is a screen that will be wrong the
  // day the rule changes.
  for (const file of ['app/api/employees/[id]/route.js', 'legacy/routes/employees.js']) {
    const code = strip(readFileSync(join(ROOT, file), 'utf8'));
    assert.match(code, /resetPassword \? defaultPassword\(employee\.code\) : null/, file);
    assert.match(code, /password: issued/, `${file} does not return the password it set`);
    assert.match(code, /passwordReset: Boolean\(issued\)/, `${file} records the wrong reset flag`);
  }

  /**
   * THE CODE AS THE REQUEST WILL LEAVE IT, not as it arrived. The App Router's
   * PATCH can rename PM-0620 to PM-0641 and reset in one go, and the password
   * has to be the code the person is about to be told is theirs — so the reset
   * is decided AFTER `employee.code` has been assigned. Reading the snapshot
   * would hand out a password for a row that no longer exists.
   */
  const patch = strip(readFileSync(join(ROOT, 'app/api/employees/[id]/route.js'), 'utf8'));
  assert.ok(
    patch.indexOf('employee.code = wanted;') < patch.indexOf('defaultPassword(employee.code)'),
    'the reset is decided before the new รหัสพนักงาน is assigned — it would set the old code',
  );

  // And the import hands back one row per account it created, so the slips and
  // the table print what was stored rather than what the screen assumes.
  for (const file of ['app/api/employees/import/route.js', 'legacy/routes/employees.js']) {
    const code = readFileSync(join(ROOT, file), 'utf8');
    assert.match(code, /issuedPasswords\.push\(\{ code: employee\.code, name: employee\.name, password: issued \}\)/, file);
    assert.match(code, /issued: issuedPasswords/, file);
  }
});

test('every path that issues one also demands it be replaced', () => {
  // The whole of what makes a guessable default affordable: the flag that says
  // this password is not the account's own. One path that forgot it would be a
  // permanently guessable account and nothing on any screen would say so.
  const paths = [
    'app/api/employees/route.js',
    'app/api/employees/[id]/route.js',
    'app/api/employees/import/route.js',
    'legacy/routes/employees.js',
    'src/reset-admin-password.js',
  ];
  for (const file of paths) {
    assert.match(
      strip(readFileSync(join(ROOT, file), 'utf8')),
      /mustChangePassword(:| =) true/,
      `${file} issues a password without forcing it to be replaced`,
    );
  }

  // And something on screen honours it. It was a gate — one screen an account
  // could reach and no other — until 2026-09-03; it is a strip on the landing
  // tab now. What must never be true is that NOTHING reads the flag, which is
  // what deleting the gate would have left had the strip not gone in with it.
  const app = strip(readFileSync(join(ROOT, 'components/App.jsx'), 'utf8'));
  assert.match(app, /tab === home && user\.mustChangePassword && \(/);

  // Cleared in one place only, by the person who typed the new value.
  const self = strip(readFileSync(join(ROOT, 'app/api/employees/me/password/route.js'), 'utf8'));
  assert.match(self, /me\.mustChangePassword = false/);
  // …and never by typing the issued value straight back in, which would clear
  // the flag while leaving the account exactly as exposed as it was.
  assert.match(self, /String\(next\) === String\(current \|\| ''\)/);
});

test('signing in reaches the app, and the flag is said in ink instead', () => {
  // 2026-09-04, TWO ASKS IN ONE DAY. First: let somebody who does not want to
  // change their password work anyway (a ข้ามไปก่อน button on the gate).
  // Then, once that was built and walked: "ไม่ต้องเข้ามาหน้านี้แล้ว ไม่เอา
  // หน้านี้แล้ว" — delete the screen. Both halves of this test are about the
  // SECOND ask, and the danger it carries is not the deletion. It is that
  // `mustChangePassword` becomes a field nothing on any screen reads, which
  // looks like nothing at all going wrong.
  const app = strip(readFileSync(join(ROOT, 'components/App.jsx'), 'utf8'));

  // 1. NO SCREEN STANDS BETWEEN A SIGN-IN AND THE SHELL. Not the deleted
  //    component, not an early return reading the flag, and not a revival of
  //    either under another name — a second screen with a way past it is the
  //    thing that was asked to go.
  assert.doesNotMatch(app, /FirstLogin[^\n]*\(/, 'the first-login screen is back');
  assert.doesNotMatch(app, /if \(session\.user\.mustChangePassword/, 'the flag gates a screen again');
  assert.doesNotMatch(app, /postponed/, 'the skip state is back, which means the gate is too');

  // 2. AND THE FLAG IS STILL READ, on the landing tab, by the one thing left
  //    that says a รหัสพนักงาน printed on every ใบ OT is this account's
  //    working password.
  assert.match(app, /function PasswordReminder\(/);
  assert.match(app, /tab === home && user\.mustChangePassword && \(/);
  assert.match(app, /<PasswordReminder onOpenProfile=\{openPasswordChange\}/);
  // And that press names the CARD, not just the tab — ข้อมูลส่วนตัว opens at
  // ข้อมูลของคุณ and เปลี่ยนรหัสผ่าน is the fourth card down it. See the jump
  // section in test/profileActions.test.js for the landing itself.
  assert.match(
    app,
    /function openPasswordChange\(\) \{\s*setProfileJump\('password'\);\s*goTab\('profile'\);/,
    'the strip sends somebody to the page without saying which card it meant',
  );

  // Nothing on the way in writes to the flag: it is cleared by typing a new
  // password and by nothing else, least of all by arriving.
  assert.doesNotMatch(app, /mustChangePassword[^\n]*api\.(post|patch)/);

  // …and the page the strip points at says it too, on the form that fixes it —
  // including the sentence the deleted screen carried, which named the issued
  // password outright for whoever was told nothing and guessed.
  const profile = strip(readFileSync(join(ROOT, 'components/ProfileView.jsx'), 'utf8'));
  assert.match(profile, /<ChangePassword\s+pending=\{user\.mustChangePassword\}/);
  assert.match(profile, /\{pending && <>[^]*ซึ่งคือรหัสพนักงานของคุณ/);
  assert.match(profile, /\{pending && !ok && \(/);
  // The amber Alert folds (▲/▼, 2026-09-10), but never the fact: the password
  // in use is the รหัสพนักงาน stays OUTSIDE the hidden half.
  assert.match(
    profile,
    /<div className="alert-fold-text">\s*คุณยังใช้รหัสผ่านที่ฝ่ายบุคคลตั้งให้อยู่ ซึ่งคือรหัสพนักงานของคุณ\s*<span id=\{warnId\} hidden=\{warnFolded\}>/,
    'the warning folds away the one fact it exists to say',
  );
});

// ── the screen may say the value; it may never send one ─────────────────────

test('the browser computes the default to show it, and the server to store it', () => {
  // THE OLD BUG, WHICH IS NOT THE SAME BUG AS THE VALUE BEING GUESSABLE.
  // ตั้งรหัสใหม่ used to prefill a box with `defaultPassword(employee.code)` in
  // the BROWSER and PATCH whatever was left in it, so what an account's
  // password became never came from the server at all. A generator that runs on
  // the client is not a generator, it is a suggestion.
  const screen = strip(readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8'));

  // A reset asks for a reset. It does not carry a value.
  assert.match(screen, /\{ resetPassword: true \}/);
  const patches = [...screen.matchAll(/api\.patch\(`\/employees\/[^`]*`, \{([^}]*)\}/g)];
  assert.ok(patches.length > 0, 'the reset call changed shape');
  for (const [, payload] of patches) {
    assert.doesNotMatch(payload, /password:/, 'the roster screen PATCHes a password value');
  }

  // And no box to type one into on the reset dialog. The quickest way past such
  // a box is a memorable password typed six times.
  assert.doesNotMatch(screen, /label>รหัสผ่านใหม่</);

  // What it MAY do is say the value out loud, which is the point of the change:
  // a sentence naming the rule leaves somebody to work out their own password.
  assert.match(screen, /defaultPassword\(employee\.code\)/, 'the screen never names the value');
});

test('the generator stays on the server, and out of the client bundle', () => {
  // Comments stripped: the module's own prose explains why `Math.random` is
  // wrong, and a check that read the explanation as the code would fail on the
  // file that documents the rule best.
  const gen = strip(readFileSync(join(ROOT, 'lib/tempPassword.js'), 'utf8'));
  assert.match(gen, /from 'node:crypto'/);
  assert.match(gen, /randomInt\(/);
  assert.doesNotMatch(gen, /Math\.random/);

  // lib/employees.js is imported by 'use client' files, so it must not pull
  // `node:crypto` into the browser bundle. `defaultPassword` lives there and
  // needs no crypto — which is exactly why it can, and why the generator still
  // cannot.
  const shared = strip(readFileSync(join(ROOT, 'lib/employees.js'), 'utf8'));
  assert.doesNotMatch(shared, /tempPassword|node:crypto/,
    'lib/employees.js now pulls node:crypto into the client bundle');
  assert.doesNotMatch(shared, /Primus@/, 'the old derived scheme came back');

  // And the screen imports the rule rather than restating it. A second copy of
  // "the password is the code" is a copy that will still say so after the rule
  // changes.
  const screen = readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8');
  assert.match(screen, /defaultPassword,?\s*[^}]*\} from '@\/lib\/employees\.js'|\{[^}]*defaultPassword[^}]*\} from '@\/lib\/employees\.js'/s);
  assert.doesNotMatch(strip(screen), /generateTempPassword/, 'the roster screen generates a password');
});

test('the one caller of the generator left is the console recovery for ADMIN', () => {
  // Pinned from this side as well as from test/permissionRouteGuards.test.js,
  // because the failure is silent in both directions: a reset-admin that
  // started using `defaultPassword` would set the recovery account's password
  // to a string printed on the roster, and a route that went back to
  // `generateTempPassword` would hand HR a random value again with no screen
  // saying so.
  const files = [
    'app/api/employees/route.js', 'app/api/employees/[id]/route.js',
    'app/api/employees/import/route.js', 'legacy/routes/employees.js',
    'components/AdminView.jsx', 'lib/employees.js',
  ];
  for (const file of files) {
    assert.doesNotMatch(strip(readFileSync(join(ROOT, file), 'utf8')), /generateTempPassword/, file);
  }
  const script = strip(readFileSync(join(ROOT, 'src/reset-admin-password.js'), 'utf8'));
  assert.match(script, /generateTempPassword\(\)/);
  assert.doesNotMatch(script, /defaultPassword/,
    'the ADMIN recovery hands out a password computable from the roster');
});

// ── the generator itself, which still serves reset-admin ────────────────────

test('two passwords are not the same password', () => {
  // Sampled rather than compared twice: a generator that returned a per-process
  // constant would pass a single !== and fail here.
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(generateTempPassword());
  assert.equal(seen.size, 200, 'พบรหัสผ่านซ้ำในการสุ่ม 200 ครั้ง');
});

test('nothing about the employee is in it — not the code, not the company', () => {
  // The failure this generator was built for, stated directly. Every one of
  // these appeared in the old value: `Primus@PM0412` carried the company name
  // AND the code. It matters more now, not less: this is the ADMIN recovery.
  const forbidden = [
    'primus', 'themtech', 'pm', 'tht', 'ot', 'hr', 'admin',
    'PM-0412', 'PM0412', '0412', 'somchai', 'สมชาย',
  ];
  for (let i = 0; i < 200; i += 1) {
    const password = generateTempPassword().toLowerCase();
    for (const needle of forbidden) {
      // 'pm', 'ot' and 'hr' are two-letter sequences a random consonant run
      // could produce by chance — but the alphabet has no 'm' after 'p' rule to
      // prevent it, so this is checked as a substring of the BLOCK structure:
      // any occurrence means the value could be read as carrying it.
      if (needle.length <= 2) continue;
      assert.equal(password.includes(needle.toLowerCase()), false, `${password} contains ${needle}`);
    }
  }
});

test('it is not a function of the employee — the generator cannot even see one', () => {
  // The structural version of the test above, and the one that actually holds:
  // a generator that takes no arguments cannot derive anything from the row.
  // This is why `generateTempPassword()` has an empty parameter list on purpose.
  assert.equal(generateTempPassword.length, 0);
});

test('no glyph anybody misreads down a phone', () => {
  // 0/O, 1/l/I. This one is read off a server console and typed at a login
  // screen, often by two different people — a password that cannot be
  // transcribed comes back as a second call, or as a note stuck to the monitor.
  for (let i = 0; i < 200; i += 1) {
    const password = generateTempPassword();
    for (const glyph of AMBIGUOUS_GLYPHS) {
      assert.equal(password.includes(glyph), false, `${password} contains ${glyph}`);
    }
    // Lowercase throughout, which is what removes the caps-lock failure at the
    // login screen and the "was that a capital O" question with it.
    assert.equal(password, password.toLowerCase());
  }
});

test('long enough to be a password, shaped to be read aloud', () => {
  for (let i = 0; i < 50; i += 1) {
    const password = generateTempPassword();
    assert.ok(password.length >= PASSWORD_MIN_LENGTH, password);
    // Three sayable consonant-vowel-consonant blocks and one run of digits.
    assert.match(password, /^[a-z]{3}-[a-z]{3}-[a-z]{3}-\d{4}$/, password);
  }
});

test('the whole alphabet gets used — no position is stuck', () => {
  // A modulo-biased or mis-indexed pick would show up as a character that never
  // appears. Loose bounds, because this is a randomness smoke test rather than
  // a distribution test.
  const chars = new Set();
  for (let i = 0; i < 500; i += 1) for (const ch of generateTempPassword()) chars.add(ch);
  assert.ok(chars.size >= 25, `เห็นตัวอักษรเพียง ${chars.size} แบบ`);
});

// ── a reset that fails must leave the old password working ─────────────────

/**
 * THE WRITE IS THE LAST THING THAT CAN FAIL, AND IT HAS TO STAY THAT WAY.
 *
 * The hash used to be set on the document and committed by the same `save()`
 * that wrote the roster fields — with the birthday replay, the populate and the
 * response still to come. Any of those throwing gave HR a 500 and the employee a
 * password that existed nowhere.
 *
 * That was written when losing the value meant losing the account. It costs
 * less now — the value is the employee code — and it is kept exactly as it was
 * anyway, because "the hash moved and the response said it had not" is still a
 * lie told to the person who asked, and because the App Router's PATCH can
 * change the รหัสพนักงาน in the same request, which is the one case where the
 * new password is NOT recoverable from the row the caller was looking at.
 *
 * Pinned as an ordering because that is what the property IS. There is no
 * transaction here and a single-document update needs none — what it needs is
 * for nothing fallible to sit between the write and the response.
 */
test('a reset writes the new hash last, after everything else has succeeded', () => {
  /**
   * Just the handler that resets, in each file.
   *
   * The Express router also creates accounts and changes people's own
   * passwords, and both of those legitimately set a password on a document —
   * neither has anything to lose, because the create's password is returned by
   * the same statement that saves it and the self-change was typed by the
   * person doing it. Reading the whole file would fail on their `setPassword`
   * and, worse, would find the create's `save()` first and make the ordering
   * checks below pass for free.
   */
  const handlers = {
    // One handler in the file.
    'app/api/employees/[id]/route.js': (src) => src,
    'legacy/routes/employees.js': (src) => src.slice(
      src.indexOf("router.patch('/:id'"),
      src.indexOf("router.post('/me/password'"),
    ),
  };

  for (const [file, take] of Object.entries(handlers)) {
    const code = take(strip(readFileSync(join(ROOT, file), 'utf8')));
    assert.ok(code.includes('resetPassword'), `${file}: cannot find the reset handler`);

    // Hashed early, held as a local. `setPassword` puts it on the document,
    // and a document carrying a new hash is one stray save() from committing it.
    assert.match(code, /Employee\.hashPassword\(issued\)/, `${file} does not hash ahead of the write`);
    assert.doesNotMatch(
      code, /employee\.setPassword\(/,
      `${file} puts the new hash back on the document, where any save() commits it`,
    );

    const at = {
      save: code.indexOf('await employee.save()'),
      populate: code.indexOf("employee.populate('department'"),
      write: code.indexOf('Employee.updateOne('),
      audit: code.indexOf('await recordRosterChange('),
      respond: code.search(/return (json|res\.json)\(/),
    };
    // The birthday replay only exists on the App Router — this router accepts
    // no วันเกิด. Skipped rather than asserted absent, so adding it later is
    // covered by the same ordering instead of quietly escaping it.
    const recompute = code.indexOf('await recomputeEntries(');
    for (const [name, index] of Object.entries(at)) {
      assert.ok(index > 0, `${file}: cannot find ${name}`);
    }

    assert.ok(at.save < at.write, `${file}: the roster save commits the password with it`);
    assert.ok(at.populate < at.write, `${file}: a failed populate would strand the new password`);
    if (recompute > 0) {
      assert.ok(recompute < at.write, `${file}: a failed birthday replay would strand the new password`);
    }
    assert.ok(at.write < at.audit, `${file}: the trail records a reset the write could still refuse`);
    assert.ok(at.write < at.respond, `${file}: the response is sent before the password is stored`);
  }
});

/**
 * The dialog, which is now two steps: say what the password will become, then
 * say what it became.
 *
 * WHAT WAS HERE UNTIL 2026-09-02. The second step was a vault. The value was
 * random and stored only as a hash, so the dialog held a จดรหัสผ่านไว้แล้ว tick
 * that gated เสร็จสิ้น, and ×, Escape and the backdrop all went through the
 * Modal's `dirty` guard. (That machinery was itself a fix: the value used to be
 * handed up to the roster screen, which rendered it in a notice at the top of a
 * card the clicker had long scrolled past. PM-00511 was reset twice inside a
 * minute on dev and locked out both times.)
 *
 * None of it is load-bearing for a password printed on the person's own card,
 * and it is gone — pinned in test/modalCloseButton.test.js, which is where the
 * rule about every dialog's exits lives. What is pinned here is the half that
 * did not change: the value on screen is the SERVER's, and the confirmation
 * names it before anything is written.
 */
test('the reset dialog confirms the value first, then shows what was stored', () => {
  const screen = strip(readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8'));
  const start = screen.indexOf('function ResetPassword(');
  assert.ok(start > 0, 'ResetPassword is gone');
  const dialog = screen.slice(start, screen.indexOf('function Holidays(', start));

  // Step one names both halves of the question — who, and what it becomes.
  assert.match(dialog, /คุณต้องการรีเซ็ตรหัสผ่านของ/, 'the confirmation stopped asking');
  assert.match(dialog, /\{employee\.name\}/, 'the confirmation does not name the employee');
  assert.match(dialog, /\{defaultPassword\(employee\.code\)\}/, 'the confirmation does not name the value');

  // Step two renders what came BACK, not what step one predicted. The two agree
  // today; the day they stop agreeing, the screen must be wrong about its own
  // prediction rather than about what the account now accepts.
  assert.match(dialog, /setPassword\(res\.password\)/, 'the dialog does not hold what the server set');
  assert.match(dialog, /\{password\}/, 'the dialog never renders the stored value');
  assert.match(dialog, /navigator\.clipboard\?\.writeText/, 'no way to copy it');
  assert.match(dialog, /รีเซ็ตรหัสผ่านของ \{employee\.name\} เรียบร้อยแล้ว/, 'no success notification');

  // A 200 that carried no password would mean the hash had moved and the server
  // had done something this screen cannot describe. Said out loud rather than
  // rendered as an empty box.
  assert.match(dialog, /if \(!res\.password\)/, 'a passwordless response is shown as a blank');
});

test('รีเซ็ตรหัสผ่าน is on the record as well as on the row, under the same two refusals', () => {
  // Asked for on 2026-09-02: somebody dealing with "สมชายเข้าระบบไม่ได้" opens
  // the person's record, and what they used to find there was a sentence
  // telling them to close the dialog and find a button in the table.
  const raw = readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8');
  const screen = strip(raw);

  const start = screen.indexOf('function EditEmployee(');
  assert.ok(start > 0, 'EditEmployee is gone');
  const dialog = screen.slice(start, screen.indexOf('\nfunction ', start + 10));
  assert.match(dialog, /onClick=\{onReset\}/, 'the record has no reset button');

  // The same two refusals the table applies, derived from what the dialog
  // already knows rather than passed in — so the two buttons cannot come to
  // different answers about one row.
  assert.match(dialog, /const mayReset = !rowLocked && !isSelf;/);
  assert.match(dialog, /disabled=\{busy \|\| !mayReset \|\| changes\.length > 0\}/,
    'the record button can close this dialog over unsaved typing');

  // Handing off closes the edit dialog rather than stacking a second modal on
  // it — and takes nothing with it, because the button above waits for a clean
  // form.
  const wiring = raw.slice(raw.indexOf('<EditEmployee'), raw.indexOf('/>', raw.indexOf('onReset=')));
  assert.match(wiring, /onReset=\{\(\) => \{\s*setResetting\(editing\);\s*setEditing\(null\);/s);
});

test('the issued password is still never written to the audit trail', () => {
  // The allowlist in lib/rosterAudit.js is what guarantees this and is pinned
  // by test/rosterAudit.test.js. Checked again from this side because the
  // routes hold a plaintext password in a local called `issued`, which is a
  // thing somebody reaches for when adding a field to the record.
  //
  // Unchanged by the value being the employee code: `code` is already an
  // audited field, and a record that ALSO carried it as a password would be a
  // record that stays wrong the day the default changes again.
  for (const file of ['app/api/employees/[id]/route.js', 'app/api/employees/import/route.js', 'legacy/routes/employees.js']) {
    const code = strip(readFileSync(join(ROOT, file), 'utf8'));
    const calls = [...code.matchAll(/recordRosterChange\(\{[\s\S]*?\n\s*\}\)/g)].map((m) => m[0]);
    for (const call of calls) {
      // `Boolean(issued)` is the one permitted mention: it says a reset
      // happened and carries no value. Anything else is the value itself.
      const withoutFlag = call.replace(/passwordReset: Boolean\(issued\),?/g, '');
      assert.doesNotMatch(withoutFlag, /\bissued\b/, `${file} passes the issued password into the trail`);
    }
  }
});

test('a bulk import’s passwords can leave the screen without a round trip', () => {
  // Two hundred passwords read off a screen and retyped is not a thing anybody
  // does — what they do instead is import in batches of five, or screenshot the
  // page. So there is a copy and a download, and both are built from rows the
  // component already holds: round-tripping would put the passwords back on the
  // wire and give them a URL.
  const screen = strip(readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8'));

  assert.match(screen, /function IssuedPasswords\(/);
  assert.match(screen, /navigator\.clipboard\?\.writeText/);
  assert.match(screen, /new Blob\(\[csv\], \{ type: 'text\/csv;charset=utf-8' \}\)/);
  // Built locally through the shared writer — never fetched back from a route.
  assert.match(screen, /toCsv\(ISSUED_HEADERS, rows\.map/);
  assert.doesNotMatch(screen, /api\.(get|post|download)\([^)]*password/i, 'passwords are re-fetched from the server');
});

test('the downloaded file says what it is, in the one place that travels with it', () => {
  // The on-screen warning is read once, by somebody about to click away. The
  // file gets opened next week, possibly by somebody else. The filename is the
  // only part of this that goes with the data.
  //
  // KEPT WORD FOR WORD through the 2026-09-02 change, and it is the part a
  // guessable default does not soften: a CSV of working passwords against real
  // names, sitting in Downloads, is a file worth deleting whatever the
  // passwords are made of.
  const screen = strip(readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8'));
  assert.match(screen, /ISSUED_FILENAME = 'temporary-passwords-DELETE-AFTER-HANDOUT\.csv'/);

  // And the screen says it too, at the moment the file appears rather than
  // before — a warning shown before the click is a warning about a hypothetical.
  const raw = readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8');
  const block = raw.slice(raw.indexOf("done === 'downloaded'"), raw.indexOf("done === 'failed'"));
  assert.match(block, /ลบทิ้งทันทีที่แจกเสร็จ/);
  assert.match(block, /อย่าส่งต่อทางอีเมลหรือแชท/);
});

// ── the repair for the rows that predate the rule ───────────────────────────

/**
 * `npm run migrate:first-password` may only touch an account NOBODY CAN LOG
 * INTO.
 *
 * This is the whole of what keeps it from being the script
 * src/reset-admin-password.js refuses to be — "a script that would reset
 * anybody turns 'has a shell on this server' into 'is any employee'". The
 * refusal is a pure function so both halves can be pinned here without a
 * database, and a future edit that drops either half fails this test rather
 * than being noticed by whoever loses an account to it.
 */
test('the first-password repair skips every row somebody can already use', () => {
  const row = (over) => ({ code: 'PM-0620', mustChangePassword: true, ...over });

  // The only shape it touches: flag still set, and the code does not open it.
  assert.equal(repairRefusal(row(), false), null);

  // The flag is cleared by POST /api/employees/me/password and by nothing else
  // — and that route asks for the CURRENT password. A cleared flag is therefore
  // proof that the person holding the account had it, so this is where an
  // account in daily use is protected. Seeded rows are on this branch too:
  // src/seed.js never sets the flag.
  assert.notEqual(repairRefusal(row({ mustChangePassword: false }), false), null);

  // Already on the current rule — left alone rather than re-hashed, which is
  // what makes a second run a no-op instead of a fresh round of writes.
  assert.notEqual(repairRefusal(row(), true), null);

  // Both reasons to skip, and a missing row, still answer with a sentence
  // rather than throwing: this runs inside a loop over the whole roster.
  assert.notEqual(repairRefusal(row({ mustChangePassword: false }), true), null);
  assert.notEqual(repairRefusal(null, false), null);
});

test('the repair writes the same value the routes issue, and keeps the flag up', () => {
  const src = strip(readFileSync(join(ROOT, 'src/migrate-first-password.js'), 'utf8'));

  // `defaultPassword(employee.code)` — the stored, trimmed, upper-cased code,
  // exactly as the three routes read it. A migration that built the value some
  // other way would leave rows that disagree with the screen showing them.
  assert.match(src, /defaultPassword\(employee\.code\)/);
  assert.doesNotMatch(src, /generateTempPassword|Primus@|Math\.random/,
    'the repair grew a second password scheme');

  // `mustChangePassword: true` goes down with the hash in ONE $set. The flag is
  // the entire price paid for a guessable default (README §รหัสผ่านแรกเข้า), so
  // a repair that issued the value without it would be handing out passwords
  // with nothing left saying they are temporary.
  assert.match(src, /\$set: \{ passwordHash, mustChangePassword: true \}/);

  // It writes nothing without being asked twice — the line every migration in
  // src/ carries, and this one writes credentials.
  assert.match(src, /--yes/);
  assert.match(src, /--dry/);
});

/** Comments say what the code should do; these tests are about what it does. */
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
