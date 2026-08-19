import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ปุ่มดวงตาในช่องรหัสผ่าน — the two things about it that cannot be seen.
 *
 * Everything else about this control is visible in a screenshot: the icon, where
 * it sits, whether it changes when pressed. These two are not, and both are
 * failures somebody would meet as a mystery rather than as a bug in a button.
 *
 *   `type="button"` — without it the eye is a SUBMIT button, because that is
 *   what a <button> in a <form> defaults to. Pressing it posts the form
 *   half-typed: on the login page that spends an attempt against the throttle
 *   in lib/loginThrottle.js, which counts a wrong password whether or not
 *   anybody meant to send one, and three of those lock the account out.
 *
 *   THREE FLAGS ON เปลี่ยนรหัสผ่าน — one would put the old password on screen
 *   as a side effect of checking the new one, which is a different secret being
 *   revealed by a control nobody aimed at it.
 *
 * Read as source text for the reason test/passwordSlips.test.js is: the screens
 * resolve `@/…` through the Next alias and cannot be imported by `node --test`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const common = read('components/common.jsx');
const profile = read('components/ProfileView.jsx');
const app = read('components/App.jsx');

/** The `PasswordInput` body only — another button's type must not stand in. */
const control = common.slice(
  common.indexOf('export function PasswordInput'),
  common.indexOf('export function TipButton'),
);

test('the eye is type="button" — it must never submit the form it sits in', () => {
  assert.ok(control.length > 0, 'PasswordInput หายไปจาก common.jsx');
  assert.match(control, /type="button"/);
  // And the input's own type is driven by the flag, not written down.
  assert.match(control, /type=\{shown \? 'text' : 'password'\}/);
});

test('the icon agrees with the state it announces', () => {
  // aria-pressed reports STATE, so the picture has to be the state too.
  assert.match(control, /aria-pressed=\{shown\}/);
  assert.match(control, /name=\{shown \? 'eye' : 'eyeOff'\}/);
  // The label stays put and the tooltip carries the action — see the note over
  // the component.
  assert.match(control, /aria-label="แสดงรหัสผ่าน"/);
  assert.match(control, /title=\{shown \? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'\}/);
});

/* Plain string containment rather than regexes built from template literals:
   `\(` and `\w` inside a template are eaten before RegExp ever sees them, so a
   pattern assembled that way quietly matches something looser than it reads
   as. It cost one run of this file to find out. */
const has = (src, text, why) => assert.ok(src.includes(text), why || `หาไม่เจอ: ${text}`);

test('เปลี่ยนรหัสผ่าน keeps the three boxes independent', () => {
  for (const flag of ['showCurrent', 'showNext', 'showConfirm']) {
    has(profile, `[${flag}, set`, `${flag} หายไป`);
  }
  // Each box gets its own flag — the same one twice would tie two secrets
  // together, which is the failure the three exist to prevent.
  const shown = [...profile.matchAll(/shown=\{(show\w+)\}/g)].map((m) => m[1]);
  assert.deepEqual(shown, ['showCurrent', 'showNext', 'showConfirm']);
  // And no bare password box is left behind on the form.
  assert.doesNotMatch(profile, /type="password"/);
});

test('every box starts hidden, and nothing remembers otherwise', () => {
  for (const [flag, setter] of [
    ['showCurrent', 'setShowCurrent'],
    ['showNext', 'setShowNext'],
    ['showConfirm', 'setShowConfirm'],
  ]) {
    has(profile, `[${flag}, ${setter}] = useState(false)`, `${flag} ไม่ได้เริ่มที่ซ่อน`);
  }
  has(app, '[passwordShown, setPasswordShown] = useState(false)');
  // No storage anywhere near it: a revealed box must not survive a reload.
  assert.doesNotMatch(control, /localStorage|sessionStorage/);
});

test('the login page and the change form use the one control', () => {
  // Two copies of a control whose job is to put a password on screen is one
  // copy too many — see the note over PasswordInput.
  assert.match(app, /<PasswordInput/);
  assert.match(profile, /<PasswordInput/);
  assert.doesNotMatch(app, /className="reveal"/, 'the login page still has its own copy');
  assert.doesNotMatch(profile, /className="reveal"/);
});

test('the wrapper keeps the eye off the text being typed', () => {
  const css = read('app/styles.css');
  const rules = css.slice(css.indexOf('.password-field {'), css.indexOf('.roster-find'));
  assert.match(rules, /\.password-field \{[^}]*position: relative/);
  // The input is padded out of the button's way rather than the button being
  // laid over the text — 42px against a 34px button parked 5px from the edge.
  assert.match(rules, /\.password-field input \{ padding-right: 42px/);
  assert.match(rules, /\.password-field \.reveal \{[\s\S]*?position: absolute; right: 5px/);
});
