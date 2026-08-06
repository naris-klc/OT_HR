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
import { COMPANIES, DEFAULT_COMPANY, companyFromCode } from '@/src/config/companies.js';

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

/**
 * Which payroll an employee files under. The stored field wins; the code
 * prefix is only a fallback for rows written before the field existed, and
 * DEFAULT_COMPANY for a code that matches neither convention.
 */
function companyOf(employee) {
  return employee?.company || companyFromCode(employee?.code) || DEFAULT_COMPANY;
}

const labelsFor = (key) => {
  const meta = COMPANIES.find((c) => c.key === key);
  return meta
    ? { nameTh: meta.nameTh, nameEn: meta.nameEn, shortTh: meta.shortTh, shortEn: meta.shortEn }
    // A key that is no longer in the config list still has hours attached to
    // it, and dropping them silently would understate the month.
    : { nameTh: key, nameEn: key, shortTh: key, shortEn: key };
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

  const [entries, pendingGroups] = await Promise.all([
    OtEntry.find({ period, status: { $in: [...ACCOUNTING_STATUSES] } })
      .populate('employee', 'code name position company')
      .populate('department', 'code name nameTh')
      .lean(),
    // Counted rather than fetched: the sheet only needs to say "this person
    // still has 2 requests in the queue", not what they are.
    OtEntry.aggregate([
      { $match: { period, status: { $in: [...PENDING_STATUSES] } } },
      { $group: { _id: '$employee', count: { $sum: 1 }, hours: { $sum: '$totals.otHours' } } },
    ]),
  ]);

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

  /** employeeId → { employee, department, company, entries } */
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.employee) continue; // orphaned by a hard-deleted employee
    const key = String(entry.employee._id);
    if (!groups.has(key)) {
      groups.set(key, {
        employee: entry.employee,
        // The department the entry was filed under, not today's. Somebody who
        // transferred mid-month keeps their hours where they were worked —
        // the same rule ตรวจสอบรายเดือน already follows.
        department: entry.department,
        company: companyOf(entry.employee),
        entries: [],
      });
    }
    groups.get(key).entries.push(entry);
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

  const allRows = [...groups.values()]
    .filter((g) => !wanted || g.company === wanted)
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
        entries: g.entries,
      };
    })
    .sort((a, b) => String(a.employee.code).localeCompare(String(b.employee.code)));

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
    grandTotal: totalsFor(allRows.flatMap((r) => r.entries), allRows),
    pending: pendingFor(
      wanted ? pendingIn(wanted) : pendingGroups,
    ),
  };
}

/** The raw entries are an implementation detail of the totals — never sent out. */
const stripEntries = ({ entries, ...row }) => row;
