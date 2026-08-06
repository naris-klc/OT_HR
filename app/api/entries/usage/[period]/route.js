import Employee from '@/src/models/Employee.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { monthlyUsage } from '@/src/services/otService.js';

/** Monthly usage against the cap. */
export const GET = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const q = query(req);

  const employeeId = q.employee && user.role !== 'employee' ? q.employee : user._id;
  const employee = await Employee.findById(employeeId).populate('department');
  if (!employee) return fail('ไม่พบพนักงาน', 404);

  const { summary, usedHours, basis } = await monthlyUsage(employee._id, params.period);
  return json({
    period: params.period,
    summary,
    usedHours,
    basis,
    capHours: employee.department?.monthlyCapHours ?? null,
  });
});
