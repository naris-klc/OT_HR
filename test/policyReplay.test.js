import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSession, makeIsHoliday, resolveDayTypes, sessionDates,
} from '../src/lib/otEngine.js';
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

/**
 * What otService.contextFor builds, with the policy taken from a version row.
 *
 * Per session rather than per version, because day types are resolved against
 * the dates a particular session touches — and, once the birthday rule is on,
 * against whose session it is.
 */
const contextOf = (version, session, birthDate = null) => ({
  policy: version.policy,
  dayTypes: resolveDayTypes(sessionDates(session), {
    isHoliday: makeIsHoliday(HOLIDAYS, version.policy),
    birthDate,
    policy: version.policy,
  }),
});

const SESSIONS = [
  { workDate: '2026-08-03', startTime: '17:00', endTime: '20:20', endsNextDay: false },
  { workDate: '2026-08-08', startTime: '08:00', endTime: '17:00', endsNextDay: false },
  { workDate: '2026-08-12', startTime: '08:00', endTime: '22:15', endsNextDay: false },
  { workDate: '2026-08-14', startTime: '17:00', endTime: '07:00', endsNextDay: true },
  { workDate: '2026-08-17', startTime: '17:00', endTime: '17:20', endsNextDay: false },
];

/**
 * What the engine did with a session — the figures, or the refusal.
 *
 * A refusal is an outcome like any other and has to reproduce like one. Under
 * the shipped `belowMinimum: 'reject'` the last session below is not a filable
 * entry at all, and replaying it against the rules that refused it must refuse
 * it again for the same stated reason. Comparing only successful results would
 * quietly skip that case rather than check it.
 */
const outcomeOf = (session, version) => {
  try {
    return { result: computeSession(session, contextOf(version, session)) };
  } catch (err) {
    return { code: err.code };
  }
};

test('replaying against the version an entry names reproduces its hours exactly', () => {
  for (const session of SESSIONS) {
    const filed = outcomeOf(session, V1);

    // Three months later, from the stored snapshot alone.
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(
        outcomeOf(session, V1),
        filed,
        `${session.workDate} ${session.startTime}–${session.endTime} did not reproduce`,
      );
    }
  }
});

test('the same session under a different version is a different figure — which is the point', () => {
  const session = SESSIONS[2];
  const under1 = computeSession(session, contextOf(V1, session));
  const under2 = computeSession(session, contextOf(V2, session));
  assert.notEqual(
    under1.totals.otHours,
    under2.totals.otHours,
    'the two versions were expected to disagree, or this test proves nothing',
  );
});

test('a version snapshot is not disturbed by computing against it', () => {
  const before = JSON.stringify(V1.policy);
  // Refusals included: a policy that a rejected session mutated on its way out
  // would be exactly as broken as one a successful session mutated.
  for (const session of SESSIONS) outcomeOf(session, V1);
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
  for (const e of month) e.otHours = computeSession(e.session, contextOf(V1, e.session)).totals.otHours;
  const filed = month.map((e) => e.otHours);

  const { replay, skipped } = planRecompute(month);

  // HR answers OPEN 3. The replay runs against version 2 and stamps it.
  for (const entry of replay) {
    entry.otHours = computeSession(entry.session, contextOf(V2, entry.session)).totals.otHours;
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

/**
 * The same rule, for the one policy flag whose answer differs per employee.
 *
 * Worth its own case rather than trusting the general one above: every other
 * [OPEN] answer moves every entry the same way, so a replay that lost track of
 * WHO an entry belongs to would still look right. This one does not. The
 * birthday holiday moves one person's Tuesday and nobody else's, and an entry
 * replayed against the wrong employee's day types comes out plausible and
 * wrong — which is why `recomputeEntries` resolves them per entry rather than
 * once per run.
 */
test('เปิดกฎวันเกิด — ใบ pending ถูก replay ได้ version ใหม่ ใบ approved ไม่ขยับ', () => {
  const BIRTHDAY_OFF = { _id: 'v3', seq: 3, policy: { ...DEFAULT_POLICY } };
  const BIRTHDAY_ON = {
    _id: 'v4',
    seq: 4,
    policy: { ...DEFAULT_POLICY, birthdayHolidayEnabled: true },
  };

  // A Tuesday evening. 4 Aug 2026 is the birthday of one of these two people.
  const session = { workDate: '2026-08-04', startTime: '17:00', endTime: '20:00' };
  const BIRTHDAY_PERSON = '1994-08-04';
  const COLLEAGUE = '1990-11-23';

  const month = [
    { _id: 'a', status: 'pending_mgr', session, birthDate: BIRTHDAY_PERSON, policyVersionId: 'v3' },
    { _id: 'b', status: 'pending_hr', session, birthDate: COLLEAGUE, policyVersionId: 'v3' },
    { _id: 'c', status: 'approved', session, birthDate: BIRTHDAY_PERSON, policyVersionId: 'v3' },
  ];
  for (const e of month) {
    e.buckets = computeSession(e.session, contextOf(BIRTHDAY_OFF, e.session, e.birthDate)).buckets;
  }
  const filed = month.map((e) => ({ ...e.buckets }));

  // Everybody's hours start in the ordinary weekday evening column.
  for (const e of month) assert.equal(e.buckets.ot15_weekday, 3);

  // HR turns the rule on. Only what is still in flight is replayed.
  const { replay, skipped } = planRecompute(month);
  for (const entry of replay) {
    entry.buckets = computeSession(
      entry.session,
      contextOf(BIRTHDAY_ON, entry.session, entry.birthDate),
    ).buckets;
    entry.policyVersionId = 'v4';
  }

  const [a, b, c] = month;

  // The pending entry belonging to the birthday employee moved columns.
  assert.equal(a.policyVersionId, 'v4');
  assert.equal(a.buckets.ot3_holiday, 3);
  assert.equal(a.buckets.ot15_weekday, 0);

  // Their colleague, same date, same hours, same replay — unchanged. This is
  // the assertion a per-run context would fail.
  assert.equal(b.policyVersionId, 'v4');
  assert.deepEqual(b.buckets, filed[1], 'a colleague on the same Tuesday did not move');

  // And the signed-off one did not move at all, birthday or not.
  assert.equal(c.policyVersionId, 'v3', 'an approved entry kept its original version');
  assert.deepEqual(c.buckets, filed[2], 'an approved entry kept its original hours');
  assert.deepEqual(skipped, [{ id: 'c', reason: 'approved' }]);
});

test('and the approved entry still reproduces from the version it kept', () => {
  const session = SESSIONS[2];
  const approved = {
    status: 'approved',
    policyVersionId: V1._id,
    otHours: computeSession(session, contextOf(V1, session)).totals.otHours,
  };
  const versions = new Map([[V1._id, V1], [V2._id, V2]]);

  // Months later, HR asks where the number came from. The answer is the
  // snapshot the pointer names — not the policy in force by then.
  const named = versions.get(approved.policyVersionId);
  assert.equal(computeSession(session, contextOf(named, session)).totals.otHours, approved.otHours);
});
