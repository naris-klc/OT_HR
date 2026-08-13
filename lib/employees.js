/** The shortest password the system accepts, wherever one is set. */
export const PASSWORD_MIN_LENGTH = 6;

/**
 * The first-login password is NOT here, and is not derived from anything.
 *
 * It used to be `Primus@` + the code — computable from a roster that is printed
 * on every form the company files. It is now `generateTempPassword()` in
 * lib/tempPassword.js, which is `node:crypto` on the server and is deliberately
 * in a module this one does not import: client components import THIS file, and
 * a password generator reachable from the browser is not a password generator.
 * See that file for why it is shaped the way it is.
 */

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
 * `maySeePersonalDetails` is one: the roster is written by four endpoints across two
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
 * A password with the letters and digits pulled out of it, in one case.
 *
 * `PM-0620` and `pm0620` are the same employee code written two ways — the
 * roster itself holds both shapes (see normalizeCode) — and `Primus@PM-0620`
 * hides the code from a naive `includes` and from nobody else. Punctuation and
 * case are exactly the decoration somebody adds to a guessable password to make
 * it look unguessable, so the comparison is made after both are removed.
 */
const alnum = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * May this be somebody's first password — the one ฝ่ายบุคคล typed in themselves.
 *
 * WHY THE RULE IS NOT JUST A LENGTH. What this system had before was
 * `Primus@` + the employee code, and the reason that was a hole is not that it
 * was short: the roster is printed on every ใบ F-HR-027 and in every file sent
 * to accounting, so the password of every account nobody had logged into yet was
 * written on paper the company hands out. Offering HR a box to type a password
 * into is offering them somewhere to type that same scheme back in by hand —
 * `PM0620` and `Primus@PM-0620` are the two spellings they would reach for
 * first, and both are refused here, in one place, for both servers.
 *
 * It does NOT try to be a password policy. There is no character-class rule and
 * no dictionary: this credential exists to be replaced at the first login
 * (`mustChangePassword`), the person choosing it is HR rather than the account
 * holder, and a rule that makes HR fight the box is a rule that gets solved with
 * `Aa1!aaaa` for everybody. The one failure it refuses is the one that actually
 * happened.
 *
 * `{ ok: true }`, or `{ ok: false, status, error }` — the shape the routes above
 * already return.
 */
export function chosenPasswordPermission(password, { code = '' } = {}) {
  const value = String(password ?? '');
  if (value.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`,
    };
  }
  // Under three characters there is nothing left to recognise — a code stripped
  // to `pm` would refuse every password with those two letters anywhere in it.
  const bare = alnum(code);
  if (bare.length >= 3 && alnum(value).includes(bare)) {
    return {
      ok: false,
      status: 400,
      error: 'รหัสผ่านต้องไม่มีรหัสพนักงานอยู่ในนั้น — รหัสพนักงานถูกพิมพ์อยู่บนใบ OT '
        + 'ทุกใบและในไฟล์ที่ส่งบัญชี ใครก็ตามที่เห็นเอกสารเหล่านั้นจึงเดารหัสผ่านได้',
    };
  }
  return { ok: true };
}

/**
 * The two fields nobody may change on their OWN row.
 *
 * Named once and shared by the rule below, the routes that apply it and the
 * dialog that greys them out, so the field list cannot drift between the
 * refusal and the explanation of it.
 */
export const SELF_LOCKED_FIELDS = Object.freeze(['role', 'active']);

/**
 * Nobody edits themselves out of the system.
 *
 * ฝ่ายบุคคล and ผู้ดูแลระบบ can both reach their own row on ทะเบียนพนักงาน —
 * they are on the roster like everybody else, and correcting one's own surname
 * or job title is an ordinary thing to want. Two of the fields on that row are
 * not ordinary: บทบาท decides which screens exist for this account and
 * สถานะการใช้งาน decides whether it can log in at all. Saving either of them
 * against oneself is a change whose consequence is that you cannot undo it —
 * the screen you would undo it from is the one you just removed.
 *
 * The recovery is somebody else with the rights, which for a single-Admin
 * installation is nobody. So it is refused rather than warned about: a
 * confirmation dialog is the wrong instrument for an action with no way back.
 *
 * A payload REPEATING the values it already has is not a change and is not
 * refused — the same rule `codeChangePermission` follows, and for the same
 * reason: the CSV import and the Express router both send whole rows, and a
 * re-import of an unchanged roster must not start failing on the importer's own
 * line.
 *
 * `{ ok: true }`, or `{ ok: false, status, error }`.
 */
export function selfEditPermission(actor, { target = null, role = null, active = null } = {}) {
  if (!actor || !target) return { ok: true };
  if (String(actor._id ?? '') !== String(target._id ?? '')) return { ok: true };

  if (role != null && role !== target.role) {
    return {
      ok: false,
      status: 403,
      error: 'เปลี่ยนบทบาทของบัญชีตัวเองไม่ได้ '
        + '— ถ้าเปลี่ยนแล้วจะไม่มีสิทธิ์เข้าหน้านี้เพื่อเปลี่ยนกลับ ให้ผู้ดูแลระบบคนอื่นเปลี่ยนให้',
    };
  }
  if (active != null && Boolean(active) !== (target.active !== false)) {
    return {
      ok: false,
      status: 403,
      error: 'ปิดใช้งานบัญชีตัวเองไม่ได้ — บัญชีที่ปิดแล้วเข้าระบบไม่ได้ '
        + 'จึงเปิดคืนเองไม่ได้ ให้ผู้ดูแลระบบคนอื่นทำให้',
    };
  }
  return { ok: true };
}

/**
 * Would saving this take an active ผู้ดูแลระบบ off the board?
 *
 * Pure and cheap, so the routes can ask it BEFORE they spend a count query. A
 * row that is not an active Admin cannot reduce the number of active Admins,
 * whatever is being done to it.
 */
export function dropsAnAdmin(target, { role = null, active = null } = {}) {
  if (target?.role !== 'admin') return false;
  if (target?.active === false) return false;
  if (role != null && role !== 'admin') return true;
  if (active != null && !Boolean(active)) return true;
  return false;
}

/**
 * There is always at least one ผู้ดูแลระบบ who can log in.
 *
 * `selfEditPermission` above stops somebody removing their OWN access; this
 * stops the same outcome reached the polite way round — two Admins each
 * demoting the other, or one Admin demoting the only other one and then being
 * deactivated by HR, who cannot make a new Admin (`HR_ASSIGNABLE_ROLES`). Both
 * end with a system that has nobody who can hand the role back out, and the
 * repair for that is a database console.
 *
 * The count is the caller's to supply — it needs a query and this file stays
 * pure — and it must EXCLUDE the row being edited: "is there another one" is the
 * question, not "how many are there".
 *
 * 409 rather than 403: the actor has the right to do this, the state of the
 * system is what refuses. The same distinction the entry routes draw between
 * "not yours to sign" and "already signed".
 */
export function lastAdminPermission(target, { role = null, active = null, otherActiveAdmins = 0 } = {}) {
  if (!dropsAnAdmin(target, { role, active })) return { ok: true };
  if (otherActiveAdmins > 0) return { ok: true };
  return {
    ok: false,
    status: 409,
    error: 'นี่คือผู้ดูแลระบบที่ใช้งานอยู่คนสุดท้าย — เปลี่ยนบทบาทหรือปิดใช้งานไม่ได้ '
      + 'เพราะจะไม่เหลือใครที่ตั้งผู้ดูแลระบบคนใหม่ได้ ให้ตั้งผู้ดูแลระบบอีกคนก่อน',
  };
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
 * The fields on a roster row that describe the PERSON rather than the job.
 *
 * A list rather than one named field, because there is now more than one and
 * the second was added to a screen without anybody asking this question. วันเกิด
 * is here because the OT process has no use for it beyond deciding one person's
 * day type, and that decision happens on the server. อีเมล is here because it is
 * a way to contact somebody outside work — the same category, and it reached the
 * roster the same way: it is on the model, `.lean()` returns it, and no screen
 * ever displayed it, so nothing looked different while it was being sent to
 * every หัวหน้า with their team's rows.
 *
 * Anything added to the Employee schema that is about the person and not about
 * the work belongs on this list. The failure mode is then a field that is
 * withheld too widely, which somebody notices; leaving it off is a field that
 * leaks silently, which nobody does.
 */
export const PERSONAL_FIELDS = Object.freeze(['birthDate', 'email']);

/**
 * Who is allowed to be told somebody's personal details.
 *
 * The employee themselves, HR and Admin — and nobody else, managers included. A
 * manager needs their team's hours, not their dates of birth or their private
 * addresses.
 *
 * Written as a rule over (viewer, row) rather than a field list per route,
 * because the roster is served by two endpoints on two servers and a projection
 * that has to be remembered four times is a projection that will be right in
 * three places.
 *
 * (Was `maySeeBirthDate` while วันเกิด was the only such field. Renamed rather
 * than extended in place: a function named for one field deciding the fate of
 * two is how the second one ends up uncovered by the next person to read it.)
 */
export function maySeePersonalDetails(viewer, employee) {
  if (!viewer) return false;
  if (['hr', 'admin'].includes(viewer.role)) return true;
  return String(viewer._id) === String(employee?._id);
}

/**
 * An employee row as a given viewer is allowed to receive it.
 *
 * Everything outside `PERSONAL_FIELDS` is unchanged — this is not a narrowing of
 * what the roster screens show, it is the removal of fields they never displayed
 * and were being sent anyway. `.lean()` returns the whole document, so the leak
 * was silent: nothing on any screen would have looked different.
 *
 * Built by deleting rather than by picking, deliberately. A whitelist here would
 * mean every new schema field arriving invisible until somebody remembered to
 * add it — which breaks screens loudly and is fixed by widening the list, and
 * the widening is where a personal field gets waved through.
 */
export function publicEmployee(employee, viewer) {
  if (!employee) return employee;
  if (maySeePersonalDetails(viewer, employee)) return employee;
  const rest = { ...employee };
  for (const field of PERSONAL_FIELDS) delete rest[field];
  return rest;
}
