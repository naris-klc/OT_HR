import { route, query, csvResponse, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { accountingReport } from '@/lib/accounting.js';
import { groupByDepartment, sumRows } from '@/lib/departmentSummary.js';
import { toCsv } from '@/src/lib/csv.js';
import { PERIOD_RE, thaiMonth } from '@/lib/reports.js';

/**
 * สรุป OT แยกแผนก as a file.
 *
 * The same month as `accounting.csv`, added up the other way: departments, not
 * companies, with both payrolls merged into each one. Grouped by
 * `groupByDepartment()` — the same function the screen and the printed form
 * call — so the file, the screen and the paper cannot disagree about a
 * department's total.
 *
 * The layout follows the screen line for line: each department's people in
 * ลำดับที่ order, then that department's รวมชั่วโมงทำOT line, and รวมทุกแผนก at
 * the end. Those รวม lines are in the data rather than on a separate sheet on
 * purpose — this file is read by somebody reconciling it against a signed
 * sheet, not pivoted, and the รวม lines are exactly what they check. They carry
 * no รหัสพนักงาน, so a filter on that column still isolates the employee rows.
 *
 * Two columns exist here that are not on the paper: แผนก, because a row in a
 * file has to say which department it belongs to when the banner above it is
 * gone, and บริษัท, because a department holds both payrolls and payroll is who
 * gets asked about a figure.
 *
 * UTF-8 BOM via toCsv (§10), without which Excel on Thai Windows renders every
 * ชื่อ-สกุล as mojibake.
 */
export const GET = route(async (req) => {
  requireRole(await requireAuth(req), 'hr', 'admin');
  const q = query(req);

  const period = String(q.period || '');
  if (!PERIOD_RE.test(period)) return fail('ต้องระบุ period เป็น YYYY-MM', 400);

  const report = await accountingReport(period, {
    includeZero: q.includeZero === '1' || q.includeZero === 'true',
  });
  const departments = groupByDepartment(report.companies);

  const headers = [
    'แผนก', 'ลำดับที่', 'รหัสพนักงาน', 'ชื่อ-สกุล', 'บริษัท',
    'OT x1.5', 'OT x3', 'รวมชั่วโมง', 'หมายเหตุ',
  ];

  const rows = [];
  for (const dept of departments) {
    dept.rows.forEach((row, i) => {
      rows.push([
        dept.name,
        // The paper's ลำดับที่: a line number within the department, restarting
        // at 1, not an identifier. It is here so a line in the file can be
        // found on the printed sheet by eye.
        i + 1,
        row.employee.code,
        row.employee.name,
        row.companyLabel,
        cell(row.ot15Hours),
        cell(row.ot3Hours),
        cell(row.otHours),
        note(row),
      ]);
    });
    rows.push(summaryRow(
      dept.name,
      'รวมชั่วโมงทำOT',
      dept.totals,
      `${dept.totals.headcount} คนมี OT · ${dept.totals.rowCount} คนในแผนก`,
    ));
  }

  // Always written, even for a single department: it is the line the month is
  // signed off against, and the printed bundle always ends with its sheet.
  const total = sumRows(departments.flatMap((d) => d.rows));
  rows.push(summaryRow('', 'รวมทุกแผนก', total, tail(total, report.pending, period, departments)));

  return csvResponse(`OT-departments-${period}.csv`, toCsv(headers, rows));
});

/**
 * A รวม line, mirroring the sheet's foot: the label goes where the name goes —
 * the one cell the screen and the paper both repurpose. Every other column
 * still holds what its header says, so the hour columns stack under the figures
 * they add up.
 *
 * Totals always print a figure, including zero: a blank where the total that
 * gets signed for belongs reads as "not filled in".
 */
function summaryRow(department, label, totals, remark) {
  return [
    department, '', '', label, '',
    fmt(totals.ot15Hours),
    fmt(totals.ot3Hours),
    fmt(totals.otHours),
    remark,
  ];
}

/** The หมายเหตุ on the รวมทุกแผนก line. */
function tail(totals, pending, period, departments) {
  const parts = [
    `ประจำเดือน ${thaiMonth(period)}`,
    `${departments.length} แผนก`,
    `${totals.headcount} คนมี OT`,
  ];
  if (pending.count > 0) {
    parts.push(`ยังค้างอนุมัติ ${pending.count} รายการ (${fmt(pending.hours)} ชม. ไม่นับรวม)`);
  }
  return parts.join(' · ');
}

/** Why a row reads the way it does — the column HR gets asked about. */
function note(row) {
  const parts = [];
  if (row.entryCount === 0) parts.push('ไม่มี OT');
  if (row.pendingCount > 0) parts.push(`ค้างอนุมัติ ${row.pendingCount} รายการ (${fmt(row.pendingHours)} ชม. ไม่นับรวม)`);
  return parts.join(' · ');
}

const fmt = (n) => (n == null ? '' : String(Math.round(Number(n) * 100) / 100));

/** Blank, not 0, for somebody with no hours — the same rule the screen and the paper use. */
const cell = (n) => (n ? fmt(n) : '');
