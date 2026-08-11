/**
 * สรุป OT แยกแผนก — the month regrouped by department, both payrolls together.
 *
 * สรุป OT ส่งบัญชี partitions the month by company because the two file their
 * payroll separately. This report answers the other question — how many hours
 * did each แผนก work — and a department is not split between the companies:
 * the people in it sit in the same room whichever entity pays them, and a
 * count that broke them apart would be answering neither question. So the
 * company partition is undone here and the rows are regrouped, department by
 * department, across both.
 *
 * Built from the same `accountingReport()` payload the accounting screen
 * draws, so the two can never disagree about a month: this is a regrouping of
 * those rows, not a second count of them.
 *
 * The screen and the printed form both come through here, for the same reason
 * — a department total that differed between the paper and the screen it was
 * printed from would be found by the department, not by us.
 */

import { compareCodes, CODE_LOCALE } from '../src/lib/employeeCode.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Totals for a block of rows.
 *
 * The grand total is the two reported columns added together, NOT a separately
 * summed `otHours`: the sheet is signed against what is printed on it, so รวม
 * has to equal 1.50 + 3.00 as shown, to the last hundredth.
 */
export function sumRows(rows) {
  const ot15Hours = round2(rows.reduce((n, r) => n + (r.ot15Hours || 0), 0));
  const ot3Hours = round2(rows.reduce((n, r) => n + (r.ot3Hours || 0), 0));
  return {
    ot15Hours,
    ot3Hours,
    otHours: round2(ot15Hours + ot3Hours),
    /** People listed. */
    rowCount: rows.length,
    /** People who actually worked OT — what the department is counted on. */
    headcount: rows.filter((r) => r.otHours > 0).length,
  };
}

/**
 * `report.companies` → one entry per department, both payrolls merged.
 *
 * Departments come out in code order and the people in them in รหัสพนักงาน
 * order — each company's rows arrive already sorted, but interleaving two
 * sorted lists does not give a sorted list, so the merged block is sorted
 * again. Without it a department would list all of Primus and then all of
 * Themtech, which is not how the people in it are counted.
 *
 * Somebody whose department was hard-deleted still has hours, and dropping
 * them would understate the total on the last sheet, so they collect under one
 * unnamed department, sorted last, rather than disappearing.
 *
 * BOTH ORDERS ARE PINNED TO A NAMED LOCALE. This function runs twice over the
 * same month — once in the browser for สรุป OT แยกแผนก and once in the route
 * that writes departments.csv — and `localeCompare()` with no locale asks
 * whichever ICU it is running under. That is not one order with two spellings;
 * it is two orders, and the department holding the CSV next to the screen is
 * the one who finds out. See CODE_LOCALE in src/lib/employeeCode.js.
 */
export function groupByDepartment(companies = []) {
  const groups = new Map();

  for (const company of companies) {
    for (const row of company.rows) {
      const id = row.department?.id || '—';
      if (!groups.has(id)) {
        groups.set(id, {
          id,
          // ￿ sorts after any real code, which is where an unnamed
          // department belongs.
          code: row.department?.code ?? '￿',
          name: row.department?.name || 'ไม่ระบุแผนก',
          rows: [],
        });
      }
      groups.get(id).rows.push(row);
    }
  }

  return [...groups.values()]
    .map((g) => {
      // By NORMALISED รหัสพนักงาน: PM-0620 and PM0620 are one person's code
      // written two ways, and ordering them a hyphen's distance apart puts the
      // same roster in two places depending on which register a row came from.
      const rows = [...g.rows].sort((a, b) => compareCodes(a.employee.code, b.employee.code));
      return { ...g, rows, totals: sumRows(rows) };
    })
    // Department codes are NOT normalised: the '￿' above is a sort sentinel,
    // not a code, and stripping it to nothing would move the unnamed department
    // from last to first. Only the locale is pinned here.
    .sort((a, b) => String(a.code).localeCompare(String(b.code), CODE_LOCALE));
}
