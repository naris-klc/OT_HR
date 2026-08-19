import Employee from '@/src/models/Employee.js';
import { route, body, json, fail } from '@/lib/http.js';
import { signToken, setAuthCookie, publicUser } from '@/lib/session.js';
import { codeMatcher, sameCode } from '@/src/lib/employeeCode.js';
import {
  delayFor, failuresFor, hintFor, recordFailure, recordSuccess, throttleKey,
} from '@/lib/loginThrottle.js';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export const POST = route(async (req) => {
  const { code, password } = await body(req);
  if (!code || !password) return fail('กรุณากรอกรหัสพนักงานและรหัสผ่าน', 400);

  /**
   * The wait comes BEFORE the password is checked, and before the roster is
   * read at all.
   *
   * Delaying the answer instead would leave the expensive half of this route —
   * an indexed find and a bcrypt compare — running at full speed for whoever is
   * hammering it, which is the half worth protecting. Waiting first also makes
   * the delay indistinguishable from a slow network to the person on the other
   * end, whatever they typed.
   *
   * A blank code is keyed like any other: `normalizeCode` gives '' and somebody
   * posting empty bodies in a loop is counted under it. They were refused at
   * the line above anyway.
   */
  const key = throttleKey(code);
  const wait = delayFor(failuresFor(key));
  if (wait) await sleep(wait);

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
    /**
     * ONE MESSAGE, WHATEVER WENT WRONG — unchanged, and the `hint` beside it
     * keeps that property. A wrong code, a deactivated account and a wrong
     * password have always been refused in the same words so that the refusal
     * cannot be read as "this code exists"; a hint that depended on which of
     * the three it was would give that back. It depends only on how many times
     * this code has been typed wrongly, which the person typing already knows.
     */
    const failures = recordFailure(key);
    const hint = hintFor(failures);
    return fail('รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง', 401, hint ? { hint } : {});
  }

  recordSuccess(key);
  return setAuthCookie(json({ user: publicUser(user) }), signToken(user), req);
});
