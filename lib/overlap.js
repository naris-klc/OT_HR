/**
 * เวลาทับซ้อน — two requests claiming the same minutes of the same person.
 *
 * WHY IT WAS MISSING, AND WHY THAT WAS NOT SAFE. `latestPerSession` in
 * lib/reports.js already drops a filing that a later one replaced, and it reads
 * like a duplicate rule, but its key is the WHOLE window —
 * `employee|workDate|startTime|endTime|endsNextDay` — so it fires only on two
 * filings of exactly the same session. 17:00–19:00 and 18:30–20:30 on one
 * evening are two different keys and were therefore two different pieces of
 * work: both counted against the department's ceiling (4 h of a clock that ran
 * 3.5), both printed on F-HR-027, and both went on to accounting. Nothing on
 * any screen said so, and the only reader who could have caught it is a หัวหน้า
 * noticing two rows in a queue.
 *
 * SO THIS IS A RULE ABOUT MINUTES, NOT ABOUT KEYS. It answers the one question
 * a string comparison cannot: do the two sessions share any minute at all.
 *
 * PURE — no database, no clock, no mongoose. The reads are in
 * lib/overlapQuery.js, the same split lib/delegation.js makes beside
 * lib/delegationQuery.js and for the same reason: every case worth testing here
 * (a session ending exactly where the next begins, an overnight shift reaching
 * into tomorrow's request, a request landing inside yesterday's overnight one)
 * is arithmetic over two windows, and none of it should need a fixture
 * database to state.
 *
 * Relative imports, like every other pure module here: `node --test` resolves
 * no `@/…` alias.
 */

import { formatDate, parseDate, parseTime } from '../src/lib/otEngine.js';

const MINUTES_PER_DAY = 1440;
const DAY_MS = 86400000;

/**
 * The window a session occupies on ONE timeline shared by every date.
 *
 * Minutes since the Unix epoch, which is the only representation in which two
 * sessions on two different dates can be compared at all. `workDate` alone
 * cannot do it: a shift filed against 9 August that runs to 02:00 is on the
 * 10th for four of its hours, and a comparison keyed on the filing date would
 * miss every clash that crosses a midnight — which is exactly the shape this
 * rule exists to catch.
 *
 * `parseDate` returns a UTC midnight, so the division is exact and the day
 * index is an integer. No timezone reaches this: `workDate` is a wall-clock
 * date string and the times are wall-clock times, as they are everywhere else
 * in this system.
 *
 * `endsNextDay` is added as a full day rather than inferred from the times
 * being out of order — an entry may legitimately read 22:00 → 22:00 with the
 * flag set (a 24-hour session, which `computeSession` allows and anything
 * longer it refuses), and inferring would silently make that one zero minutes
 * long and therefore clash with nothing.
 *
 * Throws `OtValidationError` on a date or time it cannot read, from the
 * engine's own parsers — so a malformed payload is refused with the sentence
 * the rest of the system already uses for it.
 */
export function sessionWindow(session) {
  const day = parseDate(session?.workDate) / DAY_MS;
  const base = day * MINUTES_PER_DAY;
  const start = parseTime(session?.startTime);
  const end = parseTime(session?.endTime) + (session?.endsNextDay ? MINUTES_PER_DAY : 0);
  return { start: base + start, end: base + end };
}

/**
 * Do two windows share a minute?
 *
 * `max(startA, startB) < min(endA, endB)`, and the strict `<` is the whole
 * rule rather than a detail. Both ends are half-open — a session OCCUPIES its
 * start minute and does not occupy its end minute — so 17:00–19:00 and
 * 19:00–21:00 touch and do not overlap, which is what somebody clocking off
 * one job and onto another means. A `<=` here would refuse the commonest
 * legitimate pair of requests in the building.
 */
export function overlapsWindow(a, b) {
  return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}

/**
 * Every stored request the given session collides with.
 *
 * `existing` is what lib/overlapQuery.js read — the same person's live requests
 * within a day either side. The caller has already narrowed by employee and by
 * status; this only compares windows.
 *
 * `excludeId` keeps an edit from colliding with itself. It is not optional in
 * practice: without it every PATCH that leaves the times alone would be
 * refused by the entry it is editing.
 *
 * A ROW WHOSE OWN TIMES CANNOT BE READ IS SKIPPED, not thrown on. A single
 * malformed historic document would otherwise make it impossible to file any
 * new OT within a day of it, which is a worse failure than the one this
 * function prevents — and the row is already visible to every screen that
 * lists the month.
 *
 * Returns one entry per clash, with the shared span in minutes, ordered by
 * when the clash starts so the message names them in the order of the day.
 */
export function findOverlaps(session, existing = [], { excludeId = null } = {}) {
  const mine = sessionWindow(session);
  const found = [];

  for (const other of existing || []) {
    if (excludeId && String(other?._id ?? '') === String(excludeId)) continue;

    let theirs;
    try {
      theirs = sessionWindow(other);
    } catch {
      continue;
    }
    if (!overlapsWindow(mine, theirs)) continue;

    found.push({
      entry: other,
      /** The shared span, in minutes — what the refusal quantifies. */
      minutes: Math.min(mine.end, theirs.end) - Math.max(mine.start, theirs.start),
      from: Math.max(mine.start, theirs.start),
    });
  }

  return found.sort((a, b) => a.from - b.from);
}

/**
 * How one clashing request is named back to the person who filed it.
 *
 * THE EXISTING ENTRY'S OWN FIELDS, printed the way its own row prints them —
 * date, จาก, ถึง — rather than the overlapping span rendered as a timestamp.
 * The span is the fact the rule turns on; the window is the thing the employee
 * has to go and look at, and naming an interval that appears on no screen
 * ("ทับกันตั้งแต่ 18:30 ถึง 19:00") sends them hunting for a request that says
 * neither of those times.
 *
 * `ข้ามคืน` is spelled out for an overnight neighbour, because 22:00–02:00 read
 * off a single line is otherwise a session that appears to run backwards.
 */
export function describeClash(clash, { statusLabel = null } = {}) {
  const e = clash?.entry || {};
  const status = statusLabel ? statusLabel(e.status) : e.status;
  const window = `${e.startTime}–${e.endTime}${e.endsNextDay ? ' (ข้ามคืน)' : ''}`;
  const label = status ? ` [${status}]` : '';
  return `${e.workDate} ${window}${label} — ทับกัน ${clash.minutes} นาที`;
}

/**
 * The refusal, as one sentence plus one line per clash.
 *
 * It names every clash rather than the first, for the reason `blockedMessage`
 * names every ceiling in lib/caps.js: being turned away over one request and
 * then again over a second one they could not see is two trips to the form for
 * one mistake.
 *
 * `statusLabel` is handed in rather than imported. The Thai status names live
 * on the model (`STATUS_LABEL_TH` in src/models/OtEntry.js) and this module is
 * pure — importing mongoose to spell one word would cost the whole test suite
 * its independence from a database.
 */
export function overlapMessage(clashes, { statusLabel = null } = {}) {
  const lines = (clashes || []).map((c) => `• ${describeClash(c, { statusLabel })}`);
  return 'เวลาที่กรอกทับซ้อนกับใบ OT ที่บันทึกไว้แล้วของพนักงานคนนี้ '
    + `${lines.length} ใบ:\n${lines.join('\n')}\n`
    + 'กรุณาแก้เวลาให้ไม่ทับกัน หรือยกเลิก/แก้ไขใบเดิมก่อน';
}
