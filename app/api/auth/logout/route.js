import { route, json } from '@/lib/http.js';
import { clearAuthCookie, requireAuth } from '@/lib/session.js';
import { noteAuthEvent } from '@/lib/requestContext.js';

/**
 * ออกจากระบบ — clear the cookie, and say whose it was.
 *
 * IT STILL SUCCEEDS FOR SOMEBODY WHO IS NOT LOGGED IN, and that is why the
 * session is read inside a `catch` that does nothing. An expired token, a
 * missing one, a deactivated account: all of them arrive here as a person
 * pressing ออกจากระบบ, and every one of them must get their cookie cleared
 * rather than a 401 telling them they cannot leave. The old handler took no
 * request at all for exactly this reason.
 *
 * What it did not do was leave a record. `requireAuth` is what names an actor
 * in บันทึกระบบ (see lib/requestContext.js), so with nothing calling it every
 * logout in the system was an anonymous row — and "when did this account's
 * session end" is one of the few questions a traffic log is asked directly.
 * The call is here for its side effect on the log, and its result is unused.
 */
export const POST = route(async (req) => {
  try {
    await requireAuth(req);
  } catch {
    // No session, or an expired one. Nothing to name; the cookie still goes.
  }
  noteAuthEvent('logout');
  return clearAuthCookie(json({ ok: true }));
});
