import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import {
  compute, applyComputation, checkCap, loadContext, birthDateOf,
} from '@/src/services/otService.js';
import {
  POPULATE, scopeFor, pickSession, stampCap, editPermission, sameSession,
} from '@/lib/entries.js';
import { normaliseDescription } from '@/src/config/policy.js';

export const GET = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const entry = await OtEntry.findOne({ _id: params.id, ...scopeFor(user) }).populate(POPULATE);
  if (!entry) return fail('ไม่พบรายการ', 404);
  return json({ entry });
});

// ── edit (own request while still pending_mgr, or HR / Admin) ───────────────

export const PATCH = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id).populate(POPULATE);
  if (!entry) return fail('ไม่พบรายการ', 404);

  // Who may rewrite this, and what the edit is called in the history. The rule
  // itself lives in lib/entries.js so it can be read — and tested — on its own.
  const reason = String(payload.note || '').trim();
  const may = editPermission(user, entry, reason);
  if (!may.ok) return fail(may.error, may.status);

  // What the entry says now, captured before anything overwrites it. F-HR-027
  // prints the latest values; this is how the ones they replace survive.
  const before = entry.snapshot();

  const session = pickSession({ ...entry.toObject(), ...payload });

  // The day types belong to whoever the entry is FOR, which is not the actor
  // when HR is the one editing. `POPULATE` deliberately does not carry
  // birthDate — it feeds every entry list the API returns — so it is fetched
  // here, used, and never put on the response.
  const ctx = await loadContext([session.workDate], {
    employee: { birthDate: await birthDateOf(entry.employee?._id || entry.employee) },
  });
  const result = await compute(session, ctx);
  if (result.totals.otHours <= 0) {
    return fail('ช่วงเวลานี้อยู่ในเวลาทำงานปกติทั้งหมด จึงไม่นับเป็น OT', 400);
  }

  Object.assign(entry, session);
  if (payload.description != null) {
    const { value, error } = normaliseDescription(payload.description);
    if (error) return fail(error, 400);
    entry.description = value;
  }

  // The cap belongs to whoever the entry is FOR, which is not the actor when
  // HR is the one editing. `excludeId` keeps the entry's own current hours out
  // of the "used before" figure, so an edit is measured against the month
  // without itself in it.
  const cap = await checkCap({
    employee: entry.employee,
    department: entry.department,
    period: session.workDate.slice(0, 7),
    result,
    excludeId: entry._id,
    policy: ctx.policy,
  });
  if (cap.blocked) return fail(`เกินเพดาน ${cap.capHours} ชม./เดือน ของแผนก`, 409, { cap });

  applyComputation(entry, result, ctx);
  stampCap(entry, cap);

  // status untouched either way — HR's edit keeps the approvals already
  // collected, and the employee's entry has none to keep.
  //
  // The snapshot rides along only when the save actually moved something: a
  // form opened and closed unchanged is still worth logging as "looked at",
  // but filing a `before` identical to the after would bury the real edits.
  const changed = !sameSession(before, entry.snapshot());
  entry.log(user, may.action, reason || null, entry.status, changed ? before : null);
  await entry.save();

  return json({ entry: await entry.populate(POPULATE), cap });
});
