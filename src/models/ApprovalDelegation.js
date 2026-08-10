import mongoose from 'mongoose';
import { model } from './model.js';

/**
 * ผู้รับช่วงอนุมัติแทน — B may sign A's approval queue, between these two dates.
 *
 * The rules about what may be created and who may act on one are pure and live
 * in lib/delegation.js. This file is only the shape they are stored in, and
 * three of the choices in it are load-bearing.
 *
 * **A window, not a switch.** There is no `enabled` or `active` field, and that
 * is the point rather than an omission. A toggle gets turned on for a week and
 * left on for a year, because the person who would turn it off is the person
 * who was away — and nothing about the system ever objects, since a stand-in
 * signing is indistinguishable from a stand-in who should have stopped
 * signing months ago. A dated window stops applying on its own.
 *
 * **Dates are strings.** `'YYYY-MM-DD'`, for the reason `Holiday.date` and
 * `Employee.birthDate` are strings: this is a range on a calendar, not a pair
 * of instants, and a Date would let the server's timezone move either end by a
 * day. It also makes `fromDate <= date && date <= toDate` a correct comparison
 * with no library, which is what the pure rules rely on.
 *
 * **Nothing is deleted.** Ending one early sets `revokedAt` rather than
 * removing the row, because entries approved under it point back here through
 * `history.delegationId`, and an audit trail whose evidence can be deleted is
 * an audit trail that proves nothing. `revokedAt` is also not the switch banned
 * above: it only ever closes a window early, and there is no path that reopens
 * one.
 */
const approvalDelegationSchema = new mongoose.Schema(
  {
    /** The manager whose queue is being covered. Their signature is what B makes. */
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    /** The stand-in. `manager` or `hr` only — see DELEGATE_ROLES. */
    to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },

    /** Inclusive, both ends: 5–12 August covers the whole of the 12th. */
    fromDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    toDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },

    /** ลาป่วย, ไปราชการ — free text, shown wherever the delegation is named. */
    reason: { type: String, trim: true, maxlength: 200 },

    /**
     * Who set it up, which is not always `from`: ฝ่ายบุคคล can nominate a
     * stand-in for a manager too ill to log in and do it themselves. That is
     * the case the feature exists for, so the record has to be able to say it
     * happened.
     */
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    createdByName: String,

    /** Ended early — the manager came back. Never cleared. */
    revokedAt: Date,
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    revokedByName: String,
  },
  { timestamps: true },
);

/** "What am I holding right now", and "who is covering me" — both by date. */
approvalDelegationSchema.index({ to: 1, fromDate: 1, toDate: 1 });
approvalDelegationSchema.index({ from: 1, fromDate: 1, toDate: 1 });

export default model('ApprovalDelegation', approvalDelegationSchema);
