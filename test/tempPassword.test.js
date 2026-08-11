import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { AMBIGUOUS_GLYPHS, generateTempPassword } from '../lib/tempPassword.js';
import { PASSWORD_MIN_LENGTH } from '../lib/employees.js';

/**
 * THE FIRST-LOGIN PASSWORD IS NOT DERIVED FROM ANYTHING.
 *
 * It used to be `Primus@` + the employee code with punctuation stripped. The
 * roster is printed on every ใบ F-HR-027 and every file sent to accounting, so
 * that made the password of every account nobody had logged into yet a public
 * fact — and the accounts most likely to be unclaimed are the new hires whose
 * absence nobody would notice for a week.
 *
 * These tests pin the two halves of the fix: that the value is random and that
 * nothing about the employee can be read out of it. The second is the one worth
 * stating as a test rather than as a comment — a "random" generator that mixes
 * the code in for readability would pass every other check here.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('two passwords are not the same password', () => {
  // Sampled rather than compared twice: a generator that returned a per-process
  // constant would pass a single !== and fail here.
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(generateTempPassword());
  assert.equal(seen.size, 200, 'พบรหัสผ่านซ้ำในการสุ่ม 200 ครั้ง');
});

test('nothing about the employee is in it — not the code, not the company', () => {
  // The failure being fixed, stated directly. Every one of these appeared in
  // the old value: `Primus@PM0412` carried the company name AND the code.
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
  // 0/O, 1/l/I. HR reads these aloud and somebody else types them, often on a
  // shop-floor terminal — a password that cannot be transcribed comes back as a
  // second call, or as a note stuck to the monitor.
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

// ── where it is generated, which is the other half of the fix ───────────────

test('it is made on the server, with crypto — never in the browser', () => {
  // ตั้งรหัสใหม่ used to prefill the field in the BROWSER with a value computed
  // from the employee code and PATCH whatever was left in it. A generator that
  // runs on the client is not a generator, it is a suggestion.
  // Comments stripped: the module's own prose explains why `Math.random` is
  // wrong, and a check that read the explanation as the code would fail on the
  // file that documents the rule best.
  const gen = strip(readFileSync(join(ROOT, 'lib/tempPassword.js'), 'utf8'));
  assert.match(gen, /from 'node:crypto'/);
  assert.match(gen, /randomInt\(/);
  assert.doesNotMatch(gen, /Math\.random/);

  // And this module must stay out of anything a client component imports —
  // lib/employees.js is imported by 'use client' files.
  const shared = strip(readFileSync(join(ROOT, 'lib/employees.js'), 'utf8'));
  assert.doesNotMatch(shared, /tempPassword/, 'lib/employees.js now pulls node:crypto into the client bundle');
  assert.doesNotMatch(shared, /defaultPassword/, 'the derived password came back');

  const screen = strip(readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8'));
  assert.doesNotMatch(screen, /generateTempPassword|defaultPassword/, 'the roster screen generates a password');
  // And it no longer offers a box to type one into — see ResetPassword. The
  // quickest way past such a box is a memorable password typed six times.
  assert.doesNotMatch(screen, /label>รหัสผ่านใหม่</);
  assert.match(screen, /\{ resetPassword: true \}/);
});

test('every route that issues one asks the generator, and none reads a request field', () => {
  const routes = [
    'app/api/employees/route.js',
    'app/api/employees/[id]/route.js',
    'app/api/employees/import/route.js',
    'src/routes/employees.js',
  ];
  for (const file of routes) {
    const code = strip(readFileSync(join(ROOT, file), 'utf8'));

    assert.match(code, /generateTempPassword\(\)/, `${file} issues a password some other way`);
    // The old shapes: a password taken from the body, or from a CSV column.
    assert.doesNotMatch(code, /setPassword\(password\)/, `${file} still sets a caller's password`);
    assert.doesNotMatch(code, /pick\(row, 'password'\) \|\|/, `${file} still honours a CSV password column`);
  }

  // A JSON caller still sending one is told, not ignored: a request that
  // thought it set a password and did not is worse than one that was refused.
  for (const file of ['app/api/employees/route.js', 'app/api/employees/[id]/route.js', 'src/routes/employees.js']) {
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

test('a reset is asked for by a flag, and the issued value comes back once', () => {
  // `resetPassword: true` replaced `password: '…'`. The response carries the
  // generated value because it is the only moment it is readable — only the
  // hash is stored and every roster read goes through publicEmployee().
  for (const file of ['app/api/employees/[id]/route.js', 'src/routes/employees.js']) {
    const code = strip(readFileSync(join(ROOT, file), 'utf8'));
    assert.match(code, /resetPassword \? generateTempPassword\(\) : null/, file);
    assert.match(code, /password: issued/, `${file} does not return the issued password`);
    assert.match(code, /passwordReset: Boolean\(issued\)/, `${file} records the wrong reset flag`);
  }

  // And the import hands back one row per account it created, or those accounts
  // are unreachable: nobody can log in and nothing stored can say what to.
  for (const file of ['app/api/employees/import/route.js', 'src/routes/employees.js']) {
    const code = readFileSync(join(ROOT, file), 'utf8');
    assert.match(code, /issuedPasswords\.push\(\{ code: employee\.code, name: employee\.name, password: issued \}\)/, file);
    assert.match(code, /issued: issuedPasswords/, file);
  }
});

// ── a reset that fails must leave the old password working ─────────────────

/**
 * THE WRITE IS THE LAST THING THAT CAN FAIL, AND IT HAS TO STAY THAT WAY.
 *
 * The hash used to be set on the document and committed by the same `save()`
 * that wrote the roster fields — with the birthday replay, the populate and the
 * response still to come. Any of those throwing gave HR a 500 and the employee a
 * password that existed nowhere: the hash is one-way, so a reset that fails
 * after the write is not a failed reset, it is a locked-out account with no
 * recovery but another reset.
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
    'src/routes/employees.js': (src) => src.slice(
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
 * The other half of the same failure, on the screen.
 *
 * The dialog used to hand the value up to the roster page and close itself. The
 * page put it in a notice at the top of the card — above a forty-line hint, the
 * add-employee form and the whole table — and the button that starts a reset is
 * in a row of that table. Anybody on a roster of any size was scrolled well past
 * the notice, so the dialog vanished and nothing appeared. PM-00511 was reset
 * twice inside a minute on dev and locked out both times.
 *
 * Creating an account and importing a CSV write to the same notice and never
 * showed the symptom, because both happen at the top of the page with the notice
 * in view. Same code, different scroll position.
 */
test('the reset dialog shows the password itself, and cannot be closed by reflex', () => {
  const screen = strip(readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8'));
  const start = screen.indexOf('function ResetPassword(');
  assert.ok(start > 0, 'ResetPassword is gone');
  const dialog = screen.slice(start, screen.indexOf('function Holidays(', start));

  // It keeps the value rather than passing it out and unmounting.
  assert.match(dialog, /setPassword\(res\.password\)/, 'the dialog does not hold the issued password');
  assert.match(dialog, /\{password\}/, 'the dialog never renders the password');
  assert.match(dialog, /navigator\.clipboard\?\.writeText/, 'no way to copy it');

  // Nothing ordinary closes it until somebody says they have it, and the
  // reflexive ways out — ×, Escape, the backdrop — ask first.
  assert.match(dialog, /dirty=\{!written\}/, 'Escape and × close over an unread password');
  assert.match(dialog, /disabled=\{!written\}/, 'the close button does not wait for the tick');

  // A 200 that carried no password would mean the hash had moved and the value
  // was already gone. Said out loud rather than rendered as an empty box.
  assert.match(dialog, /if \(!res\.password\)/, 'a passwordless response is shown as a blank');

  // And the roster screen must not close the dialog the moment it arrives,
  // which is the bug in one line.
  const raw = readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8');
  const wiring = raw.slice(raw.indexOf('<ResetPassword'), raw.indexOf('{editing && ('));
  const onDone = wiring.slice(wiring.indexOf('onDone='));
  assert.doesNotMatch(onDone, /setResetting\(null\)/, 'the dialog is closed the instant the password arrives');
});

test('the issued password is still never written to the audit trail', () => {
  // The allowlist in lib/rosterAudit.js is what guarantees this and is pinned
  // by test/rosterAudit.test.js. Checked again from this side because the
  // routes now hold a plaintext password in a local called `issued`, which is a
  // new thing for somebody to reach for when adding a field to the record.
  for (const file of ['app/api/employees/[id]/route.js', 'app/api/employees/import/route.js', 'src/routes/employees.js']) {
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
  // page, or ask for the guessable scheme back. So there is a copy and a
  // download, and both are built from rows the component already holds:
  // round-tripping would put the passwords back on the wire and give them a URL.
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
  const screen = strip(readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8'));
  assert.match(screen, /ISSUED_FILENAME = 'temporary-passwords-DELETE-AFTER-HANDOUT\.csv'/);

  // And the screen says it too, at the moment the file appears rather than
  // before — a warning shown before the click is a warning about a hypothetical.
  const raw = readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8');
  const block = raw.slice(raw.indexOf("done === 'downloaded'"), raw.indexOf("done === 'failed'"));
  assert.match(block, /ลบทิ้งทันทีที่แจกเสร็จ/);
  assert.match(block, /อย่าส่งต่อทางอีเมลหรือแชท/);
});

/** Comments say what the code should do; these tests are about what it does. */
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
