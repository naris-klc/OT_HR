import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { birthdayTickRefusal, isBirthdayWelfare } from '../lib/entries.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ช่องติ๊ก “วันเกิด” — the claim, and what refuses it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE REPLACED ITS OWN OPPOSITE
 *
 * It was test/birthdaySelfFiling.test.js and it pinned a ban: a person could
 * not file OT for their own สวัสดิการวันเกิด, because the day was granted by the
 * company and recorded by ฝ่ายบุคคล off the fingerprint scanner's export.
 *
 * HR reversed that on 2026-09-03. The employee files it themselves, ticks
 * วันเกิด on the ordinary form, and it goes to the หัวหน้า and then to
 * ฝ่ายบุคคล like every other request — the queue, the single signature and the
 * ban all withdrawn together. So the question this file asks is the mirror of
 * the old one: not "may they claim it" but "is the day they claimed really it".
 *
 * THE INTERESTING HALF IS STILL WHAT IS ALLOWED. A rule that refused more than
 * it was asked to would take away hours people genuinely worked, and the two
 * cases nearest to this one are the ones to watch: a request with the box
 * untouched, and a shift that ran past midnight into a birthday it was never
 * about.
 *
 * August 2026 throughout, like every other test here: 4 Aug is a Tuesday, 8 Aug
 * a Saturday, 12 Aug (วันแม่) the company holiday.
 */

const BIRTHDAY = { type: 'holiday', reason: 'birthday' };
const WEEKEND = { type: 'holiday', reason: 'weekend' };
const COMPANY = { type: 'holiday', reason: 'companyHoliday' };
const WORKDAY = { type: 'workday', reason: null };

// ── the box, ticked, on the day it names ────────────────────────────────────

test('ติ๊กวันเกิดตรงกับวันเกิดจริง — ผ่าน', () => {
  assert.equal(
    birthdayTickRefusal({
      ticked: true,
      dayTypes: { '2026-08-04': BIRTHDAY },
      workDate: '2026-08-04',
    }),
    null,
  );
});

/**
 * The whole point of checking it. The tick fills the standard day into the form
 * and tells the หัวหน้า reading the queue what they are signing, so a tick on an
 * ordinary Tuesday cannot be quietly ignored — the sheet would carry a birthday
 * that never happened.
 */
test('ติ๊กวันเกิดในวันทำงานปกติ — ปฏิเสธ พร้อมบอกทางออกสองทาง', () => {
  const out = birthdayTickRefusal({
    ticked: true,
    dayTypes: { '2026-08-04': WORKDAY },
    workDate: '2026-08-04',
  });

  assert.equal(typeof out, 'string');
  // Both ways out, or the sentence reads as "these hours do not count": correct
  // the date, or take the tick off and file the day as ordinary OT.
  assert.match(out, /ทะเบียนพนักงาน/);
  assert.match(out, /เอาเครื่องหมายถูก/);
});

/**
 * A birthday that lands on a Saturday or on วันแม่ is not a สวัสดิการวันเกิด at
 * all — the day was already วันหยุด for everybody and the rule added nothing.
 * `resolveDayTypes` says so by answering 'weekend'/'companyHoliday' rather than
 * 'birthday', which is why this reads the reason and never the date.
 *
 * ITS OWN SENTENCE, because the way out is different: nothing about the hours
 * is wrong, and the request files whole as an ordinary holiday request the
 * moment the tick comes off. Being told to "pick a date matching your birthday"
 * would send somebody to change a date that is already right.
 */
test('วันเกิดที่ตรงเสาร์หรือวันหยุดบริษัท — ปฏิเสธคนละแบบ และบอกว่าชั่วโมงไม่หาย', () => {
  for (const [date, day] of [['2026-08-08', WEEKEND], ['2026-08-12', COMPANY]]) {
    const out = birthdayTickRefusal({ ticked: true, dayTypes: { [date]: day }, workDate: date });
    assert.equal(typeof out, 'string', `${date} ควรถูกปฏิเสธ`);
    assert.match(out, /วันหยุดของทั้งบริษัท/);
    assert.match(out, /ชั่วโมงยังนับเท่าเดิม/);
  }

  // And the two refusals are not the same sentence — see above.
  const workday = birthdayTickRefusal({
    ticked: true, dayTypes: { '2026-08-04': WORKDAY }, workDate: '2026-08-04',
  });
  const weekend = birthdayTickRefusal({
    ticked: true, dayTypes: { '2026-08-08': WEEKEND }, workDate: '2026-08-08',
  });
  assert.notEqual(workday, weekend);
});

// ── the box, untouched ──────────────────────────────────────────────────────

/**
 * NOTHING IS REFUSED WHEN NOBODY CLAIMED ANYTHING, and that includes filing on
 * a day that IS the birthday. The hours are the engine's answer either way —
 * `resolveDayTypes` reads the stored วันเกิด and puts every minute in the
 * วันหยุด columns whether or not a box was ticked — so an untouched form on
 * one's own birthday files, and is paid, exactly as a ticked one.
 */
test('ไม่ติ๊กอะไรเลย — ไม่มีอะไรให้ปฏิเสธ แม้วันนั้นจะเป็นวันเกิดจริง', () => {
  for (const day of [WORKDAY, WEEKEND, COMPANY, BIRTHDAY]) {
    assert.equal(
      birthdayTickRefusal({ ticked: false, dayTypes: { '2026-08-04': day }, workDate: '2026-08-04' }),
      null,
    );
  }
  assert.equal(birthdayTickRefusal({ dayTypes: { '2026-08-04': BIRTHDAY }, workDate: '2026-08-04' }), null);
});

// ── the tail of an overnight shift ──────────────────────────────────────────

/**
 * A shift filed against an ordinary Monday that runs past midnight into the
 * filer's own birthday is MONDAY's request.
 *
 * The rule asks about `workDate` — the day the request is FOR — and about
 * nothing else in the map. So a tick on such a request is a claim about the
 * wrong day and is refused, while the request itself files perfectly well
 * without one: the hours are one continuous shift, and the tail lands in the
 * วันหยุด columns because the engine put it there.
 */
test('กะข้ามคืนที่ไหลเข้าวันเกิด — ยื่นเป็นใบของวันจันทร์ได้ แต่ติ๊กวันเกิดไม่ได้', () => {
  const dayTypes = { '2026-08-03': WORKDAY, '2026-08-04': BIRTHDAY };

  assert.equal(birthdayTickRefusal({ ticked: false, dayTypes, workDate: '2026-08-03' }), null);
  assert.equal(
    typeof birthdayTickRefusal({ ticked: true, dayTypes, workDate: '2026-08-03' }),
    'string',
  );
});

// ── shapes the map arrives in ───────────────────────────────────────────────

test('รับ Map และ object เหมือนกัน และรูปแบบสตริงล้วนพิสูจน์วันเกิดไม่ได้', () => {
  const asMap = new Map([['2026-08-04', BIRTHDAY]]);
  assert.equal(birthdayTickRefusal({ ticked: true, dayTypes: asMap, workDate: '2026-08-04' }), null);

  // `computeSession` also accepts a bare 'holiday' per date — the shape a
  // hand-written map in a test has. It carries no reason, so it cannot prove
  // this, and reading `.reason` off a string must not throw.
  assert.equal(
    typeof birthdayTickRefusal({
      ticked: true, dayTypes: { '2026-08-04': 'holiday' }, workDate: '2026-08-04',
    }),
    'string',
  );
});

test('ไม่มีวันนั้นในแผนที่ — ปฏิเสธ ไม่ throw', () => {
  assert.equal(
    typeof birthdayTickRefusal({ ticked: true, dayTypes: {}, workDate: '2026-08-04' }),
    'string',
  );
  assert.equal(
    typeof birthdayTickRefusal({ ticked: true, dayTypes: null, workDate: '2026-08-04' }),
    'string',
  );
});

// ── the write paths actually ask ────────────────────────────────────────────

/**
 * The rule is a pure function, so the only way it can be skipped is by a route
 * not calling it. An edit is a filing — the commonest correction there is moves
 * `workDate` — so a ticked request filed on the one day the tick is true must
 * not be draggable onto any other.
 */
test('ทุกเส้นทางที่เขียนใบถามคำถามเดียวกัน', () => {
  for (const file of [
    'app/api/entries/route.js',
    'app/api/entries/[id]/route.js',
    'app/api/entries/preview/route.js',
  ]) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.match(src, /birthdayTickRefusal\(/, `${file} ไม่ได้ตรวจช่องติ๊กวันเกิด`);
    assert.match(src, /ticked: payload\.birthdayWelfare/, `${file} อ่านช่องติ๊กจากที่อื่น`);
  }
});

/**
 * AND THE FORM ASKS THE SERVER RATHER THAN WORKING IT OUT. It cannot work it
 * out: `publicEmployee` keeps `birthDate` off the roster the browser holds, so
 * a browser-side copy of this rule would need a birth date this screen must not
 * have. The preview answers, and the form prints the sentence it gets back.
 */
test('ฟอร์มถามเซิร์ฟเวอร์ ไม่ได้เดาเอง และปิดปุ่มบันทึกตามคำตอบ', () => {
  const form = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');
  assert.match(form, /setBirthdayRefusal\(res\.birthdayRefusal \|\| null\)/);
  assert.match(form, /\{birthdayRefusal && <Alert kind="error">\{birthdayRefusal\}<\/Alert>\}/);
  assert.match(form, /\|\| Boolean\(birthdayRefusal\)\}/);
  // The tick is in the preview's dependency list, or a wrong claim would sit on
  // screen unanswered until something else moved.
  assert.match(form, /form\.flatDaily, form\.birthdayWelfare,/);
});

// ── the badge the employee reads ────────────────────────────────────────────

/**
 * `isBirthdayWelfare` is what draws OT สวัสดิการวันเกิด on the employee's own
 * screens, and it is read off the ENGINE's answer — never off the tick, which
 * is not stored, and never off the description, which is free text.
 */
test('ป้ายอ่านจาก dayReason ของ segment ไม่ใช่จากชื่อรายการ', () => {
  assert.equal(isBirthdayWelfare({
    segments: [{ date: '2026-08-04', dayType: 'holiday', dayReason: 'birthday' }],
  }), true);

  // A description is free text that ฝ่ายบุคคล may type over. A row that merely
  // MENTIONS a birthday is not one — this is the `Holiday.year` lesson.
  assert.equal(isBirthdayWelfare({
    description: 'OT สวัสดิการวันเกิด',
    segments: [{ date: '2026-08-04', dayType: 'workday', dayReason: null }],
  }), false);

  assert.equal(isBirthdayWelfare({
    segments: [{ date: '2026-08-08', dayType: 'holiday', dayReason: 'weekend' }],
  }), false);
});

/**
 * AND IT IS WHAT PUTS THE TICK BACK when a stored request is re-opened for
 * editing. There is no `birthdayWelfare` field on the entry — the engine's
 * answer is the only stored answer, and a second copy could disagree with it.
 */
test('เปิดใบเดิมมาแก้ — ช่องติ๊กอ่านกลับมาจากชั่วโมง ไม่ใช่จากฟิลด์', () => {
  const form = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');
  assert.match(form, /birthdayWelfare: isBirthdayWelfare\(from\)/);
  assert.ok(
    !/birthdayWelfare: \{ type: Boolean/.test(readFileSync(join(ROOT, 'src/models/OtEntry.js'), 'utf8')),
    'the tick got stored, and can now disagree with the hours',
  );
});

/**
 * An overnight shift whose tail landed on the birthday DOES wear the badge, and
 * that is right: some of the hours on that row were paid as สวัสดิการวันเกิด,
 * and the row is where the employee goes to ask why the split looks like that.
 */
test('กะข้ามคืนที่ปลายตกวันเกิด — ติดป้าย เพราะชั่วโมงบางส่วนเป็นแบบนั้นจริง', () => {
  assert.equal(isBirthdayWelfare({
    segments: [
      { date: '2026-08-03', dayType: 'workday', dayReason: null },
      { date: '2026-08-04', dayType: 'holiday', dayReason: 'birthday' },
    ],
  }), true);
});

/**
 * Absent means NOT RECORDED, not "not a birthday". Segments computed before
 * `dayReason` existed carry no label at all, and those rows simply go unmarked
 * — the same caution `birthdayHoursOf` takes over the same field, and the
 * reason นับไม่ได้ never turns into นับเป็นศูนย์ here.
 */
test('ใบเก่าที่ segment ไม่มี dayReason — ไม่ติดป้าย และไม่พัง', () => {
  assert.equal(isBirthdayWelfare({
    segments: [{ date: '2026-08-04', dayType: 'holiday' }],
  }), false);
  assert.equal(isBirthdayWelfare({ segments: [] }), false);
  assert.equal(isBirthdayWelfare({}), false);
  assert.equal(isBirthdayWelfare(null), false);
});

// ── and where the employee meets it ─────────────────────────────────────────

/**
 * แดชบอร์ดของพนักงาน draws the badge in all three places a request appears, and
 * the reason it is all three is that they are the same screen at three widths:
 * the recent list on a phone, the nine-column history on a desktop, and the
 * pop-up either of them opens. A row that says what it is in one of them and
 * not the others is a row whose kind depends on how you got to it.
 *
 * Read as source text, like every other component test in this suite.
 */
test('ป้าย OT สวัสดิการวันเกิด ขึ้นครบทั้งสามที่บนหน้าของพนักงาน', () => {
  const view = readFileSync(join(ROOT, 'components/EmployeeView.jsx'), 'utf8');
  const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');

  assert.match(common, /export function BirthdayWelfareMark\(\{ entry \}\)/);
  assert.match(common, /if \(!isBirthdayWelfare\(entry\)\) return null;/);
  assert.match(common, /OT สวัสดิการวันเกิด/);
  // Green. The amber pill beside it (`HR ตรวจสแกนนิ้ว · อนุมัติชั้นเดียว`) says
  // an approval a reader would assume happened did not — something to notice.
  // Two amber pills on one row read as two warnings, and this is not one.
  assert.match(common, /className="chip birthday"/);
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  assert.match(css, /\.chip\.birthday \{ background: var\(--green-bg\); color: var\(--green-dark\); \}/);

  assert.equal(
    (view.match(/<BirthdayWelfareMark entry=\{e\} \/>/g) || []).length,
    3,
    'ต้องขึ้นทั้งรายการล่าสุด ตารางประวัติ และป๊อปอัปรายละเอียด',
  );
});

/**
 * และไม่มีช่องนี้บนฟอร์มบันทึกแทน.
 *
 * The claim is "this is MY สวัสดิการวันเกิด", and a หัวหน้า cannot make it for
 * somebody: they are not told when their team member was born, so a box they
 * could only tick by guessing is a box that teaches them the answer through its
 * refusal. It costs the team member nothing — the hours come from
 * `resolveDayTypes` and not from the tick, so a proxy filing on a team member's
 * birthday pays exactly as their own would.
 */
test('ฟอร์มบันทึกแทนพนักงานไม่มีช่อง “วันเกิด” ให้ติ๊ก', () => {
  const form = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');
  const checks = form.slice(form.indexOf('className="row form-checks"'));
  const block = checks.slice(0, checks.indexOf('</div>'));
  assert.match(block, /\{!proxy && \(\s*<label className="check">/);
  // เหมารายวัน is NOT behind that guard: a หัวหน้า filing for a team member who
  // was hired for the day knows perfectly well that they were.
  const flat = block.slice(block.indexOf("tickDay('flatDaily'"));
  assert.ok(!flat.slice(0, flat.indexOf('</label>')).includes('!proxy'));
});

/**
 * และหน้ารออนุมัติ OT ก็ติ๊กได้ — 2026-09-07, inside รายละเอียด → แก้ไขชั่วโมง.
 *
 * The claim is the same claim, made by a different person about somebody else's
 * day, and that is why the box is not offered to every reader of that queue.
 * ฝ่ายบุคคล and ผู้ดูแลระบบ hold the วันเกิด already and are the only two
 * `editPermission` accepts a correction from at all; a หัวหน้า is not told when
 * their team member was born (`publicEmployee` keeps `birthDate` off the roster
 * they hold), so a box they could only tick by guessing is a box that teaches
 * them the answer through its refusal. Same rule OtForm draws when it withholds
 * the tick from บันทึก OT แทนพนักงาน, turned around.
 *
 * `mayCorrectEntries` IS THE RULE, not a second reading of it — the same
 * predicate the route refuses on.
 */
test('หน้ารออนุมัติ — ช่องติ๊กวันเกิดมีเฉพาะฝ่ายบุคคล/ผู้ดูแลระบบ', () => {
  const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');
  const edit = queue.slice(queue.indexOf('function QuickEdit'), queue.indexOf('const OVER_CAP'));

  // Drawn behind the บทบาท rule, and the rule comes from lib/entries.js.
  assert.match(edit, /\{mayCorrect && \(\s*<label className="check">/);
  assert.match(queue, /mayCorrect=\{mayCorrectEntries\(user\)\}/);
  // เหมารายวัน is NOT behind that guard: whether a day was hired whole is not a
  // private fact about the person, and every reader of this queue may see it.
  const flat = edit.slice(edit.indexOf('checked={form.flatDaily}'));
  assert.ok(!flat.slice(0, flat.indexOf('</label>')).includes('mayCorrect'));

  // The box opens on the HOURS, because there is no field to open on.
  assert.match(edit, /birthdayWelfare: isBirthdayWelfare\(entry\)/);
  assert.match(edit, /form\.birthdayWelfare !== isBirthdayWelfare\(entry\)/);

  // And the claim is checked by the server, whose sentence goes in the one
  // banner this panel has — with บันทึก greyed on it, so the screen cannot
  // offer a save the write path is about to answer 409 to.
  assert.match(edit, /const birthdayRefusal = preview\?\.birthdayRefusal \|\| null;/);
  assert.match(edit, /const refused = Boolean\(birthdayRefusal \|\| weekdayRefusal\);/);
  assert.match(edit, /!note\.trim\(\) \|\| refused\}/);
});

/**
 * …และก่อนจะไปถึงช่องติ๊กนั้น แถวต้องบอกก่อนว่าเป็นวันเกิด — 2026-09-07, asked
 * for in the same sentence as the เหมารายวัน chip: *ถ้าพนักงานติ๊กช่องเหมา
 * รายวันหรือวันเกิด ให้ขึ้นแท็กในรายละเอียดหน้ารออนุมัติ OT ด้วย เพื่อให้ผู้
 * อนุมัติรู้*.
 *
 * The chip existed and was drawn on every screen that READS a decided request —
 * and on none of the ones where it is decided. What the reviewer sees without it
 * is hours in the OT วันหยุด columns on a date the วัน column calls a Tuesday,
 * with nothing on the row connecting the two.
 *
 * IT IS STILL NOT THE TICK BEING READ BACK. `isBirthdayWelfare` asks the
 * segments the engine wrote, so a row whose owner's วันเกิด was corrected after
 * filing says what the hours ARE rather than what was claimed — the same reason
 * the employee's own screens ask it and not `description`.
 */
test('หน้ารออนุมัติ — ป้าย OT สวัสดิการวันเกิด ขึ้นทั้งในแถวและในป๊อปอัปรายละเอียด', () => {
  const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');
  const row = queue.slice(queue.indexOf('<td className="why-col">'), queue.indexOf('<td className="act-col">'));
  const detail = queue.slice(queue.indexOf('<Section title="คำขอ">'), queue.indexOf('<ReasonCard'));

  for (const [where, code] of [['แถวในคิว', row], ['ป๊อปอัปรายละเอียด', detail]]) {
    assert.match(code, /<BirthdayWelfareMark entry=\{e\} \/>/, `ป้ายวันเกิดหายจาก${where}`);
  }

  /*
   * AND THE TOOLTIP NO LONGER NAMES ฝ่ายบุคคล AS THE FILER. It ended
   * "ฝ่ายบุคคลเป็นผู้บันทึกและอนุมัติรายการนี้ให้", which was true only of the
   * arrangement withdrawn on 2026-09-03 — a birthday request is now filed by the
   * person whose birthday it is and takes both signatures. On this screen that
   * sentence would tell a หัวหน้า, mid-decision, that the request they are about
   * to sign has already been recorded and approved by somebody else.
   *
   * WHO filed a row is `ProxyMark`'s question, answered from the row's own
   * history, which stays right on the rows filed under the old arrangement too.
   */
  const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');
  const mark = common.slice(common.indexOf('export function BirthdayWelfareMark'));
  const body = mark.slice(0, mark.indexOf('\n}'));
  assert.ok(
    !/ฝ่ายบุคคล/.test(body),
    'ป้ายวันเกิดกลับไปบอกว่าฝ่ายบุคคลเป็นผู้บันทึกและอนุมัติให้',
  );
});
