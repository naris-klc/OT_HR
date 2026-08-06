import Setting from '@/src/models/Setting.js';
import { route, json } from '@/lib/http.js';
import { requireAuth, publicUser } from '@/lib/session.js';

export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const policy = await Setting.effectivePolicy();

  return json({
    user: publicUser(user),
    // The UI needs the live policy to label the form correctly (break rule,
    // rounding increment, whether a cap blocks or warns).
    policy: {
      coreStartMinute: policy.coreStartMinute,
      coreEndMinute: policy.coreEndMinute,
      breakMode: policy.breakMode,
      roundingMode: policy.roundingMode,
      roundingIncrementMinutes: policy.roundingIncrementMinutes,
      minimumHours: policy.minimumHours,
      capBehaviour: policy.capBehaviour,
      capBasis: policy.capBasis,
      hrSummaryBasis: policy.hrSummaryBasis,
      hrMayReject: policy.hrMayReject,
    },
  });
});
