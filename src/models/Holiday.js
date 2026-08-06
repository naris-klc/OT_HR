import mongoose from 'mongoose';
import { model } from './model.js';

/**
 * วันหยุดบริษัท. Primus maintains its OWN calendar — this is deliberately not
 * the standard government list (§8), so there is no built-in seed of Thai
 * public holidays. The calendar is imported, presumably yearly.
 *
 * [OPEN 10] Both import paths exist: CSV upload and manual entry. Whatever
 * format HR's existing calendar turns out to be in, one of the two fits.
 *
 * Saturdays and Sundays are NOT stored here — they are holidays by rule
 * (see makeIsHoliday in src/lib/otEngine.js). This collection holds only the
 * extra dates.
 */
const holidaySchema = new mongoose.Schema(
  {
    /** 'YYYY-MM-DD'. Stored as a string so no timezone can shift the date. */
    date: {
      type: String,
      required: true,
      unique: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'],
    },
    name: { type: String, required: true, trim: true },
    year: { type: Number, required: true, index: true },
    source: { type: String, enum: ['import', 'manual'], default: 'manual' },
  },
  { timestamps: true },
);

holidaySchema.pre('validate', function setYear(next) {
  if (this.date) this.year = Number(this.date.slice(0, 4));
  next();
});

export default model('Holiday', holidaySchema);
