import mongoose from 'mongoose';
import { model } from './model.js';
import { samePolicy, policyHash } from '../../lib/policyVersion.js';
import { today } from '../../lib/today.js';

/**
 * Every set of calculation rules the system has ever computed with, kept.
 *
 * Append-only, and the append-only-ness is not a convention: every field is
 * `immutable`, so mongoose refuses a write that would restate a version rather
 * than leaving it to whoever writes the next route. There is no update path and
 * no method here that offers one. A version an entry points at has to still
 * mean in December what it meant in March, or the pointer is decoration.
 *
 * The whole policy is snapshotted, not a diff against DEFAULT_POLICY. A diff
 * would be smaller and would rot the first time the shipped defaults changed in
 * a deploy — the stored entries did not change with them, and a snapshot that
 * has to be reconstituted against a moving base is not a record of anything.
 */
const policyVersionSchema = new mongoose.Schema(
  {
    /**
     * 1, 2, 3 … what HR calls it out loud. `unique` is doing real work: two
     * admins saving the settings page at the same moment both read the same
     * latest seq, and the second insert is refused by the index rather than
     * quietly producing two version 4s that entries then point at at random.
     */
    seq: { type: Number, required: true, unique: true, immutable: true },

    /** DEFAULT_POLICY with the overrides of the moment applied — the whole thing. */
    policy: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },

    /**
     * Fingerprint of `policy`, for finding a version by its rules and for
     * printing beside the number so two people on a phone call can be sure they
     * are looking at the same one.
     *
     * NOT what `append` below decides equality on — see `policyHash` in
     * lib/policyVersion.js for why a 32-bit digest must never be the thing that
     * says "no new version needed".
     */
    policyHash: { type: String, required: true, immutable: true, index: true },

    /** Why the rules changed. Free text from the settings page. */
    /**
     * The first work date this rule set applies to — 'YYYY-MM-DD'.
     *
     * NOT `createdAt`. HR's answer, 2026-08-14: a change to how overtime is
     * paid is announced before it takes effect, and the rules that decide an
     * entry are the ones in force ON THE DAY THE WORK WAS DONE — not the day
     * the form was filed, not the day it was approved, and not the day HR
     * pressed save. Wages for work already performed are a debt already
     * incurred; restating them downward afterwards is a retroactive pay cut.
     *
     * So a save on 5 August effective 10 August leaves every shift worked on
     * the 5th through the 9th on the old rules, permanently, however late the
     * paperwork arrives. `versionForDate` in lib/policyVersion.js is the
     * lookup, and it is what the compute path resolves through.
     *
     * Immutable like everything else here: a version's dates are part of the
     * record of what the company was doing, and an editable one is evidence of
     * nothing. To correct a mistaken date, record another version.
     */
    effectiveFrom: { type: String, required: true, immutable: true, index: true },

    note: { type: String, immutable: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', immutable: true },
    /**
     * Denormalised beside the id for the same reason `history.byName` is: the
     * screens that print a version are audit screens, and an audit record that
     * turns into a blank when an employee is deleted is not one.
     */
    createdByName: { type: String, immutable: true },
  },
  // No `updatedAt`. A document that cannot be updated has no such date, and
  // carrying an empty one would invite somebody to fill it in.
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'otPolicyVersions' },
);

/**
 * Derived here rather than at each call site, so there is no way to write a
 * version row whose fingerprint does not match its own policy — including from
 * the migration, which creates one directly.
 */
policyVersionSchema.pre('validate', function setHash(next) {
  if (this.policy && !this.policyHash) this.policyHash = policyHash(this.policy);
  next();
});

/** Newest first — the version anything computed right now would be stamped with. */
policyVersionSchema.statics.latest = function latest() {
  return this.findOne().sort({ seq: -1 });
};

/**
 * Record a policy, unless it is already the one in force.
 *
 * The settings screen PATCHes one flag per dropdown, and choosing the value a
 * flag already has is a save like any other. Gating on the policy itself rather
 * than on "did a request arrive" keeps the collection a list of the rule sets
 * that existed, instead of a list of the times somebody opened the page.
 *
 * Returns `{ version, created }` — the caller needs the id either way, because
 * an unchanged policy still has to be stamped onto whatever it recomputes.
 */
policyVersionSchema.statics.append = async function append(policy, actor, note, effectiveFrom) {
  const current = await this.latest();
  if (current && samePolicy(current.policy, policy)) {
    return { version: current, created: false };
  }
  const version = await this.create({
    seq: (current?.seq ?? 0) + 1,
    // Copied, not stored by reference: `Setting.effectivePolicy()` hands back a
    // frozen object, and a Mixed path that mongoose cannot touch is a save that
    // fails for a reason nothing in the stack trace mentions.
    policy: { ...policy },
    /**
     * Defaulted here as well as validated at the route, because the migration
     * and the seed create versions too and neither goes through a route. Today
     * is the honest default: a rule set with no announced date is one that
     * starts now, and the alternative — an empty field — would make
     * `versionForDate` guess.
     */
    effectiveFrom: effectiveFrom || today(),
    note: note || undefined,
    createdBy: actor?._id,
    createdByName: actor?.name,
  });
  return { version, created: true };
};

export default model('PolicyVersion', policyVersionSchema);
