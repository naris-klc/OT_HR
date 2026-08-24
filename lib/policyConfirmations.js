/**
 * HR signing off a rule the system was already running on.
 *
 * The act this file performs is deliberately almost nothing: it writes a name,
 * a timestamp, and — since 2026-08-24 — the value being signed off, beside an
 * item id. No value moves, no version is appended, no entry is recomputed. That
 * is not a limitation to be worked around later — it is the point, and every
 * function here is shaped to make the opposite impossible rather than merely
 * unlikely.
 *
 * Two rules hold it in place:
 *
 *   1. Confirmations live on `Setting.policyConfirmations`, a sibling of
 *      `Setting.policy`. `effectivePolicy()` reads only `policy`, so nothing
 *      written here can reach the engine, a policy version, or a hash. The
 *      values copied into a record are a COPY for comparison, and they are
 *      copied into the sibling — never back.
 *   2. `confirmPolicyItem` never touches `doc.policy`. It is the only writer,
 *      and test/policyConfirmation.test.js reads this source to check it stays
 *      that way — the same standing-check pattern as rejectedNeverCounted.
 *
 * WHAT A SIGNATURE IS ATTACHED TO. Until 2026-08-24 a record was
 * `{ by, byName, at }` and nothing else, which made it a signature on a
 * question rather than on an answer: the settings page could move
 * `belowMinimum` from 'accept' to 'reject' the next morning and the sign-off
 * of 14 August would still be sitting under it, now appearing to endorse a
 * value nobody had seen. `unconfirmedState` even read the answer live on every
 * call — correctly, so the row could never show a stale value — which meant
 * nothing anywhere held the value that was actually agreed.
 *
 * So a record now carries `values`, and a sign-off STANDS only while the live
 * policy still gives those answers. When it does not, the item reports itself
 * unconfirmed again and says what was agreed and what it is now. The signature
 * is not deleted and not edited: `applyConfirmation` writes a new record with
 * the old one hanging off `supersedes`, so the chain is the history of what HR
 * has agreed to and when.
 *
 * THE FOUR SIGNED ON 2026-08-14 CANNOT BE REPAIRED. They were written before
 * any of this existed, so no value can honestly be attributed to them — the
 * policy has moved since, and back-filling today's answers would manufacture
 * evidence that HR agreed to them. They are reported as `state: 'unrecorded'`,
 * which reads on the page as ยืนยันแล้ว — ทวนอีกครั้ง: kept, dated, named, and
 * marked as a sign-off whose subject the system did not record. Deleting them
 * would be worse than useless; so would pretending they cover today's values.
 *
 * Everything here is pure — no mongoose, no clock. `lib/policyConfirmSave.js`
 * is the thin wrapper that loads and saves the document, and it is a separate
 * file so that this one can be imported by a test without dragging mongoose
 * into it: importing a model costs a third of a second of driver setup for a
 * suite that never opens a connection.
 *
 * The split earns something beyond speed. `applyConfirmation` takes the
 * document rather than fetching it, so the rule this file exists to hold — that
 * a sign-off never touches `policy` — can be checked against a plain object,
 * which is what test/policyConfirmation.test.js does.
 */

import { HR_UNCONFIRMED, HR_UNCONFIRMED_SINCE, readUnconfirmed } from '../src/config/policy.js';

const byId = new Map(HR_UNCONFIRMED.map((item) => [item.id, item]));

export function unconfirmedItem(id) {
  return byId.get(String(id ?? '')) || null;
}

/**
 * ที่มาของคำตอบ — what HR was told, or who asked, in their own words.
 *
 * Optional by design. A sign-off with no note is exactly as valid as one with,
 * and demanding a reason before a button works is how a button stops being
 * pressed. What it is not is unlimited: this ends up on an audit screen beside
 * a name and a date, and a paragraph there is a paragraph nobody reads.
 *
 * Trimmed to null rather than to '' so a note that was never written and a note
 * that was cleared are the same absence in the record.
 */
export const CONFIRM_NOTE_MAX_CHARS = 300;

export function normaliseConfirmNote(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { value: null };
  if (value.length > CONFIRM_NOTE_MAX_CHARS) {
    return {
      error: `ที่มาของคำตอบต้องไม่เกิน ${CONFIRM_NOTE_MAX_CHARS} ตัวอักษร (ขณะนี้ ${value.length})`,
    };
  }
  return { value };
}

/**
 * The answers this item is about, lifted out of a policy.
 *
 * Keyed by `item.keys`, which is the catalogue's own statement of what question
 * an item asks — so an item that grows a second flag starts recording both
 * without anything here changing, and an item whose flag is retired stops
 * comparing against a key the policy no longer has.
 *
 * An item with no keys yields `{}`, and `{}` compares equal to `{}` for ever.
 * That is the honest answer for a question with no value to point at — the case
 * `minimumScope` was in until 2026-08-13 — but it means such an item's sign-off
 * can never go stale, and if one comes back the badge will need another way to
 * notice. Recorded here rather than guarded against, because a guard would have
 * to invent a rule for a shape that does not currently exist.
 */
export function confirmedValues(item, policy = {}) {
  const out = {};
  for (const key of item?.keys || []) out[key] = policy?.[key];
  return out;
}

/** Values compare as their JSON, the way `diffPolicy` compares policy keys. */
function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Does a sign-off still cover what the system is doing?
 *
 *   'never'      — nobody has signed it.
 *   'current'    — signed, and every value it named is still the live one.
 *   'moved'      — signed, but at least one value has changed since. The badge
 *                  comes back; `changes` is what to say on the row.
 *   'unrecorded' — signed before records carried values (2026-08-14). Whether
 *                  it still covers anything is not knowable, which is itself
 *                  the finding.
 *
 * COMPARED ON `item.keys` AND NOTHING ELSE. `roundingIncrement`'s reading also
 * mentions `roundingMode`, because "ทีละ 30 นาที" is meaningless under
 * 'คิดตามจริง' — but the question HR answered was about the increment, and
 * switching the mode does not un-answer it. What it does is make the increment
 * inert, which the settings page says in its own words; see lib/policyInert.js.
 */
export function confirmationStanding(item, record, policy = {}) {
  if (!record) return { state: 'never', changes: [] };
  if (!record.values || typeof record.values !== 'object') {
    return { state: 'unrecorded', changes: [] };
  }

  const now = confirmedValues(item, policy);
  const changes = Object.keys(record.values)
    .filter((key) => !sameValue(record.values[key], now[key]))
    .map((key) => ({ key, was: record.values[key] ?? null, now: now[key] ?? null }));

  return { state: changes.length ? 'moved' : 'current', changes };
}

/**
 * One confirmation record.
 *
 * `at` is passed in rather than read from the clock so that this stays pure and
 * so the caller — which is the only thing here that knows what "now" means —
 * cannot be second-guessed by a test that runs at midnight. `values`,
 * `reading` and `policyVersionId` are passed in for the same reason: they are
 * facts about the moment of signing, and a record that fetched them itself
 * could be built for a moment that had already passed.
 *
 * `reading` is stored as well as `values` and is not redundant. The values are
 * what the comparison runs on; the sentence is what a person signed, and it
 * cannot be recomputed afterwards from the values alone — `roundingIncrement`
 * reads `roundingMode` to phrase itself, and replaying it against today's
 * policy would put an old number in a new sentence.
 */
export function confirmationRecord(actor, at, {
  values = null, reading = null, policyVersionId = null, note = null, supersedes = null,
} = {}) {
  return {
    by: actor?._id ? String(actor._id) : null,
    /** Denormalised on purpose: an employee row can be deleted, a signature cannot. */
    byName: actor?.name || actor?.code || null,
    at: at instanceof Date ? at.toISOString() : String(at),
    /** The answers as they stood — the thing the signature is actually on. */
    values,
    /** Those answers in words, as the page put them at the time. */
    reading,
    /** The whole rule set they sat in, when the live rules were on record. */
    policyVersionId: policyVersionId ? String(policyVersionId) : null,
    note,
    /** The sign-off this one replaces, kept whole. Null for a first signature. */
    supersedes,
  };
}

/** A record as a screen may read it — every field, none of them undefined. */
function publicRecord(record) {
  if (!record) return null;
  return {
    by: record.by ?? null,
    byName: record.byName ?? null,
    at: record.at ?? null,
    values: record.values ?? null,
    reading: record.reading ?? null,
    policyVersionId: record.policyVersionId ?? null,
    note: record.note ?? null,
    /** Depth only — the chain itself is on the document for anyone auditing it. */
    supersededCount: countSuperseded(record),
  };
}

function countSuperseded(record) {
  let n = 0;
  let cur = record?.supersedes;
  while (cur) { n += 1; cur = cur.supersedes; }
  return n;
}

/**
 * The catalogue as a screen reads it: every question this system has not had a
 * straight answer to, the answer the live policy currently gives, and what HR
 * has signed if anything.
 *
 * `reading` is read from `policy` on every call rather than taken from the
 * record. A confirmation says "this rule is ours now"; the row must show the
 * rule that is running, or it is the one thing on this screen that could
 * quietly lie. What the record holds is shown BESIDE it, labelled as what was
 * agreed — which is the whole point of holding it.
 *
 * `confirmed` is the record and `stands` is whether it still covers the live
 * value. They are separate fields because a screen needs both at once: the
 * badge comes off `stands`, and the line naming who signed and when comes off
 * `confirmed`, and an item that has moved has to show both.
 */
export function unconfirmedState(policy, confirmations = {}) {
  return HR_UNCONFIRMED.map((item) => {
    const record = confirmations?.[item.id] || null;
    const { state, changes } = confirmationStanding(item, record, policy);

    return {
      id: item.id,
      label: item.label,
      keys: [...item.keys],
      note: item.note,
      reading: readUnconfirmed(item, policy),
      /**
       * Per item, falling back to the date the catalogue was opened. A question
       * added later has been unanswered since IT arrived, not since the first
       * three did — `startBuffer` came on 2026-08-13, and printing 2026-08-07
       * beside it would age it by a week it did not exist for.
       */
      since: item.since || HR_UNCONFIRMED_SINCE,
      confirmed: publicRecord(record),
      /**
       * WHETHER THE SIGNATURE COVERS TODAY'S VALUE. The pill and the ยืนยัน
       * button both read this rather than `confirmed`, so a rule that moved
       * after it was agreed asks the question again on its own.
       */
      state,
      stands: state === 'current',
      changes,
    };
  });
}

/**
 * Every settings-page key that some question is still waiting on.
 *
 * It lived in src/config/policy.js until 2026-08-24 and could not stay there: it
 * skipped an item the moment a record existed under its id, which was the same
 * mistake the record itself was making — treating a signature as permanent when
 * what it covers is one set of values. It needs the live policy to know that,
 * and the comparison lives here.
 *
 * A sign-off that has gone stale, and one written before records carried values
 * at all, both leave the key on the list. That is the point: those are the two
 * ways an item can look answered while nobody has answered it.
 */
export function unconfirmedKeys(confirmations = {}, policy = {}) {
  const keys = new Set();
  for (const item of HR_UNCONFIRMED) {
    const { state } = confirmationStanding(item, confirmations?.[item.id] || null, policy);
    if (state === 'current') continue;
    for (const key of item.keys) keys.add(key);
  }
  return keys;
}

/**
 * Write one confirmation onto a settings document. Returns `{ error, status }`
 * for a caller to hand straight to `fail()`, or `{ changed, confirmations }`.
 *
 * Mutates `doc.policyConfirmations` and NOTHING ELSE — `doc.policy` is not read
 * and not assigned anywhere in this function, which is the property the whole
 * file exists to hold. `policy` is a parameter, read to copy values OUT of; the
 * caller saves.
 *
 * Idempotent WHILE THE SIGN-OFF STANDS: pressing ยืนยัน twice on an unchanged
 * rule must not re-date a sign-off that already happened, or the record of when
 * a rule became HR's answer would move every time somebody clicked around the
 * page. Once the value has moved — or where the old record never said which
 * value it was about — pressing it again is a NEW answer to a question that has
 * come back, so a new record is written with the previous one kept whole under
 * `supersedes`. Nothing is ever edited or dropped.
 */
export function applyConfirmation(doc, {
  id, actor, at = new Date(), policy = {}, policyVersionId = null, note = null,
}) {
  const item = unconfirmedItem(id);
  if (!item) return { error: `ไม่รู้จักข้อที่รอยืนยัน: ${id}`, status: 400 };

  const confirmations = { ...(doc?.policyConfirmations || {}) };
  const existing = confirmations[item.id] || null;
  const { state } = confirmationStanding(item, existing, policy);
  if (state === 'current') return { changed: false, confirmations };

  confirmations[item.id] = confirmationRecord(actor, at, {
    values: confirmedValues(item, policy),
    reading: readUnconfirmed(item, policy),
    policyVersionId,
    note,
    supersedes: existing,
  });
  doc.policyConfirmations = confirmations;
  return { changed: true, confirmations };
}
