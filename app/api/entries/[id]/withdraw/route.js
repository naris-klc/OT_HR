import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { POPULATE } from '@/lib/entries.js';
import { withdrawPermission, withdrawalRecord } from '@/lib/withdrawal.js';
import Setting from '@/src/models/Setting.js';

/**
 * ถอนใบ — the employee taking a signed entry of their own back off the books.
 *
 * **It used to only ASK.** Until 2026-09-18 this route wrote a `requested`
 * subdocument and moved nothing: the entry stayed `approved`, its hours stayed
 * in the department's cap usage and on F-HR-027, and a signer had to answer at
 * `/withdraw/decide` before anything changed. That second act is gone, the
 * route with it, and the reasoning is at the top of lib/withdrawal.js.
 *
 * One press, one act, and the row is `cancelled` when the response returns.
 *
 * The rule is `withdrawPermission`, beside `cancelPermission`, and the two are
 * worth reading together: they divide at the first signature and cover
 * everything between them with no gap and no overlap. The employee reaching
 * this route BEFORE the first signature is sent to ยกเลิก by name rather than
 * refused, because that button is on the screen they are already looking at.
 */
export const POST = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id);
  if (!entry) return fail('ไม่พบรายการ', 404);

  /**
   * Straight through `withdrawEligibility`, which is where the month wall sits
   * — and since this press no longer waits for anybody, that wall is the only
   * thing standing between `approved` and `cancelled`. `policy` is read here
   * and not trusted from the client for the ordinary reason: a gate that lives
   * on a screen is a gate `curl` walks past.
   */
  const may = withdrawPermission(user, entry, payload?.reason, {
    policy: await Setting.effectivePolicy(),
  });
  if (!may.ok) return fail(may.error, may.status);

  const from = entry.status;
  entry.withdrawal = withdrawalRecord(user, may.reason);
  entry.status = 'cancelled';

  /**
   * `withdraw`, its own action, and not `cancel`.
   *
   * Both end at `cancelled` and a trail that used one label for the two would
   * say พนักงานยกเลิกคำขอ about an entry a หัวหน้า had signed — the same
   * mistake `hr_cancel` exists to avoid on the other side of the same endpoint.
   * The distinction is not academic: `cancel` is a request nobody had looked at
   * yet, `withdraw` is hours that were on the books and are now not, and the
   * signer whose name is on the row is entitled to see which happened.
   *
   * The reason rides in the history row as well as in the subdocument, so
   * `EntryHistory` prints it without having to know about `withdrawal`.
   */
  entry.log(user, 'withdraw', may.reason, from);
  await entry.save();

  return json({ entry: await entry.populate(POPULATE) });
});
