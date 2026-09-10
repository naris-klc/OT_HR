/**
 * TWO RULES ABOUT ONE PERSON'S DAY, and they answer different questions.
 *
 * **หนึ่งวัน หนึ่งใบ** (`findSameDate`) — a date may carry one live request and
 * no more, because F-HR-027 gives each day of the month one line. Added
 * 2026-08-31 at HR's request; it is the rule an employee meets, and the one
 * that keeps the printed sheet and the CSV honest.
 *
 * **เวลาทับซ้อน** (`findOverlaps`) — two requests claiming the same minutes.
 * Older, and since 2026-09-10 it is the SECOND net rather than the one that
 * catches what the first cannot. It read *"NOT made redundant by the rule
 * above: the only pair it can still catch is one that crosses a midnight,
 * where the two requests are on two different dates and share hours anyway"*
 * until that day — and that midnight is exactly what went. A session lives
 * inside one date now, so two sessions that share a minute share a date, and
 * `findSameDate` has already refused them.
 *
 * IT STAYS ANYWAY, and the reason is what it costs to be wrong in each
 * direction. Kept, it re-refuses a pair the date rule has already refused, at
 * the price of one array walk. Removed, it takes with it the only check in the
 * building that reads MINUTES — and it would go on the strength of an argument
 * about what `findSameDate` covers, which is the kind of argument that holds
 * until somebody adds a status to `CAP_STATUSES` or a write path that does not
 * run the date rule in front of it. HR asked for ข้ามคืน to go, not for
 * เวลาทับซ้อน.
 *
 * WHY IT WAS MISSING, AND WHY THAT WAS NOT SAFE. `latestPerSession` in
 * lib/reports.js already drops a filing that a later one replaced, and it reads
 * like a duplicate rule, but its key is the WHOLE window —
 * `employee|workDate|startTime|endTime` — so it fires only on two
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
 * (a session ending exactly where the next begins, one landing wholly inside
 * another, two that merely touch) is arithmetic over two windows, and none of
 * it should need a fixture database to state.
 *
 * Relative imports, like every other pure module here: `node --test` resolves
 * no `@/…` alias.
 */

import { formatDate, parseDate, parseTime } from '../src/lib/otEngine.js';

const MINUTES_PER_DAY = 1440;
const DAY_MS = 86400000;

/**
 * หนึ่งวัน หนึ่งใบ — the rule the PAPER imposes, and the one an employee meets
 * first.
 *
 * F-HR-027 gives each day of the month ONE line. Two live requests on one date
 * therefore have nowhere to print: whatever the hours are, the sheet that goes
 * to accounting either loses one of them or runs a second line through a box
 * sized for one. That is a fact about the form rather than about the clock, so
 * it is a comparison of DATES and nothing else — two requests on 5 August
 * collide whether they are 08:00–12:00 and 18:00–21:00 or the same hour twice.
 *
 * IT NOW COVERS EVERYTHING `findOverlaps` COVERS, and that changed on
 * 2026-09-10 rather than here. The paragraph this replaces explained the one
 * gap: *"A session filed against the 5th that runs to 02:00 occupies four hours
 * of the 6th while printing on the 5th's line"*, so the 6th was a different
 * DATE holding the same minutes. No session reaches a second date any more.
 * Both rules still run, this one first, because it is the one the employee can
 * act on without thinking about windows: แก้ไขรายการเดิม.
 *
 * `existing` is the same list `findOverlaps` reads, already narrowed to the
 * person and to the statuses that still hold a claim — a rejected or cancelled
 * request prints on nothing and must not stop the day being filed again, which
 * is exactly what ส่งใหม่ and ยกเลิกแล้วยื่นใหม่ depend on.
 */
export function findSameDate(session, existing = [], { excludeId = null } = {}) {
  const day = session?.workDate;
  return (existing || []).filter((other) => (
    (!excludeId || String(other?._id ?? '') !== String(excludeId))
    && other?.workDate === day
  ));
}

/** `2026-08-05` → `05/08/2026` — the way the form's own date box shows it. */
export function slashDate(workDate) {
  const [y, m, d] = String(workDate || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(workDate || '');
}

/**
 * The refusal, in the words HR asked for on 2026-08-31.
 *
 * It names the DATE and sends the person to the entry that is already there,
 * because there is only one thing to do about this and it is not "file it
 * differently". The date is written the way the `<input type="date">` on the
 * form writes it — `05/08/2026`, ค.ศ. — so the sentence and the box the person
 * is looking at say the same thing; everywhere a date is PROSE this system
 * spells it in Thai and in พ.ศ., and that is a different job.
 *
 * One entry named rather than a list: with the rule enforced there can only
 * ever be one, and the day it is not — a row filed before this rule existed —
 * is a day where naming the first is still the right instruction.
 */
export function sameDateMessage(entry) {
  return `พบรายการ OT ของวันที่ ${slashDate(entry?.workDate)} แล้ว กรุณาแก้ไขรายการเดิม`;
}

/**
 * The window a session occupies on ONE timeline shared by every date.
 *
 * Minutes since the Unix epoch. Two sessions on two different dates cannot
 * clash any more — a session lives inside its own `workDate` since 2026-09-10 —
 * so the day offset no longer earns its keep by catching what the dates could
 * not. It stays because the comparison has to be TOTAL: `findOverlaps` is
 * handed whatever lib/overlapQuery.js read, two bare clock times out of two
 * different days would compare as though they were one day, and a rule that is
 * right only when its caller narrowed correctly is a rule waiting for a caller
 * that did not.
 *
 * `parseDate` returns a UTC midnight, so the division is exact and the day
 * index is an integer. No timezone reaches this: `workDate` is a wall-clock
 * date string and the times are wall-clock times, as they are everywhere else
 * in this system.
 *
 * A FULL DAY WAS ADDED FOR `endsNextDay` HERE, and the note beside it warned
 * against inferring the wrap from the times being out of order, because
 * 22:00 → 22:00 with the flag set was a legal 24-hour session that inference
 * would have flattened to nothing. Both the flag and the session it protected
 * are gone; `computeSession` refuses an end that is not after its start.
 *
 * Throws `OtValidationError` on a date or time it cannot read, from the
 * engine's own parsers — so a malformed payload is refused with the sentence
 * the rest of the system already uses for it.
 */
export function sessionWindow(session) {
  const day = parseDate(session?.workDate) / DAY_MS;
  const base = day * MINUTES_PER_DAY;
  const start = parseTime(session?.startTime);
  const end = parseTime(session?.endTime);
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
 * It read `ข้ามคืน` after the window for a neighbour that wrapped, because
 * 22:00–02:00 on a single line is otherwise a session that appears to run
 * backwards. Nothing wraps now — an end is always after its start — so the
 * window is the two times and nothing else.
 */
export function describeClash(clash, { statusLabel = null } = {}) {
  const e = clash?.entry || {};
  const status = statusLabel ? statusLabel(e.status) : e.status;
  const window = `${e.startTime}–${e.endTime}`;
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
