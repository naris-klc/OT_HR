import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { endsNextDayFor } from '../lib/entries.js';
import { computeSession } from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';

/**
 * ข้ามคืน ในฟอร์มแก้ไขชั่วโมง — ไม่ใช่คำถาม แต่เป็นผลของเวลาสองช่อง.
 *
 * The engine permits exactly one value of `endsNextDay` per pair of times and
 * throws on the other. A form that offered the tick-box as a free choice was
 * therefore offering one right answer and one server error — and the error came
 * back as "A single session cannot exceed 24 hours" (Thai since 2026-09-10:
 * ช่วงเวลาเดียวต้องไม่เกิน 24 ชั่วโมง), which is a sentence about a limit for
 * what is really a box in the wrong state.
 *
 * What is pinned here is that `endsNextDayFor` IS the inverse of those two
 * throws — asserted against the engine itself, not against a remembered rule,
 * so moving either boundary in one place fails here rather than shipping a form
 * that quietly disagrees with the calculation behind it.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A Monday, so no weekend or holiday branch is involved in the arithmetic. */
const WORK_DATE = '2026-08-17';
const dayTypes = { '2026-08-17': 'workday', '2026-08-18': 'workday' };

const compute = (startTime, endTime, endsNextDay) => computeSession(
  { workDate: WORK_DATE, startTime, endTime, endsNextDay },
  { policy: DEFAULT_POLICY, dayTypes },
);

test('เย็นวันธรรมดา — ไม่ใช่ข้ามคืน', () => {
  assert.equal(endsNextDayFor('17:00', '20:00'), false);
});

test('เลิกก่อนหรือเท่าเวลาเริ่ม — ข้ามคืน', () => {
  assert.equal(endsNextDayFor('22:00', '02:00'), true);
  // 24 hours exactly: the engine allows it, and unticked it would be 0 hours.
  assert.equal(endsNextDayFor('17:00', '17:00'), true);
});

test('เวลายังกรอกไม่ครบ ไม่เดาแทน', () => {
  // <input type="time"> reads '' mid-keystroke, and '' sorts before every real
  // time — a naive compare would tick the box while somebody types the hour.
  assert.equal(endsNextDayFor('', '02:00'), false);
  assert.equal(endsNextDayFor('22:00', ''), false);
  assert.equal(endsNextDayFor(undefined, undefined), false);
});

/**
 * THE TWO THROWS THIS IS THE INVERSE OF. Read off the engine rather than
 * described: if either boundary moves, the helper is wrong and this says so.
 */
test('ค่าที่ helper ตอบ คือค่าเดียวที่ engine ยอมรับ', () => {
  for (const [start, end] of [['17:00', '20:00'], ['22:00', '02:00'], ['17:00', '17:00']]) {
    const right = endsNextDayFor(start, end);
    // The answer it gives computes.
    assert.doesNotThrow(() => compute(start, end, right), `${start}–${end} (${right}) ถูกปฏิเสธ`);
    // The other one does not.
    assert.throws(
      () => compute(start, end, !right),
      `${start}–${end} (${!right}) ควรถูกปฏิเสธ แต่ engine ยอมรับ`,
    );
  }
});

test('17:00–20:00 ที่ติ๊กข้ามคืน คือกะ 27 ชั่วโมง', () => {
  // The mistake this closes off, named by the error it used to produce. Pinned
  // on `code`, not on the sentence: the sentence became Thai on 2026-09-10 and
  // a regex over the message would have to be rewritten every time the wording
  // is. `TOO_LONG` is the part the app branches on.
  assert.throws(() => compute('17:00', '20:00', true), (e) => e.code === 'TOO_LONG');
});

// ── the form reads the rule rather than repeating it ────────────────────────

const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');
const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
const edit = queue.slice(queue.indexOf('function QuickEdit'), queue.indexOf('const OVER_CAP'));

test('ฟอร์มแก้ไขชั่วโมงคิดข้ามคืนจาก lib ไม่ได้เขียนกฎเอง', () => {
  assert.match(edit, /endsNextDay: endsNextDayFor\(next\.startTime, next\.endTime\)/);
  // No second copy of the comparison in the component.
  const code = edit.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/endTime <= .*startTime/.test(code), 'คอมโพเนนต์เขียนกฎเองซ้ำ');
  // AND NO BOX AT ALL — HR, 2026-09-10. It reported the answer from 2026-09-07
  // as a greyed read-out; what HR asked for is that แก้ไขชั่วโมง stop drawing it,
  // which is the step the filing form took on 2026-09-08. The FLAG is untouched:
  // derived above, sent with the correction, and read by the engine. What must
  // not come back is a control — greyed or live — that puts it to the reviewer.
  assert.ok(!/checked=\{form\.endsNextDay\}/.test(edit), 'ช่องติ๊กข้ามคืนกลับมาอยู่ในแผงแก้ไขชั่วโมงแล้ว');
  assert.ok(!/onChange=\{\(ev\) => set\(\{ endsNextDay/.test(edit), 'ยังติ๊กข้ามคืนเองได้');
  assert.ok(!css.includes('.quick-edit .check.derived'), 'กฎ CSS ของช่องติ๊กที่ถูกลบไปแล้วยังค้างอยู่');
  // The two places a reviewer still reads the fact, neither of them a tick-box:
  // the row in the queue, and เวลาที่ขอ in the pop-up this panel opens inside.
  assert.ok(queue.includes('<div className="cell-note">ข้ามคืน</div>'), 'แถวในคิวไม่บอกว่าข้ามคืนแล้ว');
  assert.ok(queue.includes("e.endsNextDay ? ' (ข้ามคืน)' : ''"), 'เวลาที่ขอ ในป๊อปอัปไม่บอกว่าข้ามคืนแล้ว');
});

/**
 * THE TWO SWITCHES BELONG TO THE TIMES ABOVE THEM. One reports what those times
 * mean and the other changes what is deducted from them, so they are a strip
 * under the time fields rather than two more questions loose in the form.
 *
 * THE FILING FORM NO LONGER HAS THE ข้ามคืน HALF TO AGREE WITH — 2026-09-08,
 * when that box came off OtForm altogether and the wrap moved to a line beside
 * เวลาสิ้นสุด (test/otFormChecks.test.js owns that). The two screens have not
 * drifted; the filing form went one step further down the road this panel took
 * on 2026-09-07, from a box that reports the answer to no box at all. What is
 * still asserted across both is ไม่พักเที่ยง, which is a real choice on either
 * screen and has to read the same on both.
 *
 * AND THE PANEL CAUGHT THE FORM UP ON 2026-09-10, in both directions: ข้ามคืน
 * left it too, and the two boxes that remain are drawn behind the same two
 * rules the filing form draws them behind — the ตำแหน่ง one and the calendar
 * one (test/quickEditChecks.test.js owns those). What is pinned here is the
 * strip: two switches, in a box under the times, in the filing form’s words.
 */
test('สวิตช์สองตัวอยู่ในแถบเดียวกัน ใต้ช่องเวลา และใช้คำเดียวกับฟอร์มยื่น', () => {
  const form = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');
  assert.ok(form.includes('ไม่พักเที่ยง'), 'ฟอร์มยื่นเปลี่ยนคำแล้ว — สองหน้าจะไม่ตรงกัน');
  assert.ok(!form.includes('ทำงานข้ามคืน (สิ้นสุดวันถัดไป)'),
    'ช่องติ๊กข้ามคืนกลับมาอยู่บนฟอร์มยื่นแล้ว');
  assert.ok(!edit.includes('ข้ามคืน <span className="check-note">(สิ้นสุดวันถัดไป)</span>'),
    'ช่องติ๊กข้ามคืนกลับมาอยู่ในแผงแก้ไขชั่วโมงแล้ว');
  assert.ok(edit.includes('ไม่พักเที่ยง <span className="check-note">(ไม่หักเวลาพัก)</span>'));
  assert.ok(edit.includes('เหมารายวัน <span className="check-note">(นับ 8 ชม. ต่อวัน)</span>'));
  // A row that wraps, in a box of its own — not two controls stacked loose.
  assert.ok(css.includes('display: flex; flex-direction: row; flex-wrap: wrap;'),
    'แถบสวิตช์ไม่ได้เรียงเป็นแถวแล้ว');
  assert.ok(!css.includes('.quick-edit .checks { gap: 14px; flex-direction: column; }'),
    'กฎเก่าที่วางซ้อนกันบนมือถือยังอยู่');
  // And the locked เหมารายวัน times say why they are locked, once, under the
  // two ticks rather than beside the mark. It is drawn only on a flat row now:
  // its first line used to be the ข้ามคืน sentence, which stood on every
  // correction, and an empty grey line under two ticks is not a note.
  assert.ok(edit.includes('className="checks-note"'), 'ไม่มีบรรทัดบอกว่าทำไมแก้เวลาเหมารายวันเองไม่ได้');
  assert.ok(edit.includes('{form.flatDaily && ('), 'บรรทัดใต้ช่องติ๊กไม่ได้ผูกกับเหมารายวัน');
});

/**
 * ช่องเวลาสองช่องต้องอยู่บรรทัดเดียวกัน แม้ช่องหนึ่งจะมีบรรทัดห้อยอยู่ใต้มัน.
 *
 * `.row` is `align-items: flex-end` everywhere else in the app, which is right
 * where a row pairs a field with a BUTTON — the button lines up with the box
 * rather than with the label above it. Both items here are FIELDS, and on a
 * เหมารายวัน row เวลาสิ้นสุด grows a `.field-note` saying the pair is locked.
 * Aligned by their bottoms, that note lifted เวลาสิ้นสุด and its label a line
 * above เวลาเริ่ม — reported off the screen on 2026-09-10, and it read as two
 * staggered questions instead of one pair of times.
 *
 * The two halves are asserted together on purpose: the override is only
 * meaningful while the shared rule disagrees with it, and the note is the only
 * reason the two fields are ever different heights. Lose either and this test
 * should be read again rather than deleted.
 */
test('ช่องเวลาเริ่มกับเวลาสิ้นสุดอยู่บรรทัดเดียวกัน', () => {
  assert.ok(css.includes('.quick-edit .row { align-items: flex-start; }'),
    'สองช่องเวลากลับไปเรียงตามขอบล่าง — ใบเหมาจะเหลื่อมกันหนึ่งบรรทัด');
  assert.ok(css.includes('.row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }'),
    'กฎ .row ที่ร่วมกันเปลี่ยนไปแล้ว — ตรวจว่ายังต้องมีข้อยกเว้นของแผงนี้อยู่ไหม');
  // และบรรทัดที่ทำให้สองช่องสูงไม่เท่ากัน ยังอยู่ใต้ช่องเวลาสิ้นสุด
  const end = edit.slice(edit.indexOf('<label>เวลาสิ้นสุด</label>'));
  assert.match(end.slice(0, end.indexOf('</div>')), /<span className="field-note">/);
});

/**
 * ONE BANNER. A reviewer who mistyped a time AND had not written a reason yet
 * was told off in two places at once — a permanent red line under the เหตุผล
 * box and an alert at the foot — neither mentioning the other, with a disabled
 * button between them.
 *
 * The server's own sentence is kept rather than replaced by a category: it
 * names WHICH thing is wrong, and somebody correcting a time needs that.
 */
test('ข้อผิดพลาดทั้งหมดรวมอยู่ที่แบนเนอร์เดียว', () => {
  assert.match(edit, /const problems = \[/);
  assert.match(edit, /!note\.trim\(\) \? 'กรุณาระบุเหตุผลการแก้ไข' : null/);
  assert.match(edit, /\{\(moved \|\| err\) && problems\.length > 0 && \(/);
  assert.match(edit, /<Alert kind="error">\{problems\.join\(' · '\)\}<\/Alert>/);
  // The red line under the field is gone; what is left is what the note is for.
  assert.ok(!edit.includes('ต้องระบุเหตุผลก่อนบันทึก'), 'ยังเตือนสองที่');
  assert.match(edit, /<div className="field-note">บันทึกไว้ในประวัติรายการ/);
});

/**
 * ONE FILLED, ONE OUTLINED, AND THE SAME BOX UNDER BOTH.
 *
 * `.btn` is `border: none` and `.btn.ghost` carries a 1px rule, so at the same
 * padding the outlined one stands 2px taller and the pair sits crooked. The
 * filled one is given the same hairline in nothing, which is the same fix the
 * pop-up's own two buttons take.
 *
 * ยกเลิก was `quiet` — no fill, no rule — for a while. That is right in a
 * dialog footer, where the row's shape is obvious; inside a tinted panel under
 * a textarea it read as a caption to the box above it rather than the way back.
 */
test('ปุ่มบันทึกเป็นปุ่มหลัก ปุ่มยกเลิกเป็นปุ่มรอง ขนาดเท่ากัน', () => {
  assert.match(edit, /<button className="btn ghost" onClick=\{onCancel\}/);
  assert.match(edit, /<button className="btn" onClick=\{save\}/);
  assert.ok(css.includes('.quick-edit-foot .btn { border: 1px solid transparent; }'),
    'ปุ่มเขียวไม่มีเส้นขอบใส สองปุ่มจะสูงไม่เท่ากัน 2px');
  assert.ok(css.includes('.quick-edit-foot .btn.ghost { color: var(--muted); }'),
    'ปุ่มยกเลิกไม่ได้ถูกข่มด้วยสีตัวอักษร');
});
