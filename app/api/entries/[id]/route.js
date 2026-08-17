import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import {
  compute, applyComputation, checkCap, loadContext, birthDateOf,
} from '@/src/services/otService.js';
import {
  POPULATE, pickSession, stampCap, editPermission, sameSession,
  descriptionUnchanged,
} from '@/lib/entries.js';
import { resolveScope } from '@/lib/delegationQuery.js';
import { blockedMessage } from '@/lib/caps.js';
import { refusePeriodLock } from '@/lib/periodLockQuery.js';
import { normaliseDescription } from '@/src/config/policy.js';

export const GET = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const { scope } = await resolveScope(user);
  const entry = await OtEntry.findOne({ _id: params.id, ...scope }).populate(POPULATE);
  if (!entry) return fail('ไม่พบรายการ', 404);
  return json({ entry });
});

// ── edit (own request while still pending_mgr, or HR / Admin) ───────────────

export const PATCH = route(async (req, { params }) => {
  const user = await requireAuth(req);
  const payload = await body(req);

  const entry = await OtEntry.findById(params.id).populate(POPULATE);
  if (!entry) return fail('ไม่พบรายการ', 404);

  /**
   * Is the month still open?
   *
   * Before the permission check on purpose. "งวดนี้ปิดแล้ว" is true of everybody
   * — the employee, ฝ่ายบุคคล, an administrator — and answering it first means
   * HR is told the month is closed rather than being told they may edit and
   * then refused for a reason they have to guess at.
   */
  const locked = await refusePeriodLock(entry.period, 'แก้ไข');
  if (locked) return fail(locked.error, locked.status);

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
  // Same refusal and the same sentence as the submit path — an edit that leaves
  // no OT is the same mistake, arriving one screen later.
  if (result.totals.otHours <= 0) {
    return fail(noOtHoursMessage(session, ctx.policy, ctx.dayTypes, result), 400, {
      warnings: result.warnings,
    });
  }

  Object.assign(entry, session);
  /**
   * THE CAP APPLIES TO WHAT IS BEING WRITTEN, NOT TO WHAT IS ALREADY THERE.
   *
   * `DESCRIPTION_MAX_CHARS` is 22 — the width of one line of F-HR-027's
   * รายละเอียดงานที่ทำ cell — and the comment beside it says entries stored
   * before the cap existed are longer and must stay saveable. They were not.
   *
   * The edit form (OtForm) fills itself from the entry, description included,
   * and posts the whole form back. So correcting the HOURS on any entry
   * written before the cap sent its own 30-, 48- or 55-character description
   * along untouched, and was refused for the length of a field nobody had
   * touched. Found 2026-08-14 against the live database: seven of nine entries
   * in it were over the cap, and neither the employee nor ฝ่ายบุคคล could edit
   * any of them through that form. `QuickEdit` in the review screen sends only
   * the times and was unaffected, which is why this survived — the path most
   * used is the path that never carried a description.
   *
   * Comparing against the stored value is what fixes it, and it is narrower
   * than it looks: a description that is being CHANGED is still measured, so a
   * 48-character one edited down to 30 is refused exactly as a new 30 would be.
   * Only leaving it alone is free. `.trim()` on both sides because the form
   * round-trips whitespace the stored value does not have.
   */
  if (!descriptionUnchanged(payload.description, entry.description)) {
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
  if (cap.blocked) return fail(blockedMessage(cap), 409, { cap });

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
