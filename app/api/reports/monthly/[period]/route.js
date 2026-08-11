import OtEntry from '@/src/models/OtEntry.js';
import PolicyVersion from '@/src/models/PolicyVersion.js';
import Setting from '@/src/models/Setting.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { summariseEntries, hrSummary } from '@/src/lib/otEngine.js';
import { PERIOD_RE, latestPerSession, editTally, reportStatuses } from '@/lib/reports.js';
import { overCap, usageInMonth } from '@/lib/caps.js';
import { isHrVerifiedBirthday } from '@/lib/entries.js';
import { versionIdOf, versionSpread } from '@/lib/policyVersion.js';

/** HR's monthly review: every employee's totals for a period, in one table. */
export const GET = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const { period } = params;
  if (!PERIOD_RE.test(period)) return fail('ประจำเดือนต้องเป็นรูปแบบ YYYY-MM', 400);
  if (!['hr', 'admin', 'manager'].includes(user.role)) {
    return fail('ไม่มีสิทธิ์ใช้งานส่วนนี้', 403);
  }

  const q = query(req);
  const policy = await Setting.effectivePolicy();
  const filter = { period };
  if (user.role === 'manager') filter.department = user.department?._id;
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
  const all = await OtEntry.find(filter)
    .populate('employee', 'code name position birthDate')
    .populate('department', 'code name nameTh monthlyCapHours weeklyCapHours')
    .lean();

  // A session filed twice is one session. Only the latest filing counts, here
  // and on the printed form, so a total on this screen can be checked against
  // the sheet it prints without the two ever disagreeing.
  const { shown: entries, hidden } = latestPerSession(all);

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
     * monthly figure is counted by — see `usageInMonth` in lib/caps.js.
     *
     * It was three lines here and the same three lines in `monthlyUsage`, and
     * they agreed. They now agree because they are one function, which is what
     * the approval queue needed before it could show the same figure beside a
     * row: two screens quoting a person's month at each other have to be
     * quoting the same arithmetic, or the day they diverge nobody can say which
     * is the real total.
     *
     * `group.entries` is already through `latestPerSession` above; running it
     * again inside changes nothing (a deduplicated set deduplicates to itself)
     * and keeps this call identical to every other one.
     */
    const used = usageInMonth(group.entries, policy).usedHours;
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
      // `overCap` rather than the comparison spelt out: the queue colours its
      // own figure red on this exact test, and a threshold written twice is a
      // threshold that can be changed once.
      cap: { capHours, usedHours: used, exceeded: overCap(used, capHours), basis: policy.capBasis },
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
