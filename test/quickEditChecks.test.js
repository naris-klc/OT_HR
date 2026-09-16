import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  isCompanyOffDay, mayCorrectEntries,
  ticksAllowed, tickClearing, applyTickClearing,
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
 * THE THIRD WAS THIS PANEL'S ALONE. ข้ามคืน was a greyed read-out here from
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
/** Line endings normalised before anything below matches a character of this —
    see `.gitattributes`, which records the day eight test files reported the
    CHECKOUT they ran on rather than the code. `core.autocrlf` makes the working
    copy CRLF on the machine this is developed on and LF on the Linux box that
    serves it, and a multi-line assertion written for either one fails on the
    other against a tree with nothing wrong in it. */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const queue = read('components/ApprovalQueue.jsx');
const edit = queue.slice(queue.indexOf('function QuickEdit'), queue.indexOf('const OVER_CAP'));
const strip = edit.slice(edit.indexOf('{(mayTickNoBreak || mayTickFlatDaily) && ('));
const block = strip.slice(0, strip.indexOf('</div>'));

// ── ข้ามคืน ตัดออกทั้งช่อง ───────────────────────────────────────────────────

/**
 * ตัดข้ามคืนออกไปเลย — HR, 2026-09-10, and then the rest of it the same day.
 *
 * The box went first, and it was disabled and grey, which is what made it worth
 * removing rather than leaving: a control nobody may touch, in a panel that
 * exists to change things, is a question a reviewer keeps trying to answer. The
 * filing form took that step on 2026-09-08.
 *
 * TWO TESTS STOOD HERE AND ARE NOW ONE, and what they asserted has reversed.
 * *ไม่มีช่องติ๊กข้ามคืนในแผงแก้ไขชั่วโมงแล้ว **แต่ค่ายังถูกคิดและถูกส่ง*** pinned
 * the field surviving the box — *"the difference between the question is not
 * asked and the answer is not sent"* — and *ข้ามคืนยังถูกรายงานบนแถวและใน
 * รายละเอียด* pinned the two read-outs that stood in for it. HR asked for the
 * feature itself a few hours later, so the field, the derivation, the row note
 * and the เวลาที่ขอ suffix all went.
 *
 * WHAT IS PINNED NOW is that none of them comes back, and that the panel still
 * posts the form it holds.
 */
test('ไม่เหลืออะไรเกี่ยวกับข้ามคืนในแผงแก้ไขชั่วโมง หรือบนแถวหลังมัน', () => {
  assert.ok(!edit.includes('checked={form.endsNextDay}'), 'ช่องติ๊กข้ามคืนกลับมาแล้ว');
  assert.ok(!edit.includes('(สิ้นสุดวันถัดไป)'), 'คำอธิบายข้ามคืนยังอยู่ในแถบช่องติ๊ก');

  // ถามกับ CODE ไม่ใช่กับคอมเมนต์ — คอมเมนต์ในไฟล์นั้นบันทึกกฎที่ถูกถอดออกไว้
  const queueCode = queue.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/endsNextDay/.test(queueCode), 'คิวยังแตะ endsNextDay อยู่');
  assert.ok(!/ข้ามคืน/.test(queueCode), 'คิวยังวาดคำว่าข้ามคืนอยู่');

  // …and the panel still posts the whole form it holds, which is how every
  // other entered field reaches the PATCH.
  assert.match(edit, /api\.patch\(`\/entries\/\$\{entry\._id\}`, \{ \.\.\.form, note: note\.trim\(\) \}\)/);
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
  // ตำแหน่งกับวัน มาจากกฎกลาง · บทบาทของคนอ่านเป็นเงื่อนไขที่สามของแผงนี้เอง
  assert.match(
    edit,
    /const mayTick = ticksAllowed\(\{\s*\r?\n?\s*positions: \[entry\.employee\?\.position\],\s*\r?\n?\s*workDate: entry\.workDate,\s*\r?\n?\s*holidays,\s*\r?\n?\s*weekendDays: policy\.weekendDays,/,
  );
  assert.match(edit, /const mayTickFlatDaily = mayTick\.flatDaily && mayCorrectEntries\(user\);/);
  assert.match(block, /\{mayTickFlatDaily && \(\s*<label className="check">/);

  // The two halves are the library's, not a second reading of them here.
  assert.equal(mayCorrectEntries({ role: 'hr' }), true);
  assert.equal(mayCorrectEntries({ role: 'admin' }), true);
  assert.equal(mayCorrectEntries({ role: 'manager' }), false, 'หัวหน้าเห็นช่องที่เซิร์ฟเวอร์ปฏิเสธ');
  assert.equal(mayCorrectEntries({ role: 'accounting' }), false);
  assert.equal(mayCorrectEntries(null), false);
  // ตำแหน่งครึ่งหนึ่งของกฎ วัดผ่านฟังก์ชันร่วม — รายการอยู่ในนโยบายตั้งแต่ 2026-09-16
  const onSat = (position) => ticksAllowed({
    positions: [position], workDate: '2026-08-08', holidays: [], weekendDays: DEFAULT_POLICY.weekendDays,
  }).flatDaily;
  assert.equal(onSat('เจ้าหน้าที่บริการ'), true);
  assert.equal(onSat('หัวหน้าแผนกบริการ'), false, 'ตำแหน่งอื่นในแผนกเดียวกันไม่ใช่');

  // ตำแหน่งของ “คนที่ใบนี้เป็นของเขา” — populated on every row this queue reads.
  assert.ok(read('lib/entries.js').includes(
    "{ path: 'employee', select: 'code name position role company' }",
  ), 'ตำแหน่งไม่ได้ถูก populate มากับใบ — กฎนี้จะตอบ false เงียบ ๆ ทุกแถว');
  // และไม่ใช่ฟิลด์ส่วนตัวที่ publicEmployee ตัดทิ้ง.
  assert.ok(!read('lib/employees.js').includes("PERSONAL_FIELDS = Object.freeze(['birthDate', 'email', 'position'"));
});

/**
 * ติ๊กที่กฎไม่ให้ติ๊กแล้ว ถูกปลดทิ้ง — HR, 2026-09-16, บนสองจอพร้อมกัน.
 *
 * THE CLEARING IS COMPUTED FROM THE REQUEST ONLY, and that is the half worth
 * pinning: ตำแหน่ง and วันที่ทำงาน decide it, never `mayCorrectEntries`. A
 * หัวหน้า opening this panel sees no เหมารายวัน box because of WHO THEY ARE,
 * and if that reached the clearing they would strip a flag priced at eight hours
 * off somebody's row by opening it.
 *
 * AND THE PANEL MUST NOT OPEN DIRTY. `opened` is cleared the same way the form
 * is, so a withdrawn tick is off on both sides of the comparison and nothing
 * reads as an edit until somebody makes one.
 */
test('ติ๊กที่กฎไม่ให้ติ๊กแล้ว ต้องถูกปลด และแผงต้องไม่เปิดมาแบบถูกแก้แล้ว', () => {
  assert.ok(!/const mayTickFlatDaily = form\.flatDaily/.test(edit), 'ยังโชว์ช่องเพราะติ๊กไว้แล้ว');
  assert.match(edit, /const clearing = tickClearing\(\{\s*\r?\n?\s*positions: \[entry\.employee\?\.position\],/);
  assert.match(edit, /setForm\(\(f\) => applyTickClearing\(f, clearing\)\);/);
  assert.match(edit, /const opened = applyTickClearing\(asOpened\(entry\), clearing\);/);

  // สิทธิ์ของคนอ่านต้องไม่อยู่ในสูตรการปลดค่า
  const decl = edit.slice(edit.indexOf('const clearing = tickClearing'));
  assert.ok(
    !/mayCorrectEntries/.test(decl.slice(0, decl.indexOf('});'))),
    'บทบาทของคนอ่านไปอยู่ในเงื่อนไขการปลดค่าแล้ว',
  );
});

/**
 * และการปลดนั้นคือกฎเดียวกับฟอร์มยื่น ไม่ใช่กฎที่เขียนใหม่ตรงนี้ — the two
 * screens call one function, which is what stops the pair drifting the way they
 * had drifted before 2026-09-16 (the ตำแหน่ง half reached only one box, the
 * calendar half only the other).
 */
test('แผงแก้ไขชั่วโมงใช้กฎเดียวกับฟอร์มยื่น', () => {
  const weekendDays = DEFAULT_POLICY.weekendDays;
  const holidays = [{ date: '2026-08-12', name: 'วันแม่แห่งชาติ' }];
  const on = (position, workDate) => ticksAllowed({
    positions: [position], workDate, holidays, weekendDays,
  });

  assert.deepEqual(on('เจ้าหน้าที่บริการ', '2026-08-08'), { flatDaily: true, noBreak: false });
  assert.deepEqual(on('เจ้าหน้าที่บริการ', '2026-08-10'), { flatDaily: false, noBreak: false });
  assert.deepEqual(on('พนักงานผลิต1', '2026-08-12'), { flatDaily: false, noBreak: true });
  // ใบที่ตำแหน่งยังไม่มาถึงจอ — ไม่มีช่องไหนเลย และห้ามปลดค่าอะไรทั้งนั้น
  assert.deepEqual(
    ticksAllowed({ positions: [undefined], workDate: '2026-08-08', holidays, weekendDays }),
    { flatDaily: false, noBreak: false },
  );
  assert.deepEqual(
    tickClearing({ positions: [undefined], workDate: '2026-08-08', holidays, weekendDays }),
    { flatDaily: false, noBreak: false },
  );
  // ส่วนคนที่ไม่ได้กรอกตำแหน่งไว้ (สตริงว่าง) ไม่ใช่เจ้าหน้าที่บริการ — ได้ช่องไม่พักเที่ยง
  assert.deepEqual(
    ticksAllowed({ positions: [''], workDate: '2026-08-08', holidays, weekendDays }),
    { flatDaily: false, noBreak: true },
  );

  // ปฏิทินยังไม่มาตอนเปิดแผง — ห้ามปลดค่าของวันหยุดประกาศ
  assert.equal(tickClearing({
    positions: ['เจ้าหน้าที่บริการ'], workDate: '2026-08-12', holidays: null, weekendDays,
  }).flatDaily, false);
  assert.deepEqual(
    applyTickClearing({ flatDaily: true, noBreakTaken: false }, { flatDaily: false, noBreak: false }),
    { flatDaily: true, noBreakTaken: false },
  );
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
  assert.match(edit, /const mayTickNoBreak = mayTick\.noBreak;/);
  assert.match(edit, /workDate: entry\.workDate,/);
  assert.match(block, /\{mayTickNoBreak && \(\s*<label className="check">/);

  const decl = edit.slice(edit.indexOf('const mayTick = ticksAllowed'));
  assert.ok(!/preview/.test(decl.slice(0, decl.indexOf('});'))), 'ช่องไม่พักเที่ยงไปผูกกับ preview แล้ว');

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
 * แถวที่ยื่นไว้วันเสาร์แล้วถูกย้ายมาวันอังคาร — ช่องหายพร้อมค่า ไม่ใช่ช่องหาย
 * แล้วค่าค้าง. อย่างหลังคือชั่วโมงพักที่ไม่ถูกหักบนวันที่ HR บอกว่าไม่ต้องถาม.
 */
test('ใบที่ติ๊กไม่พักเที่ยงไว้แล้ว ค่าต้องถูกปลดเมื่อเป็นวันธรรมดา', () => {
  const weekendDays = DEFAULT_POLICY.weekendDays;
  const opts = { positions: ['พนักงานผลิต1'], holidays: [], weekendDays };
  assert.equal(tickClearing({ ...opts, workDate: '2026-08-08' }).noBreak, false, 'เสาร์ ค่าอยู่');
  assert.equal(tickClearing({ ...opts, workDate: '2026-08-11' }).noBreak, true, 'อังคาร ปลดทิ้ง');
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
  assert.ok(edit.includes('{(mayTickNoBreak || mayTickFlatDaily) && (\n      <div className="checks">'),
  'แถบช่องติ๊กไม่ได้ถูกกั้นด้วยกฎของสองช่องที่เหลือ');
  const guard = edit.slice(edit.indexOf('{(mayTick'));
  const terms = guard.slice(0, guard.indexOf(') && (')).match(/mayTick\w+/g) || [];
  assert.deepEqual([...terms].sort(), ['mayTickFlatDaily', 'mayTickNoBreak']);
});

/**
 * บรรทัดใต้ช่องติ๊กเหลือประโยคเดียว — ประโยคที่ไม่มีที่อื่นบนจอพูดแทนได้.
 *
 * IT CARRIED THREE SENTENCES IN ONE DAY AND LOST TWO OF THEM. It opened with
 * the ข้ามคืน line, which went with that box in the morning; then with
 * *เหมารายวันล็อกเวลาไว้ที่ 08:00–17:00 น. (อยู่ที่ทำงาน 9 ชม. รวมพักเที่ยง 1 ชม.)
 * แก้เวลาเองไม่ได้*, which HR had removed the same afternoon — every clause of it
 * was already on this panel: the lock under the two boxes it greys, the eight
 * hours in the green `FLAT_DAILY_SAY` Alert beside the figure they explain. The
 * filing form deleted the same paragraph on 2026-09-09 (test/flatDaily.test.js
 * owns that side, and it pins the import going with it, as this does here).
 *
 * WHAT IS LEFT HAS NOWHERE ELSE TO BE: the row behind the pop-up reads
 * 08:00–20:00 while the boxes above read 08:00–17:00, and a reviewer who cannot
 * see why would report the panel as showing the wrong request. It is therefore
 * drawn on `relockedTimes` — the rows where the stored pair and the locked pair
 * disagree — and not on every flat row, because a grey line saying nothing is
 * the paragraph again in miniature.
 */
test('บรรทัดใต้ช่องติ๊กเหลือเฉพาะประโยคที่บอกว่าเวลาเดิมจะถูกแก้ด้วย', () => {
  assert.match(edit, /\{relockedTimes && \(\s*\n\s*<div className="checks-note">/);
  assert.match(edit, /ใบนี้บันทึกไว้ \$\{entry\.startTime\}–\$\{entry\.endTime\} น\. ถ้ากดบันทึกจะแก้เวลาให้ด้วย/);
  // และ relockedTimes ยังเป็น “ใบเหมา + เวลาที่เก็บไว้ไม่ตรงกับคู่ที่ล็อก”
  assert.match(edit, /const relockedTimes = form\.flatDaily\s*\n?\s*&& \(form\.startTime !== entry\.startTime \|\| form\.endTime !== entry\.endTime\)/);

  // ── สองประโยคที่ถูกถอดออก ต้องไม่กลับมา ──
  assert.ok(!edit.includes('“ข้ามคืน” คำนวณจากเวลาที่กรอก จึงติ๊กเองไม่ได้'),
    'ประโยคข้ามคืนที่ถูกตัดออกไปแล้วยังอยู่');
  // ถามกับ CODE ไม่ใช่กับคอมเมนต์ — คอมเมนต์เหนือบรรทัดนั้นอ้างประโยคที่มันบันทึก
  // การตายของมันไว้ ซึ่งเป็นวิธีที่ไฟล์นี้ทั้งไฟล์เขียนถึงสิ่งที่ถูกถอดออก
  const code = edit.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/เหมารายวันล็อกเวลาไว้ที่/.test(code),
    'ย่อหน้าใต้ช่องติ๊กกลับมาแล้ว — บอกกฎเดียวกันซ้ำเป็นครั้งที่สอง');
  // …และค่าคงที่ที่มันเป็นผู้อ่านคนเดียว ออกจาก import ไปด้วย ไม่ใช่ค้างเป็นชื่อ
  // ที่คนอ่านคนถัดไปต้องหาเหตุผลให้ · ตัวเลข 9 ชม. เองไม่ถูกแตะ — test/flatDaily
  // ยังตรึง FLAT_DAY_SPAN_MINUTES ไว้ที่เก้าชั่วโมงเหมือนเดิม
  assert.ok(!/FLAT_DAY_SPAN_MINUTES/.test(queue.replace(/\/\*[\s\S]*?\*\//g, '')),
    'FLAT_DAY_SPAN_MINUTES ยังถูก import อยู่ ทั้งที่แผงนี้ไม่ได้วาดมันแล้ว');
});
