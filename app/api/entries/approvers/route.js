import Employee from '@/src/models/Employee.js';
import { SIGNER_ROLES } from '@/lib/roles.js';
import ApprovalDelegation from '@/src/models/ApprovalDelegation.js';
import { route, json } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { isDepartmentManager } from '@/lib/entries.js';
import { companyOf } from '@/src/config/companies.js';
import { isLive } from '@/lib/delegation.js';
import { today } from '@/lib/today.js';

/**
 * WHO WOULD SIGN THE CALLER'S NEXT REQUEST — for the line under the status chip
 * on OT ของฉัน.
 *
 * A READ, ABOUT THE CALLER, AND NOTHING ELSE. It takes no parameters: an
 * endpoint that answered "who signs for employee X" would be a way to walk the
 * reporting line of the whole company from any account, which is not a question
 * this screen asks. The department and the บริษัท come off the session.
 *
 * `isDepartmentManager` rather than a rule written here, because this has to
 * agree with the approve route — the same function `unsignedStaff` in
 * lib/employees.js consults when it refuses a roster save that would strand
 * somebody. Two readings of "who may sign" is exactly how a screen comes to
 * name a person the server then refuses.
 *
 * AN EMPTY `people` IS AN ANSWER, not a failure. ADM has no หัวหน้า at all, and
 * a narrowed เซ็นให้บริษัท can leave one company's staff in a mixed department
 * with nobody. The screen says so; before this, such a request sat at
 * รอหัวหน้า indefinitely with nothing anywhere explaining it.
 */
export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const departmentId = user.department?._id || user.department;
  if (!departmentId) return json({ departmentId: null, people: [] });

  const company = companyOf(user);

  /**
   * Everybody who might sign for this department — the ones IN it, and the ones
   * ticked into it from elsewhere (`approvesDepartments`).
   *
   * The `$or` is the query half of `approvalDepartments`, and it has to be here
   * rather than left to the filter below: this is a database read, and a
   * หัวหน้า in ผลิต covering สำนักงาน is simply not in the result set of a query
   * asking for สำนักงาน's members. Without it the employee's own
   * ที่ใบนี้ค้างอยู่ตรงไหน line would say nobody can sign their request while the
   * approve route accepted it from exactly that person — the screen and the
   * server disagreeing about who has authority, which is what this route exists
   * to stop.
   */
  const managers = await Employee.find({
    $or: [{ department: departmentId }, { approvesDepartments: departmentId }],
    role: { $in: SIGNER_ROLES },
    active: { $ne: false },
  }).select('code name position role department company approvesCompany approvesDepartments').lean();

  const eligible = managers.filter((m) => isDepartmentManager(m, departmentId, company));

  /**
   * And whoever is standing in for them today.
   *
   * The stand-in is listed BESIDE the manager rather than instead of them: a
   * delegation does not take the หัวหน้า's own queue away, so both can press the
   * button and naming only one would send somebody to the wrong desk. `isLive`
   * is the same predicate the approval path uses, revocation included.
   */
  const day = today();
  const delegations = eligible.length
    ? await ApprovalDelegation.find({ from: { $in: eligible.map((m) => m._id) } })
      .populate({ path: 'to', select: 'name position active' })
      .select('from to fromDate toDate revokedAt')
      .lean()
    : [];

  const people = eligible.map((m) => ({
    code: m.code,
    name: m.name,
    position: m.position || null,
    standInFor: null,
  }));

  for (const d of delegations) {
    if (!isLive(d, day)) continue;
    if (!d.to?.name || d.to.active === false) continue;
    const from = eligible.find((m) => String(m._id) === String(d.from));
    if (!from) continue;
    people.push({
      code: null,
      name: d.to.name,
      position: d.to.position || null,
      standInFor: from.name,
    });
  }

  return json({ departmentId: String(departmentId), people });
});
