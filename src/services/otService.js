/**
 * The bridge between the pure engine and the database: load the holiday
 * calendar and the live policy, compute an entry, and check it against the
 * department cap.
 */

import Employee from '../models/Employee.js';
import Holiday from '../models/Holiday.js';
import OtEntry from '../models/OtEntry.js';
import PolicyVersion from '../models/PolicyVersion.js';
import Setting from '../models/Setting.js';
import {
  BUCKETS,
  computeSession,
  makeIsHoliday,
  resolveDayTypes,
  sessionDates,
  summariseEntries,
  capUsage,
  addDays,
} from '../lib/otEngine.js';
import PolicyReplayRun from '../models/PolicyReplayRun.js';
import { latestPerSession } from '../../lib/reports.js';
import {
  CAP_STATUSES, capBreaches, usageByWeek, weekLabel, weeksOfEntry,
} from '../../lib/caps.js';
import {
  planRecompute, samePolicy, figuresMoved, summariseReplay,
} from '../../lib/policyVersion.js';

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

/**
 * Everything that is the same for everybody: the live policy, the company
 * holiday calendar, and which recorded rule set the policy corresponds to.
 *
 * Split out from `loadContext` because a replay covers many employees and the
 * birthday rule makes the day type depend on which one. The calendar is loaded
 * once per run; only the per-employee half is redone per entry.
 */
export async function loadCalendar(workDates = []) {
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

/**
 * The calendar, narrowed to one person and one session.
 *
 * This is where the employee's birthDate enters the calculation and the only
 * place it does. `computeSession` receives a plain date → day-type map and
 * never learns whose birthday it was, which is what keeps the engine a pure
 * function of (session, policy, dayTypes) and its tests free of a database.
 *
 * Resolved over `sessionDates`, not over `workDate` alone: a session that runs
 * past midnight puts minutes into two dates, and those can be two different
 * kinds of day — a birthday Friday running into an ordinary Saturday is the
 * case that has to be right.
 */
export function contextFor(calendar, session, employee = null) {
  return {
    ...calendar,
    dayTypes: resolveDayTypes(sessionDates(session), {
      isHoliday: calendar.isHoliday,
      birthDate: employee?.birthDate || null,
      policy: calendar.policy,
    }),
  };
}

/**
 * Calendar plus day types, for a caller holding one session and one employee.
 *
 * `employee` is optional and its absence is not the same as an employee with no
 * birthDate — it is a caller that has not been taught about the rule. Both
 * compute the same hours while `birthdayHolidayEnabled` is off, which is why
 * every call site was updated rather than left to fall through: the day the
 * flag is turned on, a forgotten one would quietly go on computing the old
 * answer. The monthly review reports employees with no birthDate on record for
 * the same reason (see the monthly report route) — a birthday rule that is on
 * and a roster that is half filled in must not look like a rule that is off.
 *
 * Day types are resolved for each workDate AND the day after it, which covers
 * any session starting on one of those dates whether or not it runs past
 * midnight.
 */
export async function loadContext(workDates = [], { employee = null } = {}) {
  const calendar = await loadCalendar(workDates);
  const dates = [...new Set(workDates.flatMap((d) => [d, addDays(d, 1)]))];
  return {
    ...calendar,
    dayTypes: resolveDayTypes(dates, {
      isHoliday: calendar.isHoliday,
      birthDate: employee?.birthDate || null,
      policy: calendar.policy,
    }),
  };
}

/**
 * The birthDate of whoever an entry is FOR.
 *
 * A separate query rather than a field on `POPULATE`: that projection feeds
 * every entry list the API returns, and a birthday is personal data that a
 * colleague — including the manager approving the request — has no business
 * receiving. It is loaded here, used to resolve one map, and never leaves the
 * server. See `publicEmployee` in lib/employees.js for the other half.
 */
export async function birthDateOf(employeeId) {
  if (!employeeId) return null;
  const doc = await Employee.findById(employeeId).select('birthDate').lean();
  return doc?.birthDate || null;
}

/**
 * The same thing for a batch of entries, as a Map keyed by employee id.
 *
 * One query for a whole replay. A month's worth of entries belongs to a few
 * dozen people at most, so this is smaller than the entries themselves — and a
 * per-entry lookup inside the replay loop would turn one policy change into a
 * few hundred round trips.
 */
export async function birthDatesFor(entries = []) {
  const ids = [...new Set(
    entries.map((e) => String(e.employee?._id || e.employee || '')).filter(Boolean),
  )];
  if (!ids.length) return new Map();

  const docs = await Employee.find({ _id: { $in: ids } }).select('birthDate').lean();
  return new Map(docs.map((d) => [String(d._id), d.birthDate || null]));
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
    status: { $in: [...CAP_STATUSES] },
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
 * The same question over one week: hours already committed between `weekStart`
 * and the six days after it.
 *
 * Queried by DATE RANGE, not by `period`, because a week is not inside a month.
 * The week of 30 November opens in one period and closes in the next, and a
 * query keyed on the filing month would count the November half of it and
 * quietly drop the December half — the ceiling would then clear a request that
 * had already passed it.
 *
 * The range opens one day EARLY for the same reason the totals below come from
 * segments: an entry filed against Sunday can put minutes into Monday, so an
 * entry contributing to this week may carry a `workDate` from the day before it
 * begins. A session cannot span more than two dates (`computeSession` rejects
 * anything over 24 hours), so one day of slack is the whole of it.
 *
 * `segments` is selected because `weeksOfEntry` attributes hours by the date of
 * each segment; without them it would fall back to charging whole entries to
 * the week of their `workDate`, which is the very error this exists to avoid.
 */
export async function weeklyUsage(employeeId, weekStart, { excludeId = null, policy } = {}) {
  const p = policy || (await Setting.effectivePolicy());
  const weekEnd = addDays(weekStart, 6);
  const query = {
    employee: employeeId,
    workDate: { $gte: addDays(weekStart, -1), $lte: weekEnd },
    status: { $in: [...CAP_STATUSES] },
  };
  if (excludeId) query._id = { $ne: excludeId };

  const entries = await OtEntry.find(query)
    .select('segments buckets totals employee workDate startTime endTime endsNextDay createdAt')
    .lean();
  // Superseded filings drop out here exactly as they do for the month — one
  // session filed twice is one session whichever window is counting it.
  const { shown } = latestPerSession(entries);
  const byWeek = usageByWeek(shown, { weekStartsOn: p.weekStartsOn, basis: p.capBasis });
  return { usedHours: byWeek.get(weekStart) || 0, basis: p.capBasis, weekStart, weekEnd };
}

/**
 * [OPEN 8] Check a new/edited entry against its department's ceilings — the
 * monthly one and the weekly one, always both.
 *
 * Returns the monthly figures at the top level, unchanged from when the month
 * was the only ceiling, plus:
 *
 *   breaches — every ceiling actually passed, in `capBreaches`' shape. The
 *              list is the answer; `exceeded` is only whether it is non-empty.
 *   weekly   — the weekly window's numbers, or null when the department has no
 *              weekly cap set.
 *
 * `exceeded` is now true for a breach of EITHER ceiling, and `blocked` follows
 * it — a request over the weekly limit is refused under capBehaviour 'block'
 * for the same reason a request over the monthly one is. No second mechanism:
 * the existing flag covers both windows (§7).
 *
 * A session that crosses midnight into a new week is checked against BOTH weeks
 * it touches, each against that week's own accumulated hours, because its two
 * halves are charged to two different windows.
 */
export async function checkCap({ employee, department, period, result, excludeId, policy }) {
  const p = policy || (await Setting.effectivePolicy());
  const capHours = department?.monthlyCapHours ?? null;
  const weeklyCapHours = department?.weeklyCapHours ?? null;
  const weighted = p.capBasis === 'weighted';

  const { usedHours } = await monthlyUsage(employee._id, period, { excludeId, policy: p });
  const thisEntry = weighted ? result.totals.weightedHours : result.totals.otHours;
  const projected = Math.round((usedHours + thisEntry) * 100) / 100;

  const windows = [{
    scope: 'month', key: period, label: period, capHours, usedHoursBefore: usedHours, adding: thisEntry,
  }];

  /**
   * Which weeks this entry puts hours into — one normally, two when it runs
   * past midnight across the week boundary. Read from the computed segments,
   * which already carry a date each.
   *
   * Skipped entirely when no weekly cap is set: `capBreaches` would ignore the
   * windows anyway, and there is no reason to spend a query per week to
   * discover that.
   */
  const perWeek = weeklyCapHours == null
    ? new Map()
    : weeksOfEntry(
      // Segments alone: a result with none produced no OT hours, so there is
      // no week for it to land in and the `workDate` fallback has nothing to do.
      { segments: result.segments, totals: result.totals },
      { weekStartsOn: p.weekStartsOn, basis: p.capBasis },
    );

  const weeks = [];
  for (const [weekStart, adding] of perWeek) {
    const used = await weeklyUsage(employee._id, weekStart, { excludeId, policy: p });
    weeks.push({ weekStart, weekEnd: used.weekEnd, usedHoursBefore: used.usedHours, adding });
    windows.push({
      scope: 'week',
      key: weekStart,
      label: weekLabel(weekStart, p.weekStartsOn),
      capHours: weeklyCapHours,
      usedHoursBefore: used.usedHours,
      adding,
    });
  }

  const breaches = capBreaches(windows);
  const exceeded = breaches.length > 0;

  // Which week the flat `weekly.*` fields describe: whichever was actually
  // breached, else the week the session opened in. Matched on `key`, the week's
  // start date, so the two cannot drift apart the way parsing a label would.
  const flaggedWeek = breaches.find((b) => b.scope === 'week');
  const primaryWeek = weeks.find((w) => w.weekStart === flaggedWeek?.key) || weeks[0] || null;

  return {
    capHours,
    usedHoursBefore: usedHours,
    projected,
    exceeded,
    blocked: exceeded && p.capBehaviour === 'block',
    basis: p.capBasis,
    breaches,
    weekly: weeklyCapHours == null ? null : {
      capHours: weeklyCapHours,
      weekStartsOn: p.weekStartsOn,
      weeks,
      usedHoursBefore: primaryWeek?.usedHoursBefore ?? 0,
      weekStart: primaryWeek?.weekStart ?? null,
      weekEnd: primaryWeek?.weekEnd ?? null,
    },
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
 * caller must supply a `note` saying why, and every approved entry it MOVES
 * keeps a `before` snapshot — so a restated figure appears in ประวัติการแก้ไข
 * beside the ordinary corrections, which is the only place anybody would go
 * looking for it.
 *
 * The run itself is logged either way, to otPolicyReplayRuns. Snapshots record
 * what changed and would drown if they also recorded what did not; the run
 * record is what says a replay happened at all. See PolicyReplayRun.js.
 * Writing it cannot fail the replay, so the return carries `auditLogged` to say
 * whether it got written — a replay with no record of itself is worth saying,
 * not worth undoing.
 *
 * The authorisation half of the escape hatch — admin only, note required — is
 * `authorizeReplay` in lib/policyVersion.js and belongs to the routes, which can
 * turn a refusal into a status code. The check kept here is the backstop for a
 * caller that never asked: a script, a future route, the seed.
 */
export async function recomputeEntries(filter = {}, actor = null, options = {}) {
  const { includeApproved = false, note = null, source = 'manual' } = options;
  if (includeApproved && !String(note || '').trim()) {
    throw new Error('การคำนวณใหม่ที่รวมรายการที่อนุมัติแล้ว ต้องระบุเหตุผล');
  }

  const found = await OtEntry.find(filter);
  const { replay, skipped } = planRecompute(found, { includeApproved });

  /**
   * Captured before anything is recomputed. `applyComputation` overwrites
   * `policyVersionId`, so reading the "from" versions afterwards would report
   * the version everything was replayed INTO as the one it came from.
   */
  const scannedBefore = found.map((e) => ({
    status: e.status,
    policyVersionId: e.policyVersionId,
  }));
  const replayBefore = replay.map((e) => ({ status: e.status }));

  /**
   * The calendar is one query for the whole run; the day types are not.
   *
   * Before the birthday rule a single context served every entry, because every
   * entry's day types were the same. They are not any more — a Tuesday is a
   * holiday for the one person born on it — so the shared half is loaded once
   * and the per-employee half is resolved per entry, from birthDates fetched in
   * a single query rather than one lookup per row.
   */
  const calendar = replay.length ? await loadCalendar(replay.map((e) => e.workDate)) : null;
  const birthDates = await birthDatesFor(replay);

  const failed = [];
  const changed = [];
  let updated = 0;

  for (const entry of replay) {
    try {
      const signedOff = entry.status === 'approved';
      const before = signedOff ? entry.snapshot() : null;

      const session = {
        workDate: entry.workDate,
        startTime: entry.startTime,
        endTime: entry.endTime,
        endsNextDay: entry.endsNextDay,
        noBreakTaken: entry.noBreakTaken,
      };
      const ctx = contextFor(calendar, session, {
        birthDate: birthDates.get(String(entry.employee?._id || entry.employee)) || null,
      });

      const result = computeSession(session, ctx);
      applyComputation(entry, result, ctx);

      // Only when it actually moved: a replay that lands on the same figures
      // has restated nothing, and filing a `before` identical to the after
      // would bury the ones that did move under the ones that did not.
      // Compared per bucket — hours can cross between columns while the session
      // total holds, and that is a change payroll pays differently for.
      const moved = figuresMoved(before, entry.snapshot());
      if (moved) changed.push(String(entry._id));

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

  const summary = summariseReplay({
    scanned: scannedBefore,
    replay: replayBefore,
    changed,
    skipped,
    failed,
    toVersionId: calendar?.policyVersionId || null,
  });

  /**
   * Logged last and never allowed to fail the run: the entries are already
   * saved by this point, and losing the recompute over its own audit row would
   * be the wrong trade. A run that could not be logged says so on the way out
   * instead — `auditLogged` below, and a console line carrying what the row
   * would have carried.
   *
   * The console line is the only surviving record when this fails, so it holds
   * the four things the row was for: who ordered the replay, which rules it
   * moved the entries from and to, and how much it touched. Without them a
   * swallowed failure leaves "some replay happened at some point", which is
   * indistinguishable from no replay at all — the exact ambiguity the run
   * record exists to close.
   */
  let run = null;
  try {
    run = await PolicyReplayRun.create({
      source,
      by: actor?._id,
      byName: actor?.name,
      note: note || undefined,
      filter,
      includeApproved,
      toVersion: calendar?.policyVersionId || undefined,
      fromVersions: summary.fromVersions
        .filter((f) => f.version)
        .map((f) => ({ version: f.version, count: f.count })),
      scanned: summary.scanned,
      replayed: summary.replayed,
      changed: summary.changed,
      skipped: summary.skipped,
      failed: summary.failed,
      approvedReplayed: summary.approvedReplayed,
      failures: failed.map((f) => ({ entry: f.id, error: f.error })),
    });
  } catch (err) {
    console.error('replay run not logged', {
      source,
      actor: actor ? `${actor.code || actor._id || '?'} · ${actor.name || '—'}` : null,
      fromVersions: summary.fromVersions
        .map((f) => `${f.version ? String(f.version) : 'ไม่ระบุ'} × ${f.count}`)
        .join(', ') || '—',
      toVersion: summary.toVersion || 'ไม่ระบุ',
      scanned: summary.scanned,
      replayed: summary.replayed,
      changed: summary.changed,
      skipped: summary.skipped,
      failed: summary.failed,
      approvedReplayed: summary.approvedReplayed,
      includeApproved,
      note: note || null,
      filter,
    }, err);
  }

  return {
    updated,
    failed,
    skipped,
    /** What the run record says, for a caller that wants to show it. */
    changed: changed.length,
    runId: run ? String(run._id) : null,
    /**
     * False when the run itself could not be filed. The entries were still
     * recomputed — this says only that nothing in otPolicyReplayRuns will ever
     * show it happened, which is a thing the caller's screen should say out
     * loud rather than leave to somebody noticing the gap months later.
     */
    auditLogged: Boolean(run),
  };
}
