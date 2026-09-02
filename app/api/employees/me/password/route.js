import Employee from '@/src/models/Employee.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';
import { passwordShapePermission } from '@/lib/employees.js';

/** Change own password. */
export const POST = route(async (req) => {
  const user = await requireAuth(req);
  const { current, next } = await body(req);

  /**
   * The same rule ฝ่ายบุคคล's box obeys — length, character set and the byte
   * ceiling — from `lib/employees.js`.
   *
   * It checked only a length until 2026-09-02, which meant this route, the one
   * where Thai is actually typed, was the one door with no character rule at
   * all. What it does NOT borrow is `chosenPasswordPermission`: that refuses a
   * password containing the employee code, and that rule is about a password
   * SOMEBODY ELSE chose for you. This person is choosing their own and is the
   * only one who will know it.
   */
  const shape = passwordShapePermission(next);
  if (!shape.ok) return fail(shape.error, shape.status);

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
