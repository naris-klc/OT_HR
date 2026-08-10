/**
 * สรุป OT ส่งบัญชี — the monthly submission sheet, split by legal entity.
 *
 * This is the report `src/config/companies.js` exists for. The two companies
 * file their payroll separately, so the hours HR hands to accounting have to
 * arrive already partitioned: one block per company, subtotalled per
 * department, with a headline figure accounting can sign off against.
 *
 * The JSON report and the CSV export are the same numbers in two shapes, so
 * they are built here once. A subtotal that disagreed with the screen it was
 * exported from would be found by accounting, not by us.
 *
 * There is no money in this file (§11). Hours per bucket only — applying a
 * rate is payroll's job.
 */

import Employee from '@/src/models/Employee.js';
import OtEntry from '@/src/models/OtEntry.js';
import { summariseEntries } from '@/src/lib/otEngine.js';
import { latestPerSession } from '@/lib/reports.js';
import { groupEntriesByEmployee, reconcile, birthdayHoursOf } from '@/lib/accountingRows.js';
import { COMPANIES, companyOf } from '@/src/config/companies.js';

/**
 * What counts as a fact for accounting.
 *
 * The flow is pending_mgr → pending_hr → approved, and `approved` IS "HR
 * ยืนยันแล้ว" — HR's confirmation is the step that sets it. So there is
 * deliberately no status selector on this report the way there is on
 * ตรวจสอบรายเดือน: a sheet that went to accounting with unconfirmed hours on
 * it would be a payroll error, not a filter preference.
 */
export const ACCOUNTING_STATUSES = Object.freeze(['approved']);

/** Still in flight. Never counted — only reported, so HR knows the month is not closed. */
export const PENDING_STATUSES = Object.freeze(['pending_mgr', 'pending_hr']);

const round2 = (n) => Math.round(n * 100) / 100;

// `companyOf` — the stored field, then the code prefix, then the default —
// lives in src/config/companies.js now that the birthday check asks it too.

const labelsFor = (key) => {
  const meta = COMPANIES.find((c) => c.key === key);
  return meta
    ? {
      nameTh: meta.nameTh,
      nameEn: meta.nameEn,
      shortTh: meta.shortTh,
      shortEn: meta.shortEn,
      /** What accounting calls it — heads this report and this report only. */
      accountingCode: meta.accountingCode || '',
    }
    // A key that is no longer in the config list still has hours attached to
    // it, and dropping them silently would understate the month. It has no
    // accounting code, and printing a blank is the honest version of that.
    : { nameTh: key, nameEn: key, shortTh: key, shortEn: key, accountingCode: '' };
};

const shapeEmployee = (e) => (e
  ? { id: String(e._id), code: e.code, name: e.name, position: e.position || '' }
  : null);

const shapeDepartment = (d) => (d
  ? { id: String(d._id), code: d.code, name: d.nameTh || d.name }
  : null);

/** Totals over a set of entries, plus the counts the sheet prints alongside them. */
function totalsFor(entries, rows) {
  const summary = summariseEntries(entries);
  return {
    buckets: summary.buckets,
    ot15Hours: summary.ot15Hours,
    ot3Hours: summary.ot3Hours,
    otHours: summary.otHours,
    weightedHours: summary.weightedHours,
    /**
     * How much of `ot15Hours` above is there because a day was somebody's
     * birthday — the subtotal of the same split each row carries.
     *
     * Summed from the SAME entries the figures above come from, not added up off
     * the rows, so it cannot describe a different set from the one it sits
     * beside. It is a part of the 1.50 column rather than a column of its own:
     * `ot15Hours` is unchanged by its existence, which is the property the CSV's
     * new column has to preserve.
     */
    birthdayHours: birthdayHoursOf(entries),
    entryCount: entries.length,
    /** People listed. */
    rowCount: rows.length,
    /** People who actually have hours — what accounting pays against. */
    headcount: rows.filter((r) => r.otHours > 0).length,
  };
}

/**
 * What is still in the queue for this scope.
 *
 * Counted from the queue itself rather than summed off the rows: somebody
 * whose every request for the month is still waiting has NO approved hours, so
 * they have no row on the sheet at all — and adding up the rows would report
 * their backlog as zero. "The month is not closed yet" is the one number here
 * that must not be able to under-report.
 */
function pendingFor(groups) {
  return {
    count: groups.reduce((n, g) => n + g.count, 0),
    hours: round2(groups.reduce((n, g) => n + g.hours, 0)),
    employees: groups.length,
  };
}

/**
 * Build the whole sheet.
 *
 * @param {string} period                 'YYYY-MM'
 * @param {object} [opts]
 * @param {string} [opts.company]         a company key, or 'all' / undefined
 * @param {boolean} [opts.includeZero]    list roster members with no OT, the
 *                                        way the paper sheet does — a blank
 *                                        row is accounting's evidence that the
 *                                        person was checked, not skipped
 */
export async function accountingReport(period, opts = {}) {
  const includeZero = Boolean(opts.includeZero);
  const wanted = opts.company && opts.company !== 'all' ? String(opts.company) : null;

  const [confirmed, stuck] = await Promise.all([
    OtEntry.find({ period, status: { $in: [...ACCOUNTING_STATUSES] } })
      .populate('employee', 'code name position company')
      .populate('department', 'code name nameTh')
      .lean(),
    // Fetched rather than counted in Mongo. It used to be a $group, because the
    // sheet only needs to say "this person still has 2 requests in the queue" —
    // but a sum computed in the database cannot drop a superseded filing, and a
    // backlog figure inflated by a duplicate is the same error the totals below
    // exist to avoid. The queue for one month is small enough to read.
    OtEntry.find({ period, status: { $in: [...PENDING_STATUSES] } })
      .select('employee workDate startTime endTime endsNextDay totals createdAt')
      .lean(),
  ]);

  // Within `approved` only: HR's confirmation is what makes an hour a fact, so
  // a newer request still sitting in the queue must not displace a confirmed
  // one. The queue is deduplicated on its own terms, for the same reason.
  const { shown: entries, hidden } = latestPerSession(confirmed);
  const { shown: pendingEntries } = latestPerSession(stuck);

  const pendingGroups = [...pendingEntries.reduce((acc, e) => {
    const key = String(e.employee);
    const g = acc.get(key) || { _id: e.employee, count: 0, hours: 0 };
    g.count += 1;
    g.hours += e.totals?.otHours ?? 0;
    return acc.set(key, g);
  }, new Map()).values()];

  const pendingByEmployee = new Map(pendingGroups.map((g) => [String(g._id), g]));

  // Which payroll each stuck request belongs to. The aggregate above only
  // carries employee ids, and some of those people have no row on the sheet to
  // read the company off.
  const pendingOwners = pendingGroups.length
    ? await Employee.find({ _id: { $in: pendingGroups.map((g) => g._id) } })
      .select('code company')
      .lean()
    : [];
  const companyByEmployee = new Map(pendingOwners.map((e) => [String(e._id), companyOf(e)]));
  const pendingIn = (key) => pendingGroups.filter(
    (g) => companyByEmployee.get(String(g._id)) === key,
  );

  /**
   * employeeId → { employee, department, company, entries }
   *
   * ENTRIES FIRST, roster second. Every approved entry makes a row whoever
   * filed it — a manager's OT and the OT of somebody who has since left are
   * both on the sheet — and the roster pass below only adds blank lines. See
   * lib/accountingRows.js, which is where that order is written down and
   * tested; getting it the other way round is how a roster filter turns into
   * missing hours.
   */
  const { groups, unaccounted } = groupEntriesByEmployee(entries, { companyOf });

  /**
   * Put the dangling reference back on each unaccounted entry.
   *
   * `populate('employee')` returns null when the document is gone and discards
   * the id along with it, so the one identifier that could find the row in a
   * backup is exactly the one the query above destroys. These few entries are
   * read again unpopulated to get it back.
   *
   * Runs only when something is already wrong — `unaccounted.count` is nought
   * in every ordinary month, so this costs an ordinary month nothing.
   */
  if (unaccounted.count > 0) {
    const raw = await OtEntry.find({ _id: { $in: unaccounted.entries.map((e) => e.id) } })
      .select('employee')
      .lean();
    const refOf = new Map(raw.map((r) => [String(r._id), r.employee ? String(r.employee) : null]));
    for (const item of unaccounted.entries) item.employeeId = refOf.get(item.id) ?? null;
  }

  if (includeZero) {
    // Only people who may submit OT (§2 — managers do not), and only active
    // ones. Anybody who DOES have entries is already in `groups` and stays
    // there regardless of their role or status today.
    //
    // Not narrowed to `wanted` in the query: on a database seeded before the
    // two-company split `company` is unset, and a Mongo-side filter would find
    // nobody while the rows built above are still partitioned by the code
    // prefix. The partition happens in one place — companyOf() — so both
    // halves of the sheet agree whether or not `npm run migrate:company` has
    // been run.
    const roster = await Employee.find({ active: true, role: 'employee' })
      .populate('department', 'code name nameTh')
      .select('code name position company department')
      .lean();

    for (const employee of roster) {
      const key = String(employee._id);
      if (groups.has(key)) continue;
      groups.set(key, {
        employee,
        department: employee.department,
        company: companyOf(employee),
        entries: [],
      });
    }
  }

  /**
   * Every row the month produces, before the company filter narrows the view.
   *
   * The reconciliation below is a property of the MONTH, not of what is on
   * screen. Checked against the filtered rows it would report a shortfall every
   * time somebody picked one company out of two — the loudest possible warning
   * fired by the most ordinary possible action, which is how a warning stops
   * being read.
   */
  const everyRow = [...groups.values()]
    .map((g) => {
      const summary = summariseEntries(g.entries);
      const pending = pendingByEmployee.get(String(g.employee._id));
      return {
        employee: shapeEmployee(g.employee),
        department: shapeDepartment(g.department),
        company: g.company,
        companyLabel: labelsFor(g.company).shortTh,
        buckets: summary.buckets,
        ot15Hours: summary.ot15Hours,
        ot3Hours: summary.ot3Hours,
        otHours: summary.otHours,
        weightedHours: summary.weightedHours,
        entryCount: g.entries.length,
        pendingCount: pending?.count ?? 0,
        pendingHours: round2(pending?.hours ?? 0),
        /**
         * Hours in the วันหยุด columns because the day was this person's
         * birthday — what the “วันเกิด” remark beside the row is printed from.
         *
         * The one thing on this sheet that says why a figure reads the way it
         * does. HR used to write it on the paper by hand; the note moved onto
         * the print in Aug 2026, when it came off F-HR-027. `birthdayHoursOf`
         * reads `segments[].dayReason`, which was resolved when the entry was
         * filed — no birth date is loaded by this report and none is returned,
         * so the sheet can name the reason without disclosing the date.
         */
        birthdayHours: birthdayHoursOf(g.entries),
        entries: g.entries,
      };
    })
    .sort((a, b) => String(a.employee.code).localeCompare(String(b.employee.code)));

  /** What this sheet shows: one company, or both. */
  const allRows = wanted ? everyRow.filter((r) => r.company === wanted) : everyRow;

  // Config order first so the sheet reads the same every month, then any key
  // the data carries that the config no longer does.
  const keys = [
    ...COMPANIES.map((c) => c.key),
    ...new Set(allRows.map((r) => r.company)),
  ].filter((key, i, list) => list.indexOf(key) === i && (!wanted || key === wanted));

  const companies = keys.map((key) => {
    const rows = allRows.filter((r) => r.company === key);
    const companyEntries = rows.flatMap((r) => r.entries);

    const byDepartment = new Map();
    for (const row of rows) {
      const id = row.department?.id || '—';
      if (!byDepartment.has(id)) byDepartment.set(id, { department: row.department, rows: [] });
      byDepartment.get(id).rows.push(row);
    }

    return {
      key,
      ...labelsFor(key),
      rows: rows.map(stripEntries),
      totals: totalsFor(companyEntries, rows),
      pending: pendingFor(pendingIn(key)),
      departments: [...byDepartment.values()]
        .map((d) => ({
          department: d.department,
          totals: totalsFor(d.rows.flatMap((r) => r.entries), d.rows),
        }))
        .sort((a, b) => String(a.department?.code ?? '').localeCompare(String(b.department?.code ?? ''))),
    };
  })
    // A company with nobody in it this month is noise on the sheet — unless
    // the user asked for that company specifically, where an empty table is
    // the answer to their question, or it still has requests stuck in the
    // queue, which is exactly when HR needs to be told.
    .filter((c) => c.rows.length > 0 || c.pending.count > 0 || Boolean(wanted));

  return {
    period,
    company: wanted || 'all',
    includeZero,
    statuses: [...ACCOUNTING_STATUSES],
    companies,
    /** Superseded filings left out of every figure on the sheet. */
    supersededCount: hidden.length,
    /**
     * Approved hours that reach no row on the sheet — an entry whose employee
     * no longer resolves. Nought in every ordinary month.
     *
     * Reported rather than skipped. It is the only way this sheet can be short
     * and still balance against itself: the rows agree with the subtotals, the
     * subtotals agree with the grand total, both reports agree with each other,
     * and the month is simply missing an entry that no longer belongs to
     * anybody. Every other figure here is a total of something visible.
     *
     * Never partitioned by company or department — a row with no employee has
     * neither — so it is reported once, at the top, whatever `company` was
     * asked for.
     */
    unaccounted,
    /**
     * The sheet checking itself: filed = reported + unaccounted, in hours.
     *
     * Cheap (three sums over a month already in memory) and it turns a silent
     * shortfall into something the screen can refuse to print past. See
     * test/accountingReconciliation.test.js.
     */
    reconciliation: reconcile(entries, everyRow, unaccounted),
    grandTotal: totalsFor(allRows.flatMap((r) => r.entries), allRows),
    pending: pendingFor(
      wanted ? pendingIn(wanted) : pendingGroups,
    ),
  };
}

/** The raw entries are an implementation detail of the totals — never sent out. */
const stripEntries = ({ entries, ...row }) => row;
