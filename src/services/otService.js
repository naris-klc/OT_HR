/**
 * The bridge between the pure engine and the database: load the holiday
 * calendar and the live policy, compute an entry, and check it against the
 * department cap.
 */

import Holiday from '../models/Holiday.js';
import OtEntry from '../models/OtEntry.js';
import PolicyVersion from '../models/PolicyVersion.js';
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
import { planRecompute, samePolicy } from '../../lib/policyVersion.js';

/** Holiday dates are read per request; the set is tiny (tens of rows a year). */
export async function loadHolidaySet(years = []) {
  const query = years.length ? { year: { $in: years.map(Number) } } : {};
  const docs = await Holiday.find(query).select('date').lean();
  return new Set(docs.map((d) => d.date));
}

/**
 * Which recorded rule set the live policy corresponds to, or null.
 *
 * Read-only on purpose. Versions are minted in exactly two places — the
 * settings route, when HR answers a question, and the one-off migration — and
 * neither of them is a request that happens to compute an entry. A lazily
 * created version would be a rule set with no author, no note and no moment
 * anybody chose it, appearing on whichever submit happened to be first.
 *
 * So a database whose migration has not been run yet stamps nothing, and says
 * so on screen, until someone runs it. `npm run migrate:policy-version` is
 * idempotent and backfills whatever accumulated in the meantime.
 */
export async function currentPolicyVersion(policy) {
  const latest = await PolicyVersion.latest();
  if (!latest) return null;
  // A policy edited straight in the database — or a DEFAULT_POLICY changed by a
  // deploy — is not the version on record, and claiming it is would attach the
  // wrong rules to real hours. Better an unstamped entry, which reads as "not
  // recorded", than a stamped one that lies.
  return samePolicy(latest.policy, policy) ? latest : null;
}

export async function loadContext(workDates = []) {
  const years = [...new Set(workDates.flatMap((d) => [d.slice(0, 4), addDays(d, 1).slice(0, 4)]))];
  const [policy, holidays] = await Promise.all([
    Setting.effectivePolicy(),
    loadHolidaySet(years),
  ]);
  const version = await currentPolicyVersion(policy);
  return {
    policy,
    isHoliday: makeIsHoliday(holidays, policy),
    /**
     * Carried on the context rather than passed alongside it so that stamping
     * cannot be forgotten: every caller that computes already holds a context,
     * and `applyComputation` reads the version off the same object it reads the
     * hours from. The engine never sees this — it stays pure, takes a policy,
     * and knows nothing about where the policy came from.
     */
    policyVersionId: version?._id || null,
  };
}

/** Compute one session. Throws OtValidationError on bad input. */
export async function compute(session, ctx) {
  const context = ctx || (await loadContext([session.workDate]));
  return computeSession(session, context);
}

/**
 * Write the engine result onto an OtEntry document — and, with it, which rules
 * produced it.
 *
 * The one place a stored figure and its provenance are written together. Every
 * path that recomputes an entry (submit, employee edit, hr_edit, replay) ends
 * up here, so passing the context that produced `result` is what makes
 * "recorded on every calculation" structural instead of four things to
 * remember.
 */
export function applyComputation(entry, result, ctx = null) {
  entry.segments = result.segments;
  entry.buckets = {
    [BUCKETS.OT15_WEEKDAY]: result.buckets[BUCKETS.OT15_WEEKDAY],
    [BUCKETS.OT15_HOLIDAY]: result.buckets[BUCKETS.OT15_HOLIDAY],
    [BUCKETS.OT3_HOLIDAY]: result.buckets[BUCKETS.OT3_HOLIDAY],
  };
  entry.totals = result.totals;
  entry.warnings = result.warnings;
  // Only ever overwritten together with the hours it describes. A caller with
  // no context leaves the existing pointer alone rather than clearing it —
  // an unstamped recomputation is a gap; a wrongly cleared one is a lie about
  // an entry that used to know.
  if (ctx && 'policyVersionId' in ctx) entry.policyVersionId = ctx.policyVersionId;
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
 *
 * A signed-off entry is not replayed. That is enforced here rather than only in
 * each caller's filter, because a filter is a thing every future caller has to
 * remember and this is a rule: hours somebody put their name to do not move
 * because a flag was flipped afterwards, and neither does the version pointer
 * that says what they were computed from.
 *
 * `includeApproved` is the escape hatch for HR answering an [OPEN] item late
 * and deciding the whole month should be restated. It is never a default, the
 * caller must supply a `note` saying why, and every approved entry it moves
 * keeps a `before` snapshot — so a restated figure appears in ประวัติการแก้ไข
 * beside the ordinary corrections, which is the only place anybody would go
 * looking for it.
 */
export async function recomputeEntries(filter = {}, actor = null, options = {}) {
  const { includeApproved = false, note = null } = options;
  if (includeApproved && !String(note || '').trim()) {
    throw new Error('การคำนวณใหม่ที่รวมรายการที่อนุมัติแล้ว ต้องระบุเหตุผล');
  }

  const found = await OtEntry.find(filter);
  const { replay, skipped } = planRecompute(found, { includeApproved });
  if (!replay.length) return { updated: 0, failed: [], skipped };

  const ctx = await loadContext(replay.map((e) => e.workDate));
  const failed = [];
  let updated = 0;

  for (const entry of replay) {
    try {
      const signedOff = entry.status === 'approved';
      const before = signedOff ? entry.snapshot() : null;

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
      applyComputation(entry, result, ctx);

      // Only when it actually moved: a replay that lands on the same hours has
      // restated nothing, and filing a `before` identical to the after would
      // bury the ones that did move under the ones that did not.
      const moved = before && before.otHours !== entry.totals.otHours;
      entry.log(
        actor,
        'recompute',
        note || 'policy or holiday calendar changed',
        entry.status,
        moved ? before : null,
      );
      await entry.save();
      updated += 1;
    } catch (err) {
      failed.push({ id: String(entry._id), error: err.message });
    }
  }
  return { updated, failed, skipped };
}
