/**
 * Session handling — the Next.js port of src/middleware/auth.js.
 *
 * The token still rides in the same httpOnly `ot_token` cookie with the same
 * payload, so a session issued by the old Express server stays valid here and
 * the client needs no token handling either way.
 */
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import Employee from '@/src/models/Employee.js';
import { HttpError } from './http.js';

export const COOKIE = 'ot_token';
const MAX_AGE_SECONDS = 12 * 60 * 60;

export function signToken(employee) {
  return jwt.sign(
    { sub: String(employee._id), role: employee.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_TTL || '12h' },
  );
}

/** Attach the auth cookie to an outgoing response. */
export function setAuthCookie(res, token) {
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
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
  return user;
}

/** requireRole(user, 'hr', 'admin') */
export function requireRole(user, ...roles) {
  if (!user) throw new HttpError(401, 'ไม่ได้เข้าสู่ระบบ');
  if (!roles.includes(user.role)) throw new HttpError(403, 'ไม่มีสิทธิ์ใช้งานส่วนนี้');
  return user;
}

/** The user shape the client consumes. From src/routes/auth.js, plus birthDate. */
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
    maySubmitOt: user.role === 'employee',
    // The one thing the client is expected to act on rather than display: while
    // this is true the shell shows the password screen and nothing else.
    mustChangePassword: Boolean(user.mustChangePassword),
    department: user.department
      ? {
        id: String(user.department._id),
        code: user.department.code,
        name: user.department.nameTh || user.department.name,
        monthlyCapHours: user.department.monthlyCapHours ?? null,
        weeklyCapHours: user.department.weeklyCapHours ?? null,
      }
      : null,
  };
}
