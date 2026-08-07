import mongoose from 'mongoose';
import { model } from './model.js';
import { BUCKETS } from '../lib/otEngine.js';

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
    bucket: { type: String, enum: Object.values(BUCKETS), required: true },
    multiplier: { type: Number, required: true },  // bucket label, not a rate
    minutes: { type: Number, required: true },
    hours: { type: Number, required: true },
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
      enum: [
        'submit', 'resubmit', 'approve_mgr', 'reject_mgr', 'approve_hr', 'reject_hr',
        'cancel', 'edit', 'hr_edit', 'recompute',
      ],
      required: true,
    },
    note: String,
    fromStatus: String,
    toStatus: String,

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
    /** e.g. NORMAL_HOURS_IGNORED, RAISED_TO_MINIMUM — shown to reviewers. */
    warnings: { type: [{ code: String, message: String, minutes: Number }], default: [] },

    // ── approval flow (§6) ──────────────────────────────────────────────────
    status: { type: String, enum: STATUSES, default: 'pending_mgr', required: true, index: true },
    /** 'YYYY-MM' — the month this entry rolls up into. Derived from workDate. */
    period: { type: String, required: true, index: true },

    managerDecision: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      at: Date,
      note: String,
    },
    hrDecision: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
      at: Date,
      note: String,
    },
    rejectionReason: String,

    /**
     * [OPEN 8] Set when the entry pushed its department over the monthly cap
     * and policy.capBehaviour is 'warn'. HR sees the flag and decides.
     */
    capExceeded: { type: Boolean, default: false },
    capSnapshot: {
      capHours: Number,
      usedHoursBefore: Number,
      basis: String,
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
  };
};

otEntrySchema.methods.log = function log(actor, action, note, fromStatus, before) {
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
  });
};

export default model('OtEntry', otEntrySchema);
