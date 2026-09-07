import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BUCKETS, computeSession, flatDailyMinutes, makeIsHoliday, resolveDayTypes, sessionDates,
} from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import {
  ENTERED_FIELDS, pickSession, sameSession, zeroOtHoursAllowed,
  flatDayEnd, endsNextDayFor, FLAT_DAY_SPAN_MINUTES,
} from '../lib/entries.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * เหมารายวัน — a day hired whole, which counts EIGHT HOURS OF OT ×1.5 IN THE
 * COLUMN THE DAY ITSELF DECIDES.
 *
 * HR's rule, 2026-09-03, asked for in these words: some departments do work
 * เหมา, but not every day and not everybody — so it is a tick on the request
 * rather than the department-wide `otMode: 'daily'` beside it (lib/otMode.js),
 * which answers "does this department have weekday OT at all" and goes on
 * answering it. Ticked, the form fills in 08:00–17:00; the START stays editable
 * and the END follows it nine hours on (2026-09-07 — see the form tests at the
 * foot of this file).
 *
 * ── WHERE THE EIGHT HOURS GO, WHICH HAS BEEN ANSWERED THREE TIMES ─────────
 *
 * **ให้คิดตามวันไปเลย ถ้าวันหยุดก็ใส่ 8 ชั่วโมงวันหยุด ถ้าไม่ใช่วันหยุดก็ใส่ 8
 * ชั่วโมงวันปกติ แต่แค่เป็นแบบเหมา** (2026-09-07) is what runs. A holiday —
 * Saturday, Sunday, the company calendar, or the filer's own วันเกิด — puts the
 * eight in `ot15_holiday`; an ordinary working day puts them in `ot15_weekday`;
 * `ot3_holiday` is nought on every flat day, because ×1.5 เสมอ was asked for in
 * the same breath and an evening start would otherwise land there.
 *
 * It replaced two readings, and the file keeps both because each explains a
 * shape of the tests below:
 *
 *   **A CEILING** (2026-09-03 → 2026-09-04). The day was computed the ordinary
 *   way and trimmed back to eight from the end, so a Saturday 08:00–20:00 kept
 *   eight hours of `ot15_holiday` and lost the three of `ot3_holiday` — but an
 *   evening that began at 20:00 kept ×3, and a half day was paid a half day,
 *   because a ceiling is a maximum.
 *
 *   **NOT OT AT ALL** (2026-09-04 → 2026-09-07). *ก็คือ 8 ชั่วโมงไม่มีบวกเพิ่ม*
 *   read as the ordinary day: three noughts in the rate columns and the eight
 *   hours in `totals.normalHours`, on the reasoning that a day already paid for
 *   by the flat rate cannot also be an overtime claim.
 *
 * What survived all three is the LENGTH: eight hours, early in, early out, or
 * stayed to 20:00. **A ceiling gets the totals right and the columns wrong, and
 * the columns are what the money is worked out from** — which is why this file
 * tests columns and not just a sum.
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
/** An ordinary Tuesday evening — the shape most requests in the system are. */
const WEEKDAY_EVENING = { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' };

const ALL_BUCKETS_NOUGHT = {
  [BUCKETS.OT15_WEEKDAY]: 0,
  [BUCKETS.OT15_HOLIDAY]: 0,
  [BUCKETS.OT3_HOLIDAY]: 0,
};

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

// ── the column is the day's answer, the figure is the tick's ────────────────

/**
 * THE RULE, STATED AS COLUMNS. `otHours` alone would pass against a build that
 * put the eight hours in the wrong one, and the column is what the money is
 * worked out from — so every case here asserts per bucket.
 */
test('ติ๊กเหมาแล้ววันหยุดเต็มวัน — แปดชั่วโมงลงช่องวันหยุด ×1.5', () => {
  const plain = run(HOLIDAY_DAY);
  const flat = run({ ...HOLIDAY_DAY, flatDaily: true });

  assert.equal(plain.totals.otHours, 8, 'ไม่ติ๊ก วันหยุดเต็มวันก็เป็น OT 8 ชม. อยู่แล้ว');
  assert.equal(plain.buckets[BUCKETS.OT15_HOLIDAY], 8);

  assert.equal(flat.totals.otHours, 8);
  assert.equal(flat.buckets[BUCKETS.OT15_HOLIDAY], 8);
  assert.equal(flat.buckets[BUCKETS.OT15_WEEKDAY], 0);
  assert.equal(flat.buckets[BUCKETS.OT3_HOLIDAY], 0);
  assert.equal(flat.totals.weightedHours, 12, '8 × 1.5');
  // The eight hours are claimed ONCE, in a rate column. Carried here as well
  // they would be the same day counted twice on one document — which is what
  // this field did between 2026-09-04 and 2026-09-07.
  assert.equal(flat.totals.normalHours, 0);
});

/**
 * AN ORDINARY WEEKDAY, which is the half of *คิดตามวัน* the other cases cannot
 * show: nothing about this day is วันหยุด, so its eight hours are the ×1.5
 * วันปกติ column — the same column an ordinary Tuesday evening lands in.
 */
test('ติ๊กเหมาในวันทำงาน — แปดชั่วโมงลงช่องวันปกติ ×1.5', () => {
  const flat = run({ ...WEEKDAY_EVENING, flatDaily: true });

  assert.equal(flat.buckets[BUCKETS.OT15_WEEKDAY], 8);
  assert.equal(flat.buckets[BUCKETS.OT15_HOLIDAY], 0);
  assert.equal(flat.buckets[BUCKETS.OT3_HOLIDAY], 0);
  assert.equal(flat.totals.otHours, 8);
  assert.equal(flat.totals.normalHours, 0);

  // Without the tick the same evening is the three hours somebody worked.
  const plain = run(WEEKDAY_EVENING);
  assert.equal(plain.buckets[BUCKETS.OT15_WEEKDAY], 3);

  // A full weekday 08:00–17:00 is the same eight, and this is the case the
  // 2026-09-04 rule had nothing to say about: nothing of it falls in the OT
  // window at all, so an ordinary computation would be a request of nought.
  const fullDay = run({
    workDate: '2026-08-04', startTime: '08:00', endTime: '17:00', flatDaily: true,
  });
  assert.equal(fullDay.buckets[BUCKETS.OT15_WEEKDAY], 8);
  assert.equal(fullDay.flatDailyTrimmed, 0);
  assert.equal(fullDay.warnings.length, 0, 'ไม่มีอะไรถูกตัด และไม่มีคำเตือน');
});

/**
 * ×1.5 เสมอ — THE RATE IS WRITTEN, NEVER CLOCKED. On a holiday every minute is
 * a holiday minute, so reading the bucket off the clock would put an evening
 * start in the ×3 column. This is the assertion that fails first if anybody
 * "fixes" the flat branch to reuse `bucketFor`.
 */
test('ช่อง ×3 เป็นศูนย์บนใบเหมาทุกใบ แม้จะเริ่มงานตอนกลางคืน', () => {
  for (const session of [
    { workDate: '2026-08-12', startTime: '20:00', endTime: '23:00' },
    { workDate: '2026-08-08', startTime: '18:00', endTime: '06:00', endsNextDay: true },
    { workDate: '2026-08-12', startTime: '08:00', endTime: '20:00' },
  ]) {
    const flat = run({ ...session, flatDaily: true });
    assert.equal(flat.buckets[BUCKETS.OT3_HOLIDAY], 0, `${session.startTime}: ×3 ต้องว่าง`);
    assert.equal(flat.buckets[BUCKETS.OT15_HOLIDAY], 8);
    assert.equal(flat.totals.ot3Hours, 0);
  }

  // …and the ×3 column is alive and well on the same evening without the tick.
  const plain = run({ workDate: '2026-08-12', startTime: '20:00', endTime: '23:00' });
  assert.equal(plain.buckets[BUCKETS.OT3_HOLIDAY], 3);
});

/**
 * The case the 2026-09-04 sentence was asked about in so many words — *อยู่หลัง
 * 17:00 น. ก็คือ 8 ชั่วโมงไม่มีบวกเพิ่ม*. Eleven hours in the OT window, eight
 * counted, and the three that are not have a name.
 */
test('อยู่เกินวันเหมา — ยังแปดชั่วโมง และส่วนเกินมีชื่อเรียก', () => {
  const plain = run(HOLIDAY_LONG);
  const flat = run({ ...HOLIDAY_LONG, flatDaily: true });

  assert.equal(plain.totals.otHours, 11, '08:00–20:00 บนวันหยุด = 8 + 3');

  assert.equal(flat.totals.otHours, 8);
  assert.equal(flat.buckets[BUCKETS.OT15_HOLIDAY], 8);
  assert.equal(flat.flatDailyTrimmed, 3);
  const note = flat.warnings.find((w) => w.code === 'FLAT_DAILY_CAPPED');
  assert.ok(note, 'ต้องบอกว่าชั่วโมงส่วนเกินไม่ถูกนับ');
  assert.equal(note.minutes, 180);
  // FLAT_DAILY_NO_OT was the 2026-09-04 warning and went out with the rule that
  // produced it — a flat day has OT hours now, so there is no nought to explain.
  assert.ok(!flat.warnings.some((w) => w.code === 'FLAT_DAILY_NO_OT'));
});

/**
 * ก็คือ 8 ชั่วโมง — INCLUDING WHEN THEY LEFT EARLY, which is the half that
 * reverses the ceiling outright. A ceiling is a maximum and does not pad a
 * short day; a flat RATE is a price, and the price of a day sold whole does not
 * fall because somebody went home at noon. *สแกนเข้าก่อนหรือออกก่อนหรือหลัง
 * 17:00 น. ก็คือ 8 ชั่วโมง*, asked for in both directions in one breath.
 */
test('เข้าก่อนหรือออกก่อน ก็ยังแปดชั่วโมง — ไม่ลดตามเวลาที่อยู่', () => {
  const short = run({
    workDate: '2026-08-12', startTime: '08:00', endTime: '12:00', flatDaily: true,
  });
  assert.equal(short.totals.otHours, 8, 'ครึ่งวันก็ยังเป็นวันที่ถูกเหมาไปแล้ว');
  assert.equal(short.buckets[BUCKETS.OT15_HOLIDAY], 8);
  assert.equal(short.flatDailyTrimmed, 0, 'ไม่มีอะไรถูกตัด');
  assert.equal(short.warnings.length, 0);

  const early = run({
    workDate: '2026-08-12', startTime: '06:30', endTime: '15:00', flatDaily: true,
  });
  assert.equal(early.totals.otHours, 8);
  assert.equal(early.buckets[BUCKETS.OT15_HOLIDAY], 8);
});

/**
 * THE CLOCK TIMES STAY AS WORKED, and the row carries both: the times somebody
 * was here, and the day's own worth beside them. `minutes` is deliberately not
 * `end − start` — `applyFlatDeduction` has always shortened a segment without
 * moving its clock.
 */
test('แถวเดียว เวลาเป็นเวลาจริง ตัวเลขเป็นของวันเหมา', () => {
  const flat = run({ ...HOLIDAY_LONG, flatDaily: true });

  assert.equal(flat.totals.clockHours, 12, 'ตั้งแต่ 08:00 ถึง 20:00');
  assert.equal(flat.totals.breakHours, 1, 'พักเที่ยงยังถูกหักตามเดิม');

  assert.equal(flat.segments.length, 1);
  assert.deepEqual(flat.segments[0], {
    date: '2026-08-12',
    start: '08:00',
    end: '20:00',
    dayType: 'holiday',
    dayReason: 'companyHoliday',
    bucket: BUCKETS.OT15_HOLIDAY,
    multiplier: 1.5,
    minutes: 480,
    hours: 8,
  });
});

/**
 * AN OVERNIGHT เหมา DAY IS STILL ONE DAY, AND ONE ROW. The figure is per
 * REQUEST — a Saturday shift running into Sunday is eight hours in total, not
 * eight per date — and the row is dated `workDate`, the day that was bought.
 * Reading the far side would let the column depend on how late somebody stayed.
 */
test('กะข้ามคืนที่ติ๊กเหมา — แปดชั่วโมงต่อใบ และแถวเดียวลงวันที่เริ่ม', () => {
  const overnight = {
    workDate: '2026-08-08', startTime: '18:00', endTime: '06:00', endsNextDay: true,
  };
  const plain = run(overnight);
  const flat = run({ ...overnight, flatDaily: true });

  assert.equal(plain.totals.otHours, 12, '18:00 เสาร์ ถึง 06:00 อาทิตย์');

  assert.equal(flat.totals.otHours, 8);
  assert.equal(flat.buckets[BUCKETS.OT15_HOLIDAY], 8);
  assert.equal(flat.segments.length, 1);
  assert.equal(flat.segments[0].date, '2026-08-08');
  assert.equal(flat.endsNextDay, true, 'ใบยังบอกว่าข้ามคืน');
  assert.equal(flat.flatDailyTrimmed, 4, '12 ชม. ในช่วง OT นับ 8');
});

test('ไม่ติ๊ก — กฎนี้ไม่มีผลกับอะไรเลย', () => {
  const long = run(HOLIDAY_LONG);
  assert.equal(long.totals.otHours, 11);
  assert.equal(long.totals.normalHours, 0);
  assert.equal(long.flatDailyTrimmed, 0);
  assert.ok(!long.warnings.some((w) => w.code === 'FLAT_DAILY_CAPPED'));
});

// ── the OT rules do not run on it, and that is the point of the ordering ────

/**
 * THE OTHER FOUR RULES ARE SKIPPED ENTIRELY, not run and then overwritten.
 *
 * The buffer, the rounding block and the minimum each ask *how much of what was
 * worked is payable OT*, and a flat day does not answer that: the figure is the
 * day's own length, agreed in advance. Left in front, `belowMinimum: 'reject'`
 * would THROW a flat evening out of the form for being under an hour of
 * overtime it is not measuring.
 */
test('กฎ OT อื่นไม่ทำงานกับใบเหมา — แม้แต่ belowMinimum: reject ก็ไม่ปฏิเสธ', () => {
  const strict = {
    ...DEFAULT_POLICY, belowMinimum: 'reject', minimumHours: 1, minimumBufferMinutes: 30,
  };
  // Forty minutes: over the 30-minute buffer, so it reaches the minimum, and
  // under the one-hour minimum once floor/30 has had it — which is exactly the
  // session `belowMinimum: 'reject'` throws on.
  const shortEvening = {
    workDate: '2026-08-04', startTime: '17:00', endTime: '17:40', flatDaily: true,
  };

  // Without the tick this policy refuses the session outright.
  assert.throws(() => run({ ...shortEvening, flatDaily: false }, strict));

  const flat = run(shortEvening, strict);
  assert.equal(flat.totals.otHours, 8, 'วันเหมาเป็นแปดชั่วโมง ไม่ใช่สี่สิบนาที');
  assert.equal(flat.buckets[BUCKETS.OT15_WEEKDAY], 8);
  // Neither flag is left carrying an answer about a figure that was never
  // measured — `belowMinimumFlagged` would put the row on HR's list.
  assert.equal(flat.belowMinimumFlagged, false);
  assert.equal(flat.belowBufferZeroed, false);
});

/**
 * `belowMinimum: 'raise'` cannot pad a flat day either, and this is the same
 * ordering read from the other side: the padding rule never sees it. The eight
 * hours are exact, and a rule that made them nine would be inventing a figure
 * nobody agreed.
 */
test('belowMinimum: raise ไม่เติมชั่วโมงให้ใบเหมา', () => {
  const raise = { ...DEFAULT_POLICY, belowMinimum: 'raise', minimumHours: 2 };
  const flat = run({
    workDate: '2026-08-04', startTime: '17:00', endTime: '17:40', flatDaily: true,
  }, raise);

  assert.equal(flat.totals.otHours, 8);
  assert.ok(!flat.warnings.some((w) => w.code === 'RAISED_TO_MINIMUM'));
});

/**
 * AND THE ROUNDING BLOCK DOES NOT REACH IT EITHER. `flatDailyMinutes()` is
 * derived from the core day and can be a figure no block divides — a 15-minute
 * block leaves eight hours alone, but the rule has to hold for the awkward one
 * as well, or the day's length would quietly become the policy's idea of it.
 */
test('บล็อกการปัดเวลาไม่แตะวันเหมา', () => {
  const ceil20 = { ...DEFAULT_POLICY, roundingMode: 'ceil', roundingIncrementMinutes: 20 };
  const flat = run({ ...HOLIDAY_LONG, flatDaily: true }, ceil20);
  assert.equal(flat.totals.otHours, 8);

  // A core day that is not a whole number of hours: seven and a half, and it
  // stays seven and a half.
  const oddDay = { ...DEFAULT_POLICY, coreEndMinute: 16 * 60 + 30 };
  const odd = run({ ...HOLIDAY_LONG, flatDaily: true }, oddDay);
  assert.equal(odd.totals.otHours, 7.5);
  assert.equal(odd.buckets[BUCKETS.OT15_HOLIDAY], 7.5);
});

// ── it survives the trip to the database ────────────────────────────────────

/**
 * THE ONE EXEMPTION FROM THE 0-HOUR RULE, and a flat day cannot be filed
 * without it: every write path refuses `otHours <= 0`, and a flat request is
 * nought in every column by design.
 *
 * One function, asked by all five, so the exemption cannot be remembered in
 * four places and forgotten in the fifth.
 */
test('ใบเหมาเป็นศูนย์ได้ — และทุกทางเขียนถามฟังก์ชันเดียวกัน', () => {
  assert.equal(zeroOtHoursAllowed({ flatDaily: true }), true);
  assert.equal(zeroOtHoursAllowed({ flatDaily: false }), false);
  assert.equal(zeroOtHoursAllowed({}), false);
  assert.equal(zeroOtHoursAllowed(null), false);

  for (const path of [
    'app/api/entries/route.js',
    'app/api/entries/[id]/route.js',
    'legacy/routes/entries.js',
    'src/services/otService.js',
  ]) {
    const src = readFileSync(join(ROOT, path), 'utf8');
    assert.match(
      src,
      /otHours <= 0 && !zeroOtHoursAllowed\(session\)/,
      `${path}: ยังปฏิเสธใบเหมาที่คำนวณได้ 0 ชั่วโมง`,
    );
  }

  // And the button on the form asks it too, so a screen cannot grey out a
  // request the server would have taken.
  const form = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');
  assert.match(form, /!zeroOtHoursAllowed\(form\)/);
});

/**
 * A REPLAY REBUILDS THE SESSION FROM THE DOCUMENT, and `flatDaily` was missing
 * from that list from the day the tick was added until 2026-09-04. Left out, a
 * policy change would replay a เหมารายวัน day as an ordinary one and write the
 * OT hours it does not claim back onto an approved entry — with a `recompute`
 * row in its history saying the policy did it.
 */
test('replay และ whatif ส่ง flatDaily ต่อไปให้ engine', () => {
  for (const path of ['src/services/otService.js', 'src/whatif.js']) {
    const src = readFileSync(join(ROOT, path), 'utf8');
    assert.match(src, /flatDaily: entry\.flatDaily/, `${path}: ใบเหมาจะถูกคิดใหม่เป็นใบธรรมดา`);
  }
});

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
  // The eight hours need a column of their own on the document: with the three
  // rate columns at nought, this is the only thing saying the day was worth
  // anything at all.
  assert.match(model, /normalHours: \{ type: Number, default: 0 \}/);
  assert.match(model, /normalHours: this\.totals\?\.normalHours \?\? 0/);
});

// ── and the form ────────────────────────────────────────────────────────────

/**
 * เมื่อติ๊กแล้วเวลาเริ่มต้นให้เป็น 08:00–17:00 — the fill, which is what HR
 * asked for first. It is a DEFAULT and not a lock: the same request said the
 * times must stay editable, because somebody who came in at 07:30 files 07:30
 * and the day is still the eight hours it was hired for.
 *
 * THE END HALF OF THAT WAS WITHDRAWN ON 2026-09-07 — see the test below. This
 * one holds what survives: the fill, and the start staying free.
 */
test('ติ๊กแล้วเติมเวลางานปกติให้ และเวลาเริ่มยังแก้ได้', () => {
  const form = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');

  assert.match(form, /const STANDARD_DAY = Object\.freeze\(\{ startTime: '08:00', endTime: '17:00' \}\)/);
  // One handler for both ticks, so the two cannot come to fill in different days.
  assert.match(form, /const tickDay = \(k, on\) => setForm/);
  assert.match(form, /on \? \{ \.\.\.f, \[k\]: true, \.\.\.STANDARD_DAY \} : \{ \.\.\.f, \[k\]: false \}/);
  assert.match(form, /onChange=\{\(e\) => tickDay\('flatDaily', e\.target\.checked\)\}/);
  assert.match(form, /onChange=\{\(e\) => tickDay\('birthdayWelfare', e\.target\.checked\)\}/);

  // เวลาเริ่ม takes no `disabled` of any kind. This is the half of "แก้ได้"
  // that HR kept, and the box that carries the whole of a flat day now.
  const start = form.slice(form.indexOf('<label>เวลาเริ่ม (จาก)</label>'));
  assert.ok(
    !/disabled/.test(start.slice(0, start.indexOf('<label>เวลาสิ้นสุด (ถึง)</label>'))),
    'the start box was locked — that is the half HR asked to keep',
  );
});

/**
 * เวลาจบบวกให้เอง 9 ชั่วโมง — HR, 2026-09-07, in these words: the tick may go on
 * showing 08:00–17:00 and the START may be changed, *แต่เวลาจบไม่สามารถปรับได้
 * ให้บวกจากเวลาเริ่ม 9 ชั่วโมงอัตโนมัติ … คือ บวกเวลาพัก 1 ชั่วโมงด้วย*.
 *
 * NINE ON THE CLOCK AND EIGHT ON THE PAY is the whole of it, and the two numbers
 * have to be held apart or one of them gets "fixed" into the other. The span is
 * `FLAT_DAY_SPAN_MINUTES` in lib/entries.js and decides only what the boxes
 * read; the figure is `flatDailyMinutes()` in the engine, derived from the
 * policy less the lunch hour, and it is the only thing any money is worked out
 * from. The หัวข้อ *ในใบขออนุมัติทำงานล่วงเวลา โชว์ 8 ชั่วโมงไม่รวมเวลาพัก* is
 * that second number, and it was already what the engine answered — see the
 * `computeSession` cases at the top of this file.
 */
test('ใบเหมา — เวลาจบเป็นเวลาเริ่ม + 9 ชม. และช่องนั้นแก้เองไม่ได้', () => {
  // The rule itself, exercised rather than read: 07:00 → 16:00, and the fill
  // the tick writes is a pair this rule would also produce, which is what stops
  // ticking the box and then touching the start from jumping to another day.
  assert.equal(FLAT_DAY_SPAN_MINUTES, 9 * 60);
  assert.equal(flatDayEnd('07:00'), '16:00');
  assert.equal(flatDayEnd('08:00'), '17:00');
  assert.equal(flatDayEnd('08:30'), '17:30');
  // It wraps, and the form has to notice — see `endsNextDayFor` below.
  assert.equal(flatDayEnd('16:00'), '01:00');
  assert.equal(flatDayEnd('15:00'), '00:00');
  assert.equal(endsNextDayFor('16:00', flatDayEnd('16:00')), true);
  assert.equal(endsNextDayFor('07:00', flatDayEnd('07:00')), false);
  // A blank box is a blank answer rather than a guess.
  assert.equal(flatDayEnd(''), '');
  assert.equal(flatDayEnd('24:00'), '');

  const form = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');

  // ONE PLACE COMPUTES IT, and it is the start box's own handler — so there is
  // no path through this form that moves the start and leaves the end behind.
  assert.match(form, /const setStart = \(v\) => setForm/);
  assert.match(form, /endTime: flatDayEnd\(v\), endsNextDay: endsNextDayFor\(v, flatDayEnd\(v\)\)/);
  assert.match(form, /onChange=\{setStart\}/);

  // …and the end box is shut, with the ข้ามคืน tick that now describes it.
  // Both are `form.flatDaily` and neither is `form.birthdayWelfare`: a birthday
  // is an ordinary shift on a holiday and its length is still whatever it was.
  const end = form.slice(form.indexOf('<label>เวลาสิ้นสุด (ถึง)</label>'));
  assert.match(end.slice(0, end.indexOf('</div>')), /disabled=\{form\.flatDaily\}/);
  assert.match(form, /checked=\{form\.endsNextDay\}\s*\r?\n\s*disabled=\{form\.flatDaily\}/);
  assert.ok(
    !/disabled=\{form\.birthdayWelfare\}/.test(form),
    'the วันเกิด tick locked a time — only เหมารายวัน does',
  );

  // The person is told, in the two places they are looking: beside the greyed
  // box, and in the line under the ticks.
  assert.match(form, /บวกจากเวลาเริ่ม \{FLAT_DAY_SPAN_MINUTES \/ 60\} ชม\. ให้อัตโนมัติ/);
  assert.match(form, /ทำงาน 8 ชม\. \+ พักเที่ยง 1 ชม\./);
  assert.match(form, /บนใบขออนุมัติยังนับ 8 ชั่วโมง ไม่รวมเวลาพัก/);
});

/**
 * ONE SENTENCE, IN ONE PLACE, FOR THE BADGE AND EVERY SCREEN THAT EXPLAINS IT.
 *
 * The preview is about to print 8.00 against times that may read five hours or
 * twelve, which on any other request would mean the form is wrong. The reader
 * needs the sentence before they reach the figure, in the green a fact wears
 * rather than the amber a problem wears — and the row in ตรวจสอบประจำเดือน needs
 * the same words, or the screen that files a flat day and the screen that
 * reviews one explain one rule twice.
 *
 * ── IT HAS BEEN THREE SENTENCES, AND IT IS ONE AGAIN ────────────────────────
 *
 * *นับ 8 ชั่วโมงปกติ ไม่คิดชั่วโมง OT* explained three noughts, and stood while
 * there were three noughts to explain (2026-09-04 → 2026-09-07). For part of
 * 2026-09-07 there were TWO constants — `FLAT_DAILY_BIRTHDAY_SAY` beside it, and
 * `flatDailySay()` choosing between them off the engine's `dayReason` — because
 * the OT reading arrived as a rule about วันเกิด days only. It was widened to
 * every flat day the same day, and the second constant and its chooser went out
 * with the distinction that needed them.
 *
 * WHAT THE SURVIVING SENTENCE MAY NOT DO IS NAME THE COLUMN. It is one string
 * for both kinds of day; "วันหยุด" in it would be wrong on half the rows, and a
 * template with the column interpolated is a sentence nobody can grep for. The
 * column is on the row already — what is not on the row is why a twelve-hour
 * shift reads eight.
 */
test('ป้ายเขียวและคำกำกับใต้ป้ายพูดประโยคเดียวกัน', () => {
  const common = readFileSync(join(ROOT, 'components/common.jsx'), 'utf8');
  const form = readFileSync(join(ROOT, 'components/OtForm.jsx'), 'utf8');

  assert.match(
    common,
    /export const FLAT_DAILY_SAY = 'พนักงานเหมารายวัน — นับ 8 ชั่วโมงเป็น OT ×1\.5 ไม่ว่าจะอยู่นานแค่ไหน';/,
  );
  // ONE CONSTANT, and the pair that briefly stood beside it may not come back
  // under either name: the rule they split has no split in it any more.
  // Comments stripped, because the note above the surviving constant records
  // what the other one was called — the same trap the `{detail` check below
  // documents.
  const commonCode = common.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(
    !/FLAT_DAILY_BIRTHDAY_SAY|flatDailySay/.test(commonCode),
    'the two-sentence chooser is back — one rule, one sentence',
  );
  // The sentence does not name a column, because it is drawn on both kinds of
  // flat day and one of the two would be wrong.
  assert.ok(
    !/FLAT_DAILY_SAY = '[^']*วันหยุด/.test(common),
    'the sentence names a rate column — it is drawn on วันปกติ rows too',
  );
  // The chip is the green one, and it is drawn off the entry's own tick — true
  // on a month whose scanner file nobody has imported.
  //
  // ── THE TITLE IS THE RULE ALONE SINCE 2026-09-07 ─────────────────────────
  // It read `title={scanMismatchNote(check) || FLAT_DAILY_SAY}` until then, so a
  // flat row whose scan disagreed hovered as "…ไม่คิดชั่วโมง OT · เวลาสิ้นสุด
  // สแกน 15:40 · ขาดอีก 80 นาที (ไม่ต้องแก้)". Reported as a bug and it is one:
  // the first half says the times on this request are not something the machine
  // can be short against, and the second half measures a shortfall against them
  // anyway. **ไม่มีการตัดเวลา** — so `scanMismatchDetail` answers null on every
  // flat row and there is nothing left to append.
  assert.match(common, /<span className="chip scan-flat" title=\{FLAT_DAILY_SAY\}>/);
  // The note under it is UNCONDITIONAL: it explains the eight hours in the rate
  // column, which are there whether or not anybody has uploaded a scan file to
  // compare.
  const mark = common.slice(common.indexOf('export function FlatDailyMark'));
  const body = mark.slice(0, mark.indexOf('\n}'));
  assert.match(body, /<div className="cell-sub th">\s*\{FLAT_DAILY_SAY\}/);
  // …and nothing is appended to it. The row still shows the day's raw punches
  // through `ScanDayPunches`; what is gone is arithmetic against a claim a flat
  // day never made.
  // Matched against the code with comments stripped: the note explaining WHY
  // the appended finding went away quotes the wording it removed, and an
  // assertion against the raw file passes or fails on that quotation instead of
  // on the JSX. Same trap test/submissionWindowForm.test.js documents.
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(
    !/\{detail/.test(code),
    'the scan finding was appended to the flat row again',
  );
  assert.ok(
    !/ยังได้ 8 ชั่วโมงตามเดิม/.test(code),
    'the shortfall wording came back onto the flat row',
  );

  // The form says it too, from the same constant rather than a second copy, and
  // the green panel is drawn on EVERY flat preview — it was keyed on
  // `normalHours > 0` until 2026-09-07, which is nought on every session now and
  // would draw the panel on none of them.
  assert.ok(!form.includes('เหมารายวันคิดให้ไม่เกิน 8 ชั่วโมง'), 'the ceiling wording is still on the form');
  assert.match(form, /\{form\.flatDaily && \(\s*\r?\n\s*<Alert kind="ok">\s*\r?\n\s*\{FLAT_DAILY_SAY\}/);
  /**
   * THE LABEL SAYS THE LENGTH AND NOT THE COLUMN — 2026-09-07.
   *
   * It read `เหมารายวัน (นับ 8 ชม. ปกติ ไม่คิด OT)` until the eight hours became
   * OT. Eight hours is what the tick decides and what is true of every flat day;
   * the column is the day's answer and is on the row a moment later.
   */
  assert.match(form, /เหมารายวัน \(นับ 8 ชม\. ต่อวัน\)/);
  assert.ok(
    !/ไม่คิด OT\)/.test(form),
    'the label promises "no OT" again — a flat day is eight hours of OT ×1.5',
  );
});

// ── คิดตามวัน — including the day only one person has ───────────────────────

/**
 * A วันเกิด IS A HOLIDAY, AND THE FLAT RULE DOES NOTHING SPECIAL WITH IT.
 *
 * That is the point of this block, and it is the shape of the rule rather than
 * an extra case: `resolveDayTypes` answers `holiday`/`birthday` for the day the
 * benefit gives one person, and the flat branch reads the answer like any other
 * — so the eight hours go in the วันหยุด column for the same reason a Saturday's
 * do. There is no birthday code in `computeSession` to get wrong.
 *
 * ── THE RULE HELD THIS SHAPE FOR ONE MORNING ─────────────────────────────────
 *
 * On 2026-09-07 the OT ×1.5 reading arrived as *ในกรณีที่ติ๊กช่องเหมารายวันและ
 * วันเกิด … เฉพาะวันที่ไม่ได้เป็นวันเสาร์อาทิตย์และวันหยุดบริษัท* — a birthday
 * rule, with weekends and company holidays carved out and every other flat day
 * still eight normal hours. It was widened the same day (*ไม่ต้องยกเว้นวันเสาร์
 * อาทิตย์ หรือวันหยุดแล้ว ให้คิดตามวันไปเลย*), and the carve-out went with the
 * narrowing that needed it. What is left is one rule with no exceptions in it,
 * which is why these cases now read as ordinary instances of the block above.
 *
 * 4 Aug 2026 is a Tuesday and this employee was born on 4 August. The benefit
 * itself is `birthdayHolidayEnabled`, which ships off.
 */
const BIRTHDAY_POLICY = { ...DEFAULT_POLICY, birthdayHolidayEnabled: true };
const BORN_04_AUG = '1990-08-04';

function runBirthday(session, birthDate = BORN_04_AUG, policy = BIRTHDAY_POLICY) {
  return computeSession(session, {
    policy,
    dayTypes: resolveDayTypes(sessionDates(session), {
      isHoliday: makeIsHoliday(['2026-08-12'], policy),
      birthDate,
      policy,
    }),
  });
}

test('เหมารายวันที่ตรงวันเกิด — แปดชั่วโมงลงช่องวันหยุด ×1.5 เหมือนวันหยุดอื่น', () => {
  const flat = runBirthday({
    workDate: '2026-08-04', startTime: '08:00', endTime: '17:00', flatDaily: true,
  });

  assert.equal(flat.totals.otHours, 8);
  assert.equal(flat.buckets[BUCKETS.OT15_HOLIDAY], 8, 'ช่อง OT วันหยุด ×1.5');
  assert.equal(flat.buckets[BUCKETS.OT15_WEEKDAY], 0);
  assert.equal(flat.buckets[BUCKETS.OT3_HOLIDAY], 0);
  assert.equal(flat.totals.normalHours, 0);

  // The reason rides along on the row, which is what keeps the OT
  // สวัสดิการวันเกิด chip on it — `isBirthdayWelfare` reads `dayReason` off the
  // segments and has no other way to know.
  assert.equal(flat.segments.length, 1);
  assert.equal(flat.segments[0].dayReason, 'birthday');
  assert.equal(flat.segments[0].bucket, BUCKETS.OT15_HOLIDAY);

  // Same person, same tick, an ordinary Wednesday: the วันปกติ column. The day
  // decides, and nothing else does.
  const ordinary = runBirthday({
    workDate: '2026-08-05', startTime: '08:00', endTime: '17:00', flatDaily: true,
  });
  assert.equal(ordinary.buckets[BUCKETS.OT15_WEEKDAY], 8);
  assert.equal(ordinary.segments[0].dayReason, null);
});

/**
 * THE CARVE-OUT IS GONE — *ไม่ต้องยกเว้นวันเสาร์อาทิตย์ หรือวันหยุดแล้ว*. A
 * birthday that lands on a Saturday or on วันแม่ reads `weekend` /
 * `companyHoliday` rather than `birthday`, because the day was already วันหยุด
 * for everybody and the benefit added nothing — and that changes the LABEL on
 * the row, not the figure: eight hours in the same วันหยุด column either way.
 */
test('วันเกิดที่ตรงเสาร์หรือวันหยุดบริษัท — ตัวเลขเท่ากัน เปลี่ยนแค่เหตุผลของวัน', () => {
  for (const [date, born, reason] of [
    ['2026-08-08', '1990-08-08', 'weekend'],
    ['2026-08-12', '1990-08-12', 'companyHoliday'],
  ]) {
    const flat = runBirthday(
      { workDate: date, startTime: '08:00', endTime: '17:00', flatDaily: true },
      born,
    );
    assert.equal(flat.totals.otHours, 8, `${date}: แปดชั่วโมง`);
    assert.equal(flat.buckets[BUCKETS.OT15_HOLIDAY], 8);
    assert.equal(flat.totals.normalHours, 0);
    assert.equal(flat.segments[0].dayReason, reason, `${date}: เหตุผลของวัน`);
  }
});

/**
 * IT IS THE RESOLVED DAY THAT DECIDES, NEVER THE TICK — the invariant
 * test/birthdayTick.test.js holds, read from this side. The ช่องวันเกิด says what
 * is being CLAIMED and `birthdayTickRefusal` is the verdict on the claim; the
 * column comes from the stored วันเกิด through `resolveDayTypes`.
 *
 * `computeSession` never sees `birthdayWelfare` at all, which is what makes that
 * unforgeable — asserted here so nobody adds it as a convenience.
 */
test('ช่องติ๊กวันเกิดไม่ได้เลือกคอลัมน์ — วันเกิดที่เก็บไว้ต่างหากที่เลือก', () => {
  const ticked = runBirthday({
    workDate: '2026-08-04', startTime: '08:00', endTime: '17:00', flatDaily: true, birthdayWelfare: true,
  });
  const untouched = runBirthday({
    workDate: '2026-08-04', startTime: '08:00', endTime: '17:00', flatDaily: true,
  });
  assert.deepEqual(ticked.buckets, untouched.buckets);

  // Somebody born on another day, ticking whatever they like, gets the column
  // an ordinary Tuesday has.
  const notTheirBirthday = runBirthday(
    { workDate: '2026-08-04', startTime: '08:00', endTime: '17:00', flatDaily: true, birthdayWelfare: true },
    '1990-10-13',
  );
  assert.equal(notTheirBirthday.buckets[BUCKETS.OT15_WEEKDAY], 8);
  assert.equal(notTheirBirthday.buckets[BUCKETS.OT15_HOLIDAY], 0);

  // Comments stripped first: the branch is documented by naming the field it
  // deliberately does NOT read, and an assertion against the raw file would
  // fail on that sentence instead of on the code.
  const engine = readFileSync(join(ROOT, 'src/lib/otEngine.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(
    !/birthdayWelfare/.test(engine),
    'the engine reads the tick — the day type is the only thing that may decide hours',
  );
});

/**
 * THE BENEFIT IS OFF WHERE IT IS OFF. `birthdayHolidayEnabled` ships false — it
 * is a benefit somebody has to decide to grant — and with it off a birthday is
 * an ordinary working day, so a flat day on it takes the วันปกติ column.
 */
test('ปิดสวัสดิการวันเกิดไว้ — ใบเหมาวันเกิดเป็นวันทำงานธรรมดา', () => {
  const off = runBirthday(
    { workDate: '2026-08-04', startTime: '08:00', endTime: '17:00', flatDaily: true },
    BORN_04_AUG,
    DEFAULT_POLICY,
  );
  assert.equal(off.totals.otHours, 8);
  assert.equal(off.buckets[BUCKETS.OT15_WEEKDAY], 8);
  assert.equal(off.buckets[BUCKETS.OT15_HOLIDAY], 0);
});

// ── the review screen corrects the tick too ─────────────────────────────────

/**
 * ติ๊กเหมารายวันได้จากหน้ารออนุมัติ OT — asked for on 2026-09-07, in the
 * รายละเอียด pop-up's แก้ไขชั่วโมง panel.
 *
 * The gap it closes: เหมารายวัน was on the filing form and nowhere else, so a
 * request filed WITHOUT the tick could only be put right by refusing it and
 * having it filed again — which is the round trip `QuickEdit` exists to spare,
 * and it is worse here than for a mistyped minute. The tick changes what the
 * day IS, not how long it was, and nothing on the request as filed shows it is
 * missing: a flat day filed untricked reads as an ordinary twelve-hour shift
 * and pays like one.
 *
 * THE ONE THING THIS PANEL DOES DIFFERENTLY FROM OtForm, and it is deliberate:
 * ticking does NOT fill 08:00–17:00 in. On the filing form those times are a
 * default nobody has typed over; here they are the record of when a person was
 * on the premises, printed on F-HR-027 and signed. The end still FOLLOWS the
 * start once the box is ticked — same `flatDayEnd`, on a press of เวลาเริ่ม —
 * which is exactly how the filing form treats a stored flat row it re-opens.
 */
test('หน้ารออนุมัติ — แก้ไขชั่วโมงติ๊กเหมารายวันได้ และเวลาจบยังบวกจากเวลาเริ่ม', () => {
  const queue = readFileSync(join(ROOT, 'components/ApprovalQueue.jsx'), 'utf8');
  const edit = queue.slice(queue.indexOf('function QuickEdit'), queue.indexOf('const OVER_CAP'));

  // The box is there, and it opens on what the entry says.
  assert.match(edit, /flatDaily: Boolean\(entry\.flatDaily\)/);
  assert.match(edit, /checked=\{form\.flatDaily\}/);
  assert.match(edit, /onChange=\{\(ev\) => set\(\{ flatDaily: ev\.target\.checked \}\)\}/);

  // A tick alone is a saveable correction — without this the panel would draw
  // the box, refuse to send it, and grey บันทึก over a change somebody made.
  assert.match(edit, /form\.flatDaily !== Boolean\(entry\.flatDaily\)/);

  // The rule is `flatDayEnd`'s, on the start box's own press, and the end box
  // is shut behind it — the same pair the filing form draws.
  assert.match(edit, /if \(patch\.startTime !== undefined && next\.flatDaily\) next\.endTime = flatDayEnd\(patch\.startTime\)/);
  assert.match(edit, /disabled=\{form\.flatDaily\}/);

  // AND THE TICK ITSELF MOVES NO TIME. `STANDARD_DAY` is OtForm's fill and it
  // must not reach a stored entry — see the note over `QuickEdit`.
  assert.ok(!/STANDARD_DAY|'08:00'/.test(edit), 'ติ๊กแล้วเวลาบนใบที่เซ็นไปแล้วถูกเขียนทับ');

  // One sentence for the figure, and it is the row chip's own — the delta is
  // about to read 8.00 against times that may say twelve hours.
  assert.match(edit, /\{form\.flatDaily && <Alert kind="ok">\{FLAT_DAILY_SAY\}<\/Alert>\}/);
});
