import { route, query, csvResponse, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { accountingReport } from '@/lib/accounting.js';
import { unaccountedCsvRow, BIRTHDAY_REMARK } from '@/lib/accountingRows.js';
import { BUCKETS } from '@/src/lib/otEngine.js';
import { toCsv } from '@/src/lib/csv.js';
import { PERIOD_RE } from '@/lib/reports.js';
import { COMPANY_KEYS } from '@/src/config/companies.js';
import { COMPANY_REPORT_ROLES } from '@/lib/roles.js';

/**
 * The file HR sends to accounting.
 *
 * Same numbers as the screen and in the same ORDER — both come out of
 * `accountingReport()`, and the layout mirrors the table on สรุป OT ส่งบัญชี
 * line for line: employees under their company, then that company's
 * departments, then the company, then the grand total when more than one
 * company is in the file.
 *
 * It read "in the same columns" as well until 2026-09-09. The file now ends in
 * the printed form's two rate totals — รวม 1.5 and รวม 3 — where the screen
 * ends in one รวม ชม., and its หมายเหตุ carries the word วันเกิด and nothing
 * else where the screen's carries every sentence it has. See the header block
 * and `note()` below for what that gained and what it cost.
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

  // The ×1.5 split is what the screen shows, because that screen is
  // ตรวจสอบรายเดือน's table. The two columns after it are what the PAPER shows,
  // because this file is reconciled against the paper — see below.
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
   * ── THE TAIL OF THIS FILE WAS REPLACED ON 2026-09-09 ────────────────────────
   *
   * It read `'รวมชั่วโมง', 'หมายเหตุ', 'birthday_hours'` until that day. HR sent
   * the layout they wanted as a picture of the opened file and it ends
   * `รวม 1.5 · รวม 3 · หมายเหตุ`, so both of those columns are gone and two
   * subtotals stand where the single total did.
   *
   * **`รวม 1.5` is the two ×1.5 columns added together, and `รวม 3` repeats the
   * ×3 column.** That repetition is the point rather than an oversight: the
   * printed form F-HR-027 has exactly two rate columns, 1.50 and 3.00, and this
   * file is read beside it. Adding the two ×1.5 buckets by hand every month is
   * the step that was going wrong. The split columns stay to the left of them
   * because they are what the screen shows and what a query about one figure is
   * answered from.
   *
   * **What that costs, stated so nobody has to rediscover it.** A consumer that
   * counted columns from the left now reads `รวม 1.5` where it read
   * `รวมชั่วโมง` — a DIFFERENT number on any row with ×3 hours in it — and the
   * `birthday_hours` column their spreadsheet could sum is gone; the วันเกิด
   * hours are readable only as the word in หมายเหตุ now. Both were asked for
   * with the old shape in front of the person asking.
   */
  const headers = [
    'บริษัท', 'company_code', 'รหัสพนักงาน', 'ชื่อ-สกุล', 'แผนก',
    'OT x1.5 วันปกติ', 'OT x1.5 วันหยุด', 'OT x3', 'รวม 1.5', 'รวม 3', 'หมายเหตุ',
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
        cell(ot15(row.buckets)),
        cell(row.buckets[BUCKETS.OT3_HOLIDAY]),
        note(row),
      ]);
    }

    // The screen's summary block, in the same order it appears there.
    for (const d of company.departments) {
      rows.push(summaryRow(
        company,
        'รวมแผนก',
        d.department?.name || '',
        d.totals,
        // A department that worked no OT reads as blank, like the people in
        // it. Only the company line below always prints a figure.
        cell,
      ));
    }
    rows.push(summaryRow(company, 'รวมทั้งหมด', company.shortTh, company.totals));
  }

  if (report.companies.length > 1) {
    // The grand total belongs to no company, so both company columns are blank
    // — the same rule the รหัสพนักงาน column already follows on รวม lines.
    rows.push(summaryRow(null, 'รวมทุกบริษัท', '', report.grandTotal));
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
   *
   * `fold` since 2026-09-09, and it is this file's shape that forces it: the
   * line used to put its hours under รวมชั่วโมง and its sentence in หมายเหตุ,
   * and this file now has neither — หมายเหตุ carries the word วันเกิด and
   * nothing else, and the total was replaced by a 1.50/3.00 split that these
   * hours cannot be put into, because an entry whose employee no longer
   * resolves was never split by any row. So the whole line is one sentence in
   * the ชื่อ-สกุล cell that already held its label. It still cannot be lost.
   */
  if (report.unaccounted?.count > 0) {
    rows.push(unaccountedCsvRow(headers, report.unaccounted, { fold: true }));
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
 *
 * **No หมายเหตุ on a รวม line since 2026-09-09.** The company line carried
 * `ประจำเดือน …  · n คนมี OT · n รายการ` and the backlog sentence with it, and
 * the department line carried its headcount. หมายเหตุ is the วันเกิด column
 * now, on every row of the file, so those went with the rest of the prose —
 * see `note()`.
 */
function summaryRow(company, label, subject, totals, format = fmt) {
  return [
    company?.shortTh || '', company?.accountingCode || '', '', label, subject,
    format(totals.buckets[BUCKETS.OT15_WEEKDAY]),
    format(totals.buckets[BUCKETS.OT15_HOLIDAY]),
    format(totals.buckets[BUCKETS.OT3_HOLIDAY]),
    format(ot15(totals.buckets)),
    format(totals.buckets[BUCKETS.OT3_HOLIDAY]),
    '',
  ];
}

/**
 * Why a row reads the way it does — and since 2026-09-09 there is exactly one
 * thing it can say.
 *
 * **“วันเกิด”, the word alone, or nothing.** Asked for in those terms with the
 * old cell in front of the person asking: *ช่องหมายเหตุแสดงแค่วันเกิดเท่านั้น*.
 * It is now the same cell the printed sheet carries — `remark()` in
 * AccountingPrint.jsx returns `BIRTHDAY_REMARK` and nothing else — so a person
 * holding the file beside the paper reads the same word in the same place, and
 * the hours are read off the columns rather than out of a sentence.
 *
 * ── WHAT LEFT THIS CELL, AND WHERE IT IS STILL SAID ────────────────────────
 *
 * `วันเกิด 8 ชม.` → the hours are in the ×1.5 วันหยุด column they were always
 *   part of; the `birthday_hours` column that split them out went with this.
 *   สรุป OT ส่งบัญชี on screen still prints *วันเกิด · 8.00 ชม. อยู่ในช่องวันหยุด*.
 * `ไม่มี OT` / `ไม่มี OT — ไม่มีโอที` → the row is blank across every hour
 *   column, which is what a blank line on the paper sheet has always meant. The
 *   department mode behind it (`zeroRowReason`) is still on the screen.
 * `ค้างอนุมัติ n รายการ` → the queue and the screen's banner. **This is the one
 *   worth knowing about:** the file no longer says anywhere that a figure it
 *   prints is short because something is unsigned.
 */
function note(row) {
  return row.birthdayHours > 0 ? BIRTHDAY_REMARK : '';
}

/**
 * The 1.50 column of the printed form — both ×1.5 buckets, added.
 *
 * One place, because the employee rows and every รวม line under them have to
 * add up the same way or the file disagrees with itself down a column.
 */
const ot15 = (buckets) => (buckets?.[BUCKETS.OT15_WEEKDAY] || 0) + (buckets?.[BUCKETS.OT15_HOLIDAY] || 0);

const fmt = (n) => (n == null ? '' : String(Math.round(Number(n) * 100) / 100));

/** Blank, not 0.00, for somebody with no hours — the same rule the screen uses. */
const cell = (n) => (n ? fmt(n) : '');
