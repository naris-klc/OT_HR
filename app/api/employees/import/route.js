import Employee, { ROLES } from '@/src/models/Employee.js';
import Department from '@/src/models/Department.js';
import { COMPANY_KEYS, DEFAULT_COMPANY, companyFromCode } from '@/src/config/companies.js';
import { route, uploadText, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { parseCsv, pick } from '@/src/lib/csv.js';
import { defaultPassword, rosterPermission } from '@/lib/employees.js';
import { resolveBirthDateColumn } from '@/lib/birthDate.js';
import { codeMatcher, sameCode, codeCollisions, collisionMessage } from '@/src/lib/employeeCode.js';

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

  // Before a single row is written. Excel rewrites the whole วันเกิด column
  // when HR opens and saves the file, so whether "05/03/1998" is March or May
  // is a fact about the file, not about the row — and a file whose order
  // nothing settles is refused entire. Importing the readable half of it would
  // just be the same guess made quietly. See lib/birthDate.js.
  const dates = resolveBirthDateColumn(rows);
  if (!dates.ok) return fail(dates.fileError, 400, { birthDateAmbiguous: dates.ambiguous });

  /**
   * The other question that is about the file rather than about a row, and
   * refused the same way, for the same reason.
   *
   * PM-0620 and PM0620 are one employee (src/lib/employeeCode.js), so a file
   * carrying both is a file making two statements about one person with nothing
   * in it to say which is meant. There is no per-row answer: skipping the
   * second and importing the first would leave the roster holding whichever the
   * loop happened to reach, and no screen afterwards would say a choice had
   * been made. So the whole file is refused with the clashing lines named, and
   * nothing is written.
   *
   * Two rows spelling the code IDENTICALLY are the same clash and are refused
   * with them — the loop below used to let the later one quietly overwrite the
   * earlier, which is the same coin flip with no message attached.
   */
  const collisions = codeCollisions(
    rows.map((row, i) => ({ line: i + 2, code: pick(row, 'code', 'รหัสพนักงาน', 'employee_code') })),
  );
  if (collisions.length) {
    return fail(collisionMessage(collisions), 400, {
      codeCollisions: collisions.map(({ key, rows: clashing }) => ({ code: key, rows: clashing })),
    });
  }

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
      // A cell of nothing but punctuation passes the emptiness check above and
      // still names nobody — refused here rather than turned into a filter that
      // would match on absence.
      const matcher = codeMatcher(code);
      if (!matcher) { errors.push({ line, error: `รหัสพนักงานไม่ถูกต้อง "${code}"` }); continue; }

      const department = byCode.get(deptCode);
      if (!department) { errors.push({ line, error: `ไม่พบแผนกรหัส "${deptCode}"` }); continue; }

      const role = (pick(row, 'role', 'บทบาท') || 'employee').toLowerCase();
      if (!ROLES.includes(role)) { errors.push({ line, error: `บทบาทไม่ถูกต้อง "${role}"` }); continue; }

      // Optional, and rejected loudly rather than silently dropped — a birthday
      // written 12/05/2532 is a mistake worth showing HR, not worth guessing at.
      // Read against the whole file above; what is left per row is a cell no
      // reading of the file could save.
      const cell = dates.byLine.get(line);
      if (cell?.error) { errors.push({ line, error: cell.error }); continue; }
      const birthDate = cell?.date || '';

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

      /**
       * Matched on the normalised code, so a file that writes PM0620 where the
       * roster says PM-0620 updates that person instead of minting a second
       * copy of them — which is what a raw `findOne({ code })` did, silently,
       * and which the unique index could not catch because the two strings
       * genuinely differ.
       */
      const candidate = await Employee.findOne({ code: matcher });
      const existing = candidate && sameCode(candidate.code, code) ? candidate : null;

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
        // `existing.code` is deliberately NOT assigned. The roster's spelling is
        // the one payroll reads off their own sheets, and a file that happens to
        // write it the other way is not a request to renumber anybody — it is
        // the same code, which is why this row was found at all.
        await existing.save();
        // Reported as it is stored, not as the file spelled it, so what HR is
        // shown afterwards is what is on the row.
        updated.push(existing.code);
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
    // How the วันเกิด column was read, so the confirmation says it too — the
    // preview HR agreed to and the import that happened are then the same
    // claim, checkable against each other.
    birthDates: { order: dates.order, count: dates.cells.length, decidedBy: dates.decidedBy },
  });
});
