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

function roundMinutes(minutes, policy) {
  const inc = policy.roundingIncrementMinutes;
  if (!inc || inc <= 1) return minutes;
  const q = minutes / inc;
  const rounded =
    policy.roundingMode === 'ceil' ? Math.ceil(q)
      : policy.roundingMode === 'nearest' ? Math.round(q)
        : Math.floor(q);
  return rounded * inc;
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
 * Cut points that matter: midnight (day type can change), 08:00 and 17:00 (the
 * core-hours boundary). Everything between two adjacent cut points shares one
 * bucket, which is what makes a session spanning several buckets computable.
 */
function boundaryCuts(startAbs, endAbs, policy) {
  const cuts = new Set([startAbs, endAbs]);
  const firstDay = Math.floor(startAbs / MINUTES_PER_DAY);
  const lastDay = Math.floor((endAbs - 1) / MINUTES_PER_DAY);
  for (let day = firstDay; day <= lastDay + 1; day++) {
    const base = day * MINUTES_PER_DAY;
    for (const off of [0, policy.coreStartMinute, policy.coreEndMinute]) {
      const t = base + off;
      if (t > startAbs && t < endAbs) cuts.add(t);
    }
  }
  return [...cuts].sort((a, b) => a - b);
}

function bucketFor(isHolidayDay, minuteOfDay, policy) {
  const inCore = minuteOfDay >= policy.coreStartMinute && minuteOfDay < policy.coreEndMinute;
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

  const warnings = [];
  if (nonOtMinutes > 0) {
    warnings.push({
      code: 'NORMAL_HOURS_IGNORED',
      minutes: nonOtMinutes,
      message: `${minutesToHours(nonOtMinutes)} h of this session fall inside normal working hours (Mon–Fri 08:00–17:00) and are not counted as OT.`,
    });
  }

  // OT minutes before rounding. Used by the minimum rule so that a short
  // session which rounds away to zero is still caught rather than silently
  // becoming a 0-hour entry.
  const otMinutesAfterBreak = segments.reduce((s, x) => s + x.minutes, 0);

  let workingSegments = applyRounding(segments, policy);
  let totalMinutes = workingSegments.reduce((s, x) => s + x.minutes, 0);

  // [OPEN 4] Minimum of 1 hour per OT session.
  const minimumMinutes = policy.minimumHours * 60;
  if (otMinutesAfterBreak > 0 && totalMinutes < minimumMinutes) {
    if (policy.belowMinimum === 'reject') {
      throw new OtValidationError(
        'BELOW_MINIMUM',
        `OT sessions must be at least ${policy.minimumHours} hour(s); this one is ${minutesToHours(otMinutesAfterBreak)} h.`,
      );
    }
    if (workingSegments.length === 0) {
      // Everything rounded away — pad the longest pre-rounding segment.
      const seed = segments.reduce((a, b) => (b.minutes > a.minutes ? b : a));
      workingSegments = [{ ...seed, minutes: 0 }];
    }
    const largest = workingSegments.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    largest.minutes += minimumMinutes - totalMinutes;
    totalMinutes = minimumMinutes;
    warnings.push({
      code: 'RAISED_TO_MINIMUM',
      message: `Raised to the ${policy.minimumHours}-hour minimum.`,
    });
  }

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
    },
    breakMinutes,
    endsNextDay,
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
