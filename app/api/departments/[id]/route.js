import Department from '@/src/models/Department.js';
import Employee from '@/src/models/Employee.js';
import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import {
  DEPARTMENT_ROLES,
  departmentDeleteBlock,
  departmentDeletePermission,
  departmentPermission,
} from '@/lib/departments.js';
import { capHoursFrom } from '@/lib/caps.js';
import { otModeFrom } from '@/lib/otMode.js';

/**
 * WHAT POINTS AT THIS DEPARTMENT — counted, not guessed.
 *
 * One helper for the two handlers that need the answer, so the question the
 * screen asks and the question the delete answers are the same query. Both
 * counts are ALL-TIME on purpose: see `departmentDeleteBlock`, which is where
 * that decision is written down.
 */
async function referencesTo(id) {
  const [employees, entries] = await Promise.all([
    Employee.countDocuments({ department: id }),
    OtEntry.countDocuments({ department: id }),
  ]);
  return { employees, entries };
}

/**
 * One department, and whether anything is holding it.
 *
 * Added 2026-09-02 with ลบแผนก. The screen has to know BEFORE it offers to
 * delete — pressing ลบแผนก and being told "no" by a confirmation dialog that
 * has already asked "are you sure?" is a dialog apologising for its own
 * question. `headcount` on the list endpoint cannot answer it: that is a count
 * of ACTIVE employees, and a department whose whole team was deactivated last
 * year reads zero there while still being referenced by every one of them.
 */
export const GET = route(async (req, { params }) => {
  const actor = await requireAuth(req);
  if (!DEPARTMENT_ROLES.includes(actor.role)) return fail('ไม่มีสิทธิ์ใช้งานส่วนนี้', 403);

  const department = await Department.findById(params.id)
    .populate('manager', 'code name').lean();
  if (!department) return fail('ไม่พบแผนก', 404);

  const references = await referencesTo(department._id);
  const block = departmentDeleteBlock(references);
  return json({
    department,
    references,
    // The rule's own answer rather than a re-derivation of it beside the
    // counts, which is how a screen ends up disagreeing with the route.
    deletable: !block,
    blockReason: block?.error || null,
  });
});

export const PATCH = route(async (req, { params }) => {
  const actor = await requireAuth(req);

  const department = await Department.findById(params.id);
  if (!department) return fail('ไม่พบแผนก', 404);

  const {
    code, name, nameTh, manager, monthlyCapHours, weeklyCapHours, active, otMode,
  } = await body(req);

  /**
   * Asked BEFORE a single field is assigned, and asked about the row as it
   * STANDS — the same placement and the same reason as the roster route's
   * `rosterPermission`. `departmentPermission` decides whether `active` is
   * actually MOVING by comparing what was sent against what is stored, which a
   * half-mutated document can no longer answer.
   *
   * One check for the whole handler rather than a guard beside the `active`
   * assignment forty lines down: a refusal issued there would already have
   * rewritten ชื่อ, รหัส and both ceilings on the in-memory document, and the
   * next `save()` from any source would carry them.
   */
  const may = departmentPermission(actor, { active, current: department.active });
  if (!may.ok) return fail(may.error, may.status);

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

/**
 * ลบแผนก — AND ONLY A ROW NOTHING POINTS AT.
 *
 * This handler did not exist until 2026-09-02, and the comment where the rule
 * now lives (lib/departments.js) says why it did not and what changed. The
 * short of it: the objection was never to deleting a department, it was to
 * deleting one that entries name — those entries lose their แผนก for good, into
 * a single unnamed bucket shared with every other department ever deleted. A
 * row created with a typo and never used costs none of that, and the blanket
 * refusal could not tell the two apart.
 *
 * THE COUNT IS DONE HERE, AGAIN, AND THAT IS THE POINT. The screen already
 * asked through `GET` above, and its answer is a fact about a moment that has
 * passed: somebody may have been moved into this department while the dialog
 * was open. A guard that runs only on the screen is a guard that is off for
 * anybody holding a stale page or a `curl`.
 *
 * `deleteOne` on the document rather than `findByIdAndDelete(params.id)`, so
 * the thing deleted is the row that was just counted and not a second lookup of
 * the same id — which is the shape a check-then-act race takes when it is
 * written the other way.
 */
export const DELETE = route(async (req, { params }) => {
  const may = departmentDeletePermission(await requireAuth(req));
  if (!may.ok) return fail(may.error, may.status);

  const department = await Department.findById(params.id);
  if (!department) return fail('ไม่พบแผนก', 404);

  const block = departmentDeleteBlock(await referencesTo(department._id));
  if (block) return fail(block.error, block.status, {
    employees: block.employees,
    entries: block.entries,
  });

  await department.deleteOne();
  // The row is gone, so the response says which one it was rather than handing
  // back a document the caller can no longer look up.
  return json({ deleted: { _id: department._id, code: department.code, name: department.nameTh || department.name } });
});
