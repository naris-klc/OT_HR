import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARITHMETIC_KEYS,
  arithmeticOf,
  canonicalPolicy,
  diffPolicy,
  planBackfill,
  planRecompute,
  samePolicy,
  sameArithmetic,
  versionIdOf,
  versionSpread,
} from '../lib/policyVersion.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';

/**
 * The rules that decide what a version means and who is allowed to be moved by
 * a new one. Every one of them is a pure function over data the database would
 * otherwise be the only witness to.
 */

// ── identity ────────────────────────────────────────────────────────────────

test('two policies with the same answers are the same policy, whatever order they were built in', () => {
  const a = { roundingMode: 'floor', breakMode: 'lunchWindow', minimumHours: 1 };
  const b = { minimumHours: 1, breakMode: 'lunchWindow', roundingMode: 'floor' };
  assert.equal(canonicalPolicy(a), canonicalPolicy(b));
  assert.equal(samePolicy(a, b), true);
});

test('an array value is compared in order — weekendDays is a list, not a set', () => {
  assert.equal(samePolicy({ weekendDays: [0, 6] }, { weekendDays: [0, 6] }), true);
  assert.equal(samePolicy({ weekendDays: [0, 6] }, { weekendDays: [6, 0] }), false);
});

test('one changed answer is one changed policy', () => {
  assert.equal(samePolicy(DEFAULT_POLICY, { ...DEFAULT_POLICY, roundingMode: 'ceil' }), false);
});

// ── arithmetic vs everything else ───────────────────────────────────────────

test('the flags that move numbers are the ones that make figures incomparable', () => {
  const rounded = { ...DEFAULT_POLICY, roundingMode: 'ceil' };
  assert.equal(sameArithmetic(DEFAULT_POLICY, rounded), false);
});

test('a permission change is a new policy but the same arithmetic', () => {
  const permission = { ...DEFAULT_POLICY, hrMayReject: false, hrRejectReturnsTo: 'manager' };
  assert.equal(samePolicy(DEFAULT_POLICY, permission), false);
  assert.equal(sameArithmetic(DEFAULT_POLICY, permission), true);
});

test('every arithmetic key names a real policy flag', () => {
  for (const key of ARITHMETIC_KEYS) {
    assert.ok(key in DEFAULT_POLICY, `${key} is not in DEFAULT_POLICY`);
  }
});

test('arithmeticOf ignores keys a policy does not carry rather than inventing undefined ones', () => {
  assert.deepEqual(arithmeticOf({ roundingMode: 'floor', hrMayReject: true }), { roundingMode: 'floor' });
  assert.deepEqual(arithmeticOf(null), {});
});

// ── diff ────────────────────────────────────────────────────────────────────

test('a diff names what moved, from what, to what — and whether it counts', () => {
  const after = { ...DEFAULT_POLICY, roundingMode: 'ceil', hrMayReject: false };
  const changes = diffPolicy(DEFAULT_POLICY, after);
  assert.deepEqual(changes.map((c) => c.key).sort(), ['hrMayReject', 'roundingMode']);

  const rounding = changes.find((c) => c.key === 'roundingMode');
  assert.deepEqual(rounding, { key: 'roundingMode', from: 'floor', to: 'ceil', arithmetic: true });
  assert.equal(changes.find((c) => c.key === 'hrMayReject').arithmetic, false);
});

test('an unchanged policy diffs to nothing', () => {
  assert.deepEqual(diffPolicy(DEFAULT_POLICY, { ...DEFAULT_POLICY }), []);
});

test('the origin version diffs against nothing and lists its whole snapshot', () => {
  const changes = diffPolicy(null, { roundingMode: 'floor', minimumHours: 1 });
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0], { key: 'minimumHours', from: undefined, to: 1, arithmetic: true });
});

// ── which version an entry is on ────────────────────────────────────────────

test('a version pointer reads the same bare as it does populated', () => {
  assert.equal(versionIdOf({ policyVersionId: 'v1' }), 'v1');
  assert.equal(versionIdOf({ policyVersionId: { _id: 'v1', seq: 1 } }), 'v1');
  assert.equal(versionIdOf({ policyVersionId: null }), null);
  assert.equal(versionIdOf({}), null);
  assert.equal(versionIdOf(null), null);
});

// ── the banner ──────────────────────────────────────────────────────────────

const V1 = { _id: 'v1', seq: 1, policy: DEFAULT_POLICY };
const V2 = { _id: 'v2', seq: 2, policy: { ...DEFAULT_POLICY, roundingMode: 'ceil' } };
const V3 = { _id: 'v3', seq: 3, policy: { ...DEFAULT_POLICY, hrMayReject: false } };

const on = (id, n = 1) => Array.from({ length: n }, () => ({ policyVersionId: id }));

test('a month computed under one set of rules raises nothing', () => {
  const spread = versionSpread(on('v1', 4), [V1]);
  assert.equal(spread.mixed, false);
  assert.equal(spread.arithmeticMixed, false);
  assert.equal(spread.unversioned, 0);
  assert.deepEqual(spread.used, [{ id: 'v1', count: 4, seq: 1 }]);
});

test('two versions whose arithmetic differs is the case HR must be stopped on', () => {
  const spread = versionSpread([...on('v1', 3), ...on('v2', 2)], [V1, V2]);
  assert.equal(spread.mixed, true);
  assert.equal(spread.arithmeticMixed, true);
  // Newest first — the rules a reader is already holding in their head.
  assert.deepEqual(spread.used, [{ id: 'v2', count: 2, seq: 2 }, { id: 'v1', count: 3, seq: 1 }]);
});

test('two versions that compute identically are mixed but comparable', () => {
  const spread = versionSpread([...on('v1', 3), ...on('v3', 1)], [V1, V3]);
  assert.equal(spread.mixed, true);
  assert.equal(spread.arithmeticMixed, false);
});

test('an entry with no version at all is its own kind of mixture', () => {
  const spread = versionSpread([...on('v1', 2), { policyVersionId: null }], [V1]);
  assert.equal(spread.unversioned, 1);
  assert.equal(spread.mixed, true);
  // Unrecorded rules cannot be compared to recorded ones. Not false — unknown.
  assert.equal(spread.arithmeticMixed, null);
});

test('a month of entries that all predate versioning is uniform, not mixed', () => {
  const spread = versionSpread([{ policyVersionId: null }, {}], []);
  assert.equal(spread.unversioned, 2);
  assert.equal(spread.mixed, false);
});

test('without the snapshots the comparison has no answer rather than a reassuring one', () => {
  const spread = versionSpread([...on('v1', 1), ...on('v2', 1)]);
  assert.equal(spread.mixed, true);
  assert.equal(spread.arithmeticMixed, null);
});

test('a version row the caller did not load is reported, not dropped', () => {
  const spread = versionSpread(on('v9', 2), [V1]);
  assert.deepEqual(spread.used, [{ id: 'v9', count: 2, seq: null }]);
  assert.equal(spread.arithmeticMixed, null);
});

// ── who a replay may touch ──────────────────────────────────────────────────

const entries = [
  { _id: 'a', status: 'pending_mgr' },
  { _id: 'b', status: 'pending_hr' },
  { _id: 'c', status: 'approved' },
  { _id: 'd', status: 'approved' },
  { _id: 'e', status: 'cancelled' },
];

test('a signed-off entry is not replayed', () => {
  const { replay, skipped } = planRecompute(entries);
  assert.deepEqual(replay.map((e) => e._id), ['a', 'b', 'e']);
  assert.deepEqual(skipped, [
    { id: 'c', reason: 'approved' },
    { id: 'd', reason: 'approved' },
  ]);
});

test('the escape hatch is never the default and always has to be asked for', () => {
  assert.equal(planRecompute(entries, {}).replay.length, 3);
  assert.equal(planRecompute(entries, { includeApproved: false }).replay.length, 3);
  const opened = planRecompute(entries, { includeApproved: true });
  assert.equal(opened.replay.length, 5);
  assert.deepEqual(opened.skipped, []);
});

test('an empty or absent list is not an error', () => {
  assert.deepEqual(planRecompute([]), { replay: [], skipped: [] });
  assert.deepEqual(planRecompute(null), { replay: [], skipped: [] });
});

// ── the migration, planned before anything is written ───────────────────────

test('an empty system mints one origin version and points every entry at it', () => {
  const plan = planBackfill({
    existingVersions: [],
    entries: [{ _id: '1' }, { _id: '2', policyVersionId: null }],
  });
  assert.equal(plan.createGenesis, true);
  assert.equal(plan.genesis, null);
  assert.deepEqual(plan.backfill, ['1', '2']);
  assert.equal(plan.alreadyStamped, 0);
});

test('a second run creates no rival origin and rewrites no pointer', () => {
  const first = planBackfill({ existingVersions: [], entries: [{ _id: '1' }, { _id: '2' }] });
  assert.equal(first.createGenesis, true);

  // The state the first run left behind.
  const genesis = { _id: 'v1', seq: 1 };
  const second = planBackfill({
    existingVersions: [genesis],
    entries: first.backfill.map((id) => ({ _id: id, policyVersionId: 'v1' })),
  });

  assert.equal(second.createGenesis, false);
  assert.deepEqual(second.genesis, genesis);
  assert.deepEqual(second.backfill, []);
  assert.equal(second.alreadyStamped, 2);
});

test('a policy answered since the migration does not become a second origin', () => {
  // HR flipped a flag after the migration, so version 2 is the live one — but
  // the entries backfilled last month point at version 1 and must keep doing so.
  const plan = planBackfill({
    existingVersions: [{ _id: 'v2', seq: 2 }, { _id: 'v1', seq: 1 }],
    entries: [{ _id: '1', policyVersionId: 'v1' }, { _id: '2' }],
  });
  assert.equal(plan.createGenesis, false);
  assert.equal(plan.genesis.seq, 1, 'the origin is the lowest seq, not the newest version');
  assert.deepEqual(plan.backfill, ['2']);
});

test('an entry stamped between the plan and the write is not in the plan', () => {
  const plan = planBackfill({
    existingVersions: [{ _id: 'v1', seq: 1 }],
    entries: [{ _id: '1', policyVersionId: { _id: 'v1', seq: 1 } }],
  });
  assert.deepEqual(plan.backfill, []);
  assert.equal(plan.alreadyStamped, 1);
});

test('a system with no entries at all still records its origin', () => {
  const plan = planBackfill({ existingVersions: [], entries: [] });
  assert.equal(plan.createGenesis, true);
  assert.deepEqual(plan.backfill, []);
});
