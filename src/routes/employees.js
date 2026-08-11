import { Router } from 'express';
import multer from 'multer';
import Employee, { ROLES } from '../models/Employee.js';
import Department from '../models/Department.js';
import { requireAuth, requireRole, wrap } from '../middleware/auth.js';
import { parseCsv, pick, toCsv } from '../lib/csv.js';
import {
  PASSWORD_MIN_LENGTH, defaultPassword, publicEmployee, rosterPermission,
} from '../../lib/employees.js';
import { rosterChanges } from '../../lib/rosterAudit.js';
import { recordRosterChange } from '../../lib/rosterAuditLog.js';
import { codeMatcher, sameCode, codeCollisions, collisionMessage } from '../lib/employeeCode.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

/**
 * One field snapshot, in the shape `rosterChanges` compares — the same helper
 * the App Router's routes build theirs from.
 *
 * THIS ROUTER STILL LAGS THE APP ROUTER and always has: it knows nothing of
 * `birthDate`, `company` or a รหัสพนักงาน change, so those fields cannot move
 * through here at all. That is why they are read anyway — the diff describes the
 * ROW, not what this particular handler happens to support, so a field written
 * by the Next.js server and left alone here reads as unchanged rather than as
 * absent.
 */
const snapshot = (e) => ({
  code: e.code,
  name: e.name,
  email: e.email,
  position: e.position,
  birthDate: e.birthDate,
  department: e.department,
  role: e.role,
  company: e.company,
  active: e.active,
});

router.use(requireAuth);

router.get('/', wrap(async (req, res) => {
  const query = {};
  // A manager only ever needs their own 5–6 people (§9).
  if (req.user.role === 'manager') query.department = req.user.department?._id;
  else if (req.user.role === 'employee') query._id = req.user._id;
  if (req.query.department && ['hr', 'admin'].includes(req.user.role)) query.department = req.query.department;
  if (!req.query.all) query.active = true;

  const employees = await Employee.find(query)
    .populate('department', 'code name nameTh monthlyCapHours weeklyCapHours')
    .sort({ code: 1 })
    .lean();
  // Same rule as the App Router roster — `.lean()` carries birthDate and a
  // manager listing their department must not receive it.
  res.json({ employees: employees.map((e) => publicEmployee(e, req.user)) });
}));

router.post('/', requireRole('admin', 'hr'), wrap(async (req, res) => {
  const { code, name, email, position, department, role, password } = req.body || {};
  if (!code || !name || !department) {
    return res.status(400).json({ error: 'ต้องระบุรหัสพนักงาน ชื่อ-สกุล และแผนก' });
  }
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง' });

  const may = rosterPermission(req.user, { role: role || 'employee' });
  if (!may.ok) return res.status(may.status).json({ error: may.error });
  if (password && String(password).length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ error: `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร` });
  }

  const employee = new Employee({ code, name, email: email || undefined, position, department, role: role || 'employee' });
  const issued = password || defaultPassword(code);
  await employee.setPassword(issued);
  employee.mustChangePassword = true;
  await employee.save();

  const auditLogged = await recordRosterChange({
    employee, action: 'create', changes: rosterChanges({}, snapshot(employee)), actor: req.user,
  });

  res.status(201).json({
    employee: await employee.populate('department', 'code name nameTh'),
    password: issued,
    auditLogged,
  });
}));

router.patch('/:id', requireRole('admin', 'hr'), wrap(async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

  const { name, email, position, department, role, active, password } = req.body || {};
  if (role != null && !ROLES.includes(role)) return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง' });

  const may = rosterPermission(req.user, { target: employee, role: role ?? null });
  if (!may.ok) return res.status(may.status).json({ error: may.error });
  if (password && String(password).length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ error: `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร` });
  }

  // Read before a single field is assigned — the document below is mutated in
  // place, so a "before" taken afterwards would record nothing.
  const before = snapshot(employee);

  if (name != null) employee.name = name;
  if (email !== undefined) employee.email = email || undefined;
  if (position != null) employee.position = position;
  if (department != null) employee.department = department;
  if (role != null) employee.role = role;
  if (active != null) employee.active = Boolean(active);
  if (password) {
    await employee.setPassword(password);
    employee.mustChangePassword = true;
  }

  const changes = rosterChanges(before, snapshot(employee));
  await employee.save();

  /**
   * The roster is written from two servers, so it is audited by two servers.
   * `rosterChanges` is the same allowlist either way, which is what keeps the
   * password out of both without this handler having to know the rule.
   *
   * Note that this router recomputes nothing when a วันเกิด moves — it cannot,
   * because it never accepts one. The App Router's PATCH is the only path that
   * can change a birth date and it replays that person's ใบ ที่ยังไม่อนุมัติ.
   */
  const auditLogged = await recordRosterChange({
    employee,
    action: changes.length ? 'update' : 'password_reset',
    changes,
    passwordReset: Boolean(password),
    actor: req.user,
  });

  return res.json({
    employee: await employee.populate('department', 'code name nameTh'),
    auditLogged,
  });
}));

/** Change own password. */
router.post('/me/password', wrap(async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ error: `รหัสผ่านใหม่ต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร` });
  }
  if (String(next) === String(current || '')) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม' });
  }

  const me = await Employee.findById(req.user._id).select('+passwordHash');
  if (!(await me.verifyPassword(String(current || '')))) {
    return res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
  }
  await me.setPassword(String(next));
  me.mustChangePassword = false;
  await me.save();
  return res.json({ ok: true });
}));

// ── [OPEN 11] roster import ─────────────────────────────────────────────────
// Built regardless of HR's answer: if they hand over a file, use the upload;
// if they read names down the phone, Admin uses the form above. Neither
// answer blocks v1.

router.get('/import/template', requireRole('admin', 'hr'), (req, res) => {
  const body = toCsv(
    ['code', 'name', 'email', 'position', 'department', 'role'],
    [['PM-0412', 'สมชาย ใจดี', 'somchai@primus.co.th', 'ช่างเทคนิค', 'ENG', 'employee']],
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="employee-import-template.csv"');
  res.send(Buffer.from(body, 'utf8'));
});

router.post('/import', requireRole('admin', 'hr'), upload.single('file'), wrap(async (req, res) => {
  const text = req.file ? req.file.buffer.toString('utf8') : String(req.body?.csv || '');
  if (!text.trim()) return res.status(400).json({ error: 'ไม่พบไฟล์หรือข้อมูล CSV' });

  const rows = parseCsv(text);

  // Before a single row is written, and for the reason the App Router import
  // does it (app/api/employees/import/route.js): PM-0620 and PM0620 are one
  // employee, so a file holding both says two things about one person and no
  // reading of it settles which. Refused whole rather than half-imported.
  const collisions = codeCollisions(
    rows.map((row, i) => ({ line: i + 2, code: pick(row, 'code', 'รหัสพนักงาน', 'employee_code') })),
  );
  if (collisions.length) {
    return res.status(400).json({
      error: collisionMessage(collisions),
      codeCollisions: collisions.map(({ key, rows: clashing }) => ({ code: key, rows: clashing })),
    });
  }

  const departments = await Department.find().lean();
  const byCode = new Map(departments.map((d) => [d.code.toUpperCase(), d]));

  const created = [];
  const updated = [];
  const errors = [];
  /** Rows the import moved that nothing in otEmployeeAudits will ever show. */
  let auditUnlogged = 0;

  for (const [i, row] of rows.entries()) {
    const line = i + 2; // header is line 1
    try {
      const code = pick(row, 'code', 'รหัสพนักงาน', 'employee_code').toUpperCase();
      const name = pick(row, 'name', 'ชื่อ-สกุล', 'ชื่อ');
      const deptCode = pick(row, 'department', 'แผนก', 'dept').toUpperCase();
      if (!code || !name) { errors.push({ line, error: 'ต้องมี code และ name' }); continue; }
      const matcher = codeMatcher(code);
      if (!matcher) { errors.push({ line, error: `รหัสพนักงานไม่ถูกต้อง "${code}"` }); continue; }

      const department = byCode.get(deptCode);
      if (!department) { errors.push({ line, error: `ไม่พบแผนกรหัส "${deptCode}"` }); continue; }

      const role = (pick(row, 'role', 'บทบาท') || 'employee').toLowerCase();
      if (!ROLES.includes(role)) { errors.push({ line, error: `บทบาทไม่ถูกต้อง "${role}"` }); continue; }

      // Matched on the normalised code so a differently-spelled file updates the
      // person rather than creating a second copy of them.
      const candidate = await Employee.findOne({ code: matcher });
      const existing = candidate && sameCode(candidate.code, code) ? candidate : null;

      const rowMay = rosterPermission(req.user, { target: existing, role });
      if (!rowMay.ok) { errors.push({ line, error: rowMay.error }); continue; }

      if (existing) {
        const before = snapshot(existing);
        existing.name = name;
        existing.position = pick(row, 'position', 'ตำแหน่ง') || existing.position;
        existing.email = pick(row, 'email', 'อีเมล') || existing.email;
        existing.department = department._id;
        existing.role = role;
        // `existing.code` is left alone: the roster's spelling is the one
        // payroll reads, and the file's is the same code, not a renumbering.
        const changes = rosterChanges(before, snapshot(existing));
        await existing.save();
        // Only rows the file actually moved. A roster re-imported unchanged
        // touches every row and changes none of them — see the App Router's
        // import for the same rule, which is what makes re-running it safe.
        if (!(await recordRosterChange({
          employee: existing, action: 'update', changes, actor: req.user, source: 'import',
        }))) auditUnlogged += 1;
        updated.push(existing.code);
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
        employee.mustChangePassword = true;
        await employee.save();
        if (!(await recordRosterChange({
          employee,
          action: 'create',
          changes: rosterChanges({}, snapshot(employee)),
          actor: req.user,
          source: 'import',
        }))) auditUnlogged += 1;
        created.push(code);
      }
    } catch (err) {
      errors.push({ line, error: err.message });
    }
  }

  res.json({
    created: created.length, updated: updated.length, errors, codes: { created, updated }, auditUnlogged,
  });
}));

export default router;
