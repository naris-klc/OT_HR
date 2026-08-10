import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { makeIsHoliday, computeSession, resolveDayTypes, sessionDates, BUCKETS } from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import { cancelPermission, isUntouchedSystemFiling } from '../lib/entries.js';
import {
  birthdayCandidates, filedKey, SKIP_REASONS,
  BIRTHDAY_START, BIRTHDAY_END, BIRTHDAY_DESCRIPTION,
} from '../lib/birthdayEntries.js';

/**
 * ใบ OT วันเกิด — who the system proposes, and every reason it does not.
 *
 * The feature exists because the system knows who FILED and never who came in,
 * and the benefit was going unclaimed: nobody thinks to file an OT request for
 * 08:00–17:00 on an ordinary Wednesday. So HR is offered a list and unticks
 * whoever was off. That makes the LIST the thing to get right — a name proposed
 * wrongly becomes hours in the queue that nobody worked, and a name missing
 * becomes a benefit quietly withheld from one person for a year.
 *
 * August 2026 throughout, matching test/otBirthday.test.js: 4 Aug is a Tuesday,
 * 8 Aug a Saturday, 12 Aug (วันแม่) the company holiday.
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

/**
 * The month is over, so every August birthday has happened. Passed explicitly
 * because the rule refuses to guess the date — see the `notYet` tests below.
 */
const survey = (roster, over = {}) => birthdayCandidates({
  period: '2026-08', today: '2026-08-31', roster, isHoliday, policy: ON, ...over,
});

// ── who is proposed ─────────────────────────────────────────────────────────

test('วันเกิดตรงวันทำงานในเดือนนั้น — เข้ารายชื่อ พร้อมวันที่', () => {
  const tuesday = person({ birthDate: '1977-08-04' });
  const { ruleOff, eligible, skipped } = survey([tuesday]);

  assert.equal(ruleOff, false);
  assert.equal(skipped.length, 0);
  assert.deepEqual(eligible, [{
    employeeId: tuesday._id,
    code: tuesday.code,
    name: tuesday.name,
    department: 'วิศวกรรม',
    date: '2026-08-04',
  }]);
});

test('รายชื่อที่ส่งออกไม่มีวันเกิดติดไปด้วย', () => {
  // The date of the ENTRY goes out — it is the date of the request HR is about
  // to create. The date of birth does not, on any row, eligible or skipped.
  const { eligible, skipped } = survey([
    person({ birthDate: '1977-08-04' }),
    person({ birthDate: '1990-12-25' }),
  ]);

  for (const row of [...eligible, ...skipped]) {
    assert.ok(!('birthDate' in row), `แถวของ ${row.code} มี birthDate ติดไปด้วย`);
  }
});

test('วันเกิดเดือนอื่น ไม่เข้ารายชื่อ และบอกเหตุผล', () => {
  const { eligible, skipped } = survey([person({ birthDate: '1990-12-25' })]);
  assert.equal(eligible.length, 0);
  assert.equal(skipped[0].reason, 'otherMonth');
});

test('วันเกิดตรงเสาร์ หรือวันหยุดบริษัท — ไม่เสนอ เพราะกฎวันเกิดไม่ได้เพิ่มอะไร', () => {
  // The day is already วันหยุด for the whole company, nobody was expected in,
  // and the hours of somebody who did work it are an ordinary holiday OT
  // request they file themselves.
  const { eligible, skipped } = survey([
    person({ birthDate: '1990-08-08' }),  // Saturday
    person({ birthDate: '1988-08-12' }),  // วันแม่ — company holiday
  ]);

  assert.equal(eligible.length, 0);
  assert.deepEqual(skipped.map((s) => s.reason), ['alreadyHoliday', 'alreadyHoliday']);
});

test('ยังไม่มีวันเกิดในระบบ — อยู่ในรายการที่ข้าม ไม่ใช่หายไปเงียบ ๆ', () => {
  // The count on screen is what HR uses to decide whether the month is done.
  // A name that is neither proposed nor accounted for reads as "checked, fine".
  const { eligible, skipped } = survey([person({ birthDate: null })]);
  assert.equal(eligible.length, 0);
  assert.equal(skipped[0].reason, 'noBirthDate');
});

test('วันเกิดในระบบไม่ถูกต้อง — ข้ามคนเดียว ไม่ล้มทั้งรายชื่อ', () => {
  const { eligible, skipped } = survey([
    person({ birthDate: '1994-02-30' }),
    person({ birthDate: '1977-08-04' }),
  ]);

  assert.equal(eligible.length, 1, 'คนที่วันเกิดถูกต้องต้องยังถูกเสนอ');
  assert.equal(skipped[0].reason, 'badBirthDate');
});

test('มีใบของวันนั้นอยู่แล้ว — ไม่เสนอซ้ำ (กดปุ่มสองครั้งไม่ได้ใบสองใบ)', () => {
  const p = person({ birthDate: '1977-08-04' });
  const filed = new Set([filedKey(p._id, '2026-08-04')]);

  const { eligible, skipped } = survey([p], { filed });
  assert.equal(eligible.length, 0);
  assert.equal(skipped[0].reason, 'alreadyFiled');

  // …and the key is per person per date, so somebody else's filing on the same
  // day does not withhold this person's proposal.
  const other = person({ birthDate: '1977-08-04' });
  assert.equal(survey([other], { filed }).eligible.length, 1);
});

test('ใบของวันเดียวกันแต่คนละวัน ไม่บล็อกกัน', () => {
  const p = person({ birthDate: '1977-08-04' });
  const filed = new Set([filedKey(p._id, '2026-08-05')]);
  assert.equal(survey([p], { filed }).eligible.length, 1);
});

// ── the rule itself ────────────────────────────────────────────────────────

test('กฎวันหยุดวันเกิดปิดอยู่ — ไม่เสนอใคร และบอกว่าเพราะกฎปิด', () => {
  // Filing 08:00–17:00 with the rule off would put a full working day into the
  // ×1.5 weekday column for a day nobody was owed off.
  const out = survey([person({ birthDate: '1977-08-04' })], { policy: OFF });
  assert.equal(out.ruleOff, true);
  assert.deepEqual(out.eligible, []);
  assert.deepEqual(out.skipped, []);
});

test('วันเกิด 29 ก.พ. — ตามนโยบายปีที่ไม่ใช่อธิกสุรทิน', () => {
  const p = person({ birthDate: '2000-02-29' });
  const at = (period, policy) => birthdayCandidates({
    period, today: '2028-12-31', roster: [p], isHoliday, policy,
  });

  // 2027 is not a leap year. 28 Feb 2027 is a Sunday, so 'feb28' lands on a day
  // that is already a holiday — the answer is "nothing to propose", and it comes
  // from the ordinary weekend rule rather than a special case.
  assert.equal(at('2027-02', { ...ON, birthdayLeapFallback: 'feb28' }).skipped[0].reason, 'alreadyHoliday');

  // 'mar01' moves the holiday out of the month the birthday is in — 1 Mar 2027
  // is a Monday. Which month the proposal appears in follows the DATE OF THE
  // HOLIDAY and not the date of birth, because the entry it creates belongs to
  // the month it will be paid in.
  const mar01 = { ...ON, birthdayLeapFallback: 'mar01' };
  assert.equal(at('2027-02', mar01).skipped[0].reason, 'otherMonth');
  assert.equal(at('2027-03', mar01).eligible[0].date, '2027-03-01');

  // And 'none' is an answer HR chose, not a missing value.
  assert.equal(at('2027-02', { ...ON, birthdayLeapFallback: 'none' }).skipped[0].reason, 'leapSkipped');

  // In a leap year none of that applies.
  assert.equal(at('2028-02', ON).eligible[0].date, '2028-02-29');
});

test('วันเกิดที่ยังไม่ถึง ไม่ถูกเสนอ', () => {
  // Whether somebody works their birthday is a fact about a day that has
  // happened. Offering it in advance asks HR to confirm hours for a shift nobody
  // has worked — and the entry it creates is approved on the spot.
  const p = person({ birthDate: '1977-08-20' });
  const on = (today) => birthdayCandidates({
    period: '2026-08', today, roster: [p], isHoliday, policy: ON,
  });

  assert.equal(on('2026-08-19').skipped[0].reason, 'notYet');
  // The day itself counts as arrived — HR closes the queue in the evening.
  assert.equal(on('2026-08-20').eligible[0].date, '2026-08-20');
  assert.equal(on('2026-08-21').eligible.length, 1);
});

test('ไม่ส่ง today มา ต้อง throw ไม่ใช่เงียบ ๆ ปล่อยผ่าน', () => {
  // A default would switch the guard off in exactly the case it exists for: a
  // caller that has not heard of it would file confirmed OT for a future date and
  // nothing would fail. Same reason `computeSession` throws on a date missing
  // from its dayTypes map.
  const roster = [person({ birthDate: '1977-08-04' })];
  assert.throws(
    () => birthdayCandidates({ period: '2026-08', roster, isHoliday, policy: ON }),
    /today/,
  );
  assert.throws(
    () => birthdayCandidates({ period: '2026-08', today: '31/08/2026', roster, isHoliday, policy: ON }),
    /today/,
  );
});

test('ทุกเหตุผลที่ข้ามมีคำอธิบายเป็นภาษาไทยให้หน้าจอ', () => {
  // A reason with no label prints its own key to HR.
  const reasons = ['noBirthDate', 'badBirthDate', 'otherMonth', 'alreadyHoliday',
    'alreadyFiled', 'leapSkipped', 'notYet', 'notEligible', 'noHours', 'capBlocked'];
  for (const key of reasons) {
    assert.ok(SKIP_REASONS[key], `ไม่มีคำอธิบายของเหตุผล ${key}`);
  }
});

test('เรียงตามรหัสพนักงาน ทั้งรายชื่อที่เสนอและที่ข้าม', () => {
  const a = person({ code: 'PM-0900', birthDate: '1977-08-04' });
  const b = person({ code: 'PM-0100', birthDate: '1977-08-05' });
  const c = person({ code: 'PM-0500', birthDate: '1990-12-01' });
  const d = person({ code: 'PM-0200', birthDate: null });

  const { eligible, skipped } = survey([a, b, c, d]);
  assert.deepEqual(eligible.map((e) => e.code), ['PM-0100', 'PM-0900']);
  assert.deepEqual(skipped.map((e) => e.code), ['PM-0200', 'PM-0500']);
});

// ── the entry the proposal turns into ──────────────────────────────────────

test('08:00–17:00 ในวันเกิดที่ตรงวันทำงาน = 8 ชม. ในช่อง ×1.5 วันหยุด', () => {
  // The figure on the paper this replaces: THT0018's row reads 8.00 in the 1.50
  // column. Nine hours less the lunch break the policy deducts, in the holiday
  // bucket because the day is that person's holiday.
  const session = {
    workDate: '2026-08-04',
    startTime: BIRTHDAY_START,
    endTime: BIRTHDAY_END,
    endsNextDay: false,
    noBreakTaken: false,
  };
  const dayTypes = resolveDayTypes(sessionDates(session), {
    isHoliday, birthDate: '1977-08-04', policy: ON,
  });
  const result = computeSession(session, { policy: ON, dayTypes });

  assert.equal(result.buckets[BUCKETS.OT15_HOLIDAY], 8);
  assert.equal(result.buckets[BUCKETS.OT15_WEEKDAY], 0);
  assert.equal(result.buckets[BUCKETS.OT3_HOLIDAY], 0);
  assert.equal(result.segments[0].dayReason, 'birthday');

  // Which is what puts “วันเกิด” beside the row on สรุป OT ส่งบัญชี — the
  // remark is read off this segment. See test/birthdayOnPaper.test.js.
});

test('ถ้าวันนั้นไม่ใช่วันหยุดของเขา ชั่วโมงเดียวกันไม่เป็น OT เลย', () => {
  // The engine's own veto, and the reason the route computes before it writes:
  // 08:00–17:00 on an ordinary day is working time, and an entry of nought
  // hours would sit in HR's queue looking like a request.
  const session = {
    workDate: '2026-08-05',
    startTime: BIRTHDAY_START,
    endTime: BIRTHDAY_END,
    endsNextDay: false,
    noBreakTaken: false,
  };
  const result = computeSession(session, {
    policy: ON,
    dayTypes: resolveDayTypes(sessionDates(session), { isHoliday, birthDate: null, policy: ON }),
  });
  assert.equal(result.totals.otHours, 0);
});

// ── the route: what it may be asked for ────────────────────────────────────

/**
 * The endpoint cannot be imported (it resolves `@/…` through the Next alias),
 * so these read it as text. What they pin is the shape of the authority: fixed
 * hours, HR only, entries that wait for a confirmation, and a POST that takes
 * ids and derives everything else itself.
 */
const ROUTE = 'app/api/entries/birthday/[period]/route.js';
const src = readFileSync(join(ROOT, ROUTE), 'utf8');

/**
 * The route with its prose removed, for the checks that are about what the code
 * does. This file's comments discuss approving and `proxyPermission` at length
 * precisely because it does neither, and a text search over the whole file would
 * be satisfied by the explanation instead of the behaviour.
 */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('route อ่านวันนี้จากนาฬิกาเดียวของระบบ', () => {
  // The one impure input, in one place. A route that took it from the client
  // could be told that next Tuesday has already happened.
  assert.match(code, /today: today\(\)/);
  assert.ok(!/payload\.today|q\.today/.test(code), 'วันนี้ต้องไม่มาจาก client');
});

test('POST รับเฉพาะรายชื่อพนักงาน — วันที่และเวลามาจากฝั่งเซิร์ฟเวอร์เท่านั้น', () => {
  assert.match(src, /payload\.employeeIds/, 'ต้องรับเฉพาะ employeeIds');
  for (const field of ['payload.workDate', 'payload.startTime', 'payload.endTime', 'payload.date']) {
    assert.ok(!src.includes(field), `${field} ไม่ควรถูกอ่านจาก client`);
  }
  // The date comes from the candidate the server just derived.
  assert.match(src, /workDate: candidate\.date/);
  assert.match(src, /startTime: BIRTHDAY_START/);
});

test('ใบถูกสร้างและยืนยันในคำสั่งเดียว แต่ประวัติบอกทั้งสองเหตุการณ์ตามลำดับ', () => {
  // ฝ่ายบุคคล ticking a name IS the confirmation — a second press by the same
  // person on the same list checks nothing. What must not happen is a row that
  // arrives `approved` having been filed by nobody: the trail is written as
  // ยื่น → ยืนยัน, with one name and one moment on both.
  assert.match(code, /status: 'pending_hr'/);
  assert.match(code, /entry\.log\(user, 'submit_birthday'/);
  assert.match(code, /entry\.status = 'approved'/);
  assert.match(code, /entry\.log\(user, 'approve_hr', BIRTHDAY_CONFIRM_NOTE, 'pending_hr'\)/);
  assert.ok(
    code.indexOf("'submit_birthday'") < code.indexOf("entry.status = 'approved'"),
    'ต้องบันทึกการยื่นก่อนจึงเปลี่ยนเป็นอนุมัติ',
  );

  // Nobody signed as หัวหน้า, and a row claiming otherwise would be exactly the
  // lie `initialStatus` in lib/proxyFiling.js refuses to tell.
  assert.ok(!/managerDecision/.test(code), 'ต้องไม่แต่งว่าหัวหน้าเซ็นแล้ว');
  assert.match(code, /entry\.hrDecision = \{ by: user\._id/, 'การยืนยันต้องมีชื่อคนและเวลา');
});

test('ใบที่สร้างแล้วยังถอนคืนได้ ตราบที่ยังไม่มีใครแตะ', () => {
  // The safeguard that replaces the queue. Without it one mis-ticked checkbox is
  // permanent: `approvalPermission` acts only on pending_*, cancelPermission only
  // before the first signature, and there is no delete anywhere in the API.
  const untouched = {
    status: 'approved',
    history: [{ action: 'submit_birthday' }, { action: 'approve_hr' }],
  };
  const hr = { _id: 'hr-1', role: 'hr' };

  assert.equal(isUntouchedSystemFiling(untouched), true);
  assert.deepEqual(cancelPermission(hr, untouched), { ok: true, action: 'void' });

  // …and it is the SAME endpoint the employee's own withdrawal goes through, so
  // the trail has to distinguish the two acts.
  const cancelRoute = readFileSync(join(ROOT, 'app/api/entries/[id]/cancel/route.js'), 'utf8');
  assert.match(cancelRoute, /allowed\.action === 'void' \? 'void' : 'cancel'/);
  assert.match(readFileSync(join(ROOT, 'src/models/OtEntry.js'), 'utf8'), /'cancel', 'void'/);
});

test('ใบที่มีคนแตะแล้ว ถอนไม่ได้อีก', () => {
  const hr = { _id: 'hr-1', role: 'hr' };
  const cases = [
    ['ฝ่ายบุคคลแก้ไขไปแล้ว', { action: 'hr_edit' }],
    ['พนักงานแก้ไขไปแล้ว', { action: 'edit' }],
    ['หัวหน้าอนุมัติเพิ่ม', { action: 'approve_mgr' }],
  ];

  for (const [why, extra] of cases) {
    const entry = {
      status: 'approved',
      history: [{ action: 'submit_birthday' }, { action: 'approve_hr' }, extra],
    };
    assert.equal(isUntouchedSystemFiling(entry), false, why);
    assert.equal(cancelPermission(hr, entry).ok, false, `${why} — ต้องถอนไม่ได้`);
  }

  // A manager's signature closes the door even when the history is silent about
  // it, because that is a decision somebody else may now be relying on.
  assert.equal(isUntouchedSystemFiling({
    status: 'approved',
    managerDecision: { at: new Date() },
    history: [{ action: 'submit_birthday' }, { action: 'approve_hr' }],
  }), false);

  // A policy replay is not a person: it restates the same generated hours and
  // leaves the row as unreviewed as it was.
  assert.equal(isUntouchedSystemFiling({
    status: 'approved',
    history: [{ action: 'submit_birthday' }, { action: 'approve_hr' }, { action: 'recompute' }],
  }), true);
});

test('ใบที่คนกรอกเองไม่เข้าข่ายถอนโดยฝ่ายบุคคล', () => {
  // The door is for generated rows only. An ordinary approved request is a figure
  // somebody signed for, and taking it off the books is a replay with a reason —
  // not a button.
  const hr = { _id: 'hr-1', role: 'hr' };
  for (const action of ['submit', 'submit_proxy']) {
    const entry = { status: 'approved', history: [{ action }, { action: 'approve_hr' }] };
    assert.equal(isUntouchedSystemFiling(entry), false, action);
    assert.equal(cancelPermission(hr, entry).ok, false, action);
  }
});

test('เจ้าตัวยังยกเลิกใบของตนเองได้เหมือนเดิม — กฎเดิมไม่ถูกแตะ', () => {
  // The new branch is checked first, so this is the guard that it did not take
  // anything away from the rule it sits in front of.
  const employee = { _id: 'emp-1', role: 'employee' };
  assert.deepEqual(
    cancelPermission(employee, { employee: 'emp-1', status: 'pending_mgr', history: [{ action: 'submit' }] }),
    { ok: true },
  );
  assert.equal(
    cancelPermission(employee, { employee: 'emp-1', status: 'approved', history: [{ action: 'submit' }] }).ok,
    false,
  );
});

test('เฉพาะ HR และ Admin และไม่ได้ไปขยาย proxyPermission', () => {
  assert.match(code, /requireRole\(await requireAuth\(req\), 'hr', 'admin'\)/);
  assert.ok(
    !/proxyPermission/.test(code),
    'ใช้ proxyPermission ที่นี่คือการเปิดสิทธิ์บันทึกแทนแบบทั่วไปให้ HR ไปด้วย',
  );
});

test('ทุกใบผ่านเครื่องคำนวณและเพดานแผนกเหมือนใบที่คนกรอกเอง', () => {
  assert.match(src, /computeSession\(session, ctx\)/);
  assert.match(src, /applyComputation\(entry, result, ctx\)/, 'ต้องกำกับเวอร์ชันนโยบายด้วย');
  assert.match(src, /result\.totals\.otHours <= 0/);
  assert.match(src, /cap\.blocked/);
  assert.match(src, /stampCap\(entry, cap\)/);
});

test('ประวัติของใบบอกว่าระบบสร้าง ไม่ใช่ว่าใครกรอก', () => {
  assert.match(src, /entry\.log\(user, 'submit_birthday', BIRTHDAY_NOTE/);

  // The action has to be a value the model accepts, and it has to read as
  // something other than "บันทึกแทน" on screen.
  const model = readFileSync(join(ROOT, 'src/models/OtEntry.js'), 'utf8');
  assert.match(model, /'submit_birthday'/, 'enum ของ history ยังไม่รู้จัก action นี้');

  const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');
  assert.match(common, /submit_birthday: \{ label: 'ระบบสร้างใบวันเกิด/);
  assert.match(common, /isSystemFiled/, 'ชิปบนหน้าจอต้องแยกใบที่ระบบสร้างออกจากใบที่หัวหน้าบันทึกแทน');
});

test('รายละเอียดงานที่ทำของใบวันเกิด ผ่านกฎเดียวกับใบทั่วไป', () => {
  // It prints in the รายละเอียดงานที่ทำ cell of F-HR-027, so it has to be
  // something a reader can act on — and non-empty, or the entry cannot save.
  assert.ok(BIRTHDAY_DESCRIPTION.trim().length > 0);
  assert.match(BIRTHDAY_DESCRIPTION, /วันเกิด/);
  assert.equal(BIRTHDAY_END, '17:00');
});
