import OtEntry, { STATUS_LABEL_TH } from '@/src/models/OtEntry.js';
import { route, query, csvResponse } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { BUCKETS } from '@/src/lib/otEngine.js';
import { toCsv } from '@/src/lib/csv.js';
import { latestPerSession } from '@/lib/reports.js';

/**
 * §10 data export — for HR to hand to whoever runs payroll.
 *
 * There are no baht in this file and there never will be (§11). It carries
 * hours per bucket; applying a rate is somebody else's job.
 *
 * Written with a UTF-8 BOM by toCsv, without which Excel on Thai Windows
 * renders every ชื่อ-สกุล as mojibake.
 */
export const GET = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'hr', 'admin', 'manager');
  const q = query(req);

  const filter = {};
  if (q.period) filter.period = q.period;
  if (q.from || q.to) {
    filter.workDate = {};
    if (q.from) filter.workDate.$gte = q.from;
    if (q.to) filter.workDate.$lte = q.to;
  }
  // Default to approved only: the export feeds payroll, and an unapproved
  // request is not yet a fact.
  filter.status = { $in: String(q.status || 'approved').split(',') };
  if (user.role === 'manager') filter.department = user.department?._id;
  else if (q.department) filter.department = q.department;

  const all = await OtEntry.find(filter)
    .populate('employee', 'code name position')
    .populate('department', 'code name nameTh')
    .sort({ 'employee.code': 1, workDate: 1 })
    .lean();

  // One row per session, not per filing. This file is a list rather than a
  // total, but it is a list somebody sums: leaving a superseded filing in it
  // would put the discarded hours back into payroll by way of a spreadsheet.
  const { shown: entries } = latestPerSession(all);

  const headers = [
    'รหัสพนักงาน', 'ชื่อ-สกุล', 'แผนก', 'วันที่', 'จาก', 'ถึง', 'ข้ามคืน', 'ไม่พักเที่ยง',
    'OT วันปกติ (x1.5)', 'OT วันหยุด 8-17 (x1.5)', 'OT วันหยุด นอกเวลา (x3)',
    'รวมชั่วโมง', 'รายละเอียดงานที่ทำ', 'สถานะ', 'หัวหน้าอนุมัติเมื่อ', 'HR อนุมัติเมื่อ',
  ];

  const rows = entries.map((e) => [
    e.employee?.code,
    e.employee?.name,
    e.department?.nameTh || e.department?.name,
    e.workDate,
    e.startTime,
    e.endTime,
    e.endsNextDay ? 'ใช่' : '',
    e.noBreakTaken ? 'ใช่' : '',
    fmt(e.buckets?.[BUCKETS.OT15_WEEKDAY]),
    fmt(e.buckets?.[BUCKETS.OT15_HOLIDAY]),
    fmt(e.buckets?.[BUCKETS.OT3_HOLIDAY]),
    fmt(e.totals?.otHours),
    e.description,
    STATUS_LABEL_TH[e.status] || e.status,
    isoDate(e.managerDecision?.at),
    isoDate(e.hrDecision?.at),
  ]);

  const period = q.period || `${q.from || 'all'}_${q.to || ''}`;
  return csvResponse(`OT-${period}.csv`, toCsv(headers, rows));
});

const fmt = (n) => (n == null ? '' : String(Math.round(Number(n) * 100) / 100));
const isoDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
