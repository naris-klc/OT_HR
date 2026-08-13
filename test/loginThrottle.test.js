import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORGET_AFTER_MS, FREE_ATTEMPTS, MAX_DELAY_MS, THROTTLE_HINT,
  delayFor, failuresFor, hintFor, recordFailure, recordSuccess, resetThrottle, throttleKey,
} from '../lib/loginThrottle.js';

/**
 * A PASSWORD GUESSER IS SLOWED DOWN; NOBODY IS LOCKED OUT.
 *
 * HR's answer, 2026-08-13. The ฝ่ายบุคคล login is shared by the whole
 * department, so an account lockout is a department lockout, triggered by one
 * colleague mistyping — and undone only by an administrator. A delay is paid by
 * whoever is typing and costs a program working a dictionary its whole method.
 *
 * These pin the two halves separately: the curve, which is pure arithmetic, and
 * the store, which is a Map with a clock. Both are the reasons this is not
 * written inline in the login route.
 *
 * Run with: npm test
 */

test('the first five failures cost nothing', () => {
  // Somebody who has forgotten which of two passwords is the current one gets
  // to find out without the screen appearing to hang.
  for (let n = 0; n < FREE_ATTEMPTS; n++) assert.equal(delayFor(n), 0, `failure ${n}`);
});

test('the wait starts at one second and doubles', () => {
  assert.equal(delayFor(5), 1000);
  assert.equal(delayFor(6), 2000);
  assert.equal(delayFor(7), 4000);
  assert.equal(delayFor(8), 8000);
  assert.equal(delayFor(9), 16000);
});

test('the wait is capped, and stays capped however long they keep going', () => {
  assert.equal(delayFor(10), MAX_DELAY_MS);
  assert.equal(delayFor(50), MAX_DELAY_MS);
  assert.equal(delayFor(5000), MAX_DELAY_MS);
});

test('a count that is not a number is not a wait', () => {
  // The store cannot produce these, but a caller reading a count off a stale
  // payload could. A NaN reaching setTimeout is a delay of zero dressed up as a
  // decision, so it is refused here where it can be seen.
  for (const junk of [undefined, null, NaN, 'ห้า', {}]) assert.equal(delayFor(junk), 0, String(junk));
});

test('the hint appears on the failure the delay starts on, not before', () => {
  assert.equal(hintFor(4), null, 'told to ring HR after four ordinary mistakes');
  assert.equal(hintFor(FREE_ATTEMPTS), THROTTLE_HINT);
  assert.equal(hintFor(99), THROTTLE_HINT);
});

test('the hint names ฝ่ายบุคคล AND the administrator, because HR use this too', () => {
  // The loop this sentence exists to avoid: the shared HR login is the one most
  // likely to be typed wrongly by several people, and "ask HR" is not an answer
  // when you ARE HR.
  assert.match(THROTTLE_HINT, /ฝ่ายบุคคล/);
  assert.match(THROTTLE_HINT, /ผู้ดูแลระบบ/);
  // And it says neither which account this is nor whether it exists.
  assert.doesNotMatch(THROTTLE_HINT, /ไม่พบ|ไม่มีบัญชี|บัญชีนี้/);
});

test('moving the hyphen does not buy five more guesses', () => {
  // The roster holds PM-0620 and PM00511 side by side and the login accepts
  // either spelling, so a counter kept under the typed string would reset on
  // every punctuation change. This is the whole reason for normalising.
  assert.equal(throttleKey('PM-0620'), throttleKey('pm0620'));
  assert.equal(throttleKey('PM_0620'), throttleKey('pm 0620'));
  assert.notEqual(throttleKey('PM-0620'), throttleKey('PM-0621'));
});

test('failures accumulate per code, and one code does not slow another', () => {
  resetThrottle();
  const now = 1_000_000;
  for (let i = 0; i < 6; i++) recordFailure(throttleKey('PM-0412'), now);

  assert.equal(failuresFor(throttleKey('PM-0412'), now), 6);
  assert.equal(failuresFor(throttleKey('pm 0412'), now), 6, 'the same person, spelled differently');
  assert.equal(failuresFor(throttleKey('PM-0620'), now), 0, 'a colleague was slowed down too');
});

test('getting it right forgives everything before it', () => {
  resetThrottle();
  const now = 1_000_000;
  const key = throttleKey('PM-0412');
  for (let i = 0; i < 4; i++) recordFailure(key, now);
  assert.equal(failuresFor(key, now), 4);

  recordSuccess(key);
  assert.equal(failuresFor(key, now), 0, 'tomorrow they would start one fumble from a delay');
  assert.equal(delayFor(failuresFor(key, now)), 0);
});

test('a count with nothing behind it for fifteen minutes is forgotten', () => {
  resetThrottle();
  const now = 1_000_000;
  const key = throttleKey('PM-0412');
  for (let i = 0; i < 9; i++) recordFailure(key, now);
  assert.equal(delayFor(failuresFor(key, now)), 16000);

  assert.equal(failuresFor(key, now + FORGET_AFTER_MS - 1), 9, 'forgotten a moment too early');
  assert.equal(failuresFor(key, now + FORGET_AFTER_MS), 0);
});

test('a run of failures keeps the count alive — the clock is on the LAST one', () => {
  // Otherwise a guesser could outlast the window by pacing themselves, and the
  // delay they had earned would be handed back mid-run.
  resetThrottle();
  const key = throttleKey('PM-0412');
  let at = 1_000_000;
  for (let i = 0; i < 8; i++) {
    recordFailure(key, at);
    at += FORGET_AFTER_MS - 1000; // just inside the window, every time
  }
  assert.equal(failuresFor(key, at), 8);
});

test('an aged-out entry is dropped rather than left to grow', () => {
  resetThrottle();
  const now = 1_000_000;
  recordFailure(throttleKey('PM-0001'), now);
  // A later failure under a different code prunes what has expired, so the map
  // is bounded by distinct codes tried in the window and not by attempts.
  const returned = recordFailure(throttleKey('PM-0002'), now + FORGET_AFTER_MS);
  assert.equal(returned, 1);
  assert.equal(failuresFor(throttleKey('PM-0001'), now + FORGET_AFTER_MS), 0);
});
