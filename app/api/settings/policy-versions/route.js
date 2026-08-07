import PolicyVersion from '@/src/models/PolicyVersion.js';
import OtEntry from '@/src/models/OtEntry.js';
import Setting from '@/src/models/Setting.js';
import { route, query, body, json } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { diffPolicy, policyHash, samePolicy } from '@/lib/policyVersion.js';

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
    // versions[0] is the newest — the list is sorted seq descending.
    live: await liveState(versions[0] || null),
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

/**
 * Whether the rules in force right now are ones the system has on record.
 *
 * The failure this exists to make visible: `currentPolicyVersion` stamps an
 * entry only when the live policy matches the newest recorded version exactly,
 * and it is right to — a pointer to rules that did not produce the hours is
 * worse than no pointer. But the mismatch has no other symptom. A deploy that
 * changes one value in DEFAULT_POLICY moves the effective policy without
 * anything being saved on the settings page, no version is written, and from
 * that moment every new entry is filed unstamped. Nothing fails, nobody is
 * told, and it surfaces at month end as a banner saying the month cannot be
 * compared — weeks after the entries that needed the stamp.
 *
 * So the comparison is done here, on a screen an admin opens, with the diff
 * that explains it and (see POST below) the one action that fixes it.
 */
async function liveState(latest) {
  const policy = await Setting.effectivePolicy();
  const recorded = Boolean(latest) && samePolicy(latest.policy, policy);

  return {
    hash: policyHash(policy),
    /** True when a new entry computed right now would carry a version. */
    recorded,
    latestSeq: latest?.seq ?? null,
    /**
     * What the live rules say that the newest recorded version does not. Empty
     * when they agree, and the whole story when they do not — usually a single
     * key changed by a deploy.
     */
    drift: latest && !recorded ? diffPolicy(latest.policy, policy) : [],
  };
}

/**
 * Record the rules in force as a new version — the fix for the state above.
 *
 * Nothing else in the system mints a version without also changing something:
 * the settings page writes one because HR answered a question, the migration
 * writes one because there were none. Neither helps when the live policy
 * drifted away from the record on its own, and the workaround — open the
 * settings page and re-save a dropdown to the value it already has — writes a
 * version whose note says nothing about why it exists.
 *
 * Deliberately narrow: it changes no policy value and recomputes nothing. All
 * it does is put the present on the record so that entries filed from now on
 * can point at it. Entries already filed unstamped stay that way; the migration
 * is what backfills those, and it is idempotent.
 */
export const POST = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'admin', 'hr');
  const payload = await body(req);

  const policy = await Setting.effectivePolicy();
  const { version, created } = await PolicyVersion.append(
    policy,
    user,
    payload?.note || 'บันทึกกฎที่ใช้อยู่ปัจจุบันเป็นเวอร์ชัน (ไม่ได้เปลี่ยนค่าใด)',
  );

  return json({
    version: {
      _id: version._id, seq: version.seq, createdAt: version.createdAt, note: version.note,
    },
    created,
    live: await liveState(version),
  });
});
