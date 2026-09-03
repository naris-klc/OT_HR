import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BUCKETS, computeSession, flatDailyMinutes, makeIsHoliday, resolveDayTypes, sessionDates,
} from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import { ENTERED_FIELDS, pickSession, sameSession } from '../lib/entries.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * เหมารายวัน — a day hired whole, which counts eight hours however long the
 * person stayed.
 *
 * HR's rule, 2026-09-03, asked for in these words: some departments do work
 * เหมา, but not every day and not everybody — so it is a tick on the request
 * rather than the department-wide `otMode: 'daily'` beside it (lib/otMode.js),
 * which answers "does this department have weekday OT at all" and goes on
 * answering it. Ticked, the form fills in 08:00–17:00; the times stay editable,
 * and the day still counts eight hours.
 *
 * August 2026 as everywhere else: 4 Aug is a Tuesday, 12 Aug (วันแม่) the
 * company holiday, 8 Aug a Saturday.
 */

const isHoliday = makeIsHoliday(['2026-08-12']);

function run(session, policy = DEFAULT_POLICY) {
  return computeSession(session, {
    policy,
    dayTypes: resolveDayTypes(sessionDates(session), { isHoliday, policy }),
  });
}

/** วันแม่, the standard day. The case the tick fills the form in for. */
const HOLIDAY_DAY = { workDate: '2026-08-12', startTime: '08:00', endTime: '17:00' };
/** The same day, stayed on until 20:00. */
const HOLIDAY_LONG = { workDate: '2026-08-12', startTime: '08:00', endTime: '20:00' };

// ── the figure itself ───────────────────────────────────────────────────────

/**
 * NOT A POLICY KEY, and this is the case that says why. Eight hours is
 * `coreEndMinute − coreStartMinute` less the lunch hour — the same arithmetic
 * the ordinary day is already drawn out of — so a company that moves its core
 * hours moves this with it, and there is no second number in ตั้งค่าระบบ for the
 * two to disagree over.
 */
test('หนึ่งวันเหมาคือแปดชั่วโมง และอ่านมาจากเวลางานปกติ', () => {
  assert.equal(flatDailyMinutes(DEFAULT_POLICY), 8 * 60);
  assert.equal(
    flatDailyMinutes(DEFAULT_POLICY),
    DEFAULT_POLICY.coreEndMinute - DEFAULT_POLICY.coreStartMinute - DEFAULT_POLICY.breakMinutes,
  );
  // A company on a 08:00–16:00 day gets a seven-hour flat day, not eight.
  assert.equal(flatDailyMinutes({ ...DEFAULT_POLICY, coreEndMinute: 16 * 60 }), 7 * 60);
  // And one that deducts no break at all gets the whole span.
  assert.equal(flatDailyMinutes({ ...DEFAULT_POLICY, breakMode: 'none' }), 9 * 60);
});

// ── the cap ─────────────────────────────────────────────────────────────────

test('ติ๊กเหมาแล้วอยู่เต็มวันพอดี — ไม่มีอะไรถูกตัด', () => {
  const plain = run(HOLIDAY_DAY);
  const flat = run({ ...HOLIDAY_DAY, flatDaily: true });

  assert.equal(plain.totals.otHours, 8);
  assert.equal(flat.totals.otHours, 8);
  assert.equal(flat.flatDailyTrimmed, 0);
  // Nothing to say, so nothing is said: a warning on a session the cap never
  // touched would be a notice about a rule that did not fire.
  assert.ok(!flat.warnings.some((w) => w.code === 'FLAT_DAILY_CAPPED'));
});

/**
 * The rule as HR stated it: "แก้ได้ แต่นับแค่ 8 ชั่วโมง". The times are the
 * person's own and are recorded as worked; the hours stop at the flat day.
 */
test('ติ๊กเหมาแล้วอยู่เกินเวลา — นับแค่แปดชั่วโมง และบอกว่าตัดไปเท่าไร', () => {
  const plain = run(HOLIDAY_LONG);
  const flat = run({ ...HOLIDAY_LONG, flatDaily: true });

  assert.equal(plain.totals.otHours, 11, '08:00–20:00 บนวันหยุด = 8 + 3');
  assert.equal(flat.totals.otHours, 8);
  assert.equal(flat.flatDailyTrimmed, 3);

  const note = flat.warnings.find((w) => w.code === 'FLAT_DAILY_CAPPED');
  assert.ok(note, 'ต้องมีคำเตือนบอกว่าชั่วโมงส่วนเกินไม่ถูกนับ');
  assert.equal(note.minutes, 180);
});

/**
 * TRIMMED FROM THE END, IN CLOCK ORDER, and that is the rule rather than an
 * implementation detail. A flat day is the standard day plus whatever came
 * after it, and what the tick says is that the tail is not separately payable —
 * so the tail is what goes. Spending the cap out of the largest segment (the
 * way a flat break is spent) would take the hours out of the middle of the day
 * and leave the evening on the sheet, which is the opposite of what anybody
 * ticking this box means.
 */
test('ส่วนที่ถูกตัดคือช่วงท้ายวัน ไม่ใช่ช่วงกลางวัน', () => {
  const flat = run({ ...HOLIDAY_LONG, flatDaily: true });

  // 08:00–17:00 less the lunch hour is the ×1.5 holiday column; 17:00–20:00 is
  // the ×3 one, and it is the ×3 one that goes.
  assert.equal(flat.buckets[BUCKETS.OT15_HOLIDAY], 8);
  assert.equal(flat.buckets[BUCKETS.OT3_HOLIDAY], 0);
});

/**
 * THE CLOCK TIMES STAY AS WORKED. Only the counted minutes drop — the same
 * split §3 already makes for the lunch hour, and the reason `applyFlatDeduction`
 * is written the way it is. The paper form still shows when the person was
 * here; the hour columns show what the day was worth.
 */
test('เวลาที่บันทึกไว้ยังเป็นเวลาจริง — ที่ลดคือชั่วโมงที่นับ', () => {
  const flat = run({ ...HOLIDAY_LONG, flatDaily: true });
  assert.equal(flat.totals.clockHours, 12, 'ตั้งแต่ 08:00 ถึง 20:00');
  assert.equal(flat.totals.otHours, 8);
});

/**
 * A short เหมา day is not padded. The cap is a ceiling, not a figure: somebody
 * who came in for the morning of a flat day worked the morning, and inventing
 * the afternoon would be the system writing hours nobody worked.
 */
test('เหมาที่ทำไม่ถึงแปดชั่วโมง — ไม่ถูกเติมให้เต็ม', () => {
  const half = run({
    workDate: '2026-08-12', startTime: '08:00', endTime: '12:00', flatDaily: true,
  });
  assert.equal(half.totals.otHours, 4);
  assert.equal(half.flatDailyTrimmed, 0);
});

test('ไม่ติ๊ก — เพดานนี้ไม่มีผลกับอะไรเลย', () => {
  const long = run(HOLIDAY_LONG);
  assert.equal(long.totals.otHours, 11);
  assert.equal(long.flatDailyTrimmed, 0);
});

/**
 * AN OVERNIGHT เหมา DAY IS STILL ONE DAY. The cap is per REQUEST, and a request
 * is one session however many dates it touches — so a Saturday shift running
 * into Sunday counts eight hours in total, not eight per date. Trimming from
 * the end means the Sunday hours are the ones that go, which is the same "the
 * tail is not separately payable" rule read across a midnight.
 */
test('กะข้ามคืนที่ติ๊กเหมา — แปดชั่วโมงต่อใบ ไม่ใช่ต่อวัน', () => {
  const overnight = {
    workDate: '2026-08-08', startTime: '18:00', endTime: '06:00', endsNextDay: true,
  };
  const plain = run(overnight);
  const flat = run({ ...overnight, flatDaily: true });

  assert.equal(plain.totals.otHours, 12, '18:00 เสาร์ ถึง 06:00 อาทิตย์');
  assert.equal(flat.totals.otHours, 8);
  assert.equal(flat.flatDailyTrimmed, 4);

  // AND THE FOUR HOURS THAT WENT ARE THE LAST FOUR ON THE CLOCK, which here
  // means the Sunday morning: six hours of Saturday evening survive whole and
  // Sunday keeps two of its six. Not "the Sunday date is dropped" — the cap
  // counts minutes from the start of the shift and stops, and a rule that
  // dropped whole dates instead would take six hours off a shift that had only
  // four to give.
  const byDate = Object.fromEntries(flat.segments.map((s) => [s.date, s.hours]));
  assert.deepEqual(byDate, { '2026-08-08': 6, '2026-08-09': 2 });
});

// ── it survives the trip to the database ────────────────────────────────────

/**
 * One place picks a session and four write paths spread it onto the document,
 * so the tick reaches storage from every one of them or from none.
 */
test('ช่องติ๊กถูกอ่านที่เดียว และเป็นฟิลด์ที่ผู้ใช้กรอก', () => {
  assert.equal(pickSession({ flatDaily: true }).flatDaily, true);
  assert.equal(pickSession({}).flatDaily, false);
  assert.equal(pickSession({ flatDaily: 'yes' }).flatDaily, true);

  assert.ok(ENTERED_FIELDS.includes('flatDaily'));
  // An edit that only toggles it is a real edit, so the history keeps a
  // `before` for it — the hours moved and something has to say why.
  const base = {
    workDate: '2026-08-12',
    startTime: '08:00',
    endTime: '20:00',
    endsNextDay: false,
    noBreakTaken: false,
    flatDaily: false,
    description: 'เข้าเวรวันแม่',
  };
  assert.equal(sameSession(base, { ...base, flatDaily: true }), false);

  const model = readFileSync(join(ROOT, 'src/models/OtEntry.js'), 'utf8');
  assert.match(model, /flatDaily: \{ type: Boolean, default: false \}/);
  // …and into the `before` snapshot, or an edit that toggled it would record a
  // change of hours with no field to explain it.
  assert.match(model, /flatDaily: Boolean\(this\.flatDaily\)/);
});

// ── and the form ────────────────────────────────────────────────────────────

/**
 * เมื่อติ๊กแล้วเวลาเริ่มต้นให้เป็น 08:00–17:00 — the fill, which is what HR
 * asked for first. It is a DEFAULT and not a lock: the same request said the
 * times must stay editable, because somebody who came in at 07:30 files 07:30
 * and the cap still holds the day at eight hours.
 */
test('ติ๊กแล้วเติมเวลางานปกติให้ และยังแก้ได้', () => {
  const form = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');

  assert.match(form, /const STANDARD_DAY = Object\.freeze\(\{ startTime: '08:00', endTime: '17:00' \}\)/);
  // One handler for both ticks, so the two cannot come to fill in different days.
  assert.match(form, /const tickDay = \(k, on\) => setForm/);
  assert.match(form, /on \? \{ \.\.\.f, \[k\]: true, \.\.\.STANDARD_DAY \} : \{ \.\.\.f, \[k\]: false \}/);
  assert.match(form, /onChange=\{\(e\) => tickDay\('flatDaily', e\.target\.checked\)\}/);
  assert.match(form, /onChange=\{\(e\) => tickDay\('birthdayWelfare', e\.target\.checked\)\}/);

  // The time boxes take no `disabled` of any kind — nothing on this form locks
  // a time, and a lock is what "แก้ได้" would lose.
  const times = form.slice(form.indexOf('<label>เวลาเริ่ม (จาก)</label>'));
  assert.ok(
    !/disabled/.test(times.slice(0, times.indexOf('form-checks'))),
    'a tick locked the clock — HR asked for the opposite',
  );
});
