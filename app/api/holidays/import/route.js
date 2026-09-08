import Holiday, { yearOf } from '@/src/models/Holiday.js';
import { route, uploadFile, uploadText, json, fail } from '@/lib/http.js';
import { requireAuth, requireRole } from '@/lib/session.js';
import { pick } from '@/src/lib/csv.js';
import { readUploadedTable, NO_TABLE_UPLOADED } from '@/src/lib/importTable.js';
import { recomputeEntries } from '@/src/services/otService.js';
import { normaliseDate, previousDay } from '@/lib/holidays.js';

// ── [OPEN 10] calendar import ───────────────────────────────────────────────
// The doc asks whether HR's calendar is Excel, PDF or a wall poster. Excel is
// now covered by uploading the WORKBOOK — the "Save As → CSV UTF-8" step this
// used to require went away on 2026-09-07 with src/lib/xlsx.js — and the manual
// route covers the poster. A PDF still needs retyping.

export const POST = route(async (req) => {
  const user = requireRole(await requireAuth(req), 'admin', 'hr');

  // The bytes first, so a .xlsx is recognised as one rather than decoded to
  // mojibake — the same door the roster import uses. See
  // src/lib/importTable.js for why the sniff is on bytes and not on the name.
  const upload = await uploadFile(req, 2 * 1024 * 1024);
  const source = upload ? upload.bytes : await uploadText(req, 2 * 1024 * 1024);
  if (!source || (typeof source === 'string' && !source.trim()) || !source.length) {
    return fail(NO_TABLE_UPLOADED, 400);
  }

  let table;
  try {
    table = readUploadedTable(source);
  } catch (err) {
    return fail(err.message, 400);
  }
  const rows = table.rows;
  if (!rows.length) return fail(NO_TABLE_UPLOADED, 400);
  const errors = [];
  const dates = [];

  for (const [i, row] of rows.entries()) {
    const line = i + 2;
    const raw = pick(row, 'date', 'วันที่', 'Date');
    const name = pick(row, 'name', 'ชื่อวันหยุด', 'วันหยุด', 'Name');
    const date = normaliseDate(raw);
    if (!date) { errors.push({ line, error: `วันที่ไม่ถูกต้อง: "${raw}"` }); continue; }
    if (!name) { errors.push({ line, error: 'ต้องระบุชื่อวันหยุด' }); continue; }

    await Holiday.findOneAndUpdate(
      { date },
      // `year` explicitly — an upsert does not run the model's hook. See
      // src/models/Holiday.js for what that cost before it was noticed.
      { date, name, source: 'import', year: yearOf(date) },
      { upsert: true, setDefaultsOnInsert: true, runValidators: true },
    );
    dates.push(date);
  }

  // Existing entries on the imported dates change rate bucket, so replay them.
  const affected = [...new Set(dates.flatMap((d) => [d, previousDay(d)]))];
  const recomputed = affected.length
    ? await recomputeEntries({ workDate: { $in: affected } }, user)
    : { updated: 0, failed: [] };

  return json({ imported: dates.length, errors, recomputed, source: { kind: table.kind, sheet: table.sheet } });
});
