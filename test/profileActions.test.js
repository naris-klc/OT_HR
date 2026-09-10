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
const APP = 'components/App.jsx';
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
  /**
   * `ready` is what turns it green, and the four conditions are the whole gate.
   *
   * The length half read `next.length >= MIN_LENGTH` until 2026-09-02, when the
   * server grew a character set and a byte ceiling alongside the length and the
   * form started asking `passwordShapePermission` — the same function, imported
   * rather than restated, so the button and the 400 cannot disagree about what
   * is typeable. `next.length > 0` is still here beside it because the shared
   * rule is only consulted once something has been typed: an empty box is not
   * scolded for being empty before anybody has had a turn.
   */
  assert.match(
    code,
    /const ready = current && next\.length > 0 && shape\.ok && next === confirm && !unchanged;/,
  );
  assert.match(code, /passwordShapePermission\(next\)/, 'the form checks a rule of its own');
});

test('a grey button says why it is grey — and stands down when a field already has', () => {
  const code = sourceOf(PROFILE);
  assert.match(
    code,
    /\{!ready && !busy && shape\.ok && !unchanged && !mismatch && \(/,
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

  /**
   * Scoped: the rest of the app's placeholders are sample values, not labels.
   *
   * This was a count of one. It is a list now, because a second scoped rule
   * arrived that is not a counter-example to any of the above: `.searchbox`
   * sets a COLOUR and nothing else, on the three boxes that are typed into, so
   * a prompt and a real query are never the same weight of text. What the
   * count was really guarding is the blanket rule neither of them is — one
   * `.field input::placeholder` would dress every sample value in the app as
   * a sub-label — so that is what is asserted instead of an arithmetic that
   * fails on any third scoped rule whatever it says.
   *
   * AND NOW IT ACTUALLY IS. The paragraph above has said this since the second
   * rule arrived; the assertion under it stayed a list of two, and the third
   * scoped rule duly failed it — `.dept-combo-input::placeholder`, a colour and
   * nothing else, on แผนกที่คุม's search box. Written out as the two properties
   * that were meant, a fourth colour-only rule is no longer somebody's problem
   * and a blanket one still is.
   */
  const scopes = (css.match(/[^\n]*input::placeholder/g) || []).map((s) => s.trim());
  assert.ok(scopes.length, 'the placeholder rules vanished');

  // ONE: every one of them is scoped to a form. A bare `input::placeholder`, or
  // `.field input::placeholder`, reaches every box in the app.
  for (const rule of scopes) {
    assert.match(
      rule,
      /^\.[\w-]+( [\w-]+)?::placeholder$|^\.[\w-]+ input::placeholder$/,
      `${rule} is not scoped to one form`,
    );
    assert.ok(!/^\.field /.test(rule), `${rule} dresses every box in the app`);
  }

  // TWO: exactly one of them dresses a placeholder as a SUB-LABEL, and it is
  // this form. The others are free to set a colour; mono is the tell.
  const asLabel = (css.match(/[^\n]*input::placeholder \{[^}]*var\(--mono\)[^}]*\}/g) || [])
    .map((s) => s.trim());
  assert.equal(asLabel.length, 1, 'a second form is dressing placeholders as labels');
  assert.match(asLabel[0], /^\.profile-form input::placeholder/);
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

// ── ออกจากระบบ, the sidebar's copy ──────────────────────────────────────────

/**
 * The button on the card is only half of it. On a desktop the sidebar is the
 * one somebody actually uses, and it is in a different file with a different
 * class on a ground that no theme changes — so it gets its own three checks:
 * where it sits, that it is red, and that the red is the un-themed kind.
 */
test('the sidebar sign-out sits under the whoami card, on the floor', () => {
  const code = sourceOf(APP);
  const foot = code.indexOf('<div className="sidebar-foot">');
  assert.ok(foot > 0, '.sidebar-foot is gone — the pair no longer has a floor');
  const block = code.slice(foot, foot + 900);
  const whoami = block.indexOf('className={`whoami');
  const signout = block.indexOf('className="signout"');
  assert.ok(whoami > 0 && signout > 0, 'the profile card and the sign-out are not both in the foot');
  assert.ok(signout > whoami, 'ออกจากระบบ must follow the profile card, not precede it');

  // And the floor is an auto margin, not a fixed offset somebody has to keep
  // in step with the sidebar's height.
  assert.match(styles(), /\.sidebar-foot \{[^}]*margin-top: auto/);
});

test('.signout is the destructive sub-action, not another grey nav row', () => {
  const css = styles();
  const at = css.indexOf('.signout {');
  assert.ok(at > 0, '.signout is gone');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.match(rule, /color: var\(--on-panel-danger\)/, 'the letters went back to grey');
  assert.match(rule, /border: 1px solid var\(--on-panel-danger-line\)/, 'the red line is gone');
  assert.match(rule, /background: transparent/, 'outlined, never filled — see the note above the rule');
  assert.match(rule, /transition:/, 'the hover arrives instantly again');

  const hover = css.slice(css.indexOf('.signout:hover {'), css.indexOf('.body {'));
  assert.match(hover, /background: var\(--on-panel-danger-wash\)/);
  assert.match(hover, /box-shadow: 0 0 0 3px var\(--on-panel-danger-glow\)/, 'the hover glow is gone');
});

/**
 * THIS TEST USED TO ASSERT THE OPPOSITE, and the flip is the point rather than
 * a loosening. It read "its red is un-themed, because the sidebar is dark in
 * both themes", and it enforced exactly that: none of the four tokens might
 * carry a light-dark(), on the argument that a colour whose GROUND does not
 * change must not change either.
 *
 * The argument was right and its premise expired on 2026-09-07, when the rail
 * went white in ธีมสว่าง. The same reasoning now demands the opposite: the
 * ground moves, so the red has to move with it — #F0A08A was mixed to carry on
 * charcoal and measures 1.9 on white, which is a stain rather than a word.
 *
 * WHAT IS KEPT IS THE TEST'S REAL SUBJECT, which was never the alpha: the
 * sign-out may not reach for the themed `--danger-*` set. That set is the
 * app's alert red, chosen for a pale panel inside a card, and borrowing it here
 * would tie this button to a decision about error states — which is the whole
 * reason `--on-panel-danger` exists as a name of its own.
 */
test('its red follows the rail, and is still not --danger-*', () => {
  const css = styles();
  for (const token of ['--on-panel-danger', '--on-panel-danger-line', '--on-panel-danger-wash', '--on-panel-danger-glow']) {
    assert.ok(
      css.includes(`  ${token}: light-dark(`),
      `${token} is gone, or stopped following the theme — the ground under it does`,
    );
  }
  // Not --danger-ink: that one IS themed, and its light value is unreadable here.
  assert.ok(
    !/\.signout[^}]*var\(--danger/.test(css.slice(css.indexOf('.signout {'), css.indexOf('.body {'))),
    '.signout reached for the themed --danger-* set',
  );
});

// ── the reveal eye ──────────────────────────────────────────────────────────

test('the eye is --muted, one step up from the 3.41:1 it shipped at', () => {
  const css = styles();
  const at = css.indexOf('.password-field .reveal {');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.match(rule, /color: var\(--muted\);/, 'the eye went back to --muted-2');
  assert.ok(!/--muted-2/.test(rule), '--muted-2 is the faint one — see the note above the rule');
  // Hover still goes all the way to ink, which is where "this is a control"
  // gets answered.
  assert.match(css, /\.password-field \.reveal:hover \{[^}]*color: var\(--ink-2\)/);
});

// ── the cards ───────────────────────────────────────────────────────────────

test('ข้อมูลส่วนตัว carries its own class, and its cards their own padding', () => {
  assert.match(sourceOf(PROFILE), /<div className="stack profile-page">/);
  const css = styles();
  assert.match(css, /\.profile-page \.card \{ padding: 24px; \}/);
  // Scoped, or every queue and modal in the app moves with it.
  assert.ok(!/^\.card \{[^}]*padding: 24px/m.test(css), 'the app-wide card padding was raised instead');
  // The phone gives the room back.
  assert.match(css, /@media \(max-width: 640px\) \{\n  \.profile-page \.card \{ padding: 18px; \}\n\}/);
});

// ── where เปลี่ยนรหัสผ่าน lands ─────────────────────────────────────────────

/**
 * THE STRIP NAMES ONE FORM AND THE PAGE IT OPENS HAS FIVE CARDS ON IT.
 *
 * เปลี่ยนรหัสผ่าน on the reminder strip did `goTab('profile')` and nothing
 * else, which lands at the top of ข้อมูลส่วนตัว — a name, a แผนก, a
 * ธีมสีหน้าจอ and, for a หัวหน้า, ผู้รักษาการแทน above the form somebody
 * pressed a button to reach. On a phone that is a screen and a half of
 * scrolling to find the thing they just asked for.
 *
 * Three parts, and each is useless without the other two: the press has to
 * carry WHICH card it meant, the card has to scroll itself there, and the
 * landing has to clear the app bar stuck over the top 62px of the scrollport.
 */

test('the press carries which card it meant, and stops carrying it on the way out', () => {
  const code = sourceOf(APP);
  assert.match(code, /const \[profileJump, setProfileJump\] = useState\(null\);/);
  assert.match(
    code,
    /useEffect\(\(\) => \{ if \(tab !== 'profile'\) setProfileJump\(null\); \}, \[tab\]\);/,
    'the jump outlives its arrival — the next plain visit to ข้อมูลส่วนตัว would scroll too',
  );
  assert.match(code, /<ProfileView[^>]*jumpTo=\{profileJump\}/);
});

test('the card scrolls itself into view, and only when it was asked for', () => {
  const code = sourceOf(PROFILE);
  assert.match(code, /jump=\{jumpTo === 'password'\}/);
  assert.match(code, /export function ChangePassword\(\{ onDone, pending = false, jump = false \}\)/);
  // The guard is the whole of "only when asked": this component is mounted by
  // every visit to the page, including the ones nothing sent.
  assert.match(code, /if \(!jump\) return;/);
  assert.match(code, /cardRef\.current\?\.scrollIntoView\(\{/);
  assert.match(code, /block: 'start',/);
  // On the frame after mount — the cards above this one have not been laid
  // out when the effect runs, and a scroll measured then lands short.
  assert.match(code, /window\.requestAnimationFrame\(\(\) => \{/);
  // …and it honours a reader who has asked for less motion, which an
  // imperative scroll has no CSS to do for it.
  assert.match(code, /matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  assert.match(code, /behavior: still \? 'auto' : 'smooth',/);
});

test('and it lands clear of the app bar, not underneath it', () => {
  assert.match(sourceOf(PROFILE), /<div className="card profile-password" ref=\{cardRef\}>/);
  const css = styles();
  assert.match(
    css,
    /\.profile-password \{ scroll-margin-top: calc\(62px \+ 14px\); \}/,
    'the heading somebody pressed a button to see arrives under the app bar',
  );
  // 62 is the bar's own height, read from the rule that sets it: a landing
  // measured against a number that has since moved is what this catches.
  const bar = css.indexOf('.appbar {');
  const barRule = css.slice(bar, css.indexOf('\n}', bar));
  assert.match(barRule, /height: 62px;/, 'the bar changed height and the landing above did not');
});

// ── autofill ────────────────────────────────────────────────────────────────

test('all three boxes refuse the browser and the extensions alike', () => {
  const code = sourceOf(PROFILE);
  assert.match(code, /autoComplete: 'new-password',/);
  assert.match(code, /'data-lpignore': 'true',/);
  assert.match(code, /'data-form-type': 'other',/);
  // One object, spread three times — three hand-written copies is how one of
  // them ends up a word out of step.
  assert.equal((code.match(/\{\.\.\.NO_AUTOFILL\}/g) || []).length, 3);
});

test('รหัสผ่านเดิม is included on purpose, and current-password is gone', () => {
  const code = sourceOf(PROFILE);
  assert.ok(
    !/autoComplete="current-password"/.test(code),
    'the old-password box is fillable again — a value the browser typed proves nothing about who is at the keyboard',
  );
  // No stray per-field autoComplete left to overrule the shared object.
  assert.ok(!/autoComplete="/.test(code), 'a field kept its own autoComplete attribute');
});
