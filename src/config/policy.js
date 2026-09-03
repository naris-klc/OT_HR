/**
 * POLICY — every unresolved [OPEN] item from the requirements doc lives here.
 *
 * Each flag below is one HR answer. When HR answers, change the value here and
 * nothing else. The defaults are the recommendations from the requirements doc,
 * or — where the doc gave no recommendation — the reading that is consistent
 * with the five worked examples in section 4.
 *
 * Nothing in this file involves money. See section 11: salary is out of scope.
 */

export const DEFAULT_POLICY = Object.freeze({
  // ── Working day shape (confirmed, not open) ────────────────────────────────
  /** Normal working hours, minutes from midnight. 08:00–17:00. */
  coreStartMinute: 8 * 60,
  coreEndMinute: 17 * 60,
  /** Mon–Fri are working days; Sat/Sun are holidays. 0 = Sunday. */
  weekendDays: [0, 6],

  // ── [OPEN 1] Does the break deduction apply to every session? ──────────────
  /**
   * 'lunchWindow' — deduct only the part of the session that overlaps
   *                 breakWindow (12:00–13:00). This is the DEFAULT because it
   *                 is the only rule consistent with all five worked examples:
   *                 B (Sat 08:00–17:00 → 8h) deducts, while A, D and E — none
   *                 of which touch 12:00–13:00 — do not. A duration threshold
   *                 would wrongly deduct from example D (14 clock hours).
   * 'threshold'   — deduct a flat breakMinutes when the session exceeds
   *                 breakThresholdHours.
   * 'always'      — deduct a flat breakMinutes from every session.
   * 'none'        — never deduct.
   */
  breakMode: 'lunchWindow',
  /** The lunch window, minutes from midnight. Used by 'lunchWindow' mode. */
  breakWindowStartMinute: 12 * 60,
  breakWindowEndMinute: 13 * 60,
  /** Flat deduction used by 'threshold' and 'always' modes. */
  breakMinutes: 60,
  /** Used by 'threshold' mode only. */
  breakThresholdHours: 5,

  // ── [OPEN 2] Overnight session (17:00 → 07:00): one break or two? ──────────
  /**
   * In 'lunchWindow' mode this is answered structurally: one deduction per
   * 12:00–13:00 window the session actually crosses. A 17:00 → 07:00 session
   * crosses none, so it deducts nothing. Set false to hard-cap at one break
   * per session regardless of how many days it spans.
   */
  breakPerCalendarDay: true,

  // ── [OPEN 3] Round down, up, or to nearest 30 minutes? ─────────────────────
  /**
   * 'floor'   — ปัดลงทั้งหมด (DEFAULT: never over-reports hours).
   * 'ceil'    — ปัดขึ้นทั้งหมด.
   * 'nearest' — ปัดเข้าหาค่าใกล้ที่สุด.
   * 'exact'   — คิดตามจริงเป็นทศนิยม: no rounding at all, and
   *             `roundingIncrementMinutes` is not read.
   *
   * 'exact' is a fourth ANSWER to [OPEN 3] and not a fourth increment. The other
   * three all ask "to which block", and switching the block off is not a value
   * that block can take — `roundingIncrementMinutes: 0` did it as a side effect
   * of an increment nothing divides by, which is a behaviour rather than a
   * stated rule, and it is not something the settings page could have offered
   * without a row reading "ปัดทีละ 0 นาที".
   *
   * The increment is left stored and untouched under 'exact', so switching back
   * to floor/ceil/nearest restores the block HR last chose rather than an
   * absent one.
   */
  roundingMode: 'floor',
  /**
   * Increment in minutes — the block a session's minutes are rounded to under
   * 'floor', 'ceil' and 'nearest'. Not read under 'exact'.
   *
   * The settings page offers 5, 10, 15, 30 and 60. Any positive number computes;
   * an increment of 0 or 1 is the same as no rounding, which is what 'exact'
   * says out loud and is why the dropdown does not offer it.
   *
   * ⚠ HOURS ARE STORED TO TWO DECIMAL PLACES (`minutesToHours`), and five- and
   * ten-minute blocks do not land on two decimals — 20 minutes is 0.33 h, and
   * two such columns print 0.33 + 0.33 against a total of 0.67. The same is true
   * of 'exact'. Blocks of 15, 30 and 60 are exact at two decimals and cannot
   * drift. Nothing is lost — every figure is stored in the same unit it is
   * printed in — but a form whose columns miss its total by 0.01 is a question
   * somebody will ask, and this is the answer.
   *
   * ⚠ LOWERING THIS RE-OPENS `minimumBufferMinutes`, SILENTLY. The buffer is
   * inert at any value up to one block, because a session shorter than a block
   * already floors to nought and is already refused by the 0-hour rule —
   * `roundingGraceMinutes` below moves that same bound, and for the same
   * reason, so the two of them are read together in `roundingZeroesUnder`. So a
   * buffer answered "0" under a 30-minute block is an unanswered question again
   * under a 15-minute one — and by then the รอ HR ยืนยัน badge is gone, so
   * nothing on the settings page will say so. The two keys are one question
   * asked twice and have to be answered together.
   *
   * ยังไม่ยืนยันกับ HR ณ 2026-08-07 — ตั้งตามพฤติกรรมเดิม. 30 is what the
   * requirements doc says and what every figure in the database was computed
   * with; it is NOT an answer anybody in HR has given. See HR_UNCONFIRMED
   * below: until they answer, this is a reading of the old paper, not a rule.
   */
  roundingIncrementMinutes: 30,
  /**
   * ผ่อนปรน — how near the next block is near enough to be given it.
   *
   * Read ONLY under 'floor', and only while it is SMALLER than the block. The
   * minutes are floored exactly as before, except that the last `grace` minutes
   * of a block round up instead of down — `Math.floor((m + grace) / inc) * inc`
   * in `roundMinutes`:
   *
   *   floor/30, grace 5   24 → 0 · 25 → 30 · 29 → 30 · 49 → 30 · 55 → 60
   *   floor/30, grace 10  19 → 0 · 20 → 30 · 29 → 30 · 50 → 60
   *   floor/30, grace 15  14 → 0 · 15 → 30 · 44 → 30 · 45 → 60
   *
   * 0 — off (DEFAULT), plain ปัดลง. That is what every figure in the database
   * was computed with, and shipping anything else would restate hours on the
   * first deploy for a rule nobody had switched on. The three levels the
   * settings page offers — 5, 10, 15 — were asked for on 2026-09-02 in the
   * words "บวกลบ 5 หรือ 10 และ 15 นาที", with 29 → 0.5 ชม. and 55 → 1 ชม. as
   * the worked examples. The ลบ half of that is what 'floor' already does: a
   * session that has not reached the window keeps rounding down. This key only
   * ever adds, and it is not confirmed policy — see HR_UNCONFIRMED below, where
   * it carries a badge of its own. It shared the increment's for the morning of
   * 2026-09-02, on the reasoning that the block and the grace are one answer,
   * and was split back out the same afternoon when ฝ่ายบุคคล answered the block
   * and said nothing about the grace.
   *
   * ⚠ A GRACE OF HALF A BLOCK IS 'nearest', EXACTLY. 15 under a 30-minute block
   * computes what ปัดเข้าหาค่าใกล้ที่สุด computes, minute for minute, and 30
   * under a 60-minute one does too. That is not a clash — it is two ways to
   * reach one rule — but the settings page says so, because a reader who sets
   * both is entitled to know they have not stacked anything.
   *
   * ⚠ NOT READ AT ALL UNDER 'ceil', 'nearest' OR 'exact', and IGNORED when it
   * is not smaller than the block — a grace of 15 on a 15-minute block would
   * hand a whole block to a session of nought, so it falls back to plain floor
   * rather than being clamped into a number nobody chose. `lib/policyInert.js`
   * prints the row's own reason in both cases; the value stays stored and comes
   * back the moment the mode or the block moves.
   *
   * ⚠ AND IT RE-OPENS `minimumBufferMinutes`, the same way lowering the block
   * does. Rounding alone zeroes everything under `inc - grace`, not under `inc`
   * — floor/30 with a grace of 10 stops refusing the 20–29 minute callouts it
   * used to refuse, and a buffer answered "0" against a 30-minute screen is an
   * unanswered question again against a 20-minute one. The two keys are one
   * question asked twice and have to be answered together.
   */
  roundingGraceMinutes: 0,
  /**
   * 'bucket'  — round each rate bucket independently (DEFAULT). Bucket totals
   *             then sum exactly to the session total, which is what the paper
   *             form's three columns need.
   * 'session' — round the session total, then apply the difference to the
   *             largest bucket.
   */
  roundingScope: 'bucket',

  // ── เวลาขั้นต่ำในการเริ่มนับ OT ─────────────────────────────────────────────
  /**
   * The buffer, in minutes. A session whose OT comes to less than this counts as
   * nought — it is not rounded, not flagged and not padded, it simply is not OT.
   * At or above it, the session goes on to rounding like any other.
   *
   * 0 — off (DEFAULT). Every minute of OT counts, which is what the system has
   * always done and what every figure in the database was computed with. A
   * shipped default of anything else would restate hours on the first deploy for
   * a rule nobody had switched on.
   *
   * ⚠ AND WHILE THE INCREMENT IS 30, THIS KEY DOES NOTHING WHATEVER IT IS SET
   * TO. Verified against the engine 2026-08-14: under floor/30 every session
   * producing under 30 minutes of OT already comes to 0 h and is already refused,
   * so a buffer of 15 — or of anything up to 30 — changes the message the
   * employee is refused with and not one outcome. It first bites ABOVE 30, where
   * it starts refusing the 30–44 minute callouts the increment was keeping.
   *
   * Which means "the buffer is off" and "there is no screening" are different
   * statements and only the first is true. The screening is real; it is done by
   * [OPEN 3]. Anybody reading a 0 here as "HR wanted no minimum" has read it
   * wrong, and `npm run whatif -- --set minimumBufferMinutes=15` reporting no
   * change is this paragraph, not a broken tool.
   *
   * NOT A SECOND `minimumHours`, and the two are read in that order:
   *
   *   this one  — is there any OT at all? Measured on the minutes as worked,
   *               after the break and BEFORE rounding, so a 25-minute callout
   *               under a 30-minute buffer is nought whatever the block would
   *               have made of it. Answered "no", nothing downstream runs.
   *   the other — the OT there is came to less than `minimumHours`; accept it
   *               and flag it, pad it, or refuse the entry.
   *
   * The order is what keeps `belowMinimum: 'raise'` from undoing the buffer. Pad
   * first and a 25-minute callout comes back as a full hour, which is the
   * opposite of both answers at once. So a buffered session skips the minimum
   * entirely — there is nothing short left to raise.
   *
   * MEASURED ON THE WHOLE ENTRY, not per rate column, and `minimumHoursScope`
   * does not reach it. That flag is the scope of the 1-hour minimum, which is a
   * question about how short work is treated; this asks whether the session was
   * OT, and a session is one thing whatever mix of columns it lands in. A Friday
   * night running into Saturday is not two attendances.
   *
   * A session buffered to nought is REFUSED at the form rather than stored as a
   * nought — every write path already refuses `otHours <= 0`, and
   * `noOtHoursMessage` in lib/entries.js names the buffer when that is the
   * reason. A replay refuses too: an entry already filed keeps the hours it was
   * filed with and is reported as failed, rather than being quietly emptied.
   *
   * ARITHMETIC (see ARITHMETIC_KEYS in lib/policyVersion.js). Raising it
   * restates entries still in flight; approved ones do not move.
   */
  minimumBufferMinutes: 0,

  // ── [OPEN 4] Session under the 1-hour minimum: accept, raise or refuse? ────
  /**
   * 'accept' — keep the hours actually worked and flag the entry (DEFAULT).
   * 'raise'  — pad up to minimumHours. 'reject' — refuse the entry outright.
   *
   * ยังไม่ยืนยันกับ HR ณ 2026-08-07 — HR ยังไม่ตอบ [OPEN 4] ดู HR_UNCONFIRMED
   * ข้างล่าง. The flag stays unconfirmed: changing which reading we run on is
   * not the same act as HR answering the question, and the badge comes off when
   * somebody in HR presses ยืนยัน, not when a default moves.
   *
   * The default was 'reject' — the behaviour read off the live database, where a
   * 'reject' override had sat for months against a file that said 'raise'. What
   * it does is refuse to record work that was done: a 40-minute callout is
   * turned away at the form and leaves no trace that anybody worked it. That is
   * a liability rather than a conservative choice, and it is not a decision this
   * system is entitled to make on HR's behalf while the question is still open.
   *
   * 'accept' is the reading that keeps every answer available. The hours are
   * stored as computed — not padded, so it never over-reports, and not zeroed,
   * so nothing is lost — and the entry carries `belowMinimumFlagged` for HR to
   * decide against a real record. If HR later answers 'raise' or 'reject', the
   * flag is the list of entries the answer has to be applied to.
   *
   * ARITHMETIC (see ARITHMETIC_KEYS in lib/policyVersion.js): moving this
   * restates entries still in flight. Approved ones do not move.
   */
  belowMinimum: 'accept',
  /**
   * The minimum, in hours.
   *
   * ยังไม่ยืนยันกับ HR ณ 2026-08-07 — ตั้งตามพฤติกรรมเดิม.
   *
   * WHAT IS UNCONFIRMED IS NOT ONLY THE NUMBER. What it is measured against is
   * `minimumHoursScope` below, and that question — "ต่อใบหรือต่อช่อง" — is as
   * unanswered as this one. The two are read together and neither means
   * anything alone.
   */
  minimumHours: 1,
  /**
   * What `minimumHours` is measured against.
   *
   * 'sheet'  — one entry, one minimum, whatever mix of rate columns it lands in
   *            (DEFAULT). A 20-minute weekday stretch and a 45-minute holiday
   *            stretch on the same entry clear a 1-hour minimum together.
   * 'bucket' — one minimum per rate column. The same entry is short in both, and
   *            `belowMinimum` is applied to each column that falls short: two
   *            flags under 'accept', two paddings under 'raise', and one refusal
   *            under 'reject' (the entry is refused as a whole — an entry that
   *            kept its long columns and dropped its short one would be a third
   *            answer nobody asked for).
   *
   * 'sheet' is the DEFAULT because it is what every figure in the database was
   * computed with, and because it is the reading that refuses least: under
   * 'bucket' the same work is short more often, and more often is not more
   * correct while the question is open.
   *
   * ยังไม่ยืนยันกับ HR ณ 2026-08-07 — ดู HR_UNCONFIRMED (`minimumScope`) below.
   * Until this existed the other reading was not a value but a rewrite of the
   * engine, which is why the badge for it had no dropdown to sit on.
   *
   * ARITHMETIC (see ARITHMETIC_KEYS in lib/policyVersion.js). Under 'accept' it
   * moves no hour and only flags more entries — but under 'raise' it pads
   * columns 'sheet' would have left alone, and under 'reject' it refuses
   * entries 'sheet' would have kept, so it is registered on what it can do and
   * not on what today's `belowMinimum` happens to make of it.
   */
  minimumHoursScope: 'sheet',

  // ── [OPEN 5] Does OT begin at 17:00 or 17:01? ──────────────────────────────
  /**
   * true  — 17:00 is the boundary, so 17:00–20:00 is a clean 3 hours (DEFAULT,
   *         and the doc's own recommendation). The form's "17.01" is read as
   *         paper shorthand for "after 17:00", not a one-minute gap.
   * false — OT starts at 17:01, making 17:00–20:00 count 2h59m.
   */
  otStartsAtCoreEnd: true,

  // ── วันเกิดพนักงานเป็นวันหยุดของคนนั้น ──────────────────────────────────────
  /**
   * false — a birthday is an ordinary working day (DEFAULT).
   * true  — an employee's birthday falling Mon–Fri is a holiday FOR THAT PERSON
   *         ONLY: 08:00–17:00 goes to ot15_holiday and the hours either side to
   *         ot3_holiday, exactly as a company holiday would. A birthday that
   *         already lands on a weekend or a company holiday adds nothing.
   *
   * Off by default because it is a benefit somebody has to decide to grant, and
   * because turning it on restates every entry still in flight — see
   * ARITHMETIC_KEYS in lib/policyVersion.js. Signed-off entries do not move.
   *
   * This is the one policy flag whose answer depends on WHO worked, which is why
   * day types are resolved by the caller and handed to the engine as a map.
   * `resolveDayTypes` in src/lib/otEngine.js is the whole rule; the engine
   * itself never learns that birthdays exist.
   */
  birthdayHolidayEnabled: false,
  /**
   * Which day a 29 February birthday falls on in a year that has no 29 February.
   *
   * 'feb28' — 28 February (DEFAULT: the day the birthday would have been).
   * 'mar01' — 1 March (the day after the 28th, i.e. "the next day that exists").
   * 'none'  — no birthday holiday at all in a non-leap year.
   *
   * A flag rather than a constant: this is a choice about somebody's day off,
   * three defensible answers exist, and whichever is chosen changes hours — so
   * it is recorded as part of the rule set like every other answer here.
   */
  birthdayLeapFallback: 'feb28',
  /* There is no third birthday flag, and this note is here so that nobody
     re-adds one. `birthdayReasonOnForm` decided whether F-HR-027 printed
     "วันเกิด" under the day number, and it shipped on. On 2026-08-10 HR answered
     the question it existed to ask: the controlled form does not carry the word,
     and the remark belongs on สรุป OT ส่งบัญชี, in the white strip beside the
     person's row — where it was written by hand on the old paper. A decision
     that has been made is not a flag, so the key is retired rather than
     defaulted off: the note is gone from the form, the accounting sheet prints
     it from `segments[].dayReason`, and `formDayTypes` in lib/reports.js accepts
     no birth date at all. A stored override for the retired key is dropped by
     `Setting.effectivePolicy()`, so a database that has one does not carry it
     into the versions recorded from here on. */


  // ── [OPEN 6] Different rules per department or shift? ──────────────────────
  /**
   * false — one day model for everybody (DEFAULT). If HR answers "yes", this
   * flag is not enough: shift patterns change what "outside 08:00–17:00" means
   * per employee and the day-type model has to move onto the employee record.
   * That is a schema change, not a config change — see README.
   */
  shiftPatternsEnabled: false,

  // ── [OPEN 7] Can HR reject after the manager approved? ─────────────────────
  /** true — HR may reject a pending_hr request. */
  hrMayReject: true,
  /**
   * Where a HR rejection lands. Two values, and both name a PLACE rather than a
   * บทบาท — `hrRejectReturnsTo: 'employee'` (DEFAULT) makes the entry
   * `rejected`, so the person corrects it and files again from the start;
   * `hrRejectReturnsTo: 'manager'` sends it back to `pending_mgr` for whoever
   * holds that step to read again.
   *
   * The second value keeps the word the first step has always been called, and
   * is the one place in this system where it survives: the บทบาท of that name
   * was retired on 2026-09-03, when หัวหน้างาน became `supervisor` and a real
   * ผู้จัดการแผนก took the rung above it (see lib/roles.js). This value is
   * already stored in `Setting.policy` on live databases, and renaming it would
   * need a migration of its own to buy nothing.
   */
  hrRejectReturnsTo: 'employee',

  // ── หัวหน้าบันทึก OT แทนลูกทีม ──────────────────────────────────────────────
  /**
   * When the person who filled the form in is also the person who would sign
   * the manager's step, does the request skip that step?
   *
   * true  — it goes straight to `pending_hr` (DEFAULT), with the reason written
   *         into its history.
   * false — it waits at `pending_mgr` like any other, for the หัวหน้า who wrote
   *         it to approve their own filing.
   *
   * The default is the honest reading rather than the flattering one. A หัวหน้า
   * pressing อนุมัติ on a form they typed has checked nothing — but the trail
   * that comes out of it reads ยื่นคำขอ → หัวหน้างานอนุมัติ → ฝ่ายบุคคลยืนยัน,
   * which is indistinguishable on the page from two people agreeing, and there
   * is no way to tell them apart afterwards. Skipping openly looks worse and
   * says something true: this reached HR approved by nobody.
   *
   * A flag rather than an assumption because "we want both presses on the
   * record whatever they are worth" is a defensible answer that HR is entitled
   * to give. COSMETIC — it moves no hour, only which desk the request is on.
   * The rule itself is `initialStatus` in lib/proxyFiling.js.
   */
  proxySkipsOwnApproval: true,
  /**
   * Does F-HR-027 carry a line under the table naming who filed and who signed
   * on somebody else's behalf?
   *
   * false — the sheet is unchanged except for the short (แทน) mark in the
   *         รายละเอียดงานที่ทำ cell (DEFAULT).
   * true  — a note line prints under the grid, naming the dates and both people.
   *
   * Off by default because F-HR-027 Rev.4 is a controlled form and a line
   * nobody in HR has agreed to is a change to a document, not a feature. The
   * mark inside the description cell is not covered by this: it sits where
   * (ต่อจากคืนก่อน) and [ไม่พักเที่ยง] already sit, which HR reads today.
   *
   * COSMETIC in the strict sense: every hour on the sheet comes from stored
   * segments and this decides only what is printed beside them. Flipping it must
   * recompute nothing.
   */
  proxyNoteOnForm: false,

  /* ── `hrDirectApproveBirthday` WAS HERE AND WAS WITHDRAWN ─────────────────
     Removed 2026-09-03 with the arrangement it governed. It decided whether
     ฝ่ายบุคคล filing a birthday holiday from วันเกิดที่ยังไม่มีใบ — having read
     the in and out times off the fingerprint scanner — both filed and approved
     it in one act, writing a single `submit_hr_verified` history row that named
     them as filer and signer with the reason on it.

     There is no such press now: a birthday request is filed by the person whose
     birthday it is and takes both signatures like every other request. Nothing
     in this system can reach `approved` in one act any more.

     THE ROWS IT PRODUCED ARE STILL IN THE DATABASE and are still marked as what
     they are — `isHrVerifiedBirthday` in lib/entries.js reads them, and
     ตรวจสอบรายเดือน still counts them for the months they fall in. A key that no
     longer exists is not a key that never ran.

     A stored `Setting.policy` may still carry it. It is ignored, not migrated:
     nothing reads it, and rewriting somebody's stored settings to tidy up a name
     is how a policy version comes to disagree with what produced the hours. */

  // ── [OPEN 8] Hitting the department cap: block or warn? ────────────────────
  /** 'warn' — allow through with a flag for HR (DEFAULT). 'block' — refuse. */
  capBehaviour: 'warn',

  // ── [OPEN 9] Does the cap count clock hours or weighted hours? ─────────────
  /**
   * 'clock'    — hours actually worked. Example D counts 14 (DEFAULT).
   * 'weighted' — hours × multiplier. Example D counts 31.5.
   */
  capBasis: 'clock',

  // ── [OPEN 9] Where a week begins, for the weekly department cap ────────────
  /**
   * 0 = Sunday … 6 = Saturday. 1 — Monday–Sunday (DEFAULT).
   *
   * A flag rather than a constant because the boundary is a convention, not
   * arithmetic. Monday–Sunday is what the payroll calendar here runs on, but a
   * department working a Sunday–Saturday week would otherwise have every one of
   * its weekly totals cut in the middle, and correcting that should not need a
   * redeploy.
   *
   * Read ONLY by lib/caps.js, which decides which week an OT segment falls in.
   * It has nothing to do with `weekendDays` — that one decides which days are
   * วันหยุด and therefore which bucket an hour is paid at, and it is arithmetic
   * for exactly that reason. This one moves no hour between buckets and changes
   * no total; it changes which pile of hours a ceiling is compared against.
   */
  weekStartsOn: 1,

  // ── [OPEN 12] HR summary boxes: raw hours or already multiplied? ───────────
  /**
   * 'raw'        — the "OT × 1.5" box holds the hours that fall in the ×1.5
   *                buckets (DEFAULT). Whoever runs payroll applies the rate.
   * 'multiplied' — the box holds hours × multiplier, i.e. rate-equivalent
   *                hours. Changes what the export column means.
   */
  hrSummaryBasis: 'raw',
  // ── ใบ F-HR-027 พิมพ์รายการสถานะใดบ้าง ──────────────────────────────────────
  /**
   * Which requests reach the printed F-HR-027 — the approved ones, or the ones
   * still waiting in a queue as well.
   *
   * 'approved' — เฉพาะรายการที่อนุมัติแล้ว (DEFAULT). The sheet is the one that
   *              gets wet-signed and filed, so what is on it is what payroll
   *              will pay. `?status=` is IGNORED under this answer, which is
   *              the point of it: the strict setting has to be strict against a
   *              hand-edited URL too, or it is a suggestion.
   * 'screen'   — whatever สถานะที่นับ on ตรวจสอบรายเดือน is set to, clamped by
   *              `reportStatuses`. The screen and the paper then quote the same
   *              figures for the same person, which they do not today.
   * 'draft'    — อนุมัติแล้ว + รอ HR + รอหัวหน้า, always. What the route did
   *              unconditionally before this flag existed: a working copy for
   *              reading a month before it is closed.
   *
   * THE DEFAULT CHANGES BEHAVIOUR, and that is the reason it exists. The route
   * shipped with the 'draft' list hard-coded and no mark on the paper, so HR
   * could select อนุมัติแล้วเท่านั้น, read a total off ตรวจสอบรายเดือน, press
   * พิมพ์ and get a larger total on a sheet with two signature lines on it —
   * with nothing on the page saying which rows the difference was. A หัวหน้า
   * signing that sheet signs rows the app still has waiting for their decision.
   *
   * Under the two answers that do let a pending row through, the row says so on
   * the paper: `(รออนุมัติ)` prints in the รายละเอียดงานที่ทำ cell, where
   * (ต่อจากคืนก่อน), [ไม่พักเที่ยง] and (แทน) already sit. Not a column and not
   * a row — F-HR-027 Rev.4 is a controlled form measured in millimetres against
   * the paper, and a remark in the cell HR already reads is not a revision of
   * it.
   *
   * COSMETIC in the strict sense lib/policyVersion.js means. Every hour on the
   * sheet comes from stored `segments`, resolved when the entry was filed; this
   * decides which entries are fetched to print and never what any of them is
   * worth. Flipping it must recompute nothing.
   *
   * The rule is `formPrintStatuses` in lib/reports.js, and it is applied by the
   * ROUTE rather than by the screen — see app/api/reports/form/[period]/route.js.
   */
  formPrintScope: 'approved',

  // ── ยื่น OT ล่วงหน้าได้ถึงวันไหน ─────────────────────────────────────────────
  /**
   * How many days past today a `workDate` may be, at the moment it is written.
   *
   * 0    — up to and including today (DEFAULT). Overtime here is work that has
   *        been done, and every other rule in the system treats it that way: the
   *        hours are computed from times somebody read off a scanner, the
   *        ceiling counts what was worked, and the month is printed and signed
   *        at the end of it. A request for next Tuesday records nothing that has
   *        happened.
   * n     — a positive number of days, for a company that rosters overtime ahead
   *        and wants the request in before the shift.
   * null  — ไม่จำกัด. The rule switched off, said out loud rather than by
   *        picking a number nothing will exceed: `maxAdvanceSubmissionDays:
   *        36500` computes the same and reads as a limit nobody can explain.
   *
   * WHY THERE WAS NOTHING HERE UNTIL NOW. `workDate` was checked for SHAPE by
   * the schema and for one BOUNDARY by ปิดงวด — a month HR had closed took no
   * new requests. Neither of them looked forward. Nothing anywhere refused a
   * request dated 2027, and one filed today would wait in a queue nobody opens
   * for months, inside a ceiling for a month nobody has worked yet. (ปิดงวด
   * itself was withdrawn on 2026-08-31 — see lib/periodStatus.js — so this key
   * and its backward twin are now the only limits on `workDate` there are.)
   *
   * MEASURED AGAINST THE OFFICE'S OWN DAY, never the server's — `today()` in
   * lib/today.js. After 17:00 UTC a server running on UTC is already on tomorrow
   * while the office is not, and "not after today" would start letting tomorrow
   * through every evening.
   *
   * NOT ARITHMETIC (see COSMETIC_KEYS in lib/policyVersion.js). It decides
   * whether an entry may be WRITTEN and never what its hours are: the engine
   * never reads it, and no stored figure goes stale when it moves.
   *
   * NOT ENFORCED BY THE SCHEMA, deliberately — see the note on `workDate` in
   * src/models/OtEntry.js. `advanceSubmissionRefusal` in lib/entries.js is the
   * rule, and every write path calls it with the policy actually in force.
   */
  maxAdvanceSubmissionDays: 0,

  // ── ยื่น OT ย้อนหลังได้ถึงกี่วัน ─────────────────────────────────────────────
  /**
   * How many days BEFORE today a `workDate` may be, at the moment it is written.
   *
   * null — ไม่จำกัด (DEFAULT). No backward limit at all: a late entry is late
   *        but not refused, however late. Shipped off because turning it on
   *        refuses work that people have actually done, and that is HR's
   *        decision to make rather than a default to arrive in a deploy.
   *
   *        THAT DEFAULT MEANT SOMETHING NARROWER WHEN IT WAS CHOSEN. ปิดงวด was
   *        the backward limit then — a month stopped taking new requests when
   *        ฝ่ายบุคคล closed it — and ไม่จำกัด meant "unlimited within the months
   *        that are still open". ปิดงวด was withdrawn on 2026-08-31 (the paper
   *        file is the record; lib/periodStatus.js), so ไม่จำกัด now means
   *        unlimited outright: a request may be filed today for any date in the
   *        past. Left at null rather than given a number here, because picking
   *        one is exactly the decision this key exists to leave to HR — but it
   *        is a decision they have not been asked to make yet.
   * n    — a positive number of days.
   *
   * THE MIRROR OF `maxAdvanceSubmissionDays` ABOVE, AND NOT ITS EQUAL. The two
   * refuse opposite directions and the cost of being wrong is not the same in
   * both. A future date records nothing that has happened, so refusing it loses
   * nothing. A past date records a shift somebody actually worked, and refusing
   * it turns work into hours that were never claimed — which is why the shipped
   * answers differ (0 forward, unlimited back) and why this one warns on the
   * settings page and that one does not.
   *
   * IT USED TO BE THE SECOND OF TWO, and the distinction is worth keeping on
   * the record because it is why this key is shaped the way it is:
   *
   *   ปิดงวด    — a MONTH somebody declared finished stopped moving.
   *               Deliberate, dated, reversible by an administrator with a
   *               reason. Withdrawn 2026-08-31; see lib/periodStatus.js.
   *   this one  — a rolling window measured in days from today. Nobody presses
   *               anything; it moves on its own overnight, and there is no
   *               reopening it for one late entry.
   *
   * The one that is left is the one nobody presses. That is the trade HR made
   * knowingly — a rule that never has to be remembered, in place of one that had
   * to be — and it is why the refusal this key produces names a number of days
   * rather than a person to go and ask.
   *
   * NOT ARITHMETIC, NOT ENFORCED BY THE SCHEMA, and MEASURED AGAINST THE
   * OFFICE'S OWN DAY, for the three reasons written out over
   * `maxAdvanceSubmissionDays` above. `pastSubmissionRefusal` in lib/entries.js
   * is the rule; `submissionWindowRefusal` beside it is what the routes call, so
   * that neither direction can be checked in a path that forgot the other.
   */
  maxPastSubmissionDays: null,
});

/**
 * The rules the system is running on that NOBODY IN HR HAS AGREED TO.
 *
 * Every value in DEFAULT_POLICY is a default, and saying so on the settings
 * page — as its subtitle already does — tells a reader nothing, because it is
 * equally true of the twenty flags HR has no opinion about. The items below are
 * different in kind: they were reverse-engineered from how the old paper
 * appears to have been filled in, or invented outright, and they each move
 * hours. A default nobody chose and a default somebody read off a stack of 2025
 * timesheets both print as "ค่าเริ่มต้น" and only one of them is a liability.
 *
 * It read "These three" until 2026-09-02 and there have been more than three
 * since `startBuffer` arrived on 2026-08-13. A count belongs in the list, which
 * can be counted, and not in a sentence, which cannot.
 *
 * NOT "unanswered" — UNRECORDED. ฝ่ายบุคคล answered `roundingIncrement` on
 * 2026-09-02, out loud, and the badge stayed up because nobody had pressed
 * anything. That is the design working rather than failing: what this list
 * tracks is whose answer is on the record, and a rule somebody agreed to in a
 * corridor is exactly as unrecorded as one nobody has considered. Do not
 * shorten an item out of this file because the answer is known — press ยืนยัน,
 * which is the one act that writes down who said it and when.
 *
 * So the state is recorded rather than described in prose: the badge on the
 * settings page is generated from this list, and pressing ยืนยัน on an item
 * writes who confirmed it and when.
 *
 * COSMETIC, and structurally so — nothing here is a policy key. The
 * confirmations are stored on the Setting document OUTSIDE `policy` (see
 * src/models/Setting.js), so they never reach `canonicalPolicy`, never mint a
 * version, and can never replay an entry. Confirming an item changes no value:
 * it records that the value it already had is now somebody's answer rather
 * than our guess.
 *
 * `keys` places the badge — a settings row wearing it is a row this question is
 * about. It may be empty, and `reading` is what makes that survivable: an item
 * with no dropdown to sit on still states the rule the system is running on, in
 * words, on the settings page. `minimumScope` was that case until 2026-08-13 —
 * the minimum's scope was a rule the engine had and the policy had no flag for
 * — and it is not any more, because `minimumHoursScope` is now the flag. The
 * question is no less unanswered for having a dropdown; the badge stayed and
 * only moved onto it.
 */
export const HR_UNCONFIRMED_SINCE = '2026-08-07';

export const HR_UNCONFIRMED = Object.freeze([
  Object.freeze({
    /**
     * ปัดขึ้นหรือปัดลง — the half of [OPEN 3] that has never been put to
     * anybody, and the one that moves the most hours of any item in this list.
     *
     * IT USED TO BE MISSING, and the way it went missing is the reason it is
     * first now. The badge originally sat on `roundingMode` as a stand-in,
     * because the increment was a number in this file with no row of its own to
     * wear it. When the increment got its dropdown on 2026-09-02 the badge
     * moved onto it — correctly, the increment IS a question — and this file
     * wrote down that `roundingMode` "is not unconfirmed: 'floor' is the
     * requirements doc's own recommendation." A stand-in was retired and the
     * rule it had been standing in for was recorded as answered on its way out.
     *
     * A recommendation in the requirements doc is exactly what every other item
     * here is: reverse-engineered from how the old paper appears to have been
     * filled in. `belowMinimumAction` and `minimumScope` are on this list on
     * those same grounds. Nothing distinguished `roundingMode` except that it
     * had once carried somebody else's badge.
     *
     * ฝ่ายบุคคล ANSWERED "ปัดเศษทีละ 30 นาที" on 2026-09-02, and that is the
     * increment — it says how big the block is and not which way a part-block
     * goes. Under this file's own rule (a badge covers exactly as much as one
     * answer covers) it cannot reach `roundingMode`, and the two readings of
     * their sentence are 29 นาที → 0 ชม. and 29 นาที → 0.5 ชม.
     *
     * `roundingDirection`, not `roundingMode`: an id that collides with a policy
     * key makes `{ [id]: {...} }` read as a policy override to anything scanning
     * the settings document loosely — the trap `belowMinimumAction` and
     * `startBuffer` were both named out of.
     */
    id: 'roundingDirection',
    since: '2026-09-03',
    label: 'เศษที่ไม่ครบบล็อก ปัดขึ้นหรือปัดลง',
    keys: Object.freeze(['roundingMode']),
    reading: (policy) => {
      if (policy.roundingMode === 'exact') return 'ไม่ปัดเศษ — คิดตามจริงเป็นทศนิยม';
      if (policy.roundingMode === 'ceil') return 'ปัดขึ้นทั้งหมด';
      if (policy.roundingMode === 'nearest') return 'ปัดเข้าหาค่าใกล้ที่สุด';
      return 'ปัดลงทั้งหมด — เศษที่ไม่ครบบล็อกถูกตัดทิ้ง';
    },
    note: 'ข้อนี้ถามคนละอย่างกับ “ปัดเศษทีละกี่นาที” ข้างล่าง ที่ฝ่ายบุคคลตอบมาแล้วว่า 30 นาที '
      + '— คำตอบนั้นบอกว่าบล็อกใหญ่เท่าไร ไม่ได้บอกว่าเศษที่ไม่ครบบล็อกไปทางไหน '
      + '· “ปัดลงทั้งหมด” เป็นข้อแนะนำในเอกสารข้อกำหนด ไม่ใช่คำตอบที่ใครในฝ่ายบุคคลเคยให้ไว้ '
      + 'และเป็นค่าที่ทุกใบในระบบถูกคำนวณมา '
      + '· ⚠ เป็นข้อที่ขยับชั่วโมงมากที่สุดในรายการนี้ — ปัดลงกับปัดเข้าหาค่าใกล้ที่สุด '
      + 'ต่างกันได้ถึงเกือบครึ่งชั่วโมงต่อใบ และการปัดลงอย่างเดียวคือการไม่จ่ายเวลาที่ทำไปแล้ว '
      + '· ถ้าตอบว่า “ปัดลง แต่ขาดอีกไม่กี่นาทีให้ครบ” นั่นคือแถวผ่อนปรนข้างล่าง ไม่ใช่แถวนี้ '
      + '· เปลี่ยนข้อนี้แล้วชั่วโมงของใบที่ยังไม่อนุมัติจะเปลี่ยนตาม',
  }),
  Object.freeze({
    id: 'roundingIncrement',
    /**
     * `roundingGraceMinutes` SHARED THIS BADGE FOR ONE DAY, on the reasoning
     * that "ปัดลงทีละ 30 นาที" and "และ 29 นาทีได้ศูนย์" are one answer and two
     * badges would let HR sign off half of it. That was written on the morning
     * of 2026-09-02 and was wrong by the afternoon of the same day, in the
     * exact way it feared and from the other side: ฝ่ายบุคคล answered the
     * increment — 30 นาที — and said nothing about the grace, which did not
     * exist when they were asked. One badge over both would have made pressing
     * ยืนยัน on their answer ALSO record them as having chosen ผ่อนปรน: ปิด,
     * which is a value nobody has ever put to them.
     *
     * The rule the two cases share, and the one to keep: a badge covers exactly
     * as much as one answer covers. Splitting a question HR answers in one
     * breath makes them press twice; merging two they answer separately puts
     * their name on something they never said. Only the second is a lie, so
     * when the shape is unclear the item splits.
     *
     * See `roundingGrace` below, which is where it went.
     */
    keys: Object.freeze(['roundingIncrementMinutes']),
    reading: (policy) => (policy.roundingMode === 'exact'
      ? 'ไม่ปัดเศษ — คิดตามจริงเป็นทศนิยม'
      : `ทีละ ${policy.roundingIncrementMinutes} นาที`),
    /**
     * `note` says what the question is and what answering it costs. It must NOT
     * restate the value — `reading` does that, off the live policy, and a note
     * that names a value too is a second source of truth that goes stale the
     * first time somebody changes the dropdown. All three notes here did exactly
     * that until 2026-08-13, and minimumScope's was already wrong: it read
     * "ค่าที่ใช้อยู่คือ ต่อใบ" on a database that had been running ต่อช่อง for
     * as long as anybody could tell, because a stored override shadows this file
     * silently (see `npm run whatif -- --show`).
     */
    note: '30 นาที (ครึ่งชั่วโมง) มาจากเอกสารข้อกำหนด และเป็นค่าที่ทุกใบในระบบถูกคำนวณมา '
      + '· ฝ่ายบุคคลตอบมาแล้วเมื่อ 2 ก.ย. 2569 ว่าปัดเศษทีละ 30 นาที ตรงกับค่าที่ใช้อยู่ '
      + '— กด ยืนยัน เพื่อบันทึกว่าใครรับคำตอบนี้และเมื่อไร ป้ายจะได้เลิกเป็นการเดา '
      + '· ข้อนี้ไม่ได้ตอบเรื่องการผ่อนปรนปัดขึ้นข้างล่าง ซึ่งยังไม่มีใครถูกถาม '
      + '· เปลี่ยนข้อนี้แล้วชั่วโมงของใบที่ยังไม่อนุมัติจะเปลี่ยนตาม',
  }),
  Object.freeze({
    /**
     * ผ่อนปรนการปัดขึ้น — the half of [OPEN 3] that ฝ่ายบุคคล have not been
     * asked. Its own item since 2026-09-02; see the note on `roundingIncrement`
     * above for why it is not on that badge.
     *
     * `since` is its own date and not HR_UNCONFIRMED_SINCE. The question was
     * put to nobody before the key existed, and printing 7 ส.ค. beside it would
     * age it by four weeks it did not exist for — the same reason `startBuffer`
     * carries its own date.
     */
    id: 'roundingGrace',
    label: 'เกือบครบบล็อกแล้ว ปัดขึ้นให้กี่นาที',
    since: '2026-09-02',
    keys: Object.freeze(['roundingGraceMinutes']),
    reading: (policy) => {
      if (policy.roundingMode === 'exact') return 'ไม่ปัดเศษ จึงไม่มีอะไรให้ผ่อนปรน';
      /**
       * Read through the same test the engine uses, not off the stored number.
       * Under 'ceil' and 'nearest' the key is not read at all, and a grace the
       * size of the block or larger falls back to plain floor — a row printing
       * "ผ่อนปรน 15 นาที" over an engine that forgives nothing would be the one
       * thing `reading` exists to prevent, which is why the line above it says
       * ไม่ปัดเศษ under 'exact'.
       */
      const grace = Number(policy.roundingGraceMinutes) || 0;
      const live = policy.roundingMode === 'floor'
        && grace > 0 && grace < Number(policy.roundingIncrementMinutes);
      if (live) return `ปัดขึ้นให้เมื่อเหลืออีกไม่เกิน ${grace} นาที`;
      if (grace > 0) return 'ไม่ผ่อนปรน — ค่าที่ตั้งไว้ไม่ถูกอ่านกับการปัดเศษแบบนี้';
      /**
       * A grace of nought under a mode that never reads it is not the same
       * sentence as a grace of nought under 'floor'. "ปัดลงอย่างเดียว" is a
       * claim about the ROUNDING, and printing it beside ปัดเข้าหาค่าใกล้ที่สุด
       * would describe an engine that is not running — the row above says
       * nearest and this one would say floor.
       */
      if (policy.roundingMode !== 'floor') return 'ไม่ผ่อนปรน — การปัดเศษแบบนี้ไม่ได้อ่านค่านี้';
      return 'ไม่ผ่อนปรน — ปัดลงอย่างเดียว';
    },
    note: 'ปิดไว้ *ใต้การปัดลง* แปลว่าทำ 29 นาทีได้ 0 ชม. และงานนั้นถูกปฏิเสธไม่บันทึกอะไรเลย '
      + 'ซึ่งเป็นการอ่านจากวิธีกรอกกระดาษเดิม ไม่ใช่คำตอบที่ใครในฝ่ายบุคคลเคยให้ไว้ '
      + '· ใต้การปัดแบบอื่นค่านี้ไม่ถูกอ่านเลย แถวข้างบนเป็นตัวตัดสิน '
      + '· ตั้งได้ 5, 10 หรือ 15 นาที — ตัวอย่างที่ 5: ทำ 29 นาทีได้ 0.5 ชม. และ 55 นาทีได้ 1 ชม. '
      + '· เป็นคนละข้อกับ “ปัดเศษทีละกี่นาที” ข้างบน ที่ฝ่ายบุคคลตอบแล้ว '
      + '· เปลี่ยนข้อนี้แล้วชั่วโมงของใบที่ยังไม่อนุมัติจะเปลี่ยนตาม และเส้นที่ระบบปฏิเสธงานสั้น ๆ จะขยับตามไปด้วย',
  }),
  Object.freeze({
    /**
     * Not 'belowMinimum'. An id that collides with a policy key makes
     * `{ [id]: {...} }` read as a policy override to anything scanning the
     * settings document loosely — see test/policyConfirmation.test.js, which
     * is what caught it.
     */
    id: 'belowMinimumAction',
    label: 'ต่ำกว่าขั้นต่ำ 1 ชม. ให้รับ ปัดขึ้น หรือไม่รับ',
    keys: Object.freeze(['belowMinimum']),
    reading: (policy) => {
      if (policy.belowMinimum === 'reject') return 'ไม่รับรายการ';
      if (policy.belowMinimum === 'raise') return 'ปัดขึ้นเป็น 1 ชม.';
      return 'รับตามชั่วโมงจริง และติดธงให้ HR ตรวจ';
    },
    note: '“รับตามชั่วโมงจริง” บันทึกชั่วโมงที่คำนวณได้ ไม่ปัดขึ้นและไม่ปฏิเสธ '
      + 'แต่ติดธงไว้ให้ฝ่ายบุคคลตัดสินรายใบ '
      + '· ระบบเคยตั้งไว้ที่ “ไม่รับรายการ” ซึ่งเท่ากับไม่บันทึกชั่วโมงที่พนักงานทำไปแล้ว '
      + '· เปลี่ยนเป็นปัดขึ้นหรือไม่รับ ชั่วโมงของใบที่ยังไม่อนุมัติจะเปลี่ยนตาม',
  }),
  Object.freeze({
    id: 'minimumScope',
    label: 'ขั้นต่ำ 1 ชม. นับต่อใบหรือต่อช่อง',
    keys: Object.freeze(['minimumHoursScope']),
    reading: (policy) => (policy.minimumHoursScope === 'bucket'
      ? 'ต่อช่อง (เทียบขั้นต่ำแยกทีละช่องอัตรา)'
      : 'ต่อใบ (รวมทุกช่องก่อนเทียบกับขั้นต่ำ)'),
    note: '“ต่อใบ” รวมชั่วโมงทุกช่องก่อนแล้วจึงเทียบกับ 1 ชม. · “ต่อช่อง” เทียบทีละช่อง '
      + 'ใบที่คาบเกี่ยวสองช่อง เช่น ศุกร์ดึกข้ามไปเสาร์ จึงถูกวัดสองครั้งและติดธงได้ทั้งสองช่อง '
      + '· ขณะที่ “ต่ำกว่าขั้นต่ำ” ตั้งไว้ที่ “รับตามชั่วโมงจริง” ข้อนี้เปลี่ยนแค่จำนวนธงที่ฝ่ายบุคคลต้องตรวจ '
      + 'ไม่ขยับชั่วโมง — จะขยับก็ต่อเมื่อข้อนั้นถูกเปลี่ยนเป็นปัดขึ้นหรือไม่รับ',
  }),
  Object.freeze({
    /**
     * Added 2026-08-13. The buffer had been the odd one out: a value that moves
     * hours, shipped at a figure nobody in HR chose, and the only one of the
     * four with nothing on the page saying so. It was not an oversight in the
     * catalogue so much as an artefact of when the flag arrived — it was built
     * after the other three were written down, and a question that nobody wrote
     * down is a question that stops being asked.
     *
     * `startBuffer`, not `minimumBuffer...`: an id that collides with a policy
     * key makes `{ [id]: {...} }` read as a policy override to anything scanning
     * the settings document loosely, which is the trap `belowMinimumAction`
     * was renamed out of.
     */
    id: 'startBuffer',
    since: '2026-08-13',
    label: 'ต้องทำเกินกี่นาที จึงเริ่มนับเป็น OT',
    keys: Object.freeze(['minimumBufferMinutes']),
    reading: (policy) => (Number(policy.minimumBufferMinutes) > 0
      ? `ต้องทำอย่างน้อย ${policy.minimumBufferMinutes} นาที`
      : 'ไม่มีเกณฑ์ — ทุกนาทีที่ทำนับเป็น OT'),
    note: 'ถามคนละเรื่องกับขั้นต่ำ 1 ชม. ข้อนี้ถามว่า “นับเป็น OT หรือเปล่า” '
      + 'วัดจากนาทีที่ทำจริงทั้งใบ ก่อนปัดเศษ · ใบที่ไม่ผ่านเกณฑ์นี้จะถูกปฏิเสธตั้งแต่หน้ากรอก '
      + 'ไม่ใช่บันทึกเป็น 0 · ระบบส่งมาที่ “ไม่มีเกณฑ์” เพราะยังไม่เคยมีใครในฝ่ายบุคคลระบุตัวเลขมา '
      + 'ไม่ใช่เพราะตอบแล้วว่าไม่ต้องมี '
      + '· ⚠ การปัดเศษตอบคำถามเดียวกันนี้ก่อน และตอบไปแล้วบางส่วนเสมอ — งานที่สั้นกว่า '
      + '“บล็อก ลบ ผ่อนปรน” ถูกปัดเหลือ 0 และถูกปฏิเสธอยู่แล้ว ข้อนี้จึงเริ่มมีผลจริงเหนือเส้นนั้นขึ้นไป '
      + '· เส้นนั้นขยับได้สามทาง คือเปลี่ยนวิธีปัด เปลี่ยนขนาดบล็อก หรือเปิดผ่อนปรน '
      + 'ประโยคใต้ช่องนี้บนหน้าตั้งค่าคำนวณเส้นใหม่ทุกครั้ง (`roundingZeroesUnder` ใน lib/policyInert.js) '
      + 'จึงอ่านที่นั่น อย่าอ่านตัวเลขจากประโยคนี้ '
      + '· ⚠ และข้อนี้ทำงานก่อนผ่อนปรน วัดจากนาทีที่ทำจริง — ตั้งข้อนี้ไว้สูงกว่าเส้นข้างบน '
      + 'จะบังผ่อนปรนทิ้งทั้งช่วง: ผ่อนปรน 5 เปิดไว้ให้ 25–29 นาทีได้ 0.5 ชม. แต่ถ้าข้อนี้เป็น 30 '
      + 'คนกลุ่มนั้นยังถูกปฏิเสธเหมือนเดิม ตอบสองข้อนี้พร้อมกันเสมอ',
  }),
]);

/** One item's current answer, read off the live policy rather than restated. */
export function readUnconfirmed(item, policy = DEFAULT_POLICY) {
  return typeof item.reading === 'function' ? item.reading(policy) : String(item.reading ?? '');
}

/* `unconfirmedKeys` used to sit here. It moved to lib/policyConfirmations.js on
   2026-08-24, when "confirmed" stopped meaning "a record exists": a sign-off now
   names the value it was given for and stands only while that value does, so the
   question "does this key still wear the badge" cannot be answered from the
   confirmations alone — it needs the live policy, and the comparison that reads
   both lives beside the records. Left as a note rather than as a re-export,
   because two names for one rule is how the two definitions drifted apart in
   the first place. */

/**
 * รายละเอียดงานที่ทำ — how much text may be entered, in characters.
 *
 * The printed form gives that column one line of a fixed-width cell, so a
 * description that runs past it is not recorded, it is ellipsised. Capping the
 * input at what fits means what HR reads on paper is what the employee wrote.
 *
 * This bounds what may be WRITTEN. Entries stored before the cap existed are
 * longer, and the schema's own limit stays wide so they remain saveable —
 * approving or recomputing a historic entry must not fail over a rule that did
 * not exist when it was submitted.
 */
export const DESCRIPTION_MAX_CHARS = 22;

/**
 * รายละเอียดงานที่ทำ, as it is allowed to be stored. Returns `{ value }` or
 * `{ error }`.
 *
 * It lives beside the number rather than in a route, because every write path
 * — submit, HR correction, and the retired Express server — has to answer the
 * question the same way, and the browser's own `maxlength` is a convenience
 * rather than the enforcement.
 */
export function normaliseDescription(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { error: 'กรุณาระบุรายละเอียดงานที่ทำ' };
  if (value.length > DESCRIPTION_MAX_CHARS) {
    return { error: `รายละเอียดงานที่ทำต้องไม่เกิน ${DESCRIPTION_MAX_CHARS} ตัวอักษร (ขณะนี้ ${value.length})` };
  }
  return { value };
}

/**
 * [OPEN 10] Holiday calendar format and [OPEN 11] employee roster format are
 * not arithmetic, so they are not flags — both import paths are built. See
 * `app/api/holidays/import/` and `app/api/employees/import/`: each accepts a CSV
 * upload *and* manual entry, so either HR answer is already covered.
 */

export function resolvePolicy(overrides = {}) {
  return Object.freeze({ ...DEFAULT_POLICY, ...overrides });
}
