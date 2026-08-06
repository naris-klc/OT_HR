import OtEntry from '@/src/models/OtEntry.js';
import Setting from '@/src/models/Setting.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { summariseEntries, hrSummary, capUsage } from '@/src/lib/otEngine.js';
import { PERIOD_RE } from '@/lib/reports.js';

/** HR's monthly review: every employee's totals for a period, in one table. */
export const GET = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const { period } = params;
  if (!PERIOD_RE.test(period)) return fail('ประจำเดือนต้องเป็นรูปแบบ YYYY-MM', 400);
  if (!['hr', 'admin', 'manager'].includes(user.role)) {
    return fail('ไม่มีสิทธิ์ใช้งานส่วนนี้', 403);
  }

  const q = query(req);
  const policy = await Setting.effectivePolicy();
  const filter = { period };
  if (user.role === 'manager') filter.department = user.department?._id;
  else if (q.department) filter.department = q.department;
  filter.status = { $in: String(q.status || 'approved,pending_hr,pending_mgr').split(',') };

  const entries = await OtEntry.find(filter)
    .populate('employee', 'code name position')
    .populate('department', 'code name nameTh monthlyCapHours')
    .lean();

  const byEmployee = new Map();
  for (const entry of entries) {
    const key = String(entry.employee?._id);
    if (!byEmployee.has(key)) {
      byEmployee.set(key, { employee: entry.employee, department: entry.department, entries: [] });
    }
    byEmployee.get(key).entries.push(entry);
  }

  const employees = [...byEmployee.values()].map((group) => {
    const summary = summariseEntries(group.entries);
    const capHours = group.department?.monthlyCapHours ?? null;
    const used = capUsage(summary, policy);
    return {
      employee: group.employee,
      department: group.department,
      entryCount: group.entries.length,
      pendingCount: group.entries.filter((e) => e.status !== 'approved').length,
      summary,
      hrSection: hrSummary(summary, policy),
      cap: { capHours, usedHours: used, exceeded: capHours != null && used > capHours, basis: policy.capBasis },
    };
  }).sort((a, b) => a.employee.code.localeCompare(b.employee.code));

  const grand = summariseEntries(entries);
  return json({ period, employees, grandTotal: grand, hrSection: hrSummary(grand, policy) });
});
