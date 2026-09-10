import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normaliseDescription } from '../src/config/policy.js';

/**
 * บันทึก OT — ช่องรายละเอียดงานที่ยังว่าง บอกด้วยตัวหนังสือใต้ช่อง ไม่ใช่ป้ายของเบราว์เซอร์.
 *
 * WHAT WAS THERE BEFORE, and it is the login screen's story one form along.
 * `รายละเอียดงานที่ทำ` carried `required` and nothing else, so pressing
 * ส่งขออนุมัติ with it empty got the browser's own bubble — *Please fill out
 * this field.* in an English Chrome, "โปรดกรอกฟิลด์นี้" in a Thai one, a
 * different sentence in every other browser — floating in the browser's chrome
 * above a screen that is otherwise entirely this app's. It is the one mark on
 * the form that no stylesheet in this repository can reach: it cannot be given
 * the app's ink, it cannot be worded, and it vanishes at the next click.
 *
 * WHAT IS THERE NOW. `noValidate` on the <form> turns the bubble off and
 * `submit` asks `normaliseDescription` — the SERVER'S OWN CHECKER, imported
 * rather than retyped — then draws its sentence under the box with a red rule
 * round it. `required` STAYS on the textarea: it is what tells a screen reader
 * the field is not optional, and it was never the thing that was wrong.
 *
 * WHY THE SENTENCE IS IMPORTED AND NOT TYPED. A rule written out twice is two
 * rules that can disagree, and this pair would disagree in the worst way: the
 * box would say one thing and the 400 that follows it another. The refusal in
 * `src/config/policy.js` is what the write path answers (test/description.test.js
 * pins its wording); this form now says the same words before the request goes.
 *
 * `npm test` is plain `node --test` with no JSX transform (README §Status), so
 * the component is read as SOURCE TEXT — while the sentence itself is checked
 * by calling the real function.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const form = read('components/OtForm.jsx');
const css = read('app/styles.css');

const has = (src, text, why) => assert.ok(src.includes(text), why || `หาไม่เจอ: ${text}`);

/** The one rule that draws the red, read out of the sheet so the assertions
 *  below are about what it says and not about what the file says elsewhere. */
const invalidRule = css.slice(
  css.indexOf('.field input.invalid'),
  css.indexOf('.login-form .field-note.error'),
);

test('เบราว์เซอร์ไม่ตรวจฟอร์มนี้เองอีกแล้ว', () => {
  has(form, '<form id={formId} className="card" onSubmit={submit} noValidate>');
  // And nothing quietly turned it back on by adding a second <form> without it.
  assert.equal((form.match(/<form /g) || []).length, 1, 'มีมากกว่าหนึ่งฟอร์มในไฟล์นี้');
});

test('required ยังอยู่ — เป็นสิ่งที่โปรแกรมอ่านหน้าจอใช้บอกว่าช่องนี้ต้องกรอก', () => {
  const field = form.slice(form.indexOf('<textarea'), form.indexOf('</div>', form.indexOf('<textarea')));
  has(field, 'required', 'ช่องรายละเอียดงานต้องยังเป็น required');
});

test('ประโยคที่ขึ้นคือประโยคของฝั่งเซิร์ฟเวอร์ ไม่ได้พิมพ์ซ้ำ', () => {
  has(form, "import { DESCRIPTION_MAX_CHARS, normaliseDescription } from '@/src/config/policy.js';");
  has(form, 'const description = normaliseDescription(form.description);');
  has(form, 'setDescriptionRefusal(description.error);');
  // The words are the checker's, so nothing in the component may spell them out.
  assert.ok(
    !form.includes(normaliseDescription('').error),
    'ฟอร์มพิมพ์ประโยคปฏิเสธเอง — ต้องอ่านจาก normaliseDescription เท่านั้น',
  );
});

test('ยังไม่ส่งอะไรออกไปตราบใดที่ช่องยังว่าง', () => {
  // The early `return` sits above `setBusy(true)`, so no request goes out and
  // the button never enters its กำลังบันทึก… state for a blank form.
  const guard = form.slice(form.indexOf('const description = normaliseDescription'), form.indexOf('setBusy(true)'));
  has(guard, 'return;', 'ต้องหยุดก่อนส่งคำขอ');
});

test('ช่องที่มีแต่เว้นวรรคถือว่าว่าง', () => {
  // `.trim()` lives inside the checker, which is the same call the write path
  // makes — so a box holding a space is refused here exactly as it is there.
  assert.equal(normaliseDescription('   ').error, normaliseDescription('').error);
});

test('เครื่องหมายหายตอนพิมพ์ ไม่ใช่ตอนออกจากช่อง', () => {
  has(form, "onChange={(e) => { set('description', e.target.value); setDescriptionRefusal(''); }}");
  // No onBlur anywhere in this form: the mark's whole claim is "this box is
  // empty", and that stops being true at the first character.
  assert.ok(!form.includes('onBlur'), 'ต้องล้างเครื่องหมายตอนพิมพ์ ไม่ใช่ตอนออกจากช่อง');
});

test('เคอร์เซอร์ไปอยู่ในช่องที่ต้องแก้', () => {
  has(form, 'descriptionRef.current?.focus();');
  has(form, 'ref={descriptionRef}');
});

test('โปรแกรมอ่านหน้าจอได้ยินสิ่งที่เส้นขอบบอก', () => {
  has(form, 'aria-invalid={descriptionRefusal ? true : undefined}');
  has(form, 'aria-describedby={descriptionRefusal ? `${formId}-description-refusal` : undefined}');
  has(form, 'id={`${formId}-description-refusal`}');
});

test('สีแดงมาจาก class ไม่ใช่ :invalid', () => {
  has(form, "className={descriptionRefusal ? 'invalid' : undefined}");
  has(css, '.field textarea.invalid');
  // THE POINT OF THE CLASS. An empty `required` field matches `:invalid` from
  // the first paint, so styling that selector would open บันทึก OT with the box
  // already red — an accusation before anybody has typed anything.
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/:invalid\b/.test(selectors), 'CSS ต้องไม่ใช้ :invalid — ช่องว่างจะแดงตั้งแต่เปิดหน้า');
});

test('textarea ใช้เส้นขอบเดียวกับช่องบนหน้าเข้าสู่ระบบ', () => {
  has(invalidRule, '.field textarea.invalid,');
  // It has to beat `.field textarea:focus`, which sets border-color at the same
  // specificity — so the :focus half is spelled out rather than left to order.
  has(invalidRule, '.field textarea.invalid:focus');
  has(invalidRule, 'border-color: var(--invalid-line);');
  // Border only, and from a token: this app has two themes and a hex written at
  // the rule only has one half. A wash behind a box somebody is about to type in
  // reads as disabled, which is the opposite of what is being asked for.
  assert.ok(!/background/.test(invalidRule), 'ช่องที่ยังว่างต้องเปลี่ยนแค่เส้นขอบ');
  assert.ok(!/box-shadow/.test(invalidRule), 'วงโฟกัสยังเป็นสีเขียวของแอปตามเดิม');
  assert.ok(!/#[0-9A-Fa-f]{6}/.test(invalidRule), 'สีต้องมาจาก token ไม่ใช่ hex ที่ rule');
});

test('ใต้ช่องมีบรรทัดเดียว ไม่ใช่สองประโยคซ้อนกัน', () => {
  // The blank line and the too-long line cannot both be true of the same box,
  // so they share one slot: the refusal replaces the character-count note while
  // it stands, rather than stacking a second sentence under the first.
  has(form, '{descriptionRefusal ? (');
  has(form, '<span className="field-note error" id={`${formId}-description-refusal`}>');
  has(form, '{descriptionRefusal}');
  has(form, 'เท่าที่ช่องในใบ F-HR-027 พิมพ์ได้พอดี');
});
