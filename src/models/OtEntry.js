import mongoose from 'mongoose';
import { model } from './model.js';
import { BUCKETS, DAY_REASONS } from '../lib/otEngine.js';
import { WITHDRAWAL_STATES } from '../../lib/withdrawal.js';

export const STATUSES = ['pending_mgr', 'pending_hr', 'approved', 'rejected', 'cancelled'];

export const STATUS_LABEL_TH = Object.freeze({
  pending_mgr: 'รอหัวหน้า',
  pending_hr: 'รอ HR',
  approved: 'อนุมัติ',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
});

/**
 * §12.1 — one entry, multiple rate buckets. `hours` cannot be a single number,
 * so each entry carries the computed segments plus per-bucket totals.
 *
 * These are DENORMALISED results from src/lib/otEngine.js. They are recomputed
 * on every write (and by `npm run recompute`) rather than trusted from the
 * client, so a change to the holiday calendar or to a policy flag can be
 * replayed across historic entries.
 */
const segmentSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },        // 'YYYY-MM-DD'
    start: { type: String, required: true },       // 'HH:MM'
    end: { type: String, required: true },         // 'HH:MM'
    dayType: { type: String, enum: ['workday', 'holiday'], required: true },
    /**
     * Why it was that kind of day. Optional and unvalidated against a required
     * list, for the reason every field in `snapshotSchema` is optional:
     * mongoose validates the whole document on save, and every segment written
     * before this field existed would otherwise make its entry unsaveable.
     *
     * Absent means "not recorded", NOT "no reason" — an old holiday segment is
     * still a holiday segment. Readers must treat it as a label they may or may
     * not have, which is also why nothing in the arithmetic reads it.
     */
    dayReason: { type: String, enum: [...Object.values(DAY_REASONS), null] },
    bucket: { type: String, enum: Object.values(BUCKETS), required: true },
    multiplier: { type: Number, required: true },  // bucket label, not a rate
    minutes: { type: Number, required: true },
    hours: { type: Number, required: true },
  },
  { _id: false },
);

/**
 * One ceiling this entry passed, in the shape `capBreaches` returns.
 *
 * Its own schema, and `_id: false`, for the reason `segmentSchema` above has
 * both: these are values, not records — nothing ever refers to one — and an id
 * per row would be noise in every snapshot.
 *
 * Every field optional, like `snapshotSchema`: mongoose validates the whole
 * document on save, and a required field here would make an entry written by an
 * older version of this file unsaveable — you could no longer approve or
 * recompute a historic month.
 */
const breachSchema = new mongoose.Schema(
  {
    scope: { type: String },        // 'month' | 'week'
    key: { type: String },          // the period, or the week's start date
    label: { type: String },        // how it is printed
    capHours: Number,
    usedHoursBefore: Number,
    adding: Number,
    projected: Number,
    overBy: Number,
  },
  { _id: false },
);

/**
 * What an entry said BEFORE an edit rewrote it.
 *
 * `history` has always recorded who changed an entry and why, but never WHAT it
 * used to say: an edit overwrites วันที่/เวลา/รายละเอียด in place, and the
 * version the employee originally filed was gone. F-HR-027 printing the latest
 * values is right — the form is what payroll pays against — but the manager who
 * approved different hours, and HR reconciling a month against the signed
 * paper, both need to see what those values replaced.
 *
 * Every field here is optional, on purpose. Mongoose validates the whole
 * document on save, so a `required` field would make every entry written before
 * this schema existed unsaveable — you could no longer approve, cancel or
 * recompute a historic month.
 */
const snapshotSchema = new mongoose.Schema(
  {
    workDate: String,
    startTime: String,
    endTime: String,
    endsNextDay: Boolean,
    noBreakTaken: Boolean,
    /* เหมารายวัน. Optional like every field here — a snapshot written before
       2026-09-03 has no answer, and `sameValue` reads absent as false, which is
       what it was. */
    flatDaily: Boolean,
    description: String,
    /** The hours those values computed to — what the form printed at the time. */
    buckets: {
      [BUCKETS.OT15_WEEKDAY]: Number,
      [BUCKETS.OT15_HOLIDAY]: Number,
      [BUCKETS.OT3_HOLIDAY]: Number,
    },
    otHours: Number,
    /**
     * ชั่วโมงทำงานปกติ, so that toggling เหมารายวัน leaves a readable trail.
     * That one tick moves a day's hours OUT of the rate columns and into this
     * figure, and a `before` holding only `otHours` would record the entry
     * dropping to nought with nothing saying where the eight went.
     */
    normalHours: Number,
    /**
     * And which rule set produced them. Without it a `before` block says the
     * hours moved but not whether the session did — an edit and a policy change
     * leave the same trace, and only one of them is the employee's doing.
     */
    policyVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'PolicyVersion' },
  },
  { _id: false },
);

const historySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    byName: String,
    action: {
      type: String,
      // 'edit' is the employee correcting their own request while it is still
      // pending_mgr; 'hr_edit' is HR correcting one at any live status.
      // 'resubmit' is no longer written — a rejected request is re-filed as a
      // new one — but entries from before that rule still carry it, and a
      // value dropped from this list would make those entries fail validation
      // the next time anything touched them.
      // 'submit_birthday' is the request the system wrote because HR pressed
      // สร้างใบวันเกิดของเดือนนี้ — nobody filled a form in, which is a fact
      // about the row that only its history can carry. See
      // lib/birthdayEntries.js.
      // 'void' is ฝ่ายบุคคล retracting a generated row that nobody has touched —
      // the way back out of an entry that was confirmed on creation. Its own
      // action, not a 'cancel', because 'cancel' means the employee withdrew
      // their own request and that is a different event with a different actor.
      // 'submit_hr_verified' is ฝ่ายบุคคล filing a birthday-holiday request from
      // วันเกิดที่ยังไม่มีใบ with the in/out times read off the fingerprint
      // scanner, and approving it in the same act. ONE row for one event, and
      // the only action in this list whose `toStatus` is 'approved' without an
      // 'approve_*' before it — which is the fact it exists to record. There is
      // no matching manager block on the entry, deliberately.
      //
      // RETIRED 2026-09-03. No new row can carry this action — the queue, the
      // route and the policy flag behind it were all withdrawn — but rows that
      // already do are still in the database and still have to load, which is
      // why the value stays in this enum and `isHrVerifiedBirthday` still reads
      // it.
      // 'withdraw_request' is the employee ASKING for a signed entry to be
      // taken back, and it is the only action in this list that changes no
      // status — the entry stays approved and keeps counting until somebody
      // answers. Its two answers are 'withdraw_grant', which ends at
      // 'cancelled', and 'withdraw_refuse', which ends where it started. Three
      // actions rather than reusing 'cancel' because the trail has to be able
      // to say who asked as well as who released it; 'cancel' means the
      // employee withdrew a request nobody had signed, and that is a different
      // event with one actor instead of two. See lib/withdrawal.js.
      enum: [
        'submit', 'submit_proxy', 'submit_birthday', 'submit_hr_verified', 'resubmit',
        'approve_mgr', 'reject_mgr', 'approve_hr', 'reject_hr',
        'cancel', 'void', 'edit', 'hr_edit', 'recompute',
        'withdraw_request', 'withdraw_grant', 'withdraw_refuse',
      ],
      required: true,
    },
    note: String,
    fromStatus: String,
    toStatus: String,

    /**
     * Whose authority this action was taken under, when that is not the person
     * who took it.
     *
     * Written by an approval or a refusal made by a ผู้รับช่วง — `by` stays the
     * person who pressed the button and this says on whose behalf. The pair is
     * the whole point: a trail holding only the name of whoever acted can say
     * that B signed but not why B was allowed to, and "why was B allowed to" is
     * the question a disputed figure actually raises. Collapsing the two into
     * one name loses one of them for good, and there is nothing else on the
     * entry that remembers.
     *
     * Absent on every ordinary decision, which is nearly all of them, and on
     * every decision recorded before delegation existed.
     */
    onBehalfOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    /**
     * The same name, copied. Denormalised for the reason `byName` is: a person
     * leaves, their document goes, and a trail that has to resolve a pointer to
     * stay readable stops being readable at exactly the moment somebody is
     * asking about the months they worked.
     */
    onBehalfOfName: String,
    /**
     * And where the authority came from — the window, who granted it, when.
     *
     * A name answers "who signed". This answers "on what basis", which no
     * amount of names can. Without it the trail says B acted for A and leaves
     * whoever is checking to take that on trust; with it there is a record with
     * dates on it that either covers the day the decision was made or does not.
     */
    delegationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalDelegation' },
    /**
     * ผู้ดูแลระบบ signed the หัวหน้า step because the department had no หัวหน้า
     * who could — the fourth answer to "on what basis", and the only one where
     * the basis is that there was nobody.
     *
     * Its own field precisely because the three above are all empty for it.
     * Left to those, an administrator's override is indistinguishable from an
     * ordinary manager signing their own team's request, and the one line in
     * the trail that most needs explaining would be the quietest one on it.
     *
     * `note` is never empty on one of these — `approvalPermission` refuses the
     * decision without a reason — so the row always carries both the fact and
     * the why. Absent on every other decision and on every one recorded before
     * this existed; present always means it happened.
     */
    adminOverride: Boolean,

    /**
     * The entry as it stood immediately before this action, written only by the
     * actions that rewrite it ('edit', 'hr_edit') and only when something
     * actually changed. Absent everywhere else — including on every edit
     * recorded before this field existed, which is why readers must treat it as
     * optional rather than as "nothing changed".
     */
    before: snapshotSchema,
  },
  { _id: false },
);

const otEntrySchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true, index: true },

    /**
     * Who put the request in — the employee themselves, or the หัวหน้า who
     * filled the form in for them.
     *
     * A field of its own rather than a flag, because "somebody else filed this"
     * is only half an answer: the employee reading their own OT ของฉัน, the
     * ฝ่ายบุคคล reconciling a month and the manager signing the paper all need
     * the name. It never moves `employee`, which stays the person who worked
     * the hours and whose department, cap and birthday the figures come from —
     * the two fields answer different questions and conflating them would put
     * a หัวหน้า's name on hours they did not work.
     *
     * Written on EVERY entry from here on, including the ordinary ones where it
     * equals `employee`, so that the question "was this filed by somebody else"
     * is a comparison of two present values rather than a rule with an
     * exception in it. Entries written before this field existed carry nothing,
     * and for them absent means self-filed — which is provable rather than
     * assumed: `POST /api/entries` accepted only callers passing
     * `maySubmitOt()` and wrote the caller as the employee. It is the one field
     * in this schema whose absence has a known meaning; `capSnapshot.breaches`
     * and `dayReason` above are the ordinary case, where absent means only
     * "not recorded".
     *
     * Not `required`, for the same reason nothing else added later is: mongoose
     * validates the whole document on save, and a required field here would
     * make every historic entry unsaveable the next time anything touched it.
     */
    filedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
      index: true,
    },

    // ── §12.2: sessions cross midnight ──────────────────────────────────────
    // Wall-clock fields are the source of truth: no timezone can move them,
    // and they map one-to-one onto a row of the paper form. `endsNextDay`
    // replaces the old "end must be after start" rule.
    /**
     * วันที่ the session STARTS. 'YYYY-MM-DD'.
     *
     * SHAPE ONLY. How far AHEAD of today this may be is
     * `maxAdvanceSubmissionDays`, and it is enforced by
     * `advanceSubmissionRefusal` in lib/entries.js on the way in — not here —
     * for the two reasons the `description` field below is capped loosely for:
     *
     *   Mongoose validates the whole document on save, so a bound checked here
     *   would fire on entries that are merely being APPROVED, corrected or
     *   replayed. A request filed for tomorrow, legitimately, becomes one that
     *   cannot be signed off the day after — and a window that HR later tightens
     *   would strand every entry filed under the looser one.
     *
     *   And a validator here can only read DEFAULT_POLICY. The live answer may
     *   have been moved by a stored override (see `Setting.effectivePolicy`),
     *   so the schema would enforce a number nobody is running on. The write
     *   paths have the effective policy in hand and are the only place the real
     *   rule can be asked.
     */
    workDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    /** จาก — 'HH:MM'. */
    startTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    /** ถึง — 'HH:MM'. May be earlier than startTime when endsNextDay is set. */
    endTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    endsNextDay: { type: Boolean, default: false },

    /** ไม่พักเที่ยง — skip the break deduction (§3). New in v1 per §12. */
    noBreakTaken: { type: Boolean, default: false },

    /**
     * เหมารายวัน — this day was hired whole, so it counts eight NORMAL hours
     * and no OT at all, however long the person stayed and whatever the scanner
     * recorded. `flatDailyMinutes` in src/lib/otEngine.js is the eight; the
     * branch in `computeSession` is what empties the three rate columns. This
     * is the tick that asks for both.
     *
     * AN ENTERED FIELD, not a computed one. It is on the request because HR's
     * rule (2026-09-03) is that flat days are neither every day nor everybody —
     * the department-wide `otMode: 'daily'` beside it (lib/otMode.js) answers a
     * different question and still answers it. So this cannot be derived from
     * the roster or the calendar: only the person filling the form in knows
     * which day was sold that way, which is why it is in `ENTERED_FIELDS` and
     * why an edit that only toggles it is a real edit with a `before` on it.
     *
     * `false` on every row written before 2026-09-03, which is correct rather
     * than merely convenient: nothing was capped before the tick existed.
     */
    flatDaily: { type: Boolean, default: false },

    /**
     * รายละเอียดงานที่ทำ — prints in the form's description column.
     *
     * New text is capped at DESCRIPTION_MAX_CHARS on the way in (see
     * `normaliseDescription` in lib/entries.js). This limit is deliberately
     * looser: Mongoose validates the whole document on save, so tightening it
     * here would make every entry written before the cap unsaveable — you
     * could no longer approve, cancel or recompute a historic month.
     */
    description: { type: String, required: true, trim: true, maxlength: 500 },

    // ── computed ────────────────────────────────────────────────────────────
    segments: { type: [segmentSchema], default: [] },
    buckets: {
      [BUCKETS.OT15_WEEKDAY]: { type: Number, default: 0 },
      [BUCKETS.OT15_HOLIDAY]: { type: Number, default: 0 },
      [BUCKETS.OT3_HOLIDAY]: { type: Number, default: 0 },
    },
    totals: {
      otHours: { type: Number, default: 0 },
      weightedHours: { type: Number, default: 0 },
      ot15Hours: { type: Number, default: 0 },
      ot3Hours: { type: Number, default: 0 },
      clockHours: { type: Number, default: 0 },
      breakHours: { type: Number, default: 0 },
      /**
       * ชั่วโมงทำงานปกติ — hours that are not OT and are in none of the three
       * columns above. **Nothing writes a non-zero here any more.**
       *
       * It held the eight hours of a เหมารายวัน day for exactly three days:
       * 2026-09-04, when the flat rule stopped claiming OT, until 2026-09-07,
       * when HR made those eight hours OT ×1.5 in the column the day type
       * decides (*ถ้าวันหยุดก็ใส่ 8 ชั่วโมงวันหยุด ถ้าไม่ใช่วันหยุดก็ใส่ 8
       * ชั่วโมงวันปกติ แต่แค่เป็นแบบเหมา*). A flat day now carries its figure in
       * a rate column like every other request.
       *
       * KEPT, NOT DELETED, and the rows are the reason: entries written in those
       * three days still hold their eight here, and they keep them until
       * somebody recomputes the month. A field removed from this schema is a
       * field mongoose drops the next time one of those documents is saved —
       * which is how the only record of how a figure was arrived at disappears
       * during an unrelated approval. Same decision, and the same reasoning, as
       * `csvDateOrder` in src/models/Setting.js.
       *
       * `0` everywhere else, which is right rather than merely the default: an
       * OT request makes no claim about ordinary working hours at all.
       */
      normalHours: { type: Number, default: 0 },
    },
    /**
     * e.g. NORMAL_HOURS_IGNORED, RAISED_TO_MINIMUM — shown to reviewers.
     *
     * `bucket` is set only where a warning is about ONE rate column rather than
     * the entry: the minimum under `minimumHoursScope: 'bucket'` produces one
     * warning per short column, and without a field for it mongoose would drop
     * the only thing telling two otherwise identical sentences apart.
     */
    warnings: {
      type: [{ code: String, message: String, minutes: Number, bucket: String }],
      default: [],
    },

    /**
     * The rule set the figures above were produced by — stamped by
     * `applyComputation` on every path that writes them, and never on its own.
     *
     * The [OPEN] answers can change mid-month, and when one does only entries
     * still in flight are replayed (see app/api/settings/policy). That is the
     * right call — restating a signed number silently is worse than an
     * inconsistency — but it leaves a month holding hours arrived at two
     * different ways, and until this field existed there was no way to tell
     * which row was which, then or ever afterwards.
     *
     * Optional, and it stays optional, for the reason `description`'s limit is
     * loose and every field in `snapshotSchema` is: mongoose validates the whole
     * document on save, so a `required` pointer would make every entry written
     * before the migration ran unsaveable — you could no longer approve, cancel
     * or recompute a historic month. A null here means "filed before the rules
     * were being recorded", which is a fact about the entry, not a broken one.
     */
    policyVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PolicyVersion',
      default: null,
      index: true,
    },

    // ── approval flow (§6) ──────────────────────────────────────────────────
    status: { type: String, enum: STATUSES, default: 'pending_mgr', required: true, index: true },
    /** 'YYYY-MM' — the month this entry rolls up into. Derived from workDate. */
    period: { type: String, required: true, index: true },

    /**
     * The manager's signature. `by` is whoever pressed the button; when that
     * was a ผู้รับช่วง, `onBehalfOf` names the manager whose queue it was and
     * `delegationId` points at the record that says why they could. See the
     * same three fields on `historySchema` above for why all three are kept.
     */
    managerDecision: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      at: Date,
      note: String,
      onBehalfOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      onBehalfOfName: String,
      delegationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalDelegation' },
      /**
       * Signed by ผู้ดูแลระบบ because the department had no หัวหน้า who could —
       * see the same field on `historySchema` above.
       *
       * ON THIS BLOCK AND NOT ON `hrDecision`, because there is no such thing
       * at the second step: ผู้ดูแลระบบ sign the HR step as themselves, by the
       * ordinary rule that has always let them. Only the first step can be
       * stood in for, and `approvalPermission` refuses the same person both.
       */
      adminOverride: Boolean,
    },
    hrDecision: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      at: Date,
      note: String,
      onBehalfOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      onBehalfOfName: String,
      delegationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalDelegation' },
    },
    rejectionReason: String,

    /**
     * [OPEN 8] Set when the entry pushed its department over a cap — the
     * monthly one, the weekly one, or both — and policy.capBehaviour is 'warn'.
     * HR sees the flag and decides.
     *
     * Stays a single boolean because that is the question every list screen
     * asks ("is there anything to look at on this row"). WHICH ceiling, and by
     * how much, is `capSnapshot.breaches` below.
     */
    capExceeded: { type: Boolean, default: false },

    /**
     * [OPEN 4] Set when the session came out under `minimumHours` and
     * policy.belowMinimum is 'accept' — the hours are recorded as worked and HR
     * decides what they are worth.
     *
     * A sibling of `capExceeded` and for the same reason: a list screen asks
     * "is there anything to look at on this row" and wants one boolean, while
     * WHAT was short is the `BELOW_MINIMUM_ACCEPTED` entry in `warnings`.
     *
     * Written by `applyComputation` together with the hours it describes, so a
     * replay under a policy where the entry is no longer short clears it. False
     * on every row filed under 'reject' or 'raise': neither leaves a short entry
     * behind to flag.
     */
    belowMinimumFlagged: { type: Boolean, default: false },
    /**
     * What the ceilings looked like at the moment this entry was filed.
     *
     * The three original fields are still here and still monthly. They are read
     * by rows written before the weekly cap existed and by screens that only
     * ever wanted the month, so renaming them would have bought a tidier shape
     * at the price of every historic row's snapshot reading as empty.
     *
     * `breaches` is the complete answer and the one new code should read: one
     * entry per ceiling actually passed, in the shape `capBreaches` returns.
     * Absent on rows written before the weekly cap; absent is "not recorded",
     * not "nothing was breached" — `capExceeded` is what says that.
     */
    capSnapshot: {
      capHours: Number,
      usedHoursBefore: Number,
      basis: String,
      /** The weekly side, and which week it was. Null when no weekly cap is set. */
      weeklyCapHours: Number,
      weeklyUsedHoursBefore: Number,
      /** 'YYYY-MM-DD' — the Monday (or whichever day) the week opened on. */
      weekStart: String,
      breaches: { type: [breachSchema], default: undefined },
    },
    /**
     * The rejected request this one was filed to replace.
     *
     * A refusal ends a request for good — the employee re-files rather than
     * reopening it, so the corrected version is a genuinely new document with
     * its own history starting at `submit`. Read on its own, that history says
     * a request appeared out of nowhere on a date nobody asked about, and the
     * manager reviewing it has no way to know they already refused it once or
     * what they said at the time.
     *
     * One pointer, child → parent, set once at creation and never rewritten.
     * The reverse direction is a query (`{ refiledFrom: id }`) rather than a
     * second field, because two pointers can disagree and an audit trail that
     * contradicts itself is worse than one that costs a lookup.
     *
     * NOT to be confused with the superseded-entry rule in lib/reports.js:
     * that is about the same session being FILED twice and only the latest
     * counting. This is one request replacing a refused one.
     */
    refiledFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OtEntry',
      default: null,
      index: true,
    },

    /**
     * The one request filed to replace this one — and the lock that makes
     * "once only" true.
     *
     * `refiledFrom` alone already describes the chain, and a reverse pointer
     * purely for navigation would be redundant. This one is not for
     * navigation. A limit of one re-filing cannot be enforced by reading
     * whether a child exists and then writing one: two taps on a slow
     * connection both read "no child yet" and both write. Claiming this field
     * with a single conditional update is the only version of the rule that
     * two requests cannot both win.
     *
     * Written by findOneAndUpdate guarded on `resubmittedTo: null`, and
     * cleared again if the child then fails to save — see app/api/entries.
     */
    resubmittedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OtEntry',
      default: null,
    },

    /** HR or Admin waiving the cap for this entry (§7). */
    capOverride: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      at: Date,
      reason: String,
    },

    /**
     * WHY THE PERSON WHO SIGNED THIS SIGNED IT, on an entry that was over a
     * ceiling when it was filed — required of อนุมัติ and of ไม่อนุมัติ alike
     * since 2026-09-02. See `overCeilingRefusal` in lib/caps.js.
     *
     * NOT A SECOND `capExceeded`. There is no `isOverCeiling` beside this and
     * there must not be: `capExceeded` above has meant exactly that since the
     * ceiling existed, a dozen screens, reports and tests read it, and a second
     * boolean for one idea is two booleans that will one day disagree with
     * nobody able to say which is right. This field is only the REASON, which
     * nothing held before.
     *
     * NOT `capOverride.reason` either, and the difference is what the sentence
     * is about. `capOverride` is ฝ่ายบุคคล WAIVING the ceiling — an exception
     * granted to the rule, which clears `capExceeded` — and its reason answers
     * "why is this allowed past the limit". This one answers "why did I sign a
     * request that is over the limit", is written by whoever pressed อนุมัติ or
     * ไม่อนุมัติ at either step, and changes nothing about the entry's hours.
     * A row can carry both: HR waived the ceiling, and the หัวหน้า who signed
     * it earlier said why they were passing it up. สรุป OT ส่งบัญชี prints them
     * as two separate lines for that reason.
     *
     * The reason is also in `history` — `entry.log()` records it beside the
     * decision, which is the account that cannot be overwritten. This field is
     * the shortcut a REPORT needs: the accounting sheet holds a month of rows
     * and cannot walk every entry's history to colour a number.
     *
     * 200 characters, the same ceiling `withdrawal.reason` and the rejection
     * reason carry, so no one of the four reasons in this schema is the odd one
     * out at the moment somebody types a paragraph into it.
     */
    overCeilingReason: { type: String, trim: true, maxlength: 200 },

    /**
     * ขอถอนใบที่อนุมัติแล้ว — the employee asking for a signed entry back, and
     * the answer. Rules in lib/withdrawal.js; this is only the shape.
     *
     * On the entry rather than in a collection of its own, matching
     * `capOverride`: there is at most one live request per entry, it is
     * meaningless away from the entry it is about, and every screen that would
     * show it is already holding the row. A separate collection would buy
     * "every withdrawal ever asked for" as a query — which `history` already
     * answers, and answers in the one place a person disputing the month is
     * already reading.
     *
     * NOT a status. `state` here is the request's state; `status` above stays
     * the entry's, and a granted withdrawal ends at `cancelled` — which is what
     * every rollup, cap and report already means by "these hours do not count".
     *
     * Only the latest request is kept. Asking again after a refusal overwrites
     * this block, and nothing is lost by that: `history` holds one row per ask
     * and one per answer, with the reason on each. This field is the shortcut a
     * list screen needs ("is anything waiting on this row"), the way
     * `capExceeded` is for the ceilings, and the full account lives where every
     * other full account lives.
     */
    withdrawal: {
      /** 'requested' | 'granted' | 'refused'. Absent means never asked. */
      state: { type: String, enum: [...WITHDRAWAL_STATES, null], default: undefined },

      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      requestedByName: String,
      requestedAt: Date,
      /** Why they are asking. Required by the rule — see withdrawRequestPermission. */
      reason: { type: String, trim: true, maxlength: 200 },

      /** The person who pressed the button, never the one they stood in for. */
      decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      decidedByName: String,
      decidedAt: Date,
      decisionNote: String,

      /** Whose authority, when a ผู้รับช่วง answered. Same trio as everywhere else. */
      onBehalfOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      onBehalfOfName: String,
      delegationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalDelegation' },
    },

    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);

otEntrySchema.pre('validate', function setPeriod(next) {
  if (this.workDate) this.period = this.workDate.slice(0, 7);
  next();
});

/** The monthly review and the printed form both query by these. */
otEntrySchema.index({ employee: 1, period: 1, status: 1 });
otEntrySchema.index({ department: 1, status: 1, workDate: 1 });
/**
 * The two questions asked about a WHOLE MONTH rather than about one person or
 * one department: สรุป OT ส่งบัญชี (`lib/accounting.js`) and the counts that
 * สรุปสถานะงวด re-reads every time ตรวจสอบรายเดือน renders
 * (`pendingInPeriod` and the `$facet` beside it in `lib/periodStatusQuery.js`).
 * Both are `{ period, status: { $in: […] } }` and neither is served by the two
 * above — the first is prefixed on `employee`, the second on `department`, and
 * a compound index can only be entered from its own prefix.
 *
 * It does not collide with either. Mongo's rule is that no two indexes may have
 * the same key pattern in the same order; `{ employee, period, status }` and
 * `{ department, status, workDate }` share no prefix with `{ period, status }`,
 * so this is a third index and not a redeclaration of one. It also makes the
 * single-field `period: true` above redundant for every query that filters on
 * status as well — that one is left in place deliberately, because the entry
 * list filters on `period` alone and the planner needs a cheaper index for it
 * than this one.
 *
 * `period` leads because it is the selective half: one month is a few hundred
 * documents out of the whole collection, where `status: 'approved'` is most of
 * it. The other order would scan the majority of the collection to find one
 * month inside it.
 */
otEntrySchema.index({ period: 1, status: 1 });

/**
 * The fields the employee filled in, plus the hours they computed to — the
 * shape `history.before` keeps. Call it before overwriting an entry to capture
 * the version being replaced.
 */
otEntrySchema.methods.snapshot = function snapshot() {
  return {
    workDate: this.workDate,
    startTime: this.startTime,
    endTime: this.endTime,
    endsNextDay: Boolean(this.endsNextDay),
    noBreakTaken: Boolean(this.noBreakTaken),
    flatDaily: Boolean(this.flatDaily),
    description: this.description,
    buckets: {
      [BUCKETS.OT15_WEEKDAY]: this.buckets?.[BUCKETS.OT15_WEEKDAY] ?? 0,
      [BUCKETS.OT15_HOLIDAY]: this.buckets?.[BUCKETS.OT15_HOLIDAY] ?? 0,
      [BUCKETS.OT3_HOLIDAY]: this.buckets?.[BUCKETS.OT3_HOLIDAY] ?? 0,
    },
    otHours: this.totals?.otHours ?? 0,
    normalHours: this.totals?.normalHours ?? 0,
    policyVersionId: this.policyVersionId || undefined,
  };
};

/**
 * `extra` carries `onBehalfOf` / `onBehalfOfName` / `delegationId` for the
 * decisions a ผู้รับช่วง made, and `adminOverride` for the หัวหน้า step an
 * administrator signed because the department had none — an optional last
 * argument rather than four more positional ones, so that the eleven existing
 * calls stay as they were.
 */
otEntrySchema.methods.log = function log(actor, action, note, fromStatus, before, extra) {
  this.history.push({
    by: actor?._id,
    byName: actor?.name,
    action,
    note,
    fromStatus,
    toStatus: this.status,
    // `undefined` rather than `null`: mongoose stores an explicit null as a
    // subdocument, and a reader cannot tell that from a real empty snapshot.
    before: before || undefined,
    onBehalfOf: extra?.onBehalfOf || undefined,
    onBehalfOfName: extra?.onBehalfOfName || undefined,
    delegationId: extra?.delegationId || undefined,
    adminOverride: extra?.adminOverride || undefined,
  });
};

export default model('OtEntry', otEntrySchema);
