import AccessLog, { RETENTION } from '@/src/models/AccessLog.js';
import { route, query, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { describeRequest, deviceLabel, EVENTS, statusClass } from '@/lib/accessLog.js';

/**
 * บันทึกระบบ — the traffic log, read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ผู้ดูแลระบบ ONLY, AND NOT ฝ่ายบุคคล
 *
 * Every other screen HR can reach is about OT. This one is about PEOPLE: which
 * account was connected at 22:40, from which phone, and what it opened. That is
 * a different kind of information about a colleague than "how many hours did
 * they file", and the audience for it is the person responsible for the system
 * rather than the department that manages the staff.
 *
 * The shared ฝ่ายบุคคล login is the second reason (see the memory note: the
 * whole department types the same password). A screen naming who did what,
 * handed to an account several people share, tells each of them what all the
 * others did — while the log's own record of HR's activity could then be read
 * by whichever of them was curious about it. `requireRole(user, 'admin')` is
 * the same one-line rule the rest of the app uses; there is no per-row
 * narrowing under it, because there is no half of this a non-admin may see.
 *
 * READING THE LOG IS ITSELF LOGGED. `route()` records this request like any
 * other, so `GET /logs` appears in its own answer the next time it is opened.
 * That is not an accident of the implementation, it is the property that makes
 * the collection worth anything: a log an administrator can read without trace
 * is one that says nothing about the one account that can reach everything.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** A user-typed string, made safe to hand to `$regex`. */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `2026-08-24` → the instant that day starts here.
 *
 * LOCAL TIME, NOT UTC, and the difference is seven hours of somebody else's
 * evening. Bangkok is UTC+7, so `new Date('2026-08-24')` — which JavaScript
 * reads as midnight UTC — is 07:00 on the 24th in the office. A ตั้งแต่วันที่
 * filter built that way would silently drop the first working morning of the
 * range, which is the shape of bug nobody notices until the one time it matters.
 */
function dayStart(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

/** The instant AFTER that day ends — so `ถึงวันที่` includes the day named. */
function dayEnd(ymd) {
  const start = dayStart(ymd);
  if (!start) return null;
  return new Date(start.getTime() + 86400000);
}

/**
 * The four status groups, as a Mongo condition.
 *
 * `statusClass` is the pure function the screen colours a row with; this is the
 * same partition expressed as a filter, and the two are pinned against each
 * other in test/accessLog.test.js. A filter that disagreed with the colour
 * beside it would be worse than no filter at all.
 */
const STATUS_FILTER = {
  ok: { $lt: 400 },
  refused: { $gte: 400, $lt: 500, $nin: [401, 403] },
  denied: { $in: [401, 403] },
  error: { $gte: 500 },
};

export const GET = route(async (req) => {
  requireRole(await requireAuth(req), 'admin');

  const q = query(req);
  const filter = {};

  if (q.event) {
    if (!EVENTS.includes(q.event)) return fail('ไม่รู้จักประเภทเหตุการณ์ที่ขอกรอง', 400);
    filter.event = q.event;
  } else if (q.authOnly === '1') {
    /**
     * การเข้าใช้งาน with its own dropdown left on "ทั้งหมด" — getting in,
     * getting out, and failing to get in, together.
     *
     * The three as one filter rather than the tab defaulting to `login_failed`,
     * because a successful login at 03:00 from an address nobody recognises is
     * the event a screen showing only failures would let past. The dropdown
     * narrows to any one of them for whoever wants that; the tab itself is the
     * whole story of a session beginning and ending.
     */
    filter.event = { $in: ['login', 'login_failed', 'logout'] };
  }

  /**
   * การแก้ไขข้อมูล — every request that set out to change something.
   *
   * A tab rather than a filter on the method, because "what has been changed"
   * is not "what was not a GET": `POST /entries/preview` changes nothing and
   * the form sends one per keystroke pause. See `isMutation`.
   */
  if (q.write === '1') filter.write = true;

  if (q.actor) {
    // 'none' is a real question — every row with nobody's name on it. Those are
    // failed logins and requests refused before a session was established, and
    // they are the ones somebody scanning for trouble wants isolated.
    if (q.actor === 'none') filter['actor.id'] = null;
    else if (!/^[0-9a-f]{24}$/i.test(q.actor)) return fail('รหัสผู้ใช้งานไม่ถูกต้อง', 400);
    else filter['actor.id'] = q.actor;
  }

  if (q.template) filter.template = q.template;
  if (q.ip) filter.ip = q.ip;

  if (q.status) {
    if (!STATUS_FILTER[q.status]) return fail('ไม่รู้จักผลลัพธ์ที่ขอกรอง', 400);
    filter.status = STATUS_FILTER[q.status];
  }

  const from = q.from ? dayStart(q.from) : null;
  const to = q.to ? dayEnd(q.to) : null;
  if (q.from && !from) return fail('รูปแบบวันที่เริ่มต้นไม่ถูกต้อง', 400);
  if (q.to && !to) return fail('รูปแบบวันที่สิ้นสุดไม่ถูกต้อง', 400);
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lt = to;
  }

  /**
   * ค้นหา — one box across the five fields somebody actually types into it.
   *
   * The path, the two names on the record, the code typed at a failed login,
   * and the address. NOT the Thai action label: that is computed at read time
   * from the method and the path (see `describeRequest`), so it does not exist
   * in the database to search. Searching `/entries/` finds the same rows, which
   * is why the screen prints the path under every label.
   */
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q.trim()), 'i');
    filter.$or = [
      { path: rx }, { 'actor.code': rx }, { 'actor.name': rx }, { attemptedCode: rx }, { ip: rx },
    ];
  }

  const limit = Math.min(Number(q.limit) || DEFAULT_LIMIT, MAX_LIMIT);

  /**
   * WHERE IN THE LIST — the page, expressed as rows already passed.
   *
   * IT USED TO BE A WINDOW THAT GREW. `limit` was the whole of the paging:
   * the screen asked for the newest hundred, and ดูย้อนหลังเพิ่ม asked for
   * three hundred, then five, then said "แสดงได้สูงสุด 500 รายการต่อครั้ง" and
   * stopped. Anything older than the five hundredth row was reachable only by
   * narrowing the dates or downloading the CSV — which is a log that answers
   * "what happened on Tuesday" with "download the file and look".
   *
   * A page is `skip` rows in and `limit` rows long, so the end of the
   * collection is reachable by pressing › enough times and nothing is behind a
   * ceiling. `MAX_LIMIT` stays as the guard it always was: it now caps a PAGE,
   * and the screen's largest page is 100.
   *
   * `Number('abc')` is NaN and `NaN || 0` is 0, so a junk `skip` reads as the
   * first page rather than failing the request — the same shape `limit` above
   * has always had. Negatives are clamped for Mongo's sake, which throws on
   * them.
   */
  const skip = Math.max(0, Math.trunc(Number(q.skip) || 0));

  /**
   * `_id` IS THE TIEBREAKER, AND SKIP-BASED PAGING IS WHY IT HAD TO BE ADDED.
   *
   * `createdAt` is written per request and this app can serve several inside
   * one millisecond — a page's worth of preview calls from one form, say. On a
   * single unbounded read a tie is drawn in whatever order the index hands it
   * back and nobody can tell; across two reads that each skip a different
   * number of rows, an unstable tie is a record that appears on page 2 and
   * again on page 3, while another appears on neither. `_id` is monotonic
   * within a second and unique, so the order is total and a row has exactly
   * one page.
   */
  const [total, found] = await Promise.all([
    AccessLog.countDocuments(filter),
    AccessLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit + 1)
      .lean(),
  ]);

  const records = found.slice(0, limit);

  /**
   * Who appears in this log — read off the records, not off today's roster.
   *
   * Same rule as the ผู้แก้ไข dropdown on ประวัติการแก้ทะเบียน and for the same
   * two reasons: an account since deactivated still did what it did and must
   * stay selectable, and a new account that has never connected would otherwise
   * sit in the list offering an always-empty result.
   *
   * Built from the WHOLE collection rather than from `filter`, so choosing a
   * person does not empty the list of everybody else — a filter that can only
   * ever be relaxed by clearing it is not a filter.
   */
  const actors = (await AccessLog.aggregate([
    { $match: { 'actor.id': { $ne: null } } },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: '$actor.id',
        code: { $last: '$actor.code' },
        name: { $last: '$actor.name' },
        role: { $last: '$actor.role' },
      },
    },
    { $sort: { code: 1 } },
  ])).map((a) => ({
    id: String(a._id), code: a.code || null, name: a.name || null, role: a.role || null,
  }));

  return json({
    // KEPT, THOUGH `total` NOW ANSWERS THE SAME QUESTION BETTER. It costs one
    // extra document to read and it is the only figure that is true even if
    // `countDocuments` and the `find` disagree — which they can, a millisecond
    // apart, on a collection every request writes to.
    hasMore: found.length > limit,
    /**
     * How many rows the filter matches, not how many this page holds.
     *
     * WITHOUT IT THE PAGER CANNOT SPEAK. "แสดง 1–10 จากทั้งหมด 120 รายการ" and
     * "หน้า 1 / 12" are both this number; a screen with only `hasMore` can say
     * there is more and never how much, which is the difference between a list
     * somebody can plan to read and one they page through hoping to reach the
     * end.
     */
    total,
    skip,
    retention: RETENTION,
    actors,
    records: records.map((r) => ({
      id: String(r._id),
      at: r.createdAt,
      event: r.event,
      method: r.method,
      path: r.path,
      template: r.template,
      query: r.query || null,
      status: r.status ?? null,
      // Computed here, not stored — see the comment on ACTIONS in
      // lib/accessLog.js for why a description belongs to the reader and not
      // to the record.
      action: describeRequest(r.method, r.path),
      statusClass: statusClass(r.status),
      ms: r.ms ?? null,
      write: Boolean(r.write),
      actor: r.actor?.id
        ? {
          id: String(r.actor.id), code: r.actor.code, name: r.actor.name, role: r.actor.role,
        }
        : null,
      attemptedCode: r.attemptedCode || null,
      ip: r.ip || null,
      via: r.via || null,
      userAgent: r.userAgent || null,
      device: deviceLabel(r.userAgent),
    })),
  });
});
