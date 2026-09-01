import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * กรอบสี่เหลี่ยมสีฟ้าตอนแตะปุ่ม — the two rectangles a browser draws on a
 * control, and the base rules that decide what they look like.
 *
 * REPORTED 2026-08-28 as "ทุกปุ่มที่อยู่ในระบบ", after the same thing had been
 * reported the day before about one button. That is the shape of a base-rule
 * bug, and it is the second one this stylesheet has had: `test/buttonBox.test.js`
 * records `border: 1px solid transparent` being added to six containers one at
 * a time before it went into `.btn` itself.
 *
 * WHAT THESE TESTS PIN IS THE SHAPE, NOT THE COLOUR. A ring that changes from
 * green to some other token is a design decision; a ring that goes back to
 * being declared once per control, or that is deleted without a replacement, is
 * the bug coming back. So the assertions are about WHERE the declaration lives
 * and how many of them there are.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every rule in the file as {sel, body}.
 *
 * The naive pattern is right here for a reason worth stating: a match that
 * begins at an `@media` line has to cross a `{` before it can reach its `}`,
 * so it fails and the engine moves on to the rule INSIDE the block. The result
 * is every leaf rule and no wrapper, which is exactly the list these tests want
 * — a phone override is as much a place to redeclare a ring as a base rule is.
 */
const rules = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  sel: m[1].trim().replace(/\s+/g, ' '),
  body: m[2].trim().replace(/\s+/g, ' '),
}));

test('สี highlight ตอนแตะถูกประกาศครั้งเดียวที่ root และไม่มีที่อื่นอีก', () => {
  // `-webkit-tap-highlight-color` IS AN INHERITED PROPERTY, which is the whole
  // reason one declaration can answer for an app. Declared per-control it is a
  // list that has to be added to every time somebody writes a button — and it
  // was one: `.appbar .mark-btn` and `.announce-fold` each carried their own
  // until this went to the root.
  const declaring = rules.filter((r) => /-webkit-tap-highlight-color/.test(r.body));
  assert.equal(declaring.length, 1,
    `สี highlight ตอนแตะถูกประกาศ ${declaring.length} ที่ — ${declaring.map((r) => r.sel).join(', ')}`);
  assert.equal(declaring[0].sel, 'html', 'ประกาศไว้ที่อื่นที่ไม่ใช่ root — คุณสมบัตินี้สืบทอดลงมาได้ ไม่ต้องประกาศซ้ำ');
  assert.match(declaring[0].body, /-webkit-tap-highlight-color: transparent;/);
});

test('วงแหวน focus พื้นฐานมีอยู่ และอยู่ที่ specificity ต่ำที่สุดเท่าที่จะเป็นได้', () => {
  // One pseudo-class, no element and no class, so that every rule already in
  // the file beats it — the inward ring in the dark sidebar, the inset ones,
  // and the `outline: none` that a control whose ring is a box-shadow needs.
  const base = rules.filter((r) => r.sel === ':focus-visible');
  assert.equal(base.length, 1, 'ไม่มีกฎวงแหวน focus พื้นฐาน หรือมีมากกว่าหนึ่ง');
  assert.match(base[0].body, /outline: 2px solid var\(--green\);/,
    'วงแหวนพื้นฐานไม่ได้ใช้สีเขียวของระบบ');
  assert.match(base[0].body, /outline-offset: 2px;/);
});

test('ไม่มีปุ่มไหนประกาศวงแหวนสีเดียวกับพื้นฐานซ้ำอีก', () => {
  // FOUR CONTROLS CARRIED THE BASE VALUES WORD FOR WORD — `.appbar .mark-btn`,
  // `.btn`/`.link`/`.seg button`, `.tip-btn`, `.modal-x` — and four more
  // repeated the colour to change only the offset. A copy is not wrong the day
  // it is written; it is wrong the day the base ring changes and eight controls
  // do not.
  //
  // The dark sidebar is the one allowed exception and it is not an exception to
  // this test: it names `--green-lift`, a different token, because `--green`
  // has nowhere near the contrast it needs on that surface.
  const repeats = rules.filter((r) => r.sel !== ':focus-visible'
    && /outline: 2px solid var\(--green\)[;\s]/.test(r.body));
  assert.deepEqual(repeats.map((r) => r.sel), [],
    'มีปุ่มที่ประกาศวงแหวนสีเขียวเองซ้ำกับกฎพื้นฐาน');
});

test('การเอากรอบออกไม่เคยถูกเขียนแบบเหมารวมทั้งแอป', () => {
  // THE FIX THAT WAS ASKED FOR, AND THE ONE THAT WAS NOT WRITTEN. `outline:
  // none` on `button`, on `*`, or on `:focus` with nothing behind it removes
  // the only sign a keyboard has of where it is, on every control at once — to
  // answer a complaint about a COLOUR. Every `outline: none` in this file has
  // to be a specific control that puts something else in its place.
  const blanket = rules.filter((r) => /outline: none/.test(r.body)
    && !/[.#[]/.test(r.sel));
  assert.deepEqual(blanket.map((r) => r.sel), [],
    'มีกฎที่ลบกรอบ focus แบบเหมารวม ไม่ได้เจาะจงปุ่มใดปุ่มหนึ่ง');
});

/**
 * ── THE THIRD ONE, AND IT WAS A TEXT-BOX RULE ON A TICK BOX ─────────────────
 *
 * Reported 2026-08-31 on บันทึก OT แทนลูกทีม as a square around the checkbox
 * when you pick somebody and a plate behind it — which reads like the same
 * complaint the two tests above answer, and is not. Nothing here draws an
 * outline. `.field input` is the app's TEXT box, a checkbox is an `input`, and
 * every tick list in this app sits inside a `.field`.
 *
 * MEASURED ON THE BUILT APP BEFORE THE FIX, at 420px on ธีมมืด: the box came
 * out 17 × 46 — 17 wide from its own rule and 46 tall because `min-height:
 * var(--field-h)` beats a 17px `height` — filled with `var(--field-bg)`; and a
 * press added `box-shadow: 0 0 0 3px var(--focus-ring)` that stayed after the
 * pointer left, because that rule is `:focus` and not `:focus-visible`.
 *
 * AND IT HAD KILLED THE KEYBOARD'S RING, which is the half nobody reports:
 * `outline: none` is right for a text box whose ring is a box-shadow, so
 * Tabbing onto a checkbox matched `:focus-visible`, computed the 2px offset,
 * and drew nothing. Measured after the fix, a real Tab gives
 * `outline: 2px solid rgb(46, 119, 71)` — `--green`, from the base rule.
 */
test('กฎของกล่องข้อความไม่เอื้อมไปถึง checkbox กับ radio', () => {
  /**
   * Every `.field input` rule that PAINTS A BOX has to carry the exclusion —
   * the base rule, its `:focus` and its `:disabled` were the three that did
   * not, and each of them alone is enough to put the plate or the halo back.
   *
   * A rule is exempt when its own selector cannot reach a tick box anyway:
   * `:out-of-range` needs a range and `.invalid` is a class no checkbox wears.
   * Listing them by hand would rot; asking whether the selector already
   * narrows itself does not.
   */
  const PAINTS = /(min-height|padding|background|border|box-shadow|width):/;
  const reach = rules.filter((r) => /(^|,)\s*\.field input(?![-\w])/.test(r.sel)
    // …not the one rule written FOR tick boxes.
    && !/:is\(\[type='checkbox'\]/.test(r.sel)
    // …and not one that already cannot match a checkbox.
    && !/:out-of-range|\.invalid/.test(r.sel)
    && PAINTS.test(r.body));
  assert.ok(reach.length >= 3, `พบกฎ .field input ที่วาดกล่องเพียง ${reach.length} ข้อ`);
  for (const r of reach) {
    assert.match(
      r.sel,
      /\.field input:not\(:where\(\[type='checkbox'\], \[type='radio'\]\)\)/,
      `กฎนี้ยังเอื้อมถึง checkbox: ${r.sel.replace(/\s+/g, ' ').trim()}`,
    );
  }
});

test('ช่องติ๊กยังได้สีเขียวของธีม และไม่ได้มาจากกฎกล่องข้อความ', () => {
  // `accent-color` is what paints the tick itself, and it is the theme's
  // `--green` — not a hard-coded emerald, and not something the text-box rule
  // was ever providing.
  assert.match(css, /\.check input \{[^}]*accent-color: var\(--green\);/);
  // The one thing the disabled rule WAS right about is the cursor, and it is
  // the half a reader would not think to put back after the exclusion.
  assert.match(
    css,
    /\.field input:is\(\[type='checkbox'\], \[type='radio'\]\):disabled \{ cursor: not-allowed; \}/,
  );
});
