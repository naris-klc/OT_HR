import Department from '@/src/models/Department.js';
import Employee from '@/src/models/Employee.js';
import { route, body, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { departmentPermission } from '@/lib/departments.js';
import { capHoursFrom } from '@/lib/caps.js';
import { otModeFrom } from '@/lib/otMode.js';

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

/**
 * ฝ่ายบุคคล AND ผู้ดูแลระบบ. It was Admin's alone from the first commit, with no
 * comment saying why and no commit deciding it — while `PATCH` next door had
 * always been open to HR, so the shipped split let HR rename, renumber, re-cap
 * and switch OFF a department but not add one, and the screen offered them the
 * button regardless.
 *
 * `active` is deliberately not in the payload below and not a field this handler
 * accepts: a new department is active, and turning one off is ผู้ดูแลระบบ's —
 * see `departmentPermission` for why that one field is where the line is drawn.
 */
export const POST = route(async (req) => {
  const may = departmentPermission(await requireAuth(req));
  if (!may.ok) return fail(may.error, may.status);
  const {
    code, name, nameTh, manager, monthlyCapHours, weeklyCapHours, otMode, signedByHr,
  } = await body(req);
  if (!code || !name) return fail('ต้องระบุรหัสและชื่อแผนก', 400);

  // Refused rather than defaulted — see `otModeFrom`. A department created
  // with a mode nobody recognises would read as an ordinary one.
  const mode = otModeFrom(otMode);
  if (mode === null) return fail('รูปแบบโอทีของแผนกไม่ถูกต้อง', 400);

  const department = await Department.create({
    code, name, nameTh,
    manager: manager || null,
    // §7: caps are per-department and OPTIONAL. Empty means no cap, which is
    // not the same as a cap of 0 — see `capHoursFrom`.
    monthlyCapHours: capHoursFrom(monthlyCapHours),
    weeklyCapHours: capHoursFrom(weeklyCapHours),
    otMode: mode,
    // ฝ่ายบุคคลเป็นหัวหน้างานของแผนกนี้ — see `signedByHr` on the model. A
    // plain Boolean and not `otModeFrom`'s refuse-the-unknown treatment: there
    // are two answers and anything that is not the true one is the false one,
    // which is also what the schema default says.
    signedByHr: Boolean(signedByHr),
  });
  return json({ department }, 201);
});
