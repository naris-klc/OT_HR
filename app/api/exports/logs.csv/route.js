import AccessLog from '@/src/models/AccessLog.js';
import { route, query, csvResponse } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { toCsv } from '@/src/lib/csv.js';
import { describeRequest, deviceLabel, EVENT_LABEL, STATUS_CLASS_LABEL, statusClass } from '@/lib/accessLog.js';

/**
 * บันทึกระบบ as a file — the form the log is handed over in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY AN EXPORT AT ALL, WHEN THERE IS A SCREEN
 *
 * Because the request this exists for does not come from somebody who will be
 * given a login. พ.ร.บ.คอมพิวเตอร์ มาตรา ๒๖ requires the records be kept AND
 * that they can be produced when a competent official asks for them; what is
 * asked for is a copy, covering a stated period, that can be read without this
 * application. A screen cannot be handed over and a Mongo collection cannot be
 * read by whoever receives it.
 *
 * The date range is the whole point, so it is not optional in practice even
 * though it is optional in the code — an export with no `from` is the entire
 * log, which is the right default only for a small one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT CARRIES EVERY COLUMN, INCLUDING THE ONES THE SCREEN SUMMARISES
 *
 * The full user-agent, not `deviceLabel`'s two words. The raw
 * `x-forwarded-for` chain, not just the first hop. A record produced for
 * somebody else is not the place for our abridgement of it: the screen's job is
 * to be readable, this file's job is to be complete.
 *
 * UTF-8 BOM by way of `toCsv`, like every other export here, or Excel on Thai
 * Windows renders every ชื่อ-สกุล as mojibake.
 *
 * ผู้ดูแลระบบ only — same rule and same reasons as app/api/logs/route.js. And
 * like every other request, taking this copy is itself a row in the log.
 */

const MAX_ROWS = 100_000;

function dayStart(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

export const GET = route(async (req) => {
  requireRole(await requireAuth(req), 'admin');

  const q = query(req);
  const filter = {};

  const from = dayStart(q.from);
  const to = dayStart(q.to);
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    // The day named is included — `to` is a date somebody typed, not an instant.
    if (to) filter.createdAt.$lt = new Date(to.getTime() + 86400000);
  }
  if (q.event) filter.event = q.event;
  if (q.write === '1') filter.write = true;
  if (q.actor && /^[0-9a-f]{24}$/i.test(q.actor)) filter['actor.id'] = q.actor;

  const rows = await AccessLog.find(filter).sort({ createdAt: 1 }).limit(MAX_ROWS).lean();

  const headers = [
    'วันเวลา', 'ประเภทเหตุการณ์', 'การกระทำ', 'วิธี', 'เส้นทาง', 'พารามิเตอร์',
    'ผลลัพธ์', 'รหัสสถานะ', 'เปลี่ยนแปลงข้อมูล', 'เวลาที่ใช้ (มิลลิวินาที)',
    'รหัสพนักงาน', 'ชื่อ-สกุล', 'บทบาท', 'รหัสที่กรอก (เข้าระบบไม่สำเร็จ)',
    'หมายเลขไอพี', 'ผ่านตัวกลาง', 'อุปกรณ์', 'User-Agent',
  ];

  const body = toCsv(headers, rows.map((r) => [
    // Sorted oldest-first and printed in the office's own timezone: this file
    // is read as a narrative of an evening, not scanned like the screen.
    new Date(r.createdAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
    EVENT_LABEL[r.event] || r.event,
    describeRequest(r.method, r.path),
    r.method,
    r.path,
    r.query || '',
    STATUS_CLASS_LABEL[statusClass(r.status)],
    r.status ?? '',
    r.write ? 'ใช่' : '',
    r.ms ?? '',
    r.actor?.code || '',
    r.actor?.name || '',
    r.actor?.role || '',
    r.attemptedCode || '',
    r.ip || '',
    r.via || '',
    deviceLabel(r.userAgent),
    r.userAgent || '',
  ]));

  const stamp = `${q.from || 'เริ่มต้น'}_${q.to || 'ล่าสุด'}`;
  return csvResponse(`บันทึกระบบ_${stamp}.csv`, body);
});
