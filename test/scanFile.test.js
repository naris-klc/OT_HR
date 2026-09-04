import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCAN_FORMATS, MIXED_FORMAT, MIXED_COMPANY, decodeScanText, parseScanFile, scanSummary,
  scanDateRange, periodMismatchNote, periodText, formatLabel, machineLabel,
  decideCompany, buildScanSlots,
} from '../lib/scanFile.js';
import { periodLabel } from '../lib/api.js';
import { COMPANIES } from '../src/config/companies.js';

/**
 * ไฟล์ .txt จากเครื่องสแกนนิ้วมือ — สองเครื่อง สองรูปแบบ หนึ่งตัวอ่าน
 *
 * THE SAMPLES IN HERE ARE THE REAL FILES, byte for byte, cut down to a few
 * lines each: `THT07261.txt` from the machine that prints columns and
 * `ทดสอบ.txt` from the one that joins its fields with "/" and "'". They are
 * quoted rather than paraphrased because every property this module has is a
 * property of THOSE files — the padding, the BOM, the TIS-620 header — and a
 * tidied-up sample would test a file nobody is ever going to import.
 *
 * WHAT THIS IS DEFENDING. The file is the only record that a person was at the
 * door at a particular second, and it arrives once a month from a machine
 * nobody here configured. Every failure available to it is silent: a header
 * counted as a scan, a `07/25` read as 7 January, a TIS-620 byte turning into a
 * replacement character in the copy of the file the system keeps. None of those
 * announce themselves on any screen, so each one has a case below.
 *
 * Run with: npm test
 */

// ── the two files, as bytes ─────────────────────────────────────────────────

/** The columns machine: a TIS-620 header, then space-padded fixed columns. */
const SPACED_BYTES = Buffer.concat([
  // 'วัน/เวลา            รหัสพนักงาน' in TIS-620 — the bytes the machine writes.
  Buffer.from([0xC7, 0xD1, 0xB9, 0x2F, 0xE0, 0xC7, 0xC5, 0xD2]),
  Buffer.from('            '),
  Buffer.from([0xC3, 0xCB, 0xD1, 0xCA, 0xBE, 0xB9, 0xD1, 0xA1, 0xA7, 0xD2, 0xB9]),
  Buffer.from(
    '\r\n01/07/2026 07:26:22 THT0107              '
    + '\r\n02/07/2026 00:59:04 THT0107              '
    + '\r\n02/07/2026 07:23:09 THT0107              '
    + '\r\n31/07/2026 22:56:50 THT0107              \r\n',
  ),
]);

/** The slashed machine: a UTF-8 byte-order mark, then one field run per line. */
const SLASHED_TEXT = "01/07/2026/07:21:27'PM00112\r\n"
  + "01/07/2026/19:30:34'PM00112\r\n"
  + "31/07/2026/17:00:52'PM00112\r\n";
const SLASHED_BYTES = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(SLASHED_TEXT, 'utf8')]);

// ── encoding ────────────────────────────────────────────────────────────────

test('หัวไฟล์ TIS-620 อ่านออกเป็นภาษาไทย ไม่ใช่ตัวแทนที่', () => {
  /**
   * ทุกบรรทัดข้อมูลเป็น ASCII ล้วน การอ่านผิดจึงไม่ทำให้ punch ผิดสักแถว — สิ่ง
   * ที่มันทำคือเก็บ "ไฟล์ที่ HR นำเข้า" ไว้เป็นไฟล์ที่ไม่ใช่ไฟล์นั้น
   */
  const { text, encoding } = decodeScanText(SPACED_BYTES);
  assert.equal(encoding, 'windows-874');
  assert.match(text, /^วัน\/เวลา/);
  assert.ok(!text.includes('�'), 'ไม่ควรเหลือตัวแทนที่ในข้อความที่เก็บไว้');
});

test('ไฟล์ UTF-8 ที่มี BOM ถูกอ่านเป็น UTF-8 และ BOM ไม่ติดมากับบรรทัดแรก', () => {
  const { text, encoding } = decodeScanText(SLASHED_BYTES);
  assert.equal(encoding, 'utf-8');
  assert.equal(text.split('\r\n')[0], "01/07/2026/07:21:27'PM00112");
  // BOM ที่หลุดเข้ามาจะทำให้บรรทัดแรกไม่ตรงแพตเทิร์นและกลายเป็น "ข้าม" เงียบ ๆ
  assert.equal(parseScanFile(text).skipped.length, 0);
});

test('decodeScanText รับ ArrayBuffer แบบที่เบราว์เซอร์ส่งมาได้เท่ากับ Buffer', () => {
  // หน้าจอพรีวิวอ่านไฟล์เป็น ArrayBuffer ส่วนเราต์อ่านเป็น Buffer — ต้องได้เท่ากัน
  const view = SPACED_BYTES.buffer.slice(
    SPACED_BYTES.byteOffset, SPACED_BYTES.byteOffset + SPACED_BYTES.byteLength,
  );
  assert.equal(decodeScanText(view).text, decodeScanText(SPACED_BYTES).text);
});

// ── the two shapes ──────────────────────────────────────────────────────────

test('เครื่องแบบคอลัมน์: หัวไฟล์ถูกข้าม ทุกบรรทัดที่เหลือเป็นการสแกน', () => {
  const parsed = parseScanFile(decodeScanText(SPACED_BYTES).text);
  assert.equal(parsed.punches.length, 4);
  assert.equal(parsed.errors.length, 0);
  // หัวไฟล์คือบรรทัดที่ถูกข้าม และต้องถูกข้ามแบบที่คนเห็นได้ ไม่ใช่หายไปเฉย ๆ
  assert.deepEqual(parsed.skipped.map((s) => s.line), [1]);
  assert.match(parsed.skipped[0].text, /รหัสพนักงาน/);
  assert.deepEqual(parsed.punches[0], {
    line: 2,
    code: 'THT0107',
    codeKey: 'THT0107',
    date: '2026-07-01',
    time: '07:26:22',
    format: 'spaced',
    eraConverted: false,
  });
});

test("เครื่องแบบคั่นด้วย / และ ' อ่านได้ครบเท่ากัน", () => {
  const parsed = parseScanFile(decodeScanText(SLASHED_BYTES).text);
  assert.equal(parsed.skipped.length, 0);
  assert.equal(parsed.punches.length, 3);
  assert.deepEqual(parsed.punches[1], {
    line: 2,
    code: 'PM00112',
    codeKey: 'PM00112',
    date: '2026-07-01',
    time: '19:30:34',
    format: 'slashed',
    eraConverted: false,
  });
});

test('สองแพตเทิร์นชนกันไม่ได้ — บรรทัดหนึ่งเข้าได้รูปแบบเดียว', () => {
  /**
   * นี่คือสิ่งที่ทำให้ "ไฟล์นี้มาจากเครื่องไหน" เป็นการอ่าน ไม่ใช่การเดา และ
   * ทำให้ลำดับที่ลองแพตเทิร์นไม่มีผลต่อคำตอบ
   */
  for (const sample of ['01/07/2026 07:26:22 THT0107', "01/07/2026/07:21:27'PM00112"]) {
    const hits = SCAN_FORMATS.filter((f) => f.pattern.test(sample));
    assert.equal(hits.length, 1, `"${sample}" ต้องเข้าได้รูปแบบเดียว`);
  }
  // และตัวอย่างที่เขียนไว้ในโมดูลต้องเป็นตัวอย่างที่แพตเทิร์นของตัวเองอ่านออกจริง
  for (const f of SCAN_FORMATS) {
    assert.ok(f.pattern.test(f.example), `ตัวอย่างของ ${f.key} อ่านไม่ออกด้วยแพตเทิร์นของตัวเอง`);
  }
});

test('ไฟล์ที่ปนสองเครื่อง ยังอ่านได้ครบ และถูกทำเครื่องหมายว่าปน', () => {
  const parsed = parseScanFile("01/07/2026 07:26:22 THT0107\n02/07/2026/08:00:00'PM00112\n");
  assert.equal(parsed.punches.length, 2);
  assert.equal(scanSummary(parsed).format, MIXED_FORMAT);
  assert.match(formatLabel(MIXED_FORMAT), /ปนกัน/);
});

// ── the readings that must not be guessed ───────────────────────────────────

test('วันที่อ่านแบบ วัน/เดือน/ปี และแบบ เดือน/วัน/ปี ถูกปฏิเสธ ไม่ใช่สลับให้', () => {
  /**
   * เครื่องที่ตั้งเป็นภาษาอังกฤษจะเขียน 07/25/2026 ซึ่งทุกวันหลังวันที่ 12 จะตก
   * — ไฟล์ทั้งเดือนจึงกลายเป็นกองผิดพลาดที่มองข้ามไม่ได้ แทนที่จะเป็นเดือนที่
   * ถูกอ่านสลับเงียบ ๆ ทั้งเดือน
   */
  const parsed = parseScanFile('25/07/2026 07:00:00 PM001\n07/25/2026 07:00:00 PM001\n');
  assert.equal(parsed.punches.length, 1);
  assert.equal(parsed.punches[0].date, '2026-07-25', '25/07 คือ 25 กรกฎาคม');
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].line, 2);
  assert.match(parsed.errors[0].error, /เดือน\/วัน\/ปี/);
});

test('เวลาที่ไม่มีอยู่จริงเป็นความผิดพลาดของบรรทัด ไม่ใช่บรรทัดที่ถูกข้าม', () => {
  // 24:00 ไม่มีในนาฬิกา 24 ชั่วโมง — และบรรทัดนี้ "หน้าตาเหมือนการสแกน" จึงต้อง
  // ไปอยู่กองที่คนเห็น ไม่ใช่กองเดียวกับหัวไฟล์
  const parsed = parseScanFile('01/07/2026 24:00:00 PM001\n01/07/2026 07:60:00 PM001\n');
  assert.equal(parsed.punches.length, 0);
  assert.equal(parsed.skipped.length, 0);
  assert.equal(parsed.errors.length, 2);
  assert.match(parsed.errors[0].error, /ไม่มีอยู่จริง/);
});

test('รหัสพนักงานเก็บตามที่พิมพ์มา และเทียบด้วยรูปที่ตัดขีดออกแล้ว', () => {
  // ทะเบียนมีสองรูป — PM-0620 กับ PM00511 — และ src/lib/employeeCode.js คือที่
  // เดียวที่ตัดสินว่าสองรหัสคือรหัสเดียวกัน
  const [punch] = parseScanFile('01/07/2026 07:00:00 PM-0620\n').punches;
  assert.equal(punch.code, 'PM-0620', 'ต้องเก็บสิ่งที่เครื่องพิมพ์ไว้ตามเดิม');
  assert.equal(punch.codeKey, 'PM0620');
});

test('บรรทัดซ้ำทั้งดวง (คนเดียว วันเดียว วินาทีเดียว) นับครั้งเดียว', () => {
  const parsed = parseScanFile(
    "01/07/2026/07:00:00'PM001\n01/07/2026/07:00:00'PM001\n01/07/2026/07:00:01'PM001\n",
  );
  assert.equal(parsed.punches.length, 2, 'วินาทีต่างกันคือคนละครั้ง');
  assert.deepEqual(parsed.duplicates.map((d) => d.line), [2]);
});

test('บรรทัดว่างไม่ใช่บรรทัดที่ใครเขียน จึงไม่ถูกนับว่าถูกข้าม', () => {
  const parsed = parseScanFile('\n\n01/07/2026 07:00:00 PM001\n\n');
  assert.equal(parsed.punches.length, 1);
  assert.equal(parsed.skipped.length, 0);
});

// ── the summary a person reads before pressing นำเข้า ───────────────────────

test('สรุปไฟล์บอกจำนวนคน ช่วงวัน และเดือนที่ไฟล์แตะ', () => {
  const parsed = parseScanFile(decodeScanText(SPACED_BYTES).text);
  const summary = scanSummary(parsed);
  assert.equal(summary.punchCount, 4);
  assert.equal(summary.peopleCount, 1);
  assert.equal(summary.format, 'spaced');
  assert.equal(summary.from, '2026-07-01');
  assert.equal(summary.to, '2026-07-31');
  assert.deepEqual(summary.periods, ['2026-07']);
  assert.equal(summary.skippedCount, 1);
  // ทุกบรรทัดต้องลงกองใดกองหนึ่งเสมอ — นี่คือสิ่งที่ทำให้พรีวิว "ตรวจได้" ไม่ใช่
  // "ต้องเชื่อ" (บรรทัดสุดท้ายของไฟล์ว่างเพราะจบด้วยขึ้นบรรทัดใหม่)
  const accounted = summary.punchCount + summary.skippedCount
    + summary.errorCount + summary.duplicateCount;
  assert.equal(accounted, summary.lineCount - 1);
});

test('ไฟล์ที่คร่อมสองเดือน รายงานทั้งสองเดือน', () => {
  const parsed = parseScanFile("31/07/2026/23:50:00'PM001\n01/08/2026/00:20:00'PM001\n");
  assert.deepEqual(scanSummary(parsed).periods, ['2026-07', '2026-08']);
});

test('ช่วงวันแสดงเป็น DD/MM/YYYY พ.ศ. แบบเดียวกับวันที่อื่นบนจอ', () => {
  assert.equal(scanDateRange({ from: '2026-07-01', to: '2026-07-31' }), '01/07/2569 – 31/07/2569');
  assert.equal(scanDateRange({ from: '2026-07-01', to: '2026-07-01' }), '01/07/2569');
  assert.equal(scanDateRange({ from: null, to: null }), '—');
});

test('ชื่อเดือนตรงกับที่ช่องเลือกเดือนบนจอเดียวกันแสดง', () => {
  /**
   * ตัวหนึ่งอยู่ใน `lib/api.js` ซึ่งหยิบ fetch กับคุกกี้มาด้วย จึงเอามาใช้ใน
   * เราต์ไม่ได้ อีกตัวจึงอยู่ที่นี่ — และเทสต์นี้คือสิ่งที่ทำให้สองตัวตรงกันจริง
   * เหมือนที่ `thaiText` กับ `thaiDate` ตรงกันด้วยเทสต์ ไม่ใช่ด้วยความหวัง
   */
  for (const p of ['2026-07', '2026-01', '2026-12', '2027-09']) {
    assert.equal(periodText(p), periodLabel(p), `${p} ต้องอ่านเหมือนกันทั้งสองฝั่ง`);
  }
  assert.equal(periodText('2026-07'), 'กรกฎาคม 2569');
  // ค่าที่ไม่ใช่งวด คืนตามที่ได้มา ไม่ใช่คืน "undefined 2569"
  assert.equal(periodText('ไม่ทราบ'), 'ไม่ทราบ');
  assert.equal(periodText(''), '');
});

test('เตือนเมื่อไฟล์ไม่ใช่เดือนที่กำลังดูอยู่ — และไม่เตือนเมื่อคร่อมเดือน', () => {
  /**
   * กะที่เริ่มวันที่ 31 สแกนออกวันที่ 1 เป็นเรื่องปกติ กฎที่ห้ามไฟล์คร่อมเดือน
   * จึงจะบล็อกกรณีที่ถูกต้องไปพร้อมกับกรณีที่ผิด — สิ่งที่ต้องจับคือการเลือกไฟล์
   * ผิดเดือน ซึ่งคือ "ไม่มีเดือนนี้อยู่ในไฟล์เลย"
   */
  const july = scanSummary(parseScanFile("01/07/2026/07:00:00'PM001\n"));
  assert.equal(periodMismatchNote(july, '2026-07'), null);
  const note = periodMismatchNote(july, '2026-08');
  // ทั้งสองเดือนเรียกเป็นภาษาไทย พ.ศ. เหมือนช่องเลือกเดือนเหนือประโยคนี้ —
  // ISO ในประโยคเดียวที่ขอให้คนเทียบกับทั้งหน้า คือสิ่งที่ต้องไม่กลับมา
  assert.match(note, /กรกฎาคม 2569/);
  assert.match(note, /สิงหาคม 2569/);
  assert.ok(!/\d{4}-\d{2}/.test(note), 'ไม่ควรมี YYYY-MM ดิบอยู่ในประโยค');

  const spanning = scanSummary(parseScanFile("31/07/2026/23:50:00'PM001\n01/08/2026/00:20:00'PM001\n"));
  assert.equal(periodMismatchNote(spanning, '2026-07'), null);
  assert.equal(periodMismatchNote(spanning, '2026-08'), null);
});

// ── สี่ไฟล์ต่อเดือน: สองเครื่อง × สองบริษัท ────────────────────────────────

test('เครื่องที่ 1 คือแบบคอลัมน์ · เครื่องที่ 2 คือแบบคั่นด้วย /', () => {
  /**
   * เลขเครื่องเป็น **ป้ายชื่อ** ไม่ใช่ตัวตัดสิน — ไม่มีที่ไหนแตกกิ่งตามเลขนี้
   * แต่ป้ายที่ผิดคือหน้าจอที่เรียกชื่อเครื่องผิด ซึ่งคนอ่านตรวจไม่ได้จากตัวไฟล์
   * ตอบไว้เมื่อ 4 ก.ย. 2569
   */
  const [one, two] = SCAN_FORMATS;
  assert.equal(one.key, 'spaced');
  assert.equal(one.machine, 1);
  assert.equal(two.key, 'slashed');
  assert.equal(two.machine, 2);
  assert.equal(machineLabel('spaced'), 'เครื่องที่ 1');
  assert.equal(machineLabel('slashed'), 'เครื่องที่ 2');
  // เลขเครื่องต้องไม่ซ้ำกัน ไม่งั้นตารางสี่ช่องจะมีสองแถวชื่อเดียวกัน
  assert.equal(new Set(SCAN_FORMATS.map((f) => f.machine)).size, SCAN_FORMATS.length);
});

test('บริษัทของไฟล์ตัดสินจากทะเบียน ไม่ใช่จากคำนำหน้ารหัส', () => {
  /**
   * `src/config/companies.js` เขียนไว้เองว่าคำนำหน้าเป็นแค่ธรรมเนียม และ
   * **ฟิลด์ที่เก็บไว้คือคำตอบ** ฟังก์ชันนี้จึงรับ *คำตอบ* มาแล้ว ไม่ได้รับรหัส
   * — ถ้ามันรับรหัส มันจะเป็นที่ที่สองที่เดาบริษัทจาก PM/THT
   */
  assert.deepEqual(decideCompany(['primus', 'primus', 'primus']), {
    company: 'primus',
    counts: [{ company: 'primus', punches: 3 }],
  });
  // รหัสที่ไม่มีในทะเบียนไม่ได้โหวต — และไม่ทำให้ไฟล์กลายเป็น "ตัดสินไม่ได้"
  assert.equal(decideCompany(['themtech', null, null, 'themtech']).company, 'themtech');
  // ไม่มีใครในไฟล์อยู่ในทะเบียนเลย = ตอบไม่ได้จริง ๆ ไม่ใช่ความผิดพลาด
  assert.deepEqual(decideCompany([null, null]), { company: null, counts: [] });
  assert.deepEqual(decideCompany([]), { company: null, counts: [] });
});

test('ไฟล์ที่คนในนั้นอยู่คนละบริษัท ถูกรายงานว่าปน ไม่ใช่เลือกข้างให้', () => {
  /**
   * ฝ่ายบุคคลบอกว่าไฟล์หนึ่งคือบริษัทหนึ่ง ถ้าไม่จริงแปลว่าอย่างใดอย่างหนึ่ง:
   * ข้อตกลงเปลี่ยนไปแล้ว หรือส่งออกไฟล์ผิด — ทั้งสองอย่างคือเรื่องที่ต้องบอกคน
   * ไม่ใช่เรื่องที่โมดูลนี้ควรตัดสินแทน
   */
  const mixed = decideCompany(['primus', 'themtech', 'primus']);
  assert.equal(mixed.company, MIXED_COMPANY);
  // และหลักฐานต้องเรียงจากมากไปน้อย เพื่อให้ "นิ้วของคนที่ลาออก" ต่างจาก
  // "ส่งออกไฟล์ผิด" ได้ด้วยการอ่านบรรทัดเดียว
  assert.deepEqual(mixed.counts, [
    { company: 'primus', punches: 2 },
    { company: 'themtech', punches: 1 },
  ]);
});

test('ตารางของเดือนคือ สองเครื่อง × สองบริษัท — และเลขสี่ไม่ได้ถูกเขียนไว้ที่ไหน', () => {
  const { slots, missing } = buildScanSlots(COMPANIES, []);
  assert.equal(slots.length, SCAN_FORMATS.length * COMPANIES.length);
  assert.equal(slots.length, 4, 'วันนี้คือสองเครื่องสองบริษัท = สี่ไฟล์ต่อเดือน');
  assert.equal(missing.length, 4, 'เดือนที่ยังไม่ได้นำเข้าอะไรเลย ขาดครบทั้งสี่');
  // ทุกช่องต้องไม่ซ้ำกัน และครบทุกคู่
  const pairs = slots.map((s) => `${s.format}|${s.company}`);
  assert.equal(new Set(pairs).size, 4);
  assert.deepEqual(slots.map((s) => s.machine), [1, 1, 2, 2]);
});

test('ช่องที่เต็มแล้วชี้ไปที่ไฟล์ล่าสุด — ใบที่รายการยังอยู่จริง', () => {
  /**
   * เคยชี้ไปที่ไฟล์ใบแรก บนความเข้าใจว่าช่องถูกเติมครั้งเดียวแล้วที่เหลือคือการ
   * นำเข้าซ้ำ · การนำเข้าทับ (4 ก.ย. 2569) กลับด้านข้อนั้น: ไฟล์ใบหลังที่คร่อม
   * วันเดียวกัน **ลบรายการของใบแรกทิ้ง** การเอ่ยชื่อใบแรกจึงเป็นการชี้คนอ่านไปที่
   * ไฟล์ที่รายการของมันไม่อยู่ในฐานข้อมูลแล้ว
   */
  const batches = [
    { _id: 'b2', format: 'spaced', company: 'primus', createdAt: '2026-08-02T00:00:00Z' },
    { _id: 'b1', format: 'spaced', company: 'primus', createdAt: '2026-08-01T00:00:00Z', supersededBy: 'b2' },
    { _id: 'b3', format: 'slashed', company: 'themtech', createdAt: '2026-08-03T00:00:00Z' },
  ];
  const { slots, missing } = buildScanSlots(COMPANIES, batches);
  const filled = slots.find((s) => s.format === 'spaced' && s.company === 'primus');
  assert.equal(filled.batch._id, 'b2', 'ช่องต้องชี้ไปที่ใบล่าสุด ไม่ใช่ใบแรก');
  assert.equal(filled.imports, 2);
  assert.equal(filled.superseded, 1, 'และบอกได้ว่ามีกี่ใบที่ถูกทับไปแล้ว');
  assert.deepEqual(
    missing.map((s) => `${s.format}|${s.company}`).sort(),
    ['slashed|primus', 'spaced|themtech'],
  );
});

test('ไฟล์ที่ปน หรือที่ตัดสินบริษัทไม่ได้ ไม่ถูกนับว่าเติมช่องไหนเลย', () => {
  /**
   * นี่คือครึ่งที่สำคัญ: นับไฟล์ปนว่าเป็น "เครื่องที่ 1 · ไพรมัส มาแล้ว" คือการ
   * ซ่อนไฟล์ใบเดียวที่ต้องมีคนไปดู ไว้หลังเครื่องหมายถูก
   */
  const batches = [
    { _id: 'm1', format: 'spaced', company: MIXED_COMPANY, createdAt: '2026-08-01T00:00:00Z' },
    { _id: 'u1', format: 'slashed', company: null, createdAt: '2026-08-02T00:00:00Z' },
    { _id: 'x1', format: MIXED_FORMAT, company: 'primus', createdAt: '2026-08-03T00:00:00Z' },
  ];
  const { slots, missing, unplaced } = buildScanSlots(COMPANIES, batches);
  assert.equal(slots.filter((s) => s.batch).length, 0);
  assert.equal(missing.length, 4, 'ยังขาดครบทั้งสี่ แม้จะนำเข้าไปสามไฟล์แล้ว');
  assert.deepEqual(unplaced.map((b) => b._id).sort(), ['m1', 'u1', 'x1']);
});

test('ไฟล์ที่ไม่มีการสแกนเลย สรุปออกมาเป็นศูนย์ ไม่ใช่พัง', () => {
  const summary = scanSummary(parseScanFile('ไม่ใช่ไฟล์สแกน\n'));
  assert.equal(summary.punchCount, 0);
  assert.equal(summary.format, null);
  assert.equal(summary.from, null);
  assert.deepEqual(summary.periods, []);
  assert.equal(periodMismatchNote(summary, '2026-07'), null);
});
