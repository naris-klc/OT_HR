import test from 'node:test';
import assert from 'node:assert/strict';

import {
  approvalPermission, approvalRecord, barredAsOwnFiling, delegationPermission, historyExtra,
  isOwnFiling, delegatedClaims, delegatedDepartments, isLive, overlaps, publicDelegation, receivedOn,
  scopeWidening, wouldCycle,
} from '../lib/delegation.js';
import { scopeFor } from '../lib/entries.js';

/**
 * ผู้รับช่วงอนุมัติแทน — a stand-in for the manager's signature, for a window
 * that ends by itself.
 *
 * Three things are being pinned here, and the third is the one that matters
 * most in six months: that a window expires without anybody doing anything,
 * that no chain of stand-ins can form, and that the record says B acted using
 * A's authority rather than flattening the two into one name.
 */

const ENG = 'dept-eng';
const QA = 'dept-qa';
const SALES = 'dept-sales';

const A = { _id: 'mgr-a', name: 'สมชาย', role: 'supervisor', department: ENG };
const B = { _id: 'mgr-b', name: 'สมหญิง', role: 'supervisor', department: QA };
const C = { _id: 'mgr-c', name: 'สมปอง', role: 'supervisor', department: SALES };
const HR = { _id: 'hr-1', name: 'ฝ่ายบุคคล', role: 'hr', department: ENG };
const ADMIN = { _id: 'adm-1', name: 'แอดมิน', role: 'admin' };
// `company` on every person a request can be FOR: the permission rules read
// which payroll a row belongs to, and refuse to guess when nobody says.
const WORKER = { _id: 'emp-1', name: 'พนักงาน', role: 'employee', department: ENG, company: 'primus' };

/** A → B for the week of 5–12 August. */
const AtoB = {
  _id: 'del-1', from: A, to: B, fromDate: '2026-08-05', toDate: '2026-08-12',
};

const engEntry = (over = {}) => ({ status: 'pending_mgr', department: ENG, employee: WORKER, ...over });

// ── the window ──────────────────────────────────────────────────────────────

test('both ends of the window are inclusive', () => {
  assert.equal(isLive(AtoB, '2026-08-05'), true, 'the first day is covered');
  assert.equal(isLive(AtoB, '2026-08-12'), true, 'and so is the last');
});

test('a delegation that has not started yet grants nothing', () => {
  assert.equal(isLive(AtoB, '2026-08-04'), false);
});

test('a delegation that has run out grants nothing, with nobody switching it off', () => {
  // The whole reason there is no enabled flag: this stops being true on the
  // 13th whether or not the person who set it up remembers.
  assert.equal(isLive(AtoB, '2026-08-13'), false);
  assert.equal(isLive(AtoB, '2027-01-01'), false);
});

test('one ended early grants nothing from the moment it is revoked', () => {
  assert.equal(isLive({ ...AtoB, revokedAt: new Date() }, '2026-08-06'), false);
});

test('windows sharing a single day overlap; windows a day apart do not', () => {
  assert.equal(overlaps(AtoB, { fromDate: '2026-08-12', toDate: '2026-08-20' }), true);
  assert.equal(overlaps(AtoB, { fromDate: '2026-08-13', toDate: '2026-08-20' }), false);
  assert.equal(overlaps(AtoB, { fromDate: '2026-07-01', toDate: '2026-08-05' }), true);
});

// ── approving under one ─────────────────────────────────────────────────────

test('inside the window the stand-in approves, on the manager’s behalf', () => {
  const may = approvalPermission({
    user: B, entry: engEntry(), delegations: [AtoB], today: '2026-08-06',
  });
  assert.equal(may.ok, true);
  assert.equal(may.stage, 'mgr');
  assert.equal(may.onBehalfOf._id, 'mgr-a', 'and it is recorded whose authority that was');
  assert.equal(may.delegationId, 'del-1');
});

test('after it expires the stand-in is refused, and told it is not their team', () => {
  const may = approvalPermission({
    user: B, entry: engEntry(), delegations: [AtoB], today: '2026-08-13',
  });
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
});

test('before it starts, the same', () => {
  assert.equal(
    approvalPermission({ user: B, entry: engEntry(), delegations: [AtoB], today: '2026-08-04' }).ok,
    false,
  );
});

test('the real manager approves throughout, and needs no delegation to do it', () => {
  // "เพิ่ม" and not "ย้าย": the manager's own claim is settled before any
  // delegation is consulted, so coming back early costs nothing and needs no
  // undo.
  for (const day of ['2026-08-04', '2026-08-06', '2026-08-13']) {
    const may = approvalPermission({ user: A, entry: engEntry(), delegations: [AtoB], today: day });
    assert.equal(may.ok, true, day);
    assert.equal(may.onBehalfOf, null, 'their own signature is their own');
    assert.equal(may.delegationId, null);
  }
});

test('a stand-in covers the team they were given and no other', () => {
  const may = approvalPermission({
    user: B, entry: engEntry({ department: SALES }), delegations: [AtoB], today: '2026-08-06',
  });
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
});

test('the stand-in still runs their own queue at the same time', () => {
  const may = approvalPermission({
    user: B, entry: engEntry({ department: QA }), delegations: [AtoB], today: '2026-08-06',
  });
  assert.equal(may.ok, true);
  assert.equal(may.onBehalfOf, null);
});

test('a ฝ่ายบุคคล standing in takes the manager’s step, not their own', () => {
  // The branch has to be chosen by what the delegation authorises. Chosen by
  // the actor's role instead, HR would be told their manager's-step claim was
  // "not at the HR step" and the delegation would do nothing at all.
  const may = approvalPermission({
    user: HR, entry: engEntry(), delegations: [{ ...AtoB, to: HR }], today: '2026-08-06',
  });
  assert.equal(may.ok, true);
  assert.equal(may.stage, 'mgr');
  assert.equal(may.onBehalfOf._id, 'mgr-a');
});

test('and holding a delegation never blocks their own HR confirmation', () => {
  const may = approvalPermission({
    user: HR,
    entry: engEntry({ status: 'pending_hr', managerDecision: { at: new Date() } }),
    delegations: [{ ...AtoB, to: HR }],
    today: '2026-08-06',
  });
  assert.equal(may.ok, true);
  assert.equal(may.stage, 'hr');
  assert.equal(may.onBehalfOf, null, 'the HR step is theirs, not anybody’s to lend');
});

test('a delegation covers the manager’s step only — never the HR one', () => {
  const may = approvalPermission({
    user: B,
    entry: engEntry({ status: 'pending_hr', managerDecision: { at: new Date() } }),
    delegations: [AtoB],
    today: '2026-08-06',
  });
  assert.equal(may.ok, false);
  assert.equal(may.status, 409);
});

/**
 * The rule that must not lean on the other rule.
 *
 * `initialStatus` routes a หัวหน้า's own filing past the step they would sign,
 * which handles the ordinary case — but it is a different rule in a different
 * file behind a config flag, and a request can reach `pending_mgr` with their
 * name on it by more than one route: the flag turned off, or a stand-in
 * reaching a department whose entries never went past their own step.
 */
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE CHANGED SHAPE ON 2026-09-09 AND KEPT THE HALF THAT MATTERS.
 *
 * It was "nobody decides a request they filed, at any step". HR asked for the
 * two presses (`proxySkipsOwnApproval`), so a proxy filing now waits at
 * `pending_mgr` for the หัวหน้า who typed it — and in 13 of 18 แผนก that person
 * is the only one who could ever sign it, so the old rule kept as it was would
 * have parked the whole feature in a queue with no exit.
 *
 * What is still refused is the thing §6 is about: ONE PERSON, BOTH SIGNATURES.
 */
test('the filer signs the step their own filing is waiting at, and nothing else', () => {
  const own = engEntry({ filedBy: A, employee: WORKER });

  const atTheirStep = approvalPermission({
    user: A, entry: own, delegations: [], today: '2026-08-06',
  });
  assert.equal(atTheirStep.ok, true, 'รอหัวหน้า — this is the press HR asked for');
  assert.equal(atTheirStep.stage, 'mgr');

  // The same row one step further on. Somebody else signed the หัวหน้า step;
  // the filer is still not the second pair of eyes on their own filing.
  const atHr = approvalPermission({
    user: A,
    entry: engEntry({ ...own, status: 'pending_hr' }),
    delegations: [],
    today: '2026-08-06',
  });
  assert.equal(atHr.ok, false, 'and not the ฝ่ายบุคคล step of it');
  assert.equal(atHr.status, 403);
  assert.match(atHr.error, /ผู้เซ็นสองคน/);
});

test('having filed it, they may not sign it twice either', () => {
  // The หัวหน้า step is theirs to press once. `signedManagerStep` is what stops
  // the same press being counted as the ฝ่ายบุคคล one, and it is asked of the
  // person who PRESSED — see its own note.
  const signed = engEntry({
    filedBy: A, employee: WORKER, status: 'pending_hr',
    managerDecision: { by: A._id, at: new Date() },
  });
  const may = approvalPermission({ user: A, entry: signed, delegations: [], today: '2026-08-06' });
  assert.equal(may.ok, false);
});

test('a stand-in signs a filing of their own at that step too — one rule, not two', () => {
  /**
   * C filed into their own team; A is standing in for C that week. Refused
   * outright before 2026-09-09, allowed now, and the widening is deliberate
   * rather than accidental: the refusal is written against the ENTRY'S STEP and
   * not against how the reviewer's claim was come by, so that the browser —
   * which is never told about delegations — can ask the identical question.
   *
   * No route creates this row. `proxyPermission` lets a หัวหน้า file only for
   * their own แผนก, so every filing that exists is one its filer could sign in
   * their own right, exactly as `initialStatus` assumes. The two readings pick
   * out the same entries; only this one can be asked from a screen.
   */
  const CtoA = { _id: 'del-9', from: C, to: A, fromDate: '2026-08-05', toDate: '2026-08-12' };
  const viaDelegation = approvalPermission({
    user: A,
    entry: engEntry({ department: SALES, filedBy: A }),
    delegations: [CtoA],
    today: '2026-08-06',
  });
  assert.equal(viaDelegation.ok, true);
  assert.equal(viaDelegation.stage, 'mgr');
});

test('a colleague may still approve what somebody else filed', () => {
  // The rule is about the one person, not about proxy filings in general.
  const filedByC = engEntry({ filedBy: C });
  assert.equal(
    approvalPermission({ user: A, entry: filedByC, delegations: [], today: '2026-08-06' }).ok,
    true,
  );
});

/**
 * The screen has to be able to ask the same question.
 *
 * A queue that offered ยืนยัน and ไม่อนุมัติ on a row where both are refused sent
 * the reviewer round in circles — press, 403, press the other one, the same 403,
 * with nothing saying what to do instead. That happened with ฝ่ายบุคคล's own
 * generated birthday rows. So the first clause of `approvalPermission` is an
 * exported predicate, and these two must agree: if they drift, the queue either
 * hides work somebody could do or offers work the server will refuse.
 */
test('isOwnFiling works on the shape the BROWSER holds, not only the server one', () => {
  /**
   * The bug this exists to stop coming back. `publicUser()` hands the client
   * `id`; the server holds `_id`. Compared with `idOf`, a client-side user turned
   * into "[object Object]" and every row read as "not yours" — so the queue went
   * on offering two buttons the server refuses, and the failure was invisible
   * because both sides answered the same word for different reasons.
   */
  const entry = engEntry({ filedBy: A, employee: WORKER });
  const serverUser = A;                                    // mongoose-shaped: _id
  const clientUser = { id: String(A._id), role: A.role };  // publicUser-shaped: id

  assert.equal(isOwnFiling(entry, serverUser), true, 'server shape');
  assert.equal(isOwnFiling(entry, clientUser), true, 'client shape');

  // And a different person, in both shapes, is still not the filer.
  assert.equal(isOwnFiling(entry, C), false);
  assert.equal(isOwnFiling(entry, { id: String(C._id), role: C.role }), false);
});

test('barredAsOwnFiling is exactly the refusal approvalPermission gives', () => {
  /**
   * `isOwnFiling` ANSWERS "did you write it" AND IS NO LONGER THE REFUSAL — the
   * queue asks the second question, so the second question is what has to match
   * the server. Every row here is at `pending_hr`, which is where the two
   * questions part company: at `pending_mgr` the filer decides their own row.
   */
  const hr = (over) => engEntry({ status: 'pending_hr', ...over });
  const cases = [
    ['filed by the reviewer', hr({ filedBy: A, employee: WORKER }), A, true],
    ['filed by somebody else', hr({ filedBy: C, employee: WORKER }), A, false],
    ['self-filed by the employee', hr({ filedBy: WORKER, employee: WORKER }), A, false],
    ['no filedBy recorded at all', hr({ employee: WORKER }), A, false],
  ];

  for (const [why, entry, user, expected] of cases) {
    assert.equal(barredAsOwnFiling(entry, user), expected, why);

    const decision = approvalPermission({ user, entry, delegations: [], today: '2026-08-06' });
    assert.equal(decision.ok, false, `${why} — a หัวหน้า signs no ฝ่ายบุคคล step`);
    // The rows the reviewer wrote are refused for THIS reason and not for the
    // ordinary "wrong step" one, which is the whole point of the predicate.
    if (expected) assert.match(decision.error, /ผู้เซ็นสองคน/, why);
    else assert.equal(decision.status, 409, why);
  }

  // And the same four rows at the step a filing actually waits at: only the
  // reviewer's own is theirs to press, and it is not refused.
  assert.equal(
    barredAsOwnFiling(engEntry({ filedBy: A, employee: WORKER }), A), false,
    'รอหัวหน้า — the filer is the one being waited for',
  );
});

// ── the rules that stop a chain forming ─────────────────────────────────────

const window = { fromDate: '2026-08-05', toDate: '2026-08-12' };
const grant = (over = {}) => ({ actor: A, from: A, to: B, window, existing: [], ...over });

test('a manager may nominate their own stand-in', () => {
  assert.deepEqual(delegationPermission(grant()), { ok: true });
});

test('ฝ่ายบุคคล may nominate one for a manager who cannot log in to do it', () => {
  // The case the feature exists for. A rule that works only while the person
  // is well is not a rule for absence.
  assert.equal(delegationPermission(grant({ actor: HR })).ok, true);
  assert.equal(delegationPermission(grant({ actor: ADMIN })).ok, true);
});

test('nobody else nominates a stand-in for somebody else’s queue', () => {
  const may = delegationPermission(grant({ actor: C }));
  assert.equal(may.ok, false);
  assert.equal(may.status, 403);
});

test('the stand-in must be a หัวหน้างาน or ฝ่ายบุคคล', () => {
  const may = delegationPermission(grant({ to: WORKER }));
  assert.equal(may.ok, false);
  assert.equal(may.status, 400);
  assert.match(may.error, /หัวหน้างานหรือฝ่ายบุคคล/);
});

test('only a manager’s queue is delegated — there is no HR queue to hand over', () => {
  assert.equal(delegationPermission(grant({ actor: HR, from: HR, to: B })).ok, false);
});

test('a window is required, and has to run forwards', () => {
  assert.equal(delegationPermission(grant({ window: {} })).status, 400);
  assert.equal(delegationPermission(grant({ window: { fromDate: '2026-08-05' } })).status, 400);
  assert.equal(
    delegationPermission(grant({ window: { fromDate: '2026-08-12', toDate: '2026-08-05' } })).status,
    400,
  );
});

test('a single day is a valid window', () => {
  assert.equal(
    delegationPermission(grant({ window: { fromDate: '2026-08-05', toDate: '2026-08-05' } })).ok,
    true,
  );
});

test('nobody delegates to themselves', () => {
  assert.equal(delegationPermission(grant({ to: A })).ok, false);
});

test('no chains: B has given their own queue away, so B cannot take A’s', () => {
  const BtoC = { _id: 'd', from: B, to: C, fromDate: '2026-08-01', toDate: '2026-08-31' };
  const may = delegationPermission(grant({ existing: [BtoC] }));
  assert.equal(may.ok, false);
  assert.equal(may.status, 409);
  assert.match(may.error, /เป็นทอด/);
});

test('no chains the other way either: A is holding somebody else’s queue', () => {
  const CtoA = { _id: 'd', from: C, to: A, fromDate: '2026-08-01', toDate: '2026-08-31' };
  const may = delegationPermission(grant({ existing: [CtoA] }));
  assert.equal(may.ok, false);
  assert.equal(may.status, 409);
  assert.match(may.error, /เป็นทอด/);
});

test('a chain that shares no day is not a chain', () => {
  // B delegating in September says nothing about B standing in during August.
  const BtoC = { _id: 'd', from: B, to: C, fromDate: '2026-09-01', toDate: '2026-09-30' };
  assert.equal(delegationPermission(grant({ existing: [BtoC] })).ok, true);
});

test('a revoked delegation is not in the way of a new one', () => {
  const BtoC = {
    _id: 'd', from: B, to: C, fromDate: '2026-08-01', toDate: '2026-08-31', revokedAt: new Date(),
  };
  assert.equal(delegationPermission(grant({ existing: [BtoC] })).ok, true);
});

test('the same pair twice over the same days is refused as redundant', () => {
  const may = delegationPermission(grant({ existing: [AtoB] }));
  assert.equal(may.ok, false);
  assert.equal(may.status, 409);
});

// ── and the loop check behind them ──────────────────────────────────────────

test('A → B → A is a cycle and is refused', () => {
  const may = delegationPermission(grant({ actor: B, from: B, to: A, existing: [AtoB] }));
  assert.equal(may.ok, false);
  assert.equal(may.status, 409);
});

/**
 * The depth rules above make a loop unreachable on their own — nothing can be
 * both a giver and a receiver, so no path is ever two edges long. That holds
 * only if every row went through them, and rows fixed by hand did not. This is
 * the check that does not depend on the others having worked.
 */
test('the loop is found by walking, not by counting one link', () => {
  const chain = [
    { from: A, to: B, fromDate: '2026-08-01', toDate: '2026-08-31' },
    { from: B, to: C, fromDate: '2026-08-01', toDate: '2026-08-31' },
  ];
  assert.equal(wouldCycle(chain, C, A), true, 'C → A closes A → B → C');
  assert.equal(wouldCycle(chain, C, B), true);
  assert.equal(wouldCycle(chain, A, C), false, 'a longer path in the same direction is not a loop');
});

test('a two-step loop and a self-loop are both found', () => {
  assert.equal(wouldCycle([{ from: A, to: B }], B, A), true);
  assert.equal(wouldCycle([], A, A), true);
});

test('an empty graph closes nothing', () => {
  assert.equal(wouldCycle([], A, B), false);
  assert.equal(wouldCycle(undefined, A, B), false);
});

// ── what the record says afterwards ─────────────────────────────────────────

test('the trail says B approved on A’s behalf, never just that B approved', () => {
  const resolved = { stage: 'mgr', onBehalfOf: A, delegationId: 'del-1' };
  const at = new Date('2026-08-06T09:00:00Z');
  const record = approvalRecord(B, resolved, { note: 'ตรวจกับเวลาสแกนแล้ว', at });

  assert.equal(record.by, 'mgr-b', 'the person who pressed the button, always');
  assert.equal(record.onBehalfOf, 'mgr-a');
  assert.equal(record.onBehalfOfName, 'สมชาย', 'copied, so it survives them leaving');
  assert.equal(record.delegationId, 'del-1', 'and where the authority came from');
  assert.equal(record.at, at);
});

test('an ordinary approval carries none of it, so the mark means something', () => {
  const record = approvalRecord(A, { stage: 'mgr', onBehalfOf: null, delegationId: null });
  assert.equal(record.by, 'mgr-a');
  assert.equal(record.onBehalfOf, undefined);
  assert.equal(record.onBehalfOfName, undefined);
  assert.equal(record.delegationId, undefined);
});

test('the history row carries the same facts as the decision block', () => {
  const resolved = { stage: 'mgr', onBehalfOf: A, delegationId: 'del-1' };
  assert.deepEqual(historyExtra(resolved), {
    onBehalfOf: 'mgr-a',
    onBehalfOfName: 'สมชาย',
    delegationId: 'del-1',
    // Absent on an ordinary delegated decision, and `undefined` rather than
    // `false` — see the field on `approvalRecord`. A stored `false` would read
    // as an assertion about entries that predate the question.
    adminOverride: undefined,
  });
});

test('an administrator’s override reaches the history row as its own fact', () => {
  // The three delegation fields are all empty for it, which is exactly why it
  // cannot be inferred from them.
  assert.deepEqual(historyExtra({ stage: 'mgr', adminOverride: true }), {
    onBehalfOf: undefined,
    onBehalfOfName: undefined,
    delegationId: undefined,
    adminOverride: true,
  });
});

test('a name alone cannot answer why B was allowed to sign — the pointer can', () => {
  // The whole argument for keeping three fields rather than one. Given only
  // `by`, there is nothing on the entry to check a disputed approval against.
  const record = approvalRecord(B, { onBehalfOf: A, delegationId: 'del-1' });
  assert.ok(record.delegationId, 'the record points at a window with dates on it');
});

// ── what an expiry does and does not touch ──────────────────────────────────

/**
 * B approves half the queue and the window closes. The rest goes back to A —
 * which is what the date test above already says. This is the other half, and
 * it is here because it is the one somebody reading this later might "fix":
 * an approval is an event that happened, not a permission re-evaluated on
 * every read. Nothing recomputes one, and nothing should.
 */
test('entries approved under a delegation keep their status after it expires', () => {
  const approved = engEntry({
    status: 'pending_hr',
    managerDecision: {
      by: 'mgr-b', at: new Date('2026-08-06T09:00:00Z'),
      onBehalfOf: 'mgr-a', onBehalfOfName: 'สมชาย', delegationId: 'del-1',
    },
  });

  // Long after the window shut, the decision is still on the entry, still
  // naming both people, and the entry is still where it was put.
  assert.equal(isLive(AtoB, '2026-09-01'), false);
  assert.equal(approved.status, 'pending_hr');
  assert.equal(approved.managerDecision.onBehalfOfName, 'สมชาย');

  // And HR confirms it on its own merits — the expiry is not their problem.
  const may = approvalPermission({
    user: HR, entry: approved, delegations: [], today: '2026-09-01',
  });
  assert.equal(may.ok, true);
  assert.equal(may.stage, 'hr');
});

test('what the expiry does change is the queue, from that day on', () => {
  const stillPending = engEntry();
  assert.equal(
    approvalPermission({ user: B, entry: stillPending, delegations: [AtoB], today: '2026-08-12' }).ok,
    true,
  );
  assert.equal(
    approvalPermission({ user: B, entry: stillPending, delegations: [AtoB], today: '2026-08-13' }).ok,
    false,
  );
});

// ── the queue a stand-in reads ──────────────────────────────────────────────

test('a stand-in sees their own team and the one they are covering, both', () => {
  const held = receivedOn([AtoB], B, '2026-08-06');
  const extra = delegatedClaims(held, B, '2026-08-06');
  assert.deepEqual(extra, [{ department: ENG, company: null }]);
  // The ids alongside, for the chip on the row and the count of covered teams.
  assert.deepEqual(delegatedDepartments(held, B, '2026-08-06'), [ENG]);

  assert.deepEqual(scopeFor(B, extra), { department: { $in: [QA, ENG] } });
});

test('with nothing delegated the scope is exactly what it always was', () => {
  assert.deepEqual(scopeFor(B, []), { department: QA });
  assert.deepEqual(scopeFor(WORKER, []), { employee: 'emp-1' });
});

test('standing in never narrows ฝ่ายบุคคล, who already see everything', () => {
  // Widening a scope that is not narrow would be narrowing it — the one way
  // this could go wrong, and it would go wrong silently.
  assert.deepEqual(scopeFor(HR, [{ department: ENG }, { department: QA }]), {});
  assert.deepEqual(scopeFor(ADMIN, [{ department: ENG }]), {});
});

/**
 * And the covered list never reaches `scopeFor` for them in the first place.
 *
 * Two defences for one mistake, because the mistake has no symptom: a
 * ฝ่ายบุคคล whose ตรวจสอบรายเดือน quietly showed one department would look
 * like a month with less OT in it, not like a bug. What they are missing while
 * standing in is a SCREEN, not access — that is `scope=delegated`.
 */
test('the covered list is only handed to somebody it would widen', () => {
  assert.deepEqual(scopeWidening(B, [ENG]), [ENG], 'a manager is narrowed, so it widens');
  assert.deepEqual(scopeWidening(HR, [ENG]), []);
  assert.deepEqual(scopeWidening(ADMIN, [ENG]), []);
  assert.deepEqual(scopeWidening(WORKER, [ENG]), []);
  assert.deepEqual(scopeWidening(B), [], 'and nothing covered is not an error');
});

// ── what the screens are handed ─────────────────────────────────────────────

test('a delegation reports which of the four states it is in', () => {
  const on = (date) => publicDelegation({ ...AtoB, _id: 'del-1' }, date).state;
  assert.equal(on('2026-08-04'), 'scheduled');
  assert.equal(on('2026-08-06'), 'active');
  assert.equal(on('2026-08-13'), 'expired');
  assert.equal(publicDelegation({ ...AtoB, revokedAt: new Date() }, '2026-08-06').state, 'revoked');
});

test('“has not started” and “has run out” are told apart, because the fix differs', () => {
  // One means wait until Monday; the other means the dates were typed
  // backwards. A single "not active" would leave the person guessing.
  assert.notEqual(publicDelegation(AtoB, '2026-08-04').state, publicDelegation(AtoB, '2026-08-13').state);
});

/**
 * ── ประโยคที่บอกว่าการอนุมัติของผู้รับช่วงทิ้งอะไรไว้ มีฉบับเดียว ────────────
 *
 * ⚠ มันมีสองฉบับจนถึง 2026-09-12
 *
 * แถบบนสุดของคิวรออนุมัติพูดกับ*ผู้รับช่วง* การ์ดในหน้าผู้รับช่วงอนุมัติแทน
 * พูดกับ*คนที่ตั้งผู้รับช่วง* — คนละหน้าจอ คนละคนอ่าน แต่ทั้งคู่ต้องบอกสิ่ง
 * เดียวกัน คือระบบบันทึกอะไรไว้เมื่อผู้รับช่วงกดอนุมัติ และทั้งคู่เขียนเอง
 * ฉบับหนึ่งว่า `ชื่อหัวหน้าเจ้าของคิว` อีกฉบับว่า `พร้อมชื่อหัวหน้างานเจ้าของคิว`
 *
 * แบ่งกันแค่ท่อนกลาง และนั่นคือทั้งหมดของการออกแบบ: ประธานเป็นของแต่ละจอ
 * เพราะประธานคือคนอ่าน และหางก็เป็นของแต่ละจอ เพราะสิ่งที่คนอ่านต้องรู้ต่อไป
 * ไม่เหมือนกัน สิ่งที่ไม่มีจอไหนเป็นเจ้าของได้คือประโยคตรงกลาง เพราะมันคือคำ
 * อธิบายว่า*ระบบ*เก็บอะไร และระบบที่อธิบายบันทึกของตัวเองสองแบบ คือระบบที่มี
 * บันทึกสองชุดในสายตาคนอ่าน
 */
test('สองจอพูดเรื่องบันทึก “ทำแทน” ด้วยประโยคกลางเดียวกัน', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = (p) => readFileSync(join(root, p), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const queue = src('components/ApprovalQueue.jsx');
  const card = src('components/Delegation.jsx');

  // ทั้งสองจออ่านจากที่เดียวกัน
  for (const [name, code] of [['คิวรออนุมัติ', queue], ['ผู้รับช่วงอนุมัติแทน', card]]) {
    assert.ok(
      code.includes('DELEGATED_APPROVAL_RECORDED'),
      `${name} เลิกอ่านประโยคกลางจาก lib/delegation.js`,
    );
    assert.ok(
      !code.includes('ทั้งในประวัติรายการและบนใบพิมพ์'),
      `${name} พิมพ์ประโยคกลางเป็นตัวอักษรเองอีกแล้ว`,
    );
  }

  // และประธานกับหางยังเป็นของแต่ละจอ ไม่ได้ถูกกลืนเข้าไปในค่าคงที่ด้วย
  assert.ok(queue.includes('การอนุมัติของคุณ') && queue.includes('หัวหน้าเจ้าของคิวยังอนุมัติเองได้ตลอดเวลา'));
  assert.ok(card.includes('ทุกการอนุมัติของผู้รับช่วง') && card.includes('มอบหมายต่อเป็นทอดไม่ได้'));

  // ประโยคกลางขึ้นต้นด้วยกริยา ไม่ใช่ประธาน — ไม่อย่างนั้นจอไหนก็ต่อหน้ามันไม่ได้
  const lib = readFileSync(join(root, 'lib/delegation.js'), 'utf8');
  assert.match(lib, /export const DELEGATED_APPROVAL_RECORDED = 'จะถูกบันทึกว่า /);
});
