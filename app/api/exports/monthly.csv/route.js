import OtEntry from '@/src/models/OtEntry.js';
import Setting from '@/src/models/Setting.js';
import { route, query, csvResponse, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { BUCKETS, summariseEntries, hrSummary } from '@/src/lib/otEngine.js';
import { toCsv } from '@/src/lib/csv.js';
import { latestPerSession, reportStatuses } from '@/lib/reports.js';
import { capColumn } from '@/lib/caps.js';
import { capEntriesByEmployee } from '@/src/services/otService.js';
import { companyOf } from '@/src/config/companies.js';
import { approvalDepartments, signsForCompany } from '@/lib/entries.js';

/** One row per employee per month — the shape HR actually reviews. */
export const GET = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'hr', 'admin', 'manager');
  const q = query(req);

  const period = q.period;
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) {
    return fail('ต้องระบุ period เป็น YYYY-MM', 400);
  }

  const policy = await Setting.effectivePolicy();
  const filter = { period, status: { $in: reportStatuses(q.status, 'approved') } };
  // Every department this หัวหน้า signs for, not only their own — the same list
  // `isDepartmentManager` decides each row from. A report narrower than the
  // approve rule hides hours its reader is responsible for.
  if (user.role === 'manager') filter.department = { $in: approvalDepartments(user) };
  else if (q.department) filter.department = q.department;

  const found = await OtEntry.find(filter)
    .populate('employee', 'code name position company')
    .populate('department', 'code name nameTh monthlyCapHours weeklyCapHours')
    .lean();

  /**
   * And the หัวหน้า's own half of it, where their signature is scoped to one
   * payroll — the same rule the queue and the ลูกทีม picker use, applied to a
   * report so that the rows on it are the rows this person is answerable for.
   *
   * Filtered in JavaScript over the populated employee rather than as a clause
   * on the query, for the reason `companyRosters` resolves the same sets that
   * way: nothing on an entry records a company, and a row whose `company` was
   * never filled in is still on a payroll that only the code prefix knows.
   *
   * ฝ่ายบุคคล and Admin are untouched — they read the whole month either way.
   */
  const all = user.role === 'manager' && user.approvesCompany
    ? found.filter((e) => signsForCompany(user, companyOf(e.employee)))
    : found;

  // Same rule as ตรวจสอบรายเดือน, which is the screen this file is exported
  // from: a figure that changed on its way into a spreadsheet would be found by
  // payroll rather than by us.
  const { shown: entries } = latestPerSession(all);

  const grouped = new Map();
  for (const e of entries) {
    const key = String(e.employee?._id);
    if (!grouped.has(key)) grouped.set(key, { employee: e.employee, department: e.department, list: [] });
    grouped.get(key).list.push(e);
  }

  /**
   * The same month as a ceiling counts it — one read for the file, shared with
   * ตรวจสอบรายเดือน, which is the screen this is exported from.
   */
  const capByEmployee = await capEntriesByEmployee(filter, { inHand: all });

  const multiplied = policy.hrSummaryBasis === 'multiplied';
  const headers = [
    'รหัสพนักงาน', 'ชื่อ-สกุล', 'แผนก', 'ประจำเดือน',
    'OT วันปกติ (x1.5)', 'OT วันหยุด 8-17 (x1.5)', 'OT วันหยุด นอกเวลา (x3)',
    `OT x1.5 (${multiplied ? 'คูณแล้ว' : 'ชั่วโมงดิบ'})`,
    `OT x3 (${multiplied ? 'คูณแล้ว' : 'ชั่วโมงดิบ'})`,
    'รวม', 'จำนวนรายการ', 'เพดานแผนก',
    /**
     * "16.5 / 40 · + รออนุมัติ 19", as two numbers a spreadsheet can add.
     *
     * `ใช้ไป` was one column following สถานะที่นับ, which made it a different
     * quantity depending on a dropdown the file does not record — 16.5 from one
     * export and 35.5 from the next, same month, same person, nothing in the
     * file to tell them apart. Split, both halves are the ceiling's own count
     * and neither moves with the filter, so two exports of a month are the same
     * two numbers.
     *
     * NOT one cell reading "16.5 / 40 ชม.". This file is opened in Excel and
     * the column is summed; a figure with a slash and a unit in it is text, and
     * the sum of a column of text is zero.
     */
    'ใช้ไป (อนุมัติแล้ว)', 'รออนุมัติ',
  ];

  const rows = [...grouped.values()]
    .sort((a, b) => String(a.employee?.code).localeCompare(String(b.employee?.code)))
    .map((g) => {
      const s = summariseEntries(g.list);
      const hr = hrSummary(s, policy);
      const capHours = g.department?.monthlyCapHours ?? null;
      // The same two figures the screen prints, from the same function.
      const cap = capColumn({
        shown: g.list,
        live: capByEmployee.get(String(g.employee?._id)) || [],
        capHours,
        policy,
      });
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
        capHours ?? 'ไม่กำหนด',
        fmt(cap.approvedHours),
        // Zero rather than blank: a month with nothing waiting has none pending,
        // which is a figure. An empty cell reads as "not worked out".
        fmt(cap.pendingHours),
      ];
    });

  return csvResponse(`OT-monthly-${period}.csv`, toCsv(headers, rows));
});

const fmt = (n) => (n == null ? '' : String(Math.round(Number(n) * 100) / 100));
