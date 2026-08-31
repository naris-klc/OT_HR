import { route, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { periodState } from '@/lib/periodStatusQuery.js';
import { isPeriod } from '@/lib/periodStatus.js';

/**
 * What one month still has outstanding — the summary ฝ่ายบุคคล read before they
 * print it.
 *
 * READABLE BY EVERYBODY who is signed in, deliberately. How a month stands is
 * not a secret: an employee wondering why their request has not appeared on a
 * sheet, and a หัวหน้า looking at an empty queue, are both asking the question
 * this answers.
 *
 * WHAT IT USED TO BE. Until 2026-08-31 this route reported ปิดงวด — whether the
 * month was locked, by whom, and the events behind it — and it had two siblings,
 * `close/route.js` and `reopen/route.js`, that changed that state. HR withdrew
 * the feature: the printed and signed F-HR-027 in the filing cabinet is the
 * record, so a second lock in the database bought nothing and made going back
 * into a month to fix a queried row an errand for an administrator. The counts
 * this reply carries were always the useful half; they are now all of it. See
 * lib/periodStatus.js.
 *
 * `pending` and `checks` are BOTH kept at the top level, unchanged in shape from
 * when a lock lived here. Nothing else reads them today, but they are what the
 * reply has always meant and the reply is a superset of the old one — a screen
 * or a script written against the old shape sees a missing `lock` and `closed`,
 * not a renamed count.
 */
export const GET = route(async (req, { params }) => {
  await requireAuth(req);
  if (!isPeriod(params.period)) return fail('รูปแบบงวดไม่ถูกต้อง (YYYY-MM)', 400);

  const state = await periodState(params.period);
  return json({ ...state, pending: state.checks.pending });
});
