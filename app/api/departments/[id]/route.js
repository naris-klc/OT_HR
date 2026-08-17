import Department from '@/src/models/Department.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { capHoursFrom } from '@/lib/caps.js';
import { otModeFrom } from '@/lib/otMode.js';

export const PATCH = route(async (req, { params }) => {
  requireRole(await requireAuth(req), 'admin', 'hr');

  const department = await Department.findById(params.id);
  if (!department) return fail('ไม่พบแผนก', 404);

  const {
    code, name, nameTh, manager, monthlyCapHours, weeklyCapHours, active, otMode,
  } = await body(req);

  /**
   * รหัสแผนก, which used to be unchangeable — not refused, simply absent from
   * this handler, so a code typed wrong when the row was created was permanent.
   *
   * Nothing about the hours moves when it changes: employees and entries point
   * at the row by id, and every report resolves the label from the row at the
   * moment it is drawn. What the code IS load-bearing for is the roster CSV,
   * which matches its แผนก column against it (app/api/employees/import) — a file
   * still carrying the old code stops matching, and says so per row rather than
   * quietly filing anybody in the wrong team.
   *
   * Checked against the index's own rule — trimmed and upper-cased, as the
   * schema stores it — so the refusal names the department already holding it
   * instead of surfacing as a duplicate-key error.
   */
  if (code != null) {
    const wanted = String(code).trim().toUpperCase();
    if (!wanted) return fail('รหัสแผนกว่างไม่ได้', 400);
    if (wanted !== department.code) {
      const clash = await Department.findOne({ code: wanted, _id: { $ne: department._id } })
        .select('code name nameTh').lean();
      if (clash) {
        return fail(`รหัส "${clash.code}" ถูกใช้อยู่แล้วโดยแผนก ${clash.nameTh || clash.name}`, 409);
      }
      department.code = wanted;
    }
  }
  if (name != null) department.name = name;
  if (nameTh != null) department.nameTh = nameTh;
  if (active != null) department.active = Boolean(active);
  if (manager !== undefined) department.manager = manager || null;
  // `undefined` is "not mentioned in this PATCH"; '' is "cleared". Only the
  // second one writes, and it writes null — no ceiling, not a ceiling of zero.
  if (monthlyCapHours !== undefined) department.monthlyCapHours = capHoursFrom(monthlyCapHours);
  if (weeklyCapHours !== undefined) department.weeklyCapHours = capHoursFrom(weeklyCapHours);
  // Same `undefined` rule as the ceilings above, and the same refusal the
  // create route makes: a value that is not a mode is a 400, never a silent
  // fall back to "this department does ordinary OT".
  if (otMode !== undefined) {
    const mode = otModeFrom(otMode);
    if (mode === null) return fail('รูปแบบโอทีของแผนกไม่ถูกต้อง', 400);
    department.otMode = mode;
  }

  await department.save();
  return json({ department });
});
