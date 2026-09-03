import OtEntry, { STATUS_LABEL_TH } from '@/src/models/OtEntry.js';
import { SIGNER_ROLES, isSigner } from '@/lib/roles.js';
import { route, query, csvResponse } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { BUCKETS } from '@/src/lib/otEngine.js';
import { toCsv } from '@/src/lib/csv.js';
import { latestPerSession, reportStatuses } from '@/lib/reports.js';
import { companyOf } from '@/src/config/companies.js';
import { approvalDepartments, signsForCompany } from '@/lib/entries.js';

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
  const user = requireRole(await requireAuth(req), 'hr', 'admin', ...SIGNER_ROLES);
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
  filter.status = { $in: reportStatuses(q.status, 'approved') };
  // Every department this หัวหน้า signs for, not only their own — the same list
  // `isDepartmentManager` decides each row from. A report narrower than the
  // approve rule hides hours its reader is responsible for.
  if (isSigner(user.role)) filter.department = { $in: approvalDepartments(user) };
  else if (q.department) filter.department = q.department;

  const found = await OtEntry.find(filter)
    .populate('employee', 'code name position company')
    .populate('department', 'code name nameTh')
    .sort({ 'employee.code': 1, workDate: 1 })
    .lean();

  /**
   * And the หัวหน้า's own half of it, where their signature is scoped to one
   * payroll — the same rule the queue and the ลูกทีม picker use, applied to a
   * report so that the rows on it are the rows this person is answerable for.
   *
   * Filtered in JavaScript over the populated employee rather than as a clause
   * on the query, for the reason `companyRosters` resolves the same sets that
   * way: nothing on an entry records a company, and a row whose `company` was
   * never filled in is still on a payroll that only the code prefix knows.
   *
   * ฝ่ายบุคคล and Admin are untouched — they read the whole month either way.
   */
  const all = isSigner(user.role) && user.approvesCompany
    ? found.filter((e) => signsForCompany(user, companyOf(e.employee)))
    : found;

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
