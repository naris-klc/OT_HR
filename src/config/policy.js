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
  /** Increment in minutes. 30 per the requirements doc. */
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
  /** 'raise' — pad up to minimumHours. 'reject' — refuse the entry. */
  belowMinimum: 'raise',
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

  // ── [OPEN 8] Hitting the department cap: block or warn? ────────────────────
  /** 'warn' — allow through with a flag for HR (DEFAULT). 'block' — refuse. */
  capBehaviour: 'warn',

  // ── [OPEN 9] Does the cap count clock hours or weighted hours? ─────────────
  /**
   * 'clock'    — hours actually worked. Example D counts 14 (DEFAULT).
   * 'weighted' — hours × multiplier. Example D counts 31.5.
   */
  capBasis: 'clock',

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
