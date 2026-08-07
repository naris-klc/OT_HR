import { Router } from 'express';
import OtEntry, { STATUS_LABEL_TH } from '../models/OtEntry.js';
import Employee from '../models/Employee.js';
import Setting from '../models/Setting.js';
import { requireAuth, wrap } from '../middleware/auth.js';
import {
  BUCKETS, BUCKET_LABEL_TH, summariseEntries, hrSummary, capUsage, makeIsHoliday,
} from '../lib/otEngine.js';
import { loadHolidaySet } from '../services/otService.js';
import { formDayTypes } from '../../lib/reports.js';

const router = Router();
router.use(requireAuth);

const PERIOD_RE = /^\d{4}-\d{2}$/;

/**
 * The data behind the printable F-HR-027 Rev.4 — one employee, one month (§10).
 *
 * Rows are built from SEGMENTS, not entries. That matters: an overnight session
 * belongs to two dates and the paper form has one row per date, so Friday's row
 * shows 17:00–24:00 and Saturday's shows 00:00–07:00 in different columns. An
 * entry-shaped row could not express that.
 */
router.get('/form/:period', wrap(async (req, res) => {
  const { period } = req.params;
  if (!PERIOD_RE.test(period)) return res.status(400).json({ error: 'ประจำเดือนต้องเป็นรูปแบบ YYYY-MM' });

  const employeeId = req.query.employee && req.user.role !== 'employee' ? req.query.employee : req.user._id;
  const employee = await Employee.findById(employeeId).populate('department');
  if (!employee) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

  if (req.user.role === 'manager'
    && String(employee.department?._id) !== String(req.user.department?._id)) {
    return res.status(403).json({ error: 'ดูได้เฉพาะพนักงานในแผนกของตน' });
  }

  const statuses = String(req.query.status || 'approved,pending_hr,pending_mgr').split(',');
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

  // Resolved for this employee, so the grid agrees with the hours beside it —
  // see the App Router copy of this route for why.
  const dates = [];
  for (let day = 1; day <= daysInMonth; day++) {
    dates.push(`${period}-${String(day).padStart(2, '0')}`);
  }
  const dayTypes = formDayTypes(dates, {
    isHoliday: makeIsHoliday(holidays, policy),
    birthDate: employee.birthDate,
    policy,
  });

  const rows = dates.map((date, i) => ({
    day: i + 1,
    date,
    isHoliday: dayTypes[date].type === 'holiday',
    dayReason: dayTypes[date].reason,
    sessions: [],
  }));
  const byDate = new Map(rows.map((r) => [r.date, r]));

  const inPeriod = [];
  for (const entry of entries) {
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

  return res.json({
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
}));

/** HR's monthly review: every employee's totals for a period, in one table. */
router.get('/monthly/:period', wrap(async (req, res) => {
  const { period } = req.params;
  if (!PERIOD_RE.test(period)) return res.status(400).json({ error: 'ประจำเดือนต้องเป็นรูปแบบ YYYY-MM' });
  if (!['hr', 'admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'ไม่มีสิทธิ์ใช้งานส่วนนี้' });
  }

  const policy = await Setting.effectivePolicy();
  const query = { period };
  if (req.user.role === 'manager') query.department = req.user.department?._id;
  else if (req.query.department) query.department = req.query.department;
  query.status = { $in: String(req.query.status || 'approved,pending_hr,pending_mgr').split(',') };

  const entries = await OtEntry.find(query)
    .populate('employee', 'code name position')
    .populate('department', 'code name nameTh monthlyCapHours')
    .lean();

  const byEmployee = new Map();
  for (const entry of entries) {
    const key = String(entry.employee?._id);
    if (!byEmployee.has(key)) {
      byEmployee.set(key, { employee: entry.employee, department: entry.department, entries: [] });
    }
    byEmployee.get(key).entries.push(entry);
  }

  const employees = [...byEmployee.values()].map((group) => {
    const summary = summariseEntries(group.entries);
    const capHours = group.department?.monthlyCapHours ?? null;
    const used = capUsage(summary, policy);
    return {
      employee: group.employee,
      department: group.department,
      entryCount: group.entries.length,
      pendingCount: group.entries.filter((e) => e.status !== 'approved').length,
      summary,
      hrSection: hrSummary(summary, policy),
      cap: { capHours, usedHours: used, exceeded: capHours != null && used > capHours, basis: policy.capBasis },
    };
  }).sort((a, b) => a.employee.code.localeCompare(b.employee.code));

  const grand = summariseEntries(entries);
  return res.json({ period, employees, grandTotal: grand, hrSection: hrSummary(grand, policy) });
}));

// ── helpers ─────────────────────────────────────────────────────────────────

const min = (a, b) => (a <= b ? a : b);
const max = (a, b) => (a >= b ? a : b);

function previousPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** "2026-08" → "สิงหาคม 2569" — the form prints ประจำเดือน in พ.ศ. */
function thaiMonth(period) {
  const [y, m] = period.split('-').map(Number);
  return `${THAI_MONTHS[m - 1]} ${y + 543}`;
}

export default router;
