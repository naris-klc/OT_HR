import OtEntry, { STATUS_LABEL_TH } from '@/src/models/OtEntry.js';
import { isSigner } from '@/lib/roles.js';
import Employee from '@/src/models/Employee.js';
import Setting from '@/src/models/Setting.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import {
  BUCKETS, BUCKET_LABEL_TH, summariseEntries, hrSummary, capUsage, makeIsHoliday,
} from '@/src/lib/otEngine.js';
import { loadHolidaySet } from '@/src/services/otService.js';
import { companyOf } from '@/src/config/companies.js';
import { isDepartmentManager } from '@/lib/entries.js';
import { managerSignature } from '@/lib/approverLine.js';
import {
  PERIOD_RE, actingNotes, previousPeriod, thaiMonth, min, max, latestPerSession,
  formDayTypes, formPrintStatuses, formPendingStatuses,
} from '@/lib/reports.js';

/**
 * The data behind the printable F-HR-027 Rev.4 — one employee, one month (§10).
 *
 * Rows are built from SEGMENTS, not entries. That matters: an overnight session
 * belongs to two dates and the paper form has one row per date, so Friday's row
 * shows 17:00–24:00 and Saturday's shows 00:00–07:00 in different columns. An
 * entry-shaped row could not express that.
 */
export const GET = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const { period } = params;
  if (!PERIOD_RE.test(period)) return fail('ประจำเดือนต้องเป็นรูปแบบ YYYY-MM', 400);

  const q = query(req);
  const employeeId = q.employee && user.role !== 'employee' ? q.employee : user._id;
  const employee = await Employee.findById(employeeId).populate('department');
  if (!employee) return fail('ไม่พบพนักงาน', 404);

  /**
   * A department they sign for, and their own half of it where their signature
   * is scoped to one payroll. This is the sheet a หัวหน้า signs; one belonging
   * to somebody they cannot sign for is not theirs to print.
   *
   * `isDepartmentManager` rather than the two halves written out here, which is
   * what this was: `employee.department === user.department` plus a
   * `signsForCompany`. That spelling was the whole rule right up until a
   * หัวหน้า could be ticked into another แผนก, at which point it became a
   * reviewer who may approve somebody's request and may not print the sheet
   * that request goes onto. One function, so the two cannot come apart again.
   */
  if (isSigner(user.role)
    && !isDepartmentManager(user, employee.department, companyOf(employee))) {
    return fail('ดูได้เฉพาะพนักงานในแผนกของตน', 403);
  }

  const policy = await Setting.effectivePolicy();

  /**
   * WHICH ROWS THIS SHEET MAY CARRY — the policy's answer first, the screen's
   * request only where the policy defers to it.
   *
   * Decided HERE rather than on the print screen, and that placement is the
   * setting. `?status=` arrives from a browser: under เฉพาะรายการที่อนุมัติแล้ว
   * a client that sends the wider list — a stale tab, a typed URL, a screen
   * added later that forgot — must still be answered with approved rows alone,
   * or the strict answer is a convention rather than a rule. See
   * `formPrintStatuses` in lib/reports.js for the table.
   *
   * Withdrawn and refused requests are on nobody's F-HR-027 under any of the
   * three answers: `reportStatuses` drops them inside that function, as it does
   * for every other report. The sheet is a statement of what a person worked.
   */
  const { scope: printScope, statuses } = formPrintStatuses(policy, q.status);

  /**
   * …and which of the rows that reach the paper it marks as unsettled, which
   * is a narrower list than "not approved". On a sheet no รอหัวหน้า row can
   * reach, รอ HR is not one of them: the หัวหน้า has signed, and the step
   * still open is the เฉพาะฝ่ายบุคคล box at the foot of this very sheet. See
   * `formPendingStatuses` in lib/reports.js.
   */
  const pendingStatuses = formPendingStatuses(statuses);

  // An overnight session started on the last day of the previous month spills
  // into this month, so widen the query by one period and filter by segment.
  const entries = await OtEntry.find({
    employee: employee._id,
    period: { $in: [period, previousPeriod(period)] },
    status: { $in: statuses },
  }).sort({ workDate: 1, startTime: 1 }).lean();

  const [year, month] = period.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const holidays = await loadHolidaySet([year]);

  /**
   * The calendar down the left of the sheet — the company one, for everybody.
   *
   * `formDayTypes` takes no birth date and this route has none to give it: the
   * sheet carries no birthday remark since HR asked for it off F-HR-027
   * (2026-08-10), and the remark lives on สรุป OT ส่งบัญชี now. Nothing below
   * this line depends on the map either — the hours come from `entry.segments`,
   * resolved when each entry was filed, so a Tuesday somebody's birthday made a
   * holiday still prints in the วันหยุด columns with the day number beside it.
   */
  const dates = [];
  for (let day = 1; day <= daysInMonth; day++) {
    dates.push(`${period}-${String(day).padStart(2, '0')}`);
  }
  const dayTypes = formDayTypes(dates, {
    isHoliday: makeIsHoliday(holidays, policy),
    policy,
  });

  const rows = dates.map((date, i) => ({
    day: i + 1,
    date,
    /** The company calendar's answer, and no reason field — so no row can
        explain a holiday by naming whose day it was. */
    isHoliday: dayTypes[date].type === 'holiday',
    sessions: [],
  }));
  const byDate = new Map(rows.map((r) => [r.date, r]));

  // Two filings of one session print as one row — the newest. This runs before
  // the row and summary loop rather than after it, so สรุปรวม counts exactly
  // what the rows above it show; a total that included a hidden row would be a
  // figure the sheet cannot be checked against.
  const { shown, hidden } = latestPerSession(entries);

  /**
   * ONE DATE, ONE LINE — and after 2026-09-02 that is a rule about the SHEET as
   * well as about filing.
   *
   * `findSameDate` in lib/overlap.js has refused a second live request on a
   * date since 2026-08-31, so two requests can no longer meet on one line. The
   * one thing that still could was an overnight session: it is ONE request, and
   * its segments land on two dates, so the night filed against the 7th drew a
   * second line on the 8th above the 8th's own request. HR asked for that line
   * off the sheet on 2026-09-02, having been shown what it costs.
   *
   * SO A SEGMENT PRINTS ONLY ON THE DATE ITS REQUEST WAS FILED AGAINST. The
   * hours after midnight are not moved anywhere — they are dropped from the
   * rows AND from สรุปรวม together, because a total that counted a line the
   * sheet does not show is the one thing worse than a short total.
   *
   * ⚠ THIS SHEET NOW UNDER-REPORTS AN OVERNIGHT MONTH, on purpose and by
   * exactly the hours after midnight. ตรวจสอบประจำเดือน, the CSVs and
   * สรุป OT ส่งบัญชี all still count them — they read entries and segments, not
   * this route — so a month with an overnight session will not reconcile
   * against the paper, and the difference is `notPrinted` below. That list is
   * returned so the screen can say so before anybody signs; see `FormNotices`
   * in components/PrintForm.jsx.
   *
   * The neighbouring-month case was already this way and is the precedent: a
   * segment landing outside the grid has never printed. What is new is that a
   * segment landing INSIDE the grid, on a date that is not its own, no longer
   * prints either.
   */
  const printsOn = (entry, seg) => seg.date === entry.workDate && byDate.has(seg.date);

  const inPeriod = [];
  /** Hours a segment of one of these requests worked, that no line will show. */
  const notPrinted = [];
  for (const entry of shown) {
    for (const seg of entry.segments || []) {
      const row = byDate.get(seg.date);
      if (!row) continue; // segment belongs to the neighbouring month
      if (!printsOn(entry, seg)) {
        // The hours after a midnight. Counted nowhere on this sheet — not in a
        // row and not in สรุปรวม — and named here so the screen can.
        notPrinted.push({
          id: String(entry._id),
          workDate: entry.workDate,
          onDate: seg.date,
          from: seg.start,
          to: seg.end,
          hours: seg.hours,
          bucket: seg.bucket,
          description: entry.description,
          status: entry.status,
          statusLabel: STATUS_LABEL_TH[entry.status],
        });
        continue;
      }
      let session = row.sessions.find((s) => s.entryId === String(entry._id));
      if (!session) {
        session = {
          entryId: String(entry._id),
          from: seg.start,
          to: seg.end,
          description: entry.description,
          status: entry.status,
          statusLabel: STATUS_LABEL_TH[entry.status],
          noBreakTaken: entry.noBreakTaken,
          /**
           * `continuedFromPreviousDay` WAS HERE and is gone (2026-09-02). It
           * was `seg.date !== entry.workDate`, which `printsOn` above now
           * refuses outright — so the field could only ever be false, and the
           * (ต่อจากคืนก่อน) mark it drove could never draw. A flag that cannot
           * be true is a reader's false lead, not a spare part.
           */
          /**
           * This row was filled in by somebody other than the person the sheet
           * is for. Printed as a short mark in the description cell, where
           * [ไม่พักเที่ยง] already is — the one place on this form that carries
           * per-row remarks and the one HR already reads. Read off the history
           * so a leaver's filing still says so.
           */
          filedByProxy: (entry.history || []).some((h) => h.action === 'submit_proxy'),
          /**
           * WHO SIGNED THE หัวหน้างาน STEP — the name that prints in the
           * ลงชื่อหัวหน้างาน column, and null where that column stays blank.
           *
           * Per SESSION and not per sheet, because it is per ENTRY: a month is
           * signed a request at a time, by whichever หัวหน้า was on the queue
           * that day, and a stand-in may have signed some of them. One name at
           * the foot of the sheet would be one of those names presented as all
           * of them.
           *
           * `managerSignature` decides which history row that is (lib/
           * approverLine.js) — the same module the pop-up's การอนุมัติ list
           * reads, so the paper and the screen cannot come to disagree about
           * who signed. A row still at รอหัวหน้า, and one ฝ่ายบุคคล filed and
           * approved from the fingerprint scanner, both answer null: nobody has
           * signed that step, and a blank box is what an unsigned form looks
           * like.
           */
          approverName: managerSignature(entry)?.name || null,
          [BUCKETS.OT15_WEEKDAY]: 0,
          [BUCKETS.OT15_HOLIDAY]: 0,
          [BUCKETS.OT3_HOLIDAY]: 0,
        };
        row.sessions.push(session);
      }
      session.from = min(session.from, seg.start);
      session.to = max(session.to, seg.end);
      session[seg.bucket] += seg.hours;
      inPeriod.push({ buckets: { [seg.bucket]: seg.hours }, totals: { otHours: seg.hours } });
    }
  }

  const summary = summariseEntries(inPeriod);

  /**
   * The three lists below the sheet — unsettled, unmarked, folded away — are
   * three readings of the same month, so they are one shape and one test of
   * what counts as being on this sheet at all. A row is on it when a segment
   * of it lands on a date the grid has, which is what put it in `rows` above.
   */
  /**
   * `printsOn` AND NOT `byDate.has` ALONE, since 2026-09-02.
   *
   * The three lists below say what this sheet is carrying and what it is not,
   * and they have to mean the same thing by "on it" as the grid does. A request
   * filed against 31 August that runs to 02:00 has a segment on 1 September:
   * under the old test it was "on" the September sheet and could be reported as
   * pending or unmarked there, while now no line of that sheet shows it. One
   * predicate, so a request cannot be listed under a month it does not print in.
   */
  const onSheet = (e) => (e.segments || []).some((s) => printsOn(e, s));
  const brief = (e) => ({
    id: String(e._id),
    workDate: e.workDate,
    from: e.startTime,
    to: e.endTime,
    description: e.description,
    otHours: e.totals?.otHours ?? 0,
    status: e.status,
    statusLabel: STATUS_LABEL_TH[e.status],
  });

  return json({
    form: {
      code: (await Setting.load()).formCode,
      employee: {
        code: employee.code,
        name: employee.name,
        position: employee.position,
        department: employee.department?.nameTh || employee.department?.name,
      },
      period,
      periodLabel: thaiMonth(period),
      columns: {
        [BUCKETS.OT15_WEEKDAY]: BUCKET_LABEL_TH[BUCKETS.OT15_WEEKDAY],
        [BUCKETS.OT15_HOLIDAY]: BUCKET_LABEL_TH[BUCKETS.OT15_HOLIDAY],
        [BUCKETS.OT3_HOLIDAY]: BUCKET_LABEL_TH[BUCKETS.OT3_HOLIDAY],
      },
      rows,
      /**
       * Which of the three answers to `formPrintScope` produced this sheet.
       *
       * Returned on every print, not only the ones it changed, because the
       * screen has to be able to explain a sheet that ignored สถานะที่นับ. Under
       * เฉพาะรายการที่อนุมัติแล้ว the filter is deliberately not consulted, and
       * a print that quietly disagrees with the table above it — with no reason
       * on the page — is the thing this whole setting exists to stop.
       */
      printScope,
      /**
       * The rows on this sheet still waiting on a decision the sheet is not
       * itself the place for — empty under the strict answer, by construction,
       * and empty too under อนุมัติแล้ว + รอ HR, where the only step left is
       * the เฉพาะฝ่ายบุคคล box at the foot (see `formPendingStatuses`).
       *
       * Named for the screen the way `hidden` is, and for the opposite reason:
       * `hidden` is hours that are NOT on the paper, this is hours that ARE and
       * should not be signed for as though they were settled. The paper says so
       * itself with (รออนุมัติ) in the description cell; this is the list, so
       * whoever pressed print can act on it without reading 31 rows.
       */
      pending: shown.filter((e) => onSheet(e) && pendingStatuses.includes(e.status)).map(brief),
      /**
       * The other half of the same question: rows on this sheet that are not
       * approved and carry NO mark — รอ HR under a filter that counts it as
       * signed, which is อนุมัติแล้ว + รอ HR on ตรวจสอบรายเดือน.
       *
       * The paper is deliberately silent about them; this list is why the
       * screen is not. Whoever pressed print chose that filter and can read
       * the statuses in the table they pressed it from, so it is one quiet
       * line rather than the warning `pending` raises — but a sheet that
       * counts hours ฝ่ายบุคคล has not confirmed yet may not become a sheet
       * that never said so.
       */
      unmarked: shown
        .filter((e) => onSheet(e) && e.status !== 'approved'
          && !pendingStatuses.includes(e.status))
        .map(brief),
      /**
       * Who filled rows in and who signed them, when that was not the obvious
       * person — the note block under the grid.
       *
       * Built from the rows the sheet actually prints (`shown`), so a note can
       * never point at a filing that was folded off the page. Returned whatever
       * `proxyNoteOnForm` says: the flag decides whether the PAPER carries the
       * block, and the screen above the sheet says it either way, because the
       * person holding both is entitled to know what the page leaves out.
       */
      acting: actingNotes(shown),
      /** [proxyNoteOnForm] Does the note block print, or stay on the screen? */
      actingOnPaper: Boolean(policy.proxyNoteOnForm),
      /**
       * Duplicate filings kept off the sheet. Not printed — the paper form has
       * no place for them — but returned so the screen can name the hours it
       * dropped rather than let them vanish between two documents.
       */
      hidden: hidden.filter((e) => onSheet(e)).map(brief),
      /**
       * THE HOURS AFTER A MIDNIGHT — worked, approved, in the database, and on
       * no line of this sheet since 2026-09-02, when หนึ่งวัน หนึ่งใบ was
       * extended from filing to the paper itself.
       *
       * The mirror of `hidden` above and a strictly worse case than it, which
       * is why it is its own list rather than folded in. `hidden` is a
       * duplicate FILING that the sheet is right to drop and that no other
       * report counts either; this is hours every other report DOES count. So
       * the sheet and ตรวจสอบประจำเดือน disagree by exactly this list, and the
       * person holding both has to be told which side is short and by how much.
       *
       * On the screen only, like every other list here — the paper is the thing
       * that is silent about them, and adding a note to it would be adding a
       * line to a controlled form to explain a line that was taken off it.
       */
      notPrinted,
      /**
       * Their sum — the exact figure by which this sheet is short against every
       * other document for the month. Added here rather than totted up in the
       * browser because it is the one number the notice leads with, and a total
       * derived twice is a total that can disagree with its own list.
       */
      notPrintedHours: Math.round(notPrinted.reduce((n, s) => n + (s.hours || 0), 0) * 100) / 100,
      /** สรุปรวม — one total per hour column. */
      summary: summary.buckets,
      totalHours: summary.otHours,
      /** [OPEN 12] raw hours, or hours × multiplier — set by policy. */
      hrSection: hrSummary(summary, policy),
      cap: {
        capHours: employee.department?.monthlyCapHours ?? null,
        usedHours: capUsage(summary, policy),
        basis: policy.capBasis,
      },
    },
  });
});
