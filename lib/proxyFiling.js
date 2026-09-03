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
import { ROLE_LABEL_TH, isSigner, mayApproveRole, filesStraightToHr } from './roles.js';
import { companyOf } from '../src/config/companies.js';

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
 * The four บทบาท that hold a แผนก, and only for people they could sign for.
 * Not ฝ่ายบุคคล and not ผู้ดูแลระบบ: both would be filing for people they do
 * not work beside, which is a different feature with a different argument
 * behind it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TARGET RULE CHANGED SHAPE ON 2026-09-03, AND IT IS THE SAME RULE
 *
 * It read `target.role !== 'employee'` — matching the old `maySubmitOt()` —
 * with the reason "a หัวหน้า filing for another หัวหน้า would create the
 * request §2 exists to prevent, by hand". §2 is gone: every บทบาท files its own
 * OT now, so `role: 'employee'` no longer picks out "somebody who could have
 * filed this themselves" — everybody could.
 *
 * What survives is the half that was doing the work. Filing for somebody is
 * filing a request this person cannot then approve, so the target must be
 * somebody whose request they WOULD have signed — `mayApproveRole`, the same
 * matrix `approvalPermission` decides by. A ผู้จัดการแผนก may therefore file
 * for a หัวหน้างาน on their team and not for another ผู้จัดการแผนก, which is
 * §2's concern stated as a rung instead of as a ban.
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
  if (!isSigner(actor?.role)) {
    return {
      ok: false,
      status: 403,
      error: 'บันทึก OT แทนผู้อื่นได้เฉพาะผู้ที่เซ็นอนุมัติขั้นแรกในแผนก '
        + '(หัวหน้างาน การเงิน ผู้จัดการแผนก ผู้จัดการฝ่าย)',
    };
  }
  if (!mayApproveRole(actor?.role, target.role)) {
    return {
      ok: false,
      status: 400,
      error: 'บันทึกแทนได้เฉพาะคนที่ตนเป็นผู้อนุมัติใบของเขา '
        + `— ใบของ${ROLE_LABEL_TH[target.role] || 'ตำแหน่งนี้'}ไม่ได้ผ่านคุณ`,
    };
  }
  if (target.active === false) {
    return { ok: false, status: 409, error: 'พนักงานคนนี้ถูกปิดใช้งานแล้ว' };
  }
  /**
   * Their own team, and — where the หัวหน้า's signature is scoped to one
   * payroll — their own half of it. Filing for somebody is filing a request
   * this person cannot then approve, and a screen that let them write one and
   * refused it at the next step would be worse than not offering it.
   */
  if (!isDepartmentManager(actor, target.department, companyOf(target))) {
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
export function initialStatus({ filer, employee, department, policy, signers = null }) {
  const ordinary = { status: 'pending_mgr', skipped: false, note: null };

  /**
   * ─────────────────────────────────────────────────────────────────────────
   * SOME บทบาท HAVE NO FIRST STEP AT ALL — asked before anything about who
   * typed the form, because it is a property of whose request this IS.
   *
   * การเงิน, ผู้จัดการฝ่าย, ฝ่ายบุคคล and ผู้ดูแลระบบ file straight to the
   * ฝ่ายบุคคล step: one signature, not two, because the signature they would
   * otherwise collect first is ฝ่ายบุคคล's own. See `APPROVED_BY` in
   * lib/roles.js, which holds the whole matrix and the reason each row is
   * what it is.
   *
   * This is NOT the proxy skip below and must not be confused with it — no
   * step is being skipped by anybody's judgement, and no `SKIP_NOTE` is
   * written, because nothing was passed over. `skipped` stays false for the
   * same reason: the history line it produces says a หัวหน้า signed by filing,
   * and here nobody did.
   */
  if (filesStraightToHr(employee?.role)) {
    return { status: 'pending_hr', skipped: false, note: null };
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────
   * AND SOME แผนก HAVE NOBODY WHO COULD SIGN THE FIRST STEP — so the request
   * goes to ฝ่ายบุคคล rather than to a step no living person holds.
   *
   * `signers` is every active person who might sign, read from the roster by
   * the route; null means the caller did not ask, and the answer is then the
   * ordinary one. Not required-and-throwing like `isDepartmentManager`'s
   * company argument, deliberately: getting this wrong routes a request to a
   * step somebody is watching, which is recoverable by a person, whereas
   * refusing to file it at all is not.
   *
   * WHY THIS EXISTS. The หน่วยงาน table writes ฝ่ายบุคคล into the หัวหน้างาน
   * column of แผนกจัดซื้อ and แผนกทรัพยากรมนุษย์ outright — those departments
   * have no first-step signer and are not expected to grow one. Without this
   * their requests would sit at `pending_mgr` for ever, which is precisely the
   * failure `nobodyCanSign` was written to make VISIBLE and this one exists to
   * make unnecessary.
   */
  if (Array.isArray(signers) && !signers.some(
    (p) => p.active !== false
      && idOf(p) !== idOf(employee)
      && mayApproveRole(p.role, employee?.role)
      && isDepartmentManager(p, department, companyOf(employee)),
  )) {
    return { status: 'pending_hr', skipped: false, note: null };
  }

  if (idOf(filer) === idOf(employee)) return ordinary;
  if (policy?.proxySkipsOwnApproval === false) return ordinary;
  /**
   * "Could this filer sign the step themselves" — so the company scope is part
   * of the question. A หัวหน้า who may not sign for this person's payroll has
   * not signed anything by filing it, and the request must wait at pending_mgr
   * for whoever can.
   */
  if (!isDepartmentManager(filer, department, companyOf(employee))) return ordinary;

  return { status: 'pending_hr', skipped: true, note: SKIP_NOTE };
}
