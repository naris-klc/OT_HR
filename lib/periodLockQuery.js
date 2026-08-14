/**
 * Reading the lock, so that lib/periodLock.js never has to.
 *
 * The split is the same one lib/delegationQuery.js makes beside
 * lib/delegation.js, and for the same reason: the rules stay pure and
 * exhaustively testable, and the one module that talks to Mongo stays small
 * enough to read in a sitting.
 */
import PeriodLock from '@/src/models/PeriodLock.js';
import OtEntry from '@/src/models/OtEntry.js';
import { PENDING_STATUSES, lockRefusal, lockSummary } from './periodLock.js';

/** The lock document for one period, or null — which means never closed. */
export async function lockFor(period) {
  if (!period) return null;
  return PeriodLock.findOne({ period }).lean();
}

/**
 * "Is this month closed, and if so, say no" — one call, at the top of every
 * route that writes.
 *
 * Returns null when the write may go ahead, or a `{ status, error }` ready for
 * `fail()`. Written as one helper rather than as a check inside
 * `editPermission` and its two siblings because it is the only rule in the
 * system that needs a database read to answer: folding it into those functions
 * would make three pure, heavily tested rules asynchronous and give them a
 * Mongo dependency they have never had.
 *
 * The cost of that choice is that a route which forgets to call this is a route
 * with no lock, and nothing in the type system will say so. The list of callers
 * is pinned by test/periodLockRoutes.test.js, which reads the route files.
 */
export async function refusePeriodLock(period, verb) {
  return lockRefusal({ lock: await lockFor(period), period, verb });
}

/**
 * How many requests in this period are still waiting for somebody.
 *
 * `closeRefusal` needs the number, not just the fact, because the refusal names
 * it — "ยังมีใบค้างอนุมัติ 3 ใบ" is something HR can act on and "there are some"
 * is not.
 */
export async function pendingInPeriod(period) {
  return OtEntry.countDocuments({ period, status: { $in: PENDING_STATUSES } });
}

/**
 * Everything `closeRefusal` and `closeWarnings` need, in one round trip.
 *
 * `$facet` rather than four `countDocuments` calls, because the close button's
 * state is re-read on every render of ตรวจสอบรายเดือน and four sequential
 * round trips to answer one question is three too many.
 *
 * The two counted for warnings are narrowed to `approved` deliberately. A
 * flagged request that is still pending is already covered by `pending` — it
 * would be counted twice and named twice on the same screen — and a flagged one
 * that was refused or withdrawn is not something anybody needs to look at
 * before closing.
 */
export async function closeChecks(period) {
  const [facets] = await OtEntry.aggregate([
    { $match: { period } },
    {
      $facet: {
        pending: [{ $match: { status: { $in: PENDING_STATUSES } } }, { $count: 'n' }],
        openWithdrawals: [{ $match: { 'withdrawal.state': 'requested' } }, { $count: 'n' }],
        capExceeded: [{ $match: { status: 'approved', capExceeded: true } }, { $count: 'n' }],
        belowMinimum: [{ $match: { status: 'approved', belowMinimumFlagged: true } }, { $count: 'n' }],
      },
    },
  ]);

  const n = (key) => facets?.[key]?.[0]?.n ?? 0;
  return {
    pending: n('pending'),
    openWithdrawals: n('openWithdrawals'),
    capExceeded: n('capExceeded'),
    belowMinimum: n('belowMinimum'),
  };
}

/** The lock, plus the one sentence the screens print about it. */
export async function lockState(period) {
  const lock = await lockFor(period);
  return { period, lock: lock || null, ...lockSummary(lock, period) };
}
