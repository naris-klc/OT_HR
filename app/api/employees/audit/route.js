import Employee from '@/src/models/Employee.js';
import EmployeeAudit from '@/src/models/EmployeeAudit.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { rosterPermission } from '@/lib/employees.js';

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
  const filter = {};

  if (q.employee) {
    // Narrowed to one person: the same target check their own row would get, so
    // ?employee=<the admin's id> is refused rather than filtered to nothing —
    // an empty list would read as "this account has never been edited".
    const target = await Employee.findById(q.employee).select('role').lean();
    if (!target) return fail('ไม่พบพนักงาน', 404);
    const mayRow = rosterPermission(actor, { target });
    if (!mayRow.ok) return fail(mayRow.error, mayRow.status);
    filter.employee = target._id;
  } else if (actor.role !== 'admin') {
    const admins = await Employee.find({ role: 'admin' }).select('_id').lean();
    if (admins.length) filter.employee = { $nin: admins.map((a) => a._id) };
  }

  if (q.action) filter.action = q.action;

  const limit = Math.min(Number(q.limit) || DEFAULT_LIMIT, MAX_LIMIT);

  // One more than asked for, so the screen can say the list is cut off rather
  // than presenting a truncated history as the whole of it.
  const found = await EmployeeAudit.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();

  const records = found.slice(0, limit);

  return json({
    hasMore: found.length > limit,
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
