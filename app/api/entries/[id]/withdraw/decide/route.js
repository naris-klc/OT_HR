import OtEntry from '@/src/models/OtEntry.js';
import { SIGNER_ROLES } from '@/lib/roles.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { POPULATE, DECIDE_POPULATE } from '@/lib/entries.js';
import { withdrawDecisionPermission, withdrawalDecision } from '@/lib/withdrawal.js';
import { historyExtra } from '@/lib/delegation.js';
import { heldBy, today } from '@/lib/delegationQuery.js';

/**
 * อนุมัติ หรือ ปฏิเสธ คำขอถอนใบ.
 *
 * One route for both answers, and deliberately not two files the way `approve`
 * and `reject` are. Those two differ in what they write — a manager's decision
 * block versus a rejection reason, two steps versus one. These differ in one
 * boolean: the same people may answer, the same entry is read, the same period
 * lock applies, and the only thing that changes is whether the status moves to
 * `cancelled`. Splitting them would mean two copies of one rule, which is the
 * shape `approvalPermission` was written to get rid of.
 *
 * Granting is the act that takes signed-off hours off the books, so it is
 * `authorizeReplay`-adjacent in spirit even though it is not a replay: the
 * money moves. What makes it safe is that it cannot happen without a matching
 * request from the employee, recorded before it, with a reason.
 */
export const POST = route(async (req, { params }) => {
  const user = requireRole(await requireAuth(req), ...SIGNER_ROLES, 'hr', 'admin');
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id).populate(DECIDE_POPULATE);
  if (!entry) return fail('ไม่พบรายการ', 404);

  const granted = Boolean(payload?.granted);
  const verb = granted ? 'อนุมัติ' : 'ปฏิเสธ';

  const on = today();
  const may = withdrawDecisionPermission({
    user,
    entry,
    delegations: await heldBy(user, on),
    today: on,
    verb,
  });
  if (!may.ok) return fail(may.error, may.status);

  const from = entry.status;
  entry.withdrawal = withdrawalDecision(entry.withdrawal.toObject(), user, {
    granted,
    note: payload?.note,
    resolved: may,
  });

  /**
   * Granted ends at `cancelled` — the status every rollup, cap calculation and
   * report already reads as "these hours do not count". No new status, so no
   * query anywhere has to learn a sixth value.
   *
   * Refused ends exactly where it started. The entry was never moved while the
   * request was open, so there is nothing to put back.
   */
  if (granted) entry.status = 'cancelled';

  entry.log(
    user,
    granted ? 'withdraw_grant' : 'withdraw_refuse',
    payload?.note,
    from,
    null,
    historyExtra(may),
  );
  await entry.save();

  return json({ entry: await entry.populate(POPULATE) });
});
