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
 * Two instants: the START the request claims and the END. Each is matched
 * against the NEAREST punch, and a side with no punch within
 * `SCAN_MATCH_TOLERANCE_MINUTES` is reported with the nearest one quoted, so
 * the reader is told "อีก 40 นาที" rather than only "ไม่ตรง".
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
 * How far a scan may sit from a claimed time and still be called the same
 * moment. **15 นาที.**
 *
 * ── [OPEN] THIS NUMBER IS OURS, NOT HR'S ────────────────────────────────────
 *
 * Nobody has been asked. Fifteen is chosen from the two facts available: a
 * person walks to the door and back, and the OT arithmetic already refuses
 * anything under a 30-minute block (`floor/30`), so a tolerance at half a block
 * cannot make a difference that the hours themselves would notice. It is
 * deliberately NOT in `Setting.policy`: a value in there mints a policy version
 * and gets stamped onto entries, and this decides nothing about pay — it
 * decides how loud a screen is. The same call รูปแบบวันที่ใน CSV made
 * (that setting was itself withdrawn on 2026-09-04; the reasoning is what is
 * being borrowed here, not the field).
 *
 * IF IT IS WRONG THE FEATURE IS NOISE, which is the reason it is stated on the
 * screen beside the warning rather than buried here: a reader who thinks 15 is
 * too tight can say so, and that conversation is the point. Ask HR.
 */
export const SCAN_MATCH_TOLERANCE_MINUTES = 15;

/** The verdicts. `no_scan` is not a mismatch, and the screens must not merge them. */
export const SCAN_MATCH = Object.freeze({
  /** Both ends have a scan within the tolerance. */
  OK: 'ok',
  /** At least one end does not. THE ONLY ONE THAT WARNS. */
  MISMATCH: 'mismatch',
  /** This person has no scans at all on this day — a gap in the evidence. */
  NO_SCAN: 'no_scan',
});

/**
 * Minutes from midnight of `workDate`, so an overnight request and the punches
 * on the far side of it are on ONE number line.
 *
 * An entry ending 02:00 next day is minute 1560, and a punch at 02:04 on the
 * following date is 1564 — four apart, which is what they are. Comparing the
 * clock faces would make them 1436 apart and every overnight row a mismatch.
 */
function minutesFrom(workDate, date, time) {
  const minutes = hhmmOf(time);
  if (minutes === null) return null;
  return (dayNumber(date) - dayNumber(workDate)) * 1440 + minutes;
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
 * @param {object} entry     workDate, startTime, endTime, endsNextDay, flatDaily
 * @param {Array<{date: string, time: string}>} punches this person's scans; may
 *   cover several days — only the ones inside the window are looked at
 * @param {object} [opts]
 * @param {number} [opts.toleranceMinutes]
 * @returns {{
 *   state: string, flatDaily: boolean, tolerance: number, missingOtStart: boolean,
 *   start: object|null, end: object|null, punchCount: number,
 * }|null} null when the entry carries no times to compare
 */
export function checkEntryAgainstScans(entry, punches = [], opts = {}) {
  const tolerance = opts.toleranceMinutes ?? SCAN_MATCH_TOLERANCE_MINUTES;
  const workDate = entry?.workDate;
  if (!workDate || !entry.startTime || !entry.endTime) return null;

  const startAt = hhmmOf(entry.startTime);
  const endRaw = hhmmOf(entry.endTime);
  if (startAt === null || endRaw === null) return null;
  const endAt = endRaw + (entry.endsNextDay ? 1440 : 0);
  const flatDaily = Boolean(entry.flatDaily);

  /**
   * HOW FAR A SCAN MAY BE AND STILL BE WORTH QUOTING.
   *
   * ── IT DOES NOT DECIDE ANYTHING, AND THAT IS THE POINT ──────────────────
   *
   * Whether a side MATCHES needs no window at all: a punch inside the
   * tolerance is inside any window wider than the tolerance. This only governs
   * which punch gets named in the sentence when a side does not match.
   *
   * There has to be a bound, because the alternative is quoting the 07:26
   * arrival as "the scan nearest your 17:30 start, 604 นาที away" — a number
   * that answers nothing and makes the warning read as broken. Past this the
   * sentence says ไม่มีสแกนใกล้เคียง instead, which is the true statement.
   *
   * ── AND IT WAS TOO TIGHT, WHICH IS WHY IT IS SEPARATE NOW ───────────────
   *
   * It was `tolerance * 4` measured from the request's own ENDS — 21:00 for a
   * request finishing at 20:00. Found by walking a built app on 2026-09-04: a
   * เหมารายวัน row whose real nearest scan was 21:10 (70 นาที out) reported
   * "17:29 อยู่ 151 นาที" instead, because 21:10 fell one minute outside the
   * bound and the morning-side punch was all that was left inside it. The
   * warning was RIGHT — the row does not match — and the evidence it offered
   * was the wrong evidence, which is worse than none: a reader checks 17:29,
   * finds it is the start-of-OT scan, and concludes the feature is confused.
   *
   * Eight tolerances (two hours at the default), and measured PER SIDE rather
   * than across the whole request, so a long request does not widen it.
   */
  const quoteWindow = tolerance * 8;
  const points = punches
    .map((p) => ({ date: p.date, time: p.time, minutes: minutesFrom(workDate, p.date, p.time) }))
    .filter((p) => p.minutes !== null);
  const near = (target) => points.filter((p) => Math.abs(p.minutes - target) <= quoteWindow);

  /**
   * NO SCAN AT ALL IS ITS OWN ANSWER and is counted over the whole DAY, not the
   * window: a person with punches on the day but none near this request is a
   * mismatch (the request may be wrong), while a person with no punches at all
   * is a gap in the evidence (the file may be missing, or they may have been at
   * another site). The two ask different things of the reader and must not be
   * printed as one sentence.
   */
  const onDay = punches
    .map((p) => ({ ...p, minutes: minutesFrom(workDate, p.date, p.time) }))
    .filter((p) => p.minutes !== null && p.minutes >= 0
      && p.minutes < (entry.endsNextDay ? 2880 : 1440))
    .sort((a, b) => a.minutes - b.minutes);

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
   * `next` marks a punch that fell on the day AFTER `workDate` — only reachable
   * on an overnight request, where the 02:04 belongs to this row but not to
   * this date, and a bare "02:04" among a list of evening times would read as
   * the small hours of the wrong morning.
   */
  const dayPunches = onDay.map((p) => ({
    time: p.time.slice(0, 5),
    next: p.minutes >= 1440,
  }));

  if (onDay.length === 0) {
    return {
      state: SCAN_MATCH.NO_SCAN,
      flatDaily,
      tolerance,
      // Never true here, and stated rather than left off: a day with no punches
      // at all has nothing to say the start was expected or unexpected, and a
      // reader of this object should not have to tell `false` from `undefined`.
      missingOtStart: false,
      start: null,
      end: null,
      punchCount: 0,
      dayPunches: [],
    };
  }

  const matched = (side) => Boolean(side && side.diff <= tolerance);

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
   */
  const end = nearest(near(endAt), endAt);
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
   * So a start with **no punch near it at all** is not a finding when the day
   * has a punch EARLIER than it: that punch is the person already being inside,
   * which is the whole explanation. The verdict then rests on the end — the one
   * event of an OT day the machine is in a position to record.
   *
   * WHAT STILL WARNS, and both were asked for:
   *   · a punch that IS near the start but outside the tolerance — the 17:22
   *     leaving-scan on a request claiming 17:00. Something happened at the
   *     door near the claimed time and it disagrees, so it is quoted.
   *   · a start with nothing before it — the person has no arrival on record at
   *     all that day, which is a gap in the evidence rather than the ordinary
   *     shape of one.
   *
   * ── NOT A FINDING IS NOT THE SAME AS NOT WORTH SAYING ────────────────────
   *
   * Asked for later on 2026-09-04, after the silence had been built: *"แสดง
   * Badge/Flag Warning … ไม่ได้สแกนเข้า OT เพื่อเตือนว่าไม่มีสแกนเข้าช่วง 17:00
   * น."* — so the fact goes back on the row, and it goes back **as its own
   * mark, not as the amber verdict.**
   *
   * That distinction is the whole of what was learnt here. `เวลาไม่ตรงกับสแกน`
   * means *go and check this row*; on the two-punch day there is nothing to
   * check, which is why it was taken off. `ไม่ได้สแกนเข้า OT` means *the start
   * of this OT has no witness at the door* — true, useful, and on most rows of
   * the month, so it is drawn in the quiet tone a fact gets rather than the one
   * an errand gets. See `.chip.scan-noin` in app/styles.css.
   *
   * `missingOtStart` is on the check rather than worked out again in a
   * component, so the verdict, the sentence and the chip cannot disagree about
   * which rows have a start worth mentioning.
   *
   * IT IS READ OFF THE REQUEST'S OWN START, not off a fixed 17:00–17:30 window.
   * The helper this was asked for in names those clock times because that is
   * what the shift is, and for a request beginning at 17:00 the two agree. They
   * part on the requests the window cannot see: one filed 18:00–20:00, where
   * 17:00–17:30 is not where its start is, and one whose OT-in scan is at 17:40,
   * where the window says "no scan" while a scan is sitting right there and
   * disagreeing by 40 นาที. The tolerance answers both, and it is the number
   * ฝ่ายบุคคล can still move.
   */
  const missingOtStart = !start && onDay.some((p) => p.minutes < startAt);

  return {
    state: (matched(start) || missingOtStart) && matched(end)
      ? SCAN_MATCH.OK
      : SCAN_MATCH.MISMATCH,
    flatDaily,
    tolerance,
    missingOtStart,
    start: start ? { ...start, matched: matched(start) } : null,
    end: end ? { ...end, matched: matched(end) } : null,
    punchCount: onDay.length,
    dayPunches,
  };
}

/**
 * "07:21 , 19:30" — the day's scans as one line for the row.
 *
 * A punch on the morning AFTER `workDate` is marked `(+1)`: on an overnight
 * request it belongs to this row but not to this date, and a bare `02:04` in a
 * list of evening times reads as the small hours of the wrong morning.
 *
 * WHAT IT DOES NOT DO IS SAY WHICH IS WHICH. The machines write no in/out flag,
 * so this is a list of times and never "เข้า 07:21 ออก 19:30" — the reader can
 * see what a list of two morning-and-evening times means, and the system is not
 * in a position to assert it.
 */
export function dayPunchLine(check) {
  if (!check?.dayPunches?.length) return null;
  return check.dayPunches.map((p) => `${p.time}${p.next ? ' (+1)' : ''}`).join(' , ');
}

/**
 * ไม่ได้สแกนเข้า OT — the chip's five words, and the sentence behind it.
 *
 * Two strings and not one because the row draws both: a pill has room for a
 * label and a `title` has room for the reason. Written here beside the flag
 * they describe, for the reason every other wording in this module is —
 * a fact that is worded twice is a fact that gets corrected once.
 *
 * `SAY` is deliberate about the two halves a reader needs in the same breath:
 * what is missing, and that it is normal. Without the second half a grey chip
 * on twenty-five rows of twenty-seven reads as twenty-five things to do.
 */
export const MISSING_OT_START = Object.freeze({
  LABEL: 'ไม่ได้สแกนเข้า OT',
  SAY: 'ไม่มีสแกนใกล้เวลาเริ่ม OT — ปกติของที่นี่ เพราะ 17:00 คนอยู่ในโรงงานอยู่แล้ว'
    + ' ไม่ได้แตะประตู · เวลาที่ใช้เทียบคือสแกนตอนเลิก OT',
});

/**
 * Should the row wear that chip?
 *
 * **Never on a เหมารายวัน row.** The day was bought whole, so which door events
 * it has is not a question anybody is asking of it — and the green chip is
 * already the row's answer. A second mark there would be the amber mistake of
 * 2026-09-04 repeated in grey: a mark on a row with nothing in it.
 *
 * **Never on a `no_scan` row either.** "No scan at the OT start" is not a fact
 * about a day with no scans at all; the quiet `ไม่มีข้อมูลสแกน` chip says the
 * whole of that, and two grey chips on one row would split one statement in
 * half.
 */
export function showsMissingOtStart(check) {
  return Boolean(check?.missingOtStart) && !check.flatDaily
    && check.state !== SCAN_MATCH.NO_SCAN;
}

/**
 * The finding as one sentence, or null when there is nothing to say.
 *
 * ── เหมารายวัน IS NOT A WARNING, AND THIS IS THE SECOND ANSWER ─────────────
 *
 * The first reading of the ask (2026-09-04) was *warn, but label it* — and the
 * follow-up the same day settled it the other way: **ถ้าติ๊กเหมารายวัน เวลาสแกน
 * ไม่ตรงไม่เป็นไร แต่ต้องมีแจ้งเตือนว่าเขาเหมารายวัน.** A flat day is bought
 * whole; the hours are eight however long the person stayed, so the times on
 * the request are not a claim the machine can contradict. What HR need on that
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
   * ── ALL THREE SHAPES OF A FLAT DAY READ THE SAME WAY: FINE ────────────────
   *
   * HR named them on 2026-09-04 — ไม่ได้สแกนนิ้ว, สแกนออกก่อนเวลา, สแกนเข้าแต่
   * ไม่ได้สแกนออก — and the answer to all three is the same: **the sheet still
   * gets its eight hours** and nobody has to do anything. Not scanning at all
   * is a *kind* of flat day, not a gap in a flat day, so `no_scan` gets the
   * reassurance too. Leaving it off there was the one place this sentence still
   * read as a problem.
   */
  if (check.flatDaily) {
    return 'ใบนี้เป็นการยื่นขอ OT แบบเหมารายวัน — คิดให้ 8 ชั่วโมงตามเดิม'
      + ' ไม่ว่าจะสแกนไว้อย่างไรหรือไม่ได้สแกนเลย'
      + ` · ${detail} (ไม่ต้องแก้)`;
  }

  if (check.state === SCAN_MATCH.NO_SCAN) return detail;
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
  if (!check || check.state === SCAN_MATCH.OK) return null;
  if (check.state === SCAN_MATCH.NO_SCAN) return 'ไม่มีข้อมูลสแกนของวันนี้';

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
   * `ไม่มีสแกนใกล้เวลาสิ้นสุด` is the third shape: something was recorded that
   * day, nothing near this end of the request.
   */
  const side = (label, s) => {
    if (!s) return `${label} ไม่มีสแกนใกล้เคียง`;
    if (s.matched) return null;
    return `${label} สแกน ${s.time.slice(0, 5)} ${s.late ? 'หลังเวลา' : 'ก่อนเวลา'} ${s.diff} นาที`;
  };
  /**
   * ── AND THE START IS SIMPLY NOT MENTIONED ON THE ORDINARY DAY ────────────
   *
   * `missingOtStart` — the person was already inside when the OT began, so
   * the machine had no door event to record and the absence of one says
   * nothing. Printing `เวลาเริ่ม ไม่มีสแกนใกล้เคียง` there would put the
   * sentence back on the row the verdict has just stopped marking, which is the
   * same noise one layer down. What is left is the end, which is the half a
   * reader can act on. See `checkEntryAgainstScans`.
   */
  return [
    check.missingOtStart ? null : side('เวลาเริ่ม', check.start),
    side('เวลาสิ้นสุด', check.end),
  ]
    .filter(Boolean)
    .join(' · ');
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
  const counts = { mismatch: 0, noScan: 0, flatDaily: 0, checked: 0 };
  for (const entry of entries) {
    if (entry?.flatDaily) { counts.flatDaily += 1; continue; }
    const check = entry?.scanCheck;
    if (!check) continue;
    counts.checked += 1;
    if (check.state === SCAN_MATCH.MISMATCH) counts.mismatch += 1;
    else if (check.state === SCAN_MATCH.NO_SCAN) counts.noScan += 1;
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
