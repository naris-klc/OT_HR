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
  /** 'floor' | 'ceil' | 'nearest'. Default 'floor': never over-reports hours. */
  roundingMode: 'floor',
  /**
   * Increment in minutes.
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

  // ── [OPEN 4] Session under the 1-hour minimum: reject or round up? ─────────
  /**
   * 'raise' — pad up to minimumHours. 'reject' — refuse the entry.
   *
   * ยังไม่ยืนยันกับ HR ณ 2026-08-07 — ตั้งตามพฤติกรรมเดิม. The shipped default
   * used to be 'raise' while the live database carried a 'reject' override, so
   * every entry ever computed here was rejected below the minimum and the file
   * said otherwise. Pinning it to 'reject' does not change a single stored
   * figure; it stops the file and the database disagreeing about what the
   * system has been doing. HR has still not answered [OPEN 4] — see
   * HR_UNCONFIRMED below.
   */
  belowMinimum: 'reject',
  /**
   * The minimum, in hours.
   *
   * ยังไม่ยืนยันกับ HR ณ 2026-08-07 — ตั้งตามพฤติกรรมเดิม.
   *
   * WHAT IS UNCONFIRMED IS NOT ONLY THE NUMBER. The engine applies this to the
   * SESSION total — one entry, one minimum, whatever mix of buckets it lands in
   * (see `computeSession`, where `totalMinutes` is summed across every bucket
   * before the comparison). "ต่อใบ", in other words. Whether HR means that or
   * one minimum per rate column is the open question, and there is no flag for
   * the other reading because nothing in the system implements it.
   */
  minimumHours: 1,

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
 * about. Empty `keys` is a real case and the reason `reading` exists: the
 * minimum's scope is a rule the engine has but the policy has no flag for, so
 * there is no dropdown to hang a badge on and the current behaviour has to be
 * stated in words.
 */
export const HR_UNCONFIRMED_SINCE = '2026-08-07';

export const HR_UNCONFIRMED = Object.freeze([
  Object.freeze({
    id: 'roundingIncrement',
    label: 'ปัดเศษชั่วโมง OT ทีละกี่นาที',
    keys: Object.freeze(['roundingMode']),
    reading: (policy) => `ทีละ ${policy.roundingIncrementMinutes} นาที`,
    note: 'ค่าที่ใช้อยู่คือ 30 นาที (ครึ่งชั่วโมง) ตามเอกสารข้อกำหนดและตามที่ทุกใบในระบบถูกคำนวณมา '
      + '· ถ้าคำตอบคือชั่วโมงเต็ม ชั่วโมงของใบที่ยังไม่อนุมัติจะเปลี่ยน',
  }),
  Object.freeze({
    /**
     * Not 'belowMinimum'. An id that collides with a policy key makes
     * `{ [id]: {...} }` read as a policy override to anything scanning the
     * settings document loosely — see test/policyConfirmation.test.js, which
     * is what caught it.
     */
    id: 'belowMinimumAction',
    label: 'ต่ำกว่าขั้นต่ำ 1 ชม. ให้ปัดขึ้นหรือไม่รับ',
    keys: Object.freeze(['belowMinimum']),
    reading: (policy) => (policy.belowMinimum === 'reject' ? 'ไม่รับรายการ' : 'ปัดขึ้นเป็น 1 ชม.'),
    note: 'ค่าที่ใช้อยู่คือ “ไม่รับรายการ” ซึ่งเป็นสิ่งที่ระบบทำมาตลอด '
      + '(ฐานข้อมูลตั้ง reject ทับไว้ ทั้งที่ไฟล์เขียนว่า raise — ตอนนี้ตรงกันแล้ว)',
  }),
  Object.freeze({
    id: 'minimumScope',
    label: 'ขั้นต่ำ 1 ชม. นับต่อใบหรือต่อช่อง',
    /** No flag exists for the other reading, so no dropdown wears this badge. */
    keys: Object.freeze([]),
    reading: () => 'ต่อใบ (รวมทุกช่องก่อนเทียบกับขั้นต่ำ)',
    note: 'ระบบนับต่อใบ — รวมชั่วโมงทุกช่องในใบนั้นก่อน แล้วจึงเทียบกับ 1 ชม. '
      + '· ยังไม่มีค่าตั้งสำหรับการนับต่อช่อง ถ้าคำตอบคือต่อช่อง ต้องแก้ตัวคำนวณ ไม่ใช่แก้ค่า',
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
