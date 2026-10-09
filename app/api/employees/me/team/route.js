import Employee from '@/src/models/Employee.js';
import Department from '@/src/models/Department.js';
import { isSigner } from '@/lib/roles.js';
import { route, json } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { deptReach, idOf } from '@/lib/entries.js';
import { compareCodes } from '@/src/lib/employeeCode.js';

/**
 * ผู้ใต้บังคับบัญชาที่อนุมัติ — the people whose first step the CALLER signs,
 * for the card at the foot of ข้อมูลส่วนตัว (แบบ C, grouped by แผนก, agreed
 * 2026-10-09).
 *
 * Two halves, the same two the queue reads: everybody who names the caller
 * one by one (`personalApprovers`), and everybody reached through the แผนก
 * they hold (`deptReach`). Read-only and about the caller alone, so it needs
 * no permission beyond being signed in; somebody who signs nothing gets `[]`.
 *
 * Not a delegation's borrowed reach: a stand-in signs for somebody else's
 * team for a while, and this card answers whose หัวหน้า the caller IS.
 */
export const GET = route(async (req) => {
  const user = await requireAuth(req);
  if (!isSigner(user.role)) return json({ people: [] });

  // The stored row, not the session's copy: the grant is `approvesDepartments`
  // and `approvesCompany`, which the session does not have to carry.
  const me = await Employee.findById(user._id).lean();
  if (!me || me.active === false) return json({ people: [] });

  const [roster, depts] = await Promise.all([
    Employee.find({ active: { $ne: false } })
      .select('code name position role company department personalApprovers active').lean(),
    Department.find({}).select('code name nameTh signedByHr').lean(),
  ]);
  const mine = String(me._id);
  const named = roster.filter((p) => String(p._id) !== mine
    && (p.personalApprovers || []).some((a) => String(a) === mine));
  const viaDept = deptReach(me, roster, depts, named.map((p) => String(p._id)));

  const deptName = new Map(depts.map((d) => [idOf(d), d.nameTh || d.name || d.code]));
  const people = [
    ...named.map((p) => ({ p, via: 'named' })),
    ...viaDept.map((p) => ({ p, via: 'dept' })),
  ].map(({ p, via }) => ({
    id: String(p._id),
    code: p.code,
    name: p.name,
    position: p.position || '',
    company: p.company,
    department: deptName.get(idOf(p.department)) || '',
    via,
  })).sort((a, b) => a.department.localeCompare(b.department, 'th') || compareCodes(a.code, b.code));

  return json({ people });
});
