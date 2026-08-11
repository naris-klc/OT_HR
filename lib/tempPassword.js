/**
 * The password HR reads down the phone on somebody's first day.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACED, AND WHY IT HAD TO GO
 *
 * It used to be `Primus@` + the employee code with the punctuation stripped —
 * `defaultPassword()` in lib/employees.js. Every account that had not yet been
 * logged into had a password anybody could compute from the roster, and the
 * roster is not a secret: it is printed on every ใบ F-HR-027 and every file sent
 * to accounting. One person who noticed the shape had every unclaimed account in
 * the company, and the ones most likely to be unclaimed are the new hires nobody
 * would miss for a week.
 *
 * Worse, one of the two places it was computed was THE BROWSER: ตั้งรหัสใหม่
 * prefilled the field with `defaultPassword(employee.code)` and PATCHed whatever
 * was in it, so the value a password was reset to never came from the server at
 * all. A generator that runs on the client is not a generator, it is a
 * suggestion — anything with a devtools console could send something else.
 *
 * So: `node:crypto`, on the server, and nowhere else. This module is deliberately
 * separate from lib/employees.js, which client components import — importing
 * `node:crypto` from a 'use client' module is exactly the mistake being fixed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT LOOKS LIKE THIS AND NOT LIKE 24 RANDOM BYTES
 *
 * `gof-mez-tab-4827`. It is read aloud over a phone by one person and typed by
 * another, often on a shared machine on the shop floor, and a password nobody
 * can transcribe comes back as a second call to HR — or, worse, gets written on
 * a note beside the terminal, which is a downgrade no amount of entropy repays.
 *
 *   · consonant-vowel-consonant blocks, so every block is a syllable somebody
 *     can say instead of spelling out;
 *   · lowercase throughout, which removes the O/o and the "is that a capital"
 *     question entirely — and with it the caps-lock failure at the login screen;
 *   · the glyphs that get misheard or mistyped are simply absent: no `l`, `i`,
 *     `1`, `0` or `o`-vs-zero confusion, because `0` and `1` are not in the
 *     digit set and `l`/`i` are not in the letter set;
 *   · digits last, in one run, so the reader can say "…แล้วตามด้วยเลขสี่ตัว"
 *     rather than interleaving two alphabets.
 *
 * That costs entropy against a fully random string of the same length and it is
 * bought back with length: 19 consonants × 4 vowels × 19 consonants per block,
 * three blocks, four digits from a set of eight — about 43 bits. For a
 * credential that exists to be replaced at the first login (`mustChangePassword`
 * on the model, enforced by the client shell before any other screen opens) and
 * that is never the account's password for long, that is the right trade. It is
 * NOT a general-purpose password generator and should not be reused as one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `randomInt`, not `Math.random()` and not `% alphabet.length`. The first is not
 * a CSPRNG; the second biases toward the front of the alphabet whenever the
 * range does not divide 2^32 evenly, which is every alphabet here. `randomInt`
 * rejects-and-retries internally, so each position is uniform.
 */
import { randomInt } from 'node:crypto';

/** No `l` — it is read as `1` and as `I`. */
const CONSONANTS = 'bcdfghjkmnpqrstvwxz';
/** No `i` — same three-way confusion, from the other side. */
const VOWELS = 'aeou';
/** No `0` or `1`, so the letters above can never be mistaken for a digit. */
const DIGITS = '23456789';

const BLOCKS = 3;
const DIGIT_COUNT = 4;

/**
 * The glyphs deliberately left out, exported so the test can state the rule
 * rather than re-listing it. `O` and `I` are here as the uppercase halves of
 * pairs the lowercase output cannot produce anyway — a generator that started
 * emitting uppercase would fail the test rather than quietly reintroduce them.
 */
export const AMBIGUOUS_GLYPHS = Object.freeze(['0', '1', 'l', 'I', 'i', 'O']);

const pickFrom = (alphabet) => alphabet[randomInt(alphabet.length)];

/**
 * One temporary password: three sayable blocks and four digits.
 *
 * Takes no arguments, on purpose. Passing the employee in is how the old one
 * came to be derived from the code — a generator that can see the account is a
 * generator somebody will eventually make depend on it, and the whole failure
 * being fixed here is a password that could be computed from the roster.
 */
export function generateTempPassword() {
  const blocks = [];
  for (let i = 0; i < BLOCKS; i += 1) {
    blocks.push(pickFrom(CONSONANTS) + pickFrom(VOWELS) + pickFrom(CONSONANTS));
  }
  let digits = '';
  for (let i = 0; i < DIGIT_COUNT; i += 1) digits += pickFrom(DIGITS);
  return `${blocks.join('-')}-${digits}`;
}
