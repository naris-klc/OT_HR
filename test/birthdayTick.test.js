import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { isBirthdayWelfare } from '../lib/entries.js';
import {
  BUCKETS, computeSession, makeIsHoliday, resolveDayTypes, sessionDates,
} from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ช่องติ๊ก “วันเกิด” — ที่ไม่มีแล้ว, and what answers the question instead.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE HAS NOW REPLACED ITS OWN OPPOSITE TWICE
 *
 * It was test/birthdaySelfFiling.test.js and it pinned a BAN: a person could
 * not file OT for their own สวัสดิการวันเกิด, because the day was granted by the
 * company and recorded by ฝ่ายบุคคล off the fingerprint scanner's export. HR
 * reversed that on 2026-09-03 — the employee filed it themselves and ticked
 * วันเกิด on the ordinary form — and this file became the mirror of the old
 * one: not "may they claim it" but "is the day they claimed really it".
 *
 * HR REVERSED IT AGAIN ON 2026-09-08: *เอาตัวเลือก “วันเกิด (สวัสดิการวันเกิด
 * ของตัวเอง)” ออก แต่ให้ระบบรู้อัตโนมัติ*. So there is no claim, and the
 * question is neither of the two it has been. It is: **does the system reach the
 * right answer without being told, and is there anywhere left that a tick could
 * come back in?**
 *
 * THE THIRD QUESTION IS THE ONE WORTH A FILE. Nothing on a screen shows the
 * difference between "the box is gone" and "the box is gone and the rule went
 * with it" — the hours look the same on the day somebody's birthday is a
 * Tuesday and they worked 08:00–17:00, which is most of them. What the cases
 * below hold is that the rule is decided from the STORED วันเกิด on the server,
 * on every path that writes, and that the screens read the engine's answer back
 * rather than any field of their own.
 *
 * August 2026 throughout, like every other test here: 4 Aug is a Tuesday, 8 Aug
 * a Saturday, 12 Aug (วันแม่) the company holiday.
 */

const ON = { ...DEFAULT_POLICY, birthdayHolidayEnabled: true };
const isHoliday = makeIsHoliday(['2026-08-12']);

/** What otService.contextFor builds, without the database half. */
const run = (session, birthDate) => computeSession(session, {
  policy: ON,
  dayTypes: resolveDayTypes(sessionDates(session), { isHoliday, birthDate, policy: ON }),
});

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const WRITE_PATHS = [
  'app/api/entries/route.js',
  'app/api/entries/[id]/route.js',
  'app/api/entries/preview/route.js',
];

// ── the box is gone, everywhere ─────────────────────────────────────────────

/**
 * ONE FIELD NAME, SEARCHED FOR IN EVERY FILE THAT EVER SENT OR READ IT.
 *
 * A half-removal is the failure worth catching, and it is silent both ways
 * round: a form still posting `birthdayWelfare` to a route that no longer reads
 * it looks exactly like a form that is not, and a route still refusing on a
 * field nothing sends answers 409 to nobody until the day something does.
 *
 * Comments are stripped first. Every one of these files carries a headstone
 * naming the field it no longer has — that is the house rule, and an assertion
 * against the raw text would fail on the gravestone instead of on the code.
 */
test('ไม่มีใครส่งหรืออ่าน birthdayWelfare อีกแล้ว', () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const file of [
    ...WRITE_PATHS,
    'lib/entries.js',
    'components/OtForm.jsx',
    'components/ApprovalQueue.jsx',
    'src/lib/otEngine.js',
    'src/models/OtEntry.js',
  ]) {
    assert.ok(
      !/birthdayWelfare/.test(strip(read(file))),
      `${file} ยังอ้างถึงช่องติ๊กที่ถูกถอดออกไปแล้ว`,
    );
  }

  // And the refusal that was the verdict on it. `birthdayTickRefusal` is not
  // exported any more, so a route importing it would not build — but a route
  // may not quietly grow a second reading of the rule either.
  assert.ok(!/export function birthdayTickRefusal/.test(read('lib/entries.js')));
  for (const file of WRITE_PATHS) {
    assert.ok(
      !/birthdayTickRefusal\(/.test(strip(read(file))),
      `${file} ยังเรียกฟังก์ชันปฏิเสธที่ถูกถอดออกไปแล้ว`,
    );
  }
});

/**
 * และแถบช่องติ๊กบนฟอร์มเหลือสองช่อง. The label is asserted as well as the
 * binding: HR named the option in the words on the screen, and those words are
 * how anybody checks that the right box went.
 */
test('ฟอร์มยื่นไม่มีช่องติ๊กวันเกิด — เหลือ เหมารายวัน กับ ไม่พักเที่ยง', () => {
  const form = read('components/OtForm.jsx');
  const checks = form.slice(form.indexOf('className="row form-checks"'));
  const block = checks.slice(0, checks.indexOf('</div>'));

  assert.ok(!block.includes('วันเกิด (สวัสดิการวันเกิดของตัวเอง)'), 'ป้ายเดิมยังอยู่บนฟอร์ม');
  assert.ok(!block.includes('checked={form.birthdayWelfare}'));
  assert.equal((block.match(/<label className="check">/g) || []).length, 2);
});

/**
 * และหน้ารออนุมัติ OT ก็เช่นกัน — the box lived inside รายละเอียด → แก้ไขชั่วโมง
 * from 2026-09-07 to 2026-09-08, offered to ฝ่ายบุคคล and withheld from
 * everybody else through a `mayCorrect` prop threaded down from the queue.
 *
 * THE PROP GOES WITH IT. It decided that one control and nothing else, so a
 * `mayCorrect` still being computed and passed would be a บทบาท rule with
 * nowhere left to be read — the shape somebody re-uses for a different control
 * six months later without noticing it answers a different question.
 */
test('หน้ารออนุมัติ — ช่องติ๊กวันเกิดและ mayCorrect ออกไปด้วยกัน', () => {
  const queue = read('components/ApprovalQueue.jsx');
  const edit = queue.slice(queue.indexOf('function QuickEdit'), queue.indexOf('const OVER_CAP'));

  assert.ok(!edit.includes('checked={form.birthdayWelfare}'));
  assert.ok(!/\{mayCorrect && \(/.test(edit), 'ช่องติ๊กที่ซ่อนไว้หลัง mayCorrect ยังอยู่');
  assert.ok(!/mayCorrect=\{mayCorrectEntries\(user\)\}/.test(queue), 'prop ยังถูกส่งลงมา');
  assert.ok(!/mayCorrectEntries/.test(queue.split('\n').slice(0, 30).join('\n')), 'ยัง import อยู่');

  // เหมารายวัน stays, and stays visible to every reader of the queue: whether a
  // day was hired whole is not a private fact about the person.
  assert.match(edit, /checked=\{form\.flatDaily\}/);
});

// ── what decides instead ────────────────────────────────────────────────────

/**
 * THE STORED วันเกิด, RESOLVED ON THE SERVER — the same answer the tick could
 * only ever have agreed with.
 *
 * Two people, one date, one pair of times, one policy. Nothing in the session
 * says whose birthday it is and nothing can be made to say so: `computeSession`
 * takes a day-type map, and the map is `resolveDayTypes`' answer for one
 * employee. That is what makes the rule unforgeable now that nobody is asked.
 */
test('ระบบรู้เอง — วันเกิดที่เก็บไว้ต่างหากที่เลือกคอลัมน์', () => {
  const session = { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' };

  const theirs = run(session, '1994-08-04');
  const colleague = run(session, '1990-11-23');
  const nobody = run(session, null);

  assert.equal(theirs.buckets[BUCKETS.OT15_HOLIDAY], 3);
  assert.equal(theirs.segments[0].dayReason, 'birthday');
  assert.equal(colleague.buckets[BUCKETS.OT15_WEEKDAY], 3);
  assert.equal(nobody.buckets[BUCKETS.OT15_WEEKDAY], 3);
});

/**
 * และทุกเส้นทางที่เขียนใบ resolve วันนั้นใหม่ทุกครั้ง.
 *
 * The correction the refusal existed for is still made, by arithmetic instead:
 * the commonest edit moves `workDate`, and a request dragged off a birthday
 * loses the birthday rates in the same save that moved it. That only holds
 * while every write path builds its own context rather than trusting one stored
 * on the entry — which is what `loadContext` is, and what this pins.
 */
test('ทุกเส้นทางที่เขียนใบ resolve ชนิดของวันใหม่เอง', () => {
  for (const file of WRITE_PATHS) {
    assert.match(read(file), /loadContext\(/, `${file} ไม่ได้สร้าง context ของวันใหม่`);
  }
  // And the resolution reads a birth date the browser never holds.
  const service = read('src/services/otService.js');
  assert.match(service, /resolveDayTypes\(/);
  assert.match(service, /birthDate/);
});

/**
 * ฟอร์มบอกเอง แทนที่จะถาม — the notice that replaced the box.
 *
 * `isOwnBirthday` reads `dayReason` off the very segments drawn underneath it,
 * so the sentence and the figures cannot disagree, and it needs no birth date:
 * `publicEmployee` still keeps `birthDate` off the roster the browser holds,
 * which is why this was a round trip when it was a claim and is a round trip
 * now that it is an answer.
 *
 * BOTH PLACES, because they say different halves. The ⓘ line at the top says
 * whether 08:00–17:00 counts at all — the ordinary sentence is false on a
 * birthday — and the Alert above the split carries the eight hours, which is
 * the half somebody can act on.
 */
test('ฟอร์มบอกเองว่าวันนั้นเป็นวันเกิด และบอกกฎ 8 ชั่วโมง', () => {
  const form = read('components/OtForm.jsx');

  assert.match(form, /function isOwnBirthday\(preview\) \{/);
  assert.match(form, /s\.dayReason === 'birthday'/);
  assert.match(form, /\{isOwnBirthday\(preview\)\s*\r?\n\s*\?/, 'บรรทัด ⓘ ไม่ได้อ่านจากพรีวิว');
  assert.match(
    form,
    /\{preview && !proxy && !hrEdit && isOwnBirthday\(preview\) && \(/,
    'ประกาศเหนือช่วงเวลาไม่ได้ขึ้นทุกใบที่ตรงวันเกิดแล้ว',
  );
  assert.match(form, /8 ชั่วโมงแรกที่ทำเข้าช่อง OT วันหยุด ×1\.5/);

  // Withheld on บันทึก OT แทนพนักงาน: it would tell a หัวหน้า when their team
  // member was born. The HOURS are unaffected — the server reads the stored
  // วันเกิด whoever is filing — which is the whole point of the notice being a
  // report rather than a control.
  assert.ok(!/\{preview && isOwnBirthday/.test(form));
});

/** และพรีวิวไม่ตอบสนามที่ไม่มีใครถามแล้ว. */
test('พรีวิวไม่ส่ง birthdayRefusal กลับมาอีก', () => {
  const preview = read('app/api/entries/preview/route.js');
  assert.match(preview, /return json\(\{\s*\r?\n\s*result, cap, routing, weekdayRefusal, conflict,\s*\r?\n\s*\}\);/);

  const form = read('components/OtForm.jsx');
  assert.ok(!/setBirthdayRefusal\(/.test(form));
  assert.ok(!/Boolean\(birthdayRefusal\)/.test(form));
});

// ── the badge the employee reads ────────────────────────────────────────────

/**
 * `isBirthdayWelfare` is what draws OT สวัสดิการวันเกิด on the employee's own
 * screens, and it is read off the ENGINE's answer — never off a tick, which was
 * never stored, and never off the description, which is free text. Unchanged by
 * the removal, and that is the point: it was already the honest half.
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
 * AND IT IS WHAT A RE-OPENED REQUEST IS DRAWN FROM. There is no
 * `birthdayWelfare` field on the entry and there never was — the engine's answer
 * is the only stored answer, and a second copy could disagree with it. The tick
 * used to be restored from this; now nothing has to be restored at all.
 */
test('เปิดใบเดิมมาแก้ — ไม่มีฟิลด์ให้เปิดกลับมา', () => {
  assert.ok(
    !/birthdayWelfare: \{ type: Boolean/.test(read('src/models/OtEntry.js')),
    'the tick got stored, and can now disagree with the hours',
  );
  assert.ok(!/birthdayWelfare: isBirthdayWelfare\(/.test(read('components/OtForm.jsx')));
  assert.ok(!/birthdayWelfare: isBirthdayWelfare\(/.test(read('components/ApprovalQueue.jsx')));
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
 * ใบเก่าที่ segment ไม่มี dayReason — reads as "not recorded" rather than as
 * "not a birthday", and neither draws the badge nor throws.
 */
test('ใบเก่าที่ segment ไม่มี dayReason — ไม่ติดป้าย และไม่พัง', () => {
  assert.equal(isBirthdayWelfare({ segments: [{ date: '2026-08-04', dayType: 'holiday' }] }), false);
  assert.equal(isBirthdayWelfare({ segments: [] }), false);
  assert.equal(isBirthdayWelfare({}), false);
  assert.equal(isBirthdayWelfare(null), false);
});

/**
 * ป้าย OT สวัสดิการวันเกิด ขึ้นครบทั้งสามที่บนหน้าของพนักงาน — the chip is
 * drawn wherever a decided request is read, and the reviewer's queue is one of
 * those places (2026-09-07): *ถ้าพนักงานติ๊กช่องเหมารายวันหรือวันเกิด ให้ขึ้น
 * แท็กในรายละเอียดหน้ารออนุมัติ OT ด้วย เพื่อให้ผู้อนุมัติรู้*.
 *
 * IT IS STILL NOT A TICK BEING READ BACK — and since 2026-09-08 there is no
 * tick for it to be. `isBirthdayWelfare` asks the segments the engine wrote, so
 * a row whose owner's วันเกิด was corrected after filing says what the hours ARE
 * rather than what was claimed.
 */
test('หน้ารออนุมัติ — ป้าย OT สวัสดิการวันเกิด ขึ้นทั้งในแถวและในป๊อปอัปรายละเอียด', () => {
  const queue = read('components/ApprovalQueue.jsx');
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
  const common = read('components/common.jsx');
  const mark = common.slice(common.indexOf('export function BirthdayWelfareMark'));
  const body = mark.slice(0, mark.indexOf('\n}'));
  assert.ok(
    !/ฝ่ายบุคคล/.test(body),
    'ป้ายวันเกิดกลับไปบอกว่าฝ่ายบุคคลเป็นผู้บันทึกและอนุมัติให้',
  );
});
