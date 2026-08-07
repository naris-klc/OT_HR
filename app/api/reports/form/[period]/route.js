import OtEntry, { STATUS_LABEL_TH } from '@/src/models/OtEntry.js';
import Employee from '@/src/models/Employee.js';
import Setting from '@/src/models/Setting.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import {
  BUCKETS, BUCKET_LABEL_TH, summariseEntries, hrSummary, capUsage, makeIsHoliday,
  resolveDayTypes,
} from '@/src/lib/otEngine.js';
import { loadHolidaySet } from '@/src/services/otService.js';
import {
  PERIOD_RE, previousPeriod, thaiMonth, min, max, latestPerSession,
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

  if (user.role === 'manager'
    && String(employee.department?._id) !== String(user.department?._id)) {
    return fail('ดูได้เฉพาะพนักงานในแผนกของตน', 403);
  }

  const statuses = String(q.status || 'approved,pending_hr,pending_mgr').split(',');
  const policy = await Setting.effectivePolicy();

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
   * The calendar down the left of the sheet, resolved for THIS employee.
   *
   * It has to be the same resolution the hours were computed from, or the sheet
   * contradicts itself: a birthday Tuesday carries ot15_holiday hours, and a
   * grid drawn from the company calendar alone would print them against a row
   * marked วันทำงาน. The reason rides along so the row can say why — this is
   * the employee's own form, and a day marked หยุด with no explanation is the
   * thing that generates the phone call.
   */
  const dates = [];
  for (let day = 1; day <= daysInMonth; day++) {
    dates.push(`${period}-${String(day).padStart(2, '0')}`);
  }
  const dayTypes = resolveDayTypes(dates, {
    isHoliday: makeIsHoliday(holidays, policy),
    birthDate: employee.birthDate,
    policy,
  });

  const rows = dates.map((date, i) => ({
    day: i + 1,
    date,
    isHoliday: dayTypes[date].type === 'holiday',
    /** 'weekend' | 'companyHoliday' | 'birthday' | null. */
    dayReason: dayTypes[date].reason,
    sessions: [],
  }));
  const byDate = new Map(rows.map((r) => [r.date, r]));

  // Two filings of one session print as one row — the newest. This runs before
  // the row and summary loop rather than after it, so สรุปรวม counts exactly
  // what the rows above it show; a total that included a hidden row would be a
  // figure the sheet cannot be checked against.
  const { shown, hidden } = latestPerSession(entries);

  const inPeriod = [];
  for (const entry of shown) {
    for (const seg of entry.segments || []) {
      const row = byDate.get(seg.date);
      if (!row) continue; // segment belongs to the neighbouring month
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
          continuedFromPreviousDay: seg.date !== entry.workDate,
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
       * Duplicate filings kept off the sheet. Not printed — the paper form has
       * no place for them — but returned so the screen can name the hours it
       * dropped rather than let them vanish between two documents.
       */
      hidden: hidden.filter((e) => (e.segments || []).some((s) => byDate.has(s.date))).map((e) => ({
        id: String(e._id),
        workDate: e.workDate,
        from: e.startTime,
        to: e.endTime,
        description: e.description,
        otHours: e.totals?.otHours ?? 0,
        status: e.status,
        statusLabel: STATUS_LABEL_TH[e.status],
      })),
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
