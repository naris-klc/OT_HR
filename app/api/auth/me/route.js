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
      // Which day a week opens on, so the screens can name the span a weekly
      // breach is about rather than printing a bare date.
      weekStartsOn: policy.weekStartsOn,
      hrSummaryBasis: policy.hrSummaryBasis,
      hrMayReject: policy.hrMayReject,
      /**
       * กรอบเวลาการยื่นใบ. The date box on บันทึก OT turns these into its own
       * `min` and `max`, so the calendar cannot offer a day the write path is
       * about to refuse — see `submissionWindow` in lib/entries.js, which both
       * sides read.
       *
       * Sent even when they are the shipped defaults. A key left out is not
       * "no limit" to `submissionWindow`: absent reads as 0 in the forward
       * direction on purpose, so trimming this to save two fields would lock
       * the picker to today.
       */
      maxAdvanceSubmissionDays: policy.maxAdvanceSubmissionDays,
      maxPastSubmissionDays: policy.maxPastSubmissionDays,
    },
  });
});
