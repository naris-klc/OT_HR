import Setting from '@/src/models/Setting.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { unconfirmedState, normaliseConfirmNote } from '@/lib/policyConfirmations.js';
import { confirmPolicyItem } from '@/lib/policyConfirmSave.js';

/**
 * The rules HR has not agreed to, and the one action that changes that.
 *
 * Separate from /settings/policy on purpose. That route answers an [OPEN] item
 * by changing a value, which records a version and replays what may be
 * replayed; this one records that a value the system already had is now
 * somebody's decision. Routing both through savePolicy would have made a
 * sign-off indistinguishable from a rule change in the version history — a row
 * whose diff is empty, dated the day HR read the page.
 *
 * So: no policy value is read from the request, and none is written. See
 * lib/policyConfirmations.js.
 */
export const GET = route(async (req) => {
  requireRole(await requireAuth(req), 'admin', 'hr');
  const doc = await Setting.load();
  return json({
    items: unconfirmedState(await Setting.effectivePolicy(), doc.policyConfirmations || {}),
  });
});

export const POST = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'admin', 'hr');
  const payload = await body(req);

  /**
   * ที่มาของคำตอบ — optional, and refused rather than truncated when it is too
   * long. A sign-off is a record somebody may read in a year; silently keeping
   * the first 300 characters of what they wrote would put words in their mouth
   * and cut the sentence that mattered.
   */
  const note = normaliseConfirmNote(payload?.note);
  if (note.error) return fail(note.error, 400);

  const result = await confirmPolicyItem({ id: payload?.id, actor: user, note: note.value });
  if (result.error) return fail(result.error, result.status);

  return json(result);
});
