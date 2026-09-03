/**
 * The reads behind รายงานการใช้สิทธิ์พิเศษ. The rules are in
 * lib/complianceExport.js, which is pure and tested without a connection.
 *
 * Same split as lib/rosterAudit.js / lib/rosterAuditLog.js, for the same
 * reason: what counts
 * as the exercise of a privileged exception is the part worth pinning with
 * `node --test`, and it must not drag mongoose into a suite that never opens a
 * database.
 *
 * ONE LOADER FOR BOTH READERS. The screen and the CSV must never disagree about
 * what a quarter contained — an auditor comparing a downloaded file against the
 * screen it came from and finding two different row counts has lost the whole
 * point of the file. So the queries live here once and both routes call this.
 */
import mongoose from 'mongoose';
import Employee from '../src/models/Employee.js';
import EmployeeAudit from '../src/models/EmployeeAudit.js';
import OtEntry from '../src/models/OtEntry.js';
import PolicyReplayRun from '../src/models/PolicyReplayRun.js';
import { EVENT_KINDS, complianceRows } from './complianceExport.js';

/**
 * A ceiling, because this reads four collections and one of them is every OT
 * entry ever filed. Far above any real quarter — the whole database holds fewer
 * than a hundred entries today — and here so that a mistyped date range cannot
 * turn one download into an unbounded scan.
 */
export const MAX_ROWS = 50_000;

/** 'YYYY-MM-DD' → local midnight, or null. The logs export has the twin. */
export function dayStart(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

/**
 * The window a request asked for, as two Dates.
 *
 * `to` is pushed to the following midnight — it is a date somebody typed, not
 * an instant, and "ถึง 31 ส.ค." means the whole of the 31st. The same rule the
 * บันทึกระบบ export follows and the same one the date input's note promises.
 */
export function windowFrom({ from, to } = {}) {
  const start = dayStart(from);
  const end = dayStart(to);
  return { from: start, to: end ? new Date(end.getTime() + 86400000) : null };
}

/**
 * `?kinds=password_reset,admin_override` → the validated list, or null for all.
 *
 * Validated against the known set rather than passed through: an unknown kind
 * would silently match nothing and hand back an empty file that reads like a
 * clean quarter. Anything unrecognised is dropped, and a request naming ONLY
 * unknown kinds falls back to all six — for the same reason, an empty file is
 * the one answer this must never give by accident.
 */
export function kindsFrom(value) {
  const asked = String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
  const known = asked.filter((k) => EVENT_KINDS.includes(k));
  return known.length ? known : null;
}

/**
 * Every privileged exception in the window, oldest first.
 *
 * @param {{from: ?Date, to: ?Date}} window
 * @param {?string[]} kinds  null = all five
 */
export async function loadCompliance(window = {}, kinds = null) {
  const { from = null, to = null } = window;

  /**
   * The window as a mongo clause, shaped per collection.
   *
   * Applied in the QUERY as well as in `complianceRows`, which filters the
   * merged list again. Not redundant: the query bound keeps three collection
   * scans proportional to the period asked for, and the second pass is what
   * applies it to rows nested INSIDE a document — an entry's history rows carry
   * their own timestamps, and the parent document's dates say nothing about
   * them.
   */
  const between = (field) => {
    if (!from && !to) return {};
    const clause = {};
    if (from) clause.$gte = from;
    if (to) clause.$lt = to;
    return { [field]: clause };
  };

  const [rosterAudits, entries, replayRuns] = await Promise.all([
    EmployeeAudit.find({
      ...between('createdAt'),
      /**
       * Only the records that CAN produce a row — see `fromRosterAudits`. An
       * ordinary name correction is not an exception and does not belong in a
       * scan of a year's roster edits.
       *
       * Deliberately WIDER than what comes out: a `create` matches on
       * `changes.field: code` and then earns no row, because a new account
       * being given a code is not a renumbering. The narrowing is done in one
       * place — the pure rule — rather than half here and half there, since a
       * mongo clause that had to encode "code, but only on an update, unless
       * the role is also privileged" is a rule nobody can read or test.
       */
      $or: [
        { passwordReset: true },
        { action: 'password_reset' },
        { 'changes.field': { $in: ['role', 'code'] } },
      ],
    }).sort({ createdAt: 1 }).limit(MAX_ROWS).lean(),

    /**
     * Matched on `history`, not on `managerDecision`: a re-filed request can
     * carry two overrides and the decision block remembers only the last. The
     * date bound is on the history row, so an entry filed in March whose
     * override happened in June is found in June's report.
     */
    OtEntry.find({ history: { $elemMatch: { adminOverride: true, ...between('at') } } })
      .populate([
        { path: 'employee', select: 'code name' },
        { path: 'department', select: 'code nameTh' },
      ])
      .sort({ workDate: 1 }).limit(MAX_ROWS).lean(),

    PolicyReplayRun.find({ includeApproved: true, ...between('createdAt') })
      .sort({ createdAt: 1 }).limit(MAX_ROWS).lean(),
  ]);

  /**
   * The actor's รหัสพนักงาน, for the accounts that still exist.
   *
   * Every trail in this system denormalises `byName` on purpose — an audit row
   * must survive the deletion of the person it names — so a code is NOT stored
   * anywhere and can only come from the roster now. One query for every actor
   * across all three sources rather than a lookup per row.
   *
   * A missing one is not an error and not a blank row: `actorLabel` prints the
   * stored name on its own, which is exactly the case the denormalisation was
   * for. The code is a convenience for the common case, never the identity.
   */
  const actorIds = [...new Set([
    ...rosterAudits.map((r) => r.by),
    ...entries.flatMap((e) => (e.history || []).map((h) => h.by)),
    ...replayRuns.map((r) => r.by),
  ].filter(Boolean).map(String))].filter((id) => mongoose.Types.ObjectId.isValid(id));

  const codeOf = new Map(
    (await Employee.find({ _id: { $in: actorIds } }).select('code').lean())
      .map((p) => [String(p._id), p.code]),
  );
  const withCode = (o) => ({ ...o, byCode: codeOf.get(String(o?.by ?? '')) || '' });

  return complianceRows({
    rosterAudits: rosterAudits.map(withCode),
    entries: entries.map((e) => ({ ...e, history: (e.history || []).map(withCode) })),
    replayRuns: replayRuns.map(withCode),
  }, { from, to, kinds });
}
