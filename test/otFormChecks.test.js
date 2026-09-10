import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  isFlatDailyPosition, FLAT_DAILY_POSITIONS, isCompanyOffDay,
  FLAT_DAY_TIMES,
} from '../lib/entries.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';

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
 *   · ข้ามคืน is gone as a QUESTION, and since 2026-09-10 as a FIELD as well.
 *     This bullet read *"`endsNextDay` is still posted, still stored, and the
 *     engine still throws on the wrong value of it — so every press that moves
 *     a time has to recompute it"* while that was the arrangement. What is
 *     asserted now is the opposite, and it is just as invisible when wrong: no
 *     handler may write the field, and no line may promise the reader that a
 *     wrapped shift is understood.
 *   · the เหมารายวัน gate hides a control. A hidden control that is ALREADY
 *     TICKED is a flag priced at eight hours with nothing on the screen able to
 *     take it off, which is why the gate lets an on box through whatever the
 *     ตำแหน่ง says. That exception is the whole safety of the rule and it is
 *     one `form.flatDaily ||` away from being lost.
 *
 * `npm test` is plain `node --test` with no JSX transform (README §Status), so
 * the component is read as SOURCE TEXT. The rule itself is exercised for real —
 * `isFlatDailyPosition` is imported from lib/entries.js, where it lives
 * precisely so this file can call it.
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
 * ตัดช่องติ๊กข้ามคืนออก (2026-09-08) — และตัดทั้งฟีเจอร์ (2026-09-10).
 *
 * The box went first: it was never a question anybody could answer two ways,
 * since the engine took exactly one value of `endsNextDay` per pair of times
 * and threw on the other. Then HR asked for the rest — *เคลียร์ทุกอย่างที่
 * เกี่ยวกับฟีเจอร์ ทำงานข้ามคืน ออกจากระบบ ทั้งหมด* — and the field, the
 * derivation and the amber line that reported it went with it.
 *
 * THREE TESTS STOOD HERE AND ARE NOW ONE. *ทุกการกดที่ขยับเวลา คิดข้ามคืนใหม่
 * จาก endsNextDayFor* pinned `setStart` and `setEnd` to a helper that no longer
 * exists, and *บรรทัดข้ามคืนอยู่ข้างช่องเวลาสิ้นสุด และอ่านจากค่าที่จะถูกส่ง*
 * pinned an amber line that is no longer drawn. What is left is the one thing
 * still invisible when it is wrong: nothing on this form may write the field,
 * and nothing may promise the reader a wrap the server will refuse.
 */
test('ไม่เหลืออะไรเกี่ยวกับข้ามคืนบนฟอร์มแล้ว', () => {
  assert.ok(!form.includes('ทำงานข้ามคืน (สิ้นสุดวันถัดไป)'), 'ป้ายช่องติ๊กข้ามคืนยังอยู่');

  /**
   * MEASURED ON THE CODE, NOT ON THE COMMENTS. The prose above `setStart` says
   * what `endsNextDayFor` used to do on every press that moved a time, and that
   * paragraph is the record of a rule that was withdrawn — which this repo
   * keeps rather than deletes. It is the CODE that must not name either.
   */
  const code = form.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/endsNextDay/.test(code), 'โค้ดบนฟอร์มยังแตะ endsNextDay อยู่');
  assert.ok(!code.includes('ข้ามคืน · สิ้นสุดวัน'), 'บรรทัดสีเหลืองข้ามคืนยังถูกวาดอยู่');

  // The two handlers survive and each sets ONE value now.
  assert.match(form, /const setStart = \(v\) => setForm\(\(f\) => \(\{ \.\.\.f, startTime: v \}\)\);/);
  assert.match(form, /const setEnd = \(v\) => setForm\(\(f\) => \(\{ \.\.\.f, endTime: v \}\)\);/);
  assert.match(form, /onChange=\{setEnd\}/);

  // AND NO SCREEN WRITES THE OLD COMPARISON BACK. `endsNextDayFor` was this
  // app's one answer while the question existed; a copy of it appearing inside
  // a component is how the wrap would come back without anybody deciding to.
  assert.ok(!/endTime <= .*startTime/.test(code), 'คอมโพเนนต์เขียนกฎข้ามคืนเองซ้ำ');
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

// ── the tick that used to fill the times in now locks them ──────────────────

/**
 * IT WAS *เหมารายวันยังเติมเวลา 08:00–17:00 ให้เหมือนเดิม* until 2026-09-09 —
 * a guard that the fill survived the วันเกิด box being taken off the strip
 * beside it. The pair survived; what it is changed. See test/flatDaily.test.js
 * for the lock itself; this checks only that the strip's own tick is still
 * wired to the handler that writes it.
 */
test('เหมารายวันเขียนเวลา 08:00–17:00 แล้วล็อกไว้', () => {
  assert.match(form, /onChange=\{\(e\) => tickDay\('flatDaily', e\.target\.checked\)\}/);
  assert.match(form, /\.\.\.FLAT_DAY_TIMES,/);
  assert.deepEqual({ ...FLAT_DAY_TIMES }, { startTime: '08:00', endTime: '17:00' });
});

// ── ไม่พักเที่ยง แสดงเฉพาะวันหยุดของบริษัท ──────────────────────────────────

/**
 * HR, 2026-09-08: *ช่องติ๊กไม่พักเที่ยง โชว์เฉพาะวันหยุดเสาร์อาทิตย์และวันหยุด
 * ของบริษัท ไม่รวมวันเกิด*.
 *
 * THE EXCLUSION IS THE INTERESTING HALF and it is structural rather than an
 * `if`: `isCompanyOffDay` is handed the company calendar and `weekendDays` and
 * nothing else. A สวัสดิการวันเกิด is a holiday for one person, resolved from a
 * stored วันเกิด this screen is not allowed to hold (`publicEmployee`) — so it
 * cannot register here even by accident. What is pinned below is that the
 * function takes no third argument through which it ever could.
 */
test('isCompanyOffDay — เสาร์อาทิตย์และวันหยุดประกาศ เท่านั้น', () => {
  const weekendDays = DEFAULT_POLICY.weekendDays;
  assert.deepEqual(weekendDays, [0, 6], "วันหยุดสุดสัปดาห์ในนโยบายไม่ใช่อาทิตย์กับเสาร์แล้ว");
  const holidays = [{ date: '2026-08-12', name: 'วันแม่แห่งชาติ' }];
  const on = (date) => isCompanyOffDay(date, { holidays, weekendDays });

  // 2026-08-08 เสาร์ · 2026-08-09 อาทิตย์ · 2026-08-10 จันทร์
  assert.equal(on('2026-08-08'), true, 'เสาร์');
  assert.equal(on('2026-08-09'), true, 'อาทิตย์');
  assert.equal(on('2026-08-10'), false, 'จันทร์');
  assert.equal(on('2026-08-12'), true, 'วันหยุดบริษัท (พุธ)');

  // วันเกิดไม่ได้อยู่ในนี้ และไม่มีทางอยู่ — ฟังก์ชันไม่เคยเห็นวันเกิดของใคร.
  const src = read('lib/entries.js');
  const body = src.slice(src.indexOf('export function isCompanyOffDay'));
  assert.ok(!/birth/i.test(body.slice(0, 400)), 'isCompanyOffDay อ่านวันเกิด');
});

test('isCompanyOffDay — ค่าที่อ่านไม่ได้ ตอบ false ไม่เดา', () => {
  const weekendDays = [0, 6];
  assert.equal(isCompanyOffDay('', { weekendDays }), false);
  assert.equal(isCompanyOffDay(null, { weekendDays }), false);
  assert.equal(isCompanyOffDay('2026-8-8', { weekendDays }), false, 'ต้องเป็น YYYY-MM-DD เท่านั้น');
  assert.equal(isCompanyOffDay(undefined), false);
  // ไม่มีรายการวันหยุดสุดสัปดาห์ = ไม่มีวันไหนเป็นเสาร์อาทิตย์ — พลาดไปทางที่ช่องหาย
  // ไม่ใช่ทางที่ช่องโผล่บนวันที่ฝ่ายบุคคลสั่งไม่ให้โผล่.
  assert.equal(isCompanyOffDay('2026-08-08', {}), false);
  assert.equal(isCompanyOffDay('2026-08-08'), false);
});

test('ฟอร์มวาดช่องไม่พักเที่ยงจากปฏิทิน ไม่ได้ถามจาก preview', () => {
  assert.ok(form.includes('const mayTickNoBreak = form.noBreakTaken'));
  assert.ok(form.includes(
    'isCompanyOffDay(form.workDate, { holidays: holidays || [], weekendDays: policy.weekendDays })',
  ));
  assert.match(block, /\{mayTickNoBreak && \(\s*<label className="check">/);

  // อ่านจากปฏิทิน ไม่ใช่จาก preview — preview ต้องมีคน และหน้าบันทึกแทนยังไม่มี
  // คนติ๊กจนกว่าจะติ๊ก ส่วนวันเสาร์เป็นวันเสาร์ไม่ว่าใครยื่น.
  const decl = form.slice(form.indexOf('const mayTickNoBreak'));
  assert.ok(!/preview/.test(decl.slice(0, decl.indexOf(';'))), 'ช่องไม่พักเที่ยงไปผูกกับ preview แล้ว');
  // ปฏิทินถูกดึงปีละครั้ง ไม่ใช่ทุกครั้งที่วันที่เปลี่ยน.
  assert.ok(form.includes("const holidayYear = Number(String(form.workDate || today()).slice(0, 4))"));
  assert.ok(form.includes('api.get(`/holidays?year=${holidayYear}`)'));
  assert.ok(form.includes('}, [holidayYear]);'));

  // และ weekendDays ต้องถูกส่งมาให้เบราว์เซอร์จริง ๆ ไม่งั้นกฎนี้เงียบ ๆ ตอบ false เสมอ.
  assert.ok(read('app/api/auth/me/route.js').includes('weekendDays: policy.weekendDays'));
});

/**
 * ช่องที่ติ๊กไว้แล้วต้องเห็นเสมอ — the same exception `mayTickFlatDaily` carries,
 * and reachable in one sitting here rather than only across a policy change:
 * tick ไม่พักเที่ยง on a Saturday, then move วันที่ทำงาน to the Tuesday. Without
 * the guard the box vanishes with the flag still true, and an hour goes
 * undeducted with no control on the screen able to put it back.
 */
test('ติ๊กไม่พักเที่ยงไว้แล้วย้ายวันที่ ช่องต้องไม่หาย', () => {
  const decl = form.slice(form.indexOf('const mayTickNoBreak'));
  const head = decl.slice(0, decl.indexOf(';'));
  assert.ok(head.startsWith('const mayTickNoBreak = form.noBreakTaken'), head.slice(0, 80));
  assert.ok(head.includes('||'), 'ไม่มีข้อยกเว้นสำหรับช่องที่ติ๊กไว้แล้ว');
});

/**
 * THE GUARD IS THE TWO BOXES AND NOTHING ELSE — 2026-09-09.
 *
 * It was written as `!proxy || mayTickFlatDaily || mayTickNoBreak` when a THIRD
 * box, วันเกิด, was drawn on exactly the `!proxy` branch: `!proxy` was then a
 * true statement that the strip had something in it. `5d8821e` removed that box
 * on main, which left the term asserting a box that no path draws — and turned
 * it into a guarantee of the empty band on the commonest form of all, an
 * employee filing for themselves on an ordinary Tuesday.
 *
 * So the assertion is that NO term survives which is not one of the two
 * remaining boxes; `!proxy` coming back would mean the strip can be drawn empty
 * again.
 */
test('แถบหายทั้งแถบเมื่อไม่เหลือช่องไหนเลย', () => {
  assert.ok(form.includes('{(mayTickFlatDaily || mayTickNoBreak) && ('));
  assert.ok(!form.includes('!proxy || mayTickFlatDaily'), 'ไม่มีช่องวันเกิดแล้ว แถบจึงว่างได้ถ้ายัง !proxy');
});
