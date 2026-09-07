/**
 * OT calculation engine.
 *
 * One session in, segmented rate buckets out. This module is pure: no database,
 * no clock, no timezone. Wall-clock times only, which is what the paper form
 * records and what makes midnight crossing tractable.
 *
 * The system never calculates money (requirements §1). Multipliers here are
 * bucket labels, not rates.
 */

import { DEFAULT_POLICY } from '../config/policy.js';

export const BUCKETS = Object.freeze({
  /** Mon–Fri outside 08:00–17:00 → form column "OT วันปกติ (17.01–07.59)" */
  OT15_WEEKDAY: 'ot15_weekday',
  /** Holiday inside 08:00–17:00 → form column "OT วันหยุด (8.00–17.00)" */
  OT15_HOLIDAY: 'ot15_holiday',
  /** Holiday outside 08:00–17:00 → form column "OT วันหยุด (17.01–07.59)" */
  OT3_HOLIDAY: 'ot3_holiday',
});

export const BUCKET_MULTIPLIER = Object.freeze({
  [BUCKETS.OT15_WEEKDAY]: 1.5,
  [BUCKETS.OT15_HOLIDAY]: 1.5,
  [BUCKETS.OT3_HOLIDAY]: 3,
});

export const BUCKET_LABEL_TH = Object.freeze({
  [BUCKETS.OT15_WEEKDAY]: 'OT วันปกติ (17.01–07.59)',
  [BUCKETS.OT15_HOLIDAY]: 'OT วันหยุด (8.00–17.00)',
  [BUCKETS.OT3_HOLIDAY]: 'OT วันหยุด (17.01–07.59)',
});

/**
 * What a calendar date is, for the person whose session is being computed.
 *
 * Two values only, and deliberately so: `dayType` is stored on every segment
 * and on the printed form, and a third value would have to mean something to
 * `bucketFor`, which has exactly two branches. A birthday holiday is a holiday.
 */
export const DAY_TYPES = Object.freeze({ WORKDAY: 'workday', HOLIDAY: 'holiday' });

/**
 * WHY a date is what it is — carried alongside `dayType`, never instead of it.
 *
 * The engine does nothing with this: two segments with the same `dayType` land
 * in the same bucket whatever the reason. It exists because the reason is not
 * recoverable afterwards and somebody always asks. An overnight session that
 * starts on an employee's birthday Friday and runs into Saturday produces two
 * ot3_holiday segments that are identical on the sheet and arrived there by
 * different rules — one because HR turned the birthday rule on, one because
 * Saturday has always been a holiday. Only the first moves if the rule is
 * turned off again.
 */
export const DAY_REASONS = Object.freeze({
  WEEKEND: 'weekend',
  COMPANY_HOLIDAY: 'companyHoliday',
  BIRTHDAY: 'birthday',
});

const MINUTES_PER_DAY = 1440;

/**
 * เหมารายวัน — how many minutes one flat day is worth, and it is a constant
 * here rather than a policy key on purpose.
 *
 * HR's rule, 2026-09-03: some departments hire a day at a time, and not every
 * day and not everybody — so it is a tick on the request rather than the
 * department-wide `otMode` beside it (lib/otMode.js), which answers a different
 * question and keeps answering it. What the tick means is "this day was bought
 * whole": the standard day is 08:00–17:00 less the hour at noon, which is eight
 * hours, and staying past it adds nothing because the length was agreed.
 *
 * WHAT THESE MINUTES ARE has been answered three times. A CEILING on the rate
 * columns (2026-09-03), the ORDINARY DAY with all three buckets at nought
 * (2026-09-04, `totals.normalHours`), and since 2026-09-07 **eight hours of OT
 * ×1.5 in the column the day type decides** — *ถ้าวันหยุดก็ใส่ 8 ชั่วโมงวันหยุด
 * ถ้าไม่ใช่วันหยุดก็ใส่ 8 ชั่วโมงวันปกติ แต่แค่เป็นแบบเหมา*. The number below
 * never moved through any of it; what moved is where it lands. See the branch in
 * `computeSession`.
 *
 * NOT A POLICY KEY, and that is the part worth defending. The eight hours are
 * `coreEndMinute - coreStartMinute` less the lunch hour — the same figure
 * `bucketFor` already draws the ordinary day out of — so a company that moves
 * its core hours moves this too, and a second number in ตั้งค่าระบบ would be a
 * way for the two to disagree. Derived below rather than written as 480 for
 * exactly that reason.
 */
export function flatDailyMinutes(policy = DEFAULT_POLICY) {
  const span = policy.coreEndMinute - policy.coreStartMinute;
  const lunch = policy.breakMode === 'none' ? 0 : (policy.breakMinutes || 0);
  return Math.max(0, span - lunch);
}

export class OtValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OtValidationError';
    this.code = code;
  }
}

// ── date / time helpers (string in, string out — no Date arithmetic) ─────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

export function parseDate(dateStr) {
  const m = DATE_RE.exec(String(dateStr ?? ''));
  if (!m) throw new OtValidationError('BAD_DATE', `Invalid date: ${dateStr}`);
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const back = new Date(ms);
  if (back.getUTCFullYear() !== Number(y) || back.getUTCMonth() !== Number(mo) - 1 || back.getUTCDate() !== Number(d)) {
    throw new OtValidationError('BAD_DATE', `Invalid date: ${dateStr}`);
  }
  return ms;
}

export function formatDate(utcMs) {
  const d = new Date(utcMs);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function addDays(dateStr, days) {
  return formatDate(parseDate(dateStr) + days * 86400000);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(dateStr) {
  return new Date(parseDate(dateStr)).getUTCDay();
}

export function parseTime(timeStr) {
  const m = TIME_RE.exec(String(timeStr ?? '').trim());
  if (!m) throw new OtValidationError('BAD_TIME', `Invalid time: ${timeStr}`);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi !== 0)) {
    throw new OtValidationError('BAD_TIME', `Invalid time: ${timeStr}`);
  }
  return h * 60 + mi;
}

export function formatTime(minuteOfDay) {
  const m = ((minuteOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function minutesToHours(minutes) {
  // 2 decimals is enough for 30-minute increments and avoids float dust
  // (e.g. 0.1 + 0.2) leaking into totals and exports.
  return Math.round((minutes / 60) * 100) / 100;
}

// ── holiday resolution ──────────────────────────────────────────────────────

/**
 * Build the day-type predicate. "Holiday" (วันหยุด) means Saturday, Sunday, or
 * any date on the company holiday calendar — Primus keeps its own list, which
 * is not the government one (requirements §8).
 *
 * @param {string[]|Set<string>} holidayDates  'YYYY-MM-DD' entries
 * @param {object} policy
 */
export function makeIsHoliday(holidayDates = [], policy = DEFAULT_POLICY) {
  const set = holidayDates instanceof Set ? holidayDates : new Set(holidayDates);
  const weekend = new Set(policy.weekendDays);
  return (dateStr) => set.has(dateStr) || weekend.has(dayOfWeek(dateStr));
}

// ── day types ───────────────────────────────────────────────────────────────

/**
 * Every calendar date a session can put minutes into.
 *
 * The caller resolves day types ahead of time and this is the list to resolve.
 * It mirrors `computeSession`'s own segmentation exactly — an overnight session
 * spans two dates that may be different kinds of day, and a caller that
 * resolved only `workDate` would hand the engine a map with a hole in it.
 *
 * Lenient where `computeSession` is strict: a session whose end is not after
 * its start is rejected there, with a message about the form. Throwing a
 * different error here, one step earlier, would replace it with a worse one.
 */
export function sessionDates(session) {
  const { workDate, startTime, endTime } = session || {};
  parseDate(workDate);
  const startMin = parseTime(startTime);
  let endMin = parseTime(endTime);
  if (session.endsNextDay) endMin += MINUTES_PER_DAY;

  const lastDay = Math.floor((Math.max(endMin, startMin + 1) - 1) / MINUTES_PER_DAY);
  const dates = [];
  for (let day = 0; day <= lastDay; day++) dates.push(addDays(workDate, day));
  return dates;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * The date an employee's birthday falls on in a given year, or null.
 *
 * 29 February is the only day of the year that does not exist in every year,
 * and what to do about it is `policy.birthdayLeapFallback` rather than a
 * constant, because it is a choice about somebody's day off and not an
 * arithmetic fact. 'none' is a real answer too: a leap-day birthday gets the
 * holiday in leap years only.
 *
 * A birthDate that is not a real date throws. It can only be read at all when
 * HR has turned the birthday rule ON — see `resolveDayTypes` — so a typo in the
 * roster surfaces at the moment it starts changing hours, rather than quietly
 * granting or withholding a holiday nobody can see the reason for.
 */
export function birthdayInYear(birthDate, year, policy = DEFAULT_POLICY) {
  if (!birthDate) return null;

  const m = DATE_RE.exec(String(birthDate));
  // Catches 31 April and 30 February in the roster. Once the birthDate itself
  // is a real date, the same day-of-month is real in every other year too —
  // except 29 February, which is the whole point of the branch below.
  let valid = Boolean(m);
  if (valid) {
    try { parseDate(birthDate); } catch { valid = false; }
  }
  if (!valid) throw new OtValidationError('BAD_BIRTH_DATE', `วันเกิดไม่ถูกต้อง: ${birthDate}`);

  const [, , month, day] = m;
  const y = String(year).padStart(4, '0');

  if (month === '02' && day === '29' && !isLeapYear(Number(year))) {
    if (policy.birthdayLeapFallback === 'none') return null;
    if (policy.birthdayLeapFallback === 'mar01') return `${y}-03-01`;
    return `${y}-02-28`;
  }

  return `${y}-${month}-${day}`;
}

/**
 * The map `computeSession` reads: date → what kind of day it was FOR THIS
 * PERSON.
 *
 * Pure, and separate from the engine's own segmentation on purpose. The
 * birthday rule makes the day type depend on WHO worked, which the engine has
 * no business knowing — it takes a session and a policy, and a database lookup
 * inside it would be a database lookup inside every test. So the caller loads
 * the holiday calendar and the employee's birthDate, resolves the handful of
 * dates the session touches, and hands over the answer.
 *
 * Order matters: a birthday that already falls on a Saturday, a Sunday or a
 * company holiday adds nothing. The day was already a holiday, the hours were
 * already in the holiday buckets, and reporting the reason as 'birthday' would
 * claim the new rule moved figures it did not.
 *
 * Values come out in the `{ type, reason }` form. `computeSession` also accepts
 * a bare 'workday' / 'holiday' string per date, which is what a hand-written
 * map in a test looks like.
 */
export function resolveDayTypes(dates = [], options = {}) {
  const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
  const isHoliday = options.isHoliday || makeIsHoliday([], policy);
  const birthDate = options.birthDate || null;
  const weekend = new Set(policy.weekendDays);

  // One session spans at most two dates, but a replay resolves a month at a
  // time and the same year comes round on every one of them.
  const birthdayByYear = new Map();
  const birthdayFor = (year) => {
    if (!birthdayByYear.has(year)) {
      birthdayByYear.set(year, birthdayInYear(birthDate, year, policy));
    }
    return birthdayByYear.get(year);
  };

  const out = {};
  for (const date of dates) {
    parseDate(date);

    if (isHoliday(date)) {
      out[date] = {
        type: DAY_TYPES.HOLIDAY,
        reason: weekend.has(dayOfWeek(date)) ? DAY_REASONS.WEEKEND : DAY_REASONS.COMPANY_HOLIDAY,
      };
      continue;
    }

    const birthday = policy.birthdayHolidayEnabled && birthDate
      && birthdayFor(Number(date.slice(0, 4))) === date;

    out[date] = birthday
      ? { type: DAY_TYPES.HOLIDAY, reason: DAY_REASONS.BIRTHDAY }
      : { type: DAY_TYPES.WORKDAY, reason: null };
  }
  return out;
}

/**
 * One date's entry, in either accepted form.
 *
 * A missing date is an error and never a default. Guessing 'workday' would put
 * an employee's holiday hours in the ×1.5 weekday column and there would be
 * nothing on the entry, the form or the audit trail to say a guess was made —
 * the figure would simply be wrong and look computed. The caller knows which
 * dates it is asking about (`sessionDates`); not knowing what one of them is
 * means the resolution step was skipped, which is a bug in the caller.
 */
function readDayType(dayTypes, dateStr) {
  const raw = dayTypes instanceof Map
    ? dayTypes.get(dateStr)
    : (Object.prototype.hasOwnProperty.call(dayTypes || {}, dateStr) ? dayTypes[dateStr] : undefined);

  if (raw == null) {
    throw new OtValidationError(
      'MISSING_DAY_TYPE',
      `ไม่ทราบว่า ${dateStr} เป็นวันทำงานหรือวันหยุด — ผู้เรียกต้องส่ง dayTypes ของทุกวันที่ที่ช่วงเวลานี้พาดถึง`,
    );
  }

  const type = typeof raw === 'string' ? raw : raw.type;
  const reason = typeof raw === 'string' ? null : (raw.reason ?? null);
  if (type !== DAY_TYPES.WORKDAY && type !== DAY_TYPES.HOLIDAY) {
    throw new OtValidationError('BAD_DAY_TYPE', `ชนิดของวันไม่ถูกต้องสำหรับ ${dateStr}: ${type}`);
  }
  return { type, reason };
}

// ── rounding ────────────────────────────────────────────────────────────────

/**
 * ผ่อนปรนการปัดขึ้น, in minutes, or 0 when nothing is being forgiven.
 *
 * Exported because two other readings of the same rule exist and neither may
 * derive it again: `roundingZeroesUnder` in lib/policyInert.js, which tells the
 * settings page how short a session has to be to round away to nothing, and the
 * badge's `reading` in src/config/policy.js. A grace that this function ignores
 * and one of those two prints is the settings page describing an engine that is
 * not running.
 *
 * Ignored rather than clamped when it is not smaller than the block: a grace of
 * 15 on a 15-minute block would hand a whole block to a session of nought, and
 * silently halving it to 7.5 would run a rule nobody picked off a dropdown that
 * looks like it worked.
 */
export function roundingGraceOf(policy = {}) {
  if (policy.roundingMode !== 'floor') return 0;
  const inc = Number(policy.roundingIncrementMinutes);
  if (!inc || inc <= 1) return 0;
  const grace = Number(policy.roundingGraceMinutes) || 0;
  return grace > 0 && grace < inc ? grace : 0;
}

function roundMinutes(minutes, policy) {
  // 'exact' — คิดตามจริงเป็นทศนิยม. A fourth answer to [OPEN 3] rather than a
  // fourth block, so the increment is not read and not cleared: switching back
  // to floor/ceil/nearest restores whichever block HR last chose.
  if (policy.roundingMode === 'exact') return minutes;
  const inc = policy.roundingIncrementMinutes;
  if (!inc || inc <= 1) return minutes;
  if (policy.roundingMode === 'ceil') return Math.ceil(minutes / inc) * inc;
  if (policy.roundingMode === 'nearest') return Math.round(minutes / inc) * inc;
  /**
   * 'floor', with the grace window folded into it rather than branched around.
   * Adding the grace before flooring IS the rule — the last `grace` minutes of
   * a block land in the next one — and it keeps the two answers a single
   * expression, so there is no arm of an `if` where one of them was forgotten.
   *
   * A grace of nought is the plain floor, unchanged and exactly as it was.
   * A grace of half a block is `nearest`, arrived at from the other side.
   */
  return Math.floor((minutes + roundingGraceOf(policy)) / inc) * inc;
}

// ── interval algebra ────────────────────────────────────────────────────────

/** Subtract a list of [a,b) intervals from a single [start,end) interval. */
function subtractIntervals(start, end, holes) {
  let pieces = [[start, end]];
  for (const [hs, he] of holes) {
    const next = [];
    for (const [ps, pe] of pieces) {
      if (he <= ps || hs >= pe) { next.push([ps, pe]); continue; }
      if (hs > ps) next.push([ps, hs]);
      if (he < pe) next.push([he, pe]);
    }
    pieces = next;
  }
  return pieces.filter(([a, b]) => b > a);
}

/**
 * [OPEN 5] The instant OT starts on the evening side of the core window.
 *
 * `coreEndMinute` is when normal working hours STOP; this is when OT BEGINS,
 * and the two are the same instant only because the default answer reads the
 * form's "17.01" as paper shorthand for "after 17:00" (`otStartsAtCoreEnd`,
 * true). Answered the other way the shorthand is literal, there is a one-minute
 * gap at the boundary, and 17:00–20:00 counts 2 h 59 m.
 *
 * ONE boundary, read by both branches of `bucketFor`, because §5 is one
 * question. On a holiday there are no normal working hours for the odd minute
 * to fall into, so it stays in the ×1.5 holiday column and the ×3 column starts
 * at 17:01 — which is what the two form headers ("8.00–17.00" and
 * "17.01–07.59") say once their "17.01" is read literally. Moving the weekday
 * boundary and not the holiday one would be two answers to one question.
 *
 * The MORNING boundary does not move under either answer. §5 asks when OT
 * starts, and "07.59" is the same shorthand on the other side of the day: OT
 * worked before the shift still runs up to `coreStartMinute` exactly.
 *
 * Read as `=== false` so a policy that predates the flag, or one loaded from a
 * database that has no override for it, keeps the default 17:00 boundary rather
 * than acquiring a gap from an absent value.
 */
function otStartMinute(policy) {
  return policy.coreEndMinute + (policy.otStartsAtCoreEnd === false ? 1 : 0);
}

/**
 * Cut points that matter: midnight (day type can change), 08:00 and the instant
 * OT starts (the core-hours boundary — 17:00, or 17:01 under [OPEN 5]).
 * Everything between two adjacent cut points shares one bucket, which is what
 * makes a session spanning several buckets computable.
 *
 * It is `otStartMinute` and not `coreEndMinute` that appears here for the same
 * reason `bucketFor` reads it: a cut list that does not carry the boundary the
 * buckets are decided on lets a segment straddle it, and the whole segment then
 * takes the bucket of its first minute. That is the difference between a
 * 17:00–20:00 session losing one minute and losing all three hours.
 */
function boundaryCuts(startAbs, endAbs, policy) {
  const cuts = new Set([startAbs, endAbs]);
  const firstDay = Math.floor(startAbs / MINUTES_PER_DAY);
  const lastDay = Math.floor((endAbs - 1) / MINUTES_PER_DAY);
  for (let day = firstDay; day <= lastDay + 1; day++) {
    const base = day * MINUTES_PER_DAY;
    for (const off of [0, policy.coreStartMinute, otStartMinute(policy)]) {
      const t = base + off;
      if (t > startAbs && t < endAbs) cuts.add(t);
    }
  }
  return [...cuts].sort((a, b) => a - b);
}

function bucketFor(isHolidayDay, minuteOfDay, policy) {
  // Half-open [coreStart, otStart): the minute the OT boundary sits on belongs
  // to whatever is on its left, which is what makes 17:00–20:00 three clean
  // hours when OT starts at 17:00 and 2 h 59 m when it starts at 17:01.
  const inCore = minuteOfDay >= policy.coreStartMinute && minuteOfDay < otStartMinute(policy);
  if (isHolidayDay) return inCore ? BUCKETS.OT15_HOLIDAY : BUCKETS.OT3_HOLIDAY;
  // Mon–Fri inside 08:00–17:00 is normal working time, not OT at all.
  return inCore ? null : BUCKETS.OT15_WEEKDAY;
}

// ── break deduction ─────────────────────────────────────────────────────────

/** The 12:00–13:00 windows the session actually crosses, as absolute minutes. */
function lunchWindows(startAbs, endAbs, policy) {
  const windows = [];
  const firstDay = Math.floor(startAbs / MINUTES_PER_DAY);
  const lastDay = Math.floor((endAbs - 1) / MINUTES_PER_DAY);
  for (let day = firstDay; day <= lastDay; day++) {
    const base = day * MINUTES_PER_DAY;
    const ws = base + policy.breakWindowStartMinute;
    const we = base + policy.breakWindowEndMinute;
    if (we > startAbs && ws < endAbs) windows.push([Math.max(ws, startAbs), Math.min(we, endAbs)]);
  }
  if (!policy.breakPerCalendarDay && windows.length > 1) return windows.slice(0, 1);
  return windows;
}

/**
 * Flat deduction ('always' / 'threshold'), taken from the largest segment
 * first and spilling into the next largest. Deterministic, never produces a
 * negative segment, and keeps a normal single-bucket session in one bucket.
 *
 * A flat break has no location in the day, so the segment's start/end times
 * stay as worked while its counted minutes drop. That is the same split the
 * requirements already make — "exact clock times are recorded" (§3), and the
 * hour columns carry the counted figure, not the elapsed one.
 */
function applyFlatDeduction(segments, deductMinutes) {
  let remaining = deductMinutes;
  const order = [...segments].sort((a, b) => b.minutes - a.minutes);
  for (const seg of order) {
    if (remaining <= 0) break;
    const take = Math.min(seg.minutes, remaining);
    seg.minutes -= take;
    remaining -= take;
  }
  return segments.filter((s) => s.minutes > 0);
}

// ── the minimum ─────────────────────────────────────────────────────────────

/** Chronological, the order segmentation produces. Both fields sort as text. */
function byClock(a, b) {
  return a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date);
}

/**
 * [OPEN 4] The piles `minimumHours` is measured against.
 *
 * "ต่อใบหรือต่อช่อง" — one minimum for the entry, or one per rate column. The
 * question was open long before there was a flag for it, and the shape of the
 * answer is the reason: 'sheet' asks about one pile and 'bucket' asks the same
 * thing about three, so the two readings differ in how many piles there are and
 * in nothing else. Everything downstream — reject, accept, raise — is written
 * once, against a pile.
 *
 * Each pile carries the same hours twice. `before` is as worked (after the
 * break, before rounding) and `after` is what [OPEN 3] left of it. The rule
 * needs both: a 20-minute callout is real work that floors to nothing, and a
 * pile read only through `after` would pass as "not short" at the exact moment
 * it went to zero. `after` holds the live objects from `workingSegments`, so
 * 'raise' pads them where they lie.
 *
 * Bucket piles are keyed off the PRE-rounding segments for the same reason. A
 * column that rounded away entirely is still a column somebody worked, and
 * grouping `workingSegments` would drop it from the check that exists to catch
 * exactly that.
 */
function minimumPiles(segments, workingSegments, policy) {
  if (policy.minimumHoursScope !== 'bucket') {
    // 'sheet', and anything unrecognised: one entry, one minimum, whatever mix
    // of columns it landed in. The reading the system has always run on, and
    // the one an unknown value falls back to rather than quietly tripling the
    // number of ways an entry can be refused.
    return [{ bucket: null, before: segments, after: workingSegments }];
  }

  return [...groupBy(segments, (s) => s.bucket).entries()].map(([bucket, before]) => ({
    bucket,
    before,
    after: workingSegments.filter((s) => s.bucket === bucket),
  }));
}

// ── the engine ──────────────────────────────────────────────────────────────

/**
 * Compute the rate-bucket breakdown of a single OT session.
 *
 * @param {object} session
 * @param {string} session.workDate      'YYYY-MM-DD' — the date the session starts
 * @param {string} session.startTime     'HH:MM'
 * @param {string} session.endTime       'HH:MM'
 * @param {boolean} [session.endsNextDay] session runs past midnight
 * @param {boolean} [session.noBreakTaken] ไม่พักเที่ยง — skip the deduction
 * @param {object} options
 * @param {object|Map} options.dayTypes  date → 'workday' | 'holiday' | { type, reason }.
 *   Resolved by the caller, because the birthday rule makes the answer depend
 *   on which employee worked and this module reads no database. Must cover
 *   every date in `sessionDates(session)`; a gap throws rather than defaulting.
 * @param {object} [options.policy]
 */
export function computeSession(session, options = {}) {
  const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };

  // A caller still passing the old predicate would otherwise get silently
  // correct answers for everyone with no birthday and silently wrong ones for
  // everyone else. Louder to refuse it.
  if (options.isHoliday && !options.dayTypes) {
    throw new OtValidationError(
      'MISSING_DAY_TYPE',
      'computeSession รับ dayTypes ไม่ใช่ isHoliday — เรียก resolveDayTypes(sessionDates(session), { isHoliday, birthDate, policy }) ก่อน',
    );
  }
  const dayTypes = options.dayTypes || {};

  const { workDate, startTime, endTime } = session;
  const endsNextDay = Boolean(session.endsNextDay);
  const noBreakTaken = Boolean(session.noBreakTaken);

  parseDate(workDate);
  const startMin = parseTime(startTime);
  let endMin = parseTime(endTime);

  if (endsNextDay) {
    endMin += MINUTES_PER_DAY;
  } else if (endMin <= startMin) {
    throw new OtValidationError(
      'END_BEFORE_START',
      'End time is not after start time. Tick "ends next day" for an overnight session.',
    );
  }
  if (endMin - startMin > MINUTES_PER_DAY) {
    throw new OtValidationError('TOO_LONG', 'A single session cannot exceed 24 hours.');
  }

  // Day 0 of the absolute timeline is workDate itself.
  const startAbs = startMin;
  const endAbs = endMin;

  // [OPEN 1] In lunchWindow mode the break is a hole in the session, so it
  // lands in whichever bucket actually contains 12:00–13:00 — no attribution
  // guesswork, and it also settles [OPEN 2] for overnight sessions.
  const holes =
    !noBreakTaken && policy.breakMode === 'lunchWindow'
      ? lunchWindows(startAbs, endAbs, policy)
      : [];

  const cuts = boundaryCuts(startAbs, endAbs, policy);
  let segments = [];
  let nonOtMinutes = 0;

  for (let i = 0; i < cuts.length - 1; i++) {
    for (const [a, b] of subtractIntervals(cuts[i], cuts[i + 1], holes)) {
      const dayIndex = Math.floor(a / MINUTES_PER_DAY);
      const dateStr = addDays(workDate, dayIndex);
      const minuteOfDay = a - dayIndex * MINUTES_PER_DAY;
      const { type, reason } = readDayType(dayTypes, dateStr);
      const bucket = bucketFor(type === DAY_TYPES.HOLIDAY, minuteOfDay, policy);
      if (!bucket) { nonOtMinutes += b - a; continue; }
      segments.push({
        date: dateStr,
        start: formatTime(a),
        // A segment ending exactly at midnight prints as 24:00, not 00:00 —
        // the paper form's ถึง column has to read "17:00 – 24:00" for the
        // first night of an overnight session, or the row is unreadable.
        end: b % MINUTES_PER_DAY === 0 ? '24:00' : formatTime(b),
        dayType: type,
        /** Why it was that kind of day. Never read by the arithmetic. */
        dayReason: reason,
        bucket,
        multiplier: BUCKET_MULTIPLIER[bucket],
        minutes: b - a,
      });
    }
  }

  const clockMinutes = endAbs - startAbs;
  const otMinutesBeforeBreak = segments.reduce((s, x) => s + x.minutes, 0)
    + holes.reduce((s, [a, b]) => s + (b - a), 0);

  // Flat break modes deduct after segmentation.
  let flatDeduction = 0;
  if (!noBreakTaken && policy.breakMode !== 'lunchWindow' && policy.breakMode !== 'none') {
    const overThreshold = otMinutesBeforeBreak > policy.breakThresholdHours * 60;
    if (policy.breakMode === 'always' || (policy.breakMode === 'threshold' && overThreshold)) {
      flatDeduction = policy.breakMinutes;
      segments = applyFlatDeduction(segments, flatDeduction);
    }
  }

  const breakMinutes = holes.reduce((s, [a, b]) => s + (b - a), 0) + flatDeduction;

  // Merge adjacent same-bucket segments on the same date so the printed form
  // shows one row per bucket per day, not one per boundary crossing.
  segments = mergeSegments(segments);

  /**
   * เหมารายวัน — the day was hired whole, so it counts EIGHT HOURS OF OT ×1.5,
   * IN THE COLUMN THE DAY ITSELF DECIDES, whatever the clock says.
   *
   * ── THE RULE, IN HR'S OWN WORDS ───────────────────────────────────────────
   *
   * **ให้คิดตามวันไปเลย ถ้าวันหยุดก็ใส่ 8 ชั่วโมงวันหยุด ถ้าไม่ใช่วันหยุดก็ใส่ 8
   * ชั่วโมงวันปกติ แต่แค่เป็นแบบเหมา** (2026-09-07). Three sentences, and each
   * decides one thing:
   *
   *   *ตามวัน* — the BUCKET is the ordinary one for the kind of day. A holiday
   *   (Saturday, Sunday, the company calendar, or the filer's own วันเกิด) puts
   *   the eight hours in `ot15_holiday`; an ordinary working day puts them in
   *   `ot15_weekday`. Nothing here re-decides what kind of day it is —
   *   `resolveDayTypes` has already answered that, for this employee, and the
   *   answer is read rather than recomputed.
   *
   *   *8 ชั่วโมง* — the LENGTH is `flatDailyMinutes(policy)` and nothing else.
   *   Early in, early out, or stayed to 20:00: the figure does not move, in
   *   either direction (*สแกนเข้าก่อนหรือออกก่อนหรือหลัง 17:00 น. ก็คือ 8
   *   ชั่วโมง*, 2026-09-04, which survives every reversal around it).
   *
   *   *×1.5 เสมอ* — the RATE, asked for in those words the same day. On a
   *   holiday every minute is a holiday minute, so reading the bucket off the
   *   clock would put an evening start in `ot3_holiday`; the multiplier is
   *   written here and never clocked. `ot3_holiday` is nought on every flat day
   *   there is.
   *
   * ── WHAT THIS REPLACED, TWICE ─────────────────────────────────────────────
   *
   * Between 2026-09-03 and 2026-09-04 the tick was a CEILING: the day was
   * computed the ordinary way and trimmed back to eight from the end, so an
   * evening kept its `ot3_holiday` if it fell inside the first eight hours.
   * Between 2026-09-04 and 2026-09-07 it was NOT OT AT ALL: all three rate
   * columns at nought and the eight hours in `totals.normalHours`, on the
   * reasoning that the flat rate had already bought the ordinary day.
   *
   * Neither is what runs. `normalHours` is nought on every session this engine
   * computes now, and it stays on the result and on the model for the rows
   * written in those three days — see the field's own note in
   * src/models/OtEntry.js.
   *
   * ── SO IT SHORT-CIRCUITS, AND THE SHORT CIRCUIT IS THE RULE ───────────────
   *
   * The buffer, the rounding block and the minimum each ask *how much of what
   * was worked is payable OT*, and this day does not answer that question: the
   * figure is the day's own length, agreed in advance. Run in front of it,
   * `belowMinimum: 'reject'` would throw a flat evening out of the form for
   * being under an hour of OT it is not measuring, and `'raise'` would pad a
   * figure that is already exact.
   *
   * `nonOtMinutes` and the NORMAL_HOURS_IGNORED warning are dropped with them,
   * for the same reason: nothing on a flat day is ignored for falling inside
   * ordinary hours. The whole day is the claim.
   *
   * ── WHAT SURVIVES ────────────────────────────────────────────────────────
   *
   * `totals.clockHours` is still the shift exactly as worked and `breakMinutes`
   * is still the break that was taken — the times on the request are a record
   * of when the person was here and are not touched by any of this. What the
   * screen shows beside them is the day's own scan punches, unfiltered, which
   * is the evidence a reader compares them against.
   *
   * `flatDailyTrimmed` is the hours that FELL IN THE OT WINDOW and were not
   * counted, which is the tail past the day's length — its meaning under the
   * ceiling, restored with the arithmetic that gives it one. It is 0 on a day
   * shorter than the flat eight, because nothing was cut: the day was hired
   * whole in both directions.
   */
  if (session.flatDaily) {
    const otWindowMinutes = segments.reduce((s, x) => s + x.minutes, 0);
    const flatMinutes = flatDailyMinutes(policy);
    /**
     * THE DAY THE REQUEST IS FOR — `workDate`, and never the second date of an
     * overnight shift. A flat day is one day bought whole; a Saturday evening
     * running into Sunday is one purchase, and the segment below is dated the
     * day it began. Reading the far side would let the column depend on how
     * late somebody stayed, which is exactly what "แบบเหมา" says it does not.
     */
    const { type: flatDayType, reason: flatDayReason } = readDayType(dayTypes, workDate);
    const bucket = flatDayType === DAY_TYPES.HOLIDAY
      ? BUCKETS.OT15_HOLIDAY
      : BUCKETS.OT15_WEEKDAY;
    const trimmedMinutes = Math.max(0, otWindowMinutes - flatMinutes);

    const flatWarnings = [];
    /**
     * Only when there is something to say — the same "nothing to say, so
     * nothing is said" every other rule in here keeps. A flat day that put
     * fewer than eight hours in the OT window had nothing cut off it, and a
     * notice about a trim that did not happen is a notice about a rule that
     * never fired.
     */
    if (trimmedMinutes > 0) {
      flatWarnings.push({
        code: 'FLAT_DAILY_CAPPED',
        minutes: trimmedMinutes,
        message: `${minutesToHours(trimmedMinutes)} h beyond the flat day (เหมารายวัน) `
          + `is not counted; the day is ${minutesToHours(flatMinutes)} h of OT ×1.5 `
          + `in the ${BUCKET_LABEL_TH[bucket]} column.`,
      });
    }

    return {
      /**
       * ONE ROW, AT THE TIMES THAT WERE WORKED, FOR THE HOURS THE DAY IS WORTH.
       *
       * `minutes` is deliberately not `end − start`, which is not new here:
       * `applyFlatDeduction` has always shortened a segment without moving its
       * clock. The times are the record of when the person was on the premises
       * and print on F-HR-027 as such; the figure beside them is the flat
       * eight.
       *
       * A ROW AT ALL IS THE CHANGE OF 2026-09-07. A flat day had no segments
       * between 2026-09-04 and then — no OT hours, nothing to put in a rate
       * column — so it never reached the printed sheet. It has hours now, so it
       * has a row, and `onSheet` in the form report follows without being told.
       * `dayReason` rides along as it does on every other segment, which is what
       * keeps the OT สวัสดิการวันเกิด chip on a flat birthday row.
       */
      segments: [{
        date: workDate,
        start: formatTime(startAbs),
        end: endAbs % MINUTES_PER_DAY === 0 ? '24:00' : formatTime(endAbs),
        dayType: flatDayType,
        dayReason: flatDayReason,
        bucket,
        multiplier: BUCKET_MULTIPLIER[bucket],
        minutes: flatMinutes,
        hours: minutesToHours(flatMinutes),
      }],
      buckets: {
        [BUCKETS.OT15_WEEKDAY]: bucket === BUCKETS.OT15_WEEKDAY ? minutesToHours(flatMinutes) : 0,
        [BUCKETS.OT15_HOLIDAY]: bucket === BUCKETS.OT15_HOLIDAY ? minutesToHours(flatMinutes) : 0,
        /** Never, on any flat day: ×1.5 เสมอ is the rate half of the rule. */
        [BUCKETS.OT3_HOLIDAY]: 0,
      },
      totals: {
        otHours: minutesToHours(flatMinutes),
        weightedHours: minutesToHours(flatMinutes * 1.5),
        ot15Hours: minutesToHours(flatMinutes),
        ot3Hours: 0,
        clockHours: minutesToHours(clockMinutes),
        breakHours: minutesToHours(breakMinutes),
        /**
         * NOUGHT, and that is what pays for the rate column. The eight hours
         * are claimed once, as overtime; carried here as well they would be the
         * same day counted twice on one document.
         */
        normalHours: 0,
      },
      breakMinutes,
      endsNextDay,
      // Neither rule ran, and `false` says so. Left to carry whatever an
      // earlier pass had put there, `belowMinimumFlagged` would ask HR to look
      // at a row for being short of a minimum it was never measured against.
      belowMinimumFlagged: false,
      belowBufferZeroed: false,
      flatDailyTrimmed: minutesToHours(trimmedMinutes),
      warnings: flatWarnings,
    };
  }

  const warnings = [];
  if (nonOtMinutes > 0) {
    warnings.push({
      code: 'NORMAL_HOURS_IGNORED',
      minutes: nonOtMinutes,
      // The window is read off the policy rather than written out, because
      // under [OPEN 5]'s other answer this warning is the only thing that
      // explains where the odd minute of a 17:00 start went — and naming
      // 08:00–17:00 while the boundary is at 17:01 would explain it wrongly.
      message: `${minutesToHours(nonOtMinutes)} h of this session fall inside normal working hours `
        + `(Mon–Fri ${formatTime(policy.coreStartMinute)}–${formatTime(otStartMinute(policy))}) `
        + 'and are not counted as OT.',
    });
  }

  /**
   * เวลาขั้นต่ำในการเริ่มนับ OT — the buffer, and the first question asked of a
   * session: was any of this OT at all?
   *
   * Measured on the minutes AS WORKED — after the break, before rounding — for
   * the reason HR gave it: 25 minutes under a 30-minute buffer is nought, and 35
   * minutes goes on to the block like any other session. Reading it after
   * rounding would let the block decide the buffer's answer, so that under
   * floor/30 every session below 30 minutes was already nought and the setting
   * did nothing, while under ceil/30 a 5-minute callout arrived at the buffer as
   * a full half hour and passed it.
   *
   * `> 0` on the worked minutes, not `>= 0`: a session that produced no OT
   * minutes at all — a Tuesday 09:00–12:00, entirely inside normal hours — never
   * went near the buffer, and saying it was cut by one would name the wrong
   * rule in the refusal the write paths are about to print.
   */
  const bufferMinutes = Number(policy.minimumBufferMinutes) || 0;
  const workedMinutes = segments.reduce((s, x) => s + x.minutes, 0);
  const belowBuffer = bufferMinutes > 0 && workedMinutes > 0 && workedMinutes < bufferMinutes;
  if (belowBuffer) {
    warnings.push({
      code: 'BELOW_BUFFER_ZEROED',
      minutes: workedMinutes,
      bufferMinutes,
      message: `${workedMinutes} min of OT is under the ${bufferMinutes}-minute buffer `
        + 'and is not counted as OT.',
    });
  }

  // `segments` is the session as worked (after the break); `workingSegments` is
  // what [OPEN 3] left of it. The minimum rule reads both — see `minimumPiles`,
  // which is where the two are paired up — so that a short session rounding away
  // to zero is still caught rather than silently becoming a 0-hour entry.
  const workingSegments = belowBuffer ? [] : applyRounding(segments, policy);

  // [OPEN 4] The minimum — per entry ('sheet') or per rate column ('bucket').
  const minimumMinutes = policy.minimumHours * 60;
  /**
   * Set when the session had real OT minutes and still came out under the
   * minimum — the ×1.5/×3 equivalent of `capExceeded`: one boolean saying there
   * is something on this row for HR to look at, with the detail beside it in
   * `warnings`. False on every entry that never went near the minimum, so it
   * answers "is this one of them" without reading the warning codes.
   *
   * Only ever true in 'accept' mode. 'reject' throws and 'raise' pads the hours
   * up to the minimum, and in neither case is there a short entry left to flag.
   *
   * ONE boolean under either scope. A bucket-scoped entry can be short in two
   * columns at once and the flag still answers the question a list screen asks;
   * WHICH columns is in `warnings`, one entry each, carrying `bucket`.
   */
  let belowMinimumFlagged = false;
  /** Set when 'raise' had to re-create a column that rounding had emptied. */
  let seeded = false;

  /**
   * A buffered session skips the minimum entirely, and that is the whole reason
   * the two rules are ordered rather than merged. Left in, `belowMinimum:
   * 'raise'` would find a pile worth nought, pad it to a full hour, and hand
   * back more than the 25 minutes anybody worked — the buffer's answer inverted
   * by the rule that runs after it. There is nothing short here to raise: the
   * session is not short OT, it is not OT.
   */
  const piles = belowBuffer ? [] : minimumPiles(segments, workingSegments, policy);
  for (const pile of piles) {
    const worked = pile.before.reduce((s, x) => s + x.minutes, 0);
    const counted = pile.after.reduce((s, x) => s + x.minutes, 0);
    // A pile nobody worked is not short, it is absent — under bucket scope that
    // is every column this session never touched, and refusing an entry for
    // having no ×3 holiday hours would refuse every ordinary weekday evening.
    if (worked <= 0 || counted >= minimumMinutes) continue;

    // Named by the column HR reads on the form, not by the bucket key. Empty
    // under sheet scope, where the pile IS the entry and there is nothing to
    // distinguish it from.
    const where = pile.bucket ? ` in ${BUCKET_LABEL_TH[pile.bucket]}` : '';
    // Present only when it means something, so a sheet-scoped warning is the
    // same object it has always been rather than one carrying `bucket: null`.
    const column = pile.bucket ? { bucket: pile.bucket } : {};

    if (policy.belowMinimum === 'reject') {
      throw new OtValidationError(
        'BELOW_MINIMUM',
        `OT sessions must be at least ${policy.minimumHours} hour(s); this one is ${minutesToHours(worked)} h${where}.`,
      );
    }

    if (policy.belowMinimum === 'accept') {
      /**
       * Keep what the person worked. NOT padded up to the minimum and NOT
       * refused: the hours stay exactly what rounding produced, and the entry
       * carries a flag instead of a decision, because whether a 40-minute
       * session is payable is HR's answer to give and refusing it here throws
       * the record of the work away while they think about it.
       *
       * The 0-hour rule is untouched and sits downstream of this: a session
       * that produced no OT minutes at all never reaches this branch, and the
       * write paths still refuse an entry whose total is nought.
       */
      belowMinimumFlagged = true;
      warnings.push({
        code: 'BELOW_MINIMUM_ACCEPTED',
        minutes: counted,
        ...column,
        message: `${minutesToHours(counted)} h${where} is under the ${policy.minimumHours}-hour minimum. `
          + 'Recorded as worked and flagged for HR.',
      });
      continue;
    }

    // 'raise', and anything unrecognised — pad up to the minimum, which is
    // what this branch has always done for a value it did not know.
    let target = pile.after;
    if (!target.length) {
      // The pile rounded away entirely. Pad a copy of its longest pre-rounding
      // segment: under bucket scope that re-creates one column and leaves the
      // others where rounding left them, which is why the seed is pushed rather
      // than made the whole list.
      const seed = { ...pile.before.reduce((a, b) => (b.minutes > a.minutes ? b : a)), minutes: 0 };
      workingSegments.push(seed);
      target = [seed];
      seeded = true;
    }
    const largest = target.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    largest.minutes += minimumMinutes - counted;
    warnings.push({
      code: 'RAISED_TO_MINIMUM',
      ...column,
      message: `Raised to the ${policy.minimumHours}-hour minimum${where}.`,
    });
  }

  // Seeds are appended, and the printed form reads these rows top to bottom. A
  // sort only where one was appended keeps every other session's rows in the
  // order the segmentation produced them.
  if (seeded) workingSegments.sort(byClock);

  const totalMinutes = workingSegments.reduce((s, x) => s + x.minutes, 0);
  const buckets = totalBuckets(workingSegments);

  const ot15Minutes = (buckets[BUCKETS.OT15_WEEKDAY] || 0) + (buckets[BUCKETS.OT15_HOLIDAY] || 0);
  const ot3Minutes = buckets[BUCKETS.OT3_HOLIDAY] || 0;

  return {
    segments: workingSegments
      .filter((s) => s.minutes > 0)
      .map((s) => ({ ...s, hours: minutesToHours(s.minutes) })),
    /** Hours per form column. */
    buckets: {
      [BUCKETS.OT15_WEEKDAY]: minutesToHours(buckets[BUCKETS.OT15_WEEKDAY] || 0),
      [BUCKETS.OT15_HOLIDAY]: minutesToHours(buckets[BUCKETS.OT15_HOLIDAY] || 0),
      [BUCKETS.OT3_HOLIDAY]: minutesToHours(buckets[BUCKETS.OT3_HOLIDAY] || 0),
    },
    totals: {
      /** Hours actually worked, after break and rounding. [OPEN 9] 'clock'. */
      otHours: minutesToHours(totalMinutes),
      /** Hours × multiplier. [OPEN 9] 'weighted'. Not money. */
      weightedHours: minutesToHours(ot15Minutes * 1.5 + ot3Minutes * 3),
      ot15Hours: minutesToHours(ot15Minutes),
      ot3Hours: minutesToHours(ot3Minutes),
      clockHours: minutesToHours(clockMinutes),
      breakHours: minutesToHours(breakMinutes),
      /**
       * ชั่วโมงทำงานปกติ — hours a day is worth OUTSIDE the rate columns, and
       * **nought on every session this engine computes**, this branch and the
       * flat one alike.
       *
       * IT IS NOT DEAD AND IT IS NOT REMOVED. It carried the eight hours of a
       * เหมารายวัน day for the three days between 2026-09-04 and 2026-09-07, and
       * the rows written then still hold theirs until something recomputes them.
       * A field that stops being written is not a field that can be deleted from
       * under the documents that have it — see `normalHours` in
       * src/models/OtEntry.js, and `csvDateOrder` in src/models/Setting.js for
       * the same decision made about a value that lived one day.
       *
       * A nought here has always meant "this form makes no claim about ordinary
       * hours", not "none were worked": an ordinary Tuesday evening request sits
       * on top of a full working day this system has never been asked to count,
       * and that day's normal hours are payroll's, from the scanner and the
       * roster.
       */
      normalHours: 0,
    },
    breakMinutes,
    endsNextDay,
    /**
     * [OPEN 4] Under the minimum, accepted at the hours actually worked — see
     * where it is set above. Always present, so a caller reads a boolean rather
     * than the absence of one.
     */
    belowMinimumFlagged,
    /**
     * เวลาขั้นต่ำในการเริ่มนับ OT cut this session to nought — see where it is
     * set above. Always present, like `belowMinimumFlagged` beside it, and never
     * true at the same time as that one: a buffered session skips the minimum.
     *
     * It never reaches an OtEntry, because an entry this is true of is refused
     * rather than stored (`otHours <= 0` on every write path). It is on the
     * result so that the preview, and the refusal message, can say which rule
     * emptied a session that was filled in correctly.
     */
    belowBufferZeroed: belowBuffer,
    /**
     * Always 0 down here, and stated rather than left off: a session that was
     * not ticked เหมารายวัน never met the rule, and a caller should read a
     * number rather than tell `0` from `undefined`. The ticked sessions return
     * above, where the figure is worked out — see the branch after
     * `mergeSegments`.
     */
    flatDailyTrimmed: 0,
    warnings,
  };
}

function mergeSegments(segments) {
  const out = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (prev && prev.date === seg.date && prev.bucket === seg.bucket && prev.end === seg.start) {
      prev.end = seg.end;
      prev.minutes += seg.minutes;
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

/**
 * [OPEN 3] Rounding, scoped per policy.roundingScope.
 *
 * Rounding is applied to a GROUP total, then the difference is absorbed by the
 * group's longest segment. Rounding each segment separately would be wrong:
 * a break splits one stretch of holiday work into two segments, and flooring
 * each of two 20-minute pieces independently loses 40 minutes rather than 10.
 */
function applyRounding(segments, policy) {
  const copy = segments.map((s) => ({ ...s }));
  const groups = policy.roundingScope === 'session'
    ? [copy]
    : [...groupBy(copy, (s) => s.bucket).values()];

  for (const group of groups) {
    if (!group.length) continue;
    const total = group.reduce((s, x) => s + x.minutes, 0);
    const target = roundMinutes(total, policy);
    if (target === total) continue;
    const largest = group.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    largest.minutes = Math.max(0, largest.minutes + (target - total));
  }

  return copy.filter((s) => s.minutes > 0);
}

function groupBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function totalBuckets(segments) {
  const acc = {};
  for (const s of segments) acc[s.bucket] = (acc[s.bucket] || 0) + s.minutes;
  return acc;
}

/**
 * Roll a set of computed entries into monthly totals — used by the cap check,
 * the printed form's สรุปรวม row, and the export.
 */
export function summariseEntries(entries) {
  const acc = {
    [BUCKETS.OT15_WEEKDAY]: 0,
    [BUCKETS.OT15_HOLIDAY]: 0,
    [BUCKETS.OT3_HOLIDAY]: 0,
  };
  let otHours = 0;
  for (const e of entries) {
    const b = e.buckets || {};
    acc[BUCKETS.OT15_WEEKDAY] += b[BUCKETS.OT15_WEEKDAY] || 0;
    acc[BUCKETS.OT15_HOLIDAY] += b[BUCKETS.OT15_HOLIDAY] || 0;
    acc[BUCKETS.OT3_HOLIDAY] += b[BUCKETS.OT3_HOLIDAY] || 0;
    otHours += e.totals?.otHours ?? 0;
  }
  const round2 = (n) => Math.round(n * 100) / 100;
  const ot15 = acc[BUCKETS.OT15_WEEKDAY] + acc[BUCKETS.OT15_HOLIDAY];
  const ot3 = acc[BUCKETS.OT3_HOLIDAY];
  return {
    buckets: {
      [BUCKETS.OT15_WEEKDAY]: round2(acc[BUCKETS.OT15_WEEKDAY]),
      [BUCKETS.OT15_HOLIDAY]: round2(acc[BUCKETS.OT15_HOLIDAY]),
      [BUCKETS.OT3_HOLIDAY]: round2(acc[BUCKETS.OT3_HOLIDAY]),
    },
    ot15Hours: round2(ot15),
    ot3Hours: round2(ot3),
    otHours: round2(otHours),
    weightedHours: round2(ot15 * 1.5 + ot3 * 3),
  };
}

/**
 * [OPEN 12] What the HR summary boxes on the printed form contain.
 * 'raw' → hours in each bucket. 'multiplied' → hours × multiplier.
 */
export function hrSummary(summary, policy = DEFAULT_POLICY) {
  const round2 = (n) => Math.round(n * 100) / 100;
  const multiplied = policy.hrSummaryBasis === 'multiplied';
  const buckets = summary.buckets || {};
  // The paper form's ×1.5 box is split in two — วันปกติ above, วันหยุด below —
  // and `ot15` is the รวม box that adds them up. Splitting it here rather than
  // in the printed form keeps [OPEN 12] answered in exactly one place.
  const rate15 = multiplied ? 1.5 : 1;
  const ot15 = multiplied ? summary.ot15Hours * 1.5 : summary.ot15Hours;
  const ot3 = multiplied ? summary.ot3Hours * 3 : summary.ot3Hours;
  return {
    ot15Weekday: round2((buckets[BUCKETS.OT15_WEEKDAY] || 0) * rate15),
    ot15Holiday: round2((buckets[BUCKETS.OT15_HOLIDAY] || 0) * rate15),
    ot15: round2(ot15),
    ot3: round2(ot3),
    total: round2(ot15 + ot3),
    basis: policy.hrSummaryBasis,
  };
}

/** [OPEN 9] What a monthly cap counts. */
export function capUsage(summary, policy = DEFAULT_POLICY) {
  return policy.capBasis === 'weighted' ? summary.weightedHours : summary.otHours;
}
