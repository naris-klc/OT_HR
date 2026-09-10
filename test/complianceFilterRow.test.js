import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * การใช้สิทธิ์พิเศษ — the head of the card, above the table.
 *
 * The tab opened on five things before the first row of the report: a heading,
 * five lines of grey enumerating what counts as an exception and how the file
 * is ordered, ตั้งแต่วันที่ and ถึงวันที่ on one line, เฉพาะประเภท alone on the
 * next, and a line holding ล้างตัวกรองทั้งหมด and ดาวน์โหลด CSV ตามตัวกรอง.
 * Asked for on 2026-09-08 as one line of explanation, one line of filters, and
 * a smaller amber box.
 *
 * ── WHAT IS PINNED, AND WHY EACH PART CAN COME APART QUIETLY ────────────────
 *
 *   THE ⓘ, NOT อ่านต่อ. The standard settled on 2026-09-07 — see
 *   test/disclosure.test.js — is that a card's subtitle is drawn in full and
 *   never clamped; `Disclosure` is for the text under one setting. So the
 *   subtitle was SHORTENED to the sentence that says what the tab is, and what
 *   it used to enumerate went behind the app's own ⓘ, which is where ภาพรวม's
 *   four lines of the same sort of standing context already are. This file
 *   fails if the fold comes back instead.
 *
 *   THE BUTTONS SIT ON THE LINE OF THE BOXES, not of the labels, and the number
 *   that puts them there is two other rules added together. Both are read from
 *   the stylesheet here, so moving `.field-head`'s height or `.field`'s gap
 *   fails this rather than dropping the pair a few pixels out of line on a
 *   screen nobody rebuilds for a week.
 *
 *   THE AMBER BOX IS `tight`, which is the size `Alert` already has for a
 *   notice that is one line about a count rather than a warning to stop and
 *   read. It is not a new size.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Line endings normalised before anything below reads a character of this.
    The machine this is developed on checks the repo out CRLF (see the note in
    `.gitattributes`); the Linux box that serves it checks the same commit out
    LF. An assertion written with `\n` misses every multi-line match on the
    first, one written with `\r\n` misses them on the second, and in both
    cases the file under test is correct to the character. Normalising is what
    makes the assertion about the CSS instead of about the checkout — the same
    thing test/adminApproval.test.js and test/modalScrollFrame.test.js do. */
const read = (f) => readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
/* Comments in this repo quote the markup they explain, so an assertion about
   what a screen DRAWS has to read the code with the prose taken out. */
const sourceOf = (f) => read(f)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const css = read('app/styles.css');
const jsx = sourceOf('components/LogSystem.jsx');
/** The card, from its function down to the report table under it. */
const card = jsx.slice(jsx.indexOf('function Compliance()'), jsx.indexOf('<table className="cmp-table'));
/** One rule, from its selector to the end of its declarations. */
const rule = (selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at > 0, `${selector} หายไปจาก styles.css`);
  return css.slice(at, css.indexOf('}', at));
};

// ── one line above, the rest behind the ⓘ ───────────────────────────────────

test('the subtitle is one sentence, and it is not a fold', () => {
  const hint = card.match(/<div className="hint">([^<]*)<\/div>/)?.[1];
  assert.ok(hint, 'การใช้สิทธิ์พิเศษ ไม่มีบรรทัดอธิบายใต้หัวข้อแล้ว');
  // Short enough to be one line on a laptop and two on a phone. The five kinds
  // that used to be here run past 200 characters on their own.
  assert.ok(hint.trim().length <= 120, `บรรทัดใต้หัวข้อยาว ${hint.trim().length} ตัวอักษร`);
  // The standard this obeys, stated where it can fail: no clamp on a subtitle.
  assert.ok(!card.includes('<Disclosure'), 'บรรทัดใต้หัวข้อถูกพับด้วย Disclosure แทนที่จะสั้นลง');
});

test('what it used to say is behind the app\'s own ⓘ', () => {
  // `i` and not `?`: the glyph is the difference between a field asking what to
  // type and a heading offering context. See `TipButton` in common.jsx.
  assert.match(card, /<TipButton\s+glyph="i"/);
  assert.match(card, /text=\{ABOUT\}/);
  assert.match(card, /open=\{aboutOpen\}/);
  // A string, because `TipButton` also puts it in `title` for a pointer, and a
  // `title` given an element is the string "[object Object]".
  const about = jsx.match(/^const ABOUT = ([\s\S]*?);\r?\n\r?\n/m)?.[1];
  assert.ok(about, 'ABOUT หายไปจาก LogSystem.jsx');
  assert.ok(!about.includes('<'), 'ABOUT เป็น JSX — title จะกลายเป็น [object Object]');
  // The five kinds are all still said somewhere, which is the point of moving
  // them rather than deleting them.
  for (const kind of ['ตั้งรหัสผ่านใหม่', 'เซ็นแทนหัวหน้า', 'เปลี่ยนบทบาท', 'เปลี่ยนรหัสพนักงาน', 'คำนวณใหม่']) {
    assert.ok(about.includes(kind), `ABOUT ไม่ได้พูดถึง ${kind}`);
  }
  // Shut on arrival: it answers a question asked once, not a preference.
  assert.match(card, /useState\(false\);/);
  // The heading and the circle share one line, the row every form head uses.
  assert.match(card, /<div className="form-head">\r?\n\s*<h2>การใช้สิทธิ์พิเศษ<\/h2>/);
});

// ── three filters and two buttons, one line ─────────────────────────────────

test('the filters and the buttons are one row, and it is the app’s own bar', () => {
  /* `.queue-tools` SINCE 2026-09-10 — `.compliance-filters` is deleted. This
     row was this screen's own flex line with its own gap and its own field
     basis, beside four report screens using `.queue-tools` for the same job;
     reported as *"ปรับให้เป็นรูปแบบเดียวกันทั้ง app"*. Nothing about what this
     test guards changed: three filters and two buttons, one line, wrapping
     rather than breaking at a guessed width. */
  assert.match(card, /<div className="queue-tools">/);
  assert.ok(!card.includes('compliance-filters'), 'แถวตัวกรองของจอนี้กลับมาเป็นคลาสของตัวเอง');
  // The pair is INSIDE that row; a `.row` of its own under the grid is the
  // third line this change removed.
  const row = card.slice(card.indexOf('<div className="queue-tools">'));
  assert.ok(row.indexOf('compliance-actions') < row.indexOf('{error &&'), 'ปุ่มหลุดออกไปนอกแถวตัวกรองแล้ว');
  assert.match(row, /ดาวน์โหลด CSV ตามตัวกรอง/);
  assert.match(row, /ล้างตัวกรองทั้งหมด/);
  // Wrapping, so the pair drops to a line of its own when the window cannot
  // hold five things — no breakpoint is asked to guess where that is.
  assert.match(rule('.queue-tools'), /display: flex; gap: 12px; flex-wrap: wrap;/);
  assert.match(rule('.queue-tools'), /align-items: flex-end/);
  assert.match(rule('.queue-tools .field'), /flex: 0 1 200px/);
});

test('there is no label line left for the buttons to miss', () => {
  /* ⚠ THIS TEST HELD THE OPPOSITE ARITHMETIC UNTIL 2026-09-10, and what
     replaced it is the point of the round.

     It read: `.compliance-actions` carries `padding-top: 25px` so the pair
     stands on the line of the three BOXES rather than of the three LABELS, and
     25 is `.field-head`'s `min-height` (18) plus `.field`'s `gap` (7) — two
     figures from two other rules, read out of the stylesheet here so that
     moving either failed this rather than dropping the buttons a few pixels out
     of line on a screen nobody rebuilds for a week.

     THE LABEL LINE IS GONE. Asked for with a screenshot: *"กระชับความสูงของ
     ส่วนตัวกรอง · ลบ label ช่อง input / dropdown ออก"*. The label is inside the
     box now (`.queue-tools .field > .field-head`, absolutely positioned over
     the control), so the boxes start at the top of the row and the pair needs
     no padding at all. One number that could go stale, deleted rather than
     re-derived — which is the better answer to the report that produced it. */
  assert.ok(!css.includes('.compliance-actions {\n  flex: none; display: flex; gap: 8px; align-items: center;\n  margin-left: auto; padding-top:'),
    'ปุ่มกลับไปเยื้องตามบรรทัด label อีกแล้ว');
  const actions = rule('.queue-tools .compliance-actions');
  assert.ok(!/padding-top/.test(actions), 'ปุ่มยังเยื้องเองอยู่ ทั้งที่ไม่มีบรรทัด label ให้เยื้องแล้ว');
  // Held against the right edge of the card when the line has room to spare.
  assert.match(actions, /margin-left: auto/);
  // AND THE LABEL IS REALLY INSIDE THE BOX — the half that makes the sentence
  // above true rather than merely tidy.
  const inset = rule('.queue-tools .field > .field-head');
  assert.match(inset, /position: absolute/);
  assert.match(inset, /pointer-events: none/);
  assert.match(css, /\.queue-tools \.field input:not\(:where\(\[type='checkbox'\], \[type='radio'\]\)\),\s*\.queue-tools \.field \.pick-one,\s*\.queue-tools \.field \.pick-box \{\s*padding-top: 21px; padding-bottom: 5px;\s*\}/);
});

test('under 560 the buttons are a thumb tall and take the line', () => {
  // 560 is `.form-grid`'s own breakpoint, and these three fields were in a
  // `.form-grid` until this row was written. The FIELDS need nothing here any
  // more — `.queue-tools .field` goes full width in the 860px block, which is
  // above this one — so what is left is the pair.
  const narrow = css.slice(css.indexOf('@media (max-width: 560px) {', css.indexOf('.queue-tools .compliance-actions {')));
  const block = narrow.slice(0, narrow.indexOf('\n}\n'));
  assert.match(block, /\.queue-tools \.compliance-actions \{[^}]*margin-left: 0/);
  assert.match(block, /\.queue-tools \.compliance-actions \.btn \{[^}]*min-height: 44px/);
  const wide = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  assert.match(wide, /\.queue-tools \.field, \.queue-tools \.field\.search \{ flex: 1 1 100%; \}/);
});

// ── the amber count ─────────────────────────────────────────────────────────

test('the count of rows with no reason is a tight notice', () => {
  assert.match(card, /<Alert kind="warn" tight>/);
  // `tight` is a size `Alert` already had — this change added no fourth one.
  assert.match(css, /\.alert\.tight \{ padding: 10px 12px; font-size: 12\.5px; \}/);
});

// ── and the ⓘ is the app's, not a second one ────────────────────────────────

test('no screen grows a tip button of its own', () => {
  // One control means one place to fix its focus ring, its keys and its glyph.
  for (const f of readdirSync(join(ROOT, 'components')).filter((n) => n.endsWith('.jsx'))) {
    if (f === 'common.jsx') continue;
    assert.doesNotMatch(sourceOf(`components/${f}`), /className="tip-btn/,
      `components/${f} วาดปุ่มคำอธิบายเอง แทนที่จะใช้ TipButton`);
  }
});
