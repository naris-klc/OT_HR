/**
 * The database side of วันเกิดรอตรวจ — the reads, the clock, and how far back
 * the queue reaches.
 *
 * Kept apart from lib/birthdayCheck.js for the reason lib/delegationQuery.js is
 * kept apart from lib/delegation.js: the rules there are pure and are tested
 * without mongoose or a connection, and a test file that reaches for a model
 * drags mongoose into a suite that never opens one. Everything here needs a
 * database or a clock; nothing in that one does.
 *
 * ONE LOADER, TWO CALLERS. The queue screen and the badge on the nav both need
 * this, and two numbers from two implementations is exactly how a badge ends up
 * disagreeing with the screen it opens — the same reasoning `queue-summary`
 * already applies to the delegated count it computes rather than derives.
 */
import Employee from '@/src/models/Employee.js';
import OtEntry from '@/src/models/OtEntry.js';
import BirthdayCheck from '@/src/models/BirthdayCheck.js';
import PolicyVersion from '@/src/models/PolicyVersion.js';
import { loadCalendar } from '@/src/services/otService.js';
import { idOf } from './entries.js';
import { delegatedDepartments } from './delegation.js';
import { heldBy, today } from './delegationQuery.js';
import { birthdayQueue, latestChecks, monthsBetween, OUTCOME } from './birthdayCheck.js';
import { birthdayActionPermission } from './birthdayFiling.js';
import { companyOf } from '@/src/config/companies.js';

/**
 * The hard floor, in months back from today.
 *
 * A birthday repeats every year, so "everything outstanding" with no bound at
 * all means every birthday every employee has ever had — fifty rows a person,
 * none of which anybody is going to file OT against. Twelve months is one full
 * payroll cycle: long enough that nothing HR could still act on falls off,
 * short enough that the queue stays a queue.
 *
 * It is a CAP, not the usual answer — see `queueWindow` below, where the
 * birthday rule's own start date almost always binds first. Whichever applied is
 * returned and printed, because a queue that silently drops its own tail reads
 * as "you are up to date".
 */
export const BACKLOG_MONTHS = 12;

const periodOf = (dateStr) => String(dateStr).slice(0, 7);

/**
 * How far back the queue looks, and why it stops there.
 *
 * THE RULE'S OWN START DATE IS THE REAL BOUND. Before `birthdayHolidayEnabled`
 * was turned on, a birthday was an ordinary working day and no holiday was owed
 * — so listing those months would fill the queue with names nobody ever had
 * anything to do about, which is worse than listing none. It is read off
 * `otPolicyVersions`, the append-only record of every rule set that has been in
 * force: the earliest version with the flag on is the first moment the benefit
 * existed.
 *
 * Rounded to the FIRST OF THAT MONTH, deliberately. A flag flipped mid-month
 * replays every entry still in flight in that month (see the policy route), so
 * the month it was flipped in is the month it applies to. Cutting at the exact
 * day would put the two halves of one month on different sides of a line the
 * rest of the system does not draw.
 *
 * Returns `{ from, to, months, bound }`. `bound` says which limit applied:
 * 'rule' — the birthday rule's start; 'cap' — BACKLOG_MONTHS; 'unversioned' —
 * no version records at all, so the window is this month alone and the screen
 * says so rather than guessing at history it cannot see.
 */
export async function queueWindow(on = today()) {
  const to = periodOf(on);
  const cap = shiftPeriod(to, -(BACKLOG_MONTHS - 1));
  const ruleFrom = await birthdayRuleStart();

  if (!ruleFrom) {
    /**
     * Either the rule has never been on, or this database predates versioning
     * (`npm run migrate:policy-version` never run). Both mean the same thing
     * here — there is no evidence of when the benefit started — and inventing a
     * year of history is the one answer that could put a name in a queue for a
     * month in which nothing was owed. This month only, and the screen says why.
     */
    return { from: to, to, months: [to], bound: 'unversioned' };
  }

  const from = ruleFrom > cap ? ruleFrom : cap;
  return { from, to, months: monthsBetween(from, to), bound: ruleFrom > cap ? 'rule' : 'cap' };
}

/**
 * The first month the birthday holiday was ever in force — 'YYYY-MM', or null
 * when nothing on record says it ever was.
 *
 * SEPARATE FROM THE WINDOW ABOVE, and both callers need exactly one of the two.
 * The queue wants the window: the rule's start AND a 12-month cap, because a
 * queue reaching back three years is not a queue. ตรวจสอบรายเดือน wants only
 * this: HR can point the month picker at any period, and a month from two years
 * ago is a fair question — but a month from BEFORE the rule started is not,
 * because no birthday holiday existed then.
 *
 * That distinction is not decoration. Without it the month table would mark a
 * pre-rule birthday "ต้องตรวจ" and offer บันทึก OT ให้ on it, and the button
 * would work: `birthdayDirectApproval` checks that the rule is on NOW and that
 * the date is that person's birthday, both of which are true. The result would be
 * an approved OT request granting a holiday that did not exist on the day it is
 * dated — the retroactive move the whole system refuses everywhere else (an
 * approved figure does not shift because a flag was flipped afterwards).
 *
 * `seq` order, not `createdAt`: versions are append-only and numbered, and the
 * number is the thing a clock cannot rewrite.
 */
export async function birthdayRuleStart() {
  const first = await PolicyVersion.find({ 'policy.birthdayHolidayEnabled': true })
    .sort({ seq: 1 }).limit(1).select('seq createdAt').lean();
  if (!first.length) return null;
  return periodOf(new Date(first[0].createdAt).toISOString());
}

function shiftPeriod(period, months) {
  const [y, m] = period.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * The queue as this person sees it — every unanswered birthday in the window,
 * across months, oldest first.
 *
 * NOT SCOPED TO A MONTH, and that is the whole point of it. ตรวจสอบรายเดือน asks
 * "is this month finished"; this asks "what is outstanding", and a pile of work
 * that empties when somebody changes a month selector is a way to lose things.
 *
 * Scoped by team the same way the report route is: ฝ่ายบุคคล and Admin see
 * everybody, a หัวหน้า their own team, a ผู้รับช่วง the teams whose queue they
 * hold today — `departmentClaim`, via `birthdayActionPermission`.
 *
 * `countOnly` skips everything the badge does not need. The nav asks this on
 * every tab change and wants one integer.
 */
export async function loadBirthdayQueue(user, { countOnly = false } = {}) {
  const on = today();
  const delegations = await heldBy(user, on);

  const scope = ['hr', 'admin'].includes(user?.role)
    ? null
    : [idOf(user?.department), ...delegatedDepartments(delegations, user, on).map(idOf)].filter(Boolean);

  // A manager with no department resolves to no scope rather than to everybody.
  if (scope && scope.length === 0) {
    return { ruleEnabled: false, needsEntry: [], upcoming: [], uncheckable: [], absent: [], window: null };
  }

  const window = await queueWindow(on);
  const calendar = await loadCalendar(window.months.map((p) => `${p}-01`));

  if (!calendar.policy.birthdayHolidayEnabled) {
    return { ruleEnabled: false, needsEntry: [], upcoming: [], uncheckable: [], absent: [], window };
  }

  const roster = await Employee.find({
    active: true,
    role: 'employee',
    ...(scope ? { department: { $in: scope } } : {}),
  })
    .populate('department', 'code name nameTh')
    .select('code name birthDate department company active role')
    .lean();

  const rosterIds = roster.map((p) => p._id);
  const from = `${window.from}-01`;
  const to = `${window.to}-31`;

  const [entries, checks] = await Promise.all([
    /**
     * Every ใบ in the window, whatever became of it. ANY status — refused and
     * withdrawn included: the question is whether the day was overlooked, and a
     * request filed and then turned down was not.
     */
    OtEntry.find({ employee: { $in: rosterIds }, workDate: { $gte: from, $lte: to } })
      // `status` and `totals` are for the month TABLE, which shows the hours a
      // settled birthday came to; the queue only needs to know a ใบ exists. One
      // projection rather than two, because the two must agree about which dates
      // are dealt with and a narrower query here is how they would stop agreeing.
      .select('employee workDate status totals').lean(),
    BirthdayCheck.find({ employee: { $in: rosterIds }, workDate: { $gte: from, $lte: to } })
      .select('employee workDate outcome checkedAt checkedByName note').lean(),
  ]);

  const result = birthdayQueue({
    periods: window.months,
    today: on,
    roster,
    isHoliday: calendar.isHoliday,
    policy: calendar.policy,
    entries,
    checks,
  });

  if (countOnly) return { ...result, absent: [], window };

  /**
   * Per row: who to ring, and whether THIS caller may press the buttons.
   *
   * `canAct` is answered by the same function the two write routes refuse with,
   * rather than by the screen inferring it from a role — the lesson `isOwnFiling`
   * taught the approval queue.
   */
  const managers = await Employee.find({
    active: true, role: 'manager', ...(scope ? { department: { $in: scope } } : {}),
  }).select('code name department').lean();

  const byDepartment = new Map();
  for (const m of managers) {
    const key = String(m.department ?? '');
    byDepartment.set(key, [...(byDepartment.get(key) || []), { code: m.code, name: m.name }]);
  }

  const decorate = (rows) => rows.map((r) => ({
    ...r,
    managers: byDepartment.get(r.departmentId) || [],
    canAct: birthdayActionPermission({
      user, department: r.departmentId, delegations, today: on,
    }).ok,
  }));

  /**
   * The birthdays already answered "ไม่ได้มาทำงาน" — and the only place a check
   * can be retracted from.
   *
   * A checked row leaves the queue by design; without this it would leave the
   * SCREEN, and an append-only record nobody can reach is one that cannot be
   * undone.
   */
  const byPerson = new Map(roster.map((p) => [String(p._id), p]));
  const absent = [];
  for (const [, row] of latestChecks(checks)) {
    if (row.outcome !== OUTCOME.ABSENT) continue;
    const person = byPerson.get(String(row.employee));
    if (!person) continue;
    absent.push({
      employeeId: String(person._id),
      code: person.code,
      name: person.name,
      department: person.department?.nameTh || person.department?.name || null,
      departmentId: String(person.department?._id ?? ''),
      company: companyOf(person),
      date: row.workDate,
      checkedByName: row.checkedByName || '',
      checkedAt: row.checkedAt,
      note: row.note || '',
    });
  }
  // Newest answer first: what somebody just did is what they may want to undo.
  absent.sort((a, b) => b.date.localeCompare(a.date) || String(a.code).localeCompare(String(b.code)));

  return {
    ruleEnabled: true,
    needsEntry: decorate(result.needsEntry),
    upcoming: decorate(result.upcoming),
    uncheckable: decorate(result.uncheckable),
    absent: decorate(absent),
    window,
  };
}
