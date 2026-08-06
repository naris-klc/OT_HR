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
 * @param {object} [options]
 * @param {(dateStr: string) => boolean} [options.isHoliday]
 * @param {object} [options.policy]
 */
export function computeSession(session, options = {}) {
  const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
  const isHoliday = options.isHoliday || makeIsHoliday([], policy);

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
      const holiday = isHoliday(dateStr);
      const bucket = bucketFor(holiday, minuteOfDay, policy);
      if (!bucket) { nonOtMinutes += b - a; continue; }
      segments.push({
        date: dateStr,
        start: formatTime(a),
        // A segment ending exactly at midnight prints as 24:00, not 00:00 —
        // the paper form's ถึง column has to read "17:00 – 24:00" for the
        // first night of an overnight session, or the row is unreadable.
        end: b % MINUTES_PER_DAY === 0 ? '24:00' : formatTime(b),
        dayType: holiday ? 'holiday' : 'workday',
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
