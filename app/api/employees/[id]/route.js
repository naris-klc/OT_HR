import Employee, { ROLES } from '@/src/models/Employee.js';
import { COMPANY_KEYS } from '@/src/config/companies.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import {
  codeChangePermission, defaultPassword, dropsAnAdmin, lastAdminPermission, rosterPermission,
  selfEditPermission, signingScope, signingCoveragePermission, approvalScope,
} from '@/lib/employees.js';
import Department from '@/src/models/Department.js';
import { BIRTHDATE_REPLAY_NOTE, rosterChanges } from '@/lib/rosterAudit.js';
import { recordRosterChange } from '@/lib/rosterAuditLog.js';
import { codeMatcher, sameCode } from '@/src/lib/employeeCode.js';
import { recomputeEntries } from '@/src/services/otService.js';
import { PENDING_STATUSES } from '@/lib/accounting.js';
import { smartDate } from '@/lib/smartDate.js';

export const PATCH = route(async (req, { params }) => {
  const actor = await requireAuth(req);

  const employee = await Employee.findById(params.id);
  if (!employee) return fail('ไม่พบพนักงาน', 404);

  const {
    code, name, email, position, birthDate, department, role, company, approvesCompany, active,
    approvesDepartments, resetPassword, password, reason,
  } = await body(req);

  if (role != null && !ROLES.includes(role)) return fail('บทบาทไม่ถูกต้อง', 400);

  /**
   * A caller-chosen password is refused rather than ignored.
   *
   * The server decides these — `defaultPassword(employee.code)` — and the field
   * used to be filled in by the BROWSER with a value computed from the employee
   * code, which is the bug that got the whole scheme withdrawn once. The value
   * being guessable again does not make it the caller's to send: accepting one
   * silently would leave that path open for anything still sending it, and a
   * request that thought it set a password and did not is worse than one that
   * was told.
   */
  if (password !== undefined) {
    return fail(
      'ระบบเป็นผู้ตั้งรหัสผ่านให้เอง — ส่งค่า resetPassword: true เพื่อรีเซ็ตกลับเป็นรหัสพนักงาน',
      400,
    );
  }

  // Read before anything is assigned: the rule is about the row as it stands
  // and the role being asked for, not about the half-mutated document.
  const may = rosterPermission(actor, { target: employee, role: role ?? null });
  if (!may.ok) return fail(may.error, may.status);

  /**
   * Nobody edits themselves out of the system, nobody re-issues their own
   * password from this screen, and the system always keeps one ผู้ดูแลระบบ who
   * can log in.
   *
   * Both read the row as it STANDS, alongside the permission above and before
   * any assignment — `selfEditPermission` compares the incoming values against
   * the stored ones to decide whether anything is being changed at all, which a
   * half-mutated document cannot answer.
   *
   * `resetPassword` is passed in as the request sent it, and it is checked HERE
   * rather than beside `defaultPassword()` two hundred lines below, where
   * it would be a refusal issued after the ceiling checks, the coverage loop and
   * `employee.save()` had all already run. A request that is going to be refused
   * must be refused before it writes anything: the trail would otherwise carry a
   * roster edit belonging to a request the caller was told had failed.
   */
  const self = selfEditPermission(actor, {
    target: employee,
    role: role ?? null,
    active: active ?? null,
    resetPassword: Boolean(resetPassword),
  });
  if (!self.ok) return fail(self.error, self.status);

  // The count only when it can matter — see `dropsAnAdmin`. Excludes this row:
  // the question is whether there is ANOTHER one.
  if (dropsAnAdmin(employee, { role: role ?? null, active: active ?? null })) {
    const otherActiveAdmins = await Employee.countDocuments({
      role: 'admin', active: true, _id: { $ne: employee._id },
    });
    const last = lastAdminPermission(employee, {
      role: role ?? null, active: active ?? null, otherActiveAdmins,
    });
    if (!last.ok) return fail(last.error, last.status);
  }

  /**
   * รหัสพนักงาน is its own permission, on top of the one above and not folded
   * into it. `rosterPermission` answers "may this person write this row"; this
   * answers "may they change the thing the row is identified BY", and ฝ่ายบุคคล
   * get the first without the second. A payload repeating the existing code is
   * not a change — see lib/employees.js.
   */
  const codeChange = codeChangePermission(actor, { from: employee.code, to: code, reason });
  if (!codeChange.ok) return fail(codeChange.error, codeChange.status);

  /**
   * The row as it stands, captured before a single field is assigned.
   *
   * A plain object rather than the document, because the document is about to
   * be mutated in place and a "before" that is a live reference to the thing
   * being changed records nothing at all.
   */
  const before = {
    code: employee.code,
    name: employee.name,
    email: employee.email,
    position: employee.position,
    birthDate: employee.birthDate,
    department: employee.department,
    role: employee.role,
    company: employee.company,
    approvesCompany: employee.approvesCompany,
    // Copied out of the array rather than referenced. Everything else in this
    // snapshot is a scalar and a plain read is enough; this one is a mongoose
    // array on the document about to be mutated, so a reference would be the
    // live value and the "before" would equal the "after" every time.
    approvesDepartments: (employee.approvesDepartments || []).map(String),
    active: employee.active,
  };

  if (codeChange.changed) {
    const wanted = String(code).trim().toUpperCase();
    const matcher = codeMatcher(wanted);
    if (!matcher) return fail(`รหัสพนักงานไม่ถูกต้อง "${code}"`, 400);
    /**
     * Checked against the NORMALISED form, not left to the unique index.
     *
     * PM-0620 and PM0620 are one person everywhere else in this system
     * (src/lib/employeeCode.js) and the index cannot see that — the two strings
     * genuinely differ, so the save would succeed and leave two rows that log
     * in as each other's near-miss. Excluding this row keeps a change of
     * punctuation on one's own code allowed.
     */
    const clash = await Employee.findOne({ code: matcher, _id: { $ne: employee._id } })
      .select('code name').lean();
    if (clash && sameCode(clash.code, wanted)) {
      return fail(`รหัสพนักงาน "${clash.code}" ถูกใช้อยู่แล้วโดย ${clash.name}`, 409);
    }
    employee.code = wanted;
  }

  if (name != null) employee.name = name;
  if (email !== undefined) employee.email = email || undefined;
  if (position != null) employee.position = position;
  /**
   * `undefined` means "not mentioned"; '' means "clear it". Storing '' instead
   * would fail the schema's YYYY-MM-DD match.
   *
   * Read through `smartDate` for the reason the create route gives at length:
   * `2515-09-19` passes the schema's shape check and is five centuries wrong,
   * and this is the endpoint a CORRECTION to a birthday comes through — the
   * one edit in the whole app that is allowed to restate an approved entry
   * (`BIRTHDATE_REPLAY_NOTE`, a few lines down). A พ.ศ. year accepted here does
   * not sit quietly in one field; it replays somebody's signed-off month.
   */
  if (birthDate !== undefined) {
    const birth = smartDate(birthDate, { label: 'วันเกิด' });
    if (birth.error) return fail(birth.error, 400);
    employee.birthDate = birth.date || undefined;
  }
  if (department != null) employee.department = department;
  if (role != null) employee.role = role;
  if (company != null) {
    // Moving someone between companies changes which payroll they belong to
    // from here on — and, because สรุป OT ส่งบัญชี reads today's value rather
    // than one stored on the entry, it also restates which file every month
    // they have ever worked belongs to. The screen warns before saving this.
    if (!COMPANY_KEYS.includes(company)) return fail('บริษัทไม่ถูกต้อง', 400);
    employee.company = company;
  }
  /**
   * Who this หัวหน้า may sign for. `undefined` is "not mentioned" and null is
   * "ทุกบริษัท" — two different things, so this cannot use the `!= null` guard
   * every field above it uses, or clearing the scope back to ทุกบริษัท would be
   * indistinguishable from not sending the field at all.
   */
  if (approvesCompany !== undefined) {
    const signs = signingScope(approvesCompany);
    if (!signs.ok) return fail(signs.error, 400);
    employee.approvesCompany = signs.value;
  }
  /**
   * แผนกที่คุมเพิ่ม — same `undefined` / `[]` distinction as the scope above,
   * and for the same reason: `[]` is "untick everything", which is a real edit
   * and must not read as "field not sent".
   *
   * Applied AFTER `department`, so `approvalScope` strips the home department
   * this save is moving them to rather than the one they are leaving. Ticking
   * ADM while also being moved into ADM is then one department, not two.
   */
  if (approvesDepartments !== undefined) {
    const known = await Department.find().select('_id').lean();
    const scope = approvalScope(
      approvesDepartments, employee.department, known.map((d) => d._id),
    );
    if (!scope.ok) return fail(scope.error, 400);
    employee.approvesDepartments = scope.value;
  }
  if (active != null) employee.active = Boolean(active);

  /**
   * A reset is HR issuing a password, exactly as creating the account was — so
   * it carries the same obligation to replace it. Editing anything else leaves
   * the flag alone: a corrected job title is not a reason to ask somebody for a
   * new password.
   *
   * The value is decided here and never read from the request, which is the
   * whole of the earlier fix: the browser used to compute it and PATCH it. That
   * still holds now that the value is guessable again — what the screen shows
   * is what came back from here, and a `password` field in the body is a 400
   * two hundred lines above.
   *
   * FROM `employee.code`, WHICH IS THE CODE AS THIS REQUEST WILL LEAVE IT. The
   * assignments are all above; a request that renames PM-0620 to PM-0641 and
   * resets in one go sets the password to PM-0641, which is the code the person
   * is about to be told is theirs. Reading `before.code` here would hand out a
   * password for a row that no longer exists.
   *
   * HASHED HERE, WRITTEN AT THE VERY END. Nothing about this
   * account's password moves until every other thing this request does has
   * already succeeded — see the write below. A password that reached the
   * database and not the person who asked for it is not a failed reset, it is a
   * locked-out employee nobody can help: the hash is one-way, so there is no
   * screen, no log and no support path that can recover it, and the only repair
   * is another reset. Every other failure in this handler must therefore leave
   * the old password working.
   */
  const issued = resetPassword ? defaultPassword(employee.code) : null;
  const issuedHash = issued ? await Employee.hashPassword(issued) : null;

  /**
   * Computed from the same document that is about to be saved, so the trail
   * cannot describe a set of values different from the one that was stored.
   * `rosterChanges` reads only its allowlist, which is what keeps the password
   * out of here structurally rather than by anybody remembering.
   */
  const changes = rosterChanges(before, {
    code: employee.code,
    name: employee.name,
    email: employee.email,
    position: employee.position,
    birthDate: employee.birthDate,
    department: employee.department,
    role: employee.role,
    company: employee.company,
    approvesCompany: employee.approvesCompany,
    approvesDepartments: employee.approvesDepartments,
    active: employee.active,
  });
  const birthDateMoved = changes.some((c) => c.field === 'birthDate');

  /**
   * NOBODY IS LEFT WITHOUT A SIGNATURE BY A SAVE ON THIS SCREEN.
   *
   * Checked here — after every field has been applied to the document and
   * before anything is written — because the question is about the RESULT, not
   * about which field the request happened to name. บริษัท, แผนก, บทบาท,
   * สถานะการใช้งาน and เซ็นให้บริษัท can each take the last eligible signer away
   * from somebody, and asking the finished document rather than the payload
   * covers all five without a list here that would fall out of date.
   *
   * BOTH departments, not one. Moving a person OUT of a แผนก can strand the
   * people they used to sign for; moving them IN can strand them on arrival, in
   * a แผนก whose only หัวหน้า signs for the other company. They are different
   * questions and the same rule answers both.
   *
   * AND EVERY แผนก THIS SAVE TICKS OR UNTICKS, which is the sixth way in. A
   * หัวหน้า covering ADM from ผลิต is on neither department's roster as far as
   * the old loop was concerned: unticking ADM changes nothing about either
   * `department` value, so the loop would not have looked at ADM at all and the
   * save that stranded three people would have gone straight through. The
   * before-list and the after-list are both in the union for the same reason
   * the two `department` values are.
   */
  const asPerson = (src, dept) => ({
    _id: employee._id,
    code: employee.code,
    name: employee.name,
    role: src.role,
    department: dept,
    company: src.company,
    approvesCompany: src.approvesCompany,
    approvesDepartments: src.approvesDepartments,
  });
  const sameDept = (dept, value) => String(value ?? '') === String(dept);

  const touched = [...new Set([
    before.department,
    employee.department,
    ...before.approvesDepartments,
    ...(employee.approvesDepartments || []),
  ].map((d) => String(d ?? '')))].filter(Boolean);

  /**
   * Every OTHER active หัวหน้า on the roster, read once for the whole loop.
   *
   * Not per department, because a signer for ADM may sit in any of them — the
   * pool is the same for every iteration and `isDepartmentManager` is what
   * narrows it, asking each one whether THIS department is one of theirs.
   *
   * This person is excluded and then added back on each side of the comparison
   * in their before and after shape. That is the whole mechanism: the two lists
   * differ by exactly the edit being judged, so what `signingCoveragePermission`
   * reports as newly stranded is what THIS save costs and not what was already
   * true.
   */
  const otherManagers = await Employee
    .find({ role: 'manager', active: true, _id: { $ne: employee._id } })
    .select('code name role department company approvesCompany approvesDepartments')
    .lean();
  const wasSigner = before.role === 'manager' && before.active !== false
    ? [asPerson(before, before.department)] : [];
  const nowSigner = employee.role === 'manager' && employee.active !== false
    ? [asPerson(employee, employee.department)] : [];
  const signers = {
    before: [...otherManagers, ...wasSigner],
    after: [...otherManagers, ...nowSigner],
  };

  for (const dept of touched) {
    const others = await Employee
      .find({ department: dept, active: true, _id: { $ne: employee._id } })
      .select('code name role department company approvesCompany approvesDepartments')
      .lean();

    const was = before.active !== false && sameDept(dept, before.department)
      ? [asPerson(before, before.department)] : [];
    const now = employee.active !== false && sameDept(dept, employee.department)
      ? [asPerson(employee, employee.department)] : [];

    const cover = signingCoveragePermission(
      [...others, ...was], [...others, ...now], dept, signers,
    );
    if (!cover.ok) return fail(cover.error, 409);
  }

  await employee.save();

  /**
   * A moved วันเกิด moves which days were that person's holiday, so the hours
   * already filed against those days no longer describe the calendar they were
   * computed under.
   *
   * Replayed here for the reason the holiday routes replay theirs: the roster
   * screen is where the calendar changed, and an entry that quietly keeps a
   * stale day type until some unrelated policy save happens to sweep it up is
   * an entry whose figures nobody can explain in the meantime.
   *
   * APPROVED ENTRIES MOVE TOO. HR's rule, 2026-08-18. Until then this replayed
   * only the pending statuses, on the reasoning that hours somebody signed for
   * do not move because a birth date was corrected afterwards. What that left
   * behind is an approved entry printed on F-HR-027 under a day type everybody
   * now agrees is wrong. The paper is simply wrong, and it was wrong on the day
   * it was printed.
   *
   * THE GUARD USED TO BE ปิดงวด, AND THERE IS NONE NOW. Until 2026-08-31 a
   * month HR had closed was skipped by `recomputeEntries` whatever it was asked
   * to do, so a corrected birth date reached every open month and stopped at the
   * ones already sent to accounting. That feature was withdrawn — the signed
   * paper in the filing cabinet is the record, see lib/periodStatus.js — so this
   * replay now reaches approved entries in EVERY month, however old.
   *
   * That is the intended reading of HR's rule rather than a gap left in it: a
   * wrong birth date makes the paper wrong, and it was wrong on the day it was
   * printed too. What the correction owes is visibility, not restraint — which
   * is the paragraph below.
   *
   * What the escape hatch asks for is still paid: every entry whose figures
   * actually move keeps a `before` snapshot and a `recompute` line carrying
   * `BIRTHDATE_REPLAY_NOTE`, so the change appears in ประวัติรายการ beside the
   * ordinary corrections. `authorizeReplay`'s admin-only clause is not consulted
   * here, and that is the deliberate part: it exists so nobody re-reads a POLICY
   * question and quietly restates a month on the strength of their own reading.
   * A birth date is not a reading — it is a fact that was recorded wrong.
   *
   * Rejected and cancelled rows stay out, as they always did: nothing will ever
   * pay against them, and they would collect a `recompute` line each time.
   */
  let recomputed = null;
  if (birthDateMoved) {
    recomputed = await recomputeEntries(
      { employee: employee._id, status: { $in: [...PENDING_STATUSES, 'approved'] } },
      actor,
      /**
       * `source: 'birthdate'` and NOT 'manual', which is what this sent until
       * 2026-08-24 — the same value `POST /api/settings/recompute` uses.
       *
       * The two runs are not the same act and reading them back has to be able
       * to tell them apart. A 'manual' run is somebody deciding that a POLICY
       * question was answered wrong and that a month should be restated on the
       * strength of that reading — which is why `authorizeReplay` gates it to an
       * administrator with a written reason. This one is a fact that was
       * recorded wrong being corrected, and it deliberately does NOT consult
       * that rule (see below). Filed under one label they would be
       * distinguishable only by whoever thought to compare the `note` text,
       * and `source` is the field that is indexed for exactly this question.
       */
      { source: 'birthdate', includeApproved: true, note: BIRTHDATE_REPLAY_NOTE },
    );
  }

  /**
   * The response, assembled while the password can still be un-issued.
   *
   * `populate` is a query and a query can fail, so it happens on this side of
   * the write. Everything after this line is either the write itself or cannot
   * throw.
   */
  const populated = await employee.populate('department', 'code name nameTh');

  /**
   * ─────────────────────────────────────────────────────────────────────────
   * THE POINT OF NO RETURN, AND IT IS DELIBERATELY THE LAST ONE.
   *
   * The old password stops working here and the new one exists in exactly one
   * place: the `password` field a few lines below. Nothing may fail between
   * this write and that response — which is why the save, the birthday replay
   * and the populate above have all already happened, and why the audit below
   * cannot throw by construction (lib/rosterAuditLog.js returns false instead).
   *
   * A targeted `updateOne` rather than `employee.save()`: the document has been
   * through validators and hooks already, and re-saving the whole row here
   * would put every other field's failure modes back in front of the one write
   * that must not be rolled back into.
   *
   * This is as close to all-or-nothing as one HTTP request gets. What it cannot
   * cover is the response failing to ARRIVE — a dropped connection, a closed
   * tab — because at that point the write has committed and no server knows.
   * The screen carries that half: the dialog holds the password until somebody
   * confirms they have written it down (components/AdminView.jsx).
   */
  if (issuedHash) {
    await Employee.updateOne(
      { _id: employee._id },
      { $set: { passwordHash: issuedHash, mustChangePassword: true } },
    );
    // The copy going back in the response, brought level with the stored row.
    // Assignment only — the document is never saved again.
    employee.mustChangePassword = true;
  }

  const auditLogged = await recordRosterChange({
    employee,
    // A reset with nothing else changed is its own event; a reset alongside
    // edits stays one record for one request. Either way the password is a
    // boolean on the row and never a value.
    action: changes.length ? 'update' : 'password_reset',
    changes,
    passwordReset: Boolean(issued),
    reason,
    actor,
  });

  return json({
    employee: populated,
    /**
     * The password this reset set, and only for a reset.
     *
     * It read "This response is the ONLY moment it is readable" until
     * 2026-09-02, when the default became the employee code — a screen that
     * loses it now reads the roster instead of ordering another reset. It is
     * still sent, and the screen still shows THIS value rather than one it
     * worked out for itself: the server is what decides, and a screen guessing
     * along beside it is a screen that will be wrong the day the rule changes.
     */
    password: issued,
    /**
     * False when the change was saved but its record was not — see
     * lib/rosterAuditLog.js. The screen says so rather than letting a gap in the
     * trail be found months later.
     */
    auditLogged,
    /** Present only when วันเกิด moved. Null otherwise, not zero. */
    recomputed,
  });
});
