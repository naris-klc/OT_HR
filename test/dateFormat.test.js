import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { thaiDate, thaiDateTime, thaiStamp, periodLabel } from '../lib/api.js';
import { thaiText, thaiWords } from '../lib/smartDate.js';

/**
 * รูปแบบวันที่ของทั้งระบบ — DD/MM/YYYY
 *
 * ขอมาเป็นคำสั่งเดียวเมื่อ 4 ก.ย. 2569: "ใช้ทั้งระบบเลย" ก่อนหน้านั้นวันที่ถูกเขียน
 * สามแบบแล้วแต่ว่าไปเจอที่ไหน — "19 กันยายน 2569" ในประโยค "19 ก.ย. 69" ในตาราง
 * และอะไรก็ตามที่ toLocaleString('th-TH') คืนมาในร่องรอยการแก้ไข
 *
 * ไฟล์นี้ไม่ได้ทดสอบฟังก์ชันใดฟังก์ชันหนึ่ง แต่ทดสอบ "ข้อตกลง" ว่ามีรูปแบบเดียว
 * ซึ่งเป็นสิ่งที่พังได้เงียบที่สุด เพราะจอที่เขียนวันที่ผิดรูปก็ยังอ่านออกอยู่ดี
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

/** ทุกไฟล์ต้นทางที่คนเขียนเอง — ไม่รวมเทสต์ ซึ่งพูดถึงกฎได้ตามหน้าที่ */
const SOURCE = ['app', 'lib', 'src', 'components', 'legacy']
  .flatMap((d) => walk(d))
  .filter((f) => /\.(js|jsx)$/.test(f));

/** โค้ดล้วน — ข้อห้ามที่นับคอมเมนต์ด้วยไม่ได้พิสูจน์อะไร */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── รูปร่าง ─────────────────────────────────────────────────────────────────

test('วันที่บนจอคือ DD/MM/YYYY ปี พ.ศ. — สองหลักทั้งวันและเดือน', () => {
  assert.equal(thaiDate('1972-09-19'), '19/09/2515');
  assert.equal(thaiDate('2026-08-14'), '14/08/2569');
  assert.equal(thaiDate('2026-12-31'), '31/12/2569');

  /**
   * เลขศูนย์นำหน้าคือเหตุผลที่ฟังก์ชันนี้เขียนเอง ไม่ยกให้ locale ทำ:
   * toLocaleString('th-TH') คืน 4/9/2569 และคอลัมน์วันที่ที่ความกว้างเปลี่ยน
   * ระหว่างวันที่ 9 กับวันที่ 10 คือสิ่งที่ศูนย์นำหน้ามีไว้แก้
   */
  assert.equal(thaiDate('2026-09-04'), '04/09/2569');
  for (let d = 1; d <= 28; d += 1) {
    const iso = `2026-09-${String(d).padStart(2, '0')}`;
    assert.equal(thaiDate(iso).length, 10, `${iso} ต้องกว้างเท่ากันทุกวัน`);
  }

  // ไม่มีค่า คืนค่าว่าง — แถวเก่าที่ยังไม่มีฟิลด์นี้ต้องไม่พิมพ์ "Invalid Date"
  assert.equal(thaiDate(''), '');
  assert.equal(thaiDate(null), '');
  assert.equal(thaiDate(undefined), '');
});

test('เวลาที่ประทับไว้ใช้วันที่ชุดเดียวกัน ต่างกันแค่วินาทีกับ "น."', () => {
  const at = new Date(2026, 7, 14, 16, 3, 22);
  assert.equal(thaiStamp(at), '14/08/2569 16:03:22');
  assert.equal(thaiStamp(at, { seconds: false }), '14/08/2569 16:03');
  assert.equal(thaiDateTime(at), '14/08/2569 16:03 น.');

  // ครึ่งซ้ายของทั้งสาม คือ thaiDate ของวันเดียวกัน ตัวต่อตัว
  assert.ok(thaiStamp(at).startsWith(thaiDate('2026-08-14')));
  assert.ok(thaiDateTime(at).startsWith(thaiDate('2026-08-14')));

  // เที่ยงคืนกับตอนเช้าต้องเป็นสองหลักด้วย ไม่ใช่ 0:05
  assert.equal(thaiStamp(new Date(2026, 0, 5, 0, 5, 7)), '05/01/2569 00:05:07');

  for (const nothing of ['', null, undefined, 'ไม่ทราบ']) {
    assert.equal(thaiStamp(nothing), '', String(nothing));
    assert.equal(thaiDateTime(nothing), '', String(nothing));
  }
});

test('ฝั่งเซิร์ฟเวอร์อ่านเหมือนฝั่งจอ — thaiText กับ thaiDate', () => {
  for (const iso of ['1972-09-19', '1998-03-05', '2026-09-04', '2026-12-31']) {
    assert.equal(thaiText(iso), thaiDate(iso), `${iso} ต้องอ่านเหมือนกันทั้งสองฝั่ง`);
  }
});

test('งวดยังเป็นชื่อเดือน — งวดไม่มีวันให้ใส่ไว้ข้างหน้า', () => {
  /**
   * ไม่ใช่ที่ที่ตกหล่น แต่เป็นคนละเรื่อง: DD/MM/YYYY เป็นรูปของ *วันที่* ส่วนงวด
   * คือ *เดือน* ทั้งเดือน ไม่มีวันไหนจะไปอยู่หน้าเดือนได้
   */
  assert.equal(periodLabel('2026-08'), 'สิงหาคม 2569');
  assert.equal(periodLabel('2026-01'), 'มกราคม 2569');
  assert.equal(periodLabel(''), '');
});

// ── ข้อห้าม ─────────────────────────────────────────────────────────────────

test('ไม่มีจอไหนจัดรูปแบบวันที่ด้วย locale อีกแล้ว', () => {
  /**
   * นี่คือครึ่งที่จับของจริงได้ ร่องรอยการแก้ไขทุกเส้นเคยพิมพ์
   * new Date(x).toLocaleString('th-TH') ซึ่งลำดับถูกและศักราชถูก แต่ไม่มีศูนย์
   * นำหน้า และเปลี่ยนรูปอีกครั้งระหว่าง dateStyle 'short' กับ 'medium' ที่
   * บันทึกระบบ ใช้อยู่ข้างกันบนจอเดียว
   *
   * toLocaleString('th-TH') กับ *ตัวเลข* ไม่ห้าม — คั่นหลักพันเป็นคนละเรื่อง และ
   * เป็นเหตุผลที่ข้อห้ามผูกกับ Date(...) ไม่ใช่ผูกกับชื่อเมท็อดเปล่า ๆ
   */
  const BANNED = [
    [/toLocaleDateString/, 'toLocaleDateString'],
    [/toLocaleTimeString/, 'toLocaleTimeString'],
    [/dateStyle/, 'dateStyle'],
    [/timeStyle/, 'timeStyle'],
    [/Date\([^\n]*\)\.toLocaleString/, 'new Date(...).toLocaleString'],
  ];
  const offenders = [];
  for (const f of SOURCE) {
    const code = strip(read(f));
    for (const [re, name] of BANNED) if (re.test(code)) offenders.push(`${f} (${name})`);
  }
  assert.deepEqual(offenders, [], `ให้ใช้ thaiDate / thaiDateTime / thaiStamp แทน: ${offenders.join(', ')}`);
});

test('Intl.DateTimeFormat มีได้สองที่ และทั้งสองไม่ได้พิมพ์วันที่ให้คนอ่าน', () => {
  /**
   * lib/today.js ใช้มันหาว่า "วันนี้" ที่ออฟฟิศคือวันไหน เป็นคีย์ 'YYYY-MM-DD'
   * ไว้เปรียบเทียบ ไม่ใช่ข้อความบนจอ · lib/smartDate.js ใช้มันย้ายเวลาที่เก็บไว้
   * ไปยังเขตเวลาที่ผู้เรียกระบุ แล้วจึงประกอบเป็น DD/MM/YYYY เอง — การขอปฏิทินไทย
   * จาก Intl จะพ่วงชื่อเดือนไทยและการนับปีที่แอปนี้ไม่ได้ใช้มาด้วย
   */
  const users = SOURCE.filter((f) => /Intl\.DateTimeFormat/.test(strip(read(f))));
  assert.deepEqual(users.sort(), ['lib/smartDate.js', 'lib/today.js']);
});

test('เดือนถูกสะกดเป็นคำโดยมีวันนำหน้าได้แค่สองที่ — และทั้งสองมีไว้แก้ความกำกวม', () => {
  /**
   * ชื่อเดือนเปล่า ๆ ไม่ห้าม: หัวข้องวด หัวปฏิทิน และหัวรายงานล้วนเป็น "เดือน"
   * ทั้งเดือน ที่ห้ามคือ *วันที่* ที่สะกดเดือนออกมา — "19 กันยายน 2515" — เพราะ
   * นั่นคือรูปที่ DD/MM/YYYY มาแทน ข้อห้ามจึงจับ "วันนำหน้าชื่อเดือน" ไม่ใช่จับ
   * ชื่อเดือน
   *
   * สองที่ที่เหลือคือข้อยกเว้นเดียวกันด้วยเหตุผลเดียวกัน: ประโยคที่มีหน้าที่บอกว่า
   * 05/03 กับ 03/05 ต่างกันอย่างไร ตอบด้วยตัวเลขชุดที่สามไม่ได้ — thaiWords ใน
   * ข้อความปฏิเสธ เดือน/วัน/ปี และ readableDate ที่ตัวอย่างการอ่านไฟล์ CSV
   */
  const spelled = SOURCE.filter((f) => /\}\s+\$\{THAI_MONTH/.test(strip(read(f))));
  assert.deepEqual(spelled.sort(), ['lib/birthDate.js', 'lib/smartDate.js']);

  assert.equal(thaiWords('1972-09-19'), '19 กันยายน 2515');
  assert.notEqual(thaiWords('1972-09-19'), thaiDate('1972-09-19'));
});
