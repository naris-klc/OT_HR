import Employee, { ROLES } from '@/src/models/Employee.js';
import { COMPANY_KEYS } from '@/src/config/companies.js';
import { route, body, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import {
  PASSWORD_MIN_LENGTH, defaultPassword, publicEmployee, rosterPermission,
} from '@/lib/employees.js';
import { rosterChanges } from '@/lib/rosterAudit.js';
import { recordRosterChange } from '@/lib/rosterAuditLog.js';

export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const q = query(req);
  const filter = {};

  // A manager only ever needs their own 5–6 people (§9).
  if (user.role === 'manager') filter.department = user.department?._id;
  else if (user.role === 'employee') filter._id = user._id;
  if (q.department && ['hr', 'admin'].includes(user.role)) filter.department = q.department;
  if (q.company) filter.company = q.company;
  if (!q.all) filter.active = true;

  const employees = await Employee.find(filter)
    .populate('department', 'code name nameTh monthlyCapHours weeklyCapHours')
    .sort({ code: 1 })
    .lean();
  // `.lean()` hands back the whole document, birthDate included. A manager
  // listing their department must not receive their team's dates of birth.
  return json({ employees: employees.map((e) => publicEmployee(e, user)) });
});

export const POST = route(async (req) => {
  const actor = await requireAuth(req);
  const { code, name, email, position, birthDate, department, role, company, password } = await body(req);

  if (!code || !name || !department) {
    return fail('ต้องระบุรหัสพนักงาน ชื่อ-สกุล และแผนก', 400);
  }
  if (role && !ROLES.includes(role)) return fail('บทบาทไม่ถูกต้อง', 400);
  if (company && !COMPANY_KEYS.includes(company)) return fail('บริษัทไม่ถูกต้อง', 400);

  // ฝ่ายบุคคล owns the roster; Admin still owns who may administer the system.
  const may = rosterPermission(actor, { role: role || 'employee' });
  if (!may.ok) return fail(may.error, may.status);

  // A password HR types is one they are about to read out, so the only check it
  // gets is the one the employee's own change is held to. Left blank it becomes
  // defaultPassword(), which is longer than this anyway.
  if (password && String(password).length < PASSWORD_MIN_LENGTH) {
    return fail(`รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`, 400);
  }

  // company left out on purpose falls to the model's pre-validate hook, which
  // reads it off the code prefix.
  const employee = new Employee({
    code, name, email: email || undefined, position, department, role: role || 'employee',
    company: company || undefined,
    // Optional. An empty string must become undefined, not '', or the schema's
    // YYYY-MM-DD match rejects the whole save.
    birthDate: birthDate || undefined,
  });
  const issued = password || defaultPassword(code);
  await employee.setPassword(issued);
  // Somebody else knows this password — it is not the employee's until they
  // have replaced it, and until then the client will not let the account
  // anywhere else.
  employee.mustChangePassword = true;
  await employee.save();

  /**
   * The row's first record — every field it was created with, as a change from
   * nothing.
   *
   * Diffed against `{}` rather than written by hand, so a create and an edit
   * produce the same shape and the same allowlist decides both. A field added
   * to AUDITED_FIELDS is then covered here without this line being touched, and
   * one that must never be recorded stays out of both.
   *
   * `passwordReset` is deliberately NOT set: an account whose password was
   * issued at creation is what 'create' already means, and flagging it too
   * would make every new hire look like somebody who had forgotten theirs.
   */
  const auditLogged = await recordRosterChange({
    employee,
    action: 'create',
    changes: rosterChanges({}, {
      code: employee.code,
      name: employee.name,
      email: employee.email,
      position: employee.position,
      birthDate: employee.birthDate,
      department: employee.department,
      role: employee.role,
      company: employee.company,
      active: employee.active,
    }),
    actor,
  });

  // The issued password comes back so the screen that created the account can
  // show HR what to hand over. It is never readable again: only the hash is
  // stored, and every roster read goes through publicEmployee().
  return json({
    employee: await employee.populate('department', 'code name nameTh'),
    password: issued,
    auditLogged,
  }, 201);
});
