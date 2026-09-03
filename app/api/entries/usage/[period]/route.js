import Employee from '@/src/models/Employee.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import Setting from '@/src/models/Setting.js';
import { monthlyUsage, weeklyUsage } from '@/src/services/otService.js';
import { overCap, weekStartOf, weekEndOf } from '@/lib/caps.js';
import { addDays } from '@/src/lib/otEngine.js';

/** Usage against the ceilings — the month, and each week that touches it. */
export const GET = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const q = query(req);

  const employeeId = q.employee && user.role !== 'employee' ? q.employee : user._id;
  const employee = await Employee.findById(employeeId).populate('department');
  if (!employee) return fail('ไม่พบพนักงาน', 404);

  const policy = await Setting.effectivePolicy();
  const {
    summary, usedHours, approvedHours, pendingHours, basis, counted,
  } = await monthlyUsage(employee._id, params.period, { policy });

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
    /**
     * The same total taken apart — see `usageInMonth` in lib/caps.js.
     *
     * `usedHours` is what the ceiling counts, which includes every request the
     * employee has filed and nobody has answered yet. So "เหลือ 4.5 ชม." on the
     * strength of it is the room left IF all of those are approved, and the
     * screen has to be able to say which of the two it is showing.
     */
    approvedHours,
    pendingHours,
    basis,
    capHours: employee.department?.monthlyCapHours ?? null,
    /**
     * Is the month past its ceiling — THE SERVER'S ANSWER, not the screen's.
     *
     * `CapCard` (components/common.jsx) tints itself from this, and the same
     * card is drawn on the reviewer's pop-up from a window `queueCapUsage`
     * builds. That one has carried `exceeded` since it was written; this one
     * did not, so the shared card would have had to work it out for itself for
     * one of its two callers — a second rule about ceilings, living in a
     * component, out of reach of lib/caps.js and of its tests.
     *
     * `usedHours` and not `approvedHours`, which is what `overCap` is asked
     * everywhere else: the ceiling counts requests nobody has answered yet, and
     * a card that went quiet until they were signed would say a month was
     * inside its limit on the day it stopped being.
     */
    exceeded: overCap(usedHours, employee.department?.monthlyCapHours ?? null),
    /**
     * WHICH requests the figures above are made of, as ids.
     *
     * A superseded filing — a later request for the same shift replaced it —
     * counts nowhere, and the pop-up on หน้ารายการ OT ของฉัน draws a ceiling
     * card that would otherwise claim every open row is inside the total. The
     * reviewer's queue answers the same question per row (`counted` in
     * `queueCapUsage`); this is the same answer for a whole month at once,
     * which is the shape a screen holding the month already has.
     *
     * An array rather than the Set `usageInMonth` returns, because this is
     * going over the wire. Strings, so `includes` works against an id a screen
     * read off a row.
     */
    countedIds: [...counted],
    weeklyCapHours,
    weekStartsOn: policy.weekStartsOn,
    weeks,
  });
});
