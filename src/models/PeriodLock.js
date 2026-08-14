import mongoose from 'mongoose';
import { model } from './model.js';

/**
 * Whether a month is finished, and the record of every time that changed.
 *
 * One document per period. `state` is what every write path checks and is the
 * only mutable field on the schema; `events` is the append-only history behind
 * it — who closed the month, who opened it again and why, in order.
 *
 * WHY BOTH, rather than deriving the state by reading the last event. The state
 * is read on the hot path: every edit, cancellation, approval, refusal and new
 * request asks "is this month closed" before doing anything, and that question
 * must be one indexed field on one small document rather than a walk down an
 * array that grows every time somebody changes their mind. The events are read
 * once, by whoever is asking how this month came to be the way it is.
 *
 * NO DOCUMENT MEANS OPEN. A period that has never been closed has no row here,
 * which keeps every month before this feature shipped in exactly the state it
 * was in — nothing to migrate, and nothing about an old month suddenly becoming
 * uneditable because a collection appeared.
 *
 * The convenience fields — closedAt, closedByName, reopenedAt, reopenedByName —
 * are the last event of each kind, copied out so the settings screen and the
 * refusal messages can say who without loading and scanning the array. They are
 * a cache of `events`, and `events` is the record: if the two ever disagree,
 * the array is right.
 *
 * `byName` is denormalised beside `by` for the reason every audit row in this
 * system does it (see EmployeeAudit, PolicyReplayRun): an account can be
 * deleted, and an audit row that then reads "closed by (deleted user)" has lost
 * the only part anybody needed.
 */
const periodLockEvent = new mongoose.Schema(
  {
    _id: false,
    /** 'close' | 'reopen' */
    action: { type: String, required: true, enum: ['close', 'reopen'], immutable: true },
    at: { type: Date, required: true, immutable: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', immutable: true },
    byName: { type: String, immutable: true },
    /**
     * Required by `reopenRefusal` for a reopen and absent on a close.
     *
     * Reopening is the one path in this system by which a figure that has been
     * signed off, exported and possibly paid may change, and "why" is the only
     * part of that event which cannot be reconstructed from the entries
     * afterwards. Closing needs no reason: the reason is that the month ended.
     */
    reason: { type: String, immutable: true },
  },
);

const periodLockSchema = new mongoose.Schema(
  {
    /** 'YYYY-MM', the same slice OtEntry stamps onto every row. */
    period: { type: String, required: true, unique: true, immutable: true },

    /** The one field the write paths read. */
    state: { type: String, required: true, enum: ['closed', 'open'], default: 'closed' },

    closedAt: Date,
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    closedByName: String,

    reopenedAt: Date,
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    reopenedByName: String,
    reopenReason: String,

    /** Append-only. Nothing in the app removes or rewrites an element. */
    events: { type: [periodLockEvent], default: [] },
  },
  { timestamps: true, collection: 'otPeriodLocks' },
);

export default model('PeriodLock', periodLockSchema);
