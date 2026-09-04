import { route, query, csvResponse, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { accountingReport } from '@/lib/accounting.js';
import { unaccountedCsvRow, BIRTHDAY_REMARK } from '@/lib/accountingRows.js';
import { BUCKETS } from '@/src/lib/otEngine.js';
import { zeroRowReason } from '@/lib/otMode.js';
import { toCsv } from '@/src/lib/csv.js';
import { PERIOD_RE, thaiMonth } from '@/lib/reports.js';
import { COMPANY_KEYS } from '@/src/config/companies.js';
import { COMPANY_REPORT_ROLES } from '@/lib/roles.js';

/**
 * The file HR sends to accounting.
 *
 * Same numbers as the screen, in the same columns and the same order — both
 * come out of `accountingReport()`, and the layout mirrors the table on
 * สรุป OT ส่งบัญชี line for line: employees under their company, then that
 * company's departments, then the company, then the grand total when more than
 * one company is in the file.
 *
 * Those subtotal rows are in the data rather than on a separate sheet on
 * purpose. This file is read by a person reconciling it against a signed
 * submission form, not pivoted; the รวม lines are what they check. They are
 * labelled in the ชื่อ-สกุล column and carry no employee code, so a filter on
 * รหัสพนักงาน still isolates the employee rows.
 *
 * UTF-8 BOM via toCsv (§10), without which Excel on Thai Windows renders every
 * ชื่อ-สกุล as mojibake.
 *
 * The same three บทบาท the screen itself is open to — this is its export
 * button, and a reader who can see every figure on the page and not take the
 * file away has been given half a screen.
 */
export const GET = route(async (req) => {
  requireRole(await requireAuth(req), ...COMPANY_REPORT_ROLES);
  const q = query(req);

  const period = String(q.period || '');
  if (!PERIOD_RE.test(period)) return fail('ต้องระบุ period เป็น YYYY-MM', 400);
  if (q.company && q.company !== 'all' && !COMPANY_KEYS.includes(q.company)) {
    return fail('บริษัทไม่ถูกต้อง', 400);
  }

  const report = await accountingReport(period, {
    company: q.company,
    includeZero: q.includeZero === '1' || q.includeZero === 'true',
  });

  // Column for column what the screen shows, in the same order — including
  // the ×1.5 split, which the screen keeps because it is ตรวจสอบรายเดือน's
  // table. The printed form is the one that follows the paper and adds the
  // two ×1.5 buckets into a single 1.50 column; anyone reconciling the file
  // against it adds these two.
  /**
   * `company_code` is added BESIDE บริษัท, not instead of it.
   *
   * The report header on the screen now names each company the way accounting
   * does — PM and THT — and a file that still said only "ไพรมัส" would leave
   * them mapping the two by hand every month. Replacing the Thai column instead
   * would break every sheet and lookup already built on this file, which is the
   * more expensive half of the same mistake. Both columns, and neither side has
   * to change anything.
   *
   * Its name is ASCII and unlocalised because it is the column their system
   * matches on, not one a person reads.
   */
  /**
   * `birthday_hours` is LAST, after หมายเหตุ, and that placement is the whole
   * requirement.
   *
   * Accounting's own sheets and lookups are built on the columns that were here
   * before it; a column inserted in the middle shifts every one after it and
   * breaks them silently. Appended, a consumer that has never heard of it reads
   * exactly what it read last month.
   *
   * ASCII and unlocalised for the reason `company_code` is: it is a column their
   * system matches on and sums, not one a person reads — the sentence a person
   * reads is in หมายเหตุ. How many of the 1.50 hours are there because the day
   * was somebody's birthday; blank when none, like every other hour column here.
   */
  const headers = [
    'บริษัท', 'company_code', 'รหัสพนักงาน', 'ชื่อ-สกุล', 'แผนก',
    'OT x1.5 วันปกติ', 'OT x1.5 วันหยุด', 'OT x3', 'รวมชั่วโมง', 'หมายเหตุ',
    'birthday_hours',
  ];

  const rows = [];
  for (const company of report.companies) {
    for (const row of company.rows) {
      rows.push([
        company.shortTh,
        company.accountingCode,
        row.employee.code,
        row.employee.name,
        row.department?.name || '',
        cell(row.buckets[BUCKETS.OT15_WEEKDAY]),
        cell(row.buckets[BUCKETS.OT15_HOLIDAY]),
        cell(row.buckets[BUCKETS.OT3_HOLIDAY]),
        cell(row.otHours),
        note(row),
        // Part of the 1.50 column beside it, never added to the row's total —
        // a consumer that sums this alongside รวมชั่วโมง would double-count, and
        // that is why it is named `birthday_hours` rather than anything that
        // reads like a bucket of its own.
        cell(row.birthdayHours),
      ]);
    }

    // The screen's summary block, in the same order it appears there.
    for (const d of company.departments) {
      rows.push(summaryRow(
        company,
        'รวมแผนก',
        d.department?.name || '',
        d.totals,
        `${d.totals.headcount} คนมี OT`,
        // A department that worked no OT reads as blank, like the people in
        // it. Only the company line below always prints a figure.
        cell,
      ));
    }
    rows.push(summaryRow(
      company,
      'รวมทั้งหมด',
      company.shortTh,
      company.totals,
      tail(company.totals, company.pending, period),
    ));
  }

  if (report.companies.length > 1) {
    // The grand total belongs to no company, so both company columns are blank
    // — the same rule the รหัสพนักงาน column already follows on รวม lines.
    rows.push(summaryRow(
      null, 'รวมทุกบริษัท', '', report.grandTotal,
      tail(report.grandTotal, report.pending, period),
    ));
  }

  /**
   * Hours this file could not put on any row — nought in every ordinary month.
   *
   * The file is the one surface where the shortfall has nowhere else to show:
   * the screens carry a banner, and a spreadsheet carries only what is in it.
   * Without this line the totals above are short and every one of them still
   * adds up, which is precisely the state whoever opens the file cannot detect.
   *
   * Last, after the grand total, and only when there is something to say — a
   * row that is absent in every normal month cannot break a lookup built on the
   * ones above it.
   */
  if (report.unaccounted?.count > 0) {
    rows.push(unaccountedCsvRow(headers, report.unaccounted));
  }

  const suffix = report.company === 'all' ? 'all' : report.company;
  return csvResponse(
    `OT-accounting-${period}-${suffix}.csv`,
    toCsv(headers, rows),
  );
});

/**
 * A รวม line, mirroring the screen's foot rows: `label` goes where the name
 * goes and `subject` where the department goes — exactly the two cells the
 * screen repurposes. Every other column still holds what its header says, so
 * the three hour columns stack under the figures they add up and a filter on
 * รหัสพนักงาน still isolates the employee rows.
 *
 * Takes the company object rather than its label so that both company columns
 * are filled from one place; `null` for the grand total, which belongs to
 * neither.
 *
 * `format` is `fmt` for a line that is signed for — a blank where the total
 * belongs reads as "not filled in" — and `cell` for a subtotal, which follows
 * the employee rows in printing nothing when there is nothing.
 */
function summaryRow(company, label, subject, totals, remark, format = fmt) {
  return [
    company?.shortTh || '', company?.accountingCode || '', '', label, subject,
    format(totals.buckets[BUCKETS.OT15_WEEKDAY]),
    format(totals.buckets[BUCKETS.OT15_HOLIDAY]),
    format(totals.buckets[BUCKETS.OT3_HOLIDAY]),
    format(totals.otHours),
    remark,
    // The subtotal of the same split, so the new column adds up down the file
    // like every other figure in it. `cell` regardless of `format`: a รวม line
    // has to print its hours, but nought birthday hours is nought and printing
    // 0 in a column that is blank on every employee row above reads as a figure.
    cell(totals.birthdayHours),
  ];
}

/** The หมายเหตุ on a company-level รวม line. */
function tail(totals, pending, period) {
  const parts = [
    `ประจำเดือน ${thaiMonth(period)}`,
    `${totals.headcount} คนมี OT`,
    `${totals.entryCount} รายการ`,
  ];
  if (pending.count > 0) {
    parts.push(`ยังค้างอนุมัติ ${pending.count} รายการ (${fmt(pending.hours)} ชม. ไม่นับรวม)`);
  }
  return parts.join(' · ');
}

/**
 * Why a row reads the way it does — the column accounting queries HR about.
 *
 * “วันเกิด” leads, because it is the only part of this cell that explains a
 * figure the file is asserting: วันหยุด hours against somebody who worked a
 * weekday. It is the same remark the printed sheet carries beside the row, with
 * the hours added — a file is read next to the sheet, and the number is what
 * makes the two reconcilable. The other two parts describe what is NOT in the
 * row, and the paper does not carry them at all.
 */
function note(row) {
  const parts = [];
  if (row.birthdayHours > 0) parts.push(`${BIRTHDAY_REMARK} ${fmt(row.birthdayHours)} ชม.`);
  if (row.entryCount === 0) {
    // "ไม่มี OT" alone cannot tell a reader whether this person had a quiet
    // month or is in a department that does no OT at all. Where the department
    // answers that, the answer goes here rather than into a column of its own:
    // the แผนก column is what accounting groups by, and "ผลิต (เหมารายวัน)"
    // would split one department into two in every pivot table built on it.
    const why = zeroRowReason(row.department);
    parts.push(why ? `ไม่มี OT — ${why}` : 'ไม่มี OT');
  }
  if (row.pendingCount > 0) parts.push(`ค้างอนุมัติ ${row.pendingCount} รายการ (${fmt(row.pendingHours)} ชม. ไม่นับรวม)`);
  return parts.join(' · ');
}

const fmt = (n) => (n == null ? '' : String(Math.round(Number(n) * 100) / 100));

/** Blank, not 0.00, for somebody with no hours — the same rule the screen uses. */
const cell = (n) => (n ? fmt(n) : '');
