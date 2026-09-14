import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Source with every comment taken out. Both notices below carry a tombstone
 * that QUOTES the sentences this commit removed, and a test that reads those
 * quotes back would pass on the day somebody pastes the old block in again.
 */
const src = (p) => readFileSync(join(root, p), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const employee = src('components/EmployeeView.jsx');

/** One <Modal> out of a file that holds several — from its title to its close. */
function modal(title) {
  const i = employee.indexOf(`title="${title}"`);
  assert.ok(i >= 0, `หาโมดัลไม่เจอ: ${title}`);
  const j = employee.indexOf('</Modal>', i);
  assert.ok(j > i, `${title}: ไม่มี </Modal> ปิด`);
  return employee.slice(i, j);
}

const cancel = modal('ยกเลิกคำขอนี้');
const ask = modal('ขอถอนใบที่อนุมัติแล้ว');

/**
 * ── คำเตือนในโมดัลพูดจบในกล่องเดียว — กอง ฉ, 2026-09-14 ────────────────────
 *
 * `docs/plan-notice-compact.md` กอง ฉ ชี้เป้าไว้สองใบ: โมดัลยกเลิกใบกับโมดัล
 * ขอถอนใบของพนักงาน กล่องละประมาณหกบรรทัดในโมดัลเล็ก ๆ โดยที่ `<Alert>`
 * เตือนเรื่องหนึ่ง แล้ว `.hint` ใต้มันเล่าเรื่องเดิมต่ออีกสามวรรค
 *
 * **ปัญหาไม่ใช่ความยาว มันคือการมีสองย่อหน้า** สองย่อหน้าอ่านเป็นสองเรื่อง
 * และในใบยกเลิกมันขัดกันเองด้วยซ้ำ — `<Alert>` บอกว่ารายการจะ*ปิดถาวร*
 * `.hint` บอกว่ารายการจะ*ยังอยู่ในตาราง ไม่ได้ถูกลบทิ้ง* ทั้งคู่จริง (คนละ
 * ประธาน: คำขอ กับ แถว) แต่คนอ่านไม่ได้ประธานมาด้วย สายเดียวใส่ *แต่* ลงไป
 * ระหว่างสองข้อนั้นได้ สองย่อหน้าใส่ไม่ได้
 *
 * กติกาเดียวกับกอง ก: หัวข้อเป็น `<strong>` ในสายเดียวกับเนื้อ บรรทัดตัดตรง
 * ที่ประโยคตัด ไม่ใช่ตัดหนึ่งครั้งต่อหนึ่งก้อน
 */
test('สองโมดัลนี้ไม่มีย่อหน้าที่สองใต้คำเตือนอีกแล้ว', () => {
  for (const [name, code] of [['ยกเลิกใบ', cancel], ['ขอถอนใบ', ask]]) {
    assert.ok(
      !/className="hint"/.test(code),
      `${name}: ย่อหน้าเทาใต้ <Alert> กลับมาแล้ว`,
    );
    assert.equal(
      (code.match(/<Alert kind="warn">/g) || []).length, 1,
      `${name}: ควรมีคำเตือนกล่องเดียว`,
    );
    assert.match(code, /<Alert kind="warn">[\s\S]{0,20}<strong>/);
  }
});

/**
 * ชื่อคนที่ตัดสินใจ เคยถูกพูดสองครั้งห่างกันเจ็ดคำ — `<Alert>` จบด้วย
 * *จนกว่าหัวหน้างานหรือฝ่ายบุคคลจะอนุมัติให้ถอน* แล้ว `.hint` บรรทัดถัดไป
 * เปิดด้วย *หัวหน้างานของแผนกหรือฝ่ายบุคคลเป็นผู้พิจารณา* คนละความยาว
 * คนเดียวกัน · ที่เหลือรอดคือฉบับที่มี **แผนก** อยู่ในนั้น เพราะบริษัทนี้มี
 * หัวหน้างานหลายคนและคนที่ตัดสินใบนี้คือคนของแผนกตัวเอง
 */
test('โมดัลขอถอนใบบอกว่าใครเป็นคนตัดสินครั้งเดียว และบอกว่าแผนกไหน', () => {
  assert.equal((ask.match(/หัวหน้างาน/g) || []).length, 1, 'ชื่อผู้พิจารณาถูกพูดซ้ำ');
  assert.match(ask, /หัวหน้างานของแผนกหรือฝ่ายบุคคล/);
});

/**
 * สิ่งที่ห้ามหายไปพร้อมกับการย่อ — ห้าข้อนี้คือเหตุผลที่กล่องพวกนี้มีอยู่
 * ไม่ใช่ส่วนเกินของมัน · การย่อที่เอาข้อใดข้อหนึ่งออกไม่ใช่การย่อ
 */
test('การย่อไม่ได้เอาข้อเท็จจริงข้อไหนออกไปด้วย', () => {
  // ยกเลิกใบ — แก้กลับไม่ได้ และ *ฝ่ายบุคคลก็แก้ให้ไม่ได้* ซึ่งเป็นครึ่งที่
  // `test/cancelPermission.test.js` พิสูจน์ไว้ว่าจริงในโค้ด
  assert.match(cancel, /แก้กลับไม่ได้/);
  assert.match(cancel, /ฝ่ายบุคคล/);
  // รายการไม่ได้หายไปจากตาราง แต่ชั่วโมงหลุดจากเพดาน — คนละเรื่องกัน
  assert.match(cancel, /ไม่ได้ถูกลบทิ้ง/);
  assert.match(cancel, /เพดานของแผนก/);
  // และทางออก: ยื่นใหม่ได้ ไม่จำกัดจำนวนครั้ง (`refileState` คืน null)
  assert.match(cancel, /ไม่จำกัดจำนวนครั้ง/);

  // ขอถอนใบ — ยังไม่มีอะไรเกิดขึ้น ชั่วโมงยังถูกนับอยู่
  assert.match(ask, /ไม่ใช่การยกเลิก/);
  assert.match(ask, /ชั่วโมงยังถูกนับในเพดานของแผนก/);
  // และผลทั้งสองทาง ทางละหนึ่งวรรค
  assert.match(ask, /ถ้าอนุมัติ/);
  assert.match(ask, /ถ้าไม่อนุมัติ/);
});

/**
 * `.field-note` ใต้ช่องกรอกไม่ใช่เป้าของกองนี้ และไม่ควรถูกกวาดไปด้วย —
 * มันเป็นของ*ช่องนั้น* ตอบคำถามว่ากรอกแล้วเกิดอะไรขึ้นกับสิ่งที่พิมพ์ลงไป
 * ไม่ใช่ว่ากดปุ่มแล้วเกิดอะไรขึ้นกับใบ · และสองใบนี้ต่างกันตรงบังคับ/ไม่บังคับ
 * ซึ่งเป็นข้อมูลที่อ่านได้ก่อนพิมพ์เท่านั้นถึงจะมีประโยชน์
 */
test('ข้อความใต้ช่องเหตุผลยังอยู่ครบทั้งสองใบ และยังบอกว่าบังคับหรือไม่', () => {
  assert.match(cancel, /className="field-note">ไม่บังคับ/);
  assert.match(ask, /className="field-note">[\s\S]{0,20}จำเป็นต้องกรอก/);
});
