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

test('สองจอที่ถูกแจ้งใช้แถวเดียวกัน — และตอนนี้เป็นเมนูปุ่มเดียวที่ใช้ร่วมกันสามจอ', () => {
  // WHAT THE REPORT OF 2026-08-28 SAID AND WHAT WAS ACTUALLY CROOKED. ส่งบัญชี
  // and แยกแผนก were both reported as "the buttons do not line up with
  // แสดงพนักงานที่ไม่มี OT beside them", and on both the row was already right:
  // `.action-row` was `align-items: center` and the tick box's centre measured
  // 0.00px from the buttons'. What was crooked was the two buttons against EACH
  // OTHER, which the base rule above fixes for both at once.
  //
  // ⚠ AND THE ROW IS GONE SINCE 2026-09-10. Reported as
  // *"ตอนนี้แต่ละหน้าใช้ ui สไตล์ไม่สม่ำเสมอกันเลย"*: the two screens carried a
  // row of two full-width buttons and a tick-box where รออนุมัติ OT carries one
  // compact action in its card head. Both now use `ExportMenu` — the control
  // ตรวจสอบประจำเดือน got in the declutter earlier the same day — and the
  // tick-box is a filter on `.queue-tools` with the dropdowns.
  //
  // SO WHAT IS PINNED HERE IS THE SAME PROPERTY, ONE LAYER UP: neither screen
  // answers the question locally. One shared component, from `common.jsx`, and
  // no hand-rolled row of `btn`s on either. A second `<button className="btn">`
  // appearing on one of these cards is how the two screens go back to being
  // separate answers to one question.
  for (const file of ['components/AccountingView.jsx', 'components/DepartmentView.jsx']) {
    const jsx = readFileSync(join(ROOT, file), 'utf8');
    assert.match(jsx, /import \{[\s\S]*?ExportMenu[\s\S]*?\} from '\.\/common\.jsx'/,
      `${file} ไม่ได้ใช้ ExportMenu ที่ใช้ร่วมกัน`);
    const at = jsx.indexOf('<ExportMenu');
    assert.ok(at > 0, `${file} เลิกเรียก ExportMenu แล้ว`);
    // The menu holds both verbs — the file and the form — so neither has been
    // quietly promoted back out onto a button of its own.
    const menu = jsx.slice(at, jsx.indexOf('/>', at));
    assert.ok(/\(CSV\/Excel\)/.test(menu), `${file} เอาแถวส่งออกไฟล์ออกจากเมนู`);
    assert.ok(/พิมพ์แบบฟอร์ม \/ บันทึกเป็น PDF/.test(menu), `${file} เอาแถวพิมพ์แบบฟอร์มออกจากเมนู`);
    // AND NO ROW OF BUTTONS ANYWHERE ON THE CARD. `.action-row` is deleted from
    // the stylesheet; a screen re-creating the pair by hand would be the first
    // of the two to drift.
    assert.ok(!/className="row action-row"/.test(jsx), `${file} เอา .action-row กลับมา`);
    assert.ok(!/<button className="btn"/.test(jsx), `${file} มีปุ่มพื้นฐานหลุดออกมานอกเมนู`);
  }
  assert.ok(!/^\.action-row/m.test(css), '.action-row ยังอยู่ในสไตล์ชีต ทั้งที่ไม่มีจอไหนใส่แล้ว');
});

test('ช่องติ๊กบนแถบตัวกรองยังเป็นกล่องสูงเท่าช่องข้าง ๆ', () => {
  // THE FOURTH REPORT OF THE OLD ROW, AND THE FIRST ONE THAT CHANGED IT. The
  // three before were answered by measuring: centre 0.00px, text baselines
  // 0.45px, at every desktop width from 1024 to 1920. All true, and none of it
  // was what was being seen. What was being seen was the AIR — row 1's left
  // column (heading + hint, 42.25px) is 23.75px shorter than its right (label +
  // control, 66px), so with both sides of that row hanging from one row bottom
  // the gap above the buttons measured 40.25px against the tick box's 22.75.
  //
  // The answer was to change what the eye compares: a bare 17px tick beside two
  // filled slabs reads as a band with something floating near it; three boxes
  // of one height read as one row.
  //
  // ⚠ THE ROW IT WAS ON IS GONE (2026-09-10) AND THE BOX IS NOT. The tick-box
  // is a FILTER — it decides who gets a row — so it moved to `.queue-tools`
  // with the two dropdowns, where its neighbours are four fields of one height.
  // A bare tick there would be the same report at a different width, which is
  // why `.queue-tools .check` inherits this rule's body rather than starting
  // over: `align-self: stretch`, a rule, and `.btn.ghost`'s own radius.
  //
  // `margin-left: auto` DID NOT COME WITH IT, and that is the one deliberate
  // difference: it pushed the tick to the far end of a row of ACTIONS, where it
  // was the one thing on the row that was not one. On a bar of filters it is
  // the fifth filter and sits where it falls.
  const rule = css.slice(css.indexOf('.queue-tools .check {'),
    css.indexOf('}', css.indexOf('.queue-tools .check {')));
  assert.match(rule, /align-self: stretch;/, 'ช่องติ๊กไม่ได้สูงเท่าแถวแล้ว ขอบบน-ล่างจะไม่ตรงกับช่องข้าง ๆ');
  assert.match(rule, /border: 1px solid var\(--line\);/, 'ช่องติ๊กไม่มีเส้นขอบแล้ว — กล่องที่มองไม่เห็นไม่ได้ตอบรายงานนี้');
  assert.ok(!/margin-left: auto/.test(rule), 'ช่องติ๊กถูกดันไปสุดแถวอีกแล้ว ทั้งที่แถวนี้เป็นตัวกรอง ไม่ใช่ปุ่ม');
  // `.btn.ghost`'s own two values, not a second pair that happens to match:
  // this box stands next to a row of fields and beside that button on a phone.
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

