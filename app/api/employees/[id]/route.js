import Employee, { ROLES } from '@/src/models/Employee.js';
import { COMPANY_KEYS } from '@/src/config/companies.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import {
  codeChangePermission, dropsAnAdmin, lastAdminPermission, rosterPermission, selfEditPermission,
  signingScope,
} from '@/lib/employees.js';
import { generateTempPassword } from '@/lib/tempPassword.js';
import { BIRTHDATE_REPLAY_NOTE, rosterChanges } from '@/lib/rosterAudit.js';
import { recordRosterChange } from '@/lib/rosterAuditLog.js';
import { codeMatcher, sameCode } from '@/src/lib/employeeCode.js';
import { recomputeEntries } from '@/src/services/otService.js';
import { PENDING_STATUSES } from '@/lib/accounting.js';

export const PATCH = route(async (req, { params }) => {
  const actor = await requireAuth(req);

  const employee = await Employee.findById(params.id);
  if (!employee) return fail('ไม่พบพนักงาน', 404);

  const {
    code, name, email, position, birthDate, department, role, company, approvesCompany, active,
    resetPassword, password, reason,
  } = await body(req);

  if (role != null && !ROLES.includes(role)) return fail('บทบาทไม่ถูกต้อง', 400);

  /**
   * A caller-chosen password is refused rather than ignored.
   *
   * The server issues these now — `generateTempPassword`, from `node:crypto` —
   * and the field used to be filled in by the BROWSER with a value computed
   * from the employee code. Accepting one silently would leave that path open
   * for anything still sending it, and a request that thought it set a password
   * and did not is worse than one that was told.
   */
  if (password !== undefined) {
    return fail(
      'ระบบเป็นผู้สร้างรหัสผ่านชั่วคราวเอง — ส่งค่า resetPassword: true เพื่อขอรหัสใหม่',
      400,
    );
  }

  // Read before anything is assigned: the rule is about the row as it stands
  // and the role being asked for, not about the half-mutated document.
  const may = rosterPermission(actor, { target: employee, role: role ?? null });
  if (!may.ok) return fail(may.error, may.status);

  /**
   * Nobody edits themselves out of the system, and the system always keeps one
   * ผู้ดูแลระบบ who can log in.
   *
   * Both read the row as it STANDS, alongside the permission above and before
   * any assignment — `selfEditPermission` compares the incoming values against
   * the stored ones to decide whether anything is being changed at all, which a
   * half-mutated document cannot answer.
   */
  const self = selfEditPermission(actor, { target: employee, role: role ?? null, active: active ?? null });
  if (!self.ok) return fail(self.error, self.status);

  // The count only when it can matter — see `dropsAnAdmin`. Excludes this row:
  // the question is whether there is ANOTHER one.
  if (dropsAnAdmin(employee, { role: role ?? null, active: active ?? null })) {
    const otherActiveAdmins = await Employee.countDocuments({
      role: 'admin', active: true, _id: { $ne: employee._id },
    });
    const last = lastAdminPermission(employee, {
      role: role ?? null, active: active ?? null, otherActiveAdmins,
    });
    if (!last.ok) return fail(last.error, last.status);
  }

  /**
   * รหัสพนักงาน is its own permission, on top of the one above and not folded
   * into it. `rosterPermission` answers "may this person write this row"; this
   * answers "may they change the thing the row is identified BY", and ฝ่ายบุคคล
   * get the first without the second. A payload repeating the existing code is
   * not a change — see lib/employees.js.
   */
  const codeChange = codeChangePermission(actor, { from: employee.code, to: code, reason });
  if (!codeChange.ok) return fail(codeChange.error, codeChange.status);

  /**
   * The row as it stands, captured before a single field is assigned.
   *
   * A plain object rather than the document, because the document is about to
   * be mutated in place and a "before" that is a live reference to the thing
   * being changed records nothing at all.
   */
  const before = {
    code: employee.code,
    name: employee.name,
    email: employee.email,
    position: employee.position,
    birthDate: employee.birthDate,
    department: employee.department,
    role: employee.role,
    company: employee.company,
    approvesCompany: employee.approvesCompany,
    active: employee.active,
  };

  if (codeChange.changed) {
    const wanted = String(code).trim().toUpperCase();
    const matcher = codeMatcher(wanted);
    if (!matcher) return fail(`รหัสพนักงานไม่ถูกต้อง "${code}"`, 400);
    /**
     * Checked against the NORMALISED form, not left to the unique index.
     *
     * PM-0620 and PM0620 are one person everywhere else in this system
     * (src/lib/employeeCode.js) and the index cannot see that — the two strings
     * genuinely differ, so the save would succeed and leave two rows that log
     * in as each other's near-miss. Excluding this row keeps a change of
     * punctuation on one's own code allowed.
     */
    const clash = await Employee.findOne({ code: matcher, _id: { $ne: employee._id } })
      .select('code name').lean();
    if (clash && sameCode(clash.code, wanted)) {
      return fail(`รหัสพนักงาน "${clash.code}" ถูกใช้อยู่แล้วโดย ${clash.name}`, 409);
    }
    employee.code = wanted;
  }

  if (name != null) employee.name = name;
  if (email !== undefined) employee.email = email || undefined;
  if (position != null) employee.position = position;
  // `undefined` means "not mentioned"; '' means "clear it". Storing '' instead
  // would fail the schema's YYYY-MM-DD match.
  if (birthDate !== undefined) employee.birthDate = birthDate || undefined;
  if (department != null) employee.department = department;
  if (role != null) employee.role = role;
  if (company != null) {
    // Moving someone between companies changes which payroll they belong to
    // from here on — and, because สรุป OT ส่งบัญชี reads today's value rather
    // than one stored on the entry, it also restates which file every month
    // they have ever worked belongs to. The screen warns before saving this.
    if (!COMPANY_KEYS.includes(company)) return fail('บริษัทไม่ถูกต้อง', 400);
    employee.company = company;
  }
  /**
   * Who this หัวหน้า may sign for. `undefined` is "not mentioned" and null is
   * "ทุกบริษัท" — two different things, so this cannot use the `!= null` guard
   * every field above it uses, or clearing the scope back to ทุกบริษัท would be
   * indistinguishable from not sending the field at all.
   */
  if (approvesCompany !== undefined) {
    const signs = signingScope(approvesCompany);
    if (!signs.ok) return fail(signs.error, 400);
    employee.approvesCompany = signs.value;
  }
  if (active != null) employee.active = Boolean(active);

  /**
   * A reset is HR issuing a password, exactly as creating the account was — so
   * it carries the same obligation to replace it. Editing anything else leaves
   * the flag alone: a corrected job title is not a reason to ask somebody for a
   * new password.
   *
   * The value is made here and returned once. It is never read from the request,
   * which is the whole of the earlier fix: the browser used to compute it.
   *
   * GENERATED AND HASHED HERE, WRITTEN AT THE VERY END. Nothing about this
   * account's password moves until every other thing this request does has
   * already succeeded — see the write below. A password that reached the
   * database and not the person who asked for it is not a failed reset, it is a
   * locked-out employee nobody can help: the hash is one-way, so there is no
   * screen, no log and no support path that can recover it, and the only repair
   * is another reset. Every other failure in this handler must therefore leave
   * the old password working.
   */
  const issued = resetPassword ? generateTempPassword() : null;
  const issuedHash = issued ? await Employee.hashPassword(issued) : null;

  /**
   * Computed from the same document that is about to be saved, so the trail
   * cannot describe a set of values different from the one that was stored.
   * `rosterChanges` reads only its allowlist, which is what keeps the password
   * out of here structurally rather than by anybody remembering.
   */
  const changes = rosterChanges(before, {
    code: employee.code,
    name: employee.name,
    email: employee.email,
    position: employee.position,
    birthDate: employee.birthDate,
    department: employee.department,
    role: employee.role,
    company: employee.company,
    approvesCompany: employee.approvesCompany,
    active: employee.active,
  });
  const birthDateMoved = changes.some((c) => c.field === 'birthDate');

  await employee.save();

  /**
   * A moved วันเกิด moves which days were that person's holiday, so the hours
   * already filed against those days no longer describe the calendar they were
   * computed under.
   *
   * Replayed here for the reason the holiday routes replay theirs: the roster
   * screen is where the calendar changed, and an entry that quietly keeps a
   * stale day type until some unrelated policy save happens to sweep it up is
   * an entry whose figures nobody can explain in the meantime.
   *
   * APPROVED ENTRIES MOVE TOO, WHILE THE MONTH IS OPEN. HR's rule, 2026-08-18.
   * Until then this replayed only the pending statuses, on the reasoning that
   * hours somebody signed for do not move because a birth date was corrected
   * afterwards. What that left behind is an approved entry printed on F-HR-027
   * under a day type everybody now agrees is wrong — and while the month is
   * still open nothing has been sent anywhere, so there is no outside figure
   * for the old one to agree with. The paper is simply wrong.
   *
   * The guard is ปิดงวด, not the signature: `recomputeEntries` skips a closed
   * month whatever it is asked to do (test/replayPeriodLock.test.js — "a closed
   * month is skipped", "includeApproved does not open a closed month"), so a
   * month that HAS gone to accounting still needs an administrator to reopen
   * it. The reply names those months, so the screen can say which ones were
   * left standing on the old date.
   *
   * What the escape hatch asks for is still paid: every entry whose figures
   * actually move keeps a `before` snapshot and a `recompute` line carrying
   * `BIRTHDATE_REPLAY_NOTE`, so the change appears in ประวัติรายการ beside the
   * ordinary corrections. `authorizeReplay`'s admin-only clause is not consulted
   * here, and that is the deliberate part: it exists so nobody re-reads a POLICY
   * question and quietly restates a month on the strength of their own reading.
   * A birth date is not a reading — it is a fact that was recorded wrong.
   *
   * Rejected and cancelled rows stay out, as they always did: nothing will ever
   * pay against them, and they would collect a `recompute` line each time.
   */
  let recomputed = null;
  if (birthDateMoved) {
    recomputed = await recomputeEntries(
      { employee: employee._id, status: { $in: [...PENDING_STATUSES, 'approved'] } },
      actor,
      { source: 'manual', includeApproved: true, note: BIRTHDATE_REPLAY_NOTE },
    );
  }

  /**
   * The response, assembled while the password can still be un-issued.
   *
   * `populate` is a query and a query can fail, so it happens on this side of
   * the write. Everything after this line is either the write itself or cannot
   * throw.
   */
  const populated = await employee.populate('department', 'code name nameTh');

  /**
   * ─────────────────────────────────────────────────────────────────────────
   * THE POINT OF NO RETURN, AND IT IS DELIBERATELY THE LAST ONE.
   *
   * The old password stops working here and the new one exists in exactly one
   * place: the `password` field a few lines below. Nothing may fail between
   * this write and that response — which is why the save, the birthday replay
   * and the populate above have all already happened, and why the audit below
   * cannot throw by construction (lib/rosterAuditLog.js returns false instead).
   *
   * A targeted `updateOne` rather than `employee.save()`: the document has been
   * through validators and hooks already, and re-saving the whole row here
   * would put every other field's failure modes back in front of the one write
   * that must not be rolled back into.
   *
   * This is as close to all-or-nothing as one HTTP request gets. What it cannot
   * cover is the response failing to ARRIVE — a dropped connection, a closed
   * tab — because at that point the write has committed and no server knows.
   * The screen carries that half: the dialog holds the password until somebody
   * confirms they have written it down (components/AdminView.jsx).
   */
  if (issuedHash) {
    await Employee.updateOne(
      { _id: employee._id },
      { $set: { passwordHash: issuedHash, mustChangePassword: true } },
    );
    // The copy going back in the response, brought level with the stored row.
    // Assignment only — the document is never saved again.
    employee.mustChangePassword = true;
  }

  const auditLogged = await recordRosterChange({
    employee,
    // A reset with nothing else changed is its own event; a reset alongside
    // edits stays one record for one request. Either way the password is a
    // boolean on the row and never a value.
    action: changes.length ? 'update' : 'password_reset',
    changes,
    passwordReset: Boolean(issued),
    reason,
    actor,
  });

  return json({
    employee: populated,
    /**
     * The issued password, exactly once, and only for a reset.
     *
     * This response is the ONLY moment it is readable: the database holds a
     * hash and every roster read goes through `publicEmployee`, so a screen
     * that loses it has no way to ask again — the recovery is another reset.
     * It used to be absent here on the grounds that the caller had just typed
     * the value; now the caller has not seen it, and cannot.
     */
    password: issued,
    /**
     * False when the change was saved but its record was not — see
     * lib/rosterAuditLog.js. The screen says so rather than letting a gap in the
     * trail be found months later.
     */
    auditLogged,
    /** Present only when วันเกิด moved. Null otherwise, not zero. */
    recomputed,
  });
});
