import { route, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { closeChecks, lockState } from '@/lib/periodLockQuery.js';
import { isPeriod } from '@/lib/periodLock.js';

/**
 * Where one month stands: open, closed, or opened again — and by whom.
 *
 * READABLE BY EVERYBODY who is signed in, deliberately. Whether a month is
 * finished is not a secret: an employee whose request was refused with "งวดนี้
 * ปิดแล้ว" should be able to see the same fact on the screen they filed from,
 * and a หัวหน้า looking at an empty queue should be able to tell a quiet month
 * from a closed one.
 *
 * `checks` rides along because the screen that closes a month needs the counts
 * before it can offer the button — `closeRefusal` reads two of them as reasons
 * to say no, and a button that is going to be refused should not be offered in
 * the first place. The other two are `closeWarnings`, which do not stop
 * anything and are printed so nobody freezes a month without having seen them.
 *
 * `pending` is ALSO returned at the top level, unchanged. It was the shape
 * before `checks` existed and PeriodLockBar reads it; keeping it means this
 * reply is a superset of the old one rather than a rename that breaks a screen
 * on the way past.
 */
export const GET = route(async (req, { params }) => {
  await requireAuth(req);
  if (!isPeriod(params.period)) return fail('รูปแบบงวดไม่ถูกต้อง (YYYY-MM)', 400);

  const [state, checks] = await Promise.all([
    lockState(params.period),
    closeChecks(params.period),
  ]);
  return json({ ...state, pending: checks.pending, checks });
});
