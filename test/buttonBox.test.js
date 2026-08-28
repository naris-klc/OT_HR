import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * ปุ่มทุกปุ่มเป็นกล่องเดียวกัน จะมีเส้นขอบหรือไม่มีก็ตาม.
 *
 * `.btn` is the filled button and it carries no visible rule; `.btn.ghost`,
 * `.btn.outline` and `.btn.on-dark` each add `border: 1px solid …`. With
 * `box-sizing: border-box` that costs nothing only when a height is declared,
 * and none is declared here — the height is padding + one line of type. So a
 * variant that adds a rule without taking the padding back stands 2px taller
 * and 2px wider than the filled button beside it.
 *
 * IT WAS FOUND SIX TIMES BEFORE IT WAS FIXED ONCE. `.quick-edit-foot .btn`,
 * `.foot-split .btn`, `.btn.quiet` and three more all carry
 * `border: 1px solid transparent`, each added the day somebody noticed a
 * crooked pair in one container; two of them have a test whose comment
 * explains the 2px. On 2026-08-28 ส่งบัญชี was reported as a seventh, measured
 * on the running app at 1280px — ส่งออกไฟล์บัญชี 38.5px beside พิมพ์แบบฟอร์ม
 * 40.5px — and the answer went into the base rule instead of a seventh
 * container.
 *
 * THE GEOMETRY DID NOT MOVE, which is the reason this could be a base change
 * at all: `12px 18px` with no rule and `11px 17px` with a 1px rule are the
 * same rectangle. Nothing that was already the right size changed size.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');

/** The rule's own body, so a later `.btn.something` cannot answer for it. */
const base = css.slice(css.indexOf('\n.btn {'), css.indexOf('}', css.indexOf('\n.btn {')));

test('ปุ่มพื้นฐานมีเส้นขอบใสไว้ ปุ่มที่มีเส้นขอบจริงจึงไม่สูงกว่า 2px', () => {
  assert.match(base, /border: 1px solid transparent;/,
    'ปุ่มพื้นฐานกลับไปเป็น border: none — ปุ่ม ghost จะสูงกว่า 2px ทุกที่ในแอป');
  assert.ok(!/border: none/.test(base), 'ยังมี border: none ค้างอยู่ในกฎเดียวกัน');
});

test('padding ชดเชยเส้นขอบพอดี กล่องจึงเท่าเดิมทุกประการ', () => {
  // 11 + 11 + 14.5 + 2 = 38.5, ซึ่งเท่ากับ 12 + 12 + 14.5 ของเดิม
  // 17 + 17 + 2 ก็เท่ากับ 18 + 18 ของเดิม
  assert.match(base, /padding: 11px 17px;/,
    'padding ไม่ได้ถูกลดลง 1px กล่องจะโตขึ้น 2px ทั้งแอป');
  assert.match(base, /font: 600 14\.5px\/1 var\(--sans\);/,
    'ความสูงตัวอักษรเปลี่ยน เลข 38.5 ในคอมเมนต์ข้างบนไม่จริงแล้ว');
});

test('สองจอที่ถูกแจ้งใช้แถวเดียวกันและปุ่มคู่เดียวกัน — บรรทัดล่างจึงถูกอยู่แล้ว', () => {
  // WHAT THE REPORT SAID AND WHAT WAS ACTUALLY CROOKED. ส่งบัญชี on 2026-08-28
  // and แยกแผนก the same day were both reported as "the buttons do not line up
  // with แสดงพนักงานที่ไม่มี OT beside them", and on both the row was already
  // right: `.action-row` is `align-items: center` and the tick box's centre
  // measured 0.00px from the buttons'. What was crooked was the two buttons
  // against EACH OTHER, which the base rule above fixes for both at once.
  //
  // So what is worth pinning here is that neither screen answers the question
  // locally: one shared row class, and the plain/ghost pair that the base rule
  // is about. A hand-rolled row on either would put the two screens back on
  // separate answers to one question.
  for (const file of ['components/AccountingView.jsx', 'components/DepartmentView.jsx']) {
    const jsx = readFileSync(join(ROOT, file), 'utf8');
    const at = jsx.indexOf('className="row action-row"');
    assert.ok(at > 0, `${file} เลิกใช้ .action-row ที่ใช้ร่วมกัน`);
    const row = jsx.slice(at, jsx.indexOf('</div>', at));
    assert.ok(row.includes('className="btn"'), `${file} ไม่มีปุ่มพื้นฐานในแถวนั้นแล้ว`);
    assert.ok(row.includes('className="btn ghost"'), `${file} ไม่มีปุ่ม ghost คู่กับปุ่มพื้นฐานแล้ว`);
    assert.ok(!/alignItems|align-items/.test(row), `${file} ไปตอบเรื่องการจัดแนวเองในแถวนั้น`);
  }
});

test('ตัวแปรที่เติมเส้นขอบไม่ได้แก้ padding ตามหลัง — และไม่ต้องแก้', () => {
  // The point of the base rule: these three add a rule and say nothing about
  // padding, and that is now correct rather than a 2px bug in each.
  for (const variant of ['.btn.ghost {', '.btn.outline {', '.btn.on-dark ']) {
    const at = css.indexOf(variant);
    assert.ok(at > 0, `หาไม่เจอ ${variant}`);
    const rule = css.slice(at, css.indexOf('}', at));
    assert.match(rule, /border: 1px solid /, `${variant} ไม่ได้เติมเส้นขอบแล้ว`);
    assert.ok(!/padding/.test(rule), `${variant} ไปแก้ padding เอง แทนที่จะรับจากกฎฐาน`);
  }
});

