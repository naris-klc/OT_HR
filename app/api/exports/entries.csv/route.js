import OtEntry, { STATUS_LABEL_TH } from '@/src/models/OtEntry.js';
import { SIGNER_ROLES } from '@/lib/roles.js';
import { route, query, csvResponse } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { BUCKETS } from '@/src/lib/otEngine.js';
import { toCsv } from '@/src/lib/csv.js';
import { latestPerSession, reportStatuses, departmentScope } from '@/lib/reports.js';
import { companyOf } from '@/src/config/companies.js';
import { signsForCompany } from '@/lib/entries.js';
import { compareCodes } from '@/src/lib/employeeCode.js';

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
  // WHICH แผนก — the same three lines the report route and the other CSV ran,
  // and since 2026-09-10 the same FUNCTION: `departmentScope` in lib/reports.js,
  // which is where the reasoning that used to be copied here now lives. It
  // answers both `?scope=` (the บทบาท's reading — one team or the company) and
  // `?department=` (the แผนก dropdown on ตรวจสอบประจำเดือน), and neither can
  // widen this file past what the บทบาท alone allows.
  //
  // This is an export button UNDER that table, so it takes both parameters the
  // table did — a CSV that ignored the dropdown its own screen was set to would
  // be a file that is longer than the rows it was asked for, discovered in a
  // spreadsheet by whoever is reconciling it.
  const { teamOnly, department } = departmentScope(user, q);
  if (department) filter.department = department;

  /**
   * `.sort({ 'employee.code': 1, workDate: 1 })` STOOD HERE and sorted by
   * NEITHER of those things.
   *
   * `employee` on an entry is an ObjectId reference; `populate` replaces it in
   * the documents mongoose hands back, long after the database has decided the
   * order. So mongo was asked to sort on a path no document has — which it does
   * not refuse, it simply orders by nothing there — and the `workDate` beside
   * it was then the only live clause. The file came out in date order with the
   * people interleaved, and the column it claimed to be sorted by was the one
   * thing it was not.
   *
   * Found on 2026-09-03 while making the two report screens order numerically.
   * Sorted below, in JavaScript, where the populated code actually exists.
   */
  const found = await OtEntry.find(filter)
    .populate('employee', 'code name position company')
    .populate('department', 'code name nameTh')
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
   * ฝ่ายบุคคล, ผู้ดูแลระบบ and การเงิน are untouched — all three read the whole
   * month either way.
   */
  const all = teamOnly && user.approvesCompany
    ? found.filter((e) => signsForCompany(user, companyOf(e.employee)))
    : found;

  // One row per session, not per filing. This file is a list rather than a
  // total, but it is a list somebody sums: leaving a superseded filing in it
  // would put the discarded hours back into payroll by way of a spreadsheet.
  const { shown } = latestPerSession(all);

  /**
   * One person's month together, in the order the screen lists them — by
   * รหัสพนักงาน numerically (`compareCodes`), then by the date and the clock
   * inside each person.
   *
   * `startTime` as the third key because a person can hold two requests on one
   * date once an overnight session is involved, and two rows that are equal on
   * every key are two rows `.sort()` may return either way round — which is a
   * file that reorders itself between two exports of an unchanged month.
   */
  const entries = [...shown].sort((a, b) => (
    compareCodes(a.employee?.code, b.employee?.code)
    || String(a.workDate).localeCompare(String(b.workDate))
    || String(a.startTime).localeCompare(String(b.startTime))
  ));

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
