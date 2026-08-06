import Employee from '@/src/models/Employee.js';
import { route, body, json, fail } from '@/lib/http.js';
import { signToken, setAuthCookie, publicUser } from '@/lib/session.js';

export const POST = route(async (req) => {
  const { code, password } = await body(req);
  if (!code || !password) return fail('กรุณากรอกรหัสพนักงานและรหัสผ่าน', 400);

  const user = await Employee.findOne({ code: String(code).trim().toUpperCase() })
    .select('+passwordHash')
    .populate('department');

  if (!user || !user.active || !(await user.verifyPassword(password))) {
    return fail('รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง', 401);
  }

  return setAuthCookie(json({ user: publicUser(user) }), signToken(user));
});
