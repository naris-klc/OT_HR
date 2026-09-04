import mongoose from 'mongoose';
import { model } from './model.js';
import { SCAN_FORMATS } from '../../lib/scanFile.js';

/**
 * หนึ่งครั้งที่นิ้วแตะเครื่อง — one line of a scanner's .txt, stored.
 *
 * ── WHAT A PUNCH IS AND IS NOT ──────────────────────────────────────────────
 *
 * It is a claim that a particular รหัสพนักงาน was at a particular door at a
 * particular second. It is NOT an arrival, a departure, a shift, or an hour of
 * OT: the machines here write no in/out flag, so a day with four punches on it
 * says four times and nothing about which is which.
 *
 * NOTHING IN THIS APP READS THIS COLLECTION YET, and that is the current state
 * rather than an oversight. ตรวจสอบประจำเดือน, the CSVs, ใบ F-HR-027 and every
 * figure on every report are computed from OtEntry exactly as they were before
 * this model existed. What turns a punch into hours is a policy nobody has
 * written down — which punch starts the OT, what an odd number of punches
 * means, and above all whether a machine may contradict a sheet two people
 * signed. Storing the evidence first and deciding second is the deliberate
 * order; the reverse is how a payroll figure ends up with two sources that
 * disagree and no rule saying which wins.
 *
 * ── SEPARATE ROWS, NOT AN ARRAY ON THE BATCH ────────────────────────────────
 *
 * The same call EmployeeAudit makes. A month of the real roster is on the order
 * of fifteen thousand punches; an array that size inside the batch document
 * would have to be loaded whole to ask about one person, and would put the file
 * and its reading in one document that no index can reach into. It also
 * survives the batch being deleted, which is exactly when somebody starts
 * asking what was in it.
 */
const scanPunchSchema = new mongoose.Schema(
  {
    /** Exactly as the machine printed it — 'PM-0620' stays 'PM-0620'. */
    code: { type: String, required: true, trim: true },
    /**
     * `normalizeCode()` of the above — the comparison key, and the half of the
     * dedupe index that decides identity. The roster carries two spellings of
     * one code (PM-0620 and PM00511 are both current), and a machine
     * reconfigured to print the other spelling must not double every punch.
     */
    codeKey: { type: String, required: true, index: true },

    /**
     * The roster row this code resolved to at IMPORT TIME, or null.
     *
     * Resolved once and stored, rather than joined on `codeKey` when somebody
     * asks. A code that matches nobody today may match somebody next month —
     * the same string can be reissued, and a query that resolved late would
     * quietly hand one person's July to whoever holds that code in September.
     * Null is a real answer here and is counted on the batch (`unknownCodes`).
     */
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },

    /** 'YYYY-MM-DD' as a string, so no timezone can move a punch across midnight. */
    date: { type: String, required: true, match: [/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'] },
    /**
     * 'HH:MM:SS'. THE SECONDS ARE KEPT, and they are not decoration: they are
     * what makes two scans a minute apart two rows instead of one, and they are
     * a third of the uniqueness key below. OT entries store 'HH:MM' because a
     * request is written to the minute by a person; a machine writes to the
     * second and rounding its output here would be this module inventing data.
     */
    time: { type: String, required: true, match: [/^\d{2}:\d{2}:\d{2}$/, 'time must be HH:MM:SS'] },
    /** 'YYYY-MM' — derived from `date`, set explicitly by the import (see below). */
    period: { type: String, required: true, index: true },

    /** Which machine's shape this line had — see SCAN_FORMATS in lib/scanFile.js. */
    format: { type: String, enum: SCAN_FORMATS.map((f) => f.key), required: true },

    /** The import this arrived in, and the line number it sat on inside it. */
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'ScanBatch', required: true, index: true },
    line: { type: Number, default: null },
  },
  /** Named for the reason ScanBatch's is — see that model. */
  { timestamps: true, collection: 'otScanPunches' },
);

/**
 * ONE PERSON, ONE SECOND, ONE ROW — and this index is what makes re-importing a
 * file safe rather than merely tidy.
 *
 * HR will import the same month twice; it is the most predictable thing about a
 * monthly manual step. With this, the second import is a no-op that reports
 * "0 รายการใหม่" and the batch row records that it happened. Without it, every
 * figure ever computed from this collection would be doubled by an honest
 * mistake nobody would see.
 *
 * `format` is NOT in the key. Two machines recording the same person at the
 * same second cannot happen, and if a door were ever rewired so that it did,
 * two rows for one event is the wrong answer to that too.
 */
scanPunchSchema.index({ codeKey: 1, date: 1, time: 1 }, { unique: true });

/** "this person, this month" — the shape every future reader of this will ask. */
scanPunchSchema.index({ period: 1, codeKey: 1, date: 1 });

/**
 * Kept for documents saved through the model. It is NOT the guarantee: the
 * import writes through `bulkWrite` upserts, which are query middleware's
 * business and not document middleware's, so the route spells `period` out.
 * The same hole `Holiday.year` fell into — see that model for what it cost.
 */
scanPunchSchema.pre('validate', function setPeriod(next) {
  if (this.date) this.period = this.date.slice(0, 7);
  next();
});

export default model('ScanPunch', scanPunchSchema);
