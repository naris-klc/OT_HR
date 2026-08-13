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

test('the rules nobody in HR has answered are the ones that are listed', () => {
  // Named, not counted. Adding one is a decision somebody should have to make
  // here rather than discover on the settings page — which is how `startBuffer`
  // came to be added on 2026-08-13: the buffer moved hours, shipped at a figure
  // nobody chose, and was the only one of the four with no badge saying so.
  assert.deepEqual(
    HR_UNCONFIRMED.map((i) => i.id),
    ['roundingIncrement', 'belowMinimumAction', 'minimumScope', 'startBuffer'],
  );
  assert.equal(HR_UNCONFIRMED_SINCE, '2026-08-07');
});

test('an item added after the catalogue opened is dated from when it arrived', () => {
  // The shared HR_UNCONFIRMED_SINCE is the floor, not the answer: a question
  // that did not exist on 2026-08-07 must not be shown as unanswered since then.
  const state = unconfirmedState(DEFAULT_POLICY, {});
  const byId = Object.fromEntries(state.map((i) => [i.id, i]));
  assert.equal(byId.startBuffer.since, '2026-08-13');
  assert.equal(byId.roundingIncrement.since, HR_UNCONFIRMED_SINCE);
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
  assert.equal(
    items.find((i) => i.id === 'belowMinimumAction').reading,
    'รับตามชั่วโมงจริง และติดธงให้ HR ตรวจ',
  );
  assert.match(items.find((i) => i.id === 'minimumScope').reading, /ต่อใบ/);
});

test('the badge reads all three answers to [OPEN 4], including the one it used to ship on', () => {
  // Every value the flag can hold has a sentence, because a version recorded
  // under 'reject' is still in the collection and a settings page showing the
  // wrong one of these is worse than showing none.
  const readingOf = (belowMinimum) => unconfirmedState({ ...DEFAULT_POLICY, belowMinimum }, {})
    .find((i) => i.id === 'belowMinimumAction').reading;

  assert.equal(readingOf('reject'), 'ไม่รับรายการ');
  assert.equal(readingOf('raise'), 'ปัดขึ้นเป็น 1 ชม.');
  assert.equal(readingOf('accept'), 'รับตามชั่วโมงจริง และติดธงให้ HR ตรวจ');
});

test('answering [OPEN 4] is HR pressing ยืนยัน — not a default moving', () => {
  // The change to 'accept' does not confirm the rule. Nobody in HR has answered
  // the question, and the badge is a record of that fact rather than of which
  // reading the system happens to run on.
  const item = HR_UNCONFIRMED.find((i) => i.id === 'belowMinimumAction');
  assert.ok(item, '[OPEN 4] must stay on the unconfirmed list');
  assert.deepEqual(item.keys, ['belowMinimum']);
  assert.equal(unconfirmedKeys({}).has('belowMinimum'), true);
  assert.equal(unconfirmedState(DEFAULT_POLICY, {}).find((i) => i.id === 'belowMinimumAction').confirmed, null);
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
  assert.equal(keys.has('roundingIncrementMinutes'), true);
});

test('the rounding increment’s badge sits on the increment, not on the mode', () => {
  // Same move `minimumScope` made below, for the same reason. The increment was
  // a number in src/config/policy.js with no row on the settings page, so the
  // badge borrowed `roundingMode`'s row; the increment has its own dropdown now.
  // `roundingMode` is not an unconfirmed rule — 'floor' is the requirements
  // doc's own recommendation — and a badge left on it would say it was.
  const item = HR_UNCONFIRMED.find((i) => i.id === 'roundingIncrement');
  assert.deepEqual(item.keys, ['roundingIncrementMinutes']);
  assert.equal(unconfirmedKeys({}).has('roundingMode'), false);
});

test('the increment’s reading says so when no rounding is happening at all', () => {
  // 'exact' is a fourth answer to [OPEN 3] and it makes the increment inert.
  // A page reading "ทีละ 30 นาที" beside an engine that rounds nothing would be
  // the one thing `reading` exists to prevent.
  const readingOf = (policy) => unconfirmedState({ ...DEFAULT_POLICY, ...policy }, {})
    .find((i) => i.id === 'roundingIncrement').reading;

  assert.equal(readingOf({ roundingIncrementMinutes: 15 }), 'ทีละ 15 นาที');
  assert.match(readingOf({ roundingMode: 'exact' }), /ไม่ปัดเศษ/);
});

test('the minimum’s scope now has a flag, and its badge sits on it', () => {
  // It used to have none: the scope was a rule the engine had and the policy
  // had no key for, so the item carried empty `keys` and appeared on the page
  // on the strength of its `reading` alone. `minimumHoursScope` is that key,
  // and the badge moved onto the dropdown rather than off the page — HR have
  // still not answered the question. An item with no keys remains a supported
  // shape (see `unconfirmedKeys`); it is simply not this item's shape any more.
  const scope = HR_UNCONFIRMED.find((i) => i.id === 'minimumScope');
  assert.deepEqual(scope.keys, ['minimumHoursScope']);
  assert.equal(unconfirmedKeys({}).has('minimumHoursScope'), true);
  assert.equal(unconfirmedState(DEFAULT_POLICY, {}).some((i) => i.id === 'minimumScope'), true);
  assert.equal(unconfirmedState(DEFAULT_POLICY, {}).find((i) => i.id === 'minimumScope').confirmed, null);
});

test('answering ต่อใบ/ต่อช่อง shows the answer the engine is running on', () => {
  // The reading is read off the live policy like every other one, so a page
  // showing "ต่อใบ" while the engine measures per column is not a state this
  // can reach.
  const readingOf = (minimumHoursScope) => unconfirmedState({ ...DEFAULT_POLICY, minimumHoursScope }, {})
    .find((i) => i.id === 'minimumScope').reading;

  assert.match(readingOf('sheet'), /ต่อใบ/);
  assert.match(readingOf('bucket'), /ต่อช่อง/);
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
