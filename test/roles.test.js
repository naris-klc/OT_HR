import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  APPROVED_BY, ROLES, ROLE_LABEL_TH, SIGNER_ROLES, approverRolesFor, filesStraightToHr,
  isSigner, mayApproveRole, outranks, roleFromLabel, roleLabel,
} from '../lib/roles.js';
import { approvalPermission } from '../lib/delegation.js';
import { initialStatus } from '../lib/proxyFiling.js';
import { HR_ASSIGNABLE_ROLES } from '../lib/employees.js';

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

test('the same two rules the approve route decides by, not a second reading', () => {
  // A screen that names somebody the server would refuse sends the person
  // asking "who signs this" to the wrong desk — which is what this endpoint
  // exists to prevent, so it may not answer the question its own way.
  const route = src('app/api/entries/approvers/route.js');
  assert.match(route, /isDepartmentManager\(m, departmentId, company\)/);
  assert.match(route, /from '@\/lib\/roles\.js'/);
});
