import { Router } from 'express';
import Setting from '../models/Setting.js';
import { DEFAULT_POLICY } from '../config/policy.js';
import { requireAuth, requireRole, wrap } from '../middleware/auth.js';
import { recomputeEntries } from '../services/otService.js';
import { savePolicy } from '../../lib/policySave.js';

const router = Router();
router.use(requireAuth);

router.get('/', wrap(async (req, res) => {
  const doc = await Setting.load();
  res.json({
    settings: {
      companyName: doc.companyName,
      companyNameEn: doc.companyNameEn,
      formCode: doc.formCode,
    },
    policy: await Setting.effectivePolicy(),
    defaults: DEFAULT_POLICY,
    /** Which keys have been overridden away from the shipped defaults. */
    overrides: Object.keys(doc.policy || {}),
  });
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
 * Approved entries are skipped unless `includeApproved` is asked for with a
 * `note`, and the response names the ones it left rather than reporting a
 * smaller number with no explanation.
 */
router.post('/recompute', requireRole('admin', 'hr'), wrap(async (req, res) => {
  const filter = {};
  if (req.body?.period) filter.period = req.body.period;
  if (req.body?.status) filter.status = { $in: String(req.body.status).split(',') };

  const includeApproved = Boolean(req.body?.includeApproved);
  const note = req.body?.note;
  if (includeApproved && !String(note || '').trim()) {
    return res.status(400).json({ error: 'การคำนวณใหม่ที่รวมรายการที่อนุมัติแล้ว กรุณาระบุเหตุผล' });
  }

  return res.json(await recomputeEntries(filter, req.user, { includeApproved, note }));
}));

export default router;
