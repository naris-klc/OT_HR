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
  capFor, takeCapped,
} from '@/lib/entries.js';
import { coveredDepartments } from '@/lib/delegationQuery.js';
import { scopeWidening } from '@/lib/delegation.js';
import { proxyPermission, initialStatus } from '@/lib/proxyFiling.js';
import { refusePeriodLock } from '@/lib/periodLockQuery.js';
import { periodOf } from '@/lib/periodLock.js';
import { blockedMessage } from '@/lib/caps.js';
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
  const covered = await coveredDepartments(user);
  const q = scope === 'delegated'
    ? { department: { $in: covered } }
    // A stand-in reads the teams they are covering as well as their own. Their
    // own is always in the list — a delegation adds a department and never
    // swaps one out, so coming back early takes nothing away.
    : { ...scopeFor(user, scopeWidening(user, covered)) };

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
  const { rows: found, truncated } = takeCapped(
    await OtEntry.find(q)
      .populate(POPULATE)
      .sort({ workDate: -1, createdAt: -1 })
      .limit(cap + 1)
      .lean(),
    cap,
  );

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

  /**
   * A closed month takes no new requests either.
   *
   * HR's rule is that a period which has been sent to accounting stops moving,
   * and a request filed into it afterwards moves it as surely as an edit does —
   * it would be a row nobody could approve (the approval route refuses too),
   * sitting in a month whose total has already been reported.
   *
   * Checked before the engine runs rather than after. Somebody filing three
   * weeks late should be told the month is closed, not shown their hours
   * computed and then refused.
   */
  const closed = await refusePeriodLock(periodOf(session.workDate), 'บันทึกรายการย้อนหลัง');
  if (closed) return fail(closed.error, closed.status);

  // The day types belong to whoever the entry is FOR. Filing for oneself that
  // is the caller, whose document is already in hand; filing for somebody else
  // it is the person just loaded, populated the same way.
  const ctx = await loadContext([session.workDate], { employee });
  const result = await compute(session, ctx);

  // Refused, not stored as a nought — see `noOtHoursMessage`, which is also
  // where the sentence lives, so all four write paths say the same thing.
  if (result.totals.otHours <= 0) {
    return fail(noOtHoursMessage(session, ctx.policy, ctx.dayTypes, result), 400, {
      warnings: result.warnings,
    });
  }

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
