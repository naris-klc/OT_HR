import Employee from '@/src/models/Employee.js';
import EmployeeAudit from '@/src/models/EmployeeAudit.js';
import { route, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { rosterPermission } from '@/lib/employees.js';

/**
 * ประวัติการแก้ทะเบียน for one person.
 *
 * READ IS GATED BY THE SAME RULE AS WRITE. `rosterPermission` with this row as
 * the target, so ฝ่ายบุคคล get every ordinary row's trail and Admin's stays
 * Admin's — the same line the edit screen draws. It is not a wider audience than
 * the screen it is drawn on: a trail names who changed somebody's แผนก and
 * บทบาท, which is not a thing a colleague or a manager needs.
 *
 * A birth date can appear in it, as a `from`/`to` on the birthDate field, which
 * is the other reason this cannot be opened up: `maySeeBirthDate` allows HR,
 * Admin and the person themselves, and `rosterPermission` is strictly narrower
 * than that. No password ever appears — see lib/rosterAudit.js.
 *
 * Newest first, capped. A roster row lives as long as the person does; the
 * screen wants the recent history, and "everything since 2019" is a question for
 * whoever opens the collection.
 */
export const GET = route(async (req, { params }) => {
  const actor = await requireAuth(req);

  const employee = await Employee.findById(params.id).select('code name role').lean();
  if (!employee) return fail('ไม่พบพนักงาน', 404);

  const may = rosterPermission(actor, { target: employee });
  if (!may.ok) return fail(may.error, may.status);

  const records = await EmployeeAudit.forEmployee(employee._id, 100);

  return json({
    employee: { id: String(employee._id), code: employee.code, name: employee.name },
    records: records.map((r) => ({
      id: String(r._id),
      at: r.createdAt,
      action: r.action,
      source: r.source,
      by: r.byName || null,
      byRole: r.byRole || null,
      reason: r.reason || null,
      passwordReset: Boolean(r.passwordReset),
      // Sent as stored: strings and nulls, already narrowed to the allowlist on
      // the way in. Nothing here needs re-filtering, and a second filter that
      // could drift from the first would be the more dangerous of the two.
      changes: (r.changes || []).map((c) => ({ field: c.field, from: c.from, to: c.to })),
    })),
  });
});
