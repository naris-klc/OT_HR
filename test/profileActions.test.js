import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ข้อมูลส่วนตัว — the three things the card has to say without being read.
 *
 * ออกจากระบบ throws the session away, บันทึกรหัสผ่านใหม่ commits a change, and
 * the boxes between them are typed on a phone. All three were drawn as the same
 * grey box, which is a screen where nothing looks like what it does. What is
 * pinned here is the drawing, not the behaviour: the classes each button
 * carries, and that the rules those classes name still exist in the stylesheet
 * — a button styled by a rule somebody has since deleted is grey again with
 * every test passing.
 *
 * The components resolve `@/…` through the Next alias, which node --test does
 * not, so these read the files as text like test/settingsCoverageUi.test.js.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = 'components/ProfileView.jsx';
const sourceOf = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
// CRLF on this checkout — a `\n` in a multi-line assertion would otherwise miss
// a rule that is perfectly correct.
const styles = () => readFileSync(join(ROOT, 'app/styles.css'), 'utf8').replace(/\r\n/g, '\n');

// ── ออกจากระบบ ───────────────────────────────────────────────────────────────

test('ออกจากระบบ is the app\'s red-outline voice, not a grey ghost', () => {
  const code = sourceOf(PROFILE);
  assert.match(
    code,
    /className="btn ghost danger" onClick=\{onLogout\}>ออกจากระบบ/,
    'the sign-out button went back to a plain ghost',
  );
});

test('and .btn.ghost.danger still draws red, after .btn.ghost', () => {
  const css = styles();
  const ghost = css.indexOf('.btn.ghost {');
  const danger = css.indexOf('.btn.ghost.danger {');
  assert.ok(danger > 0, '.btn.ghost.danger is gone — the button is grey again');
  assert.ok(danger > ghost, '.btn.ghost.danger must come after .btn.ghost to win on order');
  assert.match(
    css.slice(danger, danger + 220),
    /color: var\(--danger-ink\); border-color: var\(--danger-line\)/,
  );
});

// ── บันทึกรหัสผ่านใหม่ ──────────────────────────────────────────────────────

test('the submit button is the plain green .btn — no variant to dilute it', () => {
  const code = sourceOf(PROFILE);
  assert.match(code, /<button className="btn" disabled=\{busy \|\| !ready\}>/);
  // ready is what turns it green; the four conditions are the whole gate.
  assert.match(
    code,
    /const ready = current && next\.length >= MIN_LENGTH && next === confirm && !unchanged;/,
  );
});

test('a grey button says why it is grey — and stands down when a field already has', () => {
  const code = sourceOf(PROFILE);
  assert.match(
    code,
    /\{!ready && !busy && !tooShort && !unchanged && !mismatch && \(/,
    'the readiness note must not talk over a field-level error',
  );
  assert.match(code, /ปุ่มจึงจะเป็นสีเขียวและกดบันทึกได้/);
  assert.match(styles(), /\.profile-submit \{[^}]*align-items: flex-start[^}]*\}/);
});

// ── the boxes ───────────────────────────────────────────────────────────────

test('each password field labels in Thai and places the English in the box', () => {
  const code = sourceOf(PROFILE);
  for (const [th, en] of [
    ['รหัสผ่านเดิม', 'CURRENT PASSWORD'],
    ['รหัสผ่านใหม่', 'NEW PASSWORD'],
    ['ยืนยันรหัสผ่านใหม่', 'CONFIRM'],
  ]) {
    assert.ok(code.includes(`<label>${th}</label>`), `${th} lost its own label`);
    assert.ok(code.includes(`placeholder="${en}"`), `${en} is not the placeholder`);
  }
  // And the doubled label is not back.
  assert.ok(!/·\s*(CURRENT PASSWORD|NEW PASSWORD|CONFIRM)/.test(code));
});

test('the placeholder is dressed as a sub-label, and only in this form', () => {
  const css = styles();
  assert.match(css, /\.profile-form input::placeholder \{[^}]*var\(--mono\)[^}]*\}/);
  // Scoped: the rest of the app's placeholders are sample values, not labels.
  assert.equal((css.match(/input::placeholder/g) || []).length, 1);
});

test('the phone tightens the gaps and nothing else', () => {
  const css = styles();
  const at = css.indexOf('@media (max-width: 640px) {\n  .profile-form');
  assert.ok(at > 0, 'the phone layout for เปลี่ยนรหัสผ่าน is gone');
  const block = css.slice(at).split(/^}/m)[0];
  assert.match(block, /\.profile-form \{ gap: 10px; max-width: none; \}/);
  assert.match(block, /\.profile-form \.field \{ gap: 5px; \}/);
  // The boxes themselves keep their height — a thumb has to hit them.
  assert.ok(!/padding/.test(block), 'the phone rule started resizing the inputs');
});
