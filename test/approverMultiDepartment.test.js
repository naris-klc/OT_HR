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
  _id: 'm1', code: 'PM-0101', name: 'ประเสริฐ', role: 'supervisor',
  department: PROD, approvesCompany: null, approvesDepartments: [ADM],
};
/** The same person before anybody ticked anything. */
const NARROW = {
  _id: 'm1', code: 'PM-0101', name: 'ประเสริฐ', role: 'supervisor',
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
    _id: 'm2', code: 'PM-0100', name: 'วิชัย', role: 'supervisor',
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

/** Line endings normalised — the repo is checked out CRLF on this machine, and
    a `\n` in an assertion would otherwise miss every multi-line rule while the
    stylesheet is perfectly correct. */
const styles = () => readFileSync(join(ROOT, 'app/styles.css'), 'utf8').replace(/\r\n/g, '\n');

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
      if (!/role === 'supervisor'/.test(src)) continue;
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

// ── one แผนก field that changes shape with บทบาท ─────────────────────────────

test('there is ONE แผนก field, and its shape follows บทบาท', () => {
  // Two facts, one control. `approvesDepartments` is read for role 'supervisor'
  // and nobody else, so a ticked list on any other row would grant nothing.
  const code = sourceOf('components/AdminView.jsx');
  assert.match(code, /function DepartmentField\(\{ role, department, extras, onChange, depts, disabled, allowBlank \}\)/);
  /* THE PLAIN BRANCH IS A `PickOne` SINCE 2026-09-04 and not a `<select>`, which
     is the same argument `DeptCombo` beside it already made: the list a
     `<select>` drops is drawn by the operating system and is not in this
     document. One แผนก field opening the app's own panel for a หัวหน้างาน and
     the OS's for everybody else — same label, same dialog, decided by บทบาท —
     is the disagreement this one field exists to prevent. */
  assert.match(code, /if \(!isSigner\(role\)\) \{[\s\S]*?<PickOne\s*\n\s*label="แผนก"\s*\n\s*tip=\{DEPT_TIP_STAFF\}/);
  assert.match(code, /<Field label="แผนก" tip=\{DEPT_TIP_MANAGER\}>[\s\S]*?<DeptCombo/);

  // The two-field arrangement is gone, label and all.
  assert.ok(!/HomeDeptField|ApprovesDeptsField/.test(code), 'แผนก is two fields again');
  assert.ok(!/แผนกสังกัดหลัก"|แผนกที่อนุมัติเพิ่ม"/.test(code), 'the split labels are back');
});

test('แผนก sits in ข้อมูลการทำงาน; ขอบเขตการอนุมัติ holds the scope and the badge', () => {
  const code = sourceOf('components/AdminView.jsx');
  /**
   * Checked in BOTH forms, and each slice ends at that form's own next heading.
   *
   * A slice from `>การทำงาน<` to `>สิทธิ์และสถานะ<` looks right and is not: the
   * create form's next heading is `สิทธิ์`, so the span ran from เพิ่มพนักงาน's
   * การทำงาน all the way into แก้ไข's and swept up two sections in between.
   */
  const headings = [...code.matchAll(/<div className="gh">([^<]+)<\/div>/g)];
  const works = headings.filter((h) => h[1] === 'การทำงาน');
  assert.equal(works.length, 2, 'expected a การทำงาน group in each of the two forms');

  for (const h of works) {
    const next = headings.find((x) => x.index > h.index);
    const work = code.slice(h.index, next.index);
    assert.match(work, /<DepartmentField/);
    assert.ok(!/<SignsForField|<ApprovalBadge/.test(work), 'an approval field is in การทำงาน');
  }

  // ขอบเขตการอนุมัติ appears only for a หัวหน้างาน and holds เซ็นให้บริษัท plus
  // the badge — the one place the whole grant is said out loud, since the two
  // halves of it now live in different groups.
  assert.match(code, /\{isSigner\(form\.role\) && \(\s*\n\s*<section className="form-group">\s*\n\s*<div className="gh">ขอบเขตการอนุมัติ<\/div>/);
  const scope = code.slice(code.indexOf('>ขอบเขตการอนุมัติ<'));
  const block = scope.slice(0, scope.indexOf('</section>'));
  assert.match(block, /<SignsForField/);
  assert.match(block, /<ApprovalBadge/);
  assert.ok(!/<DepartmentField/.test(block), 'แผนก is back in the approval group');

  // บทบาท stays ABOVE that group — it is the switch that makes the group
  // appear, so a หัวหน้างาน could never be appointed from inside it.
  assert.ok(
    code.indexOf('label="บทบาท"') < code.indexOf('>ขอบเขตการอนุมัติ<'),
    'บทบาท moved inside the group its own value controls',
  );

  assert.equal((code.match(/<ApprovalBadge/g) || []).length, 2, 'one per form, create and edit');
});

test('the chosen set is the home department plus the extras, and nothing else', () => {
  // The invariant the whole collapse rests on:
  //     ticked == [department, ...approvesDepartments]
  // Home FIRST, which is also what makes Backspace safe — the pill it removes
  // is always the most recently added and never the one that cannot go.
  const code = sourceOf('components/AdminView.jsx');
  assert.match(code, /const ticked = \[homeId, \.\.\.list\]\.filter\(Boolean\)/);
});

test('the home department is chosen, locked, and never reported back', () => {
  const code = sourceOf('components/AdminView.jsx');
  // No ✕ and no ⌂ on the home pill, and the toggle refuses it outright.
  assert.match(code, /if \(disabled \|\| id === homeId\) return;/);
  assert.match(code, /isHome\s*\n?\s*\? <span className="tag">สังกัดหลัก<\/span>/);
  // The row in the list says the same and cannot be actioned.
  assert.match(code, /aria-disabled=\{isHome \|\| undefined\}/);
});

test('the first pick on an empty form becomes สังกัดหลัก, not an extra', () => {
  // Otherwise the create form lets somebody build a หัวหน้า with no department,
  // which the server requires and would refuse after the form had allowed it.
  const code = sourceOf('components/AdminView.jsx');
  assert.match(code, /if \(!homeId\) onChange\(\{ department: id \}\);/);
});

test('สังกัดหลัก can still be moved, and moving it keeps the set the same size', () => {
  // With แผนก one field again, a locked home row and nothing else would mean a
  // หัวหน้า could never be moved between departments — their ceiling and their
  // report row stuck where they were hired. The old home becomes an extra
  // rather than dropping out: withdrawing a signature as a side effect of
  // moving a ceiling is two unrelated things done by one click.
  const code = sourceOf('components/AdminView.jsx');
  assert.match(code, /function makeHome\(id\) \{/);
  assert.match(
    code,
    /onChange\(\{ department: id, approvesDepartments: ticked\.filter\(\(x\) => x !== id\) \}\)/,
  );
  // Offered on the ROWS, where it can do something — and not on the chips,
  // whose ✕ is the frequent act and must not have a second button beside it.
  assert.match(code, /\{on && !isHome && !disabled && \(/);
  assert.match(code, /className="link set-home-row"/);
  assert.ok(!/className="set-home"/.test(code), 'the ⌂ is back on the chip');
  // The row toggles on click, so this must not fall through to it.
  assert.match(code, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); makeHome\(id\); \}\}/);
});

test('the same department can never be drawn as two chips', () => {
  // `makeHome` keeps the two apart and `approvalScope` strips it again on the
  // server — but a form's state can arrive from a row saved before either rule
  // existed, and `claimFilter` would build the same `$or` clause twice.
  const code = sourceOf('components/AdminView.jsx');
  assert.match(code, /const list = \(extras \|\| \[\]\)\.filter\(\(id\) => id !== homeId\)/);
});

test('the reveal-on-hover action is reachable by keyboard and on touch', () => {
  // :focus-within and the [data-active] clause are the halves that are easy to
  // leave out, without which the control is reachable and invisible.
  const css = styles();
  assert.match(css, /\.pick-menu\.dept-menu li \.set-home-row \{[\s\S]*?visibility: hidden;/);
  assert.match(css, /\.pick-menu\.dept-menu li:focus-within \.set-home-row,/);
  assert.match(css, /\.pick-menu\.dept-menu li\[data-active='1'\] \.set-home-row \{ visibility: visible; \}/);
  assert.match(css, /@media \(hover: none\) \{\s*\n\s*\.pick-menu\.dept-menu li \.set-home-row \{ visibility: visible; \}/);
});

// ── the combobox ─────────────────────────────────────────────────────────────

test('the roster decides whether there is a search box, not a developer', () => {
  // Five departments fit on screen without scrolling, and a field with a caret
  // in it says "type here" when the gesture is "pick one of these five" — a
  // click, a decision about what to type, then a click, instead of one click.
  // Over the threshold the same field is the only way to find anything, and
  // the note that used to sit here ("if the roster ever grows, put it back")
  // was a job nobody was assigned and nobody would notice was due.
  const code = sourceOf('components/AdminView.jsx');
  const css = styles();
  assert.match(code, /^const FILTER_FROM = 10;$/m);
  assert.match(code, /const searchable = depts\.length > FILTER_FROM;/);
  // Both halves are gated on it: the field, and the query that narrows the list.
  assert.match(code, /\{searchable \? \(\s*\n\s*<input/);
  assert.match(code, /const q = searchable \? query\.trim\(\)\.toLowerCase\(\) : '';/);
  // Name AND code, because WH and คลังสินค้า are the same department to two
  // different people.
  assert.match(code, /d\.nameTh \|\| d\.name \|\| ''\}\s*\$\{d\.code \|\| ''\}/);
  // The old combobox's own classes stay gone — this is not that control back.
  assert.ok(!/dept-combo-input/.test(code) && !/dept-combo-input/.test(css), 'the old search box is back');
  assert.ok(!/dept-combo-icon/.test(code) && !/dept-combo-icon/.test(css), 'the 🔍 is back');
  /**
   * IT READ `!/import Icon from/` UNTIL 2026-09-02, and while the 🔍 was the
   * only icon this file had ever imported, "no import" and "no magnifier" were
   * the same assertion. ลบแผนก brought a trash can, so they are not any more —
   * and banning the import would ban every future icon on this screen to keep
   * one that was removed from coming back.
   *
   * What is actually being protected is that the DEPARTMENT PICKER draws no
   * icon, which is what the two lines above and this one now say between them.
   */
  const combo = code.slice(code.indexOf('function DeptCombo('), code.indexOf('function ApprovalBadge('));
  assert.ok(combo.length > 0, 'DeptCombo changed shape');
  assert.ok(!/<Icon/.test(combo), 'an icon is back inside the department picker');
});

test('the field is not dressed as a field, because it sits inside one', () => {
  // `.dept-find` is inside a `.field`, so `.field input` would draw it as a form
  // field INSIDE a form field: 46px tall, its own border, radius and fill, mono
  // at 15px. Every property that rule sets is unset here, one by one — naming
  // only the ones that looked wrong is how the next one gets through.
  const css = styles();
  const rule = css.slice(css.indexOf('.dept-combo .dept-find {'), css.indexOf('}', css.indexOf('.dept-combo .dept-find {')));
  for (const prop of ['border:', 'border-radius:', 'background:', 'min-height:', 'padding:', 'font:', 'color:', 'width:']) {
    assert.ok(rule.includes(prop), '.field input sets ' + prop + ' and .dept-find does not unset it');
  }
  // Two classes to that rule's one class and one element, so it wins wherever
  // the two are written.
  assert.match(css, /\.dept-combo \.dept-find \{/);
});

test('below the threshold the keyboard still types, the way a <select> does', () => {
  // No field, no filtering, no state — ค jumps to คลังสินค้า, and somebody
  // typing at a dropdown out of habit is not doing it by accident.
  const code = sourceOf('components/AdminView.jsx');
  assert.match(code, /if \(!searchable && e\.key\.length === 1 && !e\.ctrlKey/);
  // The buffer holds briefly, so คว reaches ควบคุมคุณภาพ rather than starting
  // over on every keystroke.
  assert.match(code, /now - typed\.current\.at < 900/);
  assert.match(code, /startsWith\(buf\)/);
});

test('the shell is the control: click to open, chips inside, caret at the end', () => {
  const code = sourceOf('components/AdminView.jsx');
  assert.match(code, /function DeptCombo\(\{ home, extras, onChange, depts, disabled \}\)/);
  // A div and not a <button>: the chips inside carry buttons of their own, and
  // a button inside a button is markup a browser resolves by dropping one.
  assert.match(code, /role=\{searchable \? undefined : 'combobox'\}/);
  assert.match(code, /tabIndex=\{searchable \|\| disabled \? -1 : 0\}/);
  assert.match(code, /aria-haspopup=\{searchable \? undefined : 'listbox'\}/);
  assert.match(code, /aria-multiselectable="true"/);
  // ONE combobox on screen, one in the tree: when the field exists it takes the
  // role and the tab stop, and the div gives both up. A combobox owning a
  // combobox is two controls to a screen reader where there is one to look at.
  const inputAt = code.indexOf('className="dept-find"');
  const input = code.slice(inputAt, code.indexOf('/>', inputAt));
  assert.match(input, /role="combobox"/);
  assert.match(input, /aria-expanded=\{open\}/);
  assert.match(input, /aria-autocomplete="list"/);
  // A click on the field must not shut the list somebody opened to type into.
  assert.match(code, /else if \(e\.target !== inputRef\.current\) close\(\);/);
  assert.match(code, /<span className="caret" aria-hidden="true">▾<\/span>/);
  // Short enough to sit beside the สังกัดหลัก chip in a 282px column without
  // being cut: at the field's own 15px the old wording no longer fitted, and a
  // hint truncated to "เลือกแผนกเพ…" is worse than a shorter hint.
  // The prompt shows only while nothing has been ADDED — the home chip is
  // always there when a department is set, so an empty-LOOKING box is not the
  // same as a box with nothing chosen.
  assert.match(code, /!list\.length && <span className="ph">เพิ่มแผนก…<\/span>/);
});

test('the list is every department, each with a tick-box', () => {
  // The box is drawn rather than an <input>: the row is already role="option"
  // with aria-selected, and a real checkbox would announce the same state again
  // in a second vocabulary.
  const code = sourceOf('components/AdminView.jsx');
  // `shown`, not `depts` — and EVERYTHING indexes from it. Counting rows
  // from one list and reading them from the other is how ↓ walks past the end
  // of a filtered list, or Enter ticks the row above the one being looked at.
  assert.match(code, /\{shown\.map\(\(d, i\) => \{/);
  assert.ok(!/depts\[at\]/.test(code), 'the keyboard is indexing the unfiltered list');
  // Two different facts, older one first: an empty roster is not a search that
  // found nothing.
  assert.match(code, /\{depts\.length \? 'ไม่พบแผนกที่ค้นหา' : 'ยังไม่มีแผนกในระบบ'\}/);
  assert.match(code, /<span className=\{`tick\$\{on \? ' on' : ''\}`\} aria-hidden="true">/);
  assert.match(code, /role="option"/);
  assert.match(code, /aria-selected=\{on\}/);

  const css = styles();
  // Always drawn, so a name does not shift sideways the moment it is picked.
  // 16px, a shade under the app's real checkboxes (17, and 18 on the queue's
  // phone bar): those sit beside 15px labels in 46px rows and this one beside
  // a 14px name in a row of 32. The tick is sized off the box, not off the
  // text — 10.5 in an inside of 13 after the two 1.5px borders.
  assert.match(css, /\.pick-menu\.dept-menu li \.tick \{\s*\n\s*flex: none; width: 16px; height: 16px;[\s\S]*?border: 1\.5px solid var\(--input-line\)[\s\S]*?font-size: 10\.5px;/);
  assert.match(css, /\.pick-menu\.dept-menu li \.tick\.on \{[\s\S]*?background: var\(--green\)/);

  // IT IS NOT CALLED `box` ANY MORE, and that is the fix rather than a
  // tidy-up. `.box` is this app's alert panel — padding 13px 15px, margin
  // 12px 0 — and the rule above never named either property, so both applied.
  // With box-sizing: border-box a 16px width cannot hold 30px of padding: the
  // element floors at its padding and drew ~33 × 29 with 24px of margin under
  // every row. Three rounds of shrinking `width` could not touch it.
  assert.match(code, /<span className=\{`tick\$\{on \? ' on' : ''\}`\} aria-hidden="true">/);
  assert.ok(!/className=\{`box\$/.test(code), 'the tick-box is a .box again');
  // The alert panel is still what it was; nothing here changed it.
  assert.match(css, /^\.box \{\s*\n\s*padding: 13px 15px;[\s\S]*?margin: 12px 0;/m);
  // 17px, the same as every other tick-box in the app.
  assert.match(css, /width: 17px; height: 17px;/);
});

test('the keyboard drives it: ↑↓ wrap, Enter and Space toggle, Escape and Tab close', () => {
  const code = sourceOf('components/AdminView.jsx');
  const start = code.indexOf('function onKeyDown(e) {');
  const body = code.slice(start, code.indexOf('return (', start));
  assert.ok(start > 0, 'DeptCombo lost its key handler');

  assert.match(body, /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/);
  // Wraps rather than stopping at the ends.
  assert.match(body, /\+ step \+ shown\.length\) % shown\.length/);
  // Space as well as Enter, because the shell is a div — and both prevented, so
  // Enter cannot submit the dialog and Space cannot scroll the body under it.
  // WITH THE FIELD ON SCREEN, Space is a keystroke: it has to reach the input
  // or a department cannot be searched for by two words.
  assert.match(body, /if \(e\.key === 'Enter' \|\| \(e\.key === ' ' && !searchable\)\) \{\s*\n\s*e\.preventDefault\(\)/);
  assert.match(body, /if \(open && shown\[at\]\) toggle\(String\(shown\[at\]\._id\)\)/);
  // Escape stops propagating ONLY because it did something — the dialog behind
  // this still has to close on the second press.
  assert.match(body, /if \(e\.key === 'Escape' && open\) \{\s*\n[\s\S]*?e\.stopPropagation\(\)/);
  // …and it clears a query before it closes anything: somebody looking at three
  // of twelve departments wants the other nine back, not the dialog gone.
  assert.match(body, /if \(query\) \{ setQuery\(''\); setActive\(0\); return; \}/);
  assert.match(body, /if \(e\.key === 'Tab' && open\) close\(\)/);
  // Backspace drops the last removable chip — but NOT while there is a query to
  // correct, or a typo silently removes a department somebody granted.
  assert.match(body, /e\.key === 'Backspace' && list\.length && !query/);
});

test('focus moving onto a chip\'s ✕ does not close the list', () => {
  // The ✕ lives INSIDE the shell, so focusing it is a focusout that bubbles —
  // a naive onBlur would shut the menu every time somebody tabbed to a chip.
  const code = sourceOf('components/AdminView.jsx');
  assert.match(
    code,
    /onBlur=\{\(e\) => \{ if \(!e\.currentTarget\.contains\(e\.relatedTarget\)\) close\(\); \}\}/,
  );
  // And a click on the ✕ must not also toggle the menu on its way out.
  assert.match(code, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); toggle\(id\); \}\}/);
});

test('the pointer and the keyboard agree on which row is current', () => {
  const code = sourceOf('components/AdminView.jsx');
  // The row under the cursor is the row Enter takes.
  assert.match(code, /onMouseMove=\{\(\) => setActive\(i\)\}/);
  // …and the keyboard's row is scrolled into view, `nearest` so a resting mouse
  // is not fought with.
  assert.match(code, /scrollIntoView\(\{ block: 'nearest' \}\)/);
  // Without this the pointer's own focus change unmounts the list before the
  // click can land on it.
  assert.match(code, /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
});

test('this list beats the shared block it is built on, by specificity', () => {
  // THE BUG THIS EXISTS FOR. The element carries both classes, and the shared
  // `.pick-menu` block is written FURTHER DOWN this file than the `.dept-menu`
  // one. One class each is equal specificity, and at equal specificity the
  // later rule wins — so every property both blocks named was decided by the
  // shared one: a 160px cap served 264, z-index 50 served 5, 32px rows served
  // 40, sans served mono, and the --green-bg slab back on the pointer's row.
  //
  // None of that was visible in the built CSS either. The declarations were
  // all present in the bundle, losing — which is why "I grepped .next and the
  // rule is there" is not a check that a rule RUNS.
  const css = styles();
  const shared = css.indexOf('.pick-menu {');
  const own = css.indexOf('.pick-menu.dept-menu {');
  assert.ok(shared > own, 'the shared block moved above this one — the double class is now the only thing holding this together, which is the point of it');

  // Every selector in the block names both classes. A bare `.dept-menu` rule is
  // one that may or may not run depending on what is written below it.
  const block = css.slice(own, css.indexOf('/* ── 📌 ขอบเขตการอนุมัติ', own));
  const bare = block.split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => /^\s*\.dept-menu\b/.test(l));
  assert.deepEqual(bare, [], 'these lose to .pick-menu below them:\n  ' + bare.join('\n  '));

  // The four the shared block was actually overriding, spelled out.
  assert.match(css, /\.pick-menu\.dept-menu \{[\s\S]*?z-index: 50;[\s\S]*?max-height: 160px;/);
  assert.match(css, /\.pick-menu\.dept-menu li \{[\s\S]*?min-height: 32px;[\s\S]*?font: 500 14px\/1\.4 var\(--sans\);/);
  assert.match(css, /\.pick-menu\.dept-menu li\[data-active='1'\] \{[\s\S]*?background: var\(--neutral-wash\);/);
  // …and a thumb still gets a 44px row — from a block written BELOW the 32px
  // rule, because those two ARE the same specificity and a floor above the
  // rule it is meant to raise does nothing. Same mistake, one section down.
  const compactAt = css.search(/\.pick-menu\.dept-menu li \{\s*\n/);
  const floorAt = css.indexOf('.pick-menu.dept-menu li { min-height: 44px; }');
  assert.ok(floorAt > 0, 'the phone floor is gone');
  assert.ok(floorAt > compactAt, 'the phone floor sits above the rule it raises, so it does nothing');
});

test('the popover floats over the content below it and scrolls', () => {
  const css = styles();
  // Out of the flow, so it has never pushed a field down — that much comes from
  // `.pick-menu`, which ค้นหาพนักงาน shares and which keeps its low z-index
  // because it sits on an ordinary page under the app bar.
  assert.match(css, /\.pick-menu \{\s*\n\s*position: absolute; top: calc\(100% \+ 4px\); left: 0; right: 0; z-index: 5;/);
  assert.match(css, /overflow-y: auto; overscroll-behavior: contain;/);
  // TWO SHADOWS SINCE 2026-08-27, and the lift is the second of them. It read
  // `box-shadow: 0 14px 34px var(--shadow-soft);` alone until the ค้นหา panel on
  // ตรวจสอบรายเดือน was reported as swallowing the export buttons under it: 34px
  // of blur says "floating" and says nothing about where the panel STOPS, so the
  // half-covered button at its bottom edge did not look covered. The tight one
  // is pulled in 2px so it cannot leak out at the sides of a panel that is the
  // full width of its field.
  assert.match(css, /box-shadow: 0 2px 8px -2px var\(--shadow-soft\), 0 14px 34px var\(--shadow-soft\);/);
  // AND THE TONE IS STILL `--shadow-soft` ON BOTH. `.dept-menu` spent a round on
  // `--shadow-1` — black at half opacity on the dark side — and it "lifted the
  // panel but put a dark band across the field underneath it". Tighter geometry,
  // same tone; more blackness on a dark page is weather, not depth.
  //
  // SLICED TO THIS RULE, AND STRIPPED OF COMMENTS BEFORE IT IS READ. Two ways
  // to get this negative assertion wrong, and this test made both. A lazy
  // `[\s\S]*?` from the selector runs on past the closing brace until it finds
  // a match SOMEWHERE — `.modal` is `0 26px 60px var(--shadow-1)` and is
  // correct — so it reported the dialog's shadow as this panel's. And the rule
  // now carries a comment that NAMES `--shadow-1` to say it was rejected, so
  // the slice caught its own explanation. That is the seventh time in this
  // project a test has matched the prose written to justify it.
  const shared = css.slice(css.indexOf('.pick-menu {'));
  const body = shared.slice(0, shared.indexOf('}')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/--shadow-1/.test(body),
    'the shared panel went back to --shadow-1, which was measured and rejected');
});

test('the panel is a surface of its own, not the card it opens over', () => {
  // WHAT A DARK THEME SEPARATES WITH IS LIGHT. This panel opens inside a `.card`
  // on two screens, and while it was `--card` itself the two fills were the same
  // colour and no shadow on a near-black page could be seen between them — so it
  // read as the card growing downwards rather than as a list opening over it.
  const css = styles();
  assert.match(css, /\.pick-menu \{[\s\S]*?background: var\(--card-lift\);/);
  assert.match(css, /\.pick-menu \{[\s\S]*?border: 1px solid var\(--line-lift\);/);
  // The token is the pair, and the asymmetry is the point: the same white on the
  // light theme, where a shadow does the separating and a greyer panel would
  // read as disabled rather than as nearer; one step UP on the dark, where a
  // shadow cannot be seen at all.
  assert.match(css, /--card-lift: light-dark\(#ffffff, #273029\);/);
  assert.match(css, /--card-lift: #ffffff;/, 'the plain light fallback is gone');
});

test('inside the dialog it is lifted, spaced and shadowed like a real layer', () => {
  // What this answers was never that the list moved the layout — it is absolute
  // and never did. It was that it covered the fields under it without ever
  // looking like it was ABOVE them.
  const css = styles();
  const menu = css.slice(css.indexOf('.pick-menu.dept-menu {'));
  const rule = menu.slice(0, menu.indexOf('}'));
  // The 4px gap restated as a margin, with the shared `calc` reset — or the two
  // 4s add up and the panel floats away from the box it belongs to.
  assert.match(rule, /top: 100%; margin-top: 4px;/);
  // Over everything in `.modal-body`, which clips its own children, so this
  // cannot reach the app bar (20) that the shared 5 exists to stay under.
  assert.match(rule, /z-index: 50;/);
  assert.match(css, /\.pick-menu \{[\s\S]*?z-index: 5;/, 'the shared z-index was raised too');
  // The part that was actually missing. A token and not a literal rgba —
  // test/theme.test.js fails the build on a raw colour in a rule.
  assert.match(rule, /box-shadow: 0 8px 20px -6px var\(--shadow-soft\);/);
});

test('this list is capped shorter than the shared one, so it clears บันทึก', () => {
  // It opens inside a dialog whose save button sits a short way below it. The
  // cap is SCOPED — ค้นหาพนักงาน is not in a dialog and keeps its 264.
  const css = styles();
  assert.match(css, /\.pick-menu\.dept-menu \{[\s\S]*?max-height: 160px; overflow-y: auto;/);
  assert.match(css, /\.pick-menu\.dept-menu \{ max-height: min\(160px, 44vh\); \}/);
  assert.match(css, /\.pick-menu \{[\s\S]*?max-height: 264px;/, 'the shared cap was changed too');
});

test('the chips wrap inside the shell, and the shell never scrolls', () => {
  // A box that scrolls its own contents hides the very thing it exists to show.
  const css = styles();
  assert.match(css, /display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px;/);
  // …and it stands as tall as the บริษัท and บทบาท selects beside it in the
  // same grid, is inset by the same amount, and sets its text at the same
  // size — because all three are read from the tokens those selects use, not
  // copied across. They had already drifted once: 42 against 46, 10 against 14.
  // (The field selector carries a `:not()` pair since 2026-08-31 — a checkbox
  // is an `input`, and this rule had been sizing every tick box in a `.field`
  // to `--field-h`. It changes what the rule reaches, not what it declares.
  // `.field .pick-one` joined the list on 2026-09-01 for the same reason the
  // shell reads these tokens: `PickOne` is a button standing where a `<select>`
  // stood, and a control a pixel off the box beside it reads as a different
  // kind of thing. Another selector in the list, not another declaration.)
  assert.match(css, /\.dept-combo \{[\s\S]*?min-height: var\(--field-h\);/);
  assert.match(css, /\.field input:not\(:where\(\[type='checkbox'\], \[type='radio'\]\)\),\s*\n\.field select, \.field textarea, \.field \.pick-one, \.field \.pick-box,\s*\n\.policy-row select \{[\s\S]*?min-height: var\(--field-h\);\s*\n\s*padding: var\(--field-pad-y\) var\(--field-pad-x\);[\s\S]*?font: 500 var\(--field-size\)\/1\.3 var\(--mono\);/);
  // The vertical padding is DERIVED here rather than reused: these fields pad a
  // 19.5px line of text and the shell pads a 30px chip, so the same number
  // gives two different boxes. What matches is the sum — half of what is left
  // of --field-h once the chip and the two borders are taken off.
  assert.match(css, /\.dept-pill \{[\s\S]*?min-height: var\(--chip-h\);/);
  assert.match(css, /\.dept-combo \.ph \{[\s\S]*?font: 400 var\(--field-size\)\/1\.3 var\(--sans\);/);
  // The radius was the one they already shared; it stays shared.
  const shellRule = css.slice(css.indexOf('.dept-combo {'), css.indexOf('}', css.indexOf('.dept-combo {')));
  assert.match(shellRule, /border-radius: var\(--radius-sm\);/);
  assert.match(css, /\.field input:not\(:where\(\[type='checkbox'\], \[type='radio'\]\)\),\s*\n\.field select, \.field textarea, \.field \.pick-one, \.field \.pick-box,\s*\n\.policy-row select \{[\s\S]*?border-radius: var\(--radius-sm\);/);
  const shell = css.slice(css.indexOf('.dept-combo {'));
  assert.ok(!/overflow/.test(shell.slice(0, shell.indexOf('}'))), 'the chip shell scrolls');
});

test('a row lights up under the pointer, and the keyboard row still wins', () => {
  // `onMouseMove` moves `data-active` as the mouse travels, but cannot mark the
  // row the pointer is ALREADY on when the panel opens under it.
  const css = styles();
  assert.match(css, /\.pick-menu\.dept-menu li:hover \{ background: var\(--neutral-wash\); \}/);
  // BOTH MARKS ARE THE THEME'S GREY, and what tells them apart is a 2px rail
  // rather than a second fill: a `--green-bg` slab was the one patch of colour
  // in the dialog and read as a stain on the dark theme.
  assert.match(css, /\.pick-menu\.dept-menu li\[data-active='1'\] \{\s*\n\s*background: var\(--neutral-wash\); color: var\(--ink\);\s*\n\s*box-shadow: inset 2px 0 0 var\(--green-accent\);/);
  // Re-stated AFTER the hover rule: `.pick-menu li[data-active]` is defined
  // earlier in the file and would otherwise lose the tie.
  const hoverAt = css.indexOf('.pick-menu.dept-menu li:hover {');
  const activeAt = css.indexOf(".pick-menu.dept-menu li[data-active='1'] {");
  assert.ok(activeAt > hoverAt, 'a hovered row greys out the row Enter would take');
  // The home row answers no click and must not light up like the rows that do.
  assert.match(css, /\.pick-menu\.dept-menu li\.home:hover \{ background: transparent; \}/);
});

test('the three parts of a row line up as columns', () => {
  const css = styles();
  // Compact, and inset by the FIELD'S OWN padding token, so a name in the
  // panel starts on the vertical line the text in the closed box does.
  assert.match(css, /\.pick-menu\.dept-menu li \{\s*\n\s*gap: 8px; padding: 6px var\(--field-pad-x\); min-height: 32px;/);
  // The four parts sit on one centre line — the tick-box, the name, the
  // สังกัดหลัก badge and the code are 16, 19.6, 16.8 and 17.25px tall.
  // The multi-line rule, not the one-liner in the phone block above it.
  const rowAt = css.search(/\.pick-menu\.dept-menu li \{\s*\n/);
  const rowRule = css.slice(rowAt, css.indexOf('}', rowAt));
  assert.match(rowRule, /align-items: center;/);
  // The phone block still takes rows back over the 44px touch floor.
  assert.match(css, /\.pick-menu li \{ min-height: 44px; \}/);
  // The name takes the free space, which is what pushes the code right.
  assert.match(css, /\.pick-menu\.dept-menu li \.nm \{ flex: 1;/);
  // And the code is a real column rather than a ragged right edge.
  assert.match(css, /\.pick-menu\.dept-menu li \.cd \{\s*\n\s*flex: none; min-width: 4ch; text-align: right;/);
  assert.match(css, /color: var\(--muted-2\);/);

  // LAST in the row on every row — it used to sit before the สังกัดหลัก tag, so
  // the home row put its code a tag's width in from the right.
  const code = sourceOf('components/AdminView.jsx');
  const row = code.slice(code.indexOf('<span className={`tick'), code.indexOf('</li>'));
  assert.ok(
    row.indexOf('className="tag"') < row.indexOf('className="cd"'),
    'the code is no longer the last thing in the row',
  );
});

test('the focus ring is on the shell, and survives focus moving to a chip', () => {
  // `:focus` for the shell itself, `:focus-within` because the chips inside
  // carry buttons and the ring must not vanish when one of them takes focus.
  const css = styles();
  assert.match(css, /\.dept-combo\.open,\s*\n\.dept-combo:focus,\s*\n\.dept-combo:focus-within \{/);
  assert.match(css, /border-color: var\(--green\); box-shadow: 0 0 0 3px var\(--focus-ring\);/);
  // The browser's own outline is replaced, not merely added to.
  assert.match(css, /outline: none;/);
});

test('the caret says the shell opens, and turns when it has', () => {
  const css = styles();
  // PINNED TO THE SHELL, not floated to the end of the last row of chips.
  // `margin-left: auto` put it at the right end of the box only while the chips
  // fitted on one line; with the box nearly full the arrow was the item that
  // wrapped, and it came to rest in the bottom-right corner under the hint.
  assert.match(css, /\.dept-combo \{[\s\S]*?position: relative;/);
  assert.match(css, /\.dept-combo \.caret \{\s*\n\s*position: absolute; right: var\(--field-pad-x\); top: 50%;\s*\n\s*transform: translateY\(-50%\);/);
  const caretAt = css.indexOf('.dept-combo .caret {');
  const caretRule = css.slice(caretAt, css.indexOf('}', caretAt));
  assert.doesNotMatch(caretRule, /margin-left: auto;/);
  // Room reserved for it on the right, so nothing flows underneath.
  assert.match(css, /\.dept-combo \{[\s\S]*?padding:\s*\n\s*calc\(\(var\(--field-h\) - var\(--chip-h\) - 2px\) \/ 2\)\s*\n\s*calc\(var\(--field-pad-x\) \+ 16px\)/);
  // And the hint can give way: Thai does not break on spaces, so without a
  // `min-width: 0` it cannot shrink below the whole string and pushes what
  // follows it onto the next line.
  assert.match(css, /\.dept-combo \.ph \{\s*\n\s*min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
  // Half the centring, repeated — `transform` is one property, and a bare
  // rotate here would drop the offset and jump the arrow as it turns.
  assert.match(css, /\.dept-combo\.open \.caret \{ transform: translateY\(-50%\) rotate\(180deg\)/);
  // The app honours a reduced-motion preference everywhere else too.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.dept-combo \.caret \{ transition: none; \}/);
});

test('the home chip is filled, tagged, and has no ✕', () => {
  const css = styles();
  assert.match(css, /\.dept-pill\.home \{[\s\S]*?background: var\(--green-bg\)/);
  const code = sourceOf('components/AdminView.jsx');
  // Tag on the home branch, ✕ on the other — and the ✕ names what it removes,
  // since a row of identical glyphs says nothing on its own.
  assert.match(code, /isHome\s*\n?\s*\? <span className="tag">สังกัดหลัก<\/span>/);
  assert.match(code, /aria-label=\{`เอา \$\{nameOf\(id\)\} ออก`\}/);
  // It is still SHOWN though — the box answers "whose OT can this person sign",
  // and the answer starts with their own team.
  assert.match(code, /const ticked = \[homeId, \.\.\.list\]\.filter\(Boolean\)/);
});

test('the form groups got their breathing room', () => {
  const css = styles();
  assert.match(css, /\.form-group \+ \.form-group \{\s*\n\s*margin-top: 22px; padding-top: 22px;/);
  // The heading sits nearer its own fields than the rule above it.
  assert.match(css, /color: var\(--muted-2\); margin-bottom: 14px;/);
  // Rows a touch further apart than columns: a pair side by side is one
  // thought, two rows are two.
  assert.match(css, /\.form-grid \{[\s\S]*?gap: 18px 16px;/);
});

test('the phone gets a 48px shell and chips with room between their ✕', () => {
  // The whole shell is one target now, and it is the primary gesture of the
  // control rather than the frame around a text field.
  const css = styles();
  assert.match(css, /\.dept-combo \{\s*\n\s*gap: 8px; min-height: 48px;\s*\n\s*padding: 9px calc\(var\(--field-pad-x\) \+ 16px\) 9px var\(--field-pad-x\);/);
  assert.match(css, /\.dept-pill \{ min-height: 36px; font-size: 14px; \}/);
  assert.match(css, /\.dept-pill button \{ width: 28px; height: 28px; \}/);
});

test('the badge is drawn from the form and says both halves of the grant', () => {
  // A preview that arrives once the grant is made is a receipt. And neither box
  // says what the PAIR comes to — the join is where the mistake lives.
  const code = sourceOf('components/AdminView.jsx');
  assert.match(code, /function ApprovalBadge\(\{ role, department, extras, company, depts \}\)/);
  assert.match(code, /if \(!isSigner\(role\)\) return null;/);
  assert.match(code, /department=\{form\.department\}/);
  assert.match(code, /extras=\{form\.approvesDepartments\}/);
  assert.match(code, /company=\{form\.approvesCompany\}/);
  assert.match(code, /คุมอนุมัติ \{names\.length\} แผนก:/);
  assert.match(code, /เซ็นให้พนักงานสังกัด <b>\{where\}<\/b>/);
});
