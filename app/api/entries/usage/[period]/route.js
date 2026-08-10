import Employee from '@/src/models/Employee.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import Setting from '@/src/models/Setting.js';
import { monthlyUsage, weeklyUsage } from '@/src/services/otService.js';
import { weekStartOf, weekEndOf } from '@/lib/caps.js';
import { addDays } from '@/src/lib/otEngine.js';

/** Usage against the ceilings — the month, and each week that touches it. */
export const GET = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const q = query(req);

  const employeeId = q.employee && user.role !== 'employee' ? q.employee : user._id;
  const employee = await Employee.findById(employeeId).populate('department');
  if (!employee) return fail('ไม่พบพนักงาน', 404);

  const policy = await Setting.effectivePolicy();
  const { summary, usedHours, basis } = await monthlyUsage(employee._id, params.period, { policy });

  /**
   * Every week the month touches, including the two that straddle its edges.
   *
   * A month does not divide into weeks, so the first and last are shared with
   * the neighbouring months and their totals legitimately include days outside
   * this period — that is what the ceiling counts, and reporting a truncated
   * figure here would tell the employee they had room the submit screen would
   * then refuse them.
   */
  const weeklyCapHours = employee.department?.weeklyCapHours ?? null;
  const weeks = [];
  if (weeklyCapHours != null) {
    const [y, m] = params.period.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const first = weekStartOf(`${params.period}-01`, policy.weekStartsOn);
    const final = weekStartOf(`${params.period}-${String(last).padStart(2, '0')}`, policy.weekStartsOn);

    for (let start = first; start <= final; start = addDays(start, 7)) {
      const used = await weeklyUsage(employee._id, start, { policy });
      weeks.push({
        weekStart: start,
        weekEnd: weekEndOf(start, policy.weekStartsOn),
        usedHours: used.usedHours,
        remaining: Math.round((weeklyCapHours - used.usedHours) * 100) / 100,
      });
    }
  }

  return json({
    period: params.period,
    summary,
    usedHours,
    basis,
    capHours: employee.department?.monthlyCapHours ?? null,
    weeklyCapHours,
    weekStartsOn: policy.weekStartsOn,
    weeks,
  });
});
