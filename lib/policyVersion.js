/**
 * Which set of rules a stored figure was produced by.
 *
 * The [OPEN] answers can be changed at any time, and changing one mid-month is
 * the point of them being runtime flags rather than a redeploy. What that costs
 * is comparability: entries still in flight are replayed through the engine and
 * approved ones deliberately are not (see the policy route), so a month can hold
 * hours arrived at two different ways with nothing on either row saying so. A
 * signed-off figure and a recomputed one look identical on the sheet.
 *
 * The answer is a version pointer on every entry, and the pointer is only worth
 * having if the rules it names are kept: `otPolicyVersions` is append-only, so
 * `policyVersionId` on an entry from March still resolves to March's rules in
 * December.
 *
 * Everything here is pure — no database, no clock, no mongoose. The report route
 * and the React screens both read it, so it must run in the browser bundle too;
 * that is also why the identity of a policy is a canonical JSON string rather
 * than a crypto hash. Comparing two objects already in memory needs no digest,
 * and one fewer node builtin is one fewer thing that cannot cross to the client.
 */

/**
 * The flags that change what an entry's hours ARE, as opposed to who may do
 * what with it. Changing one of these makes stored figures stale; changing
 * anything else (hrMayReject, capBehaviour…) leaves every number exactly as it
 * was.
 *
 * Single source of truth — the two settings routes read it from here rather
 * than each keeping a copy, because a key added to one list and not the other
 * is a policy change that silently stops replaying.
 */
export const ARITHMETIC_KEYS = Object.freeze([
  'breakMode', 'breakWindowStartMinute', 'breakWindowEndMinute', 'breakMinutes',
  'breakThresholdHours', 'breakPerCalendarDay', 'roundingMode',
  'roundingIncrementMinutes', 'roundingScope', 'belowMinimum', 'minimumHours',
  'coreStartMinute', 'coreEndMinute', 'weekendDays', 'otStartsAtCoreEnd',
]);

/**
 * A policy as one comparable string — keys in a fixed order, so two objects
 * built in different orders compare equal.
 *
 * Deliberately shallow-sorted: every value in DEFAULT_POLICY is a scalar or an
 * array of scalars (`weekendDays`), and JSON.stringify preserves array order,
 * which is meaningful. A nested object would need a recursive sort; there is
 * none, and inventing one for a shape that does not exist would be a rule
 * nobody could check against a real case.
 */
export function canonicalPolicy(policy) {
  const out = {};
  for (const key of Object.keys(policy || {}).sort()) out[key] = policy[key];
  return JSON.stringify(out);
}

/** Same answers to every question, whatever order they were written in. */
export function samePolicy(a, b) {
  return canonicalPolicy(a) === canonicalPolicy(b);
}

/** Just the flags that move numbers. */
export function arithmeticOf(policy) {
  const out = {};
  for (const key of ARITHMETIC_KEYS) {
    if (policy && key in policy) out[key] = policy[key];
  }
  return out;
}

/**
 * Would these two policies compute the same hours from the same session?
 *
 * The question the warning banner actually asks. Two versions that differ only
 * in `hrMayReject` are different records of a different decision and both
 * deserve to exist — but a month spanning them has nothing wrong with it, and
 * saying otherwise trains HR to dismiss the banner.
 */
export function sameArithmetic(a, b) {
  return canonicalPolicy(arithmeticOf(a)) === canonicalPolicy(arithmeticOf(b));
}

/** What changed between two policies, as rows a screen can print. */
export function diffPolicy(before, after) {
  const keys = [...new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ])].sort();

  return keys
    .filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
    .map((key) => ({
      key,
      from: before?.[key],
      to: after?.[key],
      /** Whether this one restates stored hours or only changes a permission. */
      arithmetic: ARITHMETIC_KEYS.includes(key),
    }));
}

/** `policyVersionId` is a bare id on a lean document and a document once populated. */
export function versionIdOf(entry) {
  const ref = entry?.policyVersionId;
  if (!ref) return null;
  return String(ref._id || ref);
}

export function versionLabel(version) {
  if (!version) return '—';
  return `เวอร์ชัน ${version.seq}`;
}

/**
 * Which rule sets a set of entries was computed under — and whether that is
 * more than one.
 *
 * `versions` is optional and only affects `arithmeticMixed`: without the stored
 * snapshots there is no way to tell a version bump that moved hours from one
 * that moved a permission, and the honest answer to "do these figures compare"
 * is then "unknown", which reads as `null` rather than as false.
 *
 * An entry with no version at all counts as its own kind of mixture. Those are
 * rows written before the migration ran (or on a database where it never did),
 * and a month that is half stamped and half not is exactly the case HR must not
 * be told is uniform.
 */
export function versionSpread(entries, versions = null) {
  const counts = new Map();
  let unversioned = 0;

  for (const entry of entries || []) {
    const id = versionIdOf(entry);
    if (!id) { unversioned += 1; continue; }
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  const byId = new Map((versions || []).map((v) => [String(v._id), v]));
  const used = [...counts.entries()]
    .map(([id, count]) => ({ id, count, seq: byId.get(id)?.seq ?? null }))
    // Highest seq first: the newest rules are the ones a reader is holding in
    // their head. Unknown seq (a version row that was not loaded) sorts last
    // rather than pretending to be version 0.
    .sort((a, b) => (b.seq ?? -1) - (a.seq ?? -1));

  const mixed = used.length + (unversioned ? 1 : 0) > 1;

  // `null` means "cannot say", and it is a different answer from "no". An
  // unstamped entry's rules were never recorded, and a version row the caller
  // did not load cannot be compared to anything — in both cases the honest
  // reply to "do these figures compare" is that nobody knows.
  const snapshots = used.map((u) => byId.get(u.id)?.policy);
  let arithmeticMixed = null;
  if (snapshots.every(Boolean) && !(unversioned > 0 && used.length > 0)) {
    arithmeticMixed = !snapshots.every((p) => sameArithmetic(p, snapshots[0]));
  }

  return { used, unversioned, mixed, arithmeticMixed };
}

/**
 * Which entries a replay is allowed to touch.
 *
 * The rule that keeps a signed-off number signed off. It lives here, as a
 * function over a list, rather than only in the query filter of each caller:
 * a filter is invisible from the entry's side, and this file is where anybody
 * asking "can a recompute change an approved row" will look.
 *
 * `includeApproved` is the deliberate escape hatch — HR answering an [OPEN]
 * item late and choosing to restate the whole month. It is never the default,
 * and the caller that sets it is required to say why (see the policy route),
 * so an approved figure can only ever move with a reason attached to it.
 */
export function planRecompute(entries, { includeApproved = false } = {}) {
  const replay = [];
  const skipped = [];
  for (const entry of entries || []) {
    if (!includeApproved && entry?.status === 'approved') {
      skipped.push({ id: String(entry._id), reason: 'approved' });
      continue;
    }
    replay.push(entry);
  }
  return { replay, skipped };
}

/**
 * What the one-off migration has left to do — decided before anything is
 * written, so that running it twice is a question this function answers rather
 * than one the database has to survive.
 *
 * Two separate idempotency rules, because they can fail independently:
 *
 *   createGenesis — only when the collection is empty. NOT "when no version
 *                   matches the current policy": HR may legitimately have
 *                   changed a flag since the migration ran, and a second run
 *                   must not mint a rival origin for entries that already point
 *                   at the real one.
 *   backfill      — only entries with no pointer. An entry that already has one
 *                   is never re-stamped, whatever its status, which is what
 *                   makes the approved-rows exemption a single event.
 */
export function planBackfill({ existingVersions = [], entries = [] } = {}) {
  const genesis = existingVersions.length
    ? [...existingVersions].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))[0]
    : null;

  const backfill = (entries || []).filter((e) => !versionIdOf(e)).map((e) => String(e._id));

  return {
    createGenesis: !genesis,
    genesis,
    backfill,
    alreadyStamped: (entries || []).length - backfill.length,
  };
}
