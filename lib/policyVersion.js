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
  // Arithmetic, not a permission: turning the birthday rule on moves a
  // weekday's hours out of ot15_weekday and into the holiday columns for
  // everybody with a birthday that month, and the leap-day answer decides which
  // date that happens on.
  'birthdayHolidayEnabled', 'birthdayLeapFallback',
]);

/**
 * The other kind: flags that change who may do what, or how a figure is
 * presented, without changing the figure.
 *
 * This list exists so that the two together can be checked against
 * DEFAULT_POLICY. A key classified as neither is the failure that has no
 * symptom — `sameArithmetic` would report two versions as comparable across a
 * change that moved every number in the month, and the banner HR relies on
 * would go green at the exact moment it should go amber. There is no way to
 * detect that from the outside, so it is caught at the only moment anybody
 * could act on it: adding the flag. See test/policyVersion.test.js.
 */
export const COSMETIC_KEYS = Object.freeze([
  'shiftPatternsEnabled', 'hrMayReject', 'hrRejectReturnsTo',
  'capBehaviour', 'capBasis', 'hrSummaryBasis',
  /**
   * Where a week begins, for the weekly department ceiling.
   *
   * COSMETIC, and the reasoning has to be stated because the word fits badly:
   * moving the boundary genuinely changes which entries carry `capExceeded`,
   * and a flag is not nothing. But the line these two lists draw is not
   * "matters" against "does not matter" — it is whether STORED FIGURES GO
   * STALE, because that is the only thing the classification is consulted for:
   * `savePolicy` replays entries when and only when an arithmetic key moved.
   *
   * No hour moves. `weekStartsOn` is read in exactly one place — `weekStartOf`
   * in lib/caps.js — and it is read to group segments that were already
   * computed, into windows. Every `segments`, `buckets` and `totals` value on
   * every entry is bit-identical either side of the change. Replaying them all
   * would rewrite nothing and fill several thousand histories with recomputes
   * that moved not one minute, which is precisely the noise the split exists to
   * prevent.
   *
   * It sits beside `capBehaviour` and `capBasis` on purpose: all three change
   * what the ceiling says about unchanged hours, and none of them changes the
   * hours. What follows from that — that `capExceeded` on already-stored rows
   * reflects the boundary in force when each was filed, until something else
   * recomputes it — is already true of those two today and is not a new
   * property of this one. A cap flag is a reading taken at submission time;
   * the live check on the review screen is what a decision is made against.
   */
  'weekStartsOn',
  // Whether the printed calendar names a birthday. Cosmetic in the strict
  // sense and not merely in intent: the hours were computed from day types
  // resolved when the entry was filed and are already sitting in the holiday
  // columns — this decides what the grid beside them says. A save that flips
  // only this one must not recompute a month. See `formDayTypes` in
  // lib/reports.js, which is the only place it is read.
  'birthdayReasonOnForm',
  /**
   * Whether a หัวหน้า's own filing skips the step they would have signed.
   *
   * COSMETIC on the same terms as `hrMayReject` and `hrRejectReturnsTo` beside
   * it: it changes which desk a request lands on, and not one figure on it. An
   * entry that skips to `pending_hr` carries exactly the segments, buckets and
   * totals it would have carried waiting at `pending_mgr`; the engine is never
   * told who filed anything. Replaying a month over a change to it would
   * rewrite nothing and fill several thousand histories with recomputes that
   * moved no minutes.
   */
  'proxySkipsOwnApproval',
  /**
   * Whether the printed form carries the note naming who filed on whose behalf.
   * Cosmetic for the reason `birthdayReasonOnForm` is, and read in the same one
   * place: the hours are already in their columns before this is consulted, and
   * it decides only what is printed beside them.
   */
  'proxyNoteOnForm',
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

/**
 * A short stable fingerprint of a policy — FNV-1a over the canonical string.
 *
 * FOR LOOKING UP AND FOR PRINTING. NOT FOR DECIDING WHETHER TWO POLICIES ARE
 * THE SAME. That decision is `samePolicy` above and must stay there: this is 32
 * bits, two different rule sets can collide, and a collision consulted as an
 * equality test means a real policy change is swallowed — no new version, no
 * new pointer, and a month of entries silently attributed to rules that did not
 * produce them. A wrong `true` here is unrecoverable and invisible; the
 * canonical string comparison it would be replacing costs nothing.
 *
 * So it is used where being wrong is cheap and self-correcting: an index to
 * find candidate versions by, and eight characters HR can read out over the
 * phone to say which rule set they are looking at.
 *
 * FNV-1a rather than a crypto digest for the reason canonicalPolicy is a string
 * rather than a digest: this module is imported by the React screens, and
 * `node:crypto` does not cross to the browser bundle.
 */
export function policyHash(policy) {
  const text = canonicalPolicy(policy);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // × 16777619 in 32-bit, via shifts — Math.imul keeps it exact where a
    // plain multiply would drift into float territory.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
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
/**
 * May this person restate signed-off hours, and have they said why?
 *
 * Both halves of the escape hatch in one place, returning `{ ok: true }` or a
 * `{ error, status }` a route hands straight to `fail()`.
 *
 * It is one function rather than two checks in each caller because there are
 * four ways in — the settings page and the manual replay, each on the App
 * Router and on the retired Express server — and a rule that has to be
 * remembered four times is a rule that will hold in three places. Anything that
 * can move an approved figure asks this first.
 *
 * Admin only, not admin-or-HR. HR answers the [OPEN] items and that is what the
 * settings page is for; replaying a month that has been signed off is a
 * different act, and the person who signed it should not also be the only
 * person who can quietly redo it.
 *
 * An ordinary replay — pending entries, no `includeApproved` — is not gated at
 * all here. It touches nothing anybody put their name to.
 */
export function authorizeReplay({ actor = null, includeApproved = false, note = null } = {}) {
  if (!includeApproved) return { ok: true };

  if (actor?.role !== 'admin') {
    return {
      error: 'การคำนวณใหม่ที่รวมรายการที่อนุมัติแล้ว สงวนไว้สำหรับผู้ดูแลระบบเท่านั้น',
      status: 403,
    };
  }
  if (!String(note || '').trim()) {
    return {
      error: 'การคำนวณใหม่จะแก้ไขชั่วโมงของรายการที่อนุมัติแล้ว กรุณาระบุเหตุผล',
      status: 400,
    };
  }
  return { ok: true };
}

/**
 * Did a replay actually restate this entry?
 *
 * Compared per bucket, not on the session total. The total is the sum of three
 * columns and a rule change can move hours BETWEEN them while leaving it
 * untouched — a shifted core-hours boundary turns ×1.5 weekday hours into ×3
 * holiday hours one for one, and payroll pays a different amount against an
 * identical `otHours`. Read on the total alone that entry looks unchanged and
 * its `before` snapshot is never written, which is the one case where the audit
 * trail is missing precisely because the change was material.
 *
 * Both arguments are `entry.snapshot()` shapes, so the same comparison serves a
 * replay, an edit and a test with no mongoose in sight. Bucket keys are read off
 * the objects rather than imported from the engine: this module is in the
 * browser bundle, and a new bucket must not be able to go uncompared because a
 * list somewhere else was not updated.
 */
export function figuresMoved(before, after) {
  if (!before || !after) return false;
  if ((before.otHours ?? 0) !== (after.otHours ?? 0)) return true;

  const b = before.buckets || {};
  const a = after.buckets || {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if ((b[key] ?? 0) !== (a[key] ?? 0)) return true;
  }
  return false;
}

/**
 * One replay, counted — what the operation log keeps about a run.
 *
 * Separate from the per-entry `before` snapshots and deliberately so. Those are
 * written only where an entry changed, because a correction column that fills
 * with 200 rows that moved nothing is a column HR stops reading. But then a
 * replay that changed nothing leaves no trace at all, and "was this month
 * recomputed after the policy changed on the 14th" becomes unanswerable — the
 * absence of evidence and the evidence of absence look identical.
 *
 * So the run is recorded every time, whatever it moved, and the two records
 * answer different questions: this one says a replay happened, who ordered it
 * and why; the snapshots say which figures it moved.
 *
 * `scanned` and `replay` carry `{ status, policyVersionId }` — captured BEFORE
 * the entries are recomputed, since the recompute overwrites the pointer this
 * counts.
 */
export function summariseReplay({
  scanned = [], replay = [], changed = [], skipped = [], failed = [], toVersionId = null,
} = {}) {
  const from = new Map();
  for (const entry of scanned) {
    const id = versionIdOf(entry);
    from.set(id, (from.get(id) || 0) + 1);
  }

  let approved = 0;
  for (const entry of replay) if (entry?.status === 'approved') approved += 1;

  return {
    scanned: scanned.length,
    replayed: replay.length,
    changed: changed.length,
    skipped: skipped.length,
    failed: failed.length,
    /** Of the replayed ones — the number the escape hatch exists to guard. */
    approvedReplayed: approved,
    fromVersions: [...from.entries()]
      .map(([version, count]) => ({ version, count }))
      .sort((a, b) => b.count - a.count),
    toVersion: toVersionId ? String(toVersionId) : null,
  };
}

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
