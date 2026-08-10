/**
 * หัวหน้าบันทึก OT แทนลูกทีม — who may file for whom, and where the request
 * starts.
 *
 * Two rules, both pure, both here rather than in the route for the reason
 * `editPermission` is: they are the whole feature, they are what anybody will
 * argue about, and neither of them needs a database to be checked.
 *
 * The request that comes out of this is the EMPLOYEE'S, not the หัวหน้า's.
 * `entry.employee` is the person who worked the hours, `entry.department` is
 * their department, the cap it is measured against is theirs and the day types
 * are resolved from their birthday. `filedBy` is the only field that records
 * the หัวหน้า, and it exists so that neither the screen nor the paper can
 * present a filing as something the employee did themselves.
 */
import { idOf, isDepartmentManager } from './entries.js';

/**
 * Why a request skipped the manager's step, in the words the history keeps.
 *
 * A constant rather than a literal in the route: the same sentence is what the
 * screens match on when they explain a `pending_hr` entry that nobody approved,
 * and a note that is typed twice is a note that will one day read two ways.
 */
export const SKIP_NOTE = 'หัวหน้างานเป็นผู้บันทึกแทนและเป็นผู้อนุมัติขั้นหัวหน้าของรายการนี้เอง '
  + '— ข้ามขั้นรอหัวหน้าไปยังขั้นรอ HR';

/**
 * May this person file a request on that person's behalf?
 *
 * หัวหน้า only, and only for their own team. Not HR and not Admin: neither
 * files OT today and both would be filing for people they do not work beside,
 * which is a different feature with a different argument behind it. The whole
 * rule is this one predicate, so opening it up later is one clause, not a
 * rewrite.
 *
 * The target has to be somebody who could have filed it themselves —
 * `role: 'employee'`, matching `Employee.maySubmitOt()`. A หัวหน้า filing for
 * another หัวหน้า would create the request §2 exists to prevent, by hand.
 *
 * Returns `{ ok: true }` or `{ ok: false, error, status }` ready for `fail()`.
 */
export function proxyPermission(actor, target) {
  if (!target) return { ok: false, status: 404, error: 'ไม่พบพนักงานที่ระบุ' };

  if (idOf(actor) === idOf(target)) {
    // Not a refusal of anything — the caller asked the wrong question. Filing
    // for oneself is the ordinary path and does not come through here.
    return { ok: false, status: 400, error: 'การบันทึกให้ตนเองไม่ใช่การบันทึกแทน' };
  }
  if (actor?.role !== 'manager') {
    return { ok: false, status: 403, error: 'บันทึก OT แทนผู้อื่นได้เฉพาะหัวหน้างาน' };
  }
  if (target.role !== 'employee') {
    return {
      ok: false,
      status: 400,
      error: 'บันทึกแทนได้เฉพาะพนักงานที่มีสิทธิ์ขอ OT — หัวหน้างานและฝ่ายบุคคลไม่อยู่ในข่าย',
    };
  }
  if (target.active === false) {
    return { ok: false, status: 409, error: 'พนักงานคนนี้ถูกปิดใช้งานแล้ว' };
  }
  if (!isDepartmentManager(actor, target.department)) {
    return { ok: false, status: 403, error: 'บันทึกแทนได้เฉพาะพนักงานในแผนกของตน' };
  }
  return { ok: true };
}

/**
 * Where a newly filed request starts — and why, when that is not the usual
 * place.
 *
 * [proxySkipsOwnApproval] A หัวหน้า who fills the form in and then presses
 * อนุมัติ on it has checked nothing. The signature is real in the sense that
 * somebody made it, and worthless in the sense that it is the same person
 * twice — but the audit trail cannot tell those apart afterwards. It records
 * ยื่นคำขอ → หัวหน้างานอนุมัติ → ฝ่ายบุคคลยืนยัน and reads, correctly as far as
 * anything on the page can show, as two independent people agreeing. That is
 * the lie. Skipping the step openly is worse-looking and more honest: the
 * entry arrives at HR having been approved by nobody, and says so.
 *
 * The condition is deliberately "could this filer sign the step themselves"
 * and NOT "was this filed by proxy". Under `proxyPermission` above the two
 * coincide exactly — every proxy filing is by the department's own หัวหน้า —
 * so today they pick out the same entries. They stop coinciding the moment
 * anybody widens who may file, and of the two only this one stays true.
 *
 * Set `proxySkipsOwnApproval: false` and a proxy filing waits at `pending_mgr`
 * like any other, for the หัวหน้า who wrote it to approve. That is a defensible
 * answer — some HR departments want the two presses on the record whatever they
 * are worth — which is why it is a flag rather than an assumption, and why the
 * flag defaults to the honest reading rather than the flattering one.
 *
 * Returns `{ status, skipped, note }`. `note` is null unless something happened
 * that the history has to explain.
 */
export function initialStatus({ filer, employee, department, policy }) {
  const ordinary = { status: 'pending_mgr', skipped: false, note: null };

  if (idOf(filer) === idOf(employee)) return ordinary;
  if (policy?.proxySkipsOwnApproval === false) return ordinary;
  if (!isDepartmentManager(filer, department)) return ordinary;

  return { status: 'pending_hr', skipped: true, note: SKIP_NOTE };
}
