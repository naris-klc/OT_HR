import OtEntry from '@/src/models/OtEntry.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import {
  compute, applyComputation, checkCap, loadContext, birthDateOf,
} from '@/src/services/otService.js';
import {
  POPULATE, pickSession, stampCap, editPermission, sameSession,
  descriptionUnchanged, noOtHoursMessage, submissionWindowRefusal,
  zeroOtHoursAllowed,
} from '@/lib/entries.js';
import { today } from '@/lib/today.js';
import { resolveScope } from '@/lib/delegationQuery.js';
import { blockedMessage } from '@/lib/caps.js';
import { weekdayOtRefusal } from '@/lib/otMode.js';
import { refuseDayConflict } from '@/lib/overlapQuery.js';
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

  /**
   * An edit may not MOVE a request onto a date it could not have been filed on
   * — which is a narrower rule than the submit path's, and narrower on purpose.
   *
   * Only a date that is being CHANGED is measured. This is the lesson
   * `descriptionUnchanged` above was written from: the cap on รายละเอียดงานที่ทำ
   * was applied to every edit, the edit form posts the whole entry back, and
   * correcting the HOURS on an older request was refused for the length of a
   * field nobody had touched. A window that tightens has the same shape — an
   * entry filed legitimately under a laxer setting would become uneditable,
   * including by the ฝ่ายบุคคล trying to correct it, which turns a rule about
   * filing into a rule about repair.
   *
   * THE BACKWARD WINDOW MAKES THAT NECESSARY RATHER THAN MERELY KIND. It moves
   * on its own overnight: an entry filed inside a 7-day window is outside it on
   * the eighth day, with nobody having changed anything. Measured on every edit,
   * every request in the queue would become uneditable simply by ageing —
   * including for ฝ่ายบุคคล, and including the correction that would have made
   * it right.
   *
   * `entry.workDate` is still the stored value here; `Object.assign` below is
   * what replaces it.
   */
  if (session.workDate !== entry.workDate) {
    // `livePolicy`, as on the submit path and for the same reason: the window is
    // a question about today, not about the rules in force on the work date.
    // See the note over the same call in app/api/entries/route.js.
    const outsideWindow = submissionWindowRefusal(session.workDate, today(), ctx.livePolicy);
    if (outsideWindow) return fail(outsideWindow.error, outsideWindow.status);
  }

  const result = await compute(session, ctx);
  // Same refusal and the same sentence as the submit path — an edit that leaves
  // no OT is the same mistake, arriving one screen later. And the same
  // exemption: an edit that TICKS เหมารายวัน empties the rate columns on
  // purpose, which is the point of ticking it.
  if (result.totals.otHours <= 0 && !zeroOtHoursAllowed(session)) {
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

  /**
   * THE BIRTHDAY CHECK THIS PATH ALSO MADE WENT WITH THE BOX — 2026-09-08. See
   * the note in POST /api/entries, and `birthdayTickRefusal`'s own headstone in
   * lib/entries.js.
   *
   * The correction it existed for is still made, by the engine rather than by a
   * refusal: the commonest edit here moves `workDate`, and `ctx.dayTypes` is
   * re-resolved for the new date on every one of them. A request dragged OFF a
   * birthday loses the birthday rates in the same save that moved it, and one
   * dragged ONTO somebody's birthday gains them. Nothing has to be re-ticked and
   * nothing can be left ticked on the wrong day.
   */
  // The same department rule the submit path applies, and for the reason the
  // ceiling is measured again on an edit: an entry moved onto an ordinary
  // Tuesday is a weekday OT request however it was filed. The department is the
  // entry's own — whoever it is FOR, not the person editing.
  const weekdayRefusal = weekdayOtRefusal(entry.department, result);
  if (weekdayRefusal) return fail(weekdayRefusal, 409, { warnings: result.warnings });

  /**
   * หนึ่งวัน หนึ่งใบ and เวลาทับซ้อน, measured the same way the submit path
   * measures them — against the person the entry is FOR, which is not the actor
   * when ฝ่ายบุคคล is the one editing.
   *
   * AN EDIT IS WHERE THE DAY RULE EARNS ITS PLACE ON THIS ROUTE. A correction
   * that only moves `workDate` — the commonest one there is, a shift filed
   * against the wrong day — can land on a date this person has already filed,
   * and the times need not clash at all for the paper to have nowhere to print
   * the result.
   *
   * `excludeId` is not an optimisation here, it is the rule: without it every
   * edit would be refused by the entry it is editing — its own date is taken by
   * itself — and an edit to the description would be impossible.
   *
   * Nothing is written yet. `Object.assign` above put the new session onto the
   * in-memory document, but `save()` is still eleven lines away, so the copy
   * this reads back out of Mongo is the one being replaced — which is why
   * excluding it by id is enough and no ordering trick is needed.
   */
  const clash = await refuseDayConflict(session, {
    employee: entry.employee?._id || entry.employee,
    excludeId: entry._id,
  });
  if (clash) return fail(clash.error, clash.status, { conflict: clash.conflict });

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
