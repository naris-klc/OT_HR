/**
 * Did this request actually arrive over HTTPS?
 *
 * ── WHY THIS IS NOT `NODE_ENV === 'production'` ─────────────────────────────
 *
 * That is what decided the `Secure` flag on the auth cookie until 2026-08-19,
 * and it is the reason nobody but this laptop could log in.
 *
 * `npm start` runs `next start`, which sets NODE_ENV=production — so the cookie
 * went out marked `Secure` while the app was served over plain http. A browser
 * refuses to store a `Secure` cookie on an insecure origin, and localhost is
 * the one exception: 127.0.0.1 is a trustworthy origin, so the laptop itself
 * worked and hid the fault completely.
 *
 * Everybody else opens `http://192.168.109.119:3000` — the address
 * docs/network.md hands out — which is NOT a trustworthy origin. There the
 * login POST succeeded, the browser dropped the cookie on the floor, and the
 * `GET /api/auth/me` that follows it came back 401. What the person saw was
 * "ไม่ได้เข้าสู่ระบบ" under a password that was correct, with nothing anywhere
 * naming a cookie. Verified end to end in Chrome against both origins, same
 * account, same password: 127.0.0.1 logs in, the LAN address does not.
 *
 * So the flag follows the connection instead of the build. Over http there is
 * nothing for `Secure` to protect and it only prevents the cookie from being
 * stored; the day this sits behind TLS the same code sets it without anybody
 * remembering to.
 *
 * ── `x-forwarded-proto` FIRST ───────────────────────────────────────────────
 *
 * A reverse proxy terminating TLS talks to the app over http, so the request's
 * own URL says `http:` on exactly the deployment where the cookie MUST be
 * secure. The header is the only thing that knows, and the first value in it is
 * the client-facing hop.
 *
 * Forging it can only make the cookie stricter than the connection deserves —
 * a browser then refuses to send it back over http — so a lie costs the liar a
 * session and nobody else anything.
 *
 * Its own file, and not four lines inside `setAuthCookie`, for the reason
 * lib/loginThrottle.js is not inside the login route: this is a rule with cases
 * in it, the cases are what went wrong, and a rule with cases should be
 * readable on its own and testable without a running server.
 */

/** @param req a Fetch-style Request (NextRequest included), or nothing. */
export function isHttpsRequest(req) {
  const forwarded = req?.headers?.get?.('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0].trim().toLowerCase() === 'https';

  try {
    return new URL(req.url).protocol === 'https:';
  } catch {
    // No request, or one without a parseable URL. False is the answer that
    // keeps somebody logged in; true would be a cookie no browser stores.
    return false;
  }
}
