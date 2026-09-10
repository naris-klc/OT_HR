import { Router } from 'express';
import OtEntry, { STATUS_LABEL_TH } from '../../src/models/OtEntry.js';
import Setting from '../../src/models/Setting.js';
import { requireAuth, requireRole, wrap } from '../middleware/auth.js';
import { BUCKETS, summariseEntries, hrSummary } from '../../src/lib/otEngine.js';
import { sendCsv } from '../../src/lib/csv.js';

const router = Router();
router.use(requireAuth, requireRole('hr', 'admin', 'supervisor'));

/**
 * §10 data export — for HR to hand to whoever runs payroll.
 *
 * There are no baht in this file and there never will be (§11). It carries
 * hours per bucket; applying a rate is somebody else's job.
 *
 * Written with a UTF-8 BOM by sendCsv, without which Excel on Thai Windows
 * renders every ชื่อ-สกุล as mojibake.
 */
router.get('/entries.csv', wrap(async (req, res) => {
  const query = {};
  if (req.query.period) query.period = req.query.period;
  if (req.query.from || req.query.to) {
    query.workDate = {};
    if (req.query.from) query.workDate.$gte = req.query.from;
    if (req.query.to) query.workDate.$lte = req.query.to;
  }
  // Default to approved only: the export feeds payroll, and an unapproved
  // request is not yet a fact.
  query.status = { $in: String(req.query.status || 'approved').split(',') };
  if (req.user.role === 'supervisor') query.department = req.user.department?._id;
  else if (req.query.department) query.department = req.query.department;

  const entries = await OtEntry.find(query)
    .populate('employee', 'code name position')
    .populate('department', 'code name nameTh')
    .sort({ 'employee.code': 1, workDate: 1 })
    .lean();

  const headers = [
    'รหัสพนักงาน', 'ชื่อ-สกุล', 'แผนก', 'วันที่', 'จาก', 'ถึง', 'ไม่พักเที่ยง',
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

  const period = req.query.period || `${req.query.from || 'all'}_${req.query.to || ''}`;
  sendCsv(res, `OT-${period}.csv`, headers, rows);
}));

/** One row per employee per month — the shape HR actually reviews. */
router.get('/monthly.csv', wrap(async (req, res) => {
  const period = req.query.period;
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) {
    return res.status(400).json({ error: 'ต้องระบุ period เป็น YYYY-MM' });
  }

  const policy = await Setting.effectivePolicy();
  const query = { period, status: { $in: String(req.query.status || 'approved').split(',') } };
  if (req.user.role === 'supervisor') query.department = req.user.department?._id;
  else if (req.query.department) query.department = req.query.department;

  const entries = await OtEntry.find(query)
    .populate('employee', 'code name position')
    .populate('department', 'code name nameTh monthlyCapHours weeklyCapHours')
    .lean();

  const grouped = new Map();
  for (const e of entries) {
    const key = String(e.employee?._id);
    if (!grouped.has(key)) grouped.set(key, { employee: e.employee, department: e.department, list: [] });
    grouped.get(key).list.push(e);
  }

  const multiplied = policy.hrSummaryBasis === 'multiplied';
  const headers = [
    'รหัสพนักงาน', 'ชื่อ-สกุล', 'แผนก', 'ประจำเดือน',
    'OT วันปกติ (x1.5)', 'OT วันหยุด 8-17 (x1.5)', 'OT วันหยุด นอกเวลา (x3)',
    `OT x1.5 (${multiplied ? 'คูณแล้ว' : 'ชั่วโมงดิบ'})`,
    `OT x3 (${multiplied ? 'คูณแล้ว' : 'ชั่วโมงดิบ'})`,
    'รวม', 'จำนวนรายการ', 'เพดานแผนก', 'ใช้ไป',
  ];

  const rows = [...grouped.values()]
    .sort((a, b) => String(a.employee?.code).localeCompare(String(b.employee?.code)))
    .map((g) => {
      const s = summariseEntries(g.list);
      const hr = hrSummary(s, policy);
      return [
        g.employee?.code,
        g.employee?.name,
        g.department?.nameTh || g.department?.name,
        period,
        fmt(s.buckets[BUCKETS.OT15_WEEKDAY]),
        fmt(s.buckets[BUCKETS.OT15_HOLIDAY]),
        fmt(s.buckets[BUCKETS.OT3_HOLIDAY]),
        fmt(hr.ot15),
        fmt(hr.ot3),
        fmt(hr.total),
        g.list.length,
        g.department?.monthlyCapHours ?? 'ไม่กำหนด',
        fmt(policy.capBasis === 'weighted' ? s.weightedHours : s.otHours),
      ];
    });

  return sendCsv(res, `OT-monthly-${period}.csv`, headers, rows);
}));

const fmt = (n) => (n == null ? '' : String(Math.round(Number(n) * 100) / 100));
const isoDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export default router;
