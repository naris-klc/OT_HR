import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { recomputeEntries } from '@/src/services/otService.js';
import { authorizeReplay } from '@/lib/policyVersion.js';

/**
 * Manual replay — useful after a bulk holiday import or a data fix.
 *
 * Approved entries are not replayed unless `includeApproved` is asked for by an
 * admin with a `note` saying why — `authorizeReplay`, the same rule and the same
 * function the settings page goes through. Passing `status=approved` alone
 * therefore reports them as skipped rather than quietly restating signed-off
 * hours; the response names every one it left, so a caller expecting a number
 * can see where it went.
 *
 * Every run is recorded in otPolicyReplayRuns, including the ones that changed
 * nothing — see recomputeEntries. The write is not allowed to fail the replay,
 * so the response carries `auditLogged`: false means the entries moved and
 * nothing in the operation log will ever show it.
 */
export const POST = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'admin', 'hr');
  const payload = await body(req);

  const filter = {};
  if (payload?.period) filter.period = payload.period;
  if (payload?.status) filter.status = { $in: String(payload.status).split(',') };

  const includeApproved = Boolean(payload?.includeApproved);
  const note = payload?.note;

  const allowed = authorizeReplay({ actor: user, includeApproved, note });
  if (!allowed.ok) return fail(allowed.error, allowed.status);

  return json(await recomputeEntries(filter, user, { includeApproved, note, source: 'manual' }));
});
