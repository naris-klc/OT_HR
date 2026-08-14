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
  OtValidationError,
} from '../lib/otEngine.js';
import PolicyReplayRun from '../models/PolicyReplayRun.js';
import PeriodLock from '../models/PeriodLock.js';
import {
  CAP_STATUSES, capBreaches, monthWindowOf, overCap, periodOf, usageInMonth, usageInWeeks,
  weekEndOf, weekLabel, weeksOfEntry,
} from '../../lib/caps.js';
import { idOf, noOtHoursMessage } from '../../lib/entries.js';
import { latestPerSession } from '../../lib/reports.js';
import {
  planRecompute, samePolicy, figuresMoved, summariseReplay,
} from '../../lib/policyVersion.js';

/**
 * Holiday dates are read per request; the set is tiny (tens of rows a year).
 *
 * FILTERED ON `date`, NEVER ON `year`. `year` is a denormalised copy of the
 * first four characters of `date`, and every write path in this app upserts —
 * which skips the document hook that derives it. So `year` was simply absent on
 * every holiday added through the ปฏิทินวันหยุด screen and every one imported
 * from CSV, and this function could not see any of them: the calendar showed
 * the day, HR believed it was set, and the engine went on paying วันปกติ rates
 * for it with nothing on any screen to say so.
 *
 * The writes now set `year` properly too. This still asks `date`, because the
 * field that decides what somebody is paid should be the field the row actually
 * stores, not a copy of it that a future upsert can forget again.
 *
 * `date` is 'YYYY-MM-DD', so a string range IS a chronological range and the
 * unique index on it serves the query.
 */
export async function loadHolidaySet(years = []) {
  const query = years.length
    ? { $or: years.map((y) => ({ date: { $gte: `${Number(y)}-01-01`, $lte: `${Number(y)}-12-31` } })) }
    : {};
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
  // [OPEN 4]. Written here rather than at the four call sites for the reason
  // everything else in this function is: it describes the figures above and has
  // to move with them. A replay under a policy that no longer leaves this entry
  // short writes `false` back, so the flag can never outlive the hours.
  entry.belowMinimumFlagged = Boolean(result.belowMinimumFlagged);
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
  const entries = await OtEntry.find(query).select(MONTH_USAGE_SELECT).lean();
  // Counted by `usageInMonth`, which is also what ตรวจสอบรายเดือน and the
  // approval queue count with — see lib/caps.js.
  return usageInMonth(entries, p);
}

/**
 * The fields a monthly figure is made of: the hours, enough of the session to
 * recognise a filing that a later one replaced, and the status.
 *
 * `status` is not there to filter — the query above already did that. It is
 * there so `usageInMonth` can say how much of the total is signed off and how
 * much is still a request, which is the difference between the queue's figure
 * and ตรวจสอบรายเดือน's. Without it the split would silently report every hour
 * as approved (see the fallback in `usageInMonth`), which is the exact
 * misreading the split was added to end.
 */
const MONTH_USAGE_SELECT = 'buckets totals employee period workDate startTime endTime endsNextDay createdAt status';

/** The same, plus `segments` — the weekly window attributes hours by the date
    of each segment, so without them an overnight shift lands in one week. */
const WEEK_USAGE_SELECT = `${MONTH_USAGE_SELECT} segments`;

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

  const entries = await OtEntry.find(query).select(WEEK_USAGE_SELECT).lean();
  // Superseded filings drop out here exactly as they do for the month — one
  // session filed twice is one session whichever window is counting it.
  const { byWeek } = usageInWeeks(entries, p);
  return { usedHours: byWeek.get(weekStart) || 0, basis: p.capBasis, weekStart, weekEnd };
}

/**
 * What each row of an approval queue has already accumulated — every employee
 * on the screen, in a fixed number of queries.
 *
 * The หัวหน้า decides one request at a time and, until now, saw one request at a
 * time: nothing on the row said whether this was the person's first three hours
 * of the month or their forty-third. The figure that answers that already
 * existed on ตรวจสอบรายเดือน; what was missing was a way to put it beside a
 * queue of rows without asking the database once per row.
 *
 * Two properties matter more than the shape of what comes back:
 *
 *   THE SAME NUMBER. Every figure here comes from `usageInMonth` /
 *   `usageInWeeks` (lib/caps.js) — the functions `monthlyUsage`, `weeklyUsage`
 *   and the monthly review all count with. Nothing is recomputed a second way,
 *   so a reviewer cannot be shown 16.5 in the queue and 18 on the review screen
 *   with no way to tell which is the real one.
 *
 *   EACH ROW'S OWN MONTH. A queue may be filtered to ทุกเดือน and hold rows from
 *   several periods at once, so the window is taken from the ROW (`periodOf`)
 *   and never from whatever the screen's filter happens to say.
 *
 * The counting is the whole point of the batching: one query per shape of
 * window, not one per row. Both are `$or` over the windows actually wanted, so
 * a queue of ten rows costs the same two round trips as a queue of one, and
 * a queue where no department sets a weekly ceiling costs one.
 *
 * `find` is injected so the batching itself can be tested — the tests hand it a
 * counter and a fixture instead of a database. Production callers pass nothing.
 *
 * Returns a Map of entry id → the figures for that row, or an empty Map for an
 * empty queue.
 */
export async function queueCapUsage(rows = [], { policy, find = findUsageEntries } = {}) {
  if (!rows.length) return new Map();
  const p = policy || (await Setting.effectivePolicy());

  /** period → the employees wanted in it, and week start → the same. */
  const monthsWanted = new Map();
  const weeksWanted = new Map();
  /** entry id → everything about the row that the assembly below needs. */
  const plan = new Map();

  for (const row of rows) {
    const employeeId = idOf(row.employee);
    if (!employeeId) continue;

    const period = periodOf(row);
    const capHours = row.department?.monthlyCapHours ?? null;
    const weeklyCapHours = row.department?.weeklyCapHours ?? null;
    want(monthsWanted, period, employeeId);

    /**
     * The weekly side is skipped entirely where no weekly ceiling is set — the
     * same decision `checkCap` makes, for the same reason: a total with nothing
     * to compare it against is a number on a row that answers no question, and
     * finding that out is not worth a query. A department that HAS one gets
     * both figures.
     *
     * Read off the row's own segments, so a shift crossing midnight into a new
     * week is measured against both weeks it touches.
     */
    const perWeek = weeklyCapHours == null
      ? new Map()
      : weeksOfEntry(row, { weekStartsOn: p.weekStartsOn, basis: p.capBasis });
    for (const weekStart of perWeek.keys()) want(weeksWanted, weekStart, employeeId);

    plan.set(String(row._id), { row, employeeId, period, capHours, weeklyCapHours, perWeek });
  }

  // Rows that name nobody are skipped above rather than queried for, and a page
  // of only those leaves nothing to ask: an `$or: []` is not an empty result in
  // mongo, it is a malformed query, and it would take the whole queue down with
  // it rather than the one column.
  if (!plan.size) return new Map();

  /**
   * One query for every month on the screen — grouped by period so each clause
   * is `{ period, employee: { $in } }`, which is the shape of the
   * `{ employee, period, status }` index the monthly figures have always used.
   */
  const monthRows = await find({
    status: { $in: [...CAP_STATUSES] },
    $or: [...monthsWanted].map(([period, ids]) => ({ period, employee: { $in: [...ids] } })),
  }, MONTH_USAGE_SELECT);

  const monthly = new Map();
  for (const [key, list] of groupEntries(monthRows, monthWindowOf)) {
    monthly.set(key, usageInMonth(list, p));
  }

  /**
   * And one for every week, by date range rather than by period — a week is not
   * inside a month (see `weeklyUsage`), and the range opens a day early for the
   * same reason it does there: an entry filed against the day before can put
   * minutes into this week.
   */
  const weekRows = weeksWanted.size
    ? await find({
      status: { $in: [...CAP_STATUSES] },
      $or: [...weeksWanted].map(([weekStart, ids]) => ({
        employee: { $in: [...ids] },
        workDate: { $gte: addDays(weekStart, -1), $lte: addDays(weekStart, 6) },
      })),
    }, WEEK_USAGE_SELECT)
    : [];

  const weekly = new Map();
  for (const [employeeId, list] of groupEntries(weekRows, (e) => idOf(e.employee))) {
    weekly.set(employeeId, usageInWeeks(list, p));
  }

  const out = new Map();
  for (const [id, planned] of plan) {
    const { row, employeeId, period, capHours, weeklyCapHours, perWeek } = planned;
    const month = monthly.get(`${employeeId}|${period}`) || usageInMonth([], p);

    /**
     * Is this row's own contribution inside the totals above?
     *
     * Almost always yes — `CAP_STATUSES` counts `pending_mgr`, so a request
     * still waiting for the หัวหน้า is already in the figure they are reading.
     * That has to be said on screen or it gets added a second time in somebody's
     * head. The exception is a filing a later one for the same session replaced:
     * it counts nowhere, and a row claiming to be included when it is not would
     * be the same error in the other direction.
     */
    const counted = month.counted.has(id);

    out.set(id, {
      basis: p.capBasis,
      counted,
      month: {
        period,
        usedHours: month.usedHours,
        /**
         * The same total taken apart — see `usageInMonth`.
         *
         * The queue counts `pending_mgr` and `pending_hr` alongside `approved`,
         * so `usedHours` is what the month becomes if everything on this screen
         * is approved, not what it has committed to. ตรวจสอบรายเดือน opens on
         * อนุมัติแล้ว and shows `approvedHours` instead. Both figures travel
         * together from here so the queue can print both and name them, rather
         * than the two screens each showing a bare number and disagreeing.
         */
        approvedHours: month.approvedHours,
        pendingHours: month.pendingHours,
        capHours,
        // The row's own hours, on the same basis the ceiling counts, so a
        // reviewer who wants the figure without this request can subtract.
        adding: counted ? capUsage(summariseEntries([row]), p) : 0,
        exceeded: overCap(month.usedHours, capHours),
      },
      weeks: [...perWeek.keys()].map((weekStart) => {
        const used = weekly.get(employeeId)?.byWeek.get(weekStart) || 0;
        const approved = weekly.get(employeeId)?.approvedByWeek.get(weekStart) || 0;
        return {
          weekStart,
          weekEnd: weekEndOf(weekStart, p.weekStartsOn),
          usedHours: used,
          // Split the same way and for the same reason as the month above.
          approvedHours: approved,
          pendingHours: Math.round((used - approved) * 100) / 100,
          capHours: weeklyCapHours,
          adding: counted ? perWeek.get(weekStart) || 0 : 0,
          exceeded: overCap(used, weeklyCapHours),
        };
      }),
    });
  }

  return out;
}

/**
 * The rows a CEILING counts for a report's scope, grouped by employee.
 *
 * A report is filtered by สถานะที่นับ; a ceiling is not, and cannot be — a
 * department's remaining allowance is not a display preference. So any screen
 * or file that puts a cap figure beside a filtered total needs the same month
 * counted a second way, and two of them do: ตรวจสอบรายเดือน colours its เพดาน
 * column from it, and สรุปรายเดือน (CSV) prints อนุมัติแล้ว and รออนุมัติ as
 * separate columns from it.
 *
 * ONE READ FOR THE WHOLE REPORT, never one per employee — the same rule
 * `queueCapUsage` above is built around, and the reason both callers can hand a
 * month of two hundred people to `capColumn` without the page cost moving.
 *
 * `inHand` is the rows the caller already fetched. Where its filter ALREADY
 * covers every live status there is nothing left to ask for, so the query is
 * skipped entirely and those rows are reused — at ทั้งหมดที่ยังไม่ถูกปฏิเสธ the
 * report costs exactly what it always did. The check is on the filter's
 * contents rather than on a string, so a screen that spells its widest option
 * differently still gets the short circuit.
 *
 * `find` is injected so the read can be counted in a test, as it is for
 * `queueCapUsage`. Production callers pass nothing.
 */
export async function capEntriesByEmployee(filter = {}, { inHand = null, find = findUsageEntries } = {}) {
  const asked = filter.status?.$in || [];
  const coversAllLive = CAP_STATUSES.every((s) => asked.includes(s));

  const rows = coversAllLive && inHand
    ? inHand
    : await find({ ...filter, status: { $in: [...CAP_STATUSES] } }, MONTH_USAGE_SELECT);

  // A session filed twice is one session, here as everywhere — dropped before
  // grouping so a superseded filing cannot inflate anybody's ceiling.
  const { shown } = latestPerSession(rows);
  return groupEntries(shown, (e) => idOf(e.employee));
}

/** How the batched loader reads entries when nobody injects anything else. */
const findUsageEntries = (filter, select) => OtEntry.find(filter).select(select).lean();

/** Add one member to a set held under `key`. */
function want(map, key, member) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(member);
}

/**
 * Split entries into the windows they belong to, so each window can be counted
 * by the shared helper over its own rows.
 *
 * Grouping BEFORE counting rather than deduplicating the whole fetch and
 * splitting afterwards, deliberately: it makes each group's arithmetic
 * identical to the single-employee path by construction, rather than identical
 * for a reason someone has to work out about session keys.
 */
function groupEntries(entries, keyOf) {
  const groups = new Map();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return groups;
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

  /**
   * The months ปิดงวด has finished, among the ones this run actually touches.
   *
   * Queried from the periods in hand rather than by loading every lock there
   * has ever been: a replay over one holiday date asks about one month, and the
   * yearly ones ask about twelve. `planRecompute` does the deciding — this is
   * only the read, and it is here rather than in each caller for the reason the
   * approved rule is here: a filter is something every future caller has to
   * remember, and this is a rule.
   */
  const periods = [...new Set(found.map((e) => e.period).filter(Boolean))];
  const closedPeriods = periods.length
    ? (await PeriodLock.find({ period: { $in: periods }, state: 'closed' }).select('period').lean())
      .map((l) => l.period)
    : [];

  const { replay, skipped } = planRecompute(found, { includeApproved, closedPeriods });

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

      /**
       * The fifth write path, holding the rule the other four hold: an entry is
       * never stored as a nought.
       *
       * A replay can empty one where a submission cannot, because the times were
       * filled in under rules that counted them and the rules have since moved —
       * เวลาขั้นต่ำในการเริ่มนับ OT is the case it was written for, and a raised
       * increment or a shifted core boundary can do it too. Written through, the
       * entry stays in its queue reading 0 ชม., which is exactly what
       * `noOtHoursMessage` exists to keep out of a queue, off F-HR-027 and out of
       * a monthly total.
       *
       * So it fails instead: the entry keeps the hours it was filed with, and
       * the run reports it. `belowMinimum: 'reject'` already lands here by
       * throwing from the engine, and this is the same outcome for the answer
       * that returns a nought rather than refusing.
       */
      if (result.totals.otHours <= 0) {
        throw new OtValidationError(
          'NO_OT_HOURS',
          `กฎใหม่ทำให้รายการนี้ไม่เหลือชั่วโมง OT — ${noOtHoursMessage(session, ctx.policy, ctx.dayTypes, result)}`,
        );
      }

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
    /**
     * The months this run left alone because ปิดงวด has finished them.
     *
     * Lifted out of `skipped` rather than left for each caller to filter,
     * because it is the one kind of skip that is somebody's job: an approved
     * row skipped by the ordinary rule is the system working, and a whole month
     * skipped is a set of figures that did NOT move and were probably meant to.
     * Whoever ordered the replay has to decide whether to ask an administrator
     * to reopen those periods and run it again.
     *
     * Named months, not a count. "12 skipped" reads as an ordinary run.
     */
    skippedClosed: summary.skippedClosed,
    closedPeriods: summary.closedPeriods,
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
