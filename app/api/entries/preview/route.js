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

  // Loaded BEFORE the computation, not after it as the cap check used to need.
  // The preview is what the employee sees while filling the form in, and a
  // birthday moves the hours between columns — a preview computed without the
  // person it is for would disagree with what submitting the same form saves.
  const employeeId = user.role === 'employee' ? user._id : payload.employeeId;
  const employee = employeeId
    ? await Employee.findById(employeeId).populate('department')
    : null;

  const ctx = await loadContext([session.workDate], { employee });
  const result = await compute(session, ctx);

  const cap = employee
    ? await checkCap({
      employee,
      department: employee.department,
      period: session.workDate.slice(0, 7),
      result,
      excludeId: payload.entryId || null,
      policy: ctx.policy,
    })
    : null;

  return json({ result, cap });
});
