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
    // AND NOT THE GAP ABOVE IT EITHER. ส่งบัญชี carried `marginTop: 12` and
    // แยกแผนก `14` — two hand-set numbers for one distance, on two cards that
    // are card-for-card the same, which is exactly how the second one ends up
    // 2px lower than the first with nothing on the page saying why. The number
    // is `.action-row`'s now, and it is 12: `.row`'s own gap, so the two rows
    // of the header are spaced the way the controls inside each row are.
    assert.ok(!/marginTop/.test(row), `${file} ตั้งระยะห่างบนแถวนั้นเอง แทนที่จะรับจาก .action-row`);
  }
  assert.match(css, /\.action-row \{[^}]*margin-top: 12px;/, '.action-row ไม่ได้ถือระยะห่างด้านบนไว้แล้ว');
});

test('ช่องติ๊กเป็นกล่องสูงเท่าปุ่ม — แถวล่างจึงมีขอบบนและขอบล่างเส้นเดียว', () => {
  // THE FOURTH REPORT OF THIS ROW, AND THE FIRST ONE THAT CHANGED IT. The
  // three before were answered by measuring: centre 0.00px, text baselines
  // 0.45px, at every desktop width from 1024 to 1920. All true, and none of it
  // was what was being seen. What was being seen was the AIR — row 1's left
  // column (heading + hint, 42.25px) is 23.75px shorter than its right (label +
  // control, 66px), so with both sides of this row hanging from one row bottom
  // the gap above the buttons measured 40.25px against the tick box's 22.75.
  //
  // AND THAT DIFFERENCE CANNOT BE PAID OFF IN THIS ROW. Level means both sides
  // hang from the same line, so the air above them differs by exactly what the
  // two columns above them differ by. A margin over each side to even the air
  // pulls the buttons and the tick 23.75px out of level; ending row 1's columns
  // level instead costs the heading its baseline, which is the report of the
  // round before. One 23.75px, spendable once.
  //
  // SO THE ROW CHANGES WHAT THE EYE COMPARES INSTEAD. Two filled buttons beside
  // a bare 17px tick read as a band with something floating near it; three
  // boxes of one height read as one row. `align-self: stretch` costs no
  // movement at all — `.check` is already a flex container that centres its own
  // contents, so the tick and the words stay where they were (202.25px, both
  // before and after, measured at 1440px on 2026-08-28).
  const rule = css.slice(css.indexOf('.action-row .check {'),
    css.indexOf('}', css.indexOf('.action-row .check {')));
  assert.match(rule, /align-self: stretch;/, 'ช่องติ๊กไม่ได้สูงเท่าแถวแล้ว ขอบบน-ล่างจะไม่ตรงกับปุ่ม');
  assert.match(rule, /border: 1px solid var\(--line\);/, 'ช่องติ๊กไม่มีเส้นขอบแล้ว — กล่องที่มองไม่เห็นไม่ได้ตอบรายงานนี้');
  // `.btn.ghost`'s own two values, not a second pair that happens to match:
  // this box stands next to that one and has to keep standing next to it.
  assert.match(rule, /border-radius: var\(--radius-sm\);/, 'ช่องติ๊กเลิกใช้มุมเดียวกับปุ่มข้าง ๆ');
  const ghost = css.slice(css.indexOf('.btn.ghost {'), css.indexOf('}', css.indexOf('.btn.ghost {')));
  assert.match(ghost, /border: 1px solid var\(--line\)/, 'ปุ่ม ghost เปลี่ยนเส้นขอบ ช่องติ๊กข้าง ๆ ยังลอกค่าเดิมอยู่');
});

test('ตัวแปรที่เติมเส้นขอบไม่ได้แก้ padding ตามหลัง — และไม่ต้องแก้', () => {
  // The point of the base rule: these three add a rule and say nothing about
  // padding, and that is now correct rather than a 2px bug in each.
  for (const variant of ['.btn.ghost {', '.btn.outline {', '.btn.on-hero ']) {
    const at = css.indexOf(variant);
    assert.ok(at > 0, `หาไม่เจอ ${variant}`);
    const rule = css.slice(at, css.indexOf('}', at));
    assert.match(rule, /border: 1px solid /, `${variant} ไม่ได้เติมเส้นขอบแล้ว`);
    assert.ok(!/padding/.test(rule), `${variant} ไปแก้ padding เอง แทนที่จะรับจากกฎฐาน`);
  }
});

