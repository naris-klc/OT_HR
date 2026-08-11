/** The shortest password the system accepts, wherever one is set. */
export const PASSWORD_MIN_LENGTH = 6;

/**
 * First-login password when none is supplied.
 *
 * Derived from the employee code, which everyone on the roster can read, so it
 * is a password only in the sense that it is what HR reads down the phone on the
 * first day. `mustChangePassword` on the model is what stops it being the
 * password someone still has in a year — an account issued by HR cannot reach
 * any other screen until the person holding it has replaced this.
 */
export function defaultPassword(code) {
  return `Primus@${String(code).replace(/\W/g, '')}`;
}

/**
 * Roles ฝ่ายบุคคล may hand out.
 *
 * HR creates and maintains the roster, so `hr` and `admin` are both on the
 * ทะเบียนพนักงาน screen — but only Admin may mint another Admin. Without that
 * line, "HR can create accounts" also reads "HR can create an account that can
 * do anything", which is a bigger grant than onboarding a new hire needs and is
 * not the one anybody agreed to.
 */
export const HR_ASSIGNABLE_ROLES = ['employee', 'manager'];

/**
 * May this person create or change this roster row — and give it this บทบาท.
 *
 * A permission rule rather than a role list on each route, for the reason
 * `maySeeBirthDate` is one: the roster is written by four endpoints across two
 * servers (create, edit, CSV import, and the import's per-row loop), and a rule
 * spelled out four times is a rule that will be right in three places.
 *
 * The target check is the half that is easy to miss. Letting HR edit any row
 * includes the Admin's row, and editing a row includes setting its password —
 * so HR without this could hand themselves the Admin account's password and log
 * in as Admin, which is the same escalation the role list above refuses, taken
 * the long way round.
 *
 * `{ ok: true }`, or `{ ok: false, status, error }` ready for the route to
 * return — the shape `editPermission` in lib/entries.js uses.
 */
export function rosterPermission(actor, { target = null, role = null } = {}) {
  if (!actor) return { ok: false, status: 401, error: 'ไม่ได้เข้าสู่ระบบ' };
  if (!['hr', 'admin'].includes(actor.role)) {
    return { ok: false, status: 403, error: 'ไม่มีสิทธิ์ใช้งานส่วนนี้' };
  }
  if (actor.role === 'admin') return { ok: true };

  if (target?.role === 'admin') {
    return { ok: false, status: 403, error: 'บัญชีผู้ดูแลระบบแก้ไขได้เฉพาะผู้ดูแลระบบเท่านั้น' };
  }
  if (role != null && !HR_ASSIGNABLE_ROLES.includes(role)) {
    return {
      ok: false,
      status: 403,
      error: 'ฝ่ายบุคคลกำหนดบทบาทได้เฉพาะพนักงานและหัวหน้างาน — บทบาทอื่นต้องให้ผู้ดูแลระบบตั้งให้',
    };
  }
  return { ok: true };
}

/**
 * รหัสพนักงาน on a row that already exists — Admin only, and never silently.
 *
 * Every other field on this screen describes the person. The code IS the
 * account: it is what they type to log in, what `companyFromCode` falls back to
 * when deciding which payroll they file under, and what every historic ใบ was
 * reconciled against on paper. Changing it is three changes at once, and two of
 * them are invisible from the ทะเบียน screen.
 *
 * So it is not on HR's list — not because HR is trusted less, but because the
 * blast radius is not the row in front of them — and Admin cannot do it by
 * accident either: a reason is required and stored, so the row afterwards says
 * why it stopped being the code payroll has on their sheets.
 *
 * Creating an account is NOT this. A new row's code is chosen, not changed;
 * there is no login, no payroll history and nothing to be inconsistent with, so
 * `rosterPermission` alone governs it.
 *
 * Called with the stored code and the incoming one — a payload repeating the
 * code it already has is not a change and is not refused, which is what lets the
 * edit form send the whole row without HR needing a different form from Admin's.
 *
 * `{ ok: true, changed }`, or `{ ok: false, status, error }`.
 */
export function codeChangePermission(actor, { from, to, reason = '' } = {}) {
  // Compared as stored, not normalised. PM-0620 → PM0620 IS a change of the
  // string that logs in and prints on the sheets, even though `sameCode` reads
  // the two as one person — see src/lib/employeeCode.js, where normalisation is
  // deliberately compare-time only and never rewrites what is stored.
  if (to == null || String(to).trim() === '' || String(to).trim() === String(from ?? '')) {
    return { ok: true, changed: false };
  }
  if (!actor) return { ok: false, status: 401, error: 'ไม่ได้เข้าสู่ระบบ' };
  if (actor.role !== 'admin') {
    return {
      ok: false,
      status: 403,
      error: 'รหัสพนักงานของคนที่มีอยู่แล้วแก้ได้เฉพาะผู้ดูแลระบบ '
        + '— รหัสผูกกับการเข้าสู่ระบบ การเดาบริษัทจากรหัส และใบ OT เดิมทั้งหมด',
    };
  }
  if (!String(reason || '').trim()) {
    return { ok: false, status: 400, error: 'การเปลี่ยนรหัสพนักงานต้องระบุเหตุผล' };
  }
  return { ok: true, changed: true };
}

/**
 * Who is allowed to be told somebody's วันเกิด.
 *
 * The employee themselves, HR and Admin — and nobody else, managers included.
 * A birthday is personal data that the OT process has no use for beyond
 * deciding one person's day type, and that decision happens on the server. A
 * manager needs their team's hours, not their dates of birth.
 *
 * Written as a rule over (viewer, row) rather than a field list per route,
 * because the roster is served by two endpoints on two servers and a projection
 * that has to be remembered four times is a projection that will be right in
 * three places.
 */
export function maySeeBirthDate(viewer, employee) {
  if (!viewer) return false;
  if (['hr', 'admin'].includes(viewer.role)) return true;
  return String(viewer._id) === String(employee?._id);
}

/**
 * An employee row as a given viewer is allowed to receive it.
 *
 * Everything except birthDate is unchanged — this is not a narrowing of what
 * the roster screens show, it is the removal of a field they never displayed
 * and were being sent anyway. `.lean()` returns the whole document, so the leak
 * was silent: nothing on any screen would have looked different.
 */
export function publicEmployee(employee, viewer) {
  if (!employee) return employee;
  const { birthDate, ...rest } = employee;
  return maySeeBirthDate(viewer, employee) && birthDate
    ? { ...rest, birthDate }
    : rest;
}
