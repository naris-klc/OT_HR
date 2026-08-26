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

/* ══ WHERE THE MATCH IS, for drawing it ═════════════════════════════════════

   `personMatches` answers whether a person is in the list. This answers where
   in their name or their code the query landed, so the screen can mark it.

   IT MUST BE THE SAME RULE OR IT IS A LIE. Both halves of the match above are
   fuzzy in ways a plain `indexOf` on the displayed string cannot see:

     THE CODE IS COMPARED NORMALISED. "PM0412" matches a row whose code reads
     "PM-0412", and the literal string "PM0412" appears nowhere in it. So the
     search happens in normalised space and the positions are mapped back
     through an index built while normalising — the hyphen inside a matched run
     is marked along with the digits around it, which is what a reader expects:
     they typed a code and the code lit up.

     THE NAME IS COMPARED BOTH AS WRITTEN AND WITH ITS SPACES REMOVED, because
     the space in "สมชาย ใจดี" is the keystroke somebody typing at speed leaves
     out. Same treatment: match in the tight form, map back, and the space
     inside the run is marked with the letters.

   A highlight computed any other way would mark nothing on the rows the fuzzy
   half of the rule brought in — a row in the list with no visible reason to be
   there, which is worse than no highlight at all.

   Pure, and it returns RANGES rather than markup: what to draw is the
   component's business, and `node --test` can hold this to the examples above
   without rendering anything. */

/**
 * `text` with a chosen set of characters dropped, plus the map back.
 *
 * `index[i]` is the position in the ORIGINAL string of the i-th surviving
 * character, which is what turns a match found in the reduced string into a
 * range of the one on screen.
 */
function reduce(text, keep) {
  let out = '';
  const index = [];
  for (let i = 0; i < text.length; i += 1) {
    if (keep(text[i])) { out += text[i]; index.push(i); }
  }
  return { out, index };
}

/** Every start offset of `needle` in `hay`, including overlapping ones. */
function occurrences(hay, needle) {
  const found = [];
  if (needle === '') return found;
  let at = hay.indexOf(needle);
  while (at !== -1) { found.push(at); at = hay.indexOf(needle, at + 1); }
  return found;
}

/**
 * A Thai syllable is written as a base letter with its vowel and tone stacked
 * ON it — สุ is ส plus U+0E38, two code units and one thing on the page.
 *
 * `\p{M}` is every combining mark in Unicode, which is what these are; naming
 * the Thai block instead would be a list to keep up to date and would say
 * nothing about why. Requires the `u` flag, which is what makes the property
 * escape mean anything at all rather than match the letters p and M.
 */
const COMBINING = /\p{M}/u;

/**
 * A range grown to whole clusters at both ends.
 *
 * WHY THIS IS NOT COSMETIC. A query of "ส" matches the base letter of "สุจินดา"
 * and the raw range is one code unit long — so the mark's own background and
 * padding were drawn BETWEEN ส and the vowel that belongs on it, splitting one
 * syllable into two glyphs with a gap down the middle. Thai sets no spaces
 * between words, so that gap reads as a word break in the middle of a name.
 *
 * Forward: swallow the marks that hang off the last letter. Backward: if a
 * range somehow begins ON a mark, reach back to the letter it belongs to — a
 * combining character rendered alone is a dotted circle, which is not a name.
 */
function toClusters(text, { start, end }) {
  let from = start;
  let to = end;
  while (from > 0 && COMBINING.test(text[from])) from -= 1;
  while (to < text.length && COMBINING.test(text[to])) to += 1;
  return { start: from, end: to };
}

/** Sorted, non-overlapping, touching ranges joined. */
function merge(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

const KEEP_ALL = () => true;
const KEEP_CODE = (ch) => /[A-Za-z0-9]/.test(ch);
const KEEP_NAME = (ch) => !/\s/.test(ch);

/**
 * The parts of one displayed string that the query matched.
 *
 * @param {unknown} text  the string as it appears on screen
 * @param {unknown} query what was typed in the box
 * @param {'name'|'code'} kind which half of the rule to apply
 * @returns {Array<{start: number, end: number}>} half-open, merged, in order;
 *   empty for an empty query — no filter is not "everything matches"
 */
export function matchRanges(text, query, kind) {
  const source = String(text ?? '');
  const terms = queryTerms(query);
  if (source === '' || terms.length === 0) return [];

  const ranges = [];
  const add = (reduced, needle) => {
    for (const at of occurrences(reduced.out, needle)) {
      ranges.push({
        start: reduced.index[at],
        end: reduced.index[at + needle.length - 1] + 1,
      });
    }
  };

  if (kind === 'code') {
    const reduced = reduce(source.toUpperCase(), KEEP_CODE);
    for (const term of terms) {
      if (!COULD_BE_A_CODE.test(term)) continue;
      const key = normalizeCode(term);
      if (key !== '') add(reduced, key);
    }
    return merge(ranges.map((r) => toClusters(source, r)));
  }

  const lower = source.toLowerCase();
  const asWritten = reduce(lower, KEEP_ALL);
  const tight = reduce(lower, KEEP_NAME);
  for (const term of terms) {
    const text2 = term.toLowerCase();
    add(asWritten, text2);
    add(tight, text2.replace(SPACES, ''));
  }
  return merge(ranges.map((r) => toClusters(source, r)));
}

/**
 * One string cut into the pieces a highlight is drawn from.
 *
 * @returns {Array<{text: string, hit: boolean}>} in order, joining back to the
 *   original exactly — a renderer that drops a piece drops characters.
 */
export function highlightParts(text, query, kind) {
  const source = String(text ?? '');
  const ranges = matchRanges(source, query, kind);
  if (ranges.length === 0) return source === '' ? [] : [{ text: source, hit: false }];

  const parts = [];
  let at = 0;
  for (const { start, end } of ranges) {
    if (start > at) parts.push({ text: source.slice(at, start), hit: false });
    parts.push({ text: source.slice(start, end), hit: true });
    at = end;
  }
  if (at < source.length) parts.push({ text: source.slice(at), hit: false });
  return parts;
}
