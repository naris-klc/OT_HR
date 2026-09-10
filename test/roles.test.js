import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  APPROVED_BY, COMPANY_REPORT_ROLES, ROLES, ROLE_LABEL_TH, SIGNER_ROLES, approverRolesFor,
  filesStraightToHr, hrHeadsDepartment, isSigner, mayApproveRole, outranks, readsCompanyReports,
  readsOwnTeamOnly, maySeeRole, roleFromLabel, roleLabel, seesEveryRole, visibleRolesFor,
} from '../lib/roles.js';
import { mayCorrectEntries } from '../lib/entries.js';
import { teamScoped } from '../lib/reports.js';
import { approvalPermission } from '../lib/delegation.js';
import { initialStatus } from '../lib/proxyFiling.js';
import { HR_ASSIGNABLE_ROLES, unsignedStaff } from '../lib/employees.js';

/**
 * THE SEVEN บทบาท, AND THE ONE SPELLING THAT MAY NOT COME BACK.
 *
 * บทบาท went from four to seven on 2026-09-03. Most of this file is ordinary
 * cover for a new module; the two cases that earn it are the last two, and they
 * are about the rename rather than about the roles.
 *
 * `manager` used to be a role and used to mean หัวหน้างาน. The new seven have a
 * genuine ผู้จัดการแผนก a rung above หัวหน้างาน, so that string could not stay
 * with its old meaning — and reusing it with the new one would have been worse
 * than either, because every comparison already written against it would have
 * gone on compiling and started answering a different question. It was retired
 * instead, and this file is what stops it drifting back in.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── the list itself ─────────────────────────────────────────────────────────

test('there are seven บทบาท, lowest first', () => {
  assert.deepEqual(ROLES, [
    'employee',
    'supervisor',
    'finance',
    'dept_manager',
    'division_manager',
    'hr',
    'admin',
  ]);
});

test('the order is load-bearing, so it is not alphabetical', () => {
  // If somebody ever tidies ROLES into alphabetical order, `outranks` silently
  // starts answering that admin is the lowest rung — the sort would put it
  // first. This case is here to fail in that commit rather than in a queue.
  assert.notDeepEqual(ROLES, [...ROLES].sort());
});

test('every บทบาท has a Thai name, and no two share one', () => {
  const labels = ROLES.map((r) => ROLE_LABEL_TH[r]);
  for (const [i, label] of labels.entries()) {
    assert.equal(typeof label, 'string', `${ROLES[i]} has no label`);
    assert.ok(label.length, `${ROLES[i]} has an empty label`);
  }
  assert.equal(new Set(labels).size, labels.length);
});

test('a บทบาท this file does not know prints as itself, not as blank', () => {
  // A row carrying a spelling from before a migration must still be readable on
  // the screen that would be used to correct it.
  assert.equal(roleLabel('manager'), 'manager');
  assert.equal(roleLabel('employee'), 'พนักงาน');
});

// ── who stands above whom ───────────────────────────────────────────────────

test('each rung outranks every rung below it', () => {
  assert.equal(outranks('supervisor', 'employee'), true);
  assert.equal(outranks('dept_manager', 'supervisor'), true);
  assert.equal(outranks('division_manager', 'dept_manager'), true);
  assert.equal(outranks('hr', 'division_manager'), true);
  assert.equal(outranks('admin', 'hr'), true);
  // and not the other way round
  assert.equal(outranks('employee', 'supervisor'), false);
  assert.equal(outranks('supervisor', 'dept_manager'), false);
});

test('no บทบาท outranks itself — two หัวหน้างาน are not each other’s signer', () => {
  for (const role of ROLES) assert.equal(outranks(role, role), false, role);
});

test('การเงิน and หัวหน้างาน are peers: neither signs for the other', () => {
  // They sit at the same height in different departments — the หน่วยงาน table
  // has the การเงิน signing for แผนกบัญชีและการเงิน exactly as a หัวหน้างาน
  // signs for theirs. `RANK` gives them different indexes because an array
  // does; `outranks` is where that stops being a rank.
  assert.equal(outranks('finance', 'supervisor'), false);
  assert.equal(outranks('supervisor', 'finance'), false);
  // but both still stand above พนักงาน, and below ผู้จัดการแผนก
  assert.equal(outranks('finance', 'employee'), true);
  assert.equal(outranks('dept_manager', 'finance'), true);
});

test('an unknown บทบาท outranks nothing and is outranked by nothing', () => {
  assert.equal(outranks('manager', 'employee'), false);
  assert.equal(outranks('admin', 'manager'), false);
  assert.equal(outranks(undefined, 'employee'), false);
  assert.equal(outranks('admin', null), false);
});

// ── who holds a แผนก ────────────────────────────────────────────────────────

test('four บทบาท sign the first step; ฝ่ายบุคคล and ผู้ดูแลระบบ are not among them', () => {
  assert.deepEqual(SIGNER_ROLES, ['supervisor', 'finance', 'dept_manager', 'division_manager']);
  // Not an oversight: those two sign the SECOND step, which every request
  // passes through, and this list is about holding a department.
  assert.equal(isSigner('hr'), false);
  assert.equal(isSigner('admin'), false);
  assert.equal(isSigner('employee'), false);
});

test('ฝ่ายบุคคล may hand out exactly พนักงาน plus those four', () => {
  assert.deepEqual(HR_ASSIGNABLE_ROLES, ['employee', ...SIGNER_ROLES]);
  assert.equal(HR_ASSIGNABLE_ROLES.includes('hr'), false);
  assert.equal(HR_ASSIGNABLE_ROLES.includes('admin'), false);
});

// ── reading a บทบาท off a file HR typed ─────────────────────────────────────

test('the Thai names in the roster CSV read back into stored keys', () => {
  assert.equal(roleFromLabel('พนักงาน'), 'employee');
  assert.equal(roleFromLabel('หัวหน้างาน'), 'supervisor');
  assert.equal(roleFromLabel('การเงิน'), 'finance');
  assert.equal(roleFromLabel('ผู้จัดการแผนก'), 'dept_manager');
  assert.equal(roleFromLabel('ผู้จัดการฝ่าย'), 'division_manager');
  assert.equal(roleFromLabel('ฝ่ายบุคคล'), 'hr');
  assert.equal(roleFromLabel('ผู้ดูแลระบบ'), 'admin');
});

test('"HR" is accepted because that is the word the real file has in it', () => {
  assert.equal(roleFromLabel('HR'), 'hr');
  assert.equal(roleFromLabel('hr'), 'hr');
  assert.equal(roleFromLabel(' HR '), 'hr');
});

test('a stored key passes through, so a file exported by this system re-imports', () => {
  for (const role of ROLES) assert.equal(roleFromLabel(role), role);
});

test('anything else is null — an unreadable บทบาท is not quietly a พนักงาน', () => {
  // Defaulting here would hand somebody's signature to nobody and say nothing
  // about it. The import refuses the LINE and names it instead.
  assert.equal(roleFromLabel('หัวหน้า'), null);
  assert.equal(roleFromLabel('manager'), null);
  assert.equal(roleFromLabel(''), null);
  assert.equal(roleFromLabel(null), null);
  assert.equal(roleFromLabel(undefined), null);
});

// ── the retired spelling may not come back ──────────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(js|jsx)$/.test(rel)) out.push(rel);
  }
  return out;
}

/**
 * The lines that are allowed to say it, and what they mean when they do.
 *
 *   · `hrRejectReturnsTo: 'manager'` — a policy VALUE naming the `pending_mgr`
 *     step. The step is still the mgr step whoever holds it, the value is
 *     already stored in `Setting.policy`, and renaming it would need its own
 *     migration to buy nothing.
 *   · `.populate('manager', …)` — the `Department.manager` FIELD, which is not
 *     a บทบาท at all.
 *   · the ตั้งค่าระบบ row that offers that policy value, labelled หัวหน้างาน.
 */
const ALLOWED = [/hrRejectReturnsTo/, /populate\(/, /แก้ไขและส่งใหม่/];

/**
 * The migration is the one file whose JOB is to name the retired spelling — it
 * finds the rows still carrying it. Excluded by path rather than by an ALLOWED
 * pattern, because a pattern loose enough to let it through would let a real
 * comparison through beside it.
 */
const EXEMPT = new Set(['src/migrate-roles.js']);

const sources = ['app', 'lib', 'src', 'components', 'legacy']
  .flatMap((d) => walk(d))
  .filter((f) => !EXEMPT.has(f));

test('no source file compares a บทบาท against the retired spelling', () => {
  const offenders = [];
  for (const file of sources) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!line.includes("'manager'")) return;
      if (ALLOWED.some((re) => re.test(line))) return;
      offenders.push(`${file}:${i + 1} ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `the retired บทบาท spelling is back:\n${offenders.join('\n')}`);
});

test('the readers above actually read something', () => {
  // The ban is a search over a file list. A list that came out empty would pass
  // it silently, which is the one way a ban like this fails without saying so.
  assert.ok(sources.length > 100, `only ${sources.length} source files scanned`);
});

test('the label lists that used to be duplicated now read from lib/roles.js', () => {
  // Three copies of the บทบาท list had to agree before this: the model's enum,
  // ROLE_OPTIONS on ทะเบียนพนักงาน, and ROLE_LABEL in the compliance export.
  // Adding a role meant remembering all three, and the forgotten one is always
  // the label — so the screen shows a raw `division_manager` to the person
  // whose job title it is.
  const model = readFileSync(join(ROOT, 'src/models/Employee.js'), 'utf8');
  assert.match(model, /import \{ ROLES \} from '\.\.\/\.\.\/lib\/roles\.js';/);
  assert.match(model, /enum: ROLES/);

  const admin = readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8');
  assert.match(admin, /ROLE_OPTIONS = ROLES\.map\(/);

  const compliance = readFileSync(join(ROOT, 'lib/complianceExport.js'), 'utf8');
  assert.match(compliance, /ROLE_LABEL = ROLE_LABEL_TH;/);
});


// ════════════════════════════════════════════════════════════════════════════
// THE ROUTING MATRIX — who signs the first step of whose request
// ════════════════════════════════════════════════════════════════════════════

test('the ladder HR gave, one rung at a time, is the FIRST answer for each บทบาท', () => {
  // The preference, read off the head of each list. The rest of each list is
  // the fall-up below, and it exists because 13 of 18 departments have no
  // หัวหน้างาน — a strict one-rung ladder strands 97 of the 143 พนักงาน.
  assert.equal(approverRolesFor('employee')[0], 'supervisor');
  assert.equal(approverRolesFor('supervisor')[0], 'dept_manager');
  assert.equal(approverRolesFor('dept_manager')[0], 'division_manager');
});

test('four บทบาท have no first step — ฝ่ายบุคคล sign them and that is the whole approval', () => {
  for (const role of ['finance', 'division_manager', 'hr', 'admin']) {
    assert.deepEqual(approverRolesFor(role), [], role);
    assert.equal(filesStraightToHr(role), true, role);
  }
  for (const role of ['employee', 'supervisor', 'dept_manager']) {
    assert.equal(filesStraightToHr(role), false, role);
  }
});

test('การเงิน signs for พนักงาน in their own แผนก, as the หน่วยงาน table has it', () => {
  // แผนกบัญชีและการเงิน's named signer is the การเงิน, not a หัวหน้างาน.
  assert.equal(mayApproveRole('finance', 'employee'), true);
  // …and not for a หัวหน้างาน, who is their peer, nor upwards.
  assert.equal(mayApproveRole('finance', 'supervisor'), false);
  assert.equal(mayApproveRole('supervisor', 'finance'), false);
  assert.equal(mayApproveRole('finance', 'finance'), false);
});

test('a ผู้จัดการแผนก signs พนักงาน and หัวหน้างาน, never another ผู้จัดการแผนก', () => {
  assert.equal(mayApproveRole('dept_manager', 'employee'), true);
  assert.equal(mayApproveRole('dept_manager', 'supervisor'), true);
  assert.equal(mayApproveRole('dept_manager', 'dept_manager'), false);
  assert.equal(mayApproveRole('division_manager', 'dept_manager'), true);
});

test('ฝ่ายบุคคล and ผู้ดูแลระบบ are on nobody’s first-step list', () => {
  // They sign the SECOND step, which every request passes through. Putting
  // them here would let one account supply both signatures §6 asks for.
  for (const applicant of ROLES) {
    assert.equal(mayApproveRole('hr', applicant), false, applicant);
    assert.equal(mayApproveRole('admin', applicant), false, applicant);
  }
});

test('nobody signs their own บทบาท’s requests, at any rung', () => {
  for (const role of ROLES) assert.equal(mayApproveRole(role, role), false, role);
});

test('an unknown บทบาท files straight to ฝ่ายบุคคล rather than to a step nobody holds', () => {
  // A row carrying a spelling from before a migration must land somewhere a
  // person can see it and act.
  assert.deepEqual(approverRolesFor('manager'), []);
  assert.deepEqual(approverRolesFor(undefined), []);
  assert.equal(filesStraightToHr('manager'), true);
});

test('every บทบาท in the matrix is a real one, and every real one is in the matrix', () => {
  assert.deepEqual(Object.keys(APPROVED_BY).sort(), [...ROLES].sort());
  for (const [applicant, approvers] of Object.entries(APPROVED_BY)) {
    for (const approver of approvers) {
      assert.ok(ROLES.includes(approver), `${applicant} routes to unknown ${approver}`);
      assert.ok(isSigner(approver), `${approver} does not hold a แผนก`);
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// THE MATRIX AS THE APPROVE ROUTE APPLIES IT
// ════════════════════════════════════════════════════════════════════════════

const DEPT = 'dept-prod';
const person = (id, role, over = {}) => ({
  _id: id, name: id, role, department: DEPT, company: 'primus', active: true, ...over,
});

const SUP = person('sup-1', 'supervisor');
const SUP2 = person('sup-2', 'supervisor');
const DM = person('dm-1', 'dept_manager');
const DM2 = person('dm-2', 'dept_manager');
const DIV = person('div-1', 'division_manager');
const FIN = person('fin-1', 'finance');
const EMP = person('emp-1', 'employee');
const HRP = person('hr-1', 'hr');

const waiting = (applicant) => ({
  status: 'pending_mgr', department: DEPT, employee: applicant,
});

const may = (user, applicant) => approvalPermission({
  user, entry: waiting(applicant), delegations: [], today: '2026-09-03',
});

test('a หัวหน้างาน signs a พนักงาน’s request and not another หัวหน้างาน’s', () => {
  assert.equal(may(SUP, EMP).ok, true);
  const peer = may(SUP, SUP2);
  assert.equal(peer.ok, false);
  assert.equal(peer.status, 403);
  assert.match(peer.error, /ลำดับที่สูงกว่า/);
});

test('a ผู้จัดการแผนก signs the หัวหน้างาน above that พนักงาน, and the พนักงาน too', () => {
  assert.equal(may(DM, SUP).ok, true);
  assert.equal(may(DM, EMP).ok, true, 'แผนกผลิต1 has no หัวหน้างาน — its ผู้จัดการ signs directly');
  assert.equal(may(DM, DM2).ok, false);
  assert.equal(may(DIV, DM).ok, true);
});

test('the การเงิน signs พนักงาน in their แผนก and no rung above', () => {
  assert.equal(may(FIN, EMP).ok, true);
  assert.equal(may(FIN, SUP).ok, false);
});

test('NOBODY SIGNS THEIR OWN REQUEST — applicant_id !== approver_id', () => {
  // The rule did not need saying until every บทบาท could file: a หัวหน้างาน's
  // own request now lands in the queue their own department's signers read,
  // and their own name is one of them.
  const own = may(SUP, SUP);
  assert.equal(own.ok, false);
  assert.equal(own.status, 403);
  assert.match(own.error, /ใบคำขอของตนเอง/);

  for (const who of [DM, DIV, FIN, EMP]) {
    assert.equal(may(who, who).ok, false, who.role);
  }
});

test('ฝ่ายบุคคล are the exception, and ผู้ดูแลระบบ are not', () => {
  // HR asked for this on 2026-09-03. The ฝ่ายบุคคล login is shared by the whole
  // department, so "the same person twice" is not checkable there anyway.
  const hrOwn = approvalPermission({
    user: HRP, entry: { status: 'pending_hr', department: DEPT, employee: HRP },
    delegations: [], today: '2026-09-03',
  });
  assert.equal(hrOwn.ok, true);
  assert.equal(hrOwn.stage, 'hr');

  const adminOwn = approvalPermission({
    user: person('adm-1', 'admin'),
    entry: { status: 'pending_hr', department: DEPT, employee: person('adm-1', 'admin') },
    delegations: [], today: '2026-09-03',
  });
  assert.equal(adminOwn.ok, false, 'one account held for repairs is not a second pair of eyes');
});

// ════════════════════════════════════════════════════════════════════════════
// WHERE A NEW REQUEST STARTS
// ════════════════════════════════════════════════════════════════════════════

const filing = (employee, signers) => initialStatus({
  filer: employee, employee, department: DEPT, policy: {}, signers,
});

test('a พนักงาน with a หัวหน้างาน in their แผนก waits at the หัวหน้า step', () => {
  assert.equal(filing(EMP, [SUP]).status, 'pending_mgr');
  assert.equal(filing(EMP, [DM]).status, 'pending_mgr', 'a ผู้จัดการแผนก counts');
  assert.equal(filing(EMP, [FIN]).status, 'pending_mgr', 'so does the การเงิน');
});

test('a แผนก with nobody on any rung above files to ฝ่ายบุคคล instead of waiting for ever', () => {
  // แผนกจัดซื้อ and แผนกทรัพยากรมนุษย์ have ฝ่ายบุคคล written into the
  // หัวหน้างาน column of the หน่วยงาน table outright.
  assert.equal(filing(EMP, []).status, 'pending_hr');
  assert.equal(filing(EMP, [HRP]).status, 'pending_hr', 'ฝ่ายบุคคล hold no แผนก');
  assert.equal(filing(SUP, [SUP2]).status, 'pending_hr', 'a peer cannot sign for them');
  assert.equal(filing(SUP, [DM]).status, 'pending_mgr');
});

test('the person themselves never counts as their own signer', () => {
  assert.equal(filing(SUP, [SUP, DM]).status, 'pending_mgr', 'the ผู้จัดการแผนก is why');
  assert.equal(filing(DM, [DM]).status, 'pending_hr', 'they are the only one, and it is theirs');
});

test('the four บทบาท with no first step ignore the roster entirely', () => {
  for (const who of [FIN, DIV, HRP, person('adm-1', 'admin')]) {
    const start = filing(who, [SUP, DM, DIV]);
    assert.equal(start.status, 'pending_hr', who.role);
    assert.equal(start.skipped, false, 'no step was skipped by anybody’s judgement');
    assert.equal(start.note, null);
  }
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A แผนก WHOSE หัวหน้างาน IS ฝ่ายบุคคล — the rule, not the empty roster.
 *
 * แผนกจัดซื้อ and แผนกทรัพยากรมนุษย์ have ฝ่ายบุคคล written into the
 * หัวหน้างาน column of the หน่วยงาน table, and HR restated it on 2026-09-07.
 * Both already routed to ฝ่ายบุคคล before `signedByHr` existed, because the
 * roster check above could find nobody to sign for them — which is the whole
 * reason these tests are worth writing separately from those. The roster
 * answer moves with the next hire; this one does not, and the case that tells
 * them apart is the third assertion.
 */
const HR_DEPT = { _id: 'dept-pur', signedByHr: true };
const hrDeptFiling = (employee, signers) => initialStatus({
  filer: employee, employee, department: HR_DEPT, policy: {}, signers,
});

test('ฝ่ายบุคคล as the แผนก\'s หัวหน้างาน sends the request straight to them', () => {
  const start = hrDeptFiling(EMP, []);
  assert.equal(start.status, 'pending_hr');
  assert.equal(start.skipped, false, 'no step was passed over — there was none to pass over');
  assert.equal(start.note, null);
});

test('and it outranks the roster, which is the whole reason the field exists', () => {
  // Appoint a ผู้จัดการแผนกจัดซื้อ and the roster check above would route every
  // purchasing request to them. The department's own row is what stops it.
  const dm = person('dm-pur', 'dept_manager', { department: HR_DEPT._id });
  assert.equal(
    filing(EMP, [{ ...dm, department: DEPT }]).status, 'pending_mgr',
    'the control: this is what the roster alone would answer',
  );
  assert.equal(hrDeptFiling(EMP, [dm]).status, 'pending_hr');
});

test('a หัวหน้า filing for somebody in such a แผนก has skipped nothing', () => {
  // The proxy branch marks `skipped` and writes a SKIP_NOTE when the filer
  // could have signed the step themselves. Here there is no step, so the entry
  // must not arrive at ฝ่ายบุคคล carrying a note saying one was passed over.
  const dm = person('dm-pur', 'dept_manager', { department: HR_DEPT._id });
  const start = initialStatus({
    filer: dm, employee: EMP, department: HR_DEPT, policy: {}, signers: [dm],
  });
  assert.equal(start.status, 'pending_hr');
  assert.equal(start.skipped, false);
  assert.equal(start.note, null);
});

test('a bare department id reads as "not marked", never as marked', () => {
  // `hrHeadsDepartment` takes the document. A caller that hands in an id gets
  // the ordinary roster answer — a request routed to a step somebody is
  // watching — rather than one quietly declared ฝ่ายบุคคล's on the strength of
  // a field nobody read.
  assert.equal(hrHeadsDepartment(HR_DEPT), true);
  assert.equal(hrHeadsDepartment('dept-pur'), false);
  assert.equal(hrHeadsDepartment(null), false);
  assert.equal(hrHeadsDepartment({ _id: 'dept-prod' }), false, 'an ordinary แผนก');
});

test('nobody in such a แผนก is reported as stranded on ตั้งค่าระบบ', () => {
  // The screen's ⚠ ยังไม่มีหัวหน้า is for a department left without a signer,
  // not for one where the empty column IS the answer. Both readings come from
  // `unsignedStaff`, so they cannot disagree with the routing above.
  const roster = [EMP, person('emp-2', 'employee')];
  assert.equal(unsignedStaff(roster, DEPT, []).length, 2, 'the control');
  assert.deepEqual(unsignedStaff(roster, HR_DEPT, []), []);
});

test('a null signer list is "nobody asked", not "nobody exists"', () => {
  // The write path skips the query for บทบาท whose answer does not depend on
  // it. Reading null as an empty roster would send every ordinary request to
  // ฝ่ายบุคคล the day a caller forgot the argument.
  assert.equal(filing(EMP, null).status, 'pending_mgr');
  assert.equal(filing(EMP, undefined).status, 'pending_mgr');
});


// ════════════════════════════════════════════════════════════════════════════
// บันทึกและประวัติ OT IS ONE PERSON'S OWN, WHATEVER THEIR บทบาท
// ════════════════════════════════════════════════════════════════════════════

/**
 * THE REGRESSION THIS PINS, WHICH WAS REPORTED FROM THE REAL SCREEN.
 *
 * `scopeFor` answers a DEPARTMENT for the four บทบาท that hold one, and until
 * 2026-09-03 that was harmless: those บทบาท could not file OT, so they never
 * opened บันทึกและประวัติ OT. The moment every บทบาท could file, that screen —
 * which asked for a bare list — started showing a หัวหน้างาน their whole team's
 * requests under a heading that says ของฉัน, with the hour totals to match and
 * "รอการอนุมัติจาก: <their own name>" under each row.
 *
 * Three things had to agree to fix it, so all three are read here.
 */

const src = (f) => readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

test('the list route has a scope that means MY requests, and it replaces the แผนก one', () => {
  const route = src('app/api/entries/route.js');
  assert.match(route, /const q = scope === 'mine'\n\s*\? \{ employee: user\._id \}/);
  // Replaces rather than narrows: my own requests are mine whether or not the
  // แผนก they sit in is one I sign for.
  assert.doesNotMatch(route, /scope === 'mine'[\s\S]{0,80}\.\.\.reach\.scope/);
});

test('บันทึกและประวัติ OT asks for that scope rather than a bare list', () => {
  assert.match(src('components/EmployeeView.jsx'), /\/entries\?limit=200&scope=mine/);
});

test('nobody is offered as the person who will sign their own request', () => {
  const route = src('app/api/entries/approvers/route.js');
  assert.match(route, /String\(m\._id\) !== String\(user\._id\)/);
  // and only บทบาท the matrix actually puts on this person's request
  assert.match(route, /mayApproveRole\(m\.role, user\.role\)/);
});

// ════════════════════════════════════════════════════════════════════════════
// การเงิน READ THE WHOLE COMPANY'S MONTH, AND WRITE NONE OF IT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Asked for on 2026-09-03, in one sentence: การเงิน get บันทึกและประวัติ OT and
 * พิมพ์ใบขออนุมัติ OT of their own, the queue of พนักงาน in their แผนก the way
 * any approver has it — "แต่จะเห็นเมนูตรวจสอบประจำเดือน และ รายงาน OT ฝ่ายบัญชี
 * แต่ไม่สามารถแก้ไขข้อมูลได้".
 *
 * The two halves of that pull in opposite directions and are what these cases
 * hold apart. They are a SIGNER, so `scopeFor` narrows them to แผนกบัญชีและ
 * การเงิน — right for the queue, and wrong for the two report screens, where it
 * would have given them one แผนก on ตรวจสอบประจำเดือน and every แผนก on
 * รายงาน OT ฝ่ายบัญชี in the same month. And they are NOT ฝ่ายบุคคล, so nothing
 * they can now see may be given a button that changes it.
 */

test('three บทบาท read every แผนก’s month; the other three signers read their own', () => {
  assert.deepEqual(COMPANY_REPORT_ROLES, ['finance', 'hr', 'admin']);
  for (const role of ['finance', 'hr', 'admin']) {
    assert.equal(readsCompanyReports(role), true, role);
    assert.equal(readsOwnTeamOnly(role), false, `${role} was narrowed to a team`);
  }
  assert.deepEqual(
    ROLES.filter(readsOwnTeamOnly),
    ['supervisor', 'dept_manager', 'division_manager'],
  );
  // A พนักงาน reads neither — they are on no report screen at all, and this
  // predicate must not become the thing that decides that.
  assert.equal(readsCompanyReports('employee'), false);
  assert.equal(readsOwnTeamOnly('employee'), false);
  // An unknown บทบาท reads nothing, like everywhere else in this file.
  assert.equal(readsCompanyReports('manager'), false);
  assert.equal(readsOwnTeamOnly(undefined), false);
});

test('การเงิน are still signers, and still peers of a หัวหน้างาน', () => {
  // The reading right is not a promotion. Everything about who they sign for
  // is untouched by it.
  assert.equal(isSigner('finance'), true);
  assert.equal(outranks('finance', 'supervisor'), false);
  assert.equal(mayApproveRole('finance', 'employee'), true);
  assert.equal(mayApproveRole('finance', 'supervisor'), false);
});

test('reading a report is not permission to correct one — that stays ฝ่ายบุคคล’s', () => {
  for (const role of ['hr', 'admin']) {
    assert.equal(mayCorrectEntries({ role }), true, role);
  }
  for (const role of ['finance', 'supervisor', 'dept_manager', 'division_manager', 'employee']) {
    assert.equal(mayCorrectEntries({ role }), false, role);
  }
  assert.equal(mayCorrectEntries(undefined), false);
});

test('the three monthly documents narrow through teamScoped, and none on isSigner', () => {
  /**
   * ONE PREDICATE, THREE ROUTES. Each of these spelt the narrowing as
   * `isSigner(user.role)` — correct until a signer who reads the whole company
   * existed. Missed on any ONE of them, a การเงิน gets a table and its own
   * export button disagreeing about the same month, which is a discrepancy
   * found by whoever is reconciling it and by nobody before them.
   *
   * `teamScoped` takes the `?scope=` with it, because since การเงิน hold BOTH
   * readings the request has to be able to say which one it is. It can only
   * narrow — see lib/reports.js.
   *
   * ⚠ IT READ "assert.match(text, /const teamOnly = teamScoped(user.role,
   * q.scope);/)" AT EACH OF THE THREE UNTIL 2026-09-10 — three routes pinned to
   * three copies of one line. The แผนก dropdown added a second question to that
   * same spot (`?department=`), which would have made it three copies of a
   * longer rule, so the whole of it moved into `departmentScope` and the three
   * now CALL it. That is the property this test was always about, reached at
   * last: they cannot drift apart, because there is nothing left to drift.
   *
   * So the shape pinned at each route is the call, and `teamScoped` itself is
   * pinned once, inside the function all three reach it through.
   */
  for (const file of [
    'app/api/reports/monthly/[period]/route.js',
    'app/api/exports/monthly.csv/route.js',
    'app/api/exports/entries.csv/route.js',
  ]) {
    const text = src(file);
    assert.match(text, /const \{ teamOnly, department \} = departmentScope\(user, q\);/, file);
    assert.match(text, /if \(department\) filter\.department = department;/, file);
    assert.ok(!/isSigner\(user\.role\)/.test(text), `${file} still narrows on isSigner`);
    // …and none of them kept a private copy of the rule they now share.
    assert.ok(!/teamScoped\(/.test(text), `${file} is asking teamScoped behind departmentScope`);
    assert.ok(
      !/approvalDepartments\(/.test(text),
      `${file} is building its own department list again`,
    );
  }
  // The one place the predicate is now spelt, and it is still `teamScoped`.
  const reports = src('lib/reports.js');
  assert.match(reports, /const teamOnly = teamScoped\(user\.role, q\.scope\);/);
  assert.ok(!/isSigner\(user\.role\)/.test(reports), 'departmentScope narrows on isSigner');
  // The printable sheet takes no `?scope=`: it is one employee, and whether
  // this reader may print THAT employee is a question about the person, not
  // about how wide a table they were looking at.
  const form = src('app/api/reports/form/[period]/route.js');
  assert.match(form, /readsOwnTeamOnly\(user\.role\)/);
  assert.ok(!/isSigner\(user\.role\)/.test(form), 'the form route still narrows on isSigner');
});

test('scope=team narrows and never widens — which is the only direction that matters', () => {
  // A หัวหน้างาน asking for the company still gets their team; ฝ่ายบุคคล asking
  // for a team still get the company, because they sign no แผนก. The one บทบาท
  // it moves is การเงิน, who hold both tabs.
  assert.equal(teamScoped('supervisor', undefined), true);
  assert.equal(teamScoped('supervisor', 'team'), true);
  assert.equal(teamScoped('supervisor', 'company'), true);
  assert.equal(teamScoped('hr', 'team'), false);
  assert.equal(teamScoped('admin', 'team'), false);
  assert.equal(teamScoped('finance', undefined), false, 'their wide tab');
  assert.equal(teamScoped('finance', 'team'), true, 'their narrow tab');
  // A บทบาท that reads no report at all is not handed one by asking.
  assert.equal(teamScoped('employee', 'team'), false);
  assert.equal(teamScoped('employee', undefined), false);
  // Anything that is not the word means the reader's ordinary answer.
  for (const junk of ['', 'all', 'TEAM', null, 0]) {
    assert.equal(teamScoped('finance', junk), false, String(junk));
  }
});

test('a การเงิน scoped to one payroll still reads BOTH companies on the reports', () => {
  /**
   * `approvesCompany` is the field that narrows a signer to one payroll, and it
   * is the trap in this feature: it is right for the QUEUE — a การเงิน who
   * signs only for เดมเทค signs only for เดมเทค — and wrong for the two report
   * screens, which the same person reads across both companies. Asked for
   * outright on 2026-09-03: "สามารถเห็นได้ทั้ง 2 บริษัทเลย".
   *
   * The three report routes each apply that filter behind `teamOnly`, which is
   * false for การเงิน, so the filter is skipped whatever `approvesCompany`
   * says. Pinned as source shape because the alternative failure is silent: the
   * sheet simply comes up short by one payroll, on a screen whose whole job is
   * to be complete.
   */
  for (const file of [
    'app/api/reports/monthly/[period]/route.js',
    'app/api/exports/monthly.csv/route.js',
    'app/api/exports/entries.csv/route.js',
  ]) {
    const text = src(file);
    assert.match(text, /const \{ teamOnly, department \} = departmentScope\(user, q\);/, file);
    assert.match(text, /teamOnly && user\.approvesCompany/, file);
    // …and never the old spelling, which would have narrowed them by payroll.
    assert.ok(!/isSigner\(user\.role\) && user\.approvesCompany/.test(text), file);
  }
  // On รายงาน OT ประจำทีม the payroll filter is BACK ON for them, and rightly:
  // that tab is the แผนก they sign for, and `approvesCompany` is exactly what
  // says which half of it their signature covers. Both readings come out of the
  // one `teamOnly` above, so the two can never be set differently.
  // สรุป OT ส่งบัญชี partitions BY company rather than filtering to one, and
  // the only narrowing is the reader's own dropdown (`?company=`), which
  // defaults to every company on the screen that opens it.
  assert.match(src('components/AccountingView.jsx'), /useState\('all'\)/);
});

test('สรุป OT ส่งบัญชี and its CSV take the list of readers, not a third literal pair', () => {
  for (const file of [
    'app/api/reports/accounting/[period]/route.js',
    'app/api/exports/accounting.csv/route.js',
  ]) {
    assert.match(src(file), /requireRole\(await requireAuth\(req\), \.\.\.COMPANY_REPORT_ROLES\)/, file);
  }
});

test('the drill-in has a scope of its own, and the QUEUE is not widened by it', () => {
  const route = src('app/api/entries/route.js');
  // `scope=report` — gated on the same predicate the report itself is scoped
  // by, so it can hand out no reach that screen did not already grant.
  assert.match(route, /scope === 'report' && readsCompanyReports\(user\.role\)\n\s*\? \{\}/);
  // And `scopeFor` is untouched: a การเงิน widened there would be shown every
  // pending request in the company with two buttons that answer 403.
  assert.ok(!/scopeFor\([^)]*readsCompanyReports/.test(route));
  assert.ok(!src('lib/entries.js').includes('readsCompanyReports'),
    'scopeFor learnt about company reports — the queue and the report are two questions');
  // Both screens that hang off ตรวจสอบประจำเดือน ask for it.
  for (const screen of ['components/HrEntries.jsx', 'components/HrEdits.jsx']) {
    assert.match(src(screen), /&scope=report/, screen);
  }
});

test('the screens ask the same rule the route refuses by, so no button is offered twice over', () => {
  // README §สิทธิ์: every rule is enforced at the route, and no control is
  // handed to somebody the server will refuse. `editPermission` is the rule;
  // `mayCorrectEntries` is its บทบาท half, exported so the screens can ask it.
  assert.match(src('lib/entries.js'), /if \(mayCorrectEntries\(user\)\) \{/);
  const view = src('components/HrView.jsx');
  assert.match(view, /const mayCorrect = mayCorrectEntries\(user\);/);
  assert.match(view, /mayEdit=\{mayCorrect\}/);
  // …and the two controls that write are the two that disappear.
  const entries = src('components/HrEntries.jsx');
  assert.match(entries, /\{!mayEdit \? null : closed \? \(/);
  assert.match(entries, /\{mayEdit && isUntouchedSystemFiling\(e\) && \(/);
});

test('the same two rules the approve route decides by, not a second reading', () => {
  // A screen that names somebody the server would refuse sends the person
  // asking "who signs this" to the wrong desk — which is what this endpoint
  // exists to prevent, so it may not answer the question its own way.
  const route = src('app/api/entries/approvers/route.js');
  assert.match(route, /isDepartmentManager\(m, departmentId, company\)/);
  assert.match(route, /from '@\/lib\/roles\.js'/);
});


// ════════════════════════════════════════════════════════════════════════════
// THE VISIBILITY LADDER — every rung below, not just the one you sign
// ════════════════════════════════════════════════════════════════════════════

/**
 * HR's chart, 2026-09-03:
 *
 *     ผู้ดูแลระบบ  — ทุกอย่าง
 *     ฝ่ายบุคคล ▸ ผู้จัดการฝ่าย ▸ ผู้จัดการแผนก ▸ หัวหน้างาน ▸ พนักงาน
 *     ฝ่ายบุคคล ▸ การเงิน ▸ พนักงาน
 *
 * Reading is not signing and the difference is the point: a ผู้จัดการฝ่าย reads
 * a พนักงาน's request three rungs down and, where a หัวหน้างาน exists, is not
 * the one who signs it.
 */

test('the chart HR drew, read straight off visibleRolesFor', () => {
  assert.deepEqual(visibleRolesFor('employee'), []);
  assert.deepEqual(visibleRolesFor('supervisor'), ['employee']);
  assert.deepEqual(visibleRolesFor('finance'), ['employee']);
  assert.deepEqual(visibleRolesFor('dept_manager'), ['employee', 'supervisor']);
  assert.deepEqual(visibleRolesFor('division_manager'), ['employee', 'supervisor', 'dept_manager']);
});

test('ฝ่ายบุคคล and ผู้ดูแลระบบ read every บทบาท there is', () => {
  for (const viewer of ['hr', 'admin']) {
    assert.deepEqual(visibleRolesFor(viewer), [...ROLES], viewer);
    assert.equal(seesEveryRole(viewer), true, viewer);
  }
  for (const viewer of ['employee', ...SIGNER_ROLES]) {
    assert.equal(seesEveryRole(viewer), false, viewer);
  }
});

test('the two branches cannot see into each other', () => {
  // การเงิน hangs off ฝ่ายบุคคล with พนักงาน under them and nothing else.
  assert.equal(maySeeRole('division_manager', 'finance'), false);
  assert.equal(maySeeRole('dept_manager', 'finance'), false);
  assert.equal(maySeeRole('finance', 'supervisor'), false);
  assert.equal(maySeeRole('finance', 'dept_manager'), false);
  // …and both branches still meet at ฝ่ายบุคคล.
  assert.equal(maySeeRole('hr', 'finance'), true);
  assert.equal(maySeeRole('hr', 'division_manager'), true);
});

test('nobody below ฝ่ายบุคคล reads their own บทบาท’s requests', () => {
  // Two หัวหน้างาน in one แผนก — แผนกผลิต2 has four — do not read each other.
  for (const role of ['employee', ...SIGNER_ROLES]) {
    assert.equal(maySeeRole(role, role), false, role);
  }
});

test('seeing is WIDER than signing, never narrower', () => {
  // The invariant that keeps a queue from offering a row its own list hides.
  for (const viewer of ROLES) {
    for (const applicant of ROLES) {
      if (!mayApproveRole(viewer, applicant)) continue;
      assert.equal(
        maySeeRole(viewer, applicant), true,
        `${viewer} may sign for ${applicant} but may not see them`,
      );
    }
  }
});

test('an unknown บทบาท is read by ฝ่ายบุคคล and ผู้ดูแลระบบ only', () => {
  assert.equal(maySeeRole('hr', 'manager'), true);
  assert.equal(maySeeRole('admin', 'manager'), true);
  assert.equal(maySeeRole('division_manager', 'manager'), false);
  assert.equal(maySeeRole('manager', 'employee'), false);
});

test('it is computed from APPROVED_BY, so the two cannot drift', () => {
  // Walking up the matrix from each applicant reproduces the chart. Written as
  // a second walk rather than as a second table: a hand-written table is the
  // thing that would still say the old answer a year from now.
  for (const applicant of ROLES) {
    const seen = new Set(['hr', 'admin']);
    const queue = [...approverRolesFor(applicant)];
    while (queue.length) {
      const next = queue.shift();
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...approverRolesFor(next));
    }
    for (const viewer of ROLES) {
      assert.equal(maySeeRole(viewer, applicant), seen.has(viewer), `${viewer} → ${applicant}`);
    }
  }
});

test('the list route asks the ladder, and as $and so ?employee= cannot widen it', () => {
  const route = src('app/api/entries/route.js');
  assert.match(route, /const visible = await visibleEmployeeClause\(user\);/);
  assert.match(route, /q\.\$and = \[\.\.\.\(q\.\$and \|\| \[\]\), visible\];/);
  // `mine` is one person already; `report` is a whole-company reading with
  // its own บทบาท gate. Neither is narrowed twice.
  assert.match(route, /scope !== 'mine' && !\(scope === 'report'/);
});

test('the clause keeps the reader’s own row, because ownership is not a บทบาท', () => {
  const q = src('lib/delegationQuery.js');
  assert.match(q, /export async function visibleEmployeeClause\(user\)/);
  assert.match(q, /\[\.\.\.people\.map\(\(p\) => p\._id\), user\._id\]/);
  // ฝ่ายบุคคล and ผู้ดูแลระบบ get no clause at all rather than one listing
  // every employee in the company.
  assert.match(q, /if \(seesEveryRole\(user\?\.role\)\) return null;/);
});
