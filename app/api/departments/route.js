import Department from '@/src/models/Department.js';
import Employee from '@/src/models/Employee.js';
import { route, body, query, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { capHoursFrom } from '@/lib/caps.js';

export const GET = route(async (req) => {
  await requireAuth(req);
  const { all } = query(req);

  const departments = await Department.find(all ? {} : { active: true })
    .populate('manager', 'code name')
    .sort({ code: 1 })
    .lean();

  const counts = await Employee.aggregate([
    { $match: { active: true } },
    { $group: { _id: '$department', headcount: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.headcount]));

  return json({
    departments: departments.map((d) => ({ ...d, headcount: byId.get(String(d._id)) || 0 })),
  });
});

export const POST = route(async (req) => {
  requireRole(await requireAuth(req), 'admin');
  const { code, name, nameTh, manager, monthlyCapHours, weeklyCapHours } = await body(req);
  if (!code || !name) return fail('ต้องระบุรหัสและชื่อแผนก', 400);

  const department = await Department.create({
    code, name, nameTh,
    manager: manager || null,
    // §7: caps are per-department and OPTIONAL. Empty means no cap, which is
    // not the same as a cap of 0 — see `capHoursFrom`.
    monthlyCapHours: capHoursFrom(monthlyCapHours),
    weeklyCapHours: capHoursFrom(weeklyCapHours),
  });
  return json({ department }, 201);
});
