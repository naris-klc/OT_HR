import AccessLog, { RETENTION } from '@/src/models/AccessLog.js';
import { route, query, json } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { describeRequest, FAILED_LOGIN_ALERT } from '@/lib/accessLog.js';

/**
 * ภาพรวม on บันทึกระบบ — the answer to "is there anything here I should look
 * at", asked before anybody knows what they are looking for.
 *
 * A traffic log is unreadable by scrolling. On a fifty-person LAN this
 * collection grows by a few thousand rows a week, every one of them ordinary,
 * and the two events worth noticing — a run of refused passwords, an account
 * connecting from an address nobody recognises — look exactly like the other
 * four thousand until they are counted. So the screen opens on counts and the
 * lists are what you go to afterwards.
 *
 * SEPARATE FROM /api/logs rather than a `?summary=1` on it, because they are
 * different reads: that one is a `find` with the screen's filters on it, this
 * is a fixed set of aggregations over a fixed window. Folding them together
 * would mean recomputing every count each time somebody changed a filter, on
 * the one collection in this app large enough for that to be felt.
 *
 * ผู้ดูแลระบบ only, for the reasons set out in app/api/logs/route.js.
 */

/** How far back the tiles look. Long enough to cover a week off, short enough to be about now. */
const WINDOW_DAYS = 7;
/** How many days the little bar chart shows. */
const CHART_DAYS = 14;
/**
 * How many rows บัญชีที่ใช้งานมากที่สุด returns.
 *
 * Three, not fifteen. The card answers "who is in here", and on this roster
 * that question is settled at the top of the list: the busiest few accounts
 * carry nearly all of the traffic and the tail is somebody who signed in once.
 * The long version also made this the tallest card in its row, so the two
 * beside it — หมายเลขไอพีที่เข้ามา and คำสั่งแก้ไขข้อมูลที่ใช้บ่อย, both short
 * by nature — sat under a column of whitespace. An account that is not on the
 * list is still reachable from the table below, which filters by บัญชี.
 */
const TOP_ACCOUNTS = 3;

/** Midnight this morning, in the office's timezone — see `dayStart` in ../route.js. */
function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

const daysAgo = (n) => new Date(startOfToday().getTime() - n * 86400000);

/**
 * `2026-08-24`, in local time.
 *
 * `toISOString().slice(0, 10)` is what this would ordinarily be and it is wrong
 * by seven hours here: everything logged before 07:00 Bangkok belongs to the
 * previous UTC day, so a bar chart built on it would move the first two hours
 * of every working morning onto yesterday's column.
 */
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const GET = route(async (req) => {
  requireRole(await requireAuth(req), 'admin');

  const q = query(req);
  const windowDays = Math.min(Math.max(Number(q.days) || WINDOW_DAYS, 1), 90);
  const since = daysAgo(windowDays - 1);
  const chartSince = daysAgo(CHART_DAYS - 1);

  const [total, oldest, newest] = await Promise.all([
    AccessLog.estimatedDocumentCount(),
    AccessLog.findOne().sort({ createdAt: 1 }).select('createdAt').lean(),
    AccessLog.findOne().sort({ createdAt: -1 }).select('createdAt').lean(),
  ]);

  /**
   * One pass over the window, four questions.
   *
   * `$facet` rather than four `countDocuments` calls: they all read the same
   * range of the same index, and four round trips to answer one screen is three
   * more than the collection that grows fastest in this app should be asked for.
   */
  const [facets = {}] = await AccessLog.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $facet: {
        totals: [{
          $group: {
            _id: null,
            requests: { $sum: 1 },
            writes: { $sum: { $cond: ['$write', 1, 0] } },
            errors: { $sum: { $cond: [{ $gte: ['$status', 500] }, 1, 0] } },
            denied: { $sum: { $cond: [{ $in: ['$status', [401, 403]] }, 1, 0] } },
          },
        }],
        logins: [
          { $match: { event: { $in: ['login', 'login_failed'] } } },
          { $group: { _id: '$event', n: { $sum: 1 } } },
        ],
        // Who has actually been in the system this week — by account, since the
        // ฝ่ายบุคคล login is shared and this can only ever count logins, not people.
        accounts: [
          { $match: { 'actor.id': { $ne: null } } },
          {
            $group: {
              _id: '$actor.id',
              code: { $last: '$actor.code' },
              name: { $last: '$actor.name' },
              role: { $last: '$actor.role' },
              n: { $sum: 1 },
              last: { $max: '$createdAt' },
            },
          },
          { $sort: { n: -1 } },
          { $limit: TOP_ACCOUNTS },
        ],
        // Where from. On a LAN these are DHCP leases, so the useful reading is
        // "how many devices" and "is there one I do not recognise".
        addresses: [
          { $match: { ip: { $ne: null } } },
          { $group: { _id: '$ip', n: { $sum: 1 }, last: { $max: '$createdAt' } } },
          { $sort: { n: -1 } },
          { $limit: 15 },
        ],
        // What the system is used FOR, which is the one tile that is not about
        // trouble. Grouped on the template so a hundred and forty approvals of
        // a hundred and forty different entries count as one line.
        actions: [
          { $match: { write: true } },
          { $group: { _id: { method: '$method', template: '$template' }, n: { $sum: 1 } } },
          { $sort: { n: -1 } },
          { $limit: 10 },
        ],
        // The codes somebody tried and failed on. This is the list that turns a
        // count into a question worth asking.
        failedCodes: [
          { $match: { event: 'login_failed' } },
          {
            $group: {
              _id: { code: '$attemptedCode', ip: '$ip' },
              n: { $sum: 1 },
              last: { $max: '$createdAt' },
            },
          },
          { $sort: { n: -1 } },
          { $limit: 10 },
        ],
      },
    },
  ]);

  /** Requests per day, split three ways — the shape of a week at a glance. */
  const byDay = await AccessLog.aggregate([
    { $match: { createdAt: { $gte: chartSince } } },
    {
      $group: {
        /**
         * `timezone` is not optional here. Without it Mongo buckets by UTC and
         * every morning before 07:00 lands on the previous bar — see `ymd`.
         * Named as an offset rather than 'Asia/Bangkok' so the server does not
         * need the timezone database installed to answer this.
         */
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+07:00' } },
        n: { $sum: 1 },
        writes: { $sum: { $cond: ['$write', 1, 0] } },
        failedLogins: { $sum: { $cond: [{ $eq: ['$event', 'login_failed'] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const totals = facets.totals?.[0] || {};
  const loginCounts = Object.fromEntries((facets.logins || []).map((l) => [l._id, l.n]));

  // Every day in the window, including the quiet ones. A chart drawn only from
  // the days that have rows would space a silent Sunday out of existence and
  // make the week look busier than it was.
  const days = [];
  for (let i = CHART_DAYS - 1; i >= 0; i -= 1) {
    const key = ymd(daysAgo(i));
    const hit = byDay.find((d) => d._id === key);
    days.push({
      date: key,
      n: hit?.n || 0,
      writes: hit?.writes || 0,
      failedLogins: hit?.failedLogins || 0,
    });
  }

  return json({
    retention: RETENTION,
    windowDays,
    /**
     * `estimatedDocumentCount` — the collection's own metadata, not a scan.
     * This is a header figure on a screen that is opened to look at something
     * else; it is not worth counting several hundred thousand documents to be
     * exact about, and it can never be more than a few rows out.
     */
    total,
    oldest: oldest?.createdAt || null,
    newest: newest?.createdAt || null,
    requests: totals.requests || 0,
    writes: totals.writes || 0,
    errors: totals.errors || 0,
    denied: totals.denied || 0,
    logins: loginCounts.login || 0,
    failedLogins: loginCounts.login_failed || 0,
    /** The line above which ภาพรวม stops counting and starts warning. */
    failedLoginAlert: FAILED_LOGIN_ALERT,
    days,
    accounts: (facets.accounts || []).map((a) => ({
      id: String(a._id), code: a.code, name: a.name, role: a.role, n: a.n, last: a.last,
    })),
    addresses: (facets.addresses || []).map((a) => ({ ip: a._id, n: a.n, last: a.last })),
    actions: (facets.actions || []).map((a) => ({
      method: a._id.method,
      template: a._id.template,
      label: describeRequest(a._id.method, a._id.template),
      n: a.n,
    })),
    failedCodes: (facets.failedCodes || []).map((f) => ({
      code: f._id.code || null, ip: f._id.ip || null, n: f.n, last: f.last,
    })),
  });
});
