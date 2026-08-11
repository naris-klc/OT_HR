import Employee, { ROLES } from '@/src/models/Employee.js';
import { COMPANY_KEYS } from '@/src/config/companies.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { PASSWORD_MIN_LENGTH, codeChangePermission, rosterPermission } from '@/lib/employees.js';
import { rosterChanges } from '@/lib/rosterAudit.js';
import { recordRosterChange } from '@/lib/rosterAuditLog.js';
import { codeMatcher, sameCode } from '@/src/lib/employeeCode.js';
import { recomputeEntries } from '@/src/services/otService.js';
import { PENDING_STATUSES } from '@/lib/accounting.js';

export const PATCH = route(async (req, { params }) => {
  const actor = await requireAuth(req);

  const employee = await Employee.findById(params.id);
  if (!employee) return fail('ไม่พบพนักงาน', 404);

  const {
    code, name, email, position, birthDate, department, role, company, active, password, reason,
  } = await body(req);

  if (role != null && !ROLES.includes(role)) return fail('บทบาทไม่ถูกต้อง', 400);
  // Read before anything is assigned: the rule is about the row as it stands
  // and the role being asked for, not about the half-mutated document.
  const may = rosterPermission(actor, { target: employee, role: role ?? null });
  if (!may.ok) return fail(may.error, may.status);

  /**
   * รหัสพนักงาน is its own permission, on top of the one above and not folded
   * into it. `rosterPermission` answers "may this person write this row"; this
   * answers "may they change the thing the row is identified BY", and ฝ่ายบุคคล
   * get the first without the second. A payload repeating the existing code is
   * not a change — see lib/employees.js.
   */
  const codeChange = codeChangePermission(actor, { from: employee.code, to: code, reason });
  if (!codeChange.ok) return fail(codeChange.error, codeChange.status);

  if (password && String(password).length < PASSWORD_MIN_LENGTH) {
    return fail(`รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`, 400);
  }

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
  if (active != null) employee.active = Boolean(active);
  // A reset is HR issuing a password, exactly as creating the account was — so
  // it carries the same obligation to replace it. Editing anything else leaves
  // the flag alone: a corrected job title is not a reason to ask somebody for a
  // new password.
  if (password) {
    await employee.setPassword(password);
    employee.mustChangePassword = true;
  }

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
    active: employee.active,
  });
  const birthDateMoved = changes.some((c) => c.field === 'birthDate');

  await employee.save();

  const auditLogged = await recordRosterChange({
    employee,
    // A reset with nothing else changed is its own event; a reset alongside
    // edits stays one record for one request. Either way the password is a
    // boolean on the row and never a value.
    action: changes.length ? 'update' : 'password_reset',
    changes,
    passwordReset: Boolean(password),
    reason,
    actor,
  });

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
   * ONLY WHAT IS STILL IN FLIGHT. `recomputeEntries` already refuses to replay
   * an approved entry — hours somebody signed for do not move because a birth
   * date was corrected afterwards — and narrowing to the pending statuses on
   * top of that keeps the trail off rejected and cancelled rows, which nothing
   * will ever pay against and which would collect a `recompute` line each time.
   */
  let recomputed = null;
  if (birthDateMoved) {
    recomputed = await recomputeEntries(
      { employee: employee._id, status: { $in: [...PENDING_STATUSES] } },
      actor,
      { source: 'manual' },
    );
  }

  // No password echoed back, unlike create: a reset is always a password the
  // caller just typed, so there is nothing here they do not already have.
  return json({
    employee: await employee.populate('department', 'code name nameTh'),
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
