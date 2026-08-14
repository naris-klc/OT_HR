import PeriodLock from '@/src/models/PeriodLock.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { isPeriod, reopenRefusal } from '@/lib/periodLock.js';
import { lockFor, lockState } from '@/lib/periodLockQuery.js';

/**
 * เปิดงวดที่ปิดแล้ว — the administrator's key, and the only one there is.
 *
 * This is the single path in the system by which a figure that has been signed
 * off, exported to accounting and possibly paid becomes editable again. Three
 * things follow from that and all three are deliberate:
 *
 * ADMIN ONLY, not ฝ่ายบุคคล — who closed the month. If the role that closes can
 * also open, closing is a preference rather than a control, decided twice by
 * the same person with nobody else involved. Split, a correction to a closed
 * month always passes a second pair of hands. `authorizeReplay` in
 * lib/policyVersion.js draws the same line for the same reason.
 *
 * A REASON IS REQUIRED, and stored. Everything else about this event can be
 * reconstructed afterwards from the entries — what changed, when, by whom. Why
 * the month was opened cannot.
 *
 * IT DOES NOT CLOSE ITSELF AGAIN. The month stays open until somebody closes
 * it, and the screen says so in as many words (`lockSummary` prints "ปิดใหม่
 * เมื่อแก้เสร็จ"), because a lock that expired on a timer would quietly re-close
 * a month in the middle of the correction it was opened for.
 */
export const POST = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const period = params.period;
  if (!isPeriod(period)) return fail('รูปแบบงวดไม่ถูกต้อง (YYYY-MM)', 400);

  const reason = String((await body(req))?.reason || '').trim();
  const refusal = reopenRefusal({ user, lock: await lockFor(period), reason, period });
  if (refusal) return fail(refusal.error, refusal.status);

  const at = new Date();
  await PeriodLock.findOneAndUpdate(
    { period },
    {
      $set: {
        state: 'open',
        reopenedAt: at,
        reopenedBy: user._id,
        reopenedByName: user.name,
        reopenReason: reason,
      },
      $push: { events: { action: 'reopen', at, by: user._id, byName: user.name, reason } },
    },
    { new: true },
  );

  return json(await lockState(period));
});
