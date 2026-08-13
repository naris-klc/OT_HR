import mongoose from 'mongoose';
import { model } from './model.js';
import { BUCKETS, DAY_REASONS } from '../lib/otEngine.js';

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
    description: String,
    /** The hours those values computed to — what the form printed at the time. */
    buckets: {
      [BUCKETS.OT15_WEEKDAY]: Number,
      [BUCKETS.OT15_HOLIDAY]: Number,
      [BUCKETS.OT3_HOLIDAY]: Number,
    },
    otHours: Number,
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
      // no matching manager block on the entry, deliberately: see
      // lib/birthdayFiling.js.
      enum: [
        'submit', 'submit_proxy', 'submit_birthday', 'submit_hr_verified', 'resubmit',
        'approve_mgr', 'reject_mgr', 'approve_hr', 'reject_hr',
        'cancel', 'void', 'edit', 'hr_edit', 'recompute',
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
    /** วันที่ the session STARTS. 'YYYY-MM-DD'. */
    workDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    /** จาก — 'HH:MM'. */
    startTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    /** ถึง — 'HH:MM'. May be earlier than startTime when endsNextDay is set. */
    endTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    endsNextDay: { type: Boolean, default: false },

    /** ไม่พักเที่ยง — skip the break deduction (§3). New in v1 per §12. */
    noBreakTaken: { type: Boolean, default: false },

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
    description: this.description,
    buckets: {
      [BUCKETS.OT15_WEEKDAY]: this.buckets?.[BUCKETS.OT15_WEEKDAY] ?? 0,
      [BUCKETS.OT15_HOLIDAY]: this.buckets?.[BUCKETS.OT15_HOLIDAY] ?? 0,
      [BUCKETS.OT3_HOLIDAY]: this.buckets?.[BUCKETS.OT3_HOLIDAY] ?? 0,
    },
    otHours: this.totals?.otHours ?? 0,
    policyVersionId: this.policyVersionId || undefined,
  };
};

/**
 * `extra` carries `onBehalfOf` / `onBehalfOfName` / `delegationId` for the
 * decisions a ผู้รับช่วง made — an optional last argument rather than three
 * more positional ones, so that the eleven existing calls stay as they were.
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
  });
};

export default model('OtEntry', otEntrySchema);
