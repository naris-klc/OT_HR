import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  advanceSubmissionRefusal, pastSubmissionRefusal, submissionWindowRefusal,
} from '../lib/entries.js';
import { DEFAULT_POLICY } from '../src/config/policy.js';
import { ARITHMETIC_KEYS, COSMETIC_KEYS } from '../lib/policyVersion.js';

/**
 * ยื่น OT ล่วงหน้าได้ถึงวันไหน.
 *
 * Until this rule existed nothing anywhere looked forward: `workDate` was
 * checked for shape by the schema and for one boundary by ปิดงวด, which refuses
 * a month that has FINISHED. A request dated 2027 was accepted, would sit in a
 * queue nobody opens for months, and would count against a ceiling for a month
 * nobody had worked yet.
 *
 * `today` is an argument to every case here, never read from the clock, which is
 * the property the rule was written for — a test that took the real date would
 * pass on one day of the year and be untestable on the rest.
 */

const on = (max) => ({ ...DEFAULT_POLICY, maxAdvanceSubmissionDays: max });

test('the shipped answer is today, and today is allowed', () => {
  assert.equal(DEFAULT_POLICY.maxAdvanceSubmissionDays, 0);
  assert.equal(advanceSubmissionRefusal('2026-08-19', '2026-08-19', DEFAULT_POLICY), null);
});

test('yesterday and last month are not this rule\'s business', () => {
  assert.equal(advanceSubmissionRefusal('2026-08-18', '2026-08-19', DEFAULT_POLICY), null);
  assert.equal(advanceSubmissionRefusal('2026-05-01', '2026-08-19', DEFAULT_POLICY), null);
});

test('tomorrow is refused under the default, with today in the sentence', () => {
  const refusal = advanceSubmissionRefusal('2026-08-20', '2026-08-19', DEFAULT_POLICY);
  assert.equal(refusal.status, 400);
  assert.match(refusal.error, /2026-08-20/);
  assert.match(refusal.error, /2026-08-19/);
  // Under 0 there is no window, so the refusal must not name one — a reader
  // sent looking for "ล่วงหน้าได้ไม่เกิน n วัน" would not find it anywhere.
  assert.doesNotMatch(refusal.error, /ไม่เกิน/);
});

test('a positive window lets that many days through and no more', () => {
  const policy = on(7);
  assert.equal(advanceSubmissionRefusal('2026-08-26', '2026-08-19', policy), null);
  const refusal = advanceSubmissionRefusal('2026-08-27', '2026-08-19', policy);
  assert.equal(refusal.status, 400);
  // The last date that WOULD work, so nobody has to do the arithmetic.
  assert.match(refusal.error, /2026-08-26/);
});

test('a window that crosses a month end is added in days, not in dates', () => {
  const policy = on(5);
  assert.equal(advanceSubmissionRefusal('2026-09-02', '2026-08-28', policy), null);
  assert.ok(advanceSubmissionRefusal('2026-09-03', '2026-08-28', policy));
});

test('a leap day is a day like any other', () => {
  const policy = on(1);
  assert.equal(advanceSubmissionRefusal('2028-02-29', '2028-02-28', policy), null);
  assert.ok(advanceSubmissionRefusal('2028-03-01', '2028-02-28', policy));
});

test('null is ไม่จำกัด — the rule off, and not the same as 0', () => {
  assert.equal(advanceSubmissionRefusal('2030-01-01', '2026-08-19', on(null)), null);
  assert.ok(advanceSubmissionRefusal('2030-01-01', '2026-08-19', on(0)));
});

/**
 * A garbled limit must not open the door wider than the default it garbled.
 * Falling back to 0 is the strict direction; falling back to "off" would turn a
 * typo in the settings document into an unbounded window with nothing to show
 * for it on any screen.
 */
test('an unreadable limit falls back to the strict answer, not to off', () => {
  for (const bad of [-1, 'soon', NaN, undefined]) {
    assert.ok(
      advanceSubmissionRefusal('2026-08-20', '2026-08-19', on(bad)),
      `maxAdvanceSubmissionDays: ${String(bad)} opened the window`,
    );
  }
});

/**
 * A workDate that is not a date is the schema's question. Answering it here
 * would refuse with a sentence about being too far ahead — string comparison
 * reads any letter as later than any digit — which is a confident answer to a
 * question nobody asked.
 */
test('a malformed date is left to the schema', () => {
  assert.equal(advanceSubmissionRefusal('x', '2026-08-19', DEFAULT_POLICY), null);
  assert.equal(advanceSubmissionRefusal('', '2026-08-19', DEFAULT_POLICY), null);
  assert.equal(advanceSubmissionRefusal(null, '2026-08-19', DEFAULT_POLICY), null);
  assert.equal(advanceSubmissionRefusal('2026-08-20', 'today', DEFAULT_POLICY), null);
});

/**
 * The classification is what decides whether `savePolicy` replays a month over
 * a change to this key. It must not: the rule is about the day an entry was
 * WRITTEN, and a replay runs on some later day — every stored entry would be
 * measured against a "today" that has moved since.
 */
test('it is registered as cosmetic, so changing it replays nothing', () => {
  assert.ok(COSMETIC_KEYS.includes('maxAdvanceSubmissionDays'));
  assert.ok(!ARITHMETIC_KEYS.includes('maxAdvanceSubmissionDays'));
});

/**
 * AND HR CAN REACH IT. A policy key with no row on the settings page is a rule
 * only somebody with an HTTP client can answer, which for this one would be
 * nobody in ฝ่ายบุคคล.
 *
 * Read as source text for the reason test/policyEffectiveDate.test.js is — the
 * screen resolves `@/…` through the Next alias and cannot be imported by
 * `node --test`.
 */
const screen = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'components/AdminView.jsx'),
  'utf8',
);

test('the settings page has a row for it, in its own block', () => {
  assert.match(screen, /key: 'maxAdvanceSubmissionDays'/);
  assert.match(screen, /\{ id: 5, title: 'กรอบเวลาการยื่นใบ OT' \}/);
  // The block is the ORDER of POLICY_FIELDS, not a lookup — a field carrying an
  // id no section declares would draw no heading at all.
  const field = screen.slice(screen.indexOf("key: 'maxAdvanceSubmissionDays'"));
  assert.ok(
    screen.lastIndexOf('section: 5,', screen.indexOf("key: 'maxAdvanceSubmissionDays'")) > 0,
    'the row is not declared under section 5',
  );
  assert.ok(field.length > 0);
});

/**
 * ไม่จำกัด has to survive the trip through the <select>, which hands back
 * strings. `Number('null')` is NaN, and a NaN stored here would read as "no
 * limit" to `advanceSubmissionRefusal` — the fallback above sends an unreadable
 * value to 0 — so the rule would silently invert: the answer that means "off"
 * would arrive as the strictest setting there is.
 */
test('the null option is coerced before the number branch, not by it', () => {
  assert.match(screen, /nullable: true/);
  assert.match(
    screen,
    /if \(field\.nullable && raw === 'null'\) return null;\s*\r?\n\s*if \(field\.bool\)/,
    'coerce reads nullable after bool/num — Number("null") is NaN',
  );
});

test('the row carries the two answers that are not numbers of days', () => {
  // 0 and ไม่จำกัด are the ends of the range and the two nobody guesses.
  assert.match(screen, /ยื่นล่วงหน้าไม่ได้ — ถึงวันปัจจุบันเท่านั้น \(ค่าเริ่มต้น\)/);
  assert.match(screen, /\[null, 'ไม่จำกัด/);
});

/**
 * ── ยื่นย้อนหลัง ────────────────────────────────────────────────────────────
 *
 * The mirror of everything above, and NOT its equal. A future date records
 * nothing that has happened, so refusing it costs nothing; a past one records a
 * shift somebody worked, and refusing it turns that work into hours nobody ever
 * claimed. The shipped answers differ for that reason and the tests pin the
 * difference rather than assuming symmetry.
 */

const back = (max) => ({ ...DEFAULT_POLICY, maxPastSubmissionDays: max });

test('the shipped answer is ไม่จำกัด — ปิดงวด stays the only backward limit', () => {
  assert.equal(DEFAULT_POLICY.maxPastSubmissionDays, null);
  assert.equal(pastSubmissionRefusal('2019-01-01', '2026-08-19', DEFAULT_POLICY), null);
});

test('a window lets that many days back through and no more', () => {
  const policy = back(7);
  assert.equal(pastSubmissionRefusal('2026-08-19', '2026-08-19', policy), null);
  assert.equal(pastSubmissionRefusal('2026-08-12', '2026-08-19', policy), null);
  const refusal = pastSubmissionRefusal('2026-08-11', '2026-08-19', policy);
  assert.equal(refusal.status, 400);
  assert.match(refusal.error, /ไม่สามารถยื่นขอ OT ย้อนหลังเกินกำหนด 7 วันได้/);
  // The earliest date that WOULD work, so nobody has to do the arithmetic.
  assert.match(refusal.error, /2026-08-12/);
});

test('a window that crosses a month start is subtracted in days, not in dates', () => {
  const policy = back(5);
  assert.equal(pastSubmissionRefusal('2026-07-29', '2026-08-03', policy), null);
  assert.ok(pastSubmissionRefusal('2026-07-28', '2026-08-03', policy));
});

/**
 * The fallback goes the OTHER WAY from its forward twin, which falls back to 0.
 * Both fall back to the answer the system ships with; here that is ไม่จำกัด,
 * because the strict reading would refuse work already done on the strength of
 * a value nobody could read.
 */
test('an unreadable backward limit falls back to ไม่จำกัด, not to strict', () => {
  for (const bad of ['soon', NaN, -1, undefined]) {
    assert.equal(
      pastSubmissionRefusal('2019-01-01', '2026-08-19', back(bad)), null,
      `maxPastSubmissionDays: ${String(bad)} refused an entry`,
    );
  }
  // And 0 is a real answer, not an absent one: today only.
  assert.equal(pastSubmissionRefusal('2026-08-19', '2026-08-19', back(0)), null);
  assert.ok(pastSubmissionRefusal('2026-08-18', '2026-08-19', back(0)));
});

test('a malformed date is left to the schema, backwards too', () => {
  assert.equal(pastSubmissionRefusal('x', '2026-08-19', back(7)), null);
  assert.equal(pastSubmissionRefusal(null, '2026-08-19', back(7)), null);
  assert.equal(pastSubmissionRefusal('2019-01-01', 'today', back(7)), null);
});

test('it is registered as cosmetic too', () => {
  assert.ok(COSMETIC_KEYS.includes('maxPastSubmissionDays'));
  assert.ok(!ARITHMETIC_KEYS.includes('maxPastSubmissionDays'));
});

/**
 * The routes call the combined check and not the two rules, so that a write
 * path cannot answer one direction and forget the other. These pin that it
 * really asks both.
 */
test('the combined check answers both directions', () => {
  const policy = { ...DEFAULT_POLICY, maxAdvanceSubmissionDays: 0, maxPastSubmissionDays: 7 };
  assert.equal(submissionWindowRefusal('2026-08-19', '2026-08-19', policy), null);
  assert.match(
    submissionWindowRefusal('2026-08-20', '2026-08-19', policy).error, /ล่วงหน้า/,
  );
  assert.match(
    submissionWindowRefusal('2026-08-01', '2026-08-19', policy).error, /ย้อนหลัง/,
  );
});

test('the routes call the combined check, not one half of it', () => {
  for (const file of [
    'app/api/entries/route.js',
    'app/api/entries/[id]/route.js',
    'legacy/routes/entries.js',
  ]) {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', file), 'utf8');
    assert.match(src, /submissionWindowRefusal\(/, `${file} does not check the window`);
    assert.doesNotMatch(
      src, /\badvanceSubmissionRefusal\(|\bpastSubmissionRefusal\(/,
      `${file} checks one direction directly — it will miss the other`,
    );
  }
});

test('the settings page carries the backward row beside the forward one', () => {
  assert.match(screen, /key: 'maxPastSubmissionDays'/);
  assert.match(screen, /ไม่จำกัด — ใช้การปิดงวดเป็นตัวคุมย้อนหลัง \(ค่าเริ่มต้น\)/);
  // Both rows in the same block, and the forward one first.
  assert.ok(
    screen.indexOf("key: 'maxAdvanceSubmissionDays'") < screen.indexOf("key: 'maxPastSubmissionDays'"),
    'the rows are out of order — ล่วงหน้า reads before ย้อนหลัง',
  );
});

/**
 * The one path the backward window must NOT reach. วันเกิดที่ยังไม่มีใบ exists
 * to surface days that were missed, so a rolling window would refuse exactly the
 * rows the screen is for.
 */
test('the birthday filing path is left outside the window', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'app/api/birthday/entries/route.js'),
    'utf8',
  );
  assert.doesNotMatch(src, /submissionWindowRefusal\(|pastSubmissionRefusal\(/);
  // And the reason is written down where somebody would otherwise add it.
  assert.match(src, /NO `submissionWindowRefusal` HERE/);
});
