import mongoose from 'mongoose';
import { model } from './model.js';
import { SCAN_FORMATS, MIXED_FORMAT, MIXED_COMPANY } from '../../lib/scanFile.js';
import { COMPANY_KEYS } from '../config/companies.js';

/**
 * หนึ่งไฟล์ .txt จากเครื่องสแกนนิ้วมือ ที่ ฝ่ายบุคคล นำเข้ามาหนึ่งครั้ง.
 *
 * ── WHY THE FILE ITSELF IS KEPT, AND NOT ONLY THE ROWS ─────────────────────
 *
 * Because the punches in `ScanPunch` are this module's READING of the file, and
 * a reading can be wrong in ways that only become visible months later — a
 * shape that turned out to match a line it should not have, an encoding guessed
 * the wrong way, a machine reconfigured over a weekend. When that happens the
 * question is "what did the file actually say", and the only honest answer is
 * the file. `text` is what makes re-reading possible without asking HR to find
 * a .txt from July on somebody's desktop.
 *
 * It is the same argument the ปิดงวด withdrawal rests on from the other side:
 * the paper that was signed is the record. Here the machine's own output is the
 * nearest thing to paper there is.
 *
 * `sha256` IS NOT UNIQUE, DELIBERATELY. The same bytes imported twice is a
 * mistake worth NAMING and not worth refusing: the punch collection dedupes on
 * its own (see ScanPunch's unique index), so the second import inserts nothing,
 * and a route that refused instead would also refuse the one case where a retry
 * is the right move — an import that died halfway through. The second batch row
 * records that somebody pressed the button, which is true and worth keeping.
 */
const scanBatchSchema = new mongoose.Schema(
  {
    /** As the browser reported it. Never used to decide anything — see `format`. */
    filename: { type: String, required: true, trim: true },

    /**
     * Which machine wrote it, read off the SHAPE of the lines rather than off
     * any field in the file — there is no device id in either format. See
     * SCAN_FORMATS in lib/scanFile.js.
     */
    format: { type: String, enum: [...SCAN_FORMATS.map((f) => f.key), MIXED_FORMAT], required: true },

    /**
     * WHICH OF THE MONTH'S FOUR FILES THIS IS — the other half of `format`.
     *
     * A month brings four: each machine exports ไพรมัส and เดมเทค separately.
     * The machine is readable off the shape of a line; the company is written
     * nowhere in the file, so it is DECIDED FROM THE ROSTER — the people in the
     * file are looked up and `companyOf` is asked about each. Never from the
     * `PM` / `THT` prefix: `src/config/companies.js` is explicit that the prefix
     * is a convention and the stored field is the answer.
     *
     * `mixed` when the file's people are not all on one payroll, and `null`
     * when nobody in it resolved at all. Both are stored rather than refused —
     * they are the two states somebody has to look at, and a file that is not
     * one of the four is exactly what the screen must be able to say.
     */
    company: {
      type: String,
      enum: [...COMPANY_KEYS, MIXED_COMPANY, null],
      default: null,
    },

    /**
     * The evidence behind `company`, punch by payroll — so a `mixed` verdict is
     * readable ("142 ไพรมัส, 1 เดมเทค" is a stray finger; "80 / 76" is the wrong
     * file) without re-resolving a month of codes against a roster that has
     * moved on since.
     */
    companyCounts: {
      type: [new mongoose.Schema(
        { company: String, punches: Number },
        { _id: false },
      )],
      default: [],
    },

    /** Which decoder read it — 'utf-8' or 'windows-874' (TIS-620). */
    encoding: { type: String, required: true },

    /** The file, decoded. The record; everything else here is derived from it. */
    text: { type: String, required: true },
    byteSize: { type: Number, required: true },
    /** Of the raw BYTES, before decoding — so it identifies the file, not the reading. */
    sha256: { type: String, required: true, index: true },

    /**
     * Every line accounted for, in the four ways lib/scanFile.js accounts for
     * them. Stored rather than recomputed so the batch list can be read without
     * loading a megabyte of `text` per row, and so a change to the parser
     * cannot silently restate what an old import found.
     */
    lineCount: { type: Number, default: 0 },
    punchCount: { type: Number, default: 0 },
    /** Of `punchCount`, how many were rows this database did not already hold. */
    insertedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 },

    peopleCount: { type: Number, default: 0 },
    from: { type: String, default: null, match: [/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'] },
    to: { type: String, default: null, match: [/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'] },
    /** 'YYYY-MM', every month the file touches. A file may legitimately hold two. */
    periods: { type: [String], default: [], index: true },

    /**
     * รหัสพนักงาน in the file that match nobody on the roster.
     *
     * NOT AN ERROR AND NOT A REFUSAL. A machine holds fingerprints for people
     * who have left, for a test finger somebody registered once, and for
     * whoever was hired between the last roster edit and this file. What it is
     * is the one number HR should look at after an import, so it is counted and
     * listed here rather than left to be discovered by a query nobody runs.
     */
    unknownCodes: { type: [String], default: [] },

    /**
     * ── RE-IMPORTING REPLACES, AND THIS IS THE RECORD OF IT ───────────────
     *
     * A second file over the same MACHINE, the same COMPANY and dates the new
     * one covers takes the earlier file's place: its punches in that date range
     * are deleted and the new file's are written (HR, 2026-09-04 —
     * *"ถ้าเป็นวันที่ซ้ำกับไฟล์เดิม ให้เอาไฟล์ใหม่ทับไฟล์เก่าไปเลย"*). That is
     * the right default for a re-export: the machine was emptied again after a
     * correction, and the second file is the one to believe.
     *
     * **A DELETION THAT NOBODY CAN SEE IS THE FAILURE MODE HERE**, so both
     * sides are written down. The new batch keeps `replaces` — which files it
     * took over and how many rows went — and each old batch gets
     * `supersededBy` pointing at the one that replaced it. The old batch ROW
     * survives, with its `text` intact: the file is still the record of what
     * the machine said and of what somebody imported, even after its rows
     * stopped being the live ones.
     *
     * The scope is the SLOT, never the day as a whole. เครื่องที่ 2 · ไพรมัส
     * replacing 1–30 กันยายน must not touch เครื่องที่ 1's rows for those days:
     * two machines are two doors and both readings are real.
     */
    replaces: {
      type: [new mongoose.Schema({
        batch: { type: mongoose.Schema.Types.ObjectId, ref: 'ScanBatch' },
        filename: String,
        /** Rows of that file this import deleted. */
        punches: Number,
      }, { _id: false })],
      default: [],
    },
    /** Total rows removed from earlier files of this slot — the sum of `replaces`. */
    replacedPunchCount: { type: Number, default: 0 },
    /** Set on the OLD batch, pointing at the import that took its rows over. */
    supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: 'ScanBatch', default: null },

    importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    /**
     * Denormalised for the reason every other record in this app denormalises
     * the name beside the pointer: the ฝ่ายบุคคล login is shared, so this names
     * an account and not a person, and it must go on saying what it said even
     * if that account is renamed or removed later.
     */
    importedByName: { type: String, default: '' },
  },
  /**
   * NAMED, not left to mongoose's pluraliser — the same call AccessLog,
   * EmployeeAudit, PolicyVersion and PolicyReplayRun make. `npm run backup`
   * enumerates the collections it finds in the DATABASE rather than the model
   * registry (see src/backup.js), so what a collection is called is a fact
   * about the backup and about anybody reading Compass, not an implementation
   * detail. `scanbatches` beside `otPolicyVersions` in that list is a row
   * nobody can place.
   */
  { timestamps: true, collection: 'otScanBatches' },
);

/** The batch list on ตรวจสอบประจำเดือน: this month's imports, newest first. */
scanBatchSchema.index({ periods: 1, createdAt: -1 });

/** "which of the four slots is filled" — the grid the screen draws every visit. */
scanBatchSchema.index({ periods: 1, format: 1, company: 1 });

export default model('ScanBatch', scanBatchSchema);
