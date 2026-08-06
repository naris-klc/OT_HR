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

/** DEFAULT_POLICY with the stored overrides applied. */
settingSchema.statics.effectivePolicy = async function effectivePolicy() {
  const doc = await this.load();
  return Object.freeze({ ...DEFAULT_POLICY, ...(doc.policy || {}) });
};

export default model('Setting', settingSchema);
