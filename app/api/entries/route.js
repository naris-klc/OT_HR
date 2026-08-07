import mongoose from 'mongoose';
import OtEntry from '@/src/models/OtEntry.js';
import { route, body, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { compute, applyComputation, checkCap, loadContext } from '@/src/services/otService.js';
import { POPULATE, scopeFor, pickSession, stampCap, latestPerChain } from '@/lib/entries.js';
import { normaliseDescription } from '@/src/config/policy.js';

// ── list ────────────────────────────────────────────────────────────────────

export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const { status, period, employee, department, from, to, limit, replaced } = query(req);
  const q = { ...scopeFor(user) };

  if (status) q.status = { $in: String(status).split(',') };
  if (period) q.period = period;
  if (employee && user.role !== 'employee') q.employee = employee;
  if (department && ['hr', 'admin'].includes(user.role)) q.department = department;
  if (from || to) {
    q.workDate = {};
    if (from) q.workDate.$gte = from;
    if (to) q.workDate.$lte = to;
  }

  const found = await OtEntry.find(q)
    .populate(POPULATE)
    .sort({ workDate: -1, createdAt: -1 })
    .limit(Number(limit) || 500)
    .lean();

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

  return json({ entries, replacedCount: hidden.length });
});

// ── submit ──────────────────────────────────────────────────────────────────

export const POST = route(async (req) => {
  const user = await requireAuth(req);
  // §2: managers are not eligible to submit OT. HR and Admin are not either —
  // they administer the process rather than take part in it.
  if (!user.maySubmitOt()) return fail('ตำแหน่งนี้ไม่สามารถบันทึก OT ได้', 403);

  const payload = await body(req);
  const session = pickSession(payload);
  const { value: description, error: descriptionError } = normaliseDescription(payload.description);
  if (descriptionError) return fail(descriptionError, 400);

  // The employee is the caller here, and `user` is a full document, so their
  // birthDate is already in hand — no extra query to resolve their day types.
  const ctx = await loadContext([session.workDate], { employee: user });
  const result = await compute(session, ctx);

  if (result.totals.otHours <= 0) {
    return fail('ช่วงเวลานี้อยู่ในเวลาทำงานปกติทั้งหมด จึงไม่นับเป็น OT', 400, {
      warnings: result.warnings,
    });
  }

  const period = session.workDate.slice(0, 7);
  const cap = await checkCap({
    employee: user,
    department: user.department,
    period,
    result,
    policy: ctx.policy,
  });

  // [OPEN 8] 'block' refuses here; 'warn' lets it through carrying the flag.
  if (cap.blocked) {
    return fail(
      `เกินเพดาน ${cap.capHours} ชม./เดือน ของแผนก (ใช้ไปแล้ว ${cap.usedHoursBefore} ชม.)`,
      409,
      { cap },
    );
  }

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

  const entry = new OtEntry({
    _id: childId,
    employee: user._id,
    department: user.department._id,
    ...session,
    description,
    status: 'pending_mgr',
    refiledFrom,
  });
  applyComputation(entry, result, ctx);
  stampCap(entry, cap);
  entry.log(user, 'submit', null, null);

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
