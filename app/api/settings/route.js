import Setting from '@/src/models/Setting.js';
import { DEFAULT_POLICY } from '@/src/config/policy.js';
import { unconfirmedState } from '@/lib/policyConfirmations.js';
import { route, body, json } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';

export const GET = route(async (req) => {
  await requireAuth(req);
  const doc = await Setting.load();
  const policy = await Setting.effectivePolicy();
  return json({
    settings: {
      companyName: doc.companyName,
      companyNameEn: doc.companyNameEn,
      formCode: doc.formCode,
    },
    policy,
    defaults: DEFAULT_POLICY,
    /** Which keys have been overridden away from the shipped defaults. */
    overrides: Object.keys(doc.policy || {}),
    /**
     * Which rules HR has still not agreed to. Carried on the same payload the
     * settings page already fetches, because the badge belongs beside the
     * dropdown it is about and a second request would let the two render out of
     * step with each other.
     */
    unconfirmed: unconfirmedState(policy, doc.policyConfirmations || {}),
  });
});

export const PATCH = route(async (req) => {
  requireRole(await requireAuth(req), 'admin');
  const doc = await Setting.load();
  const { companyName, companyNameEn, formCode } = await body(req);
  if (companyName != null) doc.companyName = companyName;
  if (companyNameEn != null) doc.companyNameEn = companyNameEn;
  if (formCode != null) doc.formCode = formCode;
  await doc.save();
  return json({ settings: doc });
});
