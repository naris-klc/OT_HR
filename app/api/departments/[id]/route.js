import Department from '@/src/models/Department.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { capHoursFrom } from '@/lib/caps.js';

export const PATCH = route(async (req, { params }) => {
  requireRole(await requireAuth(req), 'admin', 'hr');

  const department = await Department.findById(params.id);
  if (!department) return fail('ไม่พบแผนก', 404);

  const { name, nameTh, manager, monthlyCapHours, weeklyCapHours, active } = await body(req);
  if (name != null) department.name = name;
  if (nameTh != null) department.nameTh = nameTh;
  if (active != null) department.active = Boolean(active);
  if (manager !== undefined) department.manager = manager || null;
  // `undefined` is "not mentioned in this PATCH"; '' is "cleared". Only the
  // second one writes, and it writes null — no ceiling, not a ceiling of zero.
  if (monthlyCapHours !== undefined) department.monthlyCapHours = capHoursFrom(monthlyCapHours);
  if (weeklyCapHours !== undefined) department.weeklyCapHours = capHoursFrom(weeklyCapHours);

  await department.save();
  return json({ department });
});
