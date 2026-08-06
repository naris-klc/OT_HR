/**
 * The bridge between the pure engine and the database: load the holiday
 * calendar and the live policy, compute an entry, and check it against the
 * department cap.
 */

import Holiday from '../models/Holiday.js';
import OtEntry from '../models/OtEntry.js';
import Setting from '../models/Setting.js';
import {
  BUCKETS,
  computeSession,
  makeIsHoliday,
  summariseEntries,
  capUsage,
  addDays,
} from '../lib/otEngine.js';
import { latestPerSession } from '../../lib/reports.js';

/** Holiday dates are read per request; the set is tiny (tens of rows a year). */
export async function loadHolidaySet(years = []) {
  const query = years.length ? { year: { $in: years.map(Number) } } : {};
  const docs = await Holiday.find(query).select('date').lean();
  return new Set(docs.map((d) => d.date));
}

export async function loadContext(workDates = []) {
  const years = [...new Set(workDates.flatMap((d) => [d.slice(0, 4), addDays(d, 1).slice(0, 4)]))];
  const [policy, holidays] = await Promise.all([
    Setting.effectivePolicy(),
    loadHolidaySet(years),
  ]);
  return { policy, isHoliday: makeIsHoliday(holidays, policy) };
}

/** Compute one session. Throws OtValidationError on bad input. */
export async function compute(session, ctx) {
  const context = ctx || (await loadContext([session.workDate]));
  return computeSession(session, context);
}

/** Write the engine result onto an OtEntry document. */
export function applyComputation(entry, result) {
  entry.segments = result.segments;
  entry.buckets = {
    [BUCKETS.OT15_WEEKDAY]: result.buckets[BUCKETS.OT15_WEEKDAY],
    [BUCKETS.OT15_HOLIDAY]: result.buckets[BUCKETS.OT15_HOLIDAY],
    [BUCKETS.OT3_HOLIDAY]: result.buckets[BUCKETS.OT3_HOLIDAY],
  };
  entry.totals = result.totals;
  entry.warnings = result.warnings;
  return entry;
}

/**
 * Hours already committed by an employee in a month.
 *
 * Only entries that are still alive count — a rejected or cancelled request
 * must not eat into anyone's cap. `excludeId` lets an edit re-check itself
 * without double-counting.
 */
export async function monthlyUsage(employeeId, period, { excludeId = null, policy } = {}) {
  const p = policy || (await Setting.effectivePolicy());
  const query = {
    employee: employeeId,
    period,
    status: { $in: ['pending_mgr', 'pending_hr', 'approved'] },
  };
  if (excludeId) query._id = { $ne: excludeId };

  // The session fields come along so a superseded filing can be dropped: the
  // cap is a count of hours worked, and counting a discarded version twice
  // would push a department over a limit it never reached.
  const entries = await OtEntry.find(query)
    .select('buckets totals employee workDate startTime endTime endsNextDay createdAt')
    .lean();
  const { shown } = latestPerSession(entries);
  const summary = summariseEntries(shown);
  return { summary, usedHours: capUsage(summary, p), basis: p.capBasis };
}

/**
 * [OPEN 8] Check a new/edited entry against the department cap.
 *
 * Returns { capHours, usedHoursBefore, projected, exceeded, blocked, basis }.
 * `blocked` is only ever true when policy.capBehaviour is 'block'; otherwise
 * the entry goes through carrying `exceeded` for HR to decide (§7).
 */
export async function checkCap({ employee, department, period, result, excludeId, policy }) {
  const p = policy || (await Setting.effectivePolicy());
  const capHours = department?.monthlyCapHours ?? null;

  const { usedHours } = await monthlyUsage(employee._id, period, { excludeId, policy: p });
  const thisEntry = p.capBasis === 'weighted' ? result.totals.weightedHours : result.totals.otHours;
  const projected = Math.round((usedHours + thisEntry) * 100) / 100;

  if (capHours == null) {
    return { capHours: null, usedHoursBefore: usedHours, projected, exceeded: false, blocked: false, basis: p.capBasis };
  }

  const exceeded = projected > capHours;
  return {
    capHours,
    usedHoursBefore: usedHours,
    projected,
    exceeded,
    blocked: exceeded && p.capBehaviour === 'block',
    basis: p.capBasis,
  };
}

/**
 * Replay the engine over stored entries. Needed whenever the holiday calendar
 * or a policy flag changes — which is the whole point of answering the [OPEN]
 * items late without rework.
 */
export async function recomputeEntries(filter = {}, actor = null) {
  const entries = await OtEntry.find(filter);
  if (!entries.length) return { updated: 0, failed: [] };

  const ctx = await loadContext(entries.map((e) => e.workDate));
  const failed = [];
  let updated = 0;

  for (const entry of entries) {
    try {
      const result = computeSession(
        {
          workDate: entry.workDate,
          startTime: entry.startTime,
          endTime: entry.endTime,
          endsNextDay: entry.endsNextDay,
          noBreakTaken: entry.noBreakTaken,
        },
        ctx,
      );
      applyComputation(entry, result);
      entry.log(actor, 'recompute', 'policy or holiday calendar changed');
      await entry.save();
      updated += 1;
    } catch (err) {
      failed.push({ id: String(entry._id), error: err.message });
    }
  }
  return { updated, failed };
}
