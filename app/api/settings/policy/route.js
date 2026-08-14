import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { savePolicy } from '@/lib/policySave.js';

/**
 * Answering an [OPEN] item at runtime.
 *
 * Changing an arithmetic flag (break, rounding, minimum) changes what stored
 * entries mean, so entries still in flight are replayed through the engine.
 * Approved entries are left alone by default — they have been signed off, and
 * silently restating a signed number is worse than an inconsistency. Pass
 * `recompute: 'all'`, with a `note`, to replay those too.
 *
 * Either way the rules themselves are recorded first: every save that changes
 * the policy appends a row to otPolicyVersions, and every entry computed from
 * then on carries its id. That is what makes "which rules produced this figure"
 * answerable in December about a figure written in March — the flags in this
 * document only ever describe the present.
 *
 * The sequence lives in lib/policySave.js, shared with the Express router.
 */
export const PATCH = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'admin', 'hr');
  const payload = await body(req);

  const result = await savePolicy({
    incoming: payload?.policy || {},
    actor: user,
    recompute: payload?.recompute,
    note: payload?.note,
    /**
     * The day the new rules start. Absent means today; a future date is HR
     * announcing a change ahead of it, which is how a change to overtime pay is
     * supposed to reach the people it affects. A past date is refused inside
     * `savePolicy` — see `effectiveFromRefusal`.
     */
    effectiveFrom: payload?.effectiveFrom,
  });
  if (result.error) return fail(result.error, result.status);

  return json(result);
});
