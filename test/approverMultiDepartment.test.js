import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  approvalDepartments, claimFilter, isDepartmentManager, ownClaim, ownClaims, scopeFor,
} from '../lib/entries.js';
import { approvalScope, signingCoveragePermission, unsignedStaff } from '../lib/employees.js';
import { auditValue, rosterChanges, AUDITED_FIELDS } from '../lib/rosterAudit.js';

/**
 * หัวหน้างานหนึ่งคนคุมได้หลายแผนก — `Employee.approvesDepartments`.
 *
 * WHAT THIS IS ABOUT. A หัวหน้า signed for exactly one department for as long
 * as this system has existed: `isDepartmentManager` compared their own
 * `department` with the entry's. ADM has three people and no หัวหน้า, so a
 * holiday OT filed there waits at รอหัวหน้า with nobody able to clear it, and
 * the only two answers were to move somebody's แผนก — which moves their hours,
 * their ceiling and their report row with them — or to keep renewing a
 * ผู้รับช่วงอนุมัติ, which is a window that closes by design.
 *
 * The field is EXTRAS ONLY and the home department is derived, which is the
 * property most of this file is about: there is no value it can hold that takes
 * a หัวหน้า off their own team, and no stored list that can go stale when
 * somebody's แผนก moves.
 *
 * WHAT IS TESTED ELSEWHERE. `isDepartmentManager`'s company half is
 * test/approverCompanyScope.test.js and is untouched by this; the coverage
 * finding itself is test/signingCoverage.test.js; how the settings screen
 * paints it is test/settingsCoverageUi.test.js.
 *
 * Run with: npm test
 */

const PROD = '000000000000000000000001';
const ENG = '000000000000000000000002';
const ADM = '000000000000000000000003';
const QC = '000000000000000000000004';

/** A หัวหน้า of PROD who has also been ticked into ADM. */
const WIDE = {
  _id: 'm1', code: 'PM-0101', name: 'ประเสริฐ', role: 'manager',
  department: PROD, approvesCompany: null, approvesDepartments: [ADM],
};
/** The same person before anybody ticked anything. */
const NARROW = {
  _id: 'm1', code: 'PM-0101', name: 'ประเสริฐ', role: 'manager',
  department: PROD, approvesCompany: null,
};
/** Ticked into ADM and narrowed to one payroll. */
const WIDE_THT = { ...WIDE, approvesCompany: 'themtech' };

const pm = (id, dept) => ({ _id: id, code: `PM-0${id}`, name: id, role: 'employee', department: dept, company: 'primus' });
const tht = (id, dept) => ({ _id: id, code: `THT00${id}`, name: id, role: 'employee', department: dept, company: 'themtech' });

// ── the set of departments, assembled in one place ───────────────────────────

test('their own department is in the list without being stored', () => {
  assert.deepEqual(approvalDepartments(NARROW), [PROD]);
  assert.deepEqual(approvalDepartments(WIDE), [PROD, ADM]);
});

test('the home department comes first, whatever the stored list says', () => {
  // Not cosmetic: `ownClaims` maps this straight into the queue's claims, and
  // the reviewer's own team is the one that must not be second.
  const odd = { ...WIDE, approvesDepartments: [ENG, ADM] };
  assert.equal(approvalDepartments(odd)[0], PROD);
});

test('a stored list that repeats the home department does not duplicate it', () => {
  // The real path in: HR ticks ADM onto somebody in ผลิต, then later moves that
  // person's own แผนก to ADM. Undeduped this reaches `claimFilter` as two
  // identical $or clauses and the queue as the same row twice.
  const moved = { ...WIDE, department: ADM, approvesDepartments: [ADM] };
  assert.deepEqual(approvalDepartments(moved), [ADM]);
});

test('nothing is granted to somebody who is not a หัวหน้างาน', () => {
  // The list survives a demotion by design (same reading as approvesCompany),
  // so a reader that skipped the role check would hand a former หัวหน้า a queue.
  for (const role of ['employee', 'hr', 'admin']) {
    assert.deepEqual(approvalDepartments({ ...WIDE, role }), [], role);
  }
  assert.deepEqual(approvalDepartments(null), []);
});

test('an ObjectId-ish value and its string spell the same department', () => {
  // The session hands over a populated department and the pure rules are handed
  // a bare id — `idOf` is what makes those the same answer.
  const populated = { ...WIDE, department: { _id: PROD }, approvesDepartments: [{ _id: ADM }] };
  assert.deepEqual(approvalDepartments(populated), [PROD, ADM]);
});

// ── the rule every path decides from ─────────────────────────────────────────

test('a ticked department is signed for exactly as the home one is', () => {
  assert.equal(isDepartmentManager(WIDE, ADM, 'primus'), true);
  assert.equal(isDepartmentManager(WIDE, PROD, 'primus'), true);
});

test('an untouched roster behaves exactly as it did before the field existed', () => {
  // The safety property the whole change rests on: nobody's authority moves
  // until somebody ticks a box.
  assert.equal(isDepartmentManager(NARROW, PROD, 'primus'), true);
  assert.equal(isDepartmentManager(NARROW, ADM, 'primus'), false);
  assert.equal(isDepartmentManager(NARROW, ENG, 'primus'), false);
});

test('a department nobody ticked is still refused', () => {
  assert.equal(isDepartmentManager(WIDE, ENG, 'primus'), false);
  assert.equal(isDepartmentManager(WIDE, QC, 'primus'), false);
});

test('the company scope narrows every department, not only the home one', () => {
  // One scope for the signature, not one per team — see the field. A หัวหน้า who
  // signs only for เดมเทค signs only for เดมเทค wherever they sign.
  assert.equal(isDepartmentManager(WIDE_THT, ADM, 'themtech'), true);
  assert.equal(isDepartmentManager(WIDE_THT, ADM, 'primus'), false);
  assert.equal(isDepartmentManager(WIDE_THT, PROD, 'primus'), false);
});

/*
 * THE MISSING-COMPANY THROW IS NOT RE-TESTED HERE, deliberately.
 *
 * test/approverCompanyScope.test.js already pins it, and it pins it against
 * this same function — so widening the department half is covered by the tests
 * that were already there rather than by a second copy of them. Writing one
 * anyway would also have failed the guard in that file, which scans every
 * source for a call to it passing fewer than three arguments and cannot tell a
 * deliberate two-argument call from a forgotten one. That scan reads the file
 * as text, so it sees prose as readily as code — do not write the call out in a
 * comment here either.
 */

// ── the queue the reviewer is shown ──────────────────────────────────────────

test('the queue lists every department the approve route would accept', () => {
  // The failure this pairing exists to prevent: a row the server accepts but
  // the queue never showed, which is a button the reviewer cannot press.
  assert.deepEqual(ownClaims(WIDE), [
    { department: PROD, company: null },
    { department: ADM, company: null },
  ]);
  assert.deepEqual(scopeFor(WIDE), { department: { $in: [PROD, ADM] } });
});

test('one department is still the plain filter it always was', () => {
  // `$in` of one would work and would read as a change to every ordinary
  // หัวหน้า's query — `claimFilter` keeps the simple shape.
  assert.deepEqual(scopeFor(NARROW), { department: PROD });
});

test('a scoped signature narrows every claim by the roster of that payroll', () => {
  const rosters = new Map([['themtech', ['e1', 'e2']]]);
  assert.deepEqual(scopeFor(WIDE_THT, [], rosters), {
    $or: [
      { department: PROD, employee: { $in: ['e1', 'e2'] } },
      { department: ADM, employee: { $in: ['e1', 'e2'] } },
    ],
  });
});

test('a delegation still ADDS to the list rather than replacing it', () => {
  // The stand-in rule is unchanged and must stay unchanged: a borrowed claim is
  // extra reach, never a swap.
  const borrowed = [{ department: ENG, company: null }];
  assert.deepEqual(scopeFor(WIDE, borrowed), { department: { $in: [PROD, ADM, ENG] } });
});

test('ownClaim is still the one-department answer', () => {
  // Kept as the primitive it was. What matters is that it is no longer what
  // decides a queue — `scopeFor` reads `ownClaims`.
  assert.deepEqual(ownClaim(WIDE), { department: PROD, company: null });
});

test('nothing outside a manager role is widened by any of this', () => {
  assert.deepEqual(scopeFor({ ...WIDE, role: 'hr' }), {});
  assert.deepEqual(scopeFor({ ...WIDE, role: 'admin' }), {});
  assert.deepEqual(scopeFor({ ...WIDE, role: 'employee', _id: 'x' }), { employee: 'x' });
});

// ── who is left without a signature ──────────────────────────────────────────

test('a signer from another department closes the gap', () => {
  // ADM's own roster holds no หัวหน้า and never will under this arrangement, so
  // the pool has to come from outside it or the screen reports a gap that the
  // approve route does not agree exists.
  const admRoster = [pm('a1', ADM), pm('a2', ADM)];
  assert.equal(unsignedStaff(admRoster, ADM).length, 2, 'roster alone still sees nobody');
  assert.equal(unsignedStaff(admRoster, ADM, [WIDE]).length, 0);
});

test('a signer scoped to the other payroll closes only their half', () => {
  const roster = [pm('a1', ADM), tht('a2', ADM)];
  const left = unsignedStaff(roster, ADM, [WIDE_THT]);
  assert.deepEqual(left.map((p) => p._id), ['a1']);
});

test('passing no pool keeps the old reading exactly', () => {
  // The default is not laziness — it is the direction the failure runs. A caller
  // that forgets sees fewer signers and reports MORE gaps, which is a false
  // alarm rather than a silent all-clear over a team nobody can sign for.
  const roster = [NARROW, pm('p1', PROD)];
  assert.equal(unsignedStaff(roster, PROD).length, 0);
});

test('unticking a department is refused when it strands the people in it', () => {
  // The save the old loop could not even see: unticking ADM changes neither
  // `department` value, so nothing about the two rosters moved.
  const admRoster = [pm('a1', ADM)];
  const cover = signingCoveragePermission(
    admRoster, admRoster, ADM, { before: [WIDE], after: [NARROW] },
  );
  assert.equal(cover.ok, false);
  assert.match(cover.error, /PM-0a1/);
});

test('unticking is allowed when somebody else already covers that department', () => {
  const other = {
    _id: 'm2', code: 'PM-0100', name: 'วิชัย', role: 'manager',
    department: ENG, approvesCompany: null, approvesDepartments: [ADM],
  };
  const admRoster = [pm('a1', ADM)];
  const cover = signingCoveragePermission(
    admRoster, admRoster, ADM, { before: [WIDE, other], after: [NARROW, other] },
  );
  assert.equal(cover.ok, true);
});

test('a department that was already stranded does not block an unrelated save', () => {
  // ADM has been uncovered for as long as the roster has existed. NEWLY
  // stranded, not stranded — the rule this pairing has always drawn.
  const admRoster = [pm('a1', ADM)];
  const cover = signingCoveragePermission(
    admRoster, admRoster, ADM, { before: [NARROW], after: [NARROW] },
  );
  assert.equal(cover.ok, true);
});

// ── what the write routes accept ─────────────────────────────────────────────

test('the home department is stripped out of whatever the form sends', () => {
  // The picker ticks it because that is what the reader sees; storing it would
  // be the same fact twice, and the copy goes stale the day somebody moves.
  const r = approvalScope([PROD, ADM], PROD, [PROD, ADM, ENG]);
  assert.deepEqual(r, { ok: true, value: [ADM] });
});

test('duplicates collapse and blanks are dropped', () => {
  const r = approvalScope([ADM, ADM, '', null, ENG], PROD, [PROD, ADM, ENG]);
  assert.deepEqual(r.value, [ADM, ENG]);
});

test('not sent and cleared are two different answers', () => {
  // Same distinction approvesCompany draws, drawn the same way: `[]` is
  // "untick everything", which is a real edit and must not read as "not sent".
  assert.deepEqual(approvalScope(undefined, PROD, [PROD]), { ok: true, value: undefined });
  assert.deepEqual(approvalScope([], PROD, [PROD]), { ok: true, value: [] });
  assert.deepEqual(approvalScope(null, PROD, [PROD]), { ok: true, value: [] });
});

test('an id that is not a department is refused rather than stored', () => {
  // It would grant nothing, which is the safe direction — and it would also be
  // a tick somebody made that never does anything and never says why.
  const r = approvalScope([ADM], PROD, [PROD, ENG]);
  assert.equal(r.ok, false);
  assert.match(r.error, /ไม่ถูกต้อง/);
});

test('something that is not a list at all is refused', () => {
  assert.equal(approvalScope('PROD', PROD, [PROD]).ok, false);
  assert.equal(approvalScope(7, PROD, [PROD]).ok, false);
});

// ── the trail ────────────────────────────────────────────────────────────────

test('a change of who signs for whom is on the record', () => {
  assert.ok(AUDITED_FIELDS.includes('approvesDepartments'));
  const changes = rosterChanges(
    { approvesDepartments: [] }, { approvesDepartments: [ADM] },
  );
  assert.deepEqual(changes, [{ field: 'approvesDepartments', from: null, to: ADM }]);
});

test('reordering the same list is not a change', () => {
  // The order of a set is not a fact about anybody's authority, and a form that
  // hands back the same departments in a different order must not file a row
  // saying HR changed something.
  assert.equal(auditValue([ADM, ENG]), auditValue([ENG, ADM]));
  assert.deepEqual(rosterChanges({ approvesDepartments: [ADM, ENG] }, { approvesDepartments: [ENG, ADM] }), []);
});

test('an empty list reads as "not set", like every other empty value here', () => {
  assert.equal(auditValue([]), null);
});

// ── the screens read the same rule ───────────────────────────────────────────

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceOf = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('the roster list a หัวหน้า is shown covers every department they sign for', () => {
  // THE LIST AND THE BUTTONS HAVE TO AGREE. `proxyPermission` asks
  // `isDepartmentManager`, which now says yes for a ticked department — a picker
  // still narrowed to the home one would hide the exact people this reaches.
  const code = sourceOf('app/api/employees/route.js');
  assert.match(code, /filter\.department = \{ \$in: approvalDepartments\(user\) \}/);
});

test('no route narrows a manager to their own department alone any more', () => {
  // Six places asked "is this my department" and each of them was a screen a
  // ticked หัวหน้า would have been shut out of while the approve route let them
  // in: the queue, the ลูกทีม picker, both CSV exports, ตรวจสอบรายเดือน and
  // F-HR-027. `user.department` is now only where a person's OWN hours are
  // reported, which no route decides reach from.
  const offences = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/route\.js$/.test(name)) continue;
      const src = sourceOf(full.replace(`${ROOT}\\`, '').replace(`${ROOT}/`, ''));
      if (!/role === 'manager'/.test(src)) continue;
      if (/user\??\.department/.test(src)) {
        offences.push(full.replace(ROOT, '').replace(/\\/g, '/'));
      }
    }
  };
  walk(join(ROOT, 'app'));
  assert.deepEqual(offences, []);
});

test('the approvers list is queried wide enough to contain a ticked signer', () => {
  // A filter is not enough here: this one is a database read, and a หัวหน้า in
  // ผลิต covering สำนักงาน is not in the result set of a query asking for
  // สำนักงาน's members. The employee's own ที่ใบนี้ค้างอยู่ตรงไหน line would then
  // say nobody can sign a request the approve route accepts.
  const code = sourceOf('app/api/entries/approvers/route.js');
  assert.match(
    code,
    /\$or: \[\{ department: departmentId \}, \{ approvesDepartments: departmentId \}\]/,
  );
  assert.match(code, /select\('[^']*approvesDepartments'\)/);
});

test('the settings table names a หัวหน้า on every row they cover', () => {
  const code = sourceOf('components/AdminView.jsx');
  assert.match(code, /function headsOf\(people, department\)/);
  assert.match(code, /approvalDepartments\(p\)\.includes\(id\)/);
  // And says which of them are not from that department, so one name on three
  // rows does not read as the table repeating itself.
  assert.match(code, /const visiting = \(h\) => idOf\(h\.department\) !== String\(department\._id\)/);
  assert.match(code, /· จาก\{deptName\(h\.department\)\}/);
});

test('the picker never reports the home department back to the server', () => {
  const code = sourceOf('components/AdminView.jsx');
  assert.match(code, /function ApprovesDepartmentsField\(\{ home, value, onChange, depts, disabled \}\)/);
  // Ticked when painted…
  assert.match(code, /checked=\{locked \|\| extras\.includes\(id\)\}/);
  // …locked, and never sent.
  assert.match(code, /disabled=\{disabled \|\| locked\}/);
  assert.match(code, /if \(id === homeId\) return;/);
});

test('the summary line is drawn from the form, not from the saved row', () => {
  // A preview that arrives once the grant is made is a receipt.
  const code = sourceOf('components/AdminView.jsx');
  assert.match(code, /function ApprovalSummary\(\{ home, extras, company, depts \}\)/);
  assert.match(code, /home=\{form\.department\}/);
  assert.match(code, /extras=\{form\.approvesDepartments\}/);
  assert.match(code, /company=\{form\.approvesCompany\}/);
  assert.match(code, /ขอบเขตการอนุมัติ:/);
  assert.match(code, /อนุมัติใบ OT ให้พนักงานในแผนก/);
});
