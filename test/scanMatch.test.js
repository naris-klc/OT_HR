import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCAN_MATCH, SCAN_MATCH_TOLERANCE_MINUTES, checkEntryAgainstScans,
  scanMismatchDetail, scanMismatchNote, summariseScanChecks, groupScanChecksByPerson,
  dayPunchLine, showsMissingOtStart, MISSING_OT_START,
} from '../lib/scanMatch.js';

/**
 * เทียบเวลาบนใบ OT กับไฟล์สแกนนิ้วมือ — คำเตือน ไม่ใช่การคิดชั่วโมงใหม่
 *
 * WHAT IS BEING DEFENDED, and it is not the arithmetic — there is none. It is
 * the boundary: this is the first reader of `otScanPunches`, and the rule it
 * must not cross is that **a machine may not restate a sheet two people
 * signed** (src/models/ScanPunch.js). Every case here is about the QUESTION the
 * screen asks, never about a figure it changes, because there is no figure it
 * can change.
 *
 * THE THREE WAYS THIS FEATURE COULD BE WORSE THAN NOTHING, each with cases:
 *
 *   1. **A warning on every row.** A month whose file was never imported, a
 *      morning punch answering for an evening request, or a start time nobody
 *      scans at, would put a chip on everything — and a warning on every line
 *      is a warning nobody reads. The last of those was measured: 25 rows of 27
 *      on the first real month, all on the 17:00 the machine was never in a
 *      position to record. See §1ก.
 *   2. **Silence where there is a real gap.** "Every row agreed" and "nobody
 *      imported the file" must not produce the same screen.
 *   3. **An overnight row read against the clock face** rather than against one
 *      number line, which would make every ข้ามคืน request a false mismatch.
 *
 * เหมารายวัน is the fourth, and it is the one that got answered twice. The first
 * reading was *warn, but label it*; the second, the same day, settled it the
 * other way — **ถ้าติ๊กเหมารายวัน เวลาสแกนไม่ตรงไม่เป็นไร แต่ต้องมีแจ้งเตือนว่า
 * เขาเหมารายวัน.** HR named the three shapes it takes (ไม่ได้สแกนนิ้ว ·
 * สแกนออกก่อนเวลา · สแกนเข้าแต่ไม่ได้สแกนออก) and the answer to all three is the
 * same: the sheet still gets its eight hours and nobody has to do anything. The
 * notice exists so HR can TELL THE TWO KINDS APART, which is why the counting
 * below keeps flat days out of the warning piles entirely.
 *
 * Run with: npm test
 */

const entry = (over = {}) => ({
  workDate: '2026-09-01', startTime: '17:30', endTime: '20:00', endsNextDay: false, ...over,
});
const punch = (date, time) => ({ date, time });

// ── the ordinary readings ───────────────────────────────────────────────────

test('มีสแกนใกล้ทั้งเวลาเริ่มและเวลาสิ้นสุด = ตรงกัน ไม่มีคำเตือน', () => {
  const check = checkEntryAgainstScans(entry(), [
    punch('2026-09-01', '07:26:22'), // มาทำงานตอนเช้า — ไม่เกี่ยวกับใบนี้
    punch('2026-09-01', '17:28:10'),
    punch('2026-09-01', '20:04:55'),
  ]);
  assert.equal(check.state, SCAN_MATCH.OK);
  assert.equal(check.start.matched, true);
  assert.equal(check.end.matched, true);
  assert.equal(scanMismatchNote(check), null, 'แถวที่ตรงกันต้องไม่มีประโยคเตือน');
});

test('สแกนห่างเกินกำหนดข้างเดียว = เตือน และบอกว่าห่างกี่นาที', () => {
  // สิ้นสุด 20:00 แต่สแกนออก 20:40 — ห่าง 40 นาที
  const check = checkEntryAgainstScans(entry(), [
    punch('2026-09-01', '17:28:00'),
    punch('2026-09-01', '20:40:00'),
  ]);
  assert.equal(check.state, SCAN_MATCH.MISMATCH);
  assert.equal(check.start.matched, true);
  assert.equal(check.end.matched, false);
  assert.equal(check.end.diff, 40);
  const note = scanMismatchNote(check);
  assert.match(note, /เวลาไม่ตรงกับไฟล์สแกนนิ้ว/);
  assert.match(note, /20:40/, 'ต้องอ้างเวลาสแกนที่ใกล้ที่สุด ไม่ใช่บอกแค่ว่าไม่ตรง');
  assert.match(note, /40 นาที/);
  assert.ok(!/เวลาเริ่ม/.test(note), 'ข้างที่ตรงแล้วไม่ต้องพูดถึง');
});

test('เส้นแบ่งอยู่ที่ 15 นาทีพอดี — 15 ยังตรง 16 ไม่ตรง', () => {
  const at = (time) => checkEntryAgainstScans(
    entry({ startTime: '17:30', endTime: '20:00' }),
    [punch('2026-09-01', time), punch('2026-09-01', '20:00:00')],
  );
  assert.equal(SCAN_MATCH_TOLERANCE_MINUTES, 15);
  assert.equal(at('17:15:00').state, SCAN_MATCH.OK);
  assert.equal(at('17:14:00').state, SCAN_MATCH.MISMATCH);
  assert.equal(at('17:45:00').state, SCAN_MATCH.OK);
  assert.equal(at('17:46:00').state, SCAN_MATCH.MISMATCH);
});

test('ค่ายอมรับเปลี่ยนได้จากผู้เรียก — เผื่อวันที่ฝ่ายบุคคลตอบมาว่าควรเป็นเท่าไร', () => {
  const punches = [punch('2026-09-01', '17:50:00'), punch('2026-09-01', '20:00:00')];
  assert.equal(checkEntryAgainstScans(entry(), punches).state, SCAN_MATCH.MISMATCH);
  assert.equal(
    checkEntryAgainstScans(entry(), punches, { toleranceMinutes: 30 }).state,
    SCAN_MATCH.OK,
  );
});

// ── 1. ไม่เตือนพร่ำเพรื่อ ───────────────────────────────────────────────────

test('สแกนตอนเช้าต้องไม่ถูกใช้ตอบแทนเวลาเริ่มของใบตอนเย็น', () => {
  /**
   * นี่คือทางที่ฟีเจอร์นี้จะกลายเป็นเสียงรบกวน: ถ้าเอา "สแกนที่ใกล้ที่สุดทั้งวัน"
   * มาตอบ ใบเย็นที่ไม่มีสแกนเลยจะได้สแกน 07:26 เป็นคำตอบ แล้วบอกว่าห่าง 604 นาที
   * ซึ่งอ่านแล้วไม่ได้ความอะไร — จึงมีขอบว่า "ไกลเกินกว่าจะเอ่ยถึง"
   */
  const check = checkEntryAgainstScans(entry(), [punch('2026-09-01', '07:26:22')]);
  assert.equal(check.state, SCAN_MATCH.MISMATCH);
  assert.equal(check.start, null, 'สแกนเช้าไกลเกินกว่าจะยกมาอ้าง');
  assert.equal(check.end, null);
  assert.equal(check.punchCount, 1, 'แต่ยังนับได้ว่าวันนั้นมีการสแกนอยู่');
  assert.match(scanMismatchNote(check), /ไม่มีสแกนใกล้เคียง/);
});

test('สแกนที่ใกล้ที่สุดจริง ๆ ต้องเป็นตัวที่ถูกยกมาอ้าง ไม่ใช่ตัวที่บังเอิญอยู่ในกรอบ', () => {
  /**
   * บั๊กจริงที่เจอจากการเดินแอปที่ build แล้ว เมื่อ 4 ก.ย. 2569 · ใบ 17:30–20:00
   * ที่มีสแกน 17:29 กับ 21:10 เคยรายงานว่า "เวลาสิ้นสุดต่างจากเวลาสแกน 17:29 อยู่
   * 151 นาที" เพราะ 21:10 หลุดขอบเดิมไปหนึ่งนาที เหลือแต่ตัวฝั่งเช้าอยู่ในกรอบ
   *
   * คำเตือน *ถูก* — แถวนี้ไม่ตรงจริง — แต่หลักฐานที่ยกมาเป็นหลักฐานผิดตัว ซึ่งแย่
   * กว่าไม่ยกอะไรมาเลย: คนอ่านไปตรวจ 17:29 แล้วพบว่ามันคือสแกนตอนเริ่ม OT พอดี
   * แล้วสรุปว่าระบบมั่ว
   */
  const check = checkEntryAgainstScans(entry({ startTime: '17:30', endTime: '20:00' }), [
    punch('2026-09-01', '17:29:00'), punch('2026-09-01', '21:10:00'),
  ]);
  assert.equal(check.state, SCAN_MATCH.MISMATCH);
  assert.equal(check.start.matched, true, 'ฝั่งเริ่มตรง');
  assert.equal(check.end.time.slice(0, 5), '21:10', 'ฝั่งจบต้องอ้าง 21:10 ไม่ใช่ 17:29');
  assert.equal(check.end.diff, 70);
});

test('วินาทีถูกปัดลง ไม่ใช่ปัดขึ้น — 17:29:59 คือนาที 17:29', () => {
  // ปัดขึ้นจะทำให้สแกนที่ห่าง 15 นาที 1 วินาที กลายเป็นตรงพอดี ซึ่งเป็นเส้นที่
  // ขยับเองโดยไม่มีใครสั่ง
  const check = checkEntryAgainstScans(entry({ startTime: '17:30' }), [
    punch('2026-09-01', '17:14:59'), punch('2026-09-01', '20:00:00'),
  ]);
  assert.equal(check.start.diff, 16);
  assert.equal(check.state, SCAN_MATCH.MISMATCH);
});

// ── 1ก. ไม่มีใครสแกนตอน 17:00 — และนั่นไม่ใช่ความผิดพลาด ───────────────────
//
// บอกมาเมื่อ 4 ก.ย. 2569 ในรูปนี้: **พนักงานส่วนใหญ่สแกนเข้างานก่อน 08:00 น.
// แล้วไม่สแกนตอน 17:00 น. เมื่อมีโอที — สแกนอีกทีตอนเลิกโอที** รวมทั้งวันสองรอบ
// ส่วนน้อยสแกนสี่รอบ คือ เช้า · 17:00 ตอนเลิกงาน · ตอนเข้ามาทำโอที · ตอนออก
//
// เครื่องบันทึก "ประตู" ตอน 17:00 คนอยู่ข้างในอยู่แล้ว กะที่มาทำแค่หมดลง จึงไม่มี
// เหตุการณ์ที่ประตูให้บันทึก และไม่เคยมีตั้งแต่แรก · เดือนจริงเดือนแรกโดนธง 25 จาก
// 27 แถวด้วยเรื่องนี้ ซึ่งคือทางที่ฟีเจอร์จะกลายเป็นสีที่ไม่มีใครเปิดอ่าน

test('แบบสองรอบ (เช้า + ตอนเลิกโอที) คือแบบปกติ — ไม่เตือน', () => {
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:42:10'), punch('2026-09-01', '19:33:05')],
  );
  assert.equal(check.state, SCAN_MATCH.OK);
  assert.equal(check.missingOtStart, true, 'เวลาเริ่มไม่มีทางมีสแกน จึงไม่ถูกนับ');
  assert.equal(check.start, null);
  assert.equal(check.end.matched, true, 'ฝั่งที่เครื่องบันทึกได้จริงคือฝั่งเลิกโอที');
  assert.equal(scanMismatchNote(check), null);
  assert.equal(dayPunchLine(check), '07:42 , 19:33', 'เวลายังโชว์ครบเหมือนเดิม');
});

test('แบบสี่รอบ (สแกน 17:00 และตอนเข้าโอทีด้วย) ก็ตรงตามปกติ', () => {
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:42:10'), punch('2026-09-01', '17:02:41'),
      punch('2026-09-01', '17:28:03'), punch('2026-09-01', '19:31:55')],
  );
  assert.equal(check.state, SCAN_MATCH.OK);
  assert.equal(check.missingOtStart, false, 'วันนี้มีสแกนใกล้เวลาเริ่มจริง จึงเทียบได้');
  assert.equal(check.start.time.slice(0, 5), '17:02');
});

test('มีสแกนใกล้เวลาเริ่มแต่ห่างเกินกำหนด ยังบอกเหมือนเดิม', () => {
  /**
   * ตัดสินไว้เมื่อ 4 ก.ย. 2569 · ไม่มีสแกนตอน 17:00 = เงียบ แต่ 17:22 คือ
   * เหตุการณ์ที่ประตูใกล้เวลาที่ใบอ้าง และมันขัดกัน — จึงยกมาพูด
   */
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:42:10'), punch('2026-09-01', '17:22:00'),
      punch('2026-09-01', '17:40:00'), punch('2026-09-01', '19:33:00')],
  );
  assert.equal(check.state, SCAN_MATCH.MISMATCH);
  assert.equal(check.missingOtStart, false);
  assert.match(scanMismatchNote(check), /เวลาเริ่ม สแกน 17:22 หลังเวลา 22 นาที/);
});

test('ไม่มีสแกนก่อนเวลาเริ่มเลย ยังเตือน — คนไม่ได้อยู่ข้างในมาก่อน', () => {
  // สแกนออกอย่างเดียวทั้งวัน ไม่ใช่รูปแบบปกติของที่นี่ และเป็นช่องว่างของหลักฐานจริง
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '19:33:00')],
  );
  assert.equal(check.state, SCAN_MATCH.MISMATCH);
  assert.equal(check.missingOtStart, false);
  assert.match(scanMismatchNote(check), /เวลาเริ่ม ไม่มีสแกนใกล้เคียง/);
});

test('ลืมสแกนตอนเลิกโอที ยังเตือน และเตือนข้างเดียวคือข้างที่มีความหมาย', () => {
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:42:10')],
  );
  assert.equal(check.state, SCAN_MATCH.MISMATCH);
  const note = scanMismatchNote(check);
  assert.match(note, /เวลาสิ้นสุด ไม่มีสแกนใกล้เคียง/);
  assert.ok(!/เวลาเริ่ม/.test(note), 'ไม่พูดถึงเวลาเริ่มบนวันที่คนอยู่ข้างในอยู่แล้ว');
});

test('สแกนตัวเดียวตอบสองฝั่งไม่ได้ ถ้ามันคือตัวที่ใช้ตอบฝั่งจบไปแล้ว', () => {
  /**
   * ใบ 17:00–18:30 ที่สแกนออก 18:25 · 18:25 ห่างจากเวลาเริ่ม 85 นาที ซึ่ง*อยู่ใน*
   * กรอบที่ยกมาอ้างได้ (120) — ถ้าปล่อยไว้ ฝั่งเริ่มจะยกสแกนตอนกลับบ้านมาเป็น
   * หลักฐานเรื่องเวลามาถึง แล้วเตือนบนแถวที่ไม่มีอะไรผิด · ตระกูลเดียวกับบั๊ก
   * 21:10 เมื่อ 4 ก.ย. 2569 คือหลักฐานผิดตัวแย่กว่าไม่ยกอะไรมา
   */
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '18:30' }),
    [punch('2026-09-01', '07:42:10'), punch('2026-09-01', '18:25:00')],
  );
  assert.equal(check.state, SCAN_MATCH.OK);
  assert.equal(check.start, null, 'สแกนตอนกลับบ้านไม่ถูกยกมาตอบฝั่งเริ่ม');
  assert.equal(check.end.diff, 5);
});

test('แต่ถ้าสแกนตัวเดียวนั้นใกล้ทั้งสองฝั่งจริง ก็ตอบได้ทั้งสองฝั่ง', () => {
  // ใบสั้นพอที่การเดินผ่านประตูครั้งเดียวจะตอบได้ทั้งคู่ — นั่นคือการอ่านที่ถูก
  // ไม่ใช่ความบังเอิญ จึงไม่ถูกตัดออกจากฝั่งเริ่ม
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '17:20' }),
    [punch('2026-09-01', '17:10:00')],
  );
  assert.equal(check.state, SCAN_MATCH.OK);
  assert.equal(check.start.time.slice(0, 5), '17:10');
  assert.equal(check.end.time.slice(0, 5), '17:10');
});

test('กลับบ้านตอนเที่ยง ไม่ได้อยู่ทำโอที — ยังจับได้จากฝั่งจบ', () => {
  // กฎใหม่ปิดเสียงฝั่งเริ่ม ไม่ได้ปิดเสียงทั้งแถว: ฝั่งจบยังเป็นคำตอบอยู่
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:42:10'), punch('2026-09-01', '12:10:00')],
  );
  assert.equal(check.state, SCAN_MATCH.MISMATCH);
  assert.match(scanMismatchNote(check), /เวลาสิ้นสุด ไม่มีสแกนใกล้เคียง/);
});

// ── 1ข. ไม่ใช่ข้อผิดพลาด แต่ยังต้องพูด — ป้าย `ไม่ได้สแกนเข้า OT` ──────────
//
// ขอมาในวันเดียวกัน หลังจากที่คำตัดสินเงียบไปแล้ว: *"แสดง Badge/Flag Warning …
// ไม่ได้สแกนเข้า OT เพื่อเตือนว่าไม่มีสแกนเข้าช่วง 17:00 น."*
//
// สองอย่างนี้ตอบคนละคำถาม — **คำตัดสิน** บอกว่าต้องไปดูแถวนี้ไหม (ไม่ต้อง)
// **ป้าย** บอกว่าเครื่องเห็นอะไรและไม่เห็นอะไร ซึ่งพิมพ์ไว้บนแถวที่ไม่ต้องทำอะไร
// ก็ยังมีประโยชน์ · ป้ายจึงเป็น**สีเทา** ไม่ใช่สีส้ม เพราะมันขึ้น 25 จาก 27 แถว
// ซึ่งเป็นตัวเลขเดียวกับที่ทำให้สีส้มอ่านไม่ได้

test('แบบสองรอบได้ป้าย ไม่ได้สแกนเข้า OT ทั้งที่คำตัดสินว่าไม่มีอะไรผิด', () => {
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:42:10'), punch('2026-09-01', '19:33:05')],
  );
  assert.equal(check.state, SCAN_MATCH.OK, 'ยังไม่ใช่แถวที่ต้องไปตรวจ');
  assert.equal(showsMissingOtStart(check), true, 'แต่ยังต้องบอกว่าไม่มีสแกนตอนเริ่ม');
  assert.equal(MISSING_OT_START.LABEL, 'ไม่ได้สแกนเข้า OT');
  assert.match(MISSING_OT_START.SAY, /ปกติของที่นี่/, 'ป้ายเทาต้องบอกด้วยว่านี่คือเรื่องปกติ');
  assert.match(MISSING_OT_START.SAY, /สแกนตอนเลิก OT/, 'และบอกว่าเทียบจากอะไรแทน');
});

test('แบบสี่รอบไม่ได้ป้ายนี้ — มันสแกนเข้า OT ไว้จริง', () => {
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:42:10'), punch('2026-09-01', '17:02:41'),
      punch('2026-09-01', '17:28:03'), punch('2026-09-01', '19:31:55')],
  );
  assert.equal(showsMissingOtStart(check), false);
});

test('ใบเหมารายวันไม่ได้ป้ายนี้ — ป้ายเขียวคือคำตอบของแถวนั้นแล้ว', () => {
  /**
   * เป็นความผิดพลาดเดียวกับป้ายส้มเมื่อ 4 ก.ย. 2569 ถ้าทำซ้ำเป็นสีเทา — วันที่ถูก
   * เหมาไปทั้งวันแล้ว ไม่มีใครถามว่ามันมีเหตุการณ์ที่ประตูครบไหม
   */
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30', flatDaily: true }),
    [punch('2026-09-01', '07:42:10'), punch('2026-09-01', '19:33:05')],
  );
  assert.equal(check.missingOtStart, true, 'ข้อเท็จจริงยังเป็นจริงอยู่');
  assert.equal(showsMissingOtStart(check), false, 'แต่ไม่วาดบนแถวเหมา');
});

test('วันที่ไม่มีสแกนเลย ไม่ได้ป้ายนี้ — ป้าย ไม่มีข้อมูลสแกน พูดครบแล้ว', () => {
  // สองป้ายเทาบนแถวเดียวคือประโยคเดียวถูกผ่าครึ่ง
  const check = checkEntryAgainstScans(entry({ startTime: '17:00' }), []);
  assert.equal(check.state, SCAN_MATCH.NO_SCAN);
  assert.equal(showsMissingOtStart(check), false);
});

test('แถวที่ลืมสแกนออก ได้ทั้งป้ายเทาและป้ายส้ม — คนละเรื่องกัน', () => {
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:42:10')],
  );
  assert.equal(showsMissingOtStart(check), true, 'ไม่มีสแกนตอนเริ่ม');
  assert.equal(check.state, SCAN_MATCH.MISMATCH, 'และไม่มีสแกนตอนเลิกด้วย ซึ่งต้องไปดู');
});

test('ผลเทียบที่ยังไม่ได้เทียบ ไม่หลอกให้ขึ้นป้าย', () => {
  assert.equal(showsMissingOtStart(null), false);
  assert.equal(showsMissingOtStart(undefined), false);
  assert.equal(showsMissingOtStart({}), false);
});

// ── 2. ช่องว่างของหลักฐาน ต่างจากความไม่ตรงกัน ─────────────────────────────

test('ไม่มีสแกนเลยทั้งวัน = คนละคำตอบกับ "เวลาไม่ตรง"', () => {
  /**
   * สองอย่างนี้ขอสิ่งที่ต่างกันจากคนอ่าน: อย่างหนึ่งคือใบอาจผิด อีกอย่างคือ
   * *หลักฐานหาย* (ยังไม่ได้นำเข้าไฟล์ หรือวันนั้นไปทำงานที่อื่น) จอที่รวมสองอันนี้
   * เป็นประโยคเดียวกันคือจอที่ตอบผิดครึ่งหนึ่งของเวลา
   */
  const check = checkEntryAgainstScans(entry(), []);
  assert.equal(check.state, SCAN_MATCH.NO_SCAN);
  assert.equal(check.punchCount, 0);
  assert.match(scanMismatchNote(check), /ไม่มีข้อมูลสแกนของวันนี้/);
  assert.ok(!/เวลาไม่ตรง/.test(scanMismatchNote(check)));
});

test('สแกนของวันอื่นไม่ทำให้วันนี้กลายเป็น "มีข้อมูลแล้ว"', () => {
  const check = checkEntryAgainstScans(entry(), [
    punch('2026-08-31', '17:30:00'), punch('2026-09-02', '20:00:00'),
  ]);
  assert.equal(check.state, SCAN_MATCH.NO_SCAN);
});

// ── 3. ใบข้ามคืนอ่านบนเส้นจำนวนเดียว ไม่ใช่บนหน้าปัดนาฬิกา ─────────────────

test('ใบข้ามคืน: สแกน 02:04 ของวันรุ่งขึ้น อยู่ห่างจากเวลาเลิก 02:00 แค่ 4 นาที', () => {
  /**
   * ถ้าเทียบกันบนหน้าปัดนาฬิกา 02:04 กับ 02:00 จะกลายเป็นห่างกัน 1436 นาที และ
   * ใบข้ามคืนทุกใบในระบบจะขึ้นเตือนทั้งหมด
   */
  const check = checkEntryAgainstScans(
    entry({ startTime: '22:00', endTime: '02:00', endsNextDay: true }),
    [punch('2026-09-01', '21:55:00'), punch('2026-09-02', '02:04:00')],
  );
  assert.equal(check.state, SCAN_MATCH.OK);
  assert.equal(check.end.diff, 4);
});

test('ใบข้ามคืนนับสแกนของเช้าวันรุ่งขึ้นว่าเป็น "มีข้อมูลของใบนี้"', () => {
  const check = checkEntryAgainstScans(
    entry({ startTime: '22:00', endTime: '02:00', endsNextDay: true }),
    [punch('2026-09-02', '02:04:00')],
  );
  assert.notEqual(check.state, SCAN_MATCH.NO_SCAN);
  assert.equal(check.punchCount, 1);
});

// ── 4. เหมารายวัน — เวลาไม่ตรงไม่เป็นไร แต่ต้องบอกว่าเป็นใบเหมา ────────────

test('ใบเหมารายวันที่เวลาไม่ตรง ประโยคขึ้นต้นด้วยกฎเหมา ไม่ใช่ด้วยคำว่าไม่ตรง', () => {
  /**
   * ── นี่คือคำตอบรอบสอง และมันกลับด้านกับรอบแรก ─────────────────────────────
   *
   * รอบแรกอ่านว่า "เตือน แต่ติดป้ายว่าเหมา" · รอบสองในวันเดียวกันบอกชัดว่า
   * **ถ้าติ๊กเหมารายวัน เวลาสแกนไม่ตรงไม่เป็นไร แต่ต้องมีแจ้งเตือนว่าเขาเหมารายวัน**
   *
   * วันที่ถูกเหมาไปทั้งวันแล้ว เวลาบนใบจึงไม่ใช่ข้อกล่าวอ้างที่เครื่องจะมาค้านได้
   * สิ่งที่ฝ่ายบุคคลต้องการบนแถวนั้นไม่ใช่ "ไปดูหน่อย" แต่คือ "ใบนี้เป็นใบเหมา"
   *
   * ทำผิดทางแรกไม่ใช่เรื่องเล็ก — ป้ายสีเตือนบนแถวที่ไม่มีอะไรให้หา คือสิ่งที่สอน
   * ให้คนเลิกเปิดป้ายสีเตือนอันที่มีอะไรจริง ๆ
   */
  const check = checkEntryAgainstScans(
    entry({ flatDaily: true }),
    [punch('2026-09-01', '17:28:00'), punch('2026-09-01', '21:10:00')],
  );
  assert.equal(check.state, SCAN_MATCH.MISMATCH, 'ยังอ่านออกว่าไม่ตรง — แค่ไม่ใช่ปัญหา');
  assert.equal(check.flatDaily, true);

  const note = scanMismatchNote(check);
  assert.match(note, /^ใบนี้เป็นการยื่นขอ OT แบบเหมารายวัน/, 'ต้องขึ้นต้นด้วยกฎเหมา');
  assert.match(note, /(ไม่ต้องแก้)/, 'และต้องบอกว่าไม่ต้องไปแก้อะไร');
  assert.ok(
    !/^เวลาไม่ตรงกับไฟล์สแกนนิ้ว/.test(note),
    'ห้ามขึ้นต้นแบบใบปกติ — ประโยคที่นำด้วยคำว่าไม่ตรงคือคำเตือน',
  );
  // ตัวเลขยังอยู่ครบ เพราะ "70 นาที" ยังน่ารู้ แม้จะไม่ใช่สิ่งที่ต้องแก้
  assert.match(note, /21:10/);
  assert.match(note, /70 นาที/);
});

test('ใบเหมาทั้งสามแบบที่ฝ่ายบุคคลบอกมา อ่านออกมาว่า "ไม่ต้องแก้" เหมือนกันหมด', () => {
  /**
   * ฝ่ายบุคคลระบุสามแบบเมื่อ 4 ก.ย. 2569: **ไม่ได้สแกนนิ้ว · สแกนออกก่อนเวลา ·
   * สแกนเข้าแต่ไม่ได้สแกนออก** — คำตอบของทั้งสามแบบคืออันเดียวกัน คือใบยังได้
   * 8 ชั่วโมงตามเดิม และไม่มีใครต้องทำอะไร
   *
   * **การไม่สแกนเลยเป็น *ชนิดหนึ่ง* ของใบเหมา ไม่ใช่ *ช่องโหว่* ของใบเหมา** ซึ่ง
   * เป็นที่เดียวที่ประโยคนี้ยังอ่านเหมือนมีปัญหาอยู่ก่อนหน้านี้
   */
  const flat = (punches) => scanMismatchNote(
    checkEntryAgainstScans(entry({ flatDaily: true, startTime: '08:00', endTime: '17:00' }), punches),
  );

  const cases = {
    'ไม่ได้สแกนนิ้วเลย': flat([]),
    'สแกนออกก่อนเวลา': flat([punch('2026-09-01', '07:58:00'), punch('2026-09-01', '15:40:00')]),
    'สแกนเข้าแต่ไม่ได้สแกนออก': flat([punch('2026-09-01', '07:58:00')]),
  };

  for (const [name, note] of Object.entries(cases)) {
    assert.ok(note, `${name}: ต้องมีข้อความบอกว่าเป็นใบเหมา`);
    assert.match(note, /^ใบนี้เป็นการยื่นขอ OT แบบเหมารายวัน/, name);
    assert.match(note, /คิดให้ 8 ชั่วโมงตามเดิม/, `${name}: ต้องยืนยันว่าชั่วโมงไม่ขยับ`);
    assert.match(note, /\(ไม่ต้องแก้\)/, `${name}: ต้องบอกว่าไม่ต้องทำอะไร`);
  }

  // และแต่ละแบบยังบอกได้ว่าเกิดอะไรขึ้น ไม่ใช่ประโยคเดียวกันเป๊ะทั้งสามแบบ
  assert.match(cases['ไม่ได้สแกนนิ้วเลย'], /ไม่มีข้อมูลสแกนของวันนี้/);
  assert.match(cases['สแกนออกก่อนเวลา'], /เวลาสิ้นสุด สแกน 15:40 ก่อนเวลา 80 นาที/);
  assert.match(cases['สแกนเข้าแต่ไม่ได้สแกนออก'], /เวลาสิ้นสุด ไม่มีสแกนใกล้เคียง/);
});

test('บอกว่าสแกนอยู่ "ก่อนเวลา" หรือ "หลังเวลา" — แต่ไม่พูดว่าเข้าหรือออก', () => {
  /**
   * เครื่องไม่ได้บันทึกว่าครั้งไหนเข้าครั้งไหนออก (ดู src/models/ScanPunch.js)
   * การเขียนว่า "สแกนออกก่อนเวลา" จึงเป็นการที่โมดูลนี้แต่งฟิลด์ที่ไฟล์ไม่มีขึ้นมาเอง
   * · "ก่อนเวลา / หลังเวลา" บอกสิ่งที่มีประโยชน์เท่ากัน คือสแกนตกอยู่ฝั่งไหนของเวลาบนใบ
   * โดยไม่อ้างว่าคนเดินไปทางไหน
   */
  const early = scanMismatchDetail(checkEntryAgainstScans(entry(), [
    punch('2026-09-01', '17:28:00'), punch('2026-09-01', '18:50:00'),
  ]));
  assert.match(early, /เวลาสิ้นสุด สแกน 18:50 ก่อนเวลา 70 นาที/);

  const late = scanMismatchDetail(checkEntryAgainstScans(entry(), [
    punch('2026-09-01', '17:28:00'), punch('2026-09-01', '20:40:00'),
  ]));
  assert.match(late, /เวลาสิ้นสุด สแกน 20:40 หลังเวลา 40 นาที/);

  for (const text of [early, late]) {
    assert.ok(!/สแกนเข้า|สแกนออก/.test(text), 'ห้ามอ้างว่าเป็นการสแกนเข้าหรือสแกนออก');
  }
});

test('ใบปกติที่เวลาไม่ตรง ยังนำด้วยคำว่าไม่ตรงเหมือนเดิม', () => {
  // ครึ่งที่ต้องไม่ขยับตามการกลับด้านข้างบน
  const note = scanMismatchNote(checkEntryAgainstScans(entry(), [
    punch('2026-09-01', '17:28:00'), punch('2026-09-01', '20:40:00'),
  ]));
  assert.match(note, /^เวลาไม่ตรงกับไฟล์สแกนนิ้ว/);
  assert.ok(!/เหมารายวัน/.test(note));
});

test('ใบเหมารายวันที่เวลาตรง ไม่มีอะไรจะพูดจากฝั่งการเทียบเวลา', () => {
  /**
   * ป้าย เหมารายวัน เองยังต้องขึ้นอยู่ดี — แต่มันมาจาก `entry.flatDaily` ไม่ได้มา
   * จากการเทียบเวลา (ดู `FlatDailyMark` ใน components/common.jsx) โมดูลนี้จึง
   * ต้องเงียบ
   */
  const check = checkEntryAgainstScans(
    entry({ flatDaily: true }),
    [punch('2026-09-01', '17:30:00'), punch('2026-09-01', '20:00:00')],
  );
  assert.equal(check.state, SCAN_MATCH.OK);
  assert.equal(scanMismatchNote(check), null);
  assert.equal(scanMismatchDetail(check), null);
});

// ── แถวที่เทียบไม่ได้ ───────────────────────────────────────────────────────

test('แถวที่ไม่มีเวลาให้เทียบ คืน null ไม่ใช่คืนคำเตือน', () => {
  for (const bad of [
    null, {}, { workDate: '2026-09-01' },
    { workDate: '2026-09-01', startTime: '17:30' },
    { workDate: '2026-09-01', startTime: 'ไม่ทราบ', endTime: '20:00' },
  ]) {
    assert.equal(checkEntryAgainstScans(bad, []), null);
  }
  assert.equal(scanMismatchNote(null), null);
});

test('เวลาสแกนที่อ่านไม่ออก ถูกข้าม ไม่ใช่ทำให้ทั้งแถวพัง', () => {
  const check = checkEntryAgainstScans(entry(), [
    { date: '2026-09-01', time: 'ไม่ทราบ' },
    punch('2026-09-01', '17:30:00'),
    punch('2026-09-01', '20:00:00'),
  ]);
  assert.equal(check.state, SCAN_MATCH.OK);
});

// ── ประโยคเต็มกับบรรทัดสั้น ต้องพูดเรื่องเดียวกัน ──────────────────────────

test('บรรทัดใต้ป้ายกับข้อความ tooltip มาจากการเทียบครั้งเดียวกัน', () => {
  /**
   * `title` คือ hover ซึ่งนิ้วไม่มี ตัวเลขที่ทำให้คำเตือนใช้งานได้จริง ("อีก 40
   * นาที" ไม่ใช่แค่ "ไม่ตรง") จึงถูกพิมพ์ใต้ป้ายด้วย · ถ้าสองที่นี้ประกอบคำเอง
   * แยกกัน วันหนึ่งมันจะบอกคนละเรื่องกันโดยไม่มีใครเห็น
   */
  const check = checkEntryAgainstScans(entry(), [
    punch('2026-09-01', '17:28:00'), punch('2026-09-01', '20:40:00'),
  ]);
  const detail = scanMismatchDetail(check);
  assert.match(detail, /20:40/);
  assert.match(detail, /40 นาที/);
  assert.ok(
    scanMismatchNote(check).endsWith(detail),
    'ประโยคเต็มต้องเป็นบรรทัดสั้นที่มีคำนำหน้า ไม่ใช่ข้อความชุดที่สอง',
  );
  // และบรรทัดสั้นไม่ต้องเล่าเรื่องซ้ำว่า "ไม่ตรง" — ป้ายเหนือมันบอกไปแล้ว
  assert.ok(!/เวลาไม่ตรงกับไฟล์สแกน/.test(detail));
  assert.equal(scanMismatchDetail(null), null);
});

// ── เวลาสแกนทั้งวัน โชว์ตามที่เครื่องบันทึก ────────────────────────────────

test('แถวหนึ่งพกเวลาสแกนของทั้งวันมาด้วย เรียงตามนาฬิกา', () => {
  /**
   * ขอมาเมื่อ 4 ก.ย. 2569 หลังเดินกับเดือนจริงเดือนแรก — *"เอาเวลาที่สแกนเข้าออก
   * ตลอดทั้งวันมาโชว์ ในแต่ละวัน"*
   *
   * เดือนนั้นอ่านออกมาว่า `ใบ 17:00–19:30 · สแกน 07:21, 19:30` — คนสแกนวันละสอง
   * ครั้ง เข้าเช้าออกเย็น และ **ไม่มีใครสแกนตอน 17:00 ที่ OT เริ่ม** เพราะ 17:00
   * คือเวลาเลิกงานปกติ ไม่ใช่เหตุการณ์ที่ประตู · 25 จาก 27 แถวจึงถูกติดป้ายด้วย
   * เวลาเริ่มที่เครื่องไม่เคยอยู่ในฐานะที่จะบันทึกได้
   *
   * ระบบที่ไม่รู้ว่าครั้งไหนเป็นครั้งไหน ยังพิมพ์สิ่งที่เครื่องบันทึกไว้ได้ —
   * ไม่ต้องเดา ไม่ต้องอ้าง และคนถือกระดาษเทียบเองได้
   */
  const check = checkEntryAgainstScans(entry({ startTime: '17:00', endTime: '19:30' }), [
    punch('2026-09-01', '19:30:23'),
    punch('2026-09-01', '07:21:27'), // ส่งมาสลับลำดับ — ต้องออกมาเรียงตามนาฬิกา
  ]);
  assert.deepEqual(check.dayPunches, [
    { time: '07:21', next: false },
    { time: '19:30', next: false },
  ]);
  assert.equal(dayPunchLine(check), '07:21 , 19:30');
});

test('เวลาสแกนโชว์ทุกแถวที่มีสแกน แม้แถวนั้นจะตรงกันดีอยู่แล้ว', () => {
  /**
   * ถ้าโชว์เฉพาะแถวที่มีปัญหา คนอ่านจะเรียนรู้ว่า "เห็นเวลาสแกน = มีเรื่อง"
   * ซึ่งคือสิ่งที่ของชิ้นนี้ถูกเพิ่มเข้ามาแทน
   */
  const ok = checkEntryAgainstScans(entry(), [
    punch('2026-09-01', '17:28:10'), punch('2026-09-01', '20:04:55'),
  ]);
  assert.equal(ok.state, SCAN_MATCH.OK);
  assert.equal(dayPunchLine(ok), '17:28 , 20:04');
});

test('ใบข้ามคืน: สแกนของเช้าวันรุ่งขึ้นติด (+1) ไว้', () => {
  // 02:04 ปนอยู่ในรายการเวลาเย็น โดยไม่มีอะไรกำกับ จะอ่านเป็นเช้ามืดของวันผิด
  const check = checkEntryAgainstScans(
    entry({ startTime: '22:00', endTime: '02:00', endsNextDay: true }),
    [punch('2026-09-01', '21:55:00'), punch('2026-09-02', '02:04:00')],
  );
  assert.deepEqual(check.dayPunches, [
    { time: '21:55', next: false },
    { time: '02:04', next: true },
  ]);
  assert.equal(dayPunchLine(check), '21:55 , 02:04 (+1)');
});

test('วันที่ไม่มีสแกนเลย ไม่มีบรรทัดเวลาให้โชว์', () => {
  const none = checkEntryAgainstScans(entry(), []);
  assert.deepEqual(none.dayPunches, []);
  assert.equal(dayPunchLine(none), null);
  assert.equal(dayPunchLine(null), null);
});

test('บรรทัดเวลาไม่บอกว่าครั้งไหนเข้าครั้งไหนออก', () => {
  // เครื่องไม่มีฟิลด์เข้า-ออก การเขียนว่า "เข้า 07:21 ออก 19:30" คือการแต่งข้อมูล
  const line = dayPunchLine(checkEntryAgainstScans(entry(), [
    punch('2026-09-01', '07:21:00'), punch('2026-09-01', '19:30:00'),
  ]));
  assert.ok(!/เข้า|ออก/.test(line));
});

// ── นับแยกกองให้ทั้งเดือน ──────────────────────────────────────────────────

test('ใบเหมาไม่ถูกนับเป็น "เวลาไม่ตรง" ไม่ว่าผลเทียบจะออกมาแบบไหน', () => {
  /**
   * *"แจ้งเตือนเพื่อให้ HR แยกออกระหว่างงานเหมากับเวลาไม่ตรงงานปกติ"* — ป้ายสีแยก
   * ให้ทีละแถว ตัวเลขนี้แยกให้ทั้งเดือน ซึ่งเป็นคำถามของคนที่กำลังเลื่อนดูสามสิบแถว
   *
   * ครึ่งที่สำคัญคือ **ใบเหมาไม่เคยตกลงกองคำเตือน** ไม่ว่าผลเทียบเวลาจะเป็นอะไร
   * นั่นคือตัวการแยกทั้งหมด เขียนเป็นเลขคณิตแทนที่จะเป็นสี
   */
  const row = (over) => ({ ...over });
  const counts = summariseScanChecks([
    row({ scanCheck: { state: SCAN_MATCH.OK } }),
    row({ scanCheck: { state: SCAN_MATCH.MISMATCH } }),
    row({ scanCheck: { state: SCAN_MATCH.MISMATCH } }),
    row({ scanCheck: { state: SCAN_MATCH.NO_SCAN } }),
    // ใบเหมาสามแบบ — ตรง ไม่ตรง และไม่มีสแกนเลย — ต้องไปกองเดียวกันทั้งสาม
    row({ flatDaily: true, scanCheck: { state: SCAN_MATCH.OK } }),
    row({ flatDaily: true, scanCheck: { state: SCAN_MATCH.MISMATCH } }),
    row({ flatDaily: true, scanCheck: { state: SCAN_MATCH.NO_SCAN } }),
  ]);
  assert.deepEqual(counts, { mismatch: 2, noScan: 1, flatDaily: 3, checked: 4 });
});

test('เดือนที่ยังไม่ได้นำเข้าไฟล์สแกน ยังนับใบเหมาได้ — มันเป็นเรื่องของวิธียื่นใบ', () => {
  const counts = summariseScanChecks([
    { flatDaily: true }, { flatDaily: true }, {}, {},
  ]);
  assert.deepEqual(counts, { mismatch: 0, noScan: 0, flatDaily: 2, checked: 0 });
});

test('รายชื่อคนที่ต้องดู มีเฉพาะคนที่มีอะไรให้ดูจริง และเรียงตามปริมาณ', () => {
  /**
   * *"แล้วจะดูการเปรียบเทียบตรงไหน"* — ป้ายอยู่บนแถว ซึ่งอยู่ลึกเข้าไปหนึ่งคลิก
   * ในหน้าของ *คนเดียว* · การ์ดจึงต้องบอกว่า **ใคร** ไม่ใช่แค่บอกว่ามีกี่แถว
   * ไม่งั้นคนอ่านต้องไล่เปิดทีละคนจากทะเบียนร้อยหกสิบคน ซึ่งไม่มีใครทำ และฟีเจอร์
   * ก็จะมีอยู่โดยไม่มีใครอ่าน
   */
  const e = (id, code, name, over) => ({ employee: { _id: id, code, name }, ...over });
  const people = groupScanChecksByPerson([
    e('1', 'PM001', 'สมชาย', { scanCheck: { state: SCAN_MATCH.MISMATCH } }),
    e('1', 'PM001', 'สมชาย', { scanCheck: { state: SCAN_MATCH.MISMATCH } }),
    e('2', 'PM002', 'สมหญิง', { scanCheck: { state: SCAN_MATCH.MISMATCH } }),
    e('2', 'PM002', 'สมหญิง', { scanCheck: { state: SCAN_MATCH.NO_SCAN } }),
    // คนที่ทุกแถวตรง ต้องไม่อยู่ในรายชื่อ
    e('3', 'PM003', 'สมศรี', { scanCheck: { state: SCAN_MATCH.OK } }),
    // และคนที่มีแต่ใบเหมาก็ไม่อยู่ — ใบเหมาเป็นข้อเท็จจริง ไม่ใช่ธุระที่ต้องไปทำ
    e('4', 'PM004', 'สมปอง', { flatDaily: true, scanCheck: { state: SCAN_MATCH.MISMATCH } }),
  ]);
  assert.deepEqual(people.map((p) => p.code), ['PM001', 'PM002']);
  assert.equal(people[0].mismatch, 2);
  assert.deepEqual(
    { mismatch: people[1].mismatch, noScan: people[1].noScan },
    { mismatch: 1, noScan: 1 },
  );
});

test('แถวที่ไม่มีพนักงานผูกอยู่ ไม่ทำให้รายชื่อพัง', () => {
  assert.deepEqual(groupScanChecksByPerson([{ scanCheck: { state: SCAN_MATCH.MISMATCH } }]), []);
  assert.deepEqual(groupScanChecksByPerson(), []);
});

test('รายการว่างนับได้เป็นศูนย์ ไม่ใช่พัง', () => {
  assert.deepEqual(summariseScanChecks(), { mismatch: 0, noScan: 0, flatDaily: 0, checked: 0 });
  assert.deepEqual(summariseScanChecks([null, undefined]), {
    mismatch: 0, noScan: 0, flatDaily: 0, checked: 0,
  });
});

// ── ขอบเขต: ไม่มีอะไรในโมดูลนี้แตะตัวเลข ────────────────────────────────────

test('ผลลัพธ์ไม่มีชั่วโมง ไม่มีช่องอัตรา ไม่มีสถานะ — เป็นคำถาม ไม่ใช่คำตอบใหม่', () => {
  /**
   * เขียนเป็นเทสต์เพราะมันคือเส้นที่ทำให้สร้างที่เก็บรอยสแกนได้ก่อนที่จะมีใครตอบว่า
   * ควรอ่านมันยังไง — เครื่องขัดกับใบที่เซ็นแล้วไม่ได้ ได้แค่ตั้งคำถาม
   */
  const check = checkEntryAgainstScans(entry(), [punch('2026-09-01', '18:30:00')]);
  assert.deepEqual(
    Object.keys(check).sort(),
    ['dayPunches', 'end', 'flatDaily', 'missingOtStart', 'punchCount', 'start',
      'state', 'tolerance'],
  );
});
