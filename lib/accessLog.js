/**
 * บันทึกระบบ — the rules for what a request record may say, and what it may
 * never say. Pure: no mongoose, no Next, no imports at all, so `node --test`
 * pins every rule below without a database or a server.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Three trails already answer "what did this figure used to be": `history` on
 * OtEntry, otEmployeeAudits for the roster (lib/rosterAudit.js), and
 * otPolicyVersions for the calculation. Every one of them is about a VALUE.
 * None of them can answer the question พ.ร.บ. ว่าด้วยการกระทำความผิดเกี่ยวกับ
 * คอมพิวเตอร์ มาตรา ๒๖ actually asks of whoever runs a system: given a moment
 * in time, WHO was connected, from WHERE, and what did they touch — including
 * the person who only ever looked, and the person whose password was refused.
 *
 * A read leaves no trace in any of the three. Neither does a login that failed
 * eleven times at 02:00 from an address nobody recognises. Those are exactly
 * the events the law is written about, and this collection is where they land.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS NEVER IN IT
 *
 * THE REQUEST BODY. Not summarised, not truncated, not "just the keys". The
 * same allowlist reasoning as lib/rosterAudit.js, taken one step further: that
 * file names the fields it may record, this one records no field value at all.
 * `POST /api/auth/login` and `POST /api/employees/me/password` carry a plaintext
 * password in their body, and a logger with any body-recording path in it is one
 * refactor away from writing that password into a collection ผู้ดูแลระบบ can
 * read on screen. There is no such path. What a write CHANGED stays where it
 * already is — in the entry's own history, in the roster trail, in the policy
 * version — and this records that the request happened, by whom, from where,
 * and whether the server allowed it.
 *
 * The query string is recorded, minus anything named like a secret. Nothing in
 * this app puts a password in a query string; `redactQuery` is here so that a
 * route added next year cannot quietly make that untrue.
 */

/**
 * มาตรา ๒๖: ข้อมูลจราจรทางคอมพิวเตอร์ must be kept for at least ninety days.
 *
 * A FLOOR, NOT A SETTING. `retentionDays` will not return anything smaller,
 * whatever is in the environment — a typo in a .env that silently shortened
 * retention to a week would be discovered by somebody asking for records that
 * no longer exist, which is the worst possible moment to discover it.
 */
export const RETENTION_MIN_DAYS = 90;

/**
 * How long records are kept, from `LOG_RETENTION_DAYS`.
 *
 * `null` — the default, and what an unset variable gives — means KEEP THEM.
 * Deleting is the irreversible direction, so it is the one that has to be asked
 * for out loud. The collection is small (one short document per API call on a
 * fifty-person LAN) and it rides inside `npm run backup` like everything else.
 */
export function retentionDays(raw = process.env.LOG_RETENTION_DAYS) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(Math.floor(n), RETENTION_MIN_DAYS);
}

// ── who was at the other end ────────────────────────────────────────────────

/**
 * One address, in the shape a person can compare against a DHCP lease.
 *
 * Node hands out IPv4 addresses over IPv6 sockets as `::ffff:192.168.109.45`,
 * which is the same address the router calls 192.168.109.45 and looks nothing
 * like it in a table. `::1` is this laptop talking to itself, and printing that
 * as 127.0.0.1 is not a translation anybody has to be taught.
 */
export function normalizeIp(raw) {
  if (!raw) return null;
  const ip = String(raw).trim();
  if (!ip) return null;
  if (ip === '::1') return '127.0.0.1';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return mapped ? mapped[1] : ip;
}

/**
 * The address to hold this request against.
 *
 * `x-forwarded-for` IS ALWAYS THERE, even with no proxy in front of the app:
 * Next's node server fills it in from the socket itself when nothing else has
 * (`req.headers['x-forwarded-for'] ??= originalRequest.socket.remoteAddress`,
 * node_modules/next/dist/server/base-server.js). That is the only reason this
 * works at all — a route handler is handed a Fetch `Request`, which has no
 * socket and no `.ip`, and without that line every record here would say
 * "ไม่ทราบ" on a system whose entire purpose is to say who.
 *
 * FIRST HOP, NOT LAST. The leftmost entry is the client; the rest are proxies.
 * It is also the forgeable one — anybody on the LAN can send whatever header
 * they like — so the untouched chain is kept beside it in `via`. A single value
 * that quietly changed meaning the day a reverse proxy appeared would be worse
 * than either: today `ip` is the socket address and cannot be forged, and the
 * day it can be, `via` is what shows it.
 */
export function clientIp(req) {
  const chain = req?.headers?.get?.('x-forwarded-for') || '';
  const first = chain.split(',')[0];
  return normalizeIp(first);
}

/** The `x-forwarded-for` chain as sent, or null when there was only one hop. */
export function forwardedChain(req) {
  const chain = (req?.headers?.get?.('x-forwarded-for') || '').trim();
  return chain.includes(',') ? chain.slice(0, 200) : null;
}

/** Long enough for any real browser's string, short enough not to be a payload. */
export const UA_MAX_CHARS = 250;

export function userAgentOf(req) {
  const ua = req?.headers?.get?.('user-agent');
  return ua ? String(ua).slice(0, UA_MAX_CHARS) : null;
}

/**
 * "Chrome · Android" — a user-agent string at the width of a table column.
 *
 * The full string is what is STORED, because it is the identifying half of a
 * traffic record and somebody asking for logs is not asking for our summary of
 * them. This is only how it is printed, and the row's pop-up shows the original.
 * Order matters: Edge and Samsung Internet both say "Chrome", and Chrome says
 * "Safari", so the most specific claim has to be tested first.
 */
const BROWSERS = [
  [/Edg[eA]?\//, 'Edge'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Line\//, 'LINE'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
  [/curl\//i, 'curl'],
  [/PowerShell/i, 'PowerShell'],
  [/node|undici/i, 'Node'],
];

const PLATFORMS = [
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Windows NT/, 'Windows'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

export function deviceLabel(ua) {
  if (!ua) return 'ไม่ทราบอุปกรณ์';
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const platform = PLATFORMS.find(([re]) => re.test(ua))?.[1];
  if (browser && platform) return `${browser} · ${platform}`;
  return browser || platform || 'ไม่ทราบอุปกรณ์';
}

// ── what was asked for ──────────────────────────────────────────────────────

/**
 * Query keys that never reach the collection, whatever they hold.
 *
 * Nothing in this app sends any of these in a URL today. The list is here for
 * the route somebody adds next year: a redaction rule written after the leak is
 * a rule that ran too late, and this one costs nothing while it is unnecessary.
 */
export const SENSITIVE_QUERY_KEYS = /pass|pwd|secret|token|auth|hash|otp|key/i;

/** The redacted query string, or null when there was nothing to keep. */
export function redactQuery(search) {
  if (!search) return null;
  const params = new URLSearchParams(String(search).replace(/^\?/, ''));
  const kept = [];
  for (const [k, v] of params) {
    kept.push(`${k}=${SENSITIVE_QUERY_KEYS.test(k) ? '███' : v}`);
  }
  return kept.length ? kept.join(' · ').slice(0, 300) : null;
}

/**
 * `/api/entries/68a1…/approve` → `/entries/:id/approve`.
 *
 * The shape of a request rather than the request, so ภาพรวม can count "how many
 * times was something approved this week" without a hundred and forty distinct
 * paths each counting one. Ids, periods and dates are the three things that
 * vary; every other segment of every path in this app is fixed.
 *
 * The `/api` prefix comes off because every path here carries it — a column
 * that says the same four characters on every row is a column of nothing.
 */
export function pathTemplate(path) {
  if (!path) return '';
  return String(path)
    .replace(/^\/api/, '')
    .split('/')
    .map((seg) => {
      if (/^[0-9a-f]{24}$/i.test(seg)) return ':id';
      if (/^\d{4}-\d{2}$/.test(seg)) return ':period';
      if (/^\d{4}-\d{2}-\d{2}$/.test(seg)) return ':date';
      return seg;
    })
    .join('/') || '/';
}

/**
 * Requests not worth a record, and the reason each one is on the list.
 *
 * A log padded with non-events is one nobody reads — the same rule
 * `worthRecording` applies to the roster trail, and the stakes are higher here
 * because this collection is the one somebody will one day read UNDER PRESSURE,
 * looking for a single evening's activity.
 *
 * `/api/health` is polled by whatever watches the server and says nothing about
 * anybody. It is also the only unauthenticated route in the app, so leaving it
 * in would fill the log with actor-less rows that look exactly like the thing
 * worth noticing.
 */
export const UNLOGGED_PATHS = Object.freeze(['/api/health']);

export const shouldRecord = (path) => !UNLOGGED_PATHS
  .includes(String(path || '').replace(/\/+$/, ''));

/**
 * POSTs that change nothing, named — because "did this request change data" is
 * the question การแก้ไขข้อมูล is built on, and the method alone gets it wrong
 * in both directions if left to itself.
 *
 * `/entries/preview` is the form asking the engine what a set of times would
 * come to. It writes nothing, and somebody filing one request may send twenty
 * of them while typing it. Counting those as edits would bury the one POST that
 * really filed something under nineteen that did not.
 */
export const READ_ONLY_POSTS = Object.freeze(['/entries/preview']);

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Did this request set out to change something?
 *
 * "Set out to" — a refused write (403) and a failed one (400) are both `true`
 * here. That is deliberate: an attempt to change something that the server
 * turned down is precisely the kind of event a log exists to preserve, and a
 * flag that read `status < 400` would drop it.
 *
 * The two auth events are excluded by their path. Logging in changes no data,
 * and it has a tab of its own.
 */
export function isMutation(method, path) {
  if (!WRITE_METHODS.has(String(method || '').toUpperCase())) return false;
  const t = pathTemplate(path);
  if (t.startsWith('/auth/')) return false;
  return !READ_ONLY_POSTS.includes(t);
}

// ── what it is called where a person reads it ───────────────────────────────

/**
 * The Thai name of each thing the API can be asked to do.
 *
 * RESOLVED WHEN THE LOG IS READ, NOT WHEN IT IS WRITTEN. The record holds the
 * method and the path, which are facts; this is our description of them, and a
 * description improves. Storing the sentence would freeze today's wording into
 * three years of records — so the day a label is found to be misleading, only
 * the new rows would get the better one, and the old rows, the ones being read
 * under pressure, would keep the wording that was found to be misleading.
 *
 * Matched in order, first hit wins, so specific entries sit above general ones.
 */
const ACTIONS = [
  ['POST', '/auth/login', 'เข้าสู่ระบบ'],
  ['POST', '/auth/logout', 'ออกจากระบบ'],
  ['GET', '/auth/me', 'ตรวจสอบเซสชัน'],

  ['POST', '/entries', 'ยื่นใบขออนุมัติ OT'],
  ['GET', '/entries', 'ดูรายการใบ OT'],
  ['POST', '/entries/preview', 'คำนวณตัวอย่างก่อนยื่น'],
  ['GET', '/entries/approvers', 'ดูผู้มีสิทธิ์อนุมัติ'],
  ['GET', '/entries/queue-summary', 'นับใบที่รออนุมัติ'],
  ['GET', '/entries/:id', 'เปิดดูใบ OT'],
  ['PATCH', '/entries/:id', 'แก้ไขใบ OT'],
  ['POST', '/entries/:id/approve', 'อนุมัติใบ OT'],
  ['POST', '/entries/:id/reject', 'ไม่อนุมัติใบ OT'],
  ['POST', '/entries/:id/cancel', 'ยกเลิกใบ OT'],
  ['POST', '/entries/:id/cap-override', 'อนุมัติเกินเพดาน'],
  ['POST', '/entries/:id/withdraw', 'ขอถอนใบที่อนุมัติแล้ว'],
  ['POST', '/entries/:id/withdraw/decide', 'ตัดสินคำขอถอนใบ'],
  ['GET', '/entries/:id/trail', 'ดูประวัติของใบ OT'],
  ['GET', '/entries/usage/:period', 'ดูยอดสะสมเทียบเพดาน'],

  ['POST', '/employees', 'เพิ่มพนักงานเข้าทะเบียน'],
  ['PATCH', '/employees/:id', 'แก้ไขทะเบียนพนักงาน'],
  ['POST', '/employees/import', 'นำเข้าทะเบียนพนักงานจาก CSV'],
  ['GET', '/employees/import/template', 'ดาวน์โหลดแบบฟอร์มนำเข้าทะเบียน'],
  ['GET', '/employees/audit', 'ดูประวัติการแก้ทะเบียน'],
  ['GET', '/employees/:id/audit', 'ดูประวัติการแก้ทะเบียนรายคน'],
  ['GET', '/employees/:id/impact', 'ดูผลกระทบก่อนแก้ทะเบียน'],
  ['GET', '/employees', 'ดูทะเบียนพนักงาน'],
  ['POST', '/employees/me/password', 'เปลี่ยนรหัสผ่านของตนเอง'],

  ['GET', '/departments', 'ดูรายชื่อแผนก'],
  ['POST', '/departments', 'เพิ่มแผนก'],
  ['PATCH', '/departments/:id', 'แก้ไขแผนกหรือเพดาน'],
  ['GET', '/holidays', 'ดูวันหยุดบริษัท'],
  ['POST', '/holidays', 'เพิ่มวันหยุดบริษัท'],
  ['DELETE', '/holidays/:id', 'ลบวันหยุดบริษัท'],
  ['POST', '/holidays/import', 'นำเข้าวันหยุดจาก CSV'],
  ['GET', '/holidays/import/template', 'ดาวน์โหลดแบบฟอร์มนำเข้าวันหยุด'],

  ['GET', '/settings', 'ดูการตั้งค่าระบบ'],
  ['PATCH', '/settings', 'แก้ไขการตั้งค่าระบบ'],
  ['PATCH', '/settings/policy', 'แก้ไขนโยบายการคำนวณ'],
  ['GET', '/settings/policy-versions', 'ดูประวัตินโยบาย'],
  ['POST', '/settings/policy-versions', 'บันทึกนโยบายที่ใช้อยู่เป็นรุ่น'],
  ['GET', '/settings/policy-confirmations', 'ดูการยืนยันนโยบาย'],
  ['POST', '/settings/policy-confirmations', 'ยืนยันนโยบายการคำนวณ'],
  ['POST', '/settings/recompute', 'คำนวณใบ OT ใหม่ตามนโยบาย'],
  ['GET', '/settings/backup-status', 'ดูสถานะการสำรองข้อมูล'],

  ['GET', '/periods/:period', 'ดูสถานะงวด'],
  ['POST', '/periods/:period/close', 'ปิดงวด'],
  ['POST', '/periods/:period/reopen', 'เปิดงวดที่ปิดแล้ว'],

  ['GET', '/delegations', 'ดูผู้รับช่วงอนุมัติ'],
  ['POST', '/delegations', 'ตั้งผู้รับช่วงอนุมัติ'],
  ['DELETE', '/delegations/:id', 'ยกเลิกผู้รับช่วงอนุมัติ'],
  ['GET', '/delegations/candidates', 'ดูรายชื่อผู้รับช่วงที่เลือกได้'],

  ['GET', '/birthday/queue', 'ดูคิวตรวจวันหยุดวันเกิด'],
  ['POST', '/birthday/checks', 'บันทึกผลตรวจวันหยุดวันเกิด'],
  ['POST', '/birthday/entries', 'ยื่นใบวันหยุดวันเกิด'],

  ['GET', '/exports/entries.csv', 'ดาวน์โหลด CSV ใบ OT'],
  ['GET', '/exports/accounting.csv', 'ดาวน์โหลด CSV ส่งบัญชี'],
  ['GET', '/exports/departments.csv', 'ดาวน์โหลด CSV แยกแผนก'],
  ['GET', '/exports/monthly.csv', 'ดาวน์โหลด CSV รายเดือน'],
  ['GET', '/exports/logs.csv', 'ดาวน์โหลด CSV บันทึกระบบ'],

  ['GET', '/logs', 'เปิดดูบันทึกระบบ'],
  ['GET', '/logs/summary', 'เปิดดูภาพรวมบันทึกระบบ'],

  ['GET', '/reports/accounting/:period', 'ดูรายงานส่งบัญชี'],
  ['GET', '/reports/monthly/:period', 'ดูรายงานรายเดือน'],
  ['GET', '/reports/form/:period', 'ดึงใบ F-HR-027 เพื่อพิมพ์'],
  ['GET', '/reports/birthday-check/:period', 'ดูรายงานตรวจวันหยุดวันเกิด'],
];

/**
 * What this request was, in Thai — or the method and path when we have no name
 * for it.
 *
 * FALLING BACK TO THE PATH RATHER THAN TO "อื่น ๆ" is the point. A route added
 * without a line in the table above still appears, still readable, and looking
 * slightly unfinished — which is a great deal better than a log that files it
 * under "other" and lets it disappear.
 */
export function describeRequest(method, path) {
  const m = String(method || '').toUpperCase();
  const t = pathTemplate(path);
  const hit = ACTIONS.find(([am, ap]) => am === m && ap === t);
  return hit ? hit[2] : `${m} ${t}`;
}

/** Every request shape this file has a name for — what the filter offers. */
export const KNOWN_ACTIONS = Object.freeze(
  ACTIONS.map(([method, template, label]) => ({ method, template, label })),
);

/** ok · ปฏิเสธ · ผิดพลาด — four groups, because a log is scanned, not read. */
export function statusClass(status) {
  const n = Number(status);
  if (!Number.isFinite(n)) return 'unknown';
  if (n >= 500) return 'error';
  if (n === 401 || n === 403) return 'denied';
  if (n >= 400) return 'refused';
  return 'ok';
}

export const STATUS_CLASS_LABEL = Object.freeze({
  ok: 'สำเร็จ',
  refused: 'ข้อมูลไม่ผ่าน',
  denied: 'ไม่มีสิทธิ์ / ยังไม่ได้เข้าระบบ',
  error: 'ระบบผิดพลาด',
  unknown: 'ไม่ทราบผล',
});

/** The four things a record can be about. */
export const EVENTS = Object.freeze(['request', 'login', 'login_failed', 'logout']);

export const EVENT_LABEL = Object.freeze({
  request: 'เรียกใช้ระบบ',
  login: 'เข้าสู่ระบบสำเร็จ',
  login_failed: 'เข้าสู่ระบบไม่สำเร็จ',
  logout: 'ออกจากระบบ',
});

/**
 * How many failed logins is worth saying out loud on ภาพรวม.
 *
 * NOT A LOCKOUT and not connected to one — lib/loginThrottle.js is what slows a
 * guesser down, and HR's answer there was explicitly NO ACCOUNT LOCKOUT because
 * the ฝ่ายบุคคล login is shared by the whole department. This is only the number
 * above which the overview stops printing a count and starts printing a warning,
 * so that somebody working through employee codes overnight is visible the next
 * morning instead of being one row among four hundred.
 */
export const FAILED_LOGIN_ALERT = 10;
