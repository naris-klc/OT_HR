import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DEFAULT_POLICY,
  HR_UNCONFIRMED,
  HR_UNCONFIRMED_SINCE,
  readUnconfirmed,
  unconfirmedKeys,
} from '../src/config/policy.js';
import { ARITHMETIC_KEYS, COSMETIC_KEYS, policyHash, samePolicy } from '../lib/policyVersion.js';
import { confirmationRecord, unconfirmedItem, unconfirmedState } from '../lib/policyConfirmations.js';

/**
 * "รอ HR ยืนยัน" is a note about who decided a rule. It must never become a
 * rule.
 *
 * The badge exists because three of the values the system runs on were read off
 * the old paper rather than answered by anybody, and a page that calls all
 * twenty flags ค่าเริ่มต้น cannot say so. What makes it safe to add is that
 * confirming an item writes a name and a date and touches nothing else — no
 * value moves, no version is appended, no entry is recomputed.
 *
 * That is easy to say and easy to lose. Somebody stores the confirmations
 * inside `Setting.policy` because that is where policy things live, and from
 * that moment pressing ยืนยัน changes the canonical policy string: a new
 * version is minted, `sameArithmetic` goes false, the monthly banner tells HR
 * their figures cannot be compared, and every entry in flight is replayed —
 * over a badge. Nothing would fail; the hours would simply have been restated
 * by a button that promised not to.
 *
 * So the separation is pinned from both ends: the catalogue is not policy keys
 * (below), and the writer never writes `doc.policy` (the source check at the
 * foot of this file).
 *
 * Run with: npm test
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── the catalogue is not policy ─────────────────────────────────────────────

test('no unconfirmed item is itself a policy key', () => {
  // The ids name questions, not flags. An id that collided with a flag would
  // make `{ [id]: {...} }` look like a policy override to anything reading the
  // settings document loosely.
  for (const item of HR_UNCONFIRMED) {
    assert.ok(!(item.id in DEFAULT_POLICY), `${item.id} ชนกับ key ของนโยบาย`);
  }
});

test('confirmations are not a policy key, so they are not classified as one', () => {
  // The completeness test in policyVersion.test.js requires every DEFAULT_POLICY
  // key to be arithmetic or cosmetic. `policyConfirmations` is neither because
  // it is not in DEFAULT_POLICY at all — it is a sibling field on the Setting
  // document. If that ever changes, this fails before the other test does and
  // says why.
  assert.ok(!('policyConfirmations' in DEFAULT_POLICY));
  assert.ok(!ARITHMETIC_KEYS.includes('policyConfirmations'));
  assert.ok(!COSMETIC_KEYS.includes('policyConfirmations'));
});

test('a confirmation cannot change the policy, its hash, or its identity', () => {
  // The failure this whole file exists to prevent, stated as arithmetic: a
  // policy with confirmations hanging off it is the same policy.
  const policy = { ...DEFAULT_POLICY };
  const confirmations = { belowMinimumAction: confirmationRecord({ name: 'สมชาย' }, new Date(0)) };

  // What a confirmation write produces is a sibling object; the policy passed
  // to the engine is untouched by it.
  const after = { ...DEFAULT_POLICY };
  unconfirmedState(after, confirmations);

  assert.deepEqual(after, policy);
  assert.equal(samePolicy(after, policy), true);
  assert.equal(policyHash(after), policyHash(policy));
});

test('every key a badge is placed on names a real policy flag', () => {
  for (const item of HR_UNCONFIRMED) {
    for (const key of item.keys) {
      assert.ok(key in DEFAULT_POLICY, `${item.id} ชี้ไปที่ ${key} ซึ่งไม่มีในนโยบาย`);
    }
  }
});

test('ids are unique — two items sharing one would confirm each other', () => {
  const ids = HR_UNCONFIRMED.map((i) => i.id);
  assert.deepEqual([...new Set(ids)].sort(), [...ids].sort());
});

test('the three rules nobody in HR has answered are the three that are listed', () => {
  // Named, not counted. Adding a fourth is a decision somebody should have to
  // make here rather than discover on the settings page.
  assert.deepEqual(
    HR_UNCONFIRMED.map((i) => i.id),
    ['roundingIncrement', 'belowMinimumAction', 'minimumScope'],
  );
  assert.equal(HR_UNCONFIRMED_SINCE, '2026-08-07');
});

// ── what a screen is told ───────────────────────────────────────────────────

test('the answer shown is read off the live policy, not stored with the confirmation', () => {
  // A confirmation says "this rule is ours now". If HR later changes the value
  // through the settings page the badge must show the new value — a frozen
  // copy of what was agreed in August is the one thing here that could lie.
  const live = { ...DEFAULT_POLICY, roundingIncrementMinutes: 60, belowMinimum: 'raise' };
  const items = unconfirmedState(live, {});

  assert.equal(items.find((i) => i.id === 'roundingIncrement').reading, 'ทีละ 60 นาที');
  assert.equal(items.find((i) => i.id === 'belowMinimumAction').reading, 'ปัดขึ้นเป็น 1 ชม.');
});

test('what the system does today is what the badge says it does', () => {
  const items = unconfirmedState(DEFAULT_POLICY, {});
  assert.equal(items.find((i) => i.id === 'roundingIncrement').reading, 'ทีละ 30 นาที');
  assert.equal(items.find((i) => i.id === 'belowMinimumAction').reading, 'ไม่รับรายการ');
  assert.match(items.find((i) => i.id === 'minimumScope').reading, /ต่อใบ/);
});

test('a confirmed item carries who and when; an unconfirmed one carries null', () => {
  const at = new Date('2026-08-07T04:00:00.000Z');
  const confirmations = { belowMinimumAction: confirmationRecord({ _id: 'u1', name: 'สมชาย' }, at) };
  const items = unconfirmedState(DEFAULT_POLICY, confirmations);

  const confirmed = items.find((i) => i.id === 'belowMinimumAction');
  assert.deepEqual(confirmed.confirmed, {
    by: 'u1', byName: 'สมชาย', at: '2026-08-07T04:00:00.000Z',
  });
  assert.equal(items.find((i) => i.id === 'roundingIncrement').confirmed, null);
});

test('confirming one item does not clear the badge on the others', () => {
  const keys = unconfirmedKeys({ belowMinimumAction: confirmationRecord({ name: 'สมชาย' }, new Date(0)) });
  assert.equal(keys.has('belowMinimum'), false);
  assert.equal(keys.has('roundingMode'), true);
});

test('an item with no flag still appears — it is the one nobody could find otherwise', () => {
  // The minimum's scope is a rule the engine has and the policy has no key
  // for, so no dropdown wears its badge. Left off the page it would be the
  // only unconfirmed rule with nothing anywhere saying so.
  const scope = HR_UNCONFIRMED.find((i) => i.id === 'minimumScope');
  assert.deepEqual(scope.keys, []);
  assert.equal(unconfirmedState(DEFAULT_POLICY, {}).some((i) => i.id === 'minimumScope'), true);
});

test('an unknown id is refused rather than recorded', () => {
  assert.equal(unconfirmedItem('roundingIncrement')?.id, 'roundingIncrement');
  assert.equal(unconfirmedItem('birthdayHolidayEnabled'), null);
  assert.equal(unconfirmedItem(''), null);
  assert.equal(unconfirmedItem(null), null);
});

test('a signature survives the employee row it was signed with', () => {
  // byName is denormalised deliberately: an employee can be deleted, a
  // sign-off cannot be un-signed.
  assert.deepEqual(confirmationRecord({ _id: 'u9', code: 'PM0001' }, new Date(0)), {
    by: 'u9', byName: 'PM0001', at: '1970-01-01T00:00:00.000Z',
  });
  assert.deepEqual(confirmationRecord(null, new Date(0)), {
    by: null, byName: null, at: '1970-01-01T00:00:00.000Z',
  });
});

test('reading an item with a plain string works as well as a function', () => {
  assert.equal(readUnconfirmed({ reading: 'ต่อใบ' }, DEFAULT_POLICY), 'ต่อใบ');
  assert.equal(readUnconfirmed({}, DEFAULT_POLICY), '');
});

// ── the writer never touches the policy ─────────────────────────────────────

test('the confirmation writer writes no policy value and appends no version', () => {
  // Read as text for the same reason rejectedNeverCounted does: the rule is
  // held by what the file does NOT do, and there is no function to assert on.
  const src = readFileSync(join(ROOT, 'lib/policyConfirmations.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.doesNotMatch(code, /doc\.policy\s*=/, 'lib/policyConfirmations.js เขียนทับ doc.policy');
  assert.doesNotMatch(code, /savePolicy|PolicyVersion|recomputeEntries/, 'ยืนยันแล้วไปแตะการคำนวณใหม่');
});

test('the settings route confirms through the shared writer, not through savePolicy', () => {
  const src = readFileSync(join(ROOT, 'app/api/settings/policy-confirmations/route.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.match(code, /confirmPolicyItem/);
  assert.doesNotMatch(code, /savePolicy|recompute/i);
});
