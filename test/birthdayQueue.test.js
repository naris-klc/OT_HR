import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { makeIsHoliday } from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import {
  birthdayMonth, birthdayQueue, monthsBetween, daysBetween, OUTCOME, BIRTHDAY_STATUS,
} from '../lib/birthdayCheck.js';

/**
 * วันเกิดรอตรวจ — a QUEUE, and the whole file is about the one word.
 *
 * The list used to live at the foot of ตรวจสอบรายเดือน and follow that screen's
 * month picker. That made a birthday overlooked in August disappear the moment
 * anybody looked at September — the rows waiting longest were the ones hardest
 * to see, which is the exact opposite of what a backlog is for. So the queue is
 * NOT scoped to a month, and the month-scoped question keeps a separate answer
 * for closing the books.
 *
 * What is pinned here is that difference, in both directions: the queue carries
 * last month's leftovers into this month, and the status line on the report does
 * not. If those two ever became the same number, one of them would be lying.
 *
 * July and August 2026. 4 Aug is a Tuesday, 8 Aug a Saturday, 12 Aug (วันแม่) the
 * company holiday; 14 Jul is a Tuesday.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const isHoliday = makeIsHoliday(['2026-08-12']);
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

/** Standing in the middle of August, with July behind us. */
const TODAY = '2026-08-16';
const MONTHS = ['2026-07', '2026-08'];

const queue = (roster, over = {}) => birthdayQueue({
  periods: MONTHS, today: TODAY, roster, isHoliday, policy: ON, ...over,
});

// ── the whole point: a backlog does not vanish with a month picker ─────────

test('วันเกิดค้างจากเดือนก่อน ยังขึ้นในคิวเมื่อเปิดดูเดือนปัจจุบัน', () => {
  const july = person({ birthDate: '1980-07-14', code: 'PM-0500' });
  const august = person({ birthDate: '1977-08-04', code: 'PM-0600' });

  const rows = queue([july, august]).needsEntry;

  assert.deepEqual(rows.map((r) => r.date), ['2026-07-14', '2026-08-04']);
  assert.equal(rows.length, 2, 'ของค้างข้ามเดือนต้องไม่หายไป');

  /**
   * And the month table, asked about August, counts ONE as ต้องตรวจ — because
   * that is a different question. This is the difference the two exist to keep,
   * and a change that made these numbers agree would have broken one of them.
   */
  const monthly = birthdayMonth({
    period: '2026-08', today: TODAY, roster: [july, august], isHoliday, policy: ON,
  });
  assert.equal(monthly.summary.due, 1);
  assert.equal(monthly.rows.length, 1, 'ตารางเดือนสิงหาคมไม่พาวันเกิดเดือนกรกฎาคมมาด้วย');
  assert.equal(monthly.rows[0].date, '2026-08-04');
});

test('เรียงเก่าสุดขึ้นก่อน — ตรงข้ามกับรายงาน ซึ่งอ่านไล่ลงเดือน', () => {
  const rows = queue([
    person({ code: 'PM-0900', birthDate: '1977-08-04' }),
    person({ code: 'PM-0100', birthDate: '1980-07-14' }),
    person({ code: 'PM-0050', birthDate: '1990-08-04' }),
  ]).needsEntry;

  // Oldest first; code order settles a shared date, as everywhere else.
  assert.deepEqual(rows.map((r) => `${r.date} ${r.code}`), [
    '2026-07-14 PM-0100', '2026-08-04 PM-0050', '2026-08-04 PM-0900',
  ]);
});

test('แต่ละแถวบอกอายุเป็นวัน', () => {
  // The number that makes a backlog visible without anybody subtracting dates.
  const rows = queue([
    person({ birthDate: '1980-07-14' }),
    person({ birthDate: '1977-08-04' }),
  ]).needsEntry;

  assert.equal(rows[0].ageDays, daysBetween('2026-07-14', TODAY));
  assert.equal(rows[0].ageDays, 33);
  assert.equal(rows[1].ageDays, 12);

  // Settled the same day reads 0, not 1.
  const sameDay = birthdayQueue({
    periods: ['2026-08'], today: '2026-08-04', roster: [person({ birthDate: '1977-08-04' })],
    isHoliday, policy: ON,
  }).needsEntry;
  assert.equal(sameDay[0].ageDays, 0);
});

// ── what leaves the queue ─────────────────────────────────────────────────

test('ตรวจแล้ว — มีใบ OT ในวันนั้น → หายจากคิว', () => {
  const p = person({ birthDate: '1980-07-14' });
  const entries = [{ _id: 'x1', employee: p._id, workDate: '2026-07-14', status: 'approved', totals: { otHours: 8 } }];
  assert.deepEqual(queue([p], { entries }).needsEntry, []);
});

test('ตรวจแล้ว — มี BirthdayCheck ว่าไม่ได้มาทำงาน → หายจากคิว', () => {
  const p = person({ birthDate: '1980-07-14' });
  const checks = [{
    _id: 'c1', employee: p._id, workDate: '2026-07-14',
    outcome: OUTCOME.ABSENT, checkedAt: new Date('2026-07-15T03:00:00Z'),
  }];
  assert.deepEqual(queue([p], { checks }).needsEntry, []);
});

test('ยกเลิก BirthdayCheck → กลับมาขึ้นคิว พร้อมอายุที่เดินต่อ', () => {
  // The retraction does not reset the clock: the birthday is as overdue as it
  // ever was, and a queue that restarted the count would hide exactly that.
  const p = person({ birthDate: '1980-07-14' });
  const checks = [
    { _id: 'c1', employee: p._id, workDate: '2026-07-14', outcome: OUTCOME.ABSENT, checkedAt: new Date('2026-07-15T03:00:00Z') },
    { _id: 'c2', employee: p._id, workDate: '2026-07-14', outcome: OUTCOME.CANCELLED, checkedAt: new Date('2026-08-01T03:00:00Z') },
  ];
  const back = queue([p], { checks }).needsEntry;
  assert.equal(back.length, 1);
  assert.equal(back[0].ageDays, 33);
});

test('คิวรับเฉพาะสถานะ "ต้องตรวจ" — อีกสี่สถานะห้ามเข้า', () => {
  /**
   * Rule 4, as arithmetic rather than as a promise.
   *
   * The nav badge is this number, so a settled birthday, one on a Saturday or
   * one that has not arrived must not inflate it. Both functions classify with
   * the same `scanPeriod`, and the queue is a filter over those statuses — which
   * is what makes the two impossible to disagree.
   */
  const roster = [
    person({ _id: 'q1', code: 'A', birthDate: '1977-07-14' }), // filed
    person({ _id: 'q2', code: 'B', birthDate: '1980-07-15' }), // checked away
    person({ _id: 'q3', code: 'C', birthDate: '1985-07-16' }), // due
    person({ _id: 'q4', code: 'D', birthDate: '1990-08-08' }), // Saturday
    person({ _id: 'q5', code: 'E', birthDate: '1992-08-26' }), // not yet
  ];
  const entries = [{ _id: 'x1', employee: 'q1', workDate: '2026-07-14', status: 'approved', totals: { otHours: 8 } }];
  const checks = [{ _id: 'c1', employee: 'q2', workDate: '2026-07-15', outcome: OUTCOME.ABSENT, checkedAt: new Date('2026-07-16') }];

  const q = queue(roster, { entries, checks });
  assert.deepEqual(q.needsEntry.map((r) => r.code), ['C'], 'มีแต่ "ต้องตรวจ" เท่านั้น');
  assert.deepEqual(q.upcoming.map((r) => r.code), ['E']);
  for (const r of q.needsEntry) assert.equal(r.status, BIRTHDAY_STATUS.DUE);

  // The same data through the month table: every one of them has a row, and only
  // one of them is counted as work. Two screens, one classification.
  const july = birthdayMonth({ period: '2026-07', today: TODAY, roster, isHoliday, policy: ON, entries, checks });
  const august = birthdayMonth({ period: '2026-08', today: TODAY, roster, isHoliday, policy: ON, entries, checks });
  assert.equal(july.rows.length + august.rows.length, 5, 'ทุกคนมีแถวในตารางของเดือนตัวเอง');
  assert.equal(july.summary.due + august.summary.due, q.needsEntry.length);
});

// ── what is not in the queue at all ───────────────────────────────────────

test('"กำลังจะถึง" ไม่อยู่ในคิว และไม่ถูกนับ', () => {
  /**
   * There is no scan record for a shift that has not happened, so there is
   * nothing to press and nothing to decide. A queue whose count includes rows
   * nobody can act on is a count that stops meaning anything.
   */
  const out = queue([
    person({ birthDate: '1980-07-14' }),
    person({ birthDate: '1990-08-26' }),
  ]);

  assert.equal(out.needsEntry.length, 1);
  assert.equal(out.needsEntry[0].date, '2026-07-14');
  assert.equal(out.upcoming.length, 1);
  assert.equal(out.upcoming[0].date, '2026-08-26');
  // No age on a row that is not waiting for anybody.
  assert.equal(out.upcoming[0].ageDays, undefined);
});

test('เสาร์-อาทิตย์ วันหยุดบริษัท และเดือนนอกช่วง ไม่เข้าคิว', () => {
  const out = queue([
    person({ birthDate: '1990-08-08' }),  // Saturday
    person({ birthDate: '1988-08-12' }),  // วันแม่
    person({ birthDate: '1990-12-25' }),  // outside the window
  ]);
  assert.deepEqual(out.needsEntry, []);
  assert.deepEqual(out.upcoming, []);
});

test('กฎสวัสดิการวันเกิดปิดอยู่ — คิวว่างและบอกว่าปิดอยู่', () => {
  const out = queue([person({ birthDate: '1980-07-14' })], { policy: OFF });
  assert.equal(out.ruleEnabled, false);
  assert.deepEqual(out.needsEntry, []);
});

test('กฎเริ่มกลางเดือน — วันก่อนหน้านั้นไม่เข้าคิว แม้จะอยู่ในเดือนเดียวกัน', () => {
  /**
   * THE GAP THIS CLOSES, and it was a real one on 2026-08-20.
   *
   * The rule was recorded on 13 August, effective that day. The queue rounded
   * that to '2026-08' and offered every birthday in the month; the compute path
   * resolves the rules per DATE, so for the 10th it read the version in force on
   * the 10th — the rule off. ฝ่ายบุคคล opened บันทึก OT ให้ on a row the screen
   * had just told them to work, and got a red กฎสวัสดิการวันเกิดปิดอยู่ over two
   * empty time boxes and 08:00–17:00 computing to 0 ชั่วโมง.
   *
   * The floor is a date now, so the queue offers exactly what the engine will
   * accept. A birthday earlier in the same month is not "missed" — no holiday
   * was owed on it — and if HR decides otherwise the answer is to record the
   * earlier `effectiveFrom`, which moves the queue and the arithmetic together.
   */
  const before = person({ birthDate: '1980-08-10', code: 'PM-0100' });
  const after = person({ birthDate: '1978-08-14', code: 'PM-0200' });

  const out = queue([before, after], { activeFrom: '2026-08-13' });
  assert.deepEqual(out.needsEntry.map((r) => r.date), ['2026-08-14']);

  // And with the floor a day earlier, the same person is owed the day again.
  const wider = queue([before, after], { activeFrom: '2026-08-01' });
  assert.deepEqual(wider.needsEntry.map((r) => r.date), ['2026-08-10', '2026-08-14']);

  // No floor at all is the old answer — every caller in the app hands one in,
  // and a test fixture that does not must not silently lose rows.
  assert.equal(queue([before, after]).needsEntry.length, 2);
});

test('พื้นวันที่ไม่กลบ "ตรวจไม่ได้" — คนที่ไม่มีวันเกิดยังต้องขึ้น', () => {
  // A roster row with no birth date has no date to compare, and the warning is
  // about the roster rather than about a month. It survives the floor.
  const out = queue([person({ birthDate: null })], { activeFrom: '2026-08-13' });
  assert.equal(out.uncheckable.length, 1);
  assert.equal(out.uncheckable[0].reason, 'missing');
});

test('"ตรวจไม่ได้" นับต่อคน ไม่ใช่ต่อเดือน', () => {
  // A roster row with no birthDate is equally unanswerable in every month
  // scanned; listed per period it would print the same name twice and read as
  // two problems.
  const out = queue([person({ birthDate: null }), person({ birthDate: '1994-02-30' })]);
  assert.equal(out.uncheckable.length, 2);
  assert.deepEqual(out.uncheckable.map((r) => r.reason).sort(), ['invalid', 'missing']);
});

test('ไม่ส่ง today มา ต้อง throw ไม่ใช่เดาเอา', () => {
  assert.throws(() => birthdayQueue({ periods: MONTHS, roster: [], isHoliday, policy: ON }), /today/);
});

// ── the window helpers ────────────────────────────────────────────────────

test('monthsBetween ครอบคลุมทั้งช่วง และข้ามปีได้', () => {
  assert.deepEqual(monthsBetween('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(monthsBetween('2026-08', '2026-08'), ['2026-08']);
  // Backwards is empty rather than infinite — a loop that cannot terminate is
  // worse than a window that returns nothing.
  assert.deepEqual(monthsBetween('2026-08', '2026-07'), []);
  assert.deepEqual(monthsBetween('rubbish', '2026-07'), []);
});

test('daysBetween นับวันตามปฏิทิน ไม่ใช่ตามเขตเวลา', () => {
  assert.equal(daysBetween('2026-07-31', '2026-08-01'), 1);
  assert.equal(daysBetween('2025-12-31', '2026-01-01'), 1);
  assert.equal(daysBetween('2026-08-16', '2026-08-16'), 0);
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2, 'ปีอธิกสุรทิน');
});

// ── the two scopes stay two scopes ────────────────────────────────────────

test('คิวไม่รับ period และรายงานไม่ใช้ตัวโหลดของคิว', () => {
  /**
   * Structural, not a convention. The queue route takes no period parameter at
   * all — there is nothing to pass — and the report route keeps its own
   * `[period]` path. A single route with an optional parameter would leave the
   * two counts one branch apart, and they are supposed to differ.
   */
  const queueRoute = strip(readFileSync(join(ROOT, 'app/api/birthday/queue/route.js'), 'utf8'));
  assert.match(queueRoute, /export const GET =/);
  assert.ok(!/params|period/.test(queueRoute), 'route คิวต้องไม่รับเดือนเลย');
  assert.match(queueRoute, /loadBirthdayQueue\(user\)/);

  const report = strip(readFileSync(join(ROOT, 'app/api/reports/birthday-check/[period]/route.js'), 'utf8'));
  assert.match(report, /birthdayMonth\(\{/, 'รายงานยังต้องนับเฉพาะเดือนที่ดู');
  assert.match(report, /const \{ period \} = params;/);
  /**
   * It may share the loader's knowledge of WHEN THE RULE STARTED — the two must
   * agree about that or they would disagree about which months hold anything at
   * all. What it must not share is the queue's COUNTER, which is cross-month by
   * design and would silently turn this month's answer into every month's.
   */
  assert.ok(!/loadBirthdayQueue|birthdayQueue\(/.test(report), 'รายงานต้องไม่ใช้ตัวนับของคิว');
  assert.match(report, /birthdayRuleStart/, 'แต่ต้องรู้ว่ากฎเริ่มเดือนไหน');
});

test('ตารางในหน้ารายเดือนอ่านจาก route ของเดือน ไม่ใช่ของคิว', () => {
  const view = readFileSync(join(ROOT, 'components/HrView.jsx'), 'utf8');
  const section = view.slice(view.indexOf('function BirthdayMonth'));

  assert.match(section, /\/reports\/birthday-check\/\$\{period\}/);
  assert.ok(!/birthday\/queue/.test(section), 'ตารางรายเดือนต้องนับเฉพาะเดือนที่ดู');

  // The summary above the table, and the four numbers it prints.
  assert.match(section, /summary\.total/);
  assert.match(section, /summary\.due/);
  assert.match(section, /summary\.done/);
  assert.match(section, /summary\.upcoming/);

  // A clear month says so rather than rendering nothing: a blank space and a
  // fully-checked month look identical, and the difference matters most to
  // whoever is about to send a file to accounting.
  assert.match(section, /summary\.due === 0/);
  assert.match(section, /ตรวจครบแล้ว/);

  // Every status is drawn, not only the outstanding ones.
  for (const status of ['FILED', 'ABSENT', 'HOLIDAY', 'UPCOMING', 'DUE']) {
    assert.match(section, new RegExp(`BIRTHDAY_STATUS\\.${status}`), `ตารางไม่ได้จัดการสถานะ ${status}`);
  }
});

// ── one badge, two tabs ───────────────────────────────────────────────────

test('ตัวเลขบนแถบซ้ายเป็นผลรวมของทุกกองเสมอ ทั้งตอนเปิดอยู่และไม่ได้เปิด', () => {
  const app = strip(readFileSync(join(ROOT, 'components/App.jsx'), 'utf8'));

  /**
   * ONE NUMBER, EVERYWHERE. Both nav bars read the same `tabs` array so neither
   * can drift from the other, and the number does not change when somebody
   * walks onto the screen it counts.
   *
   * THIS TEST ASSERTED THE OPPOSITE FROM 2026-08-20 TO 2026-08-28, under the
   * name ตัวเลขบนแถบซ้ายตามแท็บที่เปิด และรวมสองแท็บเมื่อยืนอยู่หน้าอื่น. A
   * `queueBadge(key, ownPending)` returned the open tab's own pile while the
   * screen was open and the sum from anywhere else, and this file pinned both
   * halves of it. Reported as a bug on 2026-08-28: 6 on รอ HR ยืนยัน from
   * ตรวจสอบรายเดือน, 3 after pressing it. Two answers to one question inside a
   * single press, and the drop is the dangerous direction — a badge that fell
   * from 6 to 3 looks exactly like three items somebody else just cleared.
   *
   * The readability that change was after is still delivered by the two chips
   * on the tabs themselves, pinned at the foot of this test — they were there
   * before it and they are there now.
   */
  assert.match(app, /badge: queueBadge\(counts\.pendingMgr\)/);
  assert.match(app, /badge: queueBadge\(counts\.pendingHr, counts\.withdrawalOpenPendingHr\)/);
  /**
   * THREE PILES SINCE 2026-09-03, and it read "two" until then — คำขอถอนใบ was
   * a card on both these screens and in nobody's count, so with no ใบ waiting
   * and no birthday outstanding an open request carried no badge at all.
   *
   * `overlap` is the second argument and it is not decoration: an open request
   * sits on an entry that is `approved` or `pending_hr`, so ฝ่ายบุคคล's
   * `pending_hr` ones are already inside `counts.pendingHr`. Added whole the
   * badge would double-count them — and only on the days somebody asks about an
   * unconfirmed ใบ, which is the kind of wrong that gets explained away. A
   * หัวหน้า's pile is `pendingMgr`, which no open request can be in, so they
   * pass nothing.
   */
  assert.match(
    app,
    /const queueBadge = \(ownPending, overlap = 0\) => ownPending\s*\r?\n\s*\+ \(counts\.birthdayPending \|\| 0\)\s*\r?\n\s*\+ Math\.max\(0, \(counts\.withdrawalOpen \|\| 0\) - overlap\);/,
    'badge ต้องเป็นผลรวมของทุกกอง ไม่ขึ้นกับแท็บที่เปิดอยู่ และต้องหักส่วนที่นับซ้ำ',
  );
  // The server hands over both halves, and the overlap is counted with the same
  // filter the card's own list uses inside the same scope.
  const summary = readFileSync(join(ROOT, 'app/api/entries/queue-summary/route.js'), 'utf8');
  assert.match(summary, /OtEntry\.countDocuments\(\{ \.\.\.scope, 'withdrawal\.state': 'requested' \}\)/);
  assert.match(
    summary,
    /OtEntry\.countDocuments\(\{ \.\.\.scope, 'withdrawal\.state': 'requested', status: 'pending_hr' \}\)/,
  );
  assert.match(summary, /withdrawalOpen,/);
  assert.match(summary, /withdrawalOpenPendingHr: withdrawalOpenPending,/);

  // AND THE MACHINERY THAT MADE IT FOLLOW THE TAB IS GONE, not left inert.
  // A `queueActive` state that nothing reads is a lie about what drives the
  // badge, and the next person to touch this would have to prove it dead
  // before changing anything.
  for (const dead of ['queueActive', 'setQueueActive', 'onActiveTab', 'birthdayBadge']) {
    assert.ok(!app.includes(`${dead} =`) && !app.includes(`${dead}=`),
      `${dead} ยังอยู่ใน App.jsx`);
  }
  const queueTabs = strip(readFileSync(join(ROOT, 'components/QueueTabs.jsx'), 'utf8'));
  assert.ok(!queueTabs.includes('onActiveTab'), 'QueueTabs ยังรายงานแท็บที่เปิดขึ้นไป');
  // Inside, each tab gets its own number.
  assert.match(app, /pendingCount=\{counts\.pendingMgr\}/);
  assert.match(app, /pendingCount=\{counts\.pendingHr\}/);
  // Including the birthday half, which the screen already knows from the badge
  // — the tab's own count does not exist until somebody opens it, and a chip
  // that appears only after the press is no use in deciding to press.
  assert.equal([...app.matchAll(/birthdayCount=\{counts\.birthdayPending\}/g)].length, 2);

  const tabs = strip(readFileSync(join(ROOT, 'components/QueueTabs.jsx'), 'utf8'));
  assert.match(tabs, /ใบรอยืนยัน/);
  assert.match(tabs, /วันเกิดรอตรวจ/);
  assert.match(tabs, /\{pendingCount > 0 && <span className="count">\{pendingCount\}<\/span>\}/);
  assert.match(tabs, /\{shownBirthdayCount > 0 && <span className="count">\{shownBirthdayCount\}<\/span>\}/);
  // Live figure first, summary second — never the snapshot over a number the
  // queue itself has reported, or answering a row would not move the chip.
  assert.match(tabs, /const shownBirthdayCount = birthdayCount \?\? summaryCount;/);

  // No new sidebar entry: the queue is a tab on a screen that already exists.
  const navKeys = [...app.matchAll(/tabs\.push\(\{\s*key: '(\w+)'/g)].map((m) => m[1]);
  assert.ok(!navKeys.includes('birthday'), 'ห้ามสร้างเมนูใหม่ในแถบซ้าย');

  // Zero hides rather than printing a 0 — on the chip and on the badge alike. A
  // badge reading 0 is a screen saying it has work and then saying it has none.
  assert.match(app, /\{t\.badge > 0 && <span className="count"/);
});

/**
 * ANSWERING A ROW MOVES EVERY NUMBER THAT COUNTS IT, WITHOUT CHANGING SCREENS.
 *
 * The birthday half looks after itself: both lists re-read after an answer and
 * report upward, and the assertions above hold that chain together. The half
 * that does NOT is `pendingHr` — and it is the half that MOVES on the same
 * press. "บันทึก OT ให้" writes a ใบ, and unless the filer could approve it in
 * the same act (`res.direct`, which is the server's answer and depends on who
 * is filing) that ใบ lands in รอ HR ยืนยัน. The nav badge is the SUM of the two,
 * so a row crossing from one half to the other must not read as one leaving.
 *
 * Hence a re-fetch and not a decrement. `refreshCounts` is what the approval
 * queue already settles with; the birthday flow reached neither of them.
 *
 * ตรวจสอบรายเดือน is here for a second reason: it settles the same rows through
 * the same two dialogs and reported nothing at all, so its badge stayed wrong
 * until the tab changed. Its own `load()` cannot stand in — it re-reads one
 * month and the badge counts every month.
 */
test('ตอบวันเกิดหนึ่งแถวแล้วตัวเลขทุกตัวขยับทันที ไม่ต้องเปลี่ยนหน้า', () => {
  const app = strip(readFileSync(join(ROOT, 'components/App.jsx'), 'utf8'));
  const tabs = strip(readFileSync(join(ROOT, 'components/QueueTabs.jsx'), 'utf8'));
  const queue = strip(readFileSync(join(ROOT, 'components/BirthdayQueue.jsx'), 'utf8'));
  const view = strip(readFileSync(join(ROOT, 'components/HrView.jsx'), 'utf8'));

  // Both queue screens ask the server for the authoritative pair.
  assert.equal(
    [...app.matchAll(/onSettled=\{refreshCounts\}/g)].length, 3,
    'onSettled ต้องต่อครบทั้ง รออนุมัติ · รอ HR ยืนยัน และ ตรวจสอบรายเดือน',
  );

  // Down through the tabs to the queue, and called where a row is answered.
  assert.match(tabs, /onSettled=\{onSettled\}/);
  assert.match(queue, /function done\(message\) \{[\s\S]{0,200}?onSettled\?\.\(\);/);
  // The month table settles the same rows through the same dialogs.
  assert.match(view, /function done\(message\) \{[\s\S]{0,200}?onSettled\?\.\(\);/);

  // The live birthday number still goes up on its own — the re-fetch is the
  // second half of the answer, not a replacement for it. Losing this would make
  // the chip wait for a round trip it does not need.
  assert.match(queue, /onCountChange\?\.\(res\.needsEntry\.length\)/);

  // And it is a re-fetch, not arithmetic: whether a filing needed a signature
  // is the server's answer, so a client that predicted it would be wrong on
  // exactly the cases where the two halves disagree.
  assert.match(app, /async function refreshCounts\(\) \{[\s\S]{0,160}?\/entries\/queue-summary/);
});

test('ตัวเลขบนแถบซ้ายคือ "ต้องตรวจ" ทุกเดือน ไม่ใช่จำนวนในตารางเดือนที่ดู', () => {
  /**
   * The one number a reader is most likely to assume is the other one.
   *
   * The badge is `birthdayQueue().needsEntry.length` over the whole window —
   * only the DUE rows, every month. The table on ตรวจสอบรายเดือน is every status
   * for one month. Given the same data those are three different numbers, and
   * the day they agree by construction rather than by coincidence, one of them
   * has stopped answering its own question.
   */
  const roster = [
    person({ _id: 'b1', code: 'A', birthDate: '1980-07-14' }), // July, due
    person({ _id: 'b2', code: 'B', birthDate: '1977-08-04' }), // August, due
    person({ _id: 'b3', code: 'C', birthDate: '1990-08-08' }), // August, Saturday
    person({ _id: 'b4', code: 'D', birthDate: '1992-08-26' }), // August, not yet
  ];

  const badge = queue(roster).needsEntry.length;
  const table = birthdayMonth({ period: '2026-08', today: TODAY, roster, isHoliday, policy: ON });

  assert.equal(badge, 2, 'แถบซ้ายนับ "ต้องตรวจ" ของทุกเดือนรวมกัน');
  assert.equal(table.rows.length, 3, 'ตารางเดือนสิงหาคมแสดงทุกคนที่เกิดเดือนนั้น');
  assert.equal(table.summary.due, 1, 'ในนั้นเป็นงานจริงคนเดียว');
  assert.notEqual(badge, table.rows.length);
  assert.notEqual(badge, table.summary.due);
});

test('เดือนก่อนกฎเริ่มใช้ ไม่มีใครเป็น "ต้องตรวจ" — และไม่มีปุ่มให้กด', () => {
  /**
   * The month picker reaches back further than the rule does, and the queue
   * never could. Applying today's policy to a period from before
   * `birthdayHolidayEnabled` was turned on would mark ordinary working days
   * ต้องตรวจ — and the button on such a row would WORK, because
   * `birthdayDirectApproval` checks that the rule is on NOW and that the date is
   * that person's birthday, both true. The result would be an approved request
   * granting a holiday that did not exist on the date it carries: the
   * retroactive move the system refuses everywhere else.
   */
  const roster = [person({ code: 'A', birthDate: '1980-07-14' })];

  const before = birthdayMonth({
    period: '2026-07', today: TODAY, roster, isHoliday, policy: ON, activeFrom: '2026-08',
  });
  assert.equal(before.ruleEnabled, true, 'กฎเปิดอยู่ — แต่ยังไม่มีผลกับเดือนนั้น');
  assert.equal(before.ruleActiveInPeriod, false);
  assert.deepEqual(before.rows, [], 'ไม่มีแถว จึงไม่มีปุ่ม');
  assert.equal(before.summary.due, 0);

  // From the month the rule started, the same person is ordinary work again.
  const after = birthdayMonth({
    period: '2026-07', today: TODAY, roster, isHoliday, policy: ON, activeFrom: '2026-07',
  });
  assert.equal(after.ruleActiveInPeriod, true);
  assert.equal(after.summary.due, 1);

  // The route hands the floor in; it does not let the table guess.
  const report = strip(readFileSync(join(ROOT, 'app/api/reports/birthday-check/[period]/route.js'), 'utf8'));
  assert.match(report, /activeFrom: await birthdayRuleStart\(\)/);
  const loader = strip(readFileSync(join(ROOT, 'lib/birthdayQueueQuery.js'), 'utf8'));
  assert.match(loader, /export async function birthdayRuleStart/);
  /**
   * The queue's own window is built on the same fact, so the two cannot
   * disagree about when the benefit started — and the month the report asks for
   * is DERIVED from the date the queue uses, rather than read a second time
   * from a second field. `birthdayRuleStart` reading `createdAt` while the
   * arithmetic read `effectiveFrom` is exactly how they came apart.
   */
  assert.match(loader, /const ruleFromDate = await birthdayRuleStartDate\(\)/);
  assert.match(loader, /return periodOf\(await birthdayRuleStartDate\(\)/);
  assert.match(loader, /sort\(\{ effectiveFrom: 1, seq: 1 \}\)/, 'วันเริ่มกฎต้องอ่านจากวันที่มีผล');
});

test('ตัวเลข badge กับตัวเลขในแท็บมาจากการคำนวณเดียวกัน', () => {
  /**
   * The badge is the half nobody checks, so it must not be a second
   * implementation. `queue-summary` runs the loader the tab itself runs, with
   * `countOnly` to skip what a number does not need.
   */
  const summary = strip(readFileSync(join(ROOT, 'app/api/entries/queue-summary/route.js'), 'utf8'));
  assert.match(summary, /loadBirthdayQueue\(user, \{ countOnly: true \}\)/);
  assert.match(summary, /\.then\(\(q\) => q\.needsEntry\.length\)/);
  // A failed count costs a badge, not the two numbers beside it.
  assert.match(summary, /\.catch\(\(\) => 0\)/);
});

// ── the same decision looks the same on both screens ────────────────────────

test('บันทึก OT ให้ เป็นปุ่มทึบทั้งสองหน้า ไม่ใช่ ghost หน้าหนึ่ง', () => {
  /**
   * วันเกิดรอตรวจ (BirthdayQueue) and วันเกิดของเดือนนี้ (HrView) are the same
   * rows read for two different reasons, and they offer the same pair of
   * answers: บันทึก OT ให้, or ไม่ได้มาทำงาน. The pair opens the same form and
   * writes the same entry either way.
   *
   * They drifted: the queue's was `btn sm` and the monthly page's `btn ghost
   * sm`, so reading one screen after the other the same act looked like a
   * different act — and on the monthly page two outlines side by side said the
   * two answers were equals, which they are not. บันทึก OT ให้ is the outcome
   * the ต้องตรวจ chip exists to chase down.
   *
   * Pinned rather than left to care, because nothing else would have caught it:
   * both spellings render, both pass every other test, and the difference is
   * only visible with the two screens open side by side.
   */
  const pair = [
    ['components/BirthdayQueue.jsx', 'วันเกิดรอตรวจ'],
    ['components/HrView.jsx', 'วันเกิดของเดือนนี้'],
  ];
  /**
   * The className of the button whose TEXT is this label.
   *
   * Two traps here, both of which returned a wrong answer while reporting
   * green. Both labels also appear inside a `title=` on the OTHER button of the
   * pair, so the words alone find the wrong element on one of the two screens.
   * And `<button([\s\S]*?)>` backtracks across button boundaries — the leftmost
   * match starts at the FIRST <button> in the file and swallows everything up
   * to the label, so it reads some unrelated button's className.
   *
   * So: find the label as element text, then walk back to the `<button` that
   * opens it.
   */
  const classOf = (src, label) => {
    const m = new RegExp(String.raw`>\s*${label}\s*</button>`).exec(src);
    if (!m) return null;
    const open = src.lastIndexOf('<button', m.index);
    if (open < 0) return null;
    return (src.slice(open, m.index).match(/className="([^"]*)"/) || [])[1];
  };
  for (const [file, screen] of pair) {
    const src = strip(readFileSync(join(ROOT, file), 'utf8'));
    assert.equal(classOf(src, 'บันทึก OT ให้'), 'btn sm', `${screen}: ปุ่มต้องทึบ ไม่ใช่ ghost`);
  }

  /**
   * And its partner stays outlined on both. "Both filled" would be the same
   * mistake from the other end — two equal-weight greens on a row where one of
   * them means "this person did not come in".
   */
  for (const [file, screen] of pair) {
    const src = strip(readFileSync(join(ROOT, file), 'utf8'));
    assert.equal(classOf(src, 'ไม่ได้มาทำงาน'), 'btn ghost sm', `${screen}: ปุ่มคู่ต้องเป็น ghost`);
  }
});

test('การ์ดบนมือถือหรี่เงาของปุ่มทึบ ทั้งสามตาราง', () => {
  /**
   * `.btn` casts an 18px green glow. At the card's 44px that spills about a
   * third of the button's height below it, and the filled button reads as the
   * taller of a pair that is actually the same box — `box-sizing: border-box`
   * puts the outlined one's border inside its height, not on top.
   *
   * Two tables already carried the correction. The third needed it the day
   * บันทึก OT ให้ stopped being a ghost there, and a missing copy is invisible
   * in code review — it looks like nothing, and shows up as one button sitting
   * lower than its neighbour.
   */
  const css = readFileSync(join(ROOT, 'app/styles.css'), 'utf8');
  const phone = css.slice(css.indexOf('@media screen and (max-width: 860px)'));
  for (const table of ['queue-table', 'bday-table', 'bmonth-table']) {
    const rule = new RegExp(
      String.raw`\.${table} td\.act-col[^{]*\.btn:not\(\.ghost\) \{\s*box-shadow: 0 3px 9px var\(--green-glow-sm\);`,
      'g',
    );
    const found = phone.match(rule) || [];
    // Exactly once. `assert.match` would pass on a rule pasted in twice, which
    // is how this arrived — identical neighbouring blocks are invisible in a
    // stylesheet and the browser reports nothing.
    assert.equal(found.length, 1, `${table}: ต้องมีกฎหรี่เงาหนึ่งชุดพอดี (เจอ ${found.length})`);
  }
});
