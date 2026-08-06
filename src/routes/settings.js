import { Router } from 'express';
import Setting from '../models/Setting.js';
import { DEFAULT_POLICY } from '../config/policy.js';
import { requireAuth, requireRole, wrap } from '../middleware/auth.js';
import { recomputeEntries } from '../services/otService.js';

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
 * `recompute: 'all'` to replay those too.
 */
router.patch('/policy', requireRole('admin', 'hr'), wrap(async (req, res) => {
  const incoming = req.body?.policy || {};
  const unknown = Object.keys(incoming).filter((k) => !(k in DEFAULT_POLICY));
  if (unknown.length) return res.status(400).json({ error: `ไม่รู้จักค่านโยบาย: ${unknown.join(', ')}` });

  const doc = await Setting.load();
  doc.policy = { ...(doc.policy || {}), ...incoming };
  doc.markModified('policy');
  await doc.save();

  const ARITHMETIC_KEYS = [
    'breakMode', 'breakWindowStartMinute', 'breakWindowEndMinute', 'breakMinutes',
    'breakThresholdHours', 'breakPerCalendarDay', 'roundingMode',
    'roundingIncrementMinutes', 'roundingScope', 'belowMinimum', 'minimumHours',
    'coreStartMinute', 'coreEndMinute', 'weekendDays',
  ];
  const touchesArithmetic = Object.keys(incoming).some((k) => ARITHMETIC_KEYS.includes(k));

  let recomputed = { updated: 0, failed: [] };
  if (touchesArithmetic) {
    const filter = req.body?.recompute === 'all'
      ? {}
      : { status: { $in: ['pending_mgr', 'pending_hr'] } };
    recomputed = await recomputeEntries(filter, req.user);
  }

  return res.json({ policy: await Setting.effectivePolicy(), recomputed });
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

/** Manual replay — useful after a bulk holiday import or a data fix. */
router.post('/recompute', requireRole('admin', 'hr'), wrap(async (req, res) => {
  const filter = {};
  if (req.body?.period) filter.period = req.body.period;
  if (req.body?.status) filter.status = { $in: String(req.body.status).split(',') };
  res.json(await recomputeEntries(filter, req.user));
}));

export default router;
