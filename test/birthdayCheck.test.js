import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { makeIsHoliday, computeSession, resolveDayTypes, sessionDates } from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import {
  birthdayMonth, filedKey, latestChecks, UNCHECKABLE, OUTCOME, BIRTHDAY_OUTCOMES,
  BIRTHDAY_STATUS, STATUS_LABEL_TH, SETTLED_STATUSES,
} from '../lib/birthdayCheck.js';
import { noOtHoursMessage } from '../lib/entries.js';

/**
 * วันเกิดของเดือนนี้ — the month table HR closes a period against.
 *
 * The rule makes a birthday falling Mon–Fri a holiday for one person, and that
 * day looks like any other working day — same shift, same colleagues, nothing on
 * any calendar. So the request goes unfiled, unlike a Saturday, which announces
 * itself.
 *
 * WHAT IS PINNED HERE IS THAT EVERY BIRTHDAY GETS AN ANSWER. This used to be two
 * lists — "needs a ใบ" and "cannot check" — and everything else was invisible: a
 * weekend birthday, one already filed, one already checked were all simply
 * missing, and absence is not an answer. HR closing August could not tell
 * "settled" from "nobody looked". So the table holds one row per birthday with
 * one of five statuses, and only one of those statuses is work.
 *
 * August 2026, as everywhere else: 4 Aug is a Tuesday, 8 Aug a Saturday, 12 Aug
 * (วันแม่) the company holiday.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Source with comments removed — so a rule cannot be "found" in prose about it. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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
const month = (roster, over = {}) => birthdayMonth({
  period: '2026-08', today: '2026-08-31', roster, isHoliday, policy: ON, ...over,
});

const statusOf = (out, code) => out.rows.find((r) => r.code === code)?.status;

const entry = (over = {}) => ({
  _id: 'x1', employee: 'e1', workDate: '2026-08-04', status: 'approved',
  totals: { otHours: 8 }, ...over,
});

const aCheck = (over = {}) => ({
  _id: 'c1', employee: 'e1', workDate: '2026-08-04',
  outcome: OUTCOME.ABSENT, checkedAt: new Date('2026-08-05T03:00:00Z'), ...over,
});

// ── every birthday gets one of five answers ────────────────────────────────

test('ทุกคนที่เกิดเดือนนั้นขึ้นตาราง พร้อมสถานะคนละแบบ', () => {
  const roster = [
    person({ _id: 'e1', code: 'A', birthDate: '1977-08-04' }), // Tue — filed
    person({ _id: 'e2', code: 'B', birthDate: '1980-08-05' }), // Wed — checked away
    person({ _id: 'e3', code: 'C', birthDate: '1985-08-06' }), // Thu — nobody answered
    person({ _id: 'e4', code: 'D', birthDate: '1990-08-08' }), // Sat
    person({ _id: 'e5', code: 'E', birthDate: '1988-08-12' }), // วันแม่
    person({ _id: 'e6', code: 'F', birthDate: '1992-08-26' }), // not yet
  ];

  const out = birthdayMonth({
    period: '2026-08', today: '2026-08-16', roster, isHoliday, policy: ON,
    entries: [entry()],
    checks: [aCheck({ employee: 'e2', workDate: '2026-08-05', checkedByName: 'มาลี' })],
  });

  assert.equal(out.ruleEnabled, true);
  assert.equal(out.rows.length, 6, 'ต้องขึ้นทุกคน ไม่ใช่เฉพาะที่ค้าง');
  assert.equal(statusOf(out, 'A'), 'filed');
  assert.equal(statusOf(out, 'B'), 'absent');
  assert.equal(statusOf(out, 'C'), 'due');
  assert.equal(statusOf(out, 'D'), 'holiday');
  assert.equal(statusOf(out, 'E'), 'holiday');
  assert.equal(statusOf(out, 'F'), 'upcoming');

  // Date order, then code — a report is read down the month.
  assert.deepEqual(out.rows.map((r) => r.date), [
    '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-08', '2026-08-12', '2026-08-26',
  ]);

  // And the counts above the table. `done` is the three settled statuses, so the
  // four numbers add up to the first and a reader can check them against each
  // other — "เดือนนี้มีวันเกิด 6 คน · ต้องตรวจ 1 · เสร็จแล้ว 4 · รอถึงวัน 1".
  assert.deepEqual(out.summary, {
    total: 6,
    due: 1,
    done: 4,
    upcoming: 1,
    byStatus: { filed: 1, absent: 1, holiday: 2, upcoming: 1, due: 1 },
  });
  assert.equal(out.summary.due + out.summary.done + out.summary.upcoming, out.summary.total);
});

test('คนเกิดวันเสาร์ — "วันหยุดอยู่แล้ว" ขึ้นตาราง ไม่ใช่หายไป', () => {
  // Nobody was expected at work, the day was already วันหยุด for the whole
  // company, and the birthday rule added nothing to it. That is a fact worth
  // printing: silence would leave HR unable to tell it from an oversight.
  const out = month([person({ code: 'A', birthDate: '1990-08-08' })]);
  assert.equal(out.rows.length, 1);
  assert.equal(statusOf(out, 'A'), 'holiday');
  assert.equal(out.rows[0].alreadyHoliday, true);
  assert.equal(out.summary.due, 0);
  assert.equal(out.summary.done, 1);
});

test('วันเกิดตรงวันหยุดบริษัท — "วันหยุดอยู่แล้ว" เหมือนกัน', () => {
  const out = month([person({ code: 'A', birthDate: '1988-08-12' })]);
  assert.equal(statusOf(out, 'A'), 'holiday');
});

test('มีใบแล้ว — ขึ้นตารางพร้อมชั่วโมงและทางเปิดใบ', () => {
  const p = person({ _id: 'e1', code: 'A', birthDate: '1977-08-04' });
  const out = month([p], { entries: [entry({ totals: { otHours: 8 } })] });

  assert.equal(statusOf(out, 'A'), 'filed');
  assert.equal(out.rows[0].otHours, 8);
  assert.equal(out.rows[0].entryCount, 1);
  assert.equal(out.rows[0].entryId, 'x1');
  assert.equal(out.rows[0].allClosed, false);
});

test('ใบที่ถูกไม่อนุมัติ ยังนับว่า "มีใบแล้ว" แต่ไม่มีชั่วโมง', () => {
  /**
   * ANY status counts as dealt with — the question is whether the day was
   * OVERLOOKED, and a request filed and then turned down was not. But its hours
   * are on nobody's books, so printing them here would make this the one screen
   * in the system that counted a refused request.
   */
  const p = person({ _id: 'e1', code: 'A', birthDate: '1977-08-04' });
  const out = month([p], { entries: [entry({ status: 'rejected', totals: { otHours: 8 } })] });

  assert.equal(statusOf(out, 'A'), 'filed');
  assert.equal(out.rows[0].otHours, 0);
  assert.equal(out.rows[0].allClosed, true, 'หน้าจอต้องบอกได้ว่าทำไมชั่วโมงเป็นศูนย์');
});

test('ใบต้องตรงคนและตรงวัน จึงจะนับว่ามีใบ', () => {
  const p = person({ _id: 'e1', code: 'A', birthDate: '1977-08-04' });
  // Somebody else's ใบ on the same day, and this person's on another day.
  assert.equal(statusOf(month([p], { entries: [entry({ employee: 'e9' })] }), 'A'), 'due');
  assert.equal(statusOf(month([p], { entries: [entry({ workDate: '2026-08-05' })] }), 'A'), 'due');
});

test('ตรวจแล้วว่าไม่มา — ขึ้นตารางพร้อมชื่อผู้ตรวจและเวลา', () => {
  const p = person({ _id: 'e1', code: 'A', birthDate: '1977-08-04' });
  const at = new Date('2026-08-05T03:00:00Z');
  const out = month([p], {
    checks: [aCheck({ checkedAt: at, checkedByName: 'มาลี บุญมาก', note: 'ลาพักร้อน' })],
  });

  assert.equal(statusOf(out, 'A'), 'absent');
  assert.deepEqual(out.rows[0].check, { by: 'มาลี บุญมาก', at, note: 'ลาพักร้อน' });
});

test('ยกเลิกการตรวจแล้ว — กลับไปเป็น "ต้องตรวจ"', () => {
  /**
   * The rule that makes an append-only record retractable. Asked as "does a row
   * exist", the retraction would be written, stored, visible in the collection
   * and change nothing anybody can see.
   */
  const p = person({ _id: 'e1', code: 'A', birthDate: '1977-08-04' });
  const rows = [
    aCheck(),
    aCheck({ _id: 'c2', outcome: OUTCOME.CANCELLED, checkedAt: new Date('2026-08-06T03:00:00Z') }),
  ];
  assert.equal(statusOf(month([p], { checks: rows }), 'A'), 'due');

  // And marking it again after a retraction settles it once more — three rows,
  // all kept, and the newest one decides.
  const again = [...rows, aCheck({ _id: 'c3', checkedAt: new Date('2026-08-07T03:00:00Z') })];
  assert.equal(statusOf(month([p], { checks: again }), 'A'), 'absent');
});

test('ลำดับความสำคัญ: มีใบ ชนะ ตรวจแล้ว ชนะ วันหยุด', () => {
  /**
   * A ใบ is the strongest thing that can be true of a date, and its hours are
   * what HR came to see — so FILED outranks a Saturday, with `alreadyHoliday`
   * riding along so the screen can still say the birthday was beside the point.
   *
   * ABSENT above HOLIDAY is the deliberate one: the write route refuses to
   * record "ไม่ได้มาทำงาน" against a company holiday, so the pair should not
   * occur — but a row written before that rule would otherwise show as HOLIDAY
   * and lose its ยกเลิก button, leaving a stored check nobody could retract.
   */
  const sat = person({ _id: 'e1', code: 'A', birthDate: '1990-08-08' });

  const filedOnSat = month([sat], { entries: [entry({ workDate: '2026-08-08' })] });
  assert.equal(statusOf(filedOnSat, 'A'), 'filed');
  assert.equal(filedOnSat.rows[0].alreadyHoliday, true, 'ยังต้องบอกได้ว่าวันนั้นเป็นวันหยุดอยู่แล้ว');

  const checkedOnSat = month([sat], { checks: [aCheck({ workDate: '2026-08-08' })] });
  assert.equal(statusOf(checkedOnSat, 'A'), 'absent', 'การตรวจที่บันทึกไว้แล้วต้องยกเลิกได้เสมอ');
});

// ── the row itself ─────────────────────────────────────────────────────────

test('แถวพาแผนกและบริษัทไปด้วย และไม่พาวันเกิดจริง', () => {
  const p = person({ birthDate: '1977-08-04', code: 'THT0018' });
  const out = month([p]);

  assert.equal(out.uncheckable.length, 0);
  assert.equal(out.rows[0].employeeId, p._id);
  assert.equal(out.rows[0].name, p.name);
  assert.equal(out.rows[0].department, 'วิศวกรรม');
  assert.equal(out.rows[0].departmentId, 'd1');
  assert.equal(out.rows[0].date, '2026-08-04');
  // Read from the code prefix when the field is unset — the same rule
  // สรุป OT ส่งบัญชี partitions by, from one place (src/config/companies.js).
  assert.equal(out.rows[0].company, 'themtech');
  assert.ok(!('birthDate' in out.rows[0]), 'วันเกิดจริงต้องไม่ออกจากเซิร์ฟเวอร์');
});

test('บริษัทมาจากฟิลด์ที่เก็บไว้ก่อน แล้วจึงเป็นรหัสพนักงาน', () => {
  const stored = person({ birthDate: '1977-08-04', code: 'THT0001', company: 'primus' });
  assert.equal(month([stored]).rows[0].company, 'primus');
});

test('วันเกิดวันนี้พอดี ต้องตรวจได้แล้ว ไม่ใช่ "ยังไม่ถึงวัน"', () => {
  // The boundary is `date > today`, so the birthday itself is settled the same
  // day. The scan record for a day exists from the first punch on it.
  const out = birthdayMonth({
    period: '2026-08', today: '2026-08-04',
    roster: [person({ code: 'A', birthDate: '1977-08-04' })], isHoliday, policy: ON,
  });
  assert.equal(statusOf(out, 'A'), 'due');
});

test('เรียงตามวันที่ แล้วจึงตามรหัส', () => {
  const rows = month([
    person({ code: 'PM-0900', birthDate: '1977-08-20' }),
    person({ code: 'PM-0100', birthDate: '1977-08-04' }),
    person({ code: 'PM-0050', birthDate: '1980-08-20' }),
  ]).rows;

  assert.deepEqual(rows.map((r) => `${r.date} ${r.code}`), [
    '2026-08-04 PM-0100', '2026-08-20 PM-0050', '2026-08-20 PM-0900',
  ]);
});

test('วันเกิดเดือนอื่น ไม่อยู่ในตารางของเดือนนี้', () => {
  assert.deepEqual(month([person({ birthDate: '1990-12-25' })]).rows, []);
});

test('กฎวันหยุดวันเกิดปิดอยู่ — ไม่ขึ้นอะไรเลย แม้แต่รายการที่ตรวจไม่ได้', () => {
  // With the rule off a birthday is an ordinary working day: no holiday is owed,
  // so there is no such thing as a birthday to settle. The flag is returned so
  // the screen can stay silent for a reason rather than look like a clean month.
  const out = month([
    person({ birthDate: '1977-08-04' }),
    person({ birthDate: null }),
  ], { policy: OFF });

  assert.equal(out.ruleEnabled, false);
  assert.deepEqual(out.rows, []);
  assert.deepEqual(out.uncheckable, []);
  assert.equal(out.summary.total, 0);
});

test('ไม่ส่ง today มา ต้อง throw ไม่ใช่เดาเอา', () => {
  assert.throws(
    () => birthdayMonth({ period: '2026-08', roster: [person({ birthDate: '1977-08-04' })], isHoliday, policy: ON }),
    /today/,
  );
});

// ── BirthdayCheck: the record behind the "ตรวจแล้ว" status ─────────────────

/**
 * The second answer, and the only one that used to be unrecordable. "มาทำงาน"
 * writes a ใบ, which is its own evidence; "ไม่ได้มาทำงาน" wrote nothing, so the
 * same name came back every time anybody opened the screen and a birthday
 * nobody had looked at was indistinguishable from one already settled.
 */
const check2 = aCheck;

test('แถวใหม่สุดชนะ และ _id ตัดสินเมื่อเวลาเท่ากัน', () => {
  // Two rows written in the same millisecond — a seeded month does this — must
  // not let insertion order decide, or the list changes between two reads of
  // unchanged data. Same tie-break `latestPerSession` uses.
  const at = new Date('2026-08-05T03:00:00Z');
  const a = check2({ _id: 'c1', outcome: OUTCOME.ABSENT, checkedAt: at });
  const b = check2({ _id: 'c2', outcome: OUTCOME.CANCELLED, checkedAt: at });

  assert.equal(latestChecks([a, b]).get(filedKey('e1', '2026-08-04'))._id, 'c2');
  assert.equal(latestChecks([b, a]).get(filedKey('e1', '2026-08-04'))._id, 'c2');
});

test('BirthdayCheck ไม่มีชั่วโมง ไม่มีสถานะ และไม่มีรายงานใดอ่านถึง', () => {
  /**
   * The separation is structural, not a filter anybody has to remember. The
   * model carries no hours, no status, no department and no period — so there
   * is nothing a rollup COULD count — and nothing that totals hours imports it.
   */
  const model = readFileSync(join(ROOT, 'src/models/BirthdayCheck.js'), 'utf8');
  const schema = strip(model);
  for (const forbidden of ['hours', 'buckets', 'totals', 'segments', 'status', 'period', 'capSnapshot']) {
    assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(schema), `BirthdayCheck ต้องไม่มีฟิลด์ ${forbidden}`);
  }
  // Append-only by mechanism, not by convention.
  assert.match(schema, /immutable: true/);
  assert.ok(!/findOneAndUpdate|updateOne|\.save\(\)/.test(schema), 'ต้องไม่มีทางแก้แถวเดิม');

  // Nothing that turns entries into hours knows this collection exists.
  for (const file of [
    'lib/accounting.js', 'lib/reports.js', 'lib/caps.js', 'lib/departmentSummary.js',
    'src/services/otService.js', 'app/api/reports/monthly/[period]/route.js',
    'app/api/exports/accounting.csv/route.js', 'app/api/exports/entries.csv/route.js',
    'app/api/exports/monthly.csv/route.js',
  ]) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(!/BirthdayCheck/.test(src), `${file} อ้างถึง BirthdayCheck — ต้องไม่ถูกนับที่ใดเลย`);
  }
});

test('outcome มีสองค่า และไม่มี "present"', () => {
  // A person who WAS at work is recorded by the ใบ filed for them. A second
  // document saying the same thing is a second account to disagree with it.
  assert.deepEqual([...BIRTHDAY_OUTCOMES].sort(), ['absent', 'cancelled']);
  assert.equal(OUTCOME.ABSENT, 'absent');
  assert.equal(OUTCOME.CANCELLED, 'cancelled');
});

// ── the list that is not in the table: cannot check ────────────────────────

test('ไม่มี birthDate — แยกรายการว่าตรวจไม่ได้ ไม่ปนในตาราง', () => {
  /**
   * Kept OUT of the table, and out of `summary.total`. Which month somebody with
   * no วันเกิด belongs to is the one thing nobody knows, so a row for them in a
   * table sorted by date would have to invent a date to sit at. Silence is not an
   * option either: a roster still mostly empty must not read as a clean month.
   */
  const p = person({ birthDate: null });
  const out = month([p]);

  assert.deepEqual(out.rows, []);
  assert.equal(out.summary.total, 0);
  assert.equal(out.uncheckable.length, 1);
  assert.equal(out.uncheckable[0].reason, 'missing');
  assert.equal(out.uncheckable[0].code, p.code);
  assert.ok(UNCHECKABLE.missing, 'ต้องมีคำอธิบายให้หน้าจอ');
});

test('วันเกิดในระบบใช้ไม่ได้ — ตรวจไม่ได้ ไม่ใช่ไม่มีอะไรค้าง', () => {
  // 30 February in the roster. "Cannot tell" and "nothing owed" are different
  // answers, and only one of them is safe to show as an empty table.
  const out = month([person({ birthDate: '1994-02-30' })]);
  assert.deepEqual(out.rows, []);
  assert.equal(out.uncheckable[0].reason, 'invalid');
  assert.ok(UNCHECKABLE.invalid);
});

test('คนที่ตรวจไม่ได้ ไม่ทำให้คนอื่นหลุดตาราง', () => {
  const out = month([
    person({ birthDate: '1994-02-30' }),
    person({ birthDate: null }),
    person({ birthDate: '1977-08-04' }),
  ]);
  assert.equal(out.rows.length, 1);
  assert.equal(out.uncheckable.length, 2);
});

test('ทั้งตารางและรายการที่ตรวจไม่ได้ ไม่พา birthDate ออกไปด้วย', () => {
  // ตรวจสอบรายเดือน is open to หัวหน้า for their own team, and a date of birth is
  // not theirs to read. What goes out is the date of the HOLIDAY.
  const out = month([
    person({ birthDate: '1977-08-04' }),
    person({ birthDate: null }),
    person({ birthDate: '1994-02-30' }),
  ]);
  for (const r of [...out.rows, ...out.uncheckable]) {
    assert.ok(!('birthDate' in r), `${r.code} มี birthDate ติดไปด้วย`);
  }
});

test('29 ก.พ. ตามนโยบายปีที่ไม่ใช่อธิกสุรทิน', () => {
  const p = person({ code: 'A', birthDate: '2000-02-29' });
  const at = (period, policy) => birthdayMonth({
    period, today: '2028-12-31', roster: [p], isHoliday, policy,
  });

  // 28 Feb 2027 is a Sunday — the day exists, and it was already a holiday.
  assert.equal(statusOf(at('2027-02', { ...ON, birthdayLeapFallback: 'feb28' }), 'A'), 'holiday');
  // 'mar01' moves the holiday into March, and the table follows the holiday.
  assert.deepEqual(at('2027-02', { ...ON, birthdayLeapFallback: 'mar01' }).rows, []);
  assert.equal(at('2027-03', { ...ON, birthdayLeapFallback: 'mar01' }).rows[0].date, '2027-03-01');
  // 'none' — no holiday is owed that year at all, so there is no row to show.
  assert.deepEqual(at('2027-02', { ...ON, birthdayLeapFallback: 'none' }).rows, []);
  // In a leap year, 29 Feb 2028 is a Tuesday.
  assert.equal(at('2028-02', ON).rows[0].date, '2028-02-29');
});

// ── the five statuses are a closed set ─────────────────────────────────────

test('สถานะมี 5 แบบ มีคำแปลครบ และมีแบบเดียวที่เป็นงาน', () => {
  /**
   * The set is closed, and `SETTLED_STATUSES` names the three that mean nothing
   * is left to do. `birthdayQueue` holds only DUE — a status added to the queue
   * by accident would have to be added here, in the one place the meanings are
   * written down.
   */
  const all = Object.values(BIRTHDAY_STATUS);
  assert.deepEqual([...all].sort(), ['absent', 'due', 'filed', 'holiday', 'upcoming']);
  for (const s of all) assert.ok(STATUS_LABEL_TH[s], `${s} ไม่มีคำแปลไทย`);

  assert.deepEqual([...SETTLED_STATUSES].sort(), ['absent', 'filed', 'holiday']);
  assert.ok(!SETTLED_STATUSES.includes(BIRTHDAY_STATUS.DUE));
  assert.ok(!SETTLED_STATUSES.includes(BIRTHDAY_STATUS.UPCOMING));
});

// ── the screen reads, it does not write ────────────────────────────────────

/**
 * The report route reports. Both ways of ANSWERING a row are POST routes of
 * their own, each with its rule in lib/ — so however the screen above it
 * changes, reading this list can never write anything.
 *
 * Pinned as text because the routes resolve `@/…` through the Next alias, which
 * node --test does not.
 */
test('เส้นทางรายงานยังอ่านอย่างเดียว — การเขียนอยู่คนละ route', () => {
  const route = readFileSync(join(ROOT, 'app/api/reports/birthday-check/[period]/route.js'), 'utf8');
  const code = strip(route);

  assert.match(code, /export const GET =/);
  assert.ok(!/export const (POST|PATCH|PUT|DELETE)/.test(code), 'route นี้ต้องไม่มีทางเขียนอะไรเลย');
  assert.ok(!/new OtEntry|entry\.save\(\)|BirthdayCheck\.create/.test(code), 'ต้องไม่สร้างอะไร');

  // Opened to หัวหน้า, and scoped by the SAME rule the approval queue runs on —
  // not by a role test written a second time here.
  assert.match(code, /requireRole\(await requireAuth\(req\), 'manager', 'hr', 'admin'\)/);
  assert.match(code, /birthdayActionPermission/);
  assert.match(code, /delegatedDepartments/);

  // The หัวหน้า's name still rides along: HR may still prefer to ring.
  assert.match(code, /role: 'manager'/);
});

test('คิวมีปุ่มสองทางต่อแถว และถามสิทธิ์จากเซิร์ฟเวอร์ ไม่ตัดสินเอง', () => {
  const queue = readFileSync(join(ROOT, 'components/BirthdayQueue.jsx'), 'utf8');

  assert.match(queue, /บันทึก OT ให้/);
  assert.match(queue, /ไม่ได้มาทำงาน/);

  /**
   * The two actions come from one module, not from two copies.
   *
   * The month table on ตรวจสอบรายเดือน offers the same pair of buttons on the
   * same kind of row, and the dialog in front of one of them explains what the
   * stored record is and is not. Written twice, that sentence would one day read
   * two ways on two screens describing the same document.
   */
  const actions = readFileSync(join(ROOT, 'components/birthdayActions.jsx'), 'utf8');
  assert.match(actions, /\/birthday\/checks/);
  assert.match(actions, /OUTCOME\.ABSENT/);
  assert.match(actions, /OUTCOME\.CANCELLED/);
  for (const screen of ['components/BirthdayQueue.jsx', 'components/HrView.jsx']) {
    const src = readFileSync(join(ROOT, screen), 'utf8');
    assert.match(src, /from '\.\/birthdayActions\.jsx'/, `${screen} ต้องใช้ปุ่มชุดเดียวกัน`);
    assert.ok(!/\/birthday\/checks/.test(src), `${screen} เขียน POST เอง — จะเพี้ยนกับอีกจอ`);
  }

  /**
   * Whether the buttons are drawn is `canAct` — the server's own answer, from
   * `birthdayActionPermission`. A role test in the browser is how a screen ends
   * up offering a row the server refuses, or hiding one somebody may act on;
   * the approval queue already learnt that lesson with `isOwnFiling`.
   */
  assert.match(queue, /r\.canAct \?/);
  assert.ok(
    !/user\?\.role|\['hr', 'admin'\]\.includes/.test(queue),
    'ส่วนนี้ต้องไม่ตัดสินสิทธิ์เองจาก role',
  );

  // "กำลังจะถึง" is folded away and carries no button — there is no scan record
  // for a shift that has not happened, so there is nothing to press.
  const upcoming = queue.slice(queue.indexOf('upcoming.length > 0'), queue.indexOf('uncheckable.length > 0'));
  assert.match(upcoming, /<Fold/);
  assert.ok(!/<button/.test(upcoming), 'กลุ่ม “กำลังจะถึง” ต้องไม่มีปุ่ม');
});

/**
 * The sentence the old screen carried was the opposite of the truth: it sent
 * the reader to the หัวหน้า "เพราะฝ่ายบุคคลไม่ทราบว่าเขามาทำงานถึงกี่โมง". HR
 * reads the fingerprint scanner's own export. Pinned because a wrong
 * explanation on a screen outlives every correction made in a meeting.
 */
test('ข้อความอธิบายตรงกับความจริง — HR เทียบบันทึกสแกนนิ้วเองได้', () => {
  const queue = readFileSync(join(ROOT, 'components/BirthdayQueue.jsx'), 'utf8');

  assert.ok(
    !/ฝ่ายบุคคลไม่ทราบว่าเขามาทำงานถึงกี่โมง/.test(queue),
    'ข้อความเดิมที่ขัดกับสเปกยังอยู่',
  );
  assert.match(queue, /สแกนนิ้ว/, 'ต้องบอกว่าตรวจจากบันทึกเวลาเข้างาน');
  assert.match(queue, /หัวหน้าแผนกบันทึกแทนลูกทีมของตนเองได้/, 'หัวหน้าก็ยังบันทึกแทนได้');
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

test('[OPEN 5] ตอบ 17:01 แล้ว ข้อความต้องบอก 17:01 ไม่ใช่ 17:00', () => {
  // A 16:00–17:01 session is refused under this answer — OT does not start until
  // 17:01 — and the sentence that comes back is the only thing telling the person
  // why. Naming 17:00 there sends them off to re-type a time that is already right.
  const session = { workDate: '2026-08-05', startTime: '16:00', endTime: '17:01' };
  const literal = { ...ON, otStartsAtCoreEnd: false };
  const dayTypes = resolveDayTypes(sessionDates(session), { isHoliday, birthDate: null, policy: literal });

  assert.equal(computeSession(session, { policy: literal, dayTypes }).totals.otHours, 0);

  const message = noOtHoursMessage(session, literal, dayTypes);
  assert.match(message, /08:00–17:01/);
  assert.match(message, /เริ่มนับตั้งแต่ 17:01/);
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

// ── the queue never offers a button that cannot work ──────────────────────

/**
 * The rows ฝ่ายบุคคล generated are in their own confirmation queue, filed under
 * their own name — and `approvalPermission` refuses BOTH ยืนยัน and ไม่อนุมัติ on
 * a request its reviewer wrote. Before this, the queue offered both anyway: press,
 * 403, press the other, the same 403, and no way out on that screen at all
 * (the withdrawal lived two screens away, behind a status filter that hid the
 * row). What is pinned is that the screen asks the same question the server does,
 * and that the one action which works is on the row.
 */
test('คิวอนุมัติถามคำถามเดียวกับเซิร์ฟเวอร์ และไม่โชว์ปุ่มที่กดไม่ได้', () => {
  const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');

  // Not a second implementation of the rule in the component.
  assert.match(queue, /import \{ isOwnFiling \} from '@\/lib\/delegation\.js'/);
  assert.ok(
    !/filedBy\)\s*===\s*idOf\(user\)|filedBy\?\._id === user\._id/.test(queue),
    'คอมโพเนนต์เขียนกฎเองซ้ำ — จะเพี้ยนกันวันใดวันหนึ่ง',
  );

  // The row branches on it, and the branch without the two decisions offers the
  // withdrawal instead.
  assert.match(queue, /isOwnFiling\(e, user\) \? \(/);
  assert.match(queue, /onClick=\{\(\) => voidEntry\(e\)\}/);
  assert.match(queue, /const voidEntry = \(entry\) => run\(/);
  assert.match(queue, /\/entries\/\$\{e\._id\}\/cancel/);

  // Such a row cannot be ticked into a batch either — a batch of three that
  // fails on one is three presses to work out which.
  assert.match(queue, /disabled=\{isOwnFiling\(e, user\)\}/);
  assert.match(queue, /const actionable = useMemo\(\(\) => shown\.filter\(\(e\) => !isOwnFiling\(e, user\)\)/);
  assert.match(queue, /selected\.size === actionable\.length/);

  // And the pop-up does not put the same two buttons back.
  assert.match(queue, /mine=\{isOwnFiling\(detail, user\)\}/);
  assert.match(queue, /\) : mine \? \(/);
});

// ── the form tells the filer why their birthday looks different ───────────

test('ฟอร์มยื่นใบอ่านเหตุผลจาก preview ไม่ได้คำนวณวันเกิดเองในเบราว์เซอร์', () => {
  const form = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');

  assert.match(form, /function isOwnBirthday\(preview\)/);
  assert.match(form, /s\.dayReason === 'birthday'/);
  // Only on the filer's own form. A proxy filing would be telling a หัวหน้า when
  // their team member was born — and a birthday-list filing would be saying
  // "ของคุณ" to ฝ่ายบุคคล about somebody else.
  assert.match(form, /preview && !proxy && !hrEdit && !fromBirthday && isOwnBirthday\(preview\)/);
  assert.ok(!/birthDate/.test(form), 'ฟอร์มต้องไม่แตะวันเกิดของใครเลย');
});
