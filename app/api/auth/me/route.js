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
      /**
       * WHICH DAYS ARE THE WEEKEND — added 2026-09-08 for `isCompanyOffDay` in
       * lib/entries.js, which decides whether บันทึก OT draws the ไม่พักเที่ยง
       * box (HR: เฉพาะวันหยุดเสาร์อาทิตย์และวันหยุดของบริษัท ไม่รวมวันเกิด).
       *
       * IT IS NOT A BIRTH DATE AND CANNOT BECOME ONE, which is the whole reason
       * the rule is answered in the browser at all: this list plus the company
       * holiday calendar is exactly the half of `resolveDayTypes` that is about
       * everybody, and the half HR asked to be excluded is the half the screen
       * is not allowed to hold. See the function's own note.
       *
       * `weekStartsOn` above is a different key and answers a different
       * question — where a WEEK begins, for naming the span of a weekly cap
       * breach. Nothing in this app should read one for the other.
       */
      weekendDays: policy.weekendDays,
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
