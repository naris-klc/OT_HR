import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  needsOverCeilingReason, overCeilingRefusal, wasOverCeiling,
  OVER_CEILING_REASON_REQUIRED,
} from '../lib/caps.js';
import { overCeilingOf } from '../lib/accountingRows.js';

/**
 * ใบที่เกินเพดาน — signing one costs a sentence, and the sheet prints it.
 *
 * THE HOLE THIS CLOSED. ไม่อนุมัติ has demanded a reason from everybody since
 * it existed. อนุมัติ never has — and an entry carrying `capExceeded` is
 * exactly the one where that difference matters: the hours are past a limit
 * somebody set on purpose, they are on their way to payroll, and the only
 * record of why anybody thought that was all right was that a button had been
 * pressed. Two screens showed the flag (the queue and its pop-up) and both are
 * screens accounting never opens; by the time the month is being closed the
 * row has been signed and the flag is a boolean nobody is looking at.
 *
 * THREE QUESTIONS, AND THEY ARE NOT ONE QUESTION. Keeping them apart is most
 * of what this file is for:
 *
 *   needsOverCeilingReason  — must the person deciding this say why?
 *   wasOverCeiling          — did this ever go past a ceiling, waiver or not?
 *   overCeilingOf           — what does the accounting sheet print about it?
 *
 * The first says NO on a waived entry and the second says YES, and that is
 * deliberate on both counts: the exception has already been granted in writing,
 * so the next signer is not asked to re-decide it — but the hours really were
 * over the limit, and a sheet that stopped saying so the moment somebody
 * waived it would hide exactly the rows accounting is checking for.
 *
 * NO SECOND BOOLEAN. `isOverCeiling` was asked for and is not here:
 * `capExceeded` has meant precisely that since the ceiling existed and a dozen
 * screens, reports and tests read it. Two booleans for one idea are two
 * booleans that will one day disagree with nobody able to say which is right.
 * The case at the end of this file is what keeps it that way.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
/** Code with its comments out — a ban proves nothing against a paragraph. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const flagged = (over = {}) => ({
  workDate: '2026-08-05',
  totals: { otHours: 4.5 },
  capExceeded: true,
  capSnapshot: { breaches: [{ scope: 'month', capHours: 40, usedHoursBefore: 38 }] },
  ...over,
});

const ordinary = { workDate: '2026-08-06', totals: { otHours: 3 }, capExceeded: false };

// ── who has to explain themselves ───────────────────────────────────────────

test('ใบที่ติดธงเกินเพดาน ต้องมีเหตุผลทั้งตอนอนุมัติและตอนไม่อนุมัติ', () => {
  assert.equal(needsOverCeilingReason(flagged()), true);
  assert.equal(overCeilingRefusal(flagged(), '').ok, false);
  assert.equal(overCeilingRefusal(flagged(), '   ').ok, false, 'ช่องว่างล้วนไม่ใช่เหตุผล');
  assert.equal(overCeilingRefusal(flagged(), 'งานส่งลูกค้าเลื่อนไม่ได้').ok, true);
});

test('ใบธรรมดาไม่ถูกถามอะไรเพิ่ม — กฎนี้แตะเฉพาะใบที่เกินเพดาน', () => {
  assert.equal(needsOverCeilingReason(ordinary), false);
  assert.equal(overCeilingRefusal(ordinary, '').ok, true, 'อนุมัติใบปกติต้องไม่ต้องพิมพ์อะไร');
  assert.equal(overCeilingRefusal(undefined, '').ok, true);
});

test('คำปฏิเสธเป็นข้อความเดียวกับที่จอพิมพ์ไว้เหนือช่องกรอก', () => {
  /**
   * ถ้าเซิร์ฟเวอร์ปฏิเสธด้วยประโยคหนึ่งแล้วจอบอกอีกประโยคหนึ่ง คนกดจะไม่รู้ว่า
   * สองอันนี้คือกฎเดียวกัน — ค่าคงที่ตัวเดียวคือสิ่งที่ทำให้มันเป็นกฎเดียวกันจริง
   */
  const refusal = overCeilingRefusal(flagged(), '');
  assert.equal(refusal.error, OVER_CEILING_REASON_REQUIRED);
  assert.equal(refusal.status, 400);
  assert.match(OVER_CEILING_REASON_REQUIRED, /เกินเพดาน OT ที่กำหนด/);
  assert.ok(
    read('components/ApprovalQueue.jsx').includes('OVER_CEILING_REASON_REQUIRED'),
    'จอต้องใช้ค่าคงที่ตัวเดียวกัน ไม่ใช่พิมพ์ประโยคซ้ำ',
  );
});

test('ใบที่ถูกยกเว้นเพดานแล้ว ไม่ถูกถามเหตุผลซ้ำอีก', () => {
  /**
   * ข้อยกเว้นถูกอนุมัติเป็นลายลักษณ์อักษรโดยฝ่ายบุคคลไปแล้ว การถามคนเซ็นคนถัดไป
   * อีกครั้งคือการให้เขาตัดสินเรื่องที่ไม่ใช่ของเขา และเหตุผลที่ได้มาก็จะเป็นแค่
   * การพูดซ้ำสิ่งที่ฝ่ายบุคคลเขียนไว้แล้ว
   */
  const waived = flagged({ capExceeded: false, capOverride: { reason: 'ฝ่ายผลิตขอเพิ่มเพดานเดือนนี้' } });
  assert.equal(needsOverCeilingReason(waived), false);
  assert.equal(overCeilingRefusal(waived, '').ok, true);
});

// ── สิ่งที่ใบรายงานบัญชีถาม ─────────────────────────────────────────────────

test('ใบที่ถูกยกเว้นแล้ว ยังนับว่าเคยเกินเพดานเสมอ — ธงถูกล้าง แต่เรื่องไม่ได้หายไป', () => {
  const waived = flagged({ capExceeded: false, capOverride: { reason: 'ฝ่ายผลิตขอเพิ่มเพดาน' } });
  assert.equal(wasOverCeiling(waived), true, 'นี่คือแถวที่บัญชีต้องเห็นที่สุด');
  // และหลักฐานที่รอดจากการยกเว้นมีสองทาง ทดสอบแยกกันเพราะแถวเก่าจะเหลือแค่ทางเดียว
  assert.equal(
    wasOverCeiling({ capExceeded: false, capOverride: { reason: 'ยกเว้นไว้' } }),
    true,
    'แถวเก่าก่อนมีเพดานรายสัปดาห์ ไม่มี breaches — เหลือแค่ตัวยกเว้นเป็นหลักฐาน',
  );
  assert.equal(
    wasOverCeiling({ capExceeded: false, capSnapshot: { breaches: [{ scope: 'week' }] } }),
    true,
    'breaches เขียนตอนยื่นและไม่มีอะไรไปล้าง',
  );
});

test('ใบปกติไม่ถูกนับว่าเกินเพดาน แม้จะเคยถูกตรวจแล้วผ่าน', () => {
  assert.equal(wasOverCeiling(ordinary), false);
  // ตรวจแล้วไม่เกิน = breaches ว่าง ซึ่งต่างจาก "ไม่ได้บันทึกไว้" (ไม่มีคีย์เลย)
  assert.equal(wasOverCeiling({ capExceeded: false, capSnapshot: { breaches: [] } }), false);
  assert.equal(wasOverCeiling({}), false);
  assert.equal(wasOverCeiling(null), false);
});

test('สรุปรายคน — นับเฉพาะชั่วโมงของใบที่เกิน ไม่ใช่ทั้งเดือนของคนนั้น', () => {
  /**
   * คนที่ทำ OT ปกติสี่กะแล้วมีคืนยาวหนึ่งคืน ตัวเลขที่ทูลทิปพูดถึงคือคืนนั้นคืนเดียว
   * ถ้าพูดยอดรวมทั้งแถว เท่ากับบอกว่าทั้งเดือนของเขาเกินเพดาน ซึ่งไม่จริง
   */
  const over = overCeilingOf([ordinary, flagged(), { ...ordinary, workDate: '2026-08-07' }]);
  assert.equal(over.count, 1);
  assert.equal(over.hours, 4.5, 'ไม่ใช่ 10.5 ซึ่งเป็นยอดรวมทั้งแถว');
  assert.equal(over.notes.length, 1);
});

test('เดือนที่ไม่มีใบเกินเพดานเลย ได้ศูนย์ที่จอไม่ต้องวาดอะไร', () => {
  assert.deepEqual(overCeilingOf([ordinary]), { count: 0, hours: 0, notes: [] });
  assert.deepEqual(overCeilingOf([]), { count: 0, hours: 0, notes: [] });
  assert.deepEqual(overCeilingOf(), { count: 0, hours: 0, notes: [] });
});

test('เหตุผลผู้อนุมัติกับการยกเว้นของฝ่ายบุคคล ถูกแยกกันเสมอ', () => {
  /**
   * เป็นคนละคนตัดสิน คนละคำถาม — หัวหน้าบอกว่าทำไมถึงส่งใบที่เกินเพดานขึ้นไป
   * ฝ่ายบุคคลบอกว่าทำไมถึงยอมให้เพดานถูกข้าม ถ้ารวมเป็นลิสต์เดียวกัน คำของ
   * ฝ่ายบุคคลจะไปอยู่ใต้ชื่อหัวหน้า
   */
  const both = flagged({
    overCeilingReason: 'ลูกค้าเลื่อนส่งของไม่ได้',
    capOverride: { reason: 'ฝ่ายผลิตขอเพิ่มเพดานเดือนสิงหาคม' },
  });
  const [note] = overCeilingOf([both]).notes;
  assert.equal(note.reason, 'ลูกค้าเลื่อนส่งของไม่ได้');
  assert.equal(note.waivedReason, 'ฝ่ายผลิตขอเพิ่มเพดานเดือนสิงหาคม');
  assert.equal(note.waived, true);
  assert.equal(note.workDate, '2026-08-05');
  assert.equal(note.hours, 4.5);
});

test('ใบเก่าที่อนุมัติไปก่อนมีกฎนี้ ยังถูกนับและยังขึ้นสีแดง — แค่ไม่มีเหตุผล', () => {
  /**
   * ตัดทิ้งไม่ได้ ไม่งั้นครึ่งเดือนที่เก่ากว่าจะหายไปจากรายงานเงียบ ๆ
   * `reason: null` คือสิ่งที่จอเอาไปพิมพ์ว่า "ไม่ได้บันทึกเหตุผลไว้"
   */
  const [note] = overCeilingOf([flagged()]).notes;
  assert.equal(note.reason, null);
  assert.equal(note.waivedReason, null);
  assert.equal(note.waived, false);
  assert.match(
    read('components/AccountingView.jsx'),
    /ไม่ได้บันทึกเหตุผลไว้/,
    'ช่องว่างหลังเครื่องหมายทวิภาคอ่านเหมือนเหตุผลที่โหลดไม่ขึ้น',
  );
});

// ── ทั้งสองเราต์บังคับกฎเดียวกัน ────────────────────────────────────────────

test('อนุมัติ: ปฏิเสธถ้าไม่มีเหตุผล และเก็บเหตุผลลงใบ', () => {
  const code = strip(read('app/api/entries/[id]/approve/route.js'));
  assert.match(code, /const over = overCeilingRefusal\(entry, note\);/);
  assert.match(code, /if \(!over\.ok\) return fail\(over\.error, over\.status\);/);
  assert.match(code, /if \(needsOverCeilingReason\(entry\)\) entry\.overCeilingReason = String\(note\)\.trim\(\);/);
  // ลำดับสำคัญ: คนที่เซ็นใบนี้ไม่ได้อยู่แล้ว ต้องถูกบอกแบบนั้น ไม่ใช่ถูกขอเหตุผล
  // ของการตัดสินใจที่เขาทำไม่ได้
  assert.ok(
    code.indexOf('if (!may.ok)') < code.indexOf('const over = overCeilingRefusal'),
    'ต้องตรวจสิทธิ์ก่อนขอเหตุผล',
  );
});

test('ไม่อนุมัติ: ใช้กฎเดียวกัน และเก็บเหตุผลลงใบเหมือนกัน', () => {
  const code = strip(read('app/api/entries/[id]/reject/route.js'));
  assert.match(code, /const over = overCeilingRefusal\(entry, reason\);/);
  assert.match(code, /if \(needsOverCeilingReason\(entry\)\) entry\.overCeilingReason = reason;/);
  // เหตุผลของการไม่อนุมัติถูกบังคับมาตลอดอยู่แล้ว กฎเพดานจึงไม่เพิ่มอะไรที่นี่
  assert.match(code, /if \(!reason\) return fail\('กรุณาระบุเหตุผลที่ไม่อนุมัติ', 400\);/);
});

test('เหตุผลถูกบันทึกลงประวัติของใบด้วย ไม่ใช่แค่ฟิลด์เดียวที่เขียนทับได้', () => {
  /**
   * ฟิลด์ `overCeilingReason` ถูกเขียนทับได้ — ใบที่ผ่านหัวหน้าแล้วไปฝ่ายบุคคล
   * จะเหลือประโยคของคนเซ็นคนหลัง ส่วน `history` เก็บทีละขั้นและลบไม่ได้ ทั้งสอง
   * เราต์ส่งเหตุผลเข้า `entry.log()` อยู่แล้ว นี่คือสิ่งที่ตรึงไว้ว่ามันยังส่งอยู่
   */
  const approve = strip(read('app/api/entries/[id]/approve/route.js'));
  assert.match(approve, /entry\.log\(user, 'approve_mgr', note,/);
  assert.match(approve, /entry\.log\(user, 'approve_hr', note,/);
  const reject = strip(read('app/api/entries/[id]/reject/route.js'));
  assert.match(reject, /entry\.log\(user, 'reject_mgr', reason,/);
  assert.match(reject, /entry\.log\(user, 'reject_hr', reason,/);
});

// ── จอ ──────────────────────────────────────────────────────────────────────

test('ปุ่มยืนยันในกล่องกดไม่ได้จนกว่าจะพิมพ์เหตุผล และมีช่องเดียว', () => {
  const queue = strip(read('components/ApprovalQueue.jsx'));
  assert.match(queue, /const mustExplain = needsReason \|\| overCeiling;/);
  assert.match(queue, /const ready = !mustExplain \|\| why\.trim\(\)\.length > 0;/);
  assert.match(queue, /disabled=\{busy \|\| !ready\}/);
  assert.match(queue, /onClick=\{\(\) => onConfirm\(mustExplain \? why\.trim\(\) : null\)\}/);
  /**
   * ช่องเดียวสำหรับสองกฎ — คนคนเดียวตัดสินใจครั้งเดียว สองช่องบนแผ่นเดียวคือการ
   * ขอให้เขาพูดเรื่องเดิมสองรอบแล้วขัดกันเองในบันทึก
   *
   * นับเฉพาะใน `ConfirmModal` ไม่ใช่ทั้งไฟล์ — ไฟล์นี้มีกล่องอื่นที่มี textarea
   * ของตัวเองอยู่แล้ว (ไม่อนุมัติ, ยกเว้นเพดาน, แก้รายละเอียด) และการนับทั้งไฟล์
   * คือเทสต์ที่พังเพราะกล่องอื่นเปลี่ยน ไม่ใช่เพราะกล่องนี้เปลี่ยน
   */
  const confirmModal = queue.slice(
    queue.indexOf('function ConfirmModal('),
    queue.indexOf('function RejectModal('),
  );
  assert.ok(confirmModal.length > 200, 'หา ConfirmModal ไม่เจอ — เทสต์นี้กำลังตรวจของว่าง');
  assert.equal(
    (confirmModal.match(/<textarea/g) || []).length,
    1,
    'กล่องยืนยันต้องมีช่องกรอกเหตุผลช่องเดียว',
  );
});

test('ทางเข้าอนุมัติทุกทางผ่านกล่องเดียวกัน — ไม่มีทางลัดที่ยิงตรงโดยไม่มีเหตุผล', () => {
  /**
   * ปุ่ม อนุมัติ ใน รายละเอียด เคยเซ็นทันทีโดยไม่ส่ง note เลย ซึ่งตอนนี้จะโดน
   * 400 จากกฎใหม่ — และกล่องแดงไม่ใช่วิธีที่ดีในการบอกคนว่าต้องพิมพ์เหตุผล
   */
  const queue = strip(read('components/ApprovalQueue.jsx'));
  assert.match(queue, /if \(needsReason \|\| needsOverCeilingReason\(e\)\) setConfirming\(\[e\]\);/);
  assert.match(queue, /else approve\(\[e\]\);/);
});

test('กล่องบอกว่าเกินเพดานอะไรบ้าง ไม่ใช่แค่ว่ามีคนเกิน', () => {
  // เมื่อบังคับให้เขียนเหตุผล ก็ต้องให้ข้อมูลพอที่จะเขียนได้
  const queue = read('components/ApprovalQueue.jsx');
  assert.match(queue, /describeBreaches\(e\)\.map\(\(b\) => b\.text\)\.join\(' · '\)/);
});

test('ใบรายงานบัญชี — ตัวเลขแดง มีทูลทิป และมีข้อความเต็มในช่องหมายเหตุ', () => {
  const view = strip(read('components/AccountingView.jsx'));
  assert.match(view, /<OverCeilingFigure row=\{row\} \/>/);
  assert.match(view, /<OverCeilingNote over=\{row\.overCeiling\} \/>/);
  assert.match(view, /className="fig-over" title=\{tipTextOf\(over\)\}/);
  assert.match(view, /เหตุผลผู้อนุมัติ: \$\{n\.reason\}/, 'ทูลทิปต้องพูดตามรูปที่ขอไว้');
  // แดงเดียวกับที่คิวใช้ — ข้อเท็จจริงเดียวกันต้องใส่สีเดียวกันทั้งจอที่ตัดสิน
  // และจอที่รายงาน
  const css = read('app/styles.css');
  assert.match(css, /\.fig-over \{ color: var\(--danger-ink\); \}/);
  assert.match(read('components/ApprovalQueue.jsx'), /OVER_CAP = \{ color: 'var\(--danger-ink\)'/);
});

test('แถวปกติไม่มีสีและไม่มีทูลทิป — เดือนที่ถูกต้องต้องอ่านเหมือนเดิมทุกประการ', () => {
  const view = strip(read('components/AccountingView.jsx'));
  assert.match(view, /if \(!over\?\.count\) return <strong>\{cell\(row\.otHours\)\}<\/strong>;/);
  assert.match(view, /if \(!over\?\.count\) return null;/);
});

// ── ไม่มีบูลีนตัวที่สอง ─────────────────────────────────────────────────────

test('ไม่มี isOverCeiling ที่ไหนในซอร์ส — capExceeded คือฟิลด์นั้นอยู่แล้ว', () => {
  /**
   * บูลีนสองตัวสำหรับเรื่องเดียวคือบูลีนสองตัวที่วันหนึ่งจะไม่ตรงกัน แล้วไม่มีใคร
   * บอกได้ว่าตัวไหนถูก — และตัวที่มีอยู่แล้วถูกอ่านโดยจอ รายงาน และเทสต์นับสิบที่
   */
  const files = [
    'src/models/OtEntry.js', 'lib/caps.js', 'lib/accounting.js', 'lib/accountingRows.js',
    'components/ApprovalQueue.jsx', 'components/AccountingView.jsx',
    'app/api/entries/[id]/approve/route.js', 'app/api/entries/[id]/reject/route.js',
  ];
  const offenders = files.filter((f) => /isOverCeiling/.test(strip(read(f))));
  assert.deepEqual(offenders, [], `มีบูลีนตัวที่สองโผล่มาแล้วที่: ${offenders.join(', ')}`);
  // และฟิลด์ที่เพิ่มเข้ามาจริงมีตัวเดียว คือเหตุผล ซึ่งเมื่อก่อนไม่มีที่เก็บ
  assert.match(strip(read('src/models/OtEntry.js')), /overCeilingReason: \{ type: String, trim: true, maxlength: 200 \}/);
});
