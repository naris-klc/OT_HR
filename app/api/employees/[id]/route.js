import Employee, { ROLES } from '@/src/models/Employee.js';
import { COMPANY_KEYS } from '@/src/config/companies.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { PASSWORD_MIN_LENGTH, rosterPermission } from '@/lib/employees.js';

export const PATCH = route(async (req, { params }) => {
  const actor = await requireAuth(req);

  const employee = await Employee.findById(params.id);
  if (!employee) return fail('ไม่พบพนักงาน', 404);

  const { name, email, position, birthDate, department, role, company, active, password } = await body(req);

  if (role != null && !ROLES.includes(role)) return fail('บทบาทไม่ถูกต้อง', 400);
  // Read before anything is assigned: the rule is about the row as it stands
  // and the role being asked for, not about the half-mutated document.
  const may = rosterPermission(actor, { target: employee, role: role ?? null });
  if (!may.ok) return fail(may.error, may.status);
  if (password && String(password).length < PASSWORD_MIN_LENGTH) {
    return fail(`รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`, 400);
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
    // from here on. Nothing already recorded is restated by it.
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

  await employee.save();
  // No password echoed back, unlike create: a reset is always a password the
  // caller just typed, so there is nothing here they do not already have.
  return json({ employee: await employee.populate('department', 'code name nameTh') });
});
