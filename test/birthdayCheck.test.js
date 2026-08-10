import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { makeIsHoliday, computeSession, resolveDayTypes, sessionDates } from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import { birthdayCheck, filedKey, UNCHECKABLE } from '../lib/birthdayCheck.js';
import { noOtHoursMessage } from '../lib/entries.js';

/**
 * วันเกิดที่ยังไม่มีใบ — the list HR reads, and everything it must not do.
 *
 * The rule makes a birthday falling Mon–Fri a holiday for one person, and that
 * day looks like any other working day — same shift, same colleagues, nothing on
 * any calendar. So the request goes unfiled, unlike a Saturday, which announces
 * itself. This list is the only place that asymmetry is visible.
 *
 * What is pinned here is mostly what stays OFF the list, because every wrong name
 * on it sends HR to ask a หัวหน้า about hours that were never owed: a weekend
 * birthday, one on a company holiday, one already filed. And the second list —
 * "cannot check" — because a roster with no วันเกิด in it must not read as a
 * clean month.
 *
 * August 2026, as everywhere else: 4 Aug is a Tuesday, 8 Aug a Saturday, 12 Aug
 * (วันแม่) the company holiday.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOLIDAYS = ['2026-08-12'];
const isHoliday = makeIsHoliday(HOLIDAYS);

const ON = { ...DEFAULT_POLICY, birthdayHolidayEnabled: true };
const OFF = { ...DEFAULT_POLICY, birthdayHolidayEnabled: false };

let seq = 0;
const person = (over = {}) => ({
  _id: `id${(seq += 1)}`,
  code: `PM-0${100 + seq}`,
  name: `คนที่ ${seq}`,
  role: 'employee',
  active: true,
  department: { _id: 'd1', nameTh: 'วิศวกรรม' },
  ...over,
});

/** The month is over, so every August birthday has happened. */
const check = (roster, over = {}) => birthdayCheck({
  period: '2026-08', today: '2026-08-31', roster, isHoliday, policy: ON, ...over,
});

// ── what belongs on the list ────────────────────────────────────────────────

test('วันเกิดตรงวันอังคาร ไม่มีใบ — ขึ้นรายการ พร้อมแผนกและบริษัท', () => {
  const p = person({ birthDate: '1977-08-04', code: 'THT0018' });
  const { ruleEnabled, needsEntry, uncheckable } = check([p]);

  assert.equal(ruleEnabled, true);
  assert.equal(uncheckable.length, 0);
  assert.deepEqual(needsEntry, [{
    employeeId: p._id,
    code: 'THT0018',
    name: p.name,
    department: 'วิศวกรรม',
    departmentId: 'd1',
    // Read from the code prefix when the field is unset — the same rule
    // สรุป OT ส่งบัญชี partitions by, from one place (src/config/companies.js).
    company: 'themtech',
    date: '2026-08-04',
    upcoming: false,
  }]);
});

test('บริษัทมาจากฟิลด์ที่เก็บไว้ก่อน แล้วจึงเป็นรหัสพนักงาน', () => {
  const stored = person({ birthDate: '1977-08-04', code: 'THT0001', company: 'primus' });
  assert.equal(check([stored]).needsEntry[0].company, 'primus');
});

test('วันที่ยังไม่ถึง ขึ้นรายการแต่ติดป้ายว่ายังไม่ถึงวัน', () => {
  // Still worth seeing — HR is reading the month — but nobody can be asked about
  // a shift that has not happened, so the row says so rather than being chased.
  const p = person({ birthDate: '1977-08-20' });
  const rows = birthdayCheck({
    period: '2026-08', today: '2026-08-10', roster: [p], isHoliday, policy: ON,
  }).needsEntry;

  assert.equal(rows.length, 1);
  assert.equal(rows[0].upcoming, true);
});

test('เรียงตามวันที่ แล้วจึงตามรหัส', () => {
  const rows = check([
    person({ code: 'PM-0900', birthDate: '1977-08-20' }),
    person({ code: 'PM-0100', birthDate: '1977-08-04' }),
    person({ code: 'PM-0050', birthDate: '1980-08-20' }),
  ]).needsEntry;

  assert.deepEqual(rows.map((r) => `${r.date} ${r.code}`), [
    '2026-08-04 PM-0100', '2026-08-20 PM-0050', '2026-08-20 PM-0900',
  ]);
});

// ── what must stay off it ──────────────────────────────────────────────────

test('วันเกิดตรงเสาร์ ไม่ขึ้นรายการ', () => {
  // Nobody was expected at work, the day was already วันหยุด for the whole
  // company, and the birthday rule added nothing to it. This is the asymmetry the
  // list exists for: a Saturday explains itself, a Tuesday does not.
  const { needsEntry } = check([person({ birthDate: '1990-08-08' })]);
  assert.deepEqual(needsEntry, []);
});

test('วันเกิดตรงวันหยุดบริษัท ไม่ขึ้นรายการ', () => {
  const { needsEntry } = check([person({ birthDate: '1988-08-12' })]);
  assert.deepEqual(needsEntry, []);
});

test('มีใบของวันนั้นแล้ว ไม่ขึ้นรายการ — ทุกสถานะนับว่ามีใบ', () => {
  // The question is whether the day was OVERLOOKED. A request that was filed and
  // then refused, or withdrawn, was not overlooked by anybody — and putting it
  // back on the list would send HR to ask about a decision somebody already made.
  const p = person({ birthDate: '1977-08-04' });
  const filed = new Set([filedKey(p._id, '2026-08-04')]);

  assert.deepEqual(check([p], { filed }).needsEntry, []);

  // Per person per date: somebody else's ใบ on the same day withholds nothing,
  // and this person's ใบ on another day withholds nothing either.
  assert.equal(check([person({ birthDate: '1977-08-04' })], { filed }).needsEntry.length, 1);
  const elsewhere = new Set([filedKey(p._id, '2026-08-05')]);
  assert.equal(check([p], { filed: elsewhere }).needsEntry.length, 1);
});

test('วันเกิดเดือนอื่น ไม่ขึ้นรายการของเดือนนี้', () => {
  assert.deepEqual(check([person({ birthDate: '1990-12-25' })]).needsEntry, []);
});

test('กฎวันหยุดวันเกิดปิดอยู่ — ไม่ขึ้นอะไรเลย แม้แต่รายการที่ตรวจไม่ได้', () => {
  // With the rule off a birthday is an ordinary working day: no hours are owed,
  // so no ใบ is missing and nothing needs checking. The flag is returned so the
  // screen can stay silent for a reason rather than look like a clean month.
  const out = check([
    person({ birthDate: '1977-08-04' }),
    person({ birthDate: null }),
  ], { policy: OFF });

  assert.equal(out.ruleEnabled, false);
  assert.deepEqual(out.needsEntry, []);
  assert.deepEqual(out.uncheckable, []);
});

// ── the second list: cannot check ──────────────────────────────────────────

test('ไม่มี birthDate — ขึ้นรายการที่สองว่าตรวจไม่ได้ ไม่ใช่เงียบไป', () => {
  const p = person({ birthDate: null });
  const { needsEntry, uncheckable } = check([p]);

  assert.deepEqual(needsEntry, []);
  assert.equal(uncheckable.length, 1);
  assert.equal(uncheckable[0].reason, 'missing');
  assert.equal(uncheckable[0].code, p.code);
  assert.ok(UNCHECKABLE.missing, 'ต้องมีคำอธิบายให้หน้าจอ');
});

test('วันเกิดในระบบใช้ไม่ได้ — ตรวจไม่ได้ ไม่ใช่ไม่มีอะไรค้าง', () => {
  // 30 February in the roster. "Cannot tell" and "nothing owed" are different
  // answers, and only one of them is safe to show as an empty list.
  const { needsEntry, uncheckable } = check([person({ birthDate: '1994-02-30' })]);
  assert.deepEqual(needsEntry, []);
  assert.equal(uncheckable[0].reason, 'invalid');
  assert.ok(UNCHECKABLE.invalid);
});

test('คนที่ตรวจไม่ได้ ไม่ทำให้คนอื่นหลุดรายการ', () => {
  const rows = check([
    person({ birthDate: '1994-02-30' }),
    person({ birthDate: null }),
    person({ birthDate: '1977-08-04' }),
  ]);
  assert.equal(rows.needsEntry.length, 1);
  assert.equal(rows.uncheckable.length, 2);
});

test('รายการทั้งสองไม่พา birthDate ออกไปด้วย', () => {
  // ตรวจสอบรายเดือน is open to หัวหน้า for their own team, and a date of birth is
  // not theirs to read. The endpoint is HR-only on top of this; the payload does
  // not rely on that being remembered. What goes out is the date of the HOLIDAY.
  const rows = check([
    person({ birthDate: '1977-08-04' }),
    person({ birthDate: null }),
    person({ birthDate: '1994-02-30' }),
  ]);
  for (const r of [...rows.needsEntry, ...rows.uncheckable]) {
    assert.ok(!('birthDate' in r), `${r.code} มี birthDate ติดไปด้วย`);
  }
});

test('ไม่ส่ง today มา ต้อง throw ไม่ใช่เดาเอา', () => {
  assert.throws(
    () => birthdayCheck({ period: '2026-08', roster: [person({ birthDate: '1977-08-04' })], isHoliday, policy: ON }),
    /today/,
  );
});

test('29 ก.พ. ตามนโยบายปีที่ไม่ใช่อธิกสุรทิน', () => {
  const p = person({ birthDate: '2000-02-29' });
  const at = (period, policy) => birthdayCheck({
    period, today: '2028-12-31', roster: [p], isHoliday, policy,
  });

  // 28 Feb 2027 is a Sunday — already a holiday, so nothing is missing.
  assert.deepEqual(at('2027-02', { ...ON, birthdayLeapFallback: 'feb28' }).needsEntry, []);
  // 'mar01' moves the holiday into March, and the list follows the holiday.
  assert.deepEqual(at('2027-02', { ...ON, birthdayLeapFallback: 'mar01' }).needsEntry, []);
  assert.equal(at('2027-03', { ...ON, birthdayLeapFallback: 'mar01' }).needsEntry[0].date, '2027-03-01');
  // 'none' — no holiday is owed that year at all, so nothing is missing either.
  assert.deepEqual(at('2027-02', { ...ON, birthdayLeapFallback: 'none' }).needsEntry, []);
  // In a leap year, 29 Feb 2028 is a Tuesday.
  assert.equal(at('2028-02', ON).needsEntry[0].date, '2028-02-29');
});

// ── the screen reads, it does not write ────────────────────────────────────

/**
 * ฝ่ายบุคคล cannot know whether somebody was at work on their birthday, or until
 * what hour. So this list reports and stops, and the way a missing ใบ gets filed
 * is the หัวหน้า's existing proxy path. Pinned as text because the route resolves
 * `@/…` through the Next alias, which node --test does not.
 */
test('เส้นทางนี้อ่านอย่างเดียว — ไม่มีทางสร้างใบจากรายการนี้', () => {
  const route = readFileSync(join(ROOT, 'app/api/reports/birthday-check/[period]/route.js'), 'utf8');
  const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.match(code, /export const GET =/);
  assert.ok(!/export const (POST|PATCH|PUT|DELETE)/.test(code), 'route นี้ต้องไม่มีทางเขียนอะไรเลย');
  assert.ok(!/new OtEntry|entry\.save\(\)/.test(code), 'ต้องไม่สร้างใบ');
  assert.match(code, /requireRole\(await requireAuth\(req\), 'hr', 'admin'\)/);

  // The หัวหน้า's name rides along, because that is what HR does next.
  assert.match(code, /role: 'manager'/);
});

test('หน้าจอไม่มีปุ่มสร้างใบจากรายการนี้', () => {
  const view = readFileSync(join(ROOT, 'components/HrView.jsx'), 'utf8');
  const section = view.slice(view.indexOf('function BirthdayCheck'));
  assert.ok(!/api\.post|api\.patch/.test(section), 'ส่วนนี้ต้องไม่เขียนอะไรลงระบบ');
  assert.match(section, /หัวหน้า/, 'ต้องบอกว่าใครเป็นคนบันทึกแทนได้');
});

// ── 0-hour submissions are refused, in words ──────────────────────────────

test('ใบที่ได้ 0 ชั่วโมงถูกปฏิเสธ พร้อมเหตุผลที่อ่านรู้เรื่อง', () => {
  // 08:00–17:00 on an ordinary Wednesday: every minute is normal working time, so
  // the engine keeps nothing. Storing that as a 0-hour request would put a row in
  // HR's queue and a line on F-HR-027 saying somebody worked no overtime.
  const session = {
    workDate: '2026-08-05', startTime: '08:00', endTime: '17:00', endsNextDay: false,
  };
  const dayTypes = resolveDayTypes(sessionDates(session), { isHoliday, birthDate: null, policy: ON });
  const result = computeSession(session, { policy: ON, dayTypes });

  assert.equal(result.totals.otHours, 0);
  assert.equal(result.warnings[0].code, 'NORMAL_HOURS_IGNORED');

  const message = noOtHoursMessage(session, ON, dayTypes);
  assert.match(message, /08:00–17:00/, 'ต้องบอกช่วงเวลาที่ไม่นับ');
  assert.match(message, /วันทำงานปกติ/);
  assert.match(message, /วันเกิด/, 'ควรบอกทางออกด้วยว่าวันหยุด/วันเกิดนับทั้งวัน');
  assert.ok(!/NORMAL_HOURS_IGNORED/.test(message), 'ข้อความนี้ให้คนอ่าน ไม่ใช่โค้ด');
});

test('ข้อความบอกเวลาตามนโยบายที่ตั้งไว้ ไม่ใช่ 08:00–17:00 ตายตัว', () => {
  const shifted = { ...ON, coreStartMinute: 9 * 60, coreEndMinute: 18 * 60 + 30 };
  const message = noOtHoursMessage({ workDate: '2026-08-05' }, shifted, null);
  assert.match(message, /09:00–18:30/);
});

test('ถ้าวันนั้นเป็นวันหยุดอยู่แล้ว ข้อความต้องไม่อ้างเรื่องเวลาทำงานปกติ', () => {
  // On a holiday there is no normal working time, so a nought means the break
  // rule or the rounding ate the session — a different answer to a different
  // question, and confidently giving the wrong one is worse than being vague.
  const session = { workDate: '2026-08-08', startTime: '12:00', endTime: '12:20' };
  const message = noOtHoursMessage(session, ON, { '2026-08-08': { type: 'holiday', reason: 'weekend' } });
  assert.match(message, /หักเวลาพักและปัดเศษ/);
  assert.ok(!/ไม่นับเป็น OT/.test(message));
});

test('ทุกเส้นทางที่เขียนใบ ใช้ข้อความเดียวกัน', () => {
  // Four write paths on two servers. A copy per route is four sentences to keep
  // in step, and the one that drifts is the one somebody reads.
  for (const file of [
    'app/api/entries/route.js',
    'app/api/entries/[id]/route.js',
    'src/routes/entries.js',
  ]) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.match(src, /noOtHoursMessage\(session, ctx\.policy, ctx\.dayTypes\)/, file);
    assert.ok(
      !/'ช่วงเวลานี้อยู่ในเวลาทำงานปกติทั้งหมด/.test(src),
      `${file} ยังมีข้อความเดิมฝังอยู่`,
    );
  }
});

// ── the form tells the filer why their birthday looks different ───────────

test('ฟอร์มยื่นใบอ่านเหตุผลจาก preview ไม่ได้คำนวณวันเกิดเองในเบราว์เซอร์', () => {
  const form = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');

  assert.match(form, /function isOwnBirthday\(preview\)/);
  assert.match(form, /s\.dayReason === 'birthday'/);
  // Only on the filer's own form. A proxy filing would be telling a หัวหน้า when
  // their team member was born.
  assert.match(form, /preview && !proxy && !hrEdit && isOwnBirthday\(preview\)/);
  assert.ok(!/birthDate/.test(form), 'ฟอร์มต้องไม่แตะวันเกิดของใครเลย');
});
