import { Router } from 'express';
import multer from 'multer';
import Employee, { ROLES } from '../../src/models/Employee.js';
import Department from '../../src/models/Department.js';
import { requireAuth, requireRole, wrap } from '../middleware/auth.js';
import { parseCsv, pick, toCsv } from '../../src/lib/csv.js';
import {
  chosenPasswordPermission, codeChangePermission, defaultPassword, dropsAnAdmin,
  lastAdminPermission, passwordShapePermission, publicEmployee, rosterPermission,
  selfEditPermission,
} from '../../lib/employees.js';
import { rosterChanges } from '../../lib/rosterAudit.js';
import { recordRosterChange } from '../../lib/rosterAuditLog.js';
import { codeMatcher, sameCode, codeCollisions, collisionMessage } from '../../src/lib/employeeCode.js';

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
    .populate('department', 'code name nameTh monthlyCapHours weeklyCapHours otMode')
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
  // Optional and checked, as on the App Router — see the comment there for what
  // the check is refusing and why it is not a password policy. Applied on both
  // servers because a rule enforced by one of two servers is not a rule.
  const chosen = password === undefined || password === null || password === ''
    ? null
    : String(password);
  if (chosen !== null) {
    const ok = chosenPasswordPermission(chosen, { code });
    if (!ok.ok) return res.status(ok.status).json({ error: ok.error });
  }

  const employee = new Employee({ code, name, email: email || undefined, position, department, role: role || 'employee' });
  // The row's own รหัสพนักงาน when HR chose nothing — the same default the App
  // Router sets, from the same function, because two servers with two ideas of
  // what somebody's first password is means a first password that half works.
  const issued = chosen ?? defaultPassword(employee.code);
  await employee.setPassword(issued);
  employee.mustChangePassword = true;
  await employee.save();

  const auditLogged = await recordRosterChange({
    employee, action: 'create', changes: rosterChanges({}, snapshot(employee)), actor: req.user,
  });

  // A chosen password is not echoed back — see the App Router route.
  res.status(201).json({
    employee: await employee.populate('department', 'code name nameTh'),
    password: chosen ? undefined : issued,
    passwordChosen: chosen !== null,
    auditLogged,
  });
}));

router.patch('/:id', requireRole('admin', 'hr'), wrap(async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

  const { code, name, email, position, department, role, active, resetPassword, password } = req.body || {};
  if (role != null && !ROLES.includes(role)) return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง' });

  const may = rosterPermission(req.user, { target: employee, role: role ?? null });
  if (!may.ok) return res.status(may.status).json({ error: may.error });

  // Nobody edits themselves out of the system, and there is always one active
  // ผู้ดูแลระบบ left. Both read the row as it stands, before any assignment —
  // see lib/employees.js. Applied here as well as on the App Router because a
  // rule enforced by one of two servers is not a rule.
  const self = selfEditPermission(req.user, { target: employee, role: role ?? null, active: active ?? null });
  if (!self.ok) return res.status(self.status).json({ error: self.error });

  if (dropsAnAdmin(employee, { role: role ?? null, active: active ?? null })) {
    const otherActiveAdmins = await Employee.countDocuments({
      role: 'admin', active: true, _id: { $ne: employee._id },
    });
    const last = lastAdminPermission(employee, {
      role: role ?? null, active: active ?? null, otherActiveAdmins,
    });
    if (!last.ok) return res.status(last.status).json({ error: last.error });
  }

  /**
   * รหัสพนักงาน is refused here rather than ignored.
   *
   * This handler has never assigned `code`, so there is no hole today — but
   * "safe because a field is missing from a destructure" is a guarantee that
   * lasts until somebody adds the field, and the rule it would silently break
   * (Admin only, reason required) is the most consequential one on the roster.
   * The permission check goes first so a ฝ่ายบุคคล sending a code gets the same
   * 403 both servers give, rather than a 400 that reads as "wrong endpoint" and
   * suggests trying another one.
   */
  const codeChange = codeChangePermission(req.user, { from: employee.code, to: code, reason: req.body?.reason });
  if (!codeChange.ok) return res.status(codeChange.status).json({ error: codeChange.error });
  if (codeChange.changed) {
    return res.status(400).json({
      error: 'เปลี่ยนรหัสพนักงานได้ที่หน้าทะเบียนพนักงานเท่านั้น — ช่องทางนี้ไม่รองรับ',
    });
  }
  if (password !== undefined) {
    return res.status(400).json({
      error: 'ระบบเป็นผู้ตั้งรหัสผ่านให้เอง — ส่งค่า resetPassword: true เพื่อรีเซ็ตกลับเป็นรหัสพนักงาน',
    });
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
  /**
   * Decided here, returned, never read from the request — and written LAST.
   *
   * The same ordering as the App Router's PATCH, for the same reason: a hash
   * that reaches the database while the response carrying its plaintext does
   * not is an employee locked out of an account nobody can open. Hashing is the
   * slow part and it happens here, while failing is still free; the write is a
   * single field update at the end, after everything else has succeeded.
   *
   * The ordering matters less than it did now that the value is the employee
   * code and can be looked up again — and is kept exactly as it was, because
   * "the hash moved and nobody knows to what" is still the shape of the
   * failure, and this router accepts no รหัสพนักงาน change to make the value
   * recoverable from anything but the row it just wrote.
   */
  const issued = resetPassword ? defaultPassword(employee.code) : null;
  const issuedHash = issued ? await Employee.hashPassword(issued) : null;

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
  // Assembled while the password can still be un-issued: a populate is a query
  // and a query can fail.
  const populated = await employee.populate('department', 'code name nameTh');

  // The point of no return, and the last thing here that can fail. The audit
  // below cannot throw by construction (lib/rosterAuditLog.js).
  if (issuedHash) {
    await Employee.updateOne(
      { _id: employee._id },
      { $set: { passwordHash: issuedHash, mustChangePassword: true } },
    );
    employee.mustChangePassword = true;
  }

  const auditLogged = await recordRosterChange({
    employee,
    action: changes.length ? 'update' : 'password_reset',
    changes,
    passwordReset: Boolean(issued),
    actor: req.user,
  });

  return res.json({
    employee: populated,
    // Readable exactly once — only the hash is stored. Null when no reset.
    password: issued,
    auditLogged,
  });
}));

/** Change own password. */
router.post('/me/password', wrap(async (req, res) => {
  const { current, next } = req.body || {};
  // The same rule the App Router applies, from the same function — a character
  // set enforced by one of two servers is not a character set.
  const shape = passwordShapePermission(next);
  if (!shape.ok) return res.status(shape.status).json({ error: shape.error });
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
  /** Temporary passwords for rows this file created — readable once, here. */
  const issuedPasswords = [];

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

      // The lockout floors, per row — same as the App Router's import. A file
      // that demotes the importer, or the last active ผู้ดูแลระบบ, is the same
      // refusal arriving as a spreadsheet.
      const rowSelf = selfEditPermission(req.user, { target: existing, role });
      if (!rowSelf.ok) { errors.push({ line, error: rowSelf.error }); continue; }
      if (dropsAnAdmin(existing, { role })) {
        const otherActiveAdmins = await Employee.countDocuments({
          role: 'admin', active: true, _id: { $ne: existing._id },
        });
        const last = lastAdminPermission(existing, { role, otherActiveAdmins });
        if (!last.ok) { errors.push({ line, error: last.error }); continue; }
      }

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
        // The row's own รหัสพนักงาน, never read from the file. A `password`
        // column used to be honoured here — that put every new hire's password
        // in a spreadsheet, which is still refused whatever the default is.
        const issued = defaultPassword(employee.code);
        await employee.setPassword(issued);
        employee.mustChangePassword = true;
        await employee.save();
        issuedPasswords.push({ code: employee.code, name: employee.name, password: issued });
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
    created: created.length,
    updated: updated.length,
    errors,
    codes: { created, updated },
    issued: issuedPasswords,
    auditUnlogged,
  });
}));

export default router;
