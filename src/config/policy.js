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
   * ยังไม่ยืนยันกับ HR ณ 2026-08-07 — ตั้งตามพฤติกรรมเดิม. 30 is what the
   * requirements doc says and what every figure in the database was computed
   * with; it is NOT an answer anybody in HR has given. See HR_UNCONFIRMED
   * below: until they answer, this is a reading of the old paper, not a rule.
   */
  roundingIncrementMinutes: 30,
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
   * Where a HR rejection lands: 'employee' (DEFAULT — becomes `rejected`, the
   * employee corrects and resubmits, restarting at the manager) or 'manager'
   * (back to `pending_mgr` for the manager to re-review).
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

  // ── ฝ่ายบุคคลบันทึก OT ให้ จากรายการวันเกิด ─────────────────────────────────
  /**
   * When ฝ่ายบุคคล files a birthday-holiday request from วันเกิดที่ยังไม่มีใบ,
   * having read the in and out times off the fingerprint scanner, does that one
   * act both file and approve it?
   *
   * true  — the request is written `approved` (DEFAULT), carrying a single
   *         `submit_hr_verified` history row that names HR as both the person
   *         who filled it in and the person who signed it, with the reason on
   *         it. `managerDecision` stays empty, because no หัวหน้า saw it.
   * false — it starts at `pending_mgr` like any other request and waits for the
   *         department's หัวหน้า.
   *
   * The default is the shortcut because the evidence is genuinely in HR's hands
   * for this one case: the scan record answers both questions a หัวหน้า would be
   * asked, and asking them to repeat it down the phone adds a signature and no
   * information. "We want the หัวหน้า in the loop regardless" is a defensible
   * answer HR is entitled to give, which is why it is a flag rather than an
   * assumption.
   *
   * NARROW BY CONSTRUCTION. It is read in exactly one place —
   * `birthdayDirectApproval` in lib/birthdayFiling.js — which refuses outright
   * unless the date is the one the birthday rule itself produced for that
   * person. It cannot widen to ordinary OT: POST /api/entries has no branch that
   * reaches it and no branch that can write `approved`.
   *
   * COSMETIC in the sense lib/policyVersion.js means: it changes which desk a
   * request lands on and not one figure on it. The hours come from the engine
   * over the times that were typed, identically either way.
   */
  hrDirectApproveBirthday: true,

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
});

/**
 * The rules the system is running on that NOBODY IN HR HAS AGREED TO.
 *
 * Every value in DEFAULT_POLICY is a default, and saying so on the settings
 * page — as its subtitle already does — tells a reader nothing, because it is
 * equally true of the twenty flags HR has no opinion about. These three are
 * different in kind: they were reverse-engineered from how the old paper
 * appears to have been filled in, they each move hours, and no one has
 * confirmed any of them. A default nobody chose and a default somebody read off
 * a stack of 2025 timesheets both print as "ค่าเริ่มต้น" and only one of them
 * is a liability.
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
    id: 'roundingIncrement',
    /**
     * The badge used to sit on `roundingMode`, because the increment was a
     * number in this file with no row on the settings page to wear it — the
     * same stand-in `minimumScope` had, and retired the same way. The increment
     * has its own dropdown now, so the badge moved onto the flag the question is
     * actually about. `roundingMode` is not unconfirmed: 'floor' is the
     * requirements doc's own recommendation.
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
      + '— ไม่ใช่คำตอบที่ใครในฝ่ายบุคคลเคยให้ไว้ '
      + '· เปลี่ยนข้อนี้แล้วชั่วโมงของใบที่ยังไม่อนุมัติจะเปลี่ยนตาม',
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
      + 'ไม่ใช่เพราะตอบแล้วว่าไม่ต้องมี',
  }),
]);

/** One item's current answer, read off the live policy rather than restated. */
export function readUnconfirmed(item, policy = DEFAULT_POLICY) {
  return typeof item.reading === 'function' ? item.reading(policy) : String(item.reading ?? '');
}

/** Every settings-page key that some unconfirmed question is about. */
export function unconfirmedKeys(confirmations = {}) {
  const keys = new Set();
  for (const item of HR_UNCONFIRMED) {
    if (confirmations?.[item.id]) continue;
    for (const key of item.keys) keys.add(key);
  }
  return keys;
}

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
 * `src/routes/holidays.js` and `src/routes/employees.js`: each accepts a CSV
 * upload *and* manual entry, so either HR answer is already covered.
 */

export function resolvePolicy(overrides = {}) {
  return Object.freeze({ ...DEFAULT_POLICY, ...overrides });
}
