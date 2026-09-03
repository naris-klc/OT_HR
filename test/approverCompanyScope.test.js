import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  claimFilter, entryCompany, isDepartmentManager, ownClaim, scopeFor, signsForCompany,
} from '../lib/entries.js';
import {
  approvalPermission, delegatedClaims, delegatedDepartments, departmentClaim,
} from '../lib/delegation.js';
import { initialStatus, proxyPermission } from '../lib/proxyFiling.js';
import { withdrawDecisionPermission } from '../lib/withdrawal.js';
import { signingScope } from '../lib/employees.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * เซ็นให้บริษัท — one แผนก, two หัวหน้า, split by payroll.
 *
 * The arrangement this exists for: PROD holds people paid by ไพรมัส and people
 * paid by เดมเทค, they sit in the same room, the department must stay ONE row so
 * that its ceiling and its สรุป OT แยกแผนก line stay one number — and each
 * หัวหน้า signs only for their own company's people.
 *
 * Three things are pinned here, and the second is the one that will matter in
 * six months:
 *
 *   1. unset means ทุกบริษัท, so a roster nobody has touched behaves exactly as
 *      it did before the field existed;
 *   2. a stand-in exercises the GIVER's scope, not their own — otherwise the
 *      cover a หัวหน้า arranges before going on leave silently covers nothing;
 *   3. the queue and the อนุมัติ button read the same claims, so a row can never
 *      be listed for somebody the server will then refuse.
 */

const PROD = 'dept-prod';
const QC = 'dept-qc';

// ── the two หัวหน้า of one department ───────────────────────────────────────
const BOTH = { _id: 'mgr-both', name: 'หัวหน้ารวม', role: 'supervisor', department: PROD };
const PM_ONLY = {
  _id: 'mgr-pm', name: 'หัวหน้าไพรมัส', role: 'supervisor', department: PROD, approvesCompany: 'primus',
};
const THT_ONLY = {
  _id: 'mgr-tht', name: 'หัวหน้าเดมเทค', role: 'supervisor', department: PROD, approvesCompany: 'themtech',
};
const OTHER_DEPT = {
  _id: 'mgr-qc', name: 'หัวหน้า QC', role: 'supervisor', department: QC, approvesCompany: 'primus',
};
const HR = { _id: 'hr-1', name: 'ฝ่ายบุคคล', role: 'hr' };

// ── and the people in it ────────────────────────────────────────────────────
const PM_WORKER = {
  _id: 'emp-pm', code: 'PM-0620', name: 'พนักงานไพรมัส', role: 'employee',
  department: PROD, company: 'primus', active: true,
};
const THT_WORKER = {
  _id: 'emp-tht', code: 'THT0056', name: 'พนักงานเดมเทค', role: 'employee',
  department: PROD, company: 'themtech', active: true,
};

const entryFor = (employee, over = {}) => ({
  _id: `entry-${employee._id}`,
  status: 'pending_mgr',
  department: PROD,
  employee,
  ...over,
});

// ── ทุกบริษัท is the default, and it is the old behaviour ────────────────────

test('a หัวหน้า nobody has scoped signs for both payrolls, exactly as before', () => {
  assert.equal(signsForCompany(BOTH, 'primus'), true);
  assert.equal(signsForCompany(BOTH, 'themtech'), true);
  assert.equal(isDepartmentManager(BOTH, PROD, 'primus'), true);
  assert.equal(isDepartmentManager(BOTH, PROD, 'themtech'), true);
});

test('an explicit null reads the same as never having been set', () => {
  // What `signingScope('')` stores, and what the model defaults to: one state,
  // not two that look alike.
  assert.equal(signsForCompany({ ...BOTH, approvesCompany: null }, 'themtech'), true);
  assert.deepEqual(signingScope(''), { ok: true, value: null });
  assert.deepEqual(signingScope(null), { ok: true, value: null });
  assert.deepEqual(signingScope(undefined), { ok: true, value: null });
  assert.deepEqual(signingScope('themtech'), { ok: true, value: 'themtech' });
  assert.equal(signingScope('เดมเทค').ok, false, 'a label is not a key');
  assert.equal(signingScope('primus ').ok, false, 'and neither is a key with a space');
});

// ── scoped: one department, two signatures ──────────────────────────────────

test('a scoped หัวหน้า signs for their own payroll and is refused the other', () => {
  assert.equal(isDepartmentManager(PM_ONLY, PROD, 'primus'), true);
  assert.equal(isDepartmentManager(PM_ONLY, PROD, 'themtech'), false);
  assert.equal(isDepartmentManager(THT_ONLY, PROD, 'themtech'), true);
  assert.equal(isDepartmentManager(THT_ONLY, PROD, 'primus'), false);
});

test('the department rule still comes first — a scope is a narrowing, not a widening', () => {
  // OTHER_DEPT signs for ไพรมัส, and PROD is not their department. A scope must
  // never be readable as "and also anybody of that company anywhere".
  assert.equal(isDepartmentManager(OTHER_DEPT, PROD, 'primus'), false);
});

test('the company is required, and a caller who forgets is told rather than obeyed', () => {
  /**
   * The whole guarantee of the field. An optional argument would let a path
   * added next year ask half the question and be handed the widest possible
   * answer — a scoped หัวหน้า approving the other payroll, with nothing on any
   * screen showing that it happened.
   */
  assert.throws(() => isDepartmentManager(PM_ONLY, PROD), /ต้องระบุบริษัท/);
  assert.throws(() => isDepartmentManager(PM_ONLY, PROD, null), /ต้องระบุบริษัท/);
  assert.throws(() => isDepartmentManager(PM_ONLY, PROD, ''), /ต้องระบุบริษัท/);
});

test('every call site in the app passes all three arguments', () => {
  /**
   * The runtime throw catches this the moment the path runs. This catches it
   * before anybody has to run it — the point being that one of these call sites
   * is a button somebody presses on a Friday afternoon.
   */
  const offences = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.next', '.git', 'backups'].includes(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx)$/.test(name)) continue;
      const src = readFileSync(full, 'utf8');
      // The definition itself, and this file, are not call sites.
      if (full.endsWith(join('lib', 'entries.js')) || full.includes('approverCompanyScope')) continue;
      for (const call of src.match(/isDepartmentManager\([^)]*\)/g) || []) {
        const args = call.slice('isDepartmentManager('.length, -1);
        if (args.split(',').length < 3) offences.push(`${full}: ${call}`);
      }
    }
  };
  walk(ROOT);
  assert.deepEqual(offences, []);
});

test('every route that narrows a manager by department also narrows by company', () => {
  /**
   * THE LIST AND THE BUTTONS HAVE TO AGREE, and there are more lists than the
   * queue: the ลูกทีม picker in บันทึก OT แทน, ตรวจสอบรายเดือน, the two CSV
   * exports and F-HR-027. Each one narrows a หัวหน้า to their own department with
   * a line of its own, and one of them left un-narrowed is a screen offering
   * rows the server refuses — which is the failure this whole field exists to
   * make impossible.
   *
   * So the shape is pinned rather than trusted: a file that scopes by
   * `user.department` must also mention the company rule. It cannot check that
   * the rule was applied CORRECTLY — the tests above do that — only that the
   * question was asked at all, which is the half that gets forgotten when
   * somebody adds a sixth report next year.
   */
  const offences = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.next', '.git', 'backups'].includes(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/route\.js$/.test(name)) continue;
      const src = readFileSync(full, 'utf8');
      /**
       * `approvalDepartments(user)` counts as narrowing by department too — it
       * IS the department rule now, and the routes that used to write
       * `user.department` were changed to it when a หัวหน้า became able to cover
       * more than one แผนก. Without this clause every one of them would quietly
       * drop out of the check the day it was widened, which is the moment the
       * check is worth the most.
       */
      const byDept = /user\??\.department|approvalDepartments\(/;
      const narrows = new RegExp(`role === 'supervisor'[\\s\\S]{0,200}?(${byDept.source})`).test(src)
        || new RegExp(`(${byDept.source})[\\s\\S]{0,200}?role === 'supervisor'`).test(src);
      if (!narrows) continue;
      if (!/approvesCompany|signsForCompany|isDepartmentManager|resolveScope/.test(src)) {
        offences.push(full.replace(ROOT, '').replace(/\\/g, '/'));
      }
    }
  };
  walk(join(ROOT, 'app'));
  assert.deepEqual(offences, []);
});

// ── which payroll a row belongs to ──────────────────────────────────────────

test('the row’s company is read off the person it is for', () => {
  assert.equal(entryCompany(entryFor(PM_WORKER)), 'primus');
  assert.equal(entryCompany(entryFor(THT_WORKER)), 'themtech');
});

test('an unset company still resolves, from the code prefix', () => {
  // `migrate:company` filled these in, and the roster is allowed to depart from
  // the convention afterwards — so the prefix is a fallback, not the rule.
  const legacy = { _id: 'emp-x', code: 'THT0099', department: PROD };
  assert.equal(entryCompany(entryFor(legacy)), 'themtech');
});

test('a row whose employee was never populated throws instead of guessing', () => {
  /**
   * `companyOf` answers DEFAULT_COMPANY for anything it cannot read, so a route
   * that forgot to populate would file every เดมเทค request under ไพรมัส and hand
   * it to the wrong หัวหน้า — the loudest possible failure is the only safe one.
   */
  assert.throws(() => entryCompany({ department: PROD, employee: 'emp-tht' }), /populate/);
  assert.throws(() => entryCompany({ department: PROD }), /populate/);
});

// ── approving ──────────────────────────────────────────────────────────────

test('the approval queue’s rule is the same rule, through approvalPermission', () => {
  const pmRow = entryFor(PM_WORKER);
  const thtRow = entryFor(THT_WORKER);

  assert.equal(approvalPermission({ user: PM_ONLY, entry: pmRow, today: '2026-08-17' }).ok, true);
  const refused = approvalPermission({ user: PM_ONLY, entry: thtRow, today: '2026-08-17' });
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 403);
  // Said as a scope problem, which is what it is — the same sentence a หัวหน้า
  // of another department gets, because both are "not your row".
  assert.match(refused.error, /แผนกของตน/);

  // And the other half of the same department, by the other หัวหน้า.
  assert.equal(approvalPermission({ user: THT_ONLY, entry: thtRow, today: '2026-08-17' }).ok, true);
  assert.equal(approvalPermission({ user: THT_ONLY, entry: pmRow, today: '2026-08-17' }).ok, false);
});

test('ฝ่ายบุคคล confirm both payrolls — the scope is a หัวหน้า’s, not a step’s', () => {
  const row = entryFor(THT_WORKER, { status: 'pending_hr' });
  assert.equal(approvalPermission({ user: HR, entry: row, today: '2026-08-17' }).ok, true);
});

// ── หัวหน้าลาพักร้อน: the scope travels with the authority ──────────────────

/** PM_ONLY hands their queue to THT_ONLY for the week they are away. */
const PM_TO_THT = {
  _id: 'del-1', from: PM_ONLY, to: THT_ONLY, fromDate: '2026-08-17', toDate: '2026-08-24',
};

test('a stand-in exercises the giver’s scope, not their own', () => {
  /**
   * THE ONE THAT MATTERS. THT_ONLY may not sign a ไพรมัส row as themselves. While
   * they are holding PM_ONLY's queue they may — under PM_ONLY's authority, which
   * is what was handed over. Read the other way round, the delegation would grant
   * nothing at all and the ไพรมัส half of PROD would have nobody for a week.
   */
  const pmRow = entryFor(PM_WORKER);
  const may = approvalPermission({
    user: THT_ONLY, entry: pmRow, delegations: [PM_TO_THT], today: '2026-08-18',
  });
  assert.equal(may.ok, true);
  assert.equal(may.stage, 'mgr');
  assert.equal(may.onBehalfOf, PM_ONLY, 'and the record says whose authority was used');
  assert.equal(may.delegationId, 'del-1');
});

test('and keeps their own at the same time, as themselves', () => {
  const thtRow = entryFor(THT_WORKER);
  const may = approvalPermission({
    user: THT_ONLY, entry: thtRow, delegations: [PM_TO_THT], today: '2026-08-18',
  });
  assert.equal(may.ok, true);
  assert.equal(may.onBehalfOf, null, 'their own team needs nobody’s permission');
});

test('when the window closes the borrowed half goes back, with nobody switching it off', () => {
  const pmRow = entryFor(PM_WORKER);
  assert.equal(approvalPermission({
    user: THT_ONLY, entry: pmRow, delegations: [PM_TO_THT], today: '2026-08-25',
  }).ok, false);
});

test('a claim is refused when the giver could not sign it either', () => {
  // PM_ONLY cannot sign เดมเทค rows, so holding their queue does not produce a
  // claim on one. A delegation passes on an authority; it cannot mint one.
  assert.equal(departmentClaim(THT_ONLY, QC, [PM_TO_THT], '2026-08-18', 'primus'), null);
});

test('the borrowed claim carries the giver’s scope into the queue as well', () => {
  const held = [PM_TO_THT];
  assert.deepEqual(
    delegatedClaims(held, THT_ONLY, '2026-08-18'),
    [{ department: PROD, company: 'primus' }],
  );
  // The ids alongside, unchanged, for the chip and the count of covered teams.
  assert.deepEqual(delegatedDepartments(held, THT_ONLY, '2026-08-18'), [PROD]);
});

// ── the queue ──────────────────────────────────────────────────────────────

test('an unscoped queue is the same query it has always been', () => {
  assert.deepEqual(ownClaim(BOTH), { department: PROD, company: null });
  assert.deepEqual(scopeFor(BOTH, []), { department: PROD });
  assert.deepEqual(
    scopeFor(BOTH, [{ department: QC, company: null }]),
    { department: { $in: [PROD, QC] } },
    'and several teams still use the index the collection already has',
  );
});

test('a scoped queue narrows by the people that payroll pays', () => {
  const rosters = new Map([['primus', ['emp-pm', 'emp-boss']]]);
  assert.deepEqual(
    scopeFor(PM_ONLY, [], rosters),
    { department: PROD, employee: { $in: ['emp-pm', 'emp-boss'] } },
  );
});

test('own team plus a borrowed one with a different scope becomes an $or', () => {
  /**
   * THT_ONLY covering PM_ONLY's leave: one department, two halves, reached by two
   * different authorities — so the queue is two branches rather than one wider
   * clause. This is the query behind the previous four tests, and it is the same
   * pair of claims those decisions were made from.
   */
  const rosters = new Map([['primus', ['emp-pm']], ['themtech', ['emp-tht']]]);
  assert.deepEqual(
    scopeFor(THT_ONLY, [{ department: PROD, company: 'primus' }], rosters),
    {
      $or: [
        { department: PROD, employee: { $in: ['emp-tht'] } },
        { department: PROD, employee: { $in: ['emp-pm'] } },
      ],
    },
  );
});

test('a whole-department claim beside a scoped one keeps its own shape', () => {
  // The mixture a company part-way through the change actually has: one แผนก
  // still on one หัวหน้า, another split in two.
  const rosters = new Map([['primus', ['emp-pm']]]);
  assert.deepEqual(
    scopeFor(PM_ONLY, [{ department: QC, company: null }], rosters),
    {
      $or: [
        { department: PROD, employee: { $in: ['emp-pm'] } },
        { department: QC },
      ],
    },
  );
});

test('a scoped claim with no roster set throws rather than widening', () => {
  /**
   * Dropping the clause would return "the whole department", which is the answer
   * the field exists to stop. A queue is allowed to fail; it is not allowed to
   * quietly show somebody else's people.
   */
  assert.throws(() => claimFilter([{ department: PROD, company: 'primus' }], null), /บริษัท/);
  assert.throws(
    () => claimFilter([{ department: PROD, company: 'primus' }], new Map([['themtech', []]])),
    /บริษัท/,
  );
});

test('an empty claim list is nothing, not everything', () => {
  assert.equal(claimFilter([], null), null);
  // And what scopeFor does with it: a filter that matches no row, never `{}`.
  assert.deepEqual(scopeFor({ role: 'supervisor' }, []), { department: null });
});

// ── filing on somebody's behalf ─────────────────────────────────────────────

test('a scoped หัวหน้า may not file for the other payroll’s people', () => {
  assert.equal(proxyPermission(PM_ONLY, PM_WORKER).ok, true);
  const no = proxyPermission(PM_ONLY, THT_WORKER);
  assert.equal(no.ok, false);
  assert.equal(no.status, 403);
});

test('and a filing they could not have signed does not skip the หัวหน้า step', () => {
  /**
   * `initialStatus` asks "could this filer sign this themselves" — if the answer
   * is no, the request has to wait at pending_mgr for whoever can. Skipping on
   * the department alone would produce a row that reached ฝ่ายบุคคล with the
   * หัวหน้า step marked as handled by somebody who was not allowed to handle it.
   */
  const policy = { proxySkipsOwnApproval: true };
  assert.equal(
    initialStatus({ filer: PM_ONLY, employee: PM_WORKER, department: PROD, policy }).status,
    'pending_hr',
  );
  assert.equal(
    initialStatus({ filer: PM_ONLY, employee: THT_WORKER, department: PROD, policy }).status,
    'pending_mgr',
  );
});

// ── ขอถอนใบที่อนุมัติแล้ว ───────────────────────────────────────────────────

test('answering a ขอถอน follows the same scope as approving it did', () => {
  const asked = (employee) => ({
    _id: 'x',
    employee,
    department: PROD,
    status: 'approved',
    managerDecision: { by: 'mgr-pm', at: new Date('2026-08-10T02:00:00Z') },
    withdrawal: { state: 'requested', requestedBy: employee._id },
  });

  assert.equal(withdrawDecisionPermission({
    user: PM_ONLY, entry: asked(PM_WORKER), today: '2026-08-17',
  }).ok, true);
  assert.equal(withdrawDecisionPermission({
    user: PM_ONLY, entry: asked(THT_WORKER), today: '2026-08-17',
  }).ok, false);
});
