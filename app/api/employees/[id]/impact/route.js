import Employee from '@/src/models/Employee.js';
import OtEntry from '@/src/models/OtEntry.js';
import { COMPANY_KEYS, companyOf } from '@/src/config/companies.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { rosterPermission } from '@/lib/employees.js';
import { ACCOUNTING_STATUSES } from '@/lib/accounting.js';
import { companyMoveImpact } from '@/lib/rosterImpact.js';

/**
 * "How much would this restate?" — asked by the edit dialog before it saves, for
 * the one roster field whose answer is not zero.
 *
 * ONLY บริษัท. See lib/rosterImpact.js for why แผนก and บทบาท have no number
 * here: the entry carries its own department, and the accounting sheet is built
 * entries-first so the role filter only adds blank lines. A count for either
 * would be a warning that is not true.
 *
 * GATED BY THE SAME RULE AS THE EDIT. `rosterPermission` with this row as the
 * target — this endpoint answers a question about somebody's whole OT history
 * (how many months, how many hours), and that is not a wider audience than the
 * screen the question is asked from.
 *
 * Nothing is written and nothing is decided here. The dialog uses this to print
 * a sentence; the save that follows goes through PATCH /api/employees/:id, which
 * checks the same permission again.
 */
export const GET = route(async (req, { params }) => {
  const actor = await requireAuth(req);

  const employee = await Employee.findById(params.id).select('code name role company').lean();
  if (!employee) return fail('ไม่พบพนักงาน', 404);

  const may = rosterPermission(actor, { target: employee });
  if (!may.ok) return fail(may.error, may.status);

  const q = query(req);
  const to = q.company || null;
  if (to && !COMPANY_KEYS.includes(to)) return fail('บริษัทไม่ถูกต้อง', 400);

  /**
   * The company they are filed under NOW, resolved the way the sheet resolves it
   * — stored field, then code prefix, then default.
   *
   * Not `employee.company`, which is blank for every row written before
   * `npm run migrate:company`. Filling that blank in with the value the prefix
   * was already producing changes no report, and a dialog that announced
   * "ทุกเดือนย้อนหลังจะย้ายไฟล์" for it would be crying wolf on the one warning
   * that must be believed.
   */
  const from = companyOf(employee);
  const moved = Boolean(to) && to !== from;

  /**
   * Approved only — `ACCOUNTING_STATUSES`, the same filter สรุป OT ส่งบัญชี uses.
   * Pending hours are not on anybody's sheet yet, so counting them would inflate
   * a warning whose whole claim is that these figures have already gone out.
   */
  const entries = moved
    ? await OtEntry.find({
      employee: employee._id,
      status: { $in: [...ACCOUNTING_STATUSES] },
    }).select('period totals.otHours').lean()
    : [];

  return json({
    employee: { id: String(employee._id), code: employee.code, name: employee.name },
    company: { from, to, moved, ...companyMoveImpact(entries) },
  });
});
