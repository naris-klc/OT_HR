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
    /**
     * Derived from `date` and stored only as an index for the calendar screen.
     *
     * NOTHING THAT DECIDES A RATE MAY READ IT. It is a copy of four characters
     * of `date`, and a copy is a thing that can be missing: every write path in
     * this app upserts (`findOneAndUpdate`), which does not run the hook below —
     * document middleware is not query middleware, and `runValidators` only
     * checks paths that appear in the update, so `year` was silently absent on
     * every holiday ever added through the screen or the CSV import.
     *
     * That was invisible in the worst way. The calendar listed the day, HR saw
     * it there and believed it was set, and `loadHolidaySet` — which filtered on
     * `year` — could not see it, so every ใบ OT filed on that date was computed
     * and paid as an ordinary workday. Nothing anywhere said so.
     *
     * The writes now set it explicitly through `yearOf` below, and the engine
     * asks `date` directly (see `loadHolidaySet` in src/services/otService.js).
     * Both halves, deliberately: the second is what makes a missed write
     * cosmetic instead of a payroll error.
     */
    year: { type: Number, required: true, index: true },
    source: { type: String, enum: ['import', 'manual'], default: 'manual' },
  },
  { timestamps: true },
);

/**
 * The year a 'YYYY-MM-DD' belongs to — the one derivation, named once.
 *
 * Exported because the upserting routes cannot use the hook and were each
 * deriving it (or, as it turned out, not deriving it at all).
 */
export const yearOf = (date) => Number(String(date).slice(0, 4));

// Kept for documents that ARE saved through the model — the seed, and anything
// future. It is not the guarantee; the routes are.
holidaySchema.pre('validate', function setYear(next) {
  if (this.date) this.year = yearOf(this.date);
  next();
});

export default model('Holiday', holidaySchema);
