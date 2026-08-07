import mongoose from 'mongoose';
import { model } from './model.js';
import { samePolicy, policyHash } from '../../lib/policyVersion.js';

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
policyVersionSchema.statics.append = async function append(policy, actor, note) {
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
    note: note || undefined,
    createdBy: actor?._id,
    createdByName: actor?.name,
  });
  return { version, created: true };
};

export default model('PolicyVersion', policyVersionSchema);
