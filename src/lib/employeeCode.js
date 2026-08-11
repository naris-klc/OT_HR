/**
 * รหัสพนักงาน — the one place that decides when two employee codes are the
 * same code.
 *
 * The roster carries two shapes and both are current: PM-0620 from the paper
 * register HR has always kept, and PM00511 from the newer file. Nobody is going
 * to renumber anybody, so the system has to treat a hyphen as noise — the person
 * who types PM0620 into the login box is the person whose row says PM-0620, and
 * a roster file spelling a code the other way is an update to that row, not a
 * second employee.
 *
 * WHAT IS STORED DOES NOT CHANGE. The normalised form is a comparison key and
 * nothing else: it is never written to a document, never shown on a screen and
 * never printed on F-HR-027. The code on a row stays the code somebody typed,
 * because that is the string payroll reads back on their own sheets.
 *
 * ONE MODULE, for the reason `rosterPermission` is one function: this rule is
 * asked by four callers across two servers — the App Router login, the Express
 * login, the CSV import and the department report's sort — and a rule spelled
 * out four times is a rule that will be right in three places. It was, in fact,
 * spelled out nowhere: each of those four compared raw strings, so PM0620 could
 * not log in and a roster file could mint a duplicate of somebody already on it.
 *
 * Pure — no I/O and no model imports, so both servers, the browser bundle and
 * `node --test` can all load it.
 */

/**
 * Everything that is not a letter or a digit, which is exactly `/\W|_/`
 * (`\W` is `[^A-Za-z0-9_]`, and the alternation adds the underscore back).
 * Written as the explicit class because `codeMatcher()` below has to hand the
 * same class to MongoDB, and the two must be provably the same set — a
 * separator the matcher tolerated but the normaliser kept, or the reverse,
 * would mean the database found a row that JS then said was somebody else.
 */
const SEPARATORS = /[^A-Za-z0-9]+/g;
const SEPARATOR_CLASS = '[^A-Za-z0-9]*';

/**
 * The comparison key for a รหัสพนักงาน — separators removed, upper-cased.
 *
 * 'PM-0620', 'pm 0620' and 'PM_0620' all give 'PM0620'. HR has confirmed that
 * no two codes on the roster collide once the separators come off, which is
 * what makes this safe to compare on; the CSV import re-checks that property
 * for every file it is handed rather than assuming it holds forever.
 *
 * @param {unknown} code
 * @returns {string} '' when there is nothing left to compare
 */
export function normalizeCode(code) {
  return String(code ?? '').replace(SEPARATORS, '').toUpperCase();
}

/**
 * Are these the same employee code?
 *
 * Empty is never equal to anything, including another empty: a row with no code
 * is a row with no code, not a match for every other one.
 */
export function sameCode(a, b) {
  const key = normalizeCode(a);
  return key !== '' && key === normalizeCode(b);
}

/**
 * The locale the roster is ordered in.
 *
 * NAMED AND FIXED, because the alternative is not "the user's locale" — it is
 * whatever ICU the code happens to be running under. `localeCompare()` with no
 * locale asks the host: Node's default on the server, the browser's on the
 * client. สรุป OT แยกแผนก is regrouped in `lib/departmentSummary.js` on BOTH
 * sides — the screen sorts it in the browser and the CSV export sorts it in the
 * route — so an unnamed locale is two different sort orders over one month, and
 * the department comparing its printout against the screen finds the rows in a
 * different order with no explanation on either.
 *
 * 'en' rather than 'th': these are ASCII codes, and Thai collation has opinions
 * about letters that never appear in one.
 */
export const CODE_LOCALE = 'en';

/**
 * Order two employee codes — by normalised form, so PM-0620 and PM0620 sort as
 * the same string rather than a hyphen's distance apart.
 */
export function compareCodes(a, b) {
  return normalizeCode(a).localeCompare(normalizeCode(b), CODE_LOCALE);
}

/**
 * A MongoDB matcher for "whatever row has this code, however it is spelled".
 *
 * Matches exactly the strings `normalizeCode()` maps to the same key: the
 * normalised characters in order, with any run of separators allowed between
 * and around them. So a stored 'PM-0620' is found by 'pm0620' and vice versa,
 * and 'PM06200' is not found by either.
 *
 * The key is built from `normalizeCode()`, whose output is [A-Z0-9] only, so
 * there is no regex metacharacter that could survive into the pattern.
 *
 * A LOOKUP, NOT THE DECISION. Callers re-check the row they get back with
 * `sameCode()`. The regex cannot use the unique index on `code`, and a lookup
 * that has to be believed is a lookup that has to be perfect; `sameCode()` is
 * the same string comparison the rest of the system reasons about, so it stays
 * the decider.
 *
 * @returns {RegExp|null} null when the code normalises to nothing — a caller
 *   must treat that as "no match", never as "match everything"
 */
export function codeMatcher(code) {
  const key = normalizeCode(code);
  if (!key) return null;
  const pattern = SEPARATOR_CLASS + [...key].join(SEPARATOR_CLASS) + SEPARATOR_CLASS;
  return new RegExp(`^${pattern}$`, 'i');
}

/**
 * Rows of an import whose codes are the same code as each other.
 *
 * The CSV import cannot resolve these: two rows normalising to PM0620 are two
 * claims about one employee, and there is no reading of the file that says
 * which one is meant. Importing the rest and skipping these would be worse than
 * refusing — the roster would end up holding whichever of the two the loop
 * reached last, with nothing on any screen saying a choice was made.
 *
 * Reported by line so HR can fix the file rather than hunt for the clash. Codes
 * that normalise to nothing are left out: those rows fail on their own, with
 * the message about a missing code.
 *
 * @param {Array<{ line: number, code: unknown }>} entries
 * @returns {Array<{ key: string, rows: Array<{ line: number, code: string }> }>}
 */
export function codeCollisions(entries = []) {
  const byKey = new Map();

  for (const { line, code } of entries) {
    const key = normalizeCode(code);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ line, code: String(code ?? '') });
  }

  return [...byKey.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, rows }))
    .sort((a, b) => a.rows[0].line - b.rows[0].line);
}

/**
 * `codeCollisions()` as the sentence the import returns — HR reads this and
 * goes to those lines, so the clashing spellings are quoted alongside them.
 */
export function collisionMessage(collisions) {
  const detail = collisions
    .map(({ rows }) => `บรรทัด ${rows.map((r) => r.line).join(', ')} (${rows.map((r) => r.code).join(' / ')})`)
    .join(' · ');
  return 'ไฟล์นี้มีรหัสพนักงานที่ถือเป็นรหัสเดียวกันซ้ำกันเอง จึงไม่ได้นำเข้าทั้งไฟล์ '
    + '— แก้ให้เหลือแถวเดียวต่อคนแล้วอัปโหลดใหม่: '
    + detail;
}
