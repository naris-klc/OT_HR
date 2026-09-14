import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * สามจอ เมนูเดียว และรูปแบบเดียว — 2026-09-14.
 *
 * ขอมาเป็นประโยคเดียว: *กระชับข้อความ และคำอธิบาย ปุ่มตัวเลือก ส่งออก csv/excel
 * และ พิมพ์/pdf · ให้เรียงลำดับด้วย พิมพ์/pdf ขึ้นก่อน · จัดให้เป็นรูปแบบเสมอกัน
 * ทั้ง 3 หน้า* — ตรวจสอบประจำเดือน · รายงาน OT การเงิน · รายงาน OT แยกแผนก
 *
 * ทั้งสามจอใช้ `ExportMenu` ตัวเดียวกันมาตั้งแต่ 2026-09-10 แต่ *สิ่งที่ใส่ลงไป*
 * เป็นของแต่ละจอเอง และนั่นคือจุดที่มันแยกกันเดินโดยไม่มีอะไรพัง: สองจอรายงาน
 * เอาไฟล์ CSV ขึ้นก่อนและให้เป็นแถวเด่น ส่วนจอตรวจสอบประจำเดือนเอาปุ่มพิมพ์
 * ขึ้นก่อน — ต่างคนต่างมีเหตุผลที่จริงของจอตัวเอง ซึ่งเป็นวิธีที่สองจอที่สร้าง
 * จากคอมโพเนนต์เดียวกันกลายเป็นสองจอได้ในที่สุด
 *
 * เทสต์นี้จึงอ่านสามจอ *พร้อมกัน* ไม่ใช่ทีละจอ: กฎที่ถูกขอมาเป็นกฎที่พูดถึง
 * ความสัมพันธ์ระหว่างจอ และกฎแบบนั้นเขียนไว้ในไฟล์ของจอไหนก็ไม่มีใครเห็น
 *
 * สิ่งที่ *ไม่* ถูกตรึงไว้ที่นี่คือจำนวนแถวและตัวหนังสือในแถว — ตรวจสอบประจำเดือน
 * มีสามแถว อีกสองจอมีสองแถว และแต่ละจอเรียกเอกสารของตัวเองด้วยชื่อของมันเอง
 * ที่ตรึงไว้คือ *ลำดับ* · *เสียงเน้น* · และคำเตือนสองประโยคที่ย่อแล้วต้องไม่หาย
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCREENS = [
  ['components/HrView.jsx', 'ตรวจสอบประจำเดือน'],
  ['components/AccountingView.jsx', 'รายงาน OT การเงิน'],
  ['components/DepartmentView.jsx', 'รายงาน OT แยกแผนก'],
];

/** แถวของเมนู อ่านจากโค้ดของจอ ไม่ใช่รายการที่พิมพ์ซ้ำไว้ในเทสต์ */
function rowsOf(file) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const at = src.indexOf('<ExportMenu');
  assert.notEqual(at, -1, `${file} เลิกใช้ ExportMenu แล้ว`);
  const menu = src.slice(at, src.indexOf(']}', at));
  const keys = [...menu.matchAll(/\n\s*key: '([^']+)',/g)];
  assert.ok(keys.length >= 2, `${file} เมนูเหลือแถวเดียว`);
  return keys.map((m, i) => {
    const body = menu.slice(m.index, i + 1 < keys.length ? keys[i + 1].index : menu.length);
    const label = body.match(/\n\s*label: '([^']+)',/);
    const note = body.match(/\n\s*note: '([^']+)',/);
    assert.ok(label, `${file} แถว ${m[1]} ไม่มีป้ายชื่อ`);
    return {
      key: m[1],
      label: label[1],
      note: note && note[1],
      primary: /\n\s*primary: true,/.test(body),
    };
  });
}

test('ทั้งสามจอเปิดเมนูด้วยแถวพิมพ์ และแถวนั้นเป็นแถวเด่นแถวเดียว', () => {
  for (const [file, screen] of SCREENS) {
    const rows = rowsOf(file);
    assert.ok(rows[0].label.startsWith('พิมพ์'),
      `${screen}: แถวแรกของเมนูคือ “${rows[0].label}” — พิมพ์/PDF ต้องขึ้นก่อน`);
    assert.ok(rows[0].primary,
      `${screen}: แถวพิมพ์ไม่ใช่แถวเด่นแล้ว — เสียงเน้นกับลำดับต้องเป็นแถวเดียวกัน`);
    const lead = rows.filter((r) => r.primary);
    assert.equal(lead.length, 1,
      `${screen}: มีแถวเด่น ${lead.length} แถว — เมนูนี้มีได้แถวเดียว`);
    // ไม่มีจอไหนพูดคำว่า พิมพ์ สองแถว ซึ่งจะทำให้ “แถวแรกคือแถวพิมพ์” ไม่มีความหมาย
    assert.equal(rows.filter((r) => r.label.startsWith('พิมพ์')).length, 1,
      `${screen}: มีแถวขึ้นต้นด้วย พิมพ์ มากกว่าหนึ่งแถว`);
  }
});

test('ป้ายชื่อแถวไม่พูดคำว่า ส่งออก ซ้ำกับปุ่มที่มันอยู่ข้างใน', () => {
  // ปุ่มที่เปิดเมนูชื่อ พิมพ์ / ส่งออก อยู่แล้ว — อ่านออกมาจากคอมโพเนนต์เอง
  const label = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8')
    .match(/export function ExportMenu\(\{[^}]*label = '([^']+)'/)[1];
  assert.ok(label.includes('ส่งออก'), 'ปุ่มเลิกพูดคำว่า ส่งออก แล้ว — กฎข้างล่างไม่จำเป็นอีก');
  for (const [file, screen] of SCREENS) {
    for (const row of rowsOf(file)) {
      assert.ok(!row.label.includes('ส่งออก'),
        `${screen}: “${row.label}” พูดคำที่ปุ่ม “${label}” พูดไปแล้ว`);
      // และทุกแถวมีคำอธิบายกำกับว่าได้อะไรออกมา — คำอธิบายคือที่ที่ความยาว
      // ถูกย้ายไปอยู่ตอนที่ป้ายชื่อถูกตัดให้สั้น
      assert.ok(row.note, `${screen}: แถว “${row.label}” ไม่มีคำอธิบายกำกับ`);
    }
  }
});

test('ย่อคำอธิบายได้ แต่คำเตือนสองประโยคนี้ห้ามหาย', () => {
  // ⚠ ทั้งสองประโยคเคยอยู่ใต้ปุ่มเป็น `.hint` และย้ายเข้ามาเป็นคำอธิบายของแถว
  // เมื่อ 2026-09-10 · วันที่ 2026-09-14 ถูกย่อลงอีก และนี่คือสิ่งที่การย่อ
  // รอบต่อไปจะตัดทิ้งก่อนเป็นอย่างแรก เพราะมันเป็นส่วนที่ยาวที่สุดของบรรทัด
  const acct = rowsOf('components/AccountingView.jsx');
  const csv = acct.find((r) => r.key === 'csv');
  assert.ok(/ไม่ใช่เงิน|ไม่มีการคำนวณเป็นเงิน/.test(csv.note),
    'รายงาน OT การเงิน: ไฟล์ที่ส่งออกเป็นชั่วโมง ไม่ใช่เงิน — คำอธิบายเลิกบอกแล้ว');

  // บนแยกแผนก ประโยคนี้เป็นสิ่งที่คนอ่านผิดได้: ทั้งไฟล์และแบบฟอร์มออกครบทุกแผนก
  // เสมอ ไม่ขึ้นกับ dropdown แผนก ที่อยู่ห่างไปสองนิ้ว — จึงต้องอยู่ *ทั้งสองแถว*
  for (const row of rowsOf('components/DepartmentView.jsx')) {
    assert.ok(/ทุกแผนก/.test(row.note),
      `รายงาน OT แยกแผนก: แถว “${row.label}” เลิกบอกว่าออกครบทุกแผนก`);
    assert.ok(/ไม่ตามตัวกรอง|ไม่ขึ้นกับ/.test(row.note),
      `รายงาน OT แยกแผนก: แถว “${row.label}” เลิกบอกว่าไม่ขึ้นกับแผนกที่เลือก`);
  }
});
