import jwt from 'jsonwebtoken';
import Employee from '../../src/models/Employee.js';

const COOKIE = 'ot_token';

export function signToken(employee) {
  return jwt.sign(
    { sub: String(employee._id), role: employee.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_TTL || '12h' },
  );
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE);
}

/** Populates req.user, or 401s. */
export async function requireAuth(req, res, next) {
  try {
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;
    const token = req.cookies?.[COOKIE] || bearer;
    if (!token) return res.status(401).json({ error: 'ไม่ได้เข้าสู่ระบบ' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await Employee.findById(payload.sub).populate('department');
    if (!user || !user.active) return res.status(401).json({ error: 'บัญชีถูกปิดใช้งาน' });

    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
}

/** requireRole('hr', 'admin') */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'ไม่ได้เข้าสู่ระบบ' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ใช้งานส่วนนี้' });
    return next();
  };
}

/** Wrap an async handler so rejections reach the error middleware. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
