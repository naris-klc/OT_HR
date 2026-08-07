import { Router } from 'express';
import multer from 'multer';
import Employee, { ROLES } from '../models/Employee.js';
import Department from '../models/Department.js';
import { requireAuth, requireRole, wrap } from '../middleware/auth.js';
import { parseCsv, pick, toCsv } from '../lib/csv.js';
import { publicEmployee } from '../../lib/employees.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

router.use(requireAuth);

router.get('/', wrap(async (req, res) => {
  const query = {};
  // A manager only ever needs their own 5–6 people (§9).
  if (req.user.role === 'manager') query.department = req.user.department?._id;
  else if (req.user.role === 'employee') query._id = req.user._id;
  if (req.query.department && ['hr', 'admin'].includes(req.user.role)) query.department = req.query.department;
  if (!req.query.all) query.active = true;

  const employees = await Employee.find(query)
    .populate('department', 'code name nameTh monthlyCapHours')
    .sort({ code: 1 })
    .lean();
  // Same rule as the App Router roster — `.lean()` carries birthDate and a
  // manager listing their department must not receive it.
  res.json({ employees: employees.map((e) => publicEmployee(e, req.user)) });
}));

router.post('/', requireRole('admin'), wrap(async (req, res) => {
  const { code, name, email, position, department, role, password } = req.body || {};
  if (!code || !name || !department) {
    return res.status(400).json({ error: 'ต้องระบุรหัสพนักงาน ชื่อ-สกุล และแผนก' });
  }
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง' });

  const employee = new Employee({ code, name, email: email || undefined, position, department, role: role || 'employee' });
  await employee.setPassword(password || defaultPassword(code));
  await employee.save();

  res.status(201).json({ employee: await employee.populate('department', 'code name nameTh') });
}));

router.patch('/:id', requireRole('admin'), wrap(async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

  const { name, email, position, department, role, active, password } = req.body || {};
  if (name != null) employee.name = name;
  if (email !== undefined) employee.email = email || undefined;
  if (position != null) employee.position = position;
  if (department != null) employee.department = department;
  if (role != null) {
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง' });
    employee.role = role;
  }
  if (active != null) employee.active = Boolean(active);
  if (password) await employee.setPassword(password);

  await employee.save();
  return res.json({ employee: await employee.populate('department', 'code name nameTh') });
}));

/** Change own password. */
router.post('/me/password', wrap(async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 6) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร' });

  const me = await Employee.findById(req.user._id).select('+passwordHash');
  if (!(await me.verifyPassword(String(current || '')))) {
    return res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
  }
  await me.setPassword(String(next));
  await me.save();
  return res.json({ ok: true });
}));

// ── [OPEN 11] roster import ─────────────────────────────────────────────────
// Built regardless of HR's answer: if they hand over a file, use the upload;
// if they read names down the phone, Admin uses the form above. Neither
// answer blocks v1.

router.get('/import/template', requireRole('admin'), (req, res) => {
  const body = toCsv(
    ['code', 'name', 'email', 'position', 'department', 'role'],
    [['PM-0412', 'สมชาย ใจดี', 'somchai@primus.co.th', 'ช่างเทคนิค', 'ENG', 'employee']],
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="employee-import-template.csv"');
  res.send(Buffer.from(body, 'utf8'));
});

router.post('/import', requireRole('admin'), upload.single('file'), wrap(async (req, res) => {
  const text = req.file ? req.file.buffer.toString('utf8') : String(req.body?.csv || '');
  if (!text.trim()) return res.status(400).json({ error: 'ไม่พบไฟล์หรือข้อมูล CSV' });

  const rows = parseCsv(text);
  const departments = await Department.find().lean();
  const byCode = new Map(departments.map((d) => [d.code.toUpperCase(), d]));

  const created = [];
  const updated = [];
  const errors = [];

  for (const [i, row] of rows.entries()) {
    const line = i + 2; // header is line 1
    try {
      const code = pick(row, 'code', 'รหัสพนักงาน', 'employee_code').toUpperCase();
      const name = pick(row, 'name', 'ชื่อ-สกุล', 'ชื่อ');
      const deptCode = pick(row, 'department', 'แผนก', 'dept').toUpperCase();
      if (!code || !name) { errors.push({ line, error: 'ต้องมี code และ name' }); continue; }

      const department = byCode.get(deptCode);
      if (!department) { errors.push({ line, error: `ไม่พบแผนกรหัส "${deptCode}"` }); continue; }

      const role = (pick(row, 'role', 'บทบาท') || 'employee').toLowerCase();
      if (!ROLES.includes(role)) { errors.push({ line, error: `บทบาทไม่ถูกต้อง "${role}"` }); continue; }

      const existing = await Employee.findOne({ code });
      if (existing) {
        existing.name = name;
        existing.position = pick(row, 'position', 'ตำแหน่ง') || existing.position;
        existing.email = pick(row, 'email', 'อีเมล') || existing.email;
        existing.department = department._id;
        existing.role = role;
        await existing.save();
        updated.push(code);
      } else {
        const employee = new Employee({
          code,
          name,
          position: pick(row, 'position', 'ตำแหน่ง'),
          email: pick(row, 'email', 'อีเมล') || undefined,
          department: department._id,
          role,
        });
        await employee.setPassword(pick(row, 'password') || defaultPassword(code));
        await employee.save();
        created.push(code);
      }
    } catch (err) {
      errors.push({ line, error: err.message });
    }
  }

  res.json({ created: created.length, updated: updated.length, errors, codes: { created, updated } });
}));

/**
 * First-login password when none is supplied. Everyone must change it — see
 * POST /api/employees/me/password.
 */
function defaultPassword(code) {
  return `Primus@${String(code).replace(/\W/g, '')}`;
}

export default router;
