/**
 * Writing the roster trail. The rules it follows are in lib/rosterAudit.js,
 * which is pure and tested without a connection; everything here needs mongoose.
 *
 * Same split as lib/complianceExport.js and lib/complianceQuery.js, for the same
 * reason: the interesting part — what may be recorded, and what may never be —
 * should be pinnable by `node --test` without dragging a database into the suite.
 */
// Relative, not `@/…`. It was written that way because the Express router in
// src/routes/employees.js imported this module too and plain node resolves no
// alias. That router is retired — see legacy/README.md — and the App Router is
// now the only writer of the roster. The style is left as it is because it
// costs nothing and `node --test` resolves no alias either: a rule that stays
// importable outside Next is a rule that stays testable.
import EmployeeAudit from '../src/models/EmployeeAudit.js';
import { worthRecording } from './rosterAudit.js';

/**
 * File one record, and never fail the request over it.
 *
 * THE ORDER IS FORCED AND IT IS THE WRONG WAY ROUND FOR AUDITING. The change
 * has to be saved before its `to` values are known to be real — a save can be
 * refused by the unique index on `code` — so by the time this runs the roster
 * has already moved. Throwing here would leave the change applied and the
 * caller told it failed, which is worse than either outcome on its own.
 *
 * So it returns `false` instead, exactly as `recomputeEntries` does for its run
 * record, and the routes pass that out as `auditLogged` so the screen can say
 * "the change was saved and nothing will ever show who made it" out loud. A
 * swallowed failure would leave that discoverable only by somebody noticing a
 * gap months later, which is when it is least useful.
 *
 * The console line carries the whole record, because it is the only surviving
 * copy when this fails.
 */
export async function recordRosterChange({
  employee, action, changes = [], passwordReset = false, reason = null,
  actor = null, source = 'form',
}) {
  if (!worthRecording({ changes, passwordReset })) return true;

  const record = {
    employee: employee?._id,
    employeeCode: employee?.code,
    employeeName: employee?.name,
    action,
    source,
    changes,
    passwordReset: Boolean(passwordReset),
    reason: reason ? String(reason).trim() : undefined,
    by: actor?._id,
    byName: actor?.name,
    byRole: actor?.role,
  };

  try {
    await EmployeeAudit.create(record);
    return true;
  } catch (err) {
    // `changes` is spelled out rather than JSON-stringified whole: this line is
    // read by a person looking for what was lost, and `[object Object]` in the
    // one place that still knows would defeat the whole point of logging it.
    console.error('roster change not logged', {
      employee: `${record.employeeCode || '?'} · ${record.employeeName || '—'}`,
      action,
      source,
      by: actor ? `${actor.code || actor._id || '?'} · ${actor.name || '—'}` : null,
      changes: changes.map((c) => `${c.field}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join(', ') || '—',
      passwordReset: Boolean(passwordReset),
      reason: record.reason || null,
    }, err);
    return false;
  }
}
