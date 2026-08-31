import mongoose from 'mongoose';
import OtEntry from '@/src/models/OtEntry.js';
import Employee from '@/src/models/Employee.js';
import { route, body, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import {
  compute, applyComputation, checkCap, loadContext, queueCapUsage,
} from '@/src/services/otService.js';
import {
  POPULATE, scopeFor, pickSession, stampCap, latestPerChain, noOtHoursMessage,
  capFor, takeCapped, submissionWindowRefusal, entryCompany, birthdayOtRefusal,
} from '@/lib/entries.js';
import { today } from '@/lib/today.js';
import { resolveScope } from '@/lib/delegationQuery.js';
import { nobodyCanSign } from '@/lib/delegation.js';
import { proxyPermission, initialStatus } from '@/lib/proxyFiling.js';
import { refuseDayConflict } from '@/lib/overlapQuery.js';
import { blockedMessage } from '@/lib/caps.js';
import { weekdayOtRefusal } from '@/lib/otMode.js';
import { normaliseDescription } from '@/src/config/policy.js';

// ── list ────────────────────────────────────────────────────────────────────

export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const {
    status, period, employee, department, from, to, limit, replaced, scope, usage, withdrawal,
  } = query(req);

  /**
   * `scope=delegated` — the covered teams ONLY, rather than the caller's usual
   * reach widened by them.
   *
   * It exists for ฝ่ายบุคคล standing in for a หัวหน้า. Their ordinary scope is
   * everything, so widening it does nothing and their รออนุมัติ screen would be
   * every pending request in the company — which is not the queue they were
   * handed and not one anybody can work. A manager does not need this: their
   * own queue already includes what they are covering, marked row by row.
   *
   * Empty when they are covering nothing, which is a real answer and not an
   * error: it is what the screen shows the day a window closes.
   */
  const reach = await resolveScope(user);
  /**
   * `scope=unsigned` — the requests NOBODY on the roster can sign.
   *
   * ผู้ดูแลระบบ only, because they are the only ones who can do anything about
   * such a row (`mayOverrideManagerStep`). Asked for by the รออนุมัติแทนหัวหน้า
   * tab, and it is a narrow list on purpose: an administrator may sign the
   * หัวหน้า step of ANY request, but a screen listing every request in the
   * company invites them to sign rows whose own หัวหน้า is about to — which
   * would make §6's second pair of eyes a formality in practice while leaving
   * the rule looking untouched. This tab shows the rows that are genuinely
   * stuck, which is the problem the override was added for.
   *
   * The filtering itself happens after the query, below: whether anybody covers
   * a row depends on the entry's owner's payroll as well as its department, and
   * that is not a mongo filter — see `nobodyCanSign`.
   */
  const unsignedOnly = scope === 'unsigned' && user.role === 'admin';
  const q = scope === 'delegated'
    // `{ department: null }` and not `{}` when nothing is covered: an empty
    // filter on this screen would answer with the whole company.
    ? { ...(reach.delegated ?? { department: null }) }
    // A stand-in reads the teams they are covering as well as their own. Their
    // own is always in the list — a delegation adds a claim and never swaps one
    // out, so coming back early takes nothing away.
    : { ...reach.scope };

  if (status) q.status = { $in: String(status).split(',') };
  /**
   * `withdrawal=open` — the requests waiting for an answer, in whatever the
   * caller's scope already is.
   *
   * A filter on this list rather than an endpoint of its own, because the rows
   * are ordinary entries, the scoping is the scoping every other list uses, and
   * a second route would be a second place for "which teams may this person
   * see" to be got wrong. The queue screen asks for it; nothing else has to
   * know it exists.
   *
   * Note these rows are `approved` and `pending_hr`, so they do NOT appear in
   * the pending queue — an entry with an open request keeps counting until
   * somebody answers, which is the whole point of asking rather than taking.
   */
  if (withdrawal === 'open') q['withdrawal.state'] = 'requested';
  if (period) q.period = period;
  if (employee && user.role !== 'employee') q.employee = employee;
  if (department && ['hr', 'admin'].includes(user.role)) q.department = department;
  if (from || to) {
    q.workDate = {};
    if (from) q.workDate.$gte = from;
    if (to) q.workDate.$lte = to;
  }

  /**
   * One row more than will be returned — see `takeCapped`. The extra document
   * is what lets this answer "there is more" without counting the whole
   * collection on every request that does not need it.
   */
  const cap = capFor(limit);
  const matched = await OtEntry.find(q)
    .populate(POPULATE)
    .sort({ workDate: -1, createdAt: -1 })
    .limit(cap + 1)
    .lean();

  /**
   * `scope=unsigned`, applied here because it needs the populated owner.
   *
   * One roster read for the whole list rather than one per row — a หัวหน้า who
   * covers a department may sit in any other, so the pool is the same for every
   * entry and `isDepartmentManager` is what narrows it. The same shape the
   * roster route's coverage loop uses.
   *
   * AFTER the cap, and that is a real limitation said out loud: `truncated`
   * below counts documents the query matched, so on a list long enough to be
   * cut short this could report "there are more" when the rest were all
   * signable. The queue it serves is the requests waiting on a หัวหน้า across
   * the company — a few rows, on a roster of seventeen — and paying for an
   * exact count would mean resolving coverage for every pending request in the
   * database on a screen that exists to show a handful.
   */
  const narrowed = unsignedOnly
    ? await (async () => {
      const managers = await Employee.find({ role: 'manager', active: true })
        .select('code name role department company approvesCompany approvesDepartments').lean();
      return matched.filter((e) => nobodyCanSign(e, managers, entryCompany(e)));
    })()
    : matched;

  const { rows: found, truncated } = takeCapped(narrowed, cap);

  /**
   * `replaced=hide` — one row per line of filing rather than one per document.
   *
   * Opt-in rather than the default, because the two readers of this list want
   * opposite things from a replaced request. HR closing a month wants the
   * duplicate gone: the live request stands for the whole chain and its drawer
   * carries the rest. The employee's own history wants it kept, marked
   * “ส่งใหม่แล้ว”, because that row is the evidence their one chance was spent
   * and the reason the button beside it is locked.
   *
   * Folded here rather than in the component so that a screen's rows and the
   * count it prints beside them can never come from two different lists.
   */
  const { shown: entries, hidden } = replaced === 'hide'
    ? latestPerChain(found)
    : { shown: found, hidden: [] };

  /**
   * `usage=cap` — how much of each row's ceilings that row's employee has
   * already used, for the month THAT ROW belongs to.
   *
   * Opt-in, because only the approval queues want it: a หัวหน้า deciding one
   * request needs to know whether it is the person's third hour this month or
   * their forty-third, and every other caller of this endpoint (the employee's
   * own history, the month's rows on ตรวจสอบรายเดือน) either has the figure
   * already or has no use for it. Off by default, those callers pay nothing.
   *
   * Attached to the rows rather than returned beside them so a screen cannot
   * pair a total with the wrong row, and computed here rather than in a second
   * request so the rows and their totals come from one read. The batching —
   * a fixed number of queries whatever the queue's length — is `queueCapUsage`.
   */
  if (usage === 'cap' && entries.length) {
    const byEntry = await queueCapUsage(entries);
    for (const entry of entries) entry.usage = byEntry.get(String(entry._id)) || null;
  }

  /**
   * `total` is DOCUMENTS MATCHED, not rows drawn, and only when the list was
   * cut short.
   *
   * The two numbers are not the same thing under `replaced=hide`, which folds a
   * refused request into the one that replaced it: three documents can be two
   * rows. So this is not a figure a screen may print beside `entries.length` as
   * though they counted the same population — it answers one question only,
   * "how many are there altogether", for the banner that says the list is
   * incomplete. `null` when nothing was cut, because a number sent then would
   * be read as a row count and would sometimes be wrong.
   *
   * The count is skipped entirely on the ordinary request. Truncation is the
   * rare case, and paying for a second query only when it happens keeps every
   * screen that is nowhere near the ceiling exactly as fast as before.
   */
  return json({
    entries,
    replacedCount: hidden.length,
    truncated,
    total: truncated ? await OtEntry.countDocuments(q) : null,
  });
});

// ── submit ──────────────────────────────────────────────────────────────────

export const POST = route(async (req) => {
  const user = await requireAuth(req);
  const payload = await body(req);

  /**
   * Whose request is this?
   *
   * `employeeId` names somebody else and turns this into a หัวหน้า filing on
   * their behalf. Everything downstream then belongs to THAT person — the
   * department the entry is filed under, the ceiling it is measured against,
   * the birthday its day types are resolved from — and `user` is recorded only
   * as `filedBy`. Getting this wrong in either direction puts one person's
   * hours on another person's month.
   */
  const forSomeoneElse = payload.employeeId && String(payload.employeeId) !== String(user._id);

  let employee = user;
  if (forSomeoneElse) {
    const target = await Employee.findById(payload.employeeId).populate('department');
    const may = proxyPermission(user, target);
    if (!may.ok) return fail(may.error, may.status);
    employee = target;
  } else if (!user.maySubmitOt()) {
    // §2: managers are not eligible to submit OT for themselves. HR and Admin
    // are not either — they administer the process rather than take part in it.
    return fail('ตำแหน่งนี้ไม่สามารถบันทึก OT ได้', 403);
  }

  const session = pickSession(payload);
  const { value: description, error: descriptionError } = normaliseDescription(payload.description);
  if (descriptionError) return fail(descriptionError, 400);

  // The day types belong to whoever the entry is FOR. Filing for oneself that
  // is the caller, whose document is already in hand; filing for somebody else
  // it is the person just loaded, populated the same way.
  const ctx = await loadContext([session.workDate], { employee });

  /**
   * MAY THIS DATE BE FILED TODAY — the window at both ends: a day that has not
   * started, and a day too long past to still be claimed.
   *
   * THIS IS THE ONLY BACKWARD LIMIT LEFT. Until 2026-08-31 ปิดงวด sat above it
   * and refused a month HR had declared finished, which was the harder of the
   * two edges and the one that named somebody who could lift it. That feature
   * is gone — the signed paper in the filing cabinet is the record, see
   * lib/periodStatus.js — so how far back a request may be filed is now decided
   * entirely by `maxPastSubmissionDays`, on this line, and by nothing else.
   *
   * After `loadContext` and not before, because this rule reads two policy keys
   * and `loadContext` is where the live policy arrives. Still before `compute`,
   * which is the ordering that matters — the point is that somebody filing a
   * date they may not file is told so, rather than shown their hours worked out
   * and then turned away.
   *
   * `ctx.policy` is the LIVE policy, deliberately, where the engine below is
   * handed `policyFor(date)` — the rules in force on the work date. That is
   * right for arithmetic and wrong here: this asks whether the request may be
   * filed today, and the answer belongs to today's rules.
   */
  const outsideWindow = submissionWindowRefusal(session.workDate, today(), ctx.policy);
  if (outsideWindow) return fail(outsideWindow.error, outsideWindow.status);

  const result = await compute(session, ctx);

  // Refused, not stored as a nought — see `noOtHoursMessage`, which is also
  // where the sentence lives, so all four write paths say the same thing.
  if (result.totals.otHours <= 0) {
    return fail(noOtHoursMessage(session, ctx.policy, ctx.dayTypes, result), 400, {
      warnings: result.warnings,
    });
  }

  /**
   * สวัสดิการวันเกิด is not something a person claims for themselves.
   *
   * Ahead of the department rule below because it is about the DAY rather than
   * about the hours: a birthday holiday puts every minute in the วันหยุด
   * columns, so `weekdayOtRefusal` has nothing to say about it and would let
   * this through in silence. `birthdayOtRefusal` holds the rule and says why a
   * proxy filing and the tail of an overnight shift are both left alone — and
   * why it lives in lib/entries.js rather than beside the single-signature
   * path, which this route still cannot reach.
   *
   * `ctx.dayTypes` is the map the engine just computed these hours from —
   * resolved from the employee's own stored วันเกิด under the live policy,
   * where no payload can reach it.
   *
   * 409 rather than 400, like the two refusals around it: the times may be
   * exactly right and the shift may really have happened. What refuses it is
   * whose day it was, and the answer is ฝ่ายบุคคล's to record.
   */
  const birthdayRefusal = birthdayOtRefusal({
    filer: user, employee, dayTypes: ctx.dayTypes, workDate: session.workDate,
  });
  if (birthdayRefusal) return fail(birthdayRefusal, 409, { warnings: result.warnings });

  /**
   * รูปแบบโอทีของแผนก — a department that does no ordinary OT, or is paid
   * เหมารายวัน, refuses weekday hours here. lib/otMode.js holds the rule, and
   * says why this is not a ceiling of 0.
   *
   * After the engine, because the question is which BUCKET the hours landed in
   * and only the engine knows: the same 18:00–21:00 is refused on a Tuesday,
   * allowed on a company holiday, and allowed on the person's own birthday when
   * the birthday rule is on. Nothing here reads a calendar.
   *
   * 409 rather than 400 — the request is well formed and the times may be
   * exactly right; it is the state of the department that refuses it, which is
   * the same shape of answer the ceiling gives two lines below.
   */
  const weekdayRefusal = weekdayOtRefusal(employee.department, result);
  if (weekdayRefusal) return fail(weekdayRefusal, 409, { warnings: result.warnings });

  /**
   * หนึ่งวัน หนึ่งใบ — is this person's day already filed? And behind it, does
   * anybody already hold these minutes?
   *
   * Measured against the person the entry is FOR, never against the filer: a
   * หัวหน้า filing for two people on the same day is two people at work, and a
   * check keyed on `user` would refuse the second one.
   *
   * After the engine and before the ceiling, which is the order the two
   * refusals are worth reading in. A duplicated day means the hours are wrong
   * and the ceiling arithmetic was measuring a number nobody should have filed;
   * being told "เกินเพดาน" first would send somebody to argue for an override
   * over hours they had accidentally claimed twice.
   */
  const clash = await refuseDayConflict(session, { employee: employee._id });
  if (clash) return fail(clash.error, clash.status, { conflict: clash.conflict });

  const period = session.workDate.slice(0, 7);
  const cap = await checkCap({
    employee,
    department: employee.department,
    period,
    result,
    policy: ctx.policy,
  });

  // [OPEN 8] 'block' refuses here; 'warn' lets it through carrying the flag.
  // The message names every ceiling that refused it — being turned away by the
  // weekly limit and told about the monthly one sends the employee to move the
  // shift into a month that was never the problem.
  if (cap.blocked) return fail(blockedMessage(cap), 409, { cap });

  // §6 — "ส่งใหม่" files a fresh request to replace one that was refused, and
  // the right to do that is spent once.
  //
  // The whole rule is in the filter of one update. Every clause is a way the
  // claim can be wrong, and checking them in a read first would leave a gap
  // between the read and the write that a second tap fits through:
  //
  //   employee        — it has to be the caller's own request
  //   status rejected — only a refused request is re-filed
  //   refiledFrom null— a replacement cannot itself be replaced (2 levels)
  //   resubmittedTo null — the one chance has not been taken yet
  //
  // Whoever's update matches first owns the claim; everyone after it matches
  // nothing and is turned away.
  let refiledFrom = null;
  let claimedParent = null;
  const childId = new mongoose.Types.ObjectId();

  // The one chance to answer a refusal belongs to the person the request is
  // for, and a หัวหน้า cannot spend it for them. The employee still has it:
  // a proxy-filed request that was refused shows ส่งใหม่ on their own row like
  // any other, because `refileState` reads the entry and not who typed it.
  if (payload.refiledFrom && forSomeoneElse) {
    return fail('สิทธิ์ส่งใหม่เป็นของพนักงานเจ้าของคำขอ — หัวหน้าบันทึกแทนไม่สามารถใช้สิทธิ์นี้ได้', 403);
  }

  if (payload.refiledFrom) {
    const parent = await OtEntry.findOneAndUpdate(
      {
        _id: payload.refiledFrom,
        employee: user._id,
        status: 'rejected',
        refiledFrom: null,
        resubmittedTo: null,
      },
      { $set: { resubmittedTo: childId } },
      { new: false },
    ).select('status refiledFrom resubmittedTo employee').lean();

    if (!parent) {
      // One filter, several reasons — read the row back to say which.
      const seen = await OtEntry.findById(payload.refiledFrom)
        .select('employee status refiledFrom resubmittedTo').lean();
      if (!seen) return fail('ไม่พบคำขอเดิมที่อ้างอิงถึง', 404);
      if (String(seen.employee) !== String(user._id)) {
        return fail('อ้างอิงได้เฉพาะคำขอเดิมของตนเอง', 403);
      }
      if (seen.status !== 'rejected') return fail('ส่งใหม่ได้เฉพาะคำขอที่ถูกไม่อนุมัติ', 409);
      if (seen.refiledFrom) {
        return fail('คำขอนี้เป็นการส่งใหม่อยู่แล้ว และถูกไม่อนุมัติเป็นครั้งที่สอง — กรุณาบันทึก OT เป็นคำขอใหม่', 409);
      }
      return fail('คำขอนี้ใช้สิทธิ์ส่งใหม่ไปแล้ว 1 ครั้ง', 409);
    }

    refiledFrom = payload.refiledFrom;
    claimedParent = payload.refiledFrom;
  }

  /**
   * Where it starts, and whether the manager's step was skipped because the
   * person who filled the form in is the person who would have signed it.
   *
   * `ctx.policy` is the same resolved policy the hours were computed under, so
   * the routing answer and the figures come from one reading of the settings.
   */
  const start = initialStatus({
    filer: user,
    employee,
    department: employee.department,
    policy: ctx.policy,
  });

  const entry = new OtEntry({
    _id: childId,
    employee: employee._id,
    department: employee.department._id,
    filedBy: user._id,
    ...session,
    description,
    status: start.status,
    refiledFrom,
  });
  applyComputation(entry, result, ctx);
  stampCap(entry, cap);
  // `submit_proxy` says who filed it; `toStatus` says where it went; the note
  // says why, and is written only when something needs explaining. Three facts,
  // one row — a second history entry for the skip would be a second event where
  // only one thing happened.
  entry.log(user, forSomeoneElse ? 'submit_proxy' : 'submit', start.note, null);

  try {
    await entry.save();
  } catch (err) {
    // The claim was taken on the promise of a child that never arrived. Give
    // it back, or the employee loses the one chance to a failure that was not
    // theirs.
    if (claimedParent) {
      await OtEntry.updateOne({ _id: claimedParent, resubmittedTo: childId }, { $set: { resubmittedTo: null } });
    }
    throw err;
  }

  return json({ entry: await entry.populate(POPULATE), cap }, 201);
});
