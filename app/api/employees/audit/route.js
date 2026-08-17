import Employee from '@/src/models/Employee.js';
import EmployeeAudit from '@/src/models/EmployeeAudit.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { rosterPermission } from '@/lib/employees.js';
import { AUDITED_FIELDS } from '@/lib/rosterAudit.js';

/**
 * ประวัติการแก้ทะเบียน across the whole roster — the screen for the question
 * "what has been changed lately", which the per-person trail cannot answer.
 *
 * `/api/employees/:id/audit` answers "what happened to this person" and is
 * opened from their row. This one answers "what happened at all" — the question
 * somebody asks when a report came out wrong and they do not yet know whose row
 * to look at. Same records, same append-only collection, different question.
 *
 * A static segment beside `[id]`, exactly as `/api/employees/import` already is:
 * Next matches `audit` here before it tries the dynamic route.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO SEES WHAT
 *
 * HR and Admin, by `rosterPermission` with no target — the same rule that
 * decides who may reach ทะเบียนพนักงาน at all, so a หัวหน้า or a พนักงาน is
 * refused here for the same reason they are refused there.
 *
 * For HR the Admin rows are then left out, which is `rosterPermission`'s target
 * check applied to a list instead of to one row. Without it this endpoint would
 * be the way around it: HR cannot open the Admin's trail one row at a time, so a
 * list that included it would hand over exactly what that check refuses — and
 * birth dates appear in these records as `from`/`to` values.
 *
 * Both halves read TODAY'S role, which is what `rosterPermission` reads too.
 * So promoting somebody to ผู้ดูแลระบบ hides their past roster history from HR
 * and demoting them reveals it. That is the same behaviour as the per-person
 * trail rather than a second rule, and the alternative — deciding by the role
 * stored on each record — would let HR read an Admin's row as long as it was
 * written before the promotion.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;

export const GET = route(async (req) => {
  const actor = await requireAuth(req);

  const may = rosterPermission(actor);
  if (!may.ok) return fail(may.error, may.status);

  const q = query(req);

  /**
   * WHAT THIS READER MAY SEE AT ALL, kept apart from what they asked to see.
   *
   * The screen's filters narrow `filter`; the ผู้แก้ไข dropdown is built from
   * `scope`. Building it from the narrowed filter instead would empty the
   * dropdown of every choice except the one already picked — a filter that can
   * only ever be relaxed by clearing it.
   */
  const scope = {};
  if (actor.role !== 'admin') {
    const admins = await Employee.find({ role: 'admin' }).select('_id').lean();
    if (admins.length) scope.employee = { $nin: admins.map((a) => a._id) };
  }

  const filter = { ...scope };

  if (q.employee) {
    // Narrowed to one person: the same target check their own row would get, so
    // ?employee=<the admin's id> is refused rather than filtered to nothing —
    // an empty list would read as "this account has never been edited". The
    // row check having passed, this replaces the blanket exclusion above.
    const target = await Employee.findById(q.employee).select('role').lean();
    if (!target) return fail('ไม่พบพนักงาน', 404);
    const mayRow = rosterPermission(actor, { target });
    if (!mayRow.ok) return fail(mayRow.error, mayRow.status);
    filter.employee = target._id;
  }

  if (q.action) filter.action = q.action;

  /**
   * กรองตามประเภทการแก้ไข — "show me the วันเกิด changes", which is a different
   * question from `action` and the one HR actually asks: every birth date that
   * has ever been rewritten is an 'update', and so is every แผนก move.
   *
   * Checked against the allowlist rather than passed through, so this cannot be
   * used to probe for a path the trail does not record. A record with no
   * `changes` at all — a bare ตั้งรหัสผ่านใหม่ — matches no field and drops out,
   * which is the right answer: it changed no field.
   */
  if (q.field) {
    if (!AUDITED_FIELDS.includes(q.field)) return fail('ไม่รู้จักฟิลด์ที่ขอกรอง', 400);
    filter['changes.field'] = q.field;
  }

  // กรองตามผู้แก้ไข. Shape-checked here because an id mongoose cannot cast
  // throws where a 400 belongs.
  if (q.by) {
    if (!/^[0-9a-f]{24}$/i.test(q.by)) return fail('รหัสผู้แก้ไขไม่ถูกต้อง', 400);
    filter.by = q.by;
  }

  const limit = Math.min(Number(q.limit) || DEFAULT_LIMIT, MAX_LIMIT);

  // One more than asked for, so the screen can say the list is cut off rather
  // than presenting a truncated history as the whole of it.
  const found = await EmployeeAudit.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();

  const records = found.slice(0, limit);

  /**
   * Who appears in this trail as an editor — read off the records themselves,
   * not off today's roster.
   *
   * The two lists differ in both directions and each difference matters: an
   * account that has since been deactivated, or dropped from HR, still made the
   * edits it made and must remain selectable; a newly appointed HR account that
   * has changed nothing would otherwise sit in the dropdown offering an
   * always-empty result.
   *
   * The name is the one stored on the record (`byName`), for the reason the
   * model denormalises it. `$last` under a `createdAt` sort takes the newest
   * spelling, so a renamed account appears once rather than twice.
   */
  const actors = (await EmployeeAudit.aggregate([
    { $match: { ...scope, by: { $ne: null } } },
    { $sort: { createdAt: 1 } },
    { $group: { _id: '$by', name: { $last: '$byName' }, role: { $last: '$byRole' } } },
    { $sort: { name: 1 } },
  ])).map((a) => ({ id: String(a._id), name: a.name || null, role: a.role || null }));

  return json({
    hasMore: found.length > limit,
    actors,
    records: records.map((r) => ({
      id: String(r._id),
      at: r.createdAt,
      // The row this is about. `employeeCode`/`employeeName` are the copies
      // taken when the record was written — see src/models/EmployeeAudit.js:
      // the code itself is editable, so resolving the pointer to print it would
      // relabel the very record that documents a renumbering. The id rides
      // along so the screen can still link to today's row.
      employee: {
        id: r.employee ? String(r.employee) : null,
        code: r.employeeCode || null,
        name: r.employeeName || null,
      },
      action: r.action,
      source: r.source,
      by: r.byName || null,
      byRole: r.byRole || null,
      reason: r.reason || null,
      passwordReset: Boolean(r.passwordReset),
      // As stored — already narrowed to the allowlist on the way in, and a
      // second filter here could only drift from the first.
      changes: (r.changes || []).map((c) => ({ field: c.field, from: c.from, to: c.to })),
    })),
  });
});
