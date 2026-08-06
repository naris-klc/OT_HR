import OtEntry from '@/src/models/OtEntry.js';
import { route, body, query, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { compute, applyComputation, checkCap, loadContext } from '@/src/services/otService.js';
import { POPULATE, scopeFor, pickSession, stampCap } from '@/lib/entries.js';
import { normaliseDescription } from '@/src/config/policy.js';

// ── list ────────────────────────────────────────────────────────────────────

export const GET = route(async (req) => {
  const user = await requireAuth(req);
  const { status, period, employee, department, from, to, limit } = query(req);
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

  const entries = await OtEntry.find(q)
    .populate(POPULATE)
    .sort({ workDate: -1, createdAt: -1 })
    .limit(Number(limit) || 500)
    .lean();

  return json({ entries });
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

  const ctx = await loadContext([session.workDate]);
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

  const entry = new OtEntry({
    employee: user._id,
    department: user.department._id,
    ...session,
    description,
    status: 'pending_mgr',
  });
  applyComputation(entry, result);
  stampCap(entry, cap);
  entry.log(user, 'submit', null, null);
  await entry.save();

  return json({ entry: await entry.populate(POPULATE), cap }, 201);
});
