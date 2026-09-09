/**
 * สรุปสถานะงวด — what is still unanswered in a month, said in one place.
 *
 * WHAT THIS REPLACED, AND WHY. Until 2026-08-31 this file was lib/periodLock.js
 * and a month could be CLOSED: ฝ่ายบุคคล pressed ปิดงวด, nine write paths
 * refused that month afterwards, and only an administrator could open it again
 * with a reason on the record. HR withdrew the feature. The reason they gave is
 * the one that decides everything below: **the paper file is the record.** Every
 * month is printed, signed and filed as F-HR-027, and that stack in the cabinet
 * — not a flag in this database — is what accounting and an auditor read. A
 * software lock on top of it bought nothing and cost the thing HR actually does
 * most: going back into a month to fix a row somebody queried.
 *
 * SO WHAT IS LEFT IS THE PART THAT WAS ALWAYS USEFUL. Closing a month was never
 * the point of that screen; the CHECK before closing was. ฝ่ายบุคคล wanted to
 * know, before they pressed print, whether anything in the month was still
 * waiting for somebody — because a request nobody has signed does not appear on
 * the sheet, and a sheet that goes into the file missing a row is the error that
 * is expensive to find later. That question survives its answer, and this file
 * is what asks it.
 *
 * NOTHING HERE REFUSES ANYTHING. Every function returns a description; not one
 * returns a `{ status, error }`. That is the whole difference between this file
 * and the one it replaced, and it is worth stating rather than leaving to be
 * noticed: if a future rule needs to STOP a write, it does not belong here — it
 * belongs beside `editPermission`, with the other rules that say no.
 *
 * PURE. Nothing here reads the database; lib/periodStatusQuery.js does that and
 * calls these.
 */
import { periodLabel } from './api.js';

/** The period a work date belongs to. The entry model stamps the same slice. */
export const periodOf = (workDate) => String(workDate || '').slice(0, 7);

/**
 * 'YYYY-MM', and a real month — '2026-13' is not one.
 *
 * Here rather than in the route file it validates, because a `route.js` under
 * the App Router may only export HTTP methods and Next's own config keys; a
 * shared helper exported from one and imported by its siblings is a build
 * error waiting for whoever runs `next build`.
 */
export const isPeriod = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p ?? ''));

/**
 * The statuses that mean "still waiting for somebody".
 *
 * Approved, refused, withdrawn and cancelled are all finished — a month full of
 * refusals is a month that has been dealt with, and it prints correctly.
 */
export const PENDING_STATUSES = Object.freeze(['pending_mgr', 'pending_hr']);

/**
 * THE TWO GROUPS, AND WHY THEY ARE NOT ONE LIST.
 *
 * They differ in what printing the month does to them, which is the only
 * distinction that matters on a screen HR reads immediately before pressing
 * print:
 *
 *   ตกค้าง (`outstanding`) — nobody has answered it yet. An entry sitting in
 *     either queue prints with an EMPTY ลงชื่อหัวหน้างาน box, and a withdrawal
 *     request nobody has decided means a row that is on the sheet may be about
 *     to come off it. Print now and the paper is unsigned, or goes stale the
 *     same week.
 *
 *     `why` SAYS THE SIGNATURE AND NOT THE ROW, since 2026-09-09. It read
 *     "ยังไม่ขึ้นในใบ OT ที่พิมพ์ออกมา", which was true of `pending_mgr` while
 *     the shipped `formPrintScope` kept it off the paper — half false from
 *     2026-09-07 (รอ HR started printing) and wholly false from 2026-09-09,
 *     when the shipped answer became ตั้งแต่ยื่นขอ and both queues reach the
 *     sheet. The missing signature is what is true of a รออนุมัติ row under
 *     EVERY answer to that setting, including the two where the row does not
 *     print at all — which is why this line does not have to ask the policy.
 *
 *   ควรตรวจ (`review`) — finished, and worth a second look. `capExceeded` and
 *     `belowMinimumFlagged` are both APPROVED entries: their hours are real,
 *     their status is final, and they print correctly. They carry a flag saying
 *     somebody decided something unusual, which is a thing to have seen before
 *     the sheet is signed — not a thing to hold the sheet for.
 *
 * The old code drew this same line and called it refusals versus warnings,
 * because one side of it stopped a button. Nothing is stopped now; the line is
 * kept because it is a true statement about the paper.
 *
 * Returns `{ outstanding, review }`, each possibly empty, each a list of
 * `{ kind, count, short, why, text }`. A list rather than a sentence because the
 * card prints them as separate lines and the count is what makes each one
 * actionable.
 *
 * THREE STRINGS AND NOT ONE, because the card says the same thing at two
 * altitudes and must not say it twice:
 *
 *   `short` — "มีใบรออนุมัติค้างอยู่ 4 ใบ". The half that carries the count. It
 *             is what the headline is built from, and it is HR's own sentence.
 *   `why`   — "ยังไม่มีชื่อผู้อนุมัติในใบ OT ที่พิมพ์ออกมา". What that means for the sheet
 *             about to be printed. On its own line under the headline, WITHOUT
 *             the count repeated: the first draft printed `text` there and the
 *             card read "มีใบรออนุมัติค้างอยู่ 4 ใบ" twice, one line apart.
 *   `text`  — the two joined. For anywhere the count and the consequence have to
 *             travel as one sentence and there is no headline above them.
 */
export function periodItems({
  pending = 0, openWithdrawals = 0, capExceeded = 0, belowMinimum = 0,
} = {}) {
  const outstanding = [];
  const review = [];

  if (pending > 0) {
    outstanding.push({
      kind: 'pending',
      count: pending,
      short: `มีใบรออนุมัติค้างอยู่ ${pending} ใบ`,
      why: 'ยังไม่มีชื่อผู้อนุมัติในใบ OT ที่พิมพ์ออกมา',
      text: `มีใบรออนุมัติค้างอยู่ ${pending} ใบ — ยังไม่มีชื่อผู้อนุมัติในใบ OT ที่พิมพ์ออกมา`,
    });
  }
  if (openWithdrawals > 0) {
    outstanding.push({
      kind: 'openWithdrawals',
      count: openWithdrawals,
      short: `มีคำขอถอนใบค้างพิจารณา ${openWithdrawals} คำขอ`,
      why: 'ใบยังนับอยู่จนกว่าจะมีคนตอบ',
      text: `มีคำขอถอนใบค้างพิจารณา ${openWithdrawals} คำขอ — ใบยังนับอยู่จนกว่าจะมีคนตอบ`,
    });
  }
  if (capExceeded > 0) {
    review.push({
      kind: 'capExceeded',
      count: capExceeded,
      short: `มีใบที่เกินเพดานของแผนก ${capExceeded} ใบ`,
      why: 'อนุมัติไปแล้วและยังไม่ได้บันทึกการยกเว้นเพดาน',
      text: `มีใบที่เกินเพดานของแผนก ${capExceeded} ใบ — อนุมัติไปแล้วและยังไม่ได้บันทึกการยกเว้นเพดาน`,
    });
  }
  if (belowMinimum > 0) {
    review.push({
      kind: 'belowMinimum',
      count: belowMinimum,
      short: `มีใบที่ต่ำกว่าเกณฑ์ขั้นต่ำ ${belowMinimum} ใบ`,
      why: 'บันทึกชั่วโมงไว้ตามจริงแล้ว',
      text: `มีใบที่ต่ำกว่าเกณฑ์ขั้นต่ำ ${belowMinimum} ใบ — บันทึกชั่วโมงไว้ตามจริงแล้ว`,
    });
  }

  return { outstanding, review };
}

/**
 * The one line at the top of the card — HR's own example sentence, built.
 *
 * "งวด สิงหาคม 2569 — มีใบรออนุมัติค้างอยู่ 4 ใบ", and when there is more than
 * one thing outstanding they are joined, because two half-sentences on one line
 * still read faster than two lines. The half-sentence is `short`; the trailing
 * clause after the dash explains what it means for the printout and belongs on
 * the line below, not in the headline.
 *
 * A MONTH WITH NO ENTRIES SAYS SO, and says nothing else. Every month before
 * this system was installed is one of those, and "ไม่มีเอกสารตกค้าง" about a
 * month nobody worked is a reassurance about nothing — the kind of line people
 * learn to stop reading.
 *
 * `clear` is the flag the card colours itself by, and it is deliberately about
 * `outstanding` ALONE. A month with two over-cap approvals in it is ready to
 * print; saying otherwise would make the flag mean "there is something on this
 * screen", which every month has.
 */
export function periodSummary({ period, checks = {} } = {}) {
  const label = periodLabel(period);
  const entries = checks.entries ?? 0;
  const { outstanding, review } = periodItems(checks);
  const clear = outstanding.length === 0;

  let headline;
  if (entries <= 0) {
    headline = `งวด ${label} — ยังไม่มีรายการในเดือนนี้`;
  } else if (clear) {
    headline = `งวด ${label} — ไม่มีเอกสารตกค้าง (${entries} รายการ)`;
  } else {
    headline = `งวด ${label} — ${outstanding.map((i) => i.short).join(' และ ')}`;
  }

  return {
    period, label, entries, clear, headline, outstanding, review,
  };
}

/**
 * เดือนก่อนหน้ายังมีของค้าง — พูดหรือไม่พูด.
 *
 * HR arrives on the current month by default. The month that ENDED is the one
 * they are about to print, and nothing else on the screen mentions it.
 *
 * THIS IS THE ONE PLACE THE OLD ปิดงวด REMINDER CHANGED SHAPE RATHER THAN BEING
 * DELETED. It used to speak whenever last month was not closed — which, because
 * closing was a step people forgot, meant it spoke about quiet finished months
 * with nothing wrong with them, every month, forever. There is no "closed" to be
 * missing now, so the only thing worth saying about last month is the thing that
 * was worth saying all along: somebody still has to answer something in it. A
 * month with nothing outstanding is silent.
 *
 * ONE MONTH BACK, not all of them. A sweep needs an endpoint that does not
 * exist, and a prompt listing every month since the system was installed is a
 * prompt people learn to scroll past.
 *
 * @param {object|null} previous  the /periods/<prev> response, or null
 * @returns {{ entries: number, outstanding: Array }|null}
 */
export function previousMonthOutstanding(previous) {
  if (!previous) return null;
  const entries = previous.entries ?? previous.checks?.entries ?? 0;
  if (entries <= 0) return null;

  const outstanding = previous.outstanding ?? periodItems(previous.checks || {}).outstanding;
  if (!outstanding.length) return null;

  return { entries, outstanding };
}
