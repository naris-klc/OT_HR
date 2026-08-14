import { route, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { lockState, pendingInPeriod } from '@/lib/periodLockQuery.js';
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
 * `pending` rides along because the screen that closes a month needs it before
 * it can offer the button — `closeRefusal` counts it as the reason to say no,
 * and a button that is going to be refused should not be offered in the first
 * place.
 */
export const GET = route(async (req, { params }) => {
  await requireAuth(req);
  if (!isPeriod(params.period)) return fail('รูปแบบงวดไม่ถูกต้อง (YYYY-MM)', 400);

  const state = await lockState(params.period);
  return json({ ...state, pending: await pendingInPeriod(params.period) });
});
