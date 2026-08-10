import Employee from '@/src/models/Employee.js';
import BirthdayCheck from '@/src/models/BirthdayCheck.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { compute, checkCap, loadContext } from '@/src/services/otService.js';
import { pickSession, isDepartmentManager } from '@/lib/entries.js';
import { initialStatus } from '@/lib/proxyFiling.js';
import { birthdayInYear } from '@/src/lib/otEngine.js';
import { absentKeys, filedKey } from '@/lib/birthdayCheck.js';
import { birthdayDirectApproval } from '@/lib/birthdayFiling.js';
import { today } from '@/lib/delegationQuery.js';

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

  /**
   * And the same question for บันทึก OT ให้ จากรายการวันเกิด, when the form
   * asks it.
   *
   * Answered by `birthdayDirectApproval` — the very function the write route
   * refuses with, over the same recomputed birthday date and the same live
   * policy — rather than by the browser reasoning from a role and a flag. The
   * form prints one sentence off this ("จะอนุมัติทันที" or "จะรอหัวหน้าอนุมัติ")
   * and it is the sentence anybody reads twice; a browser-side copy of the rule
   * would be wrong the first time `hrDirectApproveBirthday` moved.
   *
   * Only computed when asked for. Every other caller of this route gets `null`
   * and pays for none of the lookups below.
   */
  let birthdayRouting = null;
  if (payload.birthday && employee) {
    let birthdayDate = null;
    let badBirthDate = false;
    try {
      birthdayDate = employee.birthDate
        ? birthdayInYear(employee.birthDate, Number(session.workDate.slice(0, 4)), ctx.policy)
        : null;
    } catch {
      badBirthDate = true;
    }

    if (badBirthDate) {
      birthdayRouting = { ok: false, error: 'วันเกิดของพนักงานคนนี้ในระบบไม่ถูกต้อง จึงตรวจสอบไม่ได้' };
    } else {
      const checks = await BirthdayCheck.find({ employee: employee._id, workDate: session.workDate })
        .select('employee workDate outcome checkedAt').lean();

      const gate = birthdayDirectApproval({
        actor: user,
        employee,
        workDate: session.workDate,
        birthdayDate,
        isCompanyHoliday: ctx.isHoliday(session.workDate),
        today: today(),
        policy: ctx.policy,
        alreadyAbsent: absentKeys(checks).has(filedKey(employee._id, session.workDate)),
      });
      birthdayRouting = gate.ok
        ? { ok: true, direct: Boolean(gate.direct), reason: gate.reason || null }
        : { ok: false, error: gate.error };
    }
  }

  return json({ result, cap, routing, birthdayRouting });
});
