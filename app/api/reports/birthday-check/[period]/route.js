import OtEntry from '@/src/models/OtEntry.js';
import Employee from '@/src/models/Employee.js';
import { route, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { loadCalendar } from '@/src/services/otService.js';
import { PERIOD_RE } from '@/lib/reports.js';
import { today } from '@/lib/delegationQuery.js';
import { birthdayCheck, filedKey } from '@/lib/birthdayCheck.js';

/**
 * วันเกิดที่ยังไม่มีใบ — one month, for ฝ่ายบุคคล to read.
 *
 * READ-ONLY, AND THERE IS NO WRITE COUNTERPART ON PURPOSE. HR cannot know
 * whether somebody was at work on their birthday or until what time, so this
 * route reports and stops. What it carries instead is the หัวหน้า of each
 * person's department — the people `proxyPermission` already lets file on their
 * behalf, so the answer to "what now" is a name rather than a button.
 *
 * HR AND ADMIN ONLY, and separate from ตรวจสอบรายเดือน's own route rather than
 * folded into it, though that screen is where it is drawn. That report is open to
 * หัวหน้า for their own team and it is pinned — see test/birthdayOnPaper.test.js
 * — to reporting only a COUNT of missing birth dates and never a date. Adding a
 * role-shaped branch to its payload would put both readings in one place and
 * leave the guarantee resting on which branch ran. Two routes, one rule each.
 *
 * A date of birth still never leaves the server: what goes out is the date of the
 * HOLIDAY being asked about. See `shape` in lib/birthdayCheck.js.
 */
export const GET = route(async (req, { params }) => {
  requireRole(await requireAuth(req), 'hr', 'admin');

  const { period } = params;
  if (!PERIOD_RE.test(period)) return fail('ประจำเดือนต้องเป็นรูปแบบ YYYY-MM', 400);

  const [calendar, roster, managers] = await Promise.all([
    loadCalendar([`${period}-01`]),
    // Only people who may submit OT (§2 — managers, HR and Admin may not) and
    // only active ones. The same filter สรุป OT ส่งบัญชี uses.
    Employee.find({ active: true, role: 'employee' })
      .populate('department', 'code name nameTh')
      .select('code name birthDate department company active role')
      .lean(),
    /**
     * Who can file for them.
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

  /**
   * Every ใบ in the month, whatever became of it.
   *
   * ANY status — refused and withdrawn included. The question this screen asks is
   * whether a birthday was overlooked, and a request that was filed and then
   * turned down was not overlooked by anybody.
   */
  const entries = await OtEntry.find({ period }).select('employee workDate').lean();
  const filed = new Set(entries.map((e) => filedKey(e.employee, e.workDate)));

  const check = birthdayCheck({
    period,
    // Bangkok's date, from the one helper that answers that question. It marks
    // the rows nobody can be asked about yet; everything else here is pure.
    today: today(),
    roster,
    isHoliday: calendar.isHoliday,
    policy: calendar.policy,
    filed,
  });

  const byDepartment = new Map();
  for (const m of managers) {
    const key = String(m.department ?? '');
    byDepartment.set(key, [...(byDepartment.get(key) || []), { code: m.code, name: m.name }]);
  }
  /** Attached per row: HR reads one line and knows who to ring. */
  const withManagers = (rows) => rows.map((r) => ({
    ...r,
    managers: byDepartment.get(r.departmentId) || [],
  }));

  return json({
    period,
    ruleEnabled: check.ruleEnabled,
    needsEntry: withManagers(check.needsEntry),
    uncheckable: withManagers(check.uncheckable),
  });
});
