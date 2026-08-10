import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { POPULATE, cancelPermission } from '@/lib/entries.js';

/**
 * §6: own request, while nobody has approved it.
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

  const allowed = cancelPermission(user, entry);
  if (!allowed.ok) return fail(allowed.error, allowed.status);

  const from = entry.status;
  entry.status = 'cancelled';
  entry.log(user, 'cancel', payload?.note, from);
  await entry.save();
  return json({ entry: await entry.populate(POPULATE) });
});
