import Employee, { ROLES } from '@/src/models/Employee.js';
import { COMPANY_KEYS } from '@/src/config/companies.js';
import { route, body, query, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { defaultPassword } from '@/lib/employees.js';

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
    .populate('department', 'code name nameTh monthlyCapHours')
    .sort({ code: 1 })
    .lean();
  return json({ employees });
});

export const POST = route(async (req) => {
  requireRole(await requireAuth(req), 'admin');
  const { code, name, email, position, department, role, company, password } = await body(req);

  if (!code || !name || !department) {
    return fail('ต้องระบุรหัสพนักงาน ชื่อ-สกุล และแผนก', 400);
  }
  if (role && !ROLES.includes(role)) return fail('บทบาทไม่ถูกต้อง', 400);
  if (company && !COMPANY_KEYS.includes(company)) return fail('บริษัทไม่ถูกต้อง', 400);

  // company left out on purpose falls to the model's pre-validate hook, which
  // reads it off the code prefix.
  const employee = new Employee({
    code, name, email: email || undefined, position, department, role: role || 'employee',
    company: company || undefined,
  });
  await employee.setPassword(password || defaultPassword(code));
  await employee.save();

  return json({ employee: await employee.populate('department', 'code name nameTh') }, 201);
});
