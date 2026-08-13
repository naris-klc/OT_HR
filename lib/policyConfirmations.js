/**
 * HR signing off a rule the system was already running on.
 *
 * The act this file performs is deliberately almost nothing: it writes a name
 * and a timestamp beside an item id. No value moves, no version is appended, no
 * entry is recomputed. That is not a limitation to be worked around later — it
 * is the point, and every function here is shaped to make the opposite
 * impossible rather than merely unlikely.
 *
 * Two rules hold it in place:
 *
 *   1. Confirmations live on `Setting.policyConfirmations`, a sibling of
 *      `Setting.policy`. `effectivePolicy()` reads only `policy`, so nothing
 *      written here can reach the engine, a policy version, or a hash.
 *   2. `confirmPolicyItem` never touches `doc.policy`. It is the only writer,
 *      and test/policyConfirmation.test.js reads this source to check it stays
 *      that way — the same standing-check pattern as rejectedNeverCounted.
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
 * One confirmation record.
 *
 * `at` is passed in rather than read from the clock so that this stays pure and
 * so the caller — which is the only thing here that knows what "now" means —
 * cannot be second-guessed by a test that runs at midnight.
 */
export function confirmationRecord(actor, at) {
  return {
    by: actor?._id ? String(actor._id) : null,
    /** Denormalised on purpose: an employee row can be deleted, a signature cannot. */
    byName: actor?.name || actor?.code || null,
    at: at instanceof Date ? at.toISOString() : String(at),
  };
}

/**
 * The catalogue as a screen reads it: every unconfirmed question, its answer as
 * the live policy actually gives it, and who signed it off if anybody has.
 *
 * The answer is read from `policy` on every call rather than stored alongside
 * the confirmation. A confirmation says "this rule is ours now"; if HR later
 * changes the value through the settings page, the row must show the new value
 * — a stale copy of what was agreed in August would be the one thing on this
 * screen that could quietly lie.
 */
export function unconfirmedState(policy, confirmations = {}) {
  return HR_UNCONFIRMED.map((item) => {
    const confirmed = confirmations?.[item.id] || null;
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
      confirmed: confirmed
        ? { by: confirmed.by ?? null, byName: confirmed.byName ?? null, at: confirmed.at ?? null }
        : null,
    };
  });
}

/**
 * Write one confirmation onto a settings document. Returns `{ error, status }`
 * for a caller to hand straight to `fail()`, or `{ changed, confirmations }`.
 *
 * Mutates `doc.policyConfirmations` and NOTHING ELSE — `doc.policy` is not read
 * and not assigned anywhere in this function, which is the property the whole
 * file exists to hold. The caller saves.
 *
 * Idempotent by keeping the FIRST confirmation: pressing ยืนยัน twice must not
 * re-date a sign-off that already happened, or the record of when a rule became
 * HR's answer would move every time somebody clicked around the page.
 */
export function applyConfirmation(doc, { id, actor, at = new Date() }) {
  const item = unconfirmedItem(id);
  if (!item) return { error: `ไม่รู้จักข้อที่รอยืนยัน: ${id}`, status: 400 };

  const confirmations = { ...(doc?.policyConfirmations || {}) };
  if (confirmations[item.id]) return { changed: false, confirmations };

  confirmations[item.id] = confirmationRecord(actor, at);
  doc.policyConfirmations = confirmations;
  return { changed: true, confirmations };
}
