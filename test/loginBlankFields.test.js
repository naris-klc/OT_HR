import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * เข้าสู่ระบบ — ช่องที่ยังว่าง บอกด้วยตัวหนังสือใต้ช่อง ไม่ใช่ป้ายของเบราว์เซอร์.
 *
 * WHAT WAS THERE BEFORE. Both boxes carried `required` and nothing else, so
 * pressing เข้าสู่ระบบ with one of them empty got the browser's own bubble —
 * "โปรดกรอกฟิลด์นี้" in Chrome, a different sentence in every other browser,
 * floating in the browser's chrome above the page. It is the one mark on this
 * screen that no stylesheet in this repo can reach: it cannot be given the
 * app's ink, it cannot be worded, it disappears at the next click, and it shows
 * ONE field at a time — with both boxes empty it points at the first and leaves
 * the second to be discovered by pressing the button again.
 *
 * WHAT IS THERE NOW. `noValidate` on the <form> turns the bubble off, and
 * `submit` does the same check in this page's own words: a red rule round each
 * empty box and a sentence under it naming the box. `required` STAYS on both
 * inputs — it is what tells a screen reader the field is not optional, and it
 * is not what was wrong.
 *
 * These pin the three halves that can drift apart: the browser's validation
 * stays off, the marks are put on and taken off at the right moments, and the
 * red is the app's own token rather than a hex typed at the rule.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
const jsx = readFileSync(join(ROOT, 'components/App.jsx'), 'utf8');

/** The Login component only — every other form in this file is a different one. */
const login = jsx.slice(jsx.indexOf('function Login({ onLogin })'), jsx.indexOf('// ── shell'));
const has = (src, text, why) => assert.ok(src.includes(text), why || `หาไม่เจอ: ${text}`);

/** The one rule that draws the red, read out of the sheet so the assertions below
 *  are about what it says and not about what the file says elsewhere. */
const invalidRule = css.slice(
  css.indexOf('.field input.invalid'),
  css.indexOf('.login-form .field-note.error'),
);

test('the browser does its own validation nowhere on this form', () => {
  has(login, '<form onSubmit={submit} noValidate>');
  // And nothing quietly turned it back on by adding a second <form> without it.
  assert.equal((login.match(/<form /g) || []).length, 1, 'มีมากกว่าหนึ่งฟอร์มในหน้าเข้าสู่ระบบ');
});

test('required stays — it is the screen reader’s copy of the same fact', () => {
  // Two boxes, two `required`. Removing them would silence the bubble too, and
  // would also stop a screen reader ever saying the field is mandatory.
  assert.equal((login.match(/^\s+required$/gm) || []).length, 2);
});

test('each empty box gets its own sentence, in the app and not the browser', () => {
  // Under the box it is about — a .field-note inside the same .field, which is
  // where every other per-field message in this app already sits.
  has(login, '<div className="field-note error" id="login-code-blank">กรุณากรอกรหัสพนักงาน</div>');
  has(login, '<div className="field-note error" id="login-password-blank">กรุณากรอกรหัสผ่าน</div>');
});

test('both boxes are marked at once, not one at a time', () => {
  // The object is what makes this possible: the bubble could only ever point at
  // the first empty field, whatever else was blank behind it.
  has(login, 'const missing = { code: !code.trim(), password: !password.trim() };');
  has(login, 'if (missing.code || missing.password) {');
  has(login, 'setBlanks(missing);');
});

test('a box holding only a space is empty', () => {
  // `.trim()` on both, or the server is asked a question this page can answer —
  // and the throttle counts the attempt. See lib/loginThrottle.js.
  has(login, '!code.trim()');
  has(login, '!password.trim()');
});

test('nothing is sent while a box is blank', () => {
  // The early `return` sits above `setBusy(true)`, so no request goes out and
  // the button never enters its กำลังเข้าสู่ระบบ… state for a blank form.
  const guard = login.slice(login.indexOf('const missing ='), login.indexOf('setBusy(true)'));
  has(guard, 'return;', 'ต้องหยุดก่อนส่งคำขอ');
});

test('the mark clears on the keystroke, not on blur', () => {
  has(login, 'setBlanks((was) => (was[name] ? { ...was, [name]: false } : was));');
  has(login, "onChange={edit('code', setCode)}");
  has(login, "onChange={edit('password', setPassword)}");
  // No onBlur in this form: the mark's whole claim is "this box is empty", and
  // that stops being true at the first character — not when focus moves.
  assert.ok(!login.includes('onBlur'), 'ต้องล้างเครื่องหมายตอนพิมพ์ ไม่ใช่ตอนออกจากช่อง');
});

test('the cursor lands on the first empty box', () => {
  has(login, '(missing.code ? codeRef : passwordRef).current?.focus();');
});

test('a screen reader is told what the border says', () => {
  has(login, 'aria-invalid={blanks.code || undefined}');
  has(login, 'aria-invalid={blanks.password || undefined}');
  has(login, "aria-describedby={blanks.code ? 'login-code-blank' : undefined}");
  has(login, "aria-describedby={blanks.password ? 'login-password-blank' : undefined}");
});

test('a class carries the red, never :invalid', () => {
  has(login, "className={blanks.code ? 'invalid' : undefined}");
  has(login, "className={blanks.password ? 'invalid' : undefined}");
  has(css, '.field input.invalid');
  // THE POINT OF THE CLASS. An empty `required` field matches `:invalid` from
  // the first paint, so styling that selector would open the login screen with
  // both boxes already red — an accusation before anybody has typed anything.
  // Comments stripped first: the rule's own note names the selector it is
  // avoiding, so a search of the raw sheet finds that sentence rather than a
  // declaration. What has to be absent is `:invalid` in a SELECTOR.
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/:invalid\b/.test(selectors), 'CSS ต้องไม่ใช้ :invalid — ช่องว่างจะแดงตั้งแต่เปิดหน้า');
});

test('the red is a token, and it is #EF4444', () => {
  has(css, '--invalid-line: #EF4444;');
  has(css, '--invalid-line: light-dark(#EF4444, #F87171);');
  has(invalidRule, 'border-color: var(--invalid-line);');
  // The rule must not write the hex itself — this app has two themes and a
  // value typed at the rule only has one half.
  assert.ok(!/#[0-9A-Fa-f]{6}/.test(invalidRule), 'สีต้องมาจาก token ไม่ใช่ hex ที่ rule');
});

test('the border says which box, and nothing else does', () => {
  // No fill: a wash behind a box somebody is about to type in reads as
  // disabled, which is the opposite of what is being asked for. No second
  // colour on the focus ring either — `:out-of-range` above leaves it the
  // app's green for the same reason, so one box never wears two states.
  assert.ok(!/background/.test(invalidRule), 'ช่องที่ยังว่างต้องเปลี่ยนแค่เส้นขอบ');
  assert.ok(!/box-shadow/.test(invalidRule), 'วงโฟกัสยังเป็นสีเขียวของแอปตามเดิม');
  // It has to beat `.field input:focus`, which sets border-color at the same
  // specificity — so the :focus half is spelled out rather than left to order.
  has(invalidRule, '.field input.invalid:focus');
});

test('only this panel recolours its .field-note', () => {
  // Scoped to .login-form. Everywhere else .field-note.error keeps the app's
  // warm --danger-ink, because those notes sit beside alerts and chips drawn in
  // it — recolouring all of them to match one form is the tail wagging the dog.
  has(css, '.login-form .field-note.error { color: var(--invalid-ink); }');
  has(css, '.field-note.error { color: var(--danger-ink); }');
});
