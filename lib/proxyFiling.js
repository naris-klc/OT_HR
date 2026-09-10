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
import {
  ROLE_LABEL_TH, isSigner, mayApproveRole, filesStraightToHr, hrHeadsDepartment,
} from './roles.js';
import { companyOf } from '../src/config/companies.js';

/**
 * Why a request skipped the manager's step, in the words the history keeps.
 *
 * A constant rather than a literal in the route: the same sentence is what the
 * screens match on when they explain a `pending_hr` entry that nobody approved,
 * and a note that is typed twice is a note that will one day read two ways.
 *
 * NOTHING WRITES IT ON A FRESH INSTALL SINCE 2026-09-09 — `proxySkipsOwnApproval`
 * defaults to `false` and a proxy filing waits for its หัวหน้า. It is neither
 * dead nor deprecated: the flag turns the skip back on, and the rows that were
 * filed while it was the default still carry this note and are still read by it
 * (`managerSignature` in lib/approverLine.js prints their signature off this
 * sentence, and two such rows are on prod).
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
 * [proxySkipsOwnApproval] A PROXY FILING WAITS AT `pending_mgr` LIKE EVERY
 * OTHER REQUEST — the default since 2026-09-09, asked for by HR in those words:
 * บันทึกแทนให้รอหัวหน้าอนุมัติด้วย. The หัวหน้า who typed the form opens
 * รออนุมัติ and presses อนุมัติ on it there, and `approvalPermission` lets them:
 * see the `isOwnFiling` clause in lib/delegation.js, which is the other half of
 * this rule and cannot be read apart from it.
 *
 * The argument for the old default is not withdrawn, only outvoted, and it is
 * worth keeping in front of whoever reads this next. A หัวหน้า pressing อนุมัติ
 * on a form they typed has checked nothing new. The signature is real in the
 * sense that somebody made it, and worthless in the sense that it is the same
 * person twice — while the trail records ยื่นคำขอ → หัวหน้างานอนุมัติ →
 * ฝ่ายบุคคลยืนยัน and reads, as far as anything on the page could show, like two
 * independent people agreeing. Skipping the step openly was worse-looking and
 * said something true: the entry reached HR approved by nobody.
 *
 * WHAT ANSWERS THAT NOW IS NOT THE SKIP BUT THE NAMES. `filedBy` and
 * `managerDecision.by` are both on the entry, and where they are the same person
 * every screen and the sheet say so — `SignatureFacts` writes ผู้บันทึกแทน
 * อนุมัติเอง under the หัวหน้างานอนุมัติ box. A reader can tell one press from
 * two, which is the whole of what the skip was protecting.
 *
 * AND THE PRESS IS NOT NOTHING. It can be declined: ไม่อนุมัติ is on the same
 * row, so a filing typed in error is now refused where it was typed instead of
 * arriving at HR as an approved request. That is the argument HR gave.
 *
 * Set `proxySkipsOwnApproval: true` and the old behaviour comes back: the
 * request goes straight to `pending_hr` carrying `SKIP_NOTE`. The condition for
 * it is deliberately "could this filer sign the step themselves" and NOT "was
 * this filed by proxy". Under `proxyPermission` above the two coincide exactly
 * — every proxy filing is by the department's own หัวหน้า — so today they pick
 * out the same entries. They stop coinciding the moment anybody widens who may
 * file, and of the two only this one stays true.
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
   * AND SOME แผนก HAVE ฝ่ายบุคคล AS THEIR หัวหน้างาน — by rule, not by an
   * empty roster.
   *
   * แผนกจัดซื้อ and แผนกทรัพยากรมนุษย์, which is what the หน่วยงาน table says
   * in their หัวหน้างาน column and what HR restated on 2026-09-07. See
   * `signedByHr` on src/models/Department.js for why the field exists when the
   * roster check below already sends both departments to the same place today.
   *
   * ABOVE THE ROSTER CHECK ON PURPOSE. The rule outranks the roster: the day
   * แผนกจัดซื้อ gains a ผู้จัดการแผนก, this is what stops their requests
   * quietly re-routing to a signature HR never asked for. Read the other way
   * round the field would do nothing until it was already too late to matter.
   *
   * `skipped` stays false and no `SKIP_NOTE` is written, for the same reason as
   * the branch above: nothing was passed over.
   */
  if (hrHeadsDepartment(department)) {
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
   * WHY THIS EXISTS, now that the branch above names the two departments the
   * หน่วยงาน table hands to ฝ่ายบุคคล outright. This one is the OTHER way a
   * department ends up with no first step: nobody has decided anything about
   * it, and it simply has no living signer today — a หัวหน้า left, a เซ็นให้
   * บริษัท was narrowed, or the แผนก never had one. สำนักงาน sat in exactly
   * that state for as long as the roster has existed.
   *
   * Without it their requests would sit at `pending_mgr` for ever, which is
   * precisely the failure `nobodyCanSign` was written to make VISIBLE and this
   * one exists to make unnecessary. It stays BELOW `hrHeadsDepartment` because
   * the two say different things: this answer changes with the next hire, and
   * that one changes only when a person changes it.
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
  /**
   * OPT-IN SINCE 2026-09-09, and written as `!== true` rather than as
   * `=== false` on purpose.
   *
   * The default moved (see `proxySkipsOwnApproval` in src/config/policy.js), and
   * the shape of the test has to move with it: a stored `Setting.policy` from
   * before that day carries no such key at all, and `=== false` would have read
   * that absence as "skip", which is the answer HR has just withdrawn. Absent
   * now means the default, and the default is to wait.
   */
  if (policy?.proxySkipsOwnApproval !== true) return ordinary;
  /**
   * "Could this filer sign the step themselves" — so the company scope is part
   * of the question. A หัวหน้า who may not sign for this person's payroll has
   * not signed anything by filing it, and the request must wait at pending_mgr
   * for whoever can.
   */
  if (!isDepartmentManager(filer, department, companyOf(employee))) return ordinary;

  return { status: 'pending_hr', skipped: true, note: SKIP_NOTE };
}
