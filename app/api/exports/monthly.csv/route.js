import OtEntry from '@/src/models/OtEntry.js';
import Setting from '@/src/models/Setting.js';
import { route, query, csvResponse, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { BUCKETS, summariseEntries, hrSummary } from '@/src/lib/otEngine.js';
import { toCsv } from '@/src/lib/csv.js';

/** One row per employee per month — the shape HR actually reviews. */
export const GET = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'hr', 'admin', 'manager');
  const q = query(req);

  const period = q.period;
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) {
    return fail('ต้องระบุ period เป็น YYYY-MM', 400);
  }

  const policy = await Setting.effectivePolicy();
  const filter = { period, status: { $in: String(q.status || 'approved').split(',') } };
  if (user.role === 'manager') filter.department = user.department?._id;
  else if (q.department) filter.department = q.department;

  const entries = await OtEntry.find(filter)
    .populate('employee', 'code name position')
    .populate('department', 'code name nameTh monthlyCapHours')
    .lean();

  const grouped = new Map();
  for (const e of entries) {
    const key = String(e.employee?._id);
    if (!grouped.has(key)) grouped.set(key, { employee: e.employee, department: e.department, list: [] });
    grouped.get(key).list.push(e);
  }

  const multiplied = policy.hrSummaryBasis === 'multiplied';
  const headers = [
    'รหัสพนักงาน', 'ชื่อ-สกุล', 'แผนก', 'ประจำเดือน',
    'OT วันปกติ (x1.5)', 'OT วันหยุด 8-17 (x1.5)', 'OT วันหยุด นอกเวลา (x3)',
    `OT x1.5 (${multiplied ? 'คูณแล้ว' : 'ชั่วโมงดิบ'})`,
    `OT x3 (${multiplied ? 'คูณแล้ว' : 'ชั่วโมงดิบ'})`,
    'รวม', 'จำนวนรายการ', 'เพดานแผนก', 'ใช้ไป',
  ];

  const rows = [...grouped.values()]
    .sort((a, b) => String(a.employee?.code).localeCompare(String(b.employee?.code)))
    .map((g) => {
      const s = summariseEntries(g.list);
      const hr = hrSummary(s, policy);
      return [
        g.employee?.code,
        g.employee?.name,
        g.department?.nameTh || g.department?.name,
        period,
        fmt(s.buckets[BUCKETS.OT15_WEEKDAY]),
        fmt(s.buckets[BUCKETS.OT15_HOLIDAY]),
        fmt(s.buckets[BUCKETS.OT3_HOLIDAY]),
        fmt(hr.ot15),
        fmt(hr.ot3),
        fmt(hr.total),
        g.list.length,
        g.department?.monthlyCapHours ?? 'ไม่กำหนด',
        fmt(policy.capBasis === 'weighted' ? s.weightedHours : s.otHours),
      ];
    });

  return csvResponse(`OT-monthly-${period}.csv`, toCsv(headers, rows));
});

const fmt = (n) => (n == null ? '' : String(Math.round(Number(n) * 100) / 100));
