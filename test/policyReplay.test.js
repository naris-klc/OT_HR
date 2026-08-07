import test from 'node:test';
import assert from 'node:assert/strict';

import { computeSession, makeIsHoliday } from '../src/lib/otEngine.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import { planRecompute, samePolicy } from '../lib/policyVersion.js';

/**
 * What a version pointer is worth: replaying an entry against the rules it
 * names has to give back the figures it already carries, every time.
 *
 * If it does not, the pointer is decoration — HR would be reading "computed
 * under version 2" beside hours that version 2 does not produce, which is worse
 * than no label at all. This is the property that makes the whole scheme
 * checkable, so it is checked against the real engine rather than a stand-in.
 *
 * `otEngine` stays a pure function of (session, policy) for exactly this
 * reason. It never reads a version, a database or a clock; the caller resolves
 * the policy and hands it over, and that is what makes a replay reproducible
 * three months later.
 */

/** A stored version row, as the collection keeps it: the whole policy, frozen. */
const V1 = {
  _id: 'v1',
  seq: 1,
  policy: { ...DEFAULT_POLICY },
};

const V2 = {
  _id: 'v2',
  seq: 2,
  policy: { ...DEFAULT_POLICY, roundingMode: 'ceil', breakMode: 'always' },
};

const HOLIDAYS = new Set(['2026-08-12']);

/** What otService.loadContext builds, with the policy taken from a version row. */
const contextOf = (version) => ({
  policy: version.policy,
  isHoliday: makeIsHoliday(HOLIDAYS, version.policy),
});

const SESSIONS = [
  { workDate: '2026-08-03', startTime: '17:00', endTime: '20:20', endsNextDay: false },
  { workDate: '2026-08-08', startTime: '08:00', endTime: '17:00', endsNextDay: false },
  { workDate: '2026-08-12', startTime: '08:00', endTime: '22:15', endsNextDay: false },
  { workDate: '2026-08-14', startTime: '17:00', endTime: '07:00', endsNextDay: true },
  { workDate: '2026-08-17', startTime: '17:00', endTime: '17:20', endsNextDay: false },
];

test('replaying against the version an entry names reproduces its hours exactly', () => {
  for (const session of SESSIONS) {
    const filed = computeSession(session, contextOf(V1));

    // Three months later, from the stored snapshot alone.
    for (let i = 0; i < 3; i++) {
      const replayed = computeSession(session, contextOf(V1));
      assert.deepEqual(
        replayed,
        filed,
        `${session.workDate} ${session.startTime}–${session.endTime} did not reproduce`,
      );
    }
  }
});

test('the same session under a different version is a different figure — which is the point', () => {
  const session = SESSIONS[2];
  const under1 = computeSession(session, contextOf(V1));
  const under2 = computeSession(session, contextOf(V2));
  assert.notEqual(
    under1.totals.otHours,
    under2.totals.otHours,
    'the two versions were expected to disagree, or this test proves nothing',
  );
});

test('a version snapshot is not disturbed by computing against it', () => {
  const before = JSON.stringify(V1.policy);
  for (const session of SESSIONS) computeSession(session, contextOf(V1));
  assert.equal(JSON.stringify(V1.policy), before);
  assert.equal(samePolicy(V1.policy, DEFAULT_POLICY), true);
});

/**
 * The rule the requirement is about: HR answers an [OPEN] item mid-month, and
 * afterwards the pending entries are on the new rules and the signed-off ones
 * are still on the old — with each row saying which.
 *
 * Modelled here as the two halves that decide it, both pure: `planRecompute`
 * chooses who is replayed, and the engine says what they come out as. The
 * stamping itself is one assignment in `applyComputation`, driven by the
 * context the same call already carries.
 */
test('changing a policy moves the entries in flight and leaves the signed-off ones', () => {
  const month = [
    { _id: 'a', status: 'pending_mgr', session: SESSIONS[2], policyVersionId: V1._id },
    { _id: 'b', status: 'pending_hr', session: SESSIONS[2], policyVersionId: V1._id },
    { _id: 'c', status: 'approved', session: SESSIONS[2], policyVersionId: V1._id },
  ];
  // The hours each one carries, all computed under version 1.
  for (const e of month) e.otHours = computeSession(e.session, contextOf(V1)).totals.otHours;
  const filed = month.map((e) => e.otHours);

  const { replay, skipped } = planRecompute(month);

  // HR answers OPEN 3. The replay runs against version 2 and stamps it.
  for (const entry of replay) {
    entry.otHours = computeSession(entry.session, contextOf(V2)).totals.otHours;
    entry.policyVersionId = V2._id;
  }

  const [a, b, c] = month;
  assert.equal(a.policyVersionId, 'v2');
  assert.equal(b.policyVersionId, 'v2');
  assert.equal(c.policyVersionId, 'v1', 'an approved entry kept its original version');
  assert.equal(c.otHours, filed[2], 'an approved entry kept its original hours');
  assert.notEqual(a.otHours, filed[0], 'a pending entry was recomputed');

  assert.deepEqual(skipped, [{ id: 'c', reason: 'approved' }]);
});

test('and the approved entry still reproduces from the version it kept', () => {
  const session = SESSIONS[2];
  const approved = {
    status: 'approved',
    policyVersionId: V1._id,
    otHours: computeSession(session, contextOf(V1)).totals.otHours,
  };
  const versions = new Map([[V1._id, V1], [V2._id, V2]]);

  // Months later, HR asks where the number came from. The answer is the
  // snapshot the pointer names — not the policy in force by then.
  const named = versions.get(approved.policyVersionId);
  assert.equal(computeSession(session, contextOf(named)).totals.otHours, approved.otHours);
});
