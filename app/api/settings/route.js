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

/**
 * ชื่อบริษัทและรหัสฟอร์ม — three label strings, one of which is printed on
 * ใบ F-HR-027.
 *
 * ฝ่ายบุคคล AND ผู้ดูแลระบบ. It was Admin's alone and had no screen at all, so
 * the only way to correct the form code was an API call typed by hand — which
 * meant in practice that nobody corrected it. HR own the paper it appears on
 * and they are the ones who hear from accounting when the form code on the
 * sheet stops matching the one in the QMS register.
 *
 * ONLY `formCode` HAS A SCREEN, since 2026-08-31. ตั้งค่าระบบ → รหัสเอกสาร OT
 * used to carry a box for each of the two company names as well, and each said
 * on its own label that nothing prints the value — which was true, and is why
 * they went. The FIELDS stay accepted here: they are still in the Setting
 * singleton, still patchable by hand, and if a controlled form is ever asked to
 * print the company name the boxes come back rather than a migration.
 *
 * NOTHING HERE IS ARITHMETIC. These are labels: no hour, no rate, no ceiling
 * and no day type reads any of them, and a value typed wrong is visible on the
 * next form printed and fixed by typing it again. That is the whole test this
 * handler had to pass to move — compare `PATCH /api/settings/policy`, which is
 * a different route precisely because it changes what the engine computes.
 *
 * The policy half of this collection is NOT reachable from here: `doc.policy`
 * is not in the payload and never was, so widening this handler cannot widen
 * that one by accident.
 */
export const PATCH = route(async (req) => {
  requireRole(await requireAuth(req), 'admin', 'hr');
  const doc = await Setting.load();
  const { companyName, companyNameEn, formCode } = await body(req);
  if (companyName != null) doc.companyName = companyName;
  if (companyNameEn != null) doc.companyNameEn = companyNameEn;
  if (formCode != null) doc.formCode = formCode;
  await doc.save();
  return json({ settings: doc });
});
