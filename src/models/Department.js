import mongoose from 'mongoose';
import { model } from './model.js';

/**
 * แผนก. One department has one manager and roughly 5–6 people (§9).
 *
 * §12.3: the monthly cap lives HERE, not on a settings singleton. Some
 * departments cap at 40 hr/month, others have none — hence nullable.
 */
const departmentSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    nameTh: { type: String, trim: true },

    /** The one manager who approves this department's requests. */
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },

    /**
     * [OPEN 8 / 9] null = no cap for this department. Counted per calendar
     * month on the basis set by policy.capBasis.
     */
    monthlyCapHours: { type: Number, default: null, min: 0 },

    /**
     * The same ceiling over a shorter window — null = none, and null is the
     * DEFAULT so that adding this field caps nobody who was not capped before.
     *
     * A pair rather than a replacement: forty hours in a month is a budget, and
     * a department can stay inside it while one person works thirty of them in
     * a single week. The two answer different questions and both are checked on
     * every submission (see `checkCap`), so an entry can breach either, both, or
     * neither.
     *
     * `null` and `0` are different answers and the code must never conflate
     * them — see `capBreaches` in lib/caps.js. Blank means no weekly ceiling;
     * zero means this department files no OT at all.
     *
     * Which week is `policy.weekStartsOn`, and the hours are attributed by the
     * date of each SEGMENT, so a shift crossing midnight into a new week is
     * split between the two rather than charged whole to the one it started in.
     */
    weeklyCapHours: { type: Number, default: null, min: 0 },

    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export default model('Department', departmentSchema);
