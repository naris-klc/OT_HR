import { Router } from 'express';
import OtEntry from '../models/OtEntry.js';
import Employee from '../models/Employee.js';
import Setting from '../models/Setting.js';
import { requireAuth, requireRole, wrap } from '../middleware/auth.js';
import { OtValidationError } from '../lib/otEngine.js';
import { normaliseDescription } from '../config/policy.js';
import { blockedMessage } from '../../lib/caps.js';
import { weekdayOtRefusal } from '../../lib/otMode.js';
import {
  compute, applyComputation, checkCap, loadContext, monthlyUsage, birthDateOf,
} from '../services/otService.js';
// `pickSession` and `stampCap` below are this file's own copies, from before the
// split. `sameSession` is not copied: it decides whether an edit keeps the
// version it replaced, and a second copy that drifted would lose forms rather
// than merely disagree about them. lib/entries.js imports nothing, so plain
// node can load it as happily as Next can.
import { sameSession, noOtHoursMessage } from '../../lib/entries.js';

const router = Router();
router.use(requireAuth);

const POPULATE = [
  { path: 'employee', select: 'code name position role' },
  { path: 'department', select: 'code name nameTh monthlyCapHours weeklyCapHours otMode' },
];

/** Role scoping (§2): own / own department / everything. */
function scopeFor(user) {
  if (user.role === 'employee') return { employee: user._id };
  if (user.role === 'manager') return { department: user.department?._id };
  return {}; // hr, admin
}

// ── list ────────────────────────────────────────────────────────────────────

router.get('/', wrap(async (req, res) => {
  const { status, period, employee, department, from, to } = req.query;
  const query = { ...scopeFor(req.user) };

  if (status) query.status = { $in: String(status).split(',') };
  if (period) query.period = period;
  if (employee && req.user.role !== 'employee') query.employee = employee;
  if (department && ['hr', 'admin'].includes(req.user.role)) query.department = department;
  if (from || to) {
    query.workDate = {};
    if (from) query.workDate.$gte = from;
    if (to) query.workDate.$lte = to;
  }

  const entries = await OtEntry.find(query)
    .populate(POPULATE)
    .sort({ workDate: -1, createdAt: -1 })
    .limit(Number(req.query.limit) || 500)
    .lean();

  res.json({ entries });
}));

/** Queue counts for the manager's daily review and HR's monthly review (§2). */
router.get('/queue-summary', wrap(async (req, res) => {
  const scope = scopeFor(req.user);
  const [pendingMgr, pendingHr] = await Promise.all([
    OtEntry.countDocuments({ ...scope, status: 'pending_mgr' }),
    OtEntry.countDocuments({ ...scope, status: 'pending_hr' }),
  ]);
  res.json({ pendingMgr, pendingHr });
}));

router.get('/:id', wrap(async (req, res) => {
  const entry = await OtEntry.findOne({ _id: req.params.id, ...scopeFor(req.user) }).populate(POPULATE);
  if (!entry) return res.status(404).json({ error: 'ไม่พบรายการ' });
  return res.json({ entry });
}));

// ── preview: compute without saving, so the form can show the split live ────

router.post('/preview', wrap(async (req, res) => {
  const session = pickSession(req.body);

  // Loaded before the computation: day types depend on whose birthday it is, so
  // a preview computed without the employee would disagree with the submit.
  const employeeId = req.user.role === 'employee' ? req.user._id : req.body.employeeId;
  const employee = employeeId
    ? await Employee.findById(employeeId).populate('department')
    : null;

  const ctx = await loadContext([session.workDate], { employee });
  const result = await compute(session, ctx);

  const cap = employee
    ? await checkCap({
      employee,
      department: employee.department,
      period: session.workDate.slice(0, 7),
      result,
      excludeId: req.body.entryId || null,
      policy: ctx.policy,
    })
    : null;

  const weekdayRefusal = employee ? weekdayOtRefusal(employee.department, result) : null;

  res.json({ result, cap, weekdayRefusal });
}));

// ── submit ──────────────────────────────────────────────────────────────────

router.post('/', wrap(async (req, res) => {
  // §2: managers are not eligible to submit OT. HR and Admin are not either —
  // they administer the process rather than take part in it.
  if (!req.user.maySubmitOt()) {
    return res.status(403).json({ error: 'ตำแหน่งนี้ไม่สามารถบันทึก OT ได้' });
  }

  const session = pickSession(req.body);
  const { value: description, error: descriptionError } = normaliseDescription(req.body.description);
  if (descriptionError) return res.status(400).json({ error: descriptionError });

  const ctx = await loadContext([session.workDate], { employee: req.user });
  const result = await compute(session, ctx);

  if (result.totals.otHours <= 0) {
    return res.status(400).json({
      error: noOtHoursMessage(session, ctx.policy, ctx.dayTypes, result),
      warnings: result.warnings,
    });
  }

  // รูปแบบโอทีของแผนก — see lib/otMode.js, and the App Router copy of this
  // path, which carries the reasoning.
  const weekdayRefusal = weekdayOtRefusal(req.user.department, result);
  if (weekdayRefusal) {
    return res.status(409).json({ error: weekdayRefusal, warnings: result.warnings });
  }

  const period = session.workDate.slice(0, 7);
  const cap = await checkCap({
    employee: req.user,
    department: req.user.department,
    period,
    result,
    policy: ctx.policy,
  });

  // [OPEN 8] 'block' refuses here; 'warn' lets it through carrying the flag.
  // Names every ceiling that refused it — the weekly one included, or an
  // employee turned away by the week is sent to fix the month.
  if (cap.blocked) return res.status(409).json({ error: blockedMessage(cap), cap });

  const entry = new OtEntry({
    employee: req.user._id,
    department: req.user.department._id,
    ...session,
    description,
    status: 'pending_mgr',
  });
  applyComputation(entry, result, ctx);
  stampCap(entry, cap);
  entry.log(req.user, 'submit', null, null);
  await entry.save();

  return res.status(201).json({ entry: await entry.populate(POPULATE), cap });
}));

// ── edit (own request while still pending_mgr, or HR / Admin) ───────────────

router.patch('/:id', wrap(async (req, res) => {
  const entry = await OtEntry.findById(req.params.id).populate(POPULATE);
  if (!entry) return res.status(404).json({ error: 'ไม่พบรายการ' });

  // Same rule as app/api/entries/[id]/route.js, which is the implementation
  // that runs: the employee may correct their own request until a manager has
  // approved it, HR and Admin may correct any live one with a reason, and the
  // approval an entry already has stands. Kept in step with it so this retired
  // server cannot be started and quietly allow what the live one does not.
  const isHr = ['hr', 'admin'].includes(req.user.role);
  const isOwner = String(entry.employee?._id || entry.employee) === String(req.user._id);
  const reason = String(req.body.note || '').trim();

  if (isHr) {
    if (['rejected', 'cancelled'].includes(entry.status)) {
      return res.status(409).json({ error: 'รายการที่ไม่อนุมัติหรือยกเลิกแล้ว แก้ไขไม่ได้ ให้พนักงานส่งใหม่' });
    }
    if (!reason) return res.status(400).json({ error: 'กรุณาระบุเหตุผลการแก้ไข' });
  } else if (isOwner && req.user.role === 'employee') {
    if (entry.status !== 'pending_mgr') {
      return res.status(409).json({
        error: ['rejected', 'cancelled'].includes(entry.status)
          ? 'รายการที่ไม่อนุมัติหรือยกเลิกแล้ว แก้ไขไม่ได้ — กด “ส่งใหม่” เพื่อยื่นคำขอใหม่'
          : 'รายการที่อนุมัติแล้ว แก้ไขเองไม่ได้ — ติดต่อฝ่ายบุคคลเพื่อแก้ไข',
      });
    }
  } else {
    return res.status(403).json({
      error: 'แก้ไขได้เฉพาะรายการของตนเองที่ยังรอหัวหน้าอนุมัติ หรือโดยฝ่ายบุคคล',
    });
  }

  // What the entry says now, captured before anything overwrites it.
  const before = entry.snapshot();

  const session = pickSession({ ...entry.toObject(), ...req.body });
  // Whoever the entry is FOR, which is not the actor when HR is editing.
  const ctx = await loadContext([session.workDate], {
    employee: { birthDate: await birthDateOf(entry.employee?._id || entry.employee) },
  });
  const result = await compute(session, ctx);
  if (result.totals.otHours <= 0) {
    return res.status(400).json({
      error: noOtHoursMessage(session, ctx.policy, ctx.dayTypes, result),
      warnings: result.warnings,
    });
  }

  Object.assign(entry, session);
  if (req.body.description != null) {
    const { value, error } = normaliseDescription(req.body.description);
    if (error) return res.status(400).json({ error });
    entry.description = value;
  }

  const weekdayRefusal = weekdayOtRefusal(entry.department, result);
  if (weekdayRefusal) {
    return res.status(409).json({ error: weekdayRefusal, warnings: result.warnings });
  }

  const cap = await checkCap({
    employee: entry.employee,
    department: entry.department,
    period: session.workDate.slice(0, 7),
    result,
    excludeId: entry._id,
    policy: ctx.policy,
  });
  if (cap.blocked) return res.status(409).json({ error: blockedMessage(cap), cap });

  applyComputation(entry, result, ctx);
  stampCap(entry, cap);

  // status untouched either way — HR's edit keeps the approvals already
  // collected, and the employee's entry has none to keep.
  const changed = !sameSession(before, entry.snapshot());
  entry.log(req.user, isHr ? 'hr_edit' : 'edit', reason || null, entry.status, changed ? before : null);
  await entry.save();

  return res.json({ entry: await entry.populate(POPULATE), cap });
}));

// ── cancel (§6: own request, while still pending_mgr) ────────────────────────

router.post('/:id/cancel', wrap(async (req, res) => {
  const entry = await OtEntry.findById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'ไม่พบรายการ' });
  if (String(entry.employee) !== String(req.user._id)) {
    return res.status(403).json({ error: 'ยกเลิกได้เฉพาะรายการของตนเอง' });
  }
  if (entry.status !== 'pending_mgr') {
    return res.status(409).json({ error: 'ยกเลิกได้เฉพาะรายการที่ยังรอหัวหน้า' });
  }

  const from = entry.status;
  entry.status = 'cancelled';
  entry.log(req.user, 'cancel', req.body?.note, from);
  await entry.save();
  return res.json({ entry: await entry.populate(POPULATE) });
}));

// ── approve ─────────────────────────────────────────────────────────────────

router.post('/:id/approve', requireRole('manager', 'hr', 'admin'), wrap(async (req, res) => {
  const entry = await OtEntry.findById(req.params.id).populate('department');
  if (!entry) return res.status(404).json({ error: 'ไม่พบรายการ' });

  const note = req.body?.note;
  const from = entry.status;

  if (req.user.role === 'manager') {
    if (entry.status !== 'pending_mgr') return res.status(409).json({ error: 'รายการนี้ไม่ได้อยู่ในขั้นรอหัวหน้า' });
    if (String(entry.department._id) !== String(req.user.department?._id)) {
      return res.status(403).json({ error: 'อนุมัติได้เฉพาะรายการในแผนกของตน' });
    }
    entry.managerDecision = { by: req.user._id, at: new Date(), note };
    entry.status = 'pending_hr';
    entry.log(req.user, 'approve_mgr', note, from);
  } else {
    // §6: two steps are required. HR confirming a request the manager has not
    // seen would collapse the flow to one, so it is refused.
    if (entry.status !== 'pending_hr') {
      return res.status(409).json({ error: 'ต้องผ่านการอนุมัติจากหัวหน้าก่อน' });
    }
    entry.hrDecision = { by: req.user._id, at: new Date(), note };
    entry.status = 'approved';
    entry.log(req.user, 'approve_hr', note, from);
  }

  await entry.save();
  return res.json({ entry: await entry.populate(POPULATE) });
}));

// ── reject ──────────────────────────────────────────────────────────────────

router.post('/:id/reject', requireRole('manager', 'hr', 'admin'), wrap(async (req, res) => {
  const entry = await OtEntry.findById(req.params.id).populate('department');
  if (!entry) return res.status(404).json({ error: 'ไม่พบรายการ' });

  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' });

  const policy = await Setting.effectivePolicy();
  const from = entry.status;

  if (req.user.role === 'manager') {
    if (entry.status !== 'pending_mgr') return res.status(409).json({ error: 'รายการนี้ไม่ได้อยู่ในขั้นรอหัวหน้า' });
    if (String(entry.department._id) !== String(req.user.department?._id)) {
      return res.status(403).json({ error: 'ดำเนินการได้เฉพาะรายการในแผนกของตน' });
    }
    entry.managerDecision = { by: req.user._id, at: new Date(), note: reason };
    entry.status = 'rejected';
    entry.rejectionReason = reason;
    entry.log(req.user, 'reject_mgr', reason, from);
  } else {
    // [OPEN 7] Can HR reject what the manager already approved, and where does
    // it land? Both halves are policy flags.
    if (!policy.hrMayReject) {
      return res.status(403).json({ error: 'ตามนโยบายปัจจุบัน HR ไม่สามารถปฏิเสธรายการที่หัวหน้าอนุมัติแล้ว' });
    }
    if (entry.status !== 'pending_hr') return res.status(409).json({ error: 'รายการนี้ไม่ได้อยู่ในขั้นรอ HR' });

    entry.hrDecision = { by: req.user._id, at: new Date(), note: reason };
    if (policy.hrRejectReturnsTo === 'manager') {
      entry.status = 'pending_mgr';
    } else {
      entry.status = 'rejected';
      entry.rejectionReason = reason;
    }
    entry.log(req.user, 'reject_hr', reason, from);
  }

  await entry.save();
  return res.json({ entry: await entry.populate(POPULATE) });
}));

// ── cap override (§7: HR and Admin can override a cap) ───────────────────────

router.post('/:id/cap-override', requireRole('hr', 'admin'), wrap(async (req, res) => {
  const entry = await OtEntry.findById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'ไม่พบรายการ' });

  entry.capOverride = {
    by: req.user._id,
    at: new Date(),
    reason: String(req.body?.reason || '').trim() || 'อนุมัติเกินเพดานโดย HR',
  };
  entry.capExceeded = false;
  entry.log(req.user, 'edit', `cap override: ${entry.capOverride.reason}`, entry.status);
  await entry.save();
  return res.json({ entry: await entry.populate(POPULATE) });
}));

// ── monthly usage against the cap ────────────────────────────────────────────

router.get('/usage/:period', wrap(async (req, res) => {
  const employeeId = req.query.employee && req.user.role !== 'employee'
    ? req.query.employee
    : req.user._id;
  const employee = await Employee.findById(employeeId).populate('department');
  if (!employee) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

  const { summary, usedHours, basis } = await monthlyUsage(employee._id, req.params.period);
  return res.json({
    period: req.params.period,
    summary,
    usedHours,
    basis,
    capHours: employee.department?.monthlyCapHours ?? null,
  });
}));

// ── helpers ─────────────────────────────────────────────────────────────────

function pickSession(body) {
  return {
    workDate: String(body.workDate || '').slice(0, 10),
    startTime: normaliseTime(body.startTime),
    endTime: normaliseTime(body.endTime),
    endsNextDay: Boolean(body.endsNextDay),
    noBreakTaken: Boolean(body.noBreakTaken),
  };
}

function normaliseTime(t) {
  const s = String(t || '').trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
}

function stampCap(entry, cap) {
  entry.capExceeded = Boolean(cap?.exceeded);
  entry.capSnapshot = cap
    ? { capHours: cap.capHours, usedHoursBefore: cap.usedHoursBefore, basis: cap.basis }
    : undefined;
}

/** Turn engine validation errors into 400s rather than 500s. */
router.use((err, req, res, next) => {
  if (err instanceof OtValidationError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  return next(err);
});

export default router;
