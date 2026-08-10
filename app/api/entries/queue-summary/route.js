import OtEntry from '@/src/models/OtEntry.js';
import { route, json } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { scopeFor } from '@/lib/entries.js';
import { coveredDepartments } from '@/lib/delegationQuery.js';
import { scopeWidening } from '@/lib/delegation.js';

/** Queue counts for the manager's daily review and HR's monthly review (§2). */
export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const covered = await coveredDepartments(user);
  const scope = scopeFor(user, scopeWidening(user, covered));
  const [pendingMgr, pendingHr, delegated] = await Promise.all([
    OtEntry.countDocuments({ ...scope, status: 'pending_mgr' }),
    OtEntry.countDocuments({ ...scope, status: 'pending_hr' }),
    /**
     * How much of that first number is somebody else's team.
     *
     * Counted rather than derived on the client, because the badge in the nav
     * is drawn from this and the rows are fetched separately — two numbers from
     * two lists is how a badge ends up disagreeing with the screen it opens.
     * Zero for everybody not standing in, which is nearly everybody, and the
     * query is skipped entirely for them.
     */
    covered.length
      ? OtEntry.countDocuments({ department: { $in: covered }, status: 'pending_mgr' })
      : 0,
  ]);
  return json({
    pendingMgr,
    pendingHr,
    pendingMgrDelegated: delegated,
    /**
     * How many teams are being covered — which is what decides whether the
     * screen exists, not the count above it. A covered queue that happens to be
     * empty today is still a queue somebody is answerable for, and a tab that
     * appeared and vanished with the last row would be a tab nobody trusts.
     */
    delegatedTeams: covered.length,
  });
});
