import OtEntry from '@/src/models/OtEntry.js';
import Employee from '@/src/models/Employee.js';
import BirthdayCheck from '@/src/models/BirthdayCheck.js';
import { route, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { loadCalendar } from '@/src/services/otService.js';
import { PERIOD_RE } from '@/lib/reports.js';
import { idOf } from '@/lib/entries.js';
import { today } from '@/lib/delegationQuery.js';
import { BIRTHDAY_SUBJECT_ROLES, birthdayActionPermission } from '@/lib/birthdayFiling.js';
import { birthdayMonth } from '@/lib/birthdayCheck.js';
import { birthdayRuleStart } from '@/lib/birthdayQueueQuery.js';

/**
 * วันเกิดของเดือนนี้ — every one of them, settled or not.
 *
 * THE WHOLE MONTH, NOT WHAT IS LEFT. This is the screen a period gets closed on,
 * and closing it means knowing every birthday in it was dealt with — which a
 * list of outstanding rows cannot say. A name that was settled and a name nobody
 * ever looked at are both simply missing from such a list, and absence is not an
 * answer. So one row per birthday with one of five statuses, and the counts to
 * go above them.
 *
 * The outstanding ones ALSO appear in วันเกิดรอตรวจ, the queue on the
 * confirmation screen, which spans every month and is what the nav badge counts.
 * The two are meant to give different numbers: this one is about August, that one
 * is about everything. See `birthdayQueue` in lib/birthdayCheck.js.
 *
 * READ-ONLY, AND IT STAYS READ-ONLY. The two ways to answer a row are POST
 * routes of their own under /api/birthday, each with its own rule in lib/:
 * a request written from the scanned times, or a BirthdayCheck saying the person
 * was not in. Keeping the writes out of the report route is not tidiness — it is
 * what lets test/birthdayCheck.test.js pin that reading this list can never
 * write anything, however the screen above it changes.
 *
 * WHO MAY READ IT. ฝ่ายบุคคล and Admin, for everybody — they hold the scanner's
 * export and the list is theirs. A หัวหน้า for their own team, and a ผู้รับช่วง
 * for the teams whose queue they are holding today: their team's hours go up
 * when HR settles one of these without them touching a thing, and a summary
 * they cannot reconcile is a summary they stop reading. The scoping is
 * `birthdayActionPermission`, which is `departmentClaim` — the same function
 * `approvalPermission` decides an approval with, so a window that closes takes
 * this screen with it on the same day and by the same rule.
 *
 * A DATE OF BIRTH STILL NEVER LEAVES THE SERVER. What goes out is the date of
 * the HOLIDAY being asked about, which is what the question is about; the year
 * stays here. See `shape` in lib/birthdayCheck.js, and the test that no row
 * carries `birthDate`.
 *
 * Separate from ตรวจสอบรายเดือน's own route rather than folded into it, though
 * that screen is where it is drawn. That report is pinned — see
 * test/birthdayOnPaper.test.js — to reporting only a COUNT of missing birth
 * dates and never a date. Two routes, one rule each.
 */
export const GET = route(async (req, { params }) => {
  const user = requireRole(await requireAuth(req), 'manager', 'hr', 'admin');

  const { period } = params;
  if (!PERIOD_RE.test(period)) return fail('ประจำเดือนต้องเป็นรูปแบบ YYYY-MM', 400);

  const on = today();

  /**
   * ฝ่ายบุคคล and Admin, and they see everybody — asked of the same function the
   * write routes refuse with, so what a screen shows and what it can do cannot
   * come apart.
   *
   * There is no team scope here any more. It used to narrow a หัวหน้า to their
   * own department plus whatever they were covering; since 2026-08-13 they can
   * settle no birthday row at all, and a month view of work somebody cannot do
   * reads as their job left undone. Refused outright rather than returned empty,
   * because unlike the queue this is not what a badge counts — an empty month
   * here would say "nothing outstanding", which is a different and false claim.
   */
  const may = birthdayActionPermission({ user });
  if (!may.ok) return fail(may.error, may.status);

  const rosterQuery = {
    // Everybody the birthday holiday is granted to, which is NOT the same list
    // as everybody who may submit OT — see BIRTHDAY_SUBJECT_ROLES in
    // lib/birthdayFiling.js. This filter used to read `role: 'employee'`,
    // borrowed from the OT rule, and it quietly kept every หัวหน้า off a benefit
    // the company gives to anyone who comes in on their birthday. §2 is
    // unaffected: it is about filing OT, and none of that changed.
    active: true,
    role: { $in: BIRTHDAY_SUBJECT_ROLES },
  };

  const [calendar, roster, managers] = await Promise.all([
    loadCalendar([`${period}-01`]),
    Employee.find(rosterQuery)
      .populate('department', 'code name nameTh')
      .select('code name birthDate department company active role')
      .lean(),
    /**
     * Who else can file for them.
     *
     * Read as "role manager, same department" rather than off
     * `Department.manager`, because that is the rule `isDepartmentManager` in
     * lib/entries.js actually enforces — and the rule is what makes the name on
     * screen useful. `Department.manager` is a field nothing consults for a
     * decision and is unset on most departments, so a list built from it would
     * name somebody who cannot help, or nobody at all.
     */
    Employee.find({ active: true, role: 'manager' })
      .select('code name department')
      .lean(),
  ]);

  const rosterIds = roster.map((p) => p._id);

  const [entries, checks] = await Promise.all([
    /**
     * Every ใบ in the month, whatever became of it.
     *
     * ANY status — refused and withdrawn included. The question is whether the
     * birthday was DEALT WITH, and a request that was filed and then turned down
     * was dealt with by somebody. `status` comes along so the row can say that:
     * the hours it prints are the live ones, and a date whose every ใบ is closed
     * says so rather than printing a bare 0.
     */
    OtEntry.find({ period, employee: { $in: rosterIds } })
      .select('employee workDate status totals').lean(),
    /**
     * And every check written about a day in this month, in full rather than
     * narrowed to the latest — which row is live is `absentKeys`' decision, and
     * it is a rule with a tie-break in it that belongs where it can be tested.
     */
    BirthdayCheck.find({
      employee: { $in: rosterIds },
      workDate: { $gte: `${period}-01`, $lte: `${period}-31` },
    }).select('employee workDate outcome checkedAt checkedByName note').lean(),
  ]);

  const month = birthdayMonth({
    period,
    // Bangkok's date, from the one helper that answers that question. It decides
    // ยังไม่ถึงวัน from ต้องตรวจ; everything else here is pure.
    today: on,
    roster,
    isHoliday: calendar.isHoliday,
    policy: calendar.policy,
    entries,
    checks,
    /**
     * The month picker can reach back further than the rule does.
     *
     * The queue never could — its window starts where the rule does — but this
     * table answers whichever month HR types. Without this, a period from before
     * `birthdayHolidayEnabled` was turned on would list ordinary working days as
     * ต้องตรวจ and offer a button that WORKS, filing an approved request for a
     * holiday that did not exist on the date it carries.
     */
    activeFrom: await birthdayRuleStart(),
  });

  const byDepartment = new Map();
  for (const m of managers) {
    const key = String(m.department ?? '');
    byDepartment.set(key, [
      ...(byDepartment.get(key) || []),
      { employeeId: String(m._id), code: m.code, name: m.name },
    ]);
  }

  /**
   * Per row: who to ring, and whether THIS caller may press the buttons.
   *
   * `canAct` is answered by the same function the two write routes refuse with,
   * rather than by the screen inferring it from a role.
   *
   * IT IS NO LONGER UNIFORMLY TRUE, and the note that used to say so predicted
   * the day: "the day the scope and the permission stop coinciding, the button
   * and the server would disagree silently." That day is ฝ่ายบุคคล being added
   * to the list they stand over (BIRTHDAY_SUBJECT_ROLES) — their own birthday
   * arrives inside the everybody they can see, and is the one row in it they may
   * not sign. Because this was sent from the start rather than inferred on the
   * screen, the button and the server still agree, and nothing here had to be
   * rewritten to keep them so.
   */
  const decorate = (rows) => rows.map((r) => ({
    ...r,
    // Who to RING, not who may sign — every row is ฝ่ายบุคคล's now, so a
    // หัวหน้า stays listed even on a row about themselves: that is the call HR
    // makes to find out whether they came in.
    managers: byDepartment.get(r.departmentId) || [],
    canAct: birthdayActionPermission({ user, subject: r.employeeId }).ok,
  }));

  return json({
    period,
    ruleEnabled: month.ruleEnabled,
    /** False for a month that ended before the birthday rule was ever turned on. */
    ruleActiveInPeriod: month.ruleActiveInPeriod,
    /** Whether ฝ่ายบุคคล's press files and approves in one act — the screen says so. */
    directApproval: Boolean(calendar.policy.hrDirectApproveBirthday),
    /**
     * EVERY birthday in the month, settled or not, one row each with a status.
     *
     * The whole month rather than what is left, because this screen is where a
     * period gets closed and closing it means knowing every name was dealt with.
     * A list of outstanding rows cannot answer "did anybody look at สมชาย" — a
     * name that was settled and a name nobody checked are both simply missing
     * from it.
     */
    rows: decorate(month.rows),
    /** The counts printed above the table, computed where the statuses are. */
    summary: month.summary,
    /**
     * Kept OUT of the table, and out of `summary.total`. Which month somebody
     * with no วันเกิด belongs to is the one thing nobody knows, so a row for them
     * in a table sorted by date would have to invent a date to sit at.
     */
    uncheckable: decorate(month.uncheckable),
  });
});
