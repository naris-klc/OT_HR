import Employee from '@/src/models/Employee.js';
import OtEntry from '@/src/models/OtEntry.js';
import { COMPANY_KEYS, companyOf } from '@/src/config/companies.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { rosterPermission } from '@/lib/employees.js';
import { ACCOUNTING_STATUSES } from '@/lib/accounting.js';
import { moveImpact } from '@/lib/rosterImpact.js';

/**
 * "How much would this restate?" — asked by the edit dialog before it saves, for
 * the roster fields whose answer is not zero.
 *
 * บริษัท AND, SINCE 2026-09-08, แผนก. See lib/rosterImpact.js: the reports moved
 * to สังกัดหลัก that day, so today's department decides which department every
 * month ever filed is counted under — the property บริษัท always had. บทบาท
 * still has no number here and should not get one: the accounting sheet is built
 * entries-first, so the roster filter only adds blank lines and a count that is
 * always zero is a warning people learn to click past.
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

  const employee = await Employee.findById(params.id)
    .select('code name role company department')
    .lean();
  if (!employee) return fail('ไม่พบพนักงาน', 404);

  const may = rosterPermission(actor, { target: employee });
  if (!may.ok) return fail(may.error, may.status);

  const q = query(req);
  const to = q.company || null;
  if (to && !COMPANY_KEYS.includes(to)) return fail('บริษัทไม่ถูกต้อง', 400);

  /**
   * The department half. No membership list to validate against — a แผนก id is
   * whatever the dialog's own dropdown offered, and a value that does not exist
   * is refused by the PATCH that follows, not by a question about it. What is
   * checked is only whether it MOVED, because an unchanged field restates
   * nothing and must not produce a red dialog.
   */
  const deptFrom = employee.department ? String(employee.department) : null;
  const deptTo = q.department || null;
  const deptMoved = Boolean(deptTo) && deptTo !== deptFrom;

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
  /**
   * ONE QUERY FOR BOTH MOVES, because both restate the same rows: every approved
   * entry this person has. Read once when either field moved, and handed to
   * `moveImpact` twice — two counts of the same list would be two round trips to
   * say the same number.
   */
  const entries = moved || deptMoved
    ? await OtEntry.find({
      employee: employee._id,
      status: { $in: [...ACCOUNTING_STATUSES] },
    }).select('period totals.otHours').lean()
    : [];

  const counted = moveImpact(entries);
  /** Nought for the half that did not move — the dialog prints the size, so it
      must not be handed the other field's. */
  const none = moveImpact([]);

  return json({
    employee: { id: String(employee._id), code: employee.code, name: employee.name },
    company: { from, to, moved, ...(moved ? counted : none) },
    department: {
      from: deptFrom, to: deptTo, moved: deptMoved, ...(deptMoved ? counted : none),
    },
  });
});
