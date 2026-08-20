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
import { today } from './delegationQuery.js';
import { birthdayQueue, latestChecks, monthsBetween, OUTCOME } from './birthdayCheck.js';
import { BIRTHDAY_SUBJECT_ROLES, birthdayActionPermission } from './birthdayFiling.js';
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
 * THE MONTHS ARE THE WINDOW; `fromDate` IS THE FLOOR, AND THEY ARE NOT THE SAME
 * BOUND.
 *
 * `months` is what gets scanned, so it has to start at the first of a month —
 * a scan is per period. The floor is a DATE, because that is what decides
 * whether a birthday was a holiday: `versionForDate` in lib/policyVersion.js
 * resolves the rules for one work date off `effectiveFrom`, to the day.
 *
 * This used to round the floor to the first of the month too, on the reasoning
 * that a flag flipped mid-month applies to the whole month it was flipped in.
 * The compute path does not agree and never did — it cuts at the exact day —
 * so a rule that started on the 13th left the 1st to the 12th in a gap where
 * the queue offered a row and the engine refused it: the form opened with กฎ
 * วันหยุดวันเกิดปิดอยู่ over the fields and 08:00–17:00 computed to 0 hours,
 * because for THAT date the rule genuinely was off. A queue that offers work
 * the engine will not accept is worse than one that is short by a few days, so
 * the floor now follows the same date the arithmetic follows.
 *
 * If the benefit really did start earlier than the flag was recorded, that is a
 * decision to record — another version with the earlier `effectiveFrom`, which
 * moves both halves at once — and not a rounding rule that only one half obeys.
 *
 * Returns `{ from, to, months, fromDate, bound }`. `bound` says which limit
 * applied: 'rule' — the birthday rule's start; 'cap' — BACKLOG_MONTHS;
 * 'unversioned' — no version records at all, so the window is this month alone
 * and the screen says so rather than guessing at history it cannot see.
 */
export async function queueWindow(on = today()) {
  const to = periodOf(on);
  const cap = shiftPeriod(to, -(BACKLOG_MONTHS - 1));
  const ruleFromDate = await birthdayRuleStartDate();
  const ruleFrom = ruleFromDate ? periodOf(ruleFromDate) : null;

  if (!ruleFrom) {
    /**
     * Either the rule has never been on, or this database predates versioning
     * (`npm run migrate:policy-version` never run). Both mean the same thing
     * here — there is no evidence of when the benefit started — and inventing a
     * year of history is the one answer that could put a name in a queue for a
     * month in which nothing was owed. This month only, and the screen says why.
     */
    return { from: to, to, months: [to], fromDate: `${to}-01`, bound: 'unversioned' };
  }

  const from = ruleFrom > cap ? ruleFrom : cap;
  // Whichever bound is later. When the cap binds, its month starts on the 1st;
  // when the rule binds, the floor is the rule's own effective date.
  const capDate = `${from}-01`;
  return {
    from,
    to,
    months: monthsBetween(from, to),
    fromDate: ruleFromDate > capDate ? ruleFromDate : capDate,
    bound: ruleFrom > cap ? 'rule' : 'cap',
  };
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
 * The month of `birthdayRuleStartDate` below, and nothing else — one fact, read
 * once, so the month table and the queue cannot come to different answers about
 * when the benefit began.
 */
export async function birthdayRuleStart() {
  return periodOf(await birthdayRuleStartDate() || '') || null;
}

/**
 * The first DATE the birthday holiday was ever in force — 'YYYY-MM-DD', or null
 * when nothing on record says it ever was.
 *
 * `effectiveFrom`, NOT `createdAt`, and that is the whole of the fix here.
 * `createdAt` is when somebody pressed save; `effectiveFrom` is the day the
 * rules start applying to work, and it is the ONLY one the arithmetic reads
 * (`versionForDate` → `loadCalendar.policyFor` → `resolveDayTypes`). Reading
 * the paperwork date meant the queue believed the benefit began on 13 August
 * because that is the afternoon HR ticked the box, while every calculation for
 * the 10th went on resolving the version in force on the 10th, which had it
 * off. The two dates agree in the ordinary case — a rule saved today starting
 * today — and the only times they differ are the two that matter: a change
 * announced in advance, and a change recorded mid-month.
 *
 * Earliest `effectiveFrom` wins, with `seq` breaking a tie, so this stays "the
 * first moment the benefit ever existed" — a rule turned off and on again does
 * not restart the clock. That is deliberate and is the same answer this
 * function has always given.
 */
export async function birthdayRuleStartDate() {
  const first = await PolicyVersion.find({ 'policy.birthdayHolidayEnabled': true })
    .sort({ effectiveFrom: 1, seq: 1 }).limit(1).select('seq effectiveFrom').lean();
  if (!first.length) return null;
  return first[0].effectiveFrom || null;
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
 * ฝ่ายบุคคล and Admin only, and they see everybody — there is no team scope on
 * this screen any more, because there is nobody left who can act on part of it.
 *
 * `countOnly` skips everything the badge does not need. The nav asks this on
 * every tab change and wants one integer.
 */
export async function loadBirthdayQueue(user, { countOnly = false } = {}) {
  const on = today();

  /**
   * ฝ่ายบุคคล and Admin, or nothing at all — asked of the same function the two
   * write routes refuse with, so the list somebody can see and the list somebody
   * can act on cannot come apart.
   *
   * This used to be scoped by department: a หัวหน้า saw their own team's rows
   * and could settle them. Since 2026-08-13 they can settle none of them, and a
   * work list nobody in front of it can work is worse than no list — it reads as
   * somebody else's job left undone. So the queue leaves their screens with the
   * buttons, rather than staying behind as a pile of grey rows. Their part is
   * approving ordinary OT requests, which is untouched.
   *
   * Returned rather than thrown, and shaped exactly like a month with nothing in
   * it: this feeds the nav badge, which asks on every tab change and wants one
   * integer, not an error to handle.
   */
  const EMPTY = {
    ruleEnabled: false, needsEntry: [], upcoming: [], uncheckable: [], absent: [], window: null,
  };
  if (!birthdayActionPermission({ user }).ok) return EMPTY;

  const window = await queueWindow(on);
  const calendar = await loadCalendar(window.months.map((p) => `${p}-01`));

  if (!calendar.policy.birthdayHolidayEnabled) {
    return { ruleEnabled: false, needsEntry: [], upcoming: [], uncheckable: [], absent: [], window };
  }

  const roster = await Employee.find({
    active: true,
    // Not `role: 'employee'`. The birthday holiday is granted to everybody who
    // comes in, หัวหน้า included — BIRTHDAY_SUBJECT_ROLES in lib/birthdayFiling.js
    // carries the rule and why it is not the OT rule beside it.
    role: { $in: BIRTHDAY_SUBJECT_ROLES },
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
    /**
     * The day the benefit began, handed in rather than left to the scan to
     * assume. `periods` can only start at the first of a month, so the first
     * month is the one that reaches back past the rule — and every date it
     * reaches is a date the engine computes as an ordinary working day.
     */
    activeFrom: window.fromDate,
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
    active: true, role: 'manager',
  }).select('code name department').lean();

  const byDepartment = new Map();
  for (const m of managers) {
    const key = String(m.department ?? '');
    // `employeeId` carried alongside the two display fields purely so `decorate`
    // can tell a manager apart from the row they are standing on.
    byDepartment.set(key, [
      ...(byDepartment.get(key) || []),
      { employeeId: String(m._id), code: m.code, name: m.name },
    ]);
  }

  /**
   * `managers` is who to RING, not who may sign — every row is ฝ่ายบุคคล's to
   * settle now. So the หัวหน้า is listed even on a row about themselves: HR
   * ringing them to ask whether they came in on their own birthday is exactly
   * the call to make. An earlier revision filtered them out of their own row,
   * which was right while a หัวหน้า could still press the button and became
   * wrong the moment they could not.
   */
  const decorate = (rows) => rows.map((r) => ({
    ...r,
    managers: byDepartment.get(r.departmentId) || [],
    canAct: birthdayActionPermission({ user, subject: r.employeeId }).ok,
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
