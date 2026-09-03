import OtEntry from '@/src/models/OtEntry.js';
import { SIGNER_ROLES, isSigner } from '@/lib/roles.js';
import PolicyVersion from '@/src/models/PolicyVersion.js';
import Setting from '@/src/models/Setting.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { summariseEntries, hrSummary } from '@/src/lib/otEngine.js';
import { PERIOD_RE, latestPerSession, editTally, reportStatuses } from '@/lib/reports.js';
import { capColumn } from '@/lib/caps.js';
import { capEntriesByEmployee } from '@/src/services/otService.js';
import { approvalDepartments, isHrVerifiedBirthday, signsForCompany } from '@/lib/entries.js';
import { companyOf } from '@/src/config/companies.js';
import { versionIdOf, versionSpread } from '@/lib/policyVersion.js';

/** HR's monthly review: every employee's totals for a period, in one table. */
export const GET = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const { period } = params;
  if (!PERIOD_RE.test(period)) return fail('ประจำเดือนต้องเป็นรูปแบบ YYYY-MM', 400);
  if (!['hr', 'admin', ...SIGNER_ROLES].includes(user.role)) {
    return fail('ไม่มีสิทธิ์ใช้งานส่วนนี้', 403);
  }

  const q = query(req);
  const policy = await Setting.effectivePolicy();
  const filter = { period };
  // Every department this หัวหน้า signs for, not only their own — the same list
  // `isDepartmentManager` decides each row from. A report narrower than the
  // approve rule hides hours its reader is responsible for.
  if (isSigner(user.role)) filter.department = { $in: approvalDepartments(user) };
  else if (q.department) filter.department = q.department;
  // Withdrawn and refused requests are not on any report, whatever the URL asks
  // for — see `reportStatuses`.
  filter.status = { $in: reportStatuses(q.status) };

  /**
   * `birthDate` is selected but never returned — see `withoutBirthDate` below.
   *
   * It is pulled only to answer one yes/no question: is this person's birthday
   * on record at all. With the birthday rule on, an employee with no birthDate
   * is computed as though no weekday of theirs was ever a holiday, and that
   * looks exactly like an employee whose birthday simply fell on a Sunday. The
   * difference is that one of them is right and the other is a gap in the
   * roster, and only HR can close it.
   */
  const found = await OtEntry.find(filter)
    .populate('employee', 'code name position birthDate company')
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
  const all = isSigner(user.role) && user.approvesCompany
    ? found.filter((e) => signsForCompany(user, companyOf(e.employee)))
    : found;

  // A session filed twice is one session. Only the latest filing counts, here
  // and on the printed form, so a total on this screen can be checked against
  // the sheet it prints without the two ever disagreeing.
  const { shown: entries, hidden } = latestPerSession(all);

  /**
   * The SAME month counted the way a ceiling counts it — every request still
   * alive, whatever สถานะที่นับ is set to.
   *
   * The เพดาน column shows the filtered hours (16.5 at the default filter) and
   * coloured itself from them, against a ceiling that honours no filter. So a
   * department with 35.5 of its 40 hours already committed printed in black,
   * because 19 of those hours were in a queue this screen was not looking at.
   * The colour is what a reader takes in before any of the words, and it was
   * saying the opposite of the truth.
   *
   * One read for the whole screen, skipped entirely at the widest filter, and
   * shared with สรุปรายเดือน (CSV) so the file and the screen cannot come to
   * different conclusions about the same month — see `capEntriesByEmployee`.
   */
  const capByEmployee = await capEntriesByEmployee(filter, { inHand: all });

  const byEmployee = new Map();
  for (const entry of entries) {
    const key = String(entry.employee?._id);
    if (!byEmployee.has(key)) {
      byEmployee.set(key, { employee: entry.employee, department: entry.department, entries: [] });
    }
    byEmployee.get(key).entries.push(entry);
  }

  // Edits are tallied over `all`, not over the deduplicated `entries`: the
  // count leads to a list of this employee's corrections, and that list is
  // every entry of theirs in the month. A superseded filing never appears in
  // anybody's hours, but it was still corrected, and hiding the correction
  // would leave the count and the list it opens disagreeing.
  const filedByEmployee = new Map();
  for (const entry of all) {
    const key = String(entry.employee?._id);
    if (!filedByEmployee.has(key)) filedByEmployee.set(key, []);
    filedByEmployee.get(key).push(entry);
  }

  /**
   * The rule sets this month's figures were produced under.
   *
   * Loaded from the entries that actually count — the deduplicated ones — so
   * the warning describes the numbers on the screen rather than every document
   * the query happened to return. Only the versions in use are fetched: a
   * system with two years of policy history has no business shipping all of it
   * to draw one banner.
   */
  const usedVersionIds = [...new Set(entries.map(versionIdOf).filter(Boolean))];
  const policyVersions = usedVersionIds.length
    ? await PolicyVersion.find({ _id: { $in: usedVersionIds } })
      .select('seq policy note createdAt createdByName').lean()
    : [];

  /**
   * This screen is open to managers as well as HR, and a manager has no
   * business receiving their team's dates of birth — the same rule as the
   * roster endpoint (`publicEmployee` in lib/employees.js). What leaves here is
   * the boolean, never the date.
   */
  const withoutBirthDate = (employee) => {
    if (!employee) return employee;
    const { birthDate, ...rest } = employee;
    return rest;
  };

  const employees = [...byEmployee.values()].map((group) => {
    const summary = summariseEntries(group.entries);
    const capHours = group.department?.monthlyCapHours ?? null;
    /**
     * The "16.5 / 40" on this screen, counted by the function every other
     * monthly figure is counted by — `usageInMonth`, through `capColumn`.
     *
     * It was three lines here and the same three lines in `monthlyUsage`, and
     * they agreed. They now agree because they are one function, which is what
     * the approval queue needed before it could show the same figure beside a
     * row: two screens quoting a person's month at each other have to be
     * quoting the same arithmetic, or the day they diverge nobody can say which
     * is the real total.
     *
     * TWO SETS GO IN, and that is the whole of the cap column's repair. `shown`
     * is what สถานะที่นับ selected and is what gets printed; `live` is the same
     * month as the ceiling counts it, and is what the colour is decided from. A
     * warning worked out from the filtered half was a false negative by
     * construction — see `capColumn` in lib/caps.js.
     *
     * Both sets are already through `latestPerSession`; running it again inside
     * changes nothing (a deduplicated set deduplicates to itself) and keeps
     * these calls identical to every other one.
     */
    const cap = capColumn({
      shown: group.entries,
      live: capByEmployee.get(String(group.employee?._id)) || [],
      capHours,
      policy,
    });
    return {
      employee: withoutBirthDate(group.employee),
      /** No วันเกิด on record — their weekdays can never become holidays. */
      birthDateMissing: !group.employee?.birthDate,
      department: group.department,
      entryCount: group.entries.length,
      pendingCount: group.entries.filter((e) => e.status !== 'approved').length,
      /** { count, hrCount, lastAt } — corrections made after filing (§6). */
      edits: editTally(filedByEmployee.get(String(group.employee?._id)) || []),
      /**
       * Hours ฝ่ายบุคคล filed and approved in one act, off the scan record.
       *
       * Counted per person because of who reads this screen. For a หัวหน้า it is
       * สรุปทีม, and these are hours that appeared under their team's name
       * without them pressing anything — the one figure on the page they cannot
       * account for by remembering what they approved. A count they can see
       * beside the name turns that from a discrepancy into a row to open.
       */
      hrVerified: group.entries.filter(isHrVerifiedBirthday).length,
      /** Which rules produced this person's hours — and whether that is one set. */
      policy: versionSpread(group.entries, policyVersions),
      summary,
      hrSection: hrSummary(summary, policy),
      /**
       * `usedHours` is what the screen prints — the hours สถานะที่นับ selected,
       * unchanged, because a column that quietly started showing pending hours
       * would be a different report and this one is what HR signs.
       * `capUsedHours` is what the colour is decided from. They are equal at
       * the widest filter and in any month with nothing pending, and the cell
       * says nothing extra when they are.
       */
      cap,
    };
  }).sort((a, b) => a.employee.code.localeCompare(b.employee.code));

  const grand = summariseEntries(entries);
  return json({
    period,
    employees,
    grandTotal: grand,
    hrSection: hrSummary(grand, policy),
    /** Superseded filings left out of every figure above — reported, not silent. */
    supersededCount: hidden.length,
    /**
     * The same count for the whole month, so the screen can explain the marks
     * once above the table rather than repeating the sentence on every row that
     * wears one. Zero on nearly every month, and the section renders nothing.
     */
    hrVerifiedCount: entries.filter(isHrVerifiedBirthday).length,
    /**
     * The roster gap the birthday rule creates, counted so the screen can say
     * it out loud.
     *
     * Reported whether or not the rule is on, because HR filling the dates in
     * BEFORE it is turned on is the only way to avoid a month that has to be
     * replayed afterwards. `ruleEnabled` is what decides whether the screen
     * treats it as a warning or as housekeeping.
     */
    birthDates: {
      ruleEnabled: Boolean(policy.birthdayHolidayEnabled),
      missing: employees.filter((e) => e.birthDateMissing).length,
      /** Who, so HR has a list to work from rather than a number. */
      missingFor: employees
        .filter((e) => e.birthDateMissing)
        .map((e) => ({ code: e.employee?.code, name: e.employee?.name })),
    },
    /**
     * The month as a whole. Two employees each computed consistently under a
     * different version is still a month that does not add up the same way
     * throughout, and it is the total at the bottom of this table that gets
     * signed — so the spread is taken over every counted entry, not per row.
     */
    policy: {
      ...versionSpread(entries, policyVersions),
      /** So the banner can name the versions rather than print two object ids. */
      versions: policyVersions.map((v) => ({
        _id: v._id,
        seq: v.seq,
        note: v.note,
        createdAt: v.createdAt,
        createdByName: v.createdByName,
      })),
    },
  });
});
