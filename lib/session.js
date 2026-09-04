/**
 * Session handling — the Next.js port of legacy/middleware/auth.js.
 *
 * The token still rides in the same httpOnly `ot_token` cookie with the same
 * payload, so a session issued by the old Express server stays valid here and
 * the client needs no token handling either way.
 */
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import Employee from '@/src/models/Employee.js';
import { HttpError } from './http.js';
import { isHttpsRequest } from './httpsRequest.js';
import { otModeOf } from './otMode.js';
import { ROLES, visibleRolesFor } from './roles.js';
// The union of "their own แผนก" and "the ones ticked onto them", asked here for
// the same reason every other caller asks it there: three spellings of that
// union is three chances for a screen and a route to disagree about somebody's
// reach.
import { approvalDepartments } from './entries.js';
import { noteActor } from './requestContext.js';

export const COOKIE = 'ot_token';
const MAX_AGE_SECONDS = 12 * 60 * 60;

export function signToken(employee) {
  return jwt.sign(
    { sub: String(employee._id), role: employee.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_TTL || '12h' },
  );
}

/**
 * Attach the auth cookie to an outgoing response.
 *
 * `req` IS NOT OPTIONAL, and the reason is the whole of lib/httpsRequest.js:
 * `secure` used to read NODE_ENV, which `next start` sets to production over a
 * plain-http LAN, and a browser will not store a `Secure` cookie on an origin
 * that is not trustworthy. Everybody outside this laptop was refused a session
 * they had just been granted. The flag follows the connection now, and the
 * connection is only knowable from the request.
 */
export function setAuthCookie(res, token, req) {
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsRequest(req),
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  return res;
}

export function clearAuthCookie(res) {
  res.cookies.set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}

/**
 * The authenticated Employee document, or throw 401.
 *
 * Returns a real mongoose document (not a lean object) because callers rely on
 * `user.maySubmitOt()` and on `user.department` being populated.
 */
export async function requireAuth(req) {
  const bearer = req?.headers?.get('authorization')?.startsWith('Bearer ')
    ? req.headers.get('authorization').slice(7)
    : null;
  const token = (await cookies()).get(COOKIE)?.value || bearer;
  if (!token) throw new HttpError(401, 'ไม่ได้เข้าสู่ระบบ');

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }

  const user = await Employee.findById(payload.sub).populate('department');
  if (!user || !user.active) throw new HttpError(401, 'บัญชีถูกปิดใช้งาน');
  /**
   * The one line that puts a name on every row of บันทึกระบบ.
   *
   * HERE RATHER THAN IN THE ROUTES, because this is the function that knows.
   * Every authenticated handler in the app reaches the session through it, so
   * a route added next year is named in the log without its author doing
   * anything — and a route that does NOT call this is one that authenticated
   * nobody, which is exactly what a nameless log row should mean.
   *
   * AFTER the active check, deliberately: a valid token on a deactivated
   * account is a refused request, and naming its holder as the actor would put
   * them in the log as though they had been let in.
   */
  noteActor(user);
  return user;
}

/** requireRole(user, 'hr', 'admin') */
export function requireRole(user, ...roles) {
  if (!user) throw new HttpError(401, 'ไม่ได้เข้าสู่ระบบ');
  if (!roles.includes(user.role)) throw new HttpError(403, 'ไม่มีสิทธิ์ใช้งานส่วนนี้');
  return user;
}

/** The user shape the client consumes. From legacy/routes/auth.js, plus birthDate. */
export function publicUser(user) {
  return {
    id: String(user._id),
    code: user.code,
    name: user.name,
    role: user.role,
    position: user.position,
    // Read-only on the client — the profile screen shows it, and only Admin
    // can change it on the พนักงาน screen.
    birthDate: user.birthDate || null,
    company: user.company,
    // Every บทบาท files its own OT since 2026-09-03 — the model method says
    // why, and this must stay the same answer as `Employee.maySubmitOt()` or
    // the menu offers a screen the route refuses.
    maySubmitOt: ROLES.includes(user.role),
    // The one thing the client is expected to act on rather than display: while
    // this is true the shell shows the password screen and nothing else.
    mustChangePassword: Boolean(user.mustChangePassword),
    /**
     * HOW MANY แผนก THIS PERSON SIGNS FOR — their own plus the ones ticked onto
     * them (`approvalDepartments`), and 0 for anybody who signs for none.
     *
     * THE IDS, AND IT WAS A COUNT UNTIL THE SAME DAY.
     *
     * A count was enough while the only questions were "name the scope in the
     * head" and "is this more than one" — both answered by `.length`, which is
     * still how they are answered. What the count could not do is fill the แผนก
     * dropdown on a queue with NO ROWS IN IT: the options were built from the
     * rows in hand, so an empty queue offered an empty list, and the control
     * the reader had just been given opened on ไม่มีตัวเลือก. Reported on
     * 2026-09-04, one round after the toolbar was made to survive that queue.
     *
     * IDS AND NOT NAMES, because the names are already one fetch away and that
     * fetch has to happen anyway: ฝ่ายบุคคล sign for no department at all and
     * their filter is the WHOLE company, which no field on this row can supply.
     * So the queue reads `GET /api/departments` (open to any signed-in account
     * since it was written) and narrows it by these ids — one list, one place it
     * comes from, and no second collection read on every /auth/me.
     *
     * Added 2026-09-04 with ผู้จัดการฝ่าย, who are the first บทบาท routinely
     * holding several: until then `department` was the whole answer and the
     * screen said so in as many words.
     */
    coversDepartments: approvalDepartments(user),
    /**
     * HOW MANY บทบาท THIS PERSON READS BELOW THEM — one number, for one
     * decision: whether the คิว draws its บทบาท filter at all.
     *
     * A หัวหน้างาน reads พนักงาน and nothing else, so the dropdown would open on
     * ทุกบทบาท with a single row under it — a control that cannot change what is
     * on screen. HR said so on 2026-09-04: ถ้าเป็นหัวหน้างานที่มีอนุมัติแค่
     * พนักงานอย่างเดียวก็ไม่ต้องมีช่องดรอปดาวน์.
     *
     * A COUNT, AND FROM THE SIGNATURE RATHER THAN FROM THE ROWS — the same
     * reading `coversDepartments` above takes, for the same reason
     * test/queueRoleFilter.test.js gives about แผนก: a filter drawn off the
     * rows in hand appears the morning a second rung has somebody waiting and
     * vanishes when they are signed, and a filter bar that changes width while
     * you are looking at it is worse than one control too many.
     *
     * It is deliberately not the LIST. The queue builds its options from the
     * rows it is holding, which is the right source for what is worth offering;
     * this answers only whether there is ever more than one thing to offer.
     */
    seesRoles: visibleRolesFor(user.role).length,
    department: user.department
      ? {
        id: String(user.department._id),
        code: user.department.code,
        name: user.department.nameTh || user.department.name,
        monthlyCapHours: user.department.monthlyCapHours ?? null,
        weeklyCapHours: user.department.weeklyCapHours ?? null,
        // รูปแบบโอที, so the form can say "this department does not do weekday
        // OT" before the times are typed rather than after they are refused.
        otMode: otModeOf(user.department),
      }
      : null,
  };
}
