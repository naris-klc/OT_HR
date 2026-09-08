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
  ORDER_LABEL,
} from '../lib/birthDate.js';

/**
 * The วันเกิด column of a roster CSV — read STRICTLY วัน/เดือน/ปี.
 *
 * WHAT THIS FILE USED TO PIN, AND WHY IT DOES NOT ANY MORE.
 *
 * HR types 1998-03-05. Excel displays 05/03/1998 and writes that back on save,
 * so the file that reaches the importer is in an order the machine's locale
 * chose. Read the wrong way, 05/03/1998 becomes 3 May: a real date, a clean
 * import, an employee whose birthday holiday falls two months off, and no error
 * anywhere ever — a birthday is only ever compared against itself.
 *
 * For a month the answer to that was a machine that refused to guess: evidence
 * gathered across the whole file, a refusal when nothing settled it, then a
 * question on the import screen and a company-wide default behind it. Fifty-two
 * cases in this file pinned that machinery. It was withdrawn on 2026-09-04 —
 * "ให้ Strict เป็น วัน-เดือน-ปี ถาวร" — and the cases went with it.
 *
 * WHAT IS PINNED NOW IS THE OTHER SHAPE OF THE SAME WORRY. The reading is
 * unconditional, so what these cases have to hold is that it is unconditional
 * in BOTH directions: no row in a file may bend it (§ตีความคงที่), no caller may
 * pass an order that bends it (§ห้ามมีทางลัดกลับมา), and the two things left
 * standing between HR and a silently transposed roster stay standing — the
 * preview that spells its months out, and a row that cannot be วัน/เดือน saying
 * why by name rather than as "ไม่มีอยู่จริงในปฏิทิน".
 *
 * Run with: npm test
 */

const rowsOf = (...birthDates) => parseCsv(
  ['code,name,department,birthDate']
    .concat(birthDates.map((b, i) => `PM0${i + 1},คนที่ ${i + 1},ENG,${b}`))
    .join('\n'),
);

/** The dates, in file order, for the cases that only care about the reading. */
const datesOf = (...raw) => resolveBirthDateColumn(rowsOf(...raw)).cells.map((c) => c.date);

// ── the shapes that are accepted ────────────────────────────────────────────

test('อ่านได้ทั้ง YYYY-MM-DD, DD/MM/YYYY และ D/M/YYYY', () => {
  const r = resolveBirthDateColumn(rowsOf('1998-03-05', '15/05/1998', '1/2/1997'));
  assert.deepEqual(r.cells.map((c) => c.date), ['1998-03-05', '1998-05-15', '1997-02-01']);
  assert.deepEqual(r.rowErrors, []);
});

test('คั่นด้วย / หรือ - ก็อ่านได้เท่ากัน ทั้งสองรูปแบบ', () => {
  // เลขสี่หลักนำหน้าเป็นปีได้อย่างเดียว เลขหนึ่งถึงสองหลักเป็นปีไม่ได้เลย สองรูป
  // จึงชนกันไม่ได้ ไม่ว่าจะคั่นด้วยอะไร
  assert.deepEqual(
    datesOf('12/05/1989', '12-05-1989', '1989-05-12', '1989/05/12'),
    ['1989-05-12', '1989-05-12', '1989-05-12', '1989-05-12'],
  );
});

test('ไฟล์ที่เป็น YYYY-MM-DD ล้วน รายงานว่าอ่านแบบ iso · มีทับปนอยู่ = mixed', () => {
  assert.equal(resolveBirthDateColumn(rowsOf('1998-03-05', '1997-01-01')).order, 'iso');
  assert.equal(resolveBirthDateColumn(rowsOf('05/03/1998', '01/01/1997')).order, 'dmy');
  assert.equal(resolveBirthDateColumn(rowsOf('1998-03-05', '01/01/1997')).order, 'mixed');
  // และป้ายของทั้งสามต้องมีจริง ไม่ใช่ค่าที่จอเอาไปแสดงเป็น undefined
  for (const key of ['iso', 'dmy', 'mixed']) assert.ok(ORDER_LABEL[key], key);
});

// ── ตีความคงที่: ไม่มีแถวไหนในไฟล์ที่เปลี่ยนการอ่านของแถวอื่นได้ ──────────────

test('05/03/1998 เดี่ยว ๆ อ่านเป็น 5 มีนาคม ทันที ไม่ถามและไม่ปฏิเสธ', () => {
  /**
   * นี่คือเคสที่ทั้งโมดูลเคยมีอยู่เพื่อปฏิเสธ และตอนนี้คือเคสปกติ
   *
   * ผลที่ตามมาเขียนไว้ที่หัวไฟล์ lib/birthDate.js แล้ว: ถ้าไฟล์นี้มาจากเครื่องที่
   * ตั้งเป็นภาษาอังกฤษจริง ๆ ค่านี้คือ 3 พฤษภาคม และจะถูกเก็บเป็น 5 มีนาคม โดย
   * ไม่มีจอไหนแย้งได้ — จุดที่จับได้จุดเดียวคือบรรทัดพรีวิวข้างล่าง
   */
  const r = resolveBirthDateColumn(rowsOf('05/03/1998'));
  assert.deepEqual(r.cells.map((c) => c.date), ['1998-03-05']);
  assert.deepEqual(r.rowErrors, []);
  assert.equal(r.order, 'dmy');
});

test('แถวที่เคยเป็น "ตัวชี้ขาด" ไม่มีอำนาจพิเศษแล้ว', () => {
  // 15/05 เคยชี้ขาดให้ทั้งคอลัมน์ ตอนนี้มันเป็นแค่แถวหนึ่งที่อ่านเหมือนแถวอื่น
  assert.deepEqual(datesOf('15/05/1998', '05/03/1998'), ['1998-05-15', '1998-03-05']);
  assert.deepEqual(datesOf('05/03/1998'), ['1998-03-05'], 'อยู่คนเดียวก็ต้องได้วันเดียวกัน');
});

test('แถวที่อ่านแบบ วัน/เดือน ไม่ได้ ตกเฉพาะแถวนั้น ไม่ลากทั้งไฟล์ไปด้วย', () => {
  const r = resolveBirthDateColumn(rowsOf('05/25/1998', '05/03/1998', '1997-01-01'));
  assert.equal(r.cells[0].date, null, 'ไม่มีเดือนที่ 25');
  assert.deepEqual(
    r.cells.slice(1).map((c) => c.date),
    ['1998-03-05', '1997-01-01'],
    'แถวที่เหลือยังอ่านเป็น วัน/เดือน/ปี เหมือนเดิม ไม่ถูกสลับตาม',
  );
  assert.deepEqual(r.rowErrors.map((e) => e.line), [2]);
});

test('แถวที่อ่านไม่ได้ บอกว่าน่าจะเป็นไฟล์ เดือน/วัน/ปี และบอกวันที่มันน่าจะเป็น', () => {
  /**
   * เหตุผลอยู่ที่หัว lib/birthDate.js: ตั้งแต่เลิกปฏิเสธไฟล์ทั้งไฟล์ แถวที่ตกคือ
   * *สัญญาณเรื่องทั้งคอลัมน์* ไม่ใช่ปัญหาของคนคนเดียว ข้อความว่า "ไม่มีอยู่จริงใน
   * ปฏิทิน" จะส่งคนไปหาความผิดในวันที่ที่ตัวเลขถูกทุกตัว
   */
  const [err] = resolveBirthDateColumn(rowsOf('05/25/1998')).rowErrors;
  assert.match(err.error, /เดือน\/วัน\/ปี/, 'ต้องเรียกชื่อรูปแบบที่ไฟล์น่าจะเป็น');
  assert.match(err.error, /25 พฤษภาคม 1998/, 'ต้องบอกว่าวันที่นั้นน่าจะคือวันไหน');
  assert.match(err.error, /ทั้งคอลัมน์/, 'ต้องบอกว่าให้แก้ทั้งคอลัมน์ ไม่ใช่แก้แถวเดียว');
  assert.ok(!/ไม่มีอยู่จริงในปฏิทิน/.test(err.error), 'ต้องไม่ปนกับความผิดของปฏิทิน');
});

// ── ห้ามมีทางลัดกลับมา ──────────────────────────────────────────────────────

test('ไม่มีทางส่ง "ลำดับ" เข้ามาเปลี่ยนการอ่านได้อีก', () => {
  /**
   * เคยมีสองประตู — `declaredOrder` จากคนที่อัปโหลด และ `fallbackOrder` จาก
   * ตั้งค่าระบบ — ทั้งสองถูกปิดตายเมื่อ 2026-09-04 ข้อนี้พิสูจน์ว่าปิดจริง ไม่ใช่
   * แค่ไม่มีใครเรียก: ส่งอะไรเข้ามาก็ได้ผลเท่าเดิม
   */
  const rows = rowsOf('05/03/1998');
  const plain = resolveBirthDateColumn(rows).cells[0].date;
  assert.equal(plain, '1998-03-05');
  for (const opts of [
    { declaredOrder: 'mdy' }, { fallbackOrder: 'mdy' },
    { declaredOrder: 'dmy' }, { order: 'mdy' }, null, undefined,
  ]) {
    assert.equal(
      resolveBirthDateColumn(rows, opts).cells[0].date,
      plain,
      `ตัวเลือก ${JSON.stringify(opts)} ต้องไม่เปลี่ยนอะไรเลย`,
    );
  }
});

test('ผลลัพธ์ไม่มีร่องรอยของกลไกเดาลำดับเหลืออยู่', () => {
  // ฟิลด์ที่ยังอยู่แต่ไม่มีความหมาย คือสถานะที่แย่ที่สุดในสามแบบ — จอจะยังวาด
  // ปุ่มถามลำดับต่อไปได้โดยที่ไม่มีอะไรตอบ
  const r = resolveBirthDateColumn(rowsOf('05/03/1998'));
  for (const gone of ['ok', 'fileError', 'blocking', 'ambiguous', 'answerable',
    'answered', 'declared', 'fallback', 'decidedBy']) {
    assert.ok(!(gone in r), `ยังมี ${gone} ค้างอยู่ในผลลัพธ์`);
  }
  assert.deepEqual(
    Object.keys(r).sort(),
    ['byLine', 'cells', 'converted', 'order', 'rowErrors'],
  );
});

// ── ปี พ.ศ. ─────────────────────────────────────────────────────────────────

test('ปี พ.ศ. → ลบ 543 ให้อัตโนมัติ และนับไว้ว่าแปลงกี่รายการ', () => {
  const r = resolveBirthDateColumn(rowsOf('12/05/2532', '1/2/2540', '2515-09-19', '05/03/1998'));
  assert.deepEqual(
    r.cells.map((c) => c.date),
    ['1989-05-12', '1997-02-01', '1972-09-19', '1998-03-05'],
  );
  assert.equal(r.converted.length, 3, 'ปี ค.ศ. ต้องไม่ถูกนับว่าแปลง');
  assert.deepEqual(r.converted.map((c) => c.line), [2, 3, 4]);
});

test('ขอบเขต 2400 — 2400 ยังเป็น ค.ศ. 2401 เป็น พ.ศ.', () => {
  assert.deepEqual(datesOf('01/01/2400'), ['2400-01-01']);
  assert.deepEqual(datesOf('01/01/2401'), ['1858-01-01']);
});

test('ปฏิทินถูกตรวจด้วยปี ค.ศ. ที่แปลงแล้ว ไม่ใช่ปี พ.ศ. ในไฟล์', () => {
  // 2539 หารสี่ลงตัวและ 1996 เป็นอธิกสุรทิน · 2541 ก็หารสี่ลงตัวแต่ 1998 ไม่ใช่
  assert.deepEqual(datesOf('29/02/2539'), ['1996-02-29']);
  const r = resolveBirthDateColumn(rowsOf('29/02/2541'));
  assert.equal(r.cells[0].date, null);
  assert.match(r.rowErrors[0].error, /ค\.ศ\. 1998/, 'ต้องเรียกปีที่ใช้ตรวจจริงออกมาให้เห็น');
});

test('แถวที่แปลงปีแล้วแต่วันไม่มีจริง ต้องไม่ถูกนับว่าแปลงสำเร็จ', () => {
  const r = resolveBirthDateColumn(rowsOf('29/02/2541', '12/05/2532'));
  assert.equal(r.converted.length, 1, 'นับเฉพาะแถวที่ได้วันที่จริง ๆ');
  assert.equal(r.converted[0].line, 3);
});

// ── ปฏิทินจริง และแถวที่ใช้ไม่ได้ ────────────────────────────────────────────

test('29 ก.พ. ปีอธิกสุรทิน ผ่าน — ปีปกติไม่ผ่าน', () => {
  assert.deepEqual(datesOf('29/02/1996'), ['1996-02-29']);
  assert.equal(resolveBirthDateColumn(rowsOf('29/02/1998')).cells[0].date, null);
});

test('ค่าที่ไม่ใช่วันที่เลย ผิดเฉพาะแถว และไฟล์ที่เหลือยังนำเข้าได้', () => {
  const r = resolveBirthDateColumn(rowsOf('ไม่ทราบ', '31/04/1998', '12/05/1989'));
  assert.deepEqual(r.rowErrors.map((e) => e.line), [2, 3]);
  assert.equal(r.cells[2].date, '1989-05-12');
  assert.match(r.rowErrors[0].error, /DD\/MM\/YYYY/, 'ต้องบอกรูปแบบที่รับ');
});

// ── ไฟล์ที่ไม่มีคอลัมน์วันเกิด และช่องว่าง ────────────────────────────────────

test('ไฟล์ที่ไม่มีคอลัมน์วันเกิด → อ่านได้ตามปกติ ไม่มีอะไรให้ตีความ', () => {
  const rows = parseCsv('code,name,department\nPM01,คนที่ 1,ENG');
  const r = resolveBirthDateColumn(rows);
  assert.equal(r.order, null);
  assert.deepEqual(r.cells, []);
  assert.deepEqual(r.rowErrors, []);
});

test('คอลัมน์วันเกิดที่เว้นว่างไว้ ถูกข้ามไปเงียบ ๆ', () => {
  const r = resolveBirthDateColumn(rowsOf('', '12/05/1989'));
  assert.equal(r.cells.length, 1, 'ช่องว่างไม่ใช่แถวที่ต้องอ่าน');
  assert.equal(r.cells[0].date, '1989-05-12');
});

test('หัวคอลัมน์ภาษาไทยและแบบขีดล่างก็อ่านได้', () => {
  for (const header of ['วันเกิด', 'birth_date', 'birthDate']) {
    const rows = parseCsv(`code,name,${header}\nPM01,คนที่ 1,12/05/1989`);
    assert.equal(resolveBirthDateColumn(rows).cells[0]?.date, '1989-05-12', header);
  }
});

// ── สิ่งที่ HR เห็นก่อนกดยืนยัน — และตอนนี้คือด่านเดียวที่เหลือ ────────────────

test('ตัวอย่างสะกดชื่อเดือนเป็นคำ ไม่ใช่ตัวเลขซ้ำกับที่อยู่ในไฟล์', () => {
  /**
   * ทั้งแอปแสดงวันที่เป็น DD/MM/YYYY ตั้งแต่ 2026-09-04 และบรรทัดนี้คือหนึ่งใน
   * ข้อยกเว้นที่ตั้งใจไว้ (ดู test/dateFormat.test.js) เหตุผลอยู่ที่นี่: ตัวเลข
   * คือสิ่งที่ HR มองอยู่ในไฟล์แล้ว และเป็นสิ่งที่แยก 5 มีนาคม กับ 3 พฤษภาคม
   * ไม่ออก ชื่อเดือนคือสิ่งเดียวที่เอาไปเทียบกับคนที่รับเข้ามาได้
   */
  const p = birthDatePreview(resolveBirthDateColumn(rowsOf('05/03/1998')));
  assert.equal(p[0].text, '05/03/1998 → 5 มีนาคม 1998');
  assert.ok(!/05\/03\/2541/.test(p[0].text), 'ถ้าอ่านกลับเป็นตัวเลข บรรทัดนี้ก็ไม่ได้ตรวจอะไร');
});

test('ตัวอย่างเอาแถวที่ใช้ไม่ได้ขึ้นก่อน — แถวแรกของไฟล์ไม่ใช่แถวที่ต้องอ่าน', () => {
  const rows = rowsOf('1997-01-01', '1997-01-02', '1997-01-03', '05/25/1998');
  const p = birthDatePreview(resolveBirthDateColumn(rows), 3);
  assert.equal(p[0].line, 5, 'แถวที่ตกต้องมาก่อน แม้จะอยู่ท้ายไฟล์');
  assert.equal(p.length, 3);
});

test('ตัวอย่างกำกับไว้ที่แถวที่แปลงปีให้ ไม่ใช่บอกแค่ยอดรวม', () => {
  const p = birthDatePreview(resolveBirthDateColumn(rowsOf('12/05/2532')));
  assert.match(p[0].text, /\(พ\.ศ\. → ค\.ศ\.\)/);
  assert.equal(p[0].converted, true);
});

test('readableDate เป็น ค.ศ. — ปีเดียวกับที่อยู่ในไฟล์', () => {
  // ต่างจาก thaiDate() ในหน้าจออื่นที่บวก 543 โดยตั้งใจ: บรรทัดนี้มีไว้ให้เทียบ
  // กับคอลัมน์ที่เปิดค้างอยู่ตรงหน้า
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

test('แม่แบบ CSV ต้องรอดจากการเปิด-บันทึกด้วย Excel ได้ด้วยตัวมันเอง', () => {
  /**
   * เหตุผลเปลี่ยนไปเมื่อ 2026-09-04 แต่คำตอบยังเป็นตัวเดิม
   *
   * เดิม: `1989-05-12` ที่ Excel เขียนทับเป็น `12/05/1989` ทำให้ไฟล์กำกวมและ
   * ถูกปฏิเสธ · ตอนนี้ไม่มีการปฏิเสธแล้ว แต่ถ้าเครื่องที่เปิดตั้งเป็นภาษาอังกฤษ
   * มันจะเขียนเป็น `05/12/1989` ซึ่งอ่านได้เงียบ ๆ เป็น 5 ธันวาคม — วันเกิน 12
   * ทำให้เส้นทางนั้นกลายเป็นแถวที่ *ตกและร้อง* แทนที่จะเป็นวันที่ผิดที่เงียบสนิท
   */
  const template = read('app/api/employees/import/template/route.js');
  const sample = /'(\d{4})-(\d{2})-(\d{2})'/.exec(template);
  assert.ok(sample, 'แม่แบบต้องมีตัวอย่างวันเกิดเป็น YYYY-MM-DD');
  assert.ok(
    Number(sample[3]) > 12,
    `ตัวอย่างวันเกิดในแม่แบบต้องมีวันเกิน 12 (ตอนนี้ ${sample[0]})`,
  );

  // และเดินทั้งสองเส้นทางจริง ๆ ไม่ใช่เชื่อตัวเลข
  const thaiExcel = `${Number(sample[3])}/${sample[2]}/${sample[1]}`;
  assert.equal(
    resolveBirthDateColumn(rowsOf(thaiExcel)).cells[0].date,
    `${sample[1]}-${sample[2]}-${sample[3]}`,
    'Excel ไทยเขียนทับแล้วต้องอ่านกลับได้วันเดิม',
  );
  const enExcel = `${sample[2]}/${Number(sample[3])}/${sample[1]}`;
  assert.equal(
    resolveBirthDateColumn(rowsOf(enExcel)).cells[0].date,
    null,
    'Excel อังกฤษเขียนทับแล้วต้องตกและร้อง ไม่ใช่กลายเป็นวันอื่นเงียบ ๆ',
  );
});

test('เส้นทางนำเข้าอ่านวันเกิดทั้งคอลัมน์ ก่อนเขียนแถวใดลงฐานข้อมูล', () => {
  const src = read('app/api/employees/import/route.js');

  const check = src.indexOf('resolveBirthDateColumn(rows)');
  const loop = src.indexOf('for (const [i, row] of rows.entries())');
  assert.ok(check > 0, 'route ต้องเรียกตัวอ่านรวมของทั้งไฟล์ โดยไม่มีตัวเลือกใด ๆ');
  assert.ok(check < loop, 'ต้องอ่านก่อนวนแถว มิฉะนั้นแผงยืนยันจะนับไม่ตรงกับสิ่งที่เขียนไป');

  // ตรวจบนโค้ดล้วน ไม่นับคอมเมนต์ — คอมเมนต์ในเราต์นั้นเรียกชื่อสองประตูที่ถูก
  // ปิดไปโดยตั้งใจ ว่าเคยมีอะไรอยู่ตรงนั้น การห้ามคำเหล่านั้นในคอมเมนต์ด้วย คือ
  // การห้ามไม่ให้ใครอธิบายว่าอะไรหายไป
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // ไม่มีการปฏิเสธทั้งไฟล์เพราะเรื่องลำดับอีกแล้ว และไม่มีทางรับลำดับเข้ามา
  assert.ok(!/dates\.ok/.test(code), 'ยังมีการปฏิเสธทั้งไฟล์เพราะตีความไม่ได้ค้างอยู่');
  assert.ok(!/order=|declaredOrder|csvDateOrder|Setting/.test(code), 'ยังมีทางรับลำดับเข้ามา');
  assert.match(src, /const cell = dates\.byLine\.get\(line\);/, 'แถวที่อ่านไม่ได้ต้องตกเป็นรายแถว');

  assert.ok(
    !/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/.test(src),
    'ตัวตรวจรูปแบบเดิมต้องถูกถอดออก ไม่ใช่ปล่อยไว้ซ้อนกับตัวใหม่',
  );
});

test('หน้าทะเบียนพนักงานแสดงตัวอย่างก่อน แล้วจึงอัปโหลดเมื่อยืนยัน', () => {
  const file = read('components/AdminView.jsx');
  // The holidays card in the same file still uploads on pick, and should: a
  // calendar has no column to preview. Only the roster card is pinned.
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

  // อัปโหลดคือไฟล์เปล่า ๆ ไม่มีลำดับติดไปด้วยอีกแล้ว
  assert.match(src, /api\.upload\('\/employees\/import', pending\.file\)/);
});

test('การ์ดทะเบียนบอกว่าอ่านเป็น วัน/เดือน/ปี เสมอ และเตือนเรื่อง Excel', () => {
  /**
   * คำเตือนเรื่อง Excel ยิ่งสำคัญขึ้นหลัง 2026-09-04 ไม่ใช่น้อยลง: ไฟล์ถูกสร้าง
   * ใน Excel ก่อนที่การ์ดนี้จะถูกเปิด และเครื่องไม่ปฏิเสธไฟล์ที่สลับมาแล้ว
   *
   * ผูกกับ `.hint-list` เท่านั้น เพราะ `src` มีคอมเมนต์ในโค้ดที่อธิบายเรื่อง
   * เดียวกันอยู่ด้วย การแมตช์ทั้งฟังก์ชันจะยังผ่านแม้คำเตือนถูกลบออกจากจอ
   */
  const file = read('components/AdminView.jsx');
  const src = file.slice(file.indexOf('function Employees('), file.indexOf('function ResetPassword('));
  const hintAt = src.indexOf('className="hint hint-list"');
  assert.ok(hintAt > 0, 'การ์ดนี้ต้องมีคำอธิบาย');
  const hint = src.slice(hintAt, src.indexOf('</ul>', hintAt));
  assert.match(hint, /Excel/, 'คำเตือนเรื่อง Excel บันทึกทับต้องอยู่ในคำอธิบายของหน้านี้');
  assert.match(hint, /05\/03\/1998/, 'ต้องยกค่าที่อ่านได้สองแบบให้เห็น ไม่ใช่เตือนลอย ๆ');
  assert.match(hint, /วัน\/เดือน\/ปี/, 'ต้องบอกว่าระบบอ่านทางไหน');
  assert.match(hint, /2400/, 'ต้องบอกกฎปี พ.ศ. ด้วย');
});

test('คำอธิบายของการ์ดถูกพับไว้ทั้งก้อน หลัง อ่านต่อ', () => {
  /**
   * คำเตือนข้างบนต้อง "อ่านได้" ไม่ใช่ "เห็นตลอดเวลา" — และสองอย่างนี้แลกกันได้
   * จริง: หกข้อนั้นยาวเป็นหน้าจอครึ่งบนมือถือ คนที่เข้ามาค้นชื่อพนักงานจึงเลื่อน
   * ผ่านทั้งก้อน รวมถึงข้อที่สำคัญที่สุดด้วย
   *
   * เช้าวันที่ 2026-09-07 ก้อนนี้ถูกผ่าเป็นสองส่วน — ห้าข้อหลังปุ่ม `.btn ghost`
   * ที่เขียนว่า วิธีเตรียมไฟล์นำเข้า กับบรรทัดบันทึกประวัติที่ยังยืนอยู่ใต้หัวข้อ
   * — แล้วถูกสั่งใหม่ในวันเดียวกันว่าให้ใช้ อ่านต่อ ของแอปเองทั้งระบบ และซ่อน
   * ทั้งหมด ก้อนนี้จึงกลับมาเป็นลิสต์เดียว · เคส "การ์ดทะเบียนบอกว่าอ่านเป็น
   * วัน/เดือน/ปี เสมอ" ข้างบนยังอ่าน `.hint-list` ก้อนเดิม จึงยังเป็นตัวยืนยัน
   * ว่าเนื้อคำเตือนไม่ได้หายไปไหน
   */
  const file = read('components/AdminView.jsx');
  const src = file.slice(file.indexOf('function Employees('), file.indexOf('function ResetPassword('));

  // ลิสต์เดียว พับทั้งก้อน และเป็น `ul` ไม่ใช่ย่อหน้า
  assert.match(src, /<Disclosure as="ul" lines=\{0\} className="hint hint-list" of="[^"]+">/);
  // บรรทัดบันทึกประวัติกลับเข้าไปอยู่ในลิสต์ ไม่ได้ยืนอยู่ข้างนอกอีกแล้ว
  const list = src.slice(src.indexOf('<Disclosure as="ul"'), src.indexOf('</Disclosure>'));
  assert.match(list, /ทุกการแก้ไขถูกบันทึกไว้ว่าใครแก้/, 'บรรทัดบันทึกประวัติต้องอยู่ในลิสต์เดียวกัน');
  assert.equal((list.match(/<li>/g) || []).length, 6, 'ต้องเป็นหกข้อในลิสต์เดียว');

  // และปุ่มแบบเดิมต้องไม่กลับมา — ทั้งตัวปุ่มและสถานะของมัน
  // ชื่อปุ่มเดิมยังอยู่ในคอมเมนต์ของโค้ดในฐานะประวัติ สิ่งที่ห้ามคือกลไกของมัน
  for (const gone of ['ซ่อนวิธีเตรียมไฟล์', 'helpOpen', 'helpId']) {
    assert.ok(!src.includes(gone), `ยังมี "${gone}" ค้างอยู่บนการ์ด`);
  }
});

test('พรีวิวบอกจำนวนที่แปลงปีให้ และไม่ทาสีเตือนไฟล์ที่ไม่มีอะไรผิด', () => {
  const file = read('components/AdminView.jsx');
  const src = file.slice(file.indexOf('function Employees('), file.indexOf('function ResetPassword('));
  const panel = src.slice(src.indexOf('{pending && ('), src.indexOf('{result && ('));

  assert.match(panel, /pending\.dates\.converted\.length > 0/, 'ต้องมีเงื่อนไขซ่อนบรรทัดนี้เมื่อไม่ได้แปลงอะไร');
  assert.match(panel, /แปลงปี พ\.ศ\. เป็น ค\.ศ\. ให้อัตโนมัติแล้ว/, 'ต้องบอก HR ว่าระบบแปลงปีให้');
  assert.match(panel, /pending\.dates\.converted\.length\}/, 'ต้องบอกจำนวน ไม่ใช่บอกว่าแปลงเฉย ๆ');

  // ไม่มีแถวตก → เขียว · มีแถวตก → เหลือง · ไม่มีสีแดงแล้ว เพราะไม่มีการปฏิเสธ
  //
  // `!pending.workbook &&` เพิ่มมา 2026-09-07 ตอนที่รับไฟล์ .xlsx ได้ — ไฟล์
  // workbook ไม่มีพรีวิววันเกิดให้อ่าน เพราะ xlsx เก็บวันที่เป็นวันที่จริง
  // ลำดับวัน/เดือนจึงสลับไม่ได้เลย (ดู src/lib/xlsx.js) แผงจึงไม่มี
  // `pending.dates` ให้ถาม และต้องเป็นเขียวเสมอ · เจตนาของเคสนี้ไม่เปลี่ยน คือ
  // สีเหลืองต้องมาจากแถวที่ตกจริง ไม่ใช่จากการที่มีไฟล์อยู่
  assert.match(
    panel,
    /kind=\{!pending\.workbook && pending\.dates\.rowErrors\.length \? 'warn' : 'ok'\}/,
    'สีของแผงต้องมาจากว่ามีแถวตกจริงหรือไม่',
  );
  assert.ok(!/'error'/.test(panel), 'ไม่มีสถานะ "ไม่นำเข้าทั้งไฟล์" ให้ทาสีแดงอีกแล้ว');

  // ปุ่มยืนยันต้องเป็น `.btn` เต็มใบ และกดได้ทันที ติดแค่ตอนกำลังส่ง
  assert.match(
    panel,
    /<button\s+className="btn"\s+onClick=\{confirmImport\}\s+disabled=\{sending\}/,
    'ปุ่มยืนยันนำเข้าต้องเป็นปุ่มเขียวที่กดได้ ไม่ใช่ ghost หรือถูกปิดไว้',
  );
  // และแถวที่จะถูกข้ามยังต้องถูกลงรายการไว้ ไม่ใช่แค่สรุปเป็นจำนวน
  assert.match(panel, /pending\.dates\.rowErrors\.map/, 'ต้องลงรายการแถวที่จะถูกข้าม');
});

test('คำถามเรื่องลำดับวัน/เดือน ถูกถอดออกจากจอทั้งหมด', () => {
  const admin = read('components/AdminView.jsx');
  for (const gone of [
    'declareOrder', 'undeclare', 'declaredOrder', 'answerable', 'csvDateOrder',
    'CsvDateFormat', 'blockedLines', 'ไฟล์นี้เป็น วัน/เดือน/ปี', 'อ่านไฟล์นี้เป็น',
  ]) {
    assert.ok(!admin.includes(gone), `ยังมี "${gone}" ค้างอยู่บนจอ`);
  }
  // และหัวข้อใน ตั้งค่าระบบ ต้องหายไปด้วย ไม่ใช่เหลือหัวข้อที่กดแล้วว่างเปล่า
  assert.ok(!admin.includes("key: 'csvDates'"), 'หัวข้อ ตั้งค่าระบบ ยังอยู่');
});

test('ค่าเริ่มต้นขององค์กรถูกถอดออกจากทั้งเราต์ตั้งค่าและสคีมา', () => {
  /**
   * ฟิลด์ที่ยังรับค่าได้แต่ไม่มีใครอ่าน คือกับดัก: จะมีคนตั้งค่ามันแล้วเชื่อว่า
   * ไฟล์ถัดไปจะถูกอ่านตามนั้น
   */
  const route = read('app/api/settings/route.js');
  assert.ok(!/csvDateOrder: doc\.csvDateOrder/.test(route), 'GET ยังส่งค่านั้นออกไป');
  assert.ok(!/doc\.csvDateOrder = /.test(route), 'PATCH ยังรับค่านั้นเข้ามา');
  assert.match(route, /const \{ companyName, companyNameEn, formCode \} = await body\(req\);/);

  const model = read('src/models/Setting.js');
  assert.ok(
    !/^\s{4}csvDateOrder: \{/m.test(model),
    'สคีมายังประกาศฟิลด์นั้นอยู่ — mongoose จะยังเก็บและ validate ให้',
  );
  assert.match(model, /csvDateOrder/, 'แต่ต้องเหลือคอมเมนต์บอกว่ามันเคยอยู่ตรงไหนและหายไปทำไม');
});

test('ผลการนำเข้าที่เซิร์ฟเวอร์ตอบกลับ นับจำนวนที่แปลงปีมาด้วย', () => {
  const src = read('app/api/employees/import/route.js');
  const body = src.slice(src.indexOf('birthDates: {'), src.indexOf('});', src.indexOf('birthDates: {')));
  assert.match(body, /order: dates\.order/);
  assert.match(body, /count: dates\.cells\.length/);
  assert.match(body, /converted: dates\.converted\.length/);
  assert.ok(!/declared|fallback|decidedBy/.test(body), 'ไม่มีลำดับให้อ้างว่ามาจากใครอีกแล้ว');
});

test('ข้อความผิดพลาดบนการ์ดทะเบียน ปิดได้', () => {
  const file = read('components/AdminView.jsx');
  const src = file.slice(file.indexOf('function Employees('), file.indexOf('function ResetPassword('));
  assert.match(src, /onClose=\{\(\) => setError\(''\)\}/, 'แถบแดงบนการ์ดนี้ต้องมีปุ่มปิด');
});
