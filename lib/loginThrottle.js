/**
 * Slowing down a password guesser without locking anybody out.
 *
 * HR's answer, 2026-08-13: NO ACCOUNT LOCKOUT. The ฝ่ายบุคคล login is shared by
 * the whole department, so one person mistyping five times would put every one
 * of their colleagues out of the system in the middle of a working day — and
 * the recovery for that is an administrator, who may be at lunch. A delay costs
 * the person who mistyped a few seconds and costs a program working through a
 * dictionary everything, which is the asymmetry worth having.
 *
 * WHAT IT IS NOT. This is not a defence against somebody who can send requests
 * faster than one connection at a time, and it is not rate limiting the server.
 * It makes guessing one account's password slow. Anybody wanting more than that
 * wants a reverse proxy in front of this app, which is a decision about the
 * network and not about this file.
 *
 * KEYED ON THE NORMALISED CODE, which is the whole reason `normalizeCode` is
 * imported rather than lower-casing here. The roster holds PM-0620 and PM00511
 * side by side and the login screen accepts either spelling of either, so a
 * counter kept under the typed string would reset every time the guesser moved
 * the hyphen. 'PM-0620', 'pm0620' and 'PM_0620' share one count.
 *
 * The counter is in memory, so restarting the server forgives everybody. That
 * is a real limit and an acceptable one: a restart is not something an attacker
 * can ask for, and the alternative — a write to Mongo on every failed password
 * — puts a database write on the one route that must stay cheap when somebody
 * is hammering it.
 */
/**
 * Relative, not `@/src/...`. The alias is Next's and this module is unit
 * tested — `node --test` resolves neither jsconfig paths nor the alias, so a
 * lib file the tests import has to spell the path out. Every other tested
 * module in this directory does the same (lib/otMode.js, lib/birthDate.js).
 */
import { normalizeCode } from '../src/lib/employeeCode.js';

/** Failures a person may make before anything slows down. */
export const FREE_ATTEMPTS = 5;
/** The wait after the free ones run out; it doubles from here. */
export const FIRST_DELAY_MS = 1000;
/** Long enough to end a dictionary run, short enough not to look broken. */
export const MAX_DELAY_MS = 30_000;
/** A count with no failures for this long is forgotten. */
export const FORGET_AFTER_MS = 15 * 60 * 1000;

/**
 * WHY THE MESSAGE NAMES TWO DIFFERENT PLACES TO GO.
 *
 * "ติดต่อฝ่ายบุคคล" on its own is a loop for the one account most likely to be
 * on the wrong end of this: ฝ่ายบุคคล themselves, whose shared login is typed
 * by several people who each may have been told a different password.
 *
 * It does not ask which account this is, and must not. The server knows —
 * `codeMatcher` has already looked the row up by the time this text is chosen —
 * but printing "this is an HR account, ask an administrator" tells somebody
 * working through employee codes which of their guesses found a real account
 * and which found an important one. One sentence covering both cases leaks
 * nothing and reaches the right desk either way.
 */
export const THROTTLE_HINT = 'กรอกรหัสผ่านผิดหลายครั้งแล้ว — ติดต่อฝ่ายบุคคลเพื่อขอรหัสผ่านใหม่ '
  + 'หากนี่คือบัญชีของฝ่ายบุคคลเอง ให้ติดต่อผู้ดูแลระบบ';

/**
 * How long this caller waits before their next attempt is even checked.
 *
 * Pure, and takes the count rather than reading it, so the shape of the curve
 * can be tested without a clock or a store. 1s, 2s, 4s … capped — the fifth
 * failure is the last free one, and the sixth attempt is the first to wait.
 */
export function delayFor(failures) {
  const n = Number(failures);
  if (!Number.isFinite(n) || n < FREE_ATTEMPTS) return 0;
  return Math.min(FIRST_DELAY_MS * 2 ** (n - FREE_ATTEMPTS), MAX_DELAY_MS);
}

/**
 * The sentence to add to the refusal, or null while there is nothing to say.
 *
 * Appears on the same failure the delay starts on, so somebody who has just
 * been made to wait is told why and what to do about it in the same breath.
 */
export function hintFor(failures) {
  return Number(failures) >= FREE_ATTEMPTS ? THROTTLE_HINT : null;
}

/** 'PM-0620', 'pm0620' and 'PM_0620' are one caller. */
export const throttleKey = (code) => normalizeCode(code);

/**
 * The store. A module-level Map, deliberately — see the note about restarts at
 * the top of this file.
 *
 * `now` is a parameter on everything that reads it so the tests can age an
 * entry without waiting fifteen minutes.
 */
const attempts = new Map();

export function failuresFor(key, now = Date.now()) {
  const seen = attempts.get(key);
  if (!seen) return 0;
  if (now - seen.at >= FORGET_AFTER_MS) {
    attempts.delete(key);
    return 0;
  }
  return seen.failures;
}

/** Returns the new count, which is what decides the delay and the hint. */
export function recordFailure(key, now = Date.now()) {
  const failures = failuresFor(key, now) + 1;
  attempts.set(key, { failures, at: now });
  prune(now);
  return failures;
}

/**
 * A correct password forgives everything that came before it.
 *
 * Somebody who mistyped four times and then got it right is not a suspect, and
 * carrying their count forward would meet them with a delay on the next
 * ordinary day they fumble a password.
 */
export function recordSuccess(key) {
  attempts.delete(key);
}

/**
 * Drop what has aged out.
 *
 * Bounded by the number of DISTINCT codes tried in fifteen minutes rather than
 * by the number of attempts, so a guesser hammering one account adds nothing to
 * it and one working through a code list is cleaned up behind itself.
 */
function prune(now) {
  for (const [key, seen] of attempts) {
    if (now - seen.at >= FORGET_AFTER_MS) attempts.delete(key);
  }
}

/** Test seam. Nothing in the app calls this. */
export function resetThrottle() {
  attempts.clear();
}
