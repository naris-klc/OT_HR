import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  isFlatDailyPosition, FLAT_DAILY_POSITIONS, endsNextDayFor,
} from '../lib/entries.js';

/**
 * แถบช่องติ๊กบนฟอร์มบันทึก OT — สองช่อง เรียง เหมารายวัน → ไม่พักเที่ยง.
 *
 * HR, 2026-09-08, in three sentences across one day: *ช่องติ๊กเรียงจากวันเกิด >>
 * เหมารายวัน >> ไม่พักเที่ยง ตัดช่องติ๊กข้ามคืนออก*, then *ช่องติ๊กเหมารายวัน
 * แสดงเฉพาะเจ้าหน้าที่บริการ*, and then *เอาตัวเลือก “วันเกิด (สวัสดิการวันเกิด
 * ของตัวเอง)” ออก แต่ให้ระบบรู้อัตโนมัติ* — which took the head of that order
 * off the form the same morning it was put there. What the box did is
 * test/birthdayTick.test.js's subject; what is left in the row is this one's.
 *
 * WHY A TEST AND NOT JUST AN EDIT. Two of the three things asserted here are
 * invisible on the screen when they are wrong:
 *
 *   · ข้ามคืน is gone as a QUESTION but not as a FIELD. `endsNextDay` is still
 *     posted, still stored, and the engine still throws on the wrong value of
 *     it — so every press that moves a time has to recompute it. A handler that
 *     forgets is a form that saves a `TOO_LONG` refusal on times the person
 *     typed correctly, with no box on screen they could use to put it right.
 *   · the เหมารายวัน gate hides a control. A hidden control that is ALREADY
 *     TICKED is a flag priced at eight hours with nothing on the screen able to
 *     take it off, which is why the gate lets an on box through whatever the
 *     ตำแหน่ง says. That exception is the whole safety of the rule and it is
 *     one `form.flatDaily ||` away from being lost.
 *
 * `npm test` is plain `node --test` with no JSX transform (README §Status), so
 * the component is read as SOURCE TEXT. The rule itself is exercised for real —
 * `isFlatDailyPosition` and `endsNextDayFor` are imported from lib/entries.js,
 * where they live precisely so this file can call them.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const form = read('components/OtForm.jsx');
const checks = form.slice(form.indexOf('className="row form-checks"'));
const block = checks.slice(0, checks.indexOf('</div>'));

// The bound field is the anchor, not the label — a label moves within its own
// <label> when the wording changes, the binding does not. The wording is
// asserted separately just below.
const FLAT = 'checked={form.flatDaily}';
const NO_BREAK = 'checked={form.noBreakTaken}';

// ── the order, and the two that are left ────────────────────────────────────

test('สองช่อง เรียง เหมารายวัน → ไม่พักเที่ยง', () => {
  const flat = block.indexOf(FLAT);
  const noBreak = block.indexOf(NO_BREAK);

  for (const [label, at] of [['เหมารายวัน', flat], ['ไม่พักเที่ยง', noBreak]]) {
    assert.ok(at > -1, `ไม่พบช่องติ๊ก ${label} ในแถบ`);
  }
  // และป้ายทั้งสองยังเป็นคำเดิม.
  assert.ok(block.includes('เหมารายวัน (นับ 8 ชม. ต่อวัน)'));
  assert.ok(block.includes('ไม่พักเที่ยง'));
  assert.ok(flat < noBreak, 'เหมารายวันต้องอยู่ก่อนไม่พักเที่ยง');

  // TWO `<label className="check">` AND NO MORE. The count is what catches a
  // third box arriving without a decision about where it sits in the order —
  // and it is what catches วันเกิด coming back as a control instead of as the
  // answer the server now works out on its own.
  assert.equal((block.match(/<label className="check">/g) || []).length, 2);
});

/**
 * ตัดช่องติ๊กข้ามคืนออก — and the field it used to write is now computed.
 *
 * The box was never a question anybody could answer two ways: the engine takes
 * exactly one value of `endsNextDay` per pair of times and throws on the other
 * (test/quickEditOvernight.test.js pins the helper against both throws). Every
 * tick of it was therefore redundant or a server error, and the error read "A
 * single session cannot exceed 24 hours" — a sentence about a limit for what
 * was really a tick-box in the wrong state.
 */
test('ไม่มีช่องติ๊กข้ามคืนบนฟอร์มแล้ว', () => {
  assert.ok(!form.includes('ทำงานข้ามคืน (สิ้นสุดวันถัดไป)'), 'ป้ายช่องติ๊กข้ามคืนยังอยู่');
  assert.ok(!/checked=\{form\.endsNextDay\}/.test(form), 'ยังมี input ที่ผูกกับ endsNextDay');
  assert.ok(!/set\('endsNextDay'/.test(form), 'ยังมีทางเขียน endsNextDay ตรง ๆ');
});

test('ทุกการกดที่ขยับเวลา คิดข้ามคืนใหม่จาก endsNextDayFor', () => {
  // เวลาเริ่ม — both branches. The flat one derives the end and asks about the
  // pair it just made; the ordinary one asks about the end already in the box.
  assert.match(form, /const setStart = \(v\) => setForm/);
  assert.match(form, /endTime: flatDayEnd\(v\), endsNextDay: endsNextDayFor\(v, flatDayEnd\(v\)\)/);
  assert.match(form, /startTime: v, endsNextDay: endsNextDayFor\(v, f\.endTime\)/);

  // เวลาสิ้นสุด — the other half, and the box is wired to it rather than to the
  // plain field setter that used to write `endTime` and leave the flag behind.
  assert.match(form, /const setEnd = \(v\) => setForm/);
  assert.match(form, /endTime: v, endsNextDay: endsNextDayFor\(f\.startTime, v\)/);
  assert.match(form, /onChange=\{setEnd\}/);
  assert.ok(!/set\('endTime'/.test(form), 'ช่องเวลาสิ้นสุดยังเขียนผ่าน set() ธรรมดา');

  // ติ๊กวันเกิด / เหมารายวัน เติมเวลาให้ — และคิดข้ามคืนใหม่ด้วย. 08:00–17:00
  // does not wrap, but the pair it REPLACES may have.
  assert.match(form, /endsNextDay: endsNextDayFor\(STANDARD_DAY\.startTime, STANDARD_DAY\.endTime\)/);

  // AND THE COMPARISON IS NOT COPIED INTO THE COMPONENT. `endsNextDayFor` is
  // this app's one answer to the question; a second reading of it in the form
  // is how the screen comes to disagree with the engine behind it.
  const code = form.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/endTime <= .*startTime/.test(code), 'คอมโพเนนต์เขียนกฎข้ามคืนเองซ้ำ');
});

/**
 * และคนกรอกยังต้องรู้ว่ากะนี้ข้ามคืน. With no tick to look at, the amber line
 * beside เวลาสิ้นสุด is the only thing on the screen that says so — so it says
 * the word as well as the day, and it is drawn from `form.endsNextDay`, the
 * very value being posted.
 */
test('บรรทัดข้ามคืนอยู่ข้างช่องเวลาสิ้นสุด และอ่านจากค่าที่จะถูกส่ง', () => {
  assert.match(form, /const overnight = form\.endsNextDay;/);
  assert.match(form, /ข้ามคืน · สิ้นสุดวัน\{dayName\(endDateLabel\)\}ถัดไป/);
  const end = form.slice(form.indexOf('<label>เวลาสิ้นสุด (ถึง)</label>'));
  assert.ok(end.slice(0, end.indexOf('</div>')).includes('{overnight && ('),
    'บรรทัดข้ามคืนไม่ได้อยู่ในกล่องเวลาสิ้นสุด');
});

// ── เหมารายวัน แสดงเฉพาะ เจ้าหน้าที่บริการ ──────────────────────────────────

/**
 * ตำแหน่ง ตรงตัว ไม่ใช่คำที่มีอยู่ในชื่อ.
 *
 * `หัวหน้าแผนกบริการ` is on the same team and is deliberately NOT offered the
 * box: the rule HR gave names a job, not a department. A substring match on
 * `บริการ` would take that one in, and every ตำแหน่ง containing the word after
 * it — which is the shape of mistake nobody reports, because a box that is
 * shown to too many people looks exactly like a box.
 */
test('isFlatDailyPosition — ตรงตัวเท่านั้น', () => {
  assert.deepEqual(FLAT_DAILY_POSITIONS, ['เจ้าหน้าที่บริการ']);
  assert.equal(isFlatDailyPosition('เจ้าหน้าที่บริการ'), true);
  // Whitespace off a CSV import is not a different job.
  assert.equal(isFlatDailyPosition('  เจ้าหน้าที่บริการ  '), true);

  assert.equal(isFlatDailyPosition('หัวหน้าแผนกบริการ'), false);
  assert.equal(isFlatDailyPosition('เจ้าหน้าที่บัญชี'), false);
  assert.equal(isFlatDailyPosition('พนักงานผลิต1'), false);
  // A row with no ตำแหน่ง filled in is not a เจ้าหน้าที่บริการ.
  assert.equal(isFlatDailyPosition(''), false);
  assert.equal(isFlatDailyPosition(null), false);
  assert.equal(isFlatDailyPosition(undefined), false);
});

test('ฟอร์มถามตำแหน่งของ “คนที่ใบนี้เป็นของเขา” ไม่ใช่ของคนที่กำลังกรอก', () => {
  assert.match(form, /isFlatDailyPosition/);
  assert.match(block, /\{mayTickFlatDaily && \(\s*<label className="check">/);

  // บันทึกแทนพนักงาน reads the ticked ลูกทีม, not the หัวหน้า filling the form.
  assert.match(form, /const flatDailyPositions = proxy\s*\r?\n?\s*\? targets\.map\(/);
  // `every`, and a ticked list is required: a batch carries ONE set of ticks for
  // everybody in it, so a box shown because one name in eight qualifies is a box
  // that writes เหมารายวัน onto the other seven. `[].every()` is `true`, which
  // is why the length guard is beside it.
  assert.match(form, /flatDailyPositions\.length > 0 && flatDailyPositions\.every\(isFlatDailyPosition\)/);
  assert.ok(!/flatDailyPositions\.some\(/.test(form), 'ติ๊กคนเดียวในแปดคนไม่ควรเปิดช่องให้ทั้งชุด');

  // …and the two screens that know the person hand their ตำแหน่ง in.
  assert.match(read('components/EmployeeView.jsx'), /position=\{user\.position\}/);
  assert.match(read('components/HrEntries.jsx'), /position=\{employee\.position\}/);
});

/**
 * ช่องที่ติ๊กไว้แล้วต้องเห็นเสมอ — the exception that makes the rule safe to
 * ship over a live database.
 *
 * `flatDaily` is a stored field. Rows carrying it were filed before this rule
 * existed, and ฝ่ายบุคคล can still tick it from แก้ไขชั่วโมง on รออนุมัติ OT
 * (that panel has its own box and no ตำแหน่ง rule). Open one of those on this
 * form with the box hidden and the flag is unreachable: eight hours priced onto
 * a request that nothing on the screen admits is a flat day. So the gate
 * withholds a NEW claim and never swallows a stored one.
 */
test('ใบที่ติ๊กเหมาไว้แล้ว เปิดมาต้องเห็นช่องติ๊กเสมอ ไม่ว่าตำแหน่งอะไร', () => {
  assert.match(form, /const mayTickFlatDaily = form\.flatDaily\s*\r?\n?\s*\|\|/);
  // The write path is untouched by all of this — the rule is about what is
  // DRAWN. `flatDaily` is still an entered field the server takes from anybody.
  assert.match(read('src/models/OtEntry.js'), /flatDaily: \{ type: Boolean, default: false \}/);
});

// ── the tick that fills the times in still does ─────────────────────────────

test('เหมารายวันยังเติมเวลา 08:00–17:00 ให้เหมือนเดิม', () => {
  assert.match(form, /onChange=\{\(e\) => tickDay\('flatDaily', e\.target\.checked\)\}/);
  assert.match(form, /const STANDARD_DAY = Object\.freeze\(\{ startTime: '08:00', endTime: '17:00' \}\)/);
  assert.equal(endsNextDayFor('08:00', '17:00'), false);
});
