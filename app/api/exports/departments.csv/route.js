import { route, query, csvResponse, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { accountingReport } from '@/lib/accounting.js';
import { groupByDepartment, sumRows } from '@/lib/departmentSummary.js';
import { unaccountedCsvRow, BIRTHDAY_REMARK } from '@/lib/accountingRows.js';
import { toCsv } from '@/src/lib/csv.js';
import { PERIOD_RE } from '@/lib/reports.js';

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

  /**
   * ── THE TAIL OF THIS FILE FOLLOWED accounting.csv ON 2026-09-09 ────────────
   *
   * It read `'OT x1.5', 'OT x3', 'รวมชั่วโมง', 'หมายเหตุ'` until that day, when
   * ฝ่ายบุคคล asked for this file to be made like the other one:
   * *ไฟล์ OT-departments ทำเหมือนกับส่งออกไฟล์บัญชี (CSV/Excel)*.
   *
   * **`รวม 1.5` and `รวม 3` repeat `OT x1.5` and `OT x3` exactly, and that is
   * what was asked for.** On accounting.csv the same two columns add up a split
   * that sits to their left; here there is no split to add up — this file's
   * `OT x1.5` has always BEEN the printed form's combined 1.50 column, because
   * the department screen and the department sheet both rule 1.50 and 3.00 and
   * nothing finer. So the two files now end with the same four cells, one of
   * them by summing and one by repeating.
   *
   * **`รวมชั่วโมง` is gone**, as it is from accounting.csv. A consumer that
   * counted columns from the left now finds `รวม 1.5` in the eighth column
   * where the row's whole total used to be — a different number on any row with
   * ×3 hours in it. The total is still on the paper, in `รวมชั่วโมงทำOT`, and
   * on the screen.
   */
  const headers = [
    'แผนก', 'ลำดับที่', 'รหัสพนักงาน', 'ชื่อ-สกุล', 'บริษัท',
    'OT x1.5', 'OT x3', 'รวม 1.5', 'รวม 3', 'หมายเหตุ',
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
        cell(row.ot15Hours),
        cell(row.ot3Hours),
        note(row),
      ]);
    });
    rows.push(summaryRow(dept.name, 'รวมชั่วโมงทำOT', dept.totals));
  }

  // Always written, even for a single department: it is the line the month is
  // signed off against, and the printed bundle always ends with its sheet.
  const total = sumRows(departments.flatMap((d) => d.rows));
  rows.push(summaryRow('', 'รวมทุกแผนก', total));

  /**
   * Hours no department could claim — an entry whose employee no longer
   * resolves, so it has no row, no department and no company.
   *
   * Nought in every ordinary month, and written only when it is not, for the
   * same reason as in accounting.csv: a spreadsheet carries only what is in it,
   * and a file whose totals are short while every figure in it still adds up is
   * a file nobody can check.
   *
   * The whole line lands in the ชื่อ-สกุล cell — see `unaccountedCsvRow`. It
   * used to spread across รวมชั่วโมง and หมายเหตุ; this file has had neither
   * since 2026-09-09.
   */
  if (report.unaccounted?.count > 0) {
    rows.push(unaccountedCsvRow(headers, report.unaccounted));
  }

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
 *
 * **No หมายเหตุ on a รวม line since 2026-09-09.** The department line carried
 * `n คนมี OT · n คนในแผนก` and the รวมทุกแผนก line carried
 * `ประจำเดือน … · n แผนก · n คนมี OT` and the backlog sentence with it. That
 * column says วันเกิด and nothing else now, on every row of the file — the same
 * rule accounting.csv took the same day. See `note()`.
 */
function summaryRow(department, label, totals) {
  return [
    department, '', '', label, '',
    fmt(totals.ot15Hours),
    fmt(totals.ot3Hours),
    fmt(totals.ot15Hours),
    fmt(totals.ot3Hours),
    '',
  ];
}

/**
 * Why a row reads the way it does — “วันเกิด”, the word alone, or nothing.
 *
 * ── THIS FILE KNEW NOTHING ABOUT A BIRTHDAY UNTIL 2026-09-09 ───────────────
 *
 * `test/birthdayOnPaper.test.js` pinned that ignorance, and the reason it gave
 * was *“a CSV is sorted, filtered and pasted, not read a row at a time — the
 * word in a file wants to be a column you can pivot, and nobody asked”*. The
 * department SCREEN and the department PRINTED SHEET both got the remark
 * earlier the same day, each after its own ask; this file was left out because
 * the ask had not come. It came: *ไฟล์ OT-departments ทำเหมือนกับส่งออกไฟล์
 * บัญชี*.
 *
 * So it says exactly what the other three documents say — one
 * `BIRTHDAY_REMARK`, one spelling, no hours after it, no date anywhere near it.
 * `lib/departmentSummary.js` is still silent and still has no `birthdayHours`
 * in `sumRows()`: this reads the figure off the ROW, which is the same object
 * `accountingReport()` already put it on, so the grouping stays a regrouping
 * and the รวมทุกแผนก line cannot acquire a birthday of its own.
 *
 * ── WHAT LEFT THIS CELL ────────────────────────────────────────────────────
 *
 * `ไม่มี OT` → the row is blank across both hour columns, which is what a blank
 *   line on the department sheet has always meant.
 * `ค้างอนุมัติ n รายการ` → the queue and the screen. **The file no longer says
 *   anywhere that a figure it prints is short because something is unsigned**,
 *   which is the same thing accounting.csv gave up on the same day.
 */
function note(row) {
  return row.birthdayHours > 0 ? BIRTHDAY_REMARK : '';
}

const fmt = (n) => (n == null ? '' : String(Math.round(Number(n) * 100) / 100));

/** Blank, not 0, for somebody with no hours — the same rule the screen and the paper use. */
const cell = (n) => (n ? fmt(n) : '');
