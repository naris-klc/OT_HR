/**
 * Saving an [OPEN] answer, in one place for both servers.
 *
 * The App Router route and the retired Express router answered this identically
 * and separately, including two copies of the arithmetic key list. Recording a
 * version is a third thing they would each have had to remember, and a policy
 * saved through one path without a version written is a month that can never be
 * explained afterwards — so the whole sequence lives here and each route is
 * left with its own request plumbing.
 */

// Relative rather than `@/…`: the retired Express server is started by plain
// node, which resolves no aliases, and this module has to be importable by both
// servers or it is not the one place it claims to be.
import Setting from '../src/models/Setting.js';
import PolicyVersion from '../src/models/PolicyVersion.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import { recomputeEntries } from '../src/services/otService.js';
import { diffPolicy, authorizeReplay, effectiveFromRefusal } from './policyVersion.js';
import { today } from './today.js';

/**
 * Apply overrides, record the rule set they produce, and replay what may be
 * replayed.
 *
 * Returns `{ error }` for a caller to hand straight to `fail()`, or the payload
 * the settings screen reads.
 *
 * The order matters and is not incidental: the version row is written BEFORE
 * anything is recomputed, because `loadContext` resolves the live policy to a
 * recorded version and would otherwise stamp the entries it replays with the
 * previous one — or with nothing at all.
 */
export async function savePolicy({
  incoming = {}, actor, recompute = null, note = null, effectiveFrom = null,
}) {
  const unknown = Object.keys(incoming).filter((k) => !(k in DEFAULT_POLICY));
  if (unknown.length) {
    return { error: `ไม่รู้จักค่านโยบาย: ${unknown.join(', ')}`, status: 400 };
  }

  /**
   * WHEN THE NEW RULES START — today unless HR announces a later day.
   *
   * HR's answer, 2026-08-14: a change to how overtime is paid is announced
   * before it takes effect, so the field has to accept a future date. It may
   * not accept a past one: backdating would reach behind entries already
   * computed, printed and possibly paid and change what they were worth, which
   * is the retroactive restatement this whole design exists to prevent.
   *
   * Checked before anything is written, so a bad date leaves the policy exactly
   * as it was rather than half-applied with no version to explain it.
   */
  const startsOn = String(effectiveFrom || '').trim() || today();
  const badDate = effectiveFromRefusal(startsOn, today());
  if (badDate) return { error: badDate.error, status: badDate.status };

  /**
   * Restating a signed-off figure is allowed, but only by an admin and never
   * without a reason on the record. Both halves are `authorizeReplay`, shared
   * with the manual recompute endpoint — checked at the edge, before the policy
   * is written, so a refusal reaches HR as a message about the form they are
   * looking at and leaves nothing half-applied behind it.
   */
  const includeApproved = recompute === 'all';
  const allowed = authorizeReplay({ actor, includeApproved, note });
  if (!allowed.ok) return { error: allowed.error, status: allowed.status };

  const previous = await Setting.effectivePolicy();

  const doc = await Setting.load();
  doc.policy = { ...(doc.policy || {}), ...incoming };
  doc.markModified('policy');
  await doc.save();

  const policy = await Setting.effectivePolicy();
  const changes = diffPolicy(previous, policy);

  // Append-only, and skipped entirely when the save changed nothing — the
  // settings screen PATCHes one dropdown at a time and re-choosing the value a
  // flag already has is a save like any other.
  const { version, created } = await PolicyVersion.append(policy, actor, note, startsOn);

  // Only a flag that moves numbers makes stored hours stale. Flipping
  // hrMayReject is still a new version — the record is of the rules as a whole
  // — but replaying every entry in flight over it would fill their histories
  // with recomputes that changed nothing.
  const touchesArithmetic = changes.some((c) => c.arithmetic);

  let recomputed = { updated: 0, failed: [], skipped: [] };
  if (touchesArithmetic) {
    const filter = includeApproved ? {} : { status: { $in: ['pending_mgr', 'pending_hr'] } };
    recomputed = await recomputeEntries(filter, actor, {
      includeApproved, note, source: 'policy_save',
    });
  }

  return {
    policy,
    recomputed,
    policyVersion: version
      ? { _id: version._id, seq: version.seq, createdAt: version.createdAt, note: version.note }
      : null,
    versionCreated: created,
    changes,
  };
}
