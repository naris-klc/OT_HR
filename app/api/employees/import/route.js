import Employee, { ROLES } from '@/src/models/Employee.js';
import Department from '@/src/models/Department.js';
import { COMPANY_KEYS, DEFAULT_COMPANY, companyFromCode } from '@/src/config/companies.js';
import { route, uploadText, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { parseCsv, pick } from '@/src/lib/csv.js';
import {
  dropsAnAdmin, lastAdminPermission, rosterPermission, selfEditPermission,
} from '@/lib/employees.js';
import { generateTempPassword } from '@/lib/tempPassword.js';
import { rosterChanges } from '@/lib/rosterAudit.js';
import { recordRosterChange } from '@/lib/rosterAuditLog.js';
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
  /**
   * The temporary passwords issued to rows this file CREATED, in the response
   * and nowhere else.
   *
   * A bulk import that generates passwords and does not hand them back creates
   * accounts nobody can log into — the hash is all that is stored, so the only
   * repair would be resetting every new row one at a time. They are readable
   * exactly once, on the screen that uploaded the file, which is the same
   * contract the single-employee form has always had.
   */
  const issuedPasswords = [];
  /**
   * How many rows moved the roster without leaving a record of it.
   *
   * Counted rather than thrown, for the reason lib/rosterAuditLog.js returns
   * false rather than raising: the row is already saved by the time its record
   * is attempted, so failing the import here would abandon a half-written
   * roster. Reported at the end so the confirmation can say it out loud —
   * see `auditUnlogged` in the response.
   */
  let auditUnlogged = 0;
  /**
   * One field snapshot, in the shape `rosterChanges` compares.
   *
   * Written once and used for both sides of every row, so a before and an after
   * can never be read off different field lists — which is the way a diff comes
   * to under-report the one field somebody removed from one of the two copies.
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
    approvesCompany: e.approvesCompany,
    active: e.active,
  });

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

      // Including the importer's own line: a file that demotes the person
      // running it is the same lockout the form refuses, arriving as a row. A
      // file that merely REPEATS their current role passes, which is what keeps
      // an unchanged roster safe to re-import.
      const rowSelf = selfEditPermission(actor, { target: existing, role });
      if (!rowSelf.ok) { errors.push({ line, error: rowSelf.error }); continue; }

      // And the same last-Admin floor the form is held to. Counted only when
      // the row could actually lower it, so an ordinary roster file of two
      // hundred employees runs no extra query at all.
      if (dropsAnAdmin(existing, { role })) {
        const otherActiveAdmins = await Employee.countDocuments({
          role: 'admin', active: true, _id: { $ne: existing._id },
        });
        const last = lastAdminPermission(existing, { role, otherActiveAdmins });
        if (!last.ok) { errors.push({ line, error: last.error }); continue; }
      }

      if (existing) {
        // Captured before the assignments below overwrite the document in
        // place — the same reason the PATCH route reads its `before` first.
        const before = snapshot(existing);
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
        const changes = rosterChanges(before, snapshot(existing));
        await existing.save();
        /**
         * Only rows the file actually moved get a record. A roster CSV
         * re-imported unchanged touches every row and changes none of them, and
         * a trail that filed two hundred "edited, nothing different" rows each
         * time would bury the one row that did move — the same rule the entry
         * history follows for a `before` snapshot identical to its after.
         * `recordRosterChange` drops the empty ones; this is what makes the
         * import safe to run twice.
         */
        if (!(await recordRosterChange({
          employee: existing, action: 'update', changes, actor, source: 'import',
        }))) auditUnlogged += 1;
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
        /**
         * Generated here, per row, and never read from the file.
         *
         * A `password` column used to be honoured. That put every new hire's
         * password in a spreadsheet that gets mailed around, opened on a shared
         * machine and left in Downloads — and the column was not even in the
         * template, so it was a path nobody was told about and nobody could
         * audit. Anything in it is now ignored, and the row is flagged below so
         * whoever wrote it finds out rather than assuming it took.
         */
        const issued = generateTempPassword();
        await employee.setPassword(issued);
        // Issued by the system on HR's behalf, so the same obligation as the
        // form: the account cannot reach any other screen until it is replaced.
        employee.mustChangePassword = true;
        await employee.save();
        // Carried back so HR can hand them out. This is the only moment they
        // are readable — see the create route.
        issuedPasswords.push({ code: employee.code, name: employee.name, password: issued });
        if (pick(row, 'password')) {
          warnings.push({
            line,
            code,
            warning: 'ไฟล์มีคอลัมน์ password — ระบบไม่ใช้ค่านั้น '
              + 'และสร้างรหัสผ่านชั่วคราวให้เองตามรายการด้านล่าง',
          });
        }
        if (!(await recordRosterChange({
          employee,
          action: 'create',
          changes: rosterChanges({}, snapshot(employee)),
          actor,
          source: 'import',
        }))) auditUnlogged += 1;
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
    /**
     * `{ code, name, password }` for every row created — shown once and then
     * unrecoverable. Empty on an import that only updated existing people.
     */
    issued: issuedPasswords,
    /**
     * Rows the import moved that nothing in otEmployeeAudits will ever show.
     * Nought in every ordinary run; said out loud rather than swallowed,
     * because a gap in an audit trail is only ever found by somebody looking
     * for a change that is already in dispute.
     */
    auditUnlogged,
    // How the วันเกิด column was read, so the confirmation says it too — the
    // preview HR agreed to and the import that happened are then the same
    // claim, checkable against each other.
    birthDates: { order: dates.order, count: dates.cells.length, decidedBy: dates.decidedBy },
  });
});
