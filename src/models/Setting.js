import mongoose from 'mongoose';
import { model } from './model.js';
import { DEFAULT_POLICY } from '../config/policy.js';

/**
 * Singleton holding the live policy — the runtime home of the twelve [OPEN]
 * answers, so HR can flip one without a redeploy.
 *
 * §12.3: monthlyCapHours is deliberately NOT here. Caps moved onto the
 * department. Anything left in this document is genuinely company-wide.
 */
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'singleton', unique: true, immutable: true },
    /** Sparse overrides on DEFAULT_POLICY. Unset keys fall back to the file. */
    policy: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    /**
     * Which of the HR_UNCONFIRMED items somebody in HR has now signed off, as
     * `{ [id]: { by, byName, at } }`.
     *
     * A SIBLING of `policy`, never a member of it, and that placement is the
     * whole guarantee. `Setting.effectivePolicy()` spreads `policy` and nothing
     * else, so a confirmation cannot reach `canonicalPolicy`, cannot change a
     * `policyHash`, cannot mint a version and cannot make `sameArithmetic`
     * false — which is what "COSMETIC" has to mean here to be worth anything.
     * Put inside `policy` it would also be an unclassified key and fail the
     * ARITHMETIC/COSMETIC completeness test in test/policyVersion.test.js.
     *
     * Keyed by the item id rather than by policy key: one question can cover
     * more than one flag, and one of them covers no flag at all.
     */
    policyConfirmations: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    companyName: { type: String, default: 'บริษัท ไพรมัส อินสตรูเมนท์ จำกัด' },
    companyNameEn: { type: String, default: 'Primus Instrument Co., Ltd.' },
    formCode: { type: String, default: 'F-HR-027 Rev.4' },
  },
  { timestamps: true },
);

settingSchema.statics.load = async function load() {
  return this.findOneAndUpdate(
    { key: 'singleton' },
    { $setOnInsert: { key: 'singleton', policy: {} } },
    { new: true, upsert: true },
  );
};

/**
 * DEFAULT_POLICY with the stored overrides applied.
 *
 * Overrides for keys the file no longer asks about are DROPPED rather than
 * spread through. A flag can be retired by a deploy — `birthdayReasonOnForm`
 * was, when HR took the birthday remark off F-HR-027 — and its stored answer
 * outlives it in this document. Spread in, it would reach `canonicalPolicy`,
 * change the `policyHash`, and be recorded as part of the live rule set in every
 * `PolicyVersion` written from then on: a rule the system does not have, on the
 * append-only record of the rules it does. `savePolicy` already refuses to
 * accept a key that is not in DEFAULT_POLICY; this is the same rule on the way
 * out.
 */
settingSchema.statics.effectivePolicy = async function effectivePolicy() {
  const doc = await this.load();
  const stored = doc.policy || {};
  const overrides = {};
  for (const key of Object.keys(DEFAULT_POLICY)) {
    if (key in stored) overrides[key] = stored[key];
  }
  return Object.freeze({ ...DEFAULT_POLICY, ...overrides });
};

export default model('Setting', settingSchema);
