import Employee from '@/src/models/Employee.js';
import { route, body, json } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { compute, checkCap, loadContext } from '@/src/services/otService.js';
import { pickSession } from '@/lib/entries.js';

/** Compute without saving, so the form can show the split live. */
export const POST = route(async (req) => {
  const user = await requireAuth(req);
  const payload = await body(req);

  const session = pickSession(payload);
  const ctx = await loadContext([session.workDate]);
  const result = await compute(session, ctx);

  const employeeId = user.role === 'employee' ? user._id : payload.employeeId;
  let cap = null;
  if (employeeId) {
    const employee = await Employee.findById(employeeId).populate('department');
    if (employee) {
      cap = await checkCap({
        employee,
        department: employee.department,
        period: session.workDate.slice(0, 7),
        result,
        excludeId: payload.entryId || null,
        policy: ctx.policy,
      });
    }
  }
  return json({ result, cap });
});
