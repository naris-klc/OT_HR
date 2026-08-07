import OtEntry from '@/src/models/OtEntry.js';
import PolicyVersion from '@/src/models/PolicyVersion.js';
import Setting from '@/src/models/Setting.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { summariseEntries, hrSummary, capUsage } from '@/src/lib/otEngine.js';
import { PERIOD_RE, latestPerSession, editTally } from '@/lib/reports.js';
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
  filter.status = { $in: String(q.status || 'approved,pending_hr,pending_mgr').split(',') };

  const all = await OtEntry.find(filter)
    .populate('employee', 'code name position')
    .populate('department', 'code name nameTh monthlyCapHours')
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

  const employees = [...byEmployee.values()].map((group) => {
    const summary = summariseEntries(group.entries);
    const capHours = group.department?.monthlyCapHours ?? null;
    const used = capUsage(summary, policy);
    return {
      employee: group.employee,
      department: group.department,
      entryCount: group.entries.length,
      pendingCount: group.entries.filter((e) => e.status !== 'approved').length,
      /** { count, hrCount, lastAt } — corrections made after filing (§6). */
      edits: editTally(filedByEmployee.get(String(group.employee?._id)) || []),
      /** Which rules produced this person's hours — and whether that is one set. */
      policy: versionSpread(group.entries, policyVersions),
      summary,
      hrSection: hrSummary(summary, policy),
      cap: { capHours, usedHours: used, exceeded: capHours != null && used > capHours, basis: policy.capBasis },
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
