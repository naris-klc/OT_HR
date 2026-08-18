import { Router } from 'express';
import Setting from '../../src/models/Setting.js';
import { DEFAULT_POLICY } from '../../src/config/policy.js';
import { requireAuth, requireRole, wrap } from '../middleware/auth.js';
import { recomputeEntries } from '../../src/services/otService.js';
import { savePolicy } from '../../lib/policySave.js';
import { authorizeReplay } from '../../lib/policyVersion.js';
import { unconfirmedState } from '../../lib/policyConfirmations.js';
import { confirmPolicyItem } from '../../lib/policyConfirmSave.js';

const router = Router();
router.use(requireAuth);

router.get('/', wrap(async (req, res) => {
  const doc = await Setting.load();
  const policy = await Setting.effectivePolicy();
  res.json({
    settings: {
      companyName: doc.companyName,
      companyNameEn: doc.companyNameEn,
      formCode: doc.formCode,
    },
    policy,
    defaults: DEFAULT_POLICY,
    /** Which keys have been overridden away from the shipped defaults. */
    overrides: Object.keys(doc.policy || {}),
    /** Which rules HR has still not agreed to — see lib/policyConfirmations.js. */
    unconfirmed: unconfirmedState(policy, doc.policyConfirmations || {}),
  });
}));

/**
 * HR signing off a rule the system was already running on. Changes no value and
 * replays nothing — the whole sequence is in lib/policyConfirmations.js, shared
 * with the App Router so this server cannot be the lenient way in.
 */
router.post('/policy-confirmations', requireRole('admin', 'hr'), wrap(async (req, res) => {
  const result = await confirmPolicyItem({ id: req.body?.id, actor: req.user });
  if (result.error) return res.status(result.status).json({ error: result.error });
  return res.json(result);
}));

/**
 * Answering an [OPEN] item at runtime.
 *
 * Changing an arithmetic flag (break, rounding, minimum) changes what stored
 * entries mean, so entries still in flight are replayed through the engine.
 * Approved entries are left alone by default — they have been signed off, and
 * silently restating a signed number is worse than an inconsistency. Pass
 * `recompute: 'all'`, with a `note`, to replay those too.
 *
 * The sequence — record the rule set, then replay against it — is shared with
 * the App Router route in lib/policySave.js. Two copies of it would be two
 * chances for a policy to be saved without a version written, and an entry
 * computed under an unrecorded rule set can never be explained afterwards.
 */
router.patch('/policy', requireRole('admin', 'hr'), wrap(async (req, res) => {
  const result = await savePolicy({
    incoming: req.body?.policy || {},
    actor: req.user,
    recompute: req.body?.recompute,
    note: req.body?.note,
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  return res.json(result);
}));

router.patch('/', requireRole('admin'), wrap(async (req, res) => {
  const doc = await Setting.load();
  const { companyName, companyNameEn, formCode } = req.body || {};
  if (companyName != null) doc.companyName = companyName;
  if (companyNameEn != null) doc.companyNameEn = companyNameEn;
  if (formCode != null) doc.formCode = formCode;
  await doc.save();
  res.json({ settings: doc });
}));

/**
 * Manual replay — useful after a bulk holiday import or a data fix.
 *
 * Approved entries are skipped unless an admin asks for `includeApproved` with
 * a `note` — `authorizeReplay`, shared with the App Router so the retired
 * server cannot be the lenient way in — and the response names the ones it left
 * rather than reporting a smaller number with no explanation.
 */
router.post('/recompute', requireRole('admin', 'hr'), wrap(async (req, res) => {
  const filter = {};
  if (req.body?.period) filter.period = req.body.period;
  if (req.body?.status) filter.status = { $in: String(req.body.status).split(',') };

  const includeApproved = Boolean(req.body?.includeApproved);
  const note = req.body?.note;

  const allowed = authorizeReplay({ actor: req.user, includeApproved, note });
  if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error });

  return res.json(await recomputeEntries(filter, req.user, {
    includeApproved, note, source: 'manual',
  }));
}));

export default router;
