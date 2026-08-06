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

    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export default model('Department', departmentSchema);
