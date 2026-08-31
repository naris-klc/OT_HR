import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { POPULATE } from '@/lib/entries.js';
import { withdrawRequestPermission, withdrawalRequest } from '@/lib/withdrawal.js';

/**
 * ขอถอนใบ — the employee asking for a signed entry to be taken back.
 *
 * Asking only. The entry does not move: it stays `approved`, its hours stay on
 * the books and in the department's cap usage, and it keeps printing on
 * F-HR-027 until somebody answers. That is the point rather than an omission —
 * a request that removed the hours the moment it was made would let one person
 * take back a figure two people signed, which is the thing this feature exists
 * to stop happening by phone call.
 *
 * The rule is `withdrawRequestPermission`, beside `cancelPermission`, and the
 * two are worth reading together: they divide at the first signature and cover
 * everything between them with no gap and no overlap.
 */
export const POST = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id);
  if (!entry) return fail('ไม่พบรายการ', 404);

  const may = withdrawRequestPermission(user, entry, payload?.reason);
  if (!may.ok) return fail(may.error, may.status);

  entry.withdrawal = withdrawalRequest(user, may.reason);
  /**
   * `fromStatus` and `toStatus` are the same value here, and this is the only
   * action in the enum for which that is true. It is recorded anyway: the row
   * is what makes "asked on the 14th, released on the 16th" readable, and a
   * trail that logged only the release would put the employee's reason nowhere
   * and leave the two days between looking like nothing happened.
   */
  entry.log(user, 'withdraw_request', may.reason, entry.status);
  await entry.save();

  return json({ entry: await entry.populate(POPULATE) });
});
