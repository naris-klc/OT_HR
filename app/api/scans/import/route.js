import { createHash } from 'node:crypto';
import ScanBatch from '@/src/models/ScanBatch.js';
import ScanPunch from '@/src/models/ScanPunch.js';
import Employee from '@/src/models/Employee.js';
import { route, uploadFile, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { normalizeCode } from '@/src/lib/employeeCode.js';
import { companyOf } from '@/src/config/companies.js';
import {
  SCAN_MAX_BYTES,
  decodeScanText, parseScanFile, scanSummary, decideCompany,
} from '@/lib/scanFile.js';

/**
 * นำเข้าไฟล์ .txt จากเครื่องสแกนนิ้วมือ — ฝ่ายบุคคล press the button, this
 * stores the file and its lines, and nothing else in the app changes.
 *
 * ── WHAT THIS ROUTE DOES NOT CALL ───────────────────────────────────────────
 *
 * `recomputeEntries`. Every other import in this app ends with it — the holiday
 * calendar does, because a date becoming a holiday moves its entries into a
 * different rate bucket. A punch moves nothing: no figure on ตรวจสอบประจำเดือน,
 * no ใบ F-HR-027 and no CSV reads this collection. That is the whole design and
 * the reason it is safe to build the store before the rule that reads it —
 * see the header of src/models/ScanPunch.js.
 *
 * ── WHY THE WHOLE FILE IS PARSED BEFORE ANYTHING IS WRITTEN ─────────────────
 *
 * A partly-imported month is the one outcome nobody could detect afterwards:
 * the punches that made it in look exactly like a complete import, and the ones
 * that did not are simply absent. So the parse happens first, in memory, and a
 * file with no readable scan in it at all is refused before a batch row exists.
 *
 * ── THE CLIENT'S PREVIEW IS NOT TRUSTED ─────────────────────────────────────
 *
 * ตรวจสอบประจำเดือน shows HR what the file says before they press ยืนยัน, using
 * the same lib/scanFile.js this route imports. What travels over the wire is
 * the FILE, never that reading: the server decodes and parses the bytes again
 * and stores what IT read. The preview is a question asked of the same module,
 * not an answer the server takes on faith.
 */
export const POST = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'admin', 'hr');

  const upload = await uploadFile(req, SCAN_MAX_BYTES);
  if (!upload) return fail('ไม่พบไฟล์ที่อัปโหลด', 400);

  const { text, encoding } = decodeScanText(upload.bytes);
  const parsed = parseScanFile(text);
  const summary = scanSummary(parsed);

  /**
   * A file that read as nothing is refused, and the refusal says which of the
   * two ways it read as nothing — an empty file and a file of forty unreadable
   * lines are different problems with different repairs, and "ไม่พบข้อมูล" over
   * both would send HR looking in the wrong place for either.
   */
  if (!summary.punchCount) {
    return fail(
      parsed.skipped.length || parsed.errors.length
        ? `อ่านไฟล์นี้ไม่ออกสักบรรทัด (${parsed.skipped.length + parsed.errors.length} บรรทัด)`
          + ' — ตรวจว่าเป็นไฟล์ .txt ที่ส่งออกจากเครื่องสแกนนิ้วมือหรือไม่'
        : 'ไฟล์นี้ไม่มีข้อมูลการสแกนอยู่เลย',
      400,
      { skipped: parsed.skipped.slice(0, 5), errors: parsed.errors.slice(0, 5) },
    );
  }

  /**
   * THE ROSTER IS READ ONCE, NOT ONCE PER CODE.
   *
   * A month's file holds a few hundred distinct codes and the roster is a few
   * hundred rows; `codeMatcher()` would be a regex query per code that no index
   * can serve. One `find` and a Map built with the same `normalizeCode()` the
   * matcher is built from gives the same answer — PM-0620 in the file finds
   * PM00620 on the roster and the reverse — for one round trip.
   */
  const roster = await Employee.find({}, 'code name company').lean();
  const byKey = new Map(roster.map((e) => [normalizeCode(e.code), e]));
  const unknownCodes = summary.codes.filter((key) => !byKey.has(key)).sort();

  /**
   * WHICH OF THE MONTH'S FOUR FILES THIS IS. The machine came off the shape of
   * the lines; the company comes off the ROSTER — one `companyOf` per punch,
   * over the rows that resolved, and `decideCompany` reads the tally.
   *
   * PER PUNCH AND NOT PER DISTINCT CODE, deliberately: the counts are what make
   * a `mixed` verdict readable afterwards, and "142 punches Primus against 1
   * Themtech" (a leaver's finger still on the machine) is a different thing
   * from "80 against 76" (the wrong export). One vote per person would flatten
   * both into "two companies" and throw the distinction away.
   *
   * Unresolved codes vote for nobody. They are counted and listed separately —
   * guessing their payroll from the `PM` / `THT` prefix is the one thing
   * src/config/companies.js says not to do.
   */
  const { company, counts: companyCounts } = decideCompany(
    parsed.punches.map((p) => {
      const employee = byKey.get(p.codeKey);
      return employee ? companyOf(employee) : null;
    }),
  );

  const sha256 = createHash('sha256').update(upload.bytes).digest('hex');
  /**
   * Named, never refused — see the header of src/models/ScanBatch.js. The
   * response carries it so the screen can say "ไฟล์เดียวกับที่นำเข้าเมื่อ …"
   * beside an insert count of zero, which together are the whole explanation.
   */
  const previous = await ScanBatch.findOne({ sha256 }).select('filename createdAt').lean();

  /**
   * ── THE FILES THIS ONE REPLACES ────────────────────────────────────────────
   *
   * *"ถ้าเป็นวันที่ซ้ำกับไฟล์เดิม ให้เอาไฟล์ใหม่ทับไฟล์เก่าไปเลย"* (HR,
   * 2026-09-04). A second file over the same MACHINE, the same COMPANY and
   * dates this one covers takes the earlier file's place — the right default
   * for a re-export, which is what a corrected file is.
   *
   * ── THE SCOPE IS THE SLOT × THIS FILE'S DATE RANGE, AND BOTH HALVES MATTER ─
   *
   * **The slot**, because เครื่องที่ 1 and เครื่องที่ 2 are two doors and both
   * readings of a day are real; replacing "the day" would delete the other
   * machine's evidence. Matched on `format` AND `company` exactly — a file
   * whose company came out `mixed` or unresolved replaces only other files that
   * came out the same way, which is to say almost never, which is correct: a
   * file nobody can place must not take over a slot it was never in.
   *
   * **The date RANGE and not the set of days present**, because a corrected
   * export can legitimately DROP a day — a day recorded in error. Replacing
   * only the days the new file mentions would leave that day's rows standing,
   * which is the one outcome nobody could explain afterwards. Inside `from`..`to`
   * the new file is the truth, including where it is silent.
   *
   * A file with no dates in it never reaches here (the parse refuses it above).
   */
  const replaceable = summary.from && summary.to
    ? await ScanBatch.find({
      format: summary.format,
      company,
      from: { $lte: summary.to },
      to: { $gte: summary.from },
    }).select('filename createdAt from to').sort({ createdAt: 1 }).lean()
    : [];

  const batch = await ScanBatch.create({
    filename: upload.name || 'scan.txt',
    format: summary.format,
    company,
    companyCounts,
    encoding,
    text,
    byteSize: upload.bytes.length,
    sha256,
    lineCount: summary.lineCount,
    punchCount: summary.punchCount,
    skippedCount: summary.skippedCount,
    errorCount: summary.errorCount,
    duplicateCount: summary.duplicateCount,
    peopleCount: summary.peopleCount,
    from: summary.from,
    to: summary.to,
    periods: summary.periods,
    unknownCodes,
    importedBy: user._id,
    importedByName: user.name,
  });

  /**
   * THE REPLACE ITSELF, and it happens BEFORE the new rows are written.
   *
   * Ordered this way so the two never coexist: writing first and deleting after
   * would need the delete to know which rows it had just written, and a delete
   * that has to spare something is a delete that will one day spare the wrong
   * thing. Emptying the slot's range first makes the write below an ordinary
   * insert into an empty space.
   *
   * The batch ROWS of the replaced files are kept — see `supersededBy` on the
   * model. What is deleted is their punches inside this file's range, which is
   * exactly what the new file now answers for.
   */
  const replacedIds = replaceable.map((b) => b._id);
  let replacedPunchCount = 0;
  const replaces = [];
  if (replacedIds.length) {
    for (const old of replaceable) {
      const gone = await ScanPunch.countDocuments({
        batch: old._id, date: { $gte: summary.from, $lte: summary.to },
      });
      if (gone) replaces.push({ batch: old._id, filename: old.filename, punches: gone });
      replacedPunchCount += gone;
    }
    await ScanPunch.deleteMany({
      batch: { $in: replacedIds },
      date: { $gte: summary.from, $lte: summary.to },
    });
    await ScanBatch.updateMany({ _id: { $in: replacedIds } }, { $set: { supersededBy: batch._id } });
    batch.replaces = replaces;
    batch.replacedPunchCount = replacedPunchCount;
  }

  /**
   * Upserts on the unique key — and `$set`, not `$setOnInsert`, since the
   * replace above.
   *
   * `$setOnInsert` was right while the first import owned a row for good: a
   * punch already stored belonged to the batch that brought it in, and a
   * re-import had no business rewriting that provenance. Replacing reverses
   * exactly that: the new file IS the owner of its range now, so a row that
   * survives the delete — which can only be a row from a DIFFERENT slot at the
   * same second, i.e. practically never — is re-pointed rather than left
   * describing a file that no longer answers for it.
   *
   * The upsert is kept rather than becoming `insertMany` because the unique
   * index still has to be the thing that decides, not this route's assumption
   * that it just emptied the space.
   *
   * `period` is spelled out here for the reason `Holiday.year` has to be — a
   * bulk upsert is query middleware's business, so the model's `pre('validate')`
   * hook does not run and a field left to it would silently be absent.
   */
  const writes = parsed.punches.map((p) => ({
    updateOne: {
      filter: { codeKey: p.codeKey, date: p.date, time: p.time },
      update: {
        $set: {
          code: p.code,
          codeKey: p.codeKey,
          employee: byKey.get(p.codeKey)?._id || null,
          date: p.date,
          time: p.time,
          period: p.date.slice(0, 7),
          format: p.format,
          batch: batch._id,
          line: p.line,
        },
      },
      upsert: true,
    },
  }));

  // `ordered: false` — one row losing a race with a concurrent import must not
  // stop the other fourteen thousand. A duplicate-key loss is the intended
  // outcome of this index, not a failure of the import.
  const result = await ScanPunch.bulkWrite(writes, { ordered: false });
  const inserted = result.upsertedCount ?? 0;

  batch.insertedCount = inserted;
  await batch.save();

  /**
   * The batch row WITHOUT the file in it.
   *
   * The file is the record and it is kept (see the model); it is not something
   * a screen that is about to print five lines needs sent back to it. The GET
   * beside this route drops it with `.select('-text')` instead — a route file
   * may only export request handlers, so the two sides say it in their own
   * idiom rather than sharing a helper that would have to live somewhere else
   * entirely to be shared at all.
   */
  const { text: _file, ...batchRow } = batch.toObject();

  return json({
    batch: batchRow,
    summary,
    inserted,
    /** Punches in the file this database already held — the re-import case. */
    already: summary.punchCount - inserted,
    unknownCodes,
    /** Which of the month's four this turned out to be, and the evidence for it. */
    company,
    companyCounts,
    /**
     * WHAT THIS IMPORT DELETED, named file by file.
     *
     * Sent back because a replace that only shows up as a larger insert count
     * is a deletion nobody can see. The screen prints it as its own sentence:
     * which earlier files were taken over and how many of their rows went.
     */
    replaces,
    replacedPunchCount,
    // Enough of each to act on without shipping a megabyte back to a screen
    // that is going to print five lines of it.
    skipped: parsed.skipped.slice(0, 10),
    errors: parsed.errors.slice(0, 10),
    duplicates: parsed.duplicates.slice(0, 10),
    previousImport: previous ? { filename: previous.filename, at: previous.createdAt } : null,
  }, 201);
});
