/**
 * Refuse to serve without the two values the app cannot work without.
 *
 * Imported for its side effect, by instrumentation.js, only under the Node
 * runtime — so this file is free to use Node APIs, which is the whole reason
 * it is a file.
 *
 * WHY IT EXISTS AT ALL. src/server.js refuses to start without JWT_SECRET
 * because the alternative is worse than a crash: the app comes up, every page
 * renders, and the failure waits for the first person to press เข้าสู่ระบบ —
 * who is then told nothing useful, by a 500 naming an internal error rather
 * than a missing line in .env. The move to Next dropped that guard;
 * lib/session.js reads `process.env.JWT_SECRET` straight, so an unset secret
 * fails closed but fails late and fails silently. MONGODB_URI rides along
 * because it fails the same way one layer down.
 *
 * IT EXITS RATHER THAN THROWS, and that is not tidiness. Throwing was tried:
 * Next 16.3 catches it, prints "Failed to prepare server" followed by an
 * unhandledRejection, AND LEAVES THE PORT OPEN. Verified against this app on
 * 2026-08-13 — with .env moved aside, `next start` logged "✓ Ready in 189ms",
 * logged the error underneath it, and went on listening. A server announcing
 * itself ready while holding no secret to sign a session with is the exact
 * failure this file exists to prevent, so the process is ended here instead:
 * the same console.error + process.exit(1) src/server.js has.
 *
 * IT DOES NOT BREAK `npm run build`. `registerInstrumentation()` returns early
 * when NEXT_PHASE is 'phase-production-build' (see next's
 * dist/server/lib/router-utils/instrumentation-globals.external.js), so a
 * machine that builds without a .env — CI, or a laptop that has never run the
 * app — still builds. Only starting a server is gated, which is the only
 * moment either value matters.
 */
const missing = ['MONGODB_URI', 'JWT_SECRET'].filter((key) => !process.env[key]);

if (missing.length) {
  console.error(
    `${missing.join(' and ')} not set. Copy .env.example to .env and fill it in `
    + '— the server will not start without it.',
  );
  process.exit(1);
}
