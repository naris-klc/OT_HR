/**
 * เทียบเวลาบนใบ OT กับไฟล์สแกนนิ้วมือ — และบอกเมื่อไม่ตรง.
 *
 * ── THIS IS A WARNING, NOT AN ARITHMETIC ───────────────────────────────────
 *
 * It is the first thing in this system to READ `otScanPunches`, and the line it
 * must not cross is written into `src/models/ScanPunch.js`: **a machine may not
 * restate a sheet two people signed.** So nothing here changes an hour, a
 * bucket, a ceiling or a status. It produces a sentence for a person who is
 * reconciling a month, and that person decides.
 *
 * The distinction is not decoration. The three questions that block computing
 * hours from punches — which punch is in, which is out, what an odd number of
 * them means — are all questions about *deriving* a figure. Asking "is there a
 * scan near the time this request claims" needs none of them answered: a scan
 * near 17:30 is evidence somebody was at the door at 17:30 whichever direction
 * they were walking.
 *
 * ── WHAT IT COMPARES ────────────────────────────────────────────────────────
 *
 * Two instants: the START the request claims and the END — and the two are NOT
 * read the same way, because the question is not the same on each side.
 *
 * THE END IS A DIRECTION, NOT A DISTANCE. Asked for in that shape on
 * 2026-09-07: *เวลาสแกนออกจริง >= เวลาสิ้นสุด OT ในใบขอ = ทำงานครบตามขอ, ไม่ต้อง
 * แสดง Badge แจ้งเตือนเวลาขาด.* Somebody who left at 20:40 on a request ending
 * 20:00 worked everything they asked for and forty minutes nobody is paying
 * them for; that is not a discrepancy and it had been marked as one until then.
 * Only a scan-out EARLIER than the end is เวลาขาด, and it is reported with the
 * shortfall in it — `ไม่ครบ · ขาด 40 นาที` (the badge read `สแกนออกก่อนเวลา OT`
 * until HR's own three words arrived later the same day; see `SCAN_BADGE`).
 *
 * NO TOLERANCE ON THAT SIDE. Asked and answered the same day — *ถ้าเวลาไม่ตรง
 * กันขึ้นทุกกรณี* — so a scan-out one minute short is one minute short and says
 * so. `SCAN_MATCH_TOLERANCE_MINUTES` still rules the START, where the question
 * really is "is this the same moment"; on the end there is no window left for a
 * punch to be inside of.
 *
 * ON THE END, THE PUNCH QUOTED HAS NO DISTANCE LIMIT — asked for in that shape on
 * 2026-09-07: *ถ้ามีเวลาสแกนหลายเวลา ให้เอาเวลาที่ใกล้ที่สุดกับเวลาที่ยื่นขอ
 * โอทีมา.* A day whose only punch is the 07:42 arrival says so, in ชม./นาที,
 * instead of `ไม่มีสแกนใกล้เคียง` on a row that prints 07:42 underneath it.
 * The START keeps a two-hour window, because there the far punch is the morning
 * arrival on nearly every row and quoting it is the noise this feature nearly
 * died of. See `witnessWindow` and `gapText`.
 *
 * NOT SYMMETRICALLY, and that is the shape of this workplace rather than a
 * shortcut. Most people scan before 08:00, work the shift, and scan once more
 * when the OT is over — at 17:00 they are already inside, so the machine has no
 * door event to record and the START has nothing to be checked against. A start
 * with no punch near it is therefore not a finding on a day that has a punch
 * earlier than it; the END carries the verdict. A punch that IS near the start
 * and disagrees is still reported. See `checkEntryAgainstScans`.
 *
 * Pure — no I/O, no clock, no model imports. `lib/scanMatchQuery.js` is what
 * fetches the punches; the browser gets the answers already computed.
 */
/**
 * `'17:05'` and `'17:05:22'` → minutes from midnight.
 *
 * NOT `parseTime` from lib/entries.js, and the reason is the seconds: an entry's
 * times are `HH:MM` because a person wrote them, a punch is `HH:MM:SS` because a
 * machine did (see `time` in src/models/ScanPunch.js), and that parser refuses
 * the second shape outright. Widening it would mean the picker's validator
 * started accepting a string no form can produce, to help a comparison it takes
 * no part in. Seconds are FLOORED rather than rounded: a punch at 17:29:59 is in
 * minute 17:29, which is where a person reading the machine's own listing would
 * look for it.
 */
function hhmmOf(value) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 'YYYY-MM-DD' → whole days since the epoch. A string, so no timezone can move it. */
function dayNumber(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * How far a scan may sit from a claimed START and still be called the same
 * moment. **15 นาที.**
 *
 * ── IT IS THE START'S NUMBER ONLY, SINCE 2026-09-07 ────────────────────────
 *
 * It ruled both sides until then. Asked whether the end should keep a window,
 * HR answered *ถ้าเวลาไม่ตรงกันขึ้นทุกกรณี* — so a scan-out is measured against
 * the requested end itself and a minute short is a minute short. See `metEnd`.
 * The tolerance still decides the start, where the question is whether two
 * clocks are describing one trip through the door rather than whether somebody
 * stayed as long as they said.
 *
 * ── ASKED AND ANSWERED, 2026-09-04 ──────────────────────────────────────────
 *
 * This block read "[OPEN] THIS NUMBER IS OURS, NOT HR'S — nobody has been
 * asked" until then. ฝ่ายบุคคล were asked whether fifteen was too tight or too
 * loose and answered **ไม่** — neither. The number stands, and it now stands on
 * an answer rather than on our own reasoning.
 *
 * That reasoning is kept because it is still why fifteen is a safe number to
 * have been wrong about: a person walks to the door and back, and the OT
 * arithmetic already refuses anything under a 30-minute block (`floor/30`), so
 * a tolerance at half a block cannot make a difference that the hours
 * themselves would notice.
 *
 * It is deliberately NOT in `Setting.policy`: a value in there mints a policy
 * version and gets stamped onto entries, and this decides nothing about pay —
 * it decides how loud a screen is. The same call รูปแบบวันที่ใน CSV made (that
 * setting was itself withdrawn on 2026-09-04; the reasoning is what is being
 * borrowed here, not the field). It stays printed on the screen beside the
 * warning rather than buried here, for the same reason it was before: an
 * answer given once is not an answer that can never change.
 */
export const SCAN_MATCH_TOLERANCE_MINUTES = 15;

/**
 * 04:00 — WHERE ONE WORKING DAY'S SCANS STOP BEING THE PREVIOUS DAY'S.
 *
 * The first punch at or after this time is that day's **เวลาเริ่ม**, and the
 * row prints it under that name. Asked for on 2026-09-09: *เวลาที่จากเครื่อง
 * สแกนที่แสดง ให้แสดงเฉพาะเวลาแรกหลัง 04.00 น. เป็นต้นไปนับเป็นเวลาเข้างาน* —
 * the label read `เข้างาน` from that day until 2026-09-10, when the row was
 * asked for in a shorter shape and the word became `เริ่ม`.
 *
 * ── AND SINCE 2026-09-10 IT IS ALSO WHERE THE LINE STARTS ────────────────
 *
 * The floor used to name one punch and leave the rest of the day alone, so a
 * 00:59 still printed among the evening times. It no longer does: a punch
 * below this line on `workDate` is off the row unless this row's own finding
 * quoted it (`early`, in `checkEntryAgainstScans`). One line, one working day.
 *
 * ── IT IS THE ONE PUNCH THIS MODULE IS ALLOWED TO NAME ────────────────────
 *
 * Everything else here refuses to, and `SCAN_BADGE` says so out loud: the
 * machines write no in/out flag, so calling a punch เข้า or ออก asserts a field
 * the file does not have. This exception is HR's own call and it is kept as
 * narrow as the words they used — the FIRST punch of the day, and only that
 * one. **Nothing downstream reads it.** No verdict, no hour, no bucket, no
 * badge and no count moves; the start side still decides ก่อน/หลัง on distance
 * alone, and the rest of the day's times still print beside the label in clock
 * order, unnamed. A reader who thinks the label has misread the day can see
 * every raw time on the same row and say so.
 *
 * ── WHY 04:00 AND NOT MIDNIGHT ────────────────────────────────────────────
 *
 * A punch in the small hours is somebody LEAVING the previous evening's OT, not
 * arriving, and naming it เวลาเริ่ม would date the day's arrival hours before
 * the person walked in. There is no night shift here — *ไม่มีกะดึก*, 2026-09-04,
 * the same answer that let the start side read a scan before the OT begins as
 * "already inside" — so nothing legitimate starts between midnight and 04:00
 * and the floor costs nothing where it is drawn.
 */
export const SCAN_CHECK_IN_FLOOR_MINUTES = 4 * 60;

/** The verdicts. `no_scan` is not a mismatch, and the screens must not merge them. */
export const SCAN_MATCH = Object.freeze({
  /** The scan-out reached the requested end, and the start has nothing against it. */
  OK: 'ok',
  /** เวลาขาด, or a start the machine actively disagrees with. THE ONLY ONE THAT WARNS. */
  MISMATCH: 'mismatch',
  /** This person has no scans at all on this day — a gap in the evidence. */
  NO_SCAN: 'no_scan',
});

/**
 * HOW FAR PAST THE REQUESTED END A SCAN MUST RUN BEFORE THE ROW SAYS เกินเวลา.
 *
 * ── THIRTY, BECAUSE THIRTY IS WHAT AN OT BLOCK IS ──────────────────────────
 *
 * Asked for on 2026-09-07 in exactly that shape — *เกิน 30 นาที (เท่าบล็อก
 * OT)* — and the arithmetic is what makes it the right number rather than a
 * round one. The engine rounds OT down to whole 30-minute blocks (`floor/30`),
 * so an overrun shorter than a block is an overrun the person could not have
 * claimed even if they had filed it: there is no OT in it. Marking it would be
 * the row pointing at minutes that no version of this request could ever have
 * carried.
 *
 * ── AND WITHOUT IT THE CHIP WOULD BE ON EVERY ROW ──────────────────────────
 *
 * Nobody's last door event lands on the exact minute their request ends. At
 * zero grace, a 20:03 scan on a 20:00 request is เกินเวลา, and so is nearly
 * every other row of the month — which is the failure this module has already
 * paid for twice (the 17:00 start finding, and the amber flat-day chip): a mark
 * on almost every line is a mark nobody reads, and it takes the true ones with
 * it. The short side has no grace on purpose (*ถ้าเวลาไม่ตรงกันขึ้นทุกกรณี*)
 * because a shortfall is a claim to money; an overrun is a gift, and a gift
 * three minutes wide is not news.
 *
 * NOT IN `Setting.policy`, for the same reason `SCAN_MATCH_TOLERANCE_MINUTES`
 * above is not: it decides how loud a screen is, never what anybody is paid,
 * and a value in there would mint a policy version and be stamped onto entries.
 * Not read off `roundingIncrementMinutes` either — a company that rounded to 15
 * would silently halve the quiet on this screen, and the two numbers are equal
 * today by agreement rather than by derivation.
 */
export const SCAN_OVER_MINUTES = 30;

/**
 * THE WORDS ON THE BADGES, written once and read by the row and by the tests.
 *
 * They live here rather than in `components/common.jsx` for the reason every
 * other wording in this module does — a fact that is worded twice is a fact
 * that gets corrected once.
 *
 * ── HR'S OWN THREE WORDS, GIVEN AS DEFINITIONS ON 2026-09-07 ───────────────
 *
 *   · **เกินเวลา** — *ขอโอทีมาน้อยกว่าที่ทำจริง เช่น ขอโอทีมา 19:00 น. แต่สแกน
 *     ออก 19:30 น.*
 *   · **ไม่ครบ** — *ขอโอทีมามากกว่าเวลาที่ทำจริง เช่น ขอโอทีมาถึง 20:00 น. แต่
 *     สแกนออกตอน 19:30 น.*
 *   · **ไม่ตรง** — *ไม่มีการสแกนนิ้วแต่ยื่นขอโอที*
 *
 * The three are named from the REQUEST's point of view — how the paper compares
 * with the day — and not from the machine's. That is why เกินเวลา and ไม่ครบ
 * are opposites of each other rather than degrees of one thing, and it is worth
 * keeping in mind when reading the code below, which is written the other way
 * round (it measures the scan against the request's end).
 *
 * ── WHAT THESE WORDS REPLACED, AND WHY THE LIST IS ONE LONGER ──────────────
 *
 * `ไม่มีข้อมูลสแกนนิ้ว` → **ไม่ตรง**, `สแกนออกก่อนเวลา OT` → **ไม่ครบ**, both
 * on 2026-09-07. `START_OFF` is NOT one of HR's three and keeps a longer name
 * on purpose: it is a start the machine actively disagrees with, nothing about
 * the end of the row is wrong, and calling it ไม่ตรง would collide head-on with
 * the word that now means *no scan at all*.
 *
 * ── THE NEUTRAL VOICE SURVIVES UNDERNEATH ─────────────────────────────────
 *
 * This module refuses to name a punch เข้า or ออก, and `scanMismatchDetail`
 * still does not (ก่อนเวลา / หลังเวลา): the machines write no in/out flag, so
 * calling one an exit asserts a field the file does not have. The BADGE carries
 * HR's own wording; the evidence line under it stays neutral and quotes the raw
 * time, so a reader who thinks the badge has misread the day can see why.
 */
export const SCAN_BADGE = Object.freeze({
  /** No punches at all on this day, and a request filed for it anyway. */
  NO_SCAN: 'ไม่ตรง',
  /** The scan-out came before the OT was due to end — filed more than worked. */
  SHORT: 'ไม่ครบ',
  /** The scan-out ran a whole OT block past the end — filed less than worked. */
  OVER: 'เกินเวลา',
  /** Not one of HR's three: a start the machine actively disagrees with. */
  START_OFF: 'เวลาเริ่มไม่ตรงกับสแกน',
});

/**
 * Minutes from midnight of `workDate`, so a request and every punch that could
 * be evidence for it are on ONE number line.
 *
 * IT WAS BUILT FOR ข้ามคืน and outlived it. An entry ending 02:00 the next day
 * was minute 1560 and a punch at 02:04 on the following date 1564 — four apart,
 * which is what they were, where comparing the clock faces would have made them
 * 1436 apart and flagged every wrapped row. No entry wraps since 2026-09-10,
 * and this still earns its keep on the row that does not wrap: somebody who
 * finishes a 23:30 request and reaches the reader at 00:05 leaves a punch on
 * TOMORROW'S date, and it is that punch the end side has to be able to quote.
 */
function minutesFrom(workDate, date, time) {
  const minutes = hhmmOf(time);
  if (minutes === null) return null;
  return (dayNumber(date) - dayNumber(workDate)) * 1440 + minutes;
}

/**
 * `70` → `'70 นาที'`, `708` → `'11 ชม. 48 นาที'`.
 *
 * ── A BARE MINUTE COUNT IS WHAT MADE THE FAR SCAN UNREADABLE ───────────────
 *
 * "604 นาที" was the argument for dropping a far punch out of the sentence
 * altogether: printed in the same words as a 40-minute discrepancy it reads as
 * a number the machine failed to make sense of. `11 ชม. 48 นาที` reads as what
 * it is — *there was no scan near this; the closest all day was the morning
 * one* — so the evidence can be kept and the reader is not misled by it. That
 * is what let the bound come off the end on 2026-09-07.
 *
 * ── AND THE THRESHOLD IS TWO HOURS, WHICH IS NOT AN ARBITRARY ONE ──────────
 *
 * It is the old `quoteWindow`. Every distance this feature could print before
 * 2026-09-07 was inside it, so setting the switch there means **no sentence HR
 * has already read changes its wording** — `70 นาที` and `80 นาที` are still
 * those words, and the new form appears only on the distances that were
 * unprintable until now. A cutover at an hour would have reworded live rows to
 * say the same thing differently, which is a change with a cost and no reader.
 */
function gapText(minutes) {
  if (minutes < 120) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ชม. ${rest} นาที` : `${hours} ชม.`;
}

/** The punch closest to `target`, and how far off it is. Null on an empty list. */
function nearest(points, target) {
  let best = null;
  for (const p of points) {
    const diff = Math.abs(p.minutes - target);
    if (!best || diff < best.diff) best = { ...p, diff, late: p.minutes > target };
  }
  return best;
}

/**
 * Check one entry against one person's punches.
 *
 * @param {object} entry     workDate, startTime, endTime, flatDaily
 * @param {Array<{date: string, time: string}>} punches this person's scans; may
 *   cover several days — only the ones inside the window are looked at
 * @param {object} [opts]
 * @param {number} [opts.toleranceMinutes]
 * @returns {{
 *   state: string, flatDaily: boolean, tolerance: number,
 *   startFinding: boolean, endShortMinutes: number, missingScanOut: boolean,
 *   start: object|null, end: object|null, punchCount: number,
 *   dayPunches: Array<{
 *     time: string, checkIn: boolean, early: boolean,
 *   }>,
 * }|null} null when the entry carries no times to compare
 */
export function checkEntryAgainstScans(entry, punches = [], opts = {}) {
  const tolerance = opts.toleranceMinutes ?? SCAN_MATCH_TOLERANCE_MINUTES;
  const overThreshold = opts.overMinutes ?? SCAN_OVER_MINUTES;
  const workDate = entry?.workDate;
  if (!workDate || !entry.startTime || !entry.endTime) return null;

  const startAt = hhmmOf(entry.startTime);
  const endRaw = hhmmOf(entry.endTime);
  if (startAt === null || endRaw === null) return null;
  // No wrap to add since 2026-09-10: the end is a `workDate` minute like the start.
  const endAt = endRaw;
  const flatDaily = Boolean(entry.flatDaily);

  /**
   * HOW NEAR THE CLAIMED START A DOOR EVENT MUST BE TO BE A WITNESS TO IT.
   *
   * ── IT USED TO BOUND THE EVIDENCE TOO, AND THAT HALF IS GONE ────────────
   *
   * It was `quoteWindow`: a punch outside it was not merely unmatched, it was
   * dropped, and the side reported `ไม่มีสแกนใกล้เคียง`. On a row that already
   * prints every scan of the day underneath, that is a screen contradicting
   * itself — `สแกน 07:30 , 22:15` above and "no scan near the end" below, with
   * 22:15 sitting one number outside a bound the reader cannot see.
   *
   * Asked for on 2026-09-07 in the shape the fix takes: **ถ้ามีเวลาสแกนหลายเวลา
   * ให้เอาเวลาที่ใกล้ที่สุดกับเวลาที่ยื่นขอโอทีมา** — so the END now takes the
   * nearest punch of the day however far it is, and the distance is stated in
   * ชม./นาที where it is large (`gapText`). A day whose only scan is the 07:42
   * arrival reads `เวลาสิ้นสุด สแกน 07:42 ก่อนเวลา 11 ชม. 48 นาที`, which is
   * the true sentence and is HR's own third shape: สแกนเข้าแต่ไม่ได้สแกนออก.
   *
   * NO VERDICT MOVED WITH IT. A punch inside the tolerance was inside the old
   * window too, so every row that matched still matches and every row that did
   * not still does not — the change is evidence, not arithmetic.
   *
   * ── THE START KEEPS THE BOUND, AND KEEPS IT FOR THE ORIGINAL REASON ─────
   *
   * Quoting the 07:26 arrival as "the scan nearest your 17:30 start, 604 นาที
   * away" is the noise this window was built against, and on the START that
   * noise is not hypothetical: the morning arrival is on nearly every row. Past
   * this window the start has no witness at all, which is precisely what
   * `alreadyInside` below is the answer to. The END is
   * safe to leave unbounded because it is the one event of an OT day the
   * machine is in a position to record, so a far punch there is a finding
   * rather than a coincidence.
   *
   * Eight tolerances (two hours at the default), and measured PER SIDE rather
   * than across the whole request, so a long request does not widen it. It was
   * `tolerance * 4` until 2026-09-04, when a เหมารายวัน row whose real nearest
   * scan was 21:10 quoted the morning punch instead because 21:10 fell one
   * minute outside — the same failure, one bound further out, which is why the
   * end has no bound left to fall outside of.
   */
  const witnessWindow = tolerance * 8;
  /**
   * `workDate` ITSELF, MIDNIGHT TO MIDNIGHT. It read `entry.endsNextDay ? 2880
   * : 1440` until 2026-09-10, which is how the far side of a wrapped request
   * got onto its own row. No request has a far side now.
   *
   * Punches from the neighbouring dates still arrive (lib/scanMatchQuery.js
   * reads a day either side) and still count as evidence through `quotable`
   * below — they are simply not part of THIS day's list of punches.
   */
  const dayEnd = 1440;
  const points = punches
    .map((p) => ({ date: p.date, time: p.time, minutes: minutesFrom(workDate, p.date, p.time) }))
    .filter((p) => p.minutes !== null)
    .map((p) => ({ ...p, onDay: p.minutes >= 0 && p.minutes < dayEnd }));

  /**
   * NO SCAN AT ALL IS ITS OWN ANSWER and is counted over the whole DAY, not the
   * window: a person with punches on the day but none near this request is a
   * mismatch (the request may be wrong), while a person with no punches at all
   * is a gap in the evidence (the file may be missing, or they may have been at
   * another site). The two ask different things of the reader and must not be
   * printed as one sentence.
   */
  const onDay = points.filter((p) => p.onDay).sort((a, b) => a.minutes - b.minutes);

  /**
   * The punches this row is allowed to NAME, now that distance no longer rules
   * any of them out: the day's own scans, plus anything on the far side of
   * midnight close enough to be the same moment.
   *
   * The second half is what lets a request filed 00:20–03:00 be answered by the
   * previous evening's 23:50 punch. The first half is the bound that replaced
   * the distance one — a sentence may only quote a time the reader can see on
   * the same row, and `dayPunches` is what that row prints (since 2026-09-10 as
   * `เริ่ม … - …`, the arrival named and the rest of the working day listed).
   * Naming a punch from another date would be the wrong-evidence mistake of
   * 2026-09-07 wearing a date the row never shows.
   *
   * The `early` rule below narrows what the row PRINTS without narrowing this,
   * which is why it carries an exception for a punch either side quoted: the
   * bound has to hold in the direction that matters, evidence-on-the-row, and
   * it is `dayPunchLine` that would otherwise break it.
   */
  const quotable = (target) => points.filter((p) => p.onDay
    || Math.abs(p.minutes - target) <= witnessWindow);
  const near = (target) => points.filter((p) => Math.abs(p.minutes - target) <= witnessWindow);

  /**
   * ── EVERY SCAN OF THE DAY, IN CLOCK ORDER ─────────────────────────────────
   *
   * Asked for on 2026-09-04 — *"เอาเวลาที่สแกนเข้าออกตลอดทั้งวันมาโชว์
   * ในแต่ละวัน"* — after the first real month showed why a verdict alone is not
   * enough. That month's rows read `ใบ 17:00–19:30 · สแกน 07:21, 19:30`: people
   * scan twice, arriving and leaving, and **nobody scans at 17:00 when the OT
   * begins**, because 17:00 is the end of the normal shift and not an event at
   * the door. Twenty-five of twenty-seven rows were flagged on a start time the
   * machine had never been in a position to record.
   *
   * So the row carries the EVIDENCE and a person reads it. That is a different
   * kind of answer from a verdict and a better one here: the system is not in a
   * position to know which punch was meant to be which, and printing what the
   * machine actually said costs nothing and assumes nothing.
   *
   * A `next` flag rode on each of them until 2026-09-10, marking a punch from
   * the day AFTER `workDate`. It was reachable only on an overnight request,
   * and there are none: every punch on this list is a `workDate` punch.
   *
   * ── AND ONE OF THEM IS NAMED: เวลาเริ่ม ──────────────────────────────────
   *
   * Since 2026-09-09 the first punch from 04:00 on is flagged `checkIn`, so the
   * row can print `เริ่ม 07:55 - 07:56, 22:56` instead of three times in a row
   * that the reader has to sort into an arrival and the rest. The label read
   * `เข้างาน` and the rest of the line `· สแกน …` until 2026-09-10, when HR
   * asked for the shorter shape. The whole of the reasoning — and the reason it
   * is the only naming this module does — is on `SCAN_CHECK_IN_FLOOR_MINUTES`.
   *
   * IT CARRIED A `< 1440` OF ITS OWN until 2026-09-10, to keep the small hours
   * of an overnight row's SECOND morning from being read as this day's arrival.
   * `onDay` is that bound now and always was for every other row.
   *
   * ── AND THE SMALL HOURS ARE NOT DRAWN AT ALL NOW (2026-09-10) ────────────
   *
   * `early` marks a punch before 04:00 on `workDate`, and `dayPunchLine` leaves
   * it off the line. Asked for in the shape of one row: `เข้างาน 07:23 · สแกน
   * 00:59, 07:55, 17:37, 18:24, 20:11` was to become `เริ่ม 07:23 - 07:55,
   * 17:37, 18:24, 20:11`. The 00:59 is somebody LEAVING the previous evening's
   * OT — the same fact that keeps it from being named เวลาเริ่ม — so on this
   * row it is not evidence, it is the row above's evidence printed on the wrong
   * line, and it pushed the times this row IS about off to the right.
   *
   * **UNLESS THIS ROW QUOTES IT.** A sentence may only quote a time the reader
   * can see on the same row (see `quotable`), and a request filed in the small
   * hours — 00:20–03:00, the case `quotable` exists for — is answered by
   * exactly these punches. So a punch the start or the end side actually took
   * its number from stays on the line however early it is: hiding it would
   * leave the row saying `เวลาเริ่ม สแกน 00:59 ก่อนเวลา 39 นาที` above a list
   * with no 00:59 in it, which is the wrong-evidence failure of 2026-09-04
   * wearing a fresh disguise.
   */
  const checkInPoint = onDay.find((p) => p.minutes >= SCAN_CHECK_IN_FLOOR_MINUTES) || null;

  if (onDay.length === 0) {
    return {
      state: SCAN_MATCH.NO_SCAN,
      flatDaily,
      tolerance,
      overThreshold,
      // Never true here, and stated rather than left off: a day with no punches
      // at all has nothing to say the start was expected or unexpected, and a
      // reader of this object should not have to tell `false` from `undefined`.
      startFinding: false,
      // NOT a shortfall of nought — the day is silent, so how short it ran is
      // unknown and `no_scan` is the answer instead. Same reasoning as the
      // `false` above: a reader of this object should never have to tell a
      // measured zero from a missing one.
      endShortMinutes: 0,
      // Same again on the other side. ไม่ตรง means the day is silent, so it is
      // not known that they did NOT stay late either — `overTime` is false
      // because there is no evidence, not because there was no overrun.
      endOverMinutes: 0,
      overTime: false,
      missingScanOut: false,
      start: null,
      end: null,
      punchCount: 0,
      dayPunches: [],
    };
  }

  /**
   * ── THE START ASKS "IS THIS THE SAME MOMENT", AND THAT IS A DISTANCE ─────
   *
   * A door event fifteen minutes either side of the claimed start is the same
   * trip through the door as far as anybody reconciling a month is concerned.
   * The END does not use this — see `metEnd` — because the question there is
   * not whether two clocks agree but whether the person stayed as long as they
   * said they would.
   */
  const matched = (side) => Boolean(side && side.diff <= tolerance);

  /**
   * ── AND THE END ASKS "DID THEY STAY", WHICH IS A DIRECTION ───────────────
   *
   * `>=`, and no window. A scan-out AT or AFTER the end of the request is the
   * whole of what was asked for — the extra minutes past it are the person's
   * own and are nobody's discrepancy. Anything earlier is เวลาขาด by exactly as
   * many minutes as it is early, with no grace: *ถ้าเวลาไม่ตรงกันขึ้นทุกกรณี*
   * (2026-09-07), which is a deliberate answer to the alternative of letting
   * the 15-minute tolerance rule this side too.
   *
   * It used to be `matched()` on both sides, and that made a 20:40 scan-out on
   * a 20:00 request an amber row — a person being marked for working longer
   * than they claimed.
   */
  const metEnd = (side) => Boolean(side && side.minutes >= endAt);

  /**
   * ── THE END IS READ FIRST, AND IT KEEPS THE PUNCH IT USED ────────────────
   *
   * Otherwise one punch answers for both ends and invents a mismatch out of a
   * row that is fine. A request 17:00–18:30 with the day's last scan at 18:25
   * has an end 5 นาที out — and 18:25 also sits inside the start's quote window
   * (85 นาที of the 120), so the start side would quote the leaving scan as
   * evidence about the arrival and report "หลังเวลา 85 นาที" on a row where
   * nothing is wrong. Same family as the 21:10 bug of 2026-09-04: the wrong
   * evidence is worse than none.
   *
   * UNLESS IT GENUINELY FITS BOTH. A punch inside the tolerance of the start as
   * well is a real match for the start and is left in the pool — on a request
   * short enough for one trip through the door to answer both ends, that is the
   * true reading and not a coincidence.
   *
   * ── WHICH PUNCH IS "THE SCAN-OUT" NOW THAT THE SIDE HAS A DIRECTION ──────
   *
   * The EARLIEST punch at or after the requested end, when there is one, and
   * the day's LAST punch when there is not.
   *
   * Nearest alone was wrong once the rule became directional. A day punching
   * 07:34 · 19:55 · 23:00 against a request ending 20:00 has its nearest punch
   * at 19:55 and would be reported five minutes short — while 23:00 is sitting
   * on the same row saying the person was still here three hours later. The
   * scan-out is 23:00, and the rule *สแกนออกจริง >= เวลาสิ้นสุด OT* answers the
   * row: ครบตามขอ.
   *
   * Where nothing reaches the end, "last" and "nearest" are the same punch —
   * every punch is below the end, so the latest one is the closest to it — so
   * the shortfall is still measured against the best evidence the day has.
   */
  const endCandidates = quotable(endAt);
  const reachedEnd = endCandidates.filter((p) => p.minutes >= endAt);
  const end = reachedEnd.length
    ? nearest(reachedEnd, endAt)
    : nearest(endCandidates, endAt);

  /**
   * ── AND ONLY A PUNCH THAT ACTUALLY ANSWERED THE END IS WITHHELD ──────────
   *
   * ── AND SINCE THE END BECAME DIRECTIONAL, THAT IS EVERY PUNCH IT QUOTES ──
   *
   * The gate used to be `end.diff <= tolerance` — *the end actually matched on
   * it* — and that stopped working the moment a five-minute shortfall became a
   * finding. On a request 17:00–18:30 whose day is 07:42 · 18:25, the end is
   * now 18:25 and five minutes SHORT rather than matched, so the old gate would
   * hand 18:25 back to the start, which sits 85 minutes away and inside the
   * two-hour window: the row would report `เวลาเริ่ม สแกน 18:25 หลังเวลา 1 ชม.
   * 25 นาที` about the person going HOME. That is the 21:10 bug of 2026-09-04
   * exactly — the wrong evidence, which is worse than none.
   *
   * So the rule is now about the ROLE and not about the verdict: whichever
   * punch the end quotes is the day's departure candidate, and a departure is
   * not also an arrival. The one exception is the punch that is genuinely
   * inside the start's tolerance, which on a short request is one trip through
   * the door answering both ends — the true reading, and it stays.
   */
  const startPool = near(startAt).filter((p) => !(end
    && p.date === end.date && p.time === end.time
    && Math.abs(p.minutes - startAt) > tolerance));
  const start = nearest(startPool, startAt);

  /**
   * ── NOBODY SCANS AT 17:00, AND THAT IS NOT A FINDING ─────────────────────
   *
   * Told to us in that shape on 2026-09-04: **most people scan before 08:00,
   * work the shift, and scan once more when the OT is over** — two punches for
   * the whole day. A minority scan at 17:00 as well and again on coming back to
   * start the OT, which is four. Both are normal, and the first is the common
   * one.
   *
   * The machine records a door. At 17:00 the person is already inside — the
   * shift they arrived for merely ended — so on the two-punch day there is no
   * door event to find, and there never was going to be one. Reporting that as
   * `เวลาเริ่ม ไม่มีสแกนใกล้เคียง` is the system marking a row for the reader to
   * check something the reader can already see is fine, on nearly every row of
   * the month: measured at 25 of 27 rows the first time a real month was
   * walked. A warning that is on almost every line is a warning nobody reads,
   * and it takes the true ones down with it.
   *
   * So a start with no punch near it is not a finding when the day has a punch
   * EARLIER than it: that punch is the person already being inside, which is
   * the whole explanation. The verdict then rests on the end — the one event of
   * an OT day the machine is in a position to record.
   *
   * ── AND THE TEST IS DIRECTION, NOT PRESENCE ──────────────────────────────
   *
   * It read `!start && onDay.some(...)` until 2026-09-04 — *no punch near the
   * start at all*, plus one earlier in the day. That is the two-punch day, and
   * on the two-punch day it is right. It silenced nothing on the FOUR-punch
   * day, because there a punch near the start always exists.
   *
   * ฝ่ายบุคคล settled the shape of those extra punches the same day: **พักเที่ยง
   * ไม่ต้องสแกนนิ้ว.** So a day is two punches or it is four, and the middle two
   * are never lunch — they are 17:00 ตอนเลิกงาน and ตอนเข้ามาทำโอที, the two
   * halves of one trip out and back at the shift boundary. Nothing else lands
   * between an arrival and a departure here.
   *
   * Which is what makes the direction readable without an in/out flag. A
   * request filed 18:00–20:00 on that four-punch day quoted `เวลาเริ่ม สแกน
   * 17:35 ก่อนเวลา 25 นาที` — and 17:35 is the person walking back IN. They were
   * inside from 17:35 onward, exactly as the two-punch person is inside from
   * 07:42 onward, and the machine had no more to record at 18:00 than it had at
   * 17:00. Presence could not tell those apart; **which side of the claimed
   * start the punch fell on** can, and it needs nothing the file does not have.
   *
   * WHAT STILL WARNS:
   *   · a punch AFTER the claimed start and outside the tolerance — the 17:22
   *     scan on a request claiming 17:00. The door moved once the OT was
   *     supposed to be running, and that disagrees, so it is quoted.
   *   · a start with nothing before it anywhere in the day — the person has no
   *     arrival on record at all, which is a gap in the evidence rather than
   *     the ordinary shape of one.
   *
   * WHAT NO LONGER WARNS is the third case, and only the third: a punch BEFORE
   * the claimed start, however far before. There is no reading of this
   * workplace on which that punch means the person was outside at the start —
   * and **ไม่มีกะดึก** (ฝ่ายบุคคล, 2026-09-04) closes the one reading that could
   * have: nobody's shift begins in the small hours, so an earlier punch is an
   * arrival or a shift-boundary return and never the start of something else.
   *
   * ── AND IT IS NOT SAID IN A QUIETER VOICE EITHER — 2026-09-09 ────────────
   *
   * There WAS a grey chip here. Asked for on 2026-09-04, hours after the amber
   * one had been taken off the same rows: *"แสดง Badge/Flag Warning … ไม่ได้
   * สแกนเข้า OT เพื่อเตือนว่าไม่มีสแกนเข้าช่วง 17:00 น."* — the fact went back on
   * the row as its own quiet mark, on the reading that "not a finding" and "not
   * worth saying" are different things.
   *
   * ฝ่ายบุคคล withdrew it on 2026-09-09, and the reason is the one that was
   * already written down here: *ไม่ต้องแจ้งเตือนเพราะปกติพนักงานก็ไม่สแกนกันอยู่แล้ว.*
   * The chip landed on 25 rows of 27 — and a mark that is true of nearly every
   * row is not evidence about any row, whatever colour it is drawn in. Grey was
   * an attempt to make a near-universal mark cheap enough to keep; the answer is
   * that it was not worth its column at any price.
   *
   * `missingOtStart`, `MISSING_OT_START` and `showsMissingOtStart` went with
   * it, along with `.chip.scan-noin` — the field existed to feed that chip and
   * nothing else read it. **No verdict, sentence or figure moved**: the silence
   * built above is unchanged, and `startFinding` still decides the whole of
   * what the start says. What is gone is a label, not a comparison. Do not
   * rebuild it without asking; this is the second time these rows have been
   * marked and the second time the mark has come off.
   *
   * THE TOLERANCE IS READ OFF THE REQUEST'S OWN START, not off a fixed 17:00–17:30 window.
   * The helper this was asked for in names those clock times because that is
   * what the shift is, and for a request beginning at 17:00 the two agree. They
   * part on the requests the window cannot see: one filed 18:00–20:00, where
   * 17:00–17:30 is not where its start is, and one whose OT-in scan is at 17:40,
   * where the window says "no scan" while a scan is sitting right there and
   * disagreeing by 40 นาที. The tolerance answers both, and it is the number
   * ฝ่ายบุคคล can still move.
   */
  const alreadyInside = onDay.some((p) => p.minutes < startAt);

  /**
   * ── IS THERE ANYTHING TO SAY ABOUT THE START? ─────────────────────────────
   *
   * The one flag the verdict and the sentence both read, so they cannot come to
   * two different conclusions about one row. Two shapes, and they are the two
   * in WHAT STILL WARNS above: a door event after the claimed start that
   * disagrees, or no arrival on record at all that day.
   *
   * Since 2026-09-09 it is the ONLY thing the start side says: what is left
   * over when it is false — a start with no witness at the door — used to be
   * `missingOtStart` and a grey chip, and is now nothing at all.
   */
  const startFinding = !matched(start)
    && (Boolean(start && start.late) || !alreadyInside);

  /**
   * ── เวลาขาด, AS A NUMBER THE BADGE CAN PRINT ─────────────────────────────
   *
   * *"พร้อมระบุจำนวนนาทีที่ขาด"* (2026-09-07). Nought when the scan-out reached
   * the end, and nought on a day with no punches at all — there the shortfall
   * is not zero, it is unknown, and `no_scan` is the sentence that says so.
   * A component asking "how short" must not be handed a made-up nought, which
   * is why every screen goes through `scanBadgeLabel` rather than this field.
   */
  const endShortMinutes = end && !metEnd(end) ? endAt - end.minutes : 0;

  /**
   * ── สแกนเข้าแต่ไม่ได้สแกนออก — HR'S THIRD SHAPE, MARKED AS ITSELF ────────
   *
   * The row is short by eleven hours because the last thing the machine saw was
   * the person ARRIVING; there was never an exit to be early. Calling that
   * `ไม่ครบ` alone would leave the badge asserting a walk out of the door
   * that the file records nobody taking, so the sentence adds *อาจลืมสแกนออก*
   * and lets the reader see the 07:42 for themselves.
   *
   * The test is the OT's own start, not a clock time: no door event at or after
   * the moment the person says the OT began means no candidate for an exit from
   * it. Named by HR on 2026-09-04 as one of the three shapes a day takes.
   */
  const missingScanOut = endShortMinutes > 0 && !onDay.some((p) => p.minutes >= startAt);

  /**
   * ── เกินเวลา — ขอโอทีมาน้อยกว่าที่ทำจริง ────────────────────────────────
   *
   * The mirror of `endShortMinutes`, and it is NOT a mismatch. HR named it on
   * 2026-09-07 alongside ไม่ครบ and ไม่ตรง, and answered the one question that
   * decides how it is drawn: *ข้อเท็จจริง ป้ายเทา ไม่นับกองที่ต้องตรวจ*. The
   * person worked longer than they claimed; nobody is owed a correction and the
   * company is not out of pocket. The row says what happened and asks nothing.
   *
   * ── WHICH IS WHY `state` DOES NOT MOVE ───────────────────────────────────
   *
   * An overrun row is still `SCAN_MATCH.OK` — `metEnd` is `>=` and stays that
   * way. This was decided earlier the same day and is not being reversed: the
   * VERDICT answers *does somebody have to look at this row*, and the answer
   * is still no. What is new is a MARK beside it, in the quiet tone.
   *
   * `missingOtStart` was the other mark of that shape and was built the same
   * way; it was withdrawn on 2026-09-09 (see the start-side block above) for a
   * reason that does not reach this one — it was true of nearly every row,
   * while an overrun past 30 นาที is true of few, and a mark on few rows is
   * evidence about those rows.
   *
   * ── NEVER BOTH — the rule the withdrawn grey chip followed too ────────────
   *
   * `!startFinding`, so a row that is already asking to be looked at does not
   * also wear a grey chip telling it that looking is optional. Two marks making
   * one statement is what the amber flat-day chip was.
   *
   * `endOverMinutes` is the raw overrun and is reported whatever its size, so a
   * reader of this object can see a 4-minute overrun that no chip is drawn for;
   * `overTime` is the one flag the badge, the sentence and the count all read,
   * so they cannot come to three different answers about one row.
   *
   * ── AND `!flatDaily`, WHICH IS NOT MERELY TIDINESS ───────────────────────
   *
   * A flat day is bought whole and counts eight normal hours however long the
   * person stayed, so *ทำงานเกินเวลาที่ขอ* is not a reading its times support:
   * they never claimed a length. It has said nothing about a late scan-out
   * since the flat rule was written and it goes on saying nothing — this flag
   * is what keeps the new sentence out of `scanMismatchDetail`, which a flat
   * row DOES draw (under its green chip, for the short side).
   */
  const endOverMinutes = metEnd(end) ? end.minutes - endAt : 0;
  const overTime = !flatDaily && !startFinding && endOverMinutes >= overThreshold;

  /**
   * The times the row prints — built HERE, after `start` and `end`, because
   * `early` is the one flag on them that depends on what this row quoted.
   *
   * Date AND time, the same pair `startPool` compares on: `nearest` hands back
   * a COPY carrying `diff`, so `===` against a punch would be false on every
   * row and would quietly drop the very punches the exception exists to keep.
   */
  const quotedHere = (p) => [start, end].some((side) => side
    && side.date === p.date && side.time === p.time);
  const dayPunches = onDay.map((p) => ({
    time: p.time.slice(0, 5),
    checkIn: p === checkInPoint,
    early: p.minutes < SCAN_CHECK_IN_FLOOR_MINUTES && !quotedHere(p),
  }));

  return {
    state: !startFinding && metEnd(end) ? SCAN_MATCH.OK : SCAN_MATCH.MISMATCH,
    flatDaily,
    tolerance,
    overThreshold,
    startFinding,
    endShortMinutes,
    endOverMinutes,
    overTime,
    missingScanOut,
    start: start ? { ...start, matched: matched(start) } : null,
    // `matched` on the end side means REACHED, not "near" — see `metEnd`.
    end: end ? { ...end, matched: metEnd(end) } : null,
    punchCount: onDay.length,
    dayPunches,
  };
}

/**
 * "19:30" — the day's OTHER scans as one line for the row.
 *
 * It read *"07:21, 19:30" — the day's scans as one line* until 2026-09-09,
 * when the first punch from 04:00 on was pulled out of the list and printed
 * under its own name (`scanCheckInTime`). The list is what is LEFT, and on the
 * ordinary two-punch day that is the single evening time. The two are drawn
 * side by side on one line, `เริ่ม 07:21 - 19:30`.
 *
 * The separator lost its leading space on 2026-09-07, to the shape the line was
 * asked for in: *แสดงเวลาสแกนนิ้วทั้งหมดของวันนั้นเสมอ เช่น "สแกน 07:34, 19:30"*.
 * It is an ordinary Thai list now rather than a machine listing.
 *
 * ── AND IT IS NO LONGER EVERY OTHER PUNCH (2026-09-10) ─────────────────────
 *
 * `early` punches — before 04:00 on `workDate`, and not quoted by this row's
 * own finding — are left off. It read *Nothing was dropped* here until then,
 * and that is the sentence this paragraph replaces: a 00:59 on a row whose OT
 * ran in the evening is the previous night's departure, and it was pushing the
 * times the row is actually about off to the right. The rule, the exception
 * that keeps a quoted punch on the line, and the reason both exist are on
 * `early` in `checkEntryAgainstScans`.
 *
 * `(+1)` STOOD ON A PUNCH FROM THE MORNING AFTER `workDate`, because on a
 * wrapped request such a punch belonged to the row while a bare `02:04` among
 * evening times read as the small hours of the wrong morning. Nothing wraps
 * since 2026-09-10, so no punch from another date reaches this line at all and
 * every time on it is a `workDate` time.
 *
 * WHAT IT STILL DOES NOT DO IS SAY WHICH IS WHICH. The machines write no in/out
 * flag, so what is left after the arrival is a list of times and never
 * "ออก 19:30" — the reader can see what an evening time on an OT row means, and
 * the system is not in a position to assert it. The one naming this module does
 * is the arrival, and only from 04:00 on; see `SCAN_CHECK_IN_FLOOR_MINUTES`.
 */
export function dayPunchLine(check) {
  const rest = (check?.dayPunches || []).filter((p) => !p.checkIn && !p.early);
  if (!rest.length) return null;
  return rest.map((p) => p.time).join(', ');
}

/**
 * `'07:55'` — the day's เวลาเริ่ม, or null when no punch fell on or after
 * 04:00 on `workDate`.
 *
 * The one time on this row the system is willing to call an arrival, drawn on
 * the row beside `dayPunchLine` and never instead of it: the label and the
 * remaining times are two halves of one line, and a screen that printed the
 * label alone would be hiding the evidence the naming should be checked
 * against. See `SCAN_CHECK_IN_FLOOR_MINUTES`.
 */
export function scanCheckInTime(check) {
  return check?.dayPunches?.find((p) => p.checkIn)?.time || null;
}

/**
 * The finding as one sentence, or null when there is nothing to say.
 *
 * ── เหมารายวัน IS NOT A WARNING, AND THIS IS THE SECOND ANSWER ─────────────
 *
 * The first reading of the ask (2026-09-04) was *warn, but label it* — and the
 * follow-up the same day settled it the other way: **ถ้าติ๊กเหมารายวัน เวลาสแกน
 * ไม่ตรงไม่เป็นไร แต่ต้องมีแจ้งเตือนว่าเขาเหมารายวัน.** A flat day is bought
 * whole; the day is eight NORMAL hours however long the person stayed and no OT
 * at all, so the times on the request are not a claim the machine can
 * contradict. What HR need on that
 * row is not "look at this", it is "this one was filed flat" — a fact, in the
 * colour of a fact.
 *
 * The words follow. A flat row's sentence LEADS with the flat-day rule and says
 * the difference is normal; the ordinary row's leads with เวลาไม่ตรง. Both end
 * in the same `scanMismatchDetail` so the numbers are stated once.
 *
 * Getting this wrong in the first direction is not a small thing: an amber mark
 * on a row where there is nothing to find is what teaches a reader to stop
 * opening the amber marks that are not nothing.
 */
export function scanMismatchNote(check) {
  const detail = scanMismatchDetail(check);
  if (detail === null) return null;

  /**
   * ── A FLAT DAY REACHES HERE WITH NOTHING TO SAY, AND THAT IS THE POINT ────
   *
   * `scanMismatchDetail` returns null for it since 2026-09-07, so this function
   * has already returned above. The branch that used to sit here read
   *
   *     ใบนี้เป็นใบเหมารายวัน — นับ 8 ชั่วโมงปกติ ไม่คิดชั่วโมง OT ไม่ว่าจะ
   *     สแกนไว้อย่างไรหรือไม่ได้สแกนเลย · เวลาสิ้นสุด สแกน 15:40 · ขาดอีก
   *     80 นาที (ไม่ต้องแก้)
   *
   * — a sentence that spends its first half saying the times cannot be wrong
   * and its second half saying by how much they are wrong. **ให้ลบข้อความ
   * คำนวณเวลาขาดออกทั้งหมด ไม่ต้องนำมาต่อท้ายอีก เพราะพนักงานเหมาได้ 8 ชั่วโมง
   * เต็มเสมอ ไม่มีการตัดเวลา** (2026-09-07). What is left is `FLAT_DAILY_SAY`,
   * drawn by `FlatDailyMark` — one fact, one sentence.
   */
  if (check.state === SCAN_MATCH.NO_SCAN) return detail;
  /**
   * เกินเวลา LEADS WITH THE FACT, NOT WITH เวลาไม่ตรง. The framing sentence
   * below is the one that means *go and look at this*; an overrun is a row
   * where the person did more than they asked for and there is nothing to fix,
   * so it gets the flat-day treatment — say what it is, in its own words.
   */
  if (check.overTime) return `ทำงานเกินเวลาที่ขอ OT มา — ${detail}`;
  return `เวลาไม่ตรงกับไฟล์สแกนนิ้ว — ${detail}`;
}

/**
 * The same finding WITHOUT the framing — just which side is off and by how far.
 *
 * ── WHY IT IS SEPARATE FROM THE SENTENCE ABOVE ─────────────────────────────
 *
 * Because the row draws both, in two places, and only one of them is reachable
 * on a phone. The chip carries the verdict and the `title` carries the whole
 * sentence — and a `title` is a HOVER, which a finger does not have. So the
 * numbers that make the warning actionable ("อีก 40 นาที", not merely "ไม่ตรง")
 * are printed as a line under the chip as well, where every reader has them.
 *
 * The two must not be assembled independently in the component: one comparison,
 * one set of words, so the line under the chip and the tooltip over it can never
 * describe different findings.
 */
export function scanMismatchDetail(check) {
  if (!check) return null;

  /**
   * ── เหมารายวัน SAYS NOTHING HERE, IN ANY OF ITS SHAPES ───────────────────
   *
   * **2026-09-07, and it is a bug report rather than a preference:** a row that
   * had already said *นับ 8 ชั่วโมงปกติ ไม่คิดชั่วโมง OT* went on to print
   * `ขาดอีก 80 นาที` underneath it. Two statements that contradict each other
   * on one line — the first says the times on this request are not a claim the
   * machine can be short against, and the second measures a shortfall against
   * them anyway. **ไม่มีการตัดเวลา** is the whole of the rule: the day was
   * bought whole and its eight hours are not reduced by anything a scanner
   * recorded, so there is no shortfall to state and stating one only invites
   * somebody to go and fix a row with nothing in it.
   *
   * FIRST, ABOVE `no_scan` AND ABOVE เกินเวลา. HR named the three shapes a flat
   * day takes — ไม่ได้สแกนนิ้ว · สแกนออกก่อนเวลา · สแกนเข้าแต่ไม่ได้สแกนออก —
   * and the answer to all three is the same eight hours; an overrun is a fourth
   * and gets the same silence, since a day that never claimed a length cannot
   * be exceeded either. Returning null HERE is what makes that true of every
   * screen at once: `scanMismatchNote` is built on this, `FlatDailyMark` draws
   * `FLAT_DAILY_SAY` alone, and `scanBadgeLabel` already refused flat rows. The
   * row still prints the day's punches — evidence is not a warning, and reading
   * them is how anybody would check the filing themselves.
   *
   * ── AND IT ANSWERS THE 08:00–17:00 ROW TOO ───────────────────────────────
   *
   * The other half of the same report: *"ช่วง 08:00–17:00 ในวันทำงานปกติ … ให้
   * ซ่อน Warning การสแกนออกก่อนเวลาของ OT ทั้งหมด"*. Such a row can only be a
   * flat day — `zeroOtHoursAllowed` in lib/entries.js refuses to store any
   * OTHER request that computes to no OT hours, and a เหมารายวัน filed at 08:00
   * ends at 17:00 because the form adds the nine-hour span itself. So the gate
   * above is that gate: no OT claimed, nothing to be short of, nothing said.
   */
  if (check.flatDaily) return null;

  if (check.state === SCAN_MATCH.NO_SCAN) return 'ไม่มีข้อมูลสแกนของวันนี้';
  /**
   * ── THE เกินเวลา LINE, AND WHAT IT HAS TO SAY THAT THE CHIP CANNOT ───────
   *
   * The chip says เกินเวลา · เกิน 30 นาที. The thing a reader will want to know
   * next is whether those thirty minutes got paid, and the answer is no — the
   * hours on this row are the hours on the REQUEST, and no scan file has ever
   * moved a figure in this system. Said here rather than left to be inferred,
   * because "the machine saw more than the paper" reads like an amount owed
   * unless somebody says otherwise.
   *
   * Filed as an OT-block overrun, so the ทำ OT เพิ่ม it names is real: below
   * `SCAN_OVER_MINUTES` there is no chip and no line at all.
   */
  if (check.overTime) {
    return `เวลาสิ้นสุด สแกน ${check.end.time.slice(0, 5)}`
      + ` · หลังเวลาที่ขอ ${gapText(check.endOverMinutes)}`
      + ' — ชั่วโมงคิดตามใบที่ยื่น ไม่ได้บวกเพิ่มให้';
  }
  if (check.state === SCAN_MATCH.OK) return null;

  /**
   * ── ก่อน / หลัง, AND WHY IT IS NOT เข้า / ออก ────────────────────────────
   *
   * HR named the three shapes a flat day takes on 2026-09-04: ไม่ได้สแกนนิ้ว,
   * สแกนออกก่อนเวลา, สแกนเข้าแต่ไม่ได้สแกนออก. All three are readable here —
   * but only as DIRECTIONS ON A CLOCK, never as in and out.
   *
   * The machines write no in/out flag (src/models/ScanPunch.js), so "สแกนออก
   * ก่อนเวลา 40 นาที" would be this module inventing the one field the file
   * does not have. `ก่อนเวลา` / `หลังเวลา` says the same useful thing — which
   * side of the claimed time the scan fell on — and claims nothing about which
   * way the person was walking. A reader looking at เวลาสิ้นสุด · สแกน 16:20
   * ก่อนเวลา 40 นาที has exactly the fact they need, and the system has not
   * asserted anything it cannot know.
   *
   * HR's third shape — สแกนเข้าแต่ไม่ได้สแกนออก — reads as a distance now
   * rather than as an absence: `เวลาสิ้นสุด สแกน 07:58 ก่อนเวลา 9 ชม. 2 นาที`.
   * Until 2026-09-07 it said `ไม่มีสแกนใกล้เคียง`, which was true and told the
   * reader nothing they could act on; the arrival time IS the finding there.
   *
   * `ไม่มีสแกนใกล้เคียง` survives for a side with no punch to name at all,
   * which after the unbounded end can only be the START — the two-hour window
   * came up empty and the day has no arrival before it either. That is the one
   * place the words are still the whole truth.
   */
  const side = (label, s) => {
    if (!s) return `${label} ไม่มีสแกนใกล้เคียง`;
    if (s.matched) return null;
    return `${label} สแกน ${s.time.slice(0, 5)} ${s.late ? 'หลังเวลา' : 'ก่อนเวลา'} ${gapText(s.diff)}`;
  };

  /**
   * ── THE END SIDE SAYS HOW MUCH IS MISSING, NOT MERELY HOW FAR OFF ────────
   *
   * A punch at or after the requested end has `matched` true and this returns
   * null: there is no such thing as an end that is off by being too late any
   * more (2026-09-07). So the only sentence left on this side is a shortfall,
   * and it is worded as one — *ขาดอีก 40 นาที* — because that is the number the
   * reader is being asked to do something about.
   *
   * The scan itself is still quoted in the neutral voice: `สแกน 18:50` and
   * never `สแกนออก 18:50`. The badge above the line carries HR's own wording;
   * this line carries what the machine actually recorded, so a reader who
   * thinks the badge has misread the day can see why.
   */
  const endSide = () => {
    const s = check.end;
    if (!s) return 'เวลาสิ้นสุด ไม่มีสแกนใกล้เคียง';
    if (s.matched) return null;
    return `เวลาสิ้นสุด สแกน ${s.time.slice(0, 5)} · ขาดอีก ${gapText(s.diff)}`
      + (check.missingScanOut ? ' — อาจลืมสแกนออก' : '');
  };
  /**
   * ── AND THE START IS SIMPLY NOT MENTIONED ON THE ORDINARY DAY ────────────
   *
   * The person was already inside when the OT began, so the machine had no door
   * event to record and the absence of one says nothing. Printing `เวลาเริ่ม
   * ไม่มีสแกนใกล้เคียง` there would put the sentence back on the row the verdict
   * has just stopped marking, which is the same noise one layer down. What is
   * left is the end, which is the half a reader can act on.
   *
   * It read `check.missingOtStart ? null : …` until 2026-09-04 (that field was
   * itself withdrawn on 2026-09-09 and is gone from this module). The gate is
   * `startFinding` now — the same flag the verdict uses, rather than its
   * leftover — because the two stopped being each other's negation when the
   * four-punch day got its silence: a start quoting 17:35 against an 18:00
   * request is neither a finding nor a match, and under the old gate the
   * sentence would have gone back on a row the verdict calls fine. One
   * comparison, one set of words. See `checkEntryAgainstScans`.
   */
  return [
    check.startFinding ? side('เวลาเริ่ม', check.start) : null,
    endSide(),
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The badge's own words — which chip this row wears, and null for a row that
 * wears none.
 *
 * ── ONE FUNCTION SO THE FOUR SHAPES CANNOT DRIFT APART ─────────────────────
 *
 * Asked for as three cases on 2026-09-07 — ครบตามขอ (nothing), เวลาขาด (with
 * the minutes in it), ไม่มีสแกน — and HR's own three words arrived later the
 * same day and added เกินเวลา. They are four readings of one comparison, so
 * they are decided in one place; `components/common.jsx` chose between them
 * with an inline ternary on `state` until then, which was fine while there
 * were two.
 *
 * **THEY ARE NOT ALL THE SAME COLOUR, and this function does not say which is
 * which.** ไม่ครบ and เวลาเริ่มไม่ตรงกับสแกน are errands and wear amber; ไม่ตรง
 * and เกินเวลา are facts and wear grey (*ข้อเท็จจริง ป้ายเทา ไม่นับกองที่ต้อง
 * ตรวจ*, 2026-09-07). The row reads that off `state` and `overTime`, which are
 * the same two fields this function reads — so the words and the colour cannot
 * disagree about which kind of thing a row is.
 *
 * **A flat day gets none of them.** `FlatDailyMark` has that row, in green, and
 * a chip beside it would ask somebody to look at a day that was bought whole —
 * see `scanMismatchNote`.
 *
 * THE MINUTES ARE IN THE LABEL, not only in the line under it. The line under
 * the chip is a second row of text a phone reader scrolls past; *"พร้อมระบุ
 * จำนวนนาทีที่ขาด"* asked for the number where the warning is, so the badge
 * itself reads `ไม่ครบ · ขาด 40 นาที` and is legible on its own.
 */
export function scanBadgeLabel(check) {
  if (!check || check.flatDaily) return null;
  if (check.state === SCAN_MATCH.NO_SCAN) return SCAN_BADGE.NO_SCAN;
  /**
   * เกินเวลา IS READ BEFORE THE `OK` GATE, and that is the whole of what the
   * 2026-09-07 addition changed here. Every other badge is a reading of a
   * MISMATCH; this one is a reading of a row the verdict passed. The gate used
   * to be the first line of this function, which is why it now sits below.
   */
  if (check.overTime) {
    return `${SCAN_BADGE.OVER} · เกิน ${gapText(check.endOverMinutes)}`;
  }
  if (check.state === SCAN_MATCH.OK) return null;
  if (check.endShortMinutes > 0) {
    return `${SCAN_BADGE.SHORT} · ขาด ${gapText(check.endShortMinutes)}`;
  }
  /**
   * What is left is a start the machine actively disagrees with — a door event
   * after the OT was supposed to have begun. Nothing about the END of this row
   * is wrong, so it must not be called ไม่ครบ, and it is not ไม่ตรง either:
   * that word now means the day has no scan at all. It keeps its own name.
   */
  return SCAN_BADGE.START_OFF;
}

/**
 * The month's rows, sorted into the two piles HR asked to be able to tell apart.
 *
 * ── WHY A COUNT AND NOT JUST THE CHIPS ─────────────────────────────────────
 *
 * *"แจ้งเตือนเพื่อให้ HR แยกออกระหว่างงานเหมากับเวลาไม่ตรงงานปกติ"* — the chips
 * separate the two ROW BY ROW, in colour. This separates them for the MONTH, in
 * a number, above the table: how many rows actually need a look, and how many
 * are flat days that never did. Somebody scrolling a thirty-row month should
 * not have to count green pills to answer that.
 *
 * **A flat day is never counted as a warning**, whatever its scan verdict — it
 * goes in its own pile and leaves the other two. That is the whole separation,
 * expressed as arithmetic rather than as a colour.
 */
export function summariseScanChecks(entries = []) {
  const counts = {
    mismatch: 0, short: 0, startOff: 0, noScan: 0, flatDaily: 0, checked: 0, overTime: 0,
  };
  for (const entry of entries) {
    if (entry?.flatDaily) { counts.flatDaily += 1; continue; }
    const check = entry?.scanCheck;
    if (!check) continue;
    counts.checked += 1;
    if (check.state === SCAN_MATCH.MISMATCH) {
      counts.mismatch += 1;
      /**
       * ── AND THE WARNING PILE IS SPLIT BY ITS OWN TWO BADGES ───────────────
       *
       * `mismatch` is still the whole of "rows somebody has to look at", and
       * every caller that only wants that number goes on reading it. What is
       * new on 2026-09-07 is that the pile holds TWO shapes with two different
       * names — **ไม่ครบ** and **เวลาเริ่มไม่ตรงกับสแกน** — so a card printing
       * `2 แถวไม่ครบ` over one of each was naming the pile after half of it.
       * Caught by walking the built app, not by a test: the arithmetic was
       * right and the sentence was wrong.
       *
       * The split is `endShortMinutes`, which is the same thing
       * `scanBadgeLabel` chooses between the two badges on, so a count and a
       * chip cannot disagree about which shape a row is.
       */
      if (check.endShortMinutes > 0) counts.short += 1;
      else counts.startOff += 1;
    } else if (check.state === SCAN_MATCH.NO_SCAN) counts.noScan += 1;
    /**
     * ── เกินเวลา IS ITS OWN PILE AND NOT PART OF `mismatch` ────────────────
     *
     * *ข้อเท็จจริง ป้ายเทา ไม่นับกองที่ต้องตรวจ* (2026-09-07). It is counted
     * ALONGSIDE the verdict rather than instead of it — an overrun row is
     * `SCAN_MATCH.OK`, so this `if` can never double-count with the two above,
     * and the tally still adds up to `checked` with `overTime` sitting across
     * the OK rows rather than inside the warning ones.
     *
     * The same reasoning as `flatDaily`: a screen that folds facts into the
     * errand count is a screen whose errand count nobody trusts.
     */
    if (check.overTime) counts.overTime += 1;
  }
  return counts;
}

/**
 * The same tally, **per person** — the answer to "ดูตรงไหน".
 *
 * ── WHY A NAMED LIST AND NOT JUST A NUMBER ─────────────────────────────────
 *
 * The comparison lives one click deep, on ดู / แก้ไขรายการ, and a month's
 * totals on the card above the table say a month HAS mismatches without saying
 * whose. That leaves a reader opening people one at a time to find them, which
 * on a roster of a hundred and sixty is not a thing anybody will do — so the
 * feature would be there and go unread.
 *
 * This turns the number into a route: the card names the people, the reader
 * presses that person's ดู / แก้ไขรายการ in the table below, and the rows are
 * marked when they get there.
 *
 * **Only the people with something to look at.** Somebody whose month agrees
 * with the machine is not on this list, and neither is a person whose only
 * flagged rows are flat days — a flat day is a fact, not an errand, and putting
 * its owner on a list of people to check is the same mistake as the amber chip
 * was. `flatDaily` is counted per person so the card can say a month is all
 * flat days rather than silently showing nothing.
 *
 * Ordered by how much there is to look at, then by code, so the order is stable
 * between two loads of one month.
 */
export function groupScanChecksByPerson(entries = []) {
  const people = new Map();
  for (const entry of entries) {
    const employee = entry?.employee;
    if (!employee) continue;
    const id = String(employee._id ?? employee);
    if (!people.has(id)) {
      people.set(id, {
        id,
        code: employee.code || '',
        name: employee.name || '',
        mismatch: 0,
        noScan: 0,
        flatDaily: 0,
      });
    }
    const row = people.get(id);
    if (entry.flatDaily) { row.flatDaily += 1; continue; }
    const check = entry.scanCheck;
    if (!check) continue;
    if (check.state === SCAN_MATCH.MISMATCH) row.mismatch += 1;
    else if (check.state === SCAN_MATCH.NO_SCAN) row.noScan += 1;
  }

  return [...people.values()]
    .filter((p) => p.mismatch > 0 || p.noScan > 0)
    .sort((a, b) => (b.mismatch - a.mismatch)
      || (b.noScan - a.noScan)
      || a.code.localeCompare(b.code));
}
