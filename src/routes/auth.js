import { Router } from 'express';
import Employee from '../models/Employee.js';
import Setting from '../models/Setting.js';
import { signToken, setAuthCookie, clearAuthCookie, requireAuth, wrap } from '../middleware/auth.js';

const router = Router();

router.post('/login', wrap(async (req, res) => {
  const { code, password } = req.body || {};
  if (!code || !password) return res.status(400).json({ error: 'กรุณากรอกรหัสพนักงานและรหัสผ่าน' });

  const user = await Employee.findOne({ code: String(code).trim().toUpperCase() })
    .select('+passwordHash')
    .populate('department');

  if (!user || !user.active || !(await user.verifyPassword(password))) {
    return res.status(401).json({ error: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง' });
  }

  setAuthCookie(res, signToken(user));
  return res.json({ user: publicUser(user) });
}));

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, wrap(async (req, res) => {
  const policy = await Setting.effectivePolicy();
  res.json({
    user: publicUser(req.user),
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
      hrSummaryBasis: policy.hrSummaryBasis,
      hrMayReject: policy.hrMayReject,
    },
  });
}));

export function publicUser(user) {
  return {
    id: String(user._id),
    code: user.code,
    name: user.name,
    role: user.role,
    position: user.position,
    maySubmitOt: user.role === 'employee',
    department: user.department
      ? {
        id: String(user.department._id),
        code: user.department.code,
        name: user.department.nameTh || user.department.name,
        monthlyCapHours: user.department.monthlyCapHours ?? null,
      }
      : null,
  };
}

export default router;
