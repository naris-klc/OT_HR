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
   * with; it is NOT an answer anybody in HR has given — and since 2026-09-08
   * no screen says so either, because the list that tracked it was withdrawn.
   * See the note where HR_UNCONFIRMED used to be, further down this file.
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
   * ever adds, and it is not confirmed policy — it carried a badge of its own
   * until the list was withdrawn on 2026-09-08. It shared the increment's for the morning of
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
   * ยังไม่ยืนยันกับ HR ณ 2026-08-07 — HR ยังไม่ตอบ [OPEN 4]. Changing which
   * reading we run on is not the same act as HR answering the question, and
   * from 2026-09-08 nothing on any screen keeps those two apart: the badge and
   * the sign-off that recorded the difference were withdrawn, so this comment
   * is now the only place it is written down.
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
   * ยังไม่ยืนยันกับ HR ณ 2026-08-07 — it was `minimumScope` on the withdrawn
   * list. Until this existed the other reading was not a value but a rewrite of
   * the engine, which is why the badge for it had no dropdown to sit on.
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
   * false — it waits at `pending_mgr` like every other request (DEFAULT), for
   *         the หัวหน้า who wrote it to open รออนุมัติ and press อนุมัติ on it.
   * true  — it goes straight to `pending_hr`, with the reason written into its
   *         history (`SKIP_NOTE`).
   *
   * ─────────────────────────────────────────────────────────────────────────
   * IT DEFAULTED TO `true` UNTIL 2026-09-09, AND THE ARGUMENT THAT PUT IT
   * THERE IS STILL A TRUE SENTENCE — it is no longer the one that decides.
   *
   * That argument: a หัวหน้า pressing อนุมัติ on a form they typed has checked
   * nothing, while the trail it leaves reads ยื่นคำขอ → หัวหน้างานอนุมัติ →
   * ฝ่ายบุคคลยืนยัน, which is indistinguishable on the page from two people
   * agreeing. Skipping openly looked worse and said something true: this
   * reached HR approved by nobody.
   *
   * HR asked for the other answer on 2026-09-09, in those words — บันทึกแทน
   * ให้รอหัวหน้าอนุมัติด้วย. A filing is a claim about somebody ELSE'S hours,
   * and the press afterwards is the moment the หัวหน้า takes responsibility
   * for the figures on it. It is a press that can be declined: ไม่อนุมัติ sits
   * on the same row, and a filing typed in error is now refused on the screen
   * it was typed from instead of travelling to HR as an approved request.
   *
   * WHAT KEEPS THE TRAIL HONEST NOW THAT NOTHING IS SKIPPED. The screens do
   * not have to be believed about how many people looked: both names are on
   * the entry and both are printed. `SignatureFacts` writes ผู้บันทึกแทน
   * อนุมัติเอง under the หัวหน้างานอนุมัติ box whenever the approver IS the
   * filer, so no sheet claims two people where there was one.
   *
   * COSMETIC — it moves no hour, only which desk the request is on. The rule
   * itself is `initialStatus` in lib/proxyFiling.js; the permission that lets
   * the filer press their own button is `approvalPermission` in
   * lib/delegation.js, and the two must be read together.
   */
  proxySkipsOwnApproval: false,
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
   * 'draft'    — ตั้งแต่ยื่น: อนุมัติแล้ว + รอ HR + รอหัวหน้า (DEFAULT since
   *              2026-09-09). `?status=` is IGNORED. What the route did
   *              unconditionally before this flag existed, and what HR asked
   *              for again — see below.
   * 'signed'   — ตั้งแต่หัวหน้าอนุมัติ: อนุมัติแล้ว + รอ HR. `?status=` is
   *              IGNORED, as under 'approved'. It was the DEFAULT for two days,
   *              2026-09-07 to 2026-09-09.
   * 'approved' — เฉพาะรายการที่ฝ่ายบุคคลยืนยันแล้ว. The narrower half of the
   *              answer above, kept because it is a different document: a
   *              month already settled, printed to file. `?status=` is IGNORED
   *              under this answer too, which is the point of it — a strict
   *              setting has to be strict against a hand-edited URL, or it is a
   *              suggestion. It was the DEFAULT until 2026-09-07.
   * 'screen'   — whatever สถานะที่นับ on ตรวจสอบรายเดือน is set to, clamped by
   *              `reportStatuses`. The screen and the paper then quote the same
   *              figures for the same person, which they do not today.
   *
   * ── WHY THE DEFAULT MOVED, AND WHAT IT WAS GETTING WRONG ──────────────────
   *
   * HR, 2026-09-09, with the empty sheet in front of them: *ให้ขึ้นรายการที่
   * รออนุมัติไว้เลย ให้รอแค่ชื่อผู้อนุมัติเมื่ออนุมัติจริง*. The document this
   * form IS — ใบขออนุมัติทำงานล่วงเวลา — is the one taken to the person who
   * approves it, so a sheet that waits for the approval before it will print
   * the row cannot be used for the errand it is named after. The rows go on as
   * soon as they are filed; the one thing that waits for a real approval is the
   * NAME in the ลงชื่อหัวหน้างาน column, which stays blank until somebody
   * presses อนุมัติ (`managerSignature` in lib/approverLine.js answers null, and
   * `Signed` in components/PrintForm.jsx renders nothing at all for null).
   *
   * IT MOVES A LINE THAT HAS MOVED TWICE BEFORE, and the history is the reason
   * to be careful with it rather than a reason to leave it alone:
   *
   *   2026-08-24 — the live policy was set back to 'approved' with the note
   *     *กลับเป็นค่าเริ่มต้น — ใบที่เซ็นรับต้องมีเฉพาะรายการที่อนุมัติแล้ว*.
   *   2026-09-07 — the default became 'signed': *ข้อมูลที่พนักงานยื่นขอโอที
   *     ต้องขึ้นในใบขออนุมัติทำงานล่วงเวลา ตั้งแต่ตอนที่มีคนกดอนุมัติ*. That was
   *     the LAST signature giving way to the FIRST one.
   *   2026-09-09 — this. The line moves off the approvals altogether: the sheet
   *     carries what was FILED, and the signature column carries what was
   *     approved.
   *
   * All three sentences are about one fear — paper that says more than the app
   * does — and the answer to it is now on the paper itself rather than in the
   * query: an unapproved row prints with an empty ลงชื่อหัวหน้างาน box beside
   * it, and an empty signature box is what an unsigned line looks like on every
   * paper form there has ever been.
   *
   * WHAT THE FLAG IS STILL FOR. The failure it was written for is a สรุปรวม
   * that a หัวหน้า signs for while the app still has rows waiting for their
   * decision — real, and now answered per ROW rather than per SHEET. 'approved'
   * and 'signed' are both still here for the reader who wants the narrower
   * document: a month printed to file after it is settled is not the same piece
   * of paper as a month printed to be signed.
   *
   * A รอหัวหน้า row says so on the paper as well: `(รออนุมัติ)` prints in the
   * รายละเอียดงานที่ทำ cell, where [ไม่พักเที่ยง] and (แทน) already sit. Not a
   * column and not a row — F-HR-027 Rev.4 is a controlled form measured in
   * millimetres against the paper, and a remark in the cell HR already reads is
   * not a revision of it. Under this default a รอ HR row is marked too, and
   * that is `formPendingStatuses` doing what it has always done: it drops the
   * mark from รอ HR only while no รอหัวหน้า row can reach the same sheet, since
   * marking one queue and not the other would read as "these are the unapproved
   * rows" on a sheet carrying both.
   *
   * COSMETIC in the strict sense lib/policyVersion.js means. Every hour on the
   * sheet comes from stored `segments`, resolved when the entry was filed; this
   * decides which entries are fetched to print and never what any of them is
   * worth. Flipping it must recompute nothing.
   *
   * The rule is `formPrintStatuses` in lib/reports.js, and it is applied by the
   * ROUTE rather than by the screen — see app/api/reports/form/[period]/route.js.
   */
  formPrintScope: 'draft',

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
 * HR_UNCONFIRMED LIVED HERE UNTIL 2026-09-08, AND WHAT IT DID IS WORTH KNOWING
 * BEFORE ANYBODY BUILDS IT AGAIN.
 *
 * Every value in DEFAULT_POLICY is a default, and saying so on the settings
 * page tells a reader nothing, because it is equally true of the twenty flags
 * nobody in HR has an opinion about. Six of them were different in kind: they
 * were reverse-engineered from how the old paper appears to have been filled
 * in, or invented outright, and they each move hours — เศษที่ไม่ครบบล็อก
 * ปัดขึ้นหรือปัดลง · ปัดเศษทีละกี่นาที · เกือบครบบล็อกแล้ว ปัดขึ้นให้กี่นาที ·
 * ต่ำกว่าขั้นต่ำ 1 ชม. ให้รับ ปัดขึ้น หรือไม่รับ · ขั้นต่ำ 1 ชม. นับต่อใบหรือ
 * ต่อช่อง · ต้องทำเกินกี่นาที จึงเริ่มนับเป็น OT.
 *
 * A default nobody chose and a default somebody read off a stack of 2025
 * timesheets both print as "ค่าเริ่มต้น", and only one of them is a liability.
 * This list was the difference, an amber badge said which rows were in it, and
 * a ยืนยัน button wrote down who answered one and when.
 *
 * WITHDRAWN 2026-09-08, ASKED FOR AND CONFIRMED: the sign-off form sat open on
 * every unanswered row — a labelled text box, a button and a grey sentence,
 * four to six of them at once — and the page was wanted clear. The whole
 * mechanism went with it: this list, `readUnconfirmed`, the badge, the two
 * endpoints, `Setting.policyConfirmations` and lib/policyConfirmations.js.
 *
 * WHAT WENT WITH IT, so nobody has to rediscover it: no screen can now tell a
 * rule ฝ่ายบุคคล actually answered from a rule this system read off the old
 * paper. They print identically, and the questions themselves are still open —
 * the buffer still ships at a figure nobody named, and ต่ำกว่าขั้นต่ำ 1 ชม.
 * still runs on a reading rather than an answer. The record of the four
 * signed on 2026-08-14 is still in the database and is not ours to delete; see
 * the note where the field used to be in src/models/Setting.js.
 */

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
