import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  isFlatDailyPosition, isCompanyOffDay, mayCorrectEntries,
} from '../lib/entries.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';

/**
 * แถบช่องติ๊กในแผง แก้ไขชั่วโมง บนหน้า รออนุมัติ OT — สองช่อง แต่ละช่องมีกฎของ
 * ตัวเอง.
 *
 * HR, 2026-09-10, reading the panel over somebody's shoulder: *ตัดข้ามคืนออกไป
 * เลย · เหมารายวันเห็นเฉพาะตำแหน่งเจ้าหน้าที่บริการ HR และ admin เท่านั้น ·
 * ช่องติ๊กไม่พักกลางวันขึ้นเฉพาะวันหยุดบริษัทและวันเสาร์อาทิตย์*.
 *
 * TWO OF THE THREE ARE THE FILING FORM'S RULES OF 2026-09-08, arriving on the
 * screen that CORRECTS a filing two days after the screen that makes one — the
 * gap this file exists to close, and to keep closed. test/otFormChecks.test.js
 * owns the same two rules on OtForm, and both files call the same predicates out
 * of lib/entries.js rather than describing them, so a rule can only be moved in
 * one place: the library both screens read.
 *
 * THE THIRD IS THIS PANEL'S ALONE. ข้ามคืน was a greyed read-out here from
 * 2026-09-07 — a box that reported what the two times already said — and it is
 * gone. `endsNextDay` is NOT gone: it is derived on every press that moves a
 * time, sent with the correction and thrown on by the engine when it disagrees
 * with the pair. test/quickEditOvernight.test.js is where that half lives.
 *
 * WHY A TEST AND NOT JUST AN EDIT. Both gates HIDE A CONTROL, and a hidden
 * control that is ALREADY TICKED is a stored flag with nothing on the screen
 * able to take it off — eight hours priced onto a request, or an hour of lunch
 * not deducted, either of them uncorrectable from the one panel HR corrects
 * things in. Each gate is one `form.x ||` away from that, and the failure is
 * invisible on the screen: a box that is missing looks exactly like a box that
 * was never offered.
 *
 * `npm test` is plain `node --test` with no JSX transform (README §Status), so
 * the component is read as SOURCE TEXT and the predicates are exercised for
 * real.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const queue = read('components/ApprovalQueue.jsx');
const edit = queue.slice(queue.indexOf('function QuickEdit'), queue.indexOf('const OVER_CAP'));
const strip = edit.slice(edit.indexOf('{(mayTickNoBreak || mayTickFlatDaily) && ('));
const block = strip.slice(0, strip.indexOf('</div>'));

// ── ข้ามคืน ตัดออกทั้งช่อง ───────────────────────────────────────────────────

/**
 * ตัดข้ามคืนออกไปเลย — HR, 2026-09-10.
 *
 * The box was disabled and grey, which is what made it worth removing rather
 * than leaving: a control nobody may touch, in a panel that exists to change
 * things, is a question a reviewer keeps trying to answer. The filing form took
 * the same step on 2026-09-08.
 *
 * WHAT MUST NOT GO WITH IT is the field. The three assertions below are the
 * difference between "the question is not asked" and "the answer is not sent" —
 * the second would save a `TOO_LONG` refusal on times somebody typed correctly.
 */
test('ไม่มีช่องติ๊กข้ามคืนในแผงแก้ไขชั่วโมงแล้ว แต่ค่ายังถูกคิดและถูกส่ง', () => {
  assert.ok(!edit.includes('checked={form.endsNextDay}'), 'ช่องติ๊กข้ามคืนกลับมาแล้ว');
  assert.ok(!edit.includes('(สิ้นสุดวันถัดไป)'), 'คำอธิบายข้ามคืนยังอยู่ในแถบช่องติ๊ก');

  // …and the flag is still derived from the pair, on every press.
  assert.match(edit, /endsNextDay: endsNextDayFor\(next\.startTime, next\.endTime\)/);
  // …still measured, so a correction that only wraps the shift still counts as
  // a change and can still be saved.
  assert.match(edit, /form\.endsNextDay !== opened\.endsNextDay/);
  // …and still posted: `...form` carries it to both the preview and the PATCH.
  assert.match(edit, /api\.patch\(`\/entries\/\$\{entry\._id\}`, \{ \.\.\.form, note: note\.trim\(\) \}\)/);
});

/**
 * และคนตรวจยังต้องรู้ว่ากะนี้ข้ามคืน. Two places say so, both of them before
 * this panel is opened: the row in the queue and เวลาที่ขอ in the pop-up the
 * panel sits inside. Neither is a control.
 */
test('ข้ามคืนยังถูกรายงานบนแถวและในรายละเอียด', () => {
  assert.ok(queue.includes('{e.endsNextDay && <div className="cell-note">ข้ามคืน</div>}'));
  assert.ok(queue.includes("e.endsNextDay ? ' (ข้ามคืน)' : ''"));
});

// ── เหมารายวัน — ตำแหน่ง และ บทบาท ต้องเข้าเงื่อนไขทั้งคู่ ──────────────────

/**
 * เหมารายวันเห็นเฉพาะตำแหน่งเจ้าหน้าที่บริการ HR และ admin เท่านั้น — HR,
 * 2026-09-10.
 *
 * TWO CONDITIONS ANSWERING TWO DIFFERENT QUESTIONS, which is the part worth
 * pinning: the ตำแหน่ง is asked of THE PERSON THE ROW IS FOR (only a
 * เจ้าหน้าที่บริการ is sold by the day — a fact about the request), and the
 * บทบาท is asked of THE READER. `mayCorrectEntries` is the same predicate
 * `editPermission` refuses the save with, so a หัวหน้า is never shown a tick
 * the server answers 403 to.
 */
test('ช่องเหมารายวัน — ตำแหน่งของเจ้าของใบ และบทบาทของคนอ่าน ต้องผ่านทั้งคู่', () => {
  assert.match(
    edit,
    /const mayTickFlatDaily = form\.flatDaily\s*\r?\n?\s*\|\| \(mayCorrectEntries\(user\) && isFlatDailyPosition\(entry\.employee\?\.position\)\)/,
  );
  assert.match(block, /\{mayTickFlatDaily && \(\s*<label className="check">/);

  // The two halves are the library's, not a second reading of them here.
  assert.equal(mayCorrectEntries({ role: 'hr' }), true);
  assert.equal(mayCorrectEntries({ role: 'admin' }), true);
  assert.equal(mayCorrectEntries({ role: 'manager' }), false, 'หัวหน้าเห็นช่องที่เซิร์ฟเวอร์ปฏิเสธ');
  assert.equal(mayCorrectEntries({ role: 'accounting' }), false);
  assert.equal(mayCorrectEntries(null), false);
  assert.equal(isFlatDailyPosition('เจ้าหน้าที่บริการ'), true);
  assert.equal(isFlatDailyPosition('หัวหน้าแผนกบริการ'), false, 'ตำแหน่งอื่นในแผนกเดียวกันไม่ใช่');

  // ตำแหน่งของ “คนที่ใบนี้เป็นของเขา” — populated on every row this queue reads.
  assert.ok(read('lib/entries.js').includes(
    "{ path: 'employee', select: 'code name position role company' }",
  ), 'ตำแหน่งไม่ได้ถูก populate มากับใบ — กฎนี้จะตอบ false เงียบ ๆ ทุกแถว');
  // และไม่ใช่ฟิลด์ส่วนตัวที่ publicEmployee ตัดทิ้ง.
  assert.ok(!read('lib/employees.js').includes("PERSONAL_FIELDS = Object.freeze(['birthDate', 'email', 'position'"));
});

/**
 * ใบที่ติ๊กเหมาไว้แล้ว เปิดมาต้องเห็นช่องติ๊กเสมอ — the exception that makes the
 * rule safe over a live database, and the same one OtForm carries.
 *
 * Rows filed before either rule existed carry `flatDaily`, and so does any row
 * ฝ่ายบุคคล ticked here yesterday. Hide the box on those and the flag is
 * unreachable: eight hours priced onto a request that no screen admits is a flat
 * day. The gate withholds a NEW claim; it never swallows a stored one.
 */
test('ใบที่ติ๊กเหมาไว้แล้ว ช่องต้องไม่หายไม่ว่าตำแหน่งหรือบทบาทอะไร', () => {
  const decl = edit.slice(edit.indexOf('const mayTickFlatDaily'));
  const head = decl.slice(0, decl.indexOf(';'));
  assert.ok(head.startsWith('const mayTickFlatDaily = form.flatDaily'), head.slice(0, 90));
  assert.ok(head.includes('||'), 'ไม่มีข้อยกเว้นสำหรับช่องที่ติ๊กไว้แล้ว');
});

/**
 * และ `user` ต้องเดินทางลงมาถึงแผง. The queue holds the signed-in person; the
 * pop-up and the panel inside it are two hops away, and a prop that is not
 * passed reads as `undefined` — which `mayCorrectEntries` answers false to.
 * The box would then be missing for ฝ่ายบุคคล too, on every row, with nothing
 * on the screen or in the console saying why.
 */
test('คนที่กำลังอ่านถูกส่งลงไปถึงแผงแก้ไขชั่วโมง', () => {
  assert.ok(queue.includes('entry: e, user, isHr, busy,'), 'DetailModal ไม่ได้รับ user');
  assert.match(queue, /<DetailModal\b[\s\S]{0,900}?\n\s*user=\{user\}/);
  assert.match(queue, /<QuickEdit\s*\r?\n\s*entry=\{e\}\s*\r?\n\s*user=\{user\}/);
  assert.ok(edit.startsWith('function QuickEdit({ entry, user, onDirty, onCancel, onSaved }) {'));
});

// ── ไม่พักเที่ยง — เฉพาะวันหยุดบริษัทและเสาร์อาทิตย์ ────────────────────────

/**
 * ช่องติ๊กไม่พักกลางวันขึ้นเฉพาะวันหยุดบริษัทและวันเสาร์อาทิตย์ — HR,
 * 2026-09-10, which is word for word the rule they gave the filing form on
 * 2026-09-08.
 *
 * THE วันเกิด EXCLUSION IS STRUCTURAL, HERE AS THERE. `isCompanyOffDay` is
 * handed the company calendar and `weekendDays` and nothing else; a
 * สวัสดิการวันเกิด is a holiday for one person, resolved from a stored วันเกิด
 * no screen may hold (`publicEmployee`), so it cannot register even by accident.
 *
 * AND THE DATE IS `entry.workDate`, which this panel cannot move. The box is
 * about the hour at noon, and that noon belongs to the day the request is filed
 * under — not to the second date an overnight shift crosses.
 */
test('ช่องไม่พักเที่ยงอ่านจากปฏิทินของวันที่ทำงาน ไม่ได้ถามจาก preview', () => {
  assert.ok(edit.includes('const mayTickNoBreak = form.noBreakTaken'));
  assert.match(
    edit,
    /isCompanyOffDay\(entry\.workDate, \{\s*\r?\n?\s*holidays: holidays \|\| \[\], weekendDays: policy\.weekendDays,\s*\r?\n?\s*\}\)/,
  );
  assert.match(block, /\{mayTickNoBreak && \(\s*<label className="check">/);

  const decl = edit.slice(edit.indexOf('const mayTickNoBreak'));
  assert.ok(!/preview/.test(decl.slice(0, decl.indexOf(';'))), 'ช่องไม่พักเที่ยงไปผูกกับ preview แล้ว');

  // ปฏิทินถูกดึงปีละครั้ง และเฉพาะตอนเปิดแผงแก้ไข ไม่ใช่ทุกครั้งที่เปิดรายละเอียด.
  assert.ok(edit.includes("const holidayYear = Number(String(entry.workDate || '').slice(0, 4))"));
  assert.ok(edit.includes('api.get(`/holidays?year=${holidayYear}`)'));
  assert.ok(edit.includes('}, [holidayYear]);'));

  // และ weekendDays ต้องมาถึงเบราว์เซอร์จริง ๆ ไม่งั้นกฎนี้เงียบ ๆ ตอบ false เสมอ.
  assert.ok(read('app/api/auth/me/route.js').includes('weekendDays: policy.weekendDays'));
});

test('เสาร์อาทิตย์และวันหยุดประกาศเท่านั้น — วันธรรมดาไม่มีช่องนี้', () => {
  const weekendDays = DEFAULT_POLICY.weekendDays;
  const holidays = [{ date: '2026-08-12', name: 'วันแม่แห่งชาติ' }];
  const on = (date) => isCompanyOffDay(date, { holidays, weekendDays });

  assert.equal(on('2026-08-08'), true, 'เสาร์');
  assert.equal(on('2026-08-09'), true, 'อาทิตย์');
  assert.equal(on('2026-08-12'), true, 'วันหยุดบริษัท (พุธ)');
  assert.equal(on('2026-08-10'), false, 'จันทร์');
  // ปฏิทินโหลดไม่สำเร็จ — วันเสาร์ยังเป็นวันเสาร์ ส่วนวันหยุดประกาศหายไปเงียบ ๆ
  // ซึ่งเป็นทางที่พลาดแล้วช่องหาย ไม่ใช่ทางที่ชั่วโมงพักหายไปจากใบ.
  assert.equal(isCompanyOffDay('2026-08-08', { holidays: [], weekendDays }), true);
  assert.equal(isCompanyOffDay('2026-08-12', { holidays: [], weekendDays }), false);
});

/**
 * ช่องที่ติ๊กไว้แล้วต้องเห็นเสมอ — reachable here on a row filed on a Saturday
 * and since corrected onto a Tuesday. Without the guard the box vanishes with
 * the flag still true, and an hour goes undeducted with no control able to put
 * it back.
 */
test('ใบที่ติ๊กไม่พักเที่ยงไว้แล้ว ช่องต้องไม่หายแม้เป็นวันธรรมดา', () => {
  const decl = edit.slice(edit.indexOf('const mayTickNoBreak'));
  const head = decl.slice(0, decl.indexOf(';'));
  assert.ok(head.startsWith('const mayTickNoBreak = form.noBreakTaken'), head.slice(0, 90));
  assert.ok(head.includes('||'), 'ไม่มีข้อยกเว้นสำหรับช่องที่ติ๊กไว้แล้ว');
});

// ── แถบว่างต้องไม่ถูกวาด ────────────────────────────────────────────────────

/**
 * THE STRIP ITSELF GOES WHEN BOTH ARE WITHHELD, which an ordinary Tuesday on an
 * ordinary ตำแหน่ง now reaches — the commonest correction there is. A 14px
 * tinted band with nothing in it, under the two time boxes, is a gap the reader
 * has to account for.
 *
 * The guard is the two boxes and nothing else, for the reason OtForm's own
 * guard is: a third term that is not one of the remaining boxes is a promise the
 * strip has something in it, and it survives the box it was written for.
 */
test('ไม่เหลือช่องไหนเลย ต้องไม่วาดแถบเปล่า', () => {
  assert.ok(edit.includes('{(mayTickNoBreak || mayTickFlatDaily) && (\r\n      <div className="checks">')
    || edit.includes('{(mayTickNoBreak || mayTickFlatDaily) && (\n      <div className="checks">'),
  'แถบช่องติ๊กไม่ได้ถูกกั้นด้วยกฎของสองช่องที่เหลือ');
  const guard = edit.slice(edit.indexOf('{(mayTick'));
  const terms = guard.slice(0, guard.indexOf(') && (')).match(/mayTick\w+/g) || [];
  assert.deepEqual([...terms].sort(), ['mayTickFlatDaily', 'mayTickNoBreak']);
});

/**
 * และบรรทัดใต้ช่องติ๊กเหลือเรื่องเดียว. Its first line used to be the ข้ามคืน
 * sentence, which stood on every correction; what is left says only why a
 * เหมารายวัน day's two times are locked, so it is drawn only on a flat row. An
 * empty grey line under two ticks is not a note.
 */
test('บรรทัดใต้ช่องติ๊กขึ้นเฉพาะใบเหมารายวัน', () => {
  assert.match(edit, /\{form\.flatDaily && \(\s*\r?\n\s*<div className="checks-note">/);
  assert.ok(!edit.includes('“ข้ามคืน” คำนวณจากเวลาที่กรอก จึงติ๊กเองไม่ได้'),
    'ประโยคอธิบายช่องติ๊กที่ถูกตัดออกไปแล้วยังอยู่');
});
