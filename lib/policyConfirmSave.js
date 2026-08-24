/**
 * The one mongoose call behind an HR sign-off.
 *
 * Deliberately thin, and deliberately the only thing in this file: the rule
 * being enforced — that confirming an item changes no policy value, appends no
 * version and replays no entry — lives in lib/policyConfirmations.js, which
 * imports no model and can therefore be tested without a database.
 *
 * Shared by the App Router route and the retired Express router, for the same
 * reason savePolicy is: two copies of a write is two chances for one of them to
 * grow a recompute.
 */

import Setting from '../src/models/Setting.js';
import PolicyVersion from '../src/models/PolicyVersion.js';
import { samePolicy } from './policyVersion.js';
import { applyConfirmation, unconfirmedState } from './policyConfirmations.js';

/**
 * The recorded rule set a sign-off is happening inside, or null.
 *
 * Null is a real answer and not a failure. The live policy is only ON RECORD
 * while it matches the newest version row — a deploy that changes a shipped
 * default moves the rules with nothing saved on the settings page, and from
 * that moment `PolicyVersion.latest()` describes rules that are not running.
 * Pointing a signature at it would attach HR's name to a rule set they were not
 * shown, which is the precise failure this whole change exists to stop. So the
 * pointer is stored only when it is true, and `values` on the record carries the
 * answers either way.
 *
 * Same test `savePolicy` and the entry stamping use — canonical-string equality,
 * never the hash.
 */
async function recordedVersionId(policy) {
  const latest = await PolicyVersion.latest();
  if (!latest || !samePolicy(latest.policy, policy)) return null;
  return latest._id;
}

export async function confirmPolicyItem({ id, actor, note = null, at = new Date() }) {
  const doc = await Setting.load();
  /**
   * Read BEFORE the record is built and used for both halves of it — the value
   * comparison and the version pointer — so a signature cannot end up naming
   * one rule set and pointing at another.
   */
  const policy = await Setting.effectivePolicy();

  const result = applyConfirmation(doc, {
    id,
    actor,
    at,
    policy,
    policyVersionId: await recordedVersionId(policy),
    note,
  });
  if (result.error) return { error: result.error, status: result.status };

  if (result.changed) {
    doc.markModified('policyConfirmations');
    // Saves `policyConfirmations`. `doc.policy` was never assigned — the policy
    // above was READ and copied out of — so `effectivePolicy()` below returns
    // exactly what it would have returned before this call, and no version is
    // appended by anything on this path.
    await doc.save();
  }

  return { items: unconfirmedState(policy, result.confirmations) };
}
