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
import { applyConfirmation, unconfirmedState } from './policyConfirmations.js';

export async function confirmPolicyItem({ id, actor, at = new Date() }) {
  const doc = await Setting.load();

  const result = applyConfirmation(doc, { id, actor, at });
  if (result.error) return { error: result.error, status: result.status };

  if (result.changed) {
    doc.markModified('policyConfirmations');
    // Saves `policyConfirmations`. `doc.policy` was never assigned, so
    // `effectivePolicy()` below returns exactly what it would have returned
    // before this call, and no version is appended by anything on this path.
    await doc.save();
  }

  return { items: unconfirmedState(await Setting.effectivePolicy(), result.confirmations) };
}
