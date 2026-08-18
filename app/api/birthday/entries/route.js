import OtEntry from '@/src/models/OtEntry.js';
import Employee from '@/src/models/Employee.js';
import BirthdayCheck from '@/src/models/BirthdayCheck.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { compute, applyComputation, checkCap, loadContext } from '@/src/services/otService.js';
import { POPULATE, pickSession, stampCap, noOtHoursMessage } from '@/lib/entries.js';
import { birthdayInYear } from '@/src/lib/otEngine.js';
import { absentKeys, filedKey } from '@/lib/birthdayCheck.js';
import {
  birthdayActionPermission, birthdayDirectApproval,
  HR_VERIFIED_ACTION, HR_VERIFIED_NOTE,
} from '@/lib/birthdayFiling.js';
import { initialStatus } from '@/lib/proxyFiling.js';
import { refusePeriodLock } from '@/lib/periodLockQuery.js';
import { refuseOverlap } from '@/lib/overlapQuery.js';
import { periodOf } from '@/lib/periodLock.js';
import { approvalRecord } from '@/lib/delegation.js';
import { today } from '@/lib/delegationQuery.js';
import { blockedMessage } from '@/lib/caps.js';
import { normaliseDescription } from '@/src/config/policy.js';

/**
 * บันทึก OT ให้ — one row of วันเกิดที่ยังไม่มีใบ, settled as "they were here",
 * from the in and out times on the fingerprint scanner.
 *
 * A DOOR OF ITS OWN, and that is the design. POST /api/entries files ordinary
 * OT and has no branch that can write `approved`; this one can, for one shape of
 * request, and the shape is checked here rather than assumed from the fact that
 * a button was pressed. `birthdayDirectApproval` in lib/birthdayFiling.js is the
 * rule, and the argument that makes it safe — `birthdayDate` — is recomputed
 * from the employee's own stored วันเกิด under the live policy, below, where no
 * payload can reach it.
 *
 * ONLY TWO TIMES ARE ACCEPTED, never a number of hours. The split, the break
 * deduction and the rounding are the engine's, exactly as they are for a request
 * an employee types — a birthday request that could carry hand-entered hours
 * would be the one row on the sheet arrived at differently from every other.
 */
export const POST = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'manager', 'hr', 'admin');
  const payload = await body(req);

  const employee = await Employee.findById(payload.employeeId).populate('department');
  if (!employee) return fail('ไม่พบพนักงานที่ระบุ', 404);

  // ฝ่ายบุคคล only, and never their own row. No delegations are read: a
  // ผู้รับช่วง holds an approval queue and this is not one.
  const on = today();
  const may = birthdayActionPermission({ user, subject: employee._id });
  if (!may.ok) return fail(may.error, may.status);

  const session = pickSession(payload);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session.workDate)) {
    return fail('กรุณาระบุวันที่ในรูปแบบ YYYY-MM-DD', 400);
  }

  /**
   * A closed month takes no birthday filing either.
   *
   * This one is the likeliest of all the write paths to run into a closed
   * period, because วันเกิดที่ยังไม่มีใบ is by nature discovered late — the
   * queue's whole purpose is to surface days that were missed. Refusing here
   * rather than at the end means HR is told to reopen the month before they
   * fill anything in, and the ordinary answer for an old birthday nobody
   * claimed remains what it already was: settle it as ไม่ได้มาทำงาน.
   */
  const closed = await refusePeriodLock(periodOf(session.workDate), 'บันทึกใบวันเกิดย้อนหลัง');
  if (closed) return fail(closed.error, closed.status);

  /**
   * The context first, because the gate below is a question about the POLICY as
   * much as about the payload: which day the birthday rule puts the holiday on
   * depends on `birthdayLeapFallback`, and whether the rule applies at all
   * depends on `birthdayHolidayEnabled`.
   */
  const ctx = await loadContext([session.workDate], { employee });

  /**
   * THE DATE THE RULE ITSELF PRODUCED, not the one the caller sent.
   *
   * Recomputed here from the stored วันเกิด so that `birthdayDirectApproval` is
   * comparing the payload against the system's own answer. A roster typo throws
   * out of `birthdayInYear` (30 February and the like), which is "cannot tell"
   * rather than "no holiday owed" — and this route must not turn "cannot tell"
   * into an approved entry.
   */
  let birthdayDate = null;
  try {
    birthdayDate = employee.birthDate
      ? birthdayInYear(employee.birthDate, Number(session.workDate.slice(0, 4)), ctx.policy)
      : null;
  } catch {
    return fail('วันเกิดของพนักงานคนนี้ในระบบไม่ถูกต้อง จึงตรวจสอบไม่ได้ — แก้ไขที่หน้าพนักงานก่อน', 409);
  }

  const checks = await BirthdayCheck.find({ employee: employee._id, workDate: session.workDate })
    .select('employee workDate outcome checkedAt').lean();

  const gate = birthdayDirectApproval({
    actor: user,
    employee,
    workDate: session.workDate,
    birthdayDate,
    isCompanyHoliday: ctx.isHoliday(session.workDate),
    today: on,
    policy: ctx.policy,
    alreadyAbsent: absentKeys(checks).has(filedKey(employee._id, session.workDate)),
  });
  if (!gate.ok) return fail(gate.error, gate.status);

  /**
   * The row left the list the moment anybody filed for that day, so a request
   * arriving here means two people pressed at once — or somebody re-sent. Either
   * way a second ใบ for the same birthday is a double claim on one day's hours,
   * and this path has no `refiledFrom` chain to make sense of it.
   */
  const existing = await OtEntry.exists({ employee: employee._id, workDate: session.workDate });
  if (existing) {
    return fail('มีใบ OT ของพนักงานคนนี้ในวันดังกล่าวอยู่แล้ว — เปิดดูที่ตรวจสอบรายเดือน', 409);
  }

  /**
   * AND THE DAY BEFORE, WHICH THE CHECK ABOVE CANNOT SEE.
   *
   * `existing` asks about `workDate` and answers the case this route was
   * written for: two people pressing บันทึก OT ให้ at once. It cannot see a
   * shift filed against YESTERDAY that ran past midnight into this birthday —
   * a different date, so a different `workDate`, and no clash by that test.
   *
   * That gap matters more here than on any other path, because this one can
   * write `approved` in the same act. An overlapping birthday filing would not
   * sit in a queue waiting for somebody to notice it; it would go straight onto
   * the month as signed-off hours claimed twice.
   *
   * The two checks are kept apart rather than merged. `existing` is deliberately
   * blind to status — even a cancelled ใบ for that birthday means somebody has
   * already been here — and this one counts only live requests, because a
   * refused request holds no minutes. Neither answer is the other's.
   */
  const clash = await refuseOverlap(session, { employee: employee._id });
  if (clash) return fail(clash.error, clash.status, { overlaps: clash.overlaps });

  const { value: description, error: descriptionError } = normaliseDescription(payload.description);
  if (descriptionError) return fail(descriptionError, 400);

  const result = await compute(session, ctx);

  // Refused, not stored as a nought — the same sentence all the other write
  // paths use, from lib/entries.js.
  if (result.totals.otHours <= 0) {
    return fail(noOtHoursMessage(session, ctx.policy, ctx.dayTypes, result), 400, {
      warnings: result.warnings,
    });
  }

  /**
   * NO รูปแบบโอที CHECK HERE, and that is the decision rather than an omission.
   *
   * This route files one thing only — a วันหยุดวันเกิด that ฝ่ายบุคคล has read
   * off the scan record — and the birthday holiday is granted by the company to
   * everybody who comes in, whatever their department is paid on. A แผนก marked
   * ไม่มีโอที or เหมารายวัน is saying that staying past 17:00 on an ORDINARY day
   * earns nothing; it is not saying its people do not get their birthday. HR
   * answered this directly, 2026-08-17.
   *
   * The employee-facing paths refuse weekday hours (see `weekdayOtRefusal`).
   * A birthday shift that runs past midnight into an ordinary day does leave a
   * few weekday hours on such a department's month, and they stay: the shift is
   * one shift, HR has the scan record for it in front of them, and refusing the
   * day over its tail would leave the birthday itself unfiled.
   */
  const period = session.workDate.slice(0, 7);
  const cap = await checkCap({
    employee,
    department: employee.department,
    period,
    result,
    policy: ctx.policy,
  });
  // A birthday request eats a department's allowance exactly as any other does:
  // these are real hours somebody worked. Only the BirthdayCheck beside it —
  // "ไม่ได้มาทำงาน" — is outside every ceiling, because it holds no hours at all.
  if (cap.blocked) return fail(blockedMessage(cap), 409, { cap });

  const entry = new OtEntry({
    employee: employee._id,
    department: employee.department._id,
    // The proxy rule, unchanged: `employee` is whoever worked the hours and
    // whose cap and day types they were computed from; `filedBy` is whoever
    // typed it. Neither field moves because this route is new.
    filedBy: user._id,
    ...session,
    description,
  });

  if (gate.direct) {
    /**
     * Filed and signed in one act.
     *
     * `hrDecision` is written because it is TRUE — ฝ่ายบุคคล confirmed these
     * hours against the scan record and that is their step. `managerDecision`
     * is left untouched, because it is not: no หัวหน้า saw this. The history
     * carries one row saying both halves, with the reason on it, and the
     * screens read `isHrVerifiedBirthday` off that row rather than inferring
     * anything from the two decision blocks.
     */
    entry.status = 'approved';
    entry.hrDecision = approvalRecord(user, null, { note: HR_VERIFIED_NOTE });
    applyComputation(entry, result, ctx);
    stampCap(entry, cap);
    entry.log(user, HR_VERIFIED_ACTION, HR_VERIFIED_NOTE, null);
  } else {
    /**
     * Everything else takes the ordinary road, and `initialStatus` decides which
     * part of it — a หัวหน้า filing for their own team skips the step they would
     * have signed and waits at `pending_hr`, saying so; anybody else waits at
     * `pending_mgr`. Not re-derived here: that rule has a config flag of its own
     * and one implementation.
     */
    const start = initialStatus({
      filer: user, employee, department: employee.department, policy: ctx.policy,
    });
    entry.status = start.status;
    applyComputation(entry, result, ctx);
    stampCap(entry, cap);
    entry.log(user, 'submit_proxy', start.note, null);
  }

  await entry.save();

  return json({
    entry: await entry.populate(POPULATE),
    cap,
    /** What just happened, in the words the toast prints. */
    direct: Boolean(gate.direct),
    reason: gate.reason || null,
  }, 201);
});
