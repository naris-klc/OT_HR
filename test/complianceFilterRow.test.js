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
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
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

test('the filters and the buttons are in one row, not three', () => {
  assert.match(card, /<div className="compliance-filters">/);
  // The pair is INSIDE that row now; a `.row` of its own under the grid is the
  // third line this change removed.
  const row = card.slice(card.indexOf('<div className="compliance-filters">'));
  assert.ok(row.indexOf('compliance-actions') < row.indexOf('{error &&'), 'ปุ่มหลุดออกไปนอกแถวตัวกรองแล้ว');
  assert.match(row, /ดาวน์โหลด CSV ตามตัวกรอง/);
  assert.match(row, /ล้างตัวกรองทั้งหมด/);
  // Wrapping, so the pair drops to a line of its own when the window cannot
  // hold five things — no breakpoint is asked to guess where that is.
  assert.match(rule('.compliance-filters'), /display: flex; flex-wrap: wrap;/);
  assert.match(rule('.compliance-filters'), /align-items: start/);
  assert.match(rule('.compliance-filters > .field'), /flex: 1 1 190px/);
});

test('the buttons stand on the line of the boxes, not of the labels', () => {
  /*
   * A `.field` is a `.field-head` over its control with a gap between, so the
   * top of every box on the row is those two numbers below the top of the row.
   * The actions cell has no label, so it pays the same distance in padding.
   */
  const head = Number(rule('.field-head').match(/min-height: (\d+)px/)?.[1]);
  const gap = Number(rule('.field').match(/gap: (\d+)px/)?.[1]);
  const pad = Number(rule('.compliance-filters .compliance-actions').match(/padding-top: (\d+)px/)?.[1]);
  assert.ok(head > 0 && gap > 0, 'อ่านความสูงของหัวฟิลด์หรือช่องไฟไม่ได้');
  assert.equal(pad, head + gap, `ปุ่มเยื้องจากแถว ${pad}px แต่กล่องเริ่มที่ ${head + gap}px`);
  // Held against the right edge of the card when the line has room to spare.
  assert.match(rule('.compliance-filters .compliance-actions'), /margin-left: auto/);
});

test('under 560 the row stacks and the buttons are a thumb tall', () => {
  // 560 is `.form-grid`'s own breakpoint, and these three fields were in a
  // `.form-grid` until this row was written.
  const narrow = css.slice(css.indexOf('@media (max-width: 560px) {', css.indexOf('.compliance-filters {')));
  const block = narrow.slice(0, narrow.indexOf('\r\n}\r\n'));
  assert.match(block, /\.compliance-filters > \.field \{ flex-basis: 100%; \}/);
  assert.match(block, /\.compliance-filters \.compliance-actions \{[^}]*padding-top: 0/);
  assert.match(block, /\.compliance-filters \.compliance-actions \.btn \{[^}]*min-height: 44px/);
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
