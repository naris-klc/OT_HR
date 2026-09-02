import Employee, { ROLES } from '@/src/models/Employee.js';
import { COMPANY_KEYS, companyOf } from '@/src/config/companies.js';
import { route, body, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import {
  approvalScope, publicEmployee, rosterPermission, chosenPasswordPermission, signingScope,
  signingCoveragePermission, defaultPassword,
} from '@/lib/employees.js';
import { approvalDepartments } from '@/lib/entries.js';
import Department from '@/src/models/Department.js';
import { rosterChanges } from '@/lib/rosterAudit.js';
import { recordRosterChange } from '@/lib/rosterAuditLog.js';
import { smartDate } from '@/lib/smartDate.js';

export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const q = query(req);
  const filter = {};

  /**
   * A manager only ever needs the people they sign for (§9: 5–6 per department).
   *
   * `approvalDepartments` and not `user.department`, since a หัวหน้า can be
   * ticked into other departments. THE LIST AND THE BUTTONS HAVE TO AGREE — the
   * note below says why for the company half, and the department half is the
   * same sentence: `proxyPermission` asks `isDepartmentManager`, which now says
   * yes for a ticked department, so a picker still narrowed to the home one
   * would hide the exact people this feature was added to reach.
   *
   * `$in` on one id is the same index lookup as equality, so the ordinary
   * หัวหน้า pays nothing for the general form.
   */
  if (user.role === 'manager') filter.department = { $in: approvalDepartments(user) };
  else if (user.role === 'employee') filter._id = user._id;
  if (q.department && ['hr', 'admin'].includes(user.role)) filter.department = q.department;
  if (q.company) filter.company = q.company;
  if (!q.all) filter.active = true;

  const found = await Employee.find(filter)
    .populate('department', 'code name nameTh monthlyCapHours weeklyCapHours otMode')
    .sort({ code: 1 })
    .lean();

  /**
   * A หัวหน้า whose signature is scoped to one payroll gets that half of their
   * department, not all of it.
   *
   * THE LIST AND THE BUTTONS HAVE TO AGREE. One screen consumes this as a
   * manager: the ลูกทีม picker in บันทึก OT แทน. `proxyPermission` refuses a
   * target outside the scope, so a picker that still offered those names would
   * be a list where choosing certain rows answers 403 — the failure this system
   * has already shipped once, on HR's own birthday queue.
   *
   * Filtered here through `companyOf` rather than as a clause on the query, for
   * the reason lib/delegationQuery.js resolves the same sets the same way: a row
   * whose `company` was never filled in is still on a payroll — the code prefix
   * says which — and a mongo filter cannot see that.
   *
   * ฝ่ายบุคคล and Admin are untouched. Their scope is the whole roster and the
   * `?company=` filter above is theirs to ask for.
   */
  const employees = user.role === 'manager' && user.approvesCompany
    ? found.filter((e) => companyOf(e) === user.approvesCompany)
    : found;

  // `.lean()` hands back the whole document, birthDate included. A manager
  // listing their department must not receive their team's dates of birth.
  return json({ employees: employees.map((e) => publicEmployee(e, user)) });
});

export const POST = route(async (req) => {
  const actor = await requireAuth(req);
  const {
    code, name, email, position, birthDate, department, role, company, approvesCompany, password,
    approvesDepartments,
  } = await body(req);

  if (!code || !name || !department) {
    return fail('ต้องระบุรหัสพนักงาน ชื่อ-สกุล และแผนก', 400);
  }
  if (role && !ROLES.includes(role)) return fail('บทบาทไม่ถูกต้อง', 400);
  if (company && !COMPANY_KEYS.includes(company)) return fail('บริษัทไม่ถูกต้อง', 400);

  // ฝ่ายบุคคล owns the roster; Admin still owns who may administer the system.
  const may = rosterPermission(actor, { role: role || 'employee' });
  if (!may.ok) return fail(may.error, may.status);

  /**
   * A password ฝ่ายบุคคล chose, if they chose one.
   *
   * The route used to refuse this outright, and refusing it was right while the
   * only thing that ever sent one was the old client computing it from the
   * employee code in the browser. What HR asked for is the other case: a first
   * password they can say to somebody in the room instead of reading a generated
   * one down a phone and resetting it when the notice is closed too early.
   *
   * So it is optional and checked rather than forbidden — `chosenPasswordPermission`
   * refuses the shape the old scheme had, and the account is still flagged
   * `mustChangePassword` below, because a password somebody else chose is not
   * yet the account holder's whichever way it was made.
   *
   * After the permission check, not before: a caller who may not create this row
   * at all is answered about that, rather than being told what this system
   * thinks of a password it was never going to accept.
   *
   * An empty string is "no password", not a password of length nought: the
   * field is on a form, and a form sends what is in the box.
   */
  const chosen = password === undefined || password === null || password === ''
    ? null
    : String(password);
  if (chosen !== null) {
    const chosenOk = chosenPasswordPermission(chosen, { code });
    if (!chosenOk.ok) return fail(chosenOk.error, chosenOk.status);
  }

  /**
   * Blank means ทุกบริษัท and is stored as null, not as ''. The form sends what
   * is in the box, and an empty string would fail the enum — see the same
   * reading of birthDate two lines down.
   */
  const signs = signingScope(approvesCompany);
  if (!signs.ok) return fail(signs.error, 400);

  /**
   * แผนกที่คุมเพิ่ม. The ids are checked against the real list rather than
   * trusted — see `approvalScope`, which also strips the home department the
   * form sends back ticked.
   *
   * Read only when there is something to check: the ordinary create sends
   * nothing and must not pay for a collection scan of แผนก to be told so.
   */
  /**
   * วันเกิด, in whichever era and shape it arrived in.
   *
   * READ ON THE SERVER AND NOT ONLY IN THE BOX, and the reason is the schema
   * one line further down: `birthDate` is matched against `^\d{4}-\d{2}-\d{2}$`,
   * which `2515-09-19` satisfies perfectly. A พ.ศ. year in ISO shape was
   * therefore stored verbatim by anything that did not go through the form —
   * and then read back as a birthday five centuries away, silently, because
   * nothing downstream compares a birthday against anything but itself.
   *
   * The refusal is loud rather than a dropped field: a วันเกิด is optional, so
   * a value quietly discarded for being unreadable looks exactly like a value
   * nobody typed. `smartDate` treats an empty string as no value at all, which
   * is what keeps the field clearable.
   */
  const birth = smartDate(birthDate, { label: 'วันเกิด' });
  if (birth.error) return fail(birth.error, 400);

  let extraDepts;
  if (approvesDepartments !== undefined) {
    const known = await Department.find().select('_id').lean();
    const scope = approvalScope(approvesDepartments, department, known.map((d) => d._id));
    if (!scope.ok) return fail(scope.error, 400);
    extraDepts = scope.value;
  }

  // company left out on purpose falls to the model's pre-validate hook, which
  // reads it off the code prefix.
  const employee = new Employee({
    code, name, email: email || undefined, position, department, role: role || 'employee',
    company: company || undefined,
    approvesCompany: signs.value,
    ...(extraDepts === undefined ? {} : { approvesDepartments: extraDepts }),
    // Optional, and always ค.ศ. by the time it reaches here — see `birth`
    // above. `null` from an empty box must become undefined, not '', or the
    // schema's YYYY-MM-DD match rejects the whole save.
    birthDate: birth.date || undefined,
  });
  /**
   * A NEW ROW CAN BE STRANDED THE MOMENT IT EXISTS — a Themtech พนักงาน created
   * in a แผนก whose only หัวหน้า signs for ไพรมัส has nobody to approve them and
   * nothing anywhere says so. Same rule as the edit route, with an empty
   * "before" because there was no row a moment ago.
   *
   * Checked before the password is generated, so a refusal costs nothing: see
   * the note in the edit route about why nothing to do with a password moves
   * until everything else has succeeded.
   */
  const peers = await Employee
    .find({ department: employee.department, active: true })
    .select('code name role department company approvesCompany approvesDepartments')
    .lean();
  /**
   * The signers are asked for separately from the peers, because a หัวหน้า
   * ticked into this แผนก is not in it. Left as the peer list alone, a new hire
   * in ADM would be refused on the grounds that nobody can sign for them, on a
   * roster where somebody in ผลิต has been given ADM and can.
   *
   * The same pool serves both sides of the comparison: creating a row cannot
   * change who signs for anybody else, so `before` and `after` differ only by
   * the new person — and if the new person IS a หัวหน้า, they are added to both
   * lists below.
   */
  const signers = await Employee
    .find({ role: 'manager', active: true })
    .select('code name role department company approvesCompany approvesDepartments')
    .lean();
  const arriving = {
    _id: employee._id,
    code: employee.code,
    name: employee.name,
    role: employee.role,
    department: employee.department,
    company: employee.company,
    approvesCompany: employee.approvesCompany,
    approvesDepartments: employee.approvesDepartments,
  };
  const withNew = employee.role === 'manager' ? [...signers, arriving] : signers;
  const cover = signingCoveragePermission(
    peers,
    [...peers, arriving],
    String(employee.department ?? ''),
    { before: signers, after: withNew },
  );
  if (!cover.ok) return fail(cover.error, 409);

  /**
   * The first password: what HR typed, or — when they left the box alone — the
   * new row's own รหัสพนักงาน.
   *
   * `employee.code` rather than the `code` off the body, so the value hashed
   * here is the one the roster will actually show. They are the same string
   * today; reading the document is what keeps them the same string if the model
   * ever normalizes a code on the way in, and a first password that differs
   * from the printed code by one character is indistinguishable from a wrong
   * password to everybody involved.
   */
  const issued = chosen ?? defaultPassword(employee.code);
  await employee.setPassword(issued);
  // Somebody else knows this password — it is not the employee's until they
  // have replaced it, and until then the client will not let the account
  // anywhere else. True of a generated one and of one HR typed: what the flag
  // records is that a second person knows it, not how it was made.
  employee.mustChangePassword = true;
  await employee.save();

  /**
   * The row's first record — every field it was created with, as a change from
   * nothing.
   *
   * Diffed against `{}` rather than written by hand, so a create and an edit
   * produce the same shape and the same allowlist decides both. A field added
   * to AUDITED_FIELDS is then covered here without this line being touched, and
   * one that must never be recorded stays out of both.
   *
   * `passwordReset` is deliberately NOT set: an account whose password was
   * issued at creation is what 'create' already means, and flagging it too
   * would make every new hire look like somebody who had forgotten theirs.
   */
  const auditLogged = await recordRosterChange({
    employee,
    action: 'create',
    changes: rosterChanges({}, {
      code: employee.code,
      name: employee.name,
      email: employee.email,
      position: employee.position,
      birthDate: employee.birthDate,
      department: employee.department,
      role: employee.role,
      company: employee.company,
      approvesCompany: employee.approvesCompany,
      active: employee.active,
    }),
    actor,
  });

  // The password the SERVER decided comes back, so the screen that created the
  // account can show HR what to hand over rather than working it out a second
  // time. It read "It is never readable again" until 2026-09-02, when the
  // default became the employee code — losing it now costs a look at the
  // roster, not a reset. Sent regardless, because the screen must show what was
  // stored and not what it assumes was stored.
  //
  // One HR typed is not echoed. They already have it — it is in the box they
  // typed it into — and sending it back would put a password the server never
  // needed to transmit into a response body, a browser's network log and
  // whatever sits between the two, to tell somebody something they know.
  // `passwordChosen` is what the screen reads instead: a missing `password` on
  // its own cannot be told apart from a server that failed to issue one, and
  // that failure is the emergency ResetPassword shouts about.
  return json({
    employee: await employee.populate('department', 'code name nameTh'),
    password: chosen ? undefined : issued,
    passwordChosen: chosen !== null,
    auditLogged,
  }, 201);
});
