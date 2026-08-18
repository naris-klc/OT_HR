import { Router } from 'express';
import Department from '../models/Department.js';
import Employee from '../models/Employee.js';
import { requireAuth, requireRole, wrap } from '../middleware/auth.js';
import { capHoursFrom } from '../../lib/caps.js';
import { otModeFrom } from '../../lib/otMode.js';

const router = Router();
router.use(requireAuth);

router.get('/', wrap(async (req, res) => {
  const departments = await Department.find(req.query.all ? {} : { active: true })
    .populate('manager', 'code name')
    .sort({ code: 1 })
    .lean();

  const counts = await Employee.aggregate([
    { $match: { active: true } },
    { $group: { _id: '$department', headcount: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.headcount]));

  res.json({
    departments: departments.map((d) => ({ ...d, headcount: byId.get(String(d._id)) || 0 })),
  });
}));

router.post('/', requireRole('admin'), wrap(async (req, res) => {
  const {
    code, name, nameTh, manager, monthlyCapHours, weeklyCapHours, otMode,
  } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: 'ต้องระบุรหัสและชื่อแผนก' });

  const mode = otModeFrom(otMode);
  if (mode === null) return res.status(400).json({ error: 'รูปแบบโอทีของแผนกไม่ถูกต้อง' });

  const department = await Department.create({
    code, name, nameTh,
    manager: manager || null,
    // §7: caps are per-department and OPTIONAL. Empty means no cap, which is
    // not the same as a cap of 0 — see `capHoursFrom`.
    monthlyCapHours: capHoursFrom(monthlyCapHours),
    weeklyCapHours: capHoursFrom(weeklyCapHours),
    otMode: mode,
  });
  res.status(201).json({ department });
}));

router.patch('/:id', requireRole('admin', 'hr'), wrap(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department) return res.status(404).json({ error: 'ไม่พบแผนก' });

  const {
    name, nameTh, manager, monthlyCapHours, weeklyCapHours, active, otMode,
  } = req.body || {};
  if (name != null) department.name = name;
  if (nameTh != null) department.nameTh = nameTh;
  if (active != null) department.active = Boolean(active);
  if (manager !== undefined) department.manager = manager || null;
  if (monthlyCapHours !== undefined) department.monthlyCapHours = capHoursFrom(monthlyCapHours);
  if (weeklyCapHours !== undefined) department.weeklyCapHours = capHoursFrom(weeklyCapHours);
  if (otMode !== undefined) {
    const mode = otModeFrom(otMode);
    if (mode === null) return res.status(400).json({ error: 'รูปแบบโอทีของแผนกไม่ถูกต้อง' });
    department.otMode = mode;
  }

  await department.save();
  res.json({ department });
}));

export default router;
