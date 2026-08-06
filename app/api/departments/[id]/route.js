import Department from '@/src/models/Department.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';

export const PATCH = route(async (req, { params }) => {
  requireRole(await requireAuth(req), 'admin', 'hr');

  const department = await Department.findById(params.id);
  if (!department) return fail('ไม่พบแผนก', 404);

  const { name, nameTh, manager, monthlyCapHours, active } = await body(req);
  if (name != null) department.name = name;
  if (nameTh != null) department.nameTh = nameTh;
  if (active != null) department.active = Boolean(active);
  if (manager !== undefined) department.manager = manager || null;
  if (monthlyCapHours !== undefined) {
    department.monthlyCapHours =
      monthlyCapHours === '' || monthlyCapHours == null ? null : Number(monthlyCapHours);
  }

  await department.save();
  return json({ department });
});
