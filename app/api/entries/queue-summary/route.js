import OtEntry from '@/src/models/OtEntry.js';
import { route, json } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { scopeFor } from '@/lib/entries.js';
import { coveredDepartments } from '@/lib/delegationQuery.js';
import { scopeWidening } from '@/lib/delegation.js';
import { loadBirthdayQueue } from '@/lib/birthdayQueueQuery.js';

/** Queue counts for the manager's daily review and HR's monthly review (§2). */
export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const covered = await coveredDepartments(user);
  const scope = scopeFor(user, scopeWidening(user, covered));
  const [pendingMgr, pendingHr, delegated, birthday] = await Promise.all([
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
    /**
     * The second tab of the same screen.
     *
     * Not a `countDocuments` and it cannot be one: an unanswered birthday is the
     * absence of two different documents, decided against a roster, a calendar
     * and the live policy. So it runs the queue loader the tab itself runs —
     * `countOnly`, which skips the manager names and the answered list — because
     * a badge and the screen it opens must be one computation. Two would be one
     * refactor away from disagreeing, and the badge is the half nobody checks.
     *
     * Not fatal: a queue count that fails should cost a badge, not the two
     * numbers beside it.
     */
    loadBirthdayQueue(user, { countOnly: true })
      .then((q) => q.needsEntry.length)
      .catch(() => 0),
  ]);
  return json({
    pendingMgr,
    pendingHr,
    pendingMgrDelegated: delegated,
    /**
     * วันเกิดรอตรวจ — outstanding across ALL months, unlike everything else on
     * this route, which is the point of the queue. The nav adds it to the tab's
     * own number so the badge counts the whole screen; the screen shows the two
     * apart, because they are two different jobs.
     */
    birthdayPending: birthday,
    /**
     * How many teams are being covered — which is what decides whether the
     * screen exists, not the count above it. A covered queue that happens to be
     * empty today is still a queue somebody is answerable for, and a tab that
     * appeared and vanished with the last row would be a tab nobody trusts.
     */
    delegatedTeams: covered.length,
  });
});
