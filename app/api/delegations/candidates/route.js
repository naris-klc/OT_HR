import Employee from '@/src/models/Employee.js';
import { route, json } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { publicEmployee } from '@/lib/employees.js';
import { DELEGATE_ROLES } from '@/lib/delegation.js';

/**
 * The people who may appear in a delegation form — and only them.
 *
 * `GET /api/employees` deliberately hands a manager their own 5–6 people and
 * nobody else, which is right for the roster and useless here: the person
 * covering a หัวหน้า is normally a หัวหน้า from a different department, and
 * that endpoint would never show them. Loosening it would open a whole roster
 * to answer a question about a dozen approvers.
 *
 * So this is its own list, narrow in the other direction: everybody who could
 * legally stand in (`DELEGATE_ROLES`), plus the managers whose queues can be
 * covered, and no other field than a form needs to draw an option. It goes
 * through `publicEmployee` as well, so `birthDate` cannot ride along on a
 * screen that has no business with it.
 *
 * Readable by anyone who can create a delegation. A name, a code and a
 * department for the dozen people who sign things is not roster access.
 */
export const GET = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'manager', 'hr', 'admin');

  const people = await Employee.find({
    active: true,
    role: { $in: [...new Set([...DELEGATE_ROLES, 'manager'])] },
  })
    .select('code name role department')
    .populate('department', 'code name nameTh')
    .sort({ code: 1 })
    .lean();

  const shaped = people.map((p) => publicEmployee(p, user));
  return json({
    /** Whose queue may be covered — a manager's, and only a manager's. */
    managers: shaped.filter((p) => p.role === 'manager'),
    /** Who may cover one. */
    candidates: shaped.filter((p) => DELEGATE_ROLES.includes(p.role)),
  });
});
