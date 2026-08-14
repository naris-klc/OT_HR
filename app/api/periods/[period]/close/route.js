import PeriodLock from '@/src/models/PeriodLock.js';
import { route, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { closeRefusal, isPeriod } from '@/lib/periodLock.js';
import { lockFor, lockState, pendingInPeriod } from '@/lib/periodLockQuery.js';

/**
 * ปิดงวด — ฝ่ายบุคคล declaring a month finished.
 *
 * From here every write path in the system refuses that month: no edit, no
 * withdrawal, no approval, no refusal, no new request, no birthday filing. See
 * lib/periodLock.js for the rules and test/periodLockRoutes.test.js for the
 * list of paths that enforce them.
 *
 * NO ROLE CHECK IN THIS FILE. `closeRefusal` decides who may close, and it is
 * the same function the screen calls to decide whether to draw the button —
 * a `requireRole` here as well would be a second copy of the rule, which is how
 * a screen and a server end up disagreeing about who may do something.
 */
export const POST = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const period = params.period;
  if (!isPeriod(period)) return fail('รูปแบบงวดไม่ถูกต้อง (YYYY-MM)', 400);

  /**
   * The count is read before the refusal rather than inside it, because a month
   * with requests still waiting is the one refusal HR can do something about —
   * and the sentence names the number so they know how much.
   */
  const refusal = closeRefusal({
    user,
    lock: await lockFor(period),
    pendingCount: await pendingInPeriod(period),
    period,
  });
  if (refusal) return fail(refusal.error, refusal.status);

  /**
   * Upsert, because a month closed for the first time has no document yet — an
   * absent row is what "never closed" looks like, so that no month predating
   * this feature had to be migrated into one.
   *
   * `$push` rather than a rewrite: `events` is the record of how this month
   * came to be the way it is, and a close after a reopen has to sit behind the
   * reopen rather than replace it.
   */
  const at = new Date();
  await PeriodLock.findOneAndUpdate(
    { period },
    {
      $set: { state: 'closed', closedAt: at, closedBy: user._id, closedByName: user.name },
      $push: { events: { action: 'close', at, by: user._id, byName: user.name } },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return json(await lockState(period));
});
