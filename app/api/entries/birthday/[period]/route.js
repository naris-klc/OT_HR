import OtEntry from '@/src/models/OtEntry.js';
import Employee from '@/src/models/Employee.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { loadCalendar, contextFor, checkCap, applyComputation } from '@/src/services/otService.js';
import { computeSession } from '@/src/lib/otEngine.js';
import { stampCap, POPULATE } from '@/lib/entries.js';
import { PERIOD_RE } from '@/lib/reports.js';
import { today } from '@/lib/delegationQuery.js';
import {
  birthdayCandidates, filedKey, BIRTHDAY_START, BIRTHDAY_END,
  BIRTHDAY_DESCRIPTION, BIRTHDAY_NOTE, BIRTHDAY_CONFIRM_NOTE,
} from '@/lib/birthdayEntries.js';

/**
 * ใบ OT วันเกิด — propose the month's birthday requests, then write the ones HR
 * ticked.
 *
 * TWO METHODS, ONE ANSWER. `GET` previews and `POST` writes, and both build
 * their list through `birthdayCandidates()` from the roster and the calendar.
 * `POST` takes employee ids and NOTHING else: no date, no start and end time, no
 * hours. A client that asked for a different shift, a colleague's row or a day
 * that is not somebody's birthday is asking for something that is not in the
 * list, and gets it back as a skipped row with the reason.
 *
 * HR AND ADMIN ONLY, and this does not go through `proxyPermission` — which
 * refuses everyone but a department's own หัวหน้า and should keep doing so. That
 * rule governs a person filling in a form for somebody else with hours of their
 * choosing. This is a narrower authority than that one: fixed hours, on one date
 * per person that the calendar and the roster decide, for a benefit the policy
 * already grants. Widening `proxyPermission` to cover it would hand HR the
 * general power as a side effect of the specific one.
 *
 * The entries are created AND confirmed in this one press. There is no ขั้น
 * หัวหน้า and no second visit to รอ HR ยืนยัน: ฝ่ายบุคคล ticking a name is the
 * confirmation, and the same person pressing the same button again about the same
 * list checks nothing that the first press did not. `BIRTHDAY_CONFIRM_NOTE` is
 * the whole argument, and the history keeps both events with one name on them
 * rather than dressing one decision up as two.
 *
 * What replaces the queue is the way out: while nothing has touched the row,
 * ฝ่ายบุคคล can withdraw it (`isUntouchedSystemFiling` in lib/entries.js, offered
 * as ถอนใบ on the same card and in HR's per-employee list). It is the better
 * safeguard for this feature, because a proposal is not wrong about a rate — it
 * is wrong about somebody having been at work, which only a person can know.
 */
async function surveyFor(period) {
  const [calendar, roster] = await Promise.all([
    loadCalendar([`${period}-01`]),
    // Only people who may submit OT (§2 — managers, HR and Admin may not) and
    // only active ones. The same filter สรุป OT ส่งบัญชี uses for its blank rows.
    Employee.find({ active: true, role: 'employee' })
      .populate('department', 'code name nameTh monthlyCapHours weeklyCapHours')
      .select('code name birthDate department active role')
      .lean(),
  ]);

  /**
   * What is already on the books for this month, at any status that is alive.
   *
   * `rejected` and `cancelled` are deliberately NOT here. A refused request is
   * closed and its hours count nowhere, so the day is genuinely unclaimed — and
   * a withdrawn one even more so. Counting them would make one refusal in
   * February silently withhold the proposal every year after.
   */
  const live = await OtEntry.find({
    period,
    status: { $in: ['pending_mgr', 'pending_hr', 'approved'] },
  }).select('employee workDate').lean();

  const filed = new Set(live.map((e) => filedKey(e.employee, e.workDate)));

  return {
    calendar,
    roster,
    survey: birthdayCandidates({
      period,
      // Bangkok's date, from the one helper that answers that question — a
      // birthday that has not happened yet is not proposed, and this is where
      // the clock enters. Everything below it is pure.
      today: today(),
      roster,
      isHoliday: calendar.isHoliday,
      policy: calendar.policy,
      filed,
    }),
  };
}

/** The proposal, and a reason beside every name that is not in it. */
export const GET = route(async (req, { params }) => {
  requireRole(await requireAuth(req), 'hr', 'admin');

  const { period } = params;
  if (!PERIOD_RE.test(period)) return fail('ประจำเดือนต้องเป็นรูปแบบ YYYY-MM', 400);

  const { survey } = await surveyFor(period);
  return json({
    period,
    ...survey,
    session: { startTime: BIRTHDAY_START, endTime: BIRTHDAY_END },
  });
});

/**
 * Write the ticked ones.
 *
 * One entry at a time, and a failure is reported rather than thrown: this is a
 * batch a person is watching, and eleven requests written plus one that hit a
 * department ceiling is a better outcome than an error page and no way to tell
 * which eleven would have been fine. Every row comes back in `created` or in
 * `skipped` with its reason, so the count on screen is the count in the
 * database.
 */
export const POST = route(async (req, { params }) => {
  const user = requireRole(await requireAuth(req), 'hr', 'admin');

  const { period } = params;
  if (!PERIOD_RE.test(period)) return fail('ประจำเดือนต้องเป็นรูปแบบ YYYY-MM', 400);

  const payload = await body(req);
  const wanted = Array.isArray(payload.employeeIds) ? payload.employeeIds.map(String) : null;
  if (!wanted?.length) return fail('ต้องระบุพนักงานที่จะสร้างใบให้อย่างน้อย 1 คน', 400);

  const { calendar, roster, survey } = await surveyFor(period);
  if (survey.ruleOff) {
    return fail('กฎวันหยุดวันเกิดปิดอยู่ — เปิดที่นโยบายการคำนวณก่อนจึงจะสร้างใบวันเกิดได้', 409);
  }

  const byId = new Map(roster.map((e) => [String(e._id), e]));
  const eligible = new Map(survey.eligible.map((c) => [c.employeeId, c]));

  // Asked for, but not on the list this request just built. Either it was never
  // eligible, or the answer moved while the screen was open — somebody filed
  // their own hours for that date a minute ago. Both are the same to the caller:
  // nothing was written for that person, and here is why.
  const skipped = survey.skipped
    .filter((s) => wanted.includes(s.employeeId))
    .map((s) => ({ ...s, reasonSource: 'survey' }));

  const created = [];
  for (const id of wanted) {
    const candidate = eligible.get(id);
    if (!candidate) {
      if (!skipped.some((s) => s.employeeId === id)) {
        skipped.push({ employeeId: id, code: byId.get(id)?.code ?? '', name: byId.get(id)?.name ?? '', reason: 'notEligible' });
      }
      continue;
    }

    const employee = byId.get(id);
    const session = {
      workDate: candidate.date,
      startTime: BIRTHDAY_START,
      endTime: BIRTHDAY_END,
      endsNextDay: false,
      noBreakTaken: false,
    };

    // The same engine, the same day types, the same policy version as any other
    // filing — resolved for THIS person, which is where the birthday enters.
    const ctx = contextFor(calendar, session, employee);
    const result = computeSession(session, ctx);

    /**
     * The engine's own veto, and the reason this loop computes before it writes.
     *
     * If the day did not resolve to a holiday for this person, 08:00–17:00 is
     * ordinary working time and produces no OT at all. `birthdayCandidates`
     * should already have excluded that case; this is the check that does not
     * depend on it being right. An entry of nought hours would sit in HR's queue
     * looking like a request.
     */
    if (result.totals.otHours <= 0) {
      skipped.push({ ...candidate, reason: 'noHours' });
      continue;
    }

    const cap = await checkCap({
      employee,
      department: employee.department,
      period,
      result,
      policy: calendar.policy,
    });
    // [OPEN 8] 'block' refuses a filing that would breach the department's
    // ceiling, and it refuses this one too. A proposal HR did not type is the
    // last thing that should be the exception to a limit they set.
    if (cap.blocked) {
      skipped.push({ ...candidate, reason: 'capBlocked' });
      continue;
    }

    const entry = new OtEntry({
      employee: employee._id,
      department: employee.department._id,
      /** Who ordered it. The request is still the employee's — this is the one
          field that records that they did not type it. */
      filedBy: user._id,
      ...session,
      description: BIRTHDAY_DESCRIPTION,
      status: 'pending_hr',
    });
    applyComputation(entry, result, ctx);
    stampCap(entry, cap);
    // Its own action, not a `submit` with a note: "who filed this and why" has to
    // be machine-readable, and the trail on this row is the only place anybody
    // can see that a human did not fill the form in. See ACTION_META in
    // components/common.jsx for what it reads as.
    entry.log(user, 'submit_birthday', BIRTHDAY_NOTE, null);

    /**
     * Confirmed in the same press — see BIRTHDAY_CONFIRM_NOTE for why that is
     * one decision and not two, and for what stands in for the queue.
     *
     * Written as two history rows in the order they happened, so the trail reads
     * ยื่น → ฝ่ายบุคคลยืนยัน with one name and one timestamp on both. Filing it
     * straight into `approved` would leave a row that was never filed by anybody,
     * and `fromStatus` on the confirmation would have nothing to point at.
     *
     * `managerDecision` is deliberately left empty. Nobody signed as หัวหน้า, and
     * an entry that claimed otherwise would be the exact lie `initialStatus` in
     * lib/proxyFiling.js refuses to tell.
     */
    entry.hrDecision = { by: user._id, at: new Date(), note: BIRTHDAY_CONFIRM_NOTE };
    entry.status = 'approved';
    entry.log(user, 'approve_hr', BIRTHDAY_CONFIRM_NOTE, 'pending_hr');

    await entry.save();

    created.push(await entry.populate(POPULATE));
  }

  return json({ period, created, skipped }, created.length ? 201 : 200);
});
