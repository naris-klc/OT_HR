import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCAN_BADGE, SCAN_MATCH, SCAN_MATCH_TOLERANCE_MINUTES, checkEntryAgainstScans,
  scanBadgeLabel, scanMismatchDetail, scanMismatchNote, summariseScanChecks,
  groupScanChecksByPerson, dayPunchLine, scanCheckInTime, SCAN_CHECK_IN_FLOOR_MINUTES,
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
 *   4. **A row marked for working longer than it claimed.** Added 7 ก.ย. 2569,
 *      when the end stopped being a distance and became a direction: สแกนออก
 *      ตั้งแต่เวลาสิ้นสุดบนใบเป็นต้นไป = ทำครบตามขอ, and the row is quiet. The
 *      nearest-punch reading marked those rows amber for forty minutes nobody
 *      was ever going to pay for. §1ค.
 *
 * ── คำสี่คำที่ฝ่ายบุคคลให้มา (7 ก.ย. 2569) ───────────────────────────────────
 *
 *   · **ไม่ครบ** — ขอโอทีมามากกว่าเวลาที่ทำจริง · ป้ายส้ม กองที่ต้องตรวจ
 *   · **เกินเวลา** — ขอโอทีมาน้อยกว่าที่ทำจริง · ป้ายเทา *ไม่* นับกองที่ต้องตรวจ
 *   · **ไม่ตรง** — ไม่มีการสแกนนิ้วแต่ยื่นขอโอที · ป้ายเทา
 *   · **เหมารายวัน** — ป้ายเขียว ไม่ต้องตรงกับสแกนทุกรูปแบบ
 *
 * ฝั่งเวลาเริ่มไม่ได้อยู่ในสี่คำนี้ และมีป้ายชื่อยาวของตัวเอง — ดู `SCAN_BADGE`.
 * ฝั่งจบไม่มีค่ายอมรับแล้ว (*ถ้าเวลาไม่ตรงกันขึ้นทุกกรณี*) ส่วน 15 นาทีเหลือไว้ที่
 * ฝั่งเริ่มที่เดียว.
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

test('สแกนออกหลังเวลาสิ้นสุด OT = ทำงานครบตามขอ ไม่ต้องขึ้นป้ายเวลาขาด', () => {
  /**
   * ── กลับด้านเมื่อ 7 ก.ย. 2569 ─────────────────────────────────────────────
   *
   * สั่งมาตรง ๆ ว่า *เวลาสแกนออกจริง >= เวลาสิ้นสุด OT ในใบขอ = ถือว่าทำงานครบ
   * ตามขอ ไม่ต้องแสดง Badge แจ้งเตือนเวลาขาด* · แถวนี้เคยขึ้นสีส้มว่า "ห่าง 40
   * นาที" ทั้งที่คนอยู่ทำงานเกินกว่าที่ตัวเองขอไป 40 นาที และไม่มีใครจ่ายให้ด้วย
   * — เป็นการทำเครื่องหมายคนที่อยู่นานกว่าที่ขอ ซึ่งไม่ใช่ข้อทักท้วงของใครเลย
   */
  const check = checkEntryAgainstScans(entry(), [
    punch('2026-09-01', '17:28:00'),
    punch('2026-09-01', '20:40:00'),
  ]);
  assert.equal(check.state, SCAN_MATCH.OK);
  assert.equal(check.start.matched, true);
  assert.equal(check.end.matched, true, 'ถึงเวลาที่ขอแล้ว = ฝั่งจบผ่าน');
  assert.equal(check.endShortMinutes, 0, 'ไม่มีเวลาขาดให้เตือน ซึ่งคือทั้งหมดที่ข้อนี้ขอ');

  /**
   * แถวที่อยู่เกินยังได้ป้ายเทา `เกินเวลา` ตามคำนิยามที่ฝ่ายบุคคลให้มาทีหลังในวัน
   * เดียวกัน — แต่มันคือ*ข้อเท็จจริง* ไม่ใช่ป้ายเวลาขาด และคำตัดสินยังเป็น OK
   * ดูหมวด 1ค
   */
  assert.equal(check.overTime, true);
  assert.equal(scanBadgeLabel(check), 'เกินเวลา · เกิน 40 นาที');

  // และแถวที่อยู่เกินไม่ถึงหนึ่งบล็อก OT ไม่มีป้ายอะไรเลย — ครบตามขอ เงียบสนิท
  const quiet = checkEntryAgainstScans(entry(), [
    punch('2026-09-01', '17:28:00'),
    punch('2026-09-01', '20:10:00'),
  ]);
  assert.equal(quiet.state, SCAN_MATCH.OK);
  assert.equal(quiet.overTime, false);
  assert.equal(scanBadgeLabel(quiet), null, 'ไม่มีป้ายบนแถวที่ทำครบ');
  assert.equal(scanMismatchNote(quiet), null);
});

test('สแกนออกก่อนเวลาสิ้นสุด OT = เวลาขาด และป้ายบอกว่าขาดกี่นาที', () => {
  // สิ้นสุด 20:00 แต่ประตูขยับครั้งสุดท้าย 19:20 — ขาด 40 นาที
  const check = checkEntryAgainstScans(entry(), [
    punch('2026-09-01', '17:28:00'),
    punch('2026-09-01', '19:20:00'),
  ]);
  assert.equal(check.state, SCAN_MATCH.MISMATCH);
  assert.equal(check.start.matched, true);
  assert.equal(check.end.matched, false);
  assert.equal(check.endShortMinutes, 40);
  assert.equal(scanBadgeLabel(check), 'ไม่ครบ · ขาด 40 นาที');
  const note = scanMismatchNote(check);
  assert.match(note, /เวลาไม่ตรงกับไฟล์สแกนนิ้ว/);
  assert.match(note, /19:20/, 'ต้องอ้างเวลาสแกนที่ยกมา ไม่ใช่บอกแค่ว่าไม่ตรง');
  assert.match(note, /ขาดอีก 40 นาที/);
  assert.ok(!/เวลาเริ่ม/.test(note), 'ข้างที่ตรงแล้วไม่ต้องพูดถึง');
});

test('ฝั่งจบไม่มีค่ายอมรับแล้ว — ขาดนาทีเดียวก็ขึ้น', () => {
  /**
   * ถามเมื่อ 7 ก.ย. 2569 ว่าเส้นแบ่งควรอยู่ที่ตัวเลขบนใบหรือที่ค่ายอมรับ 15 นาที
   * และตอบมาว่า **ถ้าเวลาไม่ตรงกันขึ้นทุกกรณี** · ฝั่งจบจึงวัดกับเวลาบนใบตรง ๆ
   * ไม่มีหน้าต่างให้สแกนไปยืนอยู่ข้างในอีกแล้ว
   */
  const end = (time) => checkEntryAgainstScans(
    entry({ startTime: '17:30', endTime: '20:00' }),
    [punch('2026-09-01', '17:30:00'), punch('2026-09-01', time)],
  );
  assert.equal(end('20:00:00').state, SCAN_MATCH.OK, 'ตรงเป๊ะคือครบ');
  assert.equal(end('20:15:00').state, SCAN_MATCH.OK);
  assert.equal(end('19:59:00').state, SCAN_MATCH.MISMATCH, 'ขาดนาทีเดียวก็คือขาด');
  assert.equal(end('19:59:00').endShortMinutes, 1);
  assert.equal(scanBadgeLabel(end('19:59:00')), 'ไม่ครบ · ขาด 1 นาที');
  assert.equal(end('19:45:00').endShortMinutes, 15, 'เคยตรงเพราะอยู่ในค่ายอมรับ ตอนนี้ไม่แล้ว');
  assert.equal(end('19:45:00').state, SCAN_MATCH.MISMATCH);
});

test('เส้นแบ่ง 15 นาทีเหลือไว้ที่ฝั่งเวลาเริ่ม — 15 ยังตรง 16 ไม่ตรง', () => {
  /**
   * ฝ่ายบุคคลตอบเมื่อ 4 ก.ย. 2569 ว่า 15 ไม่แคบไปและไม่กว้างไป เลขนี้จึงยืนอยู่บน
   * คำตอบแล้ว ไม่ใช่บนเหตุผลของเราเอง · เทสต์นี้เคยวัดสี่จุดจากฝั่งเริ่มอย่างเดียว
   * และข้อ `17:14 = ไม่ตรง` ถูกถอนออกในวันเดียวกัน ดูหมวด 1ก² — ค่ายอมรับไม่ได้
   * ตัดสินสแกนที่อยู่ *ก่อน* เวลาเริ่มอีกต่อไป · เคยย้ายมาวัดที่ฝั่งจบด้วย แล้ว
   * ย้ายกลับเมื่อ 7 ก.ย. 2569 เพราะฝั่งจบเลิกใช้ค่ายอมรับไปแล้ว เหลือฝั่งเริ่ม
   * เป็นที่เดียวที่เลขนี้ยังตัดสินอะไร
   */
  assert.equal(SCAN_MATCH_TOLERANCE_MINUTES, 15);

  const start = (time) => checkEntryAgainstScans(
    entry({ startTime: '17:30', endTime: '20:00' }),
    [punch('2026-09-01', time), punch('2026-09-01', '20:00:00')],
  );
  assert.equal(start('17:45:00').state, SCAN_MATCH.OK);
  assert.equal(start('17:46:00').state, SCAN_MATCH.MISMATCH, 'หลังเวลาเริ่ม เส้นเดิม');
  assert.equal(start('17:14:00').state, SCAN_MATCH.OK, 'ก่อนเวลาเริ่ม = อยู่ข้างในแล้ว');
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
   * มาตอบ*ฝั่งเริ่ม* ใบเย็นที่ไม่มีสแกนเลยจะได้สแกน 07:26 เป็นคำตอบเรื่องเวลามาถึง
   * ซึ่งเป็นเรื่องที่เกิดขึ้นเกือบทุกแถว — ฝั่งเริ่มจึงยังมีขอบ 2 ชม. อยู่
   *
   * ── แต่ฝั่งจบไม่มีขอบแล้วตั้งแต่ 7 ก.ย. 2569 ──────────────────────────────
   *
   * สั่งมาว่า *"ถ้ามีเวลาสแกนหลายเวลา ให้เอาเวลาที่ใกล้ที่สุดกับเวลาที่ยื่นขอโอทีมา"*
   * · ฝั่งจบคือเหตุการณ์เดียวของวันโอทีที่เครื่องมีโอกาสบันทึกจริง สแกนที่ไกลจึงเป็น
   * ข้อค้นพบ ไม่ใช่ความบังเอิญ และ 07:26 ที่ยกมาพร้อมระยะแบบ ชม./นาที อ่านออกว่า
   * "ทั้งวันมีแค่สแกนเช้า" ซึ่งเป็นประโยคที่จริงและใช้ได้ ต่างจาก "604 นาที" ที่
   * อ่านแล้วเหมือนระบบพัง
   */
  const check = checkEntryAgainstScans(entry(), [punch('2026-09-01', '07:26:22')]);
  assert.equal(check.state, SCAN_MATCH.MISMATCH);
  assert.equal(check.start, null, 'สแกนเช้าไกลเกินกว่าจะยกมาอ้างเรื่องเวลาเริ่ม');
  assert.equal(check.end.time.slice(0, 5), '07:26', 'แต่ฝั่งจบยกมา — มันคือสแกนเดียวที่มี');
  assert.equal(check.punchCount, 1, 'และยังนับได้ว่าวันนั้นมีการสแกนอยู่');
  assert.match(scanMismatchNote(check), /เวลาสิ้นสุด สแกน 07:26 · ขาดอีก \d+ ชม\./);
  assert.ok(!/เวลาเริ่ม/.test(scanMismatchNote(check)), 'ไม่พูดถึงเวลาเริ่มบนวันที่คนอยู่ข้างในอยู่แล้ว');
  // และบอกด้วยว่านี่คือรูปแบบ "สแกนเข้าแต่ไม่ได้สแกนออก" ไม่ใช่คนที่เดินออกก่อนเวลา
  assert.equal(check.missingScanOut, true, 'ทั้งวันไม่มีเหตุการณ์ที่ประตูหลังเวลาเริ่ม OT เลย');
  assert.match(scanMismatchNote(check), /อาจลืมสแกนออก/);
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
  assert.equal(check.start.matched, true, 'ฝั่งเริ่มตรง');
  assert.equal(check.end.time.slice(0, 5), '21:10', 'ฝั่งจบต้องอ้าง 21:10 ไม่ใช่ 17:29');
  assert.equal(check.end.diff, 70);
  /**
   * ── คำตัดสินของแถวนี้กลับด้านเมื่อ 7 ก.ย. 2569 ────────────────────────────
   *
   * 21:10 อยู่*หลัง* 20:00 แปลว่าเขาอยู่ครบตามที่ขอแล้วบวกอีก 70 นาที · แถวนี้
   * เคยเป็นสีส้ม ตอนนี้เงียบ — ส่วนที่เทสต์นี้ปกป้องคือหลักฐานที่ยกมาต้องเป็น
   * 21:10 ไม่ใช่ 17:29 ซึ่งยังจริงอยู่และเป็นคนละเรื่องกับคำตัดสิน
   */
  assert.equal(check.state, SCAN_MATCH.OK);
  assert.equal(check.endShortMinutes, 0);
});

test('มีสแกนหลายเวลา — ฝั่งไหนก็หยิบตัวที่ใกล้เวลาบนใบที่สุด', () => {
  /**
   * สั่งมาเมื่อ 7 ก.ย. 2569: *"ถ้ามีเวลาที่สแกนเข้าออกงานหลายเวลา ให้เปรียบเทียบ
   * เวลาที่ยื่นขอโอทีและเอาเวลาสแกนนิ้วที่ใกล้ที่สุดกับเวลาที่ยื่นขอโอทีมา"*
   *
   * วันสี่รอบที่มีสองรอบอยู่แถวเวลาเริ่ม: 17:05 ห่าง 25 นาที และ 17:40 ห่าง 10 นาที
   * ตัวที่ใกล้กว่าต้องชนะ ไม่ใช่ตัวแรกที่เจอในลิสต์
   */
  const check = checkEntryAgainstScans(entry({ startTime: '17:30', endTime: '20:00' }), [
    punch('2026-09-01', '07:30:00'), punch('2026-09-01', '17:05:00'),
    punch('2026-09-01', '17:40:00'), punch('2026-09-01', '20:05:00'),
  ]);
  assert.equal(check.start.time.slice(0, 5), '17:40', 'ไม่ใช่ 17:05 ที่ไกลกว่า');
  assert.equal(check.end.time.slice(0, 5), '20:05');
  assert.equal(check.state, SCAN_MATCH.OK);
});

test('สแกนที่ใกล้ที่สุดของฝั่งจบถูกยกมาเสมอ ไม่ว่าจะห่างแค่ไหน', () => {
  /**
   * ── ขอบของฝั่งจบถูกถอดออกเมื่อ 7 ก.ย. 2569 ────────────────────────────────
   *
   * เดิมมีขอบ 2 ชม. ครอบอยู่ แถวนี้จึงเคยขึ้นว่า `เวลาสิ้นสุด ไม่มีสแกนใกล้เคียง`
   * ทั้งที่บรรทัดใต้แถวเดียวกันพิมพ์ `สแกน 07:30 , 22:15` อยู่ — หน้าจอเถียงกันเอง
   * ด้วยเส้นที่คนอ่านมองไม่เห็น และ 22:15 หลุดขอบไปแค่ 15 นาที · ตระกูลเดียวกับ
   * บั๊ก 21:10 ข้างบน ซึ่งเคยแก้ด้วยการขยายขอบ แล้วมันก็กลับมากัดที่ขอบใหม่
   *
   * ระยะที่เกินสองชั่วโมงเขียนเป็น ชม./นาที เพราะ "135 นาที" อ่านเหมือนตัวเลขที่
   * เครื่องคิดไม่ออก ส่วนใต้สองชั่วโมงยังเป็นนาทีเหมือนเดิม — ถ้อยคำที่ฝ่ายบุคคล
   * อ่านอยู่แล้วจึงไม่มีอันไหนเปลี่ยน
   */
  const far = checkEntryAgainstScans(entry({ startTime: '17:00', endTime: '20:00' }), [
    punch('2026-09-01', '07:30:00'), punch('2026-09-01', '22:15:00'),
  ]);
  assert.equal(far.end.time.slice(0, 5), '22:15', 'ไม่ใช่ 07:30 และไม่ใช่ "ไม่มีสแกนใกล้เคียง"');
  assert.equal(far.state, SCAN_MATCH.OK, 'และตั้งแต่ 7 ก.ย. 2569 มันแปลว่าอยู่ครบ ไม่ใช่ไม่ตรง');
  assert.equal(far.startFinding, false, 'ฝั่งเริ่มยังเงียบเหมือนเดิม — คนอยู่ข้างในอยู่แล้ว');

  // ฝั่งที่ยังเตือน: ไกลเท่ากันแต่อยู่*ก่อน*เวลาเลิก — ระยะเขียนเป็น ชม./นาที
  const short = checkEntryAgainstScans(entry({ startTime: '17:00', endTime: '23:00' }), [
    punch('2026-09-01', '07:30:00'), punch('2026-09-01', '20:45:00'),
  ]);
  assert.equal(short.state, SCAN_MATCH.MISMATCH);
  assert.equal(short.end.time.slice(0, 5), '20:45');
  assert.equal(short.endShortMinutes, 135);
  assert.match(scanMismatchNote(short), /เวลาสิ้นสุด สแกน 20:45 · ขาดอีก 2 ชม\. 15 นาที/);
  assert.equal(scanBadgeLabel(short), 'ไม่ครบ · ขาด 2 ชม. 15 นาที');
});

test('ฝั่งจบหยิบสแกนที่ถึงเวลาเลิกแล้ว ไม่ใช่ตัวที่ใกล้ที่สุดเฉย ๆ', () => {
  /**
   * ── กฎ "ใกล้ที่สุด" อย่างเดียวใช้ไม่ได้แล้วเมื่อฝั่งจบกลายเป็นเรื่องทิศทาง ──
   *
   * วันที่สแกน 07:34 · 19:55 · 23:00 กับใบที่จบ 20:00 · ตัวที่ใกล้ที่สุดคือ 19:55
   * (ห่าง 5 นาที) แล้วแถวจะขึ้นว่าขาด 5 นาที ทั้งที่ 23:00 พิมพ์อยู่บนแถวเดียวกัน
   * และบอกว่าคนยังอยู่ต่ออีกสามชั่วโมง · "เวลาสแกนออกจริง" ของวันนั้นคือ 23:00
   */
  const check = checkEntryAgainstScans(entry({ startTime: '17:00', endTime: '20:00' }), [
    punch('2026-09-01', '07:34:00'), punch('2026-09-01', '19:55:00'),
    punch('2026-09-01', '23:00:00'),
  ]);
  assert.equal(check.end.time.slice(0, 5), '23:00');
  assert.equal(check.state, SCAN_MATCH.OK, 'อยู่ครบ ไม่ใช่ขาด 5 นาที');
  assert.equal(check.endShortMinutes, 0);
  assert.equal(scanBadgeLabel(check), 'เกินเวลา · เกิน 3 ชม.', 'และเป็นแถวเกินเวลา ไม่ใช่แถวไม่ครบ');
});

test('ระยะใต้สองชั่วโมงยังเป็นนาที — ถ้อยคำเดิมไม่ถูกเขียนใหม่', () => {
  const check = checkEntryAgainstScans(entry({ startTime: '17:00', endTime: '19:30' }), [
    punch('2026-09-01', '07:30:00'), punch('2026-09-01', '18:20:00'),
  ]);
  assert.match(scanMismatchNote(check), /เวลาสิ้นสุด สแกน 18:20 · ขาดอีก 70 นาที/);
});

test('วินาทีถูกปัดลง ไม่ใช่ปัดขึ้น — 17:29:59 คือนาที 17:29', () => {
  // ปัดขึ้นจะทำให้สแกนที่ห่าง 15 นาที 1 วินาที กลายเป็นตรงพอดี ซึ่งเป็นเส้นที่
  // ขยับเองโดยไม่มีใครสั่ง
  const check = checkEntryAgainstScans(entry({ startTime: '17:30' }), [
    punch('2026-09-01', '17:14:59'), punch('2026-09-01', '20:00:00'),
  ]);
  assert.equal(check.start.diff, 16, 'ปัดขึ้นจะได้ 15 แล้วกลายเป็นตรงพอดี');

  /**
   * เส้นเดียวกัน วัดที่ฝั่งซึ่งค่ายอมรับยังตัดสินผลอยู่ · 17:14:59 ก่อนเวลาเริ่ม
   * จึงเงียบตามกฎทิศทาง (หมวด 1ก²) ระยะ 16 นาทียังคำนวณและยกมาโชว์เหมือนเดิม
   * แต่ไม่ได้เปลี่ยนคำตัดสินแล้ว — ตัวที่เปลี่ยนคือตัวที่อยู่หลังเวลาเริ่ม
   */
  const late = (time) => checkEntryAgainstScans(entry({ startTime: '17:30' }), [
    punch('2026-09-01', time), punch('2026-09-01', '20:00:00'),
  ]);
  assert.equal(late('17:45:59').start.diff, 15);
  assert.equal(late('17:45:59').state, SCAN_MATCH.OK);
  assert.equal(late('17:46:00').start.diff, 16);
  assert.equal(late('17:46:00').state, SCAN_MATCH.MISMATCH);
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
  assert.equal(check.startFinding, false, 'เวลาเริ่มไม่มีทางมีสแกน จึงไม่ถูกนับ');
  assert.equal(check.start, null);
  assert.equal(check.end.matched, true, 'ฝั่งที่เครื่องบันทึกได้จริงคือฝั่งเลิกโอที');
  assert.equal(scanMismatchNote(check), null);
  assert.equal(scanBadgeLabel(check), null, 'ไม่มีป้ายเวลาขาดบนแถวที่สแกนออกหลังเวลาเลิก');
  assert.equal(scanCheckInTime(check), '07:42', 'เวลาแรกตั้งแต่ 04:00 คือเวลาเข้างาน');
  assert.equal(dayPunchLine(check), '19:33', 'ที่เหลือยังโชว์ครบเหมือนเดิม');
});

test('แบบสองรอบที่ขอมา: สแกนเข้าก่อน 08:00 แล้วสแกนอีกทีตอนเลิก OT', () => {
  /**
   * รูปที่ขอมาเมื่อ 7 ก.ย. 2569 · *"สแกนเข้า < 08:00 น. และสแกนถัดไปเป็นเวลาออก
   * OT (โดยไม่มีสแกนตอน 17:00 น.)"* — ต้องจับคู่ฝั่งจบให้ถูกตัว และโชว์เวลาสแกน
   * ทั้งวันเสมอ เช่น "สแกน 07:34, 19:30" · เคยขึ้นป้ายเทา ไม่ได้สแกนเข้า OT
   * ด้วย จนถูกถอนออกเมื่อ 9 ก.ย. 2569 — ดูหมวด 1ข
   */
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:34:00'), punch('2026-09-01', '19:30:00')],
  );
  assert.equal(check.end.time.slice(0, 5), '19:30', 'สแกนถัดจากเช้าคือเวลาออก OT');
  assert.equal(check.state, SCAN_MATCH.OK, 'ถึงเวลาที่ขอพอดี = ครบ');
  assert.equal(scanBadgeLabel(check), null, 'ไม่มีป้ายส้ม');
  assert.equal(check.startFinding, false, 'และฝั่งเริ่มไม่มีอะไรจะพูด');
  assert.equal(scanCheckInTime(check), '07:34');
  assert.equal(dayPunchLine(check), '19:30');
});

test('แบบสี่รอบ (สแกน 17:00 และตอนเข้าโอทีด้วย) ก็ตรงตามปกติ', () => {
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:42:10'), punch('2026-09-01', '17:02:41'),
      punch('2026-09-01', '17:28:03'), punch('2026-09-01', '19:31:55')],
  );
  assert.equal(check.state, SCAN_MATCH.OK);
  assert.equal(check.start.matched, true, 'วันนี้มีสแกนใกล้เวลาเริ่มจริง จึงเทียบได้');
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
  assert.equal(check.startFinding, true);
  assert.match(scanMismatchNote(check), /เวลาเริ่ม สแกน 17:22 หลังเวลา 22 นาที/);
});

test('ไม่มีสแกนก่อนเวลาเริ่มเลย ยังเตือน — คนไม่ได้อยู่ข้างในมาก่อน', () => {
  // สแกนออกอย่างเดียวทั้งวัน ไม่ใช่รูปแบบปกติของที่นี่ และเป็นช่องว่างของหลักฐานจริง
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '19:33:00')],
  );
  assert.equal(check.state, SCAN_MATCH.MISMATCH);
  assert.equal(check.startFinding, true);
  assert.match(scanMismatchNote(check), /เวลาเริ่ม ไม่มีสแกนใกล้เคียง/);
});

test('ลืมสแกนตอนเลิกโอที ยังเตือน และเตือนข้างเดียวคือข้างที่มีความหมาย', () => {
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:42:10')],
  );
  assert.equal(check.state, SCAN_MATCH.MISMATCH);
  const note = scanMismatchNote(check);
  // ยกสแกนเช้ามาเป็นหลักฐานของฝั่งจบ พร้อมระยะที่อ่านออกว่า "ไม่มีสแกนตอนเลิกเลย"
  assert.match(note, /เวลาสิ้นสุด สแกน 07:42 · ขาดอีก 11 ชม\. 48 นาที — อาจลืมสแกนออก/);
  assert.ok(!/เวลาเริ่ม/.test(note), 'ไม่พูดถึงเวลาเริ่มบนวันที่คนอยู่ข้างในอยู่แล้ว');
  assert.equal(check.missingScanOut, true);
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
  assert.equal(check.start, null, 'สแกนตอนกลับบ้านไม่ถูกยกมาตอบฝั่งเริ่ม');
  assert.equal(check.startFinding, false, 'และไม่กลายเป็นข้อค้นพบเรื่องเวลาเริ่ม');
  /**
   * ── และตั้งแต่ 7 ก.ย. 2569 เกณฑ์ที่กันไว้คือ "ฝั่งจบยกตัวไหนมา" ไม่ใช่
   * "ฝั่งจบตรงไหม" ──
   *
   * เดิมกันเฉพาะสแกนที่ฝั่งจบ*ตรง*กับมัน · พอ 18:25 กลายเป็นขาด 5 นาที (ไม่ตรง
   * แล้ว) เกณฑ์เดิมจะปล่อยมันกลับไปให้ฝั่งเริ่ม แล้วแถวนี้จะขึ้นว่า `เวลาเริ่ม
   * สแกน 18:25 หลังเวลา 1 ชม. 25 นาที` เรื่องคนกำลังกลับบ้าน — บั๊ก 21:10 ซ้ำ
   */
  assert.equal(check.state, SCAN_MATCH.MISMATCH, 'ขาด 5 นาที และตอนนี้ 5 นาทีก็คือขาด');
  assert.equal(check.endShortMinutes, 5);
  assert.equal(scanMismatchDetail(check), 'เวลาสิ้นสุด สแกน 18:25 · ขาดอีก 5 นาที');
});

test('แต่ถ้าสแกนตัวเดียวนั้นใกล้ทั้งสองฝั่งจริง ก็ตอบได้ทั้งสองฝั่ง', () => {
  // ใบสั้นพอที่การเดินผ่านประตูครั้งเดียวจะตอบได้ทั้งคู่ — นั่นคือการอ่านที่ถูก
  // ไม่ใช่ความบังเอิญ จึงไม่ถูกตัดออกจากฝั่งเริ่ม
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '17:20' }),
    [punch('2026-09-01', '17:10:00')],
  );
  assert.equal(check.start.time.slice(0, 5), '17:10');
  assert.equal(check.start.matched, true, 'ฝั่งเริ่มยังใช้มันได้ ไม่ถูกกันออก');
  assert.equal(check.end.time.slice(0, 5), '17:10');
  // ฝั่งจบยังอ่านตามกฎของตัวเอง: 17:10 อยู่ก่อน 17:20 จึงขาด 10 นาที
  assert.equal(check.endShortMinutes, 10);
});

// ── 1ก². ก่อนเวลาเริ่ม = คนอยู่ข้างในแล้ว ไม่ว่าจะก่อนกี่นาที ────────────────
//
// ฝ่ายบุคคลตอบเมื่อ 4 ก.ย. 2569 ว่า **พักเที่ยงไม่ต้องสแกนนิ้ว** และ **ไม่มีกะดึก**
// วันหนึ่งจึงมีสองรอบหรือสี่รอบ และสองรอบกลางคือตอนเลิกงาน 17:00 กับตอนเข้ามาทำ
// โอที — ไม่ใช่พักเที่ยง · เกณฑ์ฝั่งเริ่มจึงเปลี่ยนจาก "มีสแกนใกล้ไหม" เป็น
// "สแกนอยู่ก่อนหรือหลังเวลาที่ใบอ้าง" ซึ่งอ่านได้โดยไม่ต้องรู้ว่าครั้งไหนเข้าครั้งไหนออก

test('ใบ 18:00 บนวันสแกนสี่รอบ: 17:35 อยู่ก่อนเวลาเริ่ม = เดินกลับเข้ามา ไม่ใช่ข้อผิด', () => {
  /**
   * เกณฑ์เดิม (`!start && ...`) เงียบเฉพาะวันสองรอบ เพราะวันสี่รอบมีสแกนใกล้
   * เวลาเริ่มเสมอ — ใบนี้เคยรายงาน `เวลาเริ่ม สแกน 17:35 ก่อนเวลา 25 นาที`
   * ทั้งที่คนอยู่ข้างในมาตั้งแต่ 17:35 คือเสียงรบกวน 25 จาก 27 แถวในรูปใหม่
   */
  const check = checkEntryAgainstScans(
    entry({ startTime: '18:00', endTime: '20:00' }),
    [punch('2026-09-01', '07:21:00'), punch('2026-09-01', '17:02:00'),
      punch('2026-09-01', '17:35:00'), punch('2026-09-01', '20:05:00')],
  );
  assert.equal(check.state, SCAN_MATCH.OK);
  assert.equal(check.startFinding, false, 'สแกนก่อนเวลาเริ่มไม่ใช่ข้อค้นพบ');
  assert.equal(check.end.diff, 5);
  assert.equal(scanMismatchNote(check), null);
});

test('แถวนั้นเงียบทั้งแถว — ป้ายเทาที่เคยยืนตรงนี้ถูกถอนเมื่อ 9 ก.ย. 2569', () => {
  const check = checkEntryAgainstScans(
    entry({ startTime: '18:00', endTime: '20:00' }),
    [punch('2026-09-01', '07:21:00'), punch('2026-09-01', '17:35:00'),
      punch('2026-09-01', '20:05:00')],
  );
  assert.equal(check.startFinding, false, 'ตอน 18:00 ไม่มีใครแตะประตู และนั่นคือเรื่องปกติ');
  assert.equal(scanBadgeLabel(check), null, 'จึงไม่มีป้ายไหนเหลืออยู่บนแถวนี้');
});

test('ไกลแค่ไหนไม่สำคัญ — สแกน 07:21 กับใบที่เริ่ม 21:00 ก็ยังคือคนอยู่ข้างใน', () => {
  // ทิศ ไม่ใช่ระยะ · ไม่มีกะดึกจึงไม่มีการอ่านแบบอื่นที่ทำให้สแกนก่อนเวลาเริ่ม
  // แปลว่าคนอยู่ข้างนอก
  const check = checkEntryAgainstScans(
    entry({ startTime: '21:00', endTime: '23:00' }),
    [punch('2026-09-01', '07:21:00'), punch('2026-09-01', '23:04:00')],
  );
  assert.equal(check.state, SCAN_MATCH.OK);
  assert.equal(check.startFinding, false);
});

test('แต่สแกนหลังเวลาเริ่มยังเตือน แม้วันนั้นจะมีสแกนก่อนหน้าด้วย', () => {
  // ประตูขยับตอนที่โอทีควรจะเดินอยู่แล้ว — อันนี้ขัดกันจริง จึงยังยกมาพูด
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:21:00'), punch('2026-09-01', '17:40:00'),
      punch('2026-09-01', '19:33:00')],
  );
  assert.equal(check.state, SCAN_MATCH.MISMATCH);
  assert.equal(check.startFinding, true);
  assert.match(scanMismatchNote(check), /เวลาเริ่ม สแกน 17:40 หลังเวลา 40 นาที/);
});

test('กลับบ้านตอนเที่ยง ไม่ได้อยู่ทำโอที — ยังจับได้จากฝั่งจบ', () => {
  // กฎใหม่ปิดเสียงฝั่งเริ่ม ไม่ได้ปิดเสียงทั้งแถว: ฝั่งจบยังเป็นคำตอบอยู่
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:42:10'), punch('2026-09-01', '12:10:00')],
  );
  assert.equal(check.state, SCAN_MATCH.MISMATCH);
  // และตั้งแต่ 7 ก.ย. 2569 บอกด้วยว่าเห็นอะไร: 12:10 คือหลักฐานว่าเขากลับไปแล้ว
  // ซึ่งเป็นคำตอบที่ตรงกว่า "ไม่มีสแกนใกล้เคียง" มาก ทั้งที่ 12:10 พิมพ์อยู่บนแถวนั้น
  assert.match(scanMismatchNote(check), /เวลาสิ้นสุด สแกน 12:10 · ขาดอีก 7 ชม\. 20 นาที/);
  assert.equal(check.missingScanOut, true, 'ประตูไม่ขยับอีกเลยหลัง 17:00 — คือรูปลืมสแกนออก');
});

// ── 1ข. ป้าย `ไม่ได้สแกนเข้า OT` ถูกถอนออก — 9 ก.ย. 2569 ──────────────────
//
// หมวดนี้เคยมีเทสต์หกตัวคุมป้ายเทาที่ขอมาเมื่อ 4 ก.ย. 2569 ตอนบ่าย หลังจากที่
// คำตัดสินเงียบไปแล้ว: *"แสดง Badge/Flag Warning … ไม่ได้สแกนเข้า OT"* — ฝ่าย
// บุคคลถอนออกเมื่อ 9 ก.ย. 2569 ด้วยเหตุผลเดียวกับที่ tooltip ของป้ายเขียนไว้เอง
// ตั้งแต่วันแรก: **ปกติพนักงานก็ไม่สแกนกันอยู่แล้ว** ป้ายจึงขึ้น 25 จาก 27 แถว
// และไม่ได้บอกอะไรเกี่ยวกับแถวที่คนกำลังอ่านอยู่
//
// สีเทาคือความพยายามทำให้ป้ายที่ขึ้นเกือบทุกแถวราคาถูกพอจะเก็บไว้ได้ ซึ่งไม่พอ —
// คอลัมน์ป้ายชื่อที่เหมือนกันทุกแถวถูกอ่านครั้งเดียวแล้วข้ามตลอดไป
//
// `missingOtStart` ก็หายไปด้วย เพราะมันมีไว้เลี้ยงป้ายนั้นอย่างเดียว · สิ่งที่
// **ไม่**ขยับคือคำตัดสิน ประโยค และตัวเลขทุกตัว: ความเงียบฝั่งเวลาเริ่มที่สร้างไว้
// ในหมวด 1ก ยังอยู่ครบ และเทสต์ในหมวดนั้นคือสิ่งที่คุ้มกันมันอยู่ตอนนี้
//
// อย่าสร้างใหม่โดยไม่ถาม — แถวกลุ่มนี้ถูกติดป้ายมาสองครั้งและถอดออกสองครั้งแล้ว

test('ไม่มีป้ายฝั่งเวลาเริ่มเหลือบนแถวสองรอบ — ผลเทียบไม่มีธงให้วาดแล้ว', () => {
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:42:10'), punch('2026-09-01', '19:33:05')],
  );
  assert.equal(check.state, SCAN_MATCH.OK, 'ยังไม่ใช่แถวที่ต้องไปตรวจ');
  assert.equal(check.startFinding, false, 'และฝั่งเริ่มก็ยังไม่ใช่ข้อค้นพบ');
  assert.equal(scanBadgeLabel(check), null, 'ไม่มีป้ายใดเหลือบนแถวนี้');
  assert.equal('missingOtStart' in check, false, 'ธงที่เลี้ยงป้ายเทาถูกถอนไปพร้อมป้าย');
  // สิ่งที่เหลือให้คนอ่านตัดสินเอง คือเวลาสแกนดิบของวันนั้น
  assert.equal(scanCheckInTime(check), '07:42');
  assert.equal(dayPunchLine(check), '19:33');
});

// ── 1ค. เกินเวลา — ขอโอทีมาน้อยกว่าที่ทำจริง ────────────────────────────────
//
// ฝ่ายบุคคลให้คำสี่คำมาเมื่อ 7 ก.ย. 2569 พร้อมนิยาม: **เกินเวลา** (ขอมาน้อยกว่า
// ที่ทำจริง) · **ไม่ครบ** (ขอมามากกว่าที่ทำจริง) · **ไม่ตรง** (ไม่มีสแกนแต่ยื่นใบ)
// · และ **เหมารายวัน** · พร้อมคำตอบว่าเกินเวลาคือ *ข้อเท็จจริง ป้ายเทา ไม่นับกอง
// ที่ต้องตรวจ* และเส้นแบ่งอยู่ที่ *เกิน 30 นาที (เท่าบล็อก OT)*
//
// สองอย่างที่เทสต์หมวดนี้ปกป้อง: เกินเวลา**ไม่ใช่**คำเตือน (คำตัดสินยังเป็น OK
// และไม่เข้ากองที่ต้องตรวจ) และมันไม่ขึ้นบนแถวที่มีอะไรให้ทำอยู่แล้ว

test('ป้ายทั้งสี่ใช้คำของฝ่ายบุคคล ไม่ใช่คำของเราเอง', () => {
  assert.equal(SCAN_BADGE.SHORT, 'ไม่ครบ');
  assert.equal(SCAN_BADGE.OVER, 'เกินเวลา');
  assert.equal(SCAN_BADGE.NO_SCAN, 'ไม่ตรง');
  // คำที่ห้าไม่ใช่ของฝ่ายบุคคล และตั้งใจให้ยาวกว่า — มันคือฝั่งเวลาเริ่มโดยเฉพาะ
  // ถ้าเรียกมันว่า "ไม่ตรง" จะชนกับคำที่แปลว่า "ไม่มีสแกนเลย" เต็ม ๆ
  assert.equal(SCAN_BADGE.START_OFF, 'เวลาเริ่มไม่ตรงกับสแกน');
});

test('เส้นแบ่งเกินเวลาอยู่ที่หนึ่งบล็อก OT — 29 นาทีเงียบ 30 นาทีขึ้น', () => {
  /**
   * ใต้ 30 นาทีคือเวลาที่ต่อให้ยื่นขอมาก็คิดเป็น OT ไม่ได้ (`floor/30`) การไป
   * ชี้ว่ามีนาทีเหล่านั้นอยู่จึงเป็นการชี้ไปที่สิ่งที่ไม่มีใบไหนพกได้ · และถ้าไม่มี
   * เส้นเลย ป้ายนี้จะขึ้นแทบทุกแถว เพราะไม่มีใครแตะประตูตรงนาทีที่ใบจบพอดี
   */
  const over = (time) => checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '20:00' }),
    [punch('2026-09-01', '07:30:00'), punch('2026-09-01', time)],
  );
  assert.equal(over('20:29:00').overTime, false, '29 นาที = ไม่ถึงหนึ่งบล็อก');
  assert.equal(scanBadgeLabel(over('20:29:00')), null);
  assert.equal(over('20:30:00').overTime, true);
  assert.equal(scanBadgeLabel(over('20:30:00')), 'เกินเวลา · เกิน 30 นาที');
  // ระยะยังรายงานครบทุกขนาด แม้แถวที่ไม่ได้ติดป้าย — ป้ายคือการตัดสินใจว่าจะพูด
  assert.equal(over('20:29:00').endOverMinutes, 29);
});

test('เกินเวลาไม่ขึ้นบนแถวที่มีข้อค้นพบฝั่งเวลาเริ่มอยู่แล้ว', () => {
  // แถวที่กำลังขอให้ไปดูอยู่แล้ว ไม่ต้องมีป้ายที่สองมาบอกว่าการดูเป็นทางเลือก
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:21:00'), punch('2026-09-01', '17:40:00'),
      punch('2026-09-01', '21:00:00')],
  );
  assert.equal(check.startFinding, true);
  assert.equal(check.endOverMinutes, 90, 'ข้อเท็จจริงยังคำนวณไว้');
  assert.equal(check.overTime, false, 'แต่ไม่ติดป้าย');
  assert.equal(scanBadgeLabel(check), 'เวลาเริ่มไม่ตรงกับสแกน');
});

test('ใบเหมารายวันไม่ได้ป้ายเกินเวลา — ป้ายเขียวคือคำตอบของแถวนั้นแล้ว', () => {
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30', flatDaily: true }),
    [punch('2026-09-01', '07:42:00'), punch('2026-09-01', '21:00:00')],
  );
  assert.equal(check.endOverMinutes, 90, 'ระยะยังคำนวณไว้ให้อ่านได้');
  assert.equal(check.overTime, false, 'แต่ธงไม่ถูกยกบนแถวเหมา');
  assert.equal(scanBadgeLabel(check), null, 'และไม่มีป้ายไหนวาดบนแถวเหมา');
});

test('เดือนหนึ่งนับแถวเกินเวลาแยกกอง ไม่ปนกับกองที่ต้องตรวจ', () => {
  const row = (punches, over = {}) => ({
    scanCheck: checkEntryAgainstScans(
      entry({ startTime: '17:00', endTime: '19:30', ...over }), punches,
    ),
    ...over,
  });
  const counts = summariseScanChecks([
    // เกินเวลา 1 ชม. — คำตัดสิน OK จึงไม่เข้ากอง mismatch
    row([punch('2026-09-01', '07:30:00'), punch('2026-09-01', '20:30:00')]),
    // ไม่ครบ 30 นาที — กองที่ต้องตรวจ
    row([punch('2026-09-01', '07:30:00'), punch('2026-09-01', '19:00:00')]),
    // ไม่ตรง — ไม่มีสแกนเลย
    row([]),
  ]);
  assert.deepEqual(counts, {
    mismatch: 1, short: 1, startOff: 0, noScan: 1, flatDaily: 0, checked: 3, overTime: 1,
  });
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

test('ใบเหมารายวันไม่พูดเรื่องเวลาขาดเลย — ไม่ว่าสแกนจะออกมาแบบไหน', () => {
  /**
   * ── รอบสาม และรอบนี้ตัดประโยคทิ้ง ไม่ได้เปลี่ยนสี ────────────────────────
   *
   * รอบแรก (4 ก.ย.) อ่านว่า "เตือน แต่ติดป้ายว่าเหมา" · รอบสองวันเดียวกัน
   * กลับเป็นป้ายเขียว แต่*เก็บตัวเลขไว้ต่อท้าย* ด้วยเหตุผลว่า "70 นาที ก็ยัง
   * น่ารู้" · รอบสาม (7 ก.ย.) แจ้งมาเป็นบั๊ก และมันเป็นบั๊กจริง — แถวเดียวกัน
   * พูดสองประโยคที่ค้านกันเอง: ครึ่งแรกบอกว่าเวลาบนใบไม่ใช่ข้อกล่าวอ้างที่
   * เครื่องจะมาวัดว่าขาดได้ ครึ่งหลังวัดว่าขาดไปกี่นาที
   *
   * **ไม่มีการตัดเวลา** คือทั้งหมดของกฎ — แปดชั่วโมงไม่ถูกหักด้วยอะไรที่เครื่อง
   * บันทึกไว้ จึงไม่มี "เวลาขาด" ให้พูดถึงตั้งแต่แรก
   */
  const check = checkEntryAgainstScans(
    entry({ flatDaily: true }),
    [punch('2026-09-01', '17:28:00'), punch('2026-09-01', '18:50:00')],
  );
  assert.equal(check.flatDaily, true);
  assert.equal(check.endShortMinutes, 70, 'การเทียบยังทำอยู่ — ที่ตัดออกคือการพูดถึงมัน');
  assert.equal(scanBadgeLabel(check), null, 'ป้ายส้มไม่ขึ้นบนใบเหมา ไม่ว่าผลเทียบจะเป็นอะไร');
  assert.equal(scanMismatchDetail(check), null, 'และไม่มีบรรทัดตัวเลขต่อท้ายด้วย');
  assert.equal(scanMismatchNote(check), null, 'tooltip ก็ไม่มี — ป้ายเขียวใช้ประโยคของตัวเอง');
});

test('ใบเหมาที่อยู่เกินเวลา ก็ไม่พูดเหมือนกัน — วันที่ไม่ได้อ้างความยาวไว้ ไม่มีอะไรให้เกิน', () => {
  const check = checkEntryAgainstScans(
    entry({ flatDaily: true, startTime: '08:00', endTime: '17:00' }),
    [punch('2026-09-01', '07:58:00'), punch('2026-09-01', '19:40:00')],
  );
  assert.equal(check.overTime, false);
  assert.equal(scanMismatchDetail(check), null);
  assert.equal(scanBadgeLabel(check), null);
});

test('ใบเหมาทั้งสามแบบที่ฝ่ายบุคคลบอกมา เงียบเหมือนกันหมด', () => {
  /**
   * ฝ่ายบุคคลระบุสามแบบเมื่อ 4 ก.ย. 2569: **ไม่ได้สแกนนิ้ว · สแกนออกก่อนเวลา ·
   * สแกนเข้าแต่ไม่ได้สแกนออก** — คำตอบของทั้งสามแบบคืออันเดียวกัน คือใบยังได้
   * 8 ชั่วโมงตามเดิม และไม่มีใครต้องทำอะไร
   *
   * **เทสต์นี้เคยตรวจว่าทั้งสามแบบ*พูด*เหมือนกัน ตอนนี้ตรวจว่าทั้งสามแบบ*เงียบ*
   * เหมือนกัน** (7 ก.ย. 2569) · ประโยคเดิมขึ้นต้นด้วยกฎเหมาแล้วต่อท้ายด้วยระยะ
   * ที่ขาด ซึ่งอ่านแล้วค้านกันเอง — ดูเทสต์ข้างบน · แถวยังพิมพ์เวลาสแกนของวันนั้น
   * อยู่ (`dayPunchLine`) หลักฐานไม่ได้หายไปไหน หายไปแค่การคิดเลขกับมัน
   */
  const flat = (punches) => checkEntryAgainstScans(
    entry({ flatDaily: true, startTime: '08:00', endTime: '17:00' }), punches,
  );

  const cases = {
    'ไม่ได้สแกนนิ้วเลย': flat([]),
    'สแกนออกก่อนเวลา': flat([punch('2026-09-01', '07:58:00'), punch('2026-09-01', '15:40:00')]),
    'สแกนเข้าแต่ไม่ได้สแกนออก': flat([punch('2026-09-01', '07:58:00')]),
  };

  for (const [name, check] of Object.entries(cases)) {
    assert.equal(scanMismatchNote(check), null, `${name}: ต้องไม่มีประโยคเตือนเลย`);
    assert.equal(scanMismatchDetail(check), null, `${name}: และไม่มีบรรทัดตัวเลขด้วย`);
    assert.equal(scanBadgeLabel(check), null, `${name}: และไม่มีป้าย`);
  }

  // สิ่งที่ยังเหลืออยู่บนแถวคือเวลาสแกนดิบ ๆ ของวันนั้น ให้คนอ่านตรวจเอง
  assert.equal(scanCheckInTime(cases['สแกนออกก่อนเวลา']), '07:58');
  assert.equal(dayPunchLine(cases['สแกนออกก่อนเวลา']), '15:40');
  assert.equal(dayPunchLine(cases['ไม่ได้สแกนนิ้วเลย']), null, 'วันที่ไม่มีสแกน ก็ไม่มีอะไรให้พิมพ์');
  assert.equal(scanCheckInTime(cases['ไม่ได้สแกนนิ้วเลย']), null);
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
  assert.match(early, /เวลาสิ้นสุด สแกน 18:50 · ขาดอีก 70 นาที/);

  const late = scanMismatchDetail(checkEntryAgainstScans(entry(), [
    punch('2026-09-01', '17:28:00'), punch('2026-09-01', '20:40:00'),
  ]));
  assert.match(late, /เวลาสิ้นสุด สแกน 20:40 · หลังเวลาที่ขอ 40 นาที/);

  // ฝั่งเวลาเริ่มยังพูดด้วยคำว่า ก่อนเวลา / หลังเวลา เหมือนเดิมทุกตัวอักษร
  const startOff = scanMismatchDetail(checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '19:30' }),
    [punch('2026-09-01', '07:21:00'), punch('2026-09-01', '17:40:00'),
      punch('2026-09-01', '19:33:00')],
  ));
  assert.match(startOff, /เวลาเริ่ม สแกน 17:40 หลังเวลา 40 นาที/);

  for (const text of [early, late, startOff]) {
    assert.ok(!/สแกนเข้า|สแกนออก/.test(text), 'ห้ามอ้างว่าเป็นการสแกนเข้าหรือสแกนออก');
  }
});

test('ใบปกติที่เวลาไม่ครบ ยังนำด้วยคำว่าไม่ตรงเหมือนเดิม', () => {
  // ครึ่งที่ต้องไม่ขยับตามการกลับด้านข้างบน
  const note = scanMismatchNote(checkEntryAgainstScans(entry(), [
    punch('2026-09-01', '17:28:00'), punch('2026-09-01', '18:50:00'),
  ]));
  assert.match(note, /^เวลาไม่ตรงกับไฟล์สแกนนิ้ว/);
  assert.ok(!/เหมารายวัน/.test(note));

  // และแถวเกินเวลานำด้วยประโยคของตัวเอง ไม่ใช่ประโยคของแถวที่ต้องไปแก้
  const over = scanMismatchNote(checkEntryAgainstScans(entry(), [
    punch('2026-09-01', '17:28:00'), punch('2026-09-01', '20:40:00'),
  ]));
  assert.match(over, /^ทำงานเกินเวลาที่ขอ OT มา/);
  assert.match(over, /ชั่วโมงคิดตามใบที่ยื่น ไม่ได้บวกเพิ่มให้/, 'ต้องตอบคำถามถัดไปว่านาทีพวกนั้นได้เงินไหม');
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
    { time: '07:21', next: false, checkIn: true, early: false },
    { time: '19:30', next: false, checkIn: false, early: false },
  ]);
  assert.equal(scanCheckInTime(check), '07:21');
  assert.equal(dayPunchLine(check), '19:30');
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
  assert.equal(scanCheckInTime(ok), '17:28', 'เวลาแรกของวันนี้อยู่หลัง 04:00 อยู่แล้ว');
  assert.equal(dayPunchLine(ok), '20:04');
});

test('ใบข้ามคืน: สแกนของเช้าวันรุ่งขึ้นติด (+1) ไว้', () => {
  // 02:04 ปนอยู่ในรายการเวลาเย็น โดยไม่มีอะไรกำกับ จะอ่านเป็นเช้ามืดของวันผิด
  const check = checkEntryAgainstScans(
    entry({ startTime: '22:00', endTime: '02:00', endsNextDay: true }),
    [punch('2026-09-01', '21:55:00'), punch('2026-09-02', '02:04:00')],
  );
  assert.deepEqual(check.dayPunches, [
    { time: '21:55', next: false, checkIn: true, early: false },
    // เช้ามืดของ *วันรุ่งขึ้น* ไม่ใช่เวลาก่อน 04:00 ของวันนี้ — ใบข้ามคืนไม่เสียเวลาไหนไป
    { time: '02:04', next: true, checkIn: false, early: false },
  ]);
  assert.equal(scanCheckInTime(check), '21:55', '02:04 เป็นเช้าวันรุ่งขึ้น ไม่ใช่เวลาเริ่มของแถวนี้');
  assert.equal(dayPunchLine(check), '02:04 (+1)');
});

test('วันที่ไม่มีสแกนเลย ไม่มีบรรทัดเวลาให้โชว์', () => {
  const none = checkEntryAgainstScans(entry(), []);
  assert.deepEqual(none.dayPunches, []);
  assert.equal(dayPunchLine(none), null);
  assert.equal(dayPunchLine(null), null);
});

// ── เวลาเริ่ม — เวลาแรกตั้งแต่ 04:00 น. เป็นต้นไป (9 ก.ย. 2569) ──────────────
//
// *"เวลาที่จากเครื่องสแกนที่แสดง ให้แสดงเฉพาะเวลาแรกหลัง 04.00 น. เป็นต้นไปนับเป็น
// เวลาเข้างาน"* — แถวที่ทำให้ขอมามีสแกนเช้าซ้ำสองครั้ง (07:55, 07:56) คนอ่านต้อง
// นั่งแยกเองว่าในสามเวลานั้นอันไหนคือเวลามาถึง
//
// นี่คือ **ครั้งเดียว** ที่โมดูลนี้ยอมเรียกชื่อการสแกน — และไม่มีคำตัดสิน ชั่วโมง
// หรือป้ายใดอ่านค่านี้ · เวลาที่เหลือของวันยังพิมพ์อยู่ข้าง ๆ ตามเดิม เพื่อให้คนที่
// คิดว่าป้ายอ่านวันผิด เห็นเวลาดิบทั้งหมดบนแถวเดียวกันแล้วเถียงได้
//
// **ป้ายชื่อเปลี่ยนคำเป็น `เริ่ม` และเวลาก่อน 04:00 หลุดจากบรรทัดไปเมื่อ 10 ก.ย.
// 2569** — สี่เคสข้างล่างนี้เขียนไว้ตอนที่มันยังพิมพ์อยู่ ตัวเลขที่คาดหวังจึงเปลี่ยน
// ตามไปด้วย เหตุผลอยู่ที่ `early` ใน `checkEntryAgainstScans`

test('สแกนเช้าซ้ำสองครั้ง — ครั้งแรกคือเวลาเริ่ม ที่เหลือยังโชว์ครบ', () => {
  const check = checkEntryAgainstScans(
    entry({ startTime: '17:00', endTime: '22:55' }),
    [punch('2026-09-01', '07:55:12'), punch('2026-09-01', '07:56:03'),
      punch('2026-09-01', '22:56:40')],
  );
  assert.equal(scanCheckInTime(check), '07:55');
  assert.equal(dayPunchLine(check), '07:56, 22:56', 'ครั้งที่ซ้ำและเวลาเย็นไม่ได้หายไปไหน');
});

test('สแกนก่อน 04:00 น. ไม่ใช่เวลาเริ่ม — และไม่อยู่ในบรรทัดแล้ว', () => {
  // เช้ามืดคือคนกำลัง *ออก* จากโอทีของเย็นวันก่อน · ที่นี่ไม่มีกะดึก (4 ก.ย. 2569)
  // เดิมบรรทัดนี้อ่านว่า `01:12, 22:56` — คือหลักฐานของแถวเมื่อวานมาเบียดแถวนี้
  const check = checkEntryAgainstScans(entry({ startTime: '17:00', endTime: '22:55' }), [
    punch('2026-09-01', '01:12:00'), punch('2026-09-01', '07:55:00'),
    punch('2026-09-01', '22:56:00'),
  ]);
  assert.equal(scanCheckInTime(check), '07:55', 'ข้าม 01:12 ไปหาเวลาแรกตั้งแต่ 04:00');
  assert.equal(dayPunchLine(check), '22:56', '01:12 เป็นของคืนก่อน ไม่ใช่ของแถวนี้');
  assert.deepEqual(
    check.dayPunches.filter((p) => p.early).map((p) => p.time),
    ['01:12'],
    'ค่าดิบยังอยู่ในผลเทียบ — ที่หายไปคือบรรทัดที่พิมพ์ ไม่ใช่ข้อมูล',
  );
});

test('แถวเต็ม ๆ ที่ขอมา — เริ่ม 07:23 แล้วตามด้วยเวลาที่เหลือของวันทำงาน', () => {
  /**
   * รูปที่สั่งมาเมื่อ 10 ก.ย. 2569 เป็นแถวเดียวเทียบกันตรง ๆ
   *
   *   เดิม  `เข้างาน 07:23 · สแกน 00:59, 07:55, 17:37, 18:24, 20:11`
   *   ใหม่  `เริ่ม 07:23 - 07:55, 17:37, 18:24, 20:11`
   */
  const check = checkEntryAgainstScans(entry({ startTime: '17:30', endTime: '20:00' }), [
    punch('2026-09-01', '00:59:00'), punch('2026-09-01', '07:23:00'),
    punch('2026-09-01', '07:55:00'), punch('2026-09-01', '17:37:00'),
    punch('2026-09-01', '18:24:00'), punch('2026-09-01', '20:11:00'),
  ]);
  assert.equal(scanCheckInTime(check), '07:23');
  assert.equal(dayPunchLine(check), '07:55, 17:37, 18:24, 20:11');
});

test('เวลาก่อน 04:00 ที่แถวนี้ยกมาอ้างเอง ยังต้องอยู่บนบรรทัด', () => {
  /**
   * ประโยคบนแถวยกเวลาไหนมา คนอ่านต้องเห็นเวลานั้นบนแถวเดียวกัน (ดู `quotable`) —
   * ใบที่ยื่นตอนเช้ามืด (00:20–03:00 คือเคสที่ `quotable` มีไว้ตอบ) ตอบด้วยสแกน
   * พวกนี้พอดี ถ้าตัดทิ้งตามกฎเวลาก่อน 04:00 แถวจะเขียนว่า `เวลาสิ้นสุด สแกน
   * 02:40 …` เหนือรายการที่ไม่มี 02:40 อยู่เลย — บั๊กหลักฐานผิดของ 4 ก.ย. 2569
   * ในเสื้อตัวใหม่
   */
  const check = checkEntryAgainstScans(
    entry({ startTime: '00:20', endTime: '03:00' }),
    [punch('2026-09-01', '00:19:00'), punch('2026-09-01', '02:40:00')],
  );
  assert.equal(scanCheckInTime(check), null, 'ทั้งวันไม่มีสแกนตั้งแต่ 04:00 — ไม่มีชื่อให้ใคร');
  assert.equal(dayPunchLine(check), '00:19, 02:40', 'ทั้งคู่คือหลักฐานที่แถวนี้ใช้จริง');
});

test('วันที่มีแต่สแกนก่อน 04:00 น. เหลือเฉพาะเวลาที่แถวนี้ใช้', () => {
  const check = checkEntryAgainstScans(
    entry({ startTime: '22:00', endTime: '02:00', endsNextDay: true }),
    [punch('2026-09-01', '01:12:00'), punch('2026-09-01', '03:40:00')],
  );
  assert.equal(scanCheckInTime(check), null);
  assert.equal(dayPunchLine(check), '03:40', 'ฝั่งจบยก 03:40 มาอ้าง — 01:12 ไม่มีใครใช้');
});

test('04:00 น. พอดี นับเป็นเวลาเริ่ม — เส้นแบ่งอยู่ที่ 4 ชั่วโมงจากเที่ยงคืน', () => {
  assert.equal(SCAN_CHECK_IN_FLOOR_MINUTES, 4 * 60);
  const check = checkEntryAgainstScans(entry({ startTime: '05:00', endTime: '08:00' }), [
    punch('2026-09-01', '03:59:00'), punch('2026-09-01', '04:00:00'),
    punch('2026-09-01', '08:05:00'),
  ]);
  assert.equal(scanCheckInTime(check), '04:00');
  // 03:59 ตกอยู่ใต้เส้นทั้งสองด้าน: ไม่ได้เป็นเวลาเริ่ม และไม่ได้พิมพ์ต่อท้าย
  assert.equal(dayPunchLine(check), '08:05');
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
  assert.deepEqual(counts, {
    mismatch: 2, short: 0, startOff: 2, noScan: 1, flatDaily: 3, checked: 4, overTime: 0,
  });
});

test('เดือนที่ยังไม่ได้นำเข้าไฟล์สแกน ยังนับใบเหมาได้ — มันเป็นเรื่องของวิธียื่นใบ', () => {
  const counts = summariseScanChecks([
    { flatDaily: true }, { flatDaily: true }, {}, {},
  ]);
  assert.deepEqual(counts, {
    mismatch: 0, short: 0, startOff: 0, noScan: 0, flatDaily: 2, checked: 0, overTime: 0,
  });
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
  assert.deepEqual(summariseScanChecks(), {
    mismatch: 0, short: 0, startOff: 0, noScan: 0, flatDaily: 0, checked: 0, overTime: 0,
  });
  assert.deepEqual(summariseScanChecks([null, undefined]), {
    mismatch: 0, short: 0, startOff: 0, noScan: 0, flatDaily: 0, checked: 0, overTime: 0,
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
    ['dayPunches', 'end', 'endOverMinutes', 'endShortMinutes', 'flatDaily',
      'missingScanOut', 'overThreshold', 'overTime', 'punchCount',
      'start', 'startFinding', 'state', 'tolerance'],
  );
});
