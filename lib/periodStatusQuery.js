/**
 * Counting what a month still has outstanding, so that lib/periodStatus.js
 * never has to.
 *
 * The split is the same one lib/delegationQuery.js makes beside
 * lib/delegation.js, and for the same reason: the rules stay pure and
 * exhaustively testable, and the one module that talks to Mongo stays small
 * enough to read in a sitting.
 *
 * THIS FILE IS READ-ONLY AND ALWAYS WILL BE. Its predecessor
 * (lib/periodLockQuery.js) also answered "may this write go ahead", because
 * ปิดงวด could refuse one. Nothing here refuses anything now — see the header of
 * lib/periodStatus.js for why the lock was withdrawn — so a `countDocuments`
 * and an aggregate is the whole of it.
 */
import OtEntry from '@/src/models/OtEntry.js';
import { PENDING_STATUSES, periodSummary } from './periodStatus.js';
import { departmentScope } from './reports.js';
import { teamReportFilter } from './delegationQuery.js';
import { signsForCompany } from './entries.js';
import { companyOf } from '@/src/config/companies.js';

/**
 * How many requests in this period are still waiting for somebody.
 *
 * The summary names the number, not just the fact — "ยังมีใบรออนุมัติค้างอยู่ 4
 * ใบ" is something ฝ่ายบุคคล can act on and "there are some" is not.
 */
export async function pendingInPeriod(period) {
  return OtEntry.countDocuments({ period, status: { $in: PENDING_STATUSES } });
}

/**
 * Everything the status card needs, in one round trip.
 *
 * `$facet` rather than four `countDocuments` calls, because the card is re-read
 * on every render of ตรวจสอบรายเดือน and four sequential round trips to answer
 * one question is three too many.
 *
 * It was FIVE until 2026-09-18. `openWithdrawals` counted `withdrawal.state:
 * 'requested'` and fed the one outstanding line on this card that could not
 * clear itself; withdrawing no longer waits for anybody, so that state is not
 * produced any more — see lib/periodStatus.js.
 *
 * The two counted for review are narrowed to `approved` deliberately. A flagged
 * request that is still pending is already covered by `pending` — it would be
 * counted twice and named twice on the same card — and a flagged one that was
 * refused or withdrawn is not something anybody needs to look at before
 * printing.
 */
export async function periodChecks(period, team = null) {
  if (team) return teamChecks(period, team);
  const [facets] = await OtEntry.aggregate([
    { $match: { period } },
    {
      $facet: {
        /* Every entry in the month, whatever its state. Not an outstanding
           item — nothing about it needs answering — but the one figure that
           tells a month somebody worked from a month that never existed. The
           reminder about last month needs it: nagging about every month back
           to the epoch is how a prompt gets ignored. */
        entries: [{ $count: 'n' }],
        pending: [{ $match: { status: { $in: PENDING_STATUSES } } }, { $count: 'n' }],
        capExceeded: [{ $match: { status: 'approved', capExceeded: true } }, { $count: 'n' }],
        belowMinimum: [{ $match: { status: 'approved', belowMinimumFlagged: true } }, { $count: 'n' }],
      },
    },
  ]);

  const n = (key) => facets?.[key]?.[0]?.n ?? 0;
  return {
    entries: n('entries'),
    pending: n('pending'),
    capExceeded: n('capExceeded'),
    belowMinimum: n('belowMinimum'),
  };
}

/**
 * WHOSE MONTH — the team a รายงาน OT ประจำทีม reader signs for, or `null` for
 * the whole company. Since 2026-10-11.
 *
 * The card counted the whole company on every screen, so รายงาน OT ประจำทีม of
 * การเงิน read "มีใบรออนุมัติค้างอยู่ 88 ใบ" above a table whose แผนก held 6.
 * ผู้ใช้สั่ง *"ให้นับเฉพาะแผนกและพนักงานที่ผู้ดูอนุมัติ"*.
 *
 * THE SAME THREE STEPS app/api/reports/monthly/[period] TAKES, in the same
 * order, so the card and the table under it count one set of people:
 * `departmentScope` (the แผนก signed for, or the one picked), `teamReportFilter`
 * (ผู้อนุมัติรายคน in and out), then the payroll half (`approvesCompany`),
 * which only the populated employee can answer and so comes back as `keep`.
 *
 * Narrows and never widens, for the reason `departmentScope` gives: a reader
 * who is not team-scoped gets `null` — the company count every signed-in
 * reader got before — whatever the query asks for.
 */
export async function teamPeriodScope(user, q) {
  const { teamOnly, department } = departmentScope(user, q);
  if (!teamOnly) return null;
  const filter = await teamReportFilter(user, department ? { department } : {}, q.department ? String(q.department) : '');
  const keep = user.approvesCompany ? (employee) => signsForCompany(user, companyOf(employee)) : null;
  return { filter, keep };
}

/**
 * The four counts of `periodChecks` over one team. A find rather than the
 * aggregate, because `keep` needs the employee populated; a team's month is
 * tens of rows, not the company's thousands.
 */
async function teamChecks(period, { filter, keep }) {
  let rows = OtEntry.find({ ...filter, period }).select('status capExceeded belowMinimumFlagged employee');
  if (keep) rows = rows.populate('employee', 'code company');
  let found = await rows.lean();
  if (keep) found = found.filter((e) => keep(e.employee));
  const approved = found.filter((e) => e.status === 'approved');
  return {
    entries: found.length,
    pending: found.filter((e) => PENDING_STATUSES.includes(e.status)).length,
    capExceeded: approved.filter((e) => e.capExceeded).length,
    belowMinimum: approved.filter((e) => e.belowMinimumFlagged).length,
  };
}

/** The counts, plus the sentences the screens print about them. */
export async function periodState(period, team = null) {
  const checks = await periodChecks(period, team);
  return { ...periodSummary({ period, checks }), checks };
}
