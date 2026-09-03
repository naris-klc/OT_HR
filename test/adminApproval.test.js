import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DELEGATE_ROLES, OVERRIDE_NOTE_REQUIRED, approvalPermission, approvalRecord,
  delegationPermission, mayOverrideManagerStep, nobodyCanSign, signedManagerStep,
} from '../lib/delegation.js';

/**
 * ผู้ดูแลระบบ CAN SIGN THE หัวหน้า STEP — AND STILL CANNOT SIGN A ใบ ALONE.
 *
 * Two rules that arrived together on 2026-08-24 and only make sense together.
 *
 * ── The hole that made the first one necessary ─────────────────────────────
 *
 * A แผนก with no หัวหน้า on the roster has requests NOBODY can sign, and
 * ผู้รับช่วงอนุมัติ cannot rescue them: `delegationPermission` needs the giver to
 * be a manager, and there is no manager to give. ADM is that department on the
 * real roster today. Before this, such a request sat at `pending_mgr` for ever
 * with no path anywhere in the application.
 *
 * ── The hole the second one closes, which is OLDER ─────────────────────────
 *
 * §6 wants two signatures and nothing checked they were two PEOPLE. The rule
 * was carried entirely by the shape of the roles — หัวหน้า sign first, ฝ่ายบุคคล
 * sign second, nobody is both — and `DELEGATE_ROLES` broke that the day it was
 * written: an HR holding a live delegation signs the manager's step on the
 * giver's authority, and the same person is then `isHr` and signs it off.
 * Reproduced against the real `approvalPermission` before the fix.
 *
 * So the second rule is written GENERALLY. Written as "an administrator may not
 * sign both" it would have fixed the path added here and left the ผู้รับช่วง one
 * exactly as it was.
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Source with comments stripped, so a rule described in prose does not pass for
 * a rule that runs — and with line endings normalised, because the repo is
 * checked out CRLF on this machine and a `\n` in an assertion below would
 * otherwise miss every multi-line match while the file is perfectly correct.
 */
const read = (file) => readFileSync(join(ROOT, file), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const ENG = 'dept-eng';
const ADM = 'dept-adm';

const MGR = { _id: 'mgr-a', name: 'สมชาย', role: 'supervisor', department: ENG, active: true };
const HR = { _id: 'hr-1', name: 'ฝ่ายบุคคล', role: 'hr' };
const HR2 = { _id: 'hr-2', name: 'ฝ่ายบุคคลสอง', role: 'hr' };
const ADMIN = { _id: 'adm-1', name: 'ผู้ดูแลระบบ', role: 'admin' };
const ADMIN2 = { _id: 'adm-2', name: 'ผู้ดูแลระบบสอง', role: 'admin' };
const WORKER = { _id: 'emp-9', name: 'พนักงาน', role: 'employee', department: ADM, company: 'primus' };

/** A request in ADM — the department with no หัวหน้า. */
const stuck = (over = {}) => ({
  status: 'pending_mgr', department: ADM, employee: WORKER, ...over,
});

const WHY = 'แผนก ADM ยังไม่มีหัวหน้างาน';

// ════════════════════════════════════════════════════════════════════════════
// 1 · who may stand in for a หัวหน้า who does not exist
// ════════════════════════════════════════════════════════════════════════════

test('ผู้ดูแลระบบ may sign the หัวหน้า step; nobody else may', () => {
  assert.equal(mayOverrideManagerStep(ADMIN), true);
  assert.equal(mayOverrideManagerStep(HR), false, 'ฝ่ายบุคคล are the SECOND pair of eyes');
  assert.equal(mayOverrideManagerStep(MGR), false, 'a หัวหน้า signs by their own claim');
  assert.equal(mayOverrideManagerStep(WORKER), false);
  assert.equal(mayOverrideManagerStep(null), false);
});

test('with a reason, an administrator signs a request nobody else can', () => {
  const may = approvalPermission({ user: ADMIN, entry: stuck(), today: '2026-08-24', note: WHY });
  assert.equal(may.ok, true);
  assert.equal(may.stage, 'mgr');
  assert.equal(may.adminOverride, true);
  // Nobody delegated this and no manager authorised it, so neither field is
  // filled in — putting a name there would be a signature its owner never gave.
  assert.equal(may.onBehalfOf, null);
  assert.equal(may.delegationId, null);
});

test('without a reason it is refused — 400, and the message says what to write', () => {
  for (const note of [undefined, null, '', '   ']) {
    const may = approvalPermission({ user: ADMIN, entry: stuck(), today: '2026-08-24', note });
    assert.equal(may.ok, false, JSON.stringify(note));
    assert.equal(may.status, 400, 'the request is malformed, not the person unauthorised');
    assert.equal(may.error, OVERRIDE_NOTE_REQUIRED);
  }
  // It names an example, because "ระบุเหตุผล" alone is answered with "ok".
  assert.match(OVERRIDE_NOTE_REQUIRED, /ยังไม่มีหัวหน้า/);
});

test('ฝ่ายบุคคล are still told to wait for the หัวหน้า, reason or no reason', () => {
  const may = approvalPermission({ user: HR, entry: stuck(), today: '2026-08-24', note: WHY });
  assert.equal(may.ok, false);
  assert.equal(may.status, 409);
  assert.match(may.error, /ต้องผ่านการอนุมัติจากหัวหน้าก่อน/);
});

test('the real หัวหน้า is still asked first — the override is never the first answer', () => {
  /**
   * Placed after `managerClaim` in the same way a delegation is. A department
   * that HAS a หัวหน้า is signed by their หัวหน้า; this path is only reached
   * when nobody else could have taken it, which is what keeps an administrator
   * from becoming the ordinary approver by being the quickest one to the queue.
   */
  // Read inside `approvalPermission`'s own body — `mayOverrideManagerStep` is
  // also DEFINED higher up the file, and matching that definition instead would
  // make this assertion true no matter where the call went.
  const src = read('lib/delegation.js');
  const body = src.slice(src.indexOf('export function approvalPermission('));
  const claim = body.indexOf('const claim = managerClaim(');
  const override = body.indexOf('if (mayOverrideManagerStep(user))');
  assert.ok(claim > 0, 'the real manager’s claim is no longer resolved here');
  assert.ok(override > 0, 'the override is no longer applied here');
  assert.ok(claim < override, 'the override is consulted before the real manager’s claim');
});

test('an administrator still cannot approve a request they filed themselves', () => {
  // `isOwnFiling` is the first clause and outranks everything, override included.
  const own = stuck({ filedBy: ADMIN });
  const may = approvalPermission({ user: ADMIN, entry: own, today: '2026-08-24', note: WHY });
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
});

// ════════════════════════════════════════════════════════════════════════════
// 2 · §6 means two PEOPLE
// ════════════════════════════════════════════════════════════════════════════

test('the administrator who signed the หัวหน้า step may not sign the ฝ่ายบุคคล one', () => {
  const after = stuck({ status: 'pending_hr', managerDecision: { by: ADMIN._id, at: new Date() } });
  const may = approvalPermission({ user: ADMIN, entry: after, today: '2026-08-24' });
  assert.equal(may.ok, false);
  assert.equal(may.status, 409, 'they have the right; this entry is what refuses');
  assert.match(may.error, /ผู้เซ็นสองคน/);
});

test('…and another administrator may — it is the person, not the role', () => {
  const after = stuck({ status: 'pending_hr', managerDecision: { by: ADMIN._id, at: new Date() } });
  assert.equal(approvalPermission({ user: ADMIN2, entry: after, today: '2026-08-24' }).ok, true);
  assert.equal(approvalPermission({ user: HR, entry: after, today: '2026-08-24' }).ok, true);
});

test('THE OLDER HOLE: a ฝ่ายบุคคล stand-in cannot sign both steps either', () => {
  /**
   * The reason the rule is general. HR-001 holds a delegation from a หัวหน้า,
   * signs the manager's step on their authority, and — before this — signed the
   * HR step of the very same entry a moment later. One person, both signatures,
   * no delegation rule broken and nothing anywhere saying so.
   */
  const del = { _id: 'del-1', from: MGR, to: HR, fromDate: '2026-08-01', toDate: '2026-08-31' };
  const engEntry = { status: 'pending_mgr', department: ENG, employee: { ...WORKER, department: ENG } };

  const first = approvalPermission({
    user: HR, entry: engEntry, delegations: [del], today: '2026-08-20',
  });
  assert.equal(first.ok, true, 'the stand-in still signs the manager’s step');
  assert.equal(first.stage, 'mgr');

  const after = { ...engEntry, status: 'pending_hr', managerDecision: { by: HR._id, at: new Date() } };
  const second = approvalPermission({
    user: HR, entry: after, delegations: [del], today: '2026-08-20',
  });
  assert.equal(second.ok, false, 'and is now out of the second one');
  assert.equal(second.status, 409);

  // The other HR account is unaffected — the queue still moves.
  assert.equal(
    approvalPermission({ user: HR2, entry: after, delegations: [], today: '2026-08-20' }).ok,
    true,
  );
});

test('holding a delegation is not the same as having signed', () => {
  // The rule keys on `managerDecision.by`, so an HR who was merely NAMED as a
  // stand-in and never used it confirms the entry as usual. Anything coarser
  // would take work away from somebody for a button they never pressed.
  const del = { _id: 'del-1', from: MGR, to: HR, fromDate: '2026-08-01', toDate: '2026-08-31' };
  const signedByTheManager = {
    status: 'pending_hr',
    department: ENG,
    employee: { ...WORKER, department: ENG },
    managerDecision: { by: MGR._id, at: new Date() },
  };
  assert.equal(
    approvalPermission({ user: HR, entry: signedByTheManager, delegations: [del], today: '2026-08-20' }).ok,
    true,
  );
});

test('signedManagerStep reads the shape the BROWSER holds as well as the server’s', () => {
  /**
   * The same trap `isOwnFiling` carries a note about: `publicUser()` hands the
   * client `id` and the server holds `_id`. Got wrong here the predicate fails
   * SILENTLY as "you did not sign this", which is the answer that hides the bug
   * — the queue would go on offering a button the server refuses.
   */
  const after = stuck({ status: 'pending_hr', managerDecision: { by: 'adm-1', at: new Date() } });
  assert.equal(signedManagerStep(after, ADMIN), true, 'server shape');
  assert.equal(signedManagerStep(after, { id: 'adm-1', role: 'admin' }), true, 'client shape');
  assert.equal(signedManagerStep(after, ADMIN2), false, 'somebody else');
});

test('an entry nobody has signed yet trips nothing', () => {
  assert.equal(signedManagerStep(stuck(), ADMIN), false);
  assert.equal(signedManagerStep(stuck({ managerDecision: {} }), ADMIN), false);
  assert.equal(signedManagerStep(null, ADMIN), false);
});

// ════════════════════════════════════════════════════════════════════════════
// 3 · what the trail keeps
// ════════════════════════════════════════════════════════════════════════════

test('the override is its own field, because the other three are empty for it', () => {
  const record = approvalRecord(ADMIN, { stage: 'mgr', adminOverride: true }, { note: WHY });
  assert.equal(record.by, 'adm-1', 'who pressed it');
  assert.equal(record.note, WHY, 'and why they were allowed to');
  assert.equal(record.adminOverride, true);
  // Left to the delegation fields alone, this record would be indistinguishable
  // from an ordinary manager signing their own team's request.
  assert.equal(record.onBehalfOf, undefined);
  assert.equal(record.delegationId, undefined);
});

test('an ordinary decision carries undefined, not false', () => {
  // A stored `false` is a value somebody later reads as an assertion that it did
  // not happen, on entries that predate the question entirely.
  assert.equal(approvalRecord(MGR, { stage: 'mgr' }, { note: 'ok' }).adminOverride, undefined);
  assert.equal(approvalRecord(HR, { stage: 'hr' }, {}).adminOverride, undefined);
});

test('the schema has somewhere to put it, on the manager block and the history', () => {
  const model = read('src/models/OtEntry.js');
  const mgr = model.slice(model.indexOf('managerDecision: {'), model.indexOf('hrDecision: {'));
  assert.match(mgr, /adminOverride: Boolean/);
  // NOT on hrDecision: there is no such thing at the second step. An
  // administrator signs the HR step as themselves, by the ordinary rule.
  const hr = model.slice(model.indexOf('hrDecision: {'), model.indexOf('rejectionReason'));
  assert.doesNotMatch(hr, /adminOverride/);
  // And `log()` carries it through, or the entry's own history would not say.
  assert.match(model, /adminOverride: extra\?\.adminOverride \|\| undefined/);
});

// ════════════════════════════════════════════════════════════════════════════
// 4 · the routes ask, and the reason reaches the rule
// ════════════════════════════════════════════════════════════════════════════

test('อนุมัติ hands the note to the rule, not merely to the record', () => {
  /**
   * A guard written in the route would be a rule the next route beside it has
   * to remember to copy — which is the shape of every duplicated-rule failure
   * in this codebase. The refusal lives with the grant.
   */
  const src = read('app/api/entries/[id]/approve/route.js');
  assert.match(src, /approvalPermission\(\{[\s\S]*?\n\s*note,\n\s*\}\)/);
  assert.doesNotMatch(src, /OVERRIDE_NOTE_REQUIRED/, 'the route is re-stating the rule');
});

test('ไม่อนุมัติ passes its own reason, which it has always demanded of everybody', () => {
  const src = read('app/api/entries/[id]/reject/route.js');
  assert.match(src, /if \(!reason\) return fail/);
  assert.match(src, /note: reason,/);
});

// ════════════════════════════════════════════════════════════════════════════
// 5 · ผู้ดูแลระบบ is a superset of ฝ่ายบุคคล — the inversion that was left
// ════════════════════════════════════════════════════════════════════════════

test('ผู้ดูแลระบบ may be named as a ผู้รับช่วงอนุมัติ, which ฝ่ายบุคคล always could', () => {
  // It read `['supervisor', 'hr', 'admin']` until บทบาท became seven on
  // 2026-09-03. All four who hold a แผนก are nameable now, for the reason
  // ผู้ดูแลระบบ was added here on 2026-08-24: a person who signs the first step
  // in their own right and cannot be named as a stand-in is an omission that
  // reads as a decision. It widens nothing — a ผู้รับช่วง exercises the GIVER's
  // claim, and `approvalPermission` asks the routing matrix of the giver's
  // บทบาท, never the holder's.
  assert.deepEqual(DELEGATE_ROLES,
    ['supervisor', 'finance', 'dept_manager', 'division_manager', 'hr', 'admin']);
  const may = delegationPermission({
    actor: HR,
    from: MGR,
    to: ADMIN,
    window: { fromDate: '2026-09-01', toDate: '2026-09-07' },
    existing: [],
  });
  assert.equal(may.ok, true);
});

test('and the roles that were never signers still are not', () => {
  const may = delegationPermission({
    actor: HR,
    from: MGR,
    to: WORKER,
    window: { fromDate: '2026-09-01', toDate: '2026-09-07' },
    existing: [],
  });
  assert.equal(may.ok, false);
});

test('a delegation still cannot be given BY somebody who is not a หัวหน้า', () => {
  // Which is exactly why the override above had to exist: a แผนก with no
  // หัวหน้า has nobody to delegate from, so the stand-in mechanism cannot reach
  // it however wide the receiving end is opened.
  const may = delegationPermission({
    actor: ADMIN,
    from: ADMIN,
    to: HR,
    window: { fromDate: '2026-09-01', toDate: '2026-09-07' },
    existing: [],
  });
  assert.equal(may.ok, false);
  assert.match(may.error, /หัวหน้างาน/);
});

// ════════════════════════════════════════════════════════════════════════════
// 6 · which rows are actually stuck
// ════════════════════════════════════════════════════════════════════════════

const covering = (over = {}) => ({
  _id: 'm', role: 'supervisor', active: true, department: ENG,
  approvesCompany: null, approvesDepartments: [], ...over,
});

test('a department with no หัวหน้า at all is stuck', () => {
  assert.equal(nobodyCanSign(stuck(), [covering()], 'primus'), true);
});

test('a department with one is not', () => {
  assert.equal(nobodyCanSign(stuck(), [covering({ department: ADM })], 'primus'), false);
});

test('a หัวหน้า ticked into it from elsewhere covers it', () => {
  // `approvesDepartments` — the whole reason this asks `isDepartmentManager`
  // rather than comparing `department` itself.
  assert.equal(
    nobodyCanSign(stuck(), [covering({ approvesDepartments: [ADM] })], 'primus'),
    false,
  );
});

test('THE HALF-COVERED CASE: a signer scoped to one payroll leaves the other stuck', () => {
  /**
   * Why this is asked per ENTRY and not per department. A แผนก can hold a
   * หัวหน้า who signs only for ไพรมัส while เดมเทค staff sit in it, and their
   * requests are as unsignable as ADM's while the department looks covered from
   * every screen in the app.
   */
  const heads = [covering({ department: ADM, approvesCompany: 'primus' })];
  assert.equal(nobodyCanSign(stuck(), heads, 'primus'), false, 'the covered payroll');
  assert.equal(nobodyCanSign(stuck(), heads, 'themtech'), true, 'and the one that is not');
});

test('a deactivated หัวหน้า covers nothing', () => {
  assert.equal(
    nobodyCanSign(stuck(), [covering({ department: ADM, active: false })], 'primus'),
    true,
  );
});

test('an empty roster is stuck rather than throwing', () => {
  assert.equal(nobodyCanSign(stuck(), [], 'primus'), true);
  assert.equal(nobodyCanSign(stuck(), undefined, 'primus'), true);
});

// ════════════════════════════════════════════════════════════════════════════
// 7 · the screen asks the same questions
// ════════════════════════════════════════════════════════════════════════════

test('the stuck queue is ผู้ดูแลระบบ’s and asks the server for that list', () => {
  const route = read('app/api/entries/route.js');
  assert.match(route, /scope === 'unsigned' && user\.role === 'admin'/);
  assert.match(route, /nobodyCanSign\(e, managers, entryCompany\(e\)\)/);

  const app = read('components/App.jsx');
  assert.match(app, /user\.role === 'admin' && counts\.unsignedPending > 0/);
  assert.match(app, /tab === 'unsigned' && <ApprovalQueue user=\{user\} stage="pending_mgr" unsignedOnly/);
});

test('the badge and the list are one computation', () => {
  // A badge counted by a different rule than the list it opens is a badge that
  // sends an administrator looking for a request that is not stuck.
  const summary = read('app/api/entries/queue-summary/route.js');
  assert.match(summary, /nobodyCanSign\(e, managers, entryCompany\(e\)\)/);
  assert.match(summary, /if \(user\.role === 'admin'\)/);
});

test('the reason box is compulsory on that queue and nowhere else', () => {
  const queue = read('components/ApprovalQueue.jsx');
  assert.match(queue, /const needsReason = unsignedOnly/);
  assert.match(queue, /disabled=\{busy \|\| !ready\}/);
  /**
   * It read `const ready = !needsReason || why.trim().length > 0` until
   * 2026-09-02, when a SECOND rule learnt to demand the same box: a request
   * that was over its department's ceiling when it was filed
   * (`needsOverCeilingReason`). The two are independent — one is about who is
   * signing, the other about what is being signed — and `mustExplain` is their
   * or. What this case still guards is unchanged and is the line below it: the
   * screen may not demand a reason the server would not.
   */
  assert.match(queue, /const mustExplain = needsReason \|\| overCeiling;/);
  assert.match(queue, /const ready = !mustExplain \|\| why\.trim\(\)\.length > 0/);
  // And the second rule is read off the ROWS, never off the queue's mode — a
  // screen-wide flag would demand a reason for entries that are under their
  // ceiling and get a 200 from a server that asked for nothing.
  assert.match(queue, /const capReason = \(list = \[\]\) => list\.some\(\(e\) => needsOverCeilingReason\(e\)\);/);
  // The screen must not demand more than the route: an administrator signing
  // from รออนุมัติแทน on a real delegation is not overriding anything, and the
  // server asks them for nothing.
  assert.doesNotMatch(queue, /needsReason = .*role === 'admin'/);
});

test('the reason is never pre-filled', () => {
  // A sentence the system wrote, appearing in the record as something a person
  // decided, on the one line whose whole job is to say what a person decided.
  const queue = read('components/ApprovalQueue.jsx');
  assert.match(queue, /const \[why, setWhy\] = useState\(''\)/);
});

test('the screen warns that the second signature will have to be somebody else', () => {
  const queue = read('components/ApprovalQueue.jsx');
  assert.match(queue, /คุณจะเซ็นขั้นนั้นของใบเดียวกันไม่ได้/);
});
