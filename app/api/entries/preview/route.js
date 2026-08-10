import Employee from '@/src/models/Employee.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { compute, checkCap, loadContext } from '@/src/services/otService.js';
import { pickSession, isDepartmentManager } from '@/lib/entries.js';
import { initialStatus } from '@/lib/proxyFiling.js';

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

  /**
   * Whose figures may be asked for.
   *
   * `employeeId` was taken on trust from anybody who was not an employee, which
   * a manager could point at any person in the company: the reply carries that
   * department's ceiling, how much of it has been used, and — since the day
   * types are resolved for the named person — whether the date is their
   * birthday. None of that is a manager's to read outside their own team, and
   * `birthDate` is filtered out of the roster for managers precisely so it is
   * not (see `publicEmployee`).
   *
   * The rule is the one that governs filing on somebody's behalf, which is what
   * this preview is for; ฝ่ายบุคคล and Admin keep the whole roster, as they do
   * everywhere else.
   */
  if (employee && !['hr', 'admin'].includes(user.role)
    && String(employee._id) !== String(user._id)
    && !isDepartmentManager(user, employee.department)) {
    return fail('ดูข้อมูลได้เฉพาะของตนเองหรือพนักงานในแผนกของตน', 403);
  }

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

  /**
   * Where this would land if it were saved now.
   *
   * Answered here rather than assumed by the form, because the answer depends
   * on `proxySkipsOwnApproval` — which the browser cannot read and should not
   * have to. A form that told a หัวหน้า their filing was going straight to HR
   * while the flag said otherwise would be wrong in the one sentence anybody
   * reads twice. Same pure rule the write path uses, over the same resolved
   * policy, so the two cannot drift.
   */
  const routing = employee
    ? initialStatus({
      filer: user,
      employee,
      department: employee.department,
      policy: ctx.policy,
    })
    : null;

  return json({ result, cap, routing });
});
