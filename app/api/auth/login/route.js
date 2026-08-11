import Employee from '@/src/models/Employee.js';
import { route, body, json, fail } from '@/lib/http.js';
import { signToken, setAuthCookie, publicUser } from '@/lib/session.js';
import { codeMatcher, sameCode } from '@/src/lib/employeeCode.js';

export const POST = route(async (req) => {
  const { code, password } = await body(req);
  if (!code || !password) return fail('กรุณากรอกรหัสพนักงานและรหัสผ่าน', 400);

  /**
   * However they spelled it. The roster holds PM-0620 and PM00511 side by side,
   * so the hyphen is a fact about which register a code was copied from, not
   * about who is typing — and somebody who types their own code without it was
   * being told their password was wrong. `codeMatcher` finds the row and
   * `sameCode` decides it is the right one; see src/lib/employeeCode.js.
   */
  const matcher = codeMatcher(code);
  const found = matcher
    ? await Employee.findOne({ code: matcher }).select('+passwordHash').populate('department')
    : null;
  const user = found && sameCode(found.code, code) ? found : null;

  if (!user || !user.active || !(await user.verifyPassword(password))) {
    return fail('รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง', 401);
  }

  return setAuthCookie(json({ user: publicUser(user) }), signToken(user));
});
