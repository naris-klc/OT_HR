import OtEntry from '@/src/models/OtEntry.js';
import Employee from '@/src/models/Employee.js';
import BirthdayCheck from '@/src/models/BirthdayCheck.js';
import { route, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { loadCalendar } from '@/src/services/otService.js';
import { PERIOD_RE } from '@/lib/reports.js';
import { idOf } from '@/lib/entries.js';
import { today, heldBy } from '@/lib/delegationQuery.js';
import { delegatedDepartments } from '@/lib/delegation.js';
import { birthdayActionPermission } from '@/lib/birthdayFiling.js';
import { birthdayCheck, filedKey, absentKeys, latestChecks, OUTCOME } from '@/lib/birthdayCheck.js';
import { companyOf } from '@/src/config/companies.js';

/**
 * วันเกิดที่ยังไม่มีใบ — one month, for whoever can settle it.
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
  const delegations = await heldBy(user, on);

  /**
   * Which teams this caller may see — and `null` for ฝ่ายบุคคล, meaning "no
   * department filter", which is not the same as an empty list. Written as a
   * distinct value rather than an empty array because `{ $in: [] }` matches
   * nothing, and an HR reading of "everybody" that arrived as an empty filter
   * would silently show a clean month.
   */
  const scope = ['hr', 'admin'].includes(user.role)
    ? null
    : [idOf(user.department), ...delegatedDepartments(delegations, user, on).map(idOf)]
      .filter(Boolean);

  if (scope && scope.length === 0) {
    return fail('ไม่พบแผนกของคุณ จึงยังดูรายการวันเกิดไม่ได้', 403);
  }

  const rosterQuery = {
    // Only people who may submit OT (§2 — managers, HR and Admin may not) and
    // only active ones. The same filter สรุป OT ส่งบัญชี uses.
    active: true,
    role: 'employee',
    ...(scope ? { department: { $in: scope } } : {}),
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
    Employee.find({ active: true, role: 'manager', ...(scope ? { department: { $in: scope } } : {}) })
      .select('code name department')
      .lean(),
  ]);

  const rosterIds = roster.map((p) => p._id);

  const [entries, checks] = await Promise.all([
    /**
     * Every ใบ in the month, whatever became of it.
     *
     * ANY status — refused and withdrawn included. The question this screen asks
     * is whether a birthday was overlooked, and a request that was filed and then
     * turned down was not overlooked by anybody.
     */
    OtEntry.find({ period, employee: { $in: rosterIds } })
      .select('employee workDate').lean(),
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

  const live = latestChecks(checks);

  const check = birthdayCheck({
    period,
    // Bangkok's date, from the one helper that answers that question. It decides
    // which rows can be settled now; everything else here is pure.
    today: on,
    roster,
    isHoliday: calendar.isHoliday,
    policy: calendar.policy,
    filed: new Set(entries.map((e) => filedKey(e.employee, e.workDate))),
    checked: absentKeys(checks),
  });

  const byDepartment = new Map();
  for (const m of managers) {
    const key = String(m.department ?? '');
    byDepartment.set(key, [...(byDepartment.get(key) || []), { code: m.code, name: m.name }]);
  }

  /**
   * Per row: who to ring, and whether THIS caller may press the buttons.
   *
   * `canAct` is answered by the same function the two write routes refuse with,
   * over the same delegations, rather than by the screen inferring it from a
   * role. Today every row a caller receives is one they may act on — the roster
   * above is already scoped — so it is uniformly true; it is sent anyway because
   * the alternative is a component that decides for itself, and the day the
   * scope and the permission stop coinciding, the button and the server would
   * disagree silently.
   */
  const decorate = (rows) => rows.map((r) => ({
    ...r,
    managers: byDepartment.get(r.departmentId) || [],
    canAct: birthdayActionPermission({
      user, department: r.departmentId, delegations, today: on,
    }).ok,
  }));

  /**
   * The birthdays somebody has already answered with "ไม่ได้มาทำงาน" — the
   * fourth group, and the only place a check can be retracted from.
   *
   * A row that is checked leaves the three lists above by design; without this
   * it would leave the SCREEN, and a record that can only be undone by an
   * endpoint nobody can reach is a record that cannot be undone. So the answers
   * stay visible for the month they are about, each naming who gave it and when
   * — which is also what stops two people checking the same name twice.
   *
   * Built from the newest row per person and date (`latestChecks`), so a
   * birthday that was marked and then un-marked is absent from here as well as
   * back on the list: one reading of the collection, two consistent screens.
   */
  const byPerson = new Map(roster.map((p) => [String(p._id), p]));
  const absent = [];
  for (const [, row] of live) {
    if (row.outcome !== OUTCOME.ABSENT) continue;
    if (row.workDate.slice(0, 7) !== period) continue;
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
  absent.sort((a, b) => a.date.localeCompare(b.date) || String(a.code).localeCompare(String(b.code)));

  return json({
    period,
    ruleEnabled: check.ruleEnabled,
    /** Whether ฝ่ายบุคคล's press files and approves in one act — the screen says so. */
    directApproval: Boolean(calendar.policy.hrDirectApproveBirthday),
    /** The birthday has been and gone; there is a scan record to check against. */
    needsEntry: decorate(check.needsEntry),
    /** It has not. Shown, never actionable. */
    upcoming: decorate(check.upcoming),
    /** Answered the other way, and retractable from here. */
    absent: decorate(absent),
    uncheckable: decorate(check.uncheckable),
  });
});
