import PolicyVersion from '@/src/models/PolicyVersion.js';
import OtEntry from '@/src/models/OtEntry.js';
import { route, query, json } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { diffPolicy } from '@/lib/policyVersion.js';

/**
 * Every rule set the system has computed with, newest first, each with what
 * changed when it came in.
 *
 * The diff is against the version before it rather than against
 * DEFAULT_POLICY: HR reading this is asking "what moved when the numbers
 * moved", and a cumulative distance from the shipped defaults answers a
 * different question every time the defaults are redeployed.
 *
 * `entryCount` comes along because the first thing anyone asks of a version
 * they have never seen is whether it touched anything real. A rule set that was
 * in force for ten minutes on a Sunday and computed nothing is a different
 * object from one that a whole month hangs off.
 */
export const GET = route(async (req) => {
  requireRole(await requireAuth(req), 'admin', 'hr');
  const { limit } = query(req);

  const versions = await PolicyVersion.find()
    .sort({ seq: -1 })
    .limit(Number(limit) || 50)
    .lean();

  const counts = await OtEntry.aggregate([
    { $group: { _id: '$policyVersionId', count: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.count]));

  return json({
    versions: versions.map((v, i) => ({
      ...v,
      entryCount: byId.get(String(v._id)) || 0,
      /**
       * versions[i + 1] is the one before it — the list is newest first.
       * `null` where the predecessor was not loaded (the list is capped), which
       * is not the same as "nothing changed" and must not print as it. The
       * origin version genuinely has no predecessor, so it diffs against
       * nothing and lists its whole snapshot.
       */
      changes: versions[i + 1]
        ? diffPolicy(versions[i + 1].policy, v.policy)
        : (v.seq === 1 ? diffPolicy(null, v.policy) : null),
    })),
    /** Entries filed before versioning, or on a database awaiting the migration. */
    unversionedEntryCount: byId.get('null') || 0,
  });
});
