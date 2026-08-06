import Setting from '@/src/models/Setting.js';
import { DEFAULT_POLICY } from '@/src/config/policy.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { recomputeEntries } from '@/src/services/otService.js';

/**
 * Answering an [OPEN] item at runtime.
 *
 * Changing an arithmetic flag (break, rounding, minimum) changes what stored
 * entries mean, so entries still in flight are replayed through the engine.
 * Approved entries are left alone by default — they have been signed off, and
 * silently restating a signed number is worse than an inconsistency. Pass
 * `recompute: 'all'` to replay those too.
 */
export const PATCH = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'admin', 'hr');
  const payload = await body(req);

  const incoming = payload?.policy || {};
  const unknown = Object.keys(incoming).filter((k) => !(k in DEFAULT_POLICY));
  if (unknown.length) return fail(`ไม่รู้จักค่านโยบาย: ${unknown.join(', ')}`, 400);

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
    const filter = payload?.recompute === 'all'
      ? {}
      : { status: { $in: ['pending_mgr', 'pending_hr'] } };
    recomputed = await recomputeEntries(filter, user);
  }

  return json({ policy: await Setting.effectivePolicy(), recomputed });
});
