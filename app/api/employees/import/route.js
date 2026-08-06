import Employee, { ROLES } from '@/src/models/Employee.js';
import Department from '@/src/models/Department.js';
import { COMPANY_KEYS, DEFAULT_COMPANY, companyFromCode } from '@/src/config/companies.js';
import { route, uploadText, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { parseCsv, pick } from '@/src/lib/csv.js';
import { defaultPassword } from '@/lib/employees.js';

// ── [OPEN 11] roster import ─────────────────────────────────────────────────
// Built regardless of HR's answer: if they hand over a file, use the upload;
// if they read names down the phone, Admin uses the form. Neither answer
// blocks v1.

export const POST = route(async (req) => {
  requireRole(await requireAuth(req), 'admin');

  const text = await uploadText(req, 2 * 1024 * 1024);
  if (!text.trim()) return fail('ไม่พบไฟล์หรือข้อมูล CSV', 400);

  const rows = parseCsv(text);
  const departments = await Department.find().lean();
  const byCode = new Map(departments.map((d) => [d.code.toUpperCase(), d]));

  const created = [];
  const updated = [];
  const errors = [];
  /** Rows whose company was neither given nor derivable — see below. */
  const warnings = [];

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

      // Which of the two payrolls this person belongs to. Stated in the file
      // wins; otherwise the code prefix decides (PM… / THT…). A code matching
      // neither is not an error — HR-001 and ADMIN are real — but it IS a
      // guess, so the row comes back as a warning for someone to confirm.
      const givenCompany = pick(row, 'company', 'บริษัท').toLowerCase();
      if (givenCompany && !COMPANY_KEYS.includes(givenCompany)) {
        errors.push({ line, error: `บริษัทไม่ถูกต้อง "${givenCompany}" (ใช้ได้: ${COMPANY_KEYS.join(', ')})` });
        continue;
      }
      const derived = companyFromCode(code);
      const company = givenCompany || derived || DEFAULT_COMPANY;
      if (!givenCompany && !derived) {
        warnings.push({ line, code, warning: `รหัสไม่ตรงรูปแบบบริษัทใด — ตั้งเป็น "${DEFAULT_COMPANY}" ไว้ก่อน` });
      }

      const existing = await Employee.findOne({ code });
      if (existing) {
        existing.name = name;
        existing.position = pick(row, 'position', 'ตำแหน่ง') || existing.position;
        existing.email = pick(row, 'email', 'อีเมล') || existing.email;
        existing.department = department._id;
        existing.role = role;
        // On an update, only a stated or a derivable company overwrites what is
        // already stored. The DEFAULT_COMPANY fallback must not: it would undo
        // an Admin's correction on every re-import of the same roster file.
        if (givenCompany || derived) existing.company = givenCompany || derived;
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
          company,
        });
        await employee.setPassword(pick(row, 'password') || defaultPassword(code));
        await employee.save();
        created.push(code);
      }
    } catch (err) {
      errors.push({ line, error: err.message });
    }
  }

  return json({
    created: created.length,
    updated: updated.length,
    errors,
    warnings,
    codes: { created, updated },
  });
});
