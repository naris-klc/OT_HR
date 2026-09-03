import Employee from '@/src/models/Employee.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { compute, checkCap, loadContext } from '@/src/services/otService.js';
import { pickSession, isDepartmentManager, birthdayTickRefusal } from '@/lib/entries.js';
import { companyOf } from '@/src/config/companies.js';
import { initialStatus } from '@/lib/proxyFiling.js';
import { weekdayOtRefusal } from '@/lib/otMode.js';
import { refuseDayConflict } from '@/lib/overlapQuery.js';

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
    && !isDepartmentManager(user, employee.department, companyOf(employee))) {
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
   * `birthdayRouting` LEFT THIS ROUTE ON 2026-09-03 and is not coming back.
   *
   * It answered one question — would ฝ่ายบุคคล's press file AND approve in one
   * act, or leave the request waiting — and that question stopped existing with
   * the queue it was asked from. A birthday request is now filed by the person
   * whose birthday it is and routed by `routing` above, exactly like every other
   * request; there is one door and one answer about where a filing lands.
   *
   * With it went this route's only reads of `BirthdayCheck`, `birthdayInYear`
   * and the live calendar for the day — which is why the preview is now a
   * cheaper call for everybody, not only for the form that used to ask.
   */

  /**
   * Said before the form is sent, rather than after it is refused.
   *
   * A sentence when this department does not do weekday OT and these hours are
   * weekday OT, null otherwise — from the very function the write path refuses
   * with, so the line on the screen and the line in the 409 are one line. The
   * form greys บันทึก on it instead of reasoning from the mode itself, which
   * would be the rule written twice.
   */
  const weekdayRefusal = employee ? weekdayOtRefusal(employee.department, result) : null;

  /**
   * และช่อง “วันเกิด” ที่ติ๊กไว้ — said in the same breath and for the same
   * reason.
   *
   * From `birthdayTickRefusal`, the function both write paths refuse with, over
   * `ctx.dayTypes` — the same map, resolved from the same stored วันเกิด under
   * the same policy. The form greys บันทึก on this sentence rather than working
   * out whose birthday the date is, which it could not do without being sent a
   * birth date it is not allowed to hold (`publicEmployee`).
   *
   * Null when the box is not ticked, which is most requests: the tick is a
   * claim, and there is nothing to check until somebody makes it.
   */
  const birthdayRefusal = employee
    ? birthdayTickRefusal({
      ticked: payload.birthdayWelfare, dayTypes: ctx.dayTypes, workDate: session.workDate,
    })
    : null;

  /**
   * หนึ่งวัน หนึ่งใบ, and เวลาทับซ้อน behind it — asked WHILE the date and the
   * times are being typed, not only when they are sent.
   *
   * The write paths have refused these since lib/overlap.js existed, and that
   * refusal was the only place either was ever said. That is one round trip too
   * late for the mistake they are about: somebody who has already filed this
   * day once is not typing a new request, they are typing the same one again —
   * usually because nothing on the screen in front of them said the first one
   * exists. Finding out on the press means the form is filled in, read back,
   * and wrong, and the sentence lands where an error goes rather than beside
   * the fields that caused it.
   *
   * `refuseDayConflict` — the very function `/entries`, `/entries/[id]` and
   * `/birthday/entries` refuse with — rather than a second reading of the rules
   * written for the screen. The form must not be able to offer what the write
   * path refuses, and a browser-side copy is exactly how the two would come to
   * disagree; the same reason `routing` and `weekdayRefusal` above are answered
   * here instead of worked out in the browser.
   *
   * The whole `{ status, error, conflict }` goes back unchanged, `status` and
   * all. It is a refusal nobody has earned yet — nothing is being written —
   * and reshaping it here would leave the form and the 400 it would eventually
   * get carrying two different descriptions of one mistake.
   *
   * `excludeId` is `entryId`, the field the ceiling above already excludes on:
   * without it every edit would report itself as the request already occupying
   * its own date.
   *
   * Costs one indexed read of three days of one person's live requests — see
   * `neighbouringEntries` — and only when the preview knows whose they are.
   */
  const conflict = employee
    ? await refuseDayConflict(session, {
      employee: employee._id,
      excludeId: payload.entryId || null,
    })
    : null;

  return json({
    result, cap, routing, weekdayRefusal, birthdayRefusal, conflict,
  });
});
