import { route, json } from '@/lib/http.js';
import { clearAuthCookie } from '@/lib/session.js';

export const POST = route(async () => clearAuthCookie(json({ ok: true })));
