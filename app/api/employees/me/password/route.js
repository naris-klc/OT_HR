import Employee from '@/src/models/Employee.js';
import { route, body, json, fail } from '@/lib/http.js';
import { requireAuth } from '@/lib/session.js';

/** Change own password. */
export const POST = route(async (req) => {
  const user = await requireAuth(req);
  const { current, next } = await body(req);

  if (!next || String(next).length < 6) {
    return fail('รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร', 400);
  }

  const me = await Employee.findById(user._id).select('+passwordHash');
  if (!(await me.verifyPassword(String(current || '')))) {
    return fail('รหัสผ่านเดิมไม่ถูกต้อง', 401);
  }
  await me.setPassword(String(next));
  await me.save();
  return json({ ok: true });
});
