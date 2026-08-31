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
 * `$facet` rather than five `countDocuments` calls, because the card is re-read
 * on every render of ตรวจสอบรายเดือน and five sequential round trips to answer
 * one question is four too many.
 *
 * The two counted for review are narrowed to `approved` deliberately. A flagged
 * request that is still pending is already covered by `pending` — it would be
 * counted twice and named twice on the same card — and a flagged one that was
 * refused or withdrawn is not something anybody needs to look at before
 * printing.
 */
export async function periodChecks(period) {
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
        openWithdrawals: [{ $match: { 'withdrawal.state': 'requested' } }, { $count: 'n' }],
        capExceeded: [{ $match: { status: 'approved', capExceeded: true } }, { $count: 'n' }],
        belowMinimum: [{ $match: { status: 'approved', belowMinimumFlagged: true } }, { $count: 'n' }],
      },
    },
  ]);

  const n = (key) => facets?.[key]?.[0]?.n ?? 0;
  return {
    entries: n('entries'),
    pending: n('pending'),
    openWithdrawals: n('openWithdrawals'),
    capExceeded: n('capExceeded'),
    belowMinimum: n('belowMinimum'),
  };
}

/** The counts, plus the sentences the screens print about them. */
export async function periodState(period) {
  const checks = await periodChecks(period);
  return { ...periodSummary({ period, checks }), checks };
}
