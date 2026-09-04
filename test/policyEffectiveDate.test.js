import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { effectiveFromRefusal, versionForDate } from '../lib/policyVersion.js';

/**
 * THE RULES THAT DECIDE AN ENTRY ARE THE ONES IN FORCE ON THE DAY IT WAS WORKED.
 *
 * HR's answer, 2026-08-14, after the question was put to them twice: overtime
 * is work already performed, so the rate it earns is fixed on the day it is
 * earned. Not the day the form was filed — an employee who files five days at
 * once must get five separate answers, and the one who forgets for a week must
 * not be paid differently from the colleague who worked the same shift beside
 * them. Not the day it was approved, which is the company's own paperwork
 * speed. And not what the settings screen says this afternoon.
 *
 * Wages for work already done are a debt already incurred. Restating them
 * downward afterwards is a retroactive pay cut, and these tests are what make
 * that structurally impossible rather than merely discouraged.
 *
 * Run with: npm test
 */

const V = (seq, effectiveFrom) => ({ seq, effectiveFrom, policy: { seq } });

// Announced in the order a company would announce them.
const VERSIONS = [V(1, '2026-01-01'), V(2, '2026-08-10'), V(3, '2026-09-01')];

test('work done before a change keeps the rules it was done under', () => {
  // The case HR put in writing: rule announced on the 10th, employee files on
  // the 12th for the 8th, 9th, 10th, 11th and 12th.
  assert.equal(versionForDate(VERSIONS, '2026-08-08').seq, 1);
  assert.equal(versionForDate(VERSIONS, '2026-08-09').seq, 1);
  assert.equal(versionForDate(VERSIONS, '2026-08-10').seq, 2, 'the effective day itself is the NEW rules');
  assert.equal(versionForDate(VERSIONS, '2026-08-11').seq, 2);
  assert.equal(versionForDate(VERSIONS, '2026-08-12').seq, 2);
});

test('filing late changes nothing — the answer depends on the work date alone', () => {
  /**
   * The unfairness "วันที่ยื่น" would have introduced, pinned so it cannot come
   * back: two people work the same shift on the same day, one files the next
   * morning and one forgets for a fortnight. Nothing here can tell them apart,
   * because nothing here is told when either of them filed.
   */
  const early = versionForDate(VERSIONS, '2026-08-09');
  const late = versionForDate(VERSIONS, '2026-08-09');
  assert.equal(early.seq, late.seq);
  assert.equal(early.seq, 1);
});

test('a rule announced for the future does not govern today', () => {
  // Saved and visible in the settings screen, but not yet in force. This is the
  // reason the field exists rather than using createdAt.
  assert.equal(versionForDate(VERSIONS, '2026-08-20').seq, 2, 'a September rule reached back into August');
  assert.equal(versionForDate(VERSIONS, '2026-09-01').seq, 3);
});

test('a date before the first recorded version has no version', () => {
  // Not version 1 by default: history the system holds no rules for is
  // answered by the caller with the live policy, exactly as before any of this
  // existed. Claiming version 1 covered it would attach rules to hours that
  // were computed under something nobody recorded.
  assert.equal(versionForDate(VERSIONS, '2025-12-31'), null);
});

test('two versions on one day: the later answer stands', () => {
  // Somebody changed their mind before lunch. `seq` breaks the tie because it
  // is the only strictly increasing thing on the record.
  const sameDay = [V(4, '2026-08-10'), V(5, '2026-08-10'), V(2, '2026-08-01')];
  assert.equal(versionForDate(sameDay, '2026-08-10').seq, 5);
  assert.equal(versionForDate(sameDay, '2026-08-09').seq, 2);
});

test('order of the list does not decide the answer', () => {
  // It arrives from a query, and a query's order is not a rule.
  const shuffled = [VERSIONS[2], VERSIONS[0], VERSIONS[1]];
  assert.equal(versionForDate(shuffled, '2026-08-09').seq, 1);
  assert.equal(versionForDate(shuffled, '2026-08-11').seq, 2);
});

test('no versions, or no date, is null rather than a guess', () => {
  assert.equal(versionForDate([], '2026-08-09'), null);
  assert.equal(versionForDate(undefined, '2026-08-09'), null);
  assert.equal(versionForDate(VERSIONS, ''), null);
  assert.equal(versionForDate(VERSIONS, undefined), null);
});

test('a version with no effective date is ignored, not treated as forever-ago', () => {
  // Rows written before this field existed are backfilled by the migration; one
  // that slipped through must not silently become the answer for all history.
  assert.equal(versionForDate([{ seq: 1, policy: {} }], '2026-08-09'), null);
});

// ── announcing one ──────────────────────────────────────────────────────────

test('today and any future date may be announced', () => {
  assert.equal(effectiveFromRefusal('2026-08-14', '2026-08-14'), null);
  assert.equal(effectiveFromRefusal('2026-09-01', '2026-08-14'), null);
});

test('backdating is refused, and the message says why', () => {
  /**
   * The whole design in one rule. A backdated version would reach behind
   * entries already computed, printed and possibly paid, and change what they
   * were worth — which is the retroactive restatement the work-date rule exists
   * to prevent. A rule that really did apply earlier is a correction to make
   * entry by entry, with a reason on each.
   */
  const refusal = effectiveFromRefusal('2026-08-13', '2026-08-14');
  assert.equal(refusal.status, 400);
  assert.match(refusal.error, /ย้อนหลังไม่ได้/);
});

test('a malformed date is refused before it can be compared', () => {
  // String comparison is what decides everything here, and '2026-8-1' sorts
  // between '2026-01-01' and '2026-09-01' in ways nobody intends.
  for (const bad of ['', '   ', '2026-8-1', '14/08/2026', 'วันนี้', null, undefined]) {
    assert.equal(effectiveFromRefusal(bad, '2026-08-14').status, 400, String(bad));
  }
});

// ── and the screen says which day it is, BEFORE the save ────────────────────

/**
 * The rule above is invisible from the settings page. `effectiveFrom` is a
 * date box beside a reason box, several rows above the dropdowns, and the
 * consequence of what is in it — that work done before that day keeps its old
 * rate for good — is a sentence nobody can infer from a date input.
 *
 * Worse, changing a dropdown WAS the save: one click appended a version that
 * can never be edited and replayed every entry in flight. The reason and the
 * date had to have been typed first, in that order, or the record was written
 * without them.
 *
 * So the change is proposed, stated in full, and only then sent. Read as source
 * text for the reason test/rosterRouteGuards.test.js is — the screen resolves
 * `@/…` through the Next alias and cannot be imported by `node --test`.
 */
const screen = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'components/AdminView.jsx'),
  'utf8',
);

test('choosing an answer proposes it — the PATCH waits for the dialog', () => {
  // The dropdown holds the proposal; nothing but the dialog's own button saves.
  //
  // NO `e` SINCE 2026-09-04. The control is a `PickOne` and not a `<select>` —
  // seventeen sentence-long answers that the operating system was drawing
  // outside this document — so what arrives is the row's own value rather than
  // an event to read `target.value` off. What is asserted is unchanged and is
  // the whole of the point: choosing PROPOSES, and only the dialog saves.
  assert.match(screen, /onChange=\{\(v\) => setPending\(\{ field: f, value: coerce\(f, v\) \}\)\}/, 'the dropdown saves on change again');
  assert.match(screen, /onConfirm=\{\(\) => save\(pending\.field\.key, pending\.value\)\}/);
  // And cancelling sends nothing at all.
  assert.match(screen, /onCancel=\{\(\) => setPending\(null\)\}/);
});

test('the dialog names the day the new rules start', () => {
  // The one thing about this page nobody can work out by looking at it, said at
  // the moment it is being decided rather than in a hint further up.
  assert.match(screen, /กฎใหม่มีผลกับใบของงานที่ทำตั้งแต่วันที่ \{thaiDate\(effectiveFrom\)\}/);
  // And whether this particular rule moves hours at all — half of them do not,
  // and "จะคำนวณใหม่" said of a permission flag is a warning people learn to
  // ignore on the rules where it is true.
  assert.match(screen, /const arithmetic = ARITHMETIC_KEYS\.includes\(field\.key\)/);
});
