import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import { connect } from '@/lib/db.js';

/**
 * /api/health — the one endpoint a monitor may call, and the only one that is
 * allowed to answer while the system is broken.
 *
 * WHAT IT IS FOR. Uptime Kuma, Netdata or a cron with `curl` polling this every
 * minute so that somebody knows the OT system is down before ฝ่ายบุคคล rings to
 * say so. It replaces the `GET /api/health` the retired Express server had
 * (see legacy/README.md), which was one line and never checked the database.
 *
 * IT CHECKS MONGO, NOT ONLY NEXT. A health check that answers 200 because the
 * web server is running, while the database behind it is unreachable, is worse
 * than no health check: it is a green light on a dashboard next to a system in
 * which nobody can log in, file OT or close a month. Every screen in this app
 * is a database read, so "Next is up" is not a fact anybody needs.
 *
 * `admin().ping()` rather than a `countDocuments`: it is the cheapest round trip
 * that proves the connection is live and the server is answering, and it reads
 * no collection, so a monitor hitting this every 60 seconds for a year costs
 * nothing and touches no data.
 *
 * NO AUTHENTICATION, AND THEREFORE NOTHING WORTH READING. A monitor cannot log
 * in, so this is the one route outside `requireAuth`. What it returns is
 * accordingly the smallest true statement possible: whether the two halves are
 * up, and how long the database took to answer. No version, no counts, no
 * hostnames, no connection string, no employee anything — an unauthenticated
 * endpoint's response is a public document, and the way these grow into a leak
 * is one useful field at a time. `database.error` is the mongoose error NAME
 * (`MongoServerSelectionError`) and never its message, which carries the host
 * and port it failed to reach.
 *
 * 200 / 503, because that is what a monitor reads. The JSON body is for a person
 * who has already been paged and is looking at it in a browser; the status code
 * is the alert. `Cache-Control: no-store` because a cached health check is a
 * health check of the past — Route Handlers are not cached by default in this
 * version of Next, but a proxy in front of the app is a different matter, and
 * this is the one route where a stale answer is actively harmful.
 *
 * NOT WRAPPED IN `route()`. That helper connects first and turns any throw into
 * a 500 — which for every other route is right, and here would mean a database
 * outage produced `เกิดข้อผิดพลาดภายในระบบ` with a 500, indistinguishable from a
 * bug in the handler. This one has to survive the failure it exists to report,
 * so it does its own connecting inside its own try.
 */
export async function GET() {
  const startedAt = Date.now();

  let database = { ok: false };
  try {
    await connect();
    /**
     * `readyState` is checked as well as the ping, because they answer two
     * different questions: the state is what mongoose believes about the pool,
     * the ping is what the server actually said just now. A pool that has gone
     * away without mongoose noticing yet reports 1 and fails the ping, and it is
     * the ping that decides.
     */
    await mongoose.connection.db.admin().ping();
    database = { ok: true, readyState: mongoose.connection.readyState };
  } catch (err) {
    // The NAME only. The message names the host and port — see the note above.
    database = { ok: false, error: err?.name || 'Error' };
  }

  const body = {
    ok: database.ok,
    // Which half is broken, for whoever is reading this at two in the morning.
    // `server: true` is a tautology — nothing else could have produced this
    // response — and it is stated anyway, because the pair is what makes
    // `ok: false` legible without knowing the shape in advance.
    server: true,
    database,
    /** How long the round trip took, in ms. A number that climbs is a warning
     *  a boolean cannot give: the disk or the network degrading before it
     *  fails outright. */
    latencyMs: Date.now() - startedAt,
    /** ISO, and UTC on purpose: this is a machine-facing timestamp for
     *  correlating with a monitor's own log, not a date anybody in the office
     *  reads. Every date a PERSON sees in this system is a wall-clock string
     *  decided in Asia/Bangkok — see lib/today.js. */
    at: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: database.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
