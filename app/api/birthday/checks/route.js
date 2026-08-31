import Employee from '@/src/models/Employee.js';
import OtEntry from '@/src/models/OtEntry.js';
import BirthdayCheck from '@/src/models/BirthdayCheck.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { loadCalendar } from '@/src/services/otService.js';
import { birthdayInYear } from '@/src/lib/otEngine.js';
import { absentKeys, filedKey, BIRTHDAY_OUTCOMES, OUTCOME } from '@/lib/birthdayCheck.js';
import { birthdayActionPermission, isBirthdaySubject } from '@/lib/birthdayFiling.js';
import { today } from '@/lib/delegationQuery.js';

/**
 * ไม่ได้มาทำงาน — the other answer to a row of วันเกิดที่ยังไม่มีใบ, and the one
 * that is true most months.
 *
 * IT IS NOT AN OT REQUEST AND IT MUST NOT BECOME ONE. Nothing this route writes
 * has an hour, a status, a department or a period on it (see
 * src/models/BirthdayCheck.js), so there is no report, cap, queue or F-HR-027
 * that could count it even by mistake. That is the whole reason it is a
 * collection of its own instead of a flag on OtEntry — a flag would have to be
 * excluded by every rollup, one by one, for ever.
 *
 * APPEND-ONLY. Getting it wrong is undone by POSTing `outcome: 'cancelled'`,
 * which writes a second row; the first stays exactly where it is. The list then
 * shows the birthday again, because `absentKeys` reads the NEWEST row for a
 * person and a date rather than any row.
 *
 * Same permission as the other button, from the same function: ฝ่ายบุคคล and
 * Admin only, and never on their own row.
 */
export const POST = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'manager', 'hr', 'admin');
  const payload = await body(req);

  const outcome = String(payload.outcome || OUTCOME.ABSENT);
  if (!BIRTHDAY_OUTCOMES.includes(outcome)) {
    return fail('outcome ต้องเป็น absent หรือ cancelled', 400);
  }

  const workDate = String(payload.workDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return fail('กรุณาระบุวันที่ในรูปแบบ YYYY-MM-DD', 400);
  }

  const employee = await Employee.findById(payload.employeeId).populate('department');
  if (!employee) return fail('ไม่พบพนักงานที่ระบุ', 404);
  // Everybody the birthday holiday is granted to, which is every role — see
  // BIRTHDAY_SUBJECT_ROLES. Kept as a check rather than dropped: it is what
  // makes "ทุกคน" a decision on the record instead of an absent rule.
  if (!isBirthdaySubject(employee)) {
    return fail('บทบาทนี้ไม่อยู่ในข่ายสวัสดิการวันเกิด', 400);
  }

  const on = today();
  // No delegations read: a ผู้รับช่วง holds an approval queue, and birthday rows
  // are not one — they are ฝ่ายบุคคล's alone. See birthdayActionPermission.
  const may = birthdayActionPermission({ user, subject: employee._id });
  if (!may.ok) return fail(may.error, may.status);

  /**
   * The date has to be the one the birthday rule actually produced for this
   * person — the same guard the filing route applies, for the same reason. A
   * check written against an ordinary Tuesday would be a permanent record
   * asserting something about a day nobody ever asked about, and because the
   * collection is append-only it could never be taken back out.
   *
   * Only for a NEW check. A retraction is allowed whatever the calendar now
   * says: the policy's leap-day answer can move a date between two Februaries,
   * and a check written under the old answer must stay retractable by the
   * person looking at it.
   */
  const calendar = await loadCalendar([workDate]);
  const checks = await BirthdayCheck.find({ employee: employee._id, workDate })
    .select('employee workDate outcome checkedAt').lean();
  const alreadyAbsent = absentKeys(checks).has(filedKey(employee._id, workDate));

  if (outcome === OUTCOME.ABSENT) {
    if (!calendar.policy.birthdayHolidayEnabled) {
      return fail('กฎสวัสดิการวันเกิดปิดอยู่ — ไม่มีรายการวันเกิดให้บันทึก', 409);
    }

    let birthdayDate = null;
    try {
      birthdayDate = employee.birthDate
        ? birthdayInYear(employee.birthDate, Number(workDate.slice(0, 4)), calendar.policy)
        : null;
    } catch {
      return fail('วันเกิดของพนักงานคนนี้ในระบบไม่ถูกต้อง จึงตรวจสอบไม่ได้', 409);
    }
    if (!birthdayDate || birthdayDate !== workDate) {
      return fail('วันที่ที่ระบุไม่ใช่สวัสดิการวันเกิดของพนักงานคนนี้', 400);
    }
    if (workDate > on) {
      return fail('วันเกิดนี้ยังไม่ถึง — ยังไม่มีบันทึกเวลาเข้า-ออกงานให้ตรวจสอบ', 409);
    }
    if (await OtEntry.exists({ employee: employee._id, workDate })) {
      return fail('มีใบ OT ของพนักงานคนนี้ในวันดังกล่าวอยู่แล้ว — ใบนั้นคือหลักฐานว่ามาทำงาน', 409);
    }
    /**
     * Saying it twice is not idempotence — it is a second record of a decision
     * that was already made, by possibly a different person, on a different day.
     * The row is already off the list; there is nothing for a second one to do.
     */
    if (alreadyAbsent) {
      return fail('มีการบันทึกไว้แล้วว่าพนักงานไม่ได้มาทำงานในวันนี้', 409);
    }
  } else if (!alreadyAbsent) {
    // Retracting nothing. Refused rather than accepted quietly, because a
    // 'cancelled' row with no 'absent' before it reads, for ever, as though
    // somebody undid a check that was never made.
    return fail('ไม่มีรายการที่บันทึกว่าไม่ได้มาทำงานในวันนี้ให้ยกเลิก', 409);
  }

  const row = await BirthdayCheck.create({
    employee: employee._id,
    workDate,
    outcome,
    checkedBy: user._id,
    // Denormalised at the moment of writing, so the record stays readable after
    // whoever wrote it has left — see the model.
    checkedByName: user.name,
    checkedAt: new Date(),
    note: String(payload.note || '').trim().slice(0, 500) || undefined,
  });

  return json({
    check: {
      _id: String(row._id),
      employeeId: String(row.employee),
      workDate: row.workDate,
      outcome: row.outcome,
      checkedByName: row.checkedByName,
      checkedAt: row.checkedAt,
      note: row.note || '',
    },
  }, 201);
});
