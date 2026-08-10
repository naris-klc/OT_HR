import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCsv } from '../src/lib/csv.js';
import {
  resolveBirthDateColumn,
  birthDatePreview,
  readableDate,
} from '../lib/birthDate.js';

/**
 * The วันเกิด column of a roster CSV, and the one wrong answer nothing catches.
 *
 * HR types 1998-03-05. Excel displays 05/03/1998 and writes that back on save,
 * so the file that reaches the importer is in an order the machine's locale
 * chose. Read the wrong way, 05/03/1998 becomes 3 May: a real date, a clean
 * import, an employee whose birthday holiday falls two months off, and no error
 * anywhere ever — a birthday is only ever compared against itself.
 *
 * That is why the rules pinned here are about the FILE and not the row. Excel
 * rewrites the whole column at once, so one row that can be read only one way
 * settles the order for every ambiguous row beside it, and a file with no such
 * row is refused entire. "Import the rows we could read" is the same guess made
 * quietly, so it is tested against explicitly.
 *
 * Run with: npm test
 */

const rowsOf = (...birthDates) => parseCsv(
  ['code,name,department,birthDate']
    .concat(birthDates.map((b, i) => `PM0${i + 1},คนที่ ${i + 1},ENG,${b}`))
    .join('\n'),
);

// ── the three accepted shapes ───────────────────────────────────────────────

test('อ่านได้ทั้ง YYYY-MM-DD, DD/MM/YYYY และ D/M/YYYY', () => {
  // 15/05 is the decider that lets the two ambiguous rows beside it be read.
  const r = resolveBirthDateColumn(rowsOf('1989-05-12', '15/05/1998', '5/3/1998'));

  assert.equal(r.ok, true, 'ไฟล์นี้ตีความได้ ไม่ควรถูกปฏิเสธ');
  assert.deepEqual(
    r.cells.map((c) => c.date),
    ['1989-05-12', '1998-05-15', '1998-03-05'],
    'ทั้งสามรูปแบบต้องได้ ค.ศ. YYYY-MM-DD เหมือนกัน',
  );
  assert.equal(r.rowErrors.length, 0);
});

test('ไฟล์ที่เป็น YYYY-MM-DD ล้วน รายงานว่าอ่านแบบ iso', () => {
  const r = resolveBirthDateColumn(rowsOf('1989-05-12', '1998-03-05'));
  assert.equal(r.order, 'iso');
  assert.equal(r.decidedBy, null, 'ไม่มีอะไรต้องตัดสิน จึงไม่ควรอ้างแถวใดเป็นตัวชี้ขาด');
});

// ── the dangerous case ──────────────────────────────────────────────────────

test('05/03/1998 เดี่ยว ๆ ในไฟล์ที่ไม่มีตัวชี้ขาด → ปฏิเสธทั้งไฟล์ ไม่ใช่เดา', () => {
  const r = resolveBirthDateColumn(rowsOf('05/03/1998'));

  assert.equal(r.ok, false, 'ต้องปฏิเสธ ไม่ใช่เลือกทางใดทางหนึ่ง');
  assert.deepEqual(r.ambiguous, [{ line: 2, raw: '05/03/1998' }], 'ต้องบอกเลขบรรทัดและค่าที่มีปัญหา');
  assert.match(r.fileError, /5 มีนาคม 1998/, 'ข้อความต้องบอกทางเลือกที่หนึ่ง');
  assert.match(r.fileError, /3 พฤษภาคม 1998/, 'ข้อความต้องบอกทางเลือกที่สอง');
  assert.match(r.fileError, /YYYY-MM-DD/, 'ต้องบอกวิธีแก้');
  assert.equal(r.cells.length, 0, 'ปฏิเสธแล้วต้องไม่มีค่าใดถูกตีความไว้ให้ใช้ต่อ');
});

test('ปฏิเสธทั้งไฟล์ — ห้ามปล่อยแถวที่อ่านได้ผ่านไปแถวเดียว', () => {
  // 1989-05-12 อ่านได้แน่นอน แต่ต้องไม่ถูกนำเข้า: แถวที่เหลือตีความไม่ได้
  // และการนำเข้าครึ่งไฟล์คือการเดาแบบเงียบ ๆ อยู่ดี
  const r = resolveBirthDateColumn(rowsOf('1989-05-12', '05/03/1998'));

  assert.equal(r.ok, false);
  assert.equal(r.byLine.size, 0, 'ไม่มีบรรทัดใดถูกส่งต่อให้ผู้เรียกใช้');
  assert.equal(r.rowErrors.length, 0, 'ไม่ใช่ปัญหารายแถว — ทั้งไฟล์ต้องหยุด');
});

test('ไฟล์ที่มี 15/05/1998 ปนอยู่ → ตีความทั้งไฟล์เป็น DD/MM และบอกว่าใครเป็นตัวตัดสิน', () => {
  const r = resolveBirthDateColumn(rowsOf('05/03/1998', '15/05/1998', '12/12/1975'));

  assert.equal(r.ok, true);
  assert.equal(r.order, 'dmy');
  assert.deepEqual(
    r.cells.map((c) => c.date),
    ['1998-03-05', '1998-05-15', '1975-12-12'],
    'ทุกแถวต้องอ่านแบบเดียวกัน รวมถึงแถวที่กำกวมในตัวเอง',
  );
  assert.deepEqual(
    r.decidedBy,
    { line: 3, raw: '15/05/1998' },
    'ผู้ใช้ต้องเห็นว่าอะไรทำให้ตีความแบบนี้ ไม่ใช่แค่ผลลัพธ์',
  );
});

test('ไฟล์ที่เขียนแบบ MM/DD/YYYY → ปฏิเสธทั้งไฟล์ พร้อมเรียกชื่อรูปแบบ', () => {
  // Excel บนเครื่อง locale อังกฤษเขียนแบบนี้ ระบบไม่รับ และการบอกว่า
  // "เดือน 25 ไม่ถูกต้อง" ไม่ช่วยให้ HR รู้ว่าไฟล์มาจากเครื่องแบบไหน
  const r = resolveBirthDateColumn(rowsOf('05/25/1998', '03/05/1998'));

  assert.equal(r.ok, false);
  assert.match(r.fileError, /MM\/DD\/YYYY/);
  assert.match(r.fileError, /บรรทัด 2 \("05\/25\/1998"\)/, 'ต้องชี้บรรทัดที่เป็นหลักฐาน');
});

test('ไฟล์ที่มีหลักฐานขัดกันเอง → ปฏิเสธ ไม่เลือกข้าง', () => {
  const r = resolveBirthDateColumn(rowsOf('15/05/1998', '05/25/1998'));

  assert.equal(r.ok, false);
  assert.match(r.fileError, /ไม่สอดคล้องกัน/);
  assert.match(r.fileError, /15\/05\/1998/);
  assert.match(r.fileError, /05\/25\/1998/);
});

// ── ปี พ.ศ. ─────────────────────────────────────────────────────────────────

test('ปี พ.ศ. → ปฏิเสธแถวนั้นพร้อมบอกว่าต้องใช้ ค.ศ. และแปลงให้ดู', () => {
  const r = resolveBirthDateColumn(rowsOf('15/05/2541'));

  assert.equal(r.ok, true, 'เป็นปัญหาของแถว ไม่ใช่ของทั้งไฟล์');
  assert.equal(r.cells[0].date, null, 'ห้ามลบ 543 ให้เอง');
  assert.match(r.cells[0].error, /พ\.ศ\./);
  assert.match(r.cells[0].error, /ค\.ศ\. 1998/, 'บอกค่าที่ถูกต้องไปเลย จะได้แก้ได้ทันที');
  assert.deepEqual(r.rowErrors.map((e) => e.line), [2]);
});

test('ปี พ.ศ. ในรูป YYYY-MM-DD ก็ถูกปฏิเสธเหมือนกัน', () => {
  const r = resolveBirthDateColumn(rowsOf('2541-03-05'));
  assert.match(r.cells[0].error, /พ\.ศ\./);
});

test('ปี พ.ศ. ที่กำกวมไม่นับเป็นตัวชี้ขาด และไม่ทำให้ทั้งไฟล์ล้ม', () => {
  // 05/03/2541 อ่านไม่ออกเพราะปีผิด — จึงไม่ใช่ทั้งหลักฐานและไม่ใช่ความกำกวม
  const r = resolveBirthDateColumn(rowsOf('05/03/2541', '1989-05-12'));

  assert.equal(r.ok, true);
  assert.equal(r.rowErrors.length, 1, 'แถวปี พ.ศ. ตกไปแถวเดียว');
  assert.equal(r.cells[1].date, '1989-05-12', 'แถวที่ถูกต้องยังนำเข้าได้');
});

// ── ปฏิทินจริง ──────────────────────────────────────────────────────────────

test('29 ก.พ. ปีอธิกสุรทิน ผ่าน — ปีปกติไม่ผ่าน', () => {
  const leap = resolveBirthDateColumn(rowsOf('29/02/1996'));
  assert.equal(leap.ok, true);
  assert.equal(leap.cells[0].date, '1996-02-29', '1996 เป็นปีอธิกสุรทิน');
  assert.equal(leap.cells[0].error, null);

  const common = resolveBirthDateColumn(rowsOf('29/02/1998'));
  assert.equal(common.cells[0].date, null);
  assert.match(common.cells[0].error, /ไม่มีอยู่จริง/);

  // ทางร้อยปีที่คนพลาดกันบ่อย: 1900 ไม่ใช่ปีอธิกสุรทิน แต่ 2000 ใช่
  assert.equal(resolveBirthDateColumn(rowsOf('29/02/2000')).cells[0].date, '2000-02-29');
  assert.equal(resolveBirthDateColumn(rowsOf('29/02/1900')).cells[0].date, null);
  // และรูปแบบ ISO ต้องถูกตรวจปฏิทินเหมือนกัน ไม่ใช่แค่ตรวจหน้าตา
  assert.match(resolveBirthDateColumn(rowsOf('1998-02-29')).cells[0].error, /ไม่มีอยู่จริง/);
});

test('วันที่ผิดแบบไม่ว่าอ่านทางไหนก็ผิด → ตกเป็นความผิดของแถว ไม่ใช่หลักฐานของไฟล์', () => {
  // 31/04 ไม่มีจริง (เมษายนมี 30 วัน) จึงต้องไม่ถูกใช้ตัดสินว่าไฟล์เป็น DD/MM
  const r = resolveBirthDateColumn(rowsOf('31/04/1998', '05/03/1998'));

  assert.equal(r.ok, false, 'เหลือ 05/03/1998 ที่ไม่มีตัวชี้ขาด → ต้องปฏิเสธทั้งไฟล์');
  assert.deepEqual(r.ambiguous, [{ line: 3, raw: '05/03/1998' }]);
});

test('ค่าที่ไม่ใช่วันที่เลย → ผิดเฉพาะแถว', () => {
  const r = resolveBirthDateColumn(rowsOf('ไม่ทราบ', '1989-05-12'));
  assert.equal(r.ok, true);
  assert.match(r.rowErrors[0].error, /ไม่ใช่รูปแบบที่รองรับ/);
  assert.equal(r.rowErrors[0].line, 2);
});

// ── ไฟล์ที่ไม่มีคอลัมน์วันเกิด ───────────────────────────────────────────────

test('ไฟล์ที่ไม่มีคอลัมน์วันเกิด → ยังนำเข้าได้เหมือนเดิม', () => {
  const rows = parseCsv('code,name,department\nPM001,สมชาย ใจดี,ENG\nPM002,สมหญิง ดีใจ,PROD');
  const r = resolveBirthDateColumn(rows);

  assert.equal(r.ok, true, 'ไม่มีวันเกิดไม่ใช่ความผิด');
  assert.equal(r.order, null);
  assert.equal(r.fileError, null);
  assert.deepEqual(r.cells, []);
  assert.deepEqual(r.rowErrors, []);
});

test('คอลัมน์วันเกิดที่เว้นว่างไว้ ถูกข้ามไปเงียบ ๆ', () => {
  const r = resolveBirthDateColumn(rowsOf('', '1989-05-12', ''));
  assert.equal(r.ok, true);
  assert.deepEqual(r.cells.map((c) => c.line), [3], 'มีแค่แถวที่กรอกไว้จริง');
});

test('หัวคอลัมน์ภาษาไทยและแบบขีดล่างก็อ่านได้', () => {
  for (const header of ['วันเกิด', 'birth_date']) {
    const r = resolveBirthDateColumn(parseCsv(`code,${header}\nPM001,15/05/1998`));
    assert.equal(r.cells[0]?.date, '1998-05-15', `หัวคอลัมน์ "${header}" ต้องถูกอ่าน`);
  }
});

// ── สิ่งที่ HR เห็นก่อนกดยืนยัน ──────────────────────────────────────────────

test('ตัวอย่างผลการตีความ แสดงอย่างน้อย 3 แถวแรกในรูปที่คนอ่านออก', () => {
  const r = resolveBirthDateColumn(rowsOf('05/03/1998', '15/05/1998', '12/12/1975', '01/01/1980'));
  const preview = birthDatePreview(r);

  assert.equal(preview.length, 3, 'อย่างน้อยสามแถวแรก');
  assert.equal(preview[0].text, '05/03/1998 → 5 มีนาคม 1998', 'ต้องอ่านออกโดยไม่ต้องแปลเอง');
  assert.equal(preview[1].text, '15/05/1998 → 15 พฤษภาคม 1998');
  assert.deepEqual(preview.map((p) => p.line), [2, 3, 4], 'มีเลขบรรทัดให้ไปตามหาในไฟล์ได้');
});

test('ตัวอย่างบอกด้วยเมื่อแถวนั้นใช้ไม่ได้ ไม่ใช่แสดงช่องว่าง', () => {
  const preview = birthDatePreview(resolveBirthDateColumn(rowsOf('15/05/2541')));
  assert.match(preview[0].text, /15\/05\/2541 → .*พ\.ศ\./);
});

test('readableDate เป็น ค.ศ. — ปีเดียวกับที่อยู่ในไฟล์', () => {
  // ต่างจาก thaiDate() ในหน้าจออื่นที่บวก 543 โดยตั้งใจ: ตัวอย่างนี้มีไว้ให้
  // เทียบกับค่าในไฟล์ ถ้าแปลงปีให้ด้วยก็เทียบไม่ได้แล้ว
  assert.equal(readableDate('1998-03-05'), '5 มีนาคม 1998');
  assert.equal(readableDate('1996-02-29'), '29 กุมภาพันธ์ 1996');
});

// ── การต่อสาย ────────────────────────────────────────────────────────────────

/**
 * The rule only holds if the server applies it. These files resolve `@/…`
 * through the Next alias, which `node --test` does not, so they are read as
 * text — the same idiom as test/birthdayStaysOnTheForm.test.js.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

test('เส้นทางนำเข้าตัดสินวันเกิดทั้งไฟล์ ก่อนเขียนแถวใดลงฐานข้อมูล', () => {
  const src = read('app/api/employees/import/route.js');

  const check = src.indexOf('resolveBirthDateColumn(rows)');
  const loop = src.indexOf('for (const [i, row] of rows.entries())');
  assert.ok(check > 0, 'route ต้องเรียกตัวตีความรวมของทั้งไฟล์');
  assert.ok(check < loop, 'ต้องตรวจก่อนวนแถว มิฉะนั้นจะเขียนบางแถวลงไปแล้วค่อยพบว่าไฟล์ใช้ไม่ได้');
  assert.match(src, /if \(!dates\.ok\) return fail\(/, 'ไฟล์ที่ตีความไม่ได้ต้องจบด้วย 400 ไม่ใช่นำเข้าบางส่วน');

  assert.ok(
    !/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/.test(src),
    'ตัวตรวจรูปแบบเดิมต้องถูกถอดออก ไม่ใช่ปล่อยไว้ซ้อนกับตัวใหม่',
  );
});

test('หน้าทะเบียนพนักงานแสดงตัวอย่างก่อน แล้วจึงอัปโหลดเมื่อยืนยัน', () => {
  const file = read('components/AdminView.jsx');
  // The holidays card in the same file still uploads on pick, and should: a
  // calendar has no ambiguous column to read. Only the roster card is pinned.
  const src = file.slice(file.indexOf('function Employees('), file.indexOf('function ResetPassword('));

  assert.match(src, /birthDatePreview\(/, 'ต้องสร้างตัวอย่างให้ดูก่อน');
  assert.match(src, /async function confirmImport\(\)/, 'การอัปโหลดต้องเป็นขั้นตอนแยกที่ผู้ใช้สั่งเอง');
  assert.match(src, /onChange=\{choose\}/, 'ปุ่มเลือกไฟล์ต้องพาไปที่ตัวอย่าง');
  assert.ok(
    !/onChange=\{upload\}/.test(src),
    'เลือกไฟล์ต้องไม่นำเข้าทันที มิฉะนั้นตัวอย่างจะมาหลังจากสายไปแล้ว',
  );
  const chooseBody = src.slice(
    src.indexOf('async function choose('),
    src.indexOf('async function confirmImport('),
  );
  assert.ok(
    !/api\.upload/.test(chooseBody),
    'การอ่านไฟล์เพื่อทำตัวอย่างต้องไม่ส่งอะไรขึ้นเซิร์ฟเวอร์',
  );
  assert.match(src, /Excel จะเขียนคอลัมน์วันเกิดใหม่/, 'คำเตือนเรื่อง Excel บันทึกทับต้องอยู่ในหน้านี้');
});
