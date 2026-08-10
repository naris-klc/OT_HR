import Employee from '@/src/models/Employee.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { PASSWORD_MIN_LENGTH } from '@/lib/employees.js';

/** Change own password. */
export const POST = route(async (req) => {
  const user = await requireAuth(req);
  const { current, next } = await body(req);

  if (!next || String(next).length < PASSWORD_MIN_LENGTH) {
    return fail(`รหัสผ่านใหม่ต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`, 400);
  }
  // Setting it back to what HR issued leaves the account exactly as exposed as
  // it was, while clearing the flag that says so.
  if (String(next) === String(current || '')) {
    return fail('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม', 400);
  }

  const me = await Employee.findById(user._id).select('+passwordHash');
  if (!(await me.verifyPassword(String(current || '')))) {
    return fail('รหัสผ่านเดิมไม่ถูกต้อง', 401);
  }
  await me.setPassword(String(next));
  // This is now a password only this person knows — which is the whole of what
  // the flag claims, so it comes off here and nowhere else.
  me.mustChangePassword = false;
  await me.save();
  return json({ ok: true });
});
