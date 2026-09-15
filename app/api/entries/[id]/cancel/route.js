import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { POPULATE, cancelPermission } from '@/lib/entries.js';
import { hasOpenWithdrawal, withdrawalDecision } from '@/lib/withdrawal.js';
import Setting from '@/src/models/Setting.js';

/**
 * §6: own request, while nobody has approved it — and, since 2026-09-15,
 * ฝ่ายบุคคล ending any live one with a reason.
 *
 * The rule itself is `cancelPermission`, beside `editPermission` — the two draw
 * the same line at the first approval and are worth reading together. This
 * route is left with the lookup and the history entry.
 *
 * The line is `awaitingFirstSignature` rather than a status, so a request a
 * หัวหน้า filed on this person's behalf — which starts at `pending_hr` having
 * been approved by nobody — is still theirs to withdraw. `findById` returns the
 * whole document, `managerDecision` included, which is what that rule reads.
 *
 * Withdrawing sets a status and nothing else. It deliberately does NOT touch
 * `resubmittedTo`: that field is the once-only lock on correcting a REFUSED
 * request, and withdrawing one's own request is not that. An employee may
 * cancel and file again as often as they like — see refileState, which returns
 * null for anything that was not rejected.
 */
export const POST = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id);
  if (!entry) return fail('ไม่พบรายการ', 404);

  /**
   * THIS ROUTE SERVES TWO ACTS, and the month wall must only reach one of them.
   * ฝ่ายบุคคล ending a live entry comes back as `action: 'hr_cancel'`, from the
   * branch at the top of the rule, and the reason is enforced there rather than
   * here — a gate that lives on the screen is a gate `curl` walks past. The rule
   * lets HR through before it reaches the cutoff, so the separation is already
   * right here — test/cancelCutoff.test.js pins it rather than leaving it a
   * by-product.
   */
  const allowed = cancelPermission(user, entry, payload?.note, {
    policy: await Setting.effectivePolicy(),
  });
  if (!allowed.ok) return fail(allowed.error, allowed.status);

  const from = entry.status;
  entry.status = 'cancelled';

  /**
   * ── AND AN OPEN คำขอถอน IS ANSWERED BY THE SAME PRESS ────────────────────
   *
   * Only ฝ่ายบุคคล can reach this: a request is open only after the first
   * signature, and past that the employee's own branch refuses. Left alone, the
   * subdocument would sit at `requested` on a row that is already `cancelled` —
   * `withdrawalOpen` in app/api/entries/queue-summary/route.js would keep
   * counting it on the nav badge and inside คำขอถอนใบ, and `periodItems`
   * (lib/periodStatus.js) would keep calling that month unfinished, for a
   * question that can no longer be answered by anybody.
   *
   * `granted` because that is what happened to the employee's request: the
   * entry they wanted off the books is off them. The same helper the decide
   * route uses, so the record has the same shape however it was reached, and
   * the reason typed here is the `decisionNote` — one sentence, not two.
   */
  if (hasOpenWithdrawal(entry)) {
    entry.withdrawal = withdrawalDecision(entry.withdrawal.toObject(), user, {
      granted: true,
      note: payload?.note,
    });
  }

  // Same outcome, two different events: the employee withdrawing their own
  // request, and ฝ่ายบุคคล ending one on everybody's behalf. The action comes
  // from the rule that allowed it rather than from the caller's role, so the
  // trail cannot say พนักงานยกเลิก about something a person in HR did — or the
  // reverse.
  entry.log(user, allowed.action, payload?.note, from);
  await entry.save();
  return json({ entry: await entry.populate(POPULATE) });
});
