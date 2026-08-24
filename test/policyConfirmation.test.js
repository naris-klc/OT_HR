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
} from '../src/config/policy.js';
import { ARITHMETIC_KEYS, COSMETIC_KEYS, policyHash, samePolicy } from '../lib/policyVersion.js';
import {
  CONFIRM_NOTE_MAX_CHARS, applyConfirmation, confirmationRecord, confirmedValues,
  normaliseConfirmNote, unconfirmedItem, unconfirmedKeys, unconfirmedState,
} from '../lib/policyConfirmations.js';

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

/** A sign-off written the way the writer writes one: naming the value it is on. */
function signedOff(item, policy, actor, at, extra = {}) {
  return confirmationRecord(actor, at, {
    values: confirmedValues(item, policy),
    reading: readUnconfirmed(item, policy),
    ...extra,
  });
}

test('a confirmed item carries who, when, and what was signed', () => {
  const at = new Date('2026-08-07T04:00:00.000Z');
  const item = unconfirmedItem('belowMinimumAction');
  const confirmations = {
    belowMinimumAction: signedOff(item, DEFAULT_POLICY, { _id: 'u1', name: 'สมชาย' }, at, {
      note: 'ที่ประชุม 7 ส.ค.',
    }),
  };
  const items = unconfirmedState(DEFAULT_POLICY, confirmations);

  const confirmed = items.find((i) => i.id === 'belowMinimumAction');
  assert.deepEqual(confirmed.confirmed, {
    by: 'u1',
    byName: 'สมชาย',
    at: '2026-08-07T04:00:00.000Z',
    values: { belowMinimum: 'accept' },
    reading: 'รับตามชั่วโมงจริง และติดธงให้ HR ตรวจ',
    policyVersionId: null,
    note: 'ที่ประชุม 7 ส.ค.',
    supersededCount: 0,
  });
  assert.equal(confirmed.state, 'current');
  assert.equal(confirmed.stands, true);
  assert.equal(items.find((i) => i.id === 'roundingIncrement').confirmed, null);
});

test('confirming one item does not clear the badge on the others', () => {
  const item = unconfirmedItem('belowMinimumAction');
  const keys = unconfirmedKeys(
    { belowMinimumAction: signedOff(item, DEFAULT_POLICY, { name: 'สมชาย' }, new Date(0)) },
    DEFAULT_POLICY,
  );
  assert.equal(keys.has('belowMinimum'), false);
  assert.equal(keys.has('roundingIncrementMinutes'), true);
});

/**
 * The failure this whole shape exists to stop.
 *
 * A signature is on an ANSWER, not on a question. Until 2026-08-24 the record
 * held no value, so moving `belowMinimum` from 'accept' to 'reject' left the
 * 14 August sign-off sitting under it, now endorsing a value nobody had seen —
 * silently, because the row reads its answer off the live policy and would have
 * shown the new one beside the old signature without a word.
 */
test('a sign-off stops standing when the value it was given for moves', () => {
  const item = unconfirmedItem('belowMinimumAction');
  const at = new Date('2026-08-14T03:46:00.000Z');
  const confirmations = {
    belowMinimumAction: signedOff(item, DEFAULT_POLICY, { _id: 'u1', name: 'ฝ่ายบุคคล' }, at),
  };

  const moved = { ...DEFAULT_POLICY, belowMinimum: 'reject' };
  const row = unconfirmedState(moved, confirmations).find((i) => i.id === 'belowMinimumAction');

  assert.equal(row.state, 'moved');
  assert.equal(row.stands, false, 'the badge has to come back on its own');
  assert.deepEqual(row.changes, [{ key: 'belowMinimum', was: 'accept', now: 'reject' }]);
  // The signature is not deleted, and it still says what it was given for.
  assert.equal(row.confirmed.byName, 'ฝ่ายบุคคล');
  assert.equal(row.confirmed.reading, 'รับตามชั่วโมงจริง และติดธงให้ HR ตรวจ');
  // And the row shows the value that is RUNNING, which is the other half.
  assert.equal(row.reading, 'ไม่รับรายการ');
  assert.equal(unconfirmedKeys(confirmations, moved).has('belowMinimum'), true);
});

/**
 * The four pressed on 2026-08-14 — kept, never repaired.
 *
 * Back-filling today's values onto them would manufacture evidence that HR
 * agreed to values they were never shown. What the record can honestly say is
 * that somebody signed something and the system did not write down what.
 */
test('a sign-off from before values were recorded is marked, not mended', () => {
  const legacy = { by: '6a7d', byName: 'ฝ่ายบุคคล', at: '2026-08-14T03:46:15.314Z' };
  const row = unconfirmedState(DEFAULT_POLICY, { belowMinimumAction: legacy })
    .find((i) => i.id === 'belowMinimumAction');

  assert.equal(row.state, 'unrecorded');
  assert.equal(row.stands, false);
  assert.equal(row.confirmed.byName, 'ฝ่ายบุคคล', 'the signature is kept whole');
  assert.equal(row.confirmed.at, '2026-08-14T03:46:15.314Z');
  assert.equal(row.confirmed.values, null, 'and is not given values it never had');
  assert.equal(unconfirmedKeys({ belowMinimumAction: legacy }, DEFAULT_POLICY).has('belowMinimum'), true);
});

test('re-confirming keeps the sign-off it replaces, and only when one is needed', () => {
  const item = unconfirmedItem('belowMinimumAction');
  const first = new Date('2026-08-14T03:46:00.000Z');
  const doc = {
    policyConfirmations: {
      belowMinimumAction: signedOff(item, DEFAULT_POLICY, { name: 'ฝ่ายบุคคล' }, first),
    },
  };

  // Pressing it again on an unchanged rule must not re-date the signature.
  const again = applyConfirmation(doc, {
    id: 'belowMinimumAction',
    actor: { name: 'คนอื่น' },
    at: new Date('2026-08-20T00:00:00.000Z'),
    policy: DEFAULT_POLICY,
  });
  assert.equal(again.changed, false);
  assert.equal(again.confirmations.belowMinimumAction.at, first.toISOString());

  // Once the value has moved, it is a new answer to a question that came back.
  const moved = { ...DEFAULT_POLICY, belowMinimum: 'raise' };
  const redone = applyConfirmation(doc, {
    id: 'belowMinimumAction',
    actor: { _id: 'u2', name: 'สมศรี' },
    at: new Date('2026-08-25T00:00:00.000Z'),
    policy: moved,
    note: 'ทวนกับ HR อีกครั้ง',
  });
  assert.equal(redone.changed, true);

  const record = redone.confirmations.belowMinimumAction;
  assert.equal(record.byName, 'สมศรี');
  assert.deepEqual(record.values, { belowMinimum: 'raise' });
  assert.equal(record.note, 'ทวนกับ HR อีกครั้ง');
  assert.equal(record.supersedes.byName, 'ฝ่ายบุคคล', 'the earlier signature is kept whole');
  assert.deepEqual(record.supersedes.values, { belowMinimum: 'accept' });
  assert.equal(
    unconfirmedState(moved, redone.confirmations).find((i) => i.id === 'belowMinimumAction')
      .confirmed.supersededCount,
    1,
  );
});

test('ที่มาของคำตอบ is optional, capped, and refused rather than trimmed', () => {
  assert.deepEqual(normaliseConfirmNote(''), { value: null });
  assert.deepEqual(normaliseConfirmNote(null), { value: null });
  assert.deepEqual(normaliseConfirmNote('  ถามคุณสมศรี  '), { value: 'ถามคุณสมศรี' });

  const tooLong = normaliseConfirmNote('ก'.repeat(CONFIRM_NOTE_MAX_CHARS + 1));
  assert.ok(tooLong.error, 'a note past the cap is an error, never a truncation');
  assert.equal(tooLong.value, undefined);
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
  const empty = {
    values: null, reading: null, policyVersionId: null, note: null, supersedes: null,
  };
  assert.deepEqual(confirmationRecord({ _id: 'u9', code: 'PM0001' }, new Date(0)), {
    by: 'u9', byName: 'PM0001', at: '1970-01-01T00:00:00.000Z', ...empty,
  });
  assert.deepEqual(confirmationRecord(null, new Date(0)), {
    by: null, byName: null, at: '1970-01-01T00:00:00.000Z', ...empty,
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

test('the sign-off writer reads a version and can never append one', () => {
  /**
   * lib/policyConfirmSave.js gained an import of PolicyVersion on 2026-08-24, so
   * a record can point at the rule set it was signed inside. Reading one is not
   * writing one, and the difference has to be held by something other than good
   * intentions: `append` and `create` are the two ways a version comes into
   * existence, and neither may appear on this path.
   */
  const src = readFileSync(join(ROOT, 'lib/policyConfirmSave.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.match(code, /PolicyVersion\.latest\(\)/, 'the version pointer must come from the latest row');
  assert.doesNotMatch(code, /PolicyVersion\.(append|create)/, 'a sign-off appended a policy version');
  assert.doesNotMatch(code, /doc\.policy\s*=/, 'a sign-off wrote a policy value');
  assert.doesNotMatch(code, /recomputeEntries|savePolicy/, 'a sign-off reached the engine');
});

test('the settings page reads standing, not the mere existence of a signature', () => {
  /**
   * The badge is the point of the whole change. `item.confirmed` is now a
   * record that may or may not still cover the value under it, so a screen
   * testing it for truthiness would show ✓ HR ยืนยันแล้ว over a rule nobody has
   * agreed to — which is exactly the state the page was in before.
   */
  const src = readFileSync(join(ROOT, 'components/AdminView.jsx'), 'utf8');

  assert.match(src, /item\.stands/, 'AdminView no longer reads whether a sign-off stands');
  assert.doesNotMatch(
    src,
    /if \(!item \|\| item\.confirmed\) return null;/,
    'the ยืนยัน block is back to hiding itself on any signature at all',
  );
  // The three things a re-opened row has to be able to say.
  assert.match(src, /ยืนยันใหม่ที่ค่าปัจจุบัน/);
  assert.match(src, /ทวนอีกครั้ง/);
  assert.match(src, /ที่มาของคำตอบ/);
});
