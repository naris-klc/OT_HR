import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { compute, applyComputation, checkCap, loadContext } from '@/src/services/otService.js';
import { POPULATE, scopeFor, pickSession, stampCap, editPermission } from '@/lib/entries.js';
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

  const session = pickSession({ ...entry.toObject(), ...payload });
  const ctx = await loadContext([session.workDate]);
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

  applyComputation(entry, result);
  stampCap(entry, cap);

  // status untouched either way — HR's edit keeps the approvals already
  // collected, and the employee's entry has none to keep.
  entry.log(user, may.action, reason || null, entry.status);
  await entry.save();

  return json({ entry: await entry.populate(POPULATE), cap });
});
