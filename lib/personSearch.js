/**
 * ค้นหาพนักงานจากรหัสหรือชื่อ — the rule behind the search box on
 * กรองตามพนักงาน.
 *
 * WHY THIS IS NOT `includes()` ON THE LINE SHOWN. The list reads
 * "PM-0412 · สมชาย ใจดี", and matching a query against that string directly
 * fails on the first thing anybody types. Half the roster is written PM-0412
 * and half PM00511 — both current, and nobody is renumbering anybody (the
 * whole story is in src/lib/employeeCode.js) — so the person who reads a
 * hyphenated code off a printed sheet and types PM0412 would get nothing, and
 * the person who types PM-00511 out of habit would get nothing either. The
 * code side of a term goes through `normalizeCode()`, the one place in the
 * system that decides when two codes are the same code. The login box, the CSV
 * import and the department sort already ask it; this is a fourth caller, not
 * a fourth copy of the rule.
 *
 * TERMS, NOT ONE STRING. "0412 สมชาย" and "สมชาย 0412" both have to work —
 * word order is not something anybody gets right against a list they cannot
 * see yet. Every whitespace-separated term has to match, but each one may
 * match a different part of the person, so a code fragment and a name fragment
 * narrow together instead of cancelling out.
 *
 * THE SPACE IN A THAI NAME IS NOT LOAD-BEARING. Thai sets no space between
 * words; the one in "สมชาย ใจดี" separates given name from family name and is
 * exactly the keystroke somebody typing at speed leaves out. The name is
 * matched both as written and with its spaces removed, which can only add
 * matches, never take one away.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is reorder. The roster arrives sorted by
 * code and leaves in that order, because the control this feeds replaced a
 * <select>, and a list that reshuffles itself as you type is a list you cannot
 * aim at. Narrowing is the whole of the behaviour.
 *
 * Pure, and its only import is `normalizeCode`, so `node --test` can hold it
 * to the examples above without rendering a thing.
 */

import { normalizeCode } from '../src/lib/employeeCode.js';

/** Runs of whitespace: between terms in a query, and inside a name. */
const SPLIT = /\s+/;
const SPACES = /\s+/g;

/**
 * Could this term be a รหัสพนักงาน at all?
 *
 * `normalizeCode()` keeps [A-Za-z0-9] and drops everything else — which means
 * it drops Thai as readily as it drops a hyphen. So "0412สมชาย" normalises to
 * "0412" and, handed straight to the code test, would match PM-0412 on the
 * strength of a name fragment that was thrown away unread. Codes on this
 * roster are ASCII (PM-0412, PM00511, THT00111, HR-001); a term carrying a
 * Thai character is a name and must never reach the code test.
 *
 * Printable ASCII rather than a list of separators on purpose: the separator
 * class lives in src/lib/employeeCode.js and must stay there. This is not a
 * second copy of it, it is a cheaper question — "is there anything in here
 * that normalising would silently eat".
 */
const COULD_BE_A_CODE = /^[\x20-\x7E]+$/;

/**
 * The query as the terms it is made of. Empty — including a query of nothing
 * but spaces — is no terms at all, which every person passes.
 *
 * @param {unknown} query
 * @returns {string[]}
 */
export function queryTerms(query) {
  const text = String(query ?? '').trim();
  return text === '' ? [] : text.split(SPLIT);
}

/**
 * The three strings a term is tested against, built once per person rather
 * than once per term.
 */
function haystack(person) {
  const name = String(person?.name ?? '').toLowerCase();
  return {
    code: normalizeCode(person?.code),
    name,
    tight: name.replace(SPACES, ''),
  };
}

/**
 * Does one term match this person?
 *
 * The `code !== ''` guard is the other half of COULD_BE_A_CODE. A term of "-"
 * or "·" — one keystroke while typing a code, and the separator the list
 * itself prints between code and name — normalises to '', and
 * `'PM0412'.includes('')` is true of every string on earth. Without the guard
 * a single hyphen would quietly match the entire roster.
 */
function termMatches(hay, term) {
  if (COULD_BE_A_CODE.test(term)) {
    const code = normalizeCode(term);
    if (code !== '' && hay.code.includes(code)) return true;
  }
  const text = term.toLowerCase();
  return hay.name.includes(text) || hay.tight.includes(text);
}

/**
 * Does this person match the whole query?
 *
 * @param {{code?: string, name?: string}} person
 * @param {unknown} query
 * @returns {boolean} true for an empty query — no filter is not "no matches"
 */
export function personMatches(person, query) {
  const terms = queryTerms(query);
  if (terms.length === 0) return true;
  const hay = haystack(person);
  return terms.every((t) => termMatches(hay, t));
}

/**
 * The roster narrowed to the query, in the order it arrived.
 *
 * An empty query hands back the array it was given rather than a copy: the
 * caller memoises on the result, and rebuilding the whole roster into a new
 * array every time the box is cleared would re-render the list for no change.
 *
 * @param {Array<{code?: string, name?: string}>} people
 * @param {unknown} query
 */
export function searchPeople(people, query) {
  const list = Array.isArray(people) ? people : [];
  const terms = queryTerms(query);
  if (terms.length === 0) return list;
  return list.filter((p) => {
    const hay = haystack(p);
    return terms.every((t) => termMatches(hay, t));
  });
}
