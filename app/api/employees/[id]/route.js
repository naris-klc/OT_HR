import Employee, { ROLES } from '@/src/models/Employee.js';
import { COMPANY_KEYS } from '@/src/config/companies.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';

export const PATCH = route(async (req, { params }) => {
  requireRole(await requireAuth(req), 'admin');

  const employee = await Employee.findById(params.id);
  if (!employee) return fail('ไม่พบพนักงาน', 404);

  const { name, email, position, department, role, company, active, password } = await body(req);
  if (name != null) employee.name = name;
  if (email !== undefined) employee.email = email || undefined;
  if (position != null) employee.position = position;
  if (department != null) employee.department = department;
  if (role != null) {
    if (!ROLES.includes(role)) return fail('บทบาทไม่ถูกต้อง', 400);
    employee.role = role;
  }
  if (company != null) {
    // Moving someone between companies changes which payroll they belong to
    // from here on. Nothing already recorded is restated by it.
    if (!COMPANY_KEYS.includes(company)) return fail('บริษัทไม่ถูกต้อง', 400);
    employee.company = company;
  }
  if (active != null) employee.active = Boolean(active);
  if (password) await employee.setPassword(password);

  await employee.save();
  return json({ employee: await employee.populate('department', 'code name nameTh') });
});
