import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARITHMETIC_KEYS,
  COSMETIC_KEYS,
  arithmeticOf,
  authorizeReplay,
  canonicalPolicy,
  diffPolicy,
  figuresMoved,
  planBackfill,
  planRecompute,
  policyHash,
  samePolicy,
  sameArithmetic,
  summariseReplay,
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

// ── classification: the check with no other symptom ─────────────────────────

/**
 * Every flag must be declared arithmetic or cosmetic, and the declaration has
 * to be made by whoever adds the flag.
 *
 * This is the test that makes the banner trustworthy. `sameArithmetic` compares
 * only the keys in ARITHMETIC_KEYS, so a new flag that moves hours and was
 * never registered is not compared at all — two versions differing by exactly
 * that flag report as computing identically, and the monthly banner goes green
 * saying the figures compare when every one of them moved. Nothing fails,
 * nothing logs, and the wrong answer is the reassuring one.
 *
 * There is no way to detect that afterwards, so it is caught at the only moment
 * anybody can act on it: the commit that adds the flag.
 */
test('every policy flag is classified as either arithmetic or cosmetic', () => {
  const declared = [...ARITHMETIC_KEYS, ...COSMETIC_KEYS].sort();
  const actual = Object.keys(DEFAULT_POLICY).sort();

  const unclassified = actual.filter((k) => !declared.includes(k));
  assert.deepEqual(
    unclassified,
    [],
    `นโยบายมี key ที่ยังไม่ได้จัดประเภท: ${unclassified.join(', ')} — `
    + 'เพิ่มลง ARITHMETIC_KEYS ถ้ามีผลต่อการคำนวณชั่วโมง หรือ COSMETIC_KEYS ถ้าไม่มี '
    + '(lib/policyVersion.js)',
  );

  const stale = declared.filter((k) => !actual.includes(k));
  assert.deepEqual(stale, [], 'มี key ที่จัดประเภทไว้แต่ไม่มีอยู่ใน DEFAULT_POLICY แล้ว');
});

test('a flag cannot be both — the two lists never overlap', () => {
  const both = ARITHMETIC_KEYS.filter((k) => COSMETIC_KEYS.includes(k));
  assert.deepEqual(both, []);
});

// ── the fingerprint ─────────────────────────────────────────────────────────

test('the same answers fingerprint the same, whatever order they were written in', () => {
  const a = { roundingMode: 'floor', breakMode: 'lunchWindow', minimumHours: 1 };
  const b = { minimumHours: 1, breakMode: 'lunchWindow', roundingMode: 'floor' };
  assert.equal(policyHash(a), policyHash(b));
});

test('one changed answer fingerprints differently', () => {
  const hash = policyHash(DEFAULT_POLICY);
  assert.notEqual(hash, policyHash({ ...DEFAULT_POLICY, roundingMode: 'ceil' }));
  assert.notEqual(hash, policyHash({ ...DEFAULT_POLICY, hrMayReject: false }));
});

test('a fingerprint is eight hex characters — short enough to read out loud', () => {
  assert.match(policyHash(DEFAULT_POLICY), /^[0-9a-f]{8}$/);
});

/**
 * The rule the model depends on: a fingerprint narrows a search, it does not
 * settle a comparison. `PolicyVersion.append` must keep deciding on
 * `samePolicy`, because 32 bits collide and a collision consulted as equality
 * would swallow a real policy change — no version written, and a month of
 * entries pointing at rules that did not produce them.
 */
test('the fingerprint is not the equality test — samePolicy is', () => {
  const a = { ...DEFAULT_POLICY };
  const b = { ...DEFAULT_POLICY, minimumHours: 2 };
  assert.equal(samePolicy(a, b), false);
  assert.equal(
    canonicalPolicy(a) === canonicalPolicy(b),
    false,
    'canonical strings are what append() compares — they must differ here',
  );
});

// ── who may restate a signed-off figure ─────────────────────────────────────

test('an ordinary replay needs no permission — it touches nothing signed off', () => {
  assert.deepEqual(authorizeReplay({ actor: { role: 'hr' }, includeApproved: false }), { ok: true });
  assert.deepEqual(authorizeReplay({}), { ok: true });
});

test('HR cannot restate approved hours, however good the reason', () => {
  const result = authorizeReplay({
    actor: { role: 'hr' }, includeApproved: true, note: 'ฝ่ายบุคคลตอบ OPEN 3 แล้ว',
  });
  assert.equal(result.ok, undefined);
  assert.equal(result.status, 403);
});

test('an admin with no reason cannot either', () => {
  const result = authorizeReplay({ actor: { role: 'admin' }, includeApproved: true, note: '  ' });
  assert.equal(result.status, 400);
});

test('an admin who says why may', () => {
  assert.deepEqual(
    authorizeReplay({ actor: { role: 'admin' }, includeApproved: true, note: 'OPEN 3' }),
    { ok: true },
  );
});

test('nobody at all is still nobody', () => {
  assert.equal(authorizeReplay({ actor: null, includeApproved: true, note: 'x' }).status, 403);
  assert.equal(
    authorizeReplay({ actor: { role: 'employee' }, includeApproved: true, note: 'x' }).status,
    403,
  );
});

// ── did the replay actually restate anything ────────────────────────────────

const snapshotOf = (weekday, holiday15, holiday3) => ({
  buckets: { ot15_weekday: weekday, ot15_holiday: holiday15, ot3_holiday: holiday3 },
  otHours: weekday + holiday15 + holiday3,
});

test('a replay that lands on the same figures has restated nothing', () => {
  assert.equal(figuresMoved(snapshotOf(3, 0, 0), snapshotOf(3, 0, 0)), false);
});

test('a changed total is a change', () => {
  assert.equal(figuresMoved(snapshotOf(3, 0, 0), snapshotOf(3.5, 0, 0)), true);
});

/**
 * The case a comparison on `otHours` alone cannot see, and the reason this
 * function exists. Moving the core-hours boundary turns ×1.5 hours into ×3
 * hours one for one: the session total holds at 8, and payroll pays a different
 * amount against it. Read on the total, that entry looks untouched and its
 * `before` snapshot is never written — the audit trail goes missing exactly
 * where the change was material.
 */
test('hours crossing between rate columns is a change even when the total holds', () => {
  const before = snapshotOf(0, 8, 0);
  const after = snapshotOf(0, 0, 8);
  assert.equal(before.otHours, after.otHours, 'the totals must match, or this proves nothing');
  assert.equal(figuresMoved(before, after), true);
});

test('a pending entry has no before snapshot to compare, and that is not a change', () => {
  assert.equal(figuresMoved(null, snapshotOf(3, 0, 0)), false);
});

// ── the operation log ───────────────────────────────────────────────────────

/**
 * A run is recorded whether or not it moved anything — the per-entry snapshots
 * cannot say "a replay happened and changed nothing", and the absence of
 * evidence would otherwise be indistinguishable from evidence of absence.
 */
test('a replay that changed nothing is still a replay that happened', () => {
  const summary = summariseReplay({
    scanned: [{ status: 'pending_hr', policyVersionId: 'v1' }],
    replay: [{ status: 'pending_hr' }],
    changed: [],
    toVersionId: 'v2',
  });
  assert.equal(summary.scanned, 1);
  assert.equal(summary.replayed, 1);
  assert.equal(summary.changed, 0);
  assert.equal(summary.toVersion, 'v2');
});

test('the versions a month was carrying are counted, not just listed', () => {
  const summary = summariseReplay({
    scanned: [
      { status: 'approved', policyVersionId: 'v1' },
      { status: 'pending_hr', policyVersionId: 'v1' },
      { status: 'pending_mgr', policyVersionId: 'v2' },
      { status: 'pending_mgr', policyVersionId: null },
    ],
    replay: [{ status: 'pending_hr' }, { status: 'pending_mgr' }, { status: 'pending_mgr' }],
    skipped: [{ id: 'a', reason: 'approved' }],
    toVersionId: 'v3',
  });

  assert.deepEqual(summary.fromVersions, [
    { version: 'v1', count: 2 },
    { version: 'v2', count: 1 },
    { version: null, count: 1 },
  ]);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.approvedReplayed, 0, 'the approved one was held back, not replayed');
});

test('a run that was allowed to touch signed-off hours says how many', () => {
  const summary = summariseReplay({
    scanned: [{ status: 'approved', policyVersionId: 'v1' }],
    replay: [{ status: 'approved' }],
    changed: ['a'],
    toVersionId: 'v2',
  });
  assert.equal(summary.approvedReplayed, 1);
  assert.equal(summary.changed, 1);
});

test('an empty run is a fact too, not an error', () => {
  const summary = summariseReplay();
  assert.equal(summary.scanned, 0);
  assert.equal(summary.replayed, 0);
  assert.deepEqual(summary.fromVersions, []);
  assert.equal(summary.toVersion, null);
});
