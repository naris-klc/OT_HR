import Employee, { ROLES } from '@/src/models/Employee.js';
import Department from '@/src/models/Department.js';
import { COMPANY_KEYS, DEFAULT_COMPANY, companyFromCode } from '@/src/config/companies.js';
import { route, uploadText, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { parseCsv, pick } from '@/src/lib/csv.js';
import { defaultPassword, rosterPermission } from '@/lib/employees.js';

// ── [OPEN 11] roster import ─────────────────────────────────────────────────
// Built regardless of HR's answer: if they hand over a file, use the upload;
// if they read names down the phone, Admin uses the form. Neither answer
// blocks v1.

export const POST = route(async (req) => {
  const actor = await requireAuth(req);
  const may = rosterPermission(actor);
  if (!may.ok) return fail(may.error, may.status);

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

      // Optional, and rejected loudly rather than silently dropped — a birthday
      // written 12/05/2532 is a mistake worth showing HR, not worth guessing at.
      const birthDate = pick(row, 'birthDate', 'วันเกิด', 'birth_date');
      if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
        errors.push({ line, error: `วันเกิดต้องเป็นรูปแบบ YYYY-MM-DD (พ.ศ. ค.ศ. ใช้ ค.ศ.) — ได้รับ "${birthDate}"` });
        continue;
      }

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

      // The same rule the form is held to, applied per row — a CSV is the one
      // way to write hundreds of roster rows at once, and a rule the form
      // enforces but the upload does not is not a rule.
      const rowMay = rosterPermission(actor, { target: existing, role });
      if (!rowMay.ok) { errors.push({ line, error: rowMay.error }); continue; }

      if (existing) {
        existing.name = name;
        existing.position = pick(row, 'position', 'ตำแหน่ง') || existing.position;
        existing.email = pick(row, 'email', 'อีเมล') || existing.email;
        // Blank leaves what is stored alone, so a roster file without the
        // column does not wipe birthdays Admin filled in by hand.
        if (birthDate) existing.birthDate = birthDate;
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
          birthDate: birthDate || undefined,
          department: department._id,
          role,
          company,
        });
        await employee.setPassword(pick(row, 'password') || defaultPassword(code));
        // Issued by whoever wrote the file, so the same obligation as the form.
        employee.mustChangePassword = true;
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
